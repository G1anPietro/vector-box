<?php
session_start();
header('Content-Type: application/json');

if (!isset($_SESSION['user'])) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Unauthorized']);
    exit();
}

$input = json_decode(file_get_contents('php://input'), true);
$command = trim($input['command'] ?? '');

if ($command !== '') {
    // Sanitized: stripped double quote breaks and controlled metacharacters
    $sanitized = preg_replace('/[^a-zA-Z0-9_\-\s]/', '', $command);
    exec("screen -S mc_server -X stuff " . escapeshellarg($sanitized . "\r"));
    echo json_encode(['success' => true]);
    exit();
}

echo json_encode(['success' => false, 'error' => 'Empty command']);