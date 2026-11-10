<?php
// public/api/get_log.php  (admin only: the log contains IPs and internal errors)
require_once __DIR__ . '/database.php';

initSession();
requireAdmin();

header('Content-Type: text/plain; charset=utf-8');
header('X-Content-Type-Options: nosniff');

$logFile = __DIR__ . '/../../data/system_errors.log';
echo file_exists($logFile) ? file_get_contents($logFile) : '>> No system errors logged yet.';
