<?php
// public/api/rooms.php
require_once __DIR__ . '/database.php';

initSession();
header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'];
$isAdmin = !empty($_SESSION['is_admin']);

try {
    $db = getDbConnection();

    if ($method === 'GET') {
        $where = $isAdmin ? '' : 'WHERE is_hidden = 0';
        $stmt = $db->query("SELECT id, name, is_private, is_hidden FROM rooms $where ORDER BY is_private DESC, name ASC");
        $allRooms = $stmt->fetchAll();

        echo json_encode(['success' => true, 'rooms' => array_values($allRooms)]);
        exit();
    }

    if ($method === 'POST') {
        requireAdmin();
        requireCsrf();

        $rawInput = file_get_contents('php://input');
        $input = json_decode($rawInput, true) ?? [];
        $roomId = preg_replace('/[^a-zA-Z0-9_\-]/', '', strtolower(trim($input['id'] ?? '')));
        $roomName = trim($input['name'] ?? $roomId);
        $isPrivate = !empty($input['is_private']) ? 1 : 0;
        $isHidden = !empty($input['is_hidden']) ? 1 : 0;
        $roomName = textCut($roomName, 50);

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

        $stmt = $db->prepare("INSERT INTO rooms (id, name, is_private, is_hidden) VALUES (:id, :name, :priv, :hid)");
        $stmt->execute([':id' => $roomId, ':name' => $roomName, ':priv' => $isPrivate, ':hid' => $isHidden]);

        echo json_encode(['success' => true, 'room' => ['id' => $roomId, 'name' => $roomName, 'is_private' => $isPrivate, 'is_hidden' => $isHidden]]);
        exit();
    }
} catch (Exception $e) {
    failInternal('ROOMS', $e);
}