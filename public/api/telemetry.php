<?php
header('Content-Type: application/json');

// Calculate real CPU load percentage from sys_getloadavg
$cpuPercent = 0;
if (function_exists('sys_getloadavg')) {
    $load = sys_getloadavg();
    // Normalize load avg over 1-min against core count
    $cores = 1;
    if (is_file('/proc/cpuinfo')) {
        $cpuinfo = file_get_contents('/proc/cpuinfo');
        preg_match_all('/^processor/m', $cpuinfo, $matches);
        $cores = count($matches[0]) ?: 1;
    }
    $cpuPercent = min(100, round(($load[0] / $cores) * 100));
}

// Calculate real RAM usage from /proc/meminfo
$ramPercent = 0;
if (is_file('/proc/meminfo')) {
    $meminfo = file_get_contents('/proc/meminfo');
    preg_match('/MemTotal:\s+(\d+)/', $meminfo, $totalMatches);
    preg_match('/MemAvailable:\s+(\d+)/', $meminfo, $availMatches);

    if (!empty($totalMatches[1]) && !empty($availMatches[1])) {
        $total = (int)$totalMatches[1];
        $available = (int)$availMatches[1];
        $used = $total - $available;
        $ramPercent = round(($used / $total) * 100);
    }
}

echo json_encode([
    'cpu' => $cpuPercent,
    'ram' => $ramPercent,
    'timestamp' => time()
]);