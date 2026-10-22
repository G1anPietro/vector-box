<?php
// public/api/uplink_stream.php

// Disable all layers of PHP output buffering
while (ob_get_level()) {
    ob_end_clean();
}

ini_set('output_buffering', 'off');
ini_set('zlib.output_compression', 'off');
ini_set('implicit_flush', 1);
ob_implicit_flush(true);

if (function_exists('apache_setenv')) {
    apache_setenv('no-gzip', '1');
}

// SSE Headers
header('Content-Type: text/event-stream');
header('Cache-Control: no-cache, no-transform');
header('Connection: keep-alive');
header('X-Accel-Buffering: no');

require_once __DIR__ . '/database.php';
require_once __DIR__ . '/debug_logger.php';

set_time_limit(0);
ignore_user_abort(true);

$lastSeenId = isset($_GET['last_id']) ? intval($_GET['last_id']) : 0;

try {
    $db = getDbConnection();
} catch (Exception $e) {
    logSystemError('SSE_DB_CONNECT_FAIL', $e->getMessage());
    echo "event: error\n";
    echo 'data: ' . json_encode(['error' => $e->getMessage()]) . "\n\n";
    flush();
    exit();
}

// Send initial handshake event
echo "event: connected\n";
echo 'data: ' . json_encode(['status' => 'handshake_ok', 'last_id' => $lastSeenId]) . "\n\n";
flush();

// Fetch initial historical messages on fresh connect
if ($lastSeenId === 0) {
    try {
        $initStmt = $db->query("SELECT * FROM (SELECT id, message, sender_ip, created_at FROM transmissions ORDER BY id DESC LIMIT 20) ORDER BY id ASC");
        $initialRows = $initStmt->fetchAll();
        foreach ($initialRows as $row) {
            $lastSeenId = intval($row['id']);
            echo "data: " . json_encode($row) . "\n\n";
        }
        flush();
    } catch (Exception $e) {
        logSystemError('SSE_INIT_FETCH_FAIL', $e->getMessage());
    }
}

// Low-latency loop (200ms ticks instead of 1000ms)
$pingCounter = 0;
while (true) {
    if (connection_aborted()) {
        break;
    }

    try {
        $stmt = $db->prepare("SELECT id, message, sender_ip, created_at FROM transmissions WHERE id > :last_id ORDER BY id ASC");
        $stmt->bindValue(':last_id', $lastSeenId, PDO::PARAM_INT);
        $stmt->execute();
        $rows = $stmt->fetchAll();

        foreach ($rows as $row) {
            $lastSeenId = intval($row['id']);
            echo "data: " . json_encode($row) . "\n\n";
            flush();
        }
    } catch (Exception $e) {
        logSystemError('SSE_LOOP_FAIL', $e->getMessage());
    }

    // Keepalive heartbeat every 15 seconds (75 ticks * 200ms)
    $pingCounter++;
    if ($pingCounter >= 75) {
        echo ": ping\n\n";
        flush();
        $pingCounter = 0;
    }

    usleep(200000); // 200ms delay for ultra-fast response time
}