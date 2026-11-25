<?php
// public/api/inventato_solo.php — claims for "Vero o inventato" alone (no room). No account and no table: the claim travels in an
// encrypted token that only this server can open, so the truth is never in the page until the answer is checked.
// Best scores stay in the phone (and on the account through api/records.php).
//
// GET  ?action=question&level=easy|hard|mix&time=15|25|40&exclude=sid,sid -> {success, token, sid, time, cat, diff, text:{it,en,es,fr,de}}
// POST {token, choice: 1|0|null}  (+ CSRF)  -> {success, right: bool, truth: bool, explain:{...}, points}   1 = true, 0 = made up, null = no answer
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/rate_limiter.php';
require_once __DIR__ . '/classi_lib.php';   // appSetting
require_once __DIR__ . '/inventato_lib.php';

initSession();
header('Cache-Control: no-store');

function inventatoKey(PDO $db): string {
    static $key = null;
    if ($key === null) {
        $s = appSetting($db, 'inventato_secret');
        if (!$s) { $s = bin2hex(random_bytes(32)); appSettingSet($db, 'inventato_secret', $s); }
        $key = hash('sha256', 'inventato:' . $s, true);
    }
    return $key;
}

/** An opaque id of a claim, so the page can say "not this one again" without knowing whether it is true. */
function inventatoSid(PDO $db, int $i): string {
    return substr(hash_hmac('sha256', (string)$i, inventatoKey($db)), 0, 8);
}

function inventatoSeal(PDO $db, array $p): string {
    $iv = random_bytes(12);
    $ct = openssl_encrypt(json_encode($p), 'aes-256-gcm', inventatoKey($db), OPENSSL_RAW_DATA, $iv, $tag);
    return rtrim(strtr(base64_encode($iv . $tag . $ct), '+/', '-_'), '=');
}

function inventatoOpen(PDO $db, string $t): ?array {
    $raw = base64_decode(strtr($t, '-_', '+/'), true);
    if ($raw === false || strlen($raw) < 29) return null;
    $json = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', inventatoKey($db), OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
    $p = $json === false ? null : json_decode($json, true);
    return is_array($p) && isset($p['i'], $p['at'], $p['time']) ? $p : null;
}

try {
    $bank = inventatoBank();
    if (!$bank) jsonFail('no_questions', 'Questions are not available', 503);
    $db = getDbConnection();

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        requireCsrf();
        if (!checkRateLimit('inventato_check', 300, 600)) jsonFail('slow_down', 'Too many requests', 429);
        $in = readJsonBody();
        $p = is_string($in['token'] ?? null) ? inventatoOpen($db, $in['token']) : null;
        if (!$p || !isset($bank[$p['i']])) jsonFail('bad_question', 'Unknown question', 400);
        $choice = $in['choice'] ?? null;
        $info = inventatoInfo($p['i']);
        $ms = (int)round((microtime(true) - $p['at']) * 1000);
        $right = is_int($choice) && $choice === ($info['truth'] ? 1 : 0) && $ms <= ($p['time'] + 1) * 1000;   // 1 s of network grace
        jsonResponse(['success' => true, 'right' => $right, 'points' => $right ? inventatoPoints(min($ms, $p['time'] * 1000), $p['time']) : 0] + $info);
    }

    if (($_GET['action'] ?? '') !== 'question') jsonFail('unknown_action', 'Unknown action', 400);
    if (!checkRateLimit('inventato_question', 300, 600)) jsonFail('slow_down', 'Too many requests', 429);
    $level = is_string($_GET['level'] ?? null) && in_array($_GET['level'], INVENTATO_LEVELS, true) ? $_GET['level'] : 'mix';
    $time = in_array((int)($_GET['time'] ?? 0), INVENTATO_TIMES, true) ? (int)$_GET['time'] : 25;
    $seen = array_flip(array_slice(array_filter(explode(',', (string)($_GET['exclude'] ?? '')), fn($x) => preg_match('/^[a-f0-9]{8}$/', $x)), 0, 300));
    $used = array_values(array_filter(array_keys($bank), fn($i) => isset($seen[inventatoSid($db, $i)])));
    $i = inventatoDraw($level, $used);
    jsonResponse(['success' => true, 'time' => $time, 'sid' => inventatoSid($db, $i), 'token' => inventatoSeal($db, ['i' => $i, 'at' => microtime(true), 'time' => $time])] + inventatoPublic($i));
} catch (Throwable $e) {
    failInternal('INVENTATO_SOLO', $e);
}
