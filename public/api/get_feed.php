<?php
// public/api/get_feed.php
require_once __DIR__ . '/database.php';

header('Content-Type: application/json');

$beforeId = isset($_GET['before_id']) ? (int)$_GET['before_id'] : 0;
$limit = isset($_GET['limit']) ? min((int)$_GET['limit'], 50) : 25;

try {
    $db = getDbConnection();

    if ($beforeId > 0) {
        // Fetch older messages prior to the highest/oldest loaded ID
        $stmt = $db->prepare("SELECT id, username, message, created_at 
                              FROM transmissions 
                              WHERE id < :before_id AND (is_deleted = 0 OR is_deleted IS NULL) 
                              ORDER BY id DESC LIMIT :lim");
        $stmt->bindValue(':before_id', $beforeId, PDO::PARAM_INT);
    } else {
        // Initial load: Fetch the latest 25 messages
        $stmt = $db->prepare("SELECT id, username, message, created_at 
                              FROM transmissions 
                              WHERE (is_deleted = 0 OR is_deleted IS NULL) 
                              ORDER BY id DESC LIMIT :lim");
    }

    $stmt->bindValue(':lim', $limit, PDO::PARAM_INT);
    $stmt->execute();
    $rows = $stmt->fetchAll();

    // Reverse array so messages render chronologically (oldest -> newest)
    $messages = array_reverse($rows);

    $formatted = array_map(function($row) {
        return [
            'id' => (int)$row['id'],
            'username' => !empty($row['username']) ? $row['username'] : 'guest',
            'message' => $row['message'],
            'created_at' => isset($row['created_at']) ? substr($row['created_at'], 11, 8) : date('H:i:s')
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