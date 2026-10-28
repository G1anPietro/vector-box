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
        $stmt = $db->query("SELECT id, name, is_private FROM rooms ORDER BY is_private ASC, name ASC");
        $allRooms = $stmt->fetchAll();

        // Filter out private rooms unless the session belongs to an admin
        $rooms = array_filter($allRooms, function($r) use ($isAdmin) {
            return (int)$r['is_private'] === 0 || $isAdmin;
        });

        echo json_encode(['success' => true, 'rooms' => array_values($rooms)]);
        exit();
    }

    if ($method === 'POST') {
        $rawInput = file_get_contents('php://input');
        $input = json_decode($rawInput, true) ?? [];
        $roomId = preg_replace('/[^a-zA-Z0-9_\-]/', '', strtolower(trim($input['id'] ?? '')));
        $roomName = trim($input['name'] ?? $roomId);

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

        $stmt = $db->prepare("INSERT INTO rooms (id, name, is_private) VALUES (:id, :name, 0)");
        $stmt->execute([':id' => $roomId, ':name' => $roomName]);

        echo json_encode(['success' => true, 'room' => ['id' => $roomId, 'name' => $roomName, 'is_private' => 0]]);
        exit();
    }
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}