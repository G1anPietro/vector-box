<?php
// public/api/moderate_user.php
require_once __DIR__ . '/database.php';

initSession();

header('Content-Type: application/json');

// Verify CSRF
$csrfHeader = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
$sessionToken = $_SESSION['csrf_token'] ?? '';
if (empty($sessionToken) || !hash_equals($sessionToken, $csrfHeader)) {
    http_response_code(403);
    echo json_encode(['success' => false, 'error' => 'CSRF verification failed']);
    exit();
}

// Verify Admin Status
if (empty($_SESSION['is_admin'])) {
    http_response_code(403);
    echo json_encode(['success' => false, 'error' => 'UNAUTHORIZED: Admin privileges required']);
    exit();
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$targetUsername = trim($input['username'] ?? '');
$action = $input['action'] ?? ''; // 'ban', 'timeout', or 'unban'
$minutes = (int)($input['minutes'] ?? 10);

if (empty($targetUsername) || !in_array($action, ['ban', 'timeout', 'unban'])) {
    echo json_encode(['success' => false, 'error' => 'Invalid parameters']);
    exit();
}

try {
    $db = getDbConnection();

    if ($action === 'ban') {
        $stmt = $db->prepare("UPDATE accounts SET is_banned = 1, banned_until = NULL WHERE username = :u AND is_admin = 0");
        $stmt->execute([':u' => $targetUsername]);
    } elseif ($action === 'timeout') {
        $until = date('Y-m-d H:i:s', strtotime("+{$minutes} minutes"));
        $stmt = $db->prepare("UPDATE accounts SET banned_until = :until WHERE username = :u AND is_admin = 0");
        $stmt->execute([':until' => $until, ':u' => $targetUsername]);
    } elseif ($action === 'unban') {
        $stmt = $db->prepare("UPDATE accounts SET is_banned = 0, banned_until = NULL WHERE username = :u");
        $stmt->execute([':u' => $targetUsername]);
    }

    echo json_encode(['success' => true, 'username' => $targetUsername, 'action' => $action]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Database update failed']);
}