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
$theme = trim($input['theme'] ?? 'cyan');

// Support both system themes and new reader themes
$allowedThemes = [
    // System themes
    'cyan', 'matrix', 'amber', 'emerald', 'synthwave', 'slate', 'classic',
    // Reader themes
    'light', 'sepia', 'dark', 'black'
];

if (!in_array($theme, $allowedThemes, true)) {
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

    echo json_encode(['success' => true, 'theme' => $theme]);
} catch (Exception $e) {
    failInternal('SAVE_THEME', $e);
}