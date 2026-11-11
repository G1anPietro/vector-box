<?php
// public/api/visits.php — visit log + phone notification for every NEW visit.
//
// recordVisit() is called by includes/head.php (every PHP page) and by api/visit.php (a
// tiny beacon that the static game pages call). A visit is "new" when the same visitor
// (IP + browser) has not been seen for VISIT_GAP_MIN minutes (default 30): then one line
// goes to data/visits.log and one ntfy notification is sent, after the page has been
// delivered (never slows the page down). Page views inside a visit are not logged.
//
// Skipped: bots and crawlers, the server itself (health checks), link previews/prefetch.
// Not notified (but logged): admins, and anything beyond VISIT_NOTIFY_MAX_PER_HOUR.
// .env: VISIT_NTFY_URL (default: NTFY_TOPIC_URL), VISIT_NOTIFY=false to turn the
// notifications off, VISIT_GAP_MIN, VISIT_NOTIFY_MAX_PER_HOUR (default 20).
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/database.php';

const VISIT_LOG_MAX_BYTES = 2 * 1024 * 1024;   // then rotated to visits.log.1

function visitIsBot(string $ua): bool {
    if ($ua === '') return true;
    return (bool)preg_match('/bot|crawl|spider|slurp|preview|monitor|uptime|curl|wget|python|httpclient|go-http|java\/|'
        . 'headless|lighthouse|facebookexternalhit|whatsapp|telegram|discord|mediapartners|adsbot|feedfetcher|scan/i', $ua);
}

/** "Firefox, Android" — just enough to recognise who it is. */
function visitDescribeUa(string $ua): string {
    $browser = 'browser';
    foreach (['Edg/' => 'Edge', 'OPR/' => 'Opera', 'SamsungBrowser' => 'Samsung Internet', 'Firefox/' => 'Firefox',
              'Chrome/' => 'Chrome', 'Safari/' => 'Safari'] as $needle => $name) {
        if (stripos($ua, $needle) !== false) { $browser = $name; break; }
    }
    $os = '';
    foreach (['Android' => 'Android', 'iPhone' => 'iPhone', 'iPad' => 'iPad', 'Windows' => 'Windows',
              'Mac OS X' => 'Mac', 'CrOS' => 'ChromeOS', 'Linux' => 'Linux'] as $needle => $name) {
        if (stripos($ua, $needle) !== false) { $os = $name; break; }
    }
    return $os ? "$browser, $os" : $browser;
}

/** Who is browsing, without creating a session for people who don't have one yet. */
function visitUser(): array {
    if (session_status() !== PHP_SESSION_ACTIVE && empty($_SESSION) && isset($_COOKIE[session_name()])) {
        initSession(); // read-only: opens and closes at once
    }
    $name = (string)($_SESSION['username'] ?? '');
    $isGuest = $name === '' || str_starts_with($name, 'guest_');
    return ['name' => $isGuest ? '' : $name, 'admin' => !empty($_SESSION['is_admin'])];
}

function recordVisit(string $page): void {
    try {
        if (PHP_SAPI === 'cli' || ($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') return;
        $purpose = strtolower(($_SERVER['HTTP_SEC_PURPOSE'] ?? '') . ($_SERVER['HTTP_PURPOSE'] ?? '') . ($_SERVER['HTTP_X_MOZ'] ?? ''));
        if (str_contains($purpose, 'prefetch') || str_contains($purpose, 'prerender')) return;

        $ua = substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 400);
        if (visitIsBot($ua)) return;
        $ip = getClientIp();
        if ($ip === '127.0.0.1' || $ip === '::1') return; // the server checking itself

        $now = time();
        $gap = max(1, (int)envValue('VISIT_GAP_MIN', '30')) * 60;
        $hash = hash('sha256', $ip . '|' . $ua);
        $db = getDbConnection();

        $row = $db->prepare('SELECT last_seen FROM visitors WHERE vhash = :h');
        $row->execute([':h' => $hash]);
        $lastSeen = $row->fetchColumn();
        $isNew = $lastSeen === false || $now - (int)$lastSeen > $gap;

        if (!$isNew) {
            // same visit: refresh last_seen at most once a minute (fewer writes)
            if ($now - (int)$lastSeen > 60) {
                $db->prepare('UPDATE visitors SET last_seen = :t WHERE vhash = :h')->execute([':t' => $now, ':h' => $hash]);
            }
            return;
        }

        $db->prepare('INSERT INTO visitors (vhash, first_seen, last_seen, last_new, visits) VALUES (:h, :t, :t, :t, 1)
                      ON CONFLICT(vhash) DO UPDATE SET last_seen = :t, last_new = :t, visits = visits + 1')
           ->execute([':h' => $hash, ':t' => $now]);
        $returning = $lastSeen !== false;

        $user = visitUser();
        $device = visitDescribeUa($ua);
        $page = substr(preg_replace('/[^\x20-\x7E]/', '', $page) ?? '', 0, 120);
        $ref = (string)parse_url((string)($_SERVER['HTTP_REFERER'] ?? ''), PHP_URL_HOST);
        $self = (string)($_SERVER['HTTP_HOST'] ?? '');
        $ref = ($ref !== '' && strcasecmp($ref, $self) !== 0) ? substr($ref, 0, 80) : '';

        // ---- the log file (data/, outside the web root) ----
        $logFile = dirname(__DIR__, 2) . '/data/visits.log';
        if (is_file($logFile) && filesize($logFile) > VISIT_LOG_MAX_BYTES) {
            @rename($logFile, $logFile . '.1');
        }
        $line = sprintf("%s\t%s\t%s\t%s\t%s\t%s\t%s\n", date('Y-m-d H:i:s'), $ip,
            $user['name'] !== '' ? $user['name'] : '-', $page, $device, $returning ? 'returning' : 'first', $ref !== '' ? $ref : '-');
        @file_put_contents($logFile, $line, FILE_APPEND | LOCK_EX);

        // ---- the phone notification, after the response has gone out ----
        if (strtolower((string)envValue('VISIT_NOTIFY', 'true')) === 'false' || $user['admin']) return;
        $url = (string)(envValue('VISIT_NTFY_URL', '') ?: envValue('NTFY_TOPIC_URL', ''));
        if (!preg_match('#^(https://|http://127\.0\.0\.1[:/])#', $url)) return; // http only for local tests
        $max = (int)envValue('VISIT_NOTIFY_MAX_PER_HOUR', '20');
        $recent = (int)$db->query('SELECT COUNT(*) FROM visitors WHERE last_new > ' . ($now - 3600))->fetchColumn();
        if ($recent > $max) return; // a flood: still logged, not notified

        $who = $user['name'] !== '' ? $user['name'] : ($returning ? 'Visitatore di ritorno' : 'Nuovo visitatore');
        $body = "$who su $page\n$device" . ($ref !== '' ? "\nda $ref" : '') . "\nIP $ip";
        register_shutdown_function(function () use ($url, $body) {
            if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => $body,
                CURLOPT_HTTPHEADER => ['Title: vector-box: nuova visita', 'Tags: eyes', 'Priority: low'],
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => 4,
                CURLOPT_CONNECTTIMEOUT => 2,
            ]);
            curl_exec($ch);
            curl_close($ch);
        });
    } catch (Throwable $e) {
        // A visit counter must never break a page
        require_once __DIR__ . '/debug_logger.php';
        logSystemError('VISITS', $e->getMessage());
    }
}
