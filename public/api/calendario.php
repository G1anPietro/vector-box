<?php
// public/api/calendario.php
// The class calendar beyond tests: topics (start/end), homework, days without lessons, oral-exam turns.
// Tests and oral exams stay in api/appunti.php (add_event / edit_event / delete_event).
//
// GET  ?action=overview&class_id=ID[&from&to]  -> topics, homework, days off, turns, the turn order, lessons per day
// POST {action:"save_topic", class_id, id?, subject_id, name, start, end?} | {action:"confirm_topic", id} | {action:"delete_topic", id}
//      {action:"save_homework", class_id, id?, subject_id, due, body} | {action:"delete_homework", id}
//      {action:"save_dayoff", class_id, from, to?, period?, reason} | {action:"delete_dayoff", id}
//      {action:"save_turn_order", class_id, order:[user ids]}          -> the class template (used for every subject)
//      {action:"make_turns", class_id, subject_id, start, per_lesson}  -> puts the order on the next lessons of the subject
//      {action:"save_turn", id, date, user_ids, note} | {action:"delete_turn", id} | {action:"clear_turns", class_id, subject_id}
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/rate_limiter.php';
require_once __DIR__ . '/classi_lib.php';
require_once __DIR__ . '/appunti_lib.php';

initSession();
requireLogin();
header('Cache-Control: no-store');
$me = (int)$_SESSION['user_id'];
$isAdmin = !empty($_SESSION['is_admin']);

function caFail(string $code, string $msg, int $status = 400): void {
    jsonResponse(['success' => false, 'code' => $code, 'error' => $msg], $status);
}

/** An active class the caller belongs to (any class for the admin). Returns [class, my permissions]. */
function caClass(PDO $db, int $id, int $me, bool $isAdmin): array {
    $class = classLoad($db, $id);
    if (!$class || $class['status'] !== 'active' || (!$isAdmin && !classIsMember($db, $id, $me))) caFail('not_found', 'Class not found', 404);
    return [$class, classPerms($db, $class, $me, $isAdmin)];
}

function caNeed(array $perms, string $perm): void {
    if (!in_array($perm, $perms, true)) caFail('forbidden', 'You do not have the permission to do this', 403);
}

function caText($v, int $max, bool $multiline = false): string {
    $s = (string)$v;
    $s = $multiline ? preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]+/u', '', $s) : preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $s);
    return textCut(trim($s ?? ''), $max);
}

function caRow(PDO $db, string $table, int $id): array {
    $st = $db->prepare("SELECT * FROM $table WHERE id = :id");
    $st->execute([':id' => $id]);
    $row = $st->fetch();
    if (!$row) caFail('not_found', 'Not found', 404);
    return $row;
}

/** Member ids of a class, as a set. */
function caMemberSet(PDO $db, int $classId): array {
    $st = $db->prepare('SELECT user_id FROM class_members WHERE class_id = :c');
    $st->execute([':c' => $classId]);
    return array_flip(array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN)));
}

try {
    $db = getDbConnection();

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $action = (string)($_GET['action'] ?? '');
        [$class, $perms] = caClass($db, (int)($_GET['class_id'] ?? 0), $me, $isAdmin);
        $classId = (int)$class['id'];
        if ($action !== 'overview') caFail('unknown_action', 'Unknown action');

        $today = classToday($class);
        $from = (string)($_GET['from'] ?? '');
        $to = (string)($_GET['to'] ?? '');
        if (!classValidDate($from)) $from = (new DateTimeImmutable($today))->modify('-30 days')->format('Y-m-d');
        if (!classValidDate($to)) $to = (new DateTimeImmutable($today))->modify('+90 days')->format('Y-m-d');
        $names = array_column(classSubjects($db, $classId), 'name', 'id');

        $st = $db->prepare('SELECT * FROM class_topics WHERE class_id = :c ORDER BY start_date DESC, id DESC LIMIT 300');
        $st->execute([':c' => $classId]);
        $topics = array_map(fn($t) => [
            'id' => (int)$t['id'], 'subject_id' => (int)$t['subject_id'], 'subject' => $names[$t['subject_id']] ?? '?', 'name' => $t['name'],
            'start' => $t['start_date'], 'end' => $t['end_date'], 'proposed' => $t['status'] === 'proposed',
        ], $st->fetchAll());

        $st = $db->prepare('SELECT h.*, CASE WHEN LENGTH(cm.display_name) > 0 THEN cm.display_name ELSE a.username END AS author FROM class_homework h
                            LEFT JOIN accounts a ON a.id = h.author_id LEFT JOIN class_members cm ON cm.class_id = h.class_id AND cm.user_id = h.author_id
                            WHERE h.class_id = :c AND h.due_date BETWEEN :f AND :t ORDER BY h.due_date, h.id');
        $st->execute([':c' => $classId, ':f' => $from, ':t' => $to]);
        $homework = array_map(fn($h) => [
            'id' => (int)$h['id'], 'subject_id' => (int)$h['subject_id'], 'subject' => $names[$h['subject_id']] ?? '?', 'due' => $h['due_date'],
            'body' => $h['body'], 'author' => $h['author'], 'can_edit' => (int)$h['author_id'] === $me || in_array('homework', $perms, true),
        ], $st->fetchAll());

        $st = $db->prepare('SELECT * FROM class_days_off WHERE class_id = :c AND date_to >= :f AND date_from <= :t ORDER BY date_from');
        $st->execute([':c' => $classId, ':f' => $from, ':t' => $to]);
        $daysOff = array_map(fn($d) => ['id' => (int)$d['id'], 'from' => $d['date_from'], 'to' => $d['date_to'],
            'period' => $d['period'] !== null ? (int)$d['period'] : null, 'reason' => $d['reason']], $st->fetchAll());

        $st = $db->prepare('SELECT * FROM class_turns WHERE class_id = :c AND turn_date BETWEEN :f AND :t ORDER BY turn_date, id');
        $st->execute([':c' => $classId, ':f' => $from, ':t' => $to]);
        $turns = array_map(fn($t) => ['id' => (int)$t['id'], 'subject_id' => (int)$t['subject_id'], 'subject' => $names[$t['subject_id']] ?? '?',
            'date' => $t['turn_date'], 'user_ids' => array_map('intval', json_decode($t['user_ids'], true) ?: []), 'note' => $t['note']], $st->fetchAll());

        jsonResponse(['success' => true, 'today' => $today, 'perms' => $perms, 'topics' => $topics, 'homework' => $homework,
            'days_off' => $daysOff, 'turns' => $turns,
            'turn_order' => array_map('intval', json_decode($class['turn_order'] ?? '[]', true) ?: [])]);
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') caFail('method', 'Method not allowed', 405);
    requireCsrf();
    $in = readJsonBody();
    $action = (string)($in['action'] ?? '');
    if (!checkRateLimit('class_calendar', 200, 3600, 'user:' . $me)) caFail('slow_down', 'Too many changes, try later', 429);
    $now = time();

    /* ---------- topics ---------- */
    if ($action === 'save_topic') {
        [$class, $perms] = caClass($db, (int)($in['class_id'] ?? 0), $me, $isAdmin);
        caNeed($perms, 'topics');
        $subjectId = (int)($in['subject_id'] ?? 0);
        if (!notesSubjectOf($db, (int)$class['id'], $subjectId)) caFail('bad_subject', 'Choose a subject of this class');
        $name = caText($in['name'] ?? '', 80);
        if ($name === '') caFail('bad_name', 'Give the topic a name');
        $start = (string)($in['start'] ?? '');
        $end = trim((string)($in['end'] ?? ''));
        if (!classValidDate($start) || ($end !== '' && (!classValidDate($end) || $end < $start))) caFail('bad_dates', 'The topic must end after it starts');
        $id = (int)($in['id'] ?? 0);
        if ($id) {
            $t = caRow($db, 'class_topics', $id);
            if ((int)$t['class_id'] !== (int)$class['id']) caFail('not_found', 'Not found', 404);
            $db->prepare("UPDATE class_topics SET subject_id = :s, name = :n, start_date = :a, end_date = :b, status = 'ok', updated_at = :t WHERE id = :id")
               ->execute([':s' => $subjectId, ':n' => $name, ':a' => $start, ':b' => $end !== '' ? $end : null, ':t' => $now, ':id' => $id]);
        } else {
            $db->prepare("INSERT INTO class_topics (class_id, subject_id, name, start_date, end_date, status, author_id, created_at, updated_at)
                          VALUES (:c, :s, :n, :a, :b, 'ok', :u, :t, :t)")
               ->execute([':c' => $class['id'], ':s' => $subjectId, ':n' => $name, ':a' => $start, ':b' => $end !== '' ? $end : null, ':u' => $me, ':t' => $now]);
            $id = (int)$db->lastInsertId();
        }
        jsonResponse(['success' => true, 'id' => $id]);
    }

    if ($action === 'confirm_topic' || $action === 'delete_topic') {
        $t = caRow($db, 'class_topics', (int)($in['id'] ?? 0));
        [, $perms] = caClass($db, (int)$t['class_id'], $me, $isAdmin);
        caNeed($perms, 'topics');
        if ($action === 'confirm_topic') {
            $db->prepare("UPDATE class_topics SET status = 'ok', updated_at = :t WHERE id = :id")->execute([':t' => $now, ':id' => $t['id']]);
        } else {
            $db->prepare('DELETE FROM class_topics WHERE id = :id')->execute([':id' => $t['id']]);
        }
        jsonResponse(['success' => true]);
    }

    /* ---------- homework: every member adds; the author or who has the permission changes ---------- */
    if ($action === 'save_homework') {
        [$class, $perms] = caClass($db, (int)($in['class_id'] ?? 0), $me, $isAdmin);
        $subjectId = (int)($in['subject_id'] ?? 0);
        if (!notesSubjectOf($db, (int)$class['id'], $subjectId)) caFail('bad_subject', 'Choose a subject of this class');
        $due = (string)($in['due'] ?? '');
        if (!classValidDate($due)) caFail('bad_date', 'Date must be YYYY-MM-DD');
        $body = caText($in['body'] ?? '', 2000, true);
        if ($body === '') caFail('empty', 'Write what the homework is');
        $id = (int)($in['id'] ?? 0);
        if ($id) {
            $h = caRow($db, 'class_homework', $id);
            if ((int)$h['class_id'] !== (int)$class['id']) caFail('not_found', 'Not found', 404);
            if ((int)$h['author_id'] !== $me) caNeed($perms, 'homework');
            $db->prepare('UPDATE class_homework SET subject_id = :s, due_date = :d, body = :b, updated_at = :t WHERE id = :id')
               ->execute([':s' => $subjectId, ':d' => $due, ':b' => $body, ':t' => $now, ':id' => $id]);
        } else {
            $db->prepare('INSERT INTO class_homework (class_id, subject_id, due_date, body, author_id, created_at, updated_at) VALUES (:c, :s, :d, :b, :u, :t, :t)')
               ->execute([':c' => $class['id'], ':s' => $subjectId, ':d' => $due, ':b' => $body, ':u' => $me, ':t' => $now]);
            $id = (int)$db->lastInsertId();
        }
        jsonResponse(['success' => true, 'id' => $id]);
    }

    if ($action === 'delete_homework') {
        $h = caRow($db, 'class_homework', (int)($in['id'] ?? 0));
        [, $perms] = caClass($db, (int)$h['class_id'], $me, $isAdmin);
        if ((int)$h['author_id'] !== $me) caNeed($perms, 'homework');
        $db->prepare('DELETE FROM class_homework WHERE id = :id')->execute([':id' => $h['id']]);
        jsonResponse(['success' => true]);
    }

    /* ---------- days without lessons ---------- */
    if ($action === 'save_dayoff') {
        [$class, $perms] = caClass($db, (int)($in['class_id'] ?? 0), $me, $isAdmin);
        caNeed($perms, 'daysoff');
        $from = (string)($in['from'] ?? '');
        $to = trim((string)($in['to'] ?? '')) ?: $from;
        if (!classValidDate($from) || !classValidDate($to) || $to < $from) caFail('bad_dates', 'The last day must not be before the first');
        if ((new DateTimeImmutable($from))->diff(new DateTimeImmutable($to))->days > 120) caFail('bad_dates', 'At most 120 days');
        $period = (int)($in['period'] ?? 0);
        if ($period && ($from !== $to || $period > CLASS_MAX_PERIODS)) caFail('bad_period', 'A single hour needs a single day');
        $db->prepare('INSERT INTO class_days_off (class_id, date_from, date_to, period, reason, author_id, created_at) VALUES (:c, :f, :t, :p, :r, :u, :now)')
           ->execute([':c' => $class['id'], ':f' => $from, ':t' => $to, ':p' => $period ?: null, ':r' => caText($in['reason'] ?? '', 80), ':u' => $me, ':now' => $now]);
        jsonResponse(['success' => true, 'id' => (int)$db->lastInsertId()]);
    }

    if ($action === 'delete_dayoff') {
        $d = caRow($db, 'class_days_off', (int)($in['id'] ?? 0));
        [, $perms] = caClass($db, (int)$d['class_id'], $me, $isAdmin);
        caNeed($perms, 'daysoff');
        $db->prepare('DELETE FROM class_days_off WHERE id = :id')->execute([':id' => $d['id']]);
        jsonResponse(['success' => true]);
    }

    /* ---------- turns ---------- */
    if ($action === 'save_turn_order') {
        [$class, $perms] = caClass($db, (int)($in['class_id'] ?? 0), $me, $isAdmin);
        caNeed($perms, 'turns');
        $members = caMemberSet($db, (int)$class['id']);
        $order = [];
        foreach ((array)($in['order'] ?? []) as $u) {
            $u = (int)$u;
            if (isset($members[$u]) && !in_array($u, $order, true)) $order[] = $u;
        }
        $db->prepare('UPDATE school_classes SET turn_order = :o WHERE id = :id')->execute([':o' => json_encode($order), ':id' => $class['id']]);
        jsonResponse(['success' => true, 'order' => $order]);
    }

    if ($action === 'make_turns') {
        // The class order, N students per lesson, on the next lessons of the subject from a day on (days off skipped)
        [$class, $perms] = caClass($db, (int)($in['class_id'] ?? 0), $me, $isAdmin);
        caNeed($perms, 'turns');
        $classId = (int)$class['id'];
        $subjectId = (int)($in['subject_id'] ?? 0);
        if (!notesSubjectOf($db, $classId, $subjectId)) caFail('bad_subject', 'Choose a subject of this class');
        $start = (string)($in['start'] ?? '');
        if (!classValidDate($start)) caFail('bad_date', 'Date must be YYYY-MM-DD');
        $per = max(1, min(10, (int)($in['per_lesson'] ?? 2)));
        $members = caMemberSet($db, $classId);
        $order = array_values(array_filter(array_map('intval', json_decode($class['turn_order'] ?? '[]', true) ?: []), fn($u) => isset($members[$u])));
        if (!$order) caFail('no_order', 'Set the order of the turns first');
        $groups = array_chunk($order, $per);
        $day = new DateTimeImmutable($start);
        $made = [];
        $ins = $db->prepare('INSERT INTO class_turns (class_id, subject_id, turn_date, user_ids, author_id, created_at) VALUES (:c, :s, :d, :u, :a, :t)');
        for ($i = 0; $i < 200 && $groups; $i++, $day = $day->modify('+1 day')) {
            $date = $day->format('Y-m-d');
            $has = array_filter(notesLessonsOn($db, $class, $date), fn($l) => $l['subject_id'] === $subjectId);
            if (!$has) continue;
            $ins->execute([':c' => $classId, ':s' => $subjectId, ':d' => $date, ':u' => json_encode(array_shift($groups)), ':a' => $me, ':t' => $now]);
            $made[] = $date;
        }
        if ($groups) caFail('no_lessons', 'Not enough lessons of this subject in the timetable: check the timetable');
        jsonResponse(['success' => true, 'dates' => $made]);
    }

    if ($action === 'save_turn' || $action === 'delete_turn') {
        $t = caRow($db, 'class_turns', (int)($in['id'] ?? 0));
        [$class, $perms] = caClass($db, (int)$t['class_id'], $me, $isAdmin);
        caNeed($perms, 'turns');
        if ($action === 'delete_turn') {
            $db->prepare('DELETE FROM class_turns WHERE id = :id')->execute([':id' => $t['id']]);
            jsonResponse(['success' => true]);
        }
        $date = (string)($in['date'] ?? $t['turn_date']);
        if (!classValidDate($date)) caFail('bad_date', 'Date must be YYYY-MM-DD');
        $members = caMemberSet($db, (int)$class['id']);
        $users = array_values(array_unique(array_filter(array_map('intval', (array)($in['user_ids'] ?? [])), fn($u) => isset($members[$u]))));
        $db->prepare('UPDATE class_turns SET turn_date = :d, user_ids = :u, note = :n, notified_at = NULL WHERE id = :id')
           ->execute([':d' => $date, ':u' => json_encode($users), ':n' => caText($in['note'] ?? '', 120), ':id' => $t['id']]);
        jsonResponse(['success' => true]);
    }

    if ($action === 'add_turn') {
        [$class, $perms] = caClass($db, (int)($in['class_id'] ?? 0), $me, $isAdmin);
        caNeed($perms, 'turns');
        $subjectId = (int)($in['subject_id'] ?? 0);
        if (!notesSubjectOf($db, (int)$class['id'], $subjectId)) caFail('bad_subject', 'Choose a subject of this class');
        $date = (string)($in['date'] ?? '');
        if (!classValidDate($date)) caFail('bad_date', 'Date must be YYYY-MM-DD');
        $members = caMemberSet($db, (int)$class['id']);
        $users = array_values(array_unique(array_filter(array_map('intval', (array)($in['user_ids'] ?? [])), fn($u) => isset($members[$u]))));
        $db->prepare('INSERT INTO class_turns (class_id, subject_id, turn_date, user_ids, note, author_id, created_at) VALUES (:c, :s, :d, :u, :n, :a, :t)')
           ->execute([':c' => $class['id'], ':s' => $subjectId, ':d' => $date, ':u' => json_encode($users), ':n' => caText($in['note'] ?? '', 120), ':a' => $me, ':t' => $now]);
        jsonResponse(['success' => true, 'id' => (int)$db->lastInsertId()]);
    }

    if ($action === 'clear_turns') {
        [$class, $perms] = caClass($db, (int)($in['class_id'] ?? 0), $me, $isAdmin);
        caNeed($perms, 'turns');
        $db->prepare('DELETE FROM class_turns WHERE class_id = :c AND subject_id = :s AND turn_date >= :d')
           ->execute([':c' => $class['id'], ':s' => (int)($in['subject_id'] ?? 0), ':d' => classToday($class)]);
        jsonResponse(['success' => true]);
    }

    caFail('unknown_action', 'Unknown action');
} catch (Throwable $e) {
    failInternal('CALENDAR', $e);
}
