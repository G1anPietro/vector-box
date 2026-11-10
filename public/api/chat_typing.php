<?php
// public/api/chat_typing.php
// "X is typing..." signal. Relayed live through the Node chat hub only; nothing is stored.
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/rate_limiter.php';

initSession();
requireCsrf();

if (chatHubSecret() === '') {
    jsonResponse(['success' => false, 'error' => 'Live chat hub not configured'], 503);
}

$input = readJsonBody();
$roomId = preg_replace('/[^a-zA-Z0-9_\-]/', '', strtolower(trim((string)($input['room_id'] ?? 'general'))));
$roomId = $roomId !== '' ? $roomId : 'general';
$isAdmin = !empty($_SESSION['is_admin']);
$username = (string)($_SESSION['username'] ?? 'guest');

try {
    $db = getDbConnection();
    $stmt = $db->prepare("SELECT is_private, is_hidden FROM rooms WHERE id = :id");
    $stmt->execute([':id' => $roomId]);
    $room = $stmt->fetch();

    $hidden = $room && (int)$room['is_hidden'] === 1;
    $readOnly = $roomId === 'announcements' || $roomId === 'news' || ($room && (int)$room['is_private'] === 1);
    if (($hidden || $readOnly) && !$isAdmin) {
        jsonResponse(['success' => false, 'error' => 'FORBIDDEN'], 403);
    }

    // Throttle AFTER the permission check, so refusals are always reported as such
    $senderKey = !empty($_SESSION['user_id']) ? 'u' . $_SESSION['user_id'] : 's' . substr(hash('sha256', session_id() ?: getClientIp()), 0, 16);
    if (!checkRateLimit('chat_typing', 1, 2, $senderKey)) {
        jsonResponse(['success' => true, 'throttled' => true]);
    }

    notifyChatHub([
        'type'     => 'typing',
        'hidden'   => $hidden,
        'room_id'  => $roomId,
        'username' => textCut($username, 50),
    ]);
    jsonResponse(['success' => true]);
} catch (Throwable $e) {
    failInternal('CHAT_TYPING', $e);
}
