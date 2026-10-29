<?php
// public/api/poker.php
require_once __DIR__ . '/database.php';

initSession();
header('Content-Type: application/json');

$action = $_GET['action'] ?? $_POST['action'] ?? 'state';
$inputTarget = trim($_REQUEST['table_id'] ?? 'general');
$username = $_SESSION['username'] ?? ('guest_' . substr(md5(session_id()), 0, 4));
$userId = $_SESSION['user_id'] ?? null;

$db = getDbConnection();

// Resolve room by ID or Room Code
$stmt = $db->prepare("SELECT * FROM poker_tables WHERE id = :t OR room_code = :t");
$stmt->execute([':t' => strtolower($inputTarget)]);
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

function evaluateHand($holeCards, $communityCards) {
    $allCards = array_merge($holeCards, $communityCards);
    if (count($allCards) < 5) return ['score' => 0, 'name' => 'High Card'];

    $ranks = [];
    $suits = [];
    $valMap = ['2'=>2,'3'=>3,'4'=>4,'5'=>5,'6'=>6,'7'=>7,'8'=>8,'9'=>9,'10'=>10,'J'=>11,'Q'=>12,'K'=>13,'A'=>14];

    foreach ($allCards as $c) {
        if ($c === '??') continue;
        $s = substr($c, -1);
        $rStr = substr($c, 0, -1);
        $v = $valMap[$rStr] ?? 0;
        $ranks[] = $v;
        $suits[$s] = ($suits[$s] ?? 0) + 1;
    }

    rsort($ranks);
    $counts = array_count_values($ranks);
    arsort($counts);

    $isFlush = false;
    foreach ($suits as $cnt) {
        if ($cnt >= 5) $isFlush = true;
    }

    $uniqueRanks = array_values(array_unique($ranks));
    $isStraight = false;
    for ($i=0; $i <= count($uniqueRanks)-5; $i++) {
        if ($uniqueRanks[$i] - $uniqueRanks[$i+4] === 4) {
            $isStraight = true;
            break;
        }
    }

    $cValues = array_values($counts);
    if ($isFlush && $isStraight) return ['score' => 8, 'name' => 'Straight Flush'];
    if ($cValues[0] === 4) return ['score' => 7, 'name' => 'Four of a Kind'];
    if ($cValues[0] === 3 && ($cValues[1] ?? 0) >= 2) return ['score' => 6, 'name' => 'Full House'];
    if ($isFlush) return ['score' => 5, 'name' => 'Flush'];
    if ($isStraight) return ['score' => 4, 'name' => 'Straight'];
    if ($cValues[0] === 3) return ['score' => 3, 'name' => 'Three of a Kind'];
    if ($cValues[0] === 2 && ($cValues[1] ?? 0) === 2) return ['score' => 2, 'name' => 'Two Pair'];
    if ($cValues[0] === 2) return ['score' => 1, 'name' => 'Pair'];

    return ['score' => 0, 'name' => 'High Card'];
}

function advanceStage($db, $tableId, &$table) {
    $fullDeck = [
        '2h','3h','4h','5h','6h','7h','8h','9h','10h','Jh','Qh','Kh','Ah',
        '2d','3d','4d','5d','6d','7d','8d','9d','10d','Jd','Qd','Kd','Ad',
        '2c','3c','4c','5c','6c','7c','8c','9c','10c','Jc','Qc','Kc','Ac',
        '2s','3s','4s','5s','6s','7s','8s','9s','10s','Js','Qs','Ks','As'
    ];
    shuffle($fullDeck);

    $community = json_decode($table['community_cards'], true) ?: [];

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

    if (count($activePlayers) === 1) {
        $winner = $activePlayers[0];
        $db->prepare("UPDATE poker_players SET chips = chips + :pot WHERE id = :id")->execute([':pot' => $pot, ':id' => $winner['id']]);
        $msg = "{$winner['username']} won {$pot} CR (Everyone else folded)!";
    } else {
        $bestScore = -1;
        $winner = null;
        $winningCombo = "";

        foreach ($activePlayers as $p) {
            $holes = json_decode($p['hole_cards'], true) ?: [];
            $res = evaluateHand($holes, $community);
            if ($res['score'] > $bestScore) {
                $bestScore = $res['score'];
                $winner = $p;
                $winningCombo = $res['name'];
            }
        }

        if ($winner) {
            $db->prepare("UPDATE poker_players SET chips = chips + :pot WHERE id = :id")->execute([':pot' => $pot, ':id' => $winner['id']]);
            $msg = "{$winner['username']} WON {$pot} CR WITH A {$winningCombo}!";
        } else {
            $msg = "SHOWDOWN COMPLETE!";
        }
    }

    $db->prepare("UPDATE poker_tables SET pot = 0, last_winner_msg = :m WHERE id = :tid")->execute([':m' => $msg, ':tid' => $tableId]);
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
            $callAmount = max(0, $table['current_bet'] - $currentPlayer['current_bet']);
            $newChips = max(0, $currentPlayer['chips'] - $callAmount);
            
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
                'hole_cards' => ($isOwner || $isShowdown) ? json_decode($p['hole_cards']) : ['??', '??']
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
        $stmt = $db->prepare("DELETE FROM poker_players WHERE table_id = :tid AND username = :u");
        $stmt->execute([':tid' => $tableId, ':u' => $username]);

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
        shuffle($deck);

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

        if ($player && $table['current_turn_seat'] == $player['seat']) {
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
                $callAmount = max(0, $table['current_bet'] - $player['current_bet']);
                $newChips = max(0, $currentPlayer['chips'] ?? $player['chips'] - $callAmount);
                
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
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}