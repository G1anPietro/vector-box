<?php
// public/api/lupus_lib.php
// "Lupus" (werewolf) engine. Uses the same rooms/phones/players as the spy game (spia_lib.php);
// the whole match lives in one JSON state per room (table lupus_games), changed inside the
// caller's BEGIN IMMEDIATE transaction.
//
// Cycle: reveal -> night (everyone acts on their phone; non-active roles get a dummy screen)
//        -> [witch] -> dawn deaths -> [hunter] -> day (discussion, vote) -> [hunter] -> night ...

const LUPUS_MIN_PLAYERS = 4;
const LUPUS_ROLES = ['wolf', 'seer', 'guard', 'witch', 'hunter', 'fisher', 'judge', 'jester', 'villager'];
const LUPUS_SPECIALS = ['seer', 'guard', 'witch', 'hunter', 'fisher', 'judge', 'jester'];
const LUPUS_NOBODY = 0;   // vote / pick target meaning "nobody"

function lupusDefaultSettings(): array {
    return [
        'wolves_mode'  => 'auto',  // auto (about 1 every 4 players) | fixed
        'wolves'       => 1,
        'seer'         => true,
        'guard'        => true,
        'witch'        => true,
        'hunter'       => true,
        'fisher'       => false,   // takes the role of someone who died since the previous night
        'fisher_sees'  => true,    // the fisher sees the dead's roles while choosing
        'judge'        => false,   // once per game, decides the day's execution alone
        'jester'       => false,   // wins alone by being executed
        'wolves_know'  => true,    // wolves see each other
        'reveal_dead'  => true,    // a dead player's role is shown to everybody
        'dead_see_all' => false,   // phones whose players are all dead see every role
        'day_timer'    => false,
        'day_min'      => 5,
        'scores'       => false,
    ];
}

function lupusSanitizeSettings(array $in, array $base): array {
    $s = array_merge(lupusDefaultSettings(), array_intersect_key($base, lupusDefaultSettings()));
    $bool = fn($v, $def) => is_bool($v) ? $v : (is_numeric($v) ? (bool)(int)$v : $def);
    $int = fn($v, $min, $max, $def) => is_numeric($v) ? max($min, min($max, (int)$v)) : $def;
    if (isset($in['wolves_mode']) && in_array($in['wolves_mode'], ['auto', 'fixed'], true)) $s['wolves_mode'] = $in['wolves_mode'];
    $s['wolves'] = $int($in['wolves'] ?? $s['wolves'], 1, 9, 1);
    foreach ([...LUPUS_SPECIALS, 'fisher_sees', 'wolves_know', 'reveal_dead', 'dead_see_all', 'day_timer', 'scores'] as $k) {
        $s[$k] = $bool($in[$k] ?? $s[$k], (bool)$s[$k]);
    }
    $s['day_min'] = $int($in['day_min'] ?? $s['day_min'], 1, 30, 5);
    return $s;
}

/** How many wolves for $n players: never so many that they start at parity. */
function lupusWolfCount(array $s, int $n): int {
    $want = $s['wolves_mode'] === 'fixed' ? $s['wolves'] : max(1, intdiv($n + 1, 4));
    return max(1, min($want, intdiv($n - 1, 2)));
}

function lupusLoad(PDO $db, int $roomId): ?array {
    $st = $db->prepare('SELECT state FROM lupus_games WHERE room_id = :r');
    $st->execute([':r' => $roomId]);
    $raw = $st->fetchColumn();
    return $raw ? json_decode($raw, true) : null;
}

function lupusSave(PDO $db, int $roomId, array $g): void {
    $db->prepare('INSERT INTO lupus_games (room_id, state, updated_at) VALUES (:r, :s, :t)
                  ON CONFLICT(room_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at')
       ->execute([':r' => $roomId, ':s' => json_encode($g), ':t' => time()]);
}

function lupusLog(array &$g, array $ev): void {
    $ev['day'] = $g['day'];
    $g['log'][] = $ev;
}

function lupusIsAlive(array $g, int $pid): bool {
    return in_array($pid, $g['alive'], true);
}

function lupusAliveWithRole(array $g, string $role): array {
    return array_values(array_filter($g['alive'], fn($p) => ($g['roles'][(string)$p] ?? '') === $role));
}

function lupusRole(array $g, int $pid): ?string {
    return $g['roles'][(string)$pid] ?? null;
}

/** Start a new match with the players currently in the room. Returns an error code or null. */
function lupusStart(PDO $db, array $room): ?string {
    $s = lupusSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $players = spiaPlayers($db, (int)$room['id']);
    $n = count($players);
    if ($n < LUPUS_MIN_PLAYERS) return 'need_players_lupus';

    $deck = array_fill(0, lupusWolfCount($s, $n), 'wolf');
    foreach (LUPUS_SPECIALS as $special) {
        if ($s[$special] && count($deck) < $n) $deck[] = $special;
    }
    while (count($deck) < $n) $deck[] = 'villager';
    $deck = spiaShuffle($deck);

    $roles = [];
    foreach (array_values($players) as $i => $p) $roles[(string)$p['id']] = $deck[$i];
    $ids = array_map(fn($p) => (int)$p['id'], $players);

    $prev = lupusLoad($db, (int)$room['id']);
    $g = [
        'match' => (int)($prev['match'] ?? 0) + 1,
        'status' => 'play',
        'phase' => 'reveal',
        'day' => 0,
        'rules' => $s,
        'roles' => $roles,
        'orig_roles' => $roles,   // roles as dealt (the fisher's changes over the game)
        'judge_used' => false,
        'fished' => [],           // fisher pid => ['p' => fished player, 'role' => new role, 'day' => n, 'seen' => bool]
        'in_game' => $ids,
        'alive' => $ids,
        'seen' => [],
        'dead' => [],
        'night' => null,
        'witch' => ['heal' => true, 'kill' => true],
        'witch_step' => null,
        'guard_last' => [],
        'seer_results' => [],
        'hunter' => null,
        'vote' => ['open' => false, 'no' => 0, 'forced' => false, 'votes' => []],
        'timer_ends' => null,
        'dawn' => null,
        'lynch' => null,
        'log' => [],
        'result' => null,
        // which roles are in play is public, like announcing them before a real game
        'deck' => array_count_values($deck),
    ];
    lupusSave($db, (int)$room['id'], $g);
    return null;
}

/** Village wins with no wolves left; wolves win once they are at least as many as everyone else. */
function lupusCheckWin(array &$g): bool {
    $wolves = count(lupusAliveWithRole($g, 'wolf'));
    $others = count($g['alive']) - $wolves;
    if ($wolves === 0) { lupusEnd($g, 'village', 'no_wolves'); return true; }
    if ($wolves >= $others) { lupusEnd($g, 'wolves', 'wolves_parity'); return true; }
    return false;
}

function lupusEnd(array &$g, string $winner, string $reason): void {
    $g['status'] = 'ended';
    $g['phase'] = 'ended';
    $g['vote']['open'] = false;
    $g['timer_ends'] = null;
    $g['result'] = ['winner' => $winner, 'reason' => $reason, 'roles' => $g['roles'], 'orig_roles' => $g['orig_roles'] ?? $g['roles']];
}

/** Record a death. The hunter gets a last shot unless they left the game. */
function lupusKill(array &$g, int $pid, string $cause): void {
    if (!lupusIsAlive($g, $pid)) return;
    $g['alive'] = array_values(array_diff($g['alive'], [$pid]));
    $g['dead'][] = ['p' => $pid, 'cause' => $cause, 'day' => $g['day'], 'role' => lupusRole($g, $pid)];
    if (lupusRole($g, $pid) === 'hunter' && $cause !== 'left' && $cause !== 'hunter') $g['hunter'] = $pid;
}

/** After deaths: hunter's shot first, then the win check, then move on to $next (day|night). */
function lupusContinue(array &$g, string $next): void {
    if ($g['hunter'] !== null) {
        $g['phase'] = 'hunter';
        $g['after_hunter'] = $next;
        return;
    }
    if (lupusCheckWin($g)) return;
    $next === 'day' ? lupusStartDay($g) : lupusStartNight($g);
}

function lupusStartNight(array &$g): void {
    $g['day']++;
    $g['phase'] = 'night';
    $g['night'] = ['acted' => [], 'wolf' => [], 'seer' => [], 'guard' => []];
    $g['vote'] = ['open' => false, 'no' => $g['vote']['no'], 'forced' => false, 'votes' => []];
    $g['timer_ends'] = null;
    // $g['lynch'] stays: the night screens show yesterday's execution (it carries its own day)
}

function lupusStartDay(array &$g): void {
    $g['phase'] = 'day';
    $g['night'] = null;
    $g['witch_step'] = null;
    $g['timer_ends'] = !empty($g['rules']['day_timer']) ? time() + 60 * (int)$g['rules']['day_min'] : null;
}

/** Everybody looked at their card: the first night begins. */
function lupusSeen(array &$g, int $pid): void {
    if ($g['phase'] !== 'reveal') return;
    if (!in_array($pid, $g['seen'], true)) $g['seen'][] = $pid;
    if (!array_diff($g['alive'], $g['seen'])) lupusStartNight($g);
}

/**
 * A player's night action. Wolves pick a victim, the seer someone to inspect, the guard someone
 * to protect; everyone else (witch included) answers a dummy question, so nobody can tell roles
 * apart by who is busy. Returns an error code or null.
 */
function lupusNightAct(array &$g, int $pid, int $target): ?string {
    if ($g['phase'] !== 'night') return 'not_now';
    if (!lupusIsAlive($g, $pid)) return 'you_are_out';
    $role = lupusRole($g, $pid);
    $validOther = $target !== $pid && lupusIsAlive($g, $target);

    switch ($role) {
        case 'wolf':
            if (!$validOther || lupusRole($g, $target) === 'wolf') return 'bad_target';
            $g['night']['wolf'][(string)$pid] = $target;
            break;
        case 'seer':
            if (!$validOther) return 'bad_target';
            if (in_array($pid, $g['night']['acted'], true)) return 'already_acted';
            $g['night']['seer'][(string)$pid] = $target;
            $g['seer_results'][(string)$pid][] = ['day' => $g['day'], 'p' => $target, 'wolf' => lupusRole($g, $target) === 'wolf'];
            break;
        case 'guard':
            if (!lupusIsAlive($g, $target)) return 'bad_target';
            if (($g['guard_last'][(string)$pid] ?? null) === $target) return 'guard_repeat';
            $g['night']['guard'][(string)$pid] = $target;
            break;
        case 'fisher':
            $cands = lupusFishCandidates($g);
            if ($cands) {
                if (!in_array($target, $cands, true)) return 'bad_target';
                $g['night']['fish'][(string)$pid] = $target;
                break;
            }
            if ($target !== LUPUS_NOBODY && !$validOther) return 'bad_target';
            break;
        default:
            // villager, witch (her real move comes later), hunter, judge, jester: dummy pick, ignored
            if ($target !== LUPUS_NOBODY && !$validOther) return 'bad_target';
    }
    if (!in_array($pid, $g['night']['acted'], true)) $g['night']['acted'][] = $pid;
    lupusMaybeEndNight($g);
    return null;
}

/** The wolves' victim: most voted; a tie is broken at random. Null when no wolf voted. */
function lupusWolfVictim(array $g): ?int {
    $counts = array_count_values(array_map('intval', array_values($g['night']['wolf'])));
    if (!$counts) return null;
    $max = max($counts);
    $top = array_keys(array_filter($counts, fn($c) => $c === $max));
    return (int)spiaPick($top);
}

function lupusMaybeEndNight(array &$g): void {
    if ($g['phase'] !== 'night' || array_diff($g['alive'], $g['night']['acted'])) return;
    $g['night']['victim'] = lupusWolfVictim($g);
    if (!empty($g['rules']['witch'])) {
        // The witch step always happens when the witch is in the game, even if she is dead or out
        // of potions: a skipped step would tell everybody. Then it ends by itself after a few seconds.
        $witch = lupusAliveWithRole($g, 'witch')[0] ?? null;
        $canAct = $witch !== null && ($g['witch']['heal'] || $g['witch']['kill']);
        $g['phase'] = 'witch';
        $g['witch_step'] = ['p' => $canAct ? $witch : null, 'auto_at' => $canAct ? null : time() + random_int(5, 10)];
        return;
    }
    lupusResolveNight($g);
}

/** Witch: heal tonight's victim and/or poison someone. Each potion once per match. */
function lupusWitchAct(array &$g, int $pid, bool $heal, int $kill): ?string {
    if ($g['phase'] !== 'witch' || ($g['witch_step']['p'] ?? null) !== $pid) return 'not_now';
    if ($heal && (!$g['witch']['heal'] || $g['night']['victim'] === null)) return 'bad_target';
    if ($kill !== LUPUS_NOBODY && (!$g['witch']['kill'] || $kill === $pid || !lupusIsAlive($g, $kill))) return 'bad_target';
    $g['night']['healed'] = $heal;
    $g['night']['poisoned'] = $kill !== LUPUS_NOBODY ? $kill : null;
    if ($heal) $g['witch']['heal'] = false;
    if ($kill !== LUPUS_NOBODY) $g['witch']['kill'] = false;
    lupusResolveNight($g);
    return null;
}

/** Players the fisher may take a role from tonight: who died since the previous night (not who left). */
function lupusFishCandidates(array $g): array {
    $out = [];
    foreach ($g['dead'] as $d) {
        if ($d['day'] === $g['day'] - 1 && $d['cause'] !== 'left') $out[] = (int)$d['p'];
    }
    return $out;
}

function lupusResolveNight(array &$g): void {
    $n = $g['night'];
    // The fisher becomes what the chosen dead player was, before tonight's deaths
    foreach ($n['fish'] ?? [] as $fisher => $target) {
        $dead = array_values(array_filter($g['dead'], fn($d) => (int)$d['p'] === (int)$target));
        if (!$dead || lupusRole($g, (int)$fisher) !== 'fisher') continue;
        $g['roles'][(string)$fisher] = $dead[0]['role'];
        $g['fished'][(string)$fisher] = ['p' => (int)$target, 'role' => $dead[0]['role'], 'day' => $g['day'], 'seen' => false];
    }
    $died = [];
    $victim = $n['victim'] ?? null;
    $protected = in_array($victim, array_map('intval', array_values($n['guard'])), true);
    $eaten = $victim !== null && !$protected && empty($n['healed']);
    if ($eaten) $died[] = [$victim, 'wolves'];
    // The guard only stops wolves: poison always works (unless the wolves already took that player)
    $poisoned = !empty($n['poisoned']) ? (int)$n['poisoned'] : null;
    if ($poisoned !== null && !($eaten && $poisoned === $victim)) $died[] = [$poisoned, 'witch'];

    foreach ($n['guard'] as $guard => $t) $g['guard_last'][$guard] = (int)$t;
    foreach ($died as [$p, $cause]) lupusKill($g, $p, $cause);
    $g['dawn'] = ['day' => $g['day'], 'died' => array_map(fn($d) => $d[0], $died)];
    lupusLog($g, ['t' => 'dawn', 'died' => $g['dawn']['died']]);
    $g['witch_step'] = null;
    lupusContinue($g, 'day');
}

function lupusHunterShoot(array &$g, int $pid, int $target): ?string {
    if ($g['phase'] !== 'hunter' || $g['hunter'] !== $pid) return 'not_now';
    if ($target !== LUPUS_NOBODY && !lupusIsAlive($g, $target)) return 'bad_target';
    $g['hunter'] = null;
    if ($target !== LUPUS_NOBODY) lupusKill($g, $target, 'hunter');
    lupusLog($g, ['t' => 'shot', 'p' => $pid, 'target' => $target]);
    lupusContinue($g, $g['after_hunter'] ?? 'night');
    return null;
}

function lupusOpenVote(array &$g, bool $forced): void {
    $g['vote'] = ['open' => true, 'no' => $g['vote']['no'] + 1, 'forced' => $forced, 'votes' => []];
    $g['timer_ends'] = null;
}

function lupusVote(array &$g, int $pid, int $target, bool $judge = false): ?string {
    if ($g['phase'] !== 'day' || !$g['vote']['open']) return 'no_vote';
    if (!lupusIsAlive($g, $pid)) return 'you_are_out';
    if ($target !== LUPUS_NOBODY && ($target === $pid || !lupusIsAlive($g, $target))) return 'bad_target';
    if ($judge) {
        // The judge's hammer: once per game, this player alone decides who is executed
        if (lupusRole($g, $pid) !== 'judge' || !empty($g['judge_used']) || $target === LUPUS_NOBODY) return 'bad_target';
        $g['vote']['judge'] = $target;
    }
    $g['vote']['votes'][(string)$pid] = $target;
    if (!array_diff($g['alive'], array_map('intval', array_keys($g['vote']['votes'])))) lupusResolveVote($g);
    return null;
}

/** One vote per day: the most voted is out; a tie or "nobody" means nobody dies. Then night falls. */
function lupusResolveVote(array &$g): void {
    $counts = array_count_values(array_map('intval', array_values($g['vote']['votes'])));
    arsort($counts);
    $g['vote']['open'] = false;
    $top = array_keys($counts);
    $tie = !$counts || (count($counts) > 1 && $counts[$top[0]] === $counts[$top[1]]);
    $out = $tie ? LUPUS_NOBODY : (int)$top[0];
    $judged = isset($g['vote']['judge']) && lupusIsAlive($g, (int)$g['vote']['judge']);
    if ($judged) {
        $out = (int)$g['vote']['judge'];
        $g['judge_used'] = true;
    }
    $g['lynch'] = ['day' => $g['day'], 'p' => $out, 'counts' => $counts, 'judge' => $judged];
    lupusLog($g, ['t' => 'lynch', 'p' => $out, 'counts' => $counts, 'judge' => $judged]);
    if ($out !== LUPUS_NOBODY) {
        lupusKill($g, $out, 'lynch');
        // The jester wanted exactly this
        if (lupusRole($g, $out) === 'jester') {
            $g['hunter'] = null;
            lupusEnd($g, 'jester', 'jester_lynched');
            $g['result']['jester'] = $out;
            return;
        }
    }
    lupusContinue($g, 'night');
}

/** Someone left the room mid-game: they are out, and they no longer block the night or the vote. */
function lupusPlayerLeft(array &$g, int $pid): void {
    if ($g['status'] !== 'play' || !lupusIsAlive($g, $pid)) return;
    lupusKill($g, $pid, 'left');
    lupusLog($g, ['t' => 'left', 'p' => $pid]);
    if ($g['phase'] === 'hunter' && $g['hunter'] === $pid) $g['hunter'] = null;
    if (lupusCheckWin($g)) return;
    if ($g['phase'] === 'reveal' && !array_diff($g['alive'], $g['seen'])) lupusStartNight($g);
    if ($g['phase'] === 'night') lupusMaybeEndNight($g);
    if ($g['phase'] === 'witch' && ($g['witch_step']['p'] ?? null) === $pid) lupusResolveNight($g);
    if ($g['phase'] === 'day' && $g['vote']['open'] && !array_diff($g['alive'], array_map('intval', array_keys($g['vote']['votes'])))) {
        lupusResolveVote($g);
    }
}

/** Time-based steps, run on polls: the day timer opens the final vote; the "empty" witch step ends. */
function lupusTick(array &$g): bool {
    if ($g['status'] !== 'play') return false;
    $now = time();
    if ($g['phase'] === 'day' && $g['timer_ends'] !== null && $now >= $g['timer_ends'] && !$g['vote']['open']) {
        lupusOpenVote($g, true);
        lupusLog($g, ['t' => 'time_up']);
        return true;
    }
    if ($g['phase'] === 'witch' && ($g['witch_step']['auto_at'] ?? null) !== null && $now >= $g['witch_step']['auto_at']) {
        lupusResolveNight($g);
        return true;
    }
    return false;
}

function lupusAwardScores(PDO $db, array $g): void {
    $winner = $g['result']['winner'] ?? '';
    if (empty($g['rules']['scores']) || !in_array($winner, ['wolves', 'village', 'jester'], true)) return;
    $add = $db->prepare('UPDATE spia_players SET score = score + 1 WHERE id = :id AND removed = 0');
    foreach ($g['roles'] as $pid => $role) {
        $won = $winner === 'jester' ? (int)$pid === (int)($g['result']['jester'] ?? 0)
            : ($winner === 'wolves' ? $role === 'wolf' : $role !== 'wolf' && $role !== 'jester');
        if ($won) $add->execute([':id' => (int)$pid]);
    }
}

/**
 * Handle a Lupus action for this phone. Returns null when it was not a Lupus action
 * (the caller then tries the shared room actions), true on success, or an error code.
 */
function lupusHandle(PDO $db, array $room, array $device, bool $isHost, array $in, string $action) {
    $g = lupusLoad($db, (int)$room['id']);
    $playing = $g && $g['status'] === 'play';
    $own = function ($pid) use ($db, $device): ?int {
        $st = $db->prepare('SELECT id FROM spia_players WHERE id = :id AND device_id = :d AND removed = 0');
        $st->execute([':id' => (int)$pid, ':d' => $device['id']]);
        $id = $st->fetchColumn();
        return $id === false ? null : (int)$id;
    };
    $target = (int)($in['target'] ?? 0);

    switch ($action) {
        case 'settings':
            if (!$isHost) return 'host_only';
            $new = lupusSanitizeSettings(is_array($in['settings'] ?? null) ? $in['settings'] : [], json_decode($room['settings'], true) ?: []);
            $db->prepare('UPDATE spia_rooms SET settings = :s WHERE id = :id')->execute([':s' => json_encode($new), ':id' => $room['id']]);
            return true;
        case 'start':
            if (!$isHost) return 'host_only';
            if ($playing) return 'round_running';
            return lupusStart($db, $room) ?? true;
        case 'end':
            if (!$isHost) return 'host_only';
            if (!$playing) return 'no_round';
            lupusEnd($g, 'none', 'host_ended');
            break;
        case 'fish_seen':
            if (!$playing) return 'no_round';
            $pid = $own($in['player_id'] ?? 0);
            if ($pid === null || !isset($g['fished'][(string)$pid])) return 'not_your_player';
            $g['fished'][(string)$pid]['seen'] = true;
            break;
        case 'seen':
        case 'night':
        case 'witch':
        case 'shoot':
        case 'vote':
            if (!$playing) return 'no_round';
            $pid = $own($in['player_id'] ?? 0);
            if ($pid === null) return 'not_your_player';
            if ($action === 'seen') { lupusSeen($g, $pid); break; }
            if ($action === 'night') $err = lupusNightAct($g, $pid, $target);
            elseif ($action === 'witch') $err = lupusWitchAct($g, $pid, !empty($in['heal']), (int)($in['kill'] ?? 0));
            elseif ($action === 'shoot') $err = lupusHunterShoot($g, $pid, $target);
            else $err = lupusVote($g, $pid, $target, !empty($in['judge']));
            if ($err) return $err;
            break;
        case 'vote_call':
            if (!$playing || $g['phase'] !== 'day') return 'no_round';
            if ($g['vote']['open']) return 'vote_open';
            lupusOpenVote($g, false);
            lupusLog($g, ['t' => 'vote']);
            break;
        case 'vote_close':
            if (!$isHost) return 'host_only';
            if (!$playing || $g['phase'] !== 'day' || !$g['vote']['open']) return 'no_vote';
            lupusResolveVote($g);
            break;
        case 'skip_day':
            // host: night falls without a vote
            if (!$isHost) return 'host_only';
            if (!$playing || $g['phase'] !== 'day' || $g['vote']['open']) return 'not_now';
            lupusLog($g, ['t' => 'skip']);
            lupusStartNight($g);
            break;
        default:
            return null;
    }
    $wasPlaying = $playing;
    lupusSave($db, (int)$room['id'], $g);
    if ($wasPlaying && $g['status'] === 'ended') lupusAwardScores($db, $g);
    return true;
}

/** What one phone may see of the match. */
function lupusView(PDO $db, array $room, array $device, bool $adminSession): array {
    $view = spiaView($db, $room, $device, $adminSession);
    $view['game'] = 'lupus';
    $view['settings'] = lupusSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $g = lupusLoad($db, (int)$room['id']);
    $view['lupus'] = null;
    if (!$g) return $view;

    $reveal = !empty($g['rules']['reveal_dead']) || $g['status'] === 'ended';
    $mine = array_map(fn($p) => (int)$p['id'], array_filter($view['players'], fn($p) => $p['device_id'] === (int)$device['id']));
    $mineInGame = array_values(array_intersect($mine, $g['in_game']));
    $allMineDead = $mineInGame && !array_intersect($mineInGame, $g['alive']);
    $seeAll = $g['status'] === 'ended' || ($allMineDead && !empty($g['rules']['dead_see_all']));

    $view['lupus'] = [
        'match' => $g['match'],
        'status' => $g['status'],
        'phase' => $g['phase'],
        'day' => $g['day'],
        'rules' => $g['rules'],
        'deck' => $g['deck'],
        'in_game' => $g['in_game'],
        'alive' => $g['alive'],
        'seen' => $g['phase'] === 'reveal' ? $g['seen'] : [],
        'acted' => $g['phase'] === 'night' ? count($g['night']['acted']) : null,
        'dead' => array_map(fn($d) => ['p' => $d['p'], 'cause' => $d['cause'], 'day' => $d['day'], 'role' => $reveal ? $d['role'] : null], $g['dead']),
        'dawn' => $g['dawn'],
        'lynch' => $g['lynch'],
        'hunter' => $g['phase'] === 'hunter' ? $g['hunter'] : null,
        'vote' => ['open' => $g['vote']['open'], 'forced' => $g['vote']['forced'], 'voted' => array_map('intval', array_keys($g['vote']['votes']))],
        'timer_ends' => $g['timer_ends'],
        'log' => $g['log'],
        'result' => $g['result'],
        'all_roles' => $seeAll ? $g['roles'] : null,
        'me' => [],
    ];

    foreach ($mineInGame as $pid) {
        $role = lupusRole($g, $pid);
        $me = [
            'player_id' => $pid,
            'role' => $role,
            'alive' => lupusIsAlive($g, $pid),
            'seen' => in_array($pid, $g['seen'], true) || $g['phase'] !== 'reveal',
            'acted' => $g['phase'] === 'night' && in_array($pid, $g['night']['acted'], true),
        ];
        if ($role === 'wolf' && !empty($g['rules']['wolves_know'])) {
            $me['pack'] = array_values(array_map('intval', array_keys(array_filter($g['roles'], fn($r) => $r === 'wolf'))));
            if ($g['phase'] === 'night') $me['pack_votes'] = $g['night']['wolf'];
        }
        if ($role === 'seer') $me['seen_results'] = $g['seer_results'][(string)$pid] ?? [];
        if ($role === 'fisher' && $g['phase'] === 'night') {
            $me['fish_candidates'] = array_map(function ($c) use ($g) {
                $d = array_values(array_filter($g['dead'], fn($x) => (int)$x['p'] === $c))[0];
                return ['p' => $c, 'role' => !empty($g['rules']['fisher_sees']) ? $d['role'] : null];
            }, lupusFishCandidates($g));
        }
        if (isset($g['fished'][(string)$pid])) $me['fished'] = $g['fished'][(string)$pid];
        if ($role === 'judge') $me['judge_available'] = empty($g['judge_used']);
        if ($role === 'guard') $me['guard_last'] = $g['guard_last'][(string)$pid] ?? null;
        if ($role === 'witch') {
            $me['potions'] = $g['witch'];
            if ($g['phase'] === 'witch' && ($g['witch_step']['p'] ?? null) === $pid) {
                $me['witch_turn'] = true;
                $me['victim'] = $g['night']['victim'];
            }
        }
        $view['lupus']['me'][] = $me;
    }
    return $view;
}

/** Admin LIVE: the full truth of a Lupus room. */
function lupusLiveInfo(PDO $db, int $roomId): ?array {
    $g = lupusLoad($db, $roomId);
    if (!$g) return null;
    return [
        'status' => $g['status'], 'phase' => $g['phase'], 'day' => $g['day'],
        'roles' => $g['roles'], 'alive' => $g['alive'],
        'night' => $g['night'], 'votes' => $g['vote']['votes'], 'result' => $g['result'],
    ];
}
