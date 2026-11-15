<?php
// public/api/save_theme.php
require_once __DIR__ . '/database.php';

initSession(true);
header('Content-Type: application/json');

$userId = $_SESSION['user_id'] ?? null;
if (!$userId) {
    session_write_close();
    jsonResponse(['success' => false, 'error' => 'Not logged in'], 401);
}
requireCsrf();

$input = json_decode(file_get_contents('php://input'), true);
$theme = trim((string)($input['theme'] ?? DEFAULT_SYSTEM_THEME));

if (in_array($theme, READER_THEMES, true)) {
    // The reader keeps its own theme in the browser: it must not overwrite the desktop theme of the account
    session_write_close();
    echo json_encode(['success' => true, 'theme' => $theme, 'stored' => false]);
    exit();
}
if (!isset(SYSTEM_THEMES[$theme])) {
    session_write_close();
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Invalid theme selection']);
    exit();
}

try {
    $db = getDbConnection();
    $stmt = $db->prepare("UPDATE accounts SET theme = :theme WHERE id = :id");
    $stmt->execute([':theme' => $theme, ':id' => $userId]);

    // Keep session state synced for both legacy theme engines and reader persistence
    $_SESSION['theme'] = $theme;
    session_write_close();

    echo json_encode(['success' => true, 'theme' => $theme, 'stored' => true]);
} catch (Exception $e) {
    failInternal('SAVE_THEME', $e);
}