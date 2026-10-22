<?php
// public/api/uplink_stream.php
require_once __DIR__ . '/database.php';

initSession();

// Prevent PHP session locking across concurrent SSE streams
session_write_close();

header('Content-Type: text/event-stream');
header('Cache-Control: no-cache');
header('Connection: keep-alive');
header('X-Accel-Buffering: no'); // Disables Nginx output buffering for immediate delivery

$lastSeenId = isset($_GET['last_id']) ? (int)$_GET['last_id'] : 0;

try {
    $db = getDbConnection();
} catch (Exception $e) {
    echo "event: error\ndata: " . json_encode(['error' => 'Database offline']) . "\n\n";
    ob_flush();
    flush();
    exit();
}

$start = time();

while (true) {
    // Send periodic SSE heartbeat every 15s to keep connection alive
    if ((time() - $start) > 15) {
        echo ": heartbeat\n\n";
        ob_flush();
        flush();
        $start = time();
    }

    try {
        // Query missing records indexed by ID
        $stmt = $db->prepare("SELECT id, username, message, created_at 
                              FROM transmissions 
                              WHERE id > :last_id AND (is_deleted = 0 OR is_deleted IS NULL) 
                              ORDER BY id ASC LIMIT 50");
        $stmt->execute([':last_id' => $lastSeenId]);
        $rows = $stmt->fetchAll();

        if (!empty($rows)) {
            foreach ($rows as $row) {
                $lastSeenId = (int)$row['id'];
                $uname = !empty($row['username']) ? $row['username'] : 'guest';

                echo "data: " . json_encode([
                    'id' => $lastSeenId,
                    'username' => $uname,
                    'message' => $row['message'],
                    'created_at' => isset($row['created_at']) ? substr($row['created_at'], 11, 8) : date('H:i:s')
                ]) . "\n\n";
            }
            ob_flush();
            flush();
        }
    } catch (Exception $e) {
        // Ignore transient stream read errors
    }

    // 1 second poll delay reduces SQLite disk load drastically while staying real-time
    sleep(1);
}