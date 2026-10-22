<?php
// public/api/uplink_send.php
header('Content-Type: application/json');
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/debug_logger.php';
require_once __DIR__ . '/rate_limiter.php';

$input = json_decode(file_get_contents('php://input'), true);
$message = trim($input['message'] ?? '');

if (empty($message)) {
    echo json_encode(['success' => false, 'error' => 'Payload empty']);
    exit();
}

// 1. Rate Limit Enforcement (Max 5 msgs every 10 seconds)
if (!checkRateLimit('feed_send', 5, 10)) {
    http_response_code(429);
    echo json_encode(['success' => false, 'error' => 'RATE_LIMIT_EXCEEDED: Slow down transmissions.']);
    exit();
}

$clientIp = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';

try {
    $db = getDbConnection();

    // 2. Duplicate Message Protection (Blocks identical message from same IP within 10s)
    $checkStmt = $db->prepare("SELECT COUNT(*) FROM transmissions WHERE sender_ip = :ip AND message = :msg AND created_at > datetime('now', '-10 seconds')");
    $checkStmt->execute([':ip' => $clientIp, ':msg' => $message]);
    if ($checkStmt->fetchColumn() > 0) {
        echo json_encode(['success' => false, 'error' => 'DUPLICATE_PAYLOAD: Message already transmitted recently.']);
        exit();
    }

    // 3. Database Storage & Auto-Prune (>1GB limit enforcement)
    $projectRoot = dirname(__DIR__, 2);
    $dbPath = $projectRoot . '/data/vector_uplink.sqlite';

    if (file_exists($dbPath) && filesize($dbPath) > 1073741824) {
        $db->exec("DELETE FROM transmissions WHERE id NOT IN (SELECT id FROM transmissions ORDER BY id DESC LIMIT 1000)");
        $db->exec("VACUUM;");
        logSystemError('DB_AUTO_PRUNE', 'Database purged older entries due to 1GB limit.');
    }

    $stmt = $db->prepare("INSERT INTO transmissions (message, sender_ip) VALUES (:message, :ip)");
    $stmt->execute([':message' => $message, ':ip' => $clientIp]);

    echo json_encode(['success' => true]);
} catch (Exception $e) {
    logSystemError('FEED_INSERT_FAIL', $e->getMessage());
    echo json_encode(['success' => false, 'error' => 'Database operation failed']);
}