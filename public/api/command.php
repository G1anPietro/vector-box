<?php
// public/api/command.php
session_start();
header('Content-Type: application/json');

require_once __DIR__ . '/debug_logger.php';
require_once __DIR__ . '/rate_limiter.php';

$input = json_decode(file_get_contents('php://input'), true);
$message = trim($input['message'] ?? $_POST['message'] ?? '');

if (!empty($message)) {
    // Rate limit ntfy messages: max 2 per 30 seconds
    if (!checkRateLimit('ntfy_send', 2, 30)) {
        http_response_code(429);
        echo json_encode(['success' => false, 'error' => 'RATE_LIMIT_EXCEEDED: Push uplink cooling down.']);
        exit();
    }

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
        echo json_encode(['success' => false, 'error' => 'Failed to route transmission to ntfy.sh']);
    }
    exit();
}