<?php
// public/api/dieci_lib.php — "10 su 10, ma…" (a 10/10… but), on the shared rooms of spia.php (game "dieci").
// One JSON state per room (table dieci_games), changed inside the caller's BEGIN IMMEDIATE transaction.
//
// Every round the server picks one player in turn (the "target"). The page shows "{Name} is a 10/10… but" and EVERY active player
// finishes the sentence from their own phone with a funny flaw (60 characters at most, anonymous). When all have written (or the
// writing time is up: the missing ones are skipped) the sentences are shown to everybody in a random order, without authors,
// and everybody votes for the funniest one (never their own). The author of the most voted sentence scores 1 (ties: all of them).
// The target also gives the "10/10 prize" to the sentence they like most (not their own): its author scores 2 more.
// The authors are sent to the phones only at the reveal. Who voted for whom is never sent (only the admin LIVE panel sees it).
// Family filter (default on): the server refuses a short list of heavy words and the hints skip the cheeky examples.
// Hints and examples: lib/dieci-q.json, [category 0 clean|1 cheeky, it, en, es, fr, de] (the text that follows "but").

const DIECI_MIN_PLAYERS = 3;
const DIECI_MAX_LEN = 60;
const DIECI_VOTE_SECONDS = 40;
const DIECI_REVEAL_SECONDS = 12;
const DIECI_HINTS = 3;
const DIECI_LANGS = ['it', 'en', 'es', 'fr', 'de'];

function dieciDefaultSettings(): array {
    return ['turns' => 1, 'time' => 60, 'family' => true];
}

function dieciSanitizeSettings(array $in, array $base): array {
    $s = array_merge(dieciDefaultSettings(), array_intersect_key($base, dieciDefaultSettings()));
    if (isset($in['turns']) && in_array($in['turns'], [1, 2], true)) $s['turns'] = $in['turns'];
    if (isset($in['time']) && in_array($in['time'], [45, 60, 90], true)) $s['time'] = $in['time'];
    $s['family'] = isset($in['family']) && is_bool($in['family']) ? $in['family'] : (bool)$s['family'];
    return $s;
}

/** The example bank (read once per request). */
function dieciBank(): array {
    static $bank = null;
    if ($bank === null) $bank = json_decode((string)@file_get_contents(dirname(__DIR__, 2) . '/lib/dieci-q.json'), true) ?: [];
    return $bank;
}

/** Lower case, no accents (ASCII), so that the word list can be matched simply. */
function dieciNorm(string $s): string {
    $s = strtr($s, [
        'à' => 'a', 'á' => 'a', 'â' => 'a', 'ã' => 'a', 'ä' => 'a', 'å' => 'a', 'À' => 'a', 'Á' => 'a', 'Â' => 'a', 'Ä' => 'a',
        'ç' => 'c', 'Ç' => 'c', 'è' => 'e', 'é' => 'e', 'ê' => 'e', 'ë' => 'e', 'È' => 'e', 'É' => 'e', 'Ê' => 'e', 'Ë' => 'e',
        'ì' => 'i', 'í' => 'i', 'î' => 'i', 'ï' => 'i', 'Ì' => 'i', 'Í' => 'i', 'Î' => 'i', 'Ï' => 'i', 'ñ' => 'n', 'Ñ' => 'n',
        'ò' => 'o', 'ó' => 'o', 'ô' => 'o', 'õ' => 'o', 'ö' => 'o', 'Ò' => 'o', 'Ó' => 'o', 'Ô' => 'o', 'Ö' => 'o',
        'ù' => 'u', 'ú' => 'u', 'û' => 'u', 'ü' => 'u', 'Ù' => 'u', 'Ú' => 'u', 'Û' => 'u', 'Ü' => 'u', 'ß' => 'ss', 'ý' => 'y', 'ÿ' => 'y',
    ]);
    return strtolower($s);
}

/** True when the text holds a heavy word (it/en/es/fr/de). Simple matching: a word that STARTS with a stem, or a whole word. */
function dieciHasBadWord(string $text): bool {
    $stems = ['vaffanc', 'puttan', 'stronz', 'merd', 'fuck', 'shit', 'bitch', 'asshole', 'motherfuck', 'cunt', 'nigger', 'nigga', 'faggot',
        'whore', 'mierda', 'joder', 'cabron', 'gilipoll', 'pendej', 'putain', 'connard', 'connasse', 'encul', 'nique', 'scheiss',
        'arschloch', 'fotze', 'ficken', 'hurensohn', 'wichs', 'schlampe'];
    $words = ['cazzo', 'cazzi', 'cazzata', 'troia', 'troie', 'minchia', 'frocio', 'figa', 'slut', 'sluts', 'slutty', 'dick', 'dicks', 'pussy',
        'puta', 'putas', 'puto', 'polla', 'marica', 'salope', 'salopes', 'pute', 'foutre', 'fick', 'nutte', 'nutten', 'negro', 'negros'];
    $n = dieciNorm($text);
    return (bool)preg_match('/(?<![a-z])(?:' . implode('|', $stems) . ')/', $n)
        || (bool)preg_match('/(?<![a-z])(?:' . implode('|', $words) . ')(?![a-z])/', $n);
}

/** Cleans one sentence. Returns [text, null] or [null, error code]. */
function dieciCheckText($raw, bool $family): array {
    if (!is_string($raw)) return [null, 'empty_text'];
    $t = preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $raw);
    $t = $t === null ? null : preg_replace('/\s+/u', ' ', $t);
    if ($t === null) return [null, 'bad_text'];   // not valid UTF-8
    $t = trim($t);
    if ($t === '') return [null, 'empty_text'];
    if (textLength($t) > DIECI_MAX_LEN) return [null, 'text_too_long'];
    if (strpbrk($t, '<>') !== false) return [null, 'bad_text'];   // no HTML
    if ($family && dieciHasBadWord($t)) return [null, 'bad_word'];
    return [$t, null];
}

function dieciLoad(PDO $db, int $roomId): ?array {
    $st = $db->prepare('SELECT state FROM dieci_games WHERE room_id = :r');
    $st->execute([':r' => $roomId]);
    $raw = $st->fetchColumn();
    return $raw ? json_decode($raw, true) : null;
}

function dieciSave(PDO $db, int $roomId, array $g): void {
    $db->prepare('INSERT INTO dieci_games (room_id, state, updated_at) VALUES (:r, :s, :t)
                  ON CONFLICT(room_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at')
       ->execute([':r' => $roomId, ':s' => json_encode($g), ':t' => time()]);
}

function dieciEvent(array &$g, array $ev): void {
    $ev['id'] = ++$g['event_seq'];
    $ev['round'] = $g['round'];
    $g['events'][] = $ev;
    if (count($g['events']) > 40) $g['events'] = array_slice($g['events'], -40);
}

function dieciActive(array $g): array {
    return array_values(array_diff($g['order'], $g['gone']));
}

function dieciShuffle(array $a): array {
    for ($i = count($a) - 1; $i > 0; $i--) { $j = random_int(0, $i); [$a[$i], $a[$j]] = [$a[$j], $a[$i]]; }
    return $a;
}

/** Items of the vote: indexes into g['show'] that are still valid (author still in, not removed by the host). */
function dieciItems(array $g): array {
    $out = [];
    foreach ($g['show'] ?? [] as $i => $pid) if (!in_array($i, $g['removed'], true) && !in_array($pid, $g['gone'], true)) $out[] = $i;
    return $out;
}

/** Does this player have something to vote for (an item that is not theirs)? */
function dieciCanVote(array $g, int $pid): bool {
    foreach (dieciItems($g) as $i) if ($g['show'][$i] !== $pid) return true;
    return false;
}

function dieciEnd(array &$g, string $reason): void {
    $g['status'] = 'ended';
    $g['phase'] = 'ended';
    $rows = [];
    foreach (dieciActive($g) as $p) {
        $s = $g['stats'][(string)$p];
        $rows[] = ['p' => $p, 'pts' => $s['pts'], 'wins' => $s['wins'], 'prizes' => $s['prizes']];
    }
    usort($rows, fn($a, $b) => [$b['pts'], $b['wins']] <=> [$a['pts'], $a['wins']]);
    $g['result'] = ['reason' => $reason, 'rounds' => $g['round'], 'rows' => $rows];
    dieciEvent($g, ['t' => 'end']);
}

/** Next round: the next target in the queue that is still in the match, or the standings when the queue is over. */
function dieciStartRound(array &$g, ?float $now = null): void {
    $now = $now ?? microtime(true);
    while ($g['round'] <= count($g['queue']) && in_array($g['queue'][$g['round'] - 1], $g['gone'], true)) $g['round']++;
    if ($g['round'] > count($g['queue'])) { $g['round'] = count($g['queue']); dieciEnd($g, 'finished'); return; }
    $time = (int)$g['rules']['time'];
    $g['q'] = ['target' => $g['queue'][$g['round'] - 1], 'started' => $now, 'deadline' => $now + $time, 'time' => $time, 'vote_deadline' => null];
    $g['texts'] = []; $g['show'] = []; $g['removed'] = []; $g['votes'] = []; $g['prize'] = null; $g['reveal'] = null;
    $g['phase'] = 'write';
    $g['next_at'] = null;
    dieciEvent($g, ['t' => 'round', 'n' => $g['round'], 'p' => $g['q']['target']]);
}

function dieciAdvance(array &$g, ?float $now = null): void {
    $g['round']++;
    dieciStartRound($g, $now);
}

/** Writing is over: the sentences of the players still in go to the vote in a random order. */
function dieciStartVote(array &$g, ?float $now = null): void {
    $now = $now ?? microtime(true);
    $authors = array_values(array_filter(dieciActive($g), fn($p) => isset($g['texts'][(string)$p])));
    $g['show'] = dieciShuffle($authors);
    $g['removed'] = []; $g['votes'] = []; $g['prize'] = null;
    $g['q']['vote_deadline'] = $now + DIECI_VOTE_SECONDS;
    $g['phase'] = 'vote';
    if (count($g['show']) === 0) dieciResolve($g, $now);
}

function dieciVotesDone(array $g): bool {
    foreach (dieciActive($g) as $p) if (dieciCanVote($g, $p) && !isset($g['votes'][(string)$p])) return false;
    return true;
}

/** Count the votes: the most voted sentence scores 1 (ties: all), the prize sentence 2 more. */
function dieciResolve(array &$g, ?float $now = null): void {
    $now = $now ?? microtime(true);
    $items = dieciItems($g);
    $counts = array_fill_keys($items, 0);
    foreach ($g['votes'] as $voter => $idx) {
        if (isset($counts[$idx]) && in_array((int)$voter, dieciActive($g), true) && $g['show'][$idx] !== (int)$voter) $counts[$idx]++;
    }
    $max = $counts ? max($counts) : 0;
    $rows = [];
    foreach ($items as $i) {
        $pid = $g['show'][$i];
        $win = $max > 0 && $counts[$i] === $max;
        $prize = $g['prize'] === $i;
        $s = &$g['stats'][(string)$pid];
        $s['votes'] += $counts[$i];
        if ($win) { $s['pts'] += 1; $s['wins']++; dieciEvent($g, ['t' => 'win', 'p' => $pid]); }
        if ($prize) { $s['pts'] += 2; $s['prizes']++; dieciEvent($g, ['t' => 'prize', 'p' => $pid]); }
        unset($s);
        $rows[] = ['p' => $pid, 'text' => $g['texts'][(string)$pid], 'n' => $counts[$i], 'win' => $win, 'prize' => $prize];
    }
    usort($rows, fn($a, $b) => $b['n'] <=> $a['n']);
    if (!$rows) dieciEvent($g, ['t' => 'none']);
    $skipped = array_values(array_filter(dieciActive($g), fn($p) => !isset($g['texts'][(string)$p])));
    $g['reveal'] = ['rows' => $rows, 'target' => $g['q']['target'], 'skipped' => $skipped, 'last' => $g['round'] >= count($g['queue'])];
    $g['phase'] = 'reveal';
    $g['next_at'] = $now + DIECI_REVEAL_SECONDS;
}

/** Advances the clock-driven parts. Returns true when the state changed (the caller saves it). */
function dieciTick(array &$g, ?float $now = null): bool {
    if ($g['status'] !== 'play') return false;
    $now = $now ?? microtime(true);
    if ($g['phase'] === 'write') {
        $all = !array_filter(dieciActive($g), fn($p) => !isset($g['texts'][(string)$p]));
        if ($now >= $g['q']['deadline'] || $all) { dieciStartVote($g, $now); return true; }
    } elseif ($g['phase'] === 'vote') {
        if ($now >= $g['q']['vote_deadline'] || dieciVotesDone($g)) { dieciResolve($g, $now); return true; }
    } elseif ($g['phase'] === 'reveal' && $now >= $g['next_at']) {
        if ($g['reveal']['last']) dieciEnd($g, 'finished'); else dieciAdvance($g, $now);
        return true;
    }
    return false;
}

function dieciStart(PDO $db, array $room): ?string {
    $s = dieciSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $players = spiaPlayers($db, (int)$room['id']);
    if (count($players) < DIECI_MIN_PLAYERS) return 'need_players_dieci';
    if (!dieciBank()) return 'no_questions';
    $order = array_map(fn($p) => (int)$p['id'], $players);
    // everybody is the target the same number of times; the first of a new lap is never the last of the previous one
    $queue = [];
    for ($lap = 0; $lap < $s['turns']; $lap++) {
        $l = dieciShuffle($order);
        if ($queue && $l[0] === end($queue) && count($l) > 1) { [$l[0], $l[1]] = [$l[1], $l[0]]; }
        $queue = array_merge($queue, $l);
    }
    $prev = dieciLoad($db, (int)$room['id']);
    $g = [
        'match' => (int)($prev['match'] ?? 0) + 1,
        'status' => 'play', 'phase' => 'write', 'rules' => $s, 'order' => $order, 'gone' => [], 'queue' => $queue,
        'stats' => array_fill_keys(array_map('strval', $order), ['pts' => 0, 'wins' => 0, 'prizes' => 0, 'votes' => 0]),
        'round' => 1, 'q' => null, 'texts' => [], 'show' => [], 'removed' => [], 'votes' => [], 'prize' => null,
        'hints' => [], 'hint' => [], 'hint_used' => [], 'reveal' => null, 'next_at' => null,
        'events' => [], 'event_seq' => (int)($prev['event_seq'] ?? 0), 'result' => null,
    ];
    dieciEvent($g, ['t' => 'start']);
    dieciStartRound($g);
    dieciSave($db, (int)$room['id'], $g);
    return null;
}

/** A player leaves or is excluded: out of the match. The round whose target they were is skipped. */
function dieciPlayerLeft(array &$g, int $pid, string $ev = 'left'): void {
    if ($g['status'] !== 'play' || !in_array($pid, $g['order'], true) || in_array($pid, $g['gone'], true)) return;
    $g['gone'][] = $pid;
    unset($g['votes'][(string)$pid]);
    dieciEvent($g, ['t' => $ev, 'p' => $pid]);
    if (count(dieciActive($g)) < DIECI_MIN_PLAYERS) { dieciEnd($g, 'too_few'); return; }
    if ($g['phase'] !== 'reveal' && ($g['q']['target'] ?? null) === $pid) dieciAdvance($g);
}

/** Room actions for the game. Returns true (handled), null (not one of its actions) or an error code. */
function dieciHandle(PDO $db, array $room, array $device, bool $isHost, array $in, string $action) {
    $g = dieciLoad($db, (int)$room['id']);
    if ($g && dieciTick($g)) dieciSave($db, (int)$room['id'], $g);
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
            $new = dieciSanitizeSettings(is_array($in['settings'] ?? null) ? $in['settings'] : [], json_decode($room['settings'], true) ?: []);
            $db->prepare('UPDATE spia_rooms SET settings = :s WHERE id = :id')->execute([':s' => json_encode($new), ':id' => $room['id']]);
            return true;
        case 'start':
            if (!$isHost) return 'host_only';
            if ($playing) return 'round_running';
            return dieciStart($db, $room) ?? true;
        case 'end':
            if (!$isHost) return 'host_only';
            if (!$playing) return 'no_round';
            dieciEnd($g, 'host_ended');
            break;
        case 'next':
            if (!$isHost) return 'host_only';
            if (!$playing || $g['phase'] !== 'reveal') return 'not_now';
            if ($g['reveal']['last']) dieciEnd($g, 'finished'); else dieciAdvance($g);
            break;
        case 'exclude':
            if (!$isHost) return 'host_only';
            if (!$playing) return 'no_round';
            $pid = $in['player_id'] ?? null;
            if (!is_int($pid) || !in_array($pid, dieciActive($g), true)) return 'bad_target';
            dieciPlayerLeft($g, $pid, 'excluded');
            break;
        case 'remove':
            if (!$isHost) return 'host_only';
            if (!$playing || $g['phase'] !== 'vote') return 'not_now';
            $idx = $in['idx'] ?? null;
            if (!is_int($idx) || !in_array($idx, dieciItems($g), true)) return 'bad_target';
            $g['removed'][] = $idx;
            foreach ($g['votes'] as $k => $v) if ($v === $idx) unset($g['votes'][$k]);   // those voters can vote again
            if ($g['prize'] === $idx) $g['prize'] = null;
            dieciEvent($g, ['t' => 'removed']);
            dieciTick($g);
            break;
        case 'write':
            if (!$playing || $g['phase'] !== 'write') return 'not_now';
            $pid = $own($in['player_id'] ?? 0);
            if ($pid === null) return 'not_your_player';
            if (!in_array($pid, dieciActive($g), true)) return 'you_are_out';
            if (isset($g['texts'][(string)$pid])) return 'already_wrote';
            if (microtime(true) > $g['q']['deadline'] + 0.5) return 'not_now';
            [$text, $err] = dieciCheckText($in['text'] ?? null, !empty($g['rules']['family']));
            if ($err !== null) return $err;
            $g['texts'][(string)$pid] = $text;
            dieciTick($g);
            break;
        case 'hint':
            if (!$playing || $g['phase'] !== 'write') return 'not_now';
            $pid = $own($in['player_id'] ?? 0);
            if ($pid === null) return 'not_your_player';
            if (!in_array($pid, dieciActive($g), true)) return 'you_are_out';
            $k = (string)$pid;
            if (($g['hints'][$k] ?? 0) >= DIECI_HINTS) return 'hints_over';
            $bank = dieciBank();
            $cats = !empty($g['rules']['family']) ? [0] : [0, 1];
            $free = array_values(array_filter(array_keys($bank), fn($i) => in_array($bank[$i][0], $cats, true) && !in_array($i, $g['hint_used'], true)));
            if (!$free) { $g['hint_used'] = []; $free = array_values(array_filter(array_keys($bank), fn($i) => in_array($bank[$i][0], $cats, true))); }
            $i = $free[random_int(0, count($free) - 1)];
            $g['hint_used'][] = $i;
            $g['hint'][$k] = $i;
            $g['hints'][$k] = ($g['hints'][$k] ?? 0) + 1;
            break;
        case 'vote':
            if (!$playing || $g['phase'] !== 'vote') return 'not_now';
            $pid = $own($in['player_id'] ?? 0);
            if ($pid === null) return 'not_your_player';
            $k = (string)$pid;
            if (!in_array($pid, dieciActive($g), true)) return 'you_are_out';
            if (isset($g['votes'][$k])) return 'already_voted';
            $idx = $in['idx'] ?? null;
            if (!is_int($idx) || !in_array($idx, dieciItems($g), true)) return 'bad_target';
            if ($g['show'][$idx] === $pid) return 'not_yourself';
            $prize = $in['prize'] ?? null;
            if ($prize !== null) {
                if ($pid !== $g['q']['target']) return 'not_target';
                if (!is_int($prize) || !in_array($prize, dieciItems($g), true)) return 'bad_target';
                if ($g['show'][$prize] === $pid) return 'not_yourself';
            }
            if (microtime(true) > $g['q']['vote_deadline'] + 0.5) return 'not_now';
            $g['votes'][$k] = $idx;
            if ($prize !== null) $g['prize'] = $prize;
            dieciTick($g);
            break;
        default:
            return null;
    }
    dieciSave($db, (int)$room['id'], $g);
    return true;
}

/** What one phone may see. Authors only at the reveal; never who voted for whom. */
function dieciView(PDO $db, array $room, array $device, bool $adminSession): array {
    $view = spiaView($db, $room, $device, $adminSession);
    $view['game'] = 'dieci';
    $view['settings'] = dieciSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $g = dieciLoad($db, (int)$room['id']);
    $view['dieci'] = null;
    if (!$g) return $view;
    $now = microtime(true);
    $mine = array_map(fn($p) => (int)$p['id'], array_filter($view['players'], fn($p) => $p['device_id'] === (int)$device['id']));
    $phase = $g['phase'];
    $bank = dieciBank();
    $me = [];
    foreach (array_values(array_intersect($mine, $g['order'])) as $pid) {
        $k = (string)$pid;
        $h = isset($g['hint'][$k]) ? ($bank[$g['hint'][$k]] ?? null) : null;
        $ownIdx = [];
        if ($phase === 'vote') foreach (dieciItems($g) as $i) if ($g['show'][$i] === $pid) $ownIdx[] = $i;
        $me[] = [
            'player_id' => $pid, 'active' => !in_array($pid, $g['gone'], true),
            'wrote' => isset($g['texts'][$k]), 'voted' => isset($g['votes'][$k]),
            'can_vote' => $phase === 'vote' && dieciCanVote($g, $pid),
            'hint' => $h ? array_combine(DIECI_LANGS, array_slice($h, 1, 5)) : null,
            'hints_left' => max(0, DIECI_HINTS - ($g['hints'][$k] ?? 0)),
            'own' => $ownIdx,
        ];
    }
    $q = null;
    if ($g['q'] && in_array($phase, ['write', 'vote'], true)) {
        $q = [
            'target' => $g['q']['target'],
            'time' => $phase === 'write' ? $g['q']['time'] : DIECI_VOTE_SECONDS,
            'left' => max(0, round(($phase === 'write' ? $g['q']['deadline'] : $g['q']['vote_deadline']) - $now, 1)),
        ];
    }
    $items = null;
    if ($phase === 'vote') {
        $items = [];
        foreach (dieciItems($g) as $i) $items[] = ['i' => $i, 'text' => $g['texts'][(string)$g['show'][$i]]];
    }
    $view['dieci'] = [
        'match' => $g['match'], 'status' => $g['status'], 'phase' => $phase, 'round' => $g['round'], 'rounds' => count($g['queue']),
        'order' => $g['order'], 'active' => dieciActive($g), 'rules' => $g['rules'],
        'target' => $g['q']['target'] ?? null,
        'wrote' => $phase === 'write' ? array_map('intval', array_keys($g['texts'])) : [],
        'voted' => $phase === 'vote' ? array_map('intval', array_keys($g['votes'])) : [],
        'q' => $q, 'items' => $items,
        'reveal' => $phase === 'reveal' ? $g['reveal'] : null,
        'next_left' => $phase === 'reveal' ? max(0, round($g['next_at'] - $now, 1)) : null,
        'events' => $g['events'], 'result' => $g['result'], 'me' => $me,
        'scores' => array_map(fn($s) => $s['pts'], $g['stats']),
    ];
    return $view;
}

/** For the admin LIVE panel: the admin sees who wrote what and who voted for whom (the players never do). */
function dieciLiveInfo(PDO $db, int $roomId): ?array {
    $g = dieciLoad($db, $roomId);
    if (!$g) return null;
    $author = [];
    foreach ($g['votes'] as $voter => $idx) $author[$voter] = $g['show'][$idx] ?? null;   // voter -> author of the chosen sentence
    return [
        'status' => $g['status'], 'phase' => $g['phase'], 'round' => $g['round'], 'rounds' => count($g['queue']),
        'target' => $g['q']['target'] ?? null,
        'texts' => $g['texts'], 'votes' => $author, 'prize' => $g['prize'] !== null ? ($g['show'][$g['prize']] ?? null) : null,
        'removed' => array_map(fn($i) => $g['show'][$i] ?? null, $g['removed']),
        'scores' => array_map(fn($s) => $s['pts'], $g['stats']),
    ];
}
