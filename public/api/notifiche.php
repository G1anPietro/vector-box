<?php
// public/api/notifiche.php
// The user's notifications (bell) and Web Push subscriptions. Logged-in users only.
//
// GET  ?action=list           -> latest notifications + unread count
// GET  ?action=vapid          -> the public key the browser needs to subscribe
// POST {action:"read", ids:[...]} | {action:"read_all"}
//      {action:"subscribe", endpoint, keys:{p256dh, auth}} | {action:"unsubscribe", endpoint}
//      {action:"save_prefs", class_id, prefs:{promemoria, turno, annuncio, slots:[d2,d1,sera]}}; GET ?action=prefs&class_id
//      {action:"test"}         -> sends a test push to my devices
//      {action:"bell_notify", class_id, on} -> push 5 minutes before the end of each lesson: next subject and room
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/rate_limiter.php';
require_once __DIR__ . '/notifiche_lib.php';

initSession();
requireLogin();
header('Cache-Control: no-store');
$me = (int)$_SESSION['user_id'];

function ntFail(string $code, string $msg, int $status = 400): void {
    jsonResponse(['success' => false, 'code' => $code, 'error' => $msg], $status);
}

try {
    $db = getDbConnection();

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $action = (string)($_GET['action'] ?? '');
        if ($action === 'prefs') {
            $st = $db->prepare('SELECT settings, bell_notify FROM class_members WHERE class_id = :c AND user_id = :u');
            $st->execute([':c' => (int)($_GET['class_id'] ?? 0), ':u' => $me]);
            $m = $st->fetch();
            if (!$m) ntFail('not_member', 'You are not in this class', 404);
            jsonResponse(['success' => true, 'prefs' => notifyPrefs((string)$m['settings']), 'bell' => (int)$m['bell_notify'] === 1,
                          'slots' => array_map(fn($k) => ['key' => $k, 'days' => REMINDER_SLOTS[$k][0], 'from' => REMINDER_SLOTS[$k][1]], array_keys(REMINDER_SLOTS))]);
        }
        if ($action === 'list') {
            $st = $db->prepare('SELECT id, class_id, kind, title, body, url, created_at, read_at FROM notifications WHERE user_id = :u ORDER BY id DESC LIMIT 30');
            $st->execute([':u' => $me]);
            $unread = $db->prepare('SELECT COUNT(*) FROM notifications WHERE user_id = :u AND read_at IS NULL');
            $unread->execute([':u' => $me]);
            $subs = $db->prepare('SELECT COUNT(*) FROM push_subscriptions WHERE user_id = :u');
            $subs->execute([':u' => $me]);
            $bells = $db->prepare('SELECT class_id FROM class_members WHERE user_id = :u AND bell_notify = 1');
            $bells->execute([':u' => $me]);
            jsonResponse(['success' => true, 'unread' => (int)$unread->fetchColumn(), 'devices' => (int)$subs->fetchColumn(),
                'bell_classes' => array_map('intval', $bells->fetchAll(PDO::FETCH_COLUMN)),
                'notifications' => array_map(fn($n) => [
                    'id' => (int)$n['id'], 'class_id' => $n['class_id'] !== null ? (int)$n['class_id'] : null, 'kind' => $n['kind'],
                    'title' => $n['title'], 'body' => $n['body'], 'url' => $n['url'],
                    'created_at' => (int)$n['created_at'], 'read' => $n['read_at'] !== null,
                ], $st->fetchAll())]);
        }
        if ($action === 'vapid') {
            jsonResponse(['success' => true, 'public_key' => vapidKeys()['public']]);
        }
        ntFail('unknown_action', 'Unknown action');
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') ntFail('method', 'Method not allowed', 405);
    requireCsrf();
    $in = readJsonBody();
    $action = (string)($in['action'] ?? '');

    if ($action === 'read' || $action === 'read_all') {
        if ($action === 'read_all') {
            $db->prepare('UPDATE notifications SET read_at = :t WHERE user_id = :u AND read_at IS NULL')->execute([':t' => time(), ':u' => $me]);
        } else {
            $upd = $db->prepare('UPDATE notifications SET read_at = :t WHERE id = :id AND user_id = :u AND read_at IS NULL');
            foreach (array_slice((array)($in['ids'] ?? []), 0, 100) as $id) $upd->execute([':t' => time(), ':id' => (int)$id, ':u' => $me]);
        }
        jsonResponse(['success' => true]);
    }

    if ($action === 'subscribe') {
        if (!checkRateLimit('push_subscribe', 20, 3600, 'user:' . $me)) ntFail('slow_down', 'Too many attempts', 429);
        $endpoint = (string)($in['endpoint'] ?? '');
        $p256dh = (string)($in['keys']['p256dh'] ?? '');
        $auth = (string)($in['keys']['auth'] ?? '');
        if (!webpushEndpointAllowed($endpoint)) ntFail('bad_endpoint', 'Unknown push service');
        if (strlen(b64uDecode($p256dh)) !== 65 || strlen(b64uDecode($auth)) !== 16) ntFail('bad_keys', 'Invalid subscription keys');
        // One device = one endpoint; it moves to whoever is logged in on it now
        $db->prepare('INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (:u, :e, :p, :a, :t)
                      ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, failures = 0')
           ->execute([':u' => $me, ':e' => $endpoint, ':p' => $p256dh, ':a' => $auth, ':t' => time()]);
        $st = $db->prepare('SELECT COUNT(*) FROM push_subscriptions WHERE user_id = :u');
        $st->execute([':u' => $me]);
        if ((int)$st->fetchColumn() > 10) {   // keep the 10 newest devices
            $db->prepare('DELETE FROM push_subscriptions WHERE user_id = :u AND id NOT IN (SELECT id FROM push_subscriptions WHERE user_id = :u ORDER BY id DESC LIMIT 10)')
               ->execute([':u' => $me]);
        }
        jsonResponse(['success' => true]);
    }

    if ($action === 'bell_notify') {
        if (!checkRateLimit('bell_notify', 60, 3600, 'user:' . $me)) ntFail('slow_down', 'Too many changes, try later', 429);
        $st = $db->prepare('UPDATE class_members SET bell_notify = :on WHERE class_id = :c AND user_id = :u');
        $st->execute([':on' => empty($in['on']) ? 0 : 1, ':c' => (int)($in['class_id'] ?? 0), ':u' => $me]);
        if ($st->rowCount() === 0) ntFail('not_member', 'You are not in this class', 403);
        jsonResponse(['success' => true]);
    }

    if ($action === 'save_prefs') {
        // My notification choices in one class: kinds on/off and which reminders of a test I want
        if (!checkRateLimit('notify_prefs', 60, 3600, 'user:' . $me)) ntFail('slow_down', 'Too many changes, try later', 429);
        $classId = (int)($in['class_id'] ?? 0);
        $st = $db->prepare('SELECT settings FROM class_members WHERE class_id = :c AND user_id = :u');
        $st->execute([':c' => $classId, ':u' => $me]);
        $cur = $st->fetchColumn();
        if ($cur === false) ntFail('not_member', 'You are not in this class', 404);
        $p = is_array($in['prefs'] ?? null) ? $in['prefs'] : [];
        $settings = json_decode((string)$cur, true);
        if (!is_array($settings)) $settings = [];
        $settings['notify'] = ['promemoria' => !empty($p['promemoria']), 'turno' => !empty($p['turno']), 'annuncio' => !empty($p['annuncio']),
            'slots' => array_values(array_intersect(array_keys(REMINDER_SLOTS), is_array($p['slots'] ?? null) ? $p['slots'] : []))];
        $db->prepare('UPDATE class_members SET settings = :s WHERE class_id = :c AND user_id = :u')
           ->execute([':s' => json_encode($settings), ':c' => $classId, ':u' => $me]);
        jsonResponse(['success' => true, 'prefs' => notifyPrefs(json_encode($settings))]);
    }

    if ($action === 'unsubscribe') {
        $db->prepare('DELETE FROM push_subscriptions WHERE endpoint = :e AND user_id = :u')->execute([':e' => (string)($in['endpoint'] ?? ''), ':u' => $me]);
        jsonResponse(['success' => true]);
    }

    if ($action === 'test') {
        if (!checkRateLimit('push_test', 5, 3600, 'user:' . $me)) ntFail('slow_down', 'Too many tests, try later', 429);
        $n = notifyUsers($db, [$me], null, 'prova', 'Notifiche attive ✓', 'Così ti arriveranno i promemoria delle verifiche.', '/pages/appunti.php');
        jsonResponse(['success' => true, 'delivered' => $n]);
    }

    ntFail('unknown_action', 'Unknown action');
} catch (Throwable $e) {
    failInternal('NOTIFY', $e);
}
