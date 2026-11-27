<?php
// public/api/mail_inbound.php — where incoming mail for an address on the site domain is handed in (by the Cloudflare Email Worker
// in docs/POSTA.md). Machine to machine: no cookie and no CSRF token; it is protected by the secret MAIL_INBOUND_SECRET in .env
// (Authorization: Bearer <secret>), and it is OFF (503) while the secret is not set.
//   POST {to, from, subject, text}   (also tmp-… addresses of api/tempmail.php) -> 200 stored | 404 no such address | 401 wrong secret | 503 off
require_once __DIR__ . '/webmail.php';
require_once __DIR__ . '/tempmail_lib.php';
require_once __DIR__ . '/mail_files_lib.php';

$secret = (string)envValue('MAIL_INBOUND_SECRET', '');
if ($secret === '') jsonResponse(['success' => false, 'error' => 'OFF'], 503);
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') jsonResponse(['success' => false, 'error' => 'POST only'], 405);
$auth = (string)($_SERVER['HTTP_AUTHORIZATION'] ?? '');
if (!hash_equals('Bearer ' . $secret, $auth)) jsonResponse(['success' => false, 'error' => 'UNAUTHORIZED'], 401);
if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 13000000) jsonResponse(['success' => false, 'error' => 'TOO_BIG'], 413);

try {
    $db = getDbConnection();
    $in = readJsonBody();
    $to = strtolower(trim((string)($in['to'] ?? '')));
    if (tmIsTempAddress($to)) {   // a temporary public box: a full or expired one answers like the others so the Worker never retries
        $r = tmDeliver($db, $to, (string)($in['from'] ?? ''), (string)($in['subject'] ?? ''), (string)($in['text'] ?? ''));
        if ($r === 'none') jsonResponse(['success' => false, 'error' => 'NO_SUCH_ADDRESS'], 404);
        jsonResponse(['success' => true, 'stored' => $r === 'stored']);
    }
    $owner = wmOwnerOf($db, $to);
    if ($owner === null) jsonResponse(['success' => false, 'error' => 'NO_SUCH_ADDRESS'], 404);
    // attachments: {name, type, data (base64)}; what does not fit (size, count, space) is named in the text instead of being lost silently
    $body = (string)($in['text'] ?? ''); $keep = []; $skipped = []; $total = 0; $used = mfUsed($db, $owner);
    foreach (array_slice((array)($in['attachments'] ?? []), 0, 10) as $at) {
        if (!is_array($at)) continue;
        $name = mfName((string)($at['name'] ?? 'file'));
        $bytes = base64_decode((string)($at['data'] ?? ''), true);
        if ($bytes === false) { $skipped[] = "$name (unreadable)"; continue; }
        $n = strlen($bytes);
        if ($n > MF_MAX_FILE || $total + $n > MF_IN_TOTAL) { $skipped[] = "$name (too big)"; continue; }
        if ($used + $n > MF_QUOTA) { $skipped[] = "$name (attachment space full)"; continue; }
        $keep[] = [$name, (string)($at['type'] ?? ''), $bytes]; $total += $n; $used += $n;
    }
    foreach (array_slice((array)($in['skipped'] ?? []), 0, 10) as $s) $skipped[] = mailLine((string)$s, 120);   // named by the Worker (too big to hand in)
    if ($skipped) $body = rtrim($body) . "\n\n[Not saved: " . implode(', ', $skipped) . ']';
    $mid = wmStore($db, $owner, 'inbox', mailLine((string)($in['from'] ?? ''), 254), $to, (string)($in['subject'] ?? ''), $body, 0);
    foreach ($keep as [$name, $type, $bytes]) mfStore($db, $owner, $name, $type, $bytes, $mid);
    jsonResponse(['success' => true]);
} catch (Throwable $e) {
    failInternal('MAIL_INBOUND', $e);
}
