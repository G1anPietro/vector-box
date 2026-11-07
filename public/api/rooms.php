<?php
// public/api/rooms.php
require_once __DIR__ . '/database.php';

initSession();
header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'];
$isAdmin = !empty($_SESSION['is_admin']);

try {
    $db = getDbConnection();

    // Ensure default systemic rooms exist
    $db->exec("INSERT OR IGNORE INTO rooms (id, name, is_private) VALUES ('general', 'General', 0)");
    $db->exec("INSERT OR IGNORE INTO rooms (id, name, is_private) VALUES ('announcements', 'Announcements Board', 1)");

    if ($method === 'GET') {
        $stmt = $db->query("SELECT id, name, is_private FROM rooms ORDER BY is_private DESC, name ASC");
        $allRooms = $stmt->fetchAll();

        echo json_encode(['success' => true, 'rooms' => array_values($allRooms)]);
        exit();
    }

    if ($method === 'POST') {
        if (!$isAdmin) {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'UNAUTHORIZED: Room creation requires admin privileges']);
            exit();
        }

        $rawInput = file_get_contents('php://input');
        $input = json_decode($rawInput, true) ?? [];
        $roomId = preg_replace('/[^a-zA-Z0-9_\-]/', '', strtolower(trim($input['id'] ?? '')));
        $roomName = trim($input['name'] ?? $roomId);
        $isPrivate = !empty($input['is_private']) ? 1 : 0;

        if (empty($roomId)) {
            echo json_encode(['success' => false, 'error' => 'Invalid room identifier']);
            exit();
        }

        $stmt = $db->prepare("SELECT COUNT(*) FROM rooms WHERE id = :id");
        $stmt->execute([':id' => $roomId]);
        if ($stmt->fetchColumn() > 0) {
            echo json_encode(['success' => false, 'error' => "Room '#{$roomId}' already exists"]);
            exit();
        }

        $stmt = $db->prepare("INSERT INTO rooms (id, name, is_private) VALUES (:id, :name, :priv)");
        $stmt->execute([':id' => $roomId, ':name' => $roomName, ':priv' => $isPrivate]);

        echo json_encode(['success' => true, 'room' => ['id' => $roomId, 'name' => $roomName, 'is_private' => $isPrivate]]);
        exit();
    }
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}