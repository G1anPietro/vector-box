<?php
// public/api/webmail.php — personal mailboxes (accounts with the mail permission; the admin makes the addresses).
//   GET  ?action=boot                       -> my addresses, folder counts, domain, is_admin
//   GET  ?action=list&folder=inbox|starred|sent|draft|trash[&q=text]
//   GET  ?action=get&id=N                   -> the message (an inbox message becomes read)
//   POST {action:'send', from_id, to, subject, body[, draft_id]}   -> local addresses get it at once; other addresses (admin only) go out through the mail queue
//   POST {action:'save_draft', id?, from_id, to, subject, body}
//   POST {action:'star'|'read', ids:[…], value:0|1}   {action:'trash'|'restore'|'delete', ids:[…]}   {action:'empty_trash'}
//   admin: GET ?action=addresses  POST {action:'create_address', local, username}  {action:'delete_address', id}
require_once __DIR__ . '/mailer.php';
require_once __DIR__ . '/rate_limiter.php';

const WM_FOLDERS = ['inbox', 'sent', 'draft', 'trash'];

function wmDomain(): string { return strtolower(trim((string)envValue('MAIL_DOMAIN', 'talvera.site'))); }

/** The addresses of one account, as full addresses. */
function wmMyAddresses(PDO $db, int $me): array {
    $st = $db->prepare('SELECT id, local_part FROM mail_addresses WHERE account_id = :a ORDER BY id');
    $st->execute([':a' => $me]);
    return array_map(fn($r) => ['id' => (int)$r['id'], 'address' => strtolower($r['local_part']) . '@' . wmDomain()], $st->fetchAll());
}

/** The account owning a full address on the site domain, or null. */
function wmOwnerOf(PDO $db, string $addr): ?int {
    $addr = strtolower(trim($addr));
    $suffix = '@' . wmDomain();
    if (!str_ends_with($addr, $suffix)) return null;
    $st = $db->prepare('SELECT account_id FROM mail_addresses WHERE local_part = :l');
    $st->execute([':l' => substr($addr, 0, -strlen($suffix))]);
    $id = $st->fetchColumn();
    return $id === false ? null : (int)$id;
}

/** Puts one message in an account's mailbox. */
function wmStore(PDO $db, int $account, string $folder, string $from, string $to, string $subject, string $body, int $read): int {
    $db->prepare('INSERT INTO mail_inbox (account_id, folder, from_addr, to_addr, subject, body, is_read, created_at) VALUES (:a, :f, :fr, :t, :s, :b, :r, :c)')
       ->execute([':a' => $account, ':f' => $folder, ':fr' => $from, ':t' => $to, ':s' => mailLine($subject, 150), ':b' => textCut(str_replace("\r", '', $body), 50000), ':r' => $read, ':c' => time()]);
    return (int)$db->lastInsertId();
}

if (basename($_SERVER['SCRIPT_NAME'] ?? '') !== 'webmail.php') return;   // included by the tests/inbound endpoint: only the helpers

initSession();
$db = getDbConnection();
$me = (int)($_SESSION['user_id'] ?? 0);
$isAdmin = sessionIsAdmin();
if (!userCanUseMail($db, $me, $isAdmin)) jsonResponse(['success' => false, 'error' => 'UNAUTHORIZED: no access to the mail'], 403);

$ids = function (array $in): array { return array_slice(array_values(array_unique(array_filter(array_map('intval', (array)($in['ids'] ?? [])), fn($i) => $i > 0))), 0, 200); };
$ph = fn(array $a) => implode(',', array_fill(0, count($a), '?'));

try {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
        $action = (string)($_GET['action'] ?? 'boot');
        if ($action === 'boot') {
            $c = $db->prepare("SELECT folder, COUNT(*) AS n, SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) AS unread FROM mail_inbox WHERE account_id = :a GROUP BY folder");
            $c->execute([':a' => $me]);
            $counts = ['inbox' => 0, 'inbox_unread' => 0, 'draft' => 0];
            foreach ($c->fetchAll() as $r) {
                if ($r['folder'] === 'inbox') { $counts['inbox'] = (int)$r['n']; $counts['inbox_unread'] = (int)$r['unread']; }
                if ($r['folder'] === 'draft') $counts['draft'] = (int)$r['n'];
            }
            jsonResponse(['success' => true, 'addresses' => wmMyAddresses($db, $me), 'counts' => $counts, 'domain' => wmDomain(), 'is_admin' => $isAdmin, 'username' => (string)($_SESSION['username'] ?? ''),
                'driver' => mailDriver()]);
        }
        if ($action === 'list') {
            $folder = (string)($_GET['folder'] ?? 'inbox');
            $q = trim((string)($_GET['q'] ?? ''));
            if ($folder === 'system' && $isAdmin) {   // admin: what the site itself sent (verification, newsletter, tests, people's outgoing mail)
                $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], textCut($q, 80)) . '%';
                $st = $db->prepare("SELECT id, kind, status, to_email, subject, substr(replace(body, char(10), ' '), 1, 110) AS snippet, created_at FROM mail_queue WHERE (subject LIKE :q ESCAPE '\\' OR to_email LIKE :q ESCAPE '\\') ORDER BY id DESC LIMIT 100");
                $st->execute([':q' => $like]);
                jsonResponse(['success' => true, 'rows' => array_map(fn($r) => ['id' => (int)$r['id'], 'folder' => 'sys', 'from_addr' => $r['kind'] . ' · ' . $r['status'], 'to_addr' => $r['to_email'], 'subject' => $r['subject'], 'snippet' => $r['snippet'], 'is_read' => 1, 'is_starred' => 0, 'created_at' => (int)$r['created_at']], $st->fetchAll())]);
            }
            $where = 'account_id = ?'; $args = [$me];
            if ($folder === 'starred') $where .= " AND is_starred = 1 AND folder != 'trash'";
            elseif (in_array($folder, WM_FOLDERS, true)) { $where .= ' AND folder = ?'; $args[] = $folder; }
            else jsonFail('bad_folder', 'Unknown folder');
            if ($q !== '') {
                $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], textCut($q, 80)) . '%';
                $where .= " AND (subject LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR from_addr LIKE ? ESCAPE '\\' OR to_addr LIKE ? ESCAPE '\\')";
                array_push($args, $like, $like, $like, $like);
            }
            $addr = $isAdmin ? strtolower(trim((string)($_GET['addr'] ?? ''))) : '';   // admin: look at one of my addresses only
            if ($addr !== '' && in_array($addr, array_column(wmMyAddresses($db, $me), 'address'), true)) {
                $a = '%' . $addr . '%';   // addresses hold only letters, digits and . _ - @ : no LIKE wildcards but _ , harmless here
                $where .= " AND (lower(from_addr) LIKE ? OR lower(to_addr) LIKE ?)"; array_push($args, $a, $a);
            }
            $st = $db->prepare("SELECT id, folder, from_addr, to_addr, subject, substr(replace(body, char(10), ' '), 1, 110) AS snippet, is_read, is_starred, created_at FROM mail_inbox WHERE $where ORDER BY id DESC LIMIT 100");
            $st->execute($args);
            jsonResponse(['success' => true, 'rows' => $st->fetchAll()]);
        }
        if ($action === 'get' && $isAdmin && ($_GET['sys'] ?? '') === '1') {
            $st = $db->prepare('SELECT kind, status, last_error, to_email, from_email, subject, body, created_at FROM mail_queue WHERE id = :id');
            $st->execute([':id' => (int)($_GET['id'] ?? 0)]);
            $m = $st->fetch();
            if (!$m) jsonFail('not_found', 'Message not found', 404);
            jsonResponse(['success' => true, 'message' => ['id' => (int)($_GET['id'] ?? 0), 'folder' => 'sys', 'from_addr' => ($m['from_email'] ?: (string)envValue('MAIL_FROM', 'no-reply')) . ' (' . $m['kind'] . ' · ' . $m['status'] . ($m['last_error'] !== '' ? ': ' . $m['last_error'] : '') . ')', 'to_addr' => $m['to_email'], 'subject' => $m['subject'], 'body' => $m['body'], 'is_read' => 1, 'created_at' => (int)$m['created_at']]]);
        }
        if ($action === 'get') {
            $st = $db->prepare('SELECT * FROM mail_inbox WHERE id = :id AND account_id = :a');
            $st->execute([':id' => (int)($_GET['id'] ?? 0), ':a' => $me]);
            $m = $st->fetch();
            if (!$m) jsonFail('not_found', 'Message not found', 404);
            if ((int)$m['is_read'] === 0 && $m['folder'] !== 'draft') {
                $db->prepare('UPDATE mail_inbox SET is_read = 1 WHERE id = :id')->execute([':id' => $m['id']]);
                $m['is_read'] = 1;
            }
            jsonResponse(['success' => true, 'message' => $m]);
        }
        if ($action === 'addresses' && $isAdmin) {
            $rows = $db->query('SELECT a.id, a.local_part, a.created_at, c.username FROM mail_addresses a LEFT JOIN accounts c ON c.id = a.account_id ORDER BY a.id')->fetchAll();
            jsonResponse(['success' => true, 'domain' => wmDomain(), 'rows' => array_map(fn($r) => ['id' => (int)$r['id'], 'address' => strtolower($r['local_part']) . '@' . wmDomain(), 'username' => $r['username'], 'created_at' => (int)$r['created_at']], $rows)]);
        }
        jsonFail('unknown_action', 'Unknown action');
    }

    requireCsrf();
    $in = readJsonBody();
    $action = (string)($in['action'] ?? '');
    if (!checkRateLimit('webmail', 300, 3600, 'user:' . $me)) jsonFail('slow_down', 'Too many requests', 429);

    // ---- admin: addresses
    if ($action === 'create_address' || $action === 'delete_address') {
        if (!$isAdmin) jsonResponse(['success' => false, 'error' => 'UNAUTHORIZED: Admin privileges required'], 403);
        if ($action === 'delete_address') {
            $db->prepare('DELETE FROM mail_addresses WHERE id = :id')->execute([':id' => (int)($in['id'] ?? 0)]);   // the messages stay in the mailbox
            jsonResponse(['success' => true]);
        }
        $local = strtolower(trim((string)($in['local'] ?? '')));
        if (!preg_match('/^[a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])?$/', $local) || str_contains($local, '..') || str_starts_with($local, 'tmp-')) jsonFail('bad_local', 'Use letters, numbers, dots, dashes and underscores (1-32 characters); tmp- is reserved');
        $st = $db->prepare('SELECT id FROM accounts WHERE username = :u COLLATE NOCASE');
        $st->execute([':u' => trim((string)($in['username'] ?? ''))]);
        $acc = $st->fetchColumn();
        if (!$acc) jsonFail('no_user', 'No account with that name', 404);
        try {
            $db->prepare('INSERT INTO mail_addresses (local_part, account_id, created_at) VALUES (:l, :a, :t)')->execute([':l' => $local, ':a' => (int)$acc, ':t' => time()]);
        } catch (PDOException $e) {
            if (str_contains($e->getMessage(), 'UNIQUE')) jsonFail('taken', 'That address already exists', 409);
            throw $e;
        }
        // the owner needs the permission to open the box: an address without it would be useless
        $db->prepare('UPDATE accounts SET can_use_mail = 1 WHERE id = :a')->execute([':a' => (int)$acc]);
        jsonResponse(['success' => true, 'address' => $local . '@' . wmDomain()]);
    }

    // ---- flags, trash
    if (in_array($action, ['star', 'read', 'trash', 'restore', 'delete'], true)) {
        $list = $ids($in);
        if (!$list) jsonResponse(['success' => true, 'changed' => 0]);
        $mark = $ph($list);
        $value = !empty($in['value']) ? 1 : 0;
        if ($action === 'star') $st = $db->prepare("UPDATE mail_inbox SET is_starred = $value WHERE account_id = ? AND id IN ($mark)");
        elseif ($action === 'read') $st = $db->prepare("UPDATE mail_inbox SET is_read = $value WHERE account_id = ? AND folder != 'draft' AND id IN ($mark)");
        elseif ($action === 'trash') $st = $db->prepare("UPDATE mail_inbox SET prev_folder = folder, folder = 'trash' WHERE account_id = ? AND folder != 'trash' AND id IN ($mark)");
        elseif ($action === 'restore') $st = $db->prepare("UPDATE mail_inbox SET folder = CASE WHEN prev_folder = '' THEN 'inbox' ELSE prev_folder END, prev_folder = '' WHERE account_id = ? AND folder = 'trash' AND id IN ($mark)");
        else $st = $db->prepare("DELETE FROM mail_inbox WHERE account_id = ? AND folder = 'trash' AND id IN ($mark)");
        $st->execute(array_merge([$me], $list));
        jsonResponse(['success' => true, 'changed' => $st->rowCount()]);
    }
    if ($action === 'empty_trash') {
        $st = $db->prepare("DELETE FROM mail_inbox WHERE account_id = :a AND folder = 'trash'");
        $st->execute([':a' => $me]);
        jsonResponse(['success' => true, 'changed' => $st->rowCount()]);
    }

    // ---- writing
    if ($action === 'save_draft' || $action === 'send') {
        $mine = wmMyAddresses($db, $me);
        $from = null;
        foreach ($mine as $a) if ($a['id'] === (int)($in['from_id'] ?? 0)) $from = $a['address'];
        if ($from === null) jsonFail('no_address', 'You have no address to write from: ask the admin to create one for you');
        $subject = mailLine((string)($in['subject'] ?? ''), 150);
        $body = textCut(str_replace("\r", '', (string)($in['body'] ?? '')), 20000);
        $toRaw = textCut((string)($in['to'] ?? ''), 600);
        $draftId = (int)($in[$action === 'send' ? 'draft_id' : 'id'] ?? 0);

        if ($action === 'save_draft') {
            if ($draftId) {
                $st = $db->prepare("UPDATE mail_inbox SET from_addr = :f, to_addr = :t, subject = :s, body = :b WHERE id = :id AND account_id = :a AND folder = 'draft'");
                $st->execute([':f' => $from, ':t' => mailLine($toRaw, 600), ':s' => $subject, ':b' => $body, ':id' => $draftId, ':a' => $me]);
                if ($st->rowCount() === 1) jsonResponse(['success' => true, 'id' => $draftId]);
            }
            jsonResponse(['success' => true, 'id' => wmStore($db, $me, 'draft', $from, mailLine($toRaw, 600), $subject, $body, 1)]);
        }

        $to = array_values(array_unique(array_filter(array_map('trim', preg_split('/[,;]+/', $toRaw) ?: []), fn($x) => $x !== '')));
        if (!$to) jsonFail('no_recipient', 'Write who it is for');
        if (count($to) > 5) jsonFail('too_many', 'At most 5 recipients');
        foreach ($to as $addr) if (!mailValidAddress($addr)) jsonFail('bad_address', "That does not look like an address: " . mailLine($addr, 60));
        if ($subject === '' && trim($body) === '') jsonFail('empty', 'Write a subject or a text first');
        $external = array_values(array_filter($to, fn($a) => wmOwnerOf($db, $a) === null));
        if ($external && !$isAdmin) jsonFail('admin_only', 'Only the admin can write to addresses outside the site', 403);
        if ($external) {
            if (!checkRateLimit('webmail_out', 40, 86400, 'user:' . $me)) jsonFail('daily_limit', 'You reached today\'s limit of messages to other addresses', 429);
            if (!mailEnabled()) jsonFail('mail_off', 'Sending to other addresses is not switched on yet', 503);
        }
        $db->exec('BEGIN IMMEDIATE');
        $queued = [];
        try {
            foreach ($to as $addr) {
                $owner = wmOwnerOf($db, $addr);
                if ($owner !== null) wmStore($db, $owner, 'inbox', $from, $addr, $subject, $body, 0);
                else $queued[] = mailEnqueue($db, null, $me, $addr, $subject, $body, 'user', $from);
            }
            wmStore($db, $me, 'sent', $from, implode(', ', $to), $subject, $body, 1);
            if ($draftId) $db->prepare("DELETE FROM mail_inbox WHERE id = :id AND account_id = :a AND folder = 'draft'")->execute([':id' => $draftId, ':a' => $me]);
            $db->exec('COMMIT');
        } catch (Throwable $e) {
            if ($db->inTransaction()) $db->exec('ROLLBACK');
            throw $e;
        }
        $res = $queued ? mailProcessQueue($db, 5, $queued) : ['sent' => 0, 'left' => 0];
        jsonResponse(['success' => true, 'delivered_here' => count($to) - count($queued), 'external' => count($queued), 'sent_now' => $res['sent']]);
    }

    jsonFail('unknown_action', 'Unknown action');
} catch (Throwable $e) {
    failInternal('WEBMAIL', $e);
}
