<?php
// public/api/mailer.php — sending e-mail through a queue. Present in the code, OFF until MAIL_DRIVER is set in .env:
//   MAIL_DRIVER=            nothing is sent (the box still works, messages wait in the queue)
//   MAIL_DRIVER=log         "sends" to data/mail.log (tests, trying the box without a provider)
//   MAIL_DRIVER=http        POST to MAIL_HTTP_URL (Resend) with "Authorization: Bearer MAIL_API_KEY" and a JSON body
//                           {from, to:[address], subject, text}: Resend's shape (https://api.resend.com/emails). Other services
//                           (Brevo, Mailgun...) use different bodies and need their own small driver here
// MAIL_FROM="Name <address@your-domain>"   MAIL_DAILY_LIMIT=200 (messages a day, all kinds)
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/classi_lib.php';   // appSetting / appSettingSet

const MAIL_MAX_ATTEMPTS = 5;

function mailDriver(): string {
    $d = strtolower(trim((string)envValue('MAIL_DRIVER', '')));
    return in_array($d, ['log', 'http'], true) ? $d : '';
}

function mailEnabled(): bool { return mailDriver() !== ''; }

function mailValidAddress(string $e): bool {
    return strlen($e) <= 254 && !preg_match('/[\r\n<>,;\s]/', $e) && filter_var($e, FILTER_VALIDATE_EMAIL) !== false;
}

/** One line, no control characters: a subject or a name can never add a header. */
function mailLine(string $s, int $max = 200): string {
    return textCut(trim(preg_replace('/[\x00-\x1F\x7F]+/', ' ', $s) ?? ''), $max);
}

function mailSecret(PDO $db): string {
    $s = appSetting($db, 'mail_secret');
    if (!$s) { $s = bin2hex(random_bytes(32)); appSettingSet($db, 'mail_secret', $s); }
    return $s;
}

/** A link token for one account and one purpose (verify, unsub): "<id>.<signature>", checked with hash_equals. */
function mailToken(PDO $db, string $kind, int $accountId): string {
    return $accountId . '.' . substr(hash_hmac('sha256', "$kind:$accountId", mailSecret($db)), 0, 40);
}

function mailTokenCheck(PDO $db, string $kind, string $token): ?int {
    if (!preg_match('/^(\d{1,12})\.([a-f0-9]{40})$/', $token, $m)) return null;
    return hash_equals(mailToken($db, $kind, (int)$m[1]), $token) ? (int)$m[1] : null;
}

/** The id inside a token (no check yet): to find the account whose current address the token must be signed for. */
function mailTokenId(string $token): ?int {
    return preg_match('/^(\d{1,12})\.[a-f0-9]{40}$/', $token, $m) ? (int)$m[1] : null;
}

/** The confirmation token is signed with the address itself: a link for the old address is worthless after a change. */
function mailVerifyKind(string $email): string { return 'verify:' . strtolower($email); }

function mailSentToday(PDO $db): int {
    $st = $db->prepare("SELECT COUNT(*) FROM mail_queue WHERE status = 'sent' AND sent_at >= :t");
    $st->execute([':t' => strtotime('today')]);
    return (int)$st->fetchColumn();
}

function mailEnqueue(PDO $db, ?int $messageId, ?int $accountId, string $to, string $subject, string $body, string $kind = 'bulk'): int {
    if (!mailValidAddress($to)) throw new InvalidArgumentException('bad address');
    $db->prepare('INSERT INTO mail_queue (message_id, account_id, to_email, subject, body, kind, created_at) VALUES (:m, :a, :t, :s, :b, :k, :c)')
       ->execute([':m' => $messageId, ':a' => $accountId, ':t' => $to, ':s' => mailLine($subject), ':b' => $body, ':k' => $kind, ':c' => time()]);
    return (int)$db->lastInsertId();
}

/** Who may receive site news: a verified address AND the person said yes. 'supporters' = those with the badge. */
function mailAudience(PDO $db, string $audience): array {
    $rows = $db->query("SELECT id, username, email FROM accounts WHERE email != '' AND email_verified = 1 AND email_optin = 1 AND is_banned = 0 ORDER BY id")->fetchAll();
    if ($audience === 'supporters') $rows = array_values(array_filter($rows, fn($r) => accountIsSupporter($db, (int)$r['id'])));
    return $rows;
}

/** The text every news message ends with: who sends it, why the person gets it, and the one-click way out. */
function mailFooter(PDO $db, int $accountId): string {
    $base = siteUrl();
    return "\n\n--\nYou get this because you asked for news from vector-box ($base) in your account settings.\n"
         . "Stop them with one click: $base/api/mail_link.php?a=unsub&t=" . mailToken($db, 'unsub', $accountId) . "\n";
}

/** The real sending of one queued row. Throws on failure. */
function mailTransport(array $row): void {
    $driver = mailDriver();
    $from = mailLine((string)envValue('MAIL_FROM', 'vector-box <no-reply@localhost>'));
    if ($driver === 'log') {
        $file = dirname(__DIR__, 2) . '/data/mail.log';
        file_put_contents($file, date('c') . "\tto=" . $row['to_email'] . "\tsubject=" . $row['subject'] . "\n" . $row['body'] . "\n----\n", FILE_APPEND | LOCK_EX);
        return;
    }
    if ($driver === 'http') {
        $url = (string)envValue('MAIL_HTTP_URL', '');
        $key = (string)envValue('MAIL_API_KEY', '');
        if (!preg_match('#^https://#', $url) || $key === '') throw new RuntimeException('MAIL_HTTP_URL (https) and MAIL_API_KEY are needed');
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode(['from' => $from, 'to' => [$row['to_email']], 'subject' => $row['subject'], 'text' => $row['body']], JSON_UNESCAPED_UNICODE),
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . $key],
            CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_SSL_VERIFYPEER => true,
        ]);
        $out = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($out === false || $code < 200 || $code >= 300) throw new RuntimeException("mail service answered HTTP $code $err");
        return;
    }
    throw new RuntimeException('MAIL_DRIVER is not set');
}

/**
 * Sends up to $limit pending rows (oldest first, or only $ids), within the daily limit. Each row is CLAIMED first (a conditional
 * update), so the worker, "send now" and the account page can overlap without sending twice. News (kind bulk) are re-checked
 * at the moment of sending: a person who unsubscribed, removed or changed the address since is skipped. A failed row is
 * retried (up to MAIL_MAX_ATTEMPTS), then marked failed. Returns ['sent','failed','left','off'].
 */
function mailProcessQueue(PDO $db, int $limit = 20, ?array $ids = null): array {
    $out = ['sent' => 0, 'failed' => 0, 'left' => 0, 'off' => mailDriver() === ''];
    if (!$out['off']) {
        // a row claimed by a run that died is given back after ten minutes
        $db->prepare("UPDATE mail_queue SET status = 'pending' WHERE status = 'sending' AND sent_at < :t")->execute([':t' => time() - 600]);
        $room = max(0, (int)envValue('MAIL_DAILY_LIMIT', '200') - mailSentToday($db));
        if ($ids === null) {
            $st = $db->prepare("SELECT * FROM mail_queue WHERE status = 'pending' ORDER BY id LIMIT :l");
            $st->bindValue(':l', min($limit, $room), PDO::PARAM_INT);
            $st->execute();
            $rows = $st->fetchAll();
        } else {
            $rows = [];
            foreach (array_slice(array_map('intval', $ids), 0, min($limit, $room)) as $id) {
                $st = $db->prepare("SELECT * FROM mail_queue WHERE id = :id AND status = 'pending'");
                $st->execute([':id' => $id]);
                if ($r = $st->fetch()) $rows[] = $r;
            }
        }
        $claim = $db->prepare("UPDATE mail_queue SET status = 'sending', sent_at = :t WHERE id = :id AND status = 'pending'");
        foreach ($rows as $row) {
            $claim->execute([':t' => time(), ':id' => $row['id']]);
            if ($claim->rowCount() !== 1) continue;                // somebody else took it
            try {
                if ($row['kind'] === 'bulk' || $row['kind'] === 'direct') {
                    // news need the consent too; a direct message from the admin only needs the address to be the confirmed one
                    $ok = $db->prepare('SELECT 1 FROM accounts WHERE id = :a AND email = :e AND email_verified = 1' . ($row['kind'] === 'bulk' ? ' AND email_optin = 1 AND is_banned = 0' : ''));
                    $ok->execute([':a' => (int)$row['account_id'], ':e' => $row['to_email']]);
                    if (!$ok->fetchColumn()) {
                        $db->prepare("UPDATE mail_queue SET status = 'failed', last_error = 'no longer subscribed', sent_at = NULL WHERE id = :id")->execute([':id' => $row['id']]);
                        continue;
                    }
                }
                mailTransport($row);
                $db->prepare("UPDATE mail_queue SET status = 'sent', sent_at = :t, attempts = attempts + 1, last_error = '' WHERE id = :id")->execute([':t' => time(), ':id' => $row['id']]);
                $out['sent']++;
            } catch (Throwable $e) {
                $final = (int)$row['attempts'] + 1 >= MAIL_MAX_ATTEMPTS;
                $db->prepare('UPDATE mail_queue SET status = :s, attempts = attempts + 1, last_error = :e, sent_at = NULL WHERE id = :id')
                   ->execute([':s' => $final ? 'failed' : 'pending', ':e' => textCut($e->getMessage(), 300), ':id' => $row['id']]);
                if ($final) $out['failed']++;
            }
        }
    }
    $out['left'] = (int)$db->query("SELECT COUNT(*) FROM mail_queue WHERE status = 'pending'")->fetchColumn();
    return $out;
}
