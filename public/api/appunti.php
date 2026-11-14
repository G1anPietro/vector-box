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
// GET  ?action=ai_pack&class_id=ID&scope=...           -> the same as ONE Markdown file (prompts + all text), for any AI
// GET  ?action=tree&class_id=ID                        -> subjects -> lesson days with counts, and counts by type (archive page)
// GET  ?action=file_text&id=ID                         -> the text of a file (extracted or transcribed), for previews
// POST multipart {action:"upload", class_id, subject_id, kind, lesson_date, period?, title?, body?, files[]}
// POST JSON {action:"edit_item", id, subject_id, kind, lesson_date, period, title, body} | {action:"delete_item", id}
//           {action:"add_event", class_id, subject_id, kind, date, title, topics, period_from?, period_to?}
//           {action:"edit_event", id, ...same fields} | {action:"delete_event", id}
//           {action:"generate", class_id, from?, to?}  -> asks the AI worker to run now (once an hour per class),
//                                       optionally on chosen lesson days (notes, questions, schemas of those days)
//           {action:"review_answer", doc_id, q, correct} -> spaced review of quiz questions (wrong ones come back)
// GET  ?action=review&class_id=ID                      -> my review questions due today
// POST multipart/JSON {action:"upload_doc", class_id, kind, target:"lesson"|"event", subject_id, lesson_date | event_id,
//                      title, content (or file .md/.txt)} -> a study document made with another AI
//      {action:"delete_doc", id}  -> a document: the AI's ones need the "docs" permission, hand-made ones also their author
//      resumable: {upload_begin, class_id, name, size, sha256?} -> {upload_id, chunk} | {duplicate}; multipart {upload_chunk, upload_id, offset, chunk};
//                 GET ?action=upload_status&upload_id; {upload_commit, class_id, upload_ids[], + item fields}; {upload_cancel, upload_id}
//      GET ?action=search&class_id&q&subject_id? -> full-text results (FTS5) with snippets ([[match]])
//      custom quiz: {custom_quiz_create, class_id, subject_id?, n, type: mc|tf|mix, from: all|prof|wrong}; {custom_quiz_answer, id, i, choice}; GET ?action=question_pool
//      {action:"delete_file", id}  -> one file of an item (author or "material" permission)
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/rate_limiter.php';
require_once __DIR__ . '/appunti_lib.php';
require_once __DIR__ . '/classifica_lib.php';
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

/** An active class the caller belongs to (or any class for the admin). Returns [class, my permissions]. */
function apClass(PDO $db, int $id, int $me, bool $isAdmin): array {
    $class = classLoad($db, $id);
    if (!$class || $class['status'] !== 'active' || (!$isAdmin && !classIsMember($db, $id, $me))) {
        apFail('not_found', 'Class not found', 404);
    }
    return [$class, classPerms($db, $class, $me, $isAdmin)];
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
    $auto = $kind === 'auto';          // "let the AI decide": saved as 'altro', the AI picks the type after reading it
    if ($auto) $kind = 'altro';
    if (!in_array($kind, NOTE_KINDS, true)) apFail('bad_kind', 'Unknown type of material');
    $date = (string)($in['lesson_date'] ?? '');
    if (!classValidDate($date)) apFail('bad_date', 'Date must be YYYY-MM-DD');
    $period = ($in['period'] ?? '') === '' || ($in['period'] ?? null) === null ? null : (int)$in['period'];
    if ($period !== null && ($period < 1 || $period > CLASS_MAX_PERIODS)) apFail('bad_period', 'Invalid lesson hour');
    $body = (string)($in['body'] ?? '');
    if (textLength($body) > NOTE_BODY_MAX) apFail('too_long', 'Text is too long (max ' . NOTE_BODY_MAX . ' characters)');
    return [
        'subject_id' => $subjectId, 'kind' => $kind, 'lesson_date' => $date, 'period' => $period,
        'title' => apText($in['title'] ?? '', NOTE_TITLE_MAX), 'body' => apText($body, NOTE_BODY_MAX, true), 'auto' => $auto,
    ];
}

function apEventFields(PDO $db, array $class, array $in): array {
    $subjectId = (int)($in['subject_id'] ?? 0);
    if (!notesSubjectOf($db, (int)$class['id'], $subjectId)) apFail('bad_subject', 'Choose a subject of this class');
    $kind = (string)($in['kind'] ?? '');
    if (!in_array($kind, EVENT_KINDS, true)) apFail('bad_kind', 'Unknown type of date');
    $date = (string)($in['date'] ?? '');
    if (!classValidDate($date)) apFail('bad_date', 'Date must be YYYY-MM-DD');
    // Optional study period: the material from..to (the topic may have started before the previous test, or a
    // new topic may start before this test). Empty = automatic (from the previous test of the subject).
    $pFrom = trim((string)($in['period_from'] ?? ''));
    $pTo = trim((string)($in['period_to'] ?? ''));
    if ($pFrom === '' && $pTo !== '') apFail('bad_period', 'Choose where the material starts');
    if ($pFrom !== '') {
        if ($pTo === '') $pTo = $date;
        if (!classValidDate($pFrom) || !classValidDate($pTo) || $pFrom > $pTo || $pTo > $date) apFail('bad_period', 'The material must go from a day to a later one, not after the test');
        if ((new DateTimeImmutable($pFrom))->diff(new DateTimeImmutable($pTo))->days > AI_PERIOD_MAX_DAYS * 3) apFail('bad_period', 'Period too long');
    }
    return [
        'subject_id' => $subjectId, 'kind' => $kind, 'event_date' => $date,
        'title' => apText($in['title'] ?? '', NOTE_TITLE_MAX),
        'topics' => apText($in['topics'] ?? '', EVENT_TOPICS_MAX, true),
        'period_from' => $pFrom !== '' ? $pFrom : null, 'period_to' => $pFrom !== '' ? $pTo : null,
        'topics_off' => json_encode(array_values(array_unique(array_map('intval', array_slice((array)($in['topics_off'] ?? []), 0, 50))))),
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

/** A quiz as the page may see it: the right answer and the explanation only for the questions this user already answered. */
function apQuizForUser(PDO $db, int $me, int $docId, string $content): string {
    $quiz = json_decode($content, true);
    if (!is_array($quiz) || !is_array($quiz['questions'] ?? null)) return $content;
    $st = $db->prepare('SELECT q_index, choice FROM quiz_answers WHERE user_id = :u AND doc_id = :d');
    $st->execute([':u' => $me, ':d' => $docId]);
    $mine = array_column($st->fetchAll(), 'choice', 'q_index');
    foreach ($quiz['questions'] as $i => &$q) {
        if (isset($mine[$i])) { $q['my_choice'] = (int)$mine[$i]; continue; }
        unset($q['answer'], $q['explanation']);
    }
    unset($q);
    $db->prepare('INSERT INTO quiz_seen (user_id, doc_id, seen_at) VALUES (:u, :d, :t) ON CONFLICT(user_id, doc_id) DO UPDATE SET seen_at = :t')
       ->execute([':u' => $me, ':d' => $docId, ':t' => time()]);
    return json_encode($quiz, JSON_UNESCAPED_UNICODE);
}

/**
 * Spaced review (Leitner boxes) for one question: a wrong answer puts it back to tomorrow, a right one in the review moves it to
 * the next box, after the last box it is learned. $card is the existing review card row or null. Returns [state, extra].
 */
function apLeitner(PDO $db, array $class, int $me, int $docId, int $q, ?array $card, ?array $question, bool $correct): array {
    $key = [':u' => $me, ':d' => $docId, ':q' => $q];
    if ($correct && !$card) return ['known', []];   // right at the first try
    $newBox = $correct ? (int)$card['box'] + 1 : 0;
    if ($newBox >= count(REVIEW_DAYS)) {
        $db->prepare('DELETE FROM review_cards WHERE user_id = :u AND doc_id = :d AND q_index = :q')->execute($key);
        return ['learned', []];
    }
    $due = (new DateTimeImmutable(classToday($class)))->modify('+' . REVIEW_DAYS[$newBox] . ' days')->format('Y-m-d');
    if ($card) {
        $db->prepare('UPDATE review_cards SET box = :b, due_date = :due, updated_at = :t, fails = fails + :f WHERE user_id = :u AND doc_id = :d AND q_index = :q')
           ->execute($key + [':b' => $newBox, ':due' => $due, ':t' => time(), ':f' => $correct ? 0 : 1]);
    } else {
        $db->prepare('INSERT INTO review_cards (user_id, doc_id, q_index, class_id, box, due_date, question, updated_at, fails) VALUES (:u, :d, :q, :c, :b, :due, :qq, :t, 1)')
           ->execute($key + [':c' => (int)$class['id'], ':b' => $newBox, ':due' => $due, ':qq' => json_encode($question, JSON_UNESCAPED_UNICODE), ':t' => time()]);
    }
    return ['review', ['box' => $newBox, 'due' => $due]];
}

/* ---------- resumable uploads: a file is sent in pieces into a temporary folder and kept until it is committed ---------- */
const UP_CHUNK = 2097152;          // size of a piece the page is told to send (2 MB: below any server limit)
const UP_MAX_OPEN = 40;            // unfinished uploads per user
const UP_KEEP_SEC = 86400;         // an abandoned upload is deleted after a day

function apTmpRoot(): string { return dirname(__DIR__, 2) . '/data/appunti-tmp'; }

/** The temp folder of one of MY uploads, or null when the id is not mine / unknown. */
function apTmpDir(int $me, string $id): ?string {
    if (!preg_match('/^[a-f0-9]{24}$/', $id)) return null;
    $dir = apTmpRoot() . "/$me/$id";
    return is_file("$dir/meta.json") ? $dir : null;
}

function apTmpMeta(string $dir): array {
    $m = json_decode((string)@file_get_contents("$dir/meta.json"), true);
    return is_array($m) ? $m : [];
}

function apTmpRemove(string $dir): void {
    foreach (glob("$dir/*") ?: [] as $f) @unlink($f);
    @rmdir($dir);
}

/** Deletes the unfinished uploads nobody touched for a day (done when someone starts a new one). */
function apTmpClean(): void {
    foreach (glob(apTmpRoot() . '/*/*', GLOB_ONLYDIR) ?: [] as $dir) {
        $t = (int)@filemtime(is_file("$dir/data.part") ? "$dir/data.part" : "$dir/meta.json");
        if ($t > 0 && $t < time() - UP_KEEP_SEC) apTmpRemove($dir);
    }
}

/**
 * Checks and stores the files of one upload and creates the item. $uploads: [{name, tmp, size, error, local?}]; `local` marks a
 * file assembled by the server from chunks (renamed instead of move_uploaded_file). Returns the new item id.
 */
function apCommitUploads(PDO $db, array $class, int $me, array $fields, array $uploads): int {
    $classId = (int)$class['id'];
    $limits = classLimits($db, $class);
    $total = 0;
    foreach ($uploads as $u) {
        if (in_array($u['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true) || $u['size'] > $limits['file'] * 1048576) {
            apFail('file_too_large', "\"{$u['name']}\" is larger than {$limits['file']} MB", 413);
        }
        if ($u['error'] !== UPLOAD_ERR_OK || empty($u['local']) && !is_uploaded_file($u['tmp'])) apFail('upload_failed', "Upload of \"{$u['name']}\" failed");
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
            if (!empty($u['local']) ? !rename($u['tmp'], "$dir/$name") : !move_uploaded_file($u['tmp'], "$dir/$name")) throw new RuntimeException('cannot store the file');
            $stored[] = ['stored' => $name, 'original' => textCut(basename(str_replace('\\', '/', $u['name'])), 200),
                         'mime' => $mime, 'size' => $u['size'], 'ext' => $ext, 'sha256' => (string)@hash_file('sha256', "$dir/$name")];
        }

        $now = time();
        $db->exec('BEGIN IMMEDIATE');
        $db->prepare('INSERT INTO class_items (class_id, subject_id, kind, lesson_date, period, title, body, author_id, source, created_at, updated_at, ai_state)
                      VALUES (:c, :s, :k, :d, :p, :t, :b, :a, :src, :now, :now, :ais)')
           ->execute([':c' => $classId, ':s' => $fields['subject_id'], ':k' => $fields['kind'], ':d' => $fields['lesson_date'],
                      ':p' => $fields['period'], ':t' => $fields['title'], ':b' => $fields['body'], ':a' => $me,
                      ':src' => 'site', ':now' => $now, ':ais' => !empty($fields['auto']) ? 'auto' : '']);
        $itemId = (int)$db->lastInsertId();
        $ins = $db->prepare('INSERT INTO class_item_files (item_id, class_id, stored_name, original_name, mime, size, text, text_status, created_at, sha256)
                             VALUES (:i, :c, :n, :o, :m, :sz, :tx, :ts, :now, :h)');
        foreach ($stored as $f) {
            [$text, $status] = notesExtractText("$dir/{$f['stored']}", $f['ext']);
            $ins->execute([':i' => $itemId, ':c' => $classId, ':n' => $f['stored'], ':o' => $f['original'], ':m' => $f['mime'],
                           ':sz' => $f['size'], ':tx' => $text, ':ts' => $status, ':now' => $now, ':h' => $f['sha256']]);
        }
        $db->exec('COMMIT');
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->exec('ROLLBACK');
        foreach ($stored as $f) @unlink("$dir/{$f['stored']}");
        throw $e;
    }
    return $itemId;
}

try {
    $db = getDbConnection();

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $action = (string)($_GET['action'] ?? '');

        if ($action === 'progress') {
            // Where I stopped reading a document (the same on every device)
            $ref = substr((string)($_GET['ref'] ?? ''), 0, 120);
            $st = $db->prepare('SELECT idx FROM read_progress WHERE user_id = :u AND ref = :r');
            $st->execute([':u' => $me, ':r' => $ref]);
            $v = $st->fetchColumn();
            jsonResponse(['success' => true, 'idx' => $v === false ? -1 : (int)$v]);
        }

        if ($action === 'upload_status') {
            // Where a resumable upload stopped (so the page can continue after a break or a reload)
            $dir = apTmpDir($me, (string)($_GET['upload_id'] ?? ''));
            if (!$dir) apFail('not_found', 'Unknown upload', 404);
            $meta = apTmpMeta($dir);
            clearstatcache(true, "$dir/data.part");
            jsonResponse(['success' => true, 'received' => is_file("$dir/data.part") ? (int)filesize("$dir/data.part") : 0, 'size' => (int)$meta['size'], 'name' => $meta['name']]);
        }

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

        if ($action === 'file_text') {
            $st = $db->prepare('SELECT id, class_id, original_name, mime, text, text_status FROM class_item_files WHERE id = :id');
            $st->execute([':id' => (int)($_GET['id'] ?? 0)]);
            $f = $st->fetch();
            if (!$f) apFail('not_found', 'File not found', 404);
            apClass($db, (int)$f['class_id'], $me, $isAdmin);
            jsonResponse(['success' => true, 'name' => $f['original_name'], 'mime' => $f['mime'],
                'status' => $f['text_status'], 'text' => $f['text_status'] === 'done' ? $f['text'] : null]);
        }

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
            $content = $doc['content'];
            if ($doc['kind'] === 'quiz' && $doc['status'] === 'ok') $content = apQuizForUser($db, $me, (int)$doc['id'], $content);
            jsonResponse(['success' => true, 'doc' => [
                'id' => (int)$doc['id'], 'kind' => $doc['kind'], 'author' => $by, 'manual' => $doc['author_id'] !== null, 'subject_id' => (int)$doc['subject_id'], 'subject' => $doc['subject'],
                'lesson_date' => $doc['lesson_date'], 'event_id' => $doc['event_id'] !== null ? (int)$doc['event_id'] : null,
                'title' => $doc['title'], 'content' => $content, 'sources' => json_decode($doc['sources'], true) ?: [],
                'status' => $doc['status'], 'updated_at' => (int)$doc['updated_at'],
            ]]);
        }

        [$class, $perms] = apClass($db, (int)($_GET['class_id'] ?? 0), $me, $isAdmin);
        $canManage = in_array('material', $perms, true);
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
            $st = $db->prepare('SELECT i.*, s.name AS subject, CASE WHEN LENGTH(cm.display_name) > 0 THEN cm.display_name ELSE a.username END AS author FROM class_items i
                                LEFT JOIN class_subjects s ON s.id = i.subject_id LEFT JOIN accounts a ON a.id = i.author_id LEFT JOIN class_members cm ON cm.class_id = i.class_id AND cm.user_id = i.author_id
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

        if ($action === 'review') {
            $today = classToday($class);
            $st = $db->prepare('SELECT r.doc_id, r.q_index, r.box, r.due_date, r.question, r.fails, d.title FROM review_cards r
                                LEFT JOIN class_docs d ON d.id = r.doc_id
                                WHERE r.user_id = :u AND r.class_id = :c ORDER BY r.due_date, r.doc_id, r.q_index');
            $st->execute([':u' => $me, ':c' => $classId]);
            $due = [];
            $later = 0;
            foreach ($st->fetchAll() as $r) {
                if ($r['due_date'] > $today) { $later++; continue; }
                $q = json_decode($r['question'], true);
                if (!is_array($q) || count($due) >= 30) continue;
                unset($q['answer'], $q['explanation']);   // the answer is given by the server when the question is answered
                $due[] = ['doc_id' => (int)$r['doc_id'], 'q' => (int)$r['q_index'], 'box' => (int)$r['box'], 'fails' => (int)$r['fails'], 'from' => $r['title'] ?? 'Quiz'] + $q;
            }
            jsonResponse(['success' => true, 'today' => $today, 'due' => $due, 'later' => $later]);
        }

        if ($action === 'events') {
            $today = classToday($class);
            $from = (string)($_GET['from'] ?? '');
            $to = (string)($_GET['to'] ?? '');
            if (!classValidDate($from)) $from = (new DateTimeImmutable($today))->modify('-60 days')->format('Y-m-d');
            if (!classValidDate($to)) $to = (new DateTimeImmutable($today))->modify('+180 days')->format('Y-m-d');
            $st = $db->prepare('SELECT e.*, s.name AS subject, CASE WHEN LENGTH(cm.display_name) > 0 THEN cm.display_name ELSE a.username END AS author FROM class_events e
                                LEFT JOIN class_subjects s ON s.id = e.subject_id LEFT JOIN accounts a ON a.id = e.author_id LEFT JOIN class_members cm ON cm.class_id = e.class_id AND cm.user_id = e.author_id
                                WHERE e.class_id = :c AND e.event_date BETWEEN :f AND :t ORDER BY e.event_date, e.id LIMIT 500');
            $st->execute([':c' => $classId, ':f' => $from, ':t' => $to]);
            jsonResponse(['success' => true, 'today' => $today, 'events' => array_map(
                fn($e) => notesFormatEvent($e, $me, in_array('calendar', $perms, true)) + ['period' => notesEventPeriod($db, $e)], $st->fetchAll())]);
        }

        if ($action === 'docs') {
            $where = 'd.class_id = :c';
            $params = [':c' => $classId];
            if (!empty($_GET['subject_id'])) { $where .= ' AND d.subject_id = :s'; $params[':s'] = (int)$_GET['subject_id']; }
            $st = $db->prepare("SELECT d.id, d.kind, d.subject_id, d.lesson_date, d.event_id, d.title, d.status, d.updated_at, d.author_id,
                                       s.name AS subject, CASE WHEN LENGTH(cm.display_name) > 0 THEN cm.display_name ELSE a.username END AS author
                                FROM class_docs d LEFT JOIN class_subjects s ON s.id = d.subject_id LEFT JOIN accounts a ON a.id = d.author_id LEFT JOIN class_members cm ON cm.class_id = d.class_id AND cm.user_id = d.author_id
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
                    'can_delete' => in_array('docs', $perms, true) || ($d['author_id'] !== null && (int)$d['author_id'] === $me),
                ], $st->fetchAll()),
                'ai' => [
                    'configured' => geminiConfigured(),
                    'requested' => !empty($class['ai_requested_at']),
                    'next_manual_at' => $lastManual ? $lastManual + AI_MANUAL_EVERY_SEC : 0,
                    'pending_files' => (int)$pending->fetchColumn(),
                    'summary_time' => $class['summary_time'],
                    'summary_on' => (json_decode((string)($class['settings'] ?? '{}'), true)['summary_on'] ?? true) !== false,
                    'last_run' => json_decode((string)appSetting($db, 'ai_last_run:' . $classId, 'null'), true),
                ],
            ]);
        }

        if ($action === 'tree') {
            $st = $db->prepare("SELECT i.subject_id, i.lesson_date, COUNT(DISTINCT i.id) AS items, COUNT(f.id) AS files
                                FROM class_items i LEFT JOIN class_item_files f ON f.item_id = i.id
                                WHERE i.class_id = :c GROUP BY i.subject_id, i.lesson_date");
            $st->execute([':c' => $classId]);
            $days = [];
            foreach ($st->fetchAll() as $r) {
                $days[(int)$r['subject_id']][$r['lesson_date']] = ['date' => $r['lesson_date'], 'items' => (int)$r['items'], 'files' => (int)$r['files'], 'docs' => 0];
            }
            $st = $db->prepare("SELECT subject_id, lesson_date, COUNT(*) AS n FROM class_docs
                                WHERE class_id = :c AND status = 'ok' AND kind = 'lezione' AND lesson_date IS NOT NULL GROUP BY subject_id, lesson_date");
            $st->execute([':c' => $classId]);
            foreach ($st->fetchAll() as $r) {
                $d = &$days[(int)$r['subject_id']][$r['lesson_date']];
                $d = ($d ?? ['date' => $r['lesson_date'], 'items' => 0, 'files' => 0, 'docs' => 0]);
                $d['docs'] = (int)$r['n'];
                unset($d);
            }
            $st = $db->prepare("SELECT subject_id, COUNT(*) FROM class_docs WHERE class_id = :c AND status = 'ok' AND event_id IS NOT NULL GROUP BY subject_id");
            $st->execute([':c' => $classId]);
            $testDocs = array_map('intval', $st->fetchAll(PDO::FETCH_KEY_PAIR));
            // Counts for the folders by type inside each subject
            $cats = [];
            $st = $db->prepare('SELECT subject_id, kind, COUNT(*) FROM class_items WHERE class_id = :c GROUP BY subject_id, kind');
            $st->execute([':c' => $classId]);
            foreach ($st->fetchAll(PDO::FETCH_NUM) as [$sid, $kind, $n]) $cats[(int)$sid][$kind] = (int)$n;
            $st = $db->prepare("SELECT i.subject_id, CASE WHEN f.mime LIKE 'image/%' THEN 'foto' WHEN f.mime LIKE 'audio/%' THEN 'audio' ELSE 'file' END, COUNT(*)
                                FROM class_item_files f JOIN class_items i ON i.id = f.item_id WHERE f.class_id = :c GROUP BY 1, 2");
            $st->execute([':c' => $classId]);
            foreach ($st->fetchAll(PDO::FETCH_NUM) as [$sid, $kind, $n]) $cats[(int)$sid][$kind] = (int)$n;
            $st = $db->prepare("SELECT subject_id, CASE WHEN kind = 'schema' THEN 'schemi' WHEN kind = 'domande' THEN 'domande_ai' WHEN event_id IS NOT NULL THEN 'verifiche' ELSE 'ai' END, COUNT(*)
                                FROM class_docs WHERE class_id = :c AND status = 'ok' GROUP BY 1, 2");
            $st->execute([':c' => $classId]);
            foreach ($st->fetchAll(PDO::FETCH_NUM) as [$sid, $kind, $n]) $cats[(int)$sid][$kind] = (int)$n;

            $subjects = [];
            foreach (classSubjects($db, $classId) as $sub) {
                $list = array_values($days[$sub['id']] ?? []);
                usort($list, fn($a, $b) => strcmp($b['date'], $a['date']));
                $subjects[] = ['id' => $sub['id'], 'name' => $sub['name'], 'days' => $list, 'test_docs' => $testDocs[$sub['id']] ?? 0,
                               'cats' => (object)($cats[$sub['id']] ?? [])];
            }
            jsonResponse(['success' => true, 'subjects' => $subjects]);
        }

        if ($action === 'ai_pack') {
            require_once __DIR__ . '/appunti_zip.php';
            if (!checkRateLimit('notes_zip', 20, 3600, 'user:' . $me)) apFail('slow_down', 'Too many downloads, try later', 429);
            $type = (string)($_GET['scope'] ?? '');
            $scope = ['type' => $type, 'subject_id' => (int)($_GET['subject_id'] ?? 0), 'date' => (string)($_GET['date'] ?? ''),
                      'event_id' => (int)($_GET['event_id'] ?? 0), 'audio' => !empty($_GET['audio'])];
            if (!in_array($type, ['day', 'subject', 'event'], true)) apFail('bad_scope', 'Unknown scope');
            if ($type === 'day' && !classValidDate($scope['date'])) apFail('bad_date', 'Date must be YYYY-MM-DD');
            if ($type === 'subject' && !notesSubjectOf($db, $classId, $scope['subject_id'])) apFail('bad_subject', 'Choose a subject');
            if (($_GET['format'] ?? '') === 'pdf') {
                set_time_limit(120);
                $built = packPdf($db, $class, $scope);
                if (is_string($built)) apFail('nothing', $built, 404);
                [$bytes, $name] = $built;
                header('Content-Type: application/pdf');
                header('Content-Length: ' . strlen($bytes));
                header('Content-Disposition: attachment; filename="' . str_replace(['"', '\\'], '', $name) . '"; filename*=UTF-8\'\'' . rawurlencode($name));
                header('X-Content-Type-Options: nosniff');
                echo $bytes;
                exit();
            }
            $built = packBuild($db, $class, $scope);
            if (is_string($built)) apFail('nothing', $built, 404);
            [$md, $name] = $built;
            header('Content-Type: text/markdown; charset=utf-8');
            header('Content-Disposition: attachment; filename="' . str_replace(['"', '\\'], '', $name) . '"; filename*=UTF-8\'\'' . rawurlencode($name));
            header('X-Content-Type-Options: nosniff');
            echo $md;
            exit();
        }

        if ($action === 'zip') {
            require_once __DIR__ . '/appunti_zip.php';
            if (!checkRateLimit('notes_zip', 20, 3600, 'user:' . $me)) apFail('slow_down', 'Too many downloads, try later', 429);
            $type = (string)($_GET['scope'] ?? '');
            $scope = ['type' => $type, 'subject_id' => (int)($_GET['subject_id'] ?? 0), 'date' => (string)($_GET['date'] ?? ''),
                      'event_id' => (int)($_GET['event_id'] ?? 0), 'audio' => !empty($_GET['audio'])];
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

        if ($action === 'search') {
            // Full-text search in the material of the class (typed notes, text of files, study documents): SQLite FTS5, no AI
            preg_match_all('/[\p{L}\p{N}]{2,}/u', (string)($_GET['q'] ?? ''), $m);
            $tokens = array_slice(array_values(array_unique($m[0])), 0, 8);
            if (!$tokens) jsonResponse(['success' => true, 'results' => []]);
            if (!checkRateLimit('notes_search', 120, 600, 'user:' . $me)) apFail('slow_down', 'Too many searches, try later', 429);
            $match = implode(' ', array_map(fn($t) => '"' . $t . '"*', $tokens));
            $sql = "SELECT ref, kind, subject_id, lesson_date, title, snippet(notes_fts, 1, '[[', ']]', '…', 18) AS snip
                    FROM notes_fts WHERE CAST(class_id AS INTEGER) = :c AND notes_fts MATCH :m" . (!empty($_GET['subject_id']) ? ' AND CAST(subject_id AS INTEGER) = :s' : '') . ' ORDER BY rank LIMIT 40';
            $st = $db->prepare($sql);
            $params = [':c' => $classId, ':m' => $match];
            if (!empty($_GET['subject_id'])) $params[':s'] = (int)$_GET['subject_id'];
            $st->execute($params);
            $names = array_column(classSubjects($db, $classId), 'name', 'id');
            $out = [];
            foreach ($st->fetchAll() as $r) {
                [$t, $id] = explode(':', (string)$r['ref'], 2);
                $row = ['kind' => $r['kind'], 'id' => (int)$id, 'title' => $r['title'], 'subject_id' => (int)$r['subject_id'], 'subject' => $names[(int)$r['subject_id']] ?? '?',
                        'lesson_date' => $r['lesson_date'], 'snippet' => $r['snip']];
                if ($t === 'f') {
                    $f = $db->prepare('SELECT f.id, f.original_name AS name, f.mime, f.size, f.text_status, f.item_id FROM class_item_files f WHERE f.id = :id');
                    $f->execute([':id' => $id]);
                    $row['file'] = $f->fetch() ?: null;
                    if (!$row['file']) continue;
                } elseif ($t === 'i') {
                    $i = $db->prepare('SELECT i.id, i.kind, i.title, i.body, CASE WHEN LENGTH(cm.display_name) > 0 THEN cm.display_name ELSE a.username END AS author FROM class_items i LEFT JOIN accounts a ON a.id = i.author_id
                                       LEFT JOIN class_members cm ON cm.class_id = i.class_id AND cm.user_id = i.author_id WHERE i.id = :id');
                    $i->execute([':id' => $id]);
                    $row['item'] = $i->fetch() ?: null;
                    if (!$row['item']) continue;
                } else {
                    $row['doc_kind'] = null;
                    $d = $db->prepare('SELECT kind, author_id FROM class_docs WHERE id = :id');
                    $d->execute([':id' => $id]);
                    $dd = $d->fetch();
                    if (!$dd) continue;
                    $row['doc_kind'] = $dd['kind'];
                    $row['manual'] = $dd['author_id'] !== null;
                }
                $out[] = $row;
            }
            jsonResponse(['success' => true, 'results' => $out]);
        }

        if ($action === 'question_pool') {
            // The open questions asked in class, with how many times each came up (the teacher's first)
            jsonResponse(['success' => true, 'questions' => notesAskedQuestions($db, $classId, (int)($_GET['subject_id'] ?? 0))]);
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

    if ($action === 'progress_set') {
        if (!checkRateLimit('read_progress', 600, 3600, 'user:' . $me)) apFail('slow_down', 'Too many updates', 429);
        $ref = substr((string)($in['ref'] ?? ''), 0, 120);
        $idx = (int)($in['idx'] ?? -1);
        if ($ref === '' || $idx < -1 || $idx > 500) apFail('bad_request', 'Bad request');
        $db->prepare('INSERT INTO read_progress (user_id, ref, idx, updated_at) VALUES (:u, :r, :i, :t) ON CONFLICT(user_id, ref) DO UPDATE SET idx = MAX(read_progress.idx, excluded.idx), updated_at = excluded.updated_at')
           ->execute([':u' => $me, ':r' => $ref, ':i' => $idx, ':t' => time()]);
        // keep the latest 300 per user
        $db->exec("DELETE FROM read_progress WHERE user_id = $me AND ref NOT IN (SELECT ref FROM read_progress WHERE user_id = $me ORDER BY updated_at DESC LIMIT 300)");
        jsonResponse(['success' => true]);
    }

    if ($action === 'upload_begin') {
        // Start (or recognise) one file of a resumable upload
        [$class, ] = apClass($db, (int)($in['class_id'] ?? 0), $me, $isAdmin);
        if (!checkRateLimit('notes_upload_begin', 300, 3600, 'user:' . $me)) apFail('slow_down', 'Too many uploads, try later', 429);
        $name = textCut(basename(str_replace('\\', '/', (string)($in['name'] ?? ''))), 200);
        $size = (int)($in['size'] ?? 0);
        $hash = strtolower((string)($in['sha256'] ?? ''));
        $limits = classLimits($db, $class);
        if ($name === '' || $size <= 0) apFail('bad_file', 'Empty file');
        if ($size > $limits['file'] * 1048576) apFail('file_too_large', "\"$name\" is larger than {$limits['file']} MB", 413);
        if (notesUsedBytes($db, (int)$class['id']) + $size > $limits['class'] * 1048576) apFail('class_full', 'The class has used all its space', 413);
        if (preg_match('/^[a-f0-9]{64}$/', $hash)) {
            $dup = $db->prepare('SELECT f.original_name, i.lesson_date FROM class_item_files f JOIN class_items i ON i.id = f.item_id WHERE f.class_id = :c AND f.sha256 = :h LIMIT 1');
            $dup->execute([':c' => $class['id'], ':h' => $hash]);
            if ($row = $dup->fetch()) jsonResponse(['success' => true, 'duplicate' => true, 'name' => $row['original_name'], 'lesson_date' => $row['lesson_date']]);
        }
        apTmpClean();
        $mine = glob(apTmpRoot() . "/$me/*", GLOB_ONLYDIR) ?: [];
        if (count($mine) >= UP_MAX_OPEN) apFail('too_many_open', 'Too many unfinished uploads: finish or cancel some');
        $id = bin2hex(random_bytes(12));
        $dir = apTmpRoot() . "/$me/$id";
        if (!@mkdir($dir, 0750, true) && !is_dir($dir)) throw new RuntimeException('cannot create ' . $dir);
        file_put_contents("$dir/meta.json", json_encode(['class_id' => (int)$class['id'], 'name' => $name, 'size' => $size, 'created' => time()]));
        jsonResponse(['success' => true, 'upload_id' => $id, 'received' => 0, 'chunk' => UP_CHUNK]);
    }

    if ($action === 'upload_chunk') {
        // One piece, at the exact offset where the server stopped: a repeated or out-of-order piece is refused with the right offset
        if (!checkRateLimit('notes_upload_chunk', 3000, 3600, 'user:' . $me)) apFail('slow_down', 'Too many uploads, try later', 429);
        $dir = apTmpDir($me, (string)($in['upload_id'] ?? ''));
        if (!$dir) apFail('not_found', 'Unknown upload', 404);
        $meta = apTmpMeta($dir);
        apClass($db, (int)$meta["class_id"], $me, $isAdmin);
        $part = $_FILES['chunk'] ?? null;
        if (!is_array($part) || $part['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($part['tmp_name']) || $part['size'] > 2 * UP_CHUNK) apFail('bad_chunk', 'Bad piece');
        clearstatcache(true, "$dir/data.part");
        $have = is_file("$dir/data.part") ? (int)filesize("$dir/data.part") : 0;
        if ((int)($in['offset'] ?? -1) !== $have) jsonResponse(['success' => false, 'code' => 'offset', 'error' => 'Wrong offset', 'received' => $have], 409);
        if ($have + $part['size'] > (int)$meta['size']) { apTmpRemove($dir); apFail('too_big', 'More data than announced', 413); }
        $fh = fopen("$dir/data.part", 'ab');
        if (!$fh || !flock($fh, LOCK_EX)) throw new RuntimeException('cannot write the piece');
        $src = fopen($part['tmp_name'], 'rb');
        stream_copy_to_stream($src, $fh);
        fclose($src);
        fflush($fh);
        flock($fh, LOCK_UN);
        fclose($fh);
        jsonResponse(['success' => true, 'received' => $have + (int)$part['size'], 'done' => $have + (int)$part['size'] === (int)$meta['size']]);
    }

    if ($action === 'upload_cancel') {
        $dir = apTmpDir($me, (string)($in['upload_id'] ?? ''));
        if ($dir) apTmpRemove($dir);
        jsonResponse(['success' => true]);
    }

    if ($action === 'upload_commit') {
        // All the files are here: make the item (same checks as a normal upload)
        [$class, ] = apClass($db, (int)($in['class_id'] ?? 0), $me, $isAdmin);
        if (!checkRateLimit('notes_upload', 60, 3600, 'user:' . $me)) apFail('slow_down', 'Too many uploads, try later', 429);
        $fields = apItemFields($db, $class, $in);
        $ids = is_array($in['upload_ids'] ?? null) ? array_values(array_unique(array_map('strval', $in['upload_ids']))) : [];
        if (!$ids && $fields['body'] === '') apFail('empty', 'Add a file or write some text');
        if (count($ids) > NOTE_MAX_FILES) apFail('too_many_files', 'At most ' . NOTE_MAX_FILES . ' files at a time');
        $uploads = [];
        $dirs = [];
        foreach ($ids as $id) {
            $dir = apTmpDir($me, $id);
            if (!$dir) apFail('not_found', 'Unknown upload', 404);
            $meta = apTmpMeta($dir);
            if ((int)$meta['class_id'] !== (int)$class['id']) apFail('not_found', 'Unknown upload', 404);
            clearstatcache(true, "$dir/data.part");
            $have = is_file("$dir/data.part") ? (int)filesize("$dir/data.part") : 0;
            if ($have !== (int)$meta['size']) jsonResponse(['success' => false, 'code' => 'incomplete', 'error' => 'A file is not complete', 'upload_id' => $id, 'received' => $have], 409);
            $uploads[] = ['name' => $meta['name'], 'tmp' => "$dir/data.part", 'size' => $have, 'error' => UPLOAD_ERR_OK, 'local' => true];
            $dirs[] = $dir;
        }
        $itemId = apCommitUploads($db, $class, $me, $fields, $uploads);
        foreach ($dirs as $d) apTmpRemove($d);
        jsonResponse(['success' => true, 'id' => $itemId]);
    }

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

        $itemId = apCommitUploads($db, $class, $me, $fields, $uploads);
        jsonResponse(['success' => true, 'id' => $itemId]);
    }

    if ($action === 'edit_item' || $action === 'delete_item') {
        $item = apLoadItem($db, (int)($in['id'] ?? 0));
        if (!$item) apFail('not_found', 'Not found', 404);
        [$class, $perms] = apClass($db, (int)$item['class_id'], $me, $isAdmin);
        if (!in_array('material', $perms, true) && (int)$item['author_id'] !== $me) apFail('forbidden', 'Only the author or the class manager can change this', 403);

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
            classLog($db, (int)$item['class_id'], $me, 'Appunti eliminati', ($item['title'] ?? '') . ' ' . ($item['lesson_date'] ?? ''));
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
        // Optional range of lesson days to (re)write: notes, questions and schemas of those days
        $rFrom = trim((string)($in['from'] ?? ''));
        $rTo = trim((string)($in['to'] ?? ''));
        if ($rFrom !== '' || $rTo !== '') {
            $today = classToday($class);
            if ($rTo === '') $rTo = $today;
            if (!classValidDate($rFrom) || !classValidDate($rTo) || $rFrom > $rTo || $rTo > $today) apFail('bad_range', 'Choose a start day before the end day, not in the future');
            if ((new DateTimeImmutable($rFrom))->diff(new DateTimeImmutable($rTo))->days > AI_RANGE_MAX_DAYS) apFail('bad_range', 'At most ' . AI_RANGE_MAX_DAYS . ' days at a time');
        } else {
            $rFrom = $rTo = null;
        }
        // Atomic: only one request per hour per class wins
        $now = time();
        $st = $db->prepare('UPDATE school_classes SET ai_requested_at = :now, ai_last_manual = :now, ai_range_from = :rf, ai_range_to = :rt
                            WHERE id = :id AND (ai_last_manual IS NULL OR ai_last_manual <= :limit)');
        $st->execute([':now' => $now, ':id' => $class['id'], ':limit' => $now - AI_MANUAL_EVERY_SEC, ':rf' => $rFrom, ':rt' => $rTo]);
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
        if (!in_array($kind, ['lezione', 'completo', 'riassunto', 'preparazione', 'quiz', 'schema'], true)) apFail('bad_kind', 'Unknown type of document');
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
        if ($kind === 'schema') {
            try { $content = aiCleanSchema($content); } catch (GeminiError $e) { apFail('bad_schema', 'The schema must be the JSON written by the AI (PROMPT 5)'); }
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
        $labels = ['lezione' => 'Lezione', 'completo' => 'Completo', 'riassunto' => 'Riassunto', 'preparazione' => 'Preparazione mirata', 'quiz' => 'Quiz', 'schema' => 'Schema'];
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
        [, $perms] = apClass($db, (int)$doc['class_id'], $me, $isAdmin);
        // Documents written by the AI only by who has the "docs" permission; hand-made ones also by their author
        $mayAll = in_array('docs', $perms, true);
        if (!$mayAll && ($doc['author_id'] === null || (int)$doc['author_id'] !== $me)) apFail('forbidden', 'You do not have the permission to delete this', 403);
        $db->exec('BEGIN IMMEDIATE');
        try {
            $db->prepare('DELETE FROM review_cards WHERE doc_id = :id')->execute([':id' => $doc['id']]);
            $db->prepare('DELETE FROM class_docs WHERE id = :id')->execute([':id' => $doc['id']]);
            $db->exec('COMMIT');
        } catch (Throwable $e) {
            $db->exec('ROLLBACK');
            throw $e;
        }
        classLog($db, (int)$doc['class_id'], $me, $doc['author_id'] === null ? 'Documento dell\'AI eliminato' : 'Documento eliminato', $doc['title'] ?? '');
        jsonResponse(['success' => true]);
    }

    if ($action === 'delete_file') {
        // One file of an item (a photo, a PDF, a recording). An item left with no file and no text goes away too.
        $st = $db->prepare('SELECT f.*, i.class_id AS item_class, i.author_id, i.body FROM class_item_files f JOIN class_items i ON i.id = f.item_id WHERE f.id = :id');
        $st->execute([':id' => (int)($in['id'] ?? 0)]);
        $f = $st->fetch();
        if (!$f) apFail('not_found', 'Not found', 404);
        [, $perms] = apClass($db, (int)$f['item_class'], $me, $isAdmin);
        if (!in_array('material', $perms, true) && (int)$f['author_id'] !== $me) apFail('forbidden', 'Only the author or who has the permission can delete this', 403);
        $db->exec('BEGIN IMMEDIATE');
        try {
            $db->prepare('DELETE FROM class_item_files WHERE id = :id')->execute([':id' => $f['id']]);
            $left = $db->prepare('SELECT COUNT(*) FROM class_item_files WHERE item_id = :i');
            $left->execute([':i' => $f['item_id']]);
            if ((int)$left->fetchColumn() === 0 && trim((string)$f['body']) === '') $db->prepare('DELETE FROM class_items WHERE id = :i')->execute([':i' => $f['item_id']]);
            $db->exec('COMMIT');
        } catch (Throwable $e) {
            $db->exec('ROLLBACK');
            throw $e;
        }
        @unlink(notesDir((int)$f['item_class']) . '/' . basename($f['stored_name']));
        classLog($db, (int)$f['item_class'], $me, 'File eliminato', $f['original_name'] ?? '');
        jsonResponse(['success' => true]);
    }

    if ($action === 'custom_quiz_create') {
        // A quiz made to measure from the class quizzes: how many questions, which subject, multiple choice / true-false / both, and from where
        // (all, the teacher's questions, the ones I get wrong). Questions are drawn at random, the ones I get wrong and the teacher's more often.
        [$class, ] = apClass($db, (int)($in['class_id'] ?? 0), $me, $isAdmin);
        if (!checkRateLimit('custom_quiz', 60, 3600, 'user:' . $me)) apFail('slow_down', 'Too many quizzes, try later', 429);
        $classId = (int)$class['id'];
        $subjectId = (int)($in['subject_id'] ?? 0);
        if ($subjectId && !notesSubjectOf($db, $classId, $subjectId)) apFail('bad_subject', 'Choose a subject');
        $n = max(5, min(50, (int)($in['n'] ?? 10)));
        $type = in_array($in['type'] ?? '', ['mc', 'tf', 'mix'], true) ? $in['type'] : 'mc';
        $from = in_array($in['from'] ?? '', ['all', 'prof', 'wrong'], true) ? $in['from'] : 'all';
        $pool = notesQuizPool($db, $classId, $subjectId);
        $wrong = [];
        foreach ($db->query("SELECT doc_id, q_index FROM review_cards WHERE user_id = $me AND class_id = $classId")->fetchAll() as $r) $wrong[$r['doc_id'] . ':' . $r['q_index']] = true;
        $right = [];
        foreach ($db->query("SELECT doc_id, q_index FROM quiz_answers WHERE user_id = $me AND class_id = $classId AND correct = 1")->fetchAll() as $r) $right[$r['doc_id'] . ':' . $r['q_index']] = true;
        if ($from === 'prof') $pool = array_values(array_filter($pool, fn($q) => $q['prof']));
        if ($from === 'wrong') $pool = array_values(array_filter($pool, fn($q) => isset($wrong[$q['doc_id'] . ':' . $q['q']])));
        if (!$pool) apFail('empty_pool', $from === 'wrong' ? 'You have no wrong questions to practise' : 'There are no quiz questions yet for this choice', 404);
        // weighted draw without repeats
        $weights = array_map(function ($q) use ($wrong, $right) {
            $k = $q['doc_id'] . ':' . $q['q'];
            return (isset($wrong[$k]) ? 3.0 : 1.0) * ($q['prof'] ? 2.0 : 1.0) * (isset($right[$k]) ? 0.5 : 1.0);
        }, $pool);
        $picked = [];
        for ($k = 0; $k < min($n, count($pool)); $k++) {
            $sum = array_sum($weights);
            $r = random_int(0, 1000000) / 1000000 * $sum;
            foreach ($weights as $i => $w) { $r -= $w; if ($r <= 0 || $i === array_key_last($weights)) { $picked[] = $pool[$i]; unset($weights[$i]); break; } }
        }
        $items = [];
        foreach ($picked as $q) {
            $asTf = $type === 'tf' || ($type === 'mix' && random_int(0, 1) === 1);
            if ($asTf) {
                // "<question> — <option>": true when the option is the right one, otherwise one of the wrong ones
                $isTrue = random_int(0, 1) === 1;
                $wrongs = array_values(array_diff(array_keys($q['options']), [$q['answer']]));
                $opt = $isTrue ? $q['answer'] : $wrongs[random_int(0, count($wrongs) - 1)];
                $items[] = ['type' => 'tf', 'question' => $q['question'] . ' — ' . $q['options'][$opt], 'options' => ['Vero', 'Falso'], 'answer' => $isTrue ? 0 : 1,
                            'explanation' => 'La risposta giusta a «' . $q['question'] . '» è «' . $q['options'][$q['answer']] . '».' . ($q['explanation'] !== '' ? ' ' . $q['explanation'] : ''),
                            'topic' => $q['topic'], 'prof' => $q['prof'], 'src' => [$q['doc_id'], $q['q']]];
            } else {
                $items[] = ['type' => 'mc', 'question' => $q['question'], 'options' => $q['options'], 'answer' => $q['answer'], 'explanation' => $q['explanation'],
                            'topic' => $q['topic'], 'prof' => $q['prof'], 'src' => [$q['doc_id'], $q['q']]];
            }
        }
        $db->prepare('INSERT INTO custom_quizzes (user_id, class_id, subject_id, items, created_at) VALUES (:u, :c, :s, :i, :t)')
           ->execute([':u' => $me, ':c' => $classId, ':s' => $subjectId ?: null, ':i' => json_encode($items, JSON_UNESCAPED_UNICODE), ':t' => time()]);
        $quizId = (int)$db->lastInsertId();
        // keep the latest 30 of each user
        $db->exec("DELETE FROM custom_quizzes WHERE user_id = $me AND id NOT IN (SELECT id FROM custom_quizzes WHERE user_id = $me ORDER BY id DESC LIMIT 30)");
        jsonResponse(['success' => true, 'id' => $quizId, 'pool' => count($pool), 'questions' => array_map(
            fn($q) => ['type' => $q['type'], 'question' => $q['question'], 'options' => $q['options'], 'topic' => $q['topic'], 'prof' => $q['prof']], $items)]);
    }

    if ($action === 'custom_quiz_answer') {
        if (!checkRateLimit('custom_answer', 1500, 3600, 'user:' . $me)) apFail('slow_down', 'Too many answers, try later', 429);
        $st = $db->prepare('SELECT * FROM custom_quizzes WHERE id = :id AND user_id = :u');
        $st->execute([':id' => (int)($in['id'] ?? 0), ':u' => $me]);
        $quiz = $st->fetch();
        if (!$quiz) apFail('not_found', 'Quiz not found', 404);
        [$class, ] = apClass($db, (int)$quiz['class_id'], $me, $isAdmin);
        $items = json_decode($quiz['items'], true) ?: [];
        $i = (int)($in['i'] ?? -1);
        $choice = (int)($in['choice'] ?? -1);
        if (!isset($items[$i]) || $choice < 0 || $choice >= count($items[$i]['options'])) apFail('bad_question', 'Unknown question');
        $item = $items[$i];
        $correct = $choice === (int)$item['answer'];
        $answered = json_decode($quiz['answered'], true) ?: [];
        $first = !isset($answered[$i]);
        if ($first) {
            $answered[$i] = $choice;
            $db->prepare('UPDATE custom_quizzes SET answered = :a WHERE id = :id')->execute([':a' => json_encode($answered), ':id' => $quiz['id']]);
            // a wrong answer puts the original question in the daily review (no points in a custom quiz: it is practice)
            if (!$correct && !empty($item['src'])) {
                [$docId, $qi] = $item['src'];
                $orig = $db->prepare("SELECT content FROM class_docs WHERE id = :id AND kind = 'quiz'");
                $orig->execute([':id' => $docId]);
                $oq = json_decode((string)$orig->fetchColumn(), true)['questions'][$qi] ?? null;
                if (is_array($oq)) {
                    $cur = $db->prepare('SELECT box, class_id FROM review_cards WHERE user_id = :u AND doc_id = :d AND q_index = :q');
                    $cur->execute([':u' => $me, ':d' => $docId, ':q' => $qi]);
                    apLeitner($db, $class, $me, (int)$docId, (int)$qi, $cur->fetch() ?: null, $oq, false);
                }
            }
        }
        jsonResponse(['success' => true, 'correct' => $correct, 'answer' => (int)$item['answer'], 'explanation' => (string)$item['explanation'], 'first' => $first, 'points' => 0]);
    }

    if ($action === 'quiz_answer') {
        // One answer to a question of a quiz. The server judges it. The FIRST answer ever to that question is kept and can give
        // points; later ones (practising again) only move the spaced review. Answers given too fast after opening the quiz or
        // after the previous answer give no points.
        if (!checkRateLimit('quiz_answer', 1500, 3600, 'user:' . $me)) apFail('slow_down', 'Too many answers, try later', 429);
        $docId = (int)($in['doc_id'] ?? 0);
        $q = (int)($in['q'] ?? -1);
        $choice = (int)($in['choice'] ?? -1);
        $st = $db->prepare("SELECT class_id, content FROM class_docs WHERE id = :id AND kind = 'quiz' AND status = 'ok'");
        $st->execute([':id' => $docId]);
        $doc = $st->fetch();
        if (!$doc) apFail('not_found', 'Quiz not found', 404);
        [$class, ] = apClass($db, (int)$doc['class_id'], $me, $isAdmin);
        $question = json_decode($doc['content'], true)['questions'][$q] ?? null;
        if ($q < 0 || !is_array($question) || $choice < 0 || $choice >= count($question['options'] ?? [])) apFail('bad_question', 'Unknown question');
        $correct = $choice === (int)$question['answer'];
        $now = time();

        $db->exec('BEGIN IMMEDIATE');
        try {
            $had = $db->prepare('SELECT choice FROM quiz_answers WHERE user_id = :u AND doc_id = :d AND q_index = :q');
            $had->execute([':u' => $me, ':d' => $docId, ':q' => $q]);
            $first = $had->fetchColumn() === false;
            $points = 0; $fast = false;
            if ($first) {
                $ref = $db->prepare('SELECT MAX(t) FROM (SELECT seen_at AS t FROM quiz_seen WHERE user_id = :u AND doc_id = :d UNION ALL SELECT MAX(answered_at) FROM quiz_answers WHERE user_id = :u)');
                $ref->execute([':u' => $me, ':d' => $docId]);
                $fast = $now - (int)$ref->fetchColumn() < SCORE_MIN_GAP;
                if ($correct && !$fast) $points = scoreAward($db, $class, $me, 'quiz', SCORE_QUIZ, "quiz:$docId:$q");
                $db->prepare('INSERT INTO quiz_answers (user_id, doc_id, q_index, class_id, choice, correct, points, answered_at) VALUES (:u, :d, :q, :c, :ch, :ok, :p, :t)')
                   ->execute([':u' => $me, ':d' => $docId, ':q' => $q, ':c' => $class['id'], ':ch' => $choice, ':ok' => $correct ? 1 : 0, ':p' => $points, ':t' => $now]);
            }
            $cur = $db->prepare('SELECT box, class_id FROM review_cards WHERE user_id = :u AND doc_id = :d AND q_index = :q');
            $cur->execute([':u' => $me, ':d' => $docId, ':q' => $q]);
            $card = $cur->fetch() ?: null;
            [$state] = apLeitner($db, $class, $me, $docId, $q, $card, $question, $correct);
            $db->exec('COMMIT');
        } catch (Throwable $e) {
            if ($db->inTransaction()) $db->exec('ROLLBACK');
            throw $e;
        }
        jsonResponse(['success' => true, 'correct' => $correct, 'answer' => (int)$question['answer'], 'explanation' => (string)($question['explanation'] ?? ''),
                      'first' => $first, 'points' => $points, 'too_fast' => $first && $correct && $fast, 'state' => $state]);
    }

    if ($action === 'review_answer') {
        // An answer in the daily review. The server judges it from its own copy of the question (the page only sends the choice).
        if (!checkRateLimit('review_answer', 1500, 3600, 'user:' . $me)) apFail('slow_down', 'Too many answers, try later', 429);
        $docId = (int)($in['doc_id'] ?? 0);
        $q = (int)($in['q'] ?? -1);
        $choice = (int)($in['choice'] ?? -1);
        $cur = $db->prepare('SELECT box, class_id, due_date, question FROM review_cards WHERE user_id = :u AND doc_id = :d AND q_index = :q');
        $cur->execute([':u' => $me, ':d' => $docId, ':q' => $q]);
        $card = $cur->fetch() ?: null;
        if (!$card) apFail('not_found', 'This question is not in your review', 404);
        [$class, ] = apClass($db, (int)$card['class_id'], $me, $isAdmin);
        $question = json_decode($card['question'], true);
        if (!is_array($question) || $choice < 0 || $choice >= count($question['options'] ?? [])) apFail('bad_question', 'Unknown question');
        $correct = $choice === (int)$question['answer'];
        $wasDue = $card['due_date'] <= classToday($class);
        $db->exec('BEGIN IMMEDIATE');
        try {
            $points = $correct && $wasDue ? scoreAward($db, $class, $me, 'review', SCORE_REVIEW, "review:$docId:$q:" . (int)$card['box']) : 0;
            [$state, $extra] = apLeitner($db, $class, $me, $docId, $q, $card, $question, $correct);
            $db->exec('COMMIT');
        } catch (Throwable $e) {
            if ($db->inTransaction()) $db->exec('ROLLBACK');
            throw $e;
        }
        jsonResponse(['success' => true, 'correct' => $correct, 'answer' => (int)$question['answer'], 'explanation' => (string)($question['explanation'] ?? ''),
                      'points' => $points, 'state' => $state] + $extra);
    }

    if ($action === 'add_event') {
        [$class, ] = apClass($db, (int)($in['class_id'] ?? 0), $me, $isAdmin);
        if (!checkRateLimit('class_event', 30, 3600, 'user:' . $me)) apFail('slow_down', 'Too many changes, try later', 429);
        $f = apEventFields($db, $class, $in);
        $db->prepare('INSERT INTO class_events (class_id, subject_id, kind, event_date, title, topics, period_from, period_to, topics_off, author_id, created_at, updated_at)
                      VALUES (:c, :s, :k, :d, :t, :tp, :pf, :pt, :off, :a, :now, :now)')
           ->execute([':c' => $class['id'], ':s' => $f['subject_id'], ':k' => $f['kind'], ':d' => $f['event_date'], ':off' => $f['topics_off'],
                      ':t' => $f['title'], ':tp' => $f['topics'], ':pf' => $f['period_from'], ':pt' => $f['period_to'], ':a' => $me, ':now' => time()]);
        // The topics of the subject still open end with their test (they can be reopened by editing them)
        if ($f['kind'] !== 'altro') {
            $off = json_decode($f['topics_off'], true);
            $open = $db->prepare("SELECT id FROM class_topics WHERE class_id = :c AND subject_id = :s AND status = 'ok' AND end_date IS NULL AND start_date <= :d");
            $open->execute([':c' => $class['id'], ':s' => $f['subject_id'], ':d' => $f['event_date']]);
            foreach ($open->fetchAll(PDO::FETCH_COLUMN) as $tid) {
                if (!in_array((int)$tid, $off, true)) $db->prepare('UPDATE class_topics SET end_date = :d, updated_at = :t WHERE id = :id')->execute([':d' => $f['event_date'], ':t' => time(), ':id' => $tid]);
            }
        }
        jsonResponse(['success' => true, 'id' => (int)$db->lastInsertId()]);
    }

    if ($action === 'edit_event' || $action === 'delete_event') {
        $st = $db->prepare('SELECT * FROM class_events WHERE id = :id');
        $st->execute([':id' => (int)($in['id'] ?? 0)]);
        $event = $st->fetch();
        if (!$event) apFail('not_found', 'Not found', 404);
        [$class, $perms] = apClass($db, (int)$event['class_id'], $me, $isAdmin);
        if (!in_array('calendar', $perms, true) && (int)$event['author_id'] !== $me) apFail('forbidden', 'Only the author or the class manager can change this', 403);
        if ($action === 'delete_event') {
            $db->prepare('DELETE FROM class_events WHERE id = :id')->execute([':id' => $event['id']]);
            $db->prepare('DELETE FROM class_docs WHERE event_id = :id')->execute([':id' => $event['id']]);
            jsonResponse(['success' => true]);
        }
        $f = apEventFields($db, $class, $in);
        $db->prepare('UPDATE class_events SET subject_id = :s, kind = :k, event_date = :d, title = :t, topics = :tp,
                      period_from = :pf, period_to = :pt, topics_off = :off, updated_at = :now WHERE id = :id')
           ->execute([':s' => $f['subject_id'], ':k' => $f['kind'], ':d' => $f['event_date'], ':t' => $f['title'], ':off' => $f['topics_off'],
                      ':tp' => $f['topics'], ':pf' => $f['period_from'], ':pt' => $f['period_to'], ':now' => time(), ':id' => $event['id']]);
        jsonResponse(['success' => true]);
    }

    apFail('unknown_action', 'Unknown action');
} catch (Throwable $e) {
    failInternal('NOTES', $e);
}
