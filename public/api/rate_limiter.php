<?php
// public/api/rate_limiter.php
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/debug_logger.php';

/**
 * Sliding-window rate limiter backed by SQLite (atomic, no per-IP files on disk).
 *
 * @param string      $action       bucket name
 * @param int         $maxRequests  max hits inside the window
 * @param int         $decaySeconds window size
 * @param string|null $key          what to limit on (default: client IP; use a username for per-account limits)
 * @return bool true if the request is allowed
 */
function checkRateLimit(string $action = 'feed', int $maxRequests = 5, int $decaySeconds = 10, ?string $key = null): bool {
    $bucket = substr($action . ':' . ($key ?? getClientIp()), 0, 200);
    $now = time();

    try {
        $db = getDbConnection();
        $db->exec('BEGIN IMMEDIATE');

        $stmt = $db->prepare('DELETE FROM rate_limits WHERE bucket = :b AND ts <= :t');
        $stmt->execute([':b' => $bucket, ':t' => $now - $decaySeconds]);

        $stmt = $db->prepare('SELECT COUNT(*) FROM rate_limits WHERE bucket = :b');
        $stmt->execute([':b' => $bucket]);
        $count = (int)$stmt->fetchColumn();

        if ($count >= $maxRequests) {
            $db->exec('COMMIT');
            logSystemError('RATE_LIMIT_EXCEEDED', "{$bucket} exceeded {$maxRequests}/{$decaySeconds}s");
            return false;
        }

        $stmt = $db->prepare('INSERT INTO rate_limits (bucket, ts) VALUES (:b, :t)');
        $stmt->execute([':b' => $bucket, ':t' => $now]);

        // Occasional housekeeping of stale rows from any bucket
        if (random_int(1, 200) === 1) {
            $db->exec('DELETE FROM rate_limits WHERE ts < ' . ($now - 86400));
        }

        $db->exec('COMMIT');
        return true;
    } catch (Throwable $e) {
        if (isset($db)) {
            try { $db->exec('ROLLBACK'); } catch (Throwable $ignored) { /* no active transaction */ }
        }
        logSystemError('RATE_LIMITER_FAIL', $e->getMessage());
        return true; // fail open: a limiter error must not take the site down
    }
}
