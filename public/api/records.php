<?php
// public/api/records.php — personal records of the solo games, kept on the account so they follow the player from phone to phone.
// GET  -> {records: {game: {variant: {best, at}}}}        (also the best results of the leaderboard games)
// POST {action:"submit", game, variant, value}            keep the better of the stored and the new value -> {best, improved}
// POST {action:"sync", game, bests: {variant: value}}     merge what the phone has with the account; answers with the merged bests
// Login and CSRF needed (a guest simply keeps the record in the browser). Rules and limits: records_lib.php.
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/rate_limiter.php';
require_once __DIR__ . '/records_lib.php';

initSession();
header('Cache-Control: no-store');
requireLogin();

try {
    $db = getDbConnection();
    $userId = (int)$_SESSION['user_id'];

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        jsonResponse(['success' => true, 'records' => (object)recordsOfAccount($db, $userId)]);
    }
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonResponse(['success' => false, 'error' => 'Method not allowed'], 405);
    requireCsrf();
    if (!checkRateLimit('records', 120, 600, 'user:' . $userId)) jsonResponse(['success' => false, 'error' => 'Too many requests'], 429);
    $in = readJsonBody();
    $game = (string)($in['game'] ?? '');
    if (!isset(RECORD_RULES[$game])) jsonResponse(['success' => false, 'error' => 'Unknown game'], 400);

    $existing = function (string $variant) use ($db, $userId, $game): ?int {
        $st = $db->prepare('SELECT best FROM personal_records WHERE user_id = :u AND game = :g AND variant = :v');
        $st->execute([':u' => $userId, ':g' => $game, ':v' => $variant]);
        $b = $st->fetchColumn();
        return $b === false ? null : (int)$b;
    };

    if (($in['action'] ?? '') === 'submit') {
        $variant = (string)($in['variant'] ?? '');
        $value = $in['value'] ?? null;
        if (($why = recordCheck($game, $variant, $value)) !== null) jsonResponse(['success' => false, 'error' => $why], 400);
        $before = $existing($variant);
        $best = recordSave($db, $userId, $game, $variant, $value);
        jsonResponse(['success' => true, 'best' => $best, 'improved' => $before === null || $best !== $before]);
    }
    if (($in['action'] ?? '') === 'sync') {
        $bests = is_array($in['bests'] ?? null) ? $in['bests'] : [];
        $db->exec('BEGIN IMMEDIATE');
        foreach (array_slice($bests, 0, 20, true) as $variant => $value) {
            if (recordCheck($game, (string)$variant, $value) === null) recordSave($db, $userId, $game, (string)$variant, $value);   // a silly value is ignored, not an error
        }
        $db->exec('COMMIT');
        $st = $db->prepare('SELECT variant, best FROM personal_records WHERE user_id = :u AND game = :g');
        $st->execute([':u' => $userId, ':g' => $game]);
        $merged = [];
        foreach ($st->fetchAll() as $r) $merged[$r['variant']] = (int)$r['best'];
        jsonResponse(['success' => true, 'bests' => (object)$merged]);
    }
    jsonResponse(['success' => false, 'error' => 'Unknown action'], 400);
} catch (Throwable $e) {
    if (isset($db) && $db->inTransaction()) $db->rollBack();
    failInternal('RECORDS', $e);
}
