<?php
session_start();
header('Content-Type: application/json');

$input = json_decode(file_get_contents('php://input'), true);
$username = trim($input['username'] ?? '');
$password = $input['password'] ?? '';

// Retrieve credentials from environment variables or defined defaults
$adminPassword = getenv('ADMIN_PASSWORD') ?: 'PatateCotte55*';
$guestPassword = getenv('GUEST_PASSWORD') ?: 'PalleSudate!';

if ($username === 'admin' && $password === $adminPassword) {
    $_SESSION['user'] = ['name' => 'Admin', 'role' => 'admin'];
    echo json_encode(['success' => true]);
    exit();
}

if ($username === 'guest' && $password === $guestPassword) {
    $_SESSION['user'] = ['name' => 'Guest', 'role' => 'guest'];
    echo json_encode(['success' => true]);
    exit();
}

http_response_code(401);
echo json_encode(['success' => false, 'error' => 'Invalid credentials.']);