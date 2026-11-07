<?php
// public/api/moderate_book_access.php
require_once __DIR__ . '/database.php';

header('Content-Type: application/json');
initSession();

// Restrict command execution to Administrators only
if (empty($_SESSION['is_admin'])) {
    http_response_code(403);
    echo json_encode(['success' => false, 'error' => 'Access denied: Admin privileges required.']);
    exit();
}

$input = json_decode(file_get_contents('php://input'), true);
$action = $input['action'] ?? '';
$targetUser = trim($input['username'] ?? '');

if (!$targetUser) {
    echo json_encode(['success' => false, 'error' => 'Username requirement missing.']);
    exit();
}

$db = getDbConnection();

try {
    if ($action === 'grant') {
        $stmt = $db->prepare("UPDATE accounts SET can_read_books = 1 WHERE username = :username");
        $stmt->execute([':username' => $targetUser]);
        
        if ($stmt->rowCount() > 0) {
            echo json_encode(['success' => true, 'message' => "Book reading access granted to user '{$targetUser}'."]);
        } else {
            echo json_encode(['success' => false, 'error' => "User '{$targetUser}' not found."]);
        }
    } elseif ($action === 'revoke') {
        $stmt = $db->prepare("UPDATE accounts SET can_read_books = 0 WHERE username = :username");
        $stmt->execute([':username' => $targetUser]);
        
        if ($stmt->rowCount() > 0) {
            echo json_encode(['success' => true, 'message' => "Book reading access revoked for user '{$targetUser}'."]);
        } else {
            echo json_encode(['success' => false, 'error' => "User '{$targetUser}' not found."]);
        }
    } else {
        echo json_encode(['success' => false, 'error' => 'Invalid moderation action specified.']);
    }
} catch (Exception $e) {
    echo json_encode(['success' => false, 'error' => 'Database operation failed.']);
}