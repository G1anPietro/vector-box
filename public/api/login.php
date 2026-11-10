<?php
// public/api/login.php
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/rate_limiter.php';
require_once __DIR__ . '/debug_logger.php';

header('Content-Type: application/json');

$input = readJsonBody();
$action = $input['action'] ?? 'login';
// Passwords are trimmed to stay compatible with hashes created by earlier versions
$username = trim((string)($input['username'] ?? ''));
$password = trim((string)($input['password'] ?? ''));

if ($username === '' || $password === '') {
    jsonResponse(['success' => false, 'error' => 'Username and password required'], 400);
}
if (strlen($username) > 64 || strlen($password) > 1024) {
    jsonResponse(['success' => false, 'error' => 'Invalid credentials'], 400);
}

try {
    $db = getDbConnection();

    if ($action === 'register') {
        if (!checkRateLimit('register', 5, 3600)) {
            jsonResponse(['success' => false, 'error' => 'Too many registrations from this address, try later'], 429);
        }
        if ($err = validateNewUsername($username) ?? validateNewPassword($password)) {
            jsonResponse(['success' => false, 'error' => $err], 400);
        }

        $hash = password_hash($password, PASSWORD_DEFAULT);
        try {
            $stmt = $db->prepare("INSERT INTO accounts (username, password_hash, theme, is_admin) VALUES (:u, :p, 'cyan', 0)");
            $stmt->execute([':u' => $username, ':p' => $hash]);
        } catch (PDOException $e) {
            // UNIQUE violation: atomic, no check-then-insert race
            if ((string)$e->getCode() === '23000') {
                jsonResponse(['success' => false, 'error' => 'Username already taken'], 409);
            }
            throw $e;
        }

        $account = ['id' => $db->lastInsertId(), 'username' => $username, 'theme' => 'cyan', 'is_admin' => 0];
        $csrf = establishSession($account);

        jsonResponse(['success' => true, 'username' => $username, 'theme' => 'cyan', 'is_admin' => 0, 'csrf_token' => $csrf]);
    }

    // ---- login ----
    if (!checkRateLimit('login_ip', 10, 300) || !checkRateLimit('login_user', 5, 300, strtolower($username))) {
        jsonResponse(['success' => false, 'error' => 'Too many attempts. Try again in a few minutes'], 429);
    }

    $stmt = $db->prepare("SELECT * FROM accounts WHERE username = :u");
    $stmt->execute([':u' => $username]);
    $user = $stmt->fetch() ?: null;

    if (!verifyPasswordSafe($user, $password)) {
        jsonResponse(['success' => false, 'error' => 'Invalid credentials'], 401);
    }

    $csrf = establishSession($user);

    jsonResponse([
        'success' => true,
        'username' => $user['username'],
        'theme' => $user['theme'] ?? 'cyan',
        'is_admin' => (int)($user['is_admin'] ?? 0),
        'csrf_token' => $csrf,
    ]);
} catch (Throwable $e) {
    logSystemError('LOGIN_FAIL', $e->getMessage());
    jsonResponse(['success' => false, 'error' => 'Authentication server error'], 500);
}
