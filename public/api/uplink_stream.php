<?php
// public/api/uplink_stream.php
// Fallback chat stream (the Node chat hub is preferred when configured).
// Each event carries "id: <message id>", so the browser's automatic reconnect
// (Last-Event-ID) resumes exactly where it left off and no message is lost
// between the 20-second cycles.
require_once __DIR__ . '/database.php';

// Read-only session: released immediately so the stream never holds the lock
initSession();

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

while (ob_get_level() > 0) {
    @ob_end_flush();
}
@ob_implicit_flush(true);

$isAdmin = !empty($_SESSION['is_admin']);
$db = getDbConnection();

// Resume point: Last-Event-ID (automatic reconnect) wins over ?last_id (first connect)
$lastId = 0;
if (isset($_SERVER['HTTP_LAST_EVENT_ID']) && ctype_digit((string)$_SERVER['HTTP_LAST_EVENT_ID'])) {
    $lastId = (int)$_SERVER['HTTP_LAST_EVENT_ID'];
} elseif (isset($_GET['last_id']) && ctype_digit((string)$_GET['last_id'])) {
    $lastId = (int)$_GET['last_id'];
}

try {
    $maxId = (int)$db->query("SELECT COALESCE(MAX(id), 0) FROM transmissions")->fetchColumn();
} catch (Throwable $e) {
    $maxId = 0;
}
// No resume point (or a bogus one from the future): start from "now"
if ($lastId <= 0 || $lastId > $maxId) {
    $lastId = $maxId;
}

// Reconnect quickly after the server closes the cycle
echo "retry: 1500\n";
// Tell the client where we are, so its first reconnect has a Last-Event-ID too
echo "id: {$lastId}\nevent: ready\ndata: {}\n\n";
@flush();

$hiddenFilter = $isAdmin ? '' : ' AND room_id NOT IN (SELECT id FROM rooms WHERE is_hidden = 1)';
$stmt = $db->prepare("SELECT id, room_id, username, message, created_at
                      FROM transmissions
                      WHERE id > :last_id AND (is_deleted = 0 OR is_deleted IS NULL)" . $hiddenFilter . "
                      ORDER BY id ASC LIMIT 200");

$startTime = time();
$maxDuration = 20; // 20-second clean cycle to avoid PHP-FPM worker exhaustion

while ((time() - $startTime) < $maxDuration) {
    if (connection_aborted()) {
        break;
    }

    try {
        $stmt->execute([':last_id' => $lastId]);
        $messages = $stmt->fetchAll();
        $stmt->closeCursor();

        if (!empty($messages)) {
            foreach ($messages as $msg) {
                $lastId = (int)$msg['id'];
                echo "id: {$lastId}\ndata: " . json_encode(formatTransmission($msg)) . "\n\n";
            }
        } else {
            // SSE comment: keep-alive, ignored by EventSource
            echo ": heartbeat\n\n";
        }

        @flush();
    } catch (Throwable $e) {
        require_once __DIR__ . '/debug_logger.php';
        logSystemError('UPLINK_STREAM', $e->getMessage());
        break;
    }

    sleep(1);
}

exit();
