<?php
// public/api/bugiardo_lib.php — "Chi è il bugiardo" (Find the liar), on the shared rooms of spia.php (game "bugiardo").
// One JSON state per room (table bugiardo_games), changed inside the caller's BEGIN IMMEDIATE transaction.
//
// Each round everybody gets the SAME secret question on their own phone, except the liar, who gets a SIMILAR but different one
// (same kind of answer: a number 0-10, a few words, or one of four choices). Everybody answers in secret; then the answers are
// shown to all in a random, anonymous order; discussion out loud; then everybody votes for the liar in secret. The server counts:
// the liar is caught only when ONE player has more votes than any other (a tie catches nobody). A caught liar may still guess the
// real question among four (judged here): right = he steals the round. Points: liar not caught +3; caught but guesses right +2;
// caught and wrong: +2 for every civilian who voted for him. Rounds 3, 5 or 8 (host), then the standings.
// SECRET: who is the liar and the liar's question never leave this file except to the liar's own phone (his question only; never
// the word "liar"), and the admin LIVE view. Answers are shown without names until the round is over.
// Bank: lib/bugiardo-q.json, [type n|t|c, [true question x5 langs], [liar question x5], opts?] (opts = 4 x [5 langs], type c only).

const BG_MIN_PLAYERS = 3;
const BG_REVEAL_SECONDS = 25;
const BG_LANGS = ['it', 'en', 'es', 'fr', 'de'];

function bugiardoDefaultSettings(): array {
    return ['rounds' => 5];
}

function bugiardoSanitizeSettings(array $in, array $base): array {
    $s = array_merge(bugiardoDefaultSettings(), array_intersect_key($base, bugiardoDefaultSettings()));
    if (isset($in['rounds']) && in_array($in['rounds'], [3, 5, 8], true)) $s['rounds'] = $in['rounds'];
    return $s;
}

function bugiardoBank(): array {
    static $bank = null;
    if ($bank === null) $bank = json_decode((string)@file_get_contents(dirname(__DIR__, 2) . '/lib/bugiardo-q.json'), true) ?: [];
    return $bank;
}

function bugiardoLoad(PDO $db, int $roomId): ?array {
    $st = $db->prepare('SELECT state FROM bugiardo_games WHERE room_id = :r');
    $st->execute([':r' => $roomId]);
    $raw = $st->fetchColumn();
    return $raw ? json_decode($raw, true) : null;
}

function bugiardoSave(PDO $db, int $roomId, array $g): void {
    $db->prepare('INSERT INTO bugiardo_games (room_id, state, updated_at) VALUES (:r, :s, :t)
                  ON CONFLICT(room_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at')
       ->execute([':r' => $roomId, ':s' => json_encode($g), ':t' => time()]);
}

function bgActive(array $g): array {
    return array_values(array_filter($g['order'], fn($p) => !in_array($p, $g['gone'], true)));
}

function bgRow(array $g): ?array {
    return bugiardoBank()[$g['pair']] ?? null;
}

/** A typed answer for this kind of question, or null when it is not valid. Text: no tags, no control characters, 40 characters. */
function bgCleanAnswer(string $type, $raw) {
    if ($type === 'n' || $type === 'c') {
        if (is_string($raw) && preg_match('/^\d{1,2}$/', $raw)) $raw = (int)$raw;
        if (!is_int($raw)) return null;
        return $raw >= 0 && $raw <= ($type === 'n' ? 10 : 3) ? $raw : null;
    }
    if (!is_string($raw)) return null;
    $s = trim(preg_replace('/\s+/u', ' ', str_replace(['<', '>'], '', preg_replace('/[\x00-\x1f\x7f]/', ' ', $raw))) ?? '');
    $s = trim(textCut($s, 40));
    return $s === '' ? null : $s;
}

function bgEnd(array &$g, string $reason): void {
    $g['status'] = 'ended';
    $g['phase'] = 'ended';
    $rows = [];
    foreach ($g['order'] as $p) {
        if (in_array($p, $g['gone'], true)) continue;
        $rows[] = ['p' => $p, 'pts' => $g['scores'][(string)$p]];
    }
    usort($rows, fn($a, $b) => $b['pts'] <=> $a['pts']);
    $top = $rows ? $rows[0]['pts'] : 0;
    $g['result'] = ['reason' => $reason, 'rounds' => $g['round'], 'rows' => $rows,
        'winners' => $top > 0 ? array_values(array_map(fn($r) => $r['p'], array_filter($rows, fn($r) => $r['pts'] === $top))) : []];
}

function bgStartRound(array &$g): void {
    $bank = bugiardoBank();
    $free = array_values(array_diff(array_keys($bank), $g['used']));
    if (!$free) { $g['used'] = []; $free = array_keys($bank); }
    $act = bgActive($g);
    $cand = array_values(array_diff($act, [$g['prev_liar']]));
    $g['round']++;
    $g['pair'] = $free[random_int(0, count($free) - 1)];
    $g['used'][] = $g['pair'];
    $g['liar'] = $g['prev_liar'] = ($cand ?: $act)[random_int(0, count($cand ?: $act) - 1)];
    $g['answers'] = [];
    $g['shown'] = [];
    $g['votes'] = [];
    $g['guess'] = null;
    $g['last'] = null;
    $g['phase'] = 'answer';
    $g['next_at'] = null;
}

/** Everybody answered (or the host moved on): the answers go on the table in random order, without names. */
function bgToShow(array &$g): void {
    $vals = [];
    foreach ($g['answers'] as $p => $v) if (!in_array((int)$p, $g['gone'], true)) $vals[] = ['v' => $v];
    shuffle($vals);
    $g['shown'] = $vals;
    $g['phase'] = 'show';
}

/** Closes the round: kind escaped | caught | stolen | void. Fills `last` (public from now on) and the points. */
function bgReveal(array &$g, string $kind, ?int $pick = null): void {
    $liar = (int)$g['liar'];
    $row = bgRow($g);
    $pts = [];
    if ($kind === 'escaped') $pts[$liar] = 3;
    elseif ($kind === 'stolen') $pts[$liar] = 2;
    elseif ($kind === 'caught') foreach ($g['votes'] as $v => $t) if ($t === $liar && (int)$v !== $liar && !in_array((int)$v, $g['gone'], true)) $pts[(int)$v] = 2;
    foreach ($pts as $p => $v) $g['scores'][(string)$p] += $v;
    $g['last'] = ['kind' => $kind, 'liar' => $liar, 'type' => $row[0], 'true' => $row[1], 'fake' => $row[2], 'opts' => $row[3] ?? null,
        'answers' => (object)$g['answers'], 'votes' => (object)$g['votes'], 'pts' => (object)$pts,
        'pick' => $pick !== null && isset($g['guess']['opts'][$pick]) ? bugiardoBank()[$g['guess']['opts'][$pick]][1] : null];
    $g['phase'] = 'reveal';
    $g['next_at'] = microtime(true) + BG_REVEAL_SECONDS;
}

/** Counts the votes: one player with more than all the others is caught (he may then guess the real question); a tie catches nobody. */
function bgResolve(array &$g): void {
    $act = bgActive($g);
    $n = [];
    foreach ($g['votes'] as $v => $t) if (in_array((int)$v, $act, true) && in_array($t, $act, true) && (int)$v !== $t) $n[$t] = ($n[$t] ?? 0) + 1;
    $top = $n ? max($n) : 0;
    $tied = array_keys(array_filter($n, fn($c) => $c === $top));
    if ($n && count($tied) === 1 && (int)$tied[0] === (int)$g['liar']) {
        $bank = bugiardoBank();
        $type = $bank[$g['pair']][0];
        $others = array_values(array_filter(array_keys($bank), fn($i) => $i !== $g['pair'] && $bank[$i][0] === $type));
        shuffle($others);
        $opts = array_merge([$g['pair']], array_slice($others, 0, 3));
        shuffle($opts);
        $g['guess'] = ['opts' => $opts];
        $g['phase'] = 'guess';
        return;
    }
    bgReveal($g, 'escaped');
}

function bgAdvance(array &$g): void {
    if ($g['round'] >= $g['rules']['rounds']) { bgEnd($g, 'done'); return; }
    bgStartRound($g);
}

/** Advances what depends on the others. Returns true when the state changed. */
function bugiardoTick(array &$g, ?float $now = null): bool {
    if ($g['status'] !== 'play') return false;
    $now = $now ?? microtime(true);
    $act = bgActive($g);
    switch ($g['phase']) {
        case 'answer':
            if (!array_diff($act, array_map('intval', array_keys($g['answers'])))) { bgToShow($g); return true; }
            return false;
        case 'vote':
            if (!array_diff($act, array_map('intval', array_keys($g['votes'])))) { bgResolve($g); return true; }
            return false;
        case 'guess':
            if (in_array((int)$g['liar'], $g['gone'], true)) { bgReveal($g, 'caught'); return true; }
            return false;
        case 'reveal':
            if ($now >= $g['next_at']) { bgAdvance($g); return true; }
            return false;
    }
    return false;
}

function bugiardoStart(PDO $db, array $room): ?string {
    $s = bugiardoSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $players = spiaPlayers($db, (int)$room['id']);
    if (count($players) < BG_MIN_PLAYERS) return 'need_players_bugiardo';
    if (!bugiardoBank()) return 'no_questions';
    $order = array_map(fn($p) => (int)$p['id'], $players);
    $prev = bugiardoLoad($db, (int)$room['id']);
    $g = [
        'match' => (int)($prev['match'] ?? 0) + 1, 'status' => 'play', 'phase' => 'answer', 'rules' => $s, 'order' => $order, 'gone' => [],
        'scores' => array_fill_keys(array_map('strval', $order), 0), 'round' => 0, 'used' => $prev['used'] ?? [], 'prev_liar' => 0,
        'pair' => 0, 'liar' => 0, 'answers' => [], 'shown' => [], 'votes' => [], 'guess' => null, 'last' => null, 'next_at' => null, 'result' => null,
    ];
    bgStartRound($g);
    bugiardoSave($db, (int)$room['id'], $g);
    return null;
}

function bugiardoPlayerLeft(array &$g, int $pid): void {
    if ($g['status'] !== 'play' || !in_array($pid, $g['order'], true) || in_array($pid, $g['gone'], true)) return;
    $g['gone'][] = $pid;
    if (count(bgActive($g)) < BG_MIN_PLAYERS) { bgEnd($g, 'too_few'); return; }
    unset($g['answers'][(string)$pid], $g['votes'][(string)$pid]);
    $g['votes'] = array_filter($g['votes'], fn($t) => $t !== $pid);
    if ($g['phase'] !== 'reveal' && (int)$g['liar'] === $pid) bgReveal($g, 'void');
    else bugiardoTick($g);
}

/** Room actions for the game. Returns true (handled), null (not one of its actions) or an error code. */
function bugiardoHandle(PDO $db, array $room, array $device, bool $isHost, array $in, string $action) {
    $g = bugiardoLoad($db, (int)$room['id']);
    if ($g && bugiardoTick($g)) bugiardoSave($db, (int)$room['id'], $g);
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
            $new = bugiardoSanitizeSettings(is_array($in['settings'] ?? null) ? $in['settings'] : [], json_decode($room['settings'], true) ?: []);
            $db->prepare('UPDATE spia_rooms SET settings = :s WHERE id = :id')->execute([':s' => json_encode($new), ':id' => $room['id']]);
            return true;
        case 'start':
            if (!$isHost) return 'host_only';
            if ($playing) return 'round_running';
            return bugiardoStart($db, $room) ?? true;
        case 'end':
            if (!$isHost) return 'host_only';
            if (!$playing) return 'no_round';
            bgEnd($g, 'host_ended');
            break;
        case 'next':   // the host moves things along: answers are in, to the vote, count the votes, skip the guess, next round
            if (!$isHost) return 'host_only';
            if (!$playing) return 'not_now';
            if ($g['phase'] === 'answer') { if (!$g['answers']) return 'not_now'; bgToShow($g); }
            elseif ($g['phase'] === 'show') $g['phase'] = 'vote';
            elseif ($g['phase'] === 'vote') bgResolve($g);
            elseif ($g['phase'] === 'guess') bgReveal($g, 'caught');
            else bgAdvance($g);
            break;
        case 'answer':
            if (!$playing || $g['phase'] !== 'answer') return 'not_now';
            $pid = $own($in['player_id'] ?? 0);
            if ($pid === null) return 'not_your_player';
            if (!in_array($pid, bgActive($g), true)) return 'you_are_out';
            if (isset($g['answers'][(string)$pid])) return 'already_answered';
            $v = bgCleanAnswer(bgRow($g)[0], $in['value'] ?? null);
            if ($v === null) return 'bad_answer';
            $g['answers'][(string)$pid] = $v;
            break;
        case 'vote':
            if (!$playing || $g['phase'] !== 'vote') return 'not_now';
            $pid = $own($in['player_id'] ?? 0);
            if ($pid === null) return 'not_your_player';
            if (!in_array($pid, bgActive($g), true)) return 'you_are_out';
            if (isset($g['votes'][(string)$pid])) return 'already_voted';
            $to = (int)($in['target'] ?? 0);
            if ($to === $pid || !in_array($to, bgActive($g), true)) return 'bad_target';
            $g['votes'][(string)$pid] = $to;
            break;
        case 'guess':
            if (!$playing || $g['phase'] !== 'guess') return 'not_now';
            $pid = $own($in['player_id'] ?? 0);
            if ($pid === null) return 'not_your_player';
            if ($pid !== (int)$g['liar']) return 'not_liar';
            $pick = $in['pick'] ?? null;
            if (!is_int($pick) || !isset($g['guess']['opts'][$pick])) return 'bad_answer';
            bgReveal($g, $g['guess']['opts'][$pick] === $g['pair'] ? 'stolen' : 'caught', $pick);
            break;
        default:
            return null;
    }
    bugiardoTick($g);
    bugiardoSave($db, (int)$room['id'], $g);
    return true;
}

/** What one phone may see: the question of ITS OWN players only (the liar's differs, nothing says so), the answers without names. */
function bugiardoView(PDO $db, array $room, array $device, bool $adminSession): array {
    $view = spiaView($db, $room, $device, $adminSession);
    $view['game'] = 'bugiardo';
    $view['settings'] = bugiardoSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $g = bugiardoLoad($db, (int)$room['id']);
    $view['bugiardo'] = null;
    if (!$g) return $view;
    $now = microtime(true);
    $mine = array_map(fn($p) => (int)$p['id'], array_filter($view['players'], fn($p) => $p['device_id'] === (int)$device['id']));
    $play = $g['status'] === 'play';
    $act = bgActive($g);
    $row = $play ? bgRow($g) : null;
    $ph = $g['phase'];
    $me = [];
    foreach (array_values(array_intersect($mine, $g['order'])) as $pid) {
        $liar = $play && (int)$g['liar'] === $pid;
        $me[] = [
            'player_id' => $pid, 'alive' => in_array($pid, $act, true), 'answered' => isset($g['answers'][(string)$pid]), 'voted' => isset($g['votes'][(string)$pid]),
            'question' => $row && in_array($ph, ['answer', 'show', 'vote'], true) ? $row[$liar ? 2 : 1] : null,   // the one question this player got
            'guesser' => $play && $ph === 'guess' && $liar,
            'options' => $play && $ph === 'guess' && $liar ? array_map(fn($i) => bugiardoBank()[$i][1], $g['guess']['opts']) : null,
        ];
    }
    $view['bugiardo'] = [
        'match' => $g['match'], 'status' => $g['status'], 'phase' => $ph, 'round' => $g['round'], 'total' => $g['rules']['rounds'],
        'order' => $g['order'], 'active' => $act, 'scores' => $g['scores'], 'rules' => $g['rules'],
        'qtype' => $row ? $row[0] : null, 'opts' => $row ? ($row[3] ?? null) : null,
        'answered' => $ph === 'answer' ? array_map('intval', array_keys($g['answers'])) : [],
        'shown' => in_array($ph, ['show', 'vote', 'guess'], true) ? $g['shown'] : [],
        'voted' => $ph === 'vote' ? array_map('intval', array_keys($g['votes'])) : [],
        'next_left' => $ph === 'reveal' ? max(0, round($g['next_at'] - $now, 1)) : null,
        'last' => in_array($ph, ['reveal', 'ended'], true) ? $g['last'] : null,
        'result' => $g['result'], 'me' => $me,
    ];
    return $view;
}

/** For the admin LIVE panel: the two questions, the liar, the answers with names, the votes. */
function bugiardoLiveInfo(PDO $db, int $roomId): ?array {
    $g = bugiardoLoad($db, $roomId);
    if (!$g) return null;
    $row = $g['status'] === 'play' ? bgRow($g) : null;
    return [
        'status' => $g['status'], 'phase' => $g['phase'], 'round' => $g['round'], 'liar' => $row ? $g['liar'] : null,
        'type' => $row[0] ?? null, 'true' => $row[1] ?? null, 'fake' => $row[2] ?? null, 'opts' => $row[3] ?? null,
        'answers' => (object)$g['answers'], 'votes' => (object)$g['votes'], 'scores' => $g['scores'],
    ];
}
