<?php
// public/api/uplink_stream.php
require_once __DIR__ . '/database.php';

initSession();
session_write_close();

header('Content-Type: text/event-stream');
header('Cache-Control: no-cache');
header('Connection: keep-alive');
header('X-Accel-Buffering: no');

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
    if ((time() - $start) > 15) {
        echo ": heartbeat\n\n";
        ob_flush();
        flush();
        $start = time();
    }

    try {
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
                $ts = isset($row['created_at']) ? $row['created_at'] : date('Y-m-d H:i:s');

                echo "data: " . json_encode([
                    'id' => $lastSeenId,
                    'username' => $uname,
                    'message' => $row['message'],
                    'date' => substr($ts, 0, 10),
                    'created_at' => substr($ts, 11, 8)
                ]) . "\n\n";
            }
            ob_flush();
            flush();
        }
    } catch (Exception $e) {
        // Ignore transient stream read errors
    }

    sleep(1);
}