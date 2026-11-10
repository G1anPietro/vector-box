<?php
// public/api/status.php
// Public, read-only system status for the STATUS window.
// Service checks come from STATUS_CHECKS in .env ("Name=host:port,Name2=host:port").
// Only names, up/down and latency are published (never hosts/ports), and the
// result is cached for 30s so visitors can't use this to hammer other hosts.
require_once __DIR__ . '/helpers.php';

const STATUS_CACHE_TTL = 30;
const STATUS_MAX_CHECKS = 8;

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function statusCachePath(): string {
    return dirname(__DIR__, 2) . '/data/status_cache.json';
}

/** Parse STATUS_CHECKS into [['name'=>, 'host'=>, 'port'=>], ...]. Invalid entries are skipped. */
function statusChecks(): array {
    $out = [];
    foreach (explode(',', (string)envValue('STATUS_CHECKS', '')) as $item) {
        if (!preg_match('/^\s*([^=]{1,30})=([A-Za-z0-9.\-]+|\[[0-9a-fA-F:]+\]):(\d{1,5})\s*$/', $item, $m)) continue;
        $port = (int)$m[3];
        if ($port < 1 || $port > 65535) continue;
        $out[] = ['name' => trim($m[1]), 'host' => trim($m[2], '[]'), 'port' => $port];
        if (count($out) >= STATUS_MAX_CHECKS) break;
    }
    return $out;
}

function readProcFile(string $path): ?string {
    $v = @file_get_contents($path);
    return $v === false ? null : $v;
}

function collectStatus(): array {
    $uptime = null;
    if (($raw = readProcFile('/proc/uptime')) !== null) {
        $uptime = (int)floatval(explode(' ', $raw)[0]);
    }

    $memPct = null;
    if (($raw = readProcFile('/proc/meminfo')) !== null
        && preg_match('/MemTotal:\s+(\d+)/', $raw, $t) && preg_match('/MemAvailable:\s+(\d+)/', $raw, $a) && (int)$t[1] > 0) {
        $memPct = (int)round(100 * (1 - (int)$a[1] / (int)$t[1]));
    }

    $cpus = null;
    if (($raw = readProcFile('/proc/cpuinfo')) !== null) {
        $cpus = max(1, preg_match_all('/^processor\s*:/m', $raw));
    }

    $load = function_exists('sys_getloadavg') ? sys_getloadavg() : false;

    $services = [];
    foreach (statusChecks() as $c) {
        $start = microtime(true);
        $fp = @fsockopen($c['host'], $c['port'], $errno, $errstr, 1.5);
        $ms = (int)round((microtime(true) - $start) * 1000);
        if ($fp) fclose($fp);
        $services[] = ['name' => $c['name'], 'up' => (bool)$fp, 'ms' => $fp ? $ms : null];
    }

    return [
        'success'        => true,
        'generated_at'   => time(),
        'uptime_seconds' => $uptime,
        'load'           => $load ? array_map(fn($v) => round($v, 2), $load) : null,
        'cpus'           => $cpus,
        'mem_used_pct'   => $memPct,
        'services'       => $services,
    ];
}

try {
    $cache = statusCachePath();
    $raw = @file_get_contents($cache);
    $data = $raw !== false ? json_decode($raw, true) : null;

    if (!is_array($data) || ($data['generated_at'] ?? 0) < time() - STATUS_CACHE_TTL) {
        $data = collectStatus();
        // Atomic replace so concurrent readers never see a half-written file
        $tmp = $cache . '.' . bin2hex(random_bytes(4)) . '.tmp';
        if (@file_put_contents($tmp, json_encode($data)) !== false) {
            @rename($tmp, $cache);
        }
    }

    echo json_encode($data);
} catch (Throwable $e) {
    failInternal('STATUS', $e);
}
