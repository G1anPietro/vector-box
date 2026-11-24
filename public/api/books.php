<?php
// public/api/books.php
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/cover_lib.php';
require_once __DIR__ . '/epub_meta.php';
require_once __DIR__ . '/books_lib.php';

initSession();
header('Content-Type: application/json');

$userId = $_SESSION['user_id'] ?? null;
$username = $_SESSION['username'] ?? 'guest';
$isAdmin = sessionIsAdmin();

try {
    $db = getDbConnection();

    $canRead = $isAdmin;
    $canUpload = $isAdmin;

    if ($userId && !$isAdmin) {
        $stmt = $db->prepare("SELECT can_read_books, can_upload_books FROM accounts WHERE id = :id");
        $stmt->execute([':id' => $userId]);
        $acc = $stmt->fetch();
        if ($acc) {
            $canRead = (int)$acc['can_read_books'] === 1;
            $canUpload = (int)$acc['can_upload_books'] === 1;
        }
    }

    $method = $_SERVER['REQUEST_METHOD'];

    // Stream / Download File
    if (isset($_GET['action']) && in_array($_GET['action'], ['stream', 'download'])) {
        if (!$canRead) {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'READ_PERMISSION_DENIED']);
            exit();
        }

        $bookId = (int)($_GET['id'] ?? 0);
        $stmt = $db->prepare("SELECT * FROM books WHERE id = :id");
        $stmt->execute([':id' => $bookId]);
        $book = $stmt->fetch();

        if (!$book || !file_exists($book['file_path'])) {
            http_response_code(404);
            echo json_encode(['success' => false, 'error' => 'BOOK_NOT_FOUND']);
            exit();
        }

        $isDownload = ($_GET['action'] === 'download');
        $contentType = ($book['format'] === 'pdf') ? 'application/pdf' : 'application/epub+zip';
        $disposition = $isDownload ? 'attachment' : 'inline';

        $size = filesize($book['file_path']);
        header("Content-Type: {$contentType}");
        header("Content-Disposition: {$disposition}; filename=\"" . rawurlencode(basename($book['file_path'])) . "\"");
        header('X-Content-Type-Options: nosniff');
        header('Accept-Ranges: bytes');

        // One byte range (pdf.js asks for pieces of big PDFs instead of the whole file)
        $range = (string)($_SERVER['HTTP_RANGE'] ?? '');
        if (preg_match('/^bytes=(\d*)-(\d*)$/', $range, $m) && ($m[1] !== '' || $m[2] !== '')) {
            if ($m[1] === '') { $start = max(0, $size - (int)$m[2]); $end = $size - 1; }
            else { $start = (int)$m[1]; $end = $m[2] === '' ? $size - 1 : min((int)$m[2], $size - 1); }
            if ($start > $end || $start >= $size) {
                http_response_code(416);
                header("Content-Range: bytes */{$size}");
                exit();
            }
            http_response_code(206);
            header("Content-Range: bytes {$start}-{$end}/{$size}");
            header('Content-Length: ' . ($end - $start + 1));
            $fh = fopen($book['file_path'], 'rb');
            fseek($fh, $start);
            $left = $end - $start + 1;
            while ($left > 0 && !feof($fh)) {
                $chunk = fread($fh, min(1048576, $left));
                if ($chunk === false || $chunk === '') break;
                echo $chunk;
                $left -= strlen($chunk);
            }
            fclose($fh);
            exit();
        }

        header("Content-Length: " . $size);
        readfile($book['file_path']);
        exit();
    }

    // Cover image (covers live in data/covers, outside the web root)
    if (($_GET['action'] ?? '') === 'cover') {
        if (!$canRead) {
            http_response_code(403);
            exit();
        }
        $stmt = $db->prepare("SELECT cover_path FROM books WHERE id = :id");
        $stmt->execute([':id' => (int)($_GET['id'] ?? 0)]);
        $coverPath = (string)$stmt->fetchColumn();
        // Only the file name is trusted; images only (no SVG: it can carry scripts)
        $file = dirname(__DIR__, 2) . '/data/covers/' . basename($coverPath);
        $types = ['jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'gif' => 'image/gif', 'webp' => 'image/webp'];
        $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
        if ($coverPath === '' || !isset($types[$ext]) || !is_file($file)) {
            http_response_code(404);
            exit();
        }
        // the list asks for w=thumb: a small copy (the originals are 300-800 KB each, 11 MB for the whole shelf on a phone connection)
        if (($_GET['w'] ?? '') === 'thumb' && ($small = coverThumb($file)) !== null) { $file = $small; $ext = 'jpg'; }
        header('Content-Type: ' . $types[$ext]);
        header('X-Content-Type-Options: nosniff');
        header('Content-Length: ' . filesize($file));
        // the list gives every cover a ?v= (its file time): a changed cover has a new URL, so the browser may keep this one for good
        header('Cache-Control: private, max-age=31536000, immutable');
        readfile($file);
        exit();
    }

    // LIST BOOKS & Auto-repair missing metadata/covers for existing items
    if ($method === 'GET') {
        if (!$canRead) {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'READ_PERMISSION_DENIED']);
            exit();
        }

        $query = trim($_GET['q'] ?? '');
        $sql = "SELECT b.*, p.cfi_or_page, p.percentage 
                FROM books b 
                LEFT JOIN reading_progress p ON (b.id = p.book_id AND p.user_id = :uid)";
        
        if (!empty($query)) {
            $sql .= " WHERE b.title LIKE :q ESCAPE '\\' OR b.author LIKE :q ESCAPE '\\'";
        }
        $sql .= " ORDER BY b.id DESC";

        $stmt = $db->prepare($sql);
        $params = [':uid' => $userId ?? 0];
        if (!empty($query)) $params[':q'] = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], (string)$query) . '%';
        $stmt->execute($params);
        $books = $stmt->fetchAll();

        // One-time metadata repair for old EPUBs (author/cover missing). Bounded work per request:
        // each book is attempted once (meta_checked) and at most 3 per catalog load.
        $coverDir = dirname(__DIR__, 2) . '/data/covers/';
        $repairBudget = 3;

        // Without PHP's zip/xml extensions EPUBs can't be read: don't mark them as checked
        // (they would never get a cover), just say so in the error log.
        if (!epubMetaSupported()) {
            require_once __DIR__ . '/debug_logger.php';
            $repairBudget = 0;
            if (array_filter($books, fn($x) => $x['format'] === 'epub' && (int)($x['meta_checked'] ?? 0) === 0)) {
                logSystemError('EPUB_META', 'PHP zip or xml extension missing (apt install php-zip php-xml): EPUB covers and authors cannot be read');
            }
        }

        foreach ($books as &$b) {
            if ($repairBudget <= 0) break;
            $needsRepair = (int)($b['meta_checked'] ?? 0) === 0
                && $b['format'] === 'epub'
                && ($b['author'] === 'Unknown' || empty($b['cover_path']))
                && file_exists($b['file_path']);
            if (!$needsRepair) continue;
            $repairBudget--;

            // One broken book must never take the whole library down
            try {
                $meta = readEpubMetadata($b['file_path']);
            } catch (Throwable $e) {
                require_once __DIR__ . '/debug_logger.php';
                logSystemError('EPUB_META', 'Book ' . (int)$b['id'] . ': ' . $e->getMessage());
                $meta = ['title' => null, 'author' => null, 'cover_data' => null, 'cover_ext' => null];
            }
            $newAuthor = $meta['author'] ?? $b['author'];
            $newCover = $b['cover_path'];

            if ($meta['cover_data'] !== null) {
                if (!file_exists($coverDir)) mkdir($coverDir, 0750, true);
                $coverFileName = $b['id'] . '_cover.' . $meta['cover_ext'];
                if (file_put_contents($coverDir . $coverFileName, $meta['cover_data']) !== false) {
                    $newCover = '../data/covers/' . $coverFileName;
                }
            }

            $uStmt = $db->prepare("UPDATE books SET author = :a, cover_path = :c, meta_checked = 1 WHERE id = :id");
            $uStmt->execute([':a' => $newAuthor, ':c' => $newCover, ':id' => $b['id']]);
            $b['author'] = $newAuthor;
            $b['cover_path'] = $newCover;
            $b['meta_checked'] = 1;
        }
        unset($b);

        // Never expose server paths: covers are served by ?action=cover
        $books = array_map(function ($b) {
            $coverFile = !empty($b['cover_path']) ? dirname(__DIR__, 2) . '/data/covers/' . basename((string)$b['cover_path']) : '';
            $b['cover_path'] = $coverFile !== '' ? '../api/books.php?action=cover&id=' . (int)$b['id'] . '&w=thumb&v=' . (int)@filemtime($coverFile) : '';
            unset($b['file_path']);
            return $b;
        }, $books);

        echo json_encode([
            'success' => true,
            'can_read' => $canRead,
            'can_upload' => $canUpload,
            'books' => $books
        ]);
        exit();
    }

    // The browser could not draw a PDF's cover (encrypted, damaged, too big...): log why, for the admin
    if ($method === 'POST' && ($_GET['action'] ?? '') === 'cover_failed') {
        requireCsrf();
        require_once __DIR__ . '/rate_limiter.php';
        if (!$canUpload || !checkRateLimit('pdf_cover_failed', 20, 3600, 'user:' . $userId)) {
            http_response_code($canUpload ? 429 : 403);
            echo json_encode(['success' => false]);
            exit();
        }
        $reason = trim(preg_replace('/[\x00-\x1F\x7F]+/u', ' ', (string)($_POST['reason'] ?? '')) ?? '');
        require_once __DIR__ . '/debug_logger.php';
        logSystemError('PDF_COVER', 'book ' . (int)($_POST['book_id'] ?? 0) . ': ' . textCut($reason, 200));
        echo json_encode(['success' => true]);
        exit();
    }

    // COVER OF A PDF: the browser draws page 1 with pdf.js and sends it as a JPEG/PNG (the server has no PDF renderer).
    // Only for uploaders, only PDFs, and only when the book has no cover yet (nobody can replace an existing one).
    if ($method === 'POST' && ($_GET['action'] ?? '') === 'set_cover') {
        requireCsrf();
        if (!$canUpload) {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'UPLOAD_PERMISSION_DENIED']);
            exit();
        }
        $stmt = $db->prepare("SELECT id, format, cover_path FROM books WHERE id = :id");
        $stmt->execute([':id' => (int)($_POST['book_id'] ?? 0)]);
        $book = $stmt->fetch();
        if (!$book || $book['format'] !== 'pdf') {
            http_response_code(404);
            echo json_encode(['success' => false, 'error' => 'NOT_FOUND']);
            exit();
        }
        if (!empty($book['cover_path'])) {
            echo json_encode(['success' => true, 'already' => true]);
            exit();
        }
        $img = $_FILES['cover'] ?? null;
        if (!$img || $img['error'] !== UPLOAD_ERR_OK || $img['size'] > 2 * 1048576 || !is_uploaded_file($img['tmp_name'])) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'BAD_IMAGE']);
            exit();
        }
        $types = ['image/jpeg' => 'jpg', 'image/png' => 'png'];
        $mime = (new finfo(FILEINFO_MIME_TYPE))->file($img['tmp_name']) ?: '';
        $size = @getimagesize($img['tmp_name']);
        if (!isset($types[$mime]) || !$size || $size[0] > 3000 || $size[1] > 3000) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'BAD_IMAGE']);
            exit();
        }
        $coverDir = dirname(__DIR__, 2) . '/data/covers/';
        if (!file_exists($coverDir)) mkdir($coverDir, 0750, true);
        $name = 'pdf_' . (int)$book['id'] . '_' . bin2hex(random_bytes(4)) . '_cover.' . $types[$mime];
        if (!move_uploaded_file($img['tmp_name'], $coverDir . $name)) throw new RuntimeException('cover move failed');
        // Only if still empty (two tabs at once): the loser's file is removed
        $upd = $db->prepare("UPDATE books SET cover_path = :c WHERE id = :id AND (cover_path IS NULL OR cover_path = '')");
        $upd->execute([':c' => '../data/covers/' . $name, ':id' => $book['id']]);
        if ($upd->rowCount() === 0) @unlink($coverDir . $name);
        echo json_encode(['success' => true]);
        exit();
    }

    // Tidy the titles and authors of the books already in the library (uploaders only): without {apply: true} it only lists the changes
    if ($method === 'POST' && ($_GET['action'] ?? '') === 'clean_titles') {
        requireCsrf();
        if (!$canUpload) {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'UPLOAD_PERMISSION_DENIED']);
            exit();
        }
        $in = readJsonBody();
        $changes = [];
        foreach ($db->query('SELECT id, title, author FROM books ORDER BY id')->fetchAll() as $b) {
            $nt = bookCleanTitle((string)$b['title'], (string)$b['author']);
            $na = $b['author'] === 'Unknown' || $b['author'] === null ? $b['author'] : bookCleanAuthor((string)$b['author']);
            if ($nt !== $b['title'] || $na !== $b['author']) $changes[] = ['id' => (int)$b['id'], 'title' => $b['title'], 'new_title' => $nt, 'author' => $b['author'], 'new_author' => $na];
        }
        if (!empty($in['apply'])) {
            $db->exec('BEGIN IMMEDIATE');
            $up = $db->prepare('UPDATE books SET title = :t, author = :a WHERE id = :id');
            foreach ($changes as $c) $up->execute([':t' => textCut($c['new_title'], 200), ':a' => $c['new_author'], ':id' => $c['id']]);
            $db->exec('COMMIT');
        }
        echo json_encode(['success' => true, 'applied' => !empty($in['apply']), 'changes' => $changes]);
        exit();
    }

    // UPLOAD BOOK
    if ($method === 'POST') {
        requireCsrf();
        if (!$canUpload) {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'UPLOAD_PERMISSION_DENIED']);
            exit();
        }

        if (empty($_FILES['book_file'])) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'NO_FILE_UPLOADED']);
            exit();
        }

        $file = $_FILES['book_file'];
        if ($file['error'] !== UPLOAD_ERR_OK) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => "UPLOAD_ERROR_CODE_{$file['error']}"]);
            exit();
        }

        $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
        if (!in_array($ext, ['epub', 'pdf'])) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'INVALID_FORMAT']);
            exit();
        }

        // Verify real content, not just the extension
        $fh = fopen($file['tmp_name'], 'rb');
        $magic = $fh ? fread($fh, 4) : '';
        if ($fh) fclose($fh);
        $validMagic = ($ext === 'pdf' && strncmp($magic, '%PDF', 4) === 0)
                   || ($ext === 'epub' && strncmp($magic, "PK\x03\x04", 4) === 0);
        if (!$validMagic) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'INVALID_FILE_CONTENT']);
            exit();
        }

        // The same file twice? (hash of the content; old books get their hash the first time they are compared)
        $sha1 = (string)sha1_file($file['tmp_name']);
        $dup = $db->prepare("SELECT id, title FROM books WHERE file_sha1 = :s LIMIT 1");
        $dup->execute([':s' => $sha1]);
        $same = $dup->fetch();
        if (!$same) {
            $cand = $db->prepare("SELECT id, title, file_path FROM books WHERE file_sha1 = '' AND file_size = :fs");
            $cand->execute([':fs' => (int)filesize($file['tmp_name'])]);
            foreach ($cand->fetchAll() as $c) {
                if (!is_file($c['file_path'])) continue;
                $h = (string)sha1_file($c['file_path']);
                $db->prepare('UPDATE books SET file_sha1 = :h WHERE id = :id')->execute([':h' => $h, ':id' => $c['id']]);
                if ($h === $sha1) { $same = $c; break; }
            }
        }
        if ($same) {
            http_response_code(409);
            echo json_encode(['success' => false, 'error' => 'DUPLICATE', 'book_id' => (int)$same['id'], 'title' => $same['title']]);
            exit();
        }

        $uploadDir = dirname(__DIR__, 2) . '/data/books/';
        $coverDir  = dirname(__DIR__, 2) . '/data/covers/';

        if (!file_exists($uploadDir)) mkdir($uploadDir, 0750, true);
        if (!file_exists($coverDir)) mkdir($coverDir, 0750, true);

        $safeName = preg_replace('/[^a-zA-Z0-9_\-]/', '_', pathinfo($file['name'], PATHINFO_FILENAME));
        $uniquePrefix = time() . '_' . bin2hex(random_bytes(3));
        $targetFileName = $uniquePrefix . '_' . $safeName . '.' . $ext;
        $targetPath = $uploadDir . $targetFileName;

        $moved = move_uploaded_file($file['tmp_name'], $targetPath);
        if (!$moved && file_exists($file['tmp_name'])) {
            $moved = copy($file['tmp_name'], $targetPath);
            if ($moved) @unlink($file['tmp_name']);
        }

        if ($moved) {
            $title = preg_replace('/\s*\(z-lib.*?\)/i', '', str_replace('_', ' ', $safeName));
            $author = 'Unknown';
            $coverRelPath = null;

            if ($ext === 'epub') {
                try {
                    $meta = readEpubMetadata($targetPath);
                } catch (Throwable $e) {
                    @unlink($targetPath);   // no orphan file without a DB row
                    throw $e;
                }
                if ($meta['title'] !== null) $title = textCut($meta['title'], 200);
                if ($meta['author'] !== null) $author = textCut($meta['author'], 120);

                if ($meta['cover_data'] !== null && @getimagesizefromstring($meta['cover_data']) !== false) {
                    $coverFileName = $uniquePrefix . '_' . $safeName . '_cover.' . $meta['cover_ext'];
                    if (file_put_contents($coverDir . $coverFileName, $meta['cover_data']) !== false) {
                        $coverRelPath = '../data/covers/' . $coverFileName;
                    }
                }
            }

            $title = textCut(bookCleanTitle($title, $author), 200);
            $author = $author === 'Unknown' ? $author : textCut(bookCleanAuthor($author), 120);

            // Same title, author and format as a book already there (another copy of the file)?
            $key = bookNormKey($title . '|' . $author);
            foreach ($db->query('SELECT id, title, author, format FROM books')->fetchAll() as $o) {
                if ($o['format'] === $ext && bookNormKey($o['title'] . '|' . $o['author']) === $key) {
                    @unlink($targetPath);
                    if ($coverRelPath !== null) @unlink($coverDir . basename($coverRelPath));
                    http_response_code(409);
                    echo json_encode(['success' => false, 'error' => 'DUPLICATE', 'book_id' => (int)$o['id'], 'title' => $o['title']]);
                    exit();
                }
            }

            $stmt = $db->prepare("INSERT INTO books (title, author, description, format, file_path, cover_path, file_size, uploaded_by, meta_checked, file_sha1)
                                  VALUES (:t, :a, '', :f, :fp, :cp, :fs, :ub, 1, :sh)");
            $stmt->execute([
                ':t' => $title,
                ':a' => $author,
                ':f' => $ext,
                ':fp' => $targetPath,
                ':cp' => $coverRelPath,
                ':fs' => filesize($targetPath),
                ':ub' => $username,
                ':sh' => $sha1,
            ]);

            echo json_encode(['success' => true, 'book_id' => $db->lastInsertId()]);
        } else {
            http_response_code(500);
            echo json_encode(['success' => false, 'error' => 'FILE_MOVE_FAILED']);
        }
        exit();
    }

} catch (Exception $e) {
    failInternal('BOOKS', $e);
}