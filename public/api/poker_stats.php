<?php
// public/api/poker_stats.php
// Per-account poker statistics for the leaderboard. Bots and guests (no user_id) are not tracked.

/**
 * Record one finished hand. Call inside the caller's poker transaction.
 * $players: every player row seated in the hand (folded or not).
 * $winner:  the winning player row, or null.
 */
function recordHandResult(PDO $db, array $players, ?array $winner, int $pot): void {
    $upsert = $db->prepare("INSERT INTO poker_stats (user_id, username, hands_played, hands_won, chips_won, biggest_pot, updated_at)
                            VALUES (:uid, :u, 1, :won, :chips, :big, CURRENT_TIMESTAMP)
                            ON CONFLICT(user_id) DO UPDATE SET
                                username     = excluded.username,
                                hands_played = hands_played + 1,
                                hands_won    = hands_won + excluded.hands_won,
                                chips_won    = chips_won + excluded.chips_won,
                                biggest_pot  = MAX(biggest_pot, excluded.biggest_pot),
                                updated_at   = CURRENT_TIMESTAMP");

    foreach ($players as $p) {
        if ((int)($p['is_bot'] ?? 0) === 1 || empty($p['user_id'])) continue;
        $isWinner = $winner !== null && (int)$winner['id'] === (int)$p['id'];
        // Bind as INTEGER: execute([...]) binds TEXT, and in SQLite TEXT always compares
        // greater than INTEGER, which would break MAX(biggest_pot, excluded.biggest_pot)
        $upsert->bindValue(':uid', (int)$p['user_id'], PDO::PARAM_INT);
        $upsert->bindValue(':u', (string)$p['username'], PDO::PARAM_STR);
        $upsert->bindValue(':won', $isWinner ? 1 : 0, PDO::PARAM_INT);
        $upsert->bindValue(':chips', $isWinner ? $pot : 0, PDO::PARAM_INT);
        $upsert->bindValue(':big', $isWinner ? $pot : 0, PDO::PARAM_INT);
        $upsert->execute();
    }
}
