<?php
// public/api/books.php
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/epub_meta.php';

initSession();
header('Content-Type: application/json');

$userId = $_SESSION['user_id'] ?? null;
$username = $_SESSION['username'] ?? 'guest';
$isAdmin = !empty($_SESSION['is_admin']);

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

        header("Content-Type: {$contentType}");
        header("Content-Length: " . filesize($book['file_path']));
        header("Content-Disposition: {$disposition}; filename=\"" . rawurlencode(basename($book['file_path'])) . "\"");
        header('X-Content-Type-Options: nosniff');
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
        header('Content-Type: ' . $types[$ext]);
        header('Content-Length: ' . filesize($file));
        header('Cache-Control: private, max-age=86400');
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
            $sql .= " WHERE b.title LIKE :q OR b.author LIKE :q";
        }
        $sql .= " ORDER BY b.id DESC";

        $stmt = $db->prepare($sql);
        $params = [':uid' => $userId ?? 0];
        if (!empty($query)) $params[':q'] = "%{$query}%";
        $stmt->execute($params);
        $books = $stmt->fetchAll();

        // One-time metadata repair for old EPUBs (author/cover missing). Bounded work per request:
        // each book is attempted once (meta_checked) and at most 3 per catalog load.
        $coverDir = dirname(__DIR__, 2) . '/data/covers/';
        $repairBudget = 3;

        // Without PHP's zip extension EPUBs can't be opened: don't mark them as checked
        // (they would never get a cover), just say so once in the error log.
        if (!class_exists('ZipArchive')) {
            require_once __DIR__ . '/debug_logger.php';
            $repairBudget = 0;
            if (array_filter($books, fn($x) => $x['format'] === 'epub' && (int)($x['meta_checked'] ?? 0) === 0)) {
                logSystemError('EPUB_META', 'PHP zip extension missing (apt install php-zip): EPUB covers and authors cannot be read');
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

            $meta = readEpubMetadata($b['file_path']);
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
            $b['cover_path'] = !empty($b['cover_path']) ? '../api/books.php?action=cover&id=' . (int)$b['id'] : '';
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
                $meta = readEpubMetadata($targetPath);
                if ($meta['title'] !== null) $title = $meta['title'];
                if ($meta['author'] !== null) $author = $meta['author'];

                if ($meta['cover_data'] !== null) {
                    $coverFileName = $uniquePrefix . '_' . $safeName . '_cover.' . $meta['cover_ext'];
                    if (file_put_contents($coverDir . $coverFileName, $meta['cover_data']) !== false) {
                        $coverRelPath = '../data/covers/' . $coverFileName;
                    }
                }
            }

            $stmt = $db->prepare("INSERT INTO books (title, author, description, format, file_path, cover_path, file_size, uploaded_by, meta_checked)
                                  VALUES (:t, :a, '', :f, :fp, :cp, :fs, :ub, 1)");
            $stmt->execute([
                ':t' => $title,
                ':a' => $author,
                ':f' => $ext,
                ':fp' => $targetPath,
                ':cp' => $coverRelPath,
                ':fs' => filesize($targetPath),
                ':ub' => $username
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