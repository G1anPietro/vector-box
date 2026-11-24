<?php
// public/api/obbligo_lib.php — "Obbligo o verità" (truth or dare), on the shared rooms of spia.php (game "obbligo").
// One JSON state per room (table obbligo_games), changed inside the caller's BEGIN IMMEDIATE transaction.
//
// Turns come from a sequence drawn by the server (the seating order shuffled once, repeated for every lap), so everybody plays
// exactly the same number of turns. The player "in the spotlight" picks TRUTH or DARE from their own phone and gets a card from
// lib/obbligo-q.json. They may swap the card once per turn and may PASS once per match (the turn ends, no point). When they tap
// "done" everybody else votes done / not valid in secret; the SERVER judges: a strict majority of "done" scores a point (a tie does
// not). Cards: {"t": [[cat, it, en, es, fr, de], ...], "d": [...]}, cat 0 calm | 1 friends | 2 spicy (off by default).

const OBBLIGO_MIN_PLAYERS = 3;
const OBBLIGO_VOTE_SECONDS = 30;
const OBBLIGO_REVEAL_SECONDS = 8;
const OBBLIGO_LANGS = ['it', 'en', 'es', 'fr', 'de'];

function obbligoDefaultSettings(): array {
    return ['laps' => 2, 'calm' => true, 'friends' => true, 'spicy' => false];
}

function obbligoSanitizeSettings(array $in, array $base): array {
    $s = array_merge(obbligoDefaultSettings(), array_intersect_key($base, obbligoDefaultSettings()));
    if (isset($in['laps']) && in_array($in['laps'], [1, 2, 3], true)) $s['laps'] = $in['laps'];
    foreach (['calm', 'friends', 'spicy'] as $k) {
        if (isset($in[$k]) && is_bool($in[$k])) $s[$k] = $in[$k];
        else $s[$k] = (bool)$s[$k];
    }
    if (!$s['calm'] && !$s['friends'] && !$s['spicy']) $s['calm'] = true;   // at least one category
    return $s;
}

function obbligoBank(): array {
    static $bank = null;
    if ($bank === null) $bank = json_decode((string)@file_get_contents(dirname(__DIR__, 2) . '/lib/obbligo-q.json'), true) ?: [];
    return $bank;
}

function obbligoLoad(PDO $db, int $roomId): ?array {
    $st = $db->prepare('SELECT state FROM obbligo_games WHERE room_id = :r');
    $st->execute([':r' => $roomId]);
    $raw = $st->fetchColumn();
    return $raw ? json_decode($raw, true) : null;
}

function obbligoSave(PDO $db, int $roomId, array $g): void {
    $db->prepare('INSERT INTO obbligo_games (room_id, state, updated_at) VALUES (:r, :s, :t)
                  ON CONFLICT(room_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at')
       ->execute([':r' => $roomId, ':s' => json_encode($g), ':t' => time()]);
}

function obbligoEvent(array &$g, array $ev): void {
    $ev['id'] = ++$g['event_seq'];
    $ev['turn'] = $g['ti'];
    $g['events'][] = $ev;
    if (count($g['events']) > 40) $g['events'] = array_slice($g['events'], -40);
}

function obbligoActive(array $g): array {
    return array_values(array_diff($g['order'], $g['gone']));
}

function obbligoEnd(array &$g, string $reason): void {
    $g['status'] = 'ended';
    $g['phase'] = 'ended';
    $rows = [];
    foreach (obbligoActive($g) as $p) {
        $s = $g['stats'][(string)$p];
        $rows[] = ['p' => $p, 'pts' => $s['pts'], 'done' => $s['done'], 'fail' => $s['fail'], 'passes' => $s['passes'], 'turns' => $s['turns']];
    }
    usort($rows, fn($a, $b) => [$b['pts'], $a['fail']] <=> [$a['pts'], $b['fail']]);
    $top = $rows ? $rows[0]['pts'] : 0;
    $g['result'] = ['reason' => $reason, 'turns' => $g['ti'], 'rows' => $rows,
                    'winners' => $top > 0 ? array_values(array_map(fn($r) => $r['p'], array_filter($rows, fn($r) => $r['pts'] === $top))) : []];
    obbligoEvent($g, ['t' => 'end']);
}

/** Draw a card of the kind ('t' truth | 'd' dare') from the enabled categories, never twice in a match until the pile is used up. */
function obbligoDraw(array &$g, string $k): void {
    $bank = obbligoBank()[$k] ?? [];
    $cats = [];
    foreach (['calm' => 0, 'friends' => 1, 'spicy' => 2] as $name => $c) if (!empty($g['rules'][$name])) $cats[] = $c;
    $used = $g['used'][$k] ?? [];
    $free = fn() => array_values(array_filter(array_keys($bank), fn($i) => in_array($bank[$i][0], $cats, true) && !in_array($i, $used, true)));
    $cands = $free();
    if (!$cands) {
        $used = array_values(array_filter($used, fn($i) => !in_array($bank[$i][0] ?? -1, $cats, true)));
        $cands = $free();
    }
    if (!$cands) $cands = array_keys($bank);
    $i = $cands[random_int(0, count($cands) - 1)];
    $used[] = $i;
    $g['used'][$k] = $used;
    $g['card'] = ['k' => $k, 'i' => $i];
}

/** Next turn of the sequence (leavers are skipped), or the end of the match. */
function obbligoBeginTurn(array &$g): void {
    while ($g['ti'] < count($g['seq']) && in_array($g['seq'][$g['ti']], $g['gone'], true)) $g['ti']++;
    if ($g['ti'] >= count($g['seq'])) { obbligoEnd($g, 'finished'); return; }
    $g['cur'] = $g['seq'][$g['ti']];
    $g['stats'][(string)$g['cur']]['turns']++;
    $g['phase'] = 'choose';
    $g['card'] = null;
    $g['swapped'] = false;
    $g['votes'] = [];
    $g['deadline'] = null;
    $g['reveal'] = null;
    $g['next_at'] = null;
    obbligoEvent($g, ['t' => 'turn', 'p' => $g['cur']]);
}

function obbligoNextTurn(array &$g): void {
    $g['ti']++;
    obbligoBeginTurn($g);
}

/** Everybody except the player in the spotlight votes. */
function obbligoVoters(array $g): array {
    return array_values(array_filter(obbligoActive($g), fn($p) => $p !== (int)$g['cur']));
}

function obbligoResolve(array &$g, ?float $now = null): void {
    $now = $now ?? microtime(true);
    $voters = obbligoVoters($g);
    $n = ['ok' => 0, 'no' => 0];
    foreach ($g['votes'] as $pid => $v) if (in_array((int)$pid, $voters, true) && isset($n[$v])) $n[$v]++;
    $k = (string)$g['cur'];
    if ($n['ok'] + $n['no'] === 0) $result = 'none';
    elseif ($n['ok'] > $n['no']) $result = 'done';
    else $result = 'fail';
    if ($result === 'done') { $g['stats'][$k]['pts']++; $g['stats'][$k]['done']++; }
    else $g['stats'][$k]['fail']++;
    obbligoEvent($g, ['t' => $result, 'p' => $g['cur']]);
    $g['reveal'] = ['ok' => $n['ok'], 'no' => $n['no'], 'result' => $result, 'last' => $g['ti'] + 1 >= count($g['seq'])];
    $g['phase'] = 'reveal';
    $g['deadline'] = null;
    $g['next_at'] = $now + OBBLIGO_REVEAL_SECONDS;
}

function obbligoTick(array &$g, ?float $now = null): bool {
    if ($g['status'] !== 'play') return false;
    $now = $now ?? microtime(true);
    if ($g['phase'] === 'vote') {
        $voters = array_map('strval', obbligoVoters($g));
        $all = !array_diff($voters, array_keys($g['votes']));
        if ($now >= $g['deadline'] || $all) { obbligoResolve($g, $now); return true; }
    } elseif ($g['phase'] === 'reveal' && $now >= $g['next_at']) {
        obbligoNextTurn($g);
        return true;
    }
    return false;
}

function obbligoStart(PDO $db, array $room): ?string {
    $s = obbligoSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $players = spiaPlayers($db, (int)$room['id']);
    if (count($players) < OBBLIGO_MIN_PLAYERS) return 'need_players_obbligo';
    $bank = obbligoBank();
    if (empty($bank['t']) || empty($bank['d'])) return 'no_questions';
    $order = array_map(fn($p) => (int)$p['id'], $players);
    $lap = $order;
    shuffle($lap);   // the seating order is drawn once; every lap repeats it, so all play the same number of turns
    $prev = obbligoLoad($db, (int)$room['id']);
    $g = [
        'match' => (int)($prev['match'] ?? 0) + 1,
        'status' => 'play', 'phase' => 'choose', 'rules' => $s, 'order' => $order, 'gone' => [],
        'seq' => array_merge(...array_fill(0, $s['laps'], $lap)), 'ti' => 0, 'cur' => null,
        'stats' => array_fill_keys(array_map('strval', $order), ['pts' => 0, 'done' => 0, 'fail' => 0, 'passes' => 0, 'turns' => 0, 'pass_used' => false]),
        'used' => $prev['used'] ?? ['t' => [], 'd' => []], 'card' => null, 'swapped' => false, 'votes' => [], 'deadline' => null,
        'reveal' => null, 'next_at' => null, 'events' => [], 'event_seq' => (int)($prev['event_seq'] ?? 0), 'result' => null,
    ];
    obbligoEvent($g, ['t' => 'start']);
    obbligoBeginTurn($g);
    obbligoSave($db, (int)$room['id'], $g);
    return null;
}

function obbligoPlayerLeft(array &$g, int $pid): void {
    if ($g['status'] !== 'play' || !in_array($pid, $g['order'], true) || in_array($pid, $g['gone'], true)) return;
    $g['gone'][] = $pid;
    unset($g['votes'][(string)$pid]);
    obbligoEvent($g, ['t' => 'left', 'p' => $pid]);
    if (count(obbligoActive($g)) < OBBLIGO_MIN_PLAYERS) { obbligoEnd($g, 'too_few'); return; }
    if ((int)$g['cur'] === $pid && in_array($g['phase'], ['choose', 'card', 'vote'], true)) obbligoNextTurn($g);   // the spotlight goes on
}

/** Room actions for the game. Returns true (handled), null (not one of its actions) or an error code. */
function obbligoHandle(PDO $db, array $room, array $device, bool $isHost, array $in, string $action) {
    $g = obbligoLoad($db, (int)$room['id']);
    if ($g && obbligoTick($g)) obbligoSave($db, (int)$room['id'], $g);
    $playing = $g && $g['status'] === 'play';
    $own = function ($pid) use ($db, $device): ?int {
        $st = $db->prepare('SELECT id FROM spia_players WHERE id = :id AND device_id = :d AND removed = 0');
        $st->execute([':id' => (int)$pid, ':d' => $device['id']]);
        $id = $st->fetchColumn();
        return $id === false ? null : (int)$id;
    };
    // the player in the spotlight, on this phone
    $turnOf = function () use ($own, $in, &$g, $playing) {
        if (!$playing) return 'not_now';
        $pid = $own($in['player_id'] ?? 0);
        if ($pid === null) return 'not_your_player';
        if ($pid !== (int)$g['cur']) return 'not_your_turn';
        return $pid;
    };

    switch ($action) {
        case 'settings':
            if (!$isHost) return 'host_only';
            $new = obbligoSanitizeSettings(is_array($in['settings'] ?? null) ? $in['settings'] : [], json_decode($room['settings'], true) ?: []);
            $db->prepare('UPDATE spia_rooms SET settings = :s WHERE id = :id')->execute([':s' => json_encode($new), ':id' => $room['id']]);
            return true;
        case 'start':
            if (!$isHost) return 'host_only';
            if ($playing) return 'round_running';
            return obbligoStart($db, $room) ?? true;
        case 'end':
            if (!$isHost) return 'host_only';
            if (!$playing) return 'no_round';
            obbligoEnd($g, 'host_ended');
            break;
        case 'next':
            if (!$isHost) return 'host_only';
            if (!$playing || $g['phase'] !== 'reveal') return 'not_now';
            obbligoNextTurn($g);
            break;
        case 'skip':   // host tool: a stuck or absent player loses the turn, no point
            if (!$isHost) return 'host_only';
            if (!$playing || !in_array($g['phase'], ['choose', 'card', 'vote'], true)) return 'not_now';
            obbligoEvent($g, ['t' => 'skip', 'p' => $g['cur']]);
            obbligoNextTurn($g);
            break;
        case 'choose':
            $pid = $turnOf();
            if (is_string($pid)) return $pid;
            if ($g['phase'] !== 'choose') return 'not_now';
            $k = $in['kind'] ?? null;
            if ($k !== 't' && $k !== 'd') return 'bad_kind';
            obbligoDraw($g, $k);
            $g['phase'] = 'card';
            obbligoEvent($g, ['t' => $k === 't' ? 'truth' : 'dare', 'p' => $pid]);
            break;
        case 'swap':
            $pid = $turnOf();
            if (is_string($pid)) return $pid;
            if ($g['phase'] !== 'card') return 'not_now';
            if ($g['swapped']) return 'swap_used';
            obbligoDraw($g, $g['card']['k']);
            $g['swapped'] = true;
            obbligoEvent($g, ['t' => 'swap', 'p' => $pid]);
            break;
        case 'pass':
            $pid = $turnOf();
            if (is_string($pid)) return $pid;
            if (!in_array($g['phase'], ['choose', 'card'], true)) return 'not_now';
            if ($g['stats'][(string)$pid]['pass_used']) return 'pass_used';
            $g['stats'][(string)$pid]['pass_used'] = true;
            $g['stats'][(string)$pid]['passes']++;
            obbligoEvent($g, ['t' => 'pass', 'p' => $pid]);
            obbligoNextTurn($g);
            break;
        case 'done':
            $pid = $turnOf();
            if (is_string($pid)) return $pid;
            if ($g['phase'] !== 'card') return 'not_now';
            $g['phase'] = 'vote';
            $g['votes'] = [];
            $g['deadline'] = microtime(true) + OBBLIGO_VOTE_SECONDS;
            obbligoEvent($g, ['t' => 'vote', 'p' => $pid]);
            break;
        case 'vote':
            if (!$playing || $g['phase'] !== 'vote') return 'not_now';
            $pid = $own($in['player_id'] ?? 0);
            if ($pid === null) return 'not_your_player';
            if (!in_array($pid, obbligoVoters($g), true)) return $pid === (int)$g['cur'] ? 'not_your_turn' : 'you_are_out';
            if (isset($g['votes'][(string)$pid])) return 'already_voted';
            $v = $in['v'] ?? null;
            if ($v !== 'ok' && $v !== 'no') return 'bad_vote';
            if (microtime(true) > $g['deadline'] + 0.5) return 'not_now';   // half a second of grace for the network
            $g['votes'][(string)$pid] = $v;
            obbligoTick($g);
            break;
        default:
            return null;
    }
    obbligoSave($db, (int)$room['id'], $g);
    return true;
}

/** What one phone may see. Never who voted what; the counts only at the reveal. */
function obbligoView(PDO $db, array $room, array $device, bool $adminSession): array {
    $view = spiaView($db, $room, $device, $adminSession);
    $view['game'] = 'obbligo';
    $view['settings'] = obbligoSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $g = obbligoLoad($db, (int)$room['id']);
    $view['obbligo'] = null;
    if (!$g) return $view;
    $now = microtime(true);
    $mine = array_map(fn($p) => (int)$p['id'], array_filter($view['players'], fn($p) => $p['device_id'] === (int)$device['id']));
    $voters = $g['status'] === 'play' ? obbligoVoters($g) : [];
    $me = [];
    foreach (array_values(array_intersect($mine, $g['order'])) as $pid) {
        $me[] = ['player_id' => $pid, 'active' => !in_array($pid, $g['gone'], true), 'current' => $g['status'] === 'play' && (int)$g['cur'] === $pid,
                 'can_vote' => in_array($pid, $voters, true), 'voted' => isset($g['votes'][(string)$pid]), 'pass_used' => (bool)$g['stats'][(string)$pid]['pass_used']];
    }
    $card = null;
    if ($g['card']) {
        $row = obbligoBank()[$g['card']['k']][$g['card']['i']] ?? null;
        $card = $row ? ['k' => $g['card']['k'], 'cat' => $row[0], 'text' => array_combine(OBBLIGO_LANGS, array_slice($row, 1))] : null;
    }
    $view['obbligo'] = [
        'match' => $g['match'], 'status' => $g['status'], 'phase' => $g['phase'], 'turn' => $g['ti'] + 1, 'turns' => count($g['seq']),
        'lap' => intdiv($g['ti'], max(1, count($g['order']))) + 1, 'laps' => $g['rules']['laps'],
        'order' => $g['order'], 'active' => obbligoActive($g), 'rules' => $g['rules'],
        'cur' => $g['status'] === 'play' ? $g['cur'] : null, 'card' => $card, 'swapped' => $g['swapped'],
        'pts' => array_map(fn($s) => $s['pts'], $g['stats']),
        'pass_used' => array_map(fn($s) => (bool)$s['pass_used'], $g['stats']),
        'voted' => array_map('intval', array_keys($g['votes'])),
        'left' => $g['phase'] === 'vote' ? max(0, round($g['deadline'] - $now, 1)) : null,
        'reveal' => $g['reveal'],
        'next_left' => $g['phase'] === 'reveal' ? max(0, round($g['next_at'] - $now, 1)) : null,
        'events' => $g['events'], 'result' => $g['result'], 'me' => $me,
    ];
    return $view;
}

/** For the admin LIVE panel: the admin sees who voted what while the vote is open. */
function obbligoLiveInfo(PDO $db, int $roomId): ?array {
    $g = obbligoLoad($db, $roomId);
    if (!$g) return null;
    $row = $g['card'] ? (obbligoBank()[$g['card']['k']][$g['card']['i']] ?? null) : null;
    return [
        'status' => $g['status'], 'phase' => $g['phase'], 'turn' => $g['ti'] + 1, 'turns' => count($g['seq']),
        'cur' => $g['status'] === 'play' ? $g['cur'] : null,
        'kind' => $g['card']['k'] ?? null, 'card' => $row ? $row[1] : null,
        'votes' => $g['votes'],
        'points' => array_map(fn($s) => $s['pts'], $g['stats']),
    ];
}
