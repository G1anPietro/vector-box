<?php
session_start();
header('Content-Type: application/json');

if (!isset($_SESSION['user'])) {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized']);
    exit();
}

// Calculate CPU percentage from /proc/stat
function getCpuUsage() {
    $stat1 = file('/proc/stat');
    usleep(100000); // 100ms sample
    $stat2 = file('/proc/stat');

    $info1 = explode(" ", preg_replace("!   *!", " ", trim($stat1[0])));
    $info2 = explode(" ", preg_replace("!   *!", " ", trim($stat2[0])));

    $total1 = $info1[1] + $info1[2] + $info1[3] + $info1[4];
    $total2 = $info2[1] + $info2[2] + $info2[3] + $info2[4];

    $diffTotal = $total2 - $total1;
    $diffIdle = $info2[4] - $info1[4];

    return ($diffTotal > 0) ? round((($diffTotal - $diffIdle) / $diffTotal) * 100) : 0;
}

// Calculate RAM percentage from /proc/meminfo
function getRamUsage() {
    $meminfo = file_get_contents('/proc/meminfo');
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