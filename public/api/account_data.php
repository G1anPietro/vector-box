<?php
// public/api/account_data.php — "your data" for the logged-in account (see account_data_lib.php for what is kept/removed).
//   GET  ?action=export                       -> a JSON file with everything stored about the account (read-only)
//   POST {action:'delete', password, delete_materials}  -> erases the account after checking the password; ends the session
require_once __DIR__ . '/account_data_lib.php';
require_once __DIR__ . '/rate_limiter.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'POST') startWritableSession(); else initSession();
requireLogin();
$userId = (int)$_SESSION['user_id'];
$db = getDbConnection();

try {
    if ($method === 'GET') {
        if (($_GET['action'] ?? '') !== 'export') jsonResponse(['success' => false, 'error' => 'Invalid action.'], 400);
        if (!checkRateLimit('account_export', 5, 3600, 'user:' . $userId)) jsonResponse(['success' => false, 'error' => 'Too many exports: try again later.'], 429);
        $data = accountExport($db, $userId);
        header('Content-Type: application/json; charset=utf-8');
        header('Content-Disposition: attachment; filename="vector-box-' . preg_replace('/[^A-Za-z0-9_-]/', '', (string)$_SESSION['username']) . '-' . date('Y-m-d') . '.json"');
        header('Cache-Control: no-store');
        echo json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    requireCsrf();
    $in = readJsonBody();
    if (($in['action'] ?? '') !== 'delete') jsonResponse(['success' => false, 'error' => 'Invalid action.'], 400);
    if (!checkRateLimit('account_delete', 5, 3600, 'user:' . $userId)) jsonResponse(['success' => false, 'error' => 'Too many attempts: try again later.'], 429);

    $st = $db->prepare('SELECT password_hash FROM accounts WHERE id = :i');
    $st->execute([':i' => $userId]);
    $hash = (string)$st->fetchColumn();
    if ($hash === '' || !password_verify((string)($in['password'] ?? ''), $hash)) {
        jsonResponse(['success' => false, 'error' => 'Wrong password.'], 403);
    }
    $blocker = accountEraseBlocker($db, $userId);
    if ($blocker !== null) jsonResponse(['success' => false, 'error' => $blocker], 409);

    $gone = accountErase($db, $userId, !empty($in['delete_materials']));

    // end the session the same way logout.php does
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', ['expires' => time() - 42000, 'path' => $p['path'], 'domain' => $p['domain'],
                                       'secure' => $p['secure'], 'httponly' => true, 'samesite' => 'Lax']);
    }
    session_destroy();
    jsonResponse(['success' => true, 'message' => 'Your account and data were deleted.', 'removed' => $gone]);
} catch (Throwable $e) {
    failInternal('ACCOUNT_DATA', $e);
}
