<?php
// public/api/bacheca.php
// The class board: what is happening now in the class's local time (lesson in progress, the next one) and the
// announcements written by the representative or whoever has the "board" permission.
//
// GET  ?action=overview&class_id=ID -> {today, now:"HH:MM:SS", lessons:[{subject, room, start, end}], next_day:{date, lesson}|null,
//                                       announcements:[...], can_post}
// POST {action:"save_announcement", class_id, id?, title, body, pinned, notify} | {action:"delete_announcement", id}
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/rate_limiter.php';
require_once __DIR__ . '/classi_lib.php';
require_once __DIR__ . '/appunti_lib.php';
require_once __DIR__ . '/notifiche_lib.php';

initSession();
requireLogin();
header('Cache-Control: no-store');
$me = (int)$_SESSION['user_id'];
$isAdmin = !empty($_SESSION['is_admin']);

const BOARD_MAX_ANNOUNCEMENTS = 50;   // per class: the oldest must be deleted before adding more

function bbFail(string $code, string $msg, int $status = 400): void {
    jsonResponse(['success' => false, 'code' => $code, 'error' => $msg], $status);
}

/** An active class the caller belongs to (any class for the admin). Returns [class, my permissions]. */
function bbClass(PDO $db, int $id, int $me, bool $isAdmin): array {
    $class = classLoad($db, $id);
    if (!$class || $class['status'] !== 'active' || (!$isAdmin && !classIsMember($db, $id, $me))) bbFail('not_found', 'Class not found', 404);
    return [$class, classPerms($db, $class, $me, $isAdmin)];
}

function bbText($v, int $max, bool $multiline = false): string {
    $s = (string)$v;
    $s = $multiline ? preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]+/u', '', $s) : preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $s);
    return textCut(trim($s ?? ''), $max);
}

try {
    $db = getDbConnection();

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        if ((string)($_GET['action'] ?? '') !== 'overview') bbFail('unknown_action', 'Unknown action');
        [$class, $perms] = bbClass($db, (int)($_GET['class_id'] ?? 0), $me, $isAdmin);
        $classId = (int)$class['id'];
        $local = (new DateTimeImmutable('now', classTimezone($class)));
        $today = $local->format('Y-m-d');
        $names = array_column(classSubjects($db, $classId), 'name', 'id');
        $shape = fn(array $l) => ['subject_id' => $l['subject_id'], 'subject' => $names[$l['subject_id']] ?? '?', 'room' => $l['room'],
                                  'start' => $l['start'], 'end' => $l['end']];
        $lessons = array_map($shape, notesLessonsOn($db, $class, $today));

        // The first lesson of the next day that has lessons (for the evening: "domani si comincia con...")
        $nextDay = null;
        for ($i = 1; $i <= 7 && !$nextDay; $i++) {
            $d = $local->modify("+$i days")->format('Y-m-d');
            $l = notesLessonsOn($db, $class, $d);
            if ($l) $nextDay = ['date' => $d, 'lesson' => $shape($l[0])];
        }
        // A whole day off today (strike, holiday, trip): the board says why
        $off = $db->prepare('SELECT reason FROM class_days_off WHERE class_id = :c AND date_from <= :d AND date_to >= :d AND period IS NULL LIMIT 1');
        $off->execute([':c' => $classId, ':d' => $today]);
        $dayOff = $off->fetch();

        $st = $db->prepare("SELECT b.*, CASE WHEN LENGTH(cm.display_name) > 0 THEN cm.display_name ELSE a.username END AS author
                            FROM class_board b LEFT JOIN accounts a ON a.id = b.author_id
                            LEFT JOIN class_members cm ON cm.class_id = b.class_id AND cm.user_id = b.author_id
                            WHERE b.class_id = :c AND b.kind = 'annuncio' AND b.status = 'open'
                            ORDER BY b.pinned DESC, b.created_at DESC LIMIT 20");
        $st->execute([':c' => $classId]);
        $canBoard = in_array('board', $perms, true);
        $announcements = array_map(fn($b) => [
            'id' => (int)$b['id'], 'title' => $b['title'], 'body' => $b['body'], 'pinned' => (int)$b['pinned'] === 1,
            'author' => $b['author'], 'created_at' => (int)$b['created_at'],
            'can_edit' => $canBoard || (int)$b['author_id'] === $me,
        ], $st->fetchAll());

        jsonResponse(['success' => true, 'today' => $today, 'now' => $local->format('H:i:s'), 'lessons' => $lessons, 'next_day' => $nextDay,
            'day_off' => $dayOff ? ($dayOff['reason'] !== '' ? $dayOff['reason'] : 'Niente lezione') : null,
            'announcements' => $announcements, 'can_post' => $canBoard,
            'missing' => array_slice(notesMissing($db, $class), 0, 12), 'can_skip' => $canBoard || in_array('material', $perms, true) || in_array('settings', $perms, true)]);
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') bbFail('method', 'Method not allowed', 405);
    requireCsrf();
    $in = readJsonBody();
    $action = (string)($in['action'] ?? '');
    if (!checkRateLimit('class_board', 60, 3600, 'user:' . $me)) bbFail('slow_down', 'Too many changes, try later', 429);
    $now = time();

    if ($action === 'save_announcement') {
        [$class, $perms] = bbClass($db, (int)($in['class_id'] ?? 0), $me, $isAdmin);
        $classId = (int)$class['id'];
        $title = bbText($in['title'] ?? '', 100);
        if ($title === '') bbFail('empty', 'Give the announcement a title');
        $body = bbText($in['body'] ?? '', 2000, true);
        $pinned = !empty($in['pinned']) ? 1 : 0;
        $id = (int)($in['id'] ?? 0);
        if ($id) {
            $st = $db->prepare("SELECT * FROM class_board WHERE id = :id AND class_id = :c AND kind = 'annuncio'");
            $st->execute([':id' => $id, ':c' => $classId]);
            $b = $st->fetch();
            if (!$b) bbFail('not_found', 'Not found', 404);
            if ((int)$b['author_id'] !== $me && !in_array('board', $perms, true)) bbFail('forbidden', 'You do not have the permission to do this', 403);
            $db->prepare('UPDATE class_board SET title = :t, body = :b, pinned = :p WHERE id = :id')
               ->execute([':t' => $title, ':b' => $body, ':p' => $pinned, ':id' => $id]);
            jsonResponse(['success' => true, 'id' => $id]);
        }
        if (!in_array('board', $perms, true)) bbFail('forbidden', 'You do not have the permission to do this', 403);
        $n = $db->prepare("SELECT COUNT(*) FROM class_board WHERE class_id = :c AND kind = 'annuncio'");
        $n->execute([':c' => $classId]);
        if ((int)$n->fetchColumn() >= BOARD_MAX_ANNOUNCEMENTS) bbFail('too_many', 'Delete an old announcement first');
        $db->prepare("INSERT INTO class_board (class_id, kind, title, body, status, pinned, author_id, created_at) VALUES (:c, 'annuncio', :t, :b, 'open', :p, :a, :n)")
           ->execute([':c' => $classId, ':t' => $title, ':b' => $body, ':p' => $pinned, ':a' => $me, ':n' => $now]);
        $id = (int)$db->lastInsertId();
        $sent = 0;
        if (!empty($in['notify'])) {
            $others = array_values(array_filter(classMemberIds($db, $classId), fn($u) => $u !== $me));
            if ($others) $sent = notifyUsers($db, $others, $classId, 'annuncio', $title, $body !== '' ? textCut($body, 140) : 'Nuovo annuncio in bacheca',
                '/pages/appunti.php?class=' . $classId . '&tab=board');
        }
        jsonResponse(['success' => true, 'id' => $id, 'pushed' => $sent]);
    }

    if ($action === 'skip_missing') {
        // "Not needed" for one lesson: it stops appearing in the missing notes (who may manage material or settings)
        [$class, $perms] = bbClass($db, (int)($in['class_id'] ?? 0), $me, $isAdmin);
        if (!in_array('material', $perms, true) && !in_array('settings', $perms, true) && !in_array('board', $perms, true)) bbFail('forbidden', 'You do not have the permission to do this', 403);
        $date = (string)($in['date'] ?? '');
        $sid = (int)($in['subject_id'] ?? 0);
        if (!classValidDate($date) || !notesSubjectOf($db, (int)$class['id'], $sid)) bbFail('bad_request', 'Unknown lesson');
        $cfg = json_decode((string)($class['settings'] ?? '{}'), true);
        if (!is_array($cfg)) $cfg = [];
        $m = notesMissingSettings($class);
        $m['skip'] = array_slice(array_values(array_unique(array_merge($m['skip'], ["$date:$sid"]))), -300);
        $cfg['missing'] = $m;
        $db->prepare('UPDATE school_classes SET settings = :s WHERE id = :id')->execute([':s' => json_encode($cfg), ':id' => $class['id']]);
        jsonResponse(['success' => true]);
    }

    if ($action === 'delete_announcement') {
        $st = $db->prepare("SELECT * FROM class_board WHERE id = :id AND kind = 'annuncio'");
        $st->execute([':id' => (int)($in['id'] ?? 0)]);
        $b = $st->fetch();
        if (!$b) bbFail('not_found', 'Not found', 404);
        [, $perms] = bbClass($db, (int)$b['class_id'], $me, $isAdmin);
        if ((int)$b['author_id'] !== $me && !in_array('board', $perms, true)) bbFail('forbidden', 'You do not have the permission to do this', 403);
        $db->prepare('DELETE FROM class_board WHERE id = :id')->execute([':id' => $b['id']]);
        classLog($db, (int)$b['class_id'], $me, 'Annuncio eliminato', $b['title'] ?? '');
        jsonResponse(['success' => true]);
    }

    bbFail('unknown_action', 'Unknown action');
} catch (Throwable $e) {
    failInternal('BOARD', $e);
}
