<?php
// public/api/check_session.php
require_once __DIR__ . '/database.php';

initSession();

header('Content-Type: application/json');

$userId = $_SESSION['user_id'] ?? null;
$username = $_SESSION['username'] ?? 'guest';
$isAdmin = (int)($_SESSION['is_admin'] ?? 0);

// Genera un token CSRF se non ne esiste già uno per la sessione
if (empty($_SESSION['csrf_token'])) {
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
}

echo json_encode([
    'logged_in' => !empty($userId),
    'user_id' => $userId,
    'username' => $username,
    'is_admin' => $isAdmin,
    'csrf_token' => $_SESSION['csrf_token']
]);