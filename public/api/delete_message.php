<?php
// public/api/delete_message.php
require_once __DIR__ . '/database.php';

initSession();

requireCsrf();
requireAdmin();

$input = readJsonBody();
$messageId = isset($input['id']) ? (int)$input['id'] : 0;

if ($messageId <= 0) {
    jsonResponse(['success' => false, 'error' => 'Invalid message ID'], 400);
}

try {
    $db = getDbConnection();
    $stmt = $db->prepare("UPDATE transmissions SET is_deleted = 1 WHERE id = :id");
    $stmt->execute([':id' => $messageId]);

    jsonResponse(['success' => true, 'id' => $messageId]);
} catch (Throwable $e) {
    failInternal('DELETE_MESSAGE', $e, 'Database update failed');
}
