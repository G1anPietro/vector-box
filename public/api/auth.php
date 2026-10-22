<?php
// public/api/auth.php
session_start();
header('Content-Type: application/json');

require_once __DIR__ . '/database.php';
require_once __DIR__ . '/debug_logger.php';

$input = json_decode(file_get_contents('php://input'), true);
$action = $input['action'] ?? '';
$username = trim($input['username'] ?? '');
$password = trim($input['password'] ?? '');

if (empty($username) || empty($password)) {
    echo json_encode(['success' => false, 'error' => 'Username and password required']);
    exit();
}

try {
    $db = getDbConnection();

    if ($action === 'register') {
        // Check availability
        $checkStmt = $db->prepare("SELECT COUNT(*) FROM accounts WHERE username = :u");
        $checkStmt->execute([':u' => $username]);
        if ($checkStmt->fetchColumn() > 0) {
            echo json_encode(['success' => false, 'error' => 'Username already registered']);
            exit();
        }

        // Create account
        $hash = password_hash($password, PASSWORD_BCRYPT);
        $stmt = $db->prepare("INSERT INTO accounts (username, password_hash, theme) VALUES (:u, :p, 'cyan')");
        $stmt->execute([':u' => $username, ':p' => $hash]);

        $userId = $db->lastInsertId();
        $_SESSION['user_id'] = $userId;
        $_SESSION['username'] = $username;
        $_SESSION['theme'] = 'cyan';

        echo json_encode(['success' => true, 'username' => $username, 'theme' => 'cyan']);
        exit();

    } elseif ($action === 'login') {
        $stmt = $db->prepare("SELECT * FROM accounts WHERE username = :u");
        $stmt->execute([':u' => $username]);
        $user = $stmt->fetch();

        if ($user && password_verify($password, $user['password_hash'])) {
            $_SESSION['user_id'] = $user['id'];
            $_SESSION['username'] = $user['username'];
            $_SESSION['theme'] = $user['theme'] ?? 'cyan';

            echo json_encode([
                'success' => true, 
                'username' => $user['username'], 
                'theme' => $_SESSION['theme']
            ]);
            exit();
        } else {
            echo json_encode(['success' => false, 'error' => 'Invalid credentials']);
            exit();
        }
    }

} catch (Exception $e) {
    logSystemError('AUTH_FAIL', $e->getMessage());
    echo json_encode(['success' => false, 'error' => 'Authentication server error']);
}