<?php
// public/api/parola.php — "Parola del giorno" streak, stats and today's saved game, kept for people with an account.
//   GET   -> {success, data: {stats, daily, updated_at} | null}
//   POST  {stats, daily, stats6?, daily6?}  (CSRF, 60 an hour) -> validates and replaces the row; the page merges local and server first.
// stats = {played, won, streak, best, last, lastWin, dist[6]}; daily = {day, guesses[<=6 words], over}.
// The 6-letter mode (stats6/daily6) rides inside the same two columns, under the keys "s6" and "d6".
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/rate_limiter.php';

initSession();
header('Content-Type: application/json');
requireLogin();
$db = getDbConnection();
$me = (int)$_SESSION['user_id'];

/** A stats object, cleaned, or null if anything is out of range. Unknown keys are dropped. */
function parolaCleanStats($s): ?array {
    if (!is_array($s)) return null;
    $int = fn($v, $max) => is_int($v) && $v >= 0 && $v <= $max;
    foreach (['played', 'won', 'streak', 'best'] as $k) if (!$int($s[$k] ?? null, 100000)) return null;
    $last = $s['last'] ?? null;
    if ($last !== null && !(is_int($last) && $last >= 0 && $last <= 20000)) return null;
    $dist = $s['dist'] ?? null;
    if (!is_array($dist) || count($dist) !== 6 || !array_is_list($dist)) return null;
    foreach ($dist as $n) if (!$int($n, 100000)) return null;
    if ($s['won'] > $s['played'] || $s['streak'] > $s['best'] || $s['best'] > $s['played']) return null;
    return ['played' => $s['played'], 'won' => $s['won'], 'streak' => $s['streak'], 'best' => $s['best'], 'last' => $last,
            'lastWin' => !empty($s['lastWin']), 'dist' => $dist];
}

/** A saved daily game, cleaned (words of $len letters a-z, at most 6, the day not in the future), or null. */
function parolaCleanDaily($d, int $len, int $today): ?array {
    if (!is_array($d)) return null;
    $day = $d['day'] ?? null;
    if (!is_int($day) || $day < 0 || $day > $today + 1) return null;   // +1: a phone one time zone ahead of the server
    $g = $d['guesses'] ?? null;
    if (!is_array($g) || count($g) > 6 || !array_is_list($g)) return null;
    foreach ($g as $w) if (!is_string($w) || !preg_match('/^[a-z]{' . $len . '}$/', $w)) return null;
    return ['day' => $day, 'guesses' => $g, 'over' => !empty($d['over'])];
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $st = $db->prepare('SELECT stats, daily, updated_at FROM parola_stats WHERE user_id = :u');
    $st->execute([':u' => $me]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    jsonResponse(['success' => true, 'data' => $row ? ['stats' => json_decode($row['stats'], true), 'daily' => json_decode($row['daily'], true), 'updated_at' => (int)$row['updated_at']] : null]);
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonFail('METHOD', 'Method not allowed', 405);

requireCsrf();
try {
    $raw = (string)file_get_contents('php://input', false, null, 0, 4097);
    if (strlen($raw) > 4096) jsonFail('TOO_BIG', 'Body too large', 413);
    $in = json_decode($raw, true);
    if (!is_array($in)) jsonFail('BAD_INPUT', 'JSON expected');
    if (!checkRateLimit('parola_save', 60, 3600, (string)$me, true, true)) jsonFail('RATE', 'Too many saves, try later', 429);
    $today = (int)floor((time() - gmmktime(0, 0, 0, 1, 1, 2026)) / 86400);   // same day numbering as parola-logic.js
    $stats = parolaCleanStats($in['stats'] ?? null);
    $daily = parolaCleanDaily($in['daily'] ?? null, 5, $today);
    if ($stats === null || $daily === null) jsonFail('BAD_INPUT', 'Invalid stats or daily game');
    if (isset($in['stats6']) || isset($in['daily6'])) {
        $s6 = parolaCleanStats($in['stats6'] ?? null);
        $d6 = parolaCleanDaily($in['daily6'] ?? null, 6, $today);
        if ($s6 === null || $d6 === null) jsonFail('BAD_INPUT', 'Invalid 6-letter stats or daily game');
        $stats['s6'] = $s6;
        $daily['d6'] = $d6;
    }
    $db->prepare('INSERT INTO parola_stats (user_id, stats, daily, updated_at) VALUES (:u, :s, :d, :n)
                  ON CONFLICT(user_id) DO UPDATE SET stats = :s, daily = :d, updated_at = :n')
       ->execute([':u' => $me, ':s' => json_encode($stats), ':d' => json_encode($daily), ':n' => time()]);
    jsonResponse(['success' => true]);
} catch (Throwable $e) {
    failInternal('PAROLA', $e);
}
