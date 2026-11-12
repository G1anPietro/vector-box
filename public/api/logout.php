<?php
// public/api/logout.php
require_once __DIR__ . '/database.php';

// Logout is a plain link (GET), so it can't carry a CSRF token. Refuse it when it comes from
// another website (Sec-Fetch-Site, sent by every modern browser), so a page elsewhere can't log you out.
if (strtolower($_SERVER['HTTP_SEC_FETCH_SITE'] ?? 'none') === 'cross-site') {
    http_response_code(403);
    exit('Logout must start from vector-box.');
}

startWritableSession();
$_SESSION = [];

if (ini_get('session.use_cookies')) {
    $params = session_get_cookie_params();
    setcookie(session_name(), '', [
        'expires'  => time() - 42000,
        'path'     => $params['path'],
        'domain'   => $params['domain'],
        'secure'   => $params['secure'],
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}
session_destroy();

if (str_contains($_SERVER['HTTP_ACCEPT'] ?? '', 'application/json')) {
    jsonResponse(['success' => true, 'message' => 'Logged out successfully']);
}
header('Location: ../pages/login.php');
exit();
