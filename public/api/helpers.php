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
 * The token is short-lived and only says whether the viewer may read hidden
 * (admin) rooms; the hub verifies it with the shared secret.
 */
function chatStreamConfig(bool $isAdmin): ?array {
    $secret = chatHubSecret();
    $url = (string)envValue('CHAT_STREAM_URL', '');
    if ($secret === '' || $url === '') return null;

    $body = base64UrlEncode(json_encode([
        'p'   => 'chat',
        'adm' => $isAdmin ? 1 : 0,
        'exp' => time() + 600,
        'n'   => bin2hex(random_bytes(8)),
    ]));
    $sig = base64UrlEncode(hash_hmac('sha256', $body, $secret, true));

    return ['url' => $url, 'token' => $body . '.' . $sig];
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
function sendPageSecurityHeaders(): void {
    if (PHP_SAPI === 'cli' || headers_sent()) return;

    $connect = ["'self'"];
    $streamUrl = (string)envValue('CHAT_STREAM_URL', '');
    if (preg_match('#^(https?://[^/]+)#i', $streamUrl, $m)) {
        $connect[] = $m[1]; // chat hub on another origin
    }

    $policy = implode('; ', [
        "default-src 'self'",
        // reader.php loads jszip/pdf.js/epub.js from these CDNs
        "script-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
        // many inline style="" attributes and element.style writes
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        'connect-src ' . implode(' ', $connect),
        "worker-src 'self' blob: https://cdnjs.cloudflare.com",
        // epub.js renders chapters in blob:/srcdoc iframes
        "frame-src 'self' blob: data:",
        "frame-ancestors 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
    ]);

    $enforce = strtolower((string)envValue('CSP_ENFORCE', 'false')) === 'true';
    header(($enforce ? 'Content-Security-Policy: ' : 'Content-Security-Policy-Report-Only: ') . $policy);
}

sendBaseSecurityHeaders();

/** mbstring is optional on some hosts: fall back to byte functions. */
function textLength(string $s): int {
    return function_exists('mb_strlen') ? mb_strlen($s) : strlen($s);
}
function textCut(string $s, int $max): string {
    return function_exists('mb_substr') ? mb_substr($s, 0, $max) : substr($s, 0, $max);
}
