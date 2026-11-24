<?php
// public/api/highlights.php — highlights and notes of the book reader (visible only to the account that wrote them).
// GET  ?book_id=N                  -> [{id, kind, location, text, note, color, percentage, created_at}]
// GET  ?book_id=N&export=1         -> the same as a Markdown file (download)
// POST {action:"add", book_id, kind:"hl"|"note", location, text, note, color, percentage}
// POST {action:"update", id, note?, color?}      POST {action:"delete", id}
// kind "hl" = a highlighted passage of an EPUB (location = CFI range, text = the passage); kind "note" = a note on a page
// (location = EPUB CFI or PDF page number). Up to 500 per book.
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/rate_limiter.php';

const HIGHLIGHTS_PER_BOOK = 500;
const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink'];

initSession();
requireLogin();

try {
    $db = getDbConnection();
    $userId = (int)$_SESSION['user_id'];
    if (!userCanReadBooks($db, $userId, !empty($_SESSION['is_admin']))) {
        jsonResponse(['success' => false, 'error' => 'FORBIDDEN: Book reader access required'], 403);
    }
    $clean = fn(string $s, int $max) => textCut(trim(preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]+/', ' ', $s) ?? ''), $max);

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $bookId = (int)($_GET['book_id'] ?? 0);
        if ($bookId <= 0) jsonResponse(['success' => false, 'error' => 'Invalid book_id'], 400);
        $st = $db->prepare('SELECT id, kind, location, text, note, color, percentage, created_at FROM book_highlights WHERE user_id = :u AND book_id = :b ORDER BY percentage, id');
        $st->execute([':u' => $userId, ':b' => $bookId]);
        $rows = array_map(fn($r) => ['id' => (int)$r['id'], 'kind' => $r['kind'], 'location' => $r['location'], 'text' => $r['text'], 'note' => $r['note'],
            'color' => $r['color'], 'percentage' => (float)$r['percentage'], 'created_at' => $r['created_at']], $st->fetchAll());
        if (!empty($_GET['export'])) {
            $b = $db->prepare('SELECT title, author FROM books WHERE id = :id');
            $b->execute([':id' => $bookId]);
            $book = $b->fetch();
            if (!$book) jsonResponse(['success' => false, 'error' => 'Book not found'], 404);
            $md = '# ' . $book['title'] . "\n" . ($book['author'] && $book['author'] !== 'Unknown' ? '*' . $book['author'] . "*\n" : '') . "\n";
            foreach ($rows as $r) {
                $pct = round($r['percentage']) . '%';
                if ($r['kind'] === 'hl') $md .= '> ' . str_replace("\n", "\n> ", $r['text']) . "\n" . ($r['note'] !== '' ? "\n" . $r['note'] . "\n" : '') . "\n*({$pct})*\n\n";
                else $md .= "**Nota ({$pct}):** " . $r['note'] . "\n\n";
            }
            header('Content-Type: text/markdown; charset=utf-8');
            header('Content-Disposition: attachment; filename="note-libro-' . $bookId . '.md"');
            header('X-Content-Type-Options: nosniff');
            echo $md;
            exit;
        }
        jsonResponse(['success' => true, 'items' => $rows]);
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonResponse(['success' => false, 'error' => 'Method not allowed'], 405);
    requireCsrf();
    if (!checkRateLimit('book_highlights', 120, 600, 'user:' . $userId)) jsonResponse(['success' => false, 'error' => 'Too many requests'], 429);
    $in = readJsonBody();
    $action = (string)($in['action'] ?? '');

    if ($action === 'delete') {
        $st = $db->prepare('DELETE FROM book_highlights WHERE id = :id AND user_id = :u');
        $st->execute([':id' => (int)($in['id'] ?? 0), ':u' => $userId]);
        if ($st->rowCount() === 0) jsonResponse(['success' => false, 'error' => 'Not found'], 404);
        jsonResponse(['success' => true]);
    }
    if ($action === 'update') {
        $id = (int)($in['id'] ?? 0);
        $st = $db->prepare('SELECT note, color FROM book_highlights WHERE id = :id AND user_id = :u');
        $st->execute([':id' => $id, ':u' => $userId]);
        $cur = $st->fetch();
        if (!$cur) jsonResponse(['success' => false, 'error' => 'Not found'], 404);
        $note = array_key_exists('note', $in) ? $clean((string)$in['note'], 1000) : $cur['note'];
        $color = in_array($in['color'] ?? '', HIGHLIGHT_COLORS, true) ? $in['color'] : $cur['color'];
        $db->prepare('UPDATE book_highlights SET note = :n, color = :c WHERE id = :id AND user_id = :u')->execute([':n' => $note, ':c' => $color, ':id' => $id, ':u' => $userId]);
        jsonResponse(['success' => true]);
    }
    if ($action !== 'add') jsonResponse(['success' => false, 'error' => 'Unknown action'], 400);

    $bookId = (int)($in['book_id'] ?? 0);
    $kind = ($in['kind'] ?? 'hl') === 'note' ? 'note' : 'hl';
    $location = trim((string)($in['location'] ?? ''));
    $text = $clean((string)($in['text'] ?? ''), 600);
    $note = $clean((string)($in['note'] ?? ''), 1000);
    $color = in_array($in['color'] ?? '', HIGHLIGHT_COLORS, true) ? $in['color'] : 'yellow';
    $pct = max(0.0, min(100.0, (float)($in['percentage'] ?? 0)));
    if ($bookId <= 0 || $location === '' || strlen($location) > 2000) jsonResponse(['success' => false, 'error' => 'book_id and a valid location are required'], 400);
    if ($kind === 'hl' && $text === '') jsonResponse(['success' => false, 'error' => 'A highlight needs the text'], 400);
    if ($kind === 'note' && $note === '') jsonResponse(['success' => false, 'error' => 'A note needs a text'], 400);
    $st = $db->prepare('SELECT 1 FROM books WHERE id = :id');
    $st->execute([':id' => $bookId]);
    if (!$st->fetchColumn()) jsonResponse(['success' => false, 'error' => 'Book not found'], 404);
    $st = $db->prepare('SELECT COUNT(*) FROM book_highlights WHERE user_id = :u AND book_id = :b');
    $st->execute([':u' => $userId, ':b' => $bookId]);
    if ((int)$st->fetchColumn() >= HIGHLIGHTS_PER_BOOK) jsonResponse(['success' => false, 'error' => 'Too many highlights for this book'], 400);
    $db->prepare('INSERT INTO book_highlights (user_id, book_id, kind, location, text, note, color, percentage) VALUES (:u, :b, :k, :l, :t, :n, :c, :p)')
       ->execute([':u' => $userId, ':b' => $bookId, ':k' => $kind, ':l' => $location, ':t' => $text, ':n' => $note, ':c' => $color, ':p' => $pct]);
    jsonResponse(['success' => true, 'id' => (int)$db->lastInsertId()]);
} catch (Throwable $e) {
    failInternal('HIGHLIGHTS', $e);
}
