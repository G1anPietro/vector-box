<?php
// public/api/inventato_lib.php — "Vero o inventato" (fake or fact), on the shared rooms of spia.php (game "inventato").
// One JSON state per room (table inventato_games), changed inside the caller's BEGIN IMMEDIATE transaction.
//
// Every round all the players get the same curious claim on their own phone and secretly say TRUE or MADE UP before the time
// is up. The SERVER holds the truth and times the answers (the phone never sends a time): right = 100 points + up to 50 for
// speed. The truth and a one-line explanation are sent only once the round is over. After the chosen number of rounds the most
// points win. Data: lib/inventato-q.json, written for this site: [category 0..5, difficulty 0 easy|1 hard, true 1|0,
// [claim it,en,es,fr,de], [explanation it,en,es,fr,de]].

const INVENTATO_MIN_PLAYERS = 2;
const INVENTATO_REVEAL_SECONDS = 8;
const INVENTATO_LANGS = ['it', 'en', 'es', 'fr', 'de'];
const INVENTATO_LEVELS = ['easy', 'hard', 'mix'];
const INVENTATO_ROUNDS = [10, 15, 20];
const INVENTATO_TIMES = [15, 25, 40];

function inventatoDefaultSettings(): array {
    return ['level' => 'mix', 'rounds' => 10, 'time' => 25, 'scores' => false];
}

function inventatoSanitizeSettings(array $in, array $base): array {
    $s = array_merge(inventatoDefaultSettings(), array_intersect_key($base, inventatoDefaultSettings()));
    if (isset($in['level']) && in_array($in['level'], INVENTATO_LEVELS, true)) $s['level'] = $in['level'];
    if (isset($in['rounds']) && in_array($in['rounds'], INVENTATO_ROUNDS, true)) $s['rounds'] = $in['rounds'];
    if (isset($in['time']) && in_array($in['time'], INVENTATO_TIMES, true)) $s['time'] = $in['time'];
    $s['scores'] = is_bool($in['scores'] ?? null) ? $in['scores'] : (is_numeric($in['scores'] ?? null) ? (bool)(int)$in['scores'] : (bool)$s['scores']);
    return $s;
}

/** The whole bank (read once per request). */
function inventatoBank(): array {
    static $bank = null;
    if ($bank === null) $bank = json_decode((string)@file_get_contents(dirname(__DIR__, 2) . '/lib/inventato-q.json'), true) ?: [];
    return $bank;
}

/** Draws a claim of the level, true or made up by a coin toss, never twice until that pile is used up. Returns its bank index. */
function inventatoDraw(string $level, array &$used): int {
    $bank = inventatoBank();
    $diff = ['easy' => 0, 'hard' => 1][$level] ?? null;
    $want = random_int(0, 1);
    $free = fn(?int $truth) => array_values(array_filter(array_keys($bank), fn($i) => ($diff === null || $bank[$i][1] === $diff) && ($truth === null || $bank[$i][2] === $truth) && !in_array($i, $used, true)));
    $c = $free($want) ?: $free(null);
    if (!$c) { $used = []; $c = $free($want) ?: $free(null); }
    $i = $c[random_int(0, count($c) - 1)];
    $used[] = $i;
    return $i;
}

/** What a phone may see of a claim: NEVER whether it is true. */
function inventatoPublic(int $i): array {
    $row = inventatoBank()[$i];
    return ['cat' => $row[0], 'diff' => $row[1], 'text' => array_combine(INVENTATO_LANGS, $row[3])];
}

/** What everybody may see once the round is over. */
function inventatoInfo(int $i): array {
    $row = inventatoBank()[$i];
    return ['truth' => $row[2] === 1, 'explain' => array_combine(INVENTATO_LANGS, $row[4])];
}

/** Points for a right answer: 100, plus up to 50 for answering fast. */
function inventatoPoints(int $ms, int $time): int {
    return 100 + (int)round(50 * max(0.0, 1 - $ms / ($time * 1000)));
}

function inventatoLoad(PDO $db, int $roomId): ?array {
    $st = $db->prepare('SELECT state FROM inventato_games WHERE room_id = :r');
    $st->execute([':r' => $roomId]);
    $raw = $st->fetchColumn();
    return $raw ? json_decode($raw, true) : null;
}

function inventatoSave(PDO $db, int $roomId, array $g): void {
    $db->prepare('INSERT INTO inventato_games (room_id, state, updated_at) VALUES (:r, :s, :t)
                  ON CONFLICT(room_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at')
       ->execute([':r' => $roomId, ':s' => json_encode($g), ':t' => time()]);
}

function inventatoEvent(array &$g, array $ev): void {
    $ev['id'] = ++$g['event_seq'];
    $ev['round'] = $g['round'];
    $g['events'][] = $ev;
    if (count($g['events']) > 40) $g['events'] = array_slice($g['events'], -40);
}

function inventatoActive(array $g): array {
    return array_values(array_diff($g['order'], $g['gone']));
}

function inventatoEnd(array &$g, string $reason): void {
    $g['status'] = 'ended';
    $g['phase'] = 'ended';
    $top = $g['points'] ? max($g['points']) : 0;
    $winners = $top > 0 ? array_values(array_filter($g['order'], fn($p) => ($g['points'][(string)$p] ?? 0) === $top)) : [];
    $g['result'] = ['winners' => $winners, 'reason' => $reason, 'points' => $g['points'], 'right' => $g['right'], 'rounds' => $g['round']];
    inventatoEvent($g, ['t' => 'end', 'why' => $reason]);
}

function inventatoStartRound(array &$g, ?float $now = null): void {
    $now = $now ?? microtime(true);
    $i = inventatoDraw($g['rules']['level'], $g['used']);
    $time = (int)$g['rules']['time'];
    $g['q'] = ['i' => $i, 'started' => $now, 'deadline' => $now + $time, 'time' => $time];
    $g['answers'] = [];
    $g['reveal'] = null;
    $g['phase'] = 'question';
    $g['next_at'] = null;
    inventatoEvent($g, ['t' => 'question', 'n' => $g['round']]);
}

/** The round is over: points for the right answers. */
function inventatoResolve(array &$g, ?float $now = null): void {
    $now = $now ?? microtime(true);
    $info = inventatoInfo($g['q']['i']);
    $truth = $info['truth'] ? 1 : 0;
    $gain = [];
    foreach (inventatoActive($g) as $p) {
        $k = (string)$p;
        $a = $g['answers'][$k] ?? null;
        if ($a !== null && $a['c'] === $truth) {
            $gain[$k] = inventatoPoints($a['ms'], $g['q']['time']);
            $g['points'][$k] = ($g['points'][$k] ?? 0) + $gain[$k];
            $g['right'][$k] = ($g['right'][$k] ?? 0) + 1;
        }
    }
    $g['reveal'] = ['truth' => $info['truth'], 'explain' => $info['explain'], 'answers' => array_map(fn($a) => $a['c'], $g['answers']), 'gain' => (object)$gain, 'last' => $g['round'] >= $g['rules']['rounds']];
    $g['phase'] = 'reveal';
    $g['next_at'] = $now + INVENTATO_REVEAL_SECONDS;
}

function inventatoAdvance(array &$g, ?float $now = null): void {
    if ($g['round'] >= $g['rules']['rounds']) { inventatoEnd($g, 'rounds_done'); return; }
    $g['round']++;
    inventatoStartRound($g, $now);
}

/** Advances the clock-driven parts. Returns true when the state changed (the caller saves it). */
function inventatoTick(array &$g, ?float $now = null): bool {
    if ($g['status'] !== 'play') return false;
    $now = $now ?? microtime(true);
    if ($g['phase'] === 'question') {
        $active = array_map('strval', inventatoActive($g));
        $all = $active && !array_diff($active, array_keys($g['answers']));
        if ($now >= $g['q']['deadline'] || $all) { inventatoResolve($g, $now); return true; }
    } elseif ($g['phase'] === 'reveal' && $now >= $g['next_at']) {
        inventatoAdvance($g, $now);
        return true;
    }
    return false;
}

function inventatoStart(PDO $db, array $room): ?string {
    $s = inventatoSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $players = spiaPlayers($db, (int)$room['id']);
    if (count($players) < INVENTATO_MIN_PLAYERS) return 'need_players_inventato';
    if (!inventatoBank()) return 'no_questions';
    $order = array_map(fn($p) => (int)$p['id'], $players);
    $prev = inventatoLoad($db, (int)$room['id']);
    $g = [
        'match' => (int)($prev['match'] ?? 0) + 1,
        'status' => 'play', 'phase' => 'question', 'rules' => $s, 'order' => $order, 'gone' => [],
        'points' => array_fill_keys(array_map('strval', $order), 0), 'right' => array_fill_keys(array_map('strval', $order), 0),
        'round' => 1, 'used' => [], 'q' => null, 'answers' => [], 'reveal' => null, 'next_at' => null,
        'events' => [], 'event_seq' => (int)($prev['event_seq'] ?? 0), 'result' => null, 'awarded' => false,
    ];
    inventatoEvent($g, ['t' => 'start']);
    inventatoStartRound($g);
    inventatoSave($db, (int)$room['id'], $g);
    return null;
}

function inventatoPlayerLeft(array &$g, int $pid): void {
    if ($g['status'] !== 'play' || !in_array($pid, $g['order'], true) || in_array($pid, $g['gone'], true)) return;
    $g['gone'][] = $pid;
    unset($g['answers'][(string)$pid]);
    inventatoEvent($g, ['t' => 'left', 'p' => $pid]);
    if (count(inventatoActive($g)) < INVENTATO_MIN_PLAYERS) inventatoEnd($g, 'too_few');
}

/** Saves the state and gives each winner a point once (when the room keeps scores). */
function inventatoSaveAndAward(PDO $db, int $roomId, array &$g): void {
    if ($g['status'] === 'ended' && !$g['awarded'] && !empty($g['rules']['scores'])) {
        foreach ($g['result']['winners'] ?? [] as $w) $db->prepare('UPDATE spia_players SET score = score + 1 WHERE id = :p')->execute([':p' => $w]);
        $g['awarded'] = true;
    }
    inventatoSave($db, $roomId, $g);
}

/** Room actions. Returns true (handled), null (not an Inventato action) or an error code. */
function inventatoHandle(PDO $db, array $room, array $device, bool $isHost, array $in, string $action) {
    $g = inventatoLoad($db, (int)$room['id']);
    if ($g && inventatoTick($g)) inventatoSaveAndAward($db, (int)$room['id'], $g);
    $playing = $g && $g['status'] === 'play';
    $own = function ($pid) use ($db, $device): ?int {
        $st = $db->prepare('SELECT id FROM spia_players WHERE id = :id AND device_id = :d AND removed = 0');
        $st->execute([':id' => (int)$pid, ':d' => $device['id']]);
        $id = $st->fetchColumn();
        return $id === false ? null : (int)$id;
    };

    switch ($action) {
        case 'settings':
            if (!$isHost) return 'host_only';
            $new = inventatoSanitizeSettings(is_array($in['settings'] ?? null) ? $in['settings'] : [], json_decode($room['settings'], true) ?: []);
            $db->prepare('UPDATE spia_rooms SET settings = :s WHERE id = :id')->execute([':s' => json_encode($new), ':id' => $room['id']]);
            return true;
        case 'start':
            if (!$isHost) return 'host_only';
            if ($playing) return 'round_running';
            return inventatoStart($db, $room) ?? true;
        case 'end':
            if (!$isHost) return 'host_only';
            if (!$playing) return 'no_round';
            inventatoEnd($g, 'host_ended');
            break;
        case 'next':
            if (!$isHost) return 'host_only';
            if (!$playing || $g['phase'] !== 'reveal') return 'not_now';
            inventatoAdvance($g);
            break;
        case 'answer':
            if (!$playing || $g['phase'] !== 'question') return 'not_now';
            $pid = $own($in['player_id'] ?? 0);
            if ($pid === null) return 'not_your_player';
            $k = (string)$pid;
            if (!in_array($pid, inventatoActive($g), true)) return 'you_are_out';
            if (isset($g['answers'][$k])) return 'already_answered';
            $choice = $in['choice'] ?? null;
            if (!is_int($choice) || $choice < 0 || $choice > 1) return 'bad_choice';   // 1 = true, 0 = made up
            $now = microtime(true);
            if ($now > $g['q']['deadline'] + 0.5) return 'not_now';   // half a second of grace for the network
            $g['answers'][$k] = ['c' => $choice, 'ms' => (int)round(($now - $g['q']['started']) * 1000)];
            inventatoTick($g, $now);
            break;
        default:
            return null;
    }
    inventatoSaveAndAward($db, (int)$room['id'], $g);
    return true;
}

/** What one phone may see. The truth only once the round is over; nobody's choice before that (just who answered). */
function inventatoView(PDO $db, array $room, array $device, bool $adminSession): array {
    $view = spiaView($db, $room, $device, $adminSession);
    $view['game'] = 'inventato';
    $view['settings'] = inventatoSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $g = inventatoLoad($db, (int)$room['id']);
    $view['inventato'] = null;
    if (!$g) return $view;
    $now = microtime(true);
    $mine = array_map(fn($p) => (int)$p['id'], array_filter($view['players'], fn($p) => $p['device_id'] === (int)$device['id']));
    $open = $g['phase'] === 'question';
    $active = inventatoActive($g);
    $me = [];
    foreach (array_values(array_intersect($mine, $g['order'])) as $pid) {
        $a = $g['answers'][(string)$pid] ?? null;
        $me[] = ['player_id' => $pid, 'active' => in_array($pid, $active, true), 'answered' => $a !== null];
    }
    $q = null;
    if ($g['q']) $q = inventatoPublic($g['q']['i']) + ['time' => $g['q']['time'], 'left' => $open ? max(0, round($g['q']['deadline'] - $now, 1)) : 0];
    $view['inventato'] = [
        'match' => $g['match'], 'status' => $g['status'], 'phase' => $g['phase'], 'round' => $g['round'], 'total' => $g['rules']['rounds'],
        'order' => $g['order'], 'active' => $active, 'points' => $g['points'], 'right' => $g['right'], 'rules' => $g['rules'],
        'answered' => array_map('intval', array_keys($g['answers'])),
        'q' => $q,
        'reveal' => $open ? null : $g['reveal'],
        'next_left' => $g['phase'] === 'reveal' ? max(0, round($g['next_at'] - $now, 1)) : null,
        'events' => $g['events'], 'result' => $g['result'], 'me' => $me,
    ];
    return $view;
}

/** For the admin LIVE panel: the truth and what everybody chose while the round is open. */
function inventatoLiveInfo(PDO $db, int $roomId): ?array {
    $g = inventatoLoad($db, $roomId);
    if (!$g) return null;
    $i = $g['q']['i'] ?? null;
    return [
        'status' => $g['status'], 'phase' => $g['phase'], 'round' => $g['round'], 'total' => $g['rules']['rounds'],
        'level' => $g['rules']['level'], 'points' => $g['points'],
        'claim' => $i !== null ? array_combine(INVENTATO_LANGS, inventatoBank()[$i][3]) : null,
        'truth' => $i !== null ? inventatoBank()[$i][2] === 1 : null,
        'answers' => array_map(fn($a) => $a['c'], $g['answers']),
    ];
}
