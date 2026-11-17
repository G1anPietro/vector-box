<?php
// public/api/sessions_lib.php — "where you are signed in": one row per signed-in browser (table account_sessions).
// Stored: sha256 of the PHP session id (never the id), a label made from the User-Agent (browser + OS, never the raw string),
// the country code and two dates. Never the IP address. Deleting the row signs that browser out on its next request (initSession).
require_once __DIR__ . '/database.php';

const SESSION_TOUCH_EVERY = 600;   // last_seen is written at most once per 10 minutes per session

function sessionSidHash(): string { return hash('sha256', session_id()); }

/** "Firefox on Linux" from a User-Agent; "Unknown browser" when nothing is recognised. Short, fixed vocabulary only. */
function sessionLabel(string $ua): string {
    $ua = substr($ua, 0, 400);
    $browser = 'Unknown browser';
    foreach (['Edg' => 'Edge', 'OPR' => 'Opera', 'Firefox' => 'Firefox', 'FxiOS' => 'Firefox', 'CriOS' => 'Chrome', 'Chrome' => 'Chrome', 'Safari' => 'Safari'] as $needle => $name) {
        if (stripos($ua, $needle) !== false) { $browser = $name; break; }
    }
    $os = 'unknown system';
    foreach (['Android' => 'Android', 'iPhone' => 'iOS', 'iPad' => 'iOS', 'Windows' => 'Windows', 'Mac OS X' => 'macOS', 'CrOS' => 'ChromeOS', 'Linux' => 'Linux'] as $needle => $name) {
        if (stripos($ua, $needle) !== false) { $os = $name; break; }
    }
    return "$browser on $os";
}

/** Adds the row for the CURRENT session (needs an open session with a user). Never throws: tracking must not break a login. */
function sessionTrack(int $userId): void {
    try {
        require_once __DIR__ . '/geoip.php';
        $cc = geoipLookup(getClientIp());
        $now = time();
        getDbConnection()->prepare('INSERT OR IGNORE INTO account_sessions (user_id, sid_hash, label, country, created_at, last_seen) VALUES (:u, :h, :l, :c, :n, :n)')
            ->execute([':u' => $userId, ':h' => sessionSidHash(), ':l' => sessionLabel((string)($_SERVER['HTTP_USER_AGENT'] ?? '')), ':c' => (string)$cc, ':n' => $now]);
        $_SESSION['tracked'] = 1;
    } catch (Throwable $e) { /* busy database: initSession will create it later */ }
}

/**
 * Called by initSession() for a logged-in session (one indexed read). Returns false when this session was revoked:
 * it had a row once ('tracked') and the row is gone. A session older than the feature has no marker: its row is created.
 */
function sessionCheck(int $userId): bool {
    $db = getDbConnection();
    $st = $db->prepare('SELECT last_seen FROM account_sessions WHERE sid_hash = :h AND user_id = :u');
    $st->execute([':h' => sessionSidHash(), ':u' => $userId]);
    $last = $st->fetchColumn();
    $st->closeCursor();
    if ($last === false) {
        if (!empty($_SESSION['tracked'])) return false;
        sessionTrack($userId);
    } elseif (time() - (int)$last >= SESSION_TOUCH_EVERY) {
        $db->prepare('UPDATE account_sessions SET last_seen = :n WHERE sid_hash = :h')->execute([':n' => time(), ':h' => sessionSidHash()]);
    }
    return true;
}
