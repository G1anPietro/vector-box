<?php
// public/api/books.php
require_once __DIR__ . '/database.php';

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
        header("Content-Disposition: {$disposition}; filename=\"" . basename($book['file_path']) . "\"");
        readfile($book['file_path']);
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

        // Repair existing books missing covers or clean titles
        $coverDir = dirname(__DIR__, 2) . '/data/covers/';
        if (!file_exists($coverDir)) mkdir($coverDir, 0777, true);

        foreach ($books as &$b) {
            if (($b['author'] === 'Unknown' || empty($b['cover_path'])) && $b['format'] === 'epub' && file_exists($b['file_path'])) {
                if (class_exists('ZipArchive')) {
                    $zip = new ZipArchive();
                    if ($zip->open($b['file_path']) === true) {
                        $containerXml = $zip->getFromName('META-INF/container.xml');
                        if ($containerXml) {
                            $container = simplexml_load_string($containerXml);
                            $opfPath = (string)$container->rootfiles->rootfile['full-path'];
                            $opfContent = $zip->getFromName($opfPath);
                            if ($opfContent) {
                                $opf = simplexml_load_string($opfContent);
                                $opf->registerXPathNamespace('dc', 'http://purl.org/dc/elements/1.1/');
                                
                                $creatorNodes = $opf->xpath('//dc:creator');
                                $newAuthor = !empty($creatorNodes) ? (string)$creatorNodes[0] : $b['author'];

                                $opfDir = dirname($opfPath);
                                $opfDir = ($opfDir === '.') ? '' : $opfDir . '/';
                                $metaCover = $opf->xpath('//meta[@name="cover"]/@content');
                                $newCover = $b['cover_path'];

                                if (!empty($metaCover)) {
                                    $coverId = (string)$metaCover[0];
                                    $coverHref = $opf->xpath("//item[@id='{$coverId}']/@href");
                                    if (!empty($coverHref)) {
                                        $coverPathInZip = $opfDir . (string)$coverHref[0];
                                        $coverData = $zip->getFromName($coverPathInZip);
                                        if ($coverData) {
                                            $coverExt = pathinfo($coverPathInZip, PATHINFO_EXTENSION) ?: 'jpg';
                                            $coverFileName = $b['id'] . '_cover.' . $coverExt;
                                            file_put_contents($coverDir . $coverFileName, $coverData);
                                            $newCover = '../data/covers/' . $coverFileName;
                                        }
                                    }
                                }

                                // Update DB entry
                                $uStmt = $db->prepare("UPDATE books SET author = :a, cover_path = :c WHERE id = :id");
                                $uStmt->execute([':a' => $newAuthor, ':c' => $newCover, ':id' => $b['id']]);
                                $b['author'] = $newAuthor;
                                $b['cover_path'] = $newCover;
                            }
                        }
                        $zip->close();
                    }
                }
            }
        }

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

        $uploadDir = dirname(__DIR__, 2) . '/data/books/';
        $coverDir  = dirname(__DIR__, 2) . '/data/covers/';

        if (!file_exists($uploadDir)) mkdir($uploadDir, 0777, true);
        if (!file_exists($coverDir)) mkdir($coverDir, 0777, true);

        $safeName = preg_replace('/[^a-zA-Z0-9_\-]/', '_', pathinfo($file['name'], PATHINFO_FILENAME));
        $targetFileName = time() . '_' . $safeName . '.' . $ext;
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

            if ($ext === 'epub' && class_exists('ZipArchive')) {
                $zip = new ZipArchive();
                if ($zip->open($targetPath) === true) {
                    $containerXml = $zip->getFromName('META-INF/container.xml');
                    if ($containerXml) {
                        $container = simplexml_load_string($containerXml);
                        $opfPath = (string)$container->rootfiles->rootfile['full-path'];
                        $opfContent = $zip->getFromName($opfPath);
                        if ($opfContent) {
                            $opf = simplexml_load_string($opfContent);
                            $opf->registerXPathNamespace('dc', 'http://purl.org/dc/elements/1.1/');
                            
                            $titleNodes = $opf->xpath('//dc:title');
                            if (!empty($titleNodes)) $title = (string)$titleNodes[0];

                            $creatorNodes = $opf->xpath('//dc:creator');
                            if (!empty($creatorNodes)) $author = (string)$creatorNodes[0];

                            $opfDir = dirname($opfPath);
                            $opfDir = ($opfDir === '.') ? '' : $opfDir . '/';
                            $metaCover = $opf->xpath('//meta[@name="cover"]/@content');
                            if (!empty($metaCover)) {
                                $coverId = (string)$metaCover[0];
                                $coverHref = $opf->xpath("//item[@id='{$coverId}']/@href");
                                if (!empty($coverHref)) {
                                    $coverPathInZip = $opfDir . (string)$coverHref[0];
                                    $coverData = $zip->getFromName($coverPathInZip);
                                    if ($coverData) {
                                        $coverExt = pathinfo($coverPathInZip, PATHINFO_EXTENSION) ?: 'jpg';
                                        $coverFileName = time() . '_' . $safeName . '_cover.' . $coverExt;
                                        file_put_contents($coverDir . $coverFileName, $coverData);
                                        $coverRelPath = '../data/covers/' . $coverFileName;
                                    }
                                }
                            }
                        }
                    }
                    $zip->close();
                }
            }

            $stmt = $db->prepare("INSERT INTO books (title, author, description, format, file_path, cover_path, file_size, uploaded_by) 
                                  VALUES (:t, :a, '', :f, :fp, :cp, :fs, :ub)");
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
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}