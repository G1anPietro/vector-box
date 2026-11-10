<?php
// public/api/poker_leaderboard.php
// Public: top players by hands won (then chips won). Includes your own row when logged in.
require_once __DIR__ . '/database.php';

initSession();

try {
    $db = getDbConnection();
    $top = $db->query("SELECT user_id, username, hands_played, hands_won, chips_won, biggest_pot
                       FROM poker_stats WHERE hands_played > 0
                       ORDER BY hands_won DESC, chips_won DESC, hands_played ASC LIMIT 10")->fetchAll();

    $fmt = fn($r, $rank = null) => [
        'rank'         => $rank,
        'username'     => $r['username'],
        'hands_played' => (int)$r['hands_played'],
        'hands_won'    => (int)$r['hands_won'],
        'win_rate'     => (int)$r['hands_played'] > 0 ? round(100 * (int)$r['hands_won'] / (int)$r['hands_played'], 1) : 0,
        'chips_won'    => (int)$r['chips_won'],
        'biggest_pot'  => (int)$r['biggest_pot'],
    ];

    $rows = [];
    foreach ($top as $i => $r) $rows[] = $fmt($r, $i + 1);

    $me = null;
    if (!empty($_SESSION['user_id'])) {
        $stmt = $db->prepare("SELECT * FROM poker_stats WHERE user_id = :id");
        $stmt->execute([':id' => (int)$_SESSION['user_id']]);
        if ($mine = $stmt->fetch()) {
            $stmt = $db->prepare("SELECT COUNT(*) + 1 FROM poker_stats
                                  WHERE hands_won > :w OR (hands_won = :w AND chips_won > :c)");
            $stmt->execute([':w' => (int)$mine['hands_won'], ':c' => (int)$mine['chips_won']]);
            $me = $fmt($mine, (int)$stmt->fetchColumn());
        }
    }

    jsonResponse(['success' => true, 'top' => $rows, 'me' => $me]);
} catch (Throwable $e) {
    failInternal('POKER_LEADERBOARD', $e);
}
