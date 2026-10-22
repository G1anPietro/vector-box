<?php
// public/api/command.php
session_start();
header('Content-Type: application/json');

require_once __DIR__ . '/debug_logger.php';

$input = json_decode(file_get_contents('php://input'), true);

// 1. PUBLIC TERMINAL TRANSMISSION (SOLO NTFY.SH)
$message = trim($input['message'] ?? $_POST['message'] ?? '');

if (!empty($message)) {
    $clientIp = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';

    $ch = curl_init('https://ntfy.sh/Messageg0kZ2n5yCH4Q');
    curl_setopt($ch, CURLOPT_POST, 1);
    curl_setopt($ch, CURLOPT_POSTFIELDS, "IP Address: {$clientIp}\nMessage: {$message}");
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Title: New Public Terminal Transmission',
        'Tags: incoming_envelope,warning'
    ]);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 5);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);

    $result = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($result !== false && $httpCode >= 200 && $httpCode < 300) {
        echo json_encode(['success' => true]);
    } else {
        logSystemError('NTFY_PUSH_FAIL', "HTTP Code: {$httpCode} | Error: {$curlError}", ['response' => $result]);
        echo json_encode(['success' => false, 'error' => 'Failed to send ntfy notification']);
    }
    exit();
}

// 2. COMANDI MINECRAFT AUTENTICATI
if (!isset($_SESSION['user'])) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Unauthorized']);
    exit();
}

$command = trim($input['command'] ?? '');
if ($command !== '') {
    $sanitized = preg_replace('/[^a-zA-Z0-9_\-\s]/', '', $command);
    exec("screen -S mc_server -X stuff " . escapeshellarg($sanitized . "\r"));
    echo json_encode(['success' => true]);
    exit();
}

echo json_encode(['success' => false, 'error' => 'Empty payload']);