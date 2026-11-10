<?php
// public/api/logout.php
require_once __DIR__ . '/database.php';

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
