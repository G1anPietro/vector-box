<?php
// public/api/spia_lib.php
// "Who's the Spy" game engine: rooms, dealing, votes, guesses, scores, per-device views.
// Every mutating function expects to run inside the caller's BEGIN IMMEDIATE transaction.

const SPIA_MAX_PLAYERS = 20;
const SPIA_MAX_DEVICES = 20;
const SPIA_NAME_MAX = 24;
const SPIA_OFFLINE_AFTER = 20;   // seconds without a poll -> phone shown as offline
const SPIA_HOST_TIMEOUT = 30;    // seconds -> host role moves automatically
const SPIA_ROOM_TTL = 86400;     // idle rooms are deleted after a day
const SPIA_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O (look like 1/0)
const SPIA_NO_SPIES = 0;         // vote target meaning "no spies (left)"

function spiaLocationsData(): array {
    static $data = null;
    if ($data !== null) return $data;
    $raw = json_decode((string)file_get_contents(dirname(__DIR__) . '/assets/spia/locations.json'), true);
    $data = ['locations' => [], 'categories' => []];
    foreach ($raw['categories'] ?? [] as $c) $data['categories'][] = $c['id'];
    foreach ($raw['locations'] ?? [] as $l) {
        $data['locations'][$l['id']] = ['cat' => $l['cat'], 'roles' => count($l['roles'])];
    }
    return $data;
}

function spiaDefaultSettings(): array {
    return [
        'spy_mode'    => 'fixed',  // fixed | range
        'spies'       => 1,
        'spy_min'     => 1,
        'spy_max'     => 2,
        'show_count'  => false,    // range mode: tell everyone how many spies were drawn
        'vote'        => true,
        'guess'       => true,
        'timer'       => false,
        'timer_min'   => 8,
        'scores'      => false,
        'spy_list'    => true,     // everyone can open the list of possible locations
        'spy_hint'    => false,    // spies see the category of the location
        'no_repeat'   => true,
        'no_repeat_n' => 5,
        'packs'       => spiaLocationsData()['categories'],
        'custom'      => false,
        'custom_locations' => [],
    ];
}

function spiaCleanText($s, int $max): string {
    $s = preg_replace('/[\x00-\x1F\x7F]+/u', ' ', (string)$s) ?? '';
    return textCut(trim(preg_replace('/\s+/u', ' ', $s) ?? ''), $max);
}

/** Merge user input over $base, clamping every field. Unknown keys are dropped. */
function spiaSanitizeSettings(array $in, array $base): array {
    $s = array_merge(spiaDefaultSettings(), $base);
    $int = fn($v, $min, $max, $def) => is_numeric($v) ? max($min, min($max, (int)$v)) : $def;
    $bool = fn($v, $def) => is_bool($v) ? $v : (is_numeric($v) ? (bool)(int)$v : $def);

    if (isset($in['spy_mode']) && in_array($in['spy_mode'], ['fixed', 'range'], true)) $s['spy_mode'] = $in['spy_mode'];
    $s['spies']   = $int($in['spies'] ?? $s['spies'], 0, SPIA_MAX_PLAYERS, 1);
    $s['spy_min'] = $int($in['spy_min'] ?? $s['spy_min'], 0, SPIA_MAX_PLAYERS, 0);
    $s['spy_max'] = $int($in['spy_max'] ?? $s['spy_max'], 0, SPIA_MAX_PLAYERS, 2);
    if ($s['spy_max'] < $s['spy_min']) $s['spy_max'] = $s['spy_min'];
    foreach (['show_count', 'vote', 'guess', 'timer', 'scores', 'spy_list', 'spy_hint', 'no_repeat', 'custom'] as $k) {
        $s[$k] = $bool($in[$k] ?? $s[$k], (bool)$s[$k]);
    }
    $s['timer_min']   = $int($in['timer_min'] ?? $s['timer_min'], 1, 30, 8);
    $s['no_repeat_n'] = $int($in['no_repeat_n'] ?? $s['no_repeat_n'], 1, 15, 5);

    if (isset($in['packs']) && is_array($in['packs'])) {
        $s['packs'] = array_values(array_intersect(spiaLocationsData()['categories'], $in['packs']));
    }
    if (isset($in['custom_locations']) && is_array($in['custom_locations'])) {
        $locs = [];
        foreach (array_slice($in['custom_locations'], 0, 30) as $l) {
            if (!is_array($l)) continue;
            $name = spiaCleanText($l['name'] ?? '', 40);
            $roles = [];
            foreach (array_slice(is_array($l['roles'] ?? null) ? $l['roles'] : [], 0, 12) as $r) {
                $r = spiaCleanText($r, 40);
                if ($r !== '') $roles[] = $r;
            }
            if ($name !== '' && $roles) $locs[] = ['name' => $name, 'roles' => $roles];
        }
        $s['custom_locations'] = $locs;
    }
    return $s;
}

/** Location ids playable with these settings: built-in ones in the chosen packs + custom ("c0", "c1", ...). */
function spiaPool(array $settings): array {
    $pool = [];
    foreach (spiaLocationsData()['locations'] as $id => $l) {
        if (in_array($l['cat'], $settings['packs'], true)) $pool[] = $id;
    }
    if (!empty($settings['custom'])) {
        foreach ($settings['custom_locations'] as $i => $_) $pool[] = 'c' . $i;
    }
    return $pool;
}

function spiaRoleCount(string $locId, array $settings): int {
    if (preg_match('/^c(\d+)$/', $locId, $m)) return count($settings['custom_locations'][(int)$m[1]]['roles'] ?? []);
    return spiaLocationsData()['locations'][$locId]['roles'] ?? 0;
}

function spiaShuffle(array $a): array {
    for ($i = count($a) - 1; $i > 0; $i--) {
        $j = random_int(0, $i);
        [$a[$i], $a[$j]] = [$a[$j], $a[$i]];
    }
    return $a;
}

function spiaNewCode(PDO $db): string {
    $check = $db->prepare('SELECT 1 FROM spia_rooms WHERE code = :c');
    for ($try = 0; $try < 50; $try++) {
        $code = '';
        for ($i = 0; $i < 4; $i++) $code .= SPIA_CODE_ALPHABET[random_int(0, strlen(SPIA_CODE_ALPHABET) - 1)];
        $check->execute([':c' => $code]);
        if (!$check->fetchColumn()) return $code;
    }
    throw new RuntimeException('Could not allocate a room code');
}

function spiaTokenHash(string $token): string {
    return hash('sha256', $token);
}

function spiaBump(PDO $db, int $roomId): void {
    $db->prepare('UPDATE spia_rooms SET version = version + 1, updated_at = :t WHERE id = :id')
       ->execute([':t' => time(), ':id' => $roomId]);
}

function spiaRoom(PDO $db, int $roomId): ?array {
    $st = $db->prepare('SELECT * FROM spia_rooms WHERE id = :id');
    $st->execute([':id' => $roomId]);
    return $st->fetch() ?: null;
}

function spiaRound(PDO $db, ?int $roundId): ?array {
    if (!$roundId) return null;
    $st = $db->prepare('SELECT * FROM spia_rounds WHERE id = :id');
    $st->execute([':id' => $roundId]);
    $r = $st->fetch();
    if (!$r) return null;
    $r['rules'] = json_decode($r['rules'], true);
    $r['pool'] = json_decode($r['pool'], true);
    $r['log'] = json_decode($r['log'], true) ?: [];
    $r['result'] = $r['result'] ? json_decode($r['result'], true) : null;
    return $r;
}

function spiaPlayers(PDO $db, int $roomId): array {
    $st = $db->prepare('SELECT * FROM spia_players WHERE room_id = :r AND removed = 0 ORDER BY id');
    $st->execute([':r' => $roomId]);
    return $st->fetchAll();
}

function spiaAssignments(PDO $db, int $roundId): array {
    $st = $db->prepare('SELECT * FROM spia_assign WHERE round_id = :r');
    $st->execute([':r' => $roundId]);
    $out = [];
    foreach ($st->fetchAll() as $a) $out[(int)$a['player_id']] = $a;
    return $out;
}

function spiaAppendLog(PDO $db, array &$round, array $event): void {
    $round['log'][] = $event;
    $db->prepare('UPDATE spia_rounds SET log = :l WHERE id = :id')
       ->execute([':l' => json_encode($round['log']), ':id' => $round['id']]);
}

/** Number of spies for a new round, given the settings and how many players there are. */
function spiaDrawSpyCount(array $s, int $players): int {
    if ($s['spy_mode'] === 'range') {
        $min = min($s['spy_min'], $players);
        $max = min($s['spy_max'], $players);
        return random_int($min, max($min, $max));
    }
    return min($s['spies'], $players);
}

/** Start a new round: pick a location, deal roles, reset votes. Returns an error string or null. */
function spiaStartRound(PDO $db, array $room): ?string {
    $settings = spiaSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $players = spiaPlayers($db, (int)$room['id']);
    if (count($players) < 3) return 'need_players';

    $pool = spiaPool($settings);
    if (!$pool) return 'no_locations';
    $candidates = $pool;
    if ($settings['no_repeat']) {
        $recent = array_slice(json_decode($room['recent_locations'], true) ?: [], -$settings['no_repeat_n']);
        $fresh = array_values(array_diff($pool, $recent));
        if ($fresh) $candidates = $fresh;
    }
    $location = $candidates[random_int(0, count($candidates) - 1)];
    $roleCount = spiaRoleCount($location, $settings);

    $n = count($players);
    $spyCount = spiaDrawSpyCount($settings, $n);
    $countVisible = $settings['spy_mode'] === 'fixed' || $settings['show_count'];
    $rules = [
        'vote' => $settings['vote'], 'guess' => $settings['guess'], 'scores' => $settings['scores'],
        'timer' => $settings['timer'], 'timer_min' => $settings['timer_min'],
        'spy_hint' => $settings['spy_hint'], 'spy_list' => $settings['spy_list'],
        'count_visible' => $countVisible,
        // late joiners can only become spies while the count is secret, and within the range
        'late_spy_max' => $countVisible ? 0 : min($settings['spy_max'], SPIA_MAX_PLAYERS),
        'custom_locations' => $settings['custom_locations'],
    ];

    $shuffled = spiaShuffle($players);
    $spyIds = array_map(fn($p) => (int)$p['id'], array_slice($shuffled, 0, $spyCount));
    $starter = $players[random_int(0, $n - 1)];

    $roundNo = (int)$room['round_count'] + 1;
    $db->prepare('INSERT INTO spia_rounds (room_id, number, location_id, pool, rules, spy_count, deal_players, starter_player_id, started_at)
                  VALUES (:r, :n, :l, :p, :ru, :sc, :dp, :st, :t)')
       ->execute([':r' => $room['id'], ':n' => $roundNo, ':l' => $location, ':p' => json_encode($pool),
                  ':ru' => json_encode($rules), ':sc' => $spyCount, ':dp' => $n, ':st' => $starter['id'], ':t' => time()]);
    $roundId = (int)$db->lastInsertId();

    // Civilians take distinct roles while they last; then roles repeat (unavoidable with big groups)
    $roles = spiaShuffle(range(0, $roleCount - 1));
    $used = [];
    $ins = $db->prepare('INSERT INTO spia_assign (round_id, player_id, is_spy, role, fake_role) VALUES (:r, :p, :s, :role, :fake)');
    $owners = [];
    foreach ($players as $p) {
        $isSpy = in_array((int)$p['id'], $spyIds, true);
        if ($isSpy) {
            if ((int)$p['is_owner'] === 1) $owners[] = (int)$p['id'];
            $ins->execute([':r' => $roundId, ':p' => $p['id'], ':s' => 1, ':role' => null, ':fake' => null]);
            continue;
        }
        $role = $roles ? array_pop($roles) : random_int(0, $roleCount - 1);
        $used[] = $role;
        $ins->execute([':r' => $roundId, ':p' => $p['id'], ':s' => 0, ':role' => $role, ':fake' => null]);
    }
    foreach ($owners as $pid) spiaGiveFakeRole($db, $roundId, $pid, $roleCount);

    $recent = json_decode($room['recent_locations'], true) ?: [];
    $recent[] = $location;
    $db->prepare('UPDATE spia_rooms SET round_id = :rid, round_count = :n, recent_locations = :rl WHERE id = :id')
       ->execute([':rid' => $roundId, ':n' => $roundNo, ':rl' => json_encode(array_slice($recent, -15)), ':id' => $room['id']]);
    return null;
}

/** Roles of this round nobody holds yet (real civilian roles and fake ones). */
function spiaFreeRoles(PDO $db, int $roundId, int $roleCount): array {
    $taken = [];
    foreach (spiaAssignments($db, $roundId) as $a) {
        if ($a['role'] !== null) $taken[] = (int)$a['role'];
        if ($a['fake_role'] !== null) $taken[] = (int)$a['fake_role'];
    }
    return array_values(array_diff(range(0, $roleCount - 1), $taken));
}

function spiaGiveFakeRole(PDO $db, int $roundId, int $playerId, int $roleCount): void {
    $free = spiaFreeRoles($db, $roundId, $roleCount);
    $fake = $free ? $free[random_int(0, count($free) - 1)] : random_int(0, $roleCount - 1);
    $db->prepare('UPDATE spia_assign SET fake_role = :f WHERE round_id = :r AND player_id = :p')
       ->execute([':f' => $fake, ':r' => $roundId, ':p' => $playerId]);
}

/** A player who joins while a round is running gets dealt in immediately. */
function spiaDealLate(PDO $db, array $round, array $player): void {
    $rules = $round['rules'];
    $roleCount = spiaRoleCount($round['location_id'], $rules);
    $isSpy = false;
    if ($rules['late_spy_max'] > (int)$round['spy_count'] && (int)$round['deal_players'] > 0) {
        // Same odds as the original deal, so a late joiner is not obviously "safe"
        $isSpy = random_int(1, (int)$round['deal_players']) <= max(1, (int)$round['spy_count']);
    }
    if ($isSpy) {
        $db->prepare('INSERT INTO spia_assign (round_id, player_id, is_spy) VALUES (:r, :p, 1)')
           ->execute([':r' => $round['id'], ':p' => $player['id']]);
        $db->prepare('UPDATE spia_rounds SET spy_count = spy_count + 1 WHERE id = :id')->execute([':id' => $round['id']]);
        if ((int)$player['is_owner'] === 1) spiaGiveFakeRole($db, (int)$round['id'], (int)$player['id'], $roleCount);
        return;
    }
    $free = spiaFreeRoles($db, (int)$round['id'], $roleCount);
    $role = $free ? $free[random_int(0, count($free) - 1)] : random_int(0, $roleCount - 1);
    $db->prepare('INSERT INTO spia_assign (round_id, player_id, is_spy, role) VALUES (:r, :p, 0, :role)')
       ->execute([':r' => $round['id'], ':p' => $player['id'], ':role' => $role]);
}

/** Living (not voted out / not left) players of the round who are still in the room. */
function spiaAlive(PDO $db, array $round): array {
    $st = $db->prepare('SELECT a.* FROM spia_assign a JOIN spia_players p ON p.id = a.player_id
                        WHERE a.round_id = :r AND a.out_reason IS NULL AND p.removed = 0');
    $st->execute([':r' => $round['id']]);
    $out = [];
    foreach ($st->fetchAll() as $a) $out[(int)$a['player_id']] = $a;
    return $out;
}

function spiaAliveSpies(PDO $db, array $round): int {
    return count(array_filter(spiaAlive($db, $round), fn($a) => (int)$a['is_spy'] === 1));
}

/**
 * Finish the round. $winner: spies | civilians | none | host.
 * Scores (if on): civilians +1 each when they win; surviving spies +2, a spy who guessed right +1 more.
 */
function spiaEndRound(PDO $db, array $room, array $round, string $winner, string $reason, array $extra = []): void {
    $assign = spiaAssignments($db, (int)$round['id']);
    $spies = array_keys(array_filter($assign, fn($a) => (int)$a['is_spy'] === 1));
    if ($winner === 'spies' && !$spies) $winner = 'none';

    if (!empty($round['rules']['scores']) && in_array($winner, ['spies', 'civilians'], true)) {
        $add = $db->prepare('UPDATE spia_players SET score = score + :d WHERE id = :id AND removed = 0');
        foreach ($assign as $pid => $a) {
            $d = 0;
            if ($winner === 'civilians' && (int)$a['is_spy'] === 0) $d = 1;
            if ($winner === 'spies' && (int)$a['is_spy'] === 1 && $a['out_reason'] === null) {
                $d = 2 + ((int)($extra['guesser'] ?? 0) === $pid ? 1 : 0);
            }
            if ($d) $add->execute([':d' => $d, ':id' => $pid]);
        }
    }

    $roles = [];
    foreach ($assign as $pid => $a) $roles[$pid] = (int)$a['is_spy'] === 1 ? null : (int)$a['role'];
    $result = array_merge([
        'winner' => $winner, 'reason' => $reason,
        'location_id' => $round['location_id'],
        'spies' => array_values($spies),
        'roles' => $roles,
    ], $extra);
    $db->prepare("UPDATE spia_rounds SET status = 'ended', vote_open = 0, timer_ends = NULL, result = :res, ended_at = :t WHERE id = :id")
       ->execute([':res' => json_encode($result), ':t' => time(), ':id' => $round['id']]);
}

/** Mark a player out of the round (voted out or wrong guess). */
function spiaEliminate(PDO $db, array $round, int $playerId, string $why): void {
    $db->prepare('UPDATE spia_assign SET out_reason = :w WHERE round_id = :r AND player_id = :p')
       ->execute([':w' => $why, ':r' => $round['id'], ':p' => $playerId]);
}

function spiaOpenVote(PDO $db, array &$round, bool $forced): void {
    $db->prepare('UPDATE spia_rounds SET vote_no = vote_no + 1, vote_open = 1, vote_forced = :f WHERE id = :id')
       ->execute([':f' => $forced ? 1 : 0, ':id' => $round['id']]);
    $round['vote_no'] = (int)$round['vote_no'] + 1;
    $round['vote_open'] = 1;
    $round['vote_forced'] = $forced ? 1 : 0;
}

/** Count the current vote and apply it. Ends the round when the vote settles it. */
function spiaResolveVote(PDO $db, array $room, array $round): void {
    $st = $db->prepare('SELECT target_id, COUNT(*) AS n FROM spia_votes WHERE round_id = :r AND vote_no = :v GROUP BY target_id ORDER BY n DESC');
    $st->execute([':r' => $round['id'], ':v' => $round['vote_no']]);
    $tally = $st->fetchAll();
    $forced = (int)$round['vote_forced'] === 1;
    $db->prepare('UPDATE spia_rounds SET vote_open = 0, vote_forced = 0 WHERE id = :id')->execute([':id' => $round['id']]);
    $round['vote_open'] = 0;

    $counts = [];
    foreach ($tally as $t) $counts[(string)$t['target_id']] = (int)$t['n'];
    $tie = !$tally || (count($tally) > 1 && (int)$tally[0]['n'] === (int)$tally[1]['n']);
    if ($tie) {
        spiaAppendLog($db, $round, ['t' => 'tie', 'vote' => (int)$round['vote_no'], 'counts' => $counts]);
        if ($forced) spiaEndRound($db, $room, $round, 'spies', 'final_tie');
        return;
    }

    $target = (int)$tally[0]['target_id'];
    if ($target === SPIA_NO_SPIES) {
        $left = spiaAliveSpies($db, $round);
        spiaAppendLog($db, $round, ['t' => 'no_spies', 'vote' => (int)$round['vote_no'], 'counts' => $counts]);
        spiaEndRound($db, $room, $round, $left === 0 ? 'civilians' : 'spies', $left === 0 ? 'no_spies_right' : 'no_spies_wrong');
        return;
    }

    $assign = spiaAssignments($db, (int)$round['id']);
    $isSpy = (int)($assign[$target]['is_spy'] ?? 0) === 1;
    spiaEliminate($db, $round, $target, 'vote');
    spiaAppendLog($db, $round, ['t' => 'out', 'p' => $target, 'spy' => $isSpy, 'why' => 'vote', 'vote' => (int)$round['vote_no'], 'counts' => $counts]);

    if (!$isSpy) {
        spiaEndRound($db, $room, $round, 'spies', 'innocent_out', ['out' => $target]);
    } elseif ($forced) {
        spiaEndRound($db, $room, $round, 'civilians', 'final_caught', ['out' => $target]);
    } elseif (!empty($round['rules']['count_visible']) && spiaAliveSpies($db, $round) === 0) {
        spiaEndRound($db, $room, $round, 'civilians', 'all_caught');
    }
}

/** Resolve the vote once every living player has voted. */
function spiaMaybeCloseVote(PDO $db, array $room, array $round): void {
    if ((int)$round['vote_open'] !== 1) return;
    $alive = spiaAlive($db, $round);
    $st = $db->prepare('SELECT voter_id FROM spia_votes WHERE round_id = :r AND vote_no = :v');
    $st->execute([':r' => $round['id'], ':v' => $round['vote_no']]);
    $voted = array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN));
    if (!array_diff(array_keys($alive), $voted)) spiaResolveVote($db, $room, $round);
}

/** Housekeeping done on polls: start the timer once everybody has seen their card, final vote at 0:00, host failover. */
function spiaTick(PDO $db, array $room): bool {
    $changed = false;
    $now = time();
    $round = spiaRound($db, $room['round_id'] ? (int)$room['round_id'] : null);
    if ($round && $round['status'] === 'play' && !empty($round['rules']['timer'])
        && $round['timer_ends'] !== null && $now >= (int)$round['timer_ends'] && (int)$round['vote_open'] === 0) {
        $db->prepare('UPDATE spia_rounds SET timer_ends = NULL WHERE id = :id')->execute([':id' => $round['id']]);
        if (!empty($round['rules']['vote'])) {
            spiaOpenVote($db, $round, true);
            spiaAppendLog($db, $round, ['t' => 'time_up']);
        } else {
            spiaAppendLog($db, $round, ['t' => 'time_up']);
        }
        $changed = true;
    }

    // Host failover: the phone that has been in the room the longest among the online ones
    $st = $db->prepare('SELECT id, last_seen FROM spia_devices WHERE room_id = :r ORDER BY joined_at, id');
    $st->execute([':r' => $room['id']]);
    $devices = $st->fetchAll();
    $host = null;
    foreach ($devices as $d) if ((int)$d['id'] === (int)$room['host_device_id']) $host = $d;
    if (!$host || $now - (int)$host['last_seen'] > SPIA_HOST_TIMEOUT) {
        foreach ($devices as $d) {
            if ((int)$d['id'] !== (int)($host['id'] ?? 0) && $now - (int)$d['last_seen'] <= SPIA_OFFLINE_AFTER) {
                $db->prepare('UPDATE spia_rooms SET host_device_id = :d WHERE id = :id')->execute([':d' => $d['id'], ':id' => $room['id']]);
                $changed = true;
                break;
            }
        }
    }
    if ($changed) spiaBump($db, (int)$room['id']);
    return $changed;
}

/** Remove a phone and its players (leave or kick). Deletes the room when it was the last one. */
function spiaRemoveDevice(PDO $db, array $room, int $deviceId): void {
    $round = spiaRound($db, $room['round_id'] ? (int)$room['round_id'] : null);
    $st = $db->prepare('SELECT id FROM spia_players WHERE device_id = :d AND removed = 0');
    $st->execute([':d' => $deviceId]);
    foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $pid) spiaRemovePlayer($db, $room, $round, (int)$pid);
    $db->prepare('DELETE FROM spia_devices WHERE id = :d')->execute([':d' => $deviceId]);

    $left = $db->prepare('SELECT COUNT(*) FROM spia_devices WHERE room_id = :r');
    $left->execute([':r' => $room['id']]);
    if ((int)$left->fetchColumn() === 0) {
        spiaDeleteRooms($db, [(int)$room['id']]);
        return;
    }
    if ((int)$room['host_device_id'] === $deviceId) {
        $next = $db->prepare('SELECT id FROM spia_devices WHERE room_id = :r ORDER BY last_seen DESC, joined_at LIMIT 1');
        $next->execute([':r' => $room['id']]);
        $db->prepare('UPDATE spia_rooms SET host_device_id = :d WHERE id = :id')->execute([':d' => $next->fetchColumn(), ':id' => $room['id']]);
    }
}

function spiaRemovePlayer(PDO $db, array $room, ?array $round, int $playerId): void {
    $db->prepare('UPDATE spia_players SET removed = 1 WHERE id = :id')->execute([':id' => $playerId]);
    if ($round && $round['status'] === 'play') {
        $db->prepare("UPDATE spia_assign SET out_reason = 'left' WHERE round_id = :r AND player_id = :p AND out_reason IS NULL")
           ->execute([':r' => $round['id'], ':p' => $playerId]);
        spiaMaybeCloseVote($db, $room, $round);
    }
}

function spiaDeleteRooms(PDO $db, array $roomIds): void {
    if (!$roomIds) return;
    $in = implode(',', array_map('intval', $roomIds));
    $db->exec("DELETE FROM spia_votes WHERE round_id IN (SELECT id FROM spia_rounds WHERE room_id IN ($in))");
    $db->exec("DELETE FROM spia_assign WHERE round_id IN (SELECT id FROM spia_rounds WHERE room_id IN ($in))");
    $db->exec("DELETE FROM spia_rounds WHERE room_id IN ($in)");
    $db->exec("DELETE FROM spia_players WHERE room_id IN ($in)");
    $db->exec("DELETE FROM spia_devices WHERE room_id IN ($in)");
    $db->exec("DELETE FROM spia_rooms WHERE id IN ($in)");
}

function spiaPruneRooms(PDO $db): void {
    $st = $db->prepare('SELECT id FROM spia_rooms WHERE updated_at < :t');
    $st->execute([':t' => time() - SPIA_ROOM_TTL]);
    spiaDeleteRooms($db, array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN)));
}

/**
 * What one phone is allowed to see. Cards only for the players on this phone.
 * $adminSession: the request comes from a logged-in admin; only then the owner's real status is marked.
 */
function spiaView(PDO $db, array $room, array $device, bool $adminSession): array {
    $now = time();
    $settings = spiaSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $players = spiaPlayers($db, (int)$room['id']);
    $st = $db->prepare('SELECT id, last_seen FROM spia_devices WHERE room_id = :r ORDER BY joined_at, id');
    $st->execute([':r' => $room['id']]);

    $devices = [];
    foreach ($st->fetchAll() as $d) {
        $devices[] = [
            'id' => (int)$d['id'],
            'online' => $now - (int)$d['last_seen'] <= SPIA_OFFLINE_AFTER,
            'host' => (int)$d['id'] === (int)$room['host_device_id'],
            'players' => array_values(array_map(fn($p) => (int)$p['id'],
                array_filter($players, fn($p) => (int)$p['device_id'] === (int)$d['id']))),
        ];
    }

    $view = [
        'success' => true,
        'now' => $now,
        'code' => $room['code'],
        'version' => (int)$room['version'],
        'device_id' => (int)$device['id'],
        'is_host' => (int)$device['id'] === (int)$room['host_device_id'],
        'settings' => $settings,
        'devices' => $devices,
        'players' => array_map(fn($p) => [
            'id' => (int)$p['id'], 'name' => $p['name'], 'device_id' => (int)$p['device_id'], 'score' => (int)$p['score'],
        ], $players),
        'round' => null,
        'cards' => [],
    ];

    $round = spiaRound($db, $room['round_id'] ? (int)$room['round_id'] : null);
    if (!$round) return $view;

    $assign = spiaAssignments($db, (int)$round['id']);
    $allSeen = true;
    foreach ($players as $p) {
        $a = $assign[(int)$p['id']] ?? null;
        if ($a && $a['out_reason'] === null && (int)$a['seen'] === 0) $allSeen = false;
    }
    $votedSt = $db->prepare('SELECT voter_id FROM spia_votes WHERE round_id = :r AND vote_no = :v');
    $votedSt->execute([':r' => $round['id'], ':v' => $round['vote_no']]);

    $rules = $round['rules'];
    $view['round'] = [
        'number' => (int)$round['number'],
        'status' => $round['status'],
        'rules' => array_diff_key($rules, ['late_spy_max' => 1, 'custom_locations' => 1]),
        'custom_locations' => $rules['custom_locations'],
        'spy_count' => !empty($rules['count_visible']) ? (int)$round['spy_count'] : null,
        'pool' => !empty($rules['spy_list']) || !empty($rules['guess']) ? $round['pool'] : [],
        'all_seen' => $allSeen,
        'starter' => $allSeen ? (int)$round['starter_player_id'] : null,
        'timer_ends' => $round['timer_ends'] !== null ? (int)$round['timer_ends'] : null,
        'vote' => [
            'open' => (int)$round['vote_open'] === 1,
            'no' => (int)$round['vote_no'],
            'forced' => (int)$round['vote_forced'] === 1,
            'voted' => (int)$round['vote_open'] === 1 ? array_map('intval', $votedSt->fetchAll(PDO::FETCH_COLUMN)) : [],
        ],
        'in_round' => array_map('intval', array_keys($assign)),
        'out' => array_values(array_map(fn($a) => (int)$a['player_id'],
            array_filter($assign, fn($a) => $a['out_reason'] !== null && $a['out_reason'] !== 'left'))),
        'seen' => array_values(array_map(fn($a) => (int)$a['player_id'], array_filter($assign, fn($a) => (int)$a['seen'] === 1))),
        'log' => $round['log'],
        'result' => $round['result'],
    ];

    $hint = null;
    if (!empty($rules['spy_hint'])) {
        $hint = preg_match('/^c\d+$/', $round['location_id']) ? 'custom' : (spiaLocationsData()['locations'][$round['location_id']]['cat'] ?? null);
    }
    foreach ($players as $p) {
        if ((int)$p['device_id'] !== (int)$device['id']) continue;
        $a = $assign[(int)$p['id']] ?? null;
        if (!$a) continue;
        $card = ['player_id' => (int)$p['id'], 'seen' => (int)$a['seen'] === 1, 'out' => $a['out_reason']];
        if ((int)$a['is_spy'] === 1 && $adminSession && (int)$p['is_owner'] === 1 && $a['fake_role'] !== null) {
            // Looks exactly like a civilian card; `x` is only ever sent to the admin's own session
            $card += ['spy' => false, 'location_id' => $round['location_id'], 'role' => (int)$a['fake_role'], 'x' => 1];
        } elseif ((int)$a['is_spy'] === 1) {
            $card += ['spy' => true, 'hint' => $hint];
        } else {
            $card += ['spy' => false, 'location_id' => $round['location_id'], 'role' => (int)$a['role']];
        }
        $view['cards'][] = $card;
    }
    return $view;
}

/** Admin LIVE panel: every active room with the full truth. */
function spiaLiveView(PDO $db): array {
    $rooms = $db->query('SELECT * FROM spia_rooms WHERE updated_at > ' . (time() - SPIA_ROOM_TTL) . ' ORDER BY updated_at DESC LIMIT 30')->fetchAll();
    $out = [];
    $now = time();
    foreach ($rooms as $room) {
        $players = spiaPlayers($db, (int)$room['id']);
        $devSt = $db->prepare('SELECT id, last_seen FROM spia_devices WHERE room_id = :r');
        $devSt->execute([':r' => $room['id']]);
        $online = [];
        foreach ($devSt->fetchAll() as $d) $online[(int)$d['id']] = $now - (int)$d['last_seen'] <= SPIA_OFFLINE_AFTER;

        $round = spiaRound($db, $room['round_id'] ? (int)$room['round_id'] : null);
        $assign = $round ? spiaAssignments($db, (int)$round['id']) : [];
        $voted = [];
        if ($round && (int)$round['vote_open'] === 1) {
            $vs = $db->prepare('SELECT voter_id, target_id FROM spia_votes WHERE round_id = :r AND vote_no = :v');
            $vs->execute([':r' => $round['id'], ':v' => $round['vote_no']]);
            foreach ($vs->fetchAll() as $v) $voted[(int)$v['voter_id']] = (int)$v['target_id'];
        }
        $out[] = [
            'code' => $room['code'],
            'updated_at' => (int)$room['updated_at'],
            'phones' => count($online),
            'phones_online' => count(array_filter($online)),
            'settings' => json_decode($room['settings'], true),
            'round' => $round ? [
                'number' => (int)$round['number'], 'status' => $round['status'],
                'location_id' => $round['location_id'], 'spy_count' => (int)$round['spy_count'],
                'custom_locations' => $round['rules']['custom_locations'],
                'vote_open' => (int)$round['vote_open'] === 1, 'result' => $round['result'],
            ] : null,
            'players' => array_map(function ($p) use ($assign, $online, $voted) {
                $a = $assign[(int)$p['id']] ?? null;
                return [
                    'id' => (int)$p['id'], 'name' => $p['name'], 'score' => (int)$p['score'],
                    'me' => (int)$p['is_owner'] === 1,
                    'online' => $online[(int)$p['device_id']] ?? false,
                    'spy' => $a ? (int)$a['is_spy'] === 1 : null,
                    'role' => $a && $a['role'] !== null ? (int)$a['role'] : null,
                    'fake_role' => $a && $a['fake_role'] !== null ? (int)$a['fake_role'] : null,
                    'out' => $a['out_reason'] ?? null,
                    'voted_for' => $voted[(int)$p['id']] ?? null,
                ];
            }, $players),
        ];
    }
    return $out;
}
