<?php
// public/api/helpers.php
// Shared helpers: env loading, client IP, JSON responses, CSRF/admin guards, credentials.

function envValue(string $key, ?string $default = null): ?string {
    static $fileVars = null;

    $v = getenv($key);
    if ($v !== false && $v !== '') {
        return $v;
    }

    if ($fileVars === null) {
        $fileVars = [];
        $path = dirname(__DIR__, 2) . '/.env';
        if (is_readable($path)) {
            foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
                $line = trim($line);
                if ($line === '' || $line[0] === '#' || strpos($line, '=') === false) continue;
                [$k, $val] = explode('=', $line, 2);
                $fileVars[trim($k)] = trim(trim($val), "\"'");
            }
        }
    }
    return $fileVars[$key] ?? $default;
}

function trustedProxies(): array {
    return array_values(array_filter(array_map('trim', explode(',', envValue('TRUSTED_PROXIES', '127.0.0.1,::1')))));
}

/**
 * Real client IP. X-Forwarded-For is honoured ONLY when the request comes from a
 * trusted proxy (TRUSTED_PROXIES, default localhost), otherwise it is attacker-controlled.
 */
function getClientIp(): string {
    $remote = $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';
    $trusted = trustedProxies();

    if (in_array($remote, $trusted, true) && !empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $chain = array_map('trim', explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']));
        for ($i = count($chain) - 1; $i >= 0; $i--) {
            if (filter_var($chain[$i], FILTER_VALIDATE_IP) && !in_array($chain[$i], $trusted, true)) {
                return $chain[$i];
            }
        }
    }
    return $remote;
}

function isHttps(): bool {
    if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') return true;
    return ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https'
        && in_array($_SERVER['REMOTE_ADDR'] ?? '', trustedProxies(), true);
}

function jsonResponse(array $data, int $status = 200): void {
    if (!headers_sent()) {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
    }
    echo json_encode($data);
    exit();
}

/** Log the real error server-side, return a generic message to the client. */
function failInternal(string $source, Throwable $e, string $publicMessage = 'Internal server error'): void {
    require_once __DIR__ . '/debug_logger.php';
    logSystemError($source, $e->getMessage());
    jsonResponse(['success' => false, 'error' => $publicMessage], 500);
}

function requireCsrf(): void {
    $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    $token = $_SESSION['csrf_token'] ?? '';
    if ($token === '' || !is_string($sent) || !hash_equals($token, $sent)) {
        jsonResponse(['success' => false, 'error' => 'FORBIDDEN: Invalid or missing CSRF token'], 403);
    }
}

function requireAdmin(): void {
    if (empty($_SESSION['is_admin'])) {
        jsonResponse(['success' => false, 'error' => 'UNAUTHORIZED: Admin privileges required'], 403);
    }
}

function requireLogin(): void {
    if (empty($_SESSION['user_id'])) {
        jsonResponse(['success' => false, 'error' => 'UNAUTHENTICATED: Login required'], 401);
    }
}

function readJsonBody(): array {
    $data = json_decode(file_get_contents('php://input'), true);
    return is_array($data) ? $data : [];
}

/** Username rules for NEW accounts. Returns an error string or null. */
function validateNewUsername(string $username): ?string {
    if (!preg_match('/^[A-Za-z0-9_\-]{3,32}$/', $username)) {
        return 'Username must be 3-32 characters: letters, digits, "_" or "-"';
    }
    if (stripos($username, 'guest_') === 0) {
        return 'Username prefix "guest_" is reserved';
    }
    return null;
}

/** Password rules for NEW passwords (bcrypt truncates at 72 bytes). */
function validateNewPassword(string $password): ?string {
    if (strlen($password) < 8) return 'Password must be at least 8 characters';
    if (strlen($password) > 72) return 'Password must be at most 72 bytes';
    return null;
}

/** Constant-ish time verify so unknown users cost the same as wrong passwords. */
function verifyPasswordSafe(?array $account, string $password): bool {
    static $dummy = '$2y$10$usesomesillystringfore7hnbRJHxXVLeakoG8K30oukPsA.ztMG';
    $hash = $account['password_hash'] ?? $dummy;
    $ok = password_verify($password, $hash);
    return $account !== null && $ok;
}

/** Writable session start (does not close it). Uses the same cookie/save-path config as initSession(). */
function startWritableSession(): void {
    if (session_status() !== PHP_SESSION_NONE) return;

    $dir = dirname(__DIR__, 2) . '/data/sessions';
    if (!is_dir($dir)) @mkdir($dir, 0700, true);

    session_save_path($dir);
    // Debian/Ubuntu ship session.gc_probability = 0 and clean only /var/lib/php/sessions
    // with a cron job, so files in our own save path would never be deleted.
    // Run PHP's GC on ~1% of requests; it removes files idle longer than the cookie lifetime.
    ini_set('session.gc_probability', '1');
    ini_set('session.gc_divisor', '100');
    ini_set('session.gc_maxlifetime', (string)(86400 * 7));
    ini_set('session.use_strict_mode', '1');   // refuse session ids the server never issued
    session_set_cookie_params([
        'lifetime' => 86400 * 7,
        'path'     => '/',
        'secure'   => isHttps(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

/** Create an authenticated session: regenerates the ID (anti-fixation) and persists data. */
function establishSession(array $account): string {
    startWritableSession();
    session_regenerate_id(true);

    $csrf = bin2hex(random_bytes(32));
    $_SESSION['user_id']    = (int)$account['id'];
    $_SESSION['username']   = $account['username'];
    $_SESSION['theme']      = $account['theme'] ?? 'cyan';
    $_SESSION['is_admin']   = (int)($account['is_admin'] ?? 0);
    $_SESSION['csrf_token'] = $csrf;
    session_write_close();

    return $csrf;
}

/** Shape of one chat message as sent to the browser (feed, streams, hub). */
function formatTransmission(array $row): array {
    $timestamp = !empty($row['created_at']) ? $row['created_at'] : date('Y-m-d H:i:s');
    return [
        'id'         => (int)$row['id'],
        'room_id'    => !empty($row['room_id']) ? $row['room_id'] : 'general',
        'username'   => !empty($row['username']) ? $row['username'] : 'guest',
        'message'    => (string)$row['message'],
        'date'       => substr($timestamp, 0, 10),
        'created_at' => substr($timestamp, 11, 8),
    ];
}

// ------------------------------------------------------------------
// Node chat hub (optional). Enabled only when CHAT_HUB_SECRET is set in
// .env (shared with server.js). PHP stays the source of truth: it stores
// every message, then tells the hub so it can push it to open browsers.
// ------------------------------------------------------------------

function base64UrlEncode(string $raw): string {
    return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
}

function chatHubSecret(): string {
    return (string)envValue('CHAT_HUB_SECRET', '');
}

/**
 * Stream config for the browser, or null when the hub is not configured.
 * The token says who the viewer is (for the online list) and whether they may read
 * hidden (admin) rooms; the hub verifies it with the shared secret. It travels in the
 * URL (EventSource can't send headers) when the hub is on another origin; on the same origin it
 * goes in a cookie instead (chatStreamCookie). Either way it is valid for 60 seconds and ONE
 * connection only (the hub remembers the nonce). The browser asks for a fresh one before every
 * (re)connect.
 */
function chatStreamConfig(bool $isAdmin, string $username = ''): ?array {
    $secret = chatHubSecret();
    $url = (string)envValue('CHAT_STREAM_URL', '');
    if ($secret === '' || $url === '') return null;

    $body = base64UrlEncode(json_encode([
        'p'   => 'chat',
        'adm' => $isAdmin ? 1 : 0,
        'u'   => textCut($username, 50), // shown in the hub's online list
        'exp' => time() + 60,
        'n'   => bin2hex(random_bytes(8)),
    ]));
    $sig = base64UrlEncode(hash_hmac('sha256', $body, $secret, true));

    // Hub on the site's own address (a path like /api/chat/stream behind nginx): the token goes in a short-lived
    // HttpOnly cookie limited to that path, so it never appears in a URL or in the access logs.
    // A hub on another origin still gets it in the URL (cookies would not reach it).
    return ['url' => $url, 'token' => $body . '.' . $sig, 'cookie' => str_starts_with($url, '/') && !str_starts_with($url, '//')];
}

/** For a same-origin hub: puts the stream token in its cookie and removes it from the JSON. */
function chatStreamCookie(?array $cfg): ?array {
    if (!$cfg || empty($cfg['cookie']) || headers_sent()) return $cfg;
    setcookie('vb_chat_ticket', $cfg['token'], [
        'expires' => time() + 60,
        'path' => (string)parse_url($cfg['url'], PHP_URL_PATH),
        'secure' => isHttps(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    $cfg['token'] = null;
    return $cfg;
}

/**
 * Fire-and-forget push to the hub. Never throws and never blocks for long:
 * if Node is down the message is still stored and clients fall back to the
 * PHP stream.
 */
function notifyChatHub(array $event): void {
    $secret = chatHubSecret();
    if ($secret === '') return;

    $url = (string)envValue('CHAT_HUB_INTERNAL_URL', 'http://127.0.0.1:' . envValue('PORT', '3000') . '/internal/chat/publish');
    $ctx = stream_context_create(['http' => [
        'method'        => 'POST',
        'header'        => "Content-Type: application/json\r\nX-Chat-Hub-Secret: {$secret}\r\n",
        'content'       => json_encode($event),
        'timeout'       => 0.5,
        'ignore_errors' => true,
    ]]);
    @file_get_contents($url, false, $ctx);
}

/** Look up whether a room is hidden (admin-only to read). Unknown rooms are public. */
function isRoomHidden(PDO $db, string $roomId): bool {
    $stmt = $db->prepare("SELECT is_hidden FROM rooms WHERE id = :id");
    $stmt->execute([':id' => $roomId]);
    return (int)$stmt->fetchColumn() === 1;
}

// ------------------------------------------------------------------
// Security headers
// ------------------------------------------------------------------

/** Baseline headers for every PHP response (sent when helpers.php is loaded). */
function sendBaseSecurityHeaders(): void {
    if (PHP_SAPI === 'cli' || headers_sent()) return;
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: SAMEORIGIN');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    header('Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()');
}

/**
 * Content-Security-Policy for HTML pages (called from includes/head.php).
 * Report-only unless CSP_ENFORCE=true: violations show up in the browser console
 * without breaking anything, so the policy can be tuned before enforcing it.
 */
/** Public address of the site (for link previews and the sitemap): SITE_URL in .env, no trailing slash. */
function siteUrl(): string {
    $u = rtrim(trim((string)envValue('SITE_URL', '')), '/');
    return preg_match('#^https?://[A-Za-z0-9.-]+(:\d+)?$#', $u) ? $u : 'https://vector-box.duckdns.org';
}

/** Description + Open Graph tags (the preview shown when a link is shared on WhatsApp, Telegram…). */
function socialMeta(string $title, string $description, string $path, string $image = '/assets/og/giochi.jpg'): string {
    $e = fn($s) => htmlspecialchars($s, ENT_QUOTES);
    $base = siteUrl();
    return '<meta name="description" content="' . $e($description) . '">' . "\n"
        . '    <meta property="og:type" content="website">' . "\n"
        . '    <meta property="og:site_name" content="vector-box">' . "\n"
        . '    <meta property="og:title" content="' . $e($title) . '">' . "\n"
        . '    <meta property="og:description" content="' . $e($description) . '">' . "\n"
        . '    <meta property="og:url" content="' . $e($base . $path) . '">' . "\n"
        . '    <meta property="og:image" content="' . $e($base . $image) . '">' . "\n"
        . '    <meta name="twitter:card" content="summary_large_image">';
}

/** "Buy me a coffee" link (Ko-fi, Buy Me a Coffee, Liberapay…) from DONATE_URL, or '' when not set. */
function donateUrl(): string {
    $u = trim((string)envValue('DONATE_URL', ''));
    return preg_match('#^https://[A-Za-z0-9.-]+(/[A-Za-z0-9._~%/-]*)?$#', $u) ? $u : '';
}

/** PayPal.me link for donations (DONATE_PAYPAL_URL), or ''. */
function donatePaypalUrl(): string {
    $u = trim((string)envValue('DONATE_PAYPAL_URL', ''));
    return preg_match('#^https://(www\.)?paypal\.me/[A-Za-z0-9._-]+/?$#', $u) ? $u : '';
}

/** True when at least one way to donate is configured. */
function donationsOn(): bool {
    return donateUrl() !== '' || donatePaypalUrl() !== '';
}

/** Optional goal shown on pages/dona.php: [what, goal €, raised €] or null. */
function donateGoal(): ?array {
    $what = trim((string)envValue('DONATE_GOAL_TEXT', ''));
    $goal = (float)envValue('DONATE_GOAL_EUR', '0');
    if ($what === '' || $goal <= 0) return null;
    return [textCut($what, 80), $goal, max(0.0, (float)envValue('DONATE_RAISED_EUR', '0'))];
}

/** AdSense publisher id from .env (ca-pub-…), or '' when ads are off. */
function adsenseClient(): string {
    $c = trim((string)envValue('ADSENSE_CLIENT', ''));
    return preg_match('/^ca-pub-\d{10,20}$/', $c) ? $c : '';
}

/**
 * Language of the plain content pages (games, support, privacy, resume): ?lang=it|en
 * (remembered in a cookie), then the cookie, then the browser's language.
 */
function pageLang(): string {
    $q = $_GET['lang'] ?? '';
    if ($q === 'it' || $q === 'en') {
        if (!headers_sent()) {
            setcookie('vb_lang', $q, ['expires' => time() + 31536000, 'path' => '/', 'samesite' => 'Lax',
                                      'secure' => !empty($_SERVER['HTTPS']), 'httponly' => true]);
        }
        return $q;
    }
    $c = $_COOKIE['vb_lang'] ?? '';
    if ($c === 'it' || $c === 'en') return $c;
    return stripos((string)($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? ''), 'it') === 0 ? 'it' : 'en';
}

function sendPageSecurityHeaders(): void {
    if (PHP_SAPI === 'cli' || headers_sent()) return;

    $connect = ["'self'"];
    $streamUrl = (string)envValue('CHAT_STREAM_URL', '');
    if (preg_match('#^(https?://[^/]+)#i', $streamUrl, $m)) {
        $connect[] = $m[1]; // chat hub on another origin
    }

    // Pages that show Google ads (they define VB_ADS_PAGE before including head.php, and only
    // when ADSENSE_CLIENT is set) must let AdSense and Google's consent message load their
    // scripts, frames and images. Those pages are static content: no user input on them.
    $ads = defined('VB_ADS_PAGE') && adsenseClient() !== '';
    $google = 'https://*.googlesyndication.com https://*.google.com https://*.googleadservices.com '
            . 'https://*.gstatic.com https://*.doubleclick.net https://*.adtrafficquality.google';
    if ($ads) $connect[] = $google;

    $policy = implode('; ', [
        "default-src 'self'",
        // reader.php loads jszip/pdf.js/epub.js from these CDNs
        "script-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net" . ($ads ? " $google" : ''),
        // many inline style="" attributes and element.style writes; epub.js loads the book's CSS as blob:
        "style-src 'self' 'unsafe-inline' blob:",
        "img-src 'self' data: blob:" . ($ads ? ' https:' : ''),
        // fonts embedded in EPUBs are loaded as blob: too
        "font-src 'self' data: blob:",
        'connect-src ' . implode(' ', $connect),
        "worker-src 'self' blob: https://cdnjs.cloudflare.com",
        // epub.js renders chapters in blob:/srcdoc iframes
        "frame-src 'self' blob: data:" . ($ads ? " $google" : ''),
        "frame-ancestors 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
    ]);

    $enforce = strtolower((string)envValue('CSP_ENFORCE', 'false')) === 'true';
    header(($enforce ? 'Content-Security-Policy: ' : 'Content-Security-Policy-Report-Only: ') . $policy);
}

sendBaseSecurityHeaders();

/** Ban / timeout check for logged-in accounts. Returns a user-facing reason, or null if allowed. */
function accountRestriction(PDO $db, ?int $userId): ?string {
    if (!$userId) return null;
    $stmt = $db->prepare("SELECT is_banned, banned_until FROM accounts WHERE id = :id");
    $stmt->execute([':id' => $userId]);
    $acc = $stmt->fetch();
    if (!$acc) return null;
    if ((int)$acc['is_banned'] === 1) return 'ACCESS DENIED: Account permanently banned';
    if (!empty($acc['banned_until']) && strtotime($acc['banned_until']) > time()) {
        $mins = (int)ceil((strtotime($acc['banned_until']) - time()) / 60);
        return "ACCESS RESTRICTED: Timed out for {$mins} more minute(s)";
    }
    return null;
}

/** Book reader permission: admins always, others need accounts.can_read_books = 1. */
function userCanReadBooks(PDO $db, ?int $userId, bool $isAdmin): bool {
    if ($isAdmin) return true;
    if (!$userId) return false;
    $stmt = $db->prepare("SELECT can_read_books FROM accounts WHERE id = :id");
    $stmt->execute([':id' => $userId]);
    return (int)$stmt->fetchColumn() === 1;
}

/** mbstring is optional on some hosts: fall back to byte functions. */
function textLength(string $s): int {
    return function_exists('mb_strlen') ? mb_strlen($s) : strlen($s);
}
function textCut(string $s, int $max): string {
    return function_exists('mb_substr') ? mb_substr($s, 0, $max) : substr($s, 0, $max);
}
