<?php
// public/api/reading_stats.php — how long and how much the account reads, per day (only the account itself sees it).
// GET  ?today=YYYY-MM-DD -> {days: [{day, seconds, pages}] (last 60 days), week: {seconds, pages}, month: {...}, streak, total_seconds}
// POST {seconds, pages, day}  adds to the phone's today (YYYY-MM-DD, checked against the server's date) (the page sends what it measured every minute): at most 1 hour and 200 pages per call,
//      and a day never goes over 20 hours.
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/rate_limiter.php';

/** The phone's own date (YYYY-MM-DD) if it is within a day of the server's, else the server's (UTC). */
function statsDay($d): string {
    if (is_string($d) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) && ($t = strtotime($d . ' 12:00:00 UTC')) !== false && abs($t - time()) < 2 * 86400) return $d;
    return gmdate('Y-m-d');
}

initSession();
requireLogin();

try {
    $db = getDbConnection();
    $userId = (int)$_SESSION['user_id'];
    if (!userCanReadBooks($db, $userId, !empty($_SESSION['is_admin']))) {
        jsonResponse(['success' => false, 'error' => 'FORBIDDEN: Book reader access required'], 403);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        requireCsrf();
        if (!checkRateLimit('reading_log', 90, 600, 'user:' . $userId)) jsonResponse(['success' => false, 'error' => 'Too many requests'], 429);
        $in = readJsonBody();
        $sec = max(0, min(3600, (int)($in['seconds'] ?? 0)));
        $pages = max(0, min(200, (int)($in['pages'] ?? 0)));
        if ($sec === 0 && $pages === 0) jsonResponse(['success' => true]);
        $today = statsDay($in['day'] ?? null);
        $db->prepare("INSERT INTO reading_log (user_id, day, seconds, pages) VALUES (:u, :d, :s, :p)
                      ON CONFLICT(user_id, day) DO UPDATE SET seconds = MIN(72000, seconds + excluded.seconds), pages = MIN(100000, pages + excluded.pages)")
           ->execute([':u' => $userId, ':d' => $today, ':s' => $sec, ':p' => $pages]);
        jsonResponse(['success' => true]);
    }
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') jsonResponse(['success' => false, 'error' => 'Method not allowed'], 405);

    $todayTs = strtotime(statsDay($_GET['today'] ?? null) . ' 12:00:00 UTC');
    $since = gmdate('Y-m-d', $todayTs - 59 * 86400);
    $st = $db->prepare('SELECT day, seconds, pages FROM reading_log WHERE user_id = :u AND day >= :d ORDER BY day');
    $st->execute([':u' => $userId, ':d' => $since]);
    $days = array_map(fn($r) => ['day' => $r['day'], 'seconds' => (int)$r['seconds'], 'pages' => (int)$r['pages']], $st->fetchAll());
    $sum = function (int $n) use ($days, $todayTs) {
        $from = gmdate('Y-m-d', $todayTs - ($n - 1) * 86400);
        $s = 0; $p = 0;
        foreach ($days as $d) if ($d['day'] >= $from) { $s += $d['seconds']; $p += $d['pages']; }
        return ['seconds' => $s, 'pages' => $p];
    };
    $by = array_column($days, 'seconds', 'day');
    $streak = 0;
    for ($i = 0; $i < 60; $i++) {
        $d = gmdate('Y-m-d', $todayTs - $i * 86400);
        if (($by[$d] ?? 0) >= 60) $streak++;
        elseif ($i > 0) break;            // today may not have been read yet: it does not break the streak
    }
    $tot = $db->prepare('SELECT COALESCE(SUM(seconds), 0) FROM reading_log WHERE user_id = :u');
    $tot->execute([':u' => $userId]);
    jsonResponse(['success' => true, 'days' => $days, 'week' => $sum(7), 'month' => $sum(30), 'streak' => $streak, 'total_seconds' => (int)$tot->fetchColumn()]);
} catch (Throwable $e) {
    failInternal('READING_STATS', $e);
}
