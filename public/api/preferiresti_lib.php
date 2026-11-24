<?php
// public/api/preferiresti_lib.php — "Preferiresti…?" (would you rather), on the shared rooms of spia.php (game "preferiresti").
// One JSON state per room (table preferiresti_games), changed inside the caller's BEGIN IMMEDIATE transaction.
//
// Every round two hard or absurd choices (A / B) are shown. Everybody picks one in secret, from their own phone. When all
// picks are in (or the time is up) the server reveals the split (counts, and only THEN who chose what).
// ONE rule: whoever is in the MINORITY takes a "white fly" point; on a tie, or when everybody chose the same side, nobody
// scores. The minority is asked out loud to explain. After the chosen number of rounds the standings come with funny titles.
// Pairs: lib/preferiresti-q.json, [category 0 calm|1 absurd|2 spicy, A: [it, en, es, fr, de], B: [it, en, es, fr, de]]
// (each text finishes the lead "Would you rather…").

const PREFERIRESTI_MIN_PLAYERS = 3;
const PREFERIRESTI_REVEAL_SECONDS = 10;
const PREFERIRESTI_LANGS = ['it', 'en', 'es', 'fr', 'de'];

function preferirestiDefaultSettings(): array {
    return ['rounds' => 10, 'time' => 30, 'calm' => true, 'absurd' => true, 'spicy' => false];
}

function preferirestiSanitizeSettings(array $in, array $base): array {
    $s = array_merge(preferirestiDefaultSettings(), array_intersect_key($base, preferirestiDefaultSettings()));
    if (isset($in['rounds']) && in_array($in['rounds'], [5, 10, 15], true)) $s['rounds'] = $in['rounds'];
    if (isset($in['time']) && in_array($in['time'], [20, 30, 45], true)) $s['time'] = $in['time'];
    foreach (['calm', 'absurd', 'spicy'] as $k) {
        if (isset($in[$k]) && is_bool($in[$k])) $s[$k] = $in[$k];
        else $s[$k] = (bool)$s[$k];
    }
    if (!$s['calm'] && !$s['absurd'] && !$s['spicy']) $s['calm'] = true;   // at least one category
    return $s;
}

/** The whole bank of pairs (read once per request). */
function preferirestiBank(): array {
    static $bank = null;
    if ($bank === null) $bank = json_decode((string)@file_get_contents(dirname(__DIR__, 2) . '/lib/preferiresti-q.json'), true) ?: [];
    return $bank;
}

function preferirestiLoad(PDO $db, int $roomId): ?array {
    $st = $db->prepare('SELECT state FROM preferiresti_games WHERE room_id = :r');
    $st->execute([':r' => $roomId]);
    $raw = $st->fetchColumn();
    return $raw ? json_decode($raw, true) : null;
}

function preferirestiSave(PDO $db, int $roomId, array $g): void {
    $db->prepare('INSERT INTO preferiresti_games (room_id, state, updated_at) VALUES (:r, :s, :t)
                  ON CONFLICT(room_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at')
       ->execute([':r' => $roomId, ':s' => json_encode($g), ':t' => time()]);
}

function preferirestiEvent(array &$g, array $ev): void {
    $ev['id'] = ++$g['event_seq'];
    $ev['round'] = $g['round'];
    $g['events'][] = $ev;
    if (count($g['events']) > 40) $g['events'] = array_slice($g['events'], -40);
}

/** Players still in the match (the ones who left stay in 'order' for the standings but do not choose). */
function preferirestiActive(array $g): array {
    return array_values(array_diff($g['order'], $g['gone']));
}

/** Titles of the standings: each one goes to a different player (the first in line when several are equal). */
function preferirestiTitles(array $g): array {
    $rows = [];
    foreach (preferirestiActive($g) as $p) $rows[$p] = $g['stats'][(string)$p];
    $out = [];
    if (!$g['played']) return $out;   // no round was resolved: no titles
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
    $pick('fly', fn($r) => $r['pts'] > 0 ? $r['pts'] : null);
    $pick('herd', fn($r) => $r['maj'] > 0 ? $r['maj'] : null);
    $pick('ghost', fn($r) => $r['missed'] > 0 ? $r['missed'] : null);
    return $out;
}

function preferirestiEnd(array &$g, string $reason): void {
    $g['status'] = 'ended';
    $g['phase'] = 'ended';
    $rows = [];
    foreach (preferirestiActive($g) as $p) {
        $s = $g['stats'][(string)$p];
        $rows[] = ['p' => $p, 'pts' => $s['pts'], 'maj' => $s['maj']];
    }
    usort($rows, fn($a, $b) => [$b['pts'], $b['maj']] <=> [$a['pts'], $a['maj']]);
    $g['result'] = ['reason' => $reason, 'rounds' => $g['played'], 'rows' => $rows, 'titles' => preferirestiTitles($g)];
    preferirestiEvent($g, ['t' => 'end']);
}

/** Draw the next pair from the enabled categories, never twice in a match until the pile is used up. */
function preferirestiStartRound(array &$g, ?float $now = null): void {
    $now = $now ?? microtime(true);
    $bank = preferirestiBank();
    $cats = [];
    foreach (['calm' => 0, 'absurd' => 1, 'spicy' => 2] as $k => $c) if (!empty($g['rules'][$k])) $cats[] = $c;
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
    preferirestiEvent($g, ['t' => 'round', 'n' => $g['round']]);
}

/** The round is over: split the choices; the minority (if there is one) scores. */
function preferirestiResolve(array &$g, ?float $now = null): void {
    $now = $now ?? microtime(true);
    $active = preferirestiActive($g);
    $choices = [];
    $n = ['a' => 0, 'b' => 0];
    foreach ($g['votes'] as $voter => $side) {
        if (in_array((int)$voter, $active, true) && isset($n[$side])) { $choices[(string)$voter] = $side; $n[$side]++; }
    }
    $minority = null;
    if ($n['a'] > 0 && $n['b'] > 0 && $n['a'] !== $n['b']) $minority = $n['a'] < $n['b'] ? 'a' : 'b';
    $scorers = [];
    foreach ($active as $p) {
        $k = (string)$p;
        $st = &$g['stats'][$k];
        if (!isset($choices[$k])) { $st['missed']++; continue; }
        $st['cast']++;
        if ($minority !== null) {
            if ($choices[$k] === $minority) { $st['pts']++; $scorers[] = $p; }
            else $st['maj']++;
        }
        unset($st);
    }
    $g['played']++;
    foreach ($scorers as $p) preferirestiEvent($g, ['t' => 'fly', 'p' => $p]);
    if (!$scorers) preferirestiEvent($g, ['t' => array_sum($n) === 0 ? 'none' : ($n['a'] === $n['b'] ? 'tie' : 'same')]);
    $g['reveal'] = ['a' => $n['a'], 'b' => $n['b'], 'choices' => $choices, 'minority' => $minority, 'scorers' => $scorers,
                    'voted' => array_sum($n), 'last' => $g['round'] >= $g['rules']['rounds']];
    $g['phase'] = 'reveal';
    $g['next_at'] = $now + PREFERIRESTI_REVEAL_SECONDS;
}

/** After the reveal: the next pair, or the standings after the last round. */
function preferirestiAdvance(array &$g, ?float $now = null): void {
    if ($g['round'] >= $g['rules']['rounds']) { preferirestiEnd($g, 'finished'); return; }
    $g['round']++;
    preferirestiStartRound($g, $now);
}

/** Advances the clock-driven parts. Returns true when the state changed (the caller saves it). */
function preferirestiTick(array &$g, ?float $now = null): bool {
    if ($g['status'] !== 'play') return false;
    $now = $now ?? microtime(true);
    if ($g['phase'] === 'vote') {
        $active = array_map('strval', preferirestiActive($g));
        $all = $active && !array_diff($active, array_keys($g['votes']));
        if ($now >= $g['q']['deadline'] || $all) { preferirestiResolve($g, $now); return true; }
    } elseif ($g['phase'] === 'reveal' && $now >= $g['next_at']) {
        preferirestiAdvance($g, $now);
        return true;
    }
    return false;
}

function preferirestiStart(PDO $db, array $room): ?string {
    $s = preferirestiSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $players = spiaPlayers($db, (int)$room['id']);
    if (count($players) < PREFERIRESTI_MIN_PLAYERS) return 'need_players_preferiresti';
    if (!preferirestiBank()) return 'no_questions';
    $order = array_map(fn($p) => (int)$p['id'], $players);
    $prev = preferirestiLoad($db, (int)$room['id']);
    $g = [
        'match' => (int)($prev['match'] ?? 0) + 1,
        'status' => 'play', 'phase' => 'vote', 'rules' => $s, 'order' => $order, 'gone' => [],
        'stats' => array_fill_keys(array_map('strval', $order), ['pts' => 0, 'maj' => 0, 'cast' => 0, 'missed' => 0]),
        'round' => 1, 'played' => 0, 'used' => $prev['used'] ?? [], 'q' => null, 'votes' => [], 'reveal' => null, 'next_at' => null,
        'events' => [], 'event_seq' => (int)($prev['event_seq'] ?? 0), 'result' => null,
    ];
    preferirestiEvent($g, ['t' => 'start']);
    preferirestiStartRound($g);
    preferirestiSave($db, (int)$room['id'], $g);
    return null;
}

function preferirestiPlayerLeft(array &$g, int $pid): void {
    if ($g['status'] !== 'play' || !in_array($pid, $g['order'], true) || in_array($pid, $g['gone'], true)) return;
    $g['gone'][] = $pid;
    unset($g['votes'][(string)$pid]);
    preferirestiEvent($g, ['t' => 'left', 'p' => $pid]);
    if (count(preferirestiActive($g)) < PREFERIRESTI_MIN_PLAYERS) preferirestiEnd($g, 'too_few');
}

/** Room actions for the game. Returns true (handled), null (not one of its actions) or an error code. */
function preferirestiHandle(PDO $db, array $room, array $device, bool $isHost, array $in, string $action) {
    $g = preferirestiLoad($db, (int)$room['id']);
    if ($g && preferirestiTick($g)) preferirestiSave($db, (int)$room['id'], $g);
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
            $new = preferirestiSanitizeSettings(is_array($in['settings'] ?? null) ? $in['settings'] : [], json_decode($room['settings'], true) ?: []);
            $db->prepare('UPDATE spia_rooms SET settings = :s WHERE id = :id')->execute([':s' => json_encode($new), ':id' => $room['id']]);
            return true;
        case 'start':
            if (!$isHost) return 'host_only';
            if ($playing) return 'round_running';
            return preferirestiStart($db, $room) ?? true;
        case 'end':
            if (!$isHost) return 'host_only';
            if (!$playing) return 'no_round';
            preferirestiEnd($g, 'host_ended');
            break;
        case 'next':
            if (!$isHost) return 'host_only';
            if (!$playing || $g['phase'] !== 'reveal') return 'not_now';
            preferirestiAdvance($g);
            break;
        case 'vote':
            if (!$playing || $g['phase'] !== 'vote') return 'not_now';
            $pid = $own($in['player_id'] ?? 0);
            if ($pid === null) return 'not_your_player';
            $k = (string)$pid;
            if (!in_array($pid, preferirestiActive($g), true)) return 'you_are_out';
            if (isset($g['votes'][$k])) return 'already_voted';
            $side = $in['side'] ?? null;
            if ($side !== 'a' && $side !== 'b') return 'bad_side';
            if (microtime(true) > $g['q']['deadline'] + 0.5) return 'not_now';   // half a second of grace for the network
            $g['votes'][$k] = $side;
            preferirestiTick($g);
            break;
        default:
            return null;
    }
    preferirestiSave($db, (int)$room['id'], $g);
    return true;
}

/** What one phone may see. Never who chose what, and no split before the reveal. */
function preferirestiView(PDO $db, array $room, array $device, bool $adminSession): array {
    $view = spiaView($db, $room, $device, $adminSession);
    $view['game'] = 'preferiresti';
    $view['settings'] = preferirestiSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $g = preferirestiLoad($db, (int)$room['id']);
    $view['preferiresti'] = null;
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
        $row = preferirestiBank()[$g['q']['i']] ?? null;
        $q = $row ? [
            'cat' => $row[0],
            'a' => array_combine(PREFERIRESTI_LANGS, $row[1]),
            'b' => array_combine(PREFERIRESTI_LANGS, $row[2]),
            'time' => $g['q']['time'],
            'left' => $open ? max(0, round($g['q']['deadline'] - $now, 1)) : 0,
        ] : null;
    }
    $view['preferiresti'] = [
        'match' => $g['match'], 'status' => $g['status'], 'phase' => $g['phase'], 'round' => $g['round'],
        'order' => $g['order'], 'active' => preferirestiActive($g), 'rules' => $g['rules'],
        'voted' => array_map('intval', array_keys($g['votes'])),
        'q' => $q,
        'reveal' => $open ? null : $g['reveal'],
        'next_left' => $g['phase'] === 'reveal' ? max(0, round($g['next_at'] - $now, 1)) : null,
        'events' => $g['events'], 'result' => $g['result'], 'me' => $me,
    ];
    return $view;
}

/** For the admin LIVE panel: the admin sees who chose what while the round is open. */
function preferirestiLiveInfo(PDO $db, int $roomId): ?array {
    $g = preferirestiLoad($db, $roomId);
    if (!$g) return null;
    $row = $g['q'] ? (preferirestiBank()[$g['q']['i']] ?? null) : null;
    return [
        'status' => $g['status'], 'phase' => $g['phase'], 'round' => $g['round'], 'rounds' => $g['rules']['rounds'],
        'a' => $row ? $row[1][0] : null, 'b' => $row ? $row[2][0] : null,
        'votes' => $g['votes'],
        'points' => array_map(fn($s) => $s['pts'], $g['stats']),
    ];
}
