<?php
// public/api/tempmail.php — temporary public mailboxes, open to everybody (no account). See tempmail_lib.php.
// The owner of a box proves it with the secret token, sent in the header X-Tempmail-Token (never in the URL: URLs end up in logs).
//   GET  ?action=pow                      -> {challenge, zeros}   (a small proof of work, against bots)
//   POST {action:'create', challenge, counter, website:''}   -> {address, token, expires_at}   (website is a honeypot: humans leave it empty)
//   GET  ?action=list                     -> {address, expires_at, messages:[{id, from, subject, created_at}]}
//   GET  ?action=get&id=N                 -> {message:{…, body}}  (plain text: the page never renders it as HTML)
//   POST {action:'extend'} | {action:'delete'} | {action:'delete_message', id}
require_once __DIR__ . '/tempmail_lib.php';

header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex');
if (!tmEnabled()) jsonFail('off', 'Temporary mail is switched off', 503);

try {
    $db = getDbConnection();
    if (random_int(1, 40) === 1) tmPurge($db);
    $post = ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST';
    $in = $post ? readJsonBody() : [];
    $action = (string)($post ? ($in['action'] ?? '') : ($_GET['action'] ?? 'list'));

    if (!$post && $action === 'pow') {
        if (!checkRateLimit('tm_pow', 30, 600, null, false)) jsonFail('slow_down', 'Too many requests, wait a little', 429);
        jsonResponse(['success' => true, 'challenge' => tmChallenge($db), 'zeros' => TM_POW_ZEROS]);
    }

    if ($post) { initSession(); requireCsrf(); }   // the session only carries the CSRF token: there are no accounts here

    if ($post && $action === 'create') {
        if (!checkRateLimit('tm_create_m', 2, 60, null, false, true) || !checkRateLimit('tm_create_h', 6, 3600, null, true, true)) jsonFail('slow_down', 'Too many new addresses from your network, try later', 429);
        if (trim((string)($in['website'] ?? '')) !== '') jsonFail('bad_request', 'Request refused');   // a bot filled the hidden field
        $nonce = tmCheckPow($db, (string)($in['challenge'] ?? ''), (string)($in['counter'] ?? ''));
        if ($nonce === null) jsonFail('bad_pow', 'The check failed, reload the page and try again', 400);
        tmPurge($db);
        if ((int)$db->query('SELECT COUNT(*) FROM temp_boxes')->fetchColumn() >= TM_MAX_BOXES) jsonFail('busy', 'No free addresses right now, try later', 503);
        $token = bin2hex(random_bytes(24));
        $now = time();
        $alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
        for ($try = 0; $try < 5; $try++) {
            $local = TM_PREFIX;
            foreach (str_split(random_bytes(10)) as $ch) $local .= $alphabet[ord($ch) & 31];
            try {
                $db->prepare('INSERT INTO temp_boxes (local_part, token_hash, pow_nonce, created_at, born_at, expires_at) VALUES (:l, :h, :p, :c, :c, :e)')
                   ->execute([':l' => $local, ':h' => hash('sha256', $token), ':p' => $nonce, ':c' => $now, ':e' => $now + TM_TTL]);
                jsonResponse(['success' => true, 'address' => $local . '@' . wmDomain(), 'token' => $token, 'expires_at' => $now + TM_TTL]);
            } catch (PDOException $e) {
                if (!str_contains($e->getMessage(), 'UNIQUE')) throw $e;
                if (str_contains($e->getMessage(), 'pow_nonce')) jsonFail('bad_pow', 'The check was already used, reload the page', 400);   // a replayed answer
            }
        }
        jsonFail('busy', 'Try again', 503);
    }

    // everything below needs the owner's token
    if (!checkRateLimit('tm_use', 120, 60, null, false)) jsonFail('slow_down', 'Too many requests, wait a little', 429);
    $box = tmBoxByToken($db, (string)($_SERVER['HTTP_X_TEMPMAIL_TOKEN'] ?? ''));
    if (!$box) {
        checkRateLimit('tm_bad', 20, 600, null, false);   // guessing tokens is hopeless (192 bits); this only keeps scanners cheap
        jsonFail('gone', 'This address does not exist or has expired', 404);
    }
    $bid = (int)$box['id'];

    if (!$post && $action === 'list') {
        $st = $db->prepare('SELECT id, from_addr, subject, created_at FROM temp_messages WHERE box_id = :b ORDER BY id DESC');
        $st->execute([':b' => $bid]);
        jsonResponse(['success' => true, 'address' => $box['local_part'] . '@' . wmDomain(), 'expires_at' => (int)$box['expires_at'], 'can_extend_until' => (int)$box['born_at'] + TM_MAX_LIFE,
            'messages' => array_map(fn($r) => ['id' => (int)$r['id'], 'from' => $r['from_addr'], 'subject' => $r['subject'], 'created_at' => (int)$r['created_at']], $st->fetchAll())]);
    }
    if (!$post && $action === 'get') {
        $st = $db->prepare('SELECT id, from_addr, subject, body, created_at FROM temp_messages WHERE id = :i AND box_id = :b');
        $st->execute([':i' => (int)($_GET['id'] ?? 0), ':b' => $bid]);
        $m = $st->fetch();
        if (!$m) jsonFail('not_found', 'No such message', 404);
        jsonResponse(['success' => true, 'message' => ['id' => (int)$m['id'], 'from' => $m['from_addr'], 'subject' => $m['subject'], 'body' => $m['body'], 'created_at' => (int)$m['created_at']]]);
    }
    if ($post && $action === 'extend') {
        $new = min(time() + TM_TTL, (int)$box['born_at'] + TM_MAX_LIFE);
        $db->prepare('UPDATE temp_boxes SET expires_at = :e WHERE id = :b')->execute([':e' => $new, ':b' => $bid]);
        jsonResponse(['success' => true, 'expires_at' => $new]);
    }
    if ($post && $action === 'delete') {
        $db->prepare('DELETE FROM temp_messages WHERE box_id = :b')->execute([':b' => $bid]);
        $db->prepare('DELETE FROM temp_boxes WHERE id = :b')->execute([':b' => $bid]);
        jsonResponse(['success' => true]);
    }
    if ($post && $action === 'delete_message') {
        $db->prepare('DELETE FROM temp_messages WHERE id = :i AND box_id = :b')->execute([':i' => (int)($in['id'] ?? 0), ':b' => $bid]);
        jsonResponse(['success' => true]);
    }
    jsonFail('bad_action', 'Unknown action');
} catch (Throwable $e) {
    failInternal('TEMPMAIL', $e);
}
