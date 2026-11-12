<?php
// public/api/moderate_book_access.php
require_once __DIR__ . '/database.php';

header('Content-Type: application/json');
initSession();

// Restrict command execution to Administrators only
requireAdmin();
requireCsrf();

$input = json_decode(file_get_contents('php://input'), true);
$action = $input['action'] ?? '';
$targetUser = trim($input['username'] ?? '');
// What the permission is for: the library (default) or the private CV page
$scopes = [
    'books'  => ['column' => 'can_read_books',  'label' => 'Book reading'],
    'resume' => ['column' => 'can_view_resume', 'label' => 'CV (resume) viewing'],
];
$scope = $scopes[$input['scope'] ?? 'books'] ?? null;
if ($scope === null) {
    echo json_encode(['success' => false, 'error' => 'Unknown permission.']);
    exit();
}

if (!$targetUser) {
    echo json_encode(['success' => false, 'error' => 'Username requirement missing.']);
    exit();
}

$db = getDbConnection();

try {
    if ($action === 'grant') {
        $stmt = $db->prepare("UPDATE accounts SET {$scope['column']} = 1 WHERE username = :username");
        $stmt->execute([':username' => $targetUser]);
        
        if ($stmt->rowCount() > 0) {
            echo json_encode(['success' => true, 'message' => "{$scope['label']} access granted to user '{$targetUser}'."]);
        } else {
            echo json_encode(['success' => false, 'error' => "User '{$targetUser}' not found."]);
        }
    } elseif ($action === 'revoke') {
        $stmt = $db->prepare("UPDATE accounts SET {$scope['column']} = 0 WHERE username = :username");
        $stmt->execute([':username' => $targetUser]);
        
        if ($stmt->rowCount() > 0) {
            echo json_encode(['success' => true, 'message' => "{$scope['label']} access revoked for user '{$targetUser}'."]);
        } else {
            echo json_encode(['success' => false, 'error' => "User '{$targetUser}' not found."]);
        }
    } else {
        echo json_encode(['success' => false, 'error' => 'Invalid moderation action specified.']);
    }
} catch (Exception $e) {
    failInternal('MODERATE_BOOK_ACCESS', $e, 'Database operation failed.');
}