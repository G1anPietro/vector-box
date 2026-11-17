<?php
// public/api/news_ideas.php — the ideas box of the news page.
//   GET                                 -> the person's own ideas with their status and the answer (an admin sees everybody's)
//   POST {text}                         -> add an idea (account required, CSRF, 5 per day, max 20 waiting)
//   POST {action:'set', id, status, reply?}   admin only: status new|considering|planned|done|declined, optional short answer
//   POST {action:'delete', id}          -> the author deletes their own idea (an admin any)
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/rate_limiter.php';

initSession();
header('Content-Type: application/json');
requireLogin();
$db = getDbConnection();
$me = (int)$_SESSION['user_id'];
$isAdmin = !empty($_SESSION['is_admin']);
const IDEA_STATUS = ['new', 'considering', 'planned', 'done', 'declined'];

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $sql = 'SELECT i.id, i.text, i.status, i.reply, i.created_at, a.username FROM news_ideas i LEFT JOIN accounts a ON a.id = i.user_id'
         . ($isAdmin ? '' : ' WHERE i.user_id = :u') . ' ORDER BY i.id DESC LIMIT 200';
    $st = $db->prepare($sql);
    $st->execute($isAdmin ? [] : [':u' => $me]);
    jsonResponse(['success' => true, 'admin' => $isAdmin, 'ideas' => array_map(fn($r) => [
        'id' => (int)$r['id'], 'text' => $r['text'], 'status' => $r['status'], 'reply' => $r['reply'],
        'created_at' => (int)$r['created_at'], 'username' => $isAdmin ? (string)$r['username'] : null,
    ], $st->fetchAll(PDO::FETCH_ASSOC))]);
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonFail('METHOD', 'Method not allowed', 405);

requireCsrf();
$in = json_decode((string)file_get_contents('php://input'), true);
if (!is_array($in)) jsonFail('BAD_INPUT', 'JSON expected');
$action = (string)($in['action'] ?? 'add');
try {
    if ($action === 'add') {
        $text = trim(preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x{200B}-\x{200F}\x{202A}-\x{202E}]/u', '', (string)($in['text'] ?? '')));
        $n = textLength($text);
        if ($n < 10 || $n > 500) jsonFail('BAD_INPUT', 'The idea must be 10-500 characters');
        if (!checkRateLimit('idea_add', 5, 86400, (string)$me, true, true)) jsonFail('RATE', 'Too many ideas today, try again tomorrow', 429);
        $waiting = $db->prepare("SELECT COUNT(*) FROM news_ideas WHERE user_id = :u AND status = 'new'");
        $waiting->execute([':u' => $me]);
        if ((int)$waiting->fetchColumn() >= 20) jsonFail('LIMIT', 'You have 20 ideas waiting: wait for some answers', 429);
        $db->prepare('INSERT INTO news_ideas (user_id, text, created_at) VALUES (:u, :t, :n)')->execute([':u' => $me, ':t' => $text, ':n' => time()]);
        jsonResponse(['success' => true, 'id' => (int)$db->lastInsertId()]);
    }
    if ($action === 'set') {
        requireAdmin();
        $status = (string)($in['status'] ?? '');
        if (!in_array($status, IDEA_STATUS, true)) jsonFail('BAD_INPUT', 'status');
        $db->prepare('UPDATE news_ideas SET status = :s, reply = :r WHERE id = :i')
           ->execute([':s' => $status, ':r' => textCut(trim((string)($in['reply'] ?? '')), 300), ':i' => (int)($in['id'] ?? 0)]);
        jsonResponse(['success' => true]);
    }
    if ($action === 'delete') {
        $db->prepare('DELETE FROM news_ideas WHERE id = :i' . ($isAdmin ? '' : ' AND user_id = :u'))
           ->execute($isAdmin ? [':i' => (int)($in['id'] ?? 0)] : [':i' => (int)($in['id'] ?? 0), ':u' => $me]);
        jsonResponse(['success' => true]);
    }
    jsonFail('BAD_INPUT', 'action');
} catch (Throwable $e) {
    failInternal('NEWS_IDEAS', $e);
}
