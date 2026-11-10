<?php
// public/api/get_feed.php
require_once __DIR__ . '/database.php';

initSession();
header('Content-Type: application/json');

$roomId = preg_replace('/[^a-zA-Z0-9_\-]/', '', strtolower($_GET['room_id'] ?? 'general'));
$beforeId = isset($_GET['before_id']) ? (int)$_GET['before_id'] : 0;
$limit = isset($_GET['limit']) ? min((int)$_GET['limit'], 50) : 25;

try {
    $db = getDbConnection();

    // Hidden rooms (e.g. the admin room) are readable by admins only
    $stmt = $db->prepare("SELECT is_hidden FROM rooms WHERE id = :id");
    $stmt->execute([':id' => $roomId]);
    $room = $stmt->fetch();
    if ($room && (int)$room['is_hidden'] === 1 && empty($_SESSION['is_admin'])) {
        jsonResponse(['success' => false, 'error' => 'FORBIDDEN: Restricted room'], 403);
    }

    // Newest id overall (read BEFORE the rows): the live stream resumes from here,
    // so nothing posted between this request and the stream connecting is lost.
    $latestId = (int)$db->query("SELECT COALESCE(MAX(id), 0) FROM transmissions")->fetchColumn();

    if ($beforeId > 0) {
        $stmt = $db->prepare("SELECT id, room_id, username, message, created_at 
                              FROM transmissions 
                              WHERE room_id = :rid AND id < :before_id AND (is_deleted = 0 OR is_deleted IS NULL) 
                              ORDER BY id DESC LIMIT :lim");
        $stmt->bindValue(':before_id', $beforeId, PDO::PARAM_INT);
    } else {
        $stmt = $db->prepare("SELECT id, room_id, username, message, created_at 
                              FROM transmissions 
                              WHERE room_id = :rid AND (is_deleted = 0 OR is_deleted IS NULL) 
                              ORDER BY id DESC LIMIT :lim");
    }

    $stmt->bindValue(':rid', $roomId, PDO::PARAM_STR);
    $stmt->bindValue(':lim', $limit, PDO::PARAM_INT);
    $stmt->execute();
    $rows = $stmt->fetchAll();

    $messages = array_reverse($rows);

    $formatted = array_map('formatTransmission', $messages);

    echo json_encode([
        'success' => true,
        'messages' => $formatted,
        'has_more' => count($rows) === $limit,
        'latest_id' => $latestId
    ]);

} catch (Exception $e) {
    failInternal('GET_FEED', $e);
}