<?php
// public/api/tempmail_lib.php — temporary public mailboxes (no account): shared by api/tempmail.php (the page) and api/mail_inbound.php (delivery).
// A box is an address tmp-xxxxxxxxxx@<domain> that lives TM_TTL seconds (extendable up to TM_MAX_LIFE). Its owner holds a random token,
// kept here only as a SHA-256 hash. Messages are plain text only (the Worker strips HTML) and are never rendered as HTML by the page.
require_once __DIR__ . '/webmail.php';

const TM_PREFIX = 'tmp-';
const TM_TTL = 3600;               // one hour, renewed by "extend"
const TM_MAX_LIFE = 21600;         // never more than six hours from birth
const TM_MAX_MSG = 30;             // per box: the rest is dropped
const TM_MAX_BOXES = 3000;         // active boxes on the whole site
const TM_MAX_MSG_TOTAL = 20000;    // stored messages on the whole site
const TM_POW_ZEROS = 4;            // hex zeros the proof of work needs (~65k hashes, about a second in a browser)

function tmEnabled(): bool { return strtolower(trim((string)envValue('TEMPMAIL', 'true'))) !== 'false'; }
function tmIsTempAddress(string $addr): bool { return str_starts_with(strtolower($addr), TM_PREFIX) && str_ends_with(strtolower($addr), '@' . wmDomain()); }

/** Forget every expired box and its messages. Cheap; called now and then, never required for correctness (readers check expires_at). */
function tmPurge(PDO $db): void {
    $now = time();
    $db->prepare('DELETE FROM temp_messages WHERE box_id IN (SELECT id FROM temp_boxes WHERE expires_at <= :n)')->execute([':n' => $now]);
    $db->prepare('DELETE FROM temp_boxes WHERE expires_at <= :n')->execute([':n' => $now]);
}

function tmBoxByLocal(PDO $db, string $local): ?array {
    $st = $db->prepare('SELECT * FROM temp_boxes WHERE local_part = :l AND expires_at > :n');
    $st->execute([':l' => strtolower($local), ':n' => time()]);
    return $st->fetch() ?: null;
}

function tmBoxByToken(PDO $db, string $token): ?array {
    if (!preg_match('/^[0-9a-f]{48}$/', $token)) return null;
    $st = $db->prepare('SELECT * FROM temp_boxes WHERE token_hash = :h AND expires_at > :n');
    $st->execute([':h' => hash('sha256', $token), ':n' => time()]);
    return $st->fetch() ?: null;
}

/** 'stored' | 'full' (dropped on purpose) | 'none' (no such live box) */
function tmDeliver(PDO $db, string $to, string $from, string $subject, string $body): string {
    $to = strtolower(trim($to));
    if (!tmEnabled() || !tmIsTempAddress($to)) return 'none';
    $box = tmBoxByLocal($db, substr($to, 0, -strlen('@' . wmDomain())));
    if (!$box) return 'none';
    $n = $db->prepare('SELECT COUNT(*) FROM temp_messages WHERE box_id = :b');
    $n->execute([':b' => $box['id']]);
    if ((int)$n->fetchColumn() >= TM_MAX_MSG || (int)$db->query('SELECT COUNT(*) FROM temp_messages')->fetchColumn() >= TM_MAX_MSG_TOTAL) return 'full';
    $clean = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', str_replace("\r", '', $body)) ?? '';
    $db->prepare('INSERT INTO temp_messages (box_id, from_addr, subject, body, created_at) VALUES (:b, :f, :s, :t, :c)')
       ->execute([':b' => $box['id'], ':f' => mailLine($from, 200), ':s' => mailLine($subject, 150), ':t' => textCut($clean, 20000), ':c' => time()]);
    return 'stored';
}

/** Proof of work against bots: a challenge signed by the server (bound to the IP, valid 10 minutes), solved by finding a counter. */
function tmChallenge(PDO $db): string {
    $ts = time(); $rnd = bin2hex(random_bytes(8));
    return $ts . '.' . $rnd . '.' . substr(hash_hmac('sha256', $ts . '.' . $rnd . '.' . getClientIp(), mailSecret($db)), 0, 32);
}

/** The challenge's random part if the answer is valid, else null. */
function tmCheckPow(PDO $db, string $challenge, string $counter): ?string {
    if (!preg_match('/^(\d{10})\.([0-9a-f]{16})\.([0-9a-f]{32})$/', $challenge, $m) || !preg_match('/^\d{1,12}$/', $counter)) return null;
    if ((int)$m[1] > time() || (int)$m[1] < time() - 600) return null;
    $mac = substr(hash_hmac('sha256', $m[1] . '.' . $m[2] . '.' . getClientIp(), mailSecret($db)), 0, 32);
    if (!hash_equals($mac, $m[3])) return null;
    return str_starts_with(hash('sha256', $challenge . ':' . $counter), str_repeat('0', TM_POW_ZEROS)) ? $m[2] : null;
}
