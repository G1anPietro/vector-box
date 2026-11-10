<?php
// public/api/dm.php
// Private messages between registered users (guests cannot use them).
// Every query is scoped to the logged-in user: there is deliberately no admin path to read
// other people's conversations, and message bodies are never written to logs.
//
// GET  ?action=conversations              -> my conversations (last message, unread count)
// GET  ?action=thread&with=ID[&before=ID] -> messages with one user (newest 50), marks them read
// GET  ?action=since&after=ID             -> my messages newer than ID (live polling)
// GET  ?action=users&q=TEXT               -> registered users whose name starts with TEXT
// GET  ?action=blocks                     -> users I blocked
// POST {action:"send", to, body} | {action:"block"|"unblock", user_id}
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/rate_limiter.php';

const DM_MAX_LENGTH = 1000;
const DM_PAGE = 50;

initSession();
requireLogin();
header('Cache-Control: no-store');

$me = (int)$_SESSION['user_id'];

function dmFail(string $code, string $message, int $status): void {
    jsonResponse(['success' => false, 'code' => $code, 'error' => $message], $status);
}

function dmUser(PDO $db, int $id): ?array {
    $st = $db->prepare('SELECT id, username FROM accounts WHERE id = :id');
    $st->execute([':id' => $id]);
    return $st->fetch() ?: null;
}

/** True when either user blocked the other. */
function dmBlocked(PDO $db, int $a, int $b): bool {
    $st = $db->prepare('SELECT 1 FROM dm_blocks WHERE (blocker_id = :a AND blocked_id = :b) OR (blocker_id = :b AND blocked_id = :a)');
    $st->execute([':a' => $a, ':b' => $b]);
    return (bool)$st->fetchColumn();
}

function dmFormat(array $m, int $me): array {
    return [
        'id' => (int)$m['id'],
        'from' => (int)$m['sender_id'],
        'to' => (int)$m['recipient_id'],
        'mine' => (int)$m['sender_id'] === $me,
        'body' => $m['body'],
        'created_at' => $m['created_at'],
        'read' => $m['read_at'] !== null,
    ];
}

try {
    $db = getDbConnection();

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $action = (string)($_GET['action'] ?? '');

        if ($action === 'conversations') {
            $st = $db->prepare('SELECT partner, MAX(id) AS last_id FROM (
                                    SELECT recipient_id AS partner, id FROM dm_messages WHERE sender_id = :me
                                    UNION ALL
                                    SELECT sender_id AS partner, id FROM dm_messages WHERE recipient_id = :me
                                ) GROUP BY partner ORDER BY last_id DESC LIMIT 100');
            $st->execute([':me' => $me]);
            $rows = $st->fetchAll();

            $msg = $db->prepare('SELECT * FROM dm_messages WHERE id = :id');
            $unread = $db->prepare('SELECT COUNT(*) FROM dm_messages WHERE recipient_id = :me AND sender_id = :p AND read_at IS NULL');
            $blocked = $db->prepare('SELECT 1 FROM dm_blocks WHERE blocker_id = :me AND blocked_id = :p');
            $out = [];
            foreach ($rows as $r) {
                $partner = dmUser($db, (int)$r['partner']);
                if (!$partner) continue;
                $msg->execute([':id' => $r['last_id']]);
                $unread->execute([':me' => $me, ':p' => $partner['id']]);
                $blocked->execute([':me' => $me, ':p' => $partner['id']]);
                $out[] = [
                    'user' => ['id' => (int)$partner['id'], 'username' => $partner['username']],
                    'last' => dmFormat($msg->fetch(), $me),
                    'unread' => (int)$unread->fetchColumn(),
                    'blocked' => (bool)$blocked->fetchColumn(),
                ];
            }
            jsonResponse(['success' => true, 'me' => $me, 'conversations' => $out]);
        }

        if ($action === 'thread') {
            $other = dmUser($db, (int)($_GET['with'] ?? 0));
            if (!$other || (int)$other['id'] === $me) dmFail('not_found', 'User not found', 404);
            $before = (int)($_GET['before'] ?? 0);
            $st = $db->prepare('SELECT * FROM dm_messages
                                WHERE ((sender_id = :me AND recipient_id = :o) OR (sender_id = :o AND recipient_id = :me))
                                  AND (:before = 0 OR id < :before)
                                ORDER BY id DESC LIMIT ' . DM_PAGE);
            $st->bindValue(':me', $me, PDO::PARAM_INT);
            $st->bindValue(':o', (int)$other['id'], PDO::PARAM_INT);
            $st->bindValue(':before', $before, PDO::PARAM_INT);
            $st->execute();
            $messages = array_reverse(array_map(fn($m) => dmFormat($m, $me), $st->fetchAll()));

            $db->prepare('UPDATE dm_messages SET read_at = CURRENT_TIMESTAMP WHERE recipient_id = :me AND sender_id = :o AND read_at IS NULL')
               ->execute([':me' => $me, ':o' => $other['id']]);

            $iBlocked = $db->prepare('SELECT 1 FROM dm_blocks WHERE blocker_id = :me AND blocked_id = :o');
            $iBlocked->execute([':me' => $me, ':o' => $other['id']]);
            jsonResponse([
                'success' => true,
                'user' => ['id' => (int)$other['id'], 'username' => $other['username']],
                'messages' => $messages,
                'more' => count($messages) === DM_PAGE,
                'blocked' => (bool)$iBlocked->fetchColumn(),
                // whether I can write here; never says which side blocked
                'can_send' => !dmBlocked($db, $me, (int)$other['id']),
            ]);
        }

        if ($action === 'since') {
            $st = $db->prepare('SELECT * FROM dm_messages WHERE (sender_id = :me OR recipient_id = :me) AND id > :after ORDER BY id LIMIT 100');
            $st->bindValue(':me', $me, PDO::PARAM_INT);
            $st->bindValue(':after', (int)($_GET['after'] ?? 0), PDO::PARAM_INT);
            $st->execute();
            jsonResponse(['success' => true, 'messages' => array_map(fn($m) => dmFormat($m, $me), $st->fetchAll())]);
        }

        if ($action === 'users') {
            $q = trim((string)($_GET['q'] ?? ''));
            if ($q === '') jsonResponse(['success' => true, 'users' => []]);
            $like = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q) . '%';
            $st = $db->prepare("SELECT id, username FROM accounts WHERE username LIKE :q ESCAPE '\\' AND id != :me ORDER BY username LIMIT 10");
            $st->execute([':q' => $like, ':me' => $me]);
            jsonResponse(['success' => true, 'users' => array_map(fn($u) => ['id' => (int)$u['id'], 'username' => $u['username']], $st->fetchAll())]);
        }

        if ($action === 'blocks') {
            $st = $db->prepare('SELECT a.id, a.username FROM dm_blocks b JOIN accounts a ON a.id = b.blocked_id WHERE b.blocker_id = :me ORDER BY a.username');
            $st->execute([':me' => $me]);
            jsonResponse(['success' => true, 'users' => array_map(fn($u) => ['id' => (int)$u['id'], 'username' => $u['username']], $st->fetchAll())]);
        }

        dmFail('unknown_action', 'Unknown action', 400);
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') dmFail('method', 'Method not allowed', 405);
    requireCsrf();
    $in = readJsonBody();
    $action = (string)($in['action'] ?? '');

    if ($action === 'send') {
        $restriction = accountRestriction($db, $me);
        if ($restriction) dmFail('restricted', $restriction, 403);
        if (!checkRateLimit('dm_send', 30, 60, 'user:' . $me)) dmFail('slow_down', 'Too many messages, slow down', 429);

        $other = dmUser($db, (int)($in['to'] ?? 0));
        if (!$other || (int)$other['id'] === $me) dmFail('not_found', 'User not found', 404);
        if (dmBlocked($db, $me, (int)$other['id'])) dmFail('blocked', 'You cannot write to this user', 403);

        // Keep line breaks, drop other control characters
        $body = trim(preg_replace('/[\x00-\x09\x0B-\x1F\x7F]+/u', ' ', (string)($in['body'] ?? '')) ?? '');
        if ($body === '') dmFail('empty', 'Message is empty', 400);
        if (textLength($body) > DM_MAX_LENGTH) dmFail('too_long', 'Message is too long (max ' . DM_MAX_LENGTH . ')', 400);

        $db->prepare('INSERT INTO dm_messages (sender_id, recipient_id, body) VALUES (:s, :r, :b)')
           ->execute([':s' => $me, ':r' => $other['id'], ':b' => $body]);
        $st = $db->prepare('SELECT * FROM dm_messages WHERE id = :id');
        $st->execute([':id' => $db->lastInsertId()]);
        jsonResponse(['success' => true, 'message' => dmFormat($st->fetch(), $me)]);
    }

    if ($action === 'block' || $action === 'unblock') {
        $other = dmUser($db, (int)($in['user_id'] ?? 0));
        if (!$other || (int)$other['id'] === $me) dmFail('not_found', 'User not found', 404);
        $sql = $action === 'block'
            ? 'INSERT OR IGNORE INTO dm_blocks (blocker_id, blocked_id) VALUES (:me, :o)'
            : 'DELETE FROM dm_blocks WHERE blocker_id = :me AND blocked_id = :o';
        $db->prepare($sql)->execute([':me' => $me, ':o' => $other['id']]);
        jsonResponse(['success' => true, 'blocked' => $action === 'block']);
    }

    dmFail('unknown_action', 'Unknown action', 400);
} catch (Throwable $e) {
    failInternal('DM', $e);
}
