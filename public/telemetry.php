<?php
session_start();
header('Content-Type: application/json');

if (!isset($_SESSION['user'])) {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized']);
    exit();
}

function getCpuUsage() {
    $stat1 = file('/proc/stat');
    usleep(50000);
    $stat2 = file('/proc/stat');

    $info1 = preg_split('/\s+/', trim($stat1[0]));
    $info2 = preg_split('/\s+/', trim($stat2[0]));

    $total1 = array_sum(array_slice($info1, 1, 4));
    $total2 = array_sum(array_slice($info2, 1, 4));

    $diffTotal = $total2 - $total1;
    $diffIdle = $info2[4] - $info1[4];

    return ($diffTotal > 0) ? round((($diffTotal - $diffIdle) / $diffTotal) * 100) : 0;
}

function getRamUsage() {
    $meminfo = @file_get_contents('/proc/meminfo');
    if (!$meminfo) return 0;

    preg_match('/MemTotal:\s+(\d+)/', $meminfo, $totalMatches);
    preg_match('/MemAvailable:\s+(\d+)/', $meminfo, $availMatches);

    if (isset($totalMatches[1], $availMatches[1])) {
        $total = (int)$totalMatches[1];
        $avail = (int)$availMatches[1];
        return round((($total - $avail) / $total) * 100);
    }
    return 0;
}

echo json_encode([
    'cpu' => getCpuUsage(),
    'ram' => getRamUsage()
]);