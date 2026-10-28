<?php
// public/api/delete_message.php
require_once __DIR__ . '/database.php';

initSession();

header('Content-Type: application/json');

// CSRF Verification
$csrfHeader = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
$sessionToken = $_SESSION['csrf_token'] ?? '';

if (empty($sessionToken) || !hash_equals($sessionToken, $csrfHeader)) {
    http_response_code(403);
    echo json_encode(['success' => false, 'error' => 'FORBIDDEN: Invalid or missing CSRF token']);
    exit();
}

$isAdmin = $_SESSION['is_admin'] ?? 0;
if (!$isAdmin) {
    http_response_code(403);
    echo json_encode(['success' => false, 'error' => 'UNAUTHORIZED: Admin privileges required']);
    exit();
}

$input = json_decode(file_get_contents('php://input'), true);
$messageId = isset($input['id']) ? (int)$input['id'] : 0;

if ($messageId <= 0) {
    echo json_encode(['success' => false, 'error' => 'Invalid message ID']);
    exit();
}

try {
    $db = getDbConnection();
    $stmt = $db->prepare("UPDATE transmissions SET is_deleted = 1 WHERE id = :id");
    $stmt->execute([':id' => $messageId]);

    echo json_encode(['success' => true, 'id' => $messageId]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Database update failed']);
}