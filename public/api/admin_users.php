<?php
// public/api/admin_users.php — the people of the site, for the admin (admin only, CSRF on every POST).
//   GET  ?action=list&q=&filter=all|admins|banned|email|news|supporters|nobooks&page=1   -> 50 per page + totals
//   GET  ?action=user&id=N                                                                  -> one person in detail
//   POST {action:'set_flag', user_id, flag: can_read_books|can_upload_books|can_view_resume|ads_free, value}
//   POST {action:'ban'|'unban'|'timeout', user_id, minutes?}                                (never on an admin)
//   POST {action:'badge', user_id, value}                                                    (the supporter badge by hand)
//   POST {action:'send_mail', user_id, subject, body}                                        (one message, only to a CONFIRMED address)
require_once __DIR__ . '/mailer.php';
require_once __DIR__ . '/rate_limiter.php';

initSession();
requireAdmin();
$db = getDbConnection();
$me = (int)$_SESSION['user_id'];

function auFail(string $code, string $msg, int $status = 400): void {
    jsonResponse(['success' => false, 'code' => $code, 'error' => $msg], $status);
}

const AU_FLAGS = ['can_read_books', 'can_upload_books', 'can_view_resume', 'ads_free'];

/** One account row as the panel shows it. */
function auRow(PDO $db, array $a): array {
    return [
        'id' => (int)$a['id'], 'username' => $a['username'], 'is_admin' => (int)$a['is_admin'], 'created_at' => $a['created_at'],
        'can_read_books' => (int)$a['can_read_books'], 'can_upload_books' => (int)$a['can_upload_books'],
        'can_view_resume' => (int)($a['can_view_resume'] ?? 0), 'ads_free' => (int)$a['ads_free'],
        'is_banned' => (int)$a['is_banned'], 'banned_until' => $a['banned_until'],
        'timed_out' => !empty($a['banned_until']) && strtotime((string)$a['banned_until']) > time(),   // judged here, in the server's own time zone
        'supporter' => accountIsSupporter($db, (int)$a['id']),
        'email' => (string)$a['email'], 'email_verified' => (int)$a['email_verified'], 'email_optin' => (int)$a['email_optin'],
    ];
}

function auTarget(PDO $db, int $id): array {
    $st = $db->prepare('SELECT * FROM accounts WHERE id = :id');
    $st->execute([':id' => $id]);
    $a = $st->fetch();
    $st->closeCursor();
    if (!$a) auFail('not_found', 'No such user', 404);
    return $a;
}

try {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
        $action = (string)($_GET['action'] ?? 'list');
        if ($action === 'list') {
            $q = trim((string)($_GET['q'] ?? ''));
            $filter = (string)($_GET['filter'] ?? 'all');
            $where = ['1 = 1']; $p = [];
            if ($q !== '') {
                $where[] = "(username LIKE :q ESCAPE '\\' OR email LIKE :q ESCAPE '\\')";
                $p[':q'] = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q) . '%';
            }
            $where[] = match ($filter) {
                'admins' => 'is_admin = 1',
                'banned' => '(is_banned = 1 OR (banned_until IS NOT NULL AND banned_until > :now))',
                'email' => "email != ''",
                'news' => 'email_verified = 1 AND email_optin = 1',
                'nobooks' => 'can_read_books = 0',
                'supporters' => "id IN (SELECT account_id FROM donors WHERE account_id IS NOT NULL)",
                default => '1 = 1',
            };
            if ($filter === 'banned') $p[':now'] = date('Y-m-d H:i:s');   // same clock as the one that wrote banned_until
            $page = max(1, (int)($_GET['page'] ?? 1));
            $cnt = $db->prepare('SELECT COUNT(*) FROM accounts WHERE ' . implode(' AND ', $where));
            $cnt->execute($p);
            $total = (int)$cnt->fetchColumn();
            $st = $db->prepare('SELECT * FROM accounts WHERE ' . implode(' AND ', $where) . ' ORDER BY id DESC LIMIT 50 OFFSET :o');
            foreach ($p as $k => $v) $st->bindValue($k, $v);
            $st->bindValue(':o', ($page - 1) * 50, PDO::PARAM_INT);
            $st->execute();
            $rows = array_map(fn($a) => auRow($db, $a), $st->fetchAll());
            $one = fn(string $sql) => (int)$db->query($sql)->fetchColumn();
            jsonResponse(['success' => true, 'users' => $rows, 'total' => $total, 'page' => $page, 'pages' => max(1, (int)ceil($total / 50)),
                'totals' => ['all' => $one('SELECT COUNT(*) FROM accounts'), 'admins' => $one('SELECT COUNT(*) FROM accounts WHERE is_admin = 1'),
                    'banned' => $one("SELECT COUNT(*) FROM accounts WHERE is_banned = 1"), 'with_email' => $one("SELECT COUNT(*) FROM accounts WHERE email != ''"),
                    'news' => $one('SELECT COUNT(*) FROM accounts WHERE email_verified = 1 AND email_optin = 1'),
                    'new_7d' => $one("SELECT COUNT(*) FROM accounts WHERE created_at >= datetime('now', '-7 days')")]]);
        }
        if ($action === 'user') {
            $a = auTarget($db, (int)($_GET['id'] ?? 0));
            $n = fn(string $sql) => (function () use ($db, $sql, $a) { $s = $db->prepare($sql); $s->execute([':i' => $a['id']]); return (int)$s->fetchColumn(); })();
            $mail = $db->prepare('SELECT id, subject, kind, status, created_at, sent_at, last_error FROM mail_queue WHERE account_id = :i ORDER BY id DESC LIMIT 10');
            $mail->execute([':i' => $a['id']]);
            jsonResponse(['success' => true, 'user' => auRow($db, $a) + ['bio' => (string)($a['bio'] ?? ''), 'email_optin_at' => $a['email_optin_at']],
                'counts' => ['messages' => $n('SELECT COUNT(*) FROM transmissions WHERE user_id = :i'),
                             'classes' => $n('SELECT COUNT(*) FROM class_members WHERE user_id = :i'),
                             'notes' => $n('SELECT COUNT(*) FROM class_items WHERE author_id = :i')],
                'mail' => $mail->fetchAll()]);
        }
        auFail('unknown_action', 'Unknown action');
    }

    requireCsrf();
    $in = readJsonBody();
    $action = (string)($in['action'] ?? '');
    if (!checkRateLimit('admin_users', 300, 3600, 'user:' . $me)) auFail('slow_down', 'Too many requests', 429);
    $a = auTarget($db, (int)($in['user_id'] ?? 0));
    $id = (int)$a['id'];

    if ($action === 'set_flag') {
        $flag = (string)($in['flag'] ?? '');
        if (!in_array($flag, AU_FLAGS, true)) auFail('bad_flag', 'Unknown setting');
        $db->prepare("UPDATE accounts SET $flag = :v WHERE id = :id")->execute([':v' => empty($in['value']) ? 0 : 1, ':id' => $id]);
        jsonResponse(['success' => true]);
    }

    if (in_array($action, ['ban', 'timeout', 'unban'], true)) {
        if ((int)$a['is_admin'] === 1 && $action !== 'unban') auFail('is_admin', 'An admin cannot be banned');
        if ($action === 'ban') $db->prepare('UPDATE accounts SET is_banned = 1, banned_until = NULL WHERE id = :id')->execute([':id' => $id]);
        elseif ($action === 'timeout') {
            $mins = max(1, min((int)($in['minutes'] ?? 10), 525600));
            $db->prepare('UPDATE accounts SET banned_until = :u WHERE id = :id')->execute([':u' => date('Y-m-d H:i:s', time() + $mins * 60), ':id' => $id]);
        } else $db->prepare('UPDATE accounts SET is_banned = 0, banned_until = NULL WHERE id = :id')->execute([':id' => $id]);
        jsonResponse(['success' => true]);
    }

    if ($action === 'badge') {
        $has = $db->prepare("SELECT 1 FROM donors WHERE account_id = :a AND note = 'badge'");
        $has->execute([':a' => $id]);
        $has = (bool)$has->fetchColumn();
        if (!empty($in['value']) && !$has) {
            $db->prepare("INSERT INTO donors (account_id, display_name, amount_cents, currency, donated_at, is_public, note, created_at) VALUES (:a, '', 0, 'EUR', :d, 0, 'badge', :t)")
               ->execute([':a' => $id, ':d' => date('Y-m-d'), ':t' => time()]);
        } elseif (empty($in['value'])) {
            $db->prepare("DELETE FROM donors WHERE account_id = :a AND note = 'badge'")->execute([':a' => $id]);
        }
        jsonResponse(['success' => true]);
    }

    if ($action === 'send_mail') {
        // One direct message from the admin. Only to an address the person confirmed (a link they clicked): never to a guess.
        if ((string)$a['email'] === '' || !(int)$a['email_verified']) auFail('no_verified_address', 'This person has no confirmed e-mail address');
        $subject = mailLine((string)($in['subject'] ?? ''), 150);
        $body = textCut(str_replace("\r", '', trim((string)($in['body'] ?? ''))), 5000);
        if ($subject === '' || $body === '') auFail('empty', 'Write a subject and a text');
        if (!checkRateLimit('admin_direct_mail', 30, 3600, 'user:' . $me)) auFail('slow_down', 'Too many messages, try later', 429);
        $text = "Hello {$a['username']},\n\n$body\n\n--\nThis message is from the person who runs vector-box (" . siteUrl() . "), written to you about your account.\nTo stop all e-mail, remove the address in your account settings.\n";
        $qid = mailEnqueue($db, null, $id, (string)$a['email'], $subject, $text, 'direct');
        $r = mailProcessQueue($db, 1, [$qid]);
        jsonResponse(['success' => true, 'queued' => true, 'sent_now' => $r['sent'] === 1, 'driver_off' => $r['off']]);
    }

    auFail('unknown_action', 'Unknown action');
} catch (Throwable $e) {
    failInternal('ADMIN_USERS', $e);
}
