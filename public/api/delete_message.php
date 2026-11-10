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

    // Tell open clients to drop it (only possible through the Node hub)
    $stmt = $db->prepare("SELECT room_id FROM transmissions WHERE id = :id");
    $stmt->execute([':id' => $messageId]);
    $roomId = $stmt->fetchColumn();
    if ($roomId !== false) {
        $roomId = $roomId ?: 'general';
        notifyChatHub([
            'type'    => 'delete',
            'hidden'  => isRoomHidden($db, $roomId),
            'id'      => $messageId,
            'room_id' => $roomId,
        ]);
    }

    jsonResponse(['success' => true, 'id' => $messageId]);
} catch (Throwable $e) {
    failInternal('DELETE_MESSAGE', $e, 'Database update failed');
}
