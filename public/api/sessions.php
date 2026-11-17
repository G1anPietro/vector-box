<?php
// public/api/sessions.php — "where you are signed in": the caller's own signed-in browsers.
//   GET                           -> {sessions:[{id,label,country,created_at,last_seen,current}]}
//   POST {action:'revoke', id}    -> signs that device out (its next request is a guest)
//   POST {action:'revoke_others'} -> signs out every device except this one
require_once __DIR__ . '/sessions_lib.php';
require_once __DIR__ . '/rate_limiter.php';

initSession();
header('Content-Type: application/json');
$isPost = ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST';
if ($isPost) requireCsrf();
requireLogin();
$me = (int)$_SESSION['user_id'];
$mine = sessionSidHash();

try {
    if (!checkRateLimit('sessions', 30, 60, (string)$me, false)) jsonFail('slow_down', 'Too many requests', 429);
    $db = getDbConnection();
    if (!$isPost) {
        $st = $db->prepare('SELECT id, sid_hash, label, country, created_at, last_seen FROM account_sessions WHERE user_id = :u ORDER BY last_seen DESC');
        $st->execute([':u' => $me]);
        $out = [];
        foreach ($st->fetchAll() as $r) {
            $out[] = ['id' => (int)$r['id'], 'label' => (string)$r['label'], 'country' => (string)$r['country'],
                      'created_at' => (int)$r['created_at'], 'last_seen' => (int)$r['last_seen'], 'current' => hash_equals($mine, (string)$r['sid_hash'])];
        }
        jsonResponse(['success' => true, 'sessions' => $out]);
    }
    $in = readJsonBody();
    $action = (string)($in['action'] ?? '');
    if ($action === 'revoke') {
        $st = $db->prepare('DELETE FROM account_sessions WHERE id = :i AND user_id = :u AND sid_hash != :h');   // only your own rows; this one signs out via logout
        $st->execute([':i' => (int)($in['id'] ?? 0), ':u' => $me, ':h' => $mine]);
        if ($st->rowCount() === 0) jsonFail('not_found', 'Device not found', 404);
        jsonResponse(['success' => true]);
    }
    if ($action === 'revoke_others') {
        $st = $db->prepare('DELETE FROM account_sessions WHERE user_id = :u AND sid_hash != :h');
        $st->execute([':u' => $me, ':h' => $mine]);
        jsonResponse(['success' => true, 'removed' => $st->rowCount()]);
    }
    jsonFail('bad_action', 'Unknown action', 400);
} catch (Throwable $e) {
    failInternal('SESSIONS', $e);
}
