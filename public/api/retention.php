<?php
// public/api/retention.php — storage limitation (GDPR art. 5): personal data is not kept for ever.
// maybeRunRetention() is called by every page (head.php) but only does anything once a day (a stamp file in data/), after the
// page has been sent. It can also be run by hand: `php public/api/retention.php`.
// Periods (days) can be changed in .env; the privacy page prints these same numbers, so the text always matches the code.
//   RETENTION_VISITS_DAYS  visit log lines and the visitor counter         90
//   RETENTION_BOTS_DAYS    bot log lines (IP addresses)                    30
//   RETENTION_IP_DAYS      IP address stored with chat / guestbook         90   (the message stays, the address goes)
//   RETENTION_CHAT_DAYS    public chat messages and guestbook entries      365
//   RETENTION_DM_DAYS      private messages                                365
//   RETENTION_NOTIF_DAYS   notifications                                   180
//   RETENTION_SHARE_DAYS   temporary links, after they expired             30
require_once __DIR__ . '/helpers.php';

function retentionDays(string $key): int {
    static $defaults = ['VISITS' => 90, 'BOTS' => 30, 'IP' => 90, 'CHAT' => 365, 'DM' => 365, 'NOTIF' => 180, 'SHARE' => 30, 'ADMINLOG' => 365];
    $n = (int)envValue('RETENTION_' . $key . '_DAYS', (string)$defaults[$key]);
    return $n >= 1 ? $n : $defaults[$key];
}

/** Keeps only the lines whose first 10 characters (a date) are not older than $cutoff (Y-m-d). */
function retentionTrimLog(string $file, string $cutoff): int {
    if (!is_file($file)) return 0;
    $lines = file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
    $keep = array_values(array_filter($lines, fn($l) => substr($l, 0, 10) >= $cutoff));
    $removed = count($lines) - count($keep);
    if ($removed > 0) file_put_contents($file, $keep ? implode("\n", $keep) . "\n" : '', LOCK_EX);
    return $removed;
}

function runRetention(PDO $db): array {
    $now = time();
    $day = fn(int $days) => $now - $days * 86400;
    $date = fn(int $days) => date('Y-m-d H:i:s', $now - $days * 86400);
    $dataDir = dirname(__DIR__, 2) . '/data';
    $done = [];
    $run = function (string $name, string $sql, array $p = []) use ($db, &$done) { $s = $db->prepare($sql); $s->execute($p); $done[$name] = $s->rowCount(); };

    $run('visitors', 'DELETE FROM visitors WHERE last_seen < :t', [':t' => $day(retentionDays('VISITS'))]);
    $run('chat_ip', "UPDATE transmissions SET sender_ip = '' WHERE sender_ip != '' AND created_at < :d", [':d' => $date(retentionDays('IP'))]);
    $run('guestbook_ip', "UPDATE guestbook SET sender_ip = '' WHERE sender_ip != '' AND created_at < :d", [':d' => $date(retentionDays('IP'))]);
    $run('chat', 'DELETE FROM transmissions WHERE created_at < :d', [':d' => $date(retentionDays('CHAT'))]);
    $run('guestbook', 'DELETE FROM guestbook WHERE created_at < :d', [':d' => $date(retentionDays('CHAT'))]);
    $run('admin_log', 'DELETE FROM admin_log WHERE created_at < :t', [':t' => $day(retentionDays('ADMINLOG'))]);
    $run('idea_votes', 'DELETE FROM news_idea_votes WHERE idea_id NOT IN (SELECT id FROM news_ideas)', []);
    $run('news_ideas', 'DELETE FROM news_ideas WHERE created_at < :t', [':t' => $day(retentionDays('CHAT'))]);
    $run('dm', 'DELETE FROM dm_messages WHERE created_at < :d', [':d' => $date(retentionDays('DM'))]);
    $run('notifications', 'DELETE FROM notifications WHERE created_at < :t', [':t' => $day(retentionDays('NOTIF'))]);
    $run('share_links', 'DELETE FROM share_links WHERE expires_at < :t', [':t' => $day(retentionDays('SHARE'))]);
    $run('bot_stats', 'DELETE FROM bot_stats WHERE day < :d', [':d' => date('Y-m-d', $day(400))]);

    $visitsCutoff = date('Y-m-d', $day(retentionDays('VISITS')));
    $done['visits_log'] = retentionTrimLog("$dataDir/visits.log", $visitsCutoff) + retentionTrimLog("$dataDir/visits.log.1", $visitsCutoff);
    $botsCutoff = date('Y-m-d', $day(retentionDays('BOTS')));
    $done['bots_log'] = retentionTrimLog("$dataDir/bots.log", $botsCutoff) + retentionTrimLog("$dataDir/bots.log.1", $botsCutoff);
    // daily upkeep after the clean-up: fresh query-planner statistics and a compact full-text index (both cheap; never fatal)
    try { $db->exec('PRAGMA optimize'); } catch (Throwable $e) { /* busy: tomorrow */ }
    try { $db->exec("INSERT INTO notes_fts(notes_fts) VALUES('optimize')"); } catch (Throwable $e) { /* no FTS table */ }
    return $done;
}

/** At most once a day, after the response has gone out. Never breaks a page. */
function maybeRunRetention(): void {
    if (PHP_SAPI === 'cli') return;
    $stamp = dirname(__DIR__, 2) . '/data/retention.stamp';
    $last = @filemtime($stamp);
    if ($last !== false && time() - $last < 86400) return;
    if (!is_dir(dirname($stamp))) return;
    @touch($stamp);   // claim the day first, so a burst of requests does not start it many times
    register_shutdown_function(function () {
        if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
        try {
            require_once __DIR__ . '/database.php';
            runRetention(getDbConnection());
        } catch (Throwable $e) {
            require_once __DIR__ . '/debug_logger.php';
            logSystemError('RETENTION', $e->getMessage());
        }
        // the country database for the statistics map: refreshed monthly by itself (GEOIP_AUTO=false switches it off)
        if (strtolower((string)envValue('GEOIP_AUTO', 'true')) !== 'false') {
            require_once __DIR__ . '/geoip.php';
            geoipRefreshIfDue();
        }
    });
}

if (PHP_SAPI === 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    require_once __DIR__ . '/database.php';
    echo json_encode(runRetention(getDbConnection()), JSON_PRETTY_PRINT), "\n";
}
