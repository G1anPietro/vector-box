<?php
// public/api/rate_limiter.php
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/debug_logger.php';

function checkRateLimit($action = 'feed', $maxRequests = 5, $decaySeconds = 10) {
    $clientIp = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';
    
    // Create rate limit cache file in data/
    $projectRoot = dirname(__DIR__, 2);
    $cacheFile = $projectRoot . '/data/rate_limit_' . md5($clientIp . '_' . $action) . '.json';
    
    $now = time();
    $data = ['timestamps' => []];

    if (file_exists($cacheFile)) {
        $data = json_decode(@file_get_contents($cacheFile), true) ?? ['timestamps' => []];
    }

    // Filter out timestamps older than the decay window
    $data['timestamps'] = array_filter($data['timestamps'], function($ts) use ($now, $decaySeconds) {
        return ($now - $ts) < $decaySeconds;
    });

    // Check if client exceeds max requests in window
    if (count($data['timestamps']) >= $maxRequests) {
        logSystemError('RATE_LIMIT_EXCEEDED', "IP {$clientIp} exceeded rate limit on {$action}", ['ip' => $clientIp]);
        return false;
    }

    // Record current request timestamp
    $data['timestamps'][] = $now;
    @file_put_contents($cacheFile, json_encode($data));

    return true;
}