<?php
// public/api/check_session.php
require_once __DIR__ . '/database.php';

// Writable: the CSRF token must actually be persisted, otherwise it changes on every call
initSession(true);

if (empty($_SESSION['csrf_token'])) {
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
}

$payload = [
    'logged_in' => !empty($_SESSION['user_id']),
    'user_id'   => $_SESSION['user_id'] ?? null,
    'username'  => $_SESSION['username'] ?? 'guest',
    'is_admin'  => (int)($_SESSION['is_admin'] ?? 0),
    'csrf_token' => $_SESSION['csrf_token'],
    // Node chat hub stream (null = not configured, use the PHP stream)
    'chat_stream' => chatStreamConfig(!empty($_SESSION['is_admin']), (string)($_SESSION['username'] ?? '')),
];
session_write_close();

header('Cache-Control: no-store');
jsonResponse($payload);
