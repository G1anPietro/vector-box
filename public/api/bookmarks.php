<?php
// public/api/bookmarks.php
// GET  ?book_id=N                                        -> this user's bookmarks for a book
// POST {action:"add", book_id, location, label, percentage} -> add (max 100 per book)
// POST {action:"delete", id}                             -> remove one of your own
require_once __DIR__ . '/database.php';

const BOOKMARKS_PER_BOOK = 100;

initSession();
requireLogin();

try {
    $db = getDbConnection();
    $userId = (int)$_SESSION['user_id'];
    $isAdmin = !empty($_SESSION['is_admin']);

    if (!userCanReadBooks($db, $userId, $isAdmin)) {
        jsonResponse(['success' => false, 'error' => 'FORBIDDEN: Book reader access required'], 403);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $bookId = (int)($_GET['book_id'] ?? 0);
        if ($bookId <= 0) jsonResponse(['success' => false, 'error' => 'Invalid book_id'], 400);

        $stmt = $db->prepare("SELECT id, location, label, percentage, created_at FROM bookmarks
                              WHERE user_id = :uid AND book_id = :bid ORDER BY percentage ASC, id ASC");
        $stmt->execute([':uid' => $userId, ':bid' => $bookId]);
        $rows = array_map(fn($r) => [
            'id'         => (int)$r['id'],
            'location'   => $r['location'],
            'label'      => $r['label'],
            'percentage' => (float)$r['percentage'],
            'created_at' => $r['created_at'],
        ], $stmt->fetchAll());
        jsonResponse(['success' => true, 'bookmarks' => $rows]);
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        jsonResponse(['success' => false, 'error' => 'Method not allowed'], 405);
    }

    requireCsrf();
    $input = readJsonBody();
    $action = (string)($input['action'] ?? '');

    if ($action === 'delete') {
        $id = (int)($input['id'] ?? 0);
        $stmt = $db->prepare("DELETE FROM bookmarks WHERE id = :id AND user_id = :uid");
        $stmt->execute([':id' => $id, ':uid' => $userId]);
        if ($stmt->rowCount() === 0) jsonResponse(['success' => false, 'error' => 'Bookmark not found'], 404);
        jsonResponse(['success' => true, 'id' => $id]);
    }

    if ($action !== 'add') {
        jsonResponse(['success' => false, 'error' => 'Unknown action'], 400);
    }

    $bookId = (int)($input['book_id'] ?? 0);
    $location = trim((string)($input['location'] ?? ''));
    $label = trim(preg_replace('/[\x00-\x1F\x7F]+/', ' ', (string)($input['label'] ?? '')) ?? '');
    $percentage = max(0.0, min(100.0, (float)($input['percentage'] ?? 0)));

    if ($bookId <= 0 || $location === '' || strlen($location) > 2000) {
        jsonResponse(['success' => false, 'error' => 'book_id and a valid location are required'], 400);
    }
    $stmt = $db->prepare("SELECT 1 FROM books WHERE id = :id");
    $stmt->execute([':id' => $bookId]);
    if (!$stmt->fetchColumn()) jsonResponse(['success' => false, 'error' => 'Book not found'], 404);

    $stmt = $db->prepare("SELECT COUNT(*) FROM bookmarks WHERE user_id = :uid AND book_id = :bid");
    $stmt->execute([':uid' => $userId, ':bid' => $bookId]);
    if ((int)$stmt->fetchColumn() >= BOOKMARKS_PER_BOOK) {
        jsonResponse(['success' => false, 'error' => 'Too many bookmarks for this book'], 400);
    }

    $stmt = $db->prepare("INSERT INTO bookmarks (user_id, book_id, location, label, percentage)
                          VALUES (:uid, :bid, :loc, :label, :pct)");
    $stmt->execute([
        ':uid' => $userId, ':bid' => $bookId, ':loc' => $location,
        ':label' => textCut($label, 100), ':pct' => $percentage,
    ]);
    jsonResponse(['success' => true, 'id' => (int)$db->lastInsertId()]);
} catch (Throwable $e) {
    failInternal('BOOKMARKS', $e);
}
