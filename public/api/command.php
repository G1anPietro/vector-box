<?php
// public/api/command.php  (public "transmit message" form -> ntfy push)
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/debug_logger.php';
require_once __DIR__ . '/rate_limiter.php';

header('Content-Type: application/json');

// It pushes a notification to the owner's phone: only from the site's own pages (CSRF token),
// so other websites can't make visitors' browsers send messages.
initSession();
requireCsrf();

$input = readJsonBody();
$message = trim((string)($input['message'] ?? $_POST['message'] ?? ''));

if ($message === '') {
    jsonResponse(['success' => false, 'error' => 'Empty payload detected.'], 400);
}
if (textLength($message) > 500) {
    jsonResponse(['success' => false, 'error' => 'MESSAGE_TOO_LONG: Maximum length is 500 characters'], 400);
}

$ntfyTopicUrl = envValue('NTFY_TOPIC_URL');
if (!$ntfyTopicUrl) {
    logSystemError('NTFY_CONFIG', 'NTFY_TOPIC_URL is not configured');
    jsonResponse(['success' => false, 'error' => 'Transmission channel is not configured'], 503);
}

// max 2 per 30 seconds per client
if (!checkRateLimit('ntfy_send', 2, 30)) {
    jsonResponse(['success' => false, 'error' => 'RATE_LIMIT_EXCEEDED: Push uplink cooling down.'], 429);
}

$clientIp = getClientIp();

$ch = curl_init($ntfyTopicUrl);
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => "IP Address: {$clientIp}\nMessage: {$message}",
    CURLOPT_HTTPHEADER     => ['Title: New Public Terminal Transmission', 'Tags: incoming_envelope,warning'],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 5,
    CURLOPT_SSL_VERIFYPEER => true,
]);

$result = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

if ($result !== false && $httpCode >= 200 && $httpCode < 300) {
    jsonResponse(['success' => true]);
}

logSystemError('NTFY_PUSH_FAIL', "HTTP Code: {$httpCode} | Error: {$curlError}");
jsonResponse(['success' => false, 'error' => 'Failed to route transmission to ntfy.sh'], 502);
