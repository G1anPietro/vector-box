<?php
// public/api/spia.php
// "Who's the Spy" rooms. A phone is identified by the device token it got on create/join
// (header X-Spia-Device); no account is needed to play.
//
// Rooms host either game: "spia" (Who's the Spy) or "lupus" (werewolf, see lupus_lib.php).
// GET  ?action=state                  -> this phone's view of the room (polled every ~2s)
// POST {action: create|join|leave|kick|host|take|player_add|player_remove|settings|
//               start|seen|vote_call|vote|vote_close|guess|end|reset_scores, ...}
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/rate_limiter.php';
require_once __DIR__ . '/spia_lib.php';
require_once __DIR__ . '/lupus_lib.php';
require_once __DIR__ . '/cucu_lib.php';

initSession();
header('Cache-Control: no-store');

$isAdmin = !empty($_SESSION['is_admin']);
$method = $_SERVER['REQUEST_METHOD'];

function spiaFail(string $code, int $status = 400): void {
    jsonResponse(['success' => false, 'error' => $code], $status);
}

/** Anything a non-admin must not be able to tell apart from a typo. */
function spiaUnknown(): void {
    spiaFail('unknown_action');
}

/** Look up the calling phone. Touches last_seen (at most every 5s). */
function spiaDevice(PDO $db): array {
    $token = (string)($_SERVER['HTTP_X_SPIA_DEVICE'] ?? '');
    if (!preg_match('/^[a-f0-9]{48}$/', $token)) spiaFail('no_device', 401);
    $st = $db->prepare('SELECT * FROM spia_devices WHERE token_hash = :h');
    $st->execute([':h' => spiaTokenHash($token)]);
    $device = $st->fetch();
    if (!$device) spiaFail('gone', 404);
    if (time() - (int)$device['last_seen'] >= 5) {
        $db->prepare('UPDATE spia_devices SET last_seen = :t WHERE id = :id')->execute([':t' => time(), ':id' => $device['id']]);
        $device['last_seen'] = time();
    }
    return $device;
}

function spiaNewDevice(PDO $db, int $roomId): array {
    $token = bin2hex(random_bytes(24));
    $db->prepare('INSERT INTO spia_devices (room_id, token_hash, joined_at, last_seen) VALUES (:r, :h, :t, :t)')
       ->execute([':r' => $roomId, ':h' => spiaTokenHash($token), ':t' => time()]);
    return ['id' => (int)$db->lastInsertId(), 'token' => $token];
}

function spiaOwnPlayer(PDO $db, array $device, $playerId): array {
    $st = $db->prepare('SELECT * FROM spia_players WHERE id = :id AND device_id = :d AND removed = 0');
    $st->execute([':id' => (int)$playerId, ':d' => $device['id']]);
    $p = $st->fetch();
    if (!$p) spiaFail('not_your_player', 403);
    return $p;
}

/** Add a player to a phone. Admin sessions mark their first player as "the admin" (server-side only). */
function spiaAddPlayer(PDO $db, array $room, array $device, string $rawName, bool $isAdmin): void {
    $name = spiaCleanText($rawName, SPIA_NAME_MAX);
    if ($name === '') spiaFail('name_empty');
    $players = spiaPlayers($db, (int)$room['id']);
    if (count($players) >= SPIA_MAX_PLAYERS) spiaFail('room_full');
    foreach ($players as $p) {
        if (mb_strtolower_safe($p['name']) === mb_strtolower_safe($name)) spiaFail('name_taken');
    }
    $isOwner = 0;
    if ($isAdmin) {
        $hasOwner = false;
        foreach ($players as $p) if ((int)$p['is_owner'] === 1) $hasOwner = true;
        $isOwner = $hasOwner ? 0 : 1;
    }
    $db->prepare('INSERT INTO spia_players (room_id, device_id, name, is_owner, created_at) VALUES (:r, :d, :n, :o, :t)')
       ->execute([':r' => $room['id'], ':d' => $device['id'], ':n' => $name, ':o' => $isOwner, ':t' => time()]);
    $player = ['id' => (int)$db->lastInsertId(), 'is_owner' => $isOwner];

    $round = spiaRound($db, $room['round_id'] ? (int)$room['round_id'] : null);
    if ($round && $round['status'] === 'play') {
        spiaDealLate($db, $round, $player);
        spiaAppendLog($db, $round, ['t' => 'join', 'p' => $player['id']]);
    }
}

function mb_strtolower_safe(string $s): string {
    return function_exists('mb_strtolower') ? mb_strtolower($s, 'UTF-8') : strtolower($s);
}

try {
    $db = getDbConnection();
    $action = (string)($_GET['action'] ?? '');

    if ($method === 'GET') {
        if ($action === 'live') {
            if (!$isAdmin) spiaUnknown();
            jsonResponse(['success' => true, 'now' => time(), 'rooms' => spiaLiveView($db)]);
        }
        if ($action === 'ext') {
            if (!$isAdmin) spiaUnknown();
            header('Content-Type: application/javascript; charset=utf-8');
            readfile(dirname(__DIR__, 2) . '/lib/spia-admin.js');
            exit;
        }
        if ($action !== 'state') spiaUnknown();

        $db->exec('BEGIN IMMEDIATE');
        $device = spiaDevice($db);
        $room = spiaRoom($db, (int)$device['room_id']);
        if (spiaTick($db, $room)) $room = spiaRoom($db, (int)$room['id']);
        if ($room['game'] === 'lupus') {
            $g = lupusLoad($db, (int)$room['id']);
            if ($g && lupusTick($g)) {
                lupusSave($db, (int)$room['id'], $g);
                if ($g['status'] === 'ended') lupusAwardScores($db, $g);
                spiaBump($db, (int)$room['id']);
                $room = spiaRoom($db, (int)$room['id']);
            }
        }
        $view = spiaRoomView($db, $room, $device, $isAdmin);
        $db->exec('COMMIT');
        jsonResponse($view);
    }

    if ($method !== 'POST') spiaFail('method', 405);
    requireCsrf();
    $in = readJsonBody();
    $action = (string)($in['action'] ?? '');

    // --- Entering a room (no device yet) ---
    if ($action === 'create') {
        if (!checkRateLimit('spia_create', 10, 600)) spiaFail('slow_down', 429);
        $db->exec('BEGIN IMMEDIATE');
        spiaPruneRooms($db);
        $game = in_array($in['game'] ?? 'spia', ['lupus', 'cucu'], true) ? $in['game'] : 'spia';
        $rawSettings = is_array($in['settings'] ?? null) ? $in['settings'] : [];
        $settings = match ($game) {
            'lupus' => lupusSanitizeSettings($rawSettings, []),
            'cucu' => cucuSanitizeSettings($rawSettings, []),
            default => spiaSanitizeSettings($rawSettings, []),
        };
        $db->prepare('INSERT INTO spia_rooms (code, game, settings, created_at, updated_at) VALUES (:c, :g, :s, :t, :t)')
           ->execute([':c' => spiaNewCode($db), ':g' => $game, ':s' => json_encode($settings), ':t' => time()]);
        $roomId = (int)$db->lastInsertId();
        $dev = spiaNewDevice($db, $roomId);
        $db->prepare('UPDATE spia_rooms SET host_device_id = :d WHERE id = :id')->execute([':d' => $dev['id'], ':id' => $roomId]);
        $room = spiaRoom($db, $roomId);
        foreach (array_slice(is_array($in['players'] ?? null) ? $in['players'] : [], 0, SPIA_MAX_PLAYERS) as $name) {
            spiaAddPlayer($db, $room, ['id' => $dev['id']], (string)$name, $isAdmin);
        }
        $db->exec('COMMIT');
        jsonResponse(['success' => true, 'code' => $room['code'], 'token' => $dev['token'], 'game' => $room['game']]);
    }

    if ($action === 'join') {
        if (!checkRateLimit('spia_join', 30, 600)) spiaFail('slow_down', 429);
        $code = strtoupper(preg_replace('/[^A-Za-z]/', '', (string)($in['code'] ?? '')));
        $db->exec('BEGIN IMMEDIATE');
        $st = $db->prepare('SELECT * FROM spia_rooms WHERE code = :c');
        $st->execute([':c' => $code]);
        $room = $st->fetch();
        if (!$room) { $db->exec('ROLLBACK'); spiaFail('room_not_found', 404); }
        $n = $db->prepare('SELECT COUNT(*) FROM spia_devices WHERE room_id = :r');
        $n->execute([':r' => $room['id']]);
        if ((int)$n->fetchColumn() >= SPIA_MAX_DEVICES) { $db->exec('ROLLBACK'); spiaFail('room_full'); }
        $dev = spiaNewDevice($db, (int)$room['id']);
        spiaBump($db, (int)$room['id']);
        $db->exec('COMMIT');
        jsonResponse(['success' => true, 'code' => $room['code'], 'token' => $dev['token'], 'game' => $room['game']]);
    }

    // --- Everything else acts as a phone already in a room ---
    $db->exec('BEGIN IMMEDIATE');
    $device = spiaDevice($db);
    $room = spiaRoom($db, (int)$device['room_id']);
    $isHost = (int)$room['host_device_id'] === (int)$device['id'];
    $round = spiaRound($db, $room['round_id'] ? (int)$room['round_id'] : null);
    $playing = $round && $round['status'] === 'play';
    $fail = function (string $code, int $status = 400) use ($db) {
        $db->exec('ROLLBACK');
        spiaFail($code, $status);
    };
    $needHost = function () use ($isHost, $fail) { if (!$isHost) $fail('host_only', 403); };

    $handled = false;
    if ($room['game'] === 'cucu') {
        $r = cucuHandle($db, $room, $device, $isHost, $in, $action, $isAdmin);
        if (is_string($r)) $fail($r, in_array($r, ['host_only', 'not_your_player', 'not_your_turn'], true) ? 403 : 409);
        $handled = $r === true;
        if (!$handled && !in_array($action, ['leave', 'kick', 'host', 'take', 'player_add', 'player_remove', 'reset_scores', 'me'], true)) {
            $fail('unknown_action');
        }
    }
    if ($room['game'] === 'lupus') {
        $r = lupusHandle($db, $room, $device, $isHost, $in, $action);
        if (is_string($r)) $fail($r, in_array($r, ['host_only', 'not_your_player', 'you_are_out'], true) ? 403 : 409);
        $handled = $r === true;
        // Not a Lupus action: only the room actions shared by every game are allowed
        if (!$handled && !in_array($action, ['leave', 'kick', 'host', 'take', 'player_add', 'player_remove', 'reset_scores', 'me'], true)) {
            $fail('unknown_action');
        }
    }

    if (!$handled) switch ($action) {
        case 'leave':
            spiaRemoveDevice($db, $room, (int)$device['id']);
            break;

        case 'kick':
            $needHost();
            $target = (int)($in['device_id'] ?? 0);
            if ($target === (int)$device['id']) $fail('bad_target');
            $st = $db->prepare('SELECT 1 FROM spia_devices WHERE id = :d AND room_id = :r');
            $st->execute([':d' => $target, ':r' => $room['id']]);
            if (!$st->fetchColumn()) $fail('bad_target', 404);
            spiaRemoveDevice($db, $room, $target);
            break;

        case 'host':
            $needHost();
            $target = (int)($in['device_id'] ?? 0);
            $st = $db->prepare('SELECT 1 FROM spia_devices WHERE id = :d AND room_id = :r');
            $st->execute([':d' => $target, ':r' => $room['id']]);
            if (!$st->fetchColumn()) $fail('bad_target', 404);
            $db->prepare('UPDATE spia_rooms SET host_device_id = :d WHERE id = :id')->execute([':d' => $target, ':id' => $room['id']]);
            break;

        case 'take':
            // Move the players of an offline phone onto this one
            $target = (int)($in['device_id'] ?? 0);
            $st = $db->prepare('SELECT * FROM spia_devices WHERE id = :d AND room_id = :r');
            $st->execute([':d' => $target, ':r' => $room['id']]);
            $other = $st->fetch();
            if (!$other || $target === (int)$device['id']) $fail('bad_target', 404);
            if (time() - (int)$other['last_seen'] <= SPIA_OFFLINE_AFTER) $fail('still_online', 409);
            $db->prepare('UPDATE spia_players SET device_id = :me WHERE device_id = :d AND removed = 0')
               ->execute([':me' => $device['id'], ':d' => $target]);
            if ((int)$room['host_device_id'] === $target) {
                $db->prepare('UPDATE spia_rooms SET host_device_id = :me WHERE id = :id')->execute([':me' => $device['id'], ':id' => $room['id']]);
            }
            break;

        case 'player_add':
            spiaAddPlayer($db, $room, $device, (string)($in['name'] ?? ''), $isAdmin);
            break;

        case 'player_remove':
            $pid = (int)($in['player_id'] ?? 0);
            $st = $db->prepare('SELECT device_id FROM spia_players WHERE id = :id AND room_id = :r AND removed = 0');
            $st->execute([':id' => $pid, ':r' => $room['id']]);
            $owner = $st->fetchColumn();
            if ($owner === false) $fail('bad_target', 404);
            if ((int)$owner !== (int)$device['id'] && !$isHost) $fail('not_your_player', 403);
            spiaRemovePlayer($db, $room, $round, $pid);
            break;

        case 'me':
            // Admin only, and indistinguishable from a typo for everybody else
            if (!$isAdmin) $fail('unknown_action');
            $p = spiaOwnPlayer($db, $device, $in['player_id'] ?? 0);
            $db->prepare('UPDATE spia_players SET is_owner = 0 WHERE room_id = :r')->execute([':r' => $room['id']]);
            $db->prepare('UPDATE spia_players SET is_owner = 1 WHERE id = :id')->execute([':id' => $p['id']]);
            // no version bump: nothing visible changes for the other phones
            $db->exec('COMMIT');
            jsonResponse(['success' => true]);

        case 'settings':
            $needHost();
            $current = json_decode($room['settings'], true) ?: [];
            $new = spiaSanitizeSettings(is_array($in['settings'] ?? null) ? $in['settings'] : [], $current);
            $db->prepare('UPDATE spia_rooms SET settings = :s WHERE id = :id')->execute([':s' => json_encode($new), ':id' => $room['id']]);
            break;

        case 'start':
            $needHost();
            if ($playing) $fail('round_running', 409);
            $err = spiaStartRound($db, $room);
            if ($err) $fail($err);
            break;

        case 'end':
            $needHost();
            if (!$playing) $fail('no_round', 409);
            spiaEndRound($db, $room, $round, 'host', 'host_ended');
            break;

        case 'seen':
            if (!$round) $fail('no_round', 409);
            $p = spiaOwnPlayer($db, $device, $in['player_id'] ?? 0);
            $db->prepare('UPDATE spia_assign SET seen = 1 WHERE round_id = :r AND player_id = :p')
               ->execute([':r' => $round['id'], ':p' => $p['id']]);
            // Timer starts once every living player has looked at their card (only once per round)
            if ($playing && !empty($round['rules']['timer']) && !in_array('timer', array_column($round['log'], 't'), true)) {
                $st = $db->prepare('SELECT COUNT(*) FROM spia_assign a JOIN spia_players pl ON pl.id = a.player_id
                                    WHERE a.round_id = :r AND a.seen = 0 AND a.out_reason IS NULL AND pl.removed = 0');
                $st->execute([':r' => $round['id']]);
                if ((int)$st->fetchColumn() === 0) {
                    $db->prepare('UPDATE spia_rounds SET timer_ends = :e WHERE id = :id')
                       ->execute([':e' => time() + 60 * (int)$round['rules']['timer_min'], ':id' => $round['id']]);
                    spiaAppendLog($db, $round, ['t' => 'timer']);
                }
            }
            break;

        case 'vote_call':
            if (!$playing || empty($round['rules']['vote'])) $fail('no_round', 409);
            if ((int)$round['vote_open'] === 1) $fail('vote_open', 409);
            spiaOpenVote($db, $round, false);
            spiaAppendLog($db, $round, ['t' => 'vote', 'vote' => (int)$round['vote_no']]);
            break;

        case 'vote':
            if (!$playing || (int)$round['vote_open'] !== 1) $fail('no_vote', 409);
            $p = spiaOwnPlayer($db, $device, $in['player_id'] ?? 0);
            $alive = spiaAlive($db, $round);
            if (!isset($alive[(int)$p['id']])) $fail('you_are_out', 403);
            $target = (int)($in['target'] ?? -1);
            if ($target !== SPIA_NO_SPIES && (!isset($alive[$target]) || $target === (int)$p['id'])) $fail('bad_target');
            $db->prepare('INSERT OR REPLACE INTO spia_votes (round_id, vote_no, voter_id, target_id) VALUES (:r, :v, :p, :t)')
               ->execute([':r' => $round['id'], ':v' => $round['vote_no'], ':p' => $p['id'], ':t' => $target]);
            spiaMaybeCloseVote($db, $room, $round);
            break;

        case 'vote_close':
            // Host can count the votes cast so far (e.g. a phone went offline mid-vote)
            $needHost();
            if (!$playing || (int)$round['vote_open'] !== 1) $fail('no_vote', 409);
            spiaResolveVote($db, $room, $round);
            break;

        case 'guess':
            if (!$playing || empty($round['rules']['guess'])) $fail('no_round', 409);
            $p = spiaOwnPlayer($db, $device, $in['player_id'] ?? 0);
            $alive = spiaAlive($db, $round);
            $a = $alive[(int)$p['id']] ?? null;
            if (!$a) $fail('you_are_out', 403);
            if ((int)$a['is_spy'] !== 1) {
                // Answer privately, change nothing
                $db->exec('ROLLBACK');
                jsonResponse(['success' => true, 'not_spy' => true]);
            }
            $loc = (string)($in['location_id'] ?? '');
            if (!in_array($loc, $round['pool'], true)) $fail('bad_target');
            if ($loc === $round['location_id']) {
                spiaAppendLog($db, $round, ['t' => 'guess', 'p' => (int)$p['id'], 'loc' => $loc, 'ok' => true]);
                spiaEndRound($db, $room, $round, 'spies', 'guess_right', ['guesser' => (int)$p['id'], 'guess' => $loc]);
            } else {
                spiaEliminate($db, $round, (int)$p['id'], 'guess');
                spiaAppendLog($db, $round, ['t' => 'guess', 'p' => (int)$p['id'], 'loc' => $loc, 'ok' => false]);
                if (!empty($round['rules']['count_visible']) && spiaAliveSpies($db, $round) === 0) {
                    spiaEndRound($db, $room, $round, 'civilians', 'all_caught');
                } else {
                    spiaMaybeCloseVote($db, $room, $round);
                }
            }
            break;

        case 'reset_scores':
            $needHost();
            $db->prepare('UPDATE spia_players SET score = 0 WHERE room_id = :r')->execute([':r' => $room['id']]);
            break;

        default:
            $fail('unknown_action');
    }

    $roomStillThere = spiaRoom($db, (int)$room['id']);
    if ($roomStillThere) spiaBump($db, (int)$room['id']);
    $db->exec('COMMIT');

    if ($action === 'leave' || !$roomStillThere) jsonResponse(['success' => true, 'left' => true]);
    jsonResponse(spiaRoomView($db, spiaRoom($db, (int)$room['id']), $device, $isAdmin));
} catch (Throwable $e) {
    if (isset($db)) {
        try { $db->exec('ROLLBACK'); } catch (Throwable $ignored) { /* no open transaction */ }
    }
    failInternal('SPIA', $e);
}
