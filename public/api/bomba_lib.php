<?php
// public/api/bomba_lib.php — "La bomba" (hot potato), on the shared rooms of spia.php (game "bomba").
// One JSON state per room (table bomba_games), changed inside the caller's BEGIN IMMEDIATE transaction.
//
// A bomb with a HIDDEN fuse (12 s .. the host's maximum, drawn by the server; fuse_at is never sent to any client, the LIVE
// panel included). Whoever holds it sees a prompt (a category, or a syllable the word must contain), says a valid answer out loud
// and presses "Pass", choosing who gets the bomb next (not themselves, not an eliminated player). When the fuse burns out the
// SERVER explodes the bomb: the holder loses a life; at 0 lives they are out. The last player with lives wins. After every
// explosion a new round starts with a new fuse. The clients never compute the time: the state is polled and the server ticks.
// Prompts: lib/bomba-q.json {"cat": [[it,en,es,fr,de]...], "syl": [[it,en,es,fr,de]...]}.

const BOMBA_MIN_PLAYERS = 3;
const BOMBA_MIN_FUSE = 12;
const BOMBA_BOOM_SECONDS = 6;
const BOMBA_LANGS = ['it', 'en', 'es', 'fr', 'de'];

function bombaDefaultSettings(): array {
    return ['lives' => 3, 'kind' => 'mix', 'fuse' => 45];
}

function bombaSanitizeSettings(array $in, array $base): array {
    $s = array_merge(bombaDefaultSettings(), array_intersect_key($base, bombaDefaultSettings()));
    if (isset($in['lives']) && in_array($in['lives'], [1, 3, 5], true)) $s['lives'] = $in['lives'];
    if (isset($in['kind']) && in_array($in['kind'], ['cat', 'syl', 'mix'], true)) $s['kind'] = $in['kind'];
    if (isset($in['fuse']) && in_array($in['fuse'], [25, 35, 45], true)) $s['fuse'] = $in['fuse'];   // the longest fuse the host allows
    return $s;
}

function bombaBank(): array {
    static $bank = null;
    if ($bank === null) $bank = json_decode((string)@file_get_contents(dirname(__DIR__, 2) . '/lib/bomba-q.json'), true) ?: [];
    return $bank;
}

function bombaLoad(PDO $db, int $roomId): ?array {
    $st = $db->prepare('SELECT state FROM bomba_games WHERE room_id = :r');
    $st->execute([':r' => $roomId]);
    $raw = $st->fetchColumn();
    return $raw ? json_decode($raw, true) : null;
}

function bombaSave(PDO $db, int $roomId, array $g): void {
    $db->prepare('INSERT INTO bomba_games (room_id, state, updated_at) VALUES (:r, :s, :t)
                  ON CONFLICT(room_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at')
       ->execute([':r' => $roomId, ':s' => json_encode($g), ':t' => time()]);
}

function bombaEvent(array &$g, array $ev): void {
    $ev['id'] = ++$g['event_seq'];
    $ev['round'] = $g['round'];
    $g['events'][] = $ev;
    if (count($g['events']) > 40) $g['events'] = array_slice($g['events'], -40);
}

/** Players still in the match: present and with lives left. */
function bombaAlive(array $g): array {
    return array_values(array_filter($g['order'], fn($p) => !in_array($p, $g['gone'], true) && $g['lives'][(string)$p] > 0));
}

/** The next living player after $pid in the seating order (not $pid itself unless alone). */
function bombaNextAlive(array $g, int $pid): ?int {
    $alive = bombaAlive($g);
    if (!$alive) return null;
    $pos = array_search($pid, $g['order'], true);
    $n = count($g['order']);
    for ($i = 1; $i <= $n; $i++) {
        $c = $g['order'][(($pos === false ? -1 : $pos) + $i) % $n];
        if (in_array($c, $alive, true) && $c !== $pid) return $c;
    }
    return $alive[0];
}

function bombaEnd(array &$g, string $reason): void {
    $g['status'] = 'ended';
    $g['phase'] = 'ended';
    $alive = bombaAlive($g);
    $rows = [];
    foreach ($g['order'] as $p) {
        if (in_array($p, $g['gone'], true)) continue;
        $s = $g['stats'][(string)$p];
        $rows[] = ['p' => $p, 'lives' => $g['lives'][(string)$p], 'booms' => $s['booms'], 'passes' => $s['passes'], 'out' => $s['out']];
    }
    // winner first, then who lasted longer (later elimination), then more lives
    usort($rows, fn($a, $b) => [$b['lives'], $b['out'] ?? PHP_INT_MAX] <=> [$a['lives'], $a['out'] ?? PHP_INT_MAX]);
    $g['result'] = ['reason' => $reason, 'rounds' => $g['round'], 'winner' => count($alive) === 1 && $reason === 'last' ? $alive[0] : null, 'rows' => $rows];
    bombaEvent($g, ['t' => 'end']);
}

/** Light a new fuse and draw the prompt (never the same prompt twice until the pile is used up). */
function bombaStartRound(array &$g, int $holder, ?float $now = null): void {
    $now = $now ?? microtime(true);
    $bank = bombaBank();
    $kinds = $g['rules']['kind'] === 'mix' ? ['cat', 'syl'] : [$g['rules']['kind']];
    $k = $kinds[random_int(0, count($kinds) - 1)];
    $free = array_values(array_filter(array_keys($bank[$k]), fn($i) => !in_array("$k$i", $g['used'], true)));
    if (!$free) {
        $g['used'] = array_values(array_filter($g['used'], fn($u) => $u[0] !== $k[0]));
        $free = array_keys($bank[$k]);
    }
    $i = $free[random_int(0, count($free) - 1)];
    $g['used'][] = "$k$i";
    $g['q'] = ['k' => $k, 'i' => $i];
    $g['fuse_at'] = $now + random_int(BOMBA_MIN_FUSE * 10, (int)$g['rules']['fuse'] * 10) / 10;   // SECRET: never leaves the server
    $g['holder'] = $holder;
    $g['phase'] = 'armed';
    $g['next_at'] = null;
    $g['boom'] = null;
    $g['passes_round'] = 0;
    bombaEvent($g, ['t' => 'round', 'n' => $g['round'], 'p' => $holder]);
}

/** The fuse is out: the holder loses a life. */
function bombaExplode(array &$g, ?float $now = null): void {
    $now = $now ?? microtime(true);
    $p = (int)$g['holder'];
    $k = (string)$p;
    $g['lives'][$k]--;
    $g['stats'][$k]['booms']++;
    $out = $g['lives'][$k] <= 0;
    if ($out) $g['stats'][$k]['out'] = $g['round'];
    $g['fuse_at'] = null;
    $g['boom'] = ['p' => $p, 'out' => $out, 'lives' => $g['lives'][$k]];
    bombaEvent($g, ['t' => $out ? 'out' : 'boom', 'p' => $p]);
    if (count(bombaAlive($g)) <= 1) { bombaEnd($g, 'last'); return; }
    $g['phase'] = 'boom';
    $g['next_at'] = $now + BOMBA_BOOM_SECONDS;
}

function bombaAdvance(array &$g, ?float $now = null): void {
    $g['round']++;
    bombaStartRound($g, bombaNextAlive($g, (int)$g['holder']) ?? (int)$g['holder'], $now);
}

/** Advances the clock-driven parts. Returns true when the state changed (the caller saves it). */
function bombaTick(array &$g, ?float $now = null): bool {
    if ($g['status'] !== 'play') return false;
    $now = $now ?? microtime(true);
    if ($g['phase'] === 'armed' && $now >= $g['fuse_at']) { bombaExplode($g, $now); return true; }
    if ($g['phase'] === 'boom' && $now >= $g['next_at']) { bombaAdvance($g, $now); return true; }
    return false;
}

function bombaStart(PDO $db, array $room): ?string {
    $s = bombaSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $players = spiaPlayers($db, (int)$room['id']);
    if (count($players) < BOMBA_MIN_PLAYERS) return 'need_players_bomba';
    $bank = bombaBank();
    if (empty($bank['cat']) || empty($bank['syl'])) return 'no_questions';
    $order = array_map(fn($p) => (int)$p['id'], $players);
    $prev = bombaLoad($db, (int)$room['id']);
    $g = [
        'match' => (int)($prev['match'] ?? 0) + 1,
        'status' => 'play', 'phase' => 'armed', 'rules' => $s, 'order' => $order, 'gone' => [],
        'lives' => array_fill_keys(array_map('strval', $order), $s['lives']),
        'stats' => array_fill_keys(array_map('strval', $order), ['booms' => 0, 'passes' => 0, 'out' => null]),
        'round' => 1, 'used' => $prev['used'] ?? [], 'q' => null, 'fuse_at' => null, 'holder' => null, 'boom' => null, 'passes_round' => 0,
        'next_at' => null, 'events' => [], 'event_seq' => (int)($prev['event_seq'] ?? 0), 'result' => null,
    ];
    bombaEvent($g, ['t' => 'start']);
    bombaStartRound($g, $order[random_int(0, count($order) - 1)]);
    bombaSave($db, (int)$room['id'], $g);
    return null;
}

function bombaPlayerLeft(array &$g, int $pid): void {
    if ($g['status'] !== 'play' || !in_array($pid, $g['order'], true) || in_array($pid, $g['gone'], true)) return;
    $g['gone'][] = $pid;
    bombaEvent($g, ['t' => 'left', 'p' => $pid]);
    $alive = bombaAlive($g);
    if (count($alive) < 2) { bombaEnd($g, 'too_few'); return; }
    if ((int)$g['holder'] === $pid) $g['holder'] = bombaNextAlive($g, $pid);   // the bomb does not vanish with the player; the fuse keeps burning
}

/** Room actions for the game. Returns true (handled), null (not one of its actions) or an error code. */
function bombaHandle(PDO $db, array $room, array $device, bool $isHost, array $in, string $action) {
    $g = bombaLoad($db, (int)$room['id']);
    if ($g && bombaTick($g)) bombaSave($db, (int)$room['id'], $g);
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
            $new = bombaSanitizeSettings(is_array($in['settings'] ?? null) ? $in['settings'] : [], json_decode($room['settings'], true) ?: []);
            $db->prepare('UPDATE spia_rooms SET settings = :s WHERE id = :id')->execute([':s' => json_encode($new), ':id' => $room['id']]);
            return true;
        case 'start':
            if (!$isHost) return 'host_only';
            if ($playing) return 'round_running';
            return bombaStart($db, $room) ?? true;
        case 'end':
            if (!$isHost) return 'host_only';
            if (!$playing) return 'no_round';
            bombaEnd($g, 'host_ended');
            break;
        case 'next':
            if (!$isHost) return 'host_only';
            if (!$playing || $g['phase'] !== 'boom') return 'not_now';
            bombaAdvance($g);
            break;
        case 'pass':
            if (!$playing || $g['phase'] !== 'armed') return 'not_now';   // the fuse may have just burnt out: the tick above already exploded it
            $pid = $own($in['player_id'] ?? 0);
            if ($pid === null) return 'not_your_player';
            if ($pid !== (int)$g['holder']) return 'not_holder';
            $to = (int)($in['to'] ?? 0);
            if ($to === $pid || !in_array($to, bombaAlive($g), true)) return 'bad_target';
            $g['holder'] = $to;
            $g['stats'][(string)$pid]['passes']++;
            $g['passes_round']++;
            bombaEvent($g, ['t' => 'pass', 'p' => $pid, 'to' => $to]);
            break;
        default:
            return null;
    }
    bombaSave($db, (int)$room['id'], $g);
    return true;
}

/** What one phone may see. NEVER the fuse (no time left, no deadline, no start time). */
function bombaView(PDO $db, array $room, array $device, bool $adminSession): array {
    $view = spiaView($db, $room, $device, $adminSession);
    $view['game'] = 'bomba';
    $view['settings'] = bombaSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $g = bombaLoad($db, (int)$room['id']);
    $view['bomba'] = null;
    if (!$g) return $view;
    $now = microtime(true);
    $mine = array_map(fn($p) => (int)$p['id'], array_filter($view['players'], fn($p) => $p['device_id'] === (int)$device['id']));
    $me = [];
    foreach (array_values(array_intersect($mine, $g['order'])) as $pid) {
        $me[] = ['player_id' => $pid, 'alive' => in_array($pid, bombaAlive($g), true), 'holder' => $g['status'] === 'play' && $g['phase'] === 'armed' && (int)$g['holder'] === $pid];
    }
    $q = null;
    if ($g['q']) {
        $row = bombaBank()[$g['q']['k']][$g['q']['i']] ?? null;
        $q = $row ? ['k' => $g['q']['k'], 'text' => array_combine(BOMBA_LANGS, $row)] : null;
    }
    $view['bomba'] = [
        'match' => $g['match'], 'status' => $g['status'], 'phase' => $g['phase'], 'round' => $g['round'],
        'order' => $g['order'], 'alive' => bombaAlive($g), 'lives' => $g['lives'], 'max_lives' => $g['rules']['lives'], 'rules' => ['lives' => $g['rules']['lives'], 'kind' => $g['rules']['kind'], 'fuse' => $g['rules']['fuse']],
        'holder' => $g['phase'] === 'armed' ? $g['holder'] : null,
        'passes' => $g['passes_round'],
        'q' => in_array($g['phase'], ['armed', 'boom'], true) ? $q : null,
        'boom' => $g['boom'],
        'next_left' => $g['phase'] === 'boom' ? max(0, round($g['next_at'] - $now, 1)) : null,
        'events' => $g['events'], 'result' => $g['result'], 'me' => $me,
    ];
    return $view;
}

/** For the admin LIVE panel: who holds the bomb and the lives. The exact fuse stays secret here too, like the other games' deadlines. */
function bombaLiveInfo(PDO $db, int $roomId): ?array {
    $g = bombaLoad($db, $roomId);
    if (!$g) return null;
    $row = $g['q'] ? (bombaBank()[$g['q']['k']][$g['q']['i']] ?? null) : null;
    return [
        'status' => $g['status'], 'phase' => $g['phase'], 'round' => $g['round'],
        'holder' => $g['phase'] === 'armed' ? $g['holder'] : null,
        'prompt' => $row ? $row[0] : null, 'kind' => $g['q']['k'] ?? null,
        'lives' => $g['lives'],
    ];
}
