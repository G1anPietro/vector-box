<?php
// public/api/book_tags.php — labels ("shelves") the reader gives to books, per account.
// GET  -> {tags: {book_id: [label, ...]}, all: [label, ...]}
// POST {book_id, tags: ["maturità", "da rileggere"]}  -> replaces the labels of that book (up to 8, 30 characters each)
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/rate_limiter.php';
require_once __DIR__ . '/books_lib.php';

initSession();
requireLogin();

try {
    $db = getDbConnection();
    $userId = (int)$_SESSION['user_id'];
    if (!userCanReadBooks($db, $userId, !empty($_SESSION['is_admin']))) {
        jsonResponse(['success' => false, 'error' => 'FORBIDDEN: Book reader access required'], 403);
    }
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $st = $db->prepare('SELECT book_id, tag FROM book_tags WHERE user_id = :u ORDER BY tag');
        $st->execute([':u' => $userId]);
        $tags = [];
        $all = [];
        foreach ($st->fetchAll() as $r) { $tags[(int)$r['book_id']][] = $r['tag']; $all[$r['tag']] = true; }
        jsonResponse(['success' => true, 'tags' => (object)$tags, 'all' => array_keys($all)]);
    }
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonResponse(['success' => false, 'error' => 'Method not allowed'], 405);
    requireCsrf();
    if (!checkRateLimit('book_tags', 60, 600, 'user:' . $userId)) jsonResponse(['success' => false, 'error' => 'Too many requests'], 429);
    $in = readJsonBody();
    $bookId = (int)($in['book_id'] ?? 0);
    $st = $db->prepare('SELECT 1 FROM books WHERE id = :id');
    $st->execute([':id' => $bookId]);
    if ($bookId <= 0 || !$st->fetchColumn()) jsonResponse(['success' => false, 'error' => 'Book not found'], 404);
    $tags = bookCleanTags($in['tags'] ?? []);
    $db->exec('BEGIN IMMEDIATE');
    $db->prepare('DELETE FROM book_tags WHERE user_id = :u AND book_id = :b')->execute([':u' => $userId, ':b' => $bookId]);
    $ins = $db->prepare('INSERT OR IGNORE INTO book_tags (user_id, book_id, tag) VALUES (:u, :b, :t)');
    foreach ($tags as $t) $ins->execute([':u' => $userId, ':b' => $bookId, ':t' => $t]);
    $db->exec('COMMIT');
    jsonResponse(['success' => true, 'tags' => $tags]);
} catch (Throwable $e) {
    failInternal('BOOK_TAGS', $e);
}
