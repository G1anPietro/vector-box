<?php
// public/api/news.php — the news board.
//   GET                      -> {success, items:[…]}   public, read-only (the page polls it)
//   POST {slug, …fields}     -> admin only, CSRF (or header X-News-Token = NEWS_TOKEN)      create/update one item (see newsSave in news_lib.php)
//   POST {action:'delete', slug}                      admin only, CSRF
require_once __DIR__ . '/news_lib.php';
require_once __DIR__ . '/rate_limiter.php';

initSession();
header('Content-Type: application/json');
$db = getDbConnection();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    header('Cache-Control: no-cache');
    jsonResponse(['success' => true, 'items' => newsBoard($db)]);
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonFail('METHOD', 'Method not allowed', 405);

// Either the admin in the browser (session + CSRF) or a script that knows NEWS_TOKEN from .env (tools/news.php --remote).
$tok = (string)envValue('NEWS_TOKEN', '');
$sent = (string)($_SERVER['HTTP_X_NEWS_TOKEN'] ?? '');
if (!($tok !== '' && strlen($tok) >= 24 && $sent !== '' && hash_equals($tok, $sent))) {
    if (!checkRateLimit('news_write', 60, 3600, null, true, true)) jsonFail('RATE', 'Too many requests', 429);
    requireCsrf();
    requireAdmin();
}
$in = json_decode((string)file_get_contents('php://input'), true);
if (!is_array($in) || !isset($in['slug'])) jsonFail('BAD_INPUT', 'slug is required');
try {
    if (($in['action'] ?? '') === 'delete') {
        $db->prepare('DELETE FROM news_updates WHERE item_id IN (SELECT id FROM news_items WHERE slug = :s)')->execute([':s' => (string)$in['slug']]);
        $db->prepare('DELETE FROM news_items WHERE slug = :s')->execute([':s' => (string)$in['slug']]);
        jsonResponse(['success' => true]);
    }
    jsonResponse(['success' => true, 'slug' => newsSave($db, (string)$in['slug'], $in)]);
} catch (InvalidArgumentException $e) {
    jsonFail('BAD_INPUT', $e->getMessage());
} catch (Throwable $e) {
    failInternal('NEWS', $e);
}
