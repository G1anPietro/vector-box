<?php
// public/api/password_reset_lib.php — password recovery by e-mail. A reset link is "<id>.<expiry>.<signature>"; the signature covers the
// CURRENT password hash, so the link dies the moment the password changes (single use) and after PR_TTL seconds.
// Not offered to admins or to accounts with two-step login (their e-mail alone must not open the account): tools/password-reset.php does those.
require_once __DIR__ . '/mailer.php';

const PR_TTL = 1800;

function prSig(PDO $db, array $acc, int $exp): string {
    return substr(hash_hmac('sha256', 'reset:' . $acc['id'] . ':' . $exp . ':' . substr(hash('sha256', (string)$acc['password_hash']), 0, 20), mailSecret($db)), 0, 40);
}

function prToken(PDO $db, array $acc): string {
    $exp = time() + PR_TTL;
    return $acc['id'] . '.' . $exp . '.' . prSig($db, $acc, $exp);
}

/** The account a valid, unexpired token belongs to, or null. */
function prCheck(PDO $db, string $token): ?array {
    if (!preg_match('/^(\d{1,12})\.(\d{10})\.([a-f0-9]{40})$/', $token, $m) || (int)$m[2] < time()) return null;
    $st = $db->prepare('SELECT id, username, password_hash, email, email_verified, is_admin, totp_enabled FROM accounts WHERE id = :i');
    $st->execute([':i' => (int)$m[1]]);
    $acc = $st->fetch();
    return ($acc && prEligible($acc) && hash_equals(prSig($db, $acc, (int)$m[2]), $m[3])) ? $acc : null;
}

function prEligible(array $acc): bool {
    return (string)$acc['email'] !== '' && (int)$acc['email_verified'] === 1 && (int)$acc['is_admin'] === 0 && (int)$acc['totp_enabled'] === 0
        && !str_starts_with((string)$acc['username'], 'guest_');
}

/** Queues the reset e-mail for the account that matches a username or a confirmed address. Returns the queue id, or 0 (nothing to send). */
function prRequest(PDO $db, string $who): int {
    $who = trim($who);
    if ($who === '' || textLength($who) > 254) return 0;
    $st = $db->prepare('SELECT id, username, password_hash, email, email_verified, is_admin, totp_enabled, lang FROM accounts WHERE LOWER(username) = LOWER(:w) OR (email_verified = 1 AND LOWER(email) = LOWER(:w)) ORDER BY (LOWER(username) = LOWER(:w)) DESC LIMIT 1');
    $st->execute([':w' => $who]);
    $acc = $st->fetch();
    if (!$acc || !prEligible($acc) || !mailEnabled() || !mailValidAddress((string)$acc['email'])) return 0;
    $url = siteUrl() . '/pages/password_reset.php?t=' . prToken($db, $acc);
    $it = ($acc['lang'] ?? 'en') === 'it';
    $subject = $it ? 'Recupero della password' : 'Password recovery';
    $body = $it
        ? "Ciao {$acc['username']},\n\nabbiamo ricevuto una richiesta per scegliere una nuova password. Il link vale 30 minuti e funziona una volta sola:\n$url\n\nSe non sei stato tu, ignora questo messaggio: la tua password non cambia."
        : "Hello {$acc['username']},\n\nwe received a request to choose a new password. The link is valid for 30 minutes and works once:\n$url\n\nIf it was not you, ignore this message: your password does not change.";
    return mailEnqueue($db, null, (int)$acc['id'], (string)$acc['email'], $subject, $body, 'verify');
}
