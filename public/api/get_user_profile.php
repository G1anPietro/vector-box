<?php
// public/api/get_user_profile.php
require_once __DIR__ . '/database.php';

initSession();
header('Content-Type: application/json');

$targetUser = trim($_GET['username'] ?? '');

if (empty($targetUser)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Username parameter required']);
    exit();
}

try {
    $db = getDbConnection();
    
    // Ensure bio column exists
    try {
        $db->exec("ALTER TABLE accounts ADD COLUMN bio TEXT DEFAULT ''");
    } catch (Exception $e) {}

    $stmt = $db->prepare("SELECT username, is_admin, created_at, bio FROM accounts WHERE username = :u");
    $stmt->execute([':u' => $targetUser]);
    $user = $stmt->fetch();

    if ($user) {
        echo json_encode([
            'success' => true,
            'username' => $user['username'],
            'is_admin' => (int)$user['is_admin'] === 1,
            'created_at' => $user['created_at'] ?? 'RECORDED',
            'bio' => $user['bio'] ?? ''
        ]);
    } else {
        http_response_code(404);
        echo json_encode(['success' => false, 'error' => "User '{$targetUser}' not found"]);
    }
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}