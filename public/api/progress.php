<?php
// public/api/progress.php
require_once __DIR__ . '/database.php';

initSession();
header('Content-Type: application/json');

$userId = $_SESSION['user_id'] ?? null;

// Allow reading progress sync for logged-in users only
if (!$userId) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'UNAUTHENTICATED: Login required to sync reading progress.']);
    exit();
}

$db = getDbConnection();
$method = $_SERVER['REQUEST_METHOD'];

try {
    if ($method === 'GET' && isset($_GET['all'])) {
        // Every book this user has opened, newest first (continue-reading shelf + card progress bars)
        $stmt = $db->prepare("SELECT book_id, percentage, updated_at FROM reading_progress
                              WHERE user_id = :uid ORDER BY updated_at DESC LIMIT 500");
        $stmt->execute([':uid' => $userId]);
        $rows = array_map(fn($r) => [
            'book_id'    => (int)$r['book_id'],
            'percentage' => (float)$r['percentage'],
            'updated_at' => $r['updated_at'],
        ], $stmt->fetchAll());
        jsonResponse(['success' => true, 'progress' => $rows]);
    }

    if ($method === 'GET') {
        $bookId = isset($_GET['book_id']) ? (int)$_GET['book_id'] : 0;
        if ($bookId <= 0) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Invalid book_id parameter.']);
            exit();
        }

        $stmt = $db->prepare("SELECT book_id, cfi_or_page, percentage, updated_at FROM reading_progress WHERE user_id = :uid AND book_id = :bid");
        $stmt->execute([':uid' => $userId, ':bid' => $bookId]);
        $progress = $stmt->fetch();

        if ($progress) {
            echo json_encode(['success' => true, 'progress' => $progress]);
        } else {
            echo json_encode(['success' => true, 'progress' => null]);
        }
        exit();
    }

    if ($method === 'POST') {
        requireCsrf();
        $rawInput = file_get_contents('php://input');
        $input = json_decode($rawInput, true) ?? [];

        $bookId = (int)($input['book_id'] ?? 0);
        $cfiOrPage = trim($input['cfi_or_page'] ?? '');
        $percentage = max(0.0, min(100.0, (float)($input['percentage'] ?? 0)));
        if (strlen($cfiOrPage) > 2000) {
            jsonResponse(['success' => false, 'error' => 'Invalid progress payload.'], 400);
        }

        if ($bookId <= 0 || empty($cfiOrPage)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'book_id and cfi_or_page are required.']);
            exit();
        }

        // Upsert reading progress (insert or update on match)
        $stmt = $db->prepare("INSERT INTO reading_progress (user_id, book_id, cfi_or_page, percentage, updated_at) 
                              VALUES (:uid, :bid, :cfi, :pct, CURRENT_TIMESTAMP)
                              ON CONFLICT(user_id, book_id) DO UPDATE SET
                              cfi_or_page = excluded.cfi_or_page,
                              percentage = excluded.percentage,
                              updated_at = CURRENT_TIMESTAMP");

        $stmt->execute([
            ':uid' => $userId,
            ':bid' => $bookId,
            ':cfi' => $cfiOrPage,
            ':pct' => $percentage
        ]);

        echo json_encode(['success' => true, 'updated' => true]);
        exit();
    }

    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Method not allowed.']);

} catch (Exception $e) {
    failInternal('PROGRESS', $e);
}