<?php
// public/api/uplink_stream.php
require_once __DIR__ . '/database.php';

// Release session locks immediately if session was active
initSession();

// Disable time limits for streaming execution window
set_time_limit(30);

header('Content-Type: text/event-stream');
header('Cache-Control: no-cache, no-transform');
header('Connection: keep-alive');
header('X-Accel-Buffering: no'); // Prevents Nginx buffering

// Disable output buffering completely
if (function_exists('apache_setenv')) {
    @apache_setenv('no-gzip', 1);
}
@ini_set('zlib.output_compression', 0);
@ini_set('implicit_flush', 1);

for ($i = 0; $i < ob_get_level(); $i++) {
    @ob_end_flush();
}
@ob_implicit_flush(1);

$db = getDbConnection();
$lastId = isset($_GET['last_id']) ? (int)$_GET['last_id'] : 0;

if ($lastId === 0) {
    try {
        $stmt = $db->query("SELECT MAX(id) FROM transmissions");
        $lastId = (int)$stmt->fetchColumn();
    } catch (Exception $e) {
        $lastId = 0;
    }
}

// Set maximum execution window of 25 seconds.
// Exiting cleanly releases the PHP worker back to the FPM pool.
// Client EventSource will automatically reconnect in 1 second.
$startTime = time();
$maxDuration = 25; 

while ((time() - $startTime) < $maxDuration) {
    // Check if browser tab was reloaded or closed
    if (connection_aborted()) {
        break;
    }

    try {
        $stmt = $db->prepare("SELECT id, room_id, username, message, created_at 
                              FROM transmissions 
                              WHERE id > :last_id AND (is_deleted = 0 OR is_deleted IS NULL) 
                              ORDER BY id ASC");
        $stmt->execute([':last_id' => $lastId]);
        $messages = $stmt->fetchAll();

        if (!empty($messages)) {
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
            }
        } else {
            // Heartbeat ping forces socket write so connection_aborted() registers immediately on client refresh
            echo ": ping\n\n";
        }

        @ob_flush();
        @flush();
    } catch (Exception $e) {
        break;
    }

    sleep(1);
}

exit();