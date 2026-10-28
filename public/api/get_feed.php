<?php
// public/api/get_feed.php
require_once __DIR__ . '/database.php';

header('Content-Type: application/json');

$roomId = preg_replace('/[^a-zA-Z0-9_\-]/', '', strtolower($_GET['room_id'] ?? 'general'));
$beforeId = isset($_GET['before_id']) ? (int)$_GET['before_id'] : 0;
$limit = isset($_GET['limit']) ? min((int)$_GET['limit'], 50) : 25;

try {
    $db = getDbConnection();

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

    $formatted = array_map(function($row) {
        $timestamp = isset($row['created_at']) ? $row['created_at'] : date('Y-m-d H:i:s');
        return [
            'id' => (int)$row['id'],
            'room_id' => $row['room_id'] ?? 'general',
            'username' => !empty($row['username']) ? $row['username'] : 'guest',
            'message' => $row['message'],
            'date' => substr($timestamp, 0, 10),
            'created_at' => substr($timestamp, 11, 8)
        ];
    }, $messages);

    echo json_encode([
        'success' => true,
        'messages' => $formatted,
        'has_more' => count($rows) === $limit
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}