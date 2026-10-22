<?php
// public/api/uplink_send.php
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/rate_limiter.php';

initSession();

header('Content-Type: application/json');

$input = json_decode(file_get_contents('php://input'), true);
$message = trim($input['message'] ?? '');

if (empty($message)) {
    echo json_encode(['success' => false, 'error' => 'Message cannot be empty']);
    exit();
}

$clientIp = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';
$userId = $_SESSION['user_id'] ?? null;
$username = $_SESSION['username'] ?? 'guest';

try {
    $db = getDbConnection();
    
    $stmt = $db->prepare("INSERT INTO transmissions (user_id, username, message, sender_ip) VALUES (:uid, :uname, :msg, :ip)");
    $stmt->execute([
        ':uid' => $userId,
        ':uname' => $username,
        ':msg' => $message,
        ':ip' => $clientIp
    ]);

    echo json_encode(['success' => true, 'username' => $username]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}