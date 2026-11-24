<?php
// public/api/probabile_lib.php — "Chi è più probabile che…" (most likely to), on the shared rooms of spia.php (game "probabile").
// One JSON state per room (table probabile_games), changed inside the caller's BEGIN IMMEDIATE transaction.
//
// Every round one sentence is shown ("…falls asleep during a movie"). Everybody votes in secret, from their own phone, for
// ANOTHER player (never themselves). When all votes are in (or the time is up) the server reveals the COUNTS: whoever got the
// most votes takes "the mark" (a tie marks all the tied players). After the chosen number of rounds the standings come with
// funny titles. Who voted for whom is never sent to a phone (only the admin LIVE panel sees it).
// Sentences: lib/probabile-q.json, [category 0 calm|1 friends|2 spicy, it, en, es, fr, de] (each text finishes the sentence
// that the page starts with "Who is most likely to").

const PROBABILE_MIN_PLAYERS = 3;
const PROBABILE_REVEAL_SECONDS = 9;
const PROBABILE_LANGS = ['it', 'en', 'es', 'fr', 'de'];

function probabileDefaultSettings(): array {
    return ['rounds' => 10, 'time' => 30, 'calm' => true, 'friends' => true, 'spicy' => false];
}

function probabileSanitizeSettings(array $in, array $base): array {
    $s = array_merge(probabileDefaultSettings(), array_intersect_key($base, probabileDefaultSettings()));
    if (isset($in['rounds']) && in_array($in['rounds'], [5, 10, 15], true)) $s['rounds'] = $in['rounds'];
    if (isset($in['time']) && in_array($in['time'], [20, 30, 45], true)) $s['time'] = $in['time'];
    foreach (['calm', 'friends', 'spicy'] as $k) {
        if (isset($in[$k]) && is_bool($in[$k])) $s[$k] = $in[$k];
        else $s[$k] = (bool)$s[$k];
    }
    if (!$s['calm'] && !$s['friends'] && !$s['spicy']) $s['calm'] = true;   // at least one category
    return $s;
}

/** The whole sentence bank (read once per request). */
function probabileBank(): array {
    static $bank = null;
    if ($bank === null) $bank = json_decode((string)@file_get_contents(dirname(__DIR__, 2) . '/lib/probabile-q.json'), true) ?: [];
    return $bank;
}

function probabileLoad(PDO $db, int $roomId): ?array {
    $st = $db->prepare('SELECT state FROM probabile_games WHERE room_id = :r');
    $st->execute([':r' => $roomId]);
    $raw = $st->fetchColumn();
    return $raw ? json_decode($raw, true) : null;
}

function probabileSave(PDO $db, int $roomId, array $g): void {
    $db->prepare('INSERT INTO probabile_games (room_id, state, updated_at) VALUES (:r, :s, :t)
                  ON CONFLICT(room_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at')
       ->execute([':r' => $roomId, ':s' => json_encode($g), ':t' => time()]);
}

function probabileEvent(array &$g, array $ev): void {
    $ev['id'] = ++$g['event_seq'];
    $ev['round'] = $g['round'];
    $g['events'][] = $ev;
    if (count($g['events']) > 40) $g['events'] = array_slice($g['events'], -40);
}

/** Players still in the match (the ones who left are kept in 'order' for the standings but do not vote or get votes). */
function probabileActive(array $g): array {
    return array_values(array_diff($g['order'], $g['gone']));
}

/** Titles of the standings: each one goes to a different player (the first in line when several are equal). */
function probabileTitles(array $g): array {
    $rows = [];
    foreach (probabileActive($g) as $p) $rows[$p] = $g['stats'][(string)$p];
    $out = [];
    if (array_sum(array_column($rows, 'got')) === 0) return $out;   // nobody voted: no titles
    $pick = function (string $key, callable $score) use (&$out, $rows): void {
        $best = null; $bestScore = null;
        foreach ($rows as $p => $r) {
            if (isset($out[$p])) continue;
            $sc = $score($r);
            if ($sc === null) continue;
            if ($bestScore === null || $sc > $bestScore) { $best = $p; $bestScore = $sc; }
        }
        if ($best !== null) $out[$best] = $key;
    };
    $pick('target', fn($r) => $r['marks'] > 0 ? $r['marks'] * 1000 + $r['got'] : null);
    $pick('saint', fn($r) => -$r['got']);
    $pick('oracle', fn($r) => $r['match'] > 0 ? $r['match'] : null);
    $pick('rebel', fn($r) => $r['cast'] - $r['match'] > 0 ? $r['cast'] - $r['match'] : null);
    return $out;
}

function probabileEnd(array &$g, string $reason): void {
    $g['status'] = 'ended';
    $g['phase'] = 'ended';
    $rows = [];
    foreach (probabileActive($g) as $p) {
        $s = $g['stats'][(string)$p];
        $rows[] = ['p' => $p, 'marks' => $s['marks'], 'got' => $s['got']];
    }
    usort($rows, fn($a, $b) => [$b['marks'], $b['got']] <=> [$a['marks'], $a['got']]);
    $g['result'] = ['reason' => $reason, 'rounds' => $g['round'], 'rows' => $rows, 'titles' => probabileTitles($g)];
    probabileEvent($g, ['t' => 'end']);
}

/** Draw the next sentence from the enabled categories, never twice in a match until the pile is used up. */
function probabileStartRound(array &$g, ?float $now = null): void {
    $now = $now ?? microtime(true);
    $bank = probabileBank();
    $cats = [];
    foreach (['calm' => 0, 'friends' => 1, 'spicy' => 2] as $k => $c) if (!empty($g['rules'][$k])) $cats[] = $c;
    $free = fn() => array_values(array_filter(array_keys($bank), fn($i) => in_array($bank[$i][0], $cats, true) && !in_array($i, $g['used'], true)));
    $cands = $free();
    if (!$cands) {
        $g['used'] = array_values(array_filter($g['used'], fn($i) => !in_array($bank[$i][0] ?? -1, $cats, true)));
        $cands = $free();
    }
    if (!$cands) $cands = array_keys($bank);
    $i = $cands[random_int(0, count($cands) - 1)];
    $g['used'][] = $i;
    $time = (int)$g['rules']['time'];
    $g['q'] = ['i' => $i, 'started' => $now, 'deadline' => $now + $time, 'time' => $time];
    $g['votes'] = [];
    $g['reveal'] = null;
    $g['phase'] = 'vote';
    $g['next_at'] = null;
    probabileEvent($g, ['t' => 'round', 'n' => $g['round']]);
}

/** The round is over: count the votes, whoever has most takes the mark (ties: all of them). */
function probabileResolve(array &$g, ?float $now = null): void {
    $now = $now ?? microtime(true);
    $active = probabileActive($g);
    $counts = array_fill_keys(array_map('strval', $active), 0);
    $valid = [];
    foreach ($g['votes'] as $voter => $target) {
        if (in_array((int)$voter, $active, true) && in_array($target, $active, true) && (int)$voter !== $target) {
            $counts[(string)$target]++;
            $valid[$voter] = $target;
        }
    }
    $max = $counts ? max($counts) : 0;
    $marked = [];
    if ($max > 0) foreach ($counts as $p => $n) if ($n === $max) $marked[] = (int)$p;
    foreach ($active as $p) {
        $k = (string)$p;
        $g['stats'][$k]['got'] += $counts[$k];
        if (in_array($p, $marked, true)) $g['stats'][$k]['marks']++;
        if (isset($valid[$k])) {
            $g['stats'][$k]['cast']++;
            if (in_array($valid[$k], $marked, true)) $g['stats'][$k]['match']++;
        }
    }
    foreach ($marked as $p) probabileEvent($g, ['t' => count($marked) > 1 ? 'tie' : 'marked', 'p' => $p]);
    if (!$marked) probabileEvent($g, ['t' => 'none']);
    $g['reveal'] = ['counts' => $counts, 'marked' => $marked, 'max' => $max, 'voted' => count($valid), 'last' => $g['round'] >= $g['rules']['rounds']];
    $g['phase'] = 'reveal';
    $g['next_at'] = $now + PROBABILE_REVEAL_SECONDS;
}

/** After the reveal: the next sentence, or the standings after the last round. */
function probabileAdvance(array &$g, ?float $now = null): void {
    if ($g['round'] >= $g['rules']['rounds']) { probabileEnd($g, 'finished'); return; }
    $g['round']++;
    probabileStartRound($g, $now);
}

/** Advances the clock-driven parts. Returns true when the state changed (the caller saves it). */
function probabileTick(array &$g, ?float $now = null): bool {
    if ($g['status'] !== 'play') return false;
    $now = $now ?? microtime(true);
    if ($g['phase'] === 'vote') {
        $active = array_map('strval', probabileActive($g));
        $all = $active && !array_diff($active, array_keys($g['votes']));
        if ($now >= $g['q']['deadline'] || $all) { probabileResolve($g, $now); return true; }
    } elseif ($g['phase'] === 'reveal' && $now >= $g['next_at']) {
        probabileAdvance($g, $now);
        return true;
    }
    return false;
}

function probabileStart(PDO $db, array $room): ?string {
    $s = probabileSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $players = spiaPlayers($db, (int)$room['id']);
    if (count($players) < PROBABILE_MIN_PLAYERS) return 'need_players_probabile';
    if (!probabileBank()) return 'no_questions';
    $order = array_map(fn($p) => (int)$p['id'], $players);
    $prev = probabileLoad($db, (int)$room['id']);
    $g = [
        'match' => (int)($prev['match'] ?? 0) + 1,
        'status' => 'play', 'phase' => 'vote', 'rules' => $s, 'order' => $order, 'gone' => [],
        'stats' => array_fill_keys(array_map('strval', $order), ['marks' => 0, 'got' => 0, 'cast' => 0, 'match' => 0]),
        'round' => 1, 'used' => $prev['used'] ?? [], 'q' => null, 'votes' => [], 'reveal' => null, 'next_at' => null,
        'events' => [], 'event_seq' => (int)($prev['event_seq'] ?? 0), 'result' => null,
    ];
    probabileEvent($g, ['t' => 'start']);
    probabileStartRound($g);
    probabileSave($db, (int)$room['id'], $g);
    return null;
}

function probabilePlayerLeft(array &$g, int $pid): void {
    if ($g['status'] !== 'play' || !in_array($pid, $g['order'], true) || in_array($pid, $g['gone'], true)) return;
    $g['gone'][] = $pid;
    unset($g['votes'][(string)$pid]);
    probabileEvent($g, ['t' => 'left', 'p' => $pid]);
    if (count(probabileActive($g)) < PROBABILE_MIN_PLAYERS) probabileEnd($g, 'too_few');
}

/** Room actions for the game. Returns true (handled), null (not one of its actions) or an error code. */
function probabileHandle(PDO $db, array $room, array $device, bool $isHost, array $in, string $action) {
    $g = probabileLoad($db, (int)$room['id']);
    if ($g && probabileTick($g)) probabileSave($db, (int)$room['id'], $g);
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
            $new = probabileSanitizeSettings(is_array($in['settings'] ?? null) ? $in['settings'] : [], json_decode($room['settings'], true) ?: []);
            $db->prepare('UPDATE spia_rooms SET settings = :s WHERE id = :id')->execute([':s' => json_encode($new), ':id' => $room['id']]);
            return true;
        case 'start':
            if (!$isHost) return 'host_only';
            if ($playing) return 'round_running';
            return probabileStart($db, $room) ?? true;
        case 'end':
            if (!$isHost) return 'host_only';
            if (!$playing) return 'no_round';
            probabileEnd($g, 'host_ended');
            break;
        case 'next':
            if (!$isHost) return 'host_only';
            if (!$playing || $g['phase'] !== 'reveal') return 'not_now';
            probabileAdvance($g);
            break;
        case 'vote':
            if (!$playing || $g['phase'] !== 'vote') return 'not_now';
            $pid = $own($in['player_id'] ?? 0);
            if ($pid === null) return 'not_your_player';
            $k = (string)$pid;
            if (!in_array($pid, probabileActive($g), true)) return 'you_are_out';
            if (isset($g['votes'][$k])) return 'already_voted';
            $target = $in['target'] ?? null;
            if (!is_int($target) || !in_array($target, probabileActive($g), true)) return 'bad_target';
            if ($target === $pid) return 'not_yourself';
            if (microtime(true) > $g['q']['deadline'] + 0.5) return 'not_now';   // half a second of grace for the network
            $g['votes'][$k] = $target;
            probabileTick($g);
            break;
        default:
            return null;
    }
    probabileSave($db, (int)$room['id'], $g);
    return true;
}

/** What one phone may see. Never who voted for whom, and no counts before the reveal. */
function probabileView(PDO $db, array $room, array $device, bool $adminSession): array {
    $view = spiaView($db, $room, $device, $adminSession);
    $view['game'] = 'probabile';
    $view['settings'] = probabileSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $g = probabileLoad($db, (int)$room['id']);
    $view['probabile'] = null;
    if (!$g) return $view;
    $now = microtime(true);
    $mine = array_map(fn($p) => (int)$p['id'], array_filter($view['players'], fn($p) => $p['device_id'] === (int)$device['id']));
    $open = $g['phase'] === 'vote';
    $me = [];
    foreach (array_values(array_intersect($mine, $g['order'])) as $pid) {
        $me[] = ['player_id' => $pid, 'active' => !in_array($pid, $g['gone'], true), 'voted' => isset($g['votes'][(string)$pid])];
    }
    $q = null;
    if ($g['q']) {
        $row = probabileBank()[$g['q']['i']] ?? null;
        $q = $row ? [
            'cat' => $row[0],
            'text' => array_combine(PROBABILE_LANGS, array_slice($row, 1, 5)),
            'time' => $g['q']['time'],
            'left' => $open ? max(0, round($g['q']['deadline'] - $now, 1)) : 0,
        ] : null;
    }
    $view['probabile'] = [
        'match' => $g['match'], 'status' => $g['status'], 'phase' => $g['phase'], 'round' => $g['round'],
        'order' => $g['order'], 'active' => probabileActive($g), 'rules' => $g['rules'],
        'voted' => array_map('intval', array_keys($g['votes'])),
        'q' => $q,
        'reveal' => $open ? null : $g['reveal'],
        'next_left' => $g['phase'] === 'reveal' ? max(0, round($g['next_at'] - $now, 1)) : null,
        'events' => $g['events'], 'result' => $g['result'], 'me' => $me,
    ];
    return $view;
}

/** For the admin LIVE panel: the admin sees who voted for whom while the round is open. */
function probabileLiveInfo(PDO $db, int $roomId): ?array {
    $g = probabileLoad($db, $roomId);
    if (!$g) return null;
    $row = $g['q'] ? (probabileBank()[$g['q']['i']] ?? null) : null;
    return [
        'status' => $g['status'], 'phase' => $g['phase'], 'round' => $g['round'], 'rounds' => $g['rules']['rounds'],
        'question' => $row ? $row[1] : null,
        'votes' => $g['votes'],
        'marks' => array_map(fn($s) => $s['marks'], $g['stats']),
    ];
}
