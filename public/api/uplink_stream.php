<?php
// public/api/uplink_stream.php
require_once __DIR__ . '/database.php';

header('Content-Type: text/event-stream');
header('Cache-Control: no-cache');
header('Connection: keep-alive');

// Disable output buffering
if (function_exists('apache_setenv')) {
    @apache_setenv('no-gzip', 1);
}
@ini_set('zlib.output_compression', 0);
@ini_set('implicit_flush', 1);
for ($i = 0; $i < ob_get_level(); $i++) {
    ob_end_flush();
}
ob_implicit_flush(1);

$db = getDbConnection();
$lastId = isset($_GET['last_id']) ? (int)$_GET['last_id'] : 0;

if ($lastId === 0) {
    $stmt = $db->query("SELECT MAX(id) FROM transmissions");
    $lastId = (int)$stmt->fetchColumn();
}

while (true) {
    if (connection_aborted()) {
        exit();
    }

    $stmt = $db->prepare("SELECT id, room_id, username, message, created_at 
                          FROM transmissions 
                          WHERE id > :last_id AND (is_deleted = 0 OR is_deleted IS NULL) 
                          ORDER BY id ASC");
    $stmt->execute([':last_id' => $lastId]);
    $messages = $stmt->fetchAll();

    foreach ($messages as $msg) {
        $lastId = (int)$msg['id'];
        $timestamp = $msg['created_at'] ?? date('Y-m-d H:i:s');

        $payload = [
            'id' => $lastId,
            'room_id' => $msg['room_id'] ?? 'general',
            'username' => !empty($msg['username']) ? $msg['username'] : 'guest',
            'message' => $msg['message'],
            'date' => substr($timestamp, 0, 10),
            'created_at' => substr($timestamp, 11, 8)
        ];

        echo "data: " . json_encode($payload) . "\n\n";
        @ob_flush();
        @flush();
    }

    sleep(1);
}