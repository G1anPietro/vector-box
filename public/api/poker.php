<?php
// public/api/poker.php
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/poker_stats.php';
require_once __DIR__ . '/rate_limiter.php';

initSession();
header('Content-Type: application/json');

$action = $_GET['action'] ?? $_POST['action'] ?? 'state';

// Every request that mutates game state must carry the CSRF token
if ($action !== 'state' || $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
}
$inputTarget = trim($_REQUEST['table_id'] ?? 'general');
$username = $_SESSION['username'];
$userId = $_SESSION['user_id'] ?? null;

$db = getDbConnection();

// Resolve room by ID or Room Code
$stmt = $db->prepare("SELECT * FROM poker_tables WHERE id = :t OR room_code = :c");
$stmt->execute([':t' => strtolower($inputTarget), ':c' => strtoupper($inputTarget)]);   // ids are stored lower case, codes upper case
$table = $stmt->fetch();

if (!$table && $action !== 'create_room') {
    $tableId = 'general';
    $stmt = $db->prepare("SELECT * FROM poker_tables WHERE id = 'general'");
    $stmt->execute();
    $table = $stmt->fetch();
    if (!$table) {
        $db->exec("INSERT INTO poker_tables (id, room_code, creator_username, max_players, bot_count, pot, current_bet, game_stage) VALUES ('general', 'GENERAL', 'system', 4, 1, 0, 0, 'waiting')");
        $stmt = $db->prepare("SELECT * FROM poker_tables WHERE id = 'general'");
        $stmt->execute();
        $table = $stmt->fetch();
    }
} else if ($table) {
    $tableId = $table['id'];
}

/** Category and tie-break ranks of exactly five cards, as a comparable list: [category, r1, r2, ...] (higher is better). */
function scoreFive(array $cards): array {
    $valMap = ['2'=>2,'3'=>3,'4'=>4,'5'=>5,'6'=>6,'7'=>7,'8'=>8,'9'=>9,'10'=>10,'J'=>11,'Q'=>12,'K'=>13,'A'=>14];
    $ranks = []; $suits = [];
    foreach ($cards as $c) {
        $ranks[] = $valMap[substr($c, 0, -1)] ?? 0;
        $suits[substr($c, -1)] = true;
    }
    rsort($ranks);
    $flush = count($suits) === 1;
    $uniq = array_values(array_unique($ranks));
    $straightHigh = 0;
    if (count($uniq) === 5) {
        if ($uniq[0] - $uniq[4] === 4) $straightHigh = $uniq[0];
        elseif ($uniq === [14, 5, 4, 3, 2]) $straightHigh = 5;   // the wheel: A-2-3-4-5
    }
    $counts = array_count_values($ranks);
    // groups ordered by size, then by rank: the tie-break order of paired hands
    uksort($counts, fn($a, $b) => $counts[$b] <=> $counts[$a] ?: $b <=> $a);
    $groups = array_keys($counts);
    $sizes = array_values($counts);
    if ($flush && $straightHigh) return [8, $straightHigh];
    if ($sizes[0] === 4) return [7, ...$groups];
    if ($sizes[0] === 3 && ($sizes[1] ?? 0) === 2) return [6, ...$groups];
    if ($flush) return [5, ...$ranks];
    if ($straightHigh) return [4, $straightHigh];
    if ($sizes[0] === 3) return [3, ...$groups];
    if ($sizes[0] === 2 && ($sizes[1] ?? 0) === 2) return [2, ...$groups];
    if ($sizes[0] === 2) return [1, ...$groups];
    return [0, ...$ranks];
}

/** Best five of the (up to seven) cards. 'key' is comparable with compareHands(); 'score' is the category 0-8. */
function evaluateHand($holeCards, $communityCards) {
    $names = ['High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];
    $all = array_values(array_filter(array_merge($holeCards, $communityCards), fn($c) => $c !== '??'));
    $n = count($all);
    if ($n < 5) return ['score' => 0, 'name' => 'High Card', 'key' => [0]];
    $best = null;
    for ($a = 0; $a < $n - 4; $a++) for ($b = $a + 1; $b < $n - 3; $b++) for ($c = $b + 1; $c < $n - 2; $c++)
        for ($d = $c + 1; $d < $n - 1; $d++) for ($e = $d + 1; $e < $n; $e++) {
            $k = scoreFive([$all[$a], $all[$b], $all[$c], $all[$d], $all[$e]]);
            if ($best === null || compareHands($k, $best) > 0) $best = $k;
        }
    return ['score' => $best[0], 'name' => $names[$best[0]], 'key' => $best];
}

function compareHands(array $x, array $y): int {
    for ($i = 0, $n = max(count($x), count($y)); $i < $n; $i++) {
        if (($x[$i] ?? 0) !== ($y[$i] ?? 0)) return ($x[$i] ?? 0) <=> ($y[$i] ?? 0);
    }
    return 0;
}

function advanceStage($db, $tableId, &$table) {
    $community = json_decode($table['community_cards'], true) ?: [];

    // Turn/river come from the cards NOT already in play (community + every hole card),
    // otherwise duplicates like two Ah could appear. CSPRNG shuffle, like the deal.
    $inPlay = $community;
    $stmtHoles = $db->prepare("SELECT hole_cards FROM poker_players WHERE table_id = :tid");
    $stmtHoles->execute([':tid' => $tableId]);
    foreach ($stmtHoles->fetchAll(PDO::FETCH_COLUMN) as $holes) {
        $inPlay = array_merge($inPlay, json_decode($holes, true) ?: []);
    }
    $fullDeck = array_values(array_diff([
        '2h','3h','4h','5h','6h','7h','8h','9h','10h','Jh','Qh','Kh','Ah',
        '2d','3d','4d','5d','6d','7d','8d','9d','10d','Jd','Qd','Kd','Ad',
        '2c','3c','4c','5c','6c','7c','8c','9c','10c','Jc','Qc','Kc','Ac',
        '2s','3s','4s','5s','6s','7s','8s','9s','10s','Js','Qs','Ks','As'
    ], $inPlay));
    secureShuffle($fullDeck);

    if ($table['game_stage'] === 'flop') {
        $community[] = array_pop($fullDeck);
        $stage = 'turn';
    } elseif ($table['game_stage'] === 'turn') {
        $community[] = array_pop($fullDeck);
        $stage = 'river';
    } elseif ($table['game_stage'] === 'river') {
        $stage = 'showdown';
    } else {
        return;
    }

    $upd = $db->prepare("UPDATE poker_tables SET community_cards = :c, game_stage = :s, current_bet = 0 WHERE id = :tid");
    $upd->execute([':c' => json_encode($community), ':s' => $stage, ':tid' => $tableId]);

    $db->prepare("UPDATE poker_players SET current_bet = 0 WHERE table_id = :tid")->execute([':tid' => $tableId]);

    if ($stage === 'showdown') {
        resolveWinner($db, $tableId, $community);
    }
}

function resolveWinner($db, $tableId, $community) {
    $stmt = $db->prepare("SELECT * FROM poker_players WHERE table_id = :tid AND is_folded = 0");
    $stmt->execute([':tid' => $tableId]);
    $activePlayers = $stmt->fetchAll();

    $stmtTable = $db->prepare("SELECT pot FROM poker_tables WHERE id = :tid");
    $stmtTable->execute([':tid' => $tableId]);
    $pot = (int)$stmtTable->fetchColumn();

    // Everyone dealt into the hand (folded too) counts as having played it
    $stmtAll = $db->prepare("SELECT id, user_id, username, is_bot FROM poker_players WHERE table_id = :tid");
    $stmtAll->execute([':tid' => $tableId]);
    $handPlayers = $stmtAll->fetchAll();

    if (count($activePlayers) === 1) {
        $winner = $activePlayers[0];
        $db->prepare("UPDATE poker_players SET chips = chips + :pot WHERE id = :id")->execute([':pot' => $pot, ':id' => $winner['id']]);
        $msg = "{$winner['username']} won {$pot} CR (Everyone else folded)!";
    } else {
        $bestKey = null;
        $winners = [];
        $winningCombo = "";

        foreach ($activePlayers as $p) {
            $holes = json_decode($p['hole_cards'], true) ?: [];
            if (count($holes) < 2) continue;   // joined during the hand: no cards, no showdown
            $res = evaluateHand($holes, $community);
            $cmp = $bestKey === null ? 1 : compareHands($res['key'], $bestKey);
            if ($cmp > 0) { $bestKey = $res['key']; $winners = [$p]; $winningCombo = $res['name']; }
            elseif ($cmp === 0) $winners[] = $p;   // a true tie: the pot is split
        }
        $winner = $winners[0] ?? null;

        if ($winners) {
            $share = intdiv($pot, count($winners));
            $rest = $pot - $share * count($winners);
            foreach ($winners as $k => $w) {
                $db->prepare("UPDATE poker_players SET chips = chips + :pot WHERE id = :id")->execute([':pot' => $share + ($k === 0 ? $rest : 0), ':id' => $w['id']]);
            }
            $msg = count($winners) > 1
                ? 'SPLIT POT ' . $pot . ' CR (' . implode(', ', array_column($winners, 'username')) . ') WITH A ' . strtoupper($winningCombo) . '!'
                : "{$winner['username']} WON {$pot} CR WITH A {$winningCombo}!";
        } else {
            $msg = "SHOWDOWN COMPLETE!";
        }
    }

    $db->prepare("UPDATE poker_tables SET pot = 0, last_winner_msg = :m WHERE id = :tid")->execute([':m' => $msg, ':tid' => $tableId]);
    recordHandResult($db, $handPlayers, $winner ?? null, $pot);
}

/** Fisher-Yates with a CSPRNG (PHP's shuffle() is predictable). */
function secureShuffle(array &$items): void {
    for ($i = count($items) - 1; $i > 0; $i--) {
        $j = random_int(0, $i);
        [$items[$i], $items[$j]] = [$items[$j], $items[$i]];
    }
}

/** Read-only check, so plain state polling doesn't need the write lock. */
function botTurnPending($db, $tableId): bool {
    $stmt = $db->prepare("SELECT game_stage, current_turn_seat FROM poker_tables WHERE id = :id");
    $stmt->execute([':id' => $tableId]);
    $table = $stmt->fetch();
    if (!$table || in_array($table['game_stage'], ['waiting', 'showdown'], true)) return false;

    $stmt = $db->prepare("SELECT is_bot, is_folded FROM poker_players WHERE table_id = :tid AND seat = :s");
    $stmt->execute([':tid' => $tableId, ':s' => $table['current_turn_seat']]);
    $p = $stmt->fetch();
    return $p && (int)$p['is_bot'] === 1 && (int)$p['is_folded'] === 0;
}

function processBotTurn($db, $tableId) {
    $maxIterations = 5;
    while ($maxIterations-- > 0) {
        $stmt = $db->prepare("SELECT * FROM poker_tables WHERE id = :id");
        $stmt->execute([':id' => $tableId]);
        $table = $stmt->fetch();

        if (!$table || in_array($table['game_stage'], ['waiting', 'showdown'])) break;

        $stmt = $db->prepare("SELECT * FROM poker_players WHERE table_id = :tid AND seat = :s");
        $stmt->execute([':tid' => $tableId, ':s' => $table['current_turn_seat']]);
        $currentPlayer = $stmt->fetch();

        if ($currentPlayer && $currentPlayer['is_bot'] == 1 && $currentPlayer['is_folded'] == 0) {
            $callAmount = min((int)$currentPlayer['chips'], max(0, $table['current_bet'] - $currentPlayer['current_bet']));
            $newChips = (int)$currentPlayer['chips'] - $callAmount;

            $updPlayer = $db->prepare("UPDATE poker_players SET chips = :c, current_bet = :b WHERE id = :id");
            $updPlayer->execute([':c' => $newChips, ':b' => $table['current_bet'], ':id' => $currentPlayer['id']]);

            $stmtActive = $db->prepare("SELECT seat FROM poker_players WHERE table_id = :tid AND is_folded = 0 ORDER BY seat ASC");
            $stmtActive->execute([':tid' => $tableId]);
            $seats = $stmtActive->fetchAll(PDO::FETCH_COLUMN);

            $nextSeat = $seats[0];
            foreach ($seats as $s) {
                if ($s > $currentPlayer['seat']) {
                    $nextSeat = $s;
                    break;
                }
            }

            $updTable = $db->prepare("UPDATE poker_tables SET current_turn_seat = :ns, pot = pot + :call WHERE id = :tid");
            $updTable->execute([':ns' => $nextSeat, ':call' => $callAmount, ':tid' => $tableId]);

            if ($nextSeat == $seats[0]) {
                advanceStage($db, $tableId, $table);
            }
        } else {
            break;
        }
    }
}

try {
    if ($action === 'create_room') {
        $newRoomId = preg_replace('/[^a-zA-Z0-9_\-]/', '', strtolower($_POST['room_name'] ?? ''));
        $roomCode = strtoupper(trim($_POST['room_code'] ?? ''));
        $botCount = min(3, max(0, (int)($_POST['bot_count'] ?? 1)));
        if (!checkRateLimit('poker_create', 6, 3600, null, true, true)) {
            echo json_encode(['success' => false, 'error' => 'Too many rooms created, try later.']);
            exit();
        }
        $newRoomId = substr($newRoomId, 0, 24);
        $roomCode = substr(preg_replace('/[^A-Z0-9_\-]/', '', $roomCode), 0, 12);

        if (!$newRoomId) {
            echo json_encode(['success' => false, 'error' => 'Invalid room name.']);
            exit();
        }

        $stmt = $db->prepare("SELECT COUNT(*) FROM poker_tables WHERE id = :id OR (room_code IS NOT NULL AND room_code = :c AND room_code != '')");
        $stmt->execute([':id' => $newRoomId, ':c' => $roomCode]);
        if ($stmt->fetchColumn() > 0) {
            echo json_encode(['success' => false, 'error' => 'Room name or code already taken.']);
            exit();
        }

        $stmt = $db->prepare("INSERT INTO poker_tables (id, room_code, creator_username, bot_count, max_players, pot, current_bet, game_stage) VALUES (:id, :c, :u, :bc, 4, 0, 0, 'waiting')");
        $stmt->execute([
            ':id' => $newRoomId,
            ':c' => $roomCode ?: NULL,
            ':u' => $username,
            ':bc' => $botCount
        ]);

        echo json_encode(['success' => true, 'room_id' => $newRoomId, 'room_code' => $roomCode]);
        exit();
    }

    // All mutations run in one exclusive transaction: two concurrent requests can no longer
    // advance the same bot turn twice or double-submit a play. It is committed when the script exits.
    if ($action !== 'state' || botTurnPending($db, $tableId)) {
        $stmt = null;   // the table lookup above left a read open: with it, BEGIN IMMEDIATE fails "database is locked" whenever another request committed meanwhile
        $db->exec('BEGIN IMMEDIATE');
        $GLOBALS['pokerTxOpen'] = true;
        register_shutdown_function(function () use ($db) {
            // PDO::inTransaction() does not see a raw BEGIN on SQLite, so track it ourselves
            if (!empty($GLOBALS['pokerTxOpen'])) {
                $GLOBALS['pokerTxOpen'] = false;
                try { $db->exec('COMMIT'); } catch (Throwable $e) { /* nothing to commit */ }
            }
        });
    }

    processBotTurn($db, $tableId);

    $stmt = $db->prepare("SELECT * FROM poker_tables WHERE id = :id");
    $stmt->execute([':id' => $tableId]);
    $table = $stmt->fetch();

    if ($action === 'state') {
        $stmt = $db->prepare("SELECT seat, username, chips, current_bet, is_folded, is_bot, hole_cards FROM poker_players WHERE table_id = :tid ORDER BY seat ASC");
        $stmt->execute([':tid' => $tableId]);
        $players = $stmt->fetchAll();

        $isShowdown = ($table['game_stage'] === 'showdown');

        $sanitizedPlayers = array_map(function($p) use ($username, $isShowdown) {
            $isOwner = ($p['username'] === $username);
            return [
                'seat' => (int)$p['seat'],
                'username' => $p['username'],
                'chips' => (int)$p['chips'],
                'current_bet' => (int)$p['current_bet'],
                'is_folded' => (int)$p['is_folded'],
                'is_bot' => (int)$p['is_bot'],
                'hole_cards' => ($isOwner || ($isShowdown && !(int)$p['is_folded'])) ? json_decode($p['hole_cards']) : ['??', '??']
            ];
        }, $players);

        echo json_encode([
            'success' => true,
            'table' => [
                'id' => $table['id'],
                'room_code' => $table['room_code'] ?? '',
                'creator' => $table['creator_username'] ?? 'system',
                'pot' => (int)$table['pot'],
                'current_bet' => (int)$table['current_bet'],
                'community_cards' => json_decode($table['community_cards']),
                'game_stage' => strtoupper($table['game_stage']),
                'current_turn_seat' => (int)$table['current_turn_seat'],
                'last_winner_msg' => $table['last_winner_msg'] ?? ''
            ],
            'players' => $sanitizedPlayers
        ]);
        exit();
    }

    if ($action === 'leave') {
        // Remove current user seat
        $me = $db->prepare("SELECT seat FROM poker_players WHERE table_id = :tid AND username = :u");
        $me->execute([':tid' => $tableId, ':u' => $username]);
        $leftSeat = $me->fetchColumn();
        $stmt = $db->prepare("DELETE FROM poker_players WHERE table_id = :tid AND username = :u");
        $stmt->execute([':tid' => $tableId, ':u' => $username]);

        // Leaving in the middle of a hand must not freeze the table: the pot goes on (or to the last one left)
        if ($leftSeat !== false && !in_array($table['game_stage'], ['waiting', 'showdown'], true)) {
            $live = $db->prepare("SELECT seat FROM poker_players WHERE table_id = :tid AND is_folded = 0 ORDER BY seat");
            $live->execute([':tid' => $tableId]);
            $seats = array_map('intval', $live->fetchAll(PDO::FETCH_COLUMN));
            if (count($seats) <= 1) {
                $db->prepare("UPDATE poker_tables SET game_stage = 'showdown' WHERE id = :tid")->execute([':tid' => $tableId]);
                resolveWinner($db, $tableId, json_decode($table['community_cards'], true) ?: []);
            } elseif ((int)$table['current_turn_seat'] === (int)$leftSeat) {
                $next = null;
                foreach ($seats as $sn) { if ($sn > (int)$leftSeat) { $next = $sn; break; } }
                $db->prepare("UPDATE poker_tables SET current_turn_seat = :s WHERE id = :tid")->execute([':s' => $next ?? $seats[0], ':tid' => $tableId]);
            }
        }

        // If no non-bot human players remain, clear table state & bots
        $stmtHumans = $db->prepare("SELECT COUNT(*) FROM poker_players WHERE table_id = :tid AND is_folded = 0 AND is_bot = 0");
        $stmtHumans->execute([':tid' => $tableId]);
        if ((int)$stmtHumans->fetchColumn() === 0) {
            $db->prepare("DELETE FROM poker_players WHERE table_id = :tid")->execute([':tid' => $tableId]);
            $db->prepare("UPDATE poker_tables SET pot = 0, current_bet = 0, community_cards = '[]', game_stage = 'waiting', last_winner_msg = '' WHERE id = :tid")
            ->execute([':tid' => $tableId]);
        }

        echo json_encode(['success' => true]);
        exit();
    }

    if ($action === 'join') {
        $stmt = $db->prepare("SELECT COUNT(*) FROM poker_players WHERE table_id = :tid AND username = :u");
        $stmt->execute([':tid' => $tableId, ':u' => $username]);
        if ($stmt->fetchColumn() > 0) {
            echo json_encode(['success' => true, 'table_id' => $tableId, 'message' => 'Already seated.']);
            exit();
        }

        $stmt = $db->prepare("SELECT seat FROM poker_players WHERE table_id = :tid");
        $stmt->execute([':tid' => $tableId]);
        $takenSeats = $stmt->fetchAll(PDO::FETCH_COLUMN);

        $assignedSeat = null;
        for ($s = 0; $s < 4; $s++) {
            if (!in_array($s, $takenSeats)) {
                $assignedSeat = $s;
                break;
            }
        }

        if ($assignedSeat === null) {
            echo json_encode(['success' => false, 'error' => 'Table is full.']);
            exit();
        }

        $stmt = $db->prepare("INSERT INTO poker_players (table_id, user_id, username, seat, chips, is_bot) VALUES (:tid, :uid, :u, :seat, 1000, 0)");
        $stmt->execute([':tid' => $tableId, ':uid' => $userId, ':u' => $username, ':seat' => $assignedSeat]);

        // Auto-spawn specified bot count
        $botCountNeeded = (int)($table['bot_count'] ?? 1);
        for ($b = 1; $b <= $botCountNeeded; $b++) {
            $stmt = $db->prepare("SELECT COUNT(*) FROM poker_players WHERE table_id = :tid AND is_bot = 1");
            $stmt->execute([':tid' => $tableId]);
            if ($stmt->fetchColumn() < $botCountNeeded) {
                $stmtSeats = $db->prepare("SELECT seat FROM poker_players WHERE table_id = :tid");
                $stmtSeats->execute([':tid' => $tableId]);
                $used = $stmtSeats->fetchAll(PDO::FETCH_COLUMN);
                
                for ($s = 0; $s < 4; $s++) {
                    if (!in_array($s, $used)) {
                        $botName = "CYBER_BOT_$b";
                        $db->prepare("INSERT INTO poker_players (table_id, username, seat, chips, is_bot) VALUES (:tid, :bname, :seat, 1000, 1)")
                           ->execute([':tid' => $tableId, ':bname' => $botName, ':seat' => $s]);
                        break;
                    }
                }
            }
        }

        echo json_encode(['success' => true, 'table_id' => $tableId, 'seat' => $assignedSeat]);
        exit();
    }

    if ($action === 'deal') {
        $deck = [
            '2h','3h','4h','5h','6h','7h','8h','9h','10h','Jh','Qh','Kh','Ah',
            '2d','3d','4d','5d','6d','7d','8d','9d','10d','Jd','Qd','Kd','Ad',
            '2c','3c','4c','5c','6c','7c','8c','9c','10c','Jc','Qc','Kc','Ac',
            '2s','3s','4s','5s','6s','7s','8s','9s','10s','Js','Qs','Ks','As'
        ];
        secureShuffle($deck);

        $stmt = $db->prepare("SELECT COUNT(*) FROM poker_players WHERE table_id = :tid AND username = :u AND is_bot = 0");
        $stmt->execute([':tid' => $tableId, ':u' => $username]);
        if ((int)$stmt->fetchColumn() === 0) {
            echo json_encode(['success' => false, 'error' => 'Join the table first.']);
            exit();
        }
        if (!in_array($table['game_stage'], ['waiting', 'showdown'], true)) {
            echo json_encode(['success' => false, 'error' => 'A hand is already in progress.']);
            exit();
        }

        $stmt = $db->prepare("SELECT id, seat FROM poker_players WHERE table_id = :tid ORDER BY seat ASC");
        $stmt->execute([':tid' => $tableId]);
        $players = $stmt->fetchAll();

        if (count($players) < 2) {
            echo json_encode(['success' => false, 'error' => 'At least 2 players required.']);
            exit();
        }

        foreach ($players as $p) {
            $cards = [array_pop($deck), array_pop($deck)];
            $upd = $db->prepare("UPDATE poker_players SET hole_cards = :cards, is_folded = 0, current_bet = 0 WHERE id = :id");
            $upd->execute([':cards' => json_encode($cards), ':id' => $p['id']]);
        }

        $community = [array_pop($deck), array_pop($deck), array_pop($deck)];
        $stmt = $db->prepare("UPDATE poker_tables SET pot = 0, current_bet = 20, community_cards = :c, game_stage = 'flop', current_turn_seat = :first_seat, last_winner_msg = '' WHERE id = :tid");
        $stmt->execute([':c' => json_encode($community), ':first_seat' => $players[0]['seat'], ':tid' => $tableId]);

        processBotTurn($db, $tableId);

        echo json_encode(['success' => true]);
        exit();
    }

    if ($action === 'play') {
        $userAction = $_POST['user_action'] ?? 'call';
        $raiseAmount = max(10, (int)($_POST['raise_amount'] ?? 40));

        $stmt = $db->prepare("SELECT * FROM poker_players WHERE table_id = :tid AND username = :u");
        $stmt->execute([':tid' => $tableId, ':u' => $username]);
        $player = $stmt->fetch();

        if ($player && !in_array($table['game_stage'], ['waiting', 'showdown'], true) && $table['current_turn_seat'] == $player['seat']) {
            if ($userAction === 'fold') {
                $upd = $db->prepare("UPDATE poker_players SET is_folded = 1 WHERE id = :id");
                $upd->execute([':id' => $player['id']]);
            } elseif ($userAction === 'raise') {
                $betDiff = max($raiseAmount, $table['current_bet'] + $raiseAmount) - $player['current_bet'];
                $actualBet = min($player['chips'], $betDiff);
                $newChips = $player['chips'] - $actualBet;

                $upd = $db->prepare("UPDATE poker_players SET chips = :c, current_bet = current_bet + :b WHERE id = :id");
                $upd->execute([':c' => $newChips, ':b' => $actualBet, ':id' => $player['id']]);

                $updTable = $db->prepare("UPDATE poker_tables SET pot = pot + :b, current_bet = current_bet + :b WHERE id = :tid");
                $updTable->execute([':b' => $actualBet, ':tid' => $tableId]);
            } else {
                $callAmount = min((int)$player['chips'], max(0, $table['current_bet'] - $player['current_bet']));
                $newChips = (int)$player['chips'] - $callAmount;
                
                $upd = $db->prepare("UPDATE poker_players SET chips = :c, current_bet = :b WHERE id = :id");
                $upd->execute([':c' => $newChips, ':b' => $table['current_bet'], ':id' => $player['id']]);
                
                $updTable = $db->prepare("UPDATE poker_tables SET pot = pot + :call WHERE id = :tid");
                $updTable->execute([':call' => $callAmount, ':tid' => $tableId]);
            }

            $stmtActive = $db->prepare("SELECT seat FROM poker_players WHERE table_id = :tid AND is_folded = 0 ORDER BY seat ASC");
            $stmtActive->execute([':tid' => $tableId]);
            $seats = $stmtActive->fetchAll(PDO::FETCH_COLUMN);

            $nextSeat = $seats[0];
            foreach ($seats as $s) {
                if ($s > $player['seat']) {
                    $nextSeat = $s;
                    break;
                }
            }

            $updTurn = $db->prepare("UPDATE poker_tables SET current_turn_seat = :ns WHERE id = :tid");
            $updTurn->execute([':ns' => $nextSeat, ':tid' => $tableId]);

            if ($nextSeat == $seats[0]) {
                advanceStage($db, $tableId, $table);
            }

            processBotTurn($db, $tableId);
        }

        echo json_encode(['success' => true]);
        exit();
    }

} catch (Exception $e) {
    if (!empty($GLOBALS['pokerTxOpen'])) {
        $GLOBALS['pokerTxOpen'] = false;
        try { $db->exec('ROLLBACK'); } catch (Throwable $ignored) {}
    }
    failInternal('POKER', $e);
}