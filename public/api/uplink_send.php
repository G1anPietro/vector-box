<?php
// public/api/uplink_send.php
header('Content-Type: application/json');
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/debug_logger.php';

$input = json_decode(file_get_contents('php://input'), true);
$message = trim($input['message'] ?? '');

if (empty($message)) {
    echo json_encode(['success' => false, 'error' => 'Payload empty']);
    exit();
}

$clientIp = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';

try {
    $db = getDbConnection();
    $stmt = $db->prepare("INSERT INTO transmissions (message, sender_ip) VALUES (:message, :ip)");
    $stmt->execute([
        ':message' => $message,
        ':ip' => $clientIp
    ]);

    echo json_encode(['success' => true]);
} catch (Exception $e) {
    logSystemError('FEED_INSERT_FAIL', $e->getMessage());
    echo json_encode(['success' => false, 'error' => 'Database operation failed']);
}