<?php
// public/api/save_theme.php
session_start();
header('Content-Type: application/json');

require_once __DIR__ . '/database.php';

if (!isset($_SESSION['user_id'])) {
    echo json_encode(['success' => false, 'error' => 'Not logged in']);
    exit();
}

$input = json_decode(file_get_contents('php://input'), true);
$theme = trim($input['theme'] ?? 'cyan');

try {
    $db = getDbConnection();
    $stmt = $db->prepare("UPDATE accounts SET theme = :theme WHERE id = :id");
    $stmt->execute([':theme' => $theme, ':id' => $_SESSION['user_id']]);
    $_SESSION['theme'] = $theme;

    echo json_encode(['success' => true]);
} catch (Exception $e) {
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}