<?php
// public/api/bandiere_lib.php — "Bandiere" (flags and capitals quiz), on the shared rooms of spia.php (game "bandiere").
// One JSON state per room (table bandiere_games), changed inside the caller's BEGIN IMMEDIATE transaction.
//
// Every round all the players get the same question on their own phone: a flag to name, a name to match with a flag,
// or the capital of a country (the SERVER picks the kind in "mix" mode). Four options, one right. The server judges and
// times the answers (the phone never sends a time): right = 100 points + up to 100 for speed. Optional lives: a wrong or
// missing answer costs one, at zero you are out. After the chosen number of rounds the most points win.
// Flags are the flag EMOJI built by the page from the ISO code: no image files. Data: lib/bandiere-q.json, written
// for this site: [iso, difficulty 0|1|2, region, [name it,en,es,fr,de], [capital it,en,es,fr,de]].

const BANDIERE_MIN_PLAYERS = 2;
const BANDIERE_REVEAL_SECONDS = 6;
const BANDIERE_LANGS = ['it', 'en', 'es', 'fr', 'de'];
const BANDIERE_LEVELS = ['easy' => 20, 'normal' => 15, 'hard' => 12, 'mix' => 15];   // seconds to answer
const BANDIERE_MODES = ['flag', 'name', 'capital', 'mix'];
const BANDIERE_ROUNDS = [10, 20, 30];

function bandiereDefaultSettings(): array {
    return ['level' => 'mix', 'mode' => 'mix', 'rounds' => 10, 'lives' => 0, 'scores' => false];
}

function bandiereSanitizeSettings(array $in, array $base): array {
    $s = array_merge(bandiereDefaultSettings(), array_intersect_key($base, bandiereDefaultSettings()));
    if (isset($in['level']) && is_string($in['level']) && isset(BANDIERE_LEVELS[$in['level']])) $s['level'] = $in['level'];
    if (isset($in['mode']) && in_array($in['mode'], BANDIERE_MODES, true)) $s['mode'] = $in['mode'];
    if (isset($in['rounds']) && in_array($in['rounds'], BANDIERE_ROUNDS, true)) $s['rounds'] = $in['rounds'];
    $s['lives'] = is_numeric($in['lives'] ?? null) ? max(0, min(5, (int)$in['lives'])) : (int)$s['lives'];
    $s['scores'] = is_bool($in['scores'] ?? null) ? $in['scores'] : (is_numeric($in['scores'] ?? null) ? (bool)(int)$in['scores'] : (bool)$s['scores']);
    return $s;
}

/** The whole country list (read once per request). */
function bandiereBank(): array {
    static $bank = null;
    if ($bank === null) $bank = json_decode((string)@file_get_contents(dirname(__DIR__, 2) . '/lib/bandiere-q.json'), true) ?: [];
    return $bank;
}

/** The question kind of a round: f2n flag -> name, n2f name -> flag, cap country -> capital. Mix: the server decides. */
function bandiereKind(string $mode): string {
    return match ($mode) { 'flag' => 'f2n', 'name' => 'n2f', 'capital' => 'cap', default => ['f2n', 'n2f', 'cap'][random_int(0, 2)] };
}

/**
 * Draws a country of the level (never twice until that pile is used up) and three wrong ones of the SAME difficulty,
 * from the same region first. Returns ['i' => bank index, 'kind', 'opts' => 4 bank indexes in screen order, 'right' => position].
 */
function bandiereDraw(string $level, string $mode, array &$used): array {
    $bank = bandiereBank();
    $diff = ['easy' => 0, 'normal' => 1, 'hard' => 2][$level] ?? null;
    $free = fn() => array_values(array_filter(array_keys($bank), fn($i) => ($diff === null || $bank[$i][1] === $diff) && !in_array($i, $used, true)));
    $c = $free();
    if (!$c) { $used = []; $c = $free(); }
    $i = $c[random_int(0, count($c) - 1)];
    $used[] = $i;
    $same = array_values(array_filter(array_keys($bank), fn($j) => $j !== $i && $bank[$j][1] === $bank[$i][1]));
    $near = array_values(array_filter($same, fn($j) => $bank[$j][2] === $bank[$i][2]));
    $far = array_values(array_diff($same, $near));
    $wrong = array_slice(array_merge(spiaShuffle($near), spiaShuffle($far)), 0, 3);
    $opts = spiaShuffle(array_merge([$i], $wrong));
    return ['i' => $i, 'kind' => bandiereKind($mode), 'opts' => $opts, 'right' => array_search($i, $opts, true)];
}

/** What a phone may see of a question: NEVER which option is right. Flag options carry only their ISO code. */
function bandierePublic(array $q): array {
    $bank = bandiereBank();
    $row = $bank[$q['i']];
    $per = function (int $col) use ($bank, $q): array {
        $o = [];
        foreach (BANDIERE_LANGS as $k => $l) $o[$l] = array_map(fn($j) => $bank[$j][$col][$k], $q['opts']);
        return $o;
    };
    $name = array_combine(BANDIERE_LANGS, $row[3]);
    return match ($q['kind']) {
        'f2n' => ['kind' => 'f2n', 'flag' => $row[0], 'prompt' => null, 'options' => $per(3)],
        'n2f' => ['kind' => 'n2f', 'flag' => null, 'prompt' => $name, 'options' => array_map(fn($j) => $bank[$j][0], $q['opts'])],
        default => ['kind' => 'cap', 'flag' => $row[0], 'prompt' => $name, 'options' => $per(4)],
    };
}

/** What everybody may see once the round is over: the country, its capital, and the name of every option. */
function bandiereInfo(array $q): array {
    $bank = bandiereBank();
    $row = $bank[$q['i']];
    $col = $q['kind'] === 'cap' ? 4 : 3;
    $labels = [];
    foreach (BANDIERE_LANGS as $k => $l) $labels[$l] = array_map(fn($j) => $bank[$j][$col][$k], $q['opts']);
    return ['iso' => $row[0], 'name' => array_combine(BANDIERE_LANGS, $row[3]), 'capital' => array_combine(BANDIERE_LANGS, $row[4]), 'labels' => $labels];
}

/** Points for a right answer: 100, plus up to 100 for answering fast. */
function bandierePoints(int $ms, int $time): int {
    return 100 + (int)round(100 * max(0.0, 1 - $ms / ($time * 1000)));
}

function bandiereLoad(PDO $db, int $roomId): ?array {
    $st = $db->prepare('SELECT state FROM bandiere_games WHERE room_id = :r');
    $st->execute([':r' => $roomId]);
    $raw = $st->fetchColumn();
    return $raw ? json_decode($raw, true) : null;
}

function bandiereSave(PDO $db, int $roomId, array $g): void {
    $db->prepare('INSERT INTO bandiere_games (room_id, state, updated_at) VALUES (:r, :s, :t)
                  ON CONFLICT(room_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at')
       ->execute([':r' => $roomId, ':s' => json_encode($g), ':t' => time()]);
}

function bandiereEvent(array &$g, array $ev): void {
    $ev['id'] = ++$g['event_seq'];
    $ev['round'] = $g['round'];
    $g['events'][] = $ev;
    if (count($g['events']) > 40) $g['events'] = array_slice($g['events'], -40);
}

/** Players who can still answer: not gone, and (with lives on) with a life left. */
function bandiereAlive(array $g): array {
    $lives = $g['rules']['lives'] > 0;
    return array_values(array_filter($g['order'], fn($p) => !in_array($p, $g['gone'], true) && (!$lives || ($g['lives'][(string)$p] ?? 0) > 0)));
}

function bandiereEnd(array &$g, string $reason): void {
    $g['status'] = 'ended';
    $g['phase'] = 'ended';
    $top = $g['points'] ? max($g['points']) : 0;
    $winners = $top > 0 ? array_values(array_filter($g['order'], fn($p) => ($g['points'][(string)$p] ?? 0) === $top)) : [];
    $g['result'] = ['winners' => $winners, 'reason' => $reason, 'points' => $g['points'], 'lives' => $g['lives']];
    bandiereEvent($g, ['t' => 'end', 'why' => $reason]);
}

function bandiereStartRound(array &$g, ?float $now = null): void {
    $now = $now ?? microtime(true);
    $q = bandiereDraw($g['rules']['level'], $g['rules']['mode'], $g['used']);
    $time = BANDIERE_LEVELS[$g['rules']['level']];
    $g['q'] = $q + ['started' => $now, 'deadline' => $now + $time, 'time' => $time];
    $g['answers'] = [];
    $g['reveal'] = null;
    $g['phase'] = 'question';
    $g['next_at'] = null;
    bandiereEvent($g, ['t' => 'question', 'n' => $g['round']]);
}

/** The round is over: points for the right answers, a life less for the others (when lives are on). */
function bandiereResolve(array &$g, ?float $now = null): void {
    $now = $now ?? microtime(true);
    $alive = bandiereAlive($g);
    $gain = [];
    $fell = [];
    foreach ($alive as $p) {
        $k = (string)$p;
        $a = $g['answers'][$k] ?? null;
        if ($a !== null && $a['c'] === $g['q']['right']) {
            $gain[$k] = bandierePoints($a['ms'], $g['q']['time']);
            $g['points'][$k] = ($g['points'][$k] ?? 0) + $gain[$k];
        } elseif ($g['rules']['lives'] > 0) {
            $g['lives'][$k] = max(0, $g['lives'][$k] - 1);
            if ($g['lives'][$k] === 0) { $fell[] = $p; bandiereEvent($g, ['t' => 'fell', 'p' => $p]); }
        }
    }
    $g['reveal'] = ['right' => $g['q']['right'], 'answers' => array_map(fn($a) => $a['c'], $g['answers']), 'gain' => (object)$gain, 'fell' => $fell, 'info' => bandiereInfo($g['q'])];
    $g['phase'] = 'reveal';
    $g['next_at'] = $now + BANDIERE_REVEAL_SECONDS;
}

/** After the reveal: the next question, or the end (all rounds played, everybody out, one left in a lives match). */
function bandiereAdvance(array &$g, ?float $now = null): void {
    $alive = count(bandiereAlive($g));
    $lives = $g['rules']['lives'] > 0;
    $why = $g['round'] >= $g['rules']['rounds'] ? 'rounds_done' : ($alive === 0 ? 'all_out' : ($lives && count($g['order']) > 1 && $alive <= 1 ? 'last_standing' : null));
    if ($why !== null) { bandiereEnd($g, $why); return; }
    $g['round']++;
    bandiereStartRound($g, $now);
}

/** Advances the clock-driven parts. Returns true when the state changed (the caller saves it). */
function bandiereTick(array &$g, ?float $now = null): bool {
    if ($g['status'] !== 'play') return false;
    $now = $now ?? microtime(true);
    if ($g['phase'] === 'question') {
        $alive = bandiereAlive($g);
        $all = $alive && !array_diff(array_map('strval', $alive), array_keys($g['answers']));
        if ($now >= $g['q']['deadline'] || $all || !$alive) { bandiereResolve($g, $now); return true; }
    } elseif ($g['phase'] === 'reveal' && $now >= $g['next_at']) {
        bandiereAdvance($g, $now);
        return true;
    }
    return false;
}

function bandiereStart(PDO $db, array $room): ?string {
    $s = bandiereSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $players = spiaPlayers($db, (int)$room['id']);
    if (count($players) < BANDIERE_MIN_PLAYERS) return 'need_players_bandiere';
    if (!bandiereBank()) return 'no_questions';
    $order = array_map(fn($p) => (int)$p['id'], $players);
    $prev = bandiereLoad($db, (int)$room['id']);
    $g = [
        'match' => (int)($prev['match'] ?? 0) + 1,
        'status' => 'play', 'phase' => 'question', 'rules' => $s, 'order' => $order, 'gone' => [],
        'lives' => array_fill_keys(array_map('strval', $order), $s['lives']),
        'points' => array_fill_keys(array_map('strval', $order), 0),
        'round' => 1, 'used' => [], 'q' => null, 'answers' => [], 'reveal' => null, 'next_at' => null,
        'events' => [], 'event_seq' => (int)($prev['event_seq'] ?? 0), 'result' => null, 'awarded' => false,
    ];
    bandiereEvent($g, ['t' => 'start']);
    bandiereStartRound($g);
    bandiereSave($db, (int)$room['id'], $g);
    return null;
}

function bandierePlayerLeft(array &$g, int $pid): void {
    if ($g['status'] !== 'play' || !in_array($pid, $g['order'], true) || in_array($pid, $g['gone'], true)) return;
    $g['gone'][] = $pid;
    unset($g['answers'][(string)$pid]);
    bandiereEvent($g, ['t' => 'left', 'p' => $pid]);
    if (!bandiereAlive($g)) bandiereEnd($g, 'all_out');
}

/** Saves the state and gives each winner a point once (when the room keeps scores). */
function bandiereSaveAndAward(PDO $db, int $roomId, array &$g): void {
    if ($g['status'] === 'ended' && !$g['awarded'] && !empty($g['rules']['scores'])) {
        foreach ($g['result']['winners'] ?? [] as $w) $db->prepare('UPDATE spia_players SET score = score + 1 WHERE id = :p')->execute([':p' => $w]);
        $g['awarded'] = true;
    }
    bandiereSave($db, $roomId, $g);
}

/** Room actions for Bandiere. Returns true (handled), null (not a Bandiere action) or an error code. */
function bandiereHandle(PDO $db, array $room, array $device, bool $isHost, array $in, string $action) {
    $g = bandiereLoad($db, (int)$room['id']);
    if ($g && bandiereTick($g)) bandiereSaveAndAward($db, (int)$room['id'], $g);
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
            $new = bandiereSanitizeSettings(is_array($in['settings'] ?? null) ? $in['settings'] : [], json_decode($room['settings'], true) ?: []);
            $db->prepare('UPDATE spia_rooms SET settings = :s WHERE id = :id')->execute([':s' => json_encode($new), ':id' => $room['id']]);
            return true;
        case 'start':
            if (!$isHost) return 'host_only';
            if ($playing) return 'round_running';
            return bandiereStart($db, $room) ?? true;
        case 'end':
            if (!$isHost) return 'host_only';
            if (!$playing) return 'no_round';
            bandiereEnd($g, 'host_ended');
            break;
        case 'next':
            if (!$isHost) return 'host_only';
            if (!$playing || $g['phase'] !== 'reveal') return 'not_now';
            bandiereAdvance($g);
            break;
        case 'answer':
            if (!$playing || $g['phase'] !== 'question') return 'not_now';
            $pid = $own($in['player_id'] ?? 0);
            if ($pid === null) return 'not_your_player';
            $k = (string)$pid;
            if (!in_array($pid, bandiereAlive($g), true)) return 'you_are_out';
            if (isset($g['answers'][$k])) return 'already_answered';
            $choice = $in['choice'] ?? null;
            if (!is_int($choice) || $choice < 0 || $choice > 3) return 'bad_choice';
            $now = microtime(true);
            if ($now > $g['q']['deadline'] + 0.5) return 'not_now';   // half a second of grace for the network
            $g['answers'][$k] = ['c' => $choice, 'ms' => (int)round(($now - $g['q']['started']) * 1000)];
            bandiereTick($g, $now);
            break;
        default:
            return null;
    }
    bandiereSaveAndAward($db, (int)$room['id'], $g);
    return true;
}

/** What one phone may see. Which option is right: only once the round is over. */
function bandiereView(PDO $db, array $room, array $device, bool $adminSession): array {
    $view = spiaView($db, $room, $device, $adminSession);
    $view['game'] = 'bandiere';
    $view['settings'] = bandiereSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $g = bandiereLoad($db, (int)$room['id']);
    $view['bandiere'] = null;
    if (!$g) return $view;
    $now = microtime(true);
    $mine = array_map(fn($p) => (int)$p['id'], array_filter($view['players'], fn($p) => $p['device_id'] === (int)$device['id']));
    $open = $g['phase'] === 'question';
    $alive = bandiereAlive($g);
    $me = [];
    foreach (array_values(array_intersect($mine, $g['order'])) as $pid) {
        $a = $g['answers'][(string)$pid] ?? null;
        $me[] = ['player_id' => $pid, 'alive' => in_array($pid, $alive, true), 'answered' => $a !== null, 'choice' => $a['c'] ?? null];
    }
    $q = null;
    if ($g['q']) $q = bandierePublic($g['q']) + ['time' => $g['q']['time'], 'left' => $open ? max(0, round($g['q']['deadline'] - $now, 1)) : 0];
    $view['bandiere'] = [
        'match' => $g['match'], 'status' => $g['status'], 'phase' => $g['phase'], 'round' => $g['round'], 'total' => $g['rules']['rounds'],
        'order' => $g['order'], 'alive' => $alive, 'lives' => $g['lives'], 'points' => $g['points'], 'rules' => $g['rules'],
        'answered' => array_map('intval', array_keys($g['answers'])),
        'q' => $q,
        'reveal' => $open ? null : $g['reveal'],
        'next_left' => $g['phase'] === 'reveal' ? max(0, round($g['next_at'] - $now, 1)) : null,
        'events' => $g['events'], 'result' => $g['result'], 'me' => $me,
    ];
    return $view;
}

/** For the admin LIVE panel: the admin sees the right option and what everybody chose while the round is open. */
function bandiereLiveInfo(PDO $db, int $roomId): ?array {
    $g = bandiereLoad($db, $roomId);
    if (!$g) return null;
    $q = $g['q'];
    $info = $q ? bandiereInfo($q) : null;
    return [
        'status' => $g['status'], 'phase' => $g['phase'], 'round' => $g['round'], 'total' => $g['rules']['rounds'],
        'level' => $g['rules']['level'], 'lives' => $g['lives'], 'points' => $g['points'],
        'kind' => $q['kind'] ?? null,
        'flag' => $info ? $info['iso'] : null,
        'prompt' => $info ? $info['name'] : null,
        'options' => $info ? $info['labels'] : null,   // names of the options, every language (flag options too)
        'right' => $q['right'] ?? null,
        'answers' => array_map(fn($a) => $a['c'], $g['answers']),
    ];
}
