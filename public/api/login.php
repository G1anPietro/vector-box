<?php
// public/api/login.php
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/debug_logger.php';

initSession();

header('Content-Type: application/json');

$input = json_decode(file_get_contents('php://input'), true);
$action = $input['action'] ?? 'login';
$username = trim($input['username'] ?? '');
$password = trim($input['password'] ?? '');

if (empty($username) || empty($password)) {
    echo json_encode(['success' => false, 'error' => 'Username and password required']);
    exit();
}

try {
    $db = getDbConnection();

    if ($action === 'register') {
        $checkStmt = $db->prepare("SELECT COUNT(*) FROM accounts WHERE username = :u");
        $checkStmt->execute([':u' => $username]);
        if ($checkStmt->fetchColumn() > 0) {
            echo json_encode(['success' => false, 'error' => 'Username already taken']);
            exit();
        }

        $hash = password_hash($password, PASSWORD_BCRYPT);
        $stmt = $db->prepare("INSERT INTO accounts (username, password_hash, theme, is_admin) VALUES (:u, :p, 'cyan', 0)");
        $stmt->execute([':u' => $username, ':p' => $hash]);

        $userId = $db->lastInsertId();

        // Generate CSRF Token
        $csrfToken = bin2hex(random_bytes(32));

        $_SESSION['user_id'] = (int)$userId;
        $_SESSION['username'] = $username;
        $_SESSION['theme'] = 'cyan';
        $_SESSION['is_admin'] = 0;
        $_SESSION['csrf_token'] = $csrfToken;
        session_write_close();

        echo json_encode([
            'success' => true, 
            'username' => $username, 
            'theme' => 'cyan',
            'is_admin' => 0,
            'csrf_token' => $csrfToken
        ]);
        exit();

    } else {
        $stmt = $db->prepare("SELECT * FROM accounts WHERE username = :u");
        $stmt->execute([':u' => $username]);
        $user = $stmt->fetch();

        if ($user && password_verify($password, $user['password_hash'])) {
            $isAdmin = (int)($user['is_admin'] ?? 0);

            // Generate CSRF Token
            $csrfToken = bin2hex(random_bytes(32));

            $_SESSION['user_id'] = (int)$user['id'];
            $_SESSION['username'] = $user['username'];
            $_SESSION['theme'] = $user['theme'] ?? 'cyan';
            $_SESSION['is_admin'] = $isAdmin;
            $_SESSION['csrf_token'] = $csrfToken;
            session_write_close();

            echo json_encode([
                'success' => true, 
                'username' => $user['username'], 
                'theme' => $_SESSION['theme'],
                'is_admin' => $isAdmin,
                'csrf_token' => $csrfToken
            ]);
            exit();
        } else {
            echo json_encode(['success' => false, 'error' => 'Invalid credentials']);
            exit();
        }
    }
} catch (Exception $e) {
    logSystemError('LOGIN_FAIL', $e->getMessage());
    echo json_encode(['success' => false, 'error' => 'Authentication server error']);
}