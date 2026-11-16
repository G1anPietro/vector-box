<?php
// public/api/mail_link.php — the two links inside our e-mails: confirm the address, stop the news. No login needed (the
// signed token is the proof), no secret is shown, nothing but plain text comes back.
require_once __DIR__ . '/mailer.php';
require_once __DIR__ . '/rate_limiter.php';

header('Content-Type: text/html; charset=utf-8');
header('X-Robots-Tag: noindex');
header('Referrer-Policy: no-referrer');
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'");

/** A tiny page: a mail scanner or a link preview that only OPENS the link changes nothing; a person presses the button. */
function mlPage(string $title, string $text, string $button = '', string $action = ''): void {
    $e = fn($s) => htmlspecialchars($s, ENT_QUOTES);
    echo '<!DOCTYPE html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' . $e($title) . '</title>'
       . '<style>body{font:16px system-ui,sans-serif;background:#16141c;color:#e8e6f0;max-width:30rem;margin:12vh auto;padding:0 1rem}button{font:inherit;padding:.6rem 1.2rem;border-radius:8px;border:1px solid #00ff66;background:#1f1c29;color:#00ff66;cursor:pointer}</style>'
       . '<h1>' . $e($title) . '</h1><p>' . $e($text) . '</p>';
    if ($button !== '') echo '<form method="post" action="' . $e($action) . '"><button type="submit">' . $e($button) . '</button></form>';
    exit();
}

try {
    if (!checkRateLimit('mail_link', 30, 600)) { http_response_code(429); mlPage('Too many requests', 'Please try again in a few minutes.'); }
    $db = getDbConnection();
    $a = (string)($_GET['a'] ?? '');
    $token = (string)($_GET['t'] ?? '');
    $id = null;
    if ($a === 'verify') {
        // signed for the address the account has NOW: after a change the old link finds a different address and fails
        $tid = mailTokenId($token);
        if ($tid !== null) {
            $st = $db->prepare("SELECT email FROM accounts WHERE id = :id AND email != ''");
            $st->execute([':id' => $tid]);
            $addr = (string)$st->fetchColumn();
            $st->closeCursor();
            if ($addr !== '' && mailTokenCheck($db, mailVerifyKind($addr), $token) !== null) $id = $tid;
        }
    } elseif ($a === 'unsub') {
        $id = mailTokenCheck($db, 'unsub', $token);
    }
    if ($id === null) { http_response_code(400); mlPage('Link not valid', 'This link is not valid (or the address was changed since).'); }
    $self = 'mail_link.php?a=' . $a . '&t=' . rawurlencode($token);
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        if ($a === 'verify') mlPage('Confirm your e-mail address', 'Press the button to confirm that this address is yours.', 'Confirm the address', $self);
        mlPage('Stop the news e-mails', 'Press the button to stop receiving news from vector-box. Messages about your account can still arrive.', 'Stop the news', $self);
    }
    if ($a === 'verify') {
        $db->prepare('UPDATE accounts SET email_verified = 1 WHERE id = :id')->execute([':id' => $id]);
        mlPage('Confirmed', 'Thank you: your e-mail address is confirmed.');
    }
    $db->prepare('UPDATE accounts SET email_optin = 0 WHERE id = :id')->execute([':id' => $id]);
    mlPage('Done', 'You will not get news e-mails from vector-box any more.');
} catch (Throwable $e) {
    failInternal('MAIL_LINK', $e);
}
