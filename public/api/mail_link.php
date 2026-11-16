<?php
// public/api/mail_link.php — the two links inside our e-mails: confirm the address, stop the news. No login needed (the
// signed token is the proof), no secret is shown, nothing but plain text comes back.
require_once __DIR__ . '/mailer.php';
require_once __DIR__ . '/rate_limiter.php';

header('Content-Type: text/plain; charset=utf-8');
header('X-Robots-Tag: noindex');
header('Referrer-Policy: no-referrer');

try {
    if (!checkRateLimit('mail_link', 30, 600)) { http_response_code(429); exit("Too many requests.\n"); }
    $db = getDbConnection();
    $a = (string)($_GET['a'] ?? '');
    $kind = $a === 'verify' ? 'verify' : ($a === 'unsub' ? 'unsub' : '');
    $id = $kind === '' ? null : mailTokenCheck($db, $kind, (string)($_GET['t'] ?? ''));
    if ($id === null) { http_response_code(400); exit("This link is not valid.\n"); }
    if ($kind === 'verify') {
        $n = $db->prepare("UPDATE accounts SET email_verified = 1 WHERE id = :id AND email != ''");
        $n->execute([':id' => $id]);
        exit($n->rowCount() ? "Thank you: your e-mail address is confirmed.\n" : "Nothing to confirm (the address was removed).\n");
    }
    $db->prepare('UPDATE accounts SET email_optin = 0 WHERE id = :id')->execute([':id' => $id]);
    exit("Done: you will not get news e-mails from vector-box any more. (Messages about your account, like confirming an address, can still arrive.)\n");
} catch (Throwable $e) {
    failInternal('MAIL_LINK', $e);
}
