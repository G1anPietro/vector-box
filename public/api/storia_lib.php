<?php
// public/api/storia_lib.php — "Storia a catena" (a chain story), on the shared rooms of spia.php (game "storia").
// One JSON state per room (table storia_games), changed inside the caller's BEGIN IMMEDIATE transaction.
//
// The server shuffles the order of the turns. Each player writes ONE sentence per turn and sees ONLY the sentence written just
// before theirs (the opening line, "incipit", for the first one): the rest of the story is in NO response until the reading
// phase. The sender of a sentence is never sent either, until the end. Turn timer (optional) is a server instant: when it runs
// out the server writes "…" for the player and moves on. After the last turn the story is read sentence by sentence (a server
// clock, the host can speed it up), everybody votes for a favourite sentence (not their own, secret) and the winner is shown.
// Player texts: control characters removed, 200 characters at most, shown by the client with textContent only.
// Bank of openings: lib/storia-q.json {"i": [[genre(m|f|d|s|a), [it,en,es,fr,de]], ...]}.

const STORIA_MIN_PLAYERS = 3;
const STORIA_MAX_CHARS = 200;
const STORIA_SKIP = '…';

function storiaDefaultSettings(): array {
    return ['rounds' => 1, 'timer' => 0, 'genre' => 'mix', 'own' => ''];
}

/** One line of player text: no control or invisible direction characters, spaces collapsed, at most 200 characters. */
function storiaCleanText(string $s, int $max = STORIA_MAX_CHARS): string {
    $s = preg_replace('/[\x00-\x1F\x7F\x{80}-\x{9F}\x{200B}-\x{200F}\x{2028}-\x{202E}\x{2060}-\x{2069}\x{FEFF}]+/u', ' ', $s) ?? '';
    $s = preg_replace('/\s+/u', ' ', $s) ?? '';
    return trim(textCut(trim($s), $max));
}

function storiaSanitizeSettings(array $in, array $base): array {
    $s = array_merge(storiaDefaultSettings(), array_intersect_key($base, storiaDefaultSettings()));
    if (isset($in['rounds']) && in_array($in['rounds'], [1, 2, 3], true)) $s['rounds'] = $in['rounds'];
    if (isset($in['timer']) && in_array($in['timer'], [0, 30, 60, 90], true)) $s['timer'] = $in['timer'];
    if (isset($in['genre']) && in_array($in['genre'], ['mix', 'mystery', 'fantasy', 'daily', 'scifi', 'absurd'], true)) $s['genre'] = $in['genre'];
    if (isset($in['own']) && is_string($in['own'])) $s['own'] = storiaCleanText($in['own']);
    return $s;
}

function storiaBank(): array {
    static $bank = null;
    if ($bank === null) $bank = (json_decode((string)@file_get_contents(dirname(__DIR__, 2) . '/lib/storia-q.json'), true) ?: [])['i'] ?? [];
    return $bank;
}

function storiaLoad(PDO $db, int $roomId): ?array {
    $st = $db->prepare('SELECT state FROM storia_games WHERE room_id = :r');
    $st->execute([':r' => $roomId]);
    $raw = $st->fetchColumn();
    return $raw ? json_decode($raw, true) : null;
}

function storiaSave(PDO $db, int $roomId, array $g): void {
    $db->prepare('INSERT INTO storia_games (room_id, state, updated_at) VALUES (:r, :s, :t)
                  ON CONFLICT(room_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at')
       ->execute([':r' => $roomId, ':s' => json_encode($g), ':t' => time()]);
}

function storiaEvent(array &$g, array $ev): void {
    $ev['id'] = ++$g['event_seq'];
    $g['events'][] = $ev;
    if (count($g['events']) > 30) $g['events'] = array_slice($g['events'], -30);
}

function storiaActive(array $g): array {
    return array_values(array_filter($g['order'], fn($p) => !in_array($p, $g['gone'], true)));
}

/** The writer whose turn it is (skipping players who left or were excluded), or null when every turn is done. */
function storiaWriter(array &$g): ?int {
    while ($g['turn'] < count($g['turns']) && in_array($g['turns'][$g['turn']], $g['gone'], true)) $g['turn']++;
    return $g['turn'] < count($g['turns']) ? (int)$g['turns'][$g['turn']] : null;
}

/** The sentence a writer is shown: the last one that is a real sentence (not a skipped turn, not a removed line). */
function storiaPrev(array $g): array {
    for ($i = count($g['story']) - 1; $i >= 0; $i--) {
        $l = $g['story'][$i];
        if (empty($l['rm']) && $l['k'] !== 'skip') return ['text' => $l['text'], 'incipit' => $l['k'] === 'inc'];
    }
    return ['text' => '', 'incipit' => true];
}

function storiaReadSeconds(string $text): float {
    return max(4.0, min(12.0, 2.0 + textLength($text) / 14));
}

/** Lines the voters may choose: real sentences of players, not removed. */
function storiaVotable(array $g): array {
    $r = [];
    foreach ($g['story'] as $i => $l) if ($l['k'] === 'line' && empty($l['rm'])) $r[] = $i;
    return $r;
}

function storiaVoters(array $g): array {
    return storiaActive($g);
}

/** Start of the next turn, or of the reading when no turn is left. */
function storiaNextTurn(array &$g, ?float $now = null): void {
    $now = $now ?? microtime(true);
    if (storiaWriter($g) === null) {
        $g['phase'] = 'read';
        $g['shown'] = 1;      // the opening line is on the page from the start
        $g['ends_at'] = null;
        $g['next_at'] = $now + storiaReadSeconds($g['story'][0]['text']);
        storiaEvent($g, ['t' => 'read']);
        storiaAfterShown($g, $now);
        return;
    }
    $g['phase'] = 'write';
    $g['ends_at'] = $g['rules']['timer'] > 0 ? $now + (int)$g['rules']['timer'] : null;
}

/** Moves from reading to voting once every line is on the page (or there is nothing to vote on). */
function storiaAfterShown(array &$g, ?float $now = null): void {
    if ($g['phase'] !== 'read' || $g['shown'] < count($g['story'])) return;
    $g['phase'] = 'vote';
    $g['next_at'] = null;
    storiaEvent($g, ['t' => 'vote']);
    if (!storiaVotable($g)) storiaFinish($g, 'done');
}

function storiaEnd(array &$g, string $reason): void {
    storiaFinish($g, $reason);
}

/** Closes the match: the whole story with its authors, the vote counts and the winners (authors of the most voted lines). */
function storiaFinish(array &$g, string $reason): void {
    $g['status'] = 'ended';
    $g['phase'] = 'ended';
    $count = [];
    foreach ($g['votes'] as $pid => $idx) {
        if (empty($g['story'][$idx]) || !empty($g['story'][$idx]['rm'])) continue;
        $count[$idx] = ($count[$idx] ?? 0) + 1;
    }
    $top = $count ? max($count) : 0;
    $bestLines = $top > 0 ? array_keys(array_filter($count, fn($n) => $n === $top)) : [];
    $winners = [];
    foreach ($bestLines as $i) $winners[] = (int)$g['story'][$i]['p'];
    $g['result'] = [
        'reason' => $reason, 'top' => $top, 'best' => array_values($bestLines), 'winners' => array_values(array_unique($winners)),
        'story' => array_map(fn($l, $i) => ['i' => $i, 'p' => $l['p'], 'text' => !empty($l['rm']) ? STORIA_SKIP : $l['text'], 'k' => $l['k'], 'rm' => !empty($l['rm']), 'votes' => $count[$i] ?? 0, 'tr' => $l['k'] === 'inc' ? ($l['tr'] ?? null) : null], $g['story'], array_keys($g['story'])),
    ];
    storiaEvent($g, ['t' => 'end']);
}

/** Advances the clock-driven parts. Returns true when the state changed (the caller saves it). */
function storiaTick(array &$g, ?float $now = null): bool {
    if ($g['status'] !== 'play') return false;
    $now = $now ?? microtime(true);
    $changed = false;
    if ($g['phase'] === 'write' && $g['ends_at'] !== null && $now >= $g['ends_at']) {
        $w = storiaWriter($g);
        if ($w !== null) {
            $g['story'][] = ['p' => $w, 'text' => STORIA_SKIP, 'k' => 'skip'];
            storiaEvent($g, ['t' => 'timeout', 'p' => $w]);
            $g['turn']++;
            storiaNextTurn($g, $now);
            $changed = true;
        }
    }
    while ($g['phase'] === 'read' && $g['next_at'] !== null && $now >= $g['next_at']) {
        $at = $g['next_at'];
        $g['shown']++;
        $line = $g['story'][$g['shown'] - 1] ?? null;
        $g['next_at'] = $at + storiaReadSeconds($line ? (!empty($line['rm']) ? STORIA_SKIP : $line['text']) : '');
        storiaAfterShown($g, $now);
        $changed = true;
    }
    return $changed;
}

function storiaStart(PDO $db, array $room): ?string {
    $s = storiaSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $players = spiaPlayers($db, (int)$room['id']);
    if (count($players) < STORIA_MIN_PLAYERS) return 'need_players_storia';
    $bank = storiaBank();
    if (!$bank && $s['own'] === '') return 'no_questions';
    $ids = array_map(fn($p) => (int)$p['id'], $players);
    // the order of the turns is the server's: a new shuffle for every lap, never the same player twice in a row
    $turns = [];
    for ($lap = 0; $lap < $s['rounds']; $lap++) {
        do { shuffle($ids); } while ($turns && count($ids) > 1 && $ids[0] === end($turns));
        $turns = array_merge($turns, $ids);
    }
    $prev = storiaLoad($db, (int)$room['id']);
    if ($s['own'] !== '') {
        $inc = $s['own'];
        $used = $prev['used'] ?? [];
    } else {
        $codes = ['mystery' => 'm', 'fantasy' => 'f', 'daily' => 'd', 'scifi' => 's', 'absurd' => 'a'];
        $pool = array_keys(array_filter($bank, fn($e) => $s['genre'] === 'mix' || $e[0] === $codes[$s['genre']]));
        if (!$pool) $pool = array_keys($bank);
        $used = $prev['used'] ?? [];
        $free = array_values(array_diff($pool, $used));
        if (!$free) { $used = array_values(array_diff($used, $pool)); $free = $pool; }
        $pick = $free[random_int(0, count($free) - 1)];
        $used[] = $pick;
        $inc = $bank[$pick][1];      // [it, en, es, fr, de]: the page shows the one of the viewer's language
    }
    $g = [
        'match' => (int)($prev['match'] ?? 0) + 1, 'status' => 'play', 'phase' => 'write', 'rules' => $s,
        'order' => $ids, 'gone' => [], 'turns' => $turns, 'turn' => 0,
        'story' => [['p' => null, 'text' => is_array($inc) ? $inc[1] : $inc, 'tr' => is_array($inc) ? $inc : null, 'k' => 'inc']],
        'used' => $used, 'ends_at' => null, 'next_at' => null, 'shown' => 0, 'votes' => [],
        'events' => [], 'event_seq' => (int)($prev['event_seq'] ?? 0), 'result' => null,
    ];
    storiaEvent($g, ['t' => 'start']);
    storiaNextTurn($g);
    storiaSave($db, (int)$room['id'], $g);
    return null;
}

/** A player left the room or was excluded: their turns are skipped; the match ends below 3 players. */
function storiaPlayerLeft(array &$g, int $pid, string $why = 'left'): void {
    if ($g['status'] !== 'play' || !in_array($pid, $g['order'], true) || in_array($pid, $g['gone'], true)) return;
    $g['gone'][] = $pid;
    unset($g['votes'][(string)$pid]);
    storiaEvent($g, ['t' => $why, 'p' => $pid]);
    if (count(storiaActive($g)) < STORIA_MIN_PLAYERS) { storiaFinish($g, 'too_few'); return; }
    if ($g['phase'] === 'write') {
        $cur = $g['turn'] < count($g['turns']) ? (int)$g['turns'][$g['turn']] : null;
        if ($cur === $pid) storiaNextTurn($g);
    }
}

/** Room actions for the game. Returns true (handled), null (not one of its actions) or an error code. */
function storiaHandle(PDO $db, array $room, array $device, bool $isHost, array $in, string $action) {
    $g = storiaLoad($db, (int)$room['id']);
    if ($g && storiaTick($g)) storiaSave($db, (int)$room['id'], $g);
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
            $new = storiaSanitizeSettings(is_array($in['settings'] ?? null) ? $in['settings'] : [], json_decode($room['settings'], true) ?: []);
            $db->prepare('UPDATE spia_rooms SET settings = :s WHERE id = :id')->execute([':s' => json_encode($new), ':id' => $room['id']]);
            return true;
        case 'start':
            if (!$isHost) return 'host_only';
            if ($playing) return 'round_running';
            return storiaStart($db, $room) ?? true;
        case 'end':
            if (!$isHost) return 'host_only';
            if (!$playing) return 'no_round';
            storiaEnd($g, 'host_ended');
            break;
        case 'write':
            if (!$playing || $g['phase'] !== 'write') return 'not_now';
            $pid = $own($in['player_id'] ?? 0);
            if ($pid === null) return 'not_your_player';
            if (storiaWriter($g) !== $pid) return 'not_your_turn';
            $text = storiaCleanText((string)($in['text'] ?? ''));
            if ($text === '' || $text === STORIA_SKIP) return 'bad_text';
            $g['story'][] = ['p' => $pid, 'text' => $text, 'k' => 'line'];
            $g['turn']++;
            storiaNextTurn($g);
            break;
        case 'skip':             // the host passes the turn of somebody who is away: the server writes "…"
            if (!$isHost) return 'host_only';
            if (!$playing || $g['phase'] !== 'write') return 'not_now';
            $w = storiaWriter($g);
            if ($w === null) return 'not_now';
            $g['story'][] = ['p' => $w, 'text' => STORIA_SKIP, 'k' => 'skip'];
            storiaEvent($g, ['t' => 'timeout', 'p' => $w]);
            $g['turn']++;
            storiaNextTurn($g);
            break;
        case 'next':             // the host speeds up the reading, or closes the votes
            if (!$isHost) return 'host_only';
            if (!$playing) return 'not_now';
            if ($g['phase'] === 'read') {
                $g['shown']++;
                $line = $g['story'][$g['shown'] - 1] ?? null;
                $g['next_at'] = microtime(true) + storiaReadSeconds($line ? (!empty($line['rm']) ? STORIA_SKIP : $line['text']) : '');
                storiaAfterShown($g);
            } elseif ($g['phase'] === 'vote') {
                storiaFinish($g, 'done');
            } else {
                return 'not_now';
            }
            break;
        case 'vote':
            if (!$playing || $g['phase'] !== 'vote') return 'not_now';
            $pid = $own($in['player_id'] ?? 0);
            if ($pid === null) return 'not_your_player';
            if (!in_array($pid, storiaVoters($g), true)) return 'you_are_out';
            $idx = $in['line'] ?? null;
            if (!is_int($idx) || !in_array($idx, storiaVotable($g), true)) return 'bad_vote';
            if ((int)$g['story'][$idx]['p'] === $pid) return 'own_line';
            $g['votes'][(string)$pid] = $idx;
            storiaEvent($g, ['t' => 'voted', 'p' => $pid]);
            if (count(array_filter(storiaVoters($g), fn($p) => isset($g['votes'][(string)$p]))) === count(storiaVoters($g))) storiaFinish($g, 'done');
            break;
        case 'remove_line':      // moderation: the host blanks a sentence (it becomes "…" for everybody, authors included)
            if (!$isHost) return 'host_only';
            if (!$playing) return 'not_now';
            $idx = $in['line'] ?? null;
            if (!is_int($idx) || empty($g['story'][$idx]) || $g['story'][$idx]['k'] === 'inc') return 'bad_vote';
            $g['story'][$idx]['rm'] = true;
            $g['votes'] = array_filter($g['votes'], fn($v) => $v !== $idx);
            storiaEvent($g, ['t' => 'removed']);
            break;
        case 'exclude':          // moderation: the host takes a player out of the story (their turns are skipped)
            if (!$isHost) return 'host_only';
            if (!$playing) return 'not_now';
            $pid = (int)($in['target'] ?? 0);
            if (!in_array($pid, $g['order'], true)) return 'bad_vote';
            storiaPlayerLeft($g, $pid, 'excluded');
            break;
        default:
            return null;
    }
    storiaSave($db, (int)$room['id'], $g);
    return true;
}

/** The opening line in the language of the viewer's phone (the client picks one of the five). */
function storiaStoryForViewers(array $g): array {
    $limit = $g['phase'] === 'read' ? $g['shown'] : count($g['story']);
    $out = [];
    foreach (array_slice($g['story'], 0, $limit, true) as $i => $l) {
        $out[] = ['i' => $i, 't' => !empty($l['rm']) ? STORIA_SKIP : $l['text'], 'k' => $l['k'] === 'inc' ? 'inc' : ($l['k'] === 'skip' || !empty($l['rm']) ? 'skip' : 'line'), 'tr' => $l['k'] === 'inc' && empty($l['rm']) ? ($l['tr'] ?? null) : null];
    }
    return $out;
}

/** What one phone may see. No author before the end; while writing only the current writer's phone gets the one previous sentence. */
function storiaView(PDO $db, array $room, array $device, bool $adminSession): array {
    $view = spiaView($db, $room, $device, $adminSession);
    $view['game'] = 'storia';
    $view['settings'] = storiaSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $view['settings']['own_on'] = $view['settings']['own'] !== '';
    $g = storiaLoad($db, (int)$room['id']);
    $view['storia'] = null;
    if (!$g) return $view;
    // the host's own opening line is not shown to the other phones while the story is written: they only get the sentence before theirs
    if ($g['status'] === 'play' && (int)$room['host_device_id'] !== (int)$device['id']) $view['settings']['own'] = '';
    $now = microtime(true);
    $mine = array_map(fn($p) => (int)$p['id'], array_filter($view['players'], fn($p) => $p['device_id'] === (int)$device['id']));
    $play = $g['status'] === 'play';
    $write = $play && $g['phase'] === 'write';
    $writer = $write ? storiaWriter($g) : null;
    $voting = $play && $g['phase'] === 'vote';
    $me = [];
    $prev = null;
    foreach (array_values(array_intersect($mine, $g['order'])) as $pid) {
        $gone = in_array($pid, $g['gone'], true);
        $me[] = ['player_id' => $pid, 'writing' => $writer === $pid, 'voted' => isset($g['votes'][(string)$pid]), 'excluded' => $gone, 'can_vote' => $voting && !$gone && !isset($g['votes'][(string)$pid])];
        if ($writer === $pid) { $p = storiaPrev($g); $prev = ['player_id' => $pid, 'text' => $p['text'], 'incipit' => $p['incipit'], 'tr' => null]; }
    }
    if ($prev && $prev['incipit'] && !empty($g['story'][0]['tr'])) $prev['tr'] = $g['story'][0]['tr'];
    $myVotes = [];
    foreach ($me as $m) if (isset($g['votes'][(string)$m['player_id']])) $myVotes[$m['player_id']] = $g['votes'][(string)$m['player_id']];
    $myLines = [];
    foreach ($g['story'] as $i => $l) if ($l['k'] === 'line' && empty($l['rm']) && in_array((int)$l['p'], $mine, true)) $myLines[(int)$l['p']][] = $i;
    $written = count(array_filter($g['story'], fn($l) => $l['k'] !== 'inc'));
    $view['storia'] = [
        'match' => $g['match'], 'status' => $g['status'], 'phase' => $g['phase'], 'rules' => array_diff_key($g['rules'], ['own' => 1]),
        'order' => $g['order'], 'active' => storiaActive($g), 'turns_total' => count($g['turns']), 'turn' => min($g['turn'], count($g['turns'])), 'written' => $written,
        'writer' => $writer, 'prev' => $prev,
        'ends_at' => $write && $g['ends_at'] !== null ? round($g['ends_at'], 1) : null,
        'left' => $write && $g['ends_at'] !== null ? max(0, round($g['ends_at'] - $now, 1)) : null,
        'story' => in_array($g['phase'], ['read', 'vote'], true) ? storiaStoryForViewers($g) : [],
        'read_left' => $g['phase'] === 'read' && $g['next_at'] !== null ? max(0, round($g['next_at'] - $now, 1)) : null,
        'total_lines' => count($g['story']),
        'voted' => array_values(array_map('intval', array_keys($g['votes']))), 'my_votes' => (object)$myVotes, 'my_lines' => (object)($play && in_array($g['phase'], ['vote'], true) ? $myLines : []),
        'events' => $g['events'], 'result' => $g['result'], 'me' => $me,
    ];
    return $view;
}

/** For the admin LIVE panel (admin sessions only): the whole story so far and who wrote what. */
function storiaLiveInfo(PDO $db, int $roomId): ?array {
    $g = storiaLoad($db, $roomId);
    if (!$g) return null;
    return [
        'status' => $g['status'], 'phase' => $g['phase'], 'writer' => $g['phase'] === 'write' ? storiaWriter($g) : null,
        'turn' => $g['turn'], 'turns_total' => count($g['turns']),
        'story' => array_map(fn($l) => ['p' => $l['p'], 'text' => !empty($l['rm']) ? STORIA_SKIP : $l['text'], 'k' => $l['k'], 'tr' => $l['tr'] ?? null], $g['story']),
        'votes' => $g['votes'],
    ];
}
