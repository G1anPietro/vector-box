<?php
// public/api/uplink_stream.php
require_once __DIR__ . '/database.php';

// Initialize session to check auth, then IMMEDIATELY release the lock
initSession();
if (session_status() === PHP_SESSION_ACTIVE) {
    session_write_close();
}

// Disable execution timeouts for long polling
@ini_set('max_execution_time', 0);
set_time_limit(0);

header('Content-Type: text/event-stream');
header('Cache-Control: no-cache, no-transform');
header('Connection: keep-alive');
header('X-Accel-Buffering: no'); // Prevents Nginx buffering

// Disable PHP output buffering completely
if (function_exists('apache_setenv')) {
    @apache_setenv('no-gzip', 1);
}
@ini_set('zlib.output_compression', 0);
@ini_set('implicit_flush', 1);

for ($i = 0; $i < ob_get_level(); $i++) {
    @ob_end_flush();
}
@ob_implicit_flush(1);

$isAdmin = !empty($_SESSION['is_admin']);
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

$startTime = time();
$maxDuration = 20; // 20-second clean cycle to avoid PHP-FPM worker exhaustion

while ((time() - $startTime) < $maxDuration) {
    if (connection_aborted()) {
        break;
    }

    try {
        $hiddenFilter = $isAdmin ? '' : ' AND room_id NOT IN (SELECT id FROM rooms WHERE is_hidden = 1)';
        $stmt = $db->prepare("SELECT id, room_id, username, message, created_at
                              FROM transmissions
                              WHERE id > :last_id AND (is_deleted = 0 OR is_deleted IS NULL)" . $hiddenFilter . "
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
            // Valid SSE comment block for keep-alive ping
            echo ": heartbeat\n\n";
        }

        @ob_flush();
        @flush();
    } catch (Exception $e) {
        break;
    }

    sleep(1);
}

exit();