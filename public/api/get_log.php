<?php
// public/api/get_log.php
header('Content-Type: text/plain');
$logFile = __DIR__ . '/../../data/system_errors.log';

if (file_exists($logFile)) {
    echo file_get_contents($logFile);
} else {
    echo ">> No system errors logged yet.";
}