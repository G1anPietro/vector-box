<?php
// public/api/debug_logger.php

function logSystemError($source, $message, $details = null) {
    require_once __DIR__ . '/helpers.php';
    $dataDir = __DIR__ . '/../../data';

    if (!file_exists($dataDir)) {
        @mkdir($dataDir, 0750, true);
    }

    // Strip control characters so attackers can't forge log lines
    $clean = static function ($v) {
        return preg_replace('/[\x00-\x1F\x7F]+/', ' ', (string)$v);
    };
    $source = $clean($source);
    $message = $clean($message);

    $logFile = $dataDir . '/system_errors.log';
    
    // 1. CAP LOG SIZE (Auto-rotate if log file exceeds 100 KB)
    if (file_exists($logFile) && filesize($logFile) > 100000) {
        $backupHeader = "====================================================\n";
        $backupHeader .= "[" . date('Y-m-d H:i:s') . "] [SYSTEM] Log rotated due to size limit (>100KB).\n";
        $backupHeader .= "====================================================\n\n";
        @file_put_contents($logFile, $backupHeader);
    }

    // 2. DEDUPLICATION (Prevent writing duplicate messages within 10 seconds)
    static $lastLoggedMessage = '';
    static $lastLoggedTime = 0;
    
    if ($message === $lastLoggedMessage && (time() - $lastLoggedTime) < 10) {
        return; // Skip spam entry
    }
    
    $lastLoggedMessage = $message;
    $lastLoggedTime = time();

    // Write Log Entry
    $timestamp = date('Y-m-d H:i:s');
    $clientIp = getClientIp();

    $entry = "====================================================\n";
    $entry .= "[{$timestamp}] [IP: {$clientIp}] [SRC: {$source}]\n";
    $entry .= "MESSAGE: {$message}\n";
    if ($details) {
        $entry .= "DETAILS: " . $clean(is_array($details) || is_object($details) ? json_encode($details) : $details) . "\n";
    }
    $entry .= "====================================================\n\n";

    @file_put_contents($logFile, $entry, FILE_APPEND | LOCK_EX);
}