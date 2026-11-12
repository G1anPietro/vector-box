<?php
// public/api/pihole.php — Pi-hole numbers for the STATUS window, admin only (they show what the home network
// browses). GET -> {success, version, queries, blocked, percent, domains_blocked, clients, top_blocked:[{domain,count}]}
// .env: PIHOLE_URL (e.g. http://127.0.0.1:8080), and PIHOLE_PASSWORD (Pi-hole v6, app password recommended) or
// PIHOLE_API_TOKEN (Pi-hole v5). Answers are cached 60 s; the v6 session id is reused until it expires.
require_once __DIR__ . '/database.php';

initSession();
requireAdmin();
header('Cache-Control: no-store');

const PIHOLE_CACHE_SECONDS = 60;

$base = rtrim(trim((string)envValue('PIHOLE_URL', '')), '/');
if (!preg_match('#^https?://[A-Za-z0-9.-]+(:\d+)?$#', $base)) {
    jsonResponse(['success' => false, 'configured' => false, 'error' => 'Pi-hole is not configured'], 404);
}
$password = (string)envValue('PIHOLE_PASSWORD', '');
$token = (string)envValue('PIHOLE_API_TOKEN', '');
$dataDir = dirname(__DIR__, 2) . '/data';
$cacheFile = $dataDir . '/pihole_cache.json';
$sidFile = $dataDir . '/pihole_sid.json';

$cached = is_file($cacheFile) ? json_decode((string)@file_get_contents($cacheFile), true) : null;
if (is_array($cached) && ($cached['at'] ?? 0) > time() - PIHOLE_CACHE_SECONDS) {
    jsonResponse($cached['data']);
}

/** One HTTP call to Pi-hole: [status, decoded JSON or null]. */
function piholeCall(string $method, string $url, array $headers = [], ?string $body = null): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 4,
        CURLOPT_CONNECTTIMEOUT => 2,
        CURLOPT_HTTPHEADER => array_merge(['Accept: application/json'], $headers),
    ]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $raw = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$status, is_string($raw) ? json_decode($raw, true) : null];
}

/** Pi-hole v6: session id (cached in data/, never sent to the browser). */
function piholeSid(string $base, string $password, string $sidFile, bool $fresh = false): string {
    if ($password === '') return '';
    if (!$fresh && is_file($sidFile)) {
        $s = json_decode((string)@file_get_contents($sidFile), true);
        if (is_array($s) && ($s['until'] ?? 0) > time() + 30 && is_string($s['sid'] ?? null)) return $s['sid'];
    }
    [$st, $j] = piholeCall('POST', $base . '/api/auth', ['Content-Type: application/json'], json_encode(['password' => $password]));
    $sid = (string)($j['session']['sid'] ?? '');
    if ($st !== 200 || $sid === '') throw new RuntimeException("Pi-hole login failed ($st)");
    @file_put_contents($sidFile, json_encode(['sid' => $sid, 'until' => time() + (int)($j['session']['validity'] ?? 300)]), LOCK_EX);
    @chmod($sidFile, 0600);
    return $sid;
}

try {
    if ($token !== '' && $password === '') {
        // Pi-hole v5
        [$st, $j] = piholeCall('GET', $base . '/admin/api.php?summaryRaw&topItems=5&auth=' . rawurlencode($token));
        if ($st !== 200 || !is_array($j) || !isset($j['dns_queries_today'])) throw new RuntimeException("Pi-hole v5 answered $st");
        $top = [];
        foreach (($j['top_ads'] ?? []) as $domain => $count) $top[] = ['domain' => (string)$domain, 'count' => (int)$count];
        $data = [
            'success' => true, 'version' => 5,
            'queries' => (int)$j['dns_queries_today'], 'blocked' => (int)($j['ads_blocked_today'] ?? 0),
            'percent' => round((float)($j['ads_percentage_today'] ?? 0), 1),
            'domains_blocked' => (int)($j['domains_being_blocked'] ?? 0), 'clients' => (int)($j['unique_clients'] ?? 0),
            'top_blocked' => array_slice($top, 0, 5),
        ];
    } else {
        // Pi-hole v6: re-login once if the cached session has expired
        $get = function (string $path) use ($base, $password, $sidFile) {
            $sid = piholeSid($base, $password, $sidFile);
            [$st, $j] = piholeCall('GET', $base . $path, $sid !== '' ? ['X-FTL-SID: ' . $sid] : []);
            if ($st === 401 && $password !== '') {
                $sid = piholeSid($base, $password, $sidFile, true);
                [$st, $j] = piholeCall('GET', $base . $path, ['X-FTL-SID: ' . $sid]);
            }
            if ($st !== 200 || !is_array($j)) throw new RuntimeException("Pi-hole answered $st for $path");
            return $j;
        };
        $sum = $get('/api/stats/summary');
        $topJ = $get('/api/stats/top_domains?blocked=true&count=5');
        $top = [];
        foreach (($topJ['domains'] ?? []) as $d) $top[] = ['domain' => (string)($d['domain'] ?? ''), 'count' => (int)($d['count'] ?? 0)];
        $data = [
            'success' => true, 'version' => 6,
            'queries' => (int)($sum['queries']['total'] ?? 0), 'blocked' => (int)($sum['queries']['blocked'] ?? 0),
            'percent' => round((float)($sum['queries']['percent_blocked'] ?? 0), 1),
            'domains_blocked' => (int)($sum['gravity']['domains_being_blocked'] ?? 0),
            'clients' => (int)($sum['clients']['active'] ?? 0),
            'top_blocked' => array_slice($top, 0, 5),
        ];
    }
    @file_put_contents($cacheFile, json_encode(['at' => time(), 'data' => $data]), LOCK_EX);
    jsonResponse($data);
} catch (Throwable $e) {
    failInternal('PIHOLE', $e, 'Pi-hole is not answering');
}
