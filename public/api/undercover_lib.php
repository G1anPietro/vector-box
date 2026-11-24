<?php
// public/api/undercover_lib.php — "Undercover" (secret words), on the shared rooms of spia.php (game "undercover").
// One JSON state per room (table undercover_games), changed inside the caller's BEGIN IMMEDIATE transaction.
//
// Everybody gets a secret word: the civilians the same one, the Undercover(s) a SIMILAR one, Mr. White nothing ("?"). Nobody is told
// their own role. Each round the server draws a speaking order; everybody says ONE clue out loud; then all vote in secret (the
// votes are shown together, after the last one). The eliminated player's ROLE is revealed (never the others' words). A tie is voted
// again between the tied players (the third tie in a row is settled by the server's draw). An eliminated Mr. White may guess the
// civilians' word (judged here; accents, capitals and spaces do not matter): if right, he wins alone.
// Civilians win when every Undercover and Mr. White are out; the others win when they are at least as many as the civilians left.
// Words: lib/undercover-q.json, [category, [A in it,en,es,fr,de], [B in it,en,es,fr,de]]; the server decides which one is the civilians'.
// SECRET: roles and words never leave this file except to the owner of that player (the admin LIVE view excepted).

const UC_MIN_PLAYERS = 3;
const UC_REVEAL_SECONDS = 12;
const UC_LANGS = ['it', 'en', 'es', 'fr', 'de'];
const UC_CATS = [0, 1, 2, 3, 4];   // animals, food and drink, things, places and nature, people and fun

function undercoverDefaultSettings(): array {
    return ['infil' => 1, 'white' => false, 'cats' => UC_CATS];
}

function undercoverSanitizeSettings(array $in, array $base): array {
    $s = array_merge(undercoverDefaultSettings(), array_intersect_key($base, undercoverDefaultSettings()));
    if (isset($in['infil']) && in_array($in['infil'], [1, 2, 3], true)) $s['infil'] = $in['infil'];
    if (isset($in['white']) && is_bool($in['white'])) $s['white'] = $in['white'];
    if (isset($in['cats']) && is_array($in['cats'])) {
        $c = array_values(array_unique(array_filter($in['cats'], fn($x) => is_int($x) && in_array($x, UC_CATS, true))));
        sort($c);
        if ($c) $s['cats'] = $c;
    }
    $s['white'] = (bool)$s['white'];
    return $s;
}

/** How many Undercover / Mr. White fit n players: the bad ones must stay fewer than half (3-4 players: one Undercover, no Mr. White). */
function undercoverFit(int $n, int $infil, bool $white): array {
    $max = intdiv($n - 1, 2);
    if ($infil + ($white ? 1 : 0) > $max) $white = false;
    return [max(1, min($infil, $max)), $white];
}

function undercoverBank(): array {
    static $bank = null;
    if ($bank === null) $bank = json_decode((string)@file_get_contents(dirname(__DIR__, 2) . '/lib/undercover-q.json'), true) ?: [];
    return $bank;
}

function undercoverLoad(PDO $db, int $roomId): ?array {
    $st = $db->prepare('SELECT state FROM undercover_games WHERE room_id = :r');
    $st->execute([':r' => $roomId]);
    $raw = $st->fetchColumn();
    return $raw ? json_decode($raw, true) : null;
}

function undercoverSave(PDO $db, int $roomId, array $g): void {
    $db->prepare('INSERT INTO undercover_games (room_id, state, updated_at) VALUES (:r, :s, :t)
                  ON CONFLICT(room_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at')
       ->execute([':r' => $roomId, ':s' => json_encode($g), ':t' => time()]);
}

function ucEvent(array &$g, array $ev): void {
    $ev['id'] = ++$g['event_seq'];
    $ev['round'] = $g['round'];
    $g['events'][] = $ev;
    if (count($g['events']) > 40) $g['events'] = array_slice($g['events'], -40);
}

/** Players still in the match: not eliminated and not left. */
function ucAlive(array $g): array {
    $out = array_map(fn($o) => $o['p'], $g['out']);
    return array_values(array_filter($g['order'], fn($p) => !in_array($p, $out, true)));
}

/** The two words in the five languages: ['civ' => [...], 'und' => [...]]. */
function ucPair(array $g): ?array {
    $row = undercoverBank()[$g['pair']['i']] ?? null;
    if (!$row) return null;
    $swap = !empty($g['pair']['swap']);
    return ['civ' => $row[$swap ? 2 : 1], 'und' => $row[$swap ? 1 : 2]];
}

/** A guess without accents, capitals, spaces or punctuation (no mbstring needed). */
function ucNorm(string $s): string {
    $s = strtr(substr($s, 0, 80), [
        'à' => 'a', 'á' => 'a', 'â' => 'a', 'ä' => 'a', 'ã' => 'a', 'å' => 'a', 'À' => 'a', 'Á' => 'a', 'Â' => 'a', 'Ä' => 'a', 'Ã' => 'a', 'Å' => 'a',
        'è' => 'e', 'é' => 'e', 'ê' => 'e', 'ë' => 'e', 'È' => 'e', 'É' => 'e', 'Ê' => 'e', 'Ë' => 'e',
        'ì' => 'i', 'í' => 'i', 'î' => 'i', 'ï' => 'i', 'Ì' => 'i', 'Í' => 'i', 'Î' => 'i', 'Ï' => 'i',
        'ò' => 'o', 'ó' => 'o', 'ô' => 'o', 'ö' => 'o', 'õ' => 'o', 'Ò' => 'o', 'Ó' => 'o', 'Ô' => 'o', 'Ö' => 'o', 'Õ' => 'o',
        'ù' => 'u', 'ú' => 'u', 'û' => 'u', 'ü' => 'u', 'Ù' => 'u', 'Ú' => 'u', 'Û' => 'u', 'Ü' => 'u',
        'ñ' => 'n', 'Ñ' => 'n', 'ç' => 'c', 'Ç' => 'c', 'ý' => 'y', 'ÿ' => 'y', 'ß' => 'ss', 'œ' => 'oe', 'Œ' => 'oe', 'æ' => 'ae',
    ]);
    return preg_replace('/[^a-z0-9]/', '', strtolower($s)) ?? '';
}

/** 'civilians', 'undercover' (the bad ones are at least as many as the civilians) or null. */
function ucCheckWin(array $g): ?string {
    $civ = 0; $bad = 0;
    foreach (ucAlive($g) as $p) { if ($g['roles'][(string)$p] === 'civ') $civ++; else $bad++; }
    if ($bad === 0) return 'civilians';
    return $civ <= $bad ? 'undercover' : null;
}

function ucEnd(array &$g, string $reason, ?string $winner): void {
    $g['status'] = 'ended';
    $g['phase'] = 'ended';
    $w = ucPair($g);
    $rows = [];
    foreach ($g['order'] as $p) {
        $o = array_values(array_filter($g['out'], fn($x) => $x['p'] === $p));
        $rows[] = ['p' => $p, 'role' => $g['roles'][(string)$p], 'out' => $o ? $o[0]['round'] : null, 'left' => $o ? !empty($o[0]['left']) : false];
    }
    $g['result'] = ['reason' => $reason, 'winner' => $winner, 'rounds' => $g['round'], 'civ' => $w['civ'] ?? [], 'und' => $w['und'] ?? [], 'rows' => $rows, 'guess' => $g['guess']];
    ucEvent($g, ['t' => 'end']);
}

/** A new round: the server draws the speaking order among the living players. */
function ucStartClues(array &$g): void {
    $s = ucAlive($g);
    shuffle($s);
    $g['speakers'] = $s;
    $g['turn'] = 0;
    $g['votes'] = [];
    $g['cands'] = null;
    $g['ties'] = 0;
    $g['last'] = null;
    $g['guess'] = null;
    $g['phase'] = 'clue';
    $g['next_at'] = null;
    ucEvent($g, ['t' => 'round', 'n' => $g['round']]);
}

/** Done with an elimination (and the guess, if any): the match is over, or a short reveal before the next round. */
function ucAfterElim(array &$g, ?float $now = null): void {
    $win = ucCheckWin($g);
    if ($win !== null) { ucEnd($g, 'last', $win); return; }
    $g['phase'] = 'reveal';
    $g['next_at'] = ($now ?? microtime(true)) + UC_REVEAL_SECONDS;
}

function ucEliminate(array &$g, int $p, array $choices, ?float $now = null): void {
    $role = $g['roles'][(string)$p];
    $g['out'][] = ['p' => $p, 'role' => $role, 'round' => $g['round']];
    $g['last'] = ['p' => $p, 'role' => $role, 'choices' => $choices];
    ucEvent($g, ['t' => 'out', 'p' => $p, 'r' => $role]);
    if ($role === 'white') { $g['phase'] = 'guess'; $g['guess'] = ['p' => $p, 'ok' => null, 'text' => null]; return; }
    ucAfterElim($g, $now);
}

/** Count the votes: one loser, or a tie (a new vote between the tied; the third tie in a row is drawn). */
function ucResolve(array &$g, ?float $now = null): void {
    $valid = $g['cands'] ?? ucAlive($g);
    $n = [];
    $choices = [];
    foreach ($g['votes'] as $voter => $target) {
        if (!in_array($target, $valid, true) || (int)$voter === $target || !in_array((int)$voter, ucAlive($g), true)) continue;
        $choices[(string)$voter] = $target;
        $n[$target] = ($n[$target] ?? 0) + 1;
    }
    if (!$n) { $g['votes'] = []; return; }
    $top = max($n);
    $tied = array_values(array_keys(array_filter($n, fn($c) => $c === $top)));
    if (count($tied) > 1 && $g['ties'] < 2) {
        $g['ties']++;
        $g['cands'] = $tied;
        $g['votes'] = [];
        ucEvent($g, ['t' => 'tie', 'ps' => $tied]);
        return;
    }
    ucEliminate($g, count($tied) > 1 ? $tied[random_int(0, count($tied) - 1)] : $tied[0], $choices, $now);
}

function ucGuessFail(array &$g, ?string $text, ?float $now = null): void {
    $g['guess']['ok'] = false;
    $g['guess']['text'] = $text;
    ucEvent($g, ['t' => 'guess_no', 'p' => $g['guess']['p']]);
    ucAfterElim($g, $now);
}

function ucAdvance(array &$g, ?float $now = null): void {
    $g['round']++;
    ucStartClues($g);
}

/** Advances what depends on the others (all read, last clue, all voted, reveal over). Returns true when the state changed. */
function undercoverTick(array &$g, ?float $now = null): bool {
    if ($g['status'] !== 'play') return false;
    $now = $now ?? microtime(true);
    $alive = ucAlive($g);
    switch ($g['phase']) {
        case 'read':
            if (!array_diff($alive, $g['seen'])) { ucStartClues($g); return true; }
            return false;
        case 'clue':
            $t = $g['turn'];
            while ($t < count($g['speakers']) && !in_array($g['speakers'][$t], $alive, true)) $t++;
            if ($t >= count($g['speakers'])) { $g['phase'] = 'vote'; $g['turn'] = $t; return true; }
            if ($t !== $g['turn']) { $g['turn'] = $t; return true; }
            return false;
        case 'vote':
            if ($alive && !array_diff(array_map('strval', $alive), array_keys($g['votes']))) { ucResolve($g, $now); return true; }
            return false;
        case 'guess':
            if (in_array($g['guess']['p'], $g['gone'], true)) { ucGuessFail($g, null, $now); return true; }
            return false;
        case 'reveal':
            if ($now >= $g['next_at']) { ucAdvance($g, $now); return true; }
            return false;
    }
    return false;
}

function undercoverStart(PDO $db, array $room): ?string {
    $s = undercoverSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $players = spiaPlayers($db, (int)$room['id']);
    if (count($players) < UC_MIN_PLAYERS) return 'need_players_undercover';
    $bank = undercoverBank();
    $prev = undercoverLoad($db, (int)$room['id']);
    $used = $prev['used'] ?? [];
    $cands = fn() => array_values(array_filter(array_keys($bank), fn($i) => in_array($bank[$i][0], $s['cats'], true) && !in_array($i, $used, true)));
    $free = $cands();
    if (!$free) { $used = []; $free = $cands(); }
    if (!$free) return 'no_questions';
    $order = array_map(fn($p) => (int)$p['id'], $players);
    [$k, $w] = undercoverFit(count($order), $s['infil'], $s['white']);
    $deal = $order;
    shuffle($deal);
    $roles = [];
    foreach ($deal as $i => $p) $roles[(string)$p] = $i < $k ? 'und' : ($w && $i === $k ? 'white' : 'civ');
    $i = $free[random_int(0, count($free) - 1)];
    $used[] = $i;
    $g = [
        'match' => (int)($prev['match'] ?? 0) + 1,
        'status' => 'play', 'phase' => 'read', 'rules' => ['k' => $k, 'w' => $w, 'cats' => $s['cats']], 'order' => $order, 'gone' => [],
        'roles' => $roles, 'pair' => ['i' => $i, 'swap' => random_int(0, 1) === 1], 'used' => $used,
        'seen' => [], 'round' => 1, 'speakers' => [], 'turn' => 0, 'votes' => [], 'cands' => null, 'ties' => 0, 'out' => [], 'last' => null, 'guess' => null,
        'next_at' => null, 'events' => [], 'event_seq' => (int)($prev['event_seq'] ?? 0), 'result' => null,
    ];
    ucEvent($g, ['t' => 'start']);
    undercoverSave($db, (int)$room['id'], $g);
    return null;
}

function undercoverPlayerLeft(array &$g, int $pid): void {
    if ($g['status'] !== 'play' || !in_array($pid, $g['order'], true) || in_array($pid, $g['gone'], true)) return;
    $g['gone'][] = $pid;
    if (!in_array($pid, ucAlive($g), true)) return;   // already out: nothing else changes
    $g['out'][] = ['p' => $pid, 'role' => $g['roles'][(string)$pid], 'round' => $g['round'], 'left' => true];
    unset($g['votes'][(string)$pid]);
    $g['votes'] = array_filter($g['votes'], fn($t) => $t !== $pid);
    ucEvent($g, ['t' => 'left', 'p' => $pid]);
    $win = ucCheckWin($g);
    if ($win !== null) ucEnd($g, 'last', $win);
    elseif (is_array($g['cands']) && in_array($pid, $g['cands'], true)) { $g['cands'] = count($g['cands']) > 2 ? array_values(array_diff($g['cands'], [$pid])) : null; }
    undercoverTick($g);
}

/** Room actions for the game. Returns true (handled), null (not one of its actions) or an error code. */
function undercoverHandle(PDO $db, array $room, array $device, bool $isHost, array $in, string $action) {
    $g = undercoverLoad($db, (int)$room['id']);
    if ($g && undercoverTick($g)) undercoverSave($db, (int)$room['id'], $g);
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
            $new = undercoverSanitizeSettings(is_array($in['settings'] ?? null) ? $in['settings'] : [], json_decode($room['settings'], true) ?: []);
            $db->prepare('UPDATE spia_rooms SET settings = :s WHERE id = :id')->execute([':s' => json_encode($new), ':id' => $room['id']]);
            return true;
        case 'start':
            if (!$isHost) return 'host_only';
            if ($playing) return 'round_running';
            return undercoverStart($db, $room) ?? true;
        case 'end':
            if (!$isHost) return 'host_only';
            if (!$playing) return 'no_round';
            ucEnd($g, 'host_ended', null);
            break;
        case 'next':   // the host moves things along: skip the wait for the others, a speaker, the vote, the reveal
            if (!$isHost) return 'host_only';
            if (!$playing) return 'not_now';
            if ($g['phase'] === 'read') ucStartClues($g);
            elseif ($g['phase'] === 'clue') $g['turn']++;
            elseif ($g['phase'] === 'vote') { if (!$g['votes']) return 'not_now'; ucResolve($g); }
            elseif ($g['phase'] === 'guess') ucGuessFail($g, null);
            elseif ($g['phase'] === 'reveal') ucAdvance($g);
            break;
        case 'seen':
            if (!$playing || $g['phase'] !== 'read') return 'not_now';
            $pid = $own($in['player_id'] ?? 0);
            if ($pid === null) return 'not_your_player';
            if (!in_array($pid, ucAlive($g), true)) return 'you_are_out';
            if (!in_array($pid, $g['seen'], true)) $g['seen'][] = $pid;
            break;
        case 'clue_done':
            if (!$playing || $g['phase'] !== 'clue') return 'not_now';
            $cur = $g['speakers'][$g['turn']] ?? null;
            if ($cur === null) return 'not_now';
            if (!$isHost && $own($cur) === null) return 'not_your_player';
            $g['turn']++;
            break;
        case 'vote':
            if (!$playing || $g['phase'] !== 'vote') return 'not_now';
            $pid = $own($in['player_id'] ?? 0);
            if ($pid === null) return 'not_your_player';
            if (!in_array($pid, ucAlive($g), true)) return 'you_are_out';
            if (isset($g['votes'][(string)$pid])) return 'already_voted';
            $to = (int)($in['target'] ?? 0);
            if ($to === $pid || !in_array($to, $g['cands'] ?? ucAlive($g), true)) return 'bad_target';
            $g['votes'][(string)$pid] = $to;
            break;
        case 'guess':
            if (!$playing || $g['phase'] !== 'guess') return 'not_now';
            $pid = $own($in['player_id'] ?? 0);
            if ($pid === null) return 'not_your_player';
            if ($pid !== $g['guess']['p']) return 'not_white';
            $text = trim((string)($in['text'] ?? ''));
            $norm = ucNorm($text);
            if ($norm === '') return 'bad_text';
            $text = substr($text, 0, 40);
            $ok = false;
            foreach (ucPair($g)['civ'] ?? [] as $w) if (ucNorm($w) === $norm) $ok = true;
            if ($ok) {
                $g['guess']['ok'] = true;
                $g['guess']['text'] = $text;
                ucEvent($g, ['t' => 'guess_yes', 'p' => $pid]);
                ucEnd($g, 'white_guessed', 'white');
            } else {
                ucGuessFail($g, $text);
            }
            break;
        default:
            return null;
    }
    undercoverTick($g);
    undercoverSave($db, (int)$room['id'], $g);
    return true;
}

/** What one phone may see: the words and roles of ITS OWN players only (a word; never a role), the roles of those eliminated. */
function undercoverView(PDO $db, array $room, array $device, bool $adminSession): array {
    $view = spiaView($db, $room, $device, $adminSession);
    $view['game'] = 'undercover';
    $view['settings'] = undercoverSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $g = undercoverLoad($db, (int)$room['id']);
    $view['undercover'] = null;
    if (!$g) return $view;
    $now = microtime(true);
    $mine = array_map(fn($p) => (int)$p['id'], array_filter($view['players'], fn($p) => $p['device_id'] === (int)$device['id']));
    $alive = ucAlive($g);
    $w = ucPair($g);
    $play = $g['status'] === 'play';
    $me = [];
    foreach (array_values(array_intersect($mine, $g['order'])) as $pid) {
        $role = $g['roles'][(string)$pid];
        $me[] = [
            'player_id' => $pid, 'alive' => in_array($pid, $alive, true), 'seen' => in_array($pid, $g['seen'], true) || $g['phase'] !== 'read',
            'voted' => isset($g['votes'][(string)$pid]),
            'word' => $play && $role !== 'white' && $w ? $w[$role] : null,   // the word only: the role is never sent to its own player
            'guesser' => $play && $g['phase'] === 'guess' && $g['guess']['p'] === $pid,
        ];
    }
    $open = $g['phase'] === 'vote';
    $view['undercover'] = [
        'match' => $g['match'], 'status' => $g['status'], 'phase' => $g['phase'], 'round' => $g['round'],
        'order' => $g['order'], 'alive' => $alive, 'rules' => ['k' => $g['rules']['k'], 'w' => $g['rules']['w']],
        'out' => array_map(fn($o) => ['p' => $o['p'], 'role' => $o['role'], 'round' => $o['round'], 'left' => !empty($o['left'])], $g['out']),
        'seen' => $g['phase'] === 'read' ? $g['seen'] : [],
        'speakers' => $g['phase'] === 'clue' ? $g['speakers'] : [],
        'speaker' => $g['phase'] === 'clue' ? ($g['speakers'][$g['turn']] ?? null) : null,
        'turn' => $g['turn'],
        'voted' => $open ? array_map('intval', array_keys($g['votes'])) : [],
        'cands' => $open ? $g['cands'] : null,
        'last' => in_array($g['phase'], ['guess', 'reveal', 'ended'], true) ? $g['last'] : null,   // who was voted out, the role, who voted for whom
        'guess' => $g['guess'] ? ['p' => $g['guess']['p'], 'ok' => $g['guess']['ok'], 'text' => $g['guess']['text']] : null,
        'next_left' => $g['phase'] === 'reveal' ? max(0, round($g['next_at'] - $now, 1)) : null,
        'events' => $g['events'], 'result' => $g['result'], 'me' => $me,
    ];
    return $view;
}

/** For the admin LIVE panel: every role and word, and who has voted for whom while the vote is open. */
function undercoverLiveInfo(PDO $db, int $roomId): ?array {
    $g = undercoverLoad($db, $roomId);
    if (!$g) return null;
    $w = ucPair($g);
    return [
        'status' => $g['status'], 'phase' => $g['phase'], 'round' => $g['round'],
        'roles' => $g['roles'], 'alive' => ucAlive($g),
        'civ' => $w['civ'][0] ?? null, 'und' => $w['und'][0] ?? null,
        'speaker' => $g['phase'] === 'clue' ? ($g['speakers'][$g['turn']] ?? null) : null,
        'votes' => $g['votes'],
    ];
}
