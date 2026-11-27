<?php
// public/api/mail_files_lib.php — attachments of the personal mail. The bytes live in data/mail_files/ (outside the web root, random
// names), the rows in mail_files. A row belongs to ONE message (message_id = mail_inbox.id) or to one outgoing queue row (queue_id), or is
// "pending" (both NULL: uploaded, not sent yet). Every row owns its own disk file, so deleting a row deletes its file, nothing is shared.
require_once __DIR__ . '/database.php';

const MF_MAX_FILE = 10 * 1024 * 1024;      // one file
const MF_MAX_FILES = 5;                    // per message written here
const MF_MAX_TOTAL = 20 * 1024 * 1024;     // per message written here
const MF_IN_TOTAL = 8 * 1024 * 1024;       // per message received (what the Worker may hand in)
const MF_QUOTA = 300 * 1024 * 1024;        // per account

function mfDir(): string {
    $d = dirname(__DIR__, 2) . '/data/mail_files';
    if (!is_dir($d)) @mkdir($d, 0750, true);
    return $d;
}

/** A safe display name: no path, no control characters, at most 120 characters. */
function mfName(string $n): string {
    $n = preg_replace('/[\x00-\x1F\x7F\\\\\/]+/', ' ', $n) ?? '';
    $n = trim(textCut(trim($n), 120), " .");
    return $n === '' ? 'file' : $n;
}

function mfMime(string $m): string { return preg_match('#^[a-z0-9][a-z0-9.+-]{0,60}/[a-z0-9][a-z0-9.+-]{0,60}$#i', $m) ? strtolower($m) : 'application/octet-stream'; }

function mfUsed(PDO $db, int $account): int {
    $st = $db->prepare('SELECT COALESCE(SUM(size), 0) FROM mail_files WHERE account_id = :a');
    $st->execute([':a' => $account]);
    return (int)$st->fetchColumn();
}

/** Writes the bytes and the row; returns the row id. */
function mfStore(PDO $db, int $account, string $name, string $mime, string $bytes, ?int $messageId = null, ?int $queueId = null): int {
    $stored = bin2hex(random_bytes(16));
    if (file_put_contents(mfDir() . '/' . $stored, $bytes, LOCK_EX) === false) throw new RuntimeException('cannot write the attachment');
    $db->prepare('INSERT INTO mail_files (account_id, message_id, queue_id, name, mime, size, stored, created_at) VALUES (:a, :m, :q, :n, :t, :s, :f, :c)')
       ->execute([':a' => $account, ':m' => $messageId, ':q' => $queueId, ':n' => mfName($name), ':t' => mfMime($mime), ':s' => strlen($bytes), ':f' => $stored, ':c' => time()]);
    return (int)$db->lastInsertId();
}

function mfPath(array $row): string { return mfDir() . '/' . basename((string)$row['stored']); }

/** A new row with its own copy of the bytes, for another account, message or queue row. */
function mfClone(PDO $db, array $row, int $account, ?int $messageId, ?int $queueId): int {
    $bytes = @file_get_contents(mfPath($row));
    if ($bytes === false) throw new RuntimeException('attachment missing on disk');
    return mfStore($db, $account, (string)$row['name'], (string)$row['mime'], $bytes, $messageId, $queueId);
}

/** Deletes rows matching a WHERE clause (and their files). */
function mfDrop(PDO $db, string $where, array $args): void {
    $st = $db->prepare("SELECT id, stored FROM mail_files WHERE $where");
    $st->execute($args);
    $rows = $st->fetchAll();
    if (!$rows) return;
    foreach ($rows as $r) {
        $db->prepare('DELETE FROM mail_files WHERE id = :i')->execute([':i' => $r['id']]);
        @unlink(mfDir() . '/' . basename((string)$r['stored']));
    }
}

/** Files of messages that no longer exist (deleted from the trash). */
function mfSweep(PDO $db, int $account): void {
    mfDrop($db, 'account_id = ? AND message_id IS NOT NULL AND message_id NOT IN (SELECT id FROM mail_inbox)', [$account]);
}

/** Uploaded but never sent, older than a day. */
function mfSweepPending(PDO $db): void {
    mfDrop($db, 'message_id IS NULL AND queue_id IS NULL AND created_at < ?', [time() - 86400]);
}
