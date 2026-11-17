<?php
// public/api/mail.php — the e-mail box (admin only).
//   GET  ?action=status                     -> driver on/off, daily limit, sent today, pending, how many people can get news
//   GET  ?action=list&folder=draft|sent|queue
//   GET  ?action=get&id=N
//   POST {action:'save_draft', id?, subject, body, audience: optin|supporters}
//   POST {action:'delete', id}
//   POST {action:'send_test', id}           -> to the admin's own (verified) address only
//   POST {action:'send', id}                -> queue one message per person who verified the address AND agreed to news
//   POST {action:'process'}                 -> send what is waiting now (a worker does it every minute when installed)
require_once __DIR__ . '/mailer.php';
require_once __DIR__ . '/rate_limiter.php';

initSession();
requireAdmin();
$db = getDbConnection();
$me = (int)$_SESSION['user_id'];

try {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
        $action = (string)($_GET['action'] ?? 'status');
        if ($action === 'status') {
            jsonResponse(['success' => true, 'driver' => mailDriver(), 'daily_limit' => (int)envValue('MAIL_DAILY_LIMIT', '200'),
                'sent_today' => mailSentToday($db),
                'pending' => (int)$db->query("SELECT COUNT(*) FROM mail_queue WHERE status = 'pending'")->fetchColumn(),
                'failed' => (int)$db->query("SELECT COUNT(*) FROM mail_queue WHERE status = 'failed'")->fetchColumn(),
                'audience' => ['optin' => count(mailAudience($db, 'optin')), 'supporters' => count(mailAudience($db, 'supporters'))]]);
        }
        if ($action === 'list') {
            $folder = (string)($_GET['folder'] ?? 'draft');
            if ($folder === 'queue') {
                $rows = $db->query("SELECT id, message_id, to_email, subject, kind, status, attempts, last_error, created_at, sent_at FROM mail_queue ORDER BY id DESC LIMIT 200")->fetchAll();
            } elseif (in_array($folder, ['draft', 'sent'], true)) {
                $st = $db->prepare('SELECT id, folder, subject, audience, recipients, created_at, sent_at FROM mail_messages WHERE folder = :f ORDER BY id DESC LIMIT 200');
                $st->execute([':f' => $folder]);
                $rows = $st->fetchAll();
            } else jsonFail('bad_folder', 'Unknown folder');
            jsonResponse(['success' => true, 'rows' => $rows]);
        }
        if ($action === 'get') {
            $st = $db->prepare('SELECT * FROM mail_messages WHERE id = :id');
            $st->execute([':id' => (int)($_GET['id'] ?? 0)]);
            $m = $st->fetch();
            if (!$m) jsonFail('not_found', 'Message not found', 404);
            jsonResponse(['success' => true, 'message' => $m]);
        }
        jsonFail('unknown_action', 'Unknown action');
    }

    requireCsrf();
    $in = readJsonBody();
    $action = (string)($in['action'] ?? '');
    if (!checkRateLimit('mail_admin', 120, 3600, 'user:' . $me)) jsonFail('slow_down', 'Too many requests', 429);

    $load = function () use ($db, $in): array {
        $st = $db->prepare('SELECT * FROM mail_messages WHERE id = :id');
        $st->execute([':id' => (int)($in['id'] ?? 0)]);
        $m = $st->fetch();
        if (!$m) jsonFail('not_found', 'Message not found', 404);
        return $m;
    };

    if ($action === 'save_draft') {
        $subject = mailLine((string)($in['subject'] ?? ''), 150);
        $body = textCut(str_replace("\r", '', (string)($in['body'] ?? '')), 20000);
        $audience = in_array($in['audience'] ?? '', ['optin', 'supporters'], true) ? $in['audience'] : 'optin';
        $id = (int)($in['id'] ?? 0);
        if ($id) {
            $m = $load();
            if ($m['folder'] !== 'draft') jsonFail('not_draft', 'A sent message cannot be changed', 409);
            $db->prepare('UPDATE mail_messages SET subject = :s, body = :b, audience = :a WHERE id = :id')->execute([':s' => $subject, ':b' => $body, ':a' => $audience, ':id' => $id]);
        } else {
            $db->prepare('INSERT INTO mail_messages (folder, subject, body, audience, created_by, created_at) VALUES (\'draft\', :s, :b, :a, :u, :t)')
               ->execute([':s' => $subject, ':b' => $body, ':a' => $audience, ':u' => $me, ':t' => time()]);
            $id = (int)$db->lastInsertId();
        }
        jsonResponse(['success' => true, 'id' => $id]);
    }

    if ($action === 'delete') {
        $m = $load();
        $db->prepare('DELETE FROM mail_messages WHERE id = :id AND folder = \'draft\'')->execute([':id' => $m['id']]);
        jsonResponse(['success' => true]);
    }

    if ($action === 'send_test' || $action === 'send') {
        $m = $load();
        if ($m['folder'] !== 'draft') jsonFail('not_draft', 'Already sent', 409);
        if (mailLine($m['subject']) === '' || trim($m['body']) === '') jsonFail('empty', 'Write a subject and a text first');
        if ($action === 'send_test') {
            $st = $db->prepare("SELECT email FROM accounts WHERE id = :id AND email != ''");
            $st->execute([':id' => $me]);
            $to = (string)$st->fetchColumn();
            if ($to === '') jsonFail('no_address', 'Add your own e-mail address in the account settings first');
            mailEnqueue($db, null, $me, $to, '[TEST] ' . $m['subject'], $m['body'] . mailFooter($db, $me), 'test');
            jsonResponse(['success' => true, 'queued' => 1]);
        }
        $people = mailAudience($db, (string)$m['audience']);
        if (!$people) jsonFail('nobody', 'Nobody has verified an address and agreed to news yet');
        $db->exec('BEGIN IMMEDIATE');
        try {
            foreach ($people as $p) mailEnqueue($db, (int)$m['id'], (int)$p['id'], $p['email'], $m['subject'], $m['body'] . mailFooter($db, (int)$p['id']), 'bulk');
            $db->prepare("UPDATE mail_messages SET folder = 'sent', recipients = :n, sent_at = :t WHERE id = :id")->execute([':n' => count($people), ':t' => time(), ':id' => $m['id']]);
            $db->exec('COMMIT');
        } catch (Throwable $e) {
            if ($db->inTransaction()) $db->exec('ROLLBACK');
            throw $e;
        }
        jsonResponse(['success' => true, 'queued' => count($people)]);
    }

    if ($action === 'process') {
        jsonResponse(['success' => true] + mailProcessQueue($db, 20));
    }

    jsonFail('unknown_action', 'Unknown action');
} catch (Throwable $e) {
    failInternal('MAIL', $e);
}
