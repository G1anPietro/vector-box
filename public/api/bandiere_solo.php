<?php
// public/api/bandiere_solo.php — questions for the Bandiere modes that need no room: alone, and one phone passed around.
// No account and no table: the question travels in an encrypted token that only this server can open, so the right answer is
// never in the page until it is checked. Best scores stay in the phone (and on the account through api/records.php).
//
// GET  ?action=question&level=easy|normal|hard|mix&mode=flag|name|capital|mix&exclude=sid,sid (the "sid" of questions already seen)
//        -> {success, token, sid, time, kind, flag, prompt, options}   (same shape as the room question, NO right answer)
// POST {token, choices: [int|null, ...], pass: bool}  (+ CSRF)  -> {success, right: int, results: [bool], points: [int], info, ...}
//        choices = one entry per player (null = no answer); the server times a single player from the token (speed bonus);
//        with pass:true nobody gets a speed bonus (the phone is handed around, so the clock is not the same for everybody).
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/rate_limiter.php';
require_once __DIR__ . '/classi_lib.php';   // appSetting
require_once __DIR__ . '/spia_lib.php';     // spiaShuffle
require_once __DIR__ . '/bandiere_lib.php';

initSession();
header('Cache-Control: no-store');

function bandiereKey(PDO $db): string {
    static $key = null;
    if ($key === null) {
        $s = appSetting($db, 'bandiere_secret');
        if (!$s) { $s = bin2hex(random_bytes(32)); appSettingSet($db, 'bandiere_secret', $s); }
        $key = hash('sha256', 'bandiere:' . $s, true);
    }
    return $key;
}

/** An opaque id of a country, so the page can say "not this one again" without knowing which country it is. */
function bandiereSid(PDO $db, string $iso): string {
    return substr(hash_hmac('sha256', $iso, bandiereKey($db)), 0, 8);
}

function bandiereSeal(PDO $db, array $p): string {
    $iv = random_bytes(12);
    $ct = openssl_encrypt(json_encode($p), 'aes-256-gcm', bandiereKey($db), OPENSSL_RAW_DATA, $iv, $tag);
    return rtrim(strtr(base64_encode($iv . $tag . $ct), '+/', '-_'), '=');
}

function bandiereOpen(PDO $db, string $t): ?array {
    $raw = base64_decode(strtr($t, '-_', '+/'), true);
    if ($raw === false || strlen($raw) < 29) return null;
    $json = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', bandiereKey($db), OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
    $p = $json === false ? null : json_decode($json, true);
    return is_array($p) && isset($p['q'], $p['at']) ? $p : null;
}

try {
    $bank = bandiereBank();
    if (!$bank) jsonFail('no_questions', 'Questions are not available', 503);
    $db = getDbConnection();

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        requireCsrf();
        if (!checkRateLimit('bandiere_check', 300, 600)) jsonFail('slow_down', 'Too many requests', 429);
        $in = readJsonBody();
        $p = is_string($in['token'] ?? null) ? bandiereOpen($db, $in['token']) : null;
        $choices = $in['choices'] ?? null;
        if (!$p || !is_array($choices) || !$choices || count($choices) > 8) jsonFail('bad_question', 'Unknown question', 400);
        $q = $p['q'];
        $pass = !empty($in['pass']);
        $ms = (int)round((microtime(true) - $p['at']) * 1000);
        $results = $points = [];
        foreach (array_values($choices) as $c) {
            $ok = is_int($c) && $c === $q['right'];
            $results[] = $ok;
            // a single player answering late (time is up + 1 s of network grace) gets no points
            $points[] = $ok ? ($pass ? 100 : ($ms <= ($p['time'] + 1) * 1000 ? bandierePoints(min($ms, $p['time'] * 1000), $p['time']) : 0)) : 0;
        }
        jsonResponse(['success' => true, 'right' => $q['right'], 'results' => $results, 'points' => $points] + bandiereInfo($q));
    }

    if (($_GET['action'] ?? '') !== 'question') jsonFail('unknown_action', 'Unknown action', 400);
    if (!checkRateLimit('bandiere_question', 300, 600)) jsonFail('slow_down', 'Too many requests', 429);
    $level = is_string($_GET['level'] ?? null) && isset(BANDIERE_LEVELS[$_GET['level']]) ? $_GET['level'] : 'mix';
    $mode = is_string($_GET['mode'] ?? null) && in_array($_GET['mode'], BANDIERE_MODES, true) ? $_GET['mode'] : 'mix';
    $seen = array_flip(array_slice(array_filter(explode(',', (string)($_GET['exclude'] ?? '')), fn($x) => preg_match('/^[a-f0-9]{8}$/', $x)), 0, 200));
    $used = array_values(array_filter(array_keys($bank), fn($i) => isset($seen[bandiereSid($db, $bank[$i][0])])));
    $q = bandiereDraw($level, $mode, $used);
    $time = BANDIERE_LEVELS[$level];
    jsonResponse(['success' => true, 'time' => $time, 'sid' => bandiereSid($db, $bank[$q['i']][0]), 'token' => bandiereSeal($db, ['q' => $q, 'at' => microtime(true), 'time' => $time])] + bandierePublic($q));
} catch (Throwable $e) {
    failInternal('BANDIERE_SOLO', $e);
}
