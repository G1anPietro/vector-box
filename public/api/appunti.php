<?php
// public/api/appunti.php
// Study material and calendar of a class. Members only (the admin sees every class).
//
// GET  ?action=lessons&class_id=ID&date=YYYY-MM-DD    -> that day's lessons (merged hours)
// GET  ?action=suggest&class_id=ID&ts=UNIX             -> the lesson a moment belongs to (photo time / now)
// GET  ?action=items&class_id=ID[&subject_id&from&to&kind]
// GET  ?action=file&id=ID                              -> download one file
// GET  ?action=events&class_id=ID[&from&to]            -> calendar
// GET  ?action=usage&class_id=ID                       -> space used and limits
// GET  ?action=docs&class_id=ID[&subject_id]           -> AI documents (without their text) + AI status
// GET  ?action=doc&id=ID                               -> one AI document with its text and sources
// GET  ?action=zip&class_id=ID&scope=day&date=D[&subject_id] | scope=subject&subject_id | scope=event&event_id
//                                                      -> everything as a .zip with an index and a PROMPT.txt
// POST multipart {action:"upload", class_id, subject_id, kind, lesson_date, period?, title?, body?, files[]}
// POST JSON {action:"edit_item", id, subject_id, kind, lesson_date, period, title, body} | {action:"delete_item", id}
//           {action:"add_event", class_id, subject_id, kind, date, title, topics}
//           {action:"edit_event", id, ...same fields} | {action:"delete_event", id}
//           {action:"generate", class_id}  -> asks the AI worker to run now (once an hour per class)
// POST multipart/JSON {action:"upload_doc", class_id, kind, target:"lesson"|"event", subject_id, lesson_date | event_id,
//                      title, content (or file .md/.txt)} -> a study document made with another AI
//      {action:"delete_doc", id}  -> only documents uploaded by hand (author or manager)
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/rate_limiter.php';
require_once __DIR__ . '/appunti_lib.php';
require_once __DIR__ . '/gemini.php';

const AI_MANUAL_EVERY_SEC = 3600;   // "Genera ora": once an hour per class

initSession();
requireLogin();

$me = (int)$_SESSION['user_id'];
$isAdmin = !empty($_SESSION['is_admin']);

function apFail(string $code, string $message, int $status = 400): void {
    header('Cache-Control: no-store');
    jsonResponse(['success' => false, 'code' => $code, 'error' => $message], $status);
}

/** An active class the caller belongs to (or any class for the admin). Returns [class, canManage]. */
function apClass(PDO $db, int $id, int $me, bool $isAdmin): array {
    $class = classLoad($db, $id);
    if (!$class || $class['status'] !== 'active' || (!$isAdmin && !classIsMember($db, $id, $me))) {
        apFail('not_found', 'Class not found', 404);
    }
    return [$class, $isAdmin || (int)$class['manager_id'] === $me];
}

function apText($v, int $max, bool $multiline = false): string {
    $pattern = $multiline ? '/[\x00-\x08\x0B-\x1F\x7F]+/u' : '/[\x00-\x1F\x7F]+/u';
    $s = trim(preg_replace($pattern, ' ', str_replace("\r\n", "\n", (string)$v)) ?? '');
    return textCut($s, $max);
}

/** Validated item fields from a request. Returns the array or stops with 400. */
function apItemFields(PDO $db, array $class, array $in): array {
    $subjectId = (int)($in['subject_id'] ?? 0);
    if (!notesSubjectOf($db, (int)$class['id'], $subjectId)) apFail('bad_subject', 'Choose a subject of this class');
    $kind = (string)($in['kind'] ?? 'appunti');
    if (!in_array($kind, NOTE_KINDS, true)) apFail('bad_kind', 'Unknown type of material');
    $date = (string)($in['lesson_date'] ?? '');
    if (!classValidDate($date)) apFail('bad_date', 'Date must be YYYY-MM-DD');
    $period = ($in['period'] ?? '') === '' || ($in['period'] ?? null) === null ? null : (int)$in['period'];
    if ($period !== null && ($period < 1 || $period > CLASS_MAX_PERIODS)) apFail('bad_period', 'Invalid lesson hour');
    $body = (string)($in['body'] ?? '');
    if (textLength($body) > NOTE_BODY_MAX) apFail('too_long', 'Text is too long (max ' . NOTE_BODY_MAX . ' characters)');
    return [
        'subject_id' => $subjectId, 'kind' => $kind, 'lesson_date' => $date, 'period' => $period,
        'title' => apText($in['title'] ?? '', NOTE_TITLE_MAX), 'body' => apText($body, NOTE_BODY_MAX, true),
    ];
}

function apEventFields(PDO $db, array $class, array $in): array {
    $subjectId = (int)($in['subject_id'] ?? 0);
    if (!notesSubjectOf($db, (int)$class['id'], $subjectId)) apFail('bad_subject', 'Choose a subject of this class');
    $kind = (string)($in['kind'] ?? '');
    if (!in_array($kind, EVENT_KINDS, true)) apFail('bad_kind', 'Unknown type of date');
    $date = (string)($in['date'] ?? '');
    if (!classValidDate($date)) apFail('bad_date', 'Date must be YYYY-MM-DD');
    return [
        'subject_id' => $subjectId, 'kind' => $kind, 'event_date' => $date,
        'title' => apText($in['title'] ?? '', NOTE_TITLE_MAX),
        'topics' => apText($in['topics'] ?? '', EVENT_TOPICS_MAX, true),
    ];
}

function apLoadItem(PDO $db, int $id): ?array {
    $st = $db->prepare('SELECT * FROM class_items WHERE id = :id');
    $st->execute([':id' => $id]);
    return $st->fetch() ?: null;
}

function apDeleteFiles(PDO $db, int $itemId): void {
    $st = $db->prepare('SELECT class_id, stored_name FROM class_item_files WHERE item_id = :i');
    $st->execute([':i' => $itemId]);
    foreach ($st->fetchAll() as $f) @unlink(notesDir((int)$f['class_id']) . '/' . basename($f['stored_name']));
    $db->prepare('DELETE FROM class_item_files WHERE item_id = :i')->execute([':i' => $itemId]);
}

try {
    $db = getDbConnection();

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $action = (string)($_GET['action'] ?? '');

        if ($action === 'file') {
            $st = $db->prepare('SELECT * FROM class_item_files WHERE id = :id');
            $st->execute([':id' => (int)($_GET['id'] ?? 0)]);
            $file = $st->fetch();
            if (!$file) apFail('not_found', 'File not found', 404);
            apClass($db, (int)$file['class_id'], $me, $isAdmin);
            $path = notesDir((int)$file['class_id']) . '/' . basename($file['stored_name']);
            if (!is_file($path)) apFail('not_found', 'File not found', 404);

            $inline = str_starts_with($file['mime'], 'image/') || $file['mime'] === 'application/pdf';
            $name = str_replace(['"', '\\'], '', $file['original_name']);
            header('Content-Type: ' . $file['mime']);
            header('Content-Length: ' . filesize($path));
            header('Content-Disposition: ' . ($inline ? 'inline' : 'attachment') . '; filename="' . rawurlencode($name)
                   . '"; filename*=UTF-8\'\'' . rawurlencode($name));
            header('X-Content-Type-Options: nosniff');
            header('Cache-Control: private, max-age=3600');
            if (str_starts_with($file['mime'], 'image/')) header("Content-Security-Policy: sandbox; default-src 'none'");
            readfile($path);
            exit();
        }

        header('Cache-Control: no-store');

        if ($action === 'doc') {
            $st = $db->prepare('SELECT d.*, s.name AS subject FROM class_docs d LEFT JOIN class_subjects s ON s.id = d.subject_id WHERE d.id = :id');
            $st->execute([':id' => (int)($_GET['id'] ?? 0)]);
            $doc = $st->fetch();
            if (!$doc) apFail('not_found', 'Not found', 404);
            apClass($db, (int)$doc['class_id'], $me, $isAdmin);
            $by = null;
            if ($doc['author_id'] !== null) {
                $a = $db->prepare('SELECT username FROM accounts WHERE id = :id');
                $a->execute([':id' => $doc['author_id']]);
                $by = $a->fetchColumn() ?: '?';
            }
            jsonResponse(['success' => true, 'doc' => [
                'id' => (int)$doc['id'], 'kind' => $doc['kind'], 'author' => $by, 'manual' => $doc['author_id'] !== null, 'subject_id' => (int)$doc['subject_id'], 'subject' => $doc['subject'],
                'lesson_date' => $doc['lesson_date'], 'event_id' => $doc['event_id'] !== null ? (int)$doc['event_id'] : null,
                'title' => $doc['title'], 'content' => $doc['content'], 'sources' => json_decode($doc['sources'], true) ?: [],
                'status' => $doc['status'], 'updated_at' => (int)$doc['updated_at'],
            ]]);
        }

        [$class, $canManage] = apClass($db, (int)($_GET['class_id'] ?? 0), $me, $isAdmin);
        $classId = (int)$class['id'];

        if ($action === 'lessons') {
            $date = (string)($_GET['date'] ?? '');
            if (!classValidDate($date)) apFail('bad_date', 'Date must be YYYY-MM-DD');
            jsonResponse(['success' => true, 'date' => $date, 'lessons' => notesLessonsOn($db, $class, $date)]);
        }

        if ($action === 'suggest') {
            $ts = (int)($_GET['ts'] ?? 0);
            // Photo times far in the future (wrong phone clock) fall back to now
            if ($ts <= 0 || $ts > time() + 86400) $ts = time();
            jsonResponse(['success' => true] + notesSuggest($db, $class, $ts));
        }

        if ($action === 'items') {
            $where = ['i.class_id = :c'];
            $params = [':c' => $classId];
            if (!empty($_GET['subject_id'])) { $where[] = 'i.subject_id = :s'; $params[':s'] = (int)$_GET['subject_id']; }
            if (!empty($_GET['kind']) && in_array($_GET['kind'], NOTE_KINDS, true)) { $where[] = 'i.kind = :k'; $params[':k'] = $_GET['kind']; }
            foreach (['from' => '>=', 'to' => '<='] as $k => $op) {
                $v = (string)($_GET[$k] ?? '');
                if ($v !== '' && classValidDate($v)) { $where[] = "i.lesson_date $op :$k"; $params[":$k"] = $v; }
            }
            $st = $db->prepare('SELECT i.*, s.name AS subject, a.username AS author FROM class_items i
                                LEFT JOIN class_subjects s ON s.id = i.subject_id LEFT JOIN accounts a ON a.id = i.author_id
                                WHERE ' . implode(' AND ', $where) . ' ORDER BY i.lesson_date DESC, i.id DESC LIMIT 300');
            $st->execute($params);
            $items = $st->fetchAll();

            $files = [];
            if ($items) {
                $ids = implode(',', array_map(fn($i) => (int)$i['id'], $items));
                foreach ($db->query("SELECT * FROM class_item_files WHERE item_id IN ($ids) ORDER BY id")->fetchAll() as $f) {
                    $files[(int)$f['item_id']][] = $f;
                }
            }
            jsonResponse(['success' => true, 'items' => array_map(
                fn($i) => notesFormatItem($i, $files[(int)$i['id']] ?? [], $me, $canManage), $items)]);
        }

        if ($action === 'events') {
            $today = classToday($class);
            $from = (string)($_GET['from'] ?? '');
            $to = (string)($_GET['to'] ?? '');
            if (!classValidDate($from)) $from = (new DateTimeImmutable($today))->modify('-60 days')->format('Y-m-d');
            if (!classValidDate($to)) $to = (new DateTimeImmutable($today))->modify('+180 days')->format('Y-m-d');
            $st = $db->prepare('SELECT e.*, s.name AS subject, a.username AS author FROM class_events e
                                LEFT JOIN class_subjects s ON s.id = e.subject_id LEFT JOIN accounts a ON a.id = e.author_id
                                WHERE e.class_id = :c AND e.event_date BETWEEN :f AND :t ORDER BY e.event_date, e.id LIMIT 500');
            $st->execute([':c' => $classId, ':f' => $from, ':t' => $to]);
            jsonResponse(['success' => true, 'today' => $today, 'events' => array_map(
                fn($e) => notesFormatEvent($e, $me, $canManage), $st->fetchAll())]);
        }

        if ($action === 'docs') {
            $where = 'd.class_id = :c';
            $params = [':c' => $classId];
            if (!empty($_GET['subject_id'])) { $where .= ' AND d.subject_id = :s'; $params[':s'] = (int)$_GET['subject_id']; }
            $st = $db->prepare("SELECT d.id, d.kind, d.subject_id, d.lesson_date, d.event_id, d.title, d.status, d.updated_at, d.author_id,
                                       s.name AS subject, a.username AS author
                                FROM class_docs d LEFT JOIN class_subjects s ON s.id = d.subject_id LEFT JOIN accounts a ON a.id = d.author_id
                                WHERE $where ORDER BY COALESCE(d.lesson_date, '') DESC, d.id DESC LIMIT 300");
            $st->execute($params);
            $pending = $db->prepare("SELECT COUNT(*) FROM class_item_files WHERE class_id = :c AND text_status = 'pending'");
            $pending->execute([':c' => $classId]);
            $lastManual = (int)($class['ai_last_manual'] ?? 0);
            jsonResponse(['success' => true,
                'docs' => array_map(fn($d) => [
                    'id' => (int)$d['id'], 'kind' => $d['kind'], 'subject_id' => (int)$d['subject_id'], 'subject' => $d['subject'],
                    'lesson_date' => $d['lesson_date'], 'event_id' => $d['event_id'] !== null ? (int)$d['event_id'] : null,
                    'title' => $d['title'], 'status' => $d['status'], 'updated_at' => (int)$d['updated_at'],
                    'manual' => $d['author_id'] !== null, 'author' => $d['author'],
                    'can_delete' => $d['author_id'] !== null && ($canManage || (int)$d['author_id'] === $me),
                ], $st->fetchAll()),
                'ai' => [
                    'configured' => geminiConfigured(),
                    'requested' => !empty($class['ai_requested_at']),
                    'next_manual_at' => $lastManual ? $lastManual + AI_MANUAL_EVERY_SEC : 0,
                    'pending_files' => (int)$pending->fetchColumn(),
                    'summary_time' => $class['summary_time'],
                    'last_run' => json_decode((string)appSetting($db, 'ai_last_run:' . $classId, 'null'), true),
                ],
            ]);
        }

        if ($action === 'zip') {
            require_once __DIR__ . '/appunti_zip.php';
            if (!checkRateLimit('notes_zip', 20, 3600, 'user:' . $me)) apFail('slow_down', 'Too many downloads, try later', 429);
            $type = (string)($_GET['scope'] ?? '');
            $scope = ['type' => $type, 'subject_id' => (int)($_GET['subject_id'] ?? 0), 'date' => (string)($_GET['date'] ?? ''),
                      'event_id' => (int)($_GET['event_id'] ?? 0)];
            if ($type === 'day' && !classValidDate($scope['date'])) apFail('bad_date', 'Date must be YYYY-MM-DD');
            if ($type === 'subject' && !notesSubjectOf($db, $classId, $scope['subject_id'])) apFail('bad_subject', 'Choose a subject');
            if (!in_array($type, ['day', 'subject', 'event'], true)) apFail('bad_scope', 'Unknown scope');
            set_time_limit(120);
            $built = zipBuild($db, $class, $scope);
            if (is_string($built)) apFail('nothing', $built, 404);
            [$path, $name] = $built;
            header('Content-Type: application/zip');
            header('Content-Length: ' . filesize($path));
            header('Content-Disposition: attachment; filename="' . str_replace(['"', '\\'], '', $name) . '"; filename*=UTF-8\'\'' . rawurlencode($name));
            header('X-Content-Type-Options: nosniff');
            readfile($path);
            @unlink($path);
            exit();
        }

        if ($action === 'usage') {
            jsonResponse(['success' => true, 'used_bytes' => notesUsedBytes($db, $classId), 'limits_mb' => classLimits($db, $class)]);
        }

        apFail('unknown_action', 'Unknown action');
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') apFail('method', 'Method not allowed', 405);
    // A body over post_max_size arrives empty: say so instead of "unknown action"
    if (empty($_POST) && empty($_FILES) && (int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 0
        && str_starts_with((string)($_SERVER['CONTENT_TYPE'] ?? ''), 'multipart/')) {
        apFail('too_large', 'The upload is too large', 413);
    }
    requireCsrf();
    $isMultipart = str_starts_with((string)($_SERVER['CONTENT_TYPE'] ?? ''), 'multipart/');
    $in = $isMultipart ? $_POST : readJsonBody();
    $action = (string)($in['action'] ?? '');

    $restriction = accountRestriction($db, $me);
    if ($restriction) apFail('restricted', $restriction, 403);

    if ($action === 'upload') {
        [$class, ] = apClass($db, (int)($in['class_id'] ?? 0), $me, $isAdmin);
        $classId = (int)$class['id'];
        if (!checkRateLimit('notes_upload', 60, 3600, 'user:' . $me)) apFail('slow_down', 'Too many uploads, try later', 429);
        $fields = apItemFields($db, $class, $in);

        // Normalise files[] (PHP gives parallel arrays)
        $uploads = [];
        $raw = $_FILES['files'] ?? null;
        if (is_array($raw) && isset($raw['name'])) {
            $names = (array)$raw['name'];
            foreach ($names as $i => $name) {
                if ((int)((array)$raw['error'])[$i] === UPLOAD_ERR_NO_FILE) continue;
                $uploads[] = ['name' => (string)$name, 'tmp' => (string)((array)$raw['tmp_name'])[$i],
                              'size' => (int)((array)$raw['size'])[$i], 'error' => (int)((array)$raw['error'])[$i]];
            }
        }
        if (!$uploads && $fields['body'] === '') apFail('empty', 'Add a file or write some text');
        if (count($uploads) > NOTE_MAX_FILES) apFail('too_many_files', 'At most ' . NOTE_MAX_FILES . ' files at a time');

        $limits = classLimits($db, $class);
        $total = 0;
        foreach ($uploads as $u) {
            if (in_array($u['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true) || $u['size'] > $limits['file'] * 1048576) {
                apFail('file_too_large', "\"{$u['name']}\" is larger than {$limits['file']} MB", 413);
            }
            if ($u['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($u['tmp'])) apFail('upload_failed', "Upload of \"{$u['name']}\" failed");
            $total += $u['size'];
        }
        if (notesUsedBytes($db, $classId) + $total > $limits['class'] * 1048576) {
            apFail('class_full', 'The class has used all its space (' . $limits['class'] . ' MB)', 413);
        }

        // Check every file's real type before keeping any of them
        foreach ($uploads as $k => $u) {
            $type = notesFileType($u['tmp'], $u['name']);
            if (!$type) apFail('bad_type', "\"{$u['name']}\": use photos, PDF, text, Word/PowerPoint or LibreOffice files", 415);
            $uploads[$k]['type'] = $type;
        }

        $dir = notesDir($classId);
        if (!is_dir($dir) && !@mkdir($dir, 0750, true) && !is_dir($dir)) throw new RuntimeException('cannot create ' . $dir);
        $stored = [];
        try {
            foreach ($uploads as $u) {
                [$ext, $mime] = $u['type'];
                $name = bin2hex(random_bytes(16)) . '.' . $ext;
                if (!move_uploaded_file($u['tmp'], "$dir/$name")) throw new RuntimeException('move_uploaded_file failed');
                $stored[] = ['stored' => $name, 'original' => textCut(basename(str_replace('\\', '/', $u['name'])), 200),
                             'mime' => $mime, 'size' => $u['size'], 'ext' => $ext];
            }

            $now = time();
            $db->exec('BEGIN IMMEDIATE');
            $db->prepare('INSERT INTO class_items (class_id, subject_id, kind, lesson_date, period, title, body, author_id, source, created_at, updated_at)
                          VALUES (:c, :s, :k, :d, :p, :t, :b, :a, :src, :now, :now)')
               ->execute([':c' => $classId, ':s' => $fields['subject_id'], ':k' => $fields['kind'], ':d' => $fields['lesson_date'],
                          ':p' => $fields['period'], ':t' => $fields['title'], ':b' => $fields['body'], ':a' => $me,
                          ':src' => 'site', ':now' => $now]);
            $itemId = (int)$db->lastInsertId();
            $ins = $db->prepare('INSERT INTO class_item_files (item_id, class_id, stored_name, original_name, mime, size, text, text_status, created_at)
                                 VALUES (:i, :c, :n, :o, :m, :sz, :tx, :ts, :now)');
            foreach ($stored as $f) {
                [$text, $status] = notesExtractText("$dir/{$f['stored']}", $f['ext']);
                $ins->execute([':i' => $itemId, ':c' => $classId, ':n' => $f['stored'], ':o' => $f['original'], ':m' => $f['mime'],
                               ':sz' => $f['size'], ':tx' => $text, ':ts' => $status, ':now' => $now]);
            }
            $db->exec('COMMIT');
        } catch (Throwable $e) {
            if ($db->inTransaction()) $db->exec('ROLLBACK');
            foreach ($stored as $f) @unlink("$dir/{$f['stored']}");
            throw $e;
        }
        jsonResponse(['success' => true, 'id' => $itemId]);
    }

    if ($action === 'edit_item' || $action === 'delete_item') {
        $item = apLoadItem($db, (int)($in['id'] ?? 0));
        if (!$item) apFail('not_found', 'Not found', 404);
        [$class, $canManage] = apClass($db, (int)$item['class_id'], $me, $isAdmin);
        if (!$canManage && (int)$item['author_id'] !== $me) apFail('forbidden', 'Only the author or the class manager can change this', 403);

        if ($action === 'delete_item') {
            $db->exec('BEGIN IMMEDIATE');
            try {
                apDeleteFiles($db, (int)$item['id']);
                $db->prepare('DELETE FROM class_items WHERE id = :id')->execute([':id' => $item['id']]);
                $db->exec('COMMIT');
            } catch (Throwable $e) {
                $db->exec('ROLLBACK');
                throw $e;
            }
            jsonResponse(['success' => true]);
        }
        $f = apItemFields($db, $class, $in);
        $db->prepare('UPDATE class_items SET subject_id = :s, kind = :k, lesson_date = :d, period = :p, title = :t, body = :b, updated_at = :now
                      WHERE id = :id')
           ->execute([':s' => $f['subject_id'], ':k' => $f['kind'], ':d' => $f['lesson_date'], ':p' => $f['period'],
                      ':t' => $f['title'], ':b' => $f['body'], ':now' => time(), ':id' => $item['id']]);
        jsonResponse(['success' => true]);
    }

    if ($action === 'generate') {
        [$class, ] = apClass($db, (int)($in['class_id'] ?? 0), $me, $isAdmin);
        if (!geminiConfigured()) apFail('ai_off', 'The AI is not configured on this server', 503);
        // Atomic: only one request per hour per class wins
        $now = time();
        $st = $db->prepare('UPDATE school_classes SET ai_requested_at = :now, ai_last_manual = :now
                            WHERE id = :id AND (ai_last_manual IS NULL OR ai_last_manual <= :limit)');
        $st->execute([':now' => $now, ':id' => $class['id'], ':limit' => $now - AI_MANUAL_EVERY_SEC]);
        if ($st->rowCount() === 0) {
            $next = (int)$class['ai_last_manual'] + AI_MANUAL_EVERY_SEC;
            jsonResponse(['success' => false, 'code' => 'too_soon', 'error' => 'Already requested in the last hour', 'next_manual_at' => $next], 429);
        }
        jsonResponse(['success' => true, 'next_manual_at' => $now + AI_MANUAL_EVERY_SEC]);
    }

    if ($action === 'upload_doc') {
        require_once __DIR__ . '/appunti_ai.php';
        [$class, ] = apClass($db, (int)($in['class_id'] ?? 0), $me, $isAdmin);
        if (!checkRateLimit('notes_doc_upload', 30, 3600, 'user:' . $me)) apFail('slow_down', 'Too many uploads, try later', 429);
        $kind = (string)($in['kind'] ?? '');
        if (!in_array($kind, ['lezione', 'completo', 'riassunto', 'preparazione', 'quiz'], true)) apFail('bad_kind', 'Unknown type of document');
        $content = (string)($in['content'] ?? '');
        $file = $_FILES['file'] ?? null;
        if ($file && ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE) {
            if ($file['error'] !== UPLOAD_ERR_OK || $file['size'] > 2 * 1048576 || !is_uploaded_file($file['tmp_name'])
                || !preg_match('/\.(md|txt|json)$/i', (string)$file['name'])) apFail('bad_file', 'Upload a .md, .txt or .json file up to 2 MB');
            $content = (string)file_get_contents($file['tmp_name']);
        }
        if (!preg_match('//u', $content)) apFail('bad_file', 'The file must be UTF-8 text');
        $content = trim(str_replace("\r\n", "\n", $content));
        if ($content === '') apFail('empty', 'Paste the text or choose a file');
        if (textLength($content) > NOTE_TEXT_MAX) apFail('too_long', 'Document too long');
        if ($kind === 'quiz') {
            try { $content = aiCleanQuiz($content); } catch (GeminiError $e) { apFail('bad_quiz', 'The quiz must be the JSON written by the AI (PROMPT 4)'); }
        }
        $eventId = null;
        if (($in['target'] ?? '') === 'event') {
            $st = $db->prepare("SELECT * FROM class_events WHERE id = :id AND class_id = :c AND kind IN ('verifica', 'interrogazione')");
            $st->execute([':id' => (int)($in['event_id'] ?? 0), ':c' => $class['id']]);
            $ev = $st->fetch();
            if (!$ev) apFail('bad_event', 'Choose a test of this class');
            [$subjectId, $date, $eventId] = [(int)$ev['subject_id'], $ev['event_date'], (int)$ev['id']];
        } else {
            $subjectId = (int)($in['subject_id'] ?? 0);
            $date = (string)($in['lesson_date'] ?? '');
            if (!notesSubjectOf($db, (int)$class['id'], $subjectId)) apFail('bad_subject', 'Choose a subject of this class');
            if (!classValidDate($date)) apFail('bad_date', 'Date must be YYYY-MM-DD');
        }
        $subject = notesSubjectOf($db, (int)$class['id'], $subjectId)['name'];
        $labels = ['lezione' => 'Lezione', 'completo' => 'Completo', 'riassunto' => 'Riassunto', 'preparazione' => 'Preparazione mirata', 'quiz' => 'Quiz'];
        $title = apText($in['title'] ?? '', NOTE_TITLE_MAX);
        if ($title === '') $title = "$subject — {$labels[$kind]} del " . (new DateTimeImmutable($date))->format('d/m/Y');
        $now = time();
        $db->prepare("INSERT INTO class_docs (class_id, doc_key, subject_id, kind, lesson_date, event_id, title, content, sources, input_hash, model, status, author_id, created_at, updated_at)
                      VALUES (:c, :k, :s, :kind, :d, :e, :t, :content, '[]', '', 'manuale', 'ok', :a, :now, :now)")
           ->execute([':c' => $class['id'], ':k' => 'manuale:' . bin2hex(random_bytes(8)), ':s' => $subjectId, ':kind' => $kind,
                      ':d' => $date, ':e' => $eventId, ':t' => $title, ':content' => $content, ':a' => $me, ':now' => $now]);
        jsonResponse(['success' => true, 'id' => (int)$db->lastInsertId()]);
    }

    if ($action === 'delete_doc') {
        $st = $db->prepare('SELECT * FROM class_docs WHERE id = :id');
        $st->execute([':id' => (int)($in['id'] ?? 0)]);
        $doc = $st->fetch();
        if (!$doc) apFail('not_found', 'Not found', 404);
        [, $canManage] = apClass($db, (int)$doc['class_id'], $me, $isAdmin);
        if ($doc['author_id'] === null) apFail('forbidden', 'Documents written by the site\'s AI cannot be deleted', 403);
        if (!$canManage && (int)$doc['author_id'] !== $me) apFail('forbidden', 'Only the author or the class manager can delete this', 403);
        $db->prepare('DELETE FROM class_docs WHERE id = :id')->execute([':id' => $doc['id']]);
        jsonResponse(['success' => true]);
    }

    if ($action === 'add_event') {
        [$class, ] = apClass($db, (int)($in['class_id'] ?? 0), $me, $isAdmin);
        if (!checkRateLimit('class_event', 30, 3600, 'user:' . $me)) apFail('slow_down', 'Too many changes, try later', 429);
        $f = apEventFields($db, $class, $in);
        $db->prepare('INSERT INTO class_events (class_id, subject_id, kind, event_date, title, topics, author_id, created_at, updated_at)
                      VALUES (:c, :s, :k, :d, :t, :tp, :a, :now, :now)')
           ->execute([':c' => $class['id'], ':s' => $f['subject_id'], ':k' => $f['kind'], ':d' => $f['event_date'],
                      ':t' => $f['title'], ':tp' => $f['topics'], ':a' => $me, ':now' => time()]);
        jsonResponse(['success' => true, 'id' => (int)$db->lastInsertId()]);
    }

    if ($action === 'edit_event' || $action === 'delete_event') {
        $st = $db->prepare('SELECT * FROM class_events WHERE id = :id');
        $st->execute([':id' => (int)($in['id'] ?? 0)]);
        $event = $st->fetch();
        if (!$event) apFail('not_found', 'Not found', 404);
        [$class, $canManage] = apClass($db, (int)$event['class_id'], $me, $isAdmin);
        if (!$canManage && (int)$event['author_id'] !== $me) apFail('forbidden', 'Only the author or the class manager can change this', 403);
        if ($action === 'delete_event') {
            $db->prepare('DELETE FROM class_events WHERE id = :id')->execute([':id' => $event['id']]);
            $db->prepare('DELETE FROM class_docs WHERE event_id = :id')->execute([':id' => $event['id']]);
            jsonResponse(['success' => true]);
        }
        $f = apEventFields($db, $class, $in);
        $db->prepare('UPDATE class_events SET subject_id = :s, kind = :k, event_date = :d, title = :t, topics = :tp, updated_at = :now WHERE id = :id')
           ->execute([':s' => $f['subject_id'], ':k' => $f['kind'], ':d' => $f['event_date'], ':t' => $f['title'],
                      ':tp' => $f['topics'], ':now' => time(), ':id' => $event['id']]);
        jsonResponse(['success' => true]);
    }

    apFail('unknown_action', 'Unknown action');
} catch (Throwable $e) {
    failInternal('NOTES', $e);
}
