<?php
// public/api/guestbook.php
// GET  -> latest entries (public)
// POST {action:"sign", message}  -> add an entry (CSRF, bans, rate limits)
// POST {action:"delete", id}     -> admin removes an entry
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/rate_limiter.php';

const GUESTBOOK_MAX_LEN = 200;
const GUESTBOOK_PAGE = 50;

initSession();

try {
    $db = getDbConnection();

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $stmt = $db->prepare("SELECT id, username, message, created_at FROM guestbook
                              WHERE is_deleted = 0 ORDER BY id DESC LIMIT :lim");
        $stmt->bindValue(':lim', GUESTBOOK_PAGE, PDO::PARAM_INT);
        $stmt->execute();
        $entries = array_map(fn($r) => [
            'id'         => (int)$r['id'],
            'username'   => $r['username'],
            'message'    => $r['message'],
            'created_at' => $r['created_at'],
        ], $stmt->fetchAll());
        jsonResponse(['success' => true, 'entries' => $entries]);
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        jsonResponse(['success' => false, 'error' => 'Method not allowed'], 405);
    }

    requireCsrf();
    $input = readJsonBody();
    $action = (string)($input['action'] ?? 'sign');

    if ($action === 'delete') {
        requireAdmin();
        $id = (int)($input['id'] ?? 0);
        if ($id <= 0) jsonResponse(['success' => false, 'error' => 'Invalid entry ID'], 400);
        $stmt = $db->prepare("UPDATE guestbook SET is_deleted = 1 WHERE id = :id");
        $stmt->execute([':id' => $id]);
        jsonResponse(['success' => true, 'id' => $id]);
    }

    if ($action !== 'sign') {
        jsonResponse(['success' => false, 'error' => 'Unknown action'], 400);
    }

    // Collapse whitespace/control characters: one line per entry
    $message = trim(preg_replace('/[\x00-\x1F\x7F\s]+/u', ' ', (string)($input['message'] ?? '')) ?? '');
    if ($message === '') {
        jsonResponse(['success' => false, 'error' => 'Message cannot be empty'], 400);
    }
    if (textLength($message) > GUESTBOOK_MAX_LEN) {
        jsonResponse(['success' => false, 'error' => 'MESSAGE_TOO_LONG: Maximum length is ' . GUESTBOOK_MAX_LEN . ' characters'], 400);
    }

    $userId = !empty($_SESSION['user_id']) ? (int)$_SESSION['user_id'] : null;
    if ($reason = accountRestriction($db, $userId)) {
        jsonResponse(['success' => false, 'error' => $reason], 403);
    }

    $isAdmin = !empty($_SESSION['is_admin']);
    $senderKey = $userId ? 'u' . $userId : 's' . substr(hash('sha256', session_id() ?: getClientIp()), 0, 16);
    if (!$isAdmin && (!checkRateLimit('guestbook_sender', 1, 60, $senderKey) || !checkRateLimit('guestbook_ip', 5, 3600))) {
        jsonResponse(['success' => false, 'error' => 'RATE_LIMIT: One entry per minute, please'], 429);
    }

    $username = (string)($_SESSION['username'] ?? 'guest');
    $stmt = $db->prepare("INSERT INTO guestbook (user_id, username, message, sender_ip) VALUES (:uid, :u, :m, :ip)");
    $stmt->execute([':uid' => $userId, ':u' => textCut($username, 50), ':m' => $message, ':ip' => getClientIp()]);

    jsonResponse(['success' => true, 'id' => (int)$db->lastInsertId()]);
} catch (Throwable $e) {
    failInternal('GUESTBOOK', $e);
}
