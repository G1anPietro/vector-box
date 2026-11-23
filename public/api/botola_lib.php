<?php
// public/api/botola_lib.php — "Botola" (a quiz where you fall), on the shared rooms of spia.php (game "botola").
// One JSON state per room (table botola_games), changed inside the caller's BEGIN IMMEDIATE transaction.
//
// Every round all the players still standing get the same question on their own phone and answer before the time is up.
// A wrong or missing answer costs a life (one life by default: you fall through the trapdoor). If everybody is right the
// SLOWEST right answer falls; if everybody is wrong nobody falls. The last one standing wins.
// The server judges: the right answer is never sent to a phone before the round is over. Questions come from
// lib/botola-q.json (Open Trivia DB, CC BY-SA 4.0): [difficulty 0|1|2, [en question, right, 3 wrong], [it ...]].

const BOTOLA_MIN_PLAYERS = 2;
const BOTOLA_REVEAL_SECONDS = 7;
const BOTOLA_LEVELS = ['easy' => 20, 'normal' => 15, 'hard' => 10, 'rising' => 15];   // seconds to answer

function botolaDefaultSettings(): array {
    return ['level' => 'rising', 'lives' => 1, 'scores' => false];
}

function botolaSanitizeSettings(array $in, array $base): array {
    $s = array_merge(botolaDefaultSettings(), array_intersect_key($base, botolaDefaultSettings()));
    if (isset($in['level']) && isset(BOTOLA_LEVELS[$in['level']])) $s['level'] = $in['level'];
    $s['lives'] = is_numeric($in['lives'] ?? null) ? max(1, min(5, (int)$in['lives'])) : (int)$s['lives'];
    $s['scores'] = is_bool($in['scores'] ?? null) ? $in['scores'] : (is_numeric($in['scores'] ?? null) ? (bool)(int)$in['scores'] : (bool)$s['scores']);
    return $s;
}

/** The whole question bank (read once per request). */
function botolaBank(): array {
    static $bank = null;
    if ($bank === null) $bank = json_decode((string)@file_get_contents(dirname(__DIR__, 2) . '/lib/botola-q.json'), true) ?: [];
    return $bank;
}

/** Levels: easy / normal / hard use that difficulty only; rising goes easy, medium, hard as the rounds pass. */
function botolaDifficulty(string $level, int $round): int {
    return match ($level) { 'easy' => 0, 'hard' => 2, 'rising' => min(2, intdiv($round - 1, 2)), default => 1 };
}

function botolaLoad(PDO $db, int $roomId): ?array {
    $st = $db->prepare('SELECT state FROM botola_games WHERE room_id = :r');
    $st->execute([':r' => $roomId]);
    $raw = $st->fetchColumn();
    return $raw ? json_decode($raw, true) : null;
}

function botolaSave(PDO $db, int $roomId, array $g): void {
    $db->prepare('INSERT INTO botola_games (room_id, state, updated_at) VALUES (:r, :s, :t)
                  ON CONFLICT(room_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at')
       ->execute([':r' => $roomId, ':s' => json_encode($g), ':t' => time()]);
}

/** Events are what every phone shows: never the right answer before the round is over. */
function botolaEvent(array &$g, array $ev): void {
    $ev['id'] = ++$g['event_seq'];
    $ev['round'] = $g['round'];
    $g['events'][] = $ev;
    if (count($g['events']) > 40) $g['events'] = array_slice($g['events'], -40);
}

function botolaAlive(array $g): array {
    return array_values(array_filter($g['order'], fn($p) => ($g['lives'][(string)$p] ?? 0) > 0));
}

function botolaEnd(array &$g, ?int $winner, string $reason): void {
    $g['status'] = 'ended';
    $g['phase'] = 'ended';
    $g['result'] = ['winner' => $winner, 'reason' => $reason, 'lives' => $g['lives']];
    botolaEvent($g, ['t' => 'end', 'p' => $winner, 'why' => $reason]);
}

/** Draw the next question of the round's difficulty, never twice in a match until the pile of that difficulty is used up. */
function botolaStartRound(array &$g, ?float $now = null): void {
    $now = $now ?? microtime(true);
    $bank = botolaBank();
    $d = botolaDifficulty($g['rules']['level'], $g['round']);
    $free = fn(int $dd) => array_values(array_filter(array_keys($bank), fn($i) => $bank[$i][0] === $dd && !in_array($i, $g['used'], true)));
    $cands = $free($d);
    if (!$cands) {   // pile used up: forget the questions of this difficulty and start over
        $g['used'] = array_values(array_filter($g['used'], fn($i) => ($bank[$i][0] ?? -1) !== $d));
        $cands = $free($d);
    }
    if (!$cands) $cands = array_keys($bank);
    $i = $cands[random_int(0, count($cands) - 1)];
    $g['used'][] = $i;
    $perm = spiaShuffle([0, 1, 2, 3]);   // option k on screen = answer perm[k] of the bank row (0 is the right one)
    $time = BOTOLA_LEVELS[$g['rules']['level']];
    $g['q'] = ['i' => $i, 'perm' => $perm, 'right' => array_search(0, $perm, true), 'started' => $now, 'deadline' => $now + $time, 'time' => $time];
    $g['answers'] = [];
    $g['reveal'] = null;
    $g['phase'] = 'question';
    $g['next_at'] = null;
    botolaEvent($g, ['t' => 'question', 'n' => $g['round']]);
}

/** The round is over: who fell. Everybody right -> the slowest falls; everybody wrong -> nobody. */
function botolaResolve(array &$g, ?float $now = null): void {
    $now = $now ?? microtime(true);
    $alive = botolaAlive($g);
    $right = $g['q']['right'];
    $ok = array_values(array_filter($alive, fn($p) => isset($g['answers'][(string)$p]) && $g['answers'][(string)$p]['c'] === $right));
    $bad = array_values(array_diff($alive, $ok));
    $slowest = null;
    $nobody = false;
    if (!$bad && count($alive) > 1) {
        usort($ok, fn($a, $b) => $g['answers'][(string)$b]['ms'] <=> $g['answers'][(string)$a]['ms']);
        $slowest = $ok[0];
        $bad = [$slowest];
        botolaEvent($g, ['t' => 'slowest', 'p' => $slowest]);
    } elseif (count($bad) === count($alive)) {
        $nobody = true;
        $bad = [];
        botolaEvent($g, ['t' => 'nobody']);
    }
    $fell = [];
    foreach ($bad as $p) {
        $k = (string)$p;
        $g['lives'][$k] = max(0, $g['lives'][$k] - 1);
        if ($g['lives'][$k] === 0) { $fell[] = $p; botolaEvent($g, ['t' => 'fell', 'p' => $p]); }
        else botolaEvent($g, ['t' => 'life', 'p' => $p]);
    }
    $g['reveal'] = [
        'right' => $right,
        'answers' => array_map(fn($a) => $a['c'], $g['answers']),
        'fell' => $fell, 'hit' => $bad, 'slowest' => $slowest, 'nobody' => $nobody,
    ];
    $g['round']++;
    $left = botolaAlive($g);
    if (count($left) <= 1) { botolaEnd($g, $left[0] ?? null, 'last_standing'); return; }
    $g['phase'] = 'reveal';
    $g['next_at'] = $now + BOTOLA_REVEAL_SECONDS;
}

/** Advances the clock-driven parts. Returns true when the state changed (the caller saves it). */
function botolaTick(array &$g, ?float $now = null): bool {
    if ($g['status'] !== 'play') return false;
    $now = $now ?? microtime(true);
    if ($g['phase'] === 'question') {
        $alive = botolaAlive($g);
        $all = $alive && !array_diff(array_map('strval', $alive), array_keys($g['answers']));
        if ($now >= $g['q']['deadline'] || $all) { botolaResolve($g, $now); return true; }
    } elseif ($g['phase'] === 'reveal' && $now >= $g['next_at']) {
        botolaStartRound($g, $now);
        return true;
    }
    return false;
}

function botolaStart(PDO $db, array $room): ?string {
    $s = botolaSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $players = spiaPlayers($db, (int)$room['id']);
    if (count($players) < BOTOLA_MIN_PLAYERS) return 'need_players_botola';
    if (!botolaBank()) return 'no_questions';
    $order = array_map(fn($p) => (int)$p['id'], $players);
    $prev = botolaLoad($db, (int)$room['id']);
    $g = [
        'match' => (int)($prev['match'] ?? 0) + 1,
        'status' => 'play', 'phase' => 'question', 'rules' => $s, 'order' => $order,
        'lives' => array_fill_keys(array_map('strval', $order), $s['lives']),
        'round' => 1, 'used' => $prev['used'] ?? [], 'q' => null, 'answers' => [], 'reveal' => null, 'next_at' => null,
        'events' => [], 'event_seq' => (int)($prev['event_seq'] ?? 0), 'result' => null, 'awarded' => false,
    ];
    botolaEvent($g, ['t' => 'start']);
    botolaStartRound($g);
    botolaSave($db, (int)$room['id'], $g);
    return null;
}

function botolaPlayerLeft(array &$g, int $pid): void {
    if ($g['status'] !== 'play' || !isset($g['lives'][(string)$pid])) return;
    $g['lives'][(string)$pid] = 0;
    unset($g['answers'][(string)$pid]);
    botolaEvent($g, ['t' => 'left', 'p' => $pid]);
    $alive = botolaAlive($g);
    if (count($alive) <= 1) botolaEnd($g, $alive[0] ?? null, 'last_standing');
}

/** Saves the state and gives the winner a point once (when the room keeps scores). */
function botolaSaveAndAward(PDO $db, int $roomId, array &$g): void {
    if ($g['status'] === 'ended' && !$g['awarded'] && !empty($g['rules']['scores']) && !empty($g['result']['winner'])) {
        $db->prepare('UPDATE spia_players SET score = score + 1 WHERE id = :p')->execute([':p' => $g['result']['winner']]);
        $g['awarded'] = true;
    }
    botolaSave($db, $roomId, $g);
}

/** Room actions for Botola. Returns true (handled), null (not a Botola action) or an error code. */
function botolaHandle(PDO $db, array $room, array $device, bool $isHost, array $in, string $action) {
    $g = botolaLoad($db, (int)$room['id']);
    if ($g && botolaTick($g)) botolaSaveAndAward($db, (int)$room['id'], $g);
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
            $new = botolaSanitizeSettings(is_array($in['settings'] ?? null) ? $in['settings'] : [], json_decode($room['settings'], true) ?: []);
            $db->prepare('UPDATE spia_rooms SET settings = :s WHERE id = :id')->execute([':s' => json_encode($new), ':id' => $room['id']]);
            return true;
        case 'start':
            if (!$isHost) return 'host_only';
            if ($playing) return 'round_running';
            return botolaStart($db, $room) ?? true;
        case 'end':
            if (!$isHost) return 'host_only';
            if (!$playing) return 'no_round';
            botolaEnd($g, null, 'host_ended');
            break;
        case 'next':
            if (!$isHost) return 'host_only';
            if (!$playing || $g['phase'] !== 'reveal') return 'not_now';
            botolaStartRound($g);
            break;
        case 'answer':
            if (!$playing || $g['phase'] !== 'question') return 'not_now';
            $pid = $own($in['player_id'] ?? 0);
            if ($pid === null) return 'not_your_player';
            $k = (string)$pid;
            if (($g['lives'][$k] ?? 0) <= 0) return 'you_are_out';
            if (isset($g['answers'][$k])) return 'already_answered';
            $choice = $in['choice'] ?? null;
            if (!is_int($choice) || $choice < 0 || $choice > 3) return 'bad_choice';
            $now = microtime(true);
            if ($now > $g['q']['deadline'] + 0.5) return 'not_now';   // half a second of grace for the network
            $g['answers'][$k] = ['c' => $choice, 'ms' => (int)round(($now - $g['q']['started']) * 1000)];
            botolaTick($g, $now);
            break;
        default:
            return null;
    }
    botolaSaveAndAward($db, (int)$room['id'], $g);
    return true;
}

/** What one phone may see. The right answer only once the round is over. */
function botolaView(PDO $db, array $room, array $device, bool $adminSession): array {
    $view = spiaView($db, $room, $device, $adminSession);
    $view['game'] = 'botola';
    $view['settings'] = botolaSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $g = botolaLoad($db, (int)$room['id']);
    $view['botola'] = null;
    if (!$g) return $view;
    $now = microtime(true);
    $mine = array_map(fn($p) => (int)$p['id'], array_filter($view['players'], fn($p) => $p['device_id'] === (int)$device['id']));
    $open = $g['phase'] === 'question';
    $me = [];
    foreach (array_values(array_intersect($mine, $g['order'])) as $pid) {
        $a = $g['answers'][(string)$pid] ?? null;
        $me[] = ['player_id' => $pid, 'alive' => ($g['lives'][(string)$pid] ?? 0) > 0, 'answered' => $a !== null, 'choice' => $a['c'] ?? null];
    }
    $q = null;
    if ($g['q']) {
        $row = botolaBank()[$g['q']['i']] ?? null;
        $opts = fn(array $texts) => array_map(fn($k) => $texts[1 + $g['q']['perm'][$k]], [0, 1, 2, 3]);   // texts[0] is the question
        $q = $row ? [
            'difficulty' => $row[0],
            'text' => ['en' => $row[1][0], 'it' => $row[2][0]],
            'options' => ['en' => $opts($row[1]), 'it' => $opts($row[2])],
            'time' => $g['q']['time'],
            'left' => $open ? max(0, round($g['q']['deadline'] - $now, 1)) : 0,
        ] : null;
    }
    $view['botola'] = [
        'match' => $g['match'], 'status' => $g['status'], 'phase' => $g['phase'], 'round' => $g['round'],
        'order' => $g['order'], 'alive' => botolaAlive($g), 'lives' => $g['lives'], 'rules' => $g['rules'],
        'answered' => array_map('intval', array_keys($g['answers'])),
        'q' => $q,
        'reveal' => $g['phase'] === 'question' ? null : $g['reveal'],
        'next_left' => $g['phase'] === 'reveal' ? max(0, round($g['next_at'] - $now, 1)) : null,
        'events' => $g['events'], 'result' => $g['result'], 'me' => $me,
    ];
    return $view;
}

/** For the admin LIVE panel: the admin sees the right answer and what everybody chose while the round is open. */
function botolaLiveInfo(PDO $db, int $roomId): ?array {
    $g = botolaLoad($db, $roomId);
    if (!$g) return null;
    $row = $g['q'] ? (botolaBank()[$g['q']['i']] ?? null) : null;
    return [
        'status' => $g['status'], 'phase' => $g['phase'], 'round' => $g['round'], 'lives' => $g['lives'], 'level' => $g['rules']['level'],
        'question' => $row ? $row[2][0] : null,
        'options' => $row ? array_map(fn($k) => $row[2][1 + $g['q']['perm'][$k]], [0, 1, 2, 3]) : null,
        'right' => $g['q']['right'] ?? null,
        'answers' => array_map(fn($a) => $a['c'], $g['answers']),
    ];
}
