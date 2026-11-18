<?php
// public/api/game_scores.php — arcade leaderboards (Tetris, 2048, Snake, Minesweeper). Rules and limits: game_scores_lib.php.
//
// GET  ?game=tetris&variant=  -> {success, logged_in, lower, top:[{name, score, at}] (10), me:{score, rank}|null}   public
// POST {game, variant, score, duration_ms}  login + CSRF; the server keeps only the account's best -> {success, improved, me}
// Only usernames of accounts are shown (already public in chat): no guests, no IP.
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/rate_limiter.php';
require_once __DIR__ . '/game_scores_lib.php';

initSession();
header('Cache-Control: no-store');

try {
    $db = getDbConnection();
    $post = $_SERVER['REQUEST_METHOD'] === 'POST';
    $in = $post ? readJsonBody() : $_GET;
    $game = (string)($in['game'] ?? '');
    $variant = (string)($in['variant'] ?? '');
    $rules = GAME_SCORE_RULES[$game] ?? null;
    if (!$rules || !in_array($variant, $rules['variants'], true)) jsonFail('bad_game', 'Unknown game', 400);
    $lower = $rules['lower'];
    $uid = (int)($_SESSION['user_id'] ?? 0);

    // my best and my rank (banned accounts do not count in the board)
    $mine = function () use ($db, $uid, $game, $variant, $lower): ?array {
        if (!$uid) return null;
        $st = $db->prepare('SELECT score FROM game_scores WHERE user_id = :u AND game = :g AND variant = :v');
        $st->execute([':u' => $uid, ':g' => $game, ':v' => $variant]);
        $s = $st->fetchColumn();
        if ($s === false) return null;
        $st = $db->prepare('SELECT COUNT(*) FROM game_scores s JOIN accounts a ON a.id = s.user_id
                            WHERE s.game = :g AND s.variant = :v AND a.is_banned = 0 AND s.score ' . ($lower ? '<' : '>') . ' :s');
        $st->execute([':g' => $game, ':v' => $variant, ':s' => (int)$s]);
        return ['score' => (int)$s, 'rank' => (int)$st->fetchColumn() + 1];
    };

    if (!$post) {
        $st = $db->prepare('SELECT a.username AS name, s.score, s.created_at AS at FROM game_scores s JOIN accounts a ON a.id = s.user_id
                            WHERE s.game = :g AND s.variant = :v AND a.is_banned = 0
                            ORDER BY s.score ' . ($lower ? 'ASC' : 'DESC') . ', s.created_at ASC, s.id ASC LIMIT 10');
        $st->execute([':g' => $game, ':v' => $variant]);
        $top = array_map(fn($r) => ['name' => $r['name'], 'score' => (int)$r['score'], 'at' => (int)$r['at']], $st->fetchAll());
        jsonResponse(['success' => true, 'logged_in' => $uid > 0, 'lower' => $lower, 'top' => $top, 'me' => $mine()]);
    }

    requireLogin();
    requireCsrf();
    if ($why = accountRestriction($db, $uid)) jsonFail('restricted', $why, 403);
    if (!checkRateLimit('game_scores', 30, 3600, 'u' . $uid, true, true)) jsonFail('rate_limited', 'Too many submissions, try again later', 429);
    $score = $in['score'] ?? null;
    $dur = $in['duration_ms'] ?? null;
    if ($why = gameScoreCheck($game, $variant, $score, $dur)) jsonFail('implausible', 'Result refused: ' . $why, 422);

    $before = $mine();
    $st = $db->prepare('INSERT INTO game_scores (user_id, game, variant, score, created_at) VALUES (:u, :g, :v, :s, :t)
                        ON CONFLICT(user_id, game, variant) DO UPDATE SET score = excluded.score, created_at = excluded.created_at
                        WHERE excluded.score ' . ($lower ? '<' : '>') . ' game_scores.score');
    $st->execute([':u' => $uid, ':g' => $game, ':v' => $variant, ':s' => $score, ':t' => time()]);
    $me = $mine();
    jsonResponse(['success' => true, 'improved' => !$before || $me['score'] !== $before['score'], 'me' => $me]);
} catch (Throwable $e) {
    failInternal('GAME_SCORES', $e);
}
