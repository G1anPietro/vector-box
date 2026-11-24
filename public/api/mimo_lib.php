<?php
// public/api/mimo_lib.php — "Mimo" (team charades), on the shared rooms of spia.php (game "mimo").
// One JSON state per room (table mimo_games), changed inside the caller's BEGIN IMMEDIATE transaction.
//
// Two or three teams. In turn, one "mime" of the team on stage gets a word on their own phone (it is NEVER put in the view of any
// other phone) and makes their team guess it with gestures only, before the time runs out (30/60/90 s). "Guessed" scores a point and
// gives the next word at once; "Pass" (3 per turn) swaps the word and scores nothing. The SERVER keeps the time: it stores the
// deadline, closes the turn when it is over and moves to the next team; the clients only show a countdown from the seconds left that
// the server sends. After N rounds (everybody on stage N times) the team with most points wins.
// Words: lib/mimo-q.json {"film": {"easy": [[it,en,es,fr,de]...], "hard": [...]}, "animals": ..., "actions": ..., "jobs": ..., "sports": ...}.

const MIMO_LANGS = ['it', 'en', 'es', 'fr', 'de'];
const MIMO_CATS = ['film', 'animals', 'actions', 'jobs', 'sports'];
const MIMO_PASSES = 3;

function mimoDefaultSettings(): array {
    return ['teams' => 2, 'rounds' => 3, 'secs' => 60, 'cat' => 'mix', 'level' => 'mix', 'assign' => 'random', 'map' => []];
}

function mimoSanitizeSettings(array $in, array $base): array {
    $s = array_merge(mimoDefaultSettings(), array_intersect_key($base, mimoDefaultSettings()));
    if (isset($in['teams']) && in_array($in['teams'], [2, 3], true)) $s['teams'] = $in['teams'];
    if (isset($in['rounds']) && in_array($in['rounds'], [2, 3, 5], true)) $s['rounds'] = $in['rounds'];
    if (isset($in['secs']) && in_array($in['secs'], [30, 60, 90], true)) $s['secs'] = $in['secs'];
    if (isset($in['cat']) && ($in['cat'] === 'mix' || in_array($in['cat'], MIMO_CATS, true))) $s['cat'] = $in['cat'];
    if (isset($in['level']) && in_array($in['level'], ['easy', 'hard', 'mix'], true)) $s['level'] = $in['level'];
    if (isset($in['assign']) && in_array($in['assign'], ['random', 'host'], true)) $s['assign'] = $in['assign'];
    // the team map is only changed by the host's "team" action, never through the settings form
    $map = [];
    foreach (is_array($s['map']) ? $s['map'] : [] as $pid => $t) {
        if (is_int($t) && $t >= 0 && $t < $s['teams']) $map[(string)(int)$pid] = $t;
    }
    $s['map'] = $map;
    return $s;
}

function mimoBank(): array {
    static $bank = null;
    if ($bank === null) $bank = json_decode((string)@file_get_contents(dirname(__DIR__, 2) . '/lib/mimo-q.json'), true) ?: [];
    return $bank;
}

function mimoLoad(PDO $db, int $roomId): ?array {
    $st = $db->prepare('SELECT state FROM mimo_games WHERE room_id = :r');
    $st->execute([':r' => $roomId]);
    $raw = $st->fetchColumn();
    return $raw ? json_decode($raw, true) : null;
}

function mimoSave(PDO $db, int $roomId, array $g): void {
    $db->prepare('INSERT INTO mimo_games (room_id, state, updated_at) VALUES (:r, :s, :t)
                  ON CONFLICT(room_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at')
       ->execute([':r' => $roomId, ':s' => json_encode($g), ':t' => time()]);
}

function mimoEvent(array &$g, array $ev): void {
    $ev['id'] = ++$g['event_seq'];
    $ev['turn'] = $g['turn'];
    $g['events'][] = $ev;
    if (count($g['events']) > 40) $g['events'] = array_slice($g['events'], -40);
}

/** Players of a team who are still here. */
function mimoMembers(array $g, int $team): array {
    return array_values(array_filter($g['order'], fn($p) => $g['team'][(string)$p] === $team && !in_array($p, $g['gone'], true)));
}

function mimoText(array $ref): ?array {
    $row = mimoBank()[$ref[0]][$ref[1]][$ref[2]] ?? null;
    return $row ? array_combine(MIMO_LANGS, $row) : null;
}

function mimoEnd(array &$g, string $reason): void {
    $g['status'] = 'ended';
    $g['phase'] = 'ended';
    $g['ends_at'] = null;
    $g['cur'] = null;
    $best = max($g['score']);
    $top = array_keys(array_filter($g['score'], fn($x) => $x === $best));
    $rows = [];
    foreach ($g['score'] as $t => $pts) $rows[] = ['team' => $t, 'score' => $pts, 'players' => array_values(array_filter($g['order'], fn($p) => $g['team'][(string)$p] === $t))];
    usort($rows, fn($a, $b) => $b['score'] <=> $a['score']);
    $g['result'] = ['reason' => $reason, 'turns' => $g['turn'], 'winner' => count($top) === 1 && $reason === 'done' ? $top[0] : null, 'rows' => $rows];
    mimoEvent($g, ['t' => 'end']);
}

/** The turn $g['turn'] opens in the "ready" phase: the next mime of that team must press Start. */
function mimoBeginTurn(array &$g): void {
    $team = $g['turn'] % $g['rules']['teams'];
    $members = mimoMembers($g, $team);
    if (!$members) { mimoEnd($g, 'too_few'); return; }
    $g['mime'] = $members[$g['mi'][$team]++ % count($members)];
    $g['phase'] = 'ready';
    $g['ends_at'] = null;
    $g['cur'] = null;
    mimoEvent($g, ['t' => 'turn', 'team' => $team, 'p' => $g['mime']]);
}

function mimoNextTurn(array &$g): void {
    $g['turn']++;
    if ($g['turn'] >= $g['total']) { mimoEnd($g, 'done'); return; }
    mimoBeginTurn($g);
}

/** Draws a word (never the same one twice until the pile of that category and level is used up). */
function mimoDraw(array &$g): void {
    $bank = mimoBank();
    $cat = $g['rules']['cat'] === 'mix' ? MIMO_CATS[random_int(0, count(MIMO_CATS) - 1)] : $g['rules']['cat'];
    $lv = $g['rules']['level'] === 'mix' ? ['easy', 'hard'][random_int(0, 1)] : $g['rules']['level'];
    $pool = $bank[$cat][$lv];
    $free = array_values(array_filter(array_keys($pool), fn($i) => !in_array("$cat.$lv.$i", $g['used'], true)));
    if (!$free) {
        $g['used'] = array_values(array_filter($g['used'], fn($u) => strpos($u, "$cat.$lv.") !== 0));
        $free = array_keys($pool);
    }
    $i = $free[random_int(0, count($free) - 1)];
    $g['used'][] = "$cat.$lv.$i";
    $g['cur']['word'] = [$cat, $lv, $i];
}

function mimoEndTurn(array &$g): void {
    $c = $g['cur'] ?? ['got' => [], 'skipped' => 0];
    $team = $g['turn'] % $g['rules']['teams'];
    $g['last'] = ['team' => $team, 'p' => $g['mime'], 'got' => $c['got'], 'skipped' => $c['skipped']];
    mimoEvent($g, ['t' => 'timeup', 'team' => $team, 'n' => count($c['got'])]);
    mimoNextTurn($g);
}

/** Advances the clock-driven part. Returns true when the state changed (the caller saves it). */
function mimoTick(array &$g, ?float $now = null): bool {
    if ($g['status'] !== 'play') return false;
    $now = $now ?? microtime(true);
    if ($g['phase'] === 'play' && $now >= $g['ends_at']) { mimoEndTurn($g); return true; }
    return false;
}

function mimoStart(PDO $db, array $room): ?string {
    $s = mimoSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $players = spiaPlayers($db, (int)$room['id']);
    $bank = mimoBank();
    if (!$bank) return 'no_questions';
    $order = array_map(fn($p) => (int)$p['id'], $players);
    $nt = $s['teams'];
    $one = count(array_unique(array_map(fn($p) => (int)$p['device_id'], $players))) === 1;   // one shared phone: a team may be a single player
    $minTeam = $one ? 1 : 2;
    if (count($order) < $nt * $minTeam) return 'need_players_mimo';
    $team = [];
    if ($s['assign'] === 'host') {
        foreach ($order as $p) if (isset($s['map'][(string)$p])) $team[(string)$p] = $s['map'][(string)$p];
        foreach ($order as $p) {                                    // newcomers the host did not place go to the smallest team
            if (isset($team[(string)$p])) continue;
            $cnt = array_fill(0, $nt, 0);
            foreach ($team as $t) $cnt[$t]++;
            $team[(string)$p] = array_search(min($cnt), $cnt, true);
        }
    } else {
        $ids = $order;
        shuffle($ids);
        foreach ($ids as $k => $p) $team[(string)$p] = $k % $nt;
    }
    $cnt = array_fill(0, $nt, 0);
    foreach ($team as $t) $cnt[$t]++;
    if (min($cnt) < $minTeam) return $s['assign'] === 'host' ? 'bad_teams' : 'need_players_mimo';
    $prev = mimoLoad($db, (int)$room['id']);
    $g = [
        'match' => (int)($prev['match'] ?? 0) + 1, 'status' => 'play', 'phase' => 'ready', 'rules' => $s, 'order' => $order, 'gone' => [],
        'team' => $team, 'score' => array_fill(0, $nt, 0), 'turn' => 0, 'total' => $s['rounds'] * $nt, 'mi' => array_fill(0, $nt, 0), 'mime' => null,
        'cur' => null, 'ends_at' => null, 'last' => null, 'used' => $prev['used'] ?? [], 'events' => [], 'event_seq' => (int)($prev['event_seq'] ?? 0), 'result' => null,
    ];
    mimoEvent($g, ['t' => 'start']);
    mimoBeginTurn($g);
    mimoSave($db, (int)$room['id'], $g);
    return null;
}

function mimoPlayerLeft(array &$g, int $pid): void {
    if ($g['status'] !== 'play' || !in_array($pid, $g['order'], true) || in_array($pid, $g['gone'], true)) return;
    $g['gone'][] = $pid;
    mimoEvent($g, ['t' => 'left', 'p' => $pid]);
    for ($t = 0; $t < $g['rules']['teams']; $t++) if (!mimoMembers($g, $t)) { mimoEnd($g, 'too_few'); return; }
    if ((int)$g['mime'] === $pid) {                                 // the mime left: another one of the team takes the stage, the time keeps running
        $members = mimoMembers($g, $g['turn'] % $g['rules']['teams']);
        $g['mime'] = $members[$g['mi'][$g['turn'] % $g['rules']['teams']]++ % count($members)];
    }
}

/** Room actions for the game. Returns true (handled), null (not one of its actions) or an error code. */
function mimoHandle(PDO $db, array $room, array $device, bool $isHost, array $in, string $action) {
    $g = mimoLoad($db, (int)$room['id']);
    if ($g && mimoTick($g)) mimoSave($db, (int)$room['id'], $g);
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
            $new = mimoSanitizeSettings(is_array($in['settings'] ?? null) ? $in['settings'] : [], json_decode($room['settings'], true) ?: []);
            $db->prepare('UPDATE spia_rooms SET settings = :s WHERE id = :id')->execute([':s' => json_encode($new), ':id' => $room['id']]);
            return true;
        case 'team':   // the host places a player in a team (assign = host)
            if (!$isHost) return 'host_only';
            $cur = mimoSanitizeSettings([], json_decode($room['settings'], true) ?: []);
            $pid = (int)($in['player_id'] ?? 0);
            $t = $in['team'] ?? null;
            if (!is_int($t) || $t < 0 || $t >= $cur['teams'] || !in_array($pid, array_map(fn($p) => (int)$p['id'], spiaPlayers($db, (int)$room['id'])), true)) return 'bad_teams';
            $cur['map'][(string)$pid] = $t;
            $db->prepare('UPDATE spia_rooms SET settings = :s WHERE id = :id')->execute([':s' => json_encode($cur), ':id' => $room['id']]);
            return true;
        case 'start':
            if (!$isHost) return 'host_only';
            if ($playing) return 'round_running';
            return mimoStart($db, $room) ?? true;
        case 'end':
            if (!$isHost) return 'host_only';
            if (!$playing) return 'no_round';
            mimoEnd($g, 'host_ended');
            break;
        case 'next':   // the host skips a turn whose mime is not there
            if (!$isHost) return 'host_only';
            if (!$playing || $g['phase'] !== 'ready') return 'not_now';
            mimoEndTurn($g);
            break;
        case 'go':
            if (!$playing || $g['phase'] !== 'ready') return 'not_now';
            if (!$isHost && $own($g['mime']) === null) return 'not_mime';
            $g['phase'] = 'play';
            $g['ends_at'] = microtime(true) + (int)$g['rules']['secs'];
            $g['cur'] = ['word' => null, 'got' => [], 'skipped' => 0, 'passes_left' => MIMO_PASSES];
            mimoDraw($g);
            mimoEvent($g, ['t' => 'go', 'team' => $g['turn'] % $g['rules']['teams'], 'p' => $g['mime']]);
            break;
        case 'guess':
        case 'skip':
            if (!$playing || $g['phase'] !== 'play') return 'not_now';   // time may have just run out: the tick above already closed the turn
            $pid = $own($in['player_id'] ?? 0);
            if ($pid === null) return 'not_your_player';
            if ($pid !== (int)$g['mime']) return 'not_mime';
            if ($action === 'guess') {
                $g['score'][$g['turn'] % $g['rules']['teams']]++;
                $g['cur']['got'][] = $g['cur']['word'];
            } else {
                if ($g['cur']['passes_left'] <= 0) return 'no_passes';
                $g['cur']['passes_left']--;
                $g['cur']['skipped']++;
            }
            mimoDraw($g);
            break;
        default:
            return null;
    }
    mimoSave($db, (int)$room['id'], $g);
    return true;
}

/** What one phone may see. The word only reaches the phone of the mime on stage; the deadline never leaves as a timestamp, only the seconds left. */
function mimoView(PDO $db, array $room, array $device, bool $adminSession): array {
    $view = spiaView($db, $room, $device, $adminSession);
    $view['game'] = 'mimo';
    $view['settings'] = mimoSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $g = mimoLoad($db, (int)$room['id']);
    $view['mimo'] = null;
    if (!$g) return $view;
    $now = microtime(true);
    $mine = array_map(fn($p) => (int)$p['id'], array_filter($view['players'], fn($p) => $p['device_id'] === (int)$device['id']));
    $live = $g['status'] === 'play';
    $me = [];
    foreach (array_values(array_intersect($mine, $g['order'])) as $pid) {
        $me[] = ['player_id' => $pid, 'team' => $g['team'][(string)$pid], 'mime' => $live && (int)$g['mime'] === $pid];
    }
    $word = null;
    if ($live && $g['phase'] === 'play' && in_array((int)$g['mime'], $mine, true) && $g['cur']['word']) $word = mimoText($g['cur']['word']);
    $last = null;
    if ($g['last']) $last = ['team' => $g['last']['team'], 'p' => $g['last']['p'], 'n' => count($g['last']['got']), 'skipped' => $g['last']['skipped'],
        'words' => array_values(array_filter(array_map('mimoText', $g['last']['got'])))];
    $view['mimo'] = [
        'match' => $g['match'], 'status' => $g['status'], 'phase' => $g['phase'], 'turn' => $g['turn'], 'total' => $g['total'],
        'round' => min($g['rules']['rounds'], intdiv($g['turn'], $g['rules']['teams']) + 1), 'rounds' => $g['rules']['rounds'],
        'teams' => $g['rules']['teams'], 'team_of' => $g['team'], 'order' => $g['order'], 'gone' => $g['gone'], 'score' => $g['score'],
        'team' => $live ? $g['turn'] % $g['rules']['teams'] : null, 'mime' => $live ? $g['mime'] : null, 'secs' => $g['rules']['secs'],
        'left' => $g['phase'] === 'play' ? max(0, round($g['ends_at'] - $now, 1)) : null,
        'passes_left' => $g['phase'] === 'play' && $word ? $g['cur']['passes_left'] : null,
        'got' => $g['phase'] === 'play' ? count($g['cur']['got']) : null,
        'word' => $word, 'last' => $last, 'events' => $g['events'], 'result' => $g['result'], 'me' => $me,
    ];
    return $view;
}

/** For the admin LIVE panel: the teams, the score and the word on stage right now (the admin may see it). */
function mimoLiveInfo(PDO $db, int $roomId): ?array {
    $g = mimoLoad($db, $roomId);
    if (!$g) return null;
    $word = $g['phase'] === 'play' && $g['cur']['word'] ? mimoText($g['cur']['word']) : null;
    return [
        'status' => $g['status'], 'phase' => $g['phase'], 'turn' => $g['turn'], 'total' => $g['total'],
        'team' => $g['status'] === 'play' ? $g['turn'] % $g['rules']['teams'] : null, 'mime' => $g['status'] === 'play' ? $g['mime'] : null,
        'word' => $word ? $word['it'] : null, 'score' => $g['score'], 'team_of' => $g['team'],
    ];
}
