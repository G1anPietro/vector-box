<?php
// public/api/totp.php — the admin's own two-step login settings (admin only; every POST needs CSRF).
//   GET                                   -> {enabled, backup_left}
//   POST {action:'begin'}                 -> a new secret (not active yet): {secret, uri} for the authenticator app
//   POST {action:'confirm', code}         -> checks the first code, switches it on, returns 8 backup codes (shown once)
//   POST {action:'backup', password, code}  -> new backup codes (the old ones stop working)
//   POST {action:'disable', password, code} -> switches it off (password AND a code are required)
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/rate_limiter.php';
require_once __DIR__ . '/totp_lib.php';

initSession();
header('Content-Type: application/json');
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') requireCsrf();
requireAdmin();
$db = getDbConnection();
$me = (int)$_SESSION['user_id'];

$st = $db->prepare('SELECT * FROM accounts WHERE id = :i');
$st->execute([':i' => $me]);
$acc = $st->fetch(PDO::FETCH_ASSOC);
$st->closeCursor();
if (!$acc) jsonFail('UNAUTHENTICATED', 'Login required', 401);

try {
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        jsonResponse(['success' => true, 'enabled' => totpEnabled($acc), 'backup_left' => count(json_decode((string)$acc['totp_backup'], true) ?: [])]);
    }
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonFail('METHOD', 'Method not allowed', 405);
    if (!checkRateLimit('totp_manage', 10, 600, (string)$me, true, true)) jsonFail('RATE', 'Too many tries, wait a few minutes', 429);
    $in = readJsonBody();
    $action = (string)($in['action'] ?? '');

    // changing or removing a protection needs BOTH proofs: the password and a current code
    $reauth = function () use ($db, $acc, $in): bool {
        return password_verify(trim((string)($in['password'] ?? '')), (string)$acc['password_hash'])
            && totpVerifyLogin($db, $acc, (string)($in['code'] ?? ''));
    };

    if ($action === 'begin') {
        if (totpEnabled($acc)) jsonFail('ALREADY_ON', 'Two-step login is already on', 409);
        $secret = random_bytes(20);
        $db->prepare("UPDATE accounts SET totp_secret = :s, totp_last_step = 0 WHERE id = :i AND totp_enabled = 0")->execute([':s' => totpEncrypt($secret), ':i' => $me]);
        $b32 = base32Encode($secret);
        jsonResponse(['success' => true, 'secret' => $b32,
            'uri' => 'otpauth://totp/vector-box:' . rawurlencode((string)$acc['username']) . '?secret=' . $b32 . '&issuer=vector-box&algorithm=SHA1&digits=6&period=' . TOTP_PERIOD]);
    }
    if ($action === 'confirm') {
        if (totpEnabled($acc)) jsonFail('ALREADY_ON', 'Two-step login is already on', 409);
        $secret = totpDecrypt((string)$acc['totp_secret']);
        $step = $secret === null ? null : totpCheck($secret, (string)($in['code'] ?? ''), 0);
        if ($step === null) jsonFail('BAD_CODE', 'That code is not right: check the time of your phone and try the next one', 400);
        [$plain, $hashes] = totpNewBackup();
        $db->prepare('UPDATE accounts SET totp_enabled = 1, totp_last_step = :s, totp_backup = :b WHERE id = :i')->execute([':s' => $step, ':b' => $hashes, ':i' => $me]);
        jsonResponse(['success' => true, 'backup_codes' => $plain]);
    }
    if (!totpEnabled($acc)) jsonFail('NOT_ON', 'Two-step login is not on', 409);
    if (!$reauth()) jsonFail('BAD_CREDENTIALS', 'Password or code not right', 403);
    if ($action === 'backup') {
        [$plain, $hashes] = totpNewBackup();
        $db->prepare('UPDATE accounts SET totp_backup = :b WHERE id = :i')->execute([':b' => $hashes, ':i' => $me]);
        jsonResponse(['success' => true, 'backup_codes' => $plain]);
    }
    if ($action === 'disable') {
        $db->prepare("UPDATE accounts SET totp_enabled = 0, totp_secret = '', totp_last_step = 0, totp_backup = '' WHERE id = :i")->execute([':i' => $me]);
        jsonResponse(['success' => true]);
    }
    jsonFail('BAD_INPUT', 'action');
} catch (Throwable $e) {
    failInternal('TOTP', $e);
}
