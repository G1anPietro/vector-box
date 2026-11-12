<?php
// public/api/classi_lib.php
// Shared helpers for the school classes behind the shared notes (api/classi.php, and later the
// notes and summaries endpoints). Pure functions plus small queries; no output.

const CLASS_NAME_MAX = 40;
const CLASS_SCHOOL_MAX = 100;
const CLASS_NOTE_MAX = 300;
const CLASS_MAX_PENDING = 3;
const CLASS_MAX_PERIODS = 12;
const CLASS_MAX_DAYS = 6;            // Monday..Saturday
const CLASS_SUBJECT_MAX = 60;
const CLASS_LABEL_MAX = 30;
const CLASS_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
const CLASS_CODE_LENGTH = 8;
// Starting bell times for a new class (the manager changes them): six 60-minute lessons from 8:00
const CLASS_DEFAULT_PERIODS = [
    ['start' => '08:00', 'end' => '09:00'], ['start' => '09:00', 'end' => '10:00'],
    ['start' => '10:00', 'end' => '11:00'], ['start' => '11:00', 'end' => '12:00'],
    ['start' => '12:00', 'end' => '13:00'], ['start' => '13:00', 'end' => '14:00'],
];

function classLoad(PDO $db, int $id): ?array {
    $st = $db->prepare('SELECT * FROM school_classes WHERE id = :id');
    $st->execute([':id' => $id]);
    return $st->fetch() ?: null;
}

function classIsMember(PDO $db, int $classId, int $userId): bool {
    $st = $db->prepare('SELECT 1 FROM class_members WHERE class_id = :c AND user_id = :u');
    $st->execute([':c' => $classId, ':u' => $userId]);
    return (bool)$st->fetchColumn();
}

/** The admin can close new class requests; open by default. */
function classRequestsOpen(PDO $db): bool {
    $st = $db->prepare('SELECT value FROM app_settings WHERE key = :k');
    $st->execute([':k' => 'class_requests_open']);
    $v = $st->fetchColumn();
    return $v === false || $v === '1';
}

function classNewInviteCode(PDO $db): string {
    $check = $db->prepare('SELECT 1 FROM school_classes WHERE invite_code = :c');
    do {
        $code = '';
        for ($i = 0; $i < CLASS_CODE_LENGTH; $i++) {
            $code .= CLASS_CODE_ALPHABET[random_int(0, strlen(CLASS_CODE_ALPHABET) - 1)];
        }
        $check->execute([':c' => $code]);
    } while ($check->fetchColumn());
    return $code;
}

function classDelete(PDO $db, int $id): void {
    $db->exec('BEGIN IMMEDIATE');
    try {
        foreach (['class_members', 'class_subjects', 'class_timetables'] as $table) {
            $db->prepare("DELETE FROM $table WHERE class_id = :id")->execute([':id' => $id]);
        }
        $db->prepare('DELETE FROM school_classes WHERE id = :id')->execute([':id' => $id]);
        $db->exec('COMMIT');
    } catch (Throwable $e) {
        $db->exec('ROLLBACK');
        throw $e;
    }
}

function classValidTime(string $t): bool {
    return (bool)preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $t);
}

function classValidDate(string $d): bool {
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $d, $m)) return false;
    return checkdate((int)$m[2], (int)$m[3], (int)$m[1]);
}

function classTimezone(array $class): DateTimeZone {
    try {
        return new DateTimeZone($class['timezone'] ?: 'Europe/Rome');
    } catch (Throwable $e) {
        return new DateTimeZone('Europe/Rome');
    }
}

/** Today's date (YYYY-MM-DD) where the class is. */
function classToday(array $class, ?int $now = null): string {
    return (new DateTimeImmutable('@' . ($now ?? time())))->setTimezone(classTimezone($class))->format('Y-m-d');
}

/** Bell times: a list of {start, end} in order, without overlaps. Returns the list or an error string. */
function classParsePeriods($raw) {
    if (!is_array($raw) || count($raw) < 1 || count($raw) > CLASS_MAX_PERIODS) {
        return 'Between 1 and ' . CLASS_MAX_PERIODS . ' lessons a day';
    }
    $out = [];
    $prevEnd = '00:00';
    foreach (array_values($raw) as $i => $p) {
        $start = is_array($p) ? (string)($p['start'] ?? '') : '';
        $end = is_array($p) ? (string)($p['end'] ?? '') : '';
        if (!classValidTime($start) || !classValidTime($end)) return 'Lesson ' . ($i + 1) . ': times must be HH:MM';
        if ($start >= $end) return 'Lesson ' . ($i + 1) . ' ends before it starts';
        if ($start < $prevEnd) return 'Lesson ' . ($i + 1) . ' overlaps the one before';
        $out[] = ['start' => $start, 'end' => $end];
        $prevEnd = $end;
    }
    return $out;
}

/** Timetable cells: {day 1-6, period, subject, label?, room?}, one per cell. Returns the list or an error string. */
function classParseSlots($raw, int $periodCount) {
    if (!is_array($raw) || count($raw) > CLASS_MAX_DAYS * CLASS_MAX_PERIODS) return 'Invalid timetable';
    $out = [];
    $seen = [];
    foreach ($raw as $s) {
        if (!is_array($s)) return 'Invalid timetable';
        $day = (int)($s['day'] ?? 0);
        $period = (int)($s['period'] ?? 0);
        if ($day < 1 || $day > CLASS_MAX_DAYS) return 'Day must be 1 (Monday) to ' . CLASS_MAX_DAYS;
        if ($period < 1 || $period > $periodCount) return 'Lesson number out of range';
        $key = $day . ':' . $period;
        if (isset($seen[$key])) return 'Two subjects in the same hour';
        $seen[$key] = true;
        $clean = fn($v, $max) => textCut(trim(preg_replace('/[\x00-\x1F\x7F]+/u', ' ', (string)$v) ?? ''), $max);
        $subject = $clean($s['subject'] ?? '', CLASS_SUBJECT_MAX);
        if ($subject === '') return 'Every hour needs a subject';
        $out[] = [
            'day' => $day, 'period' => $period, 'subject' => $subject,
            'label' => $clean($s['label'] ?? '', CLASS_LABEL_MAX),
            'room' => $clean($s['room'] ?? '', CLASS_LABEL_MAX),
        ];
    }
    usort($out, fn($a, $b) => [$a['day'], $a['period']] <=> [$b['day'], $b['period']]);
    return $out;
}

/** Makes sure every subject name exists for the class; returns name => id. Call inside a transaction. */
function classEnsureSubjects(PDO $db, int $classId, array $names): array {
    $ins = $db->prepare('INSERT OR IGNORE INTO class_subjects (class_id, name) VALUES (:c, :n)');
    $get = $db->prepare('SELECT id FROM class_subjects WHERE class_id = :c AND name = :n');
    $ids = [];
    foreach (array_unique($names) as $name) {
        $ins->execute([':c' => $classId, ':n' => $name]);
        $get->execute([':c' => $classId, ':n' => $name]);
        $ids[$name] = (int)$get->fetchColumn();
    }
    return $ids;
}

function classSubjects(PDO $db, int $classId): array {
    $st = $db->prepare('SELECT id, name FROM class_subjects WHERE class_id = :c ORDER BY name');
    $st->execute([':c' => $classId]);
    return array_map(fn($r) => ['id' => (int)$r['id'], 'name' => $r['name']], $st->fetchAll());
}

/** The timetable version in force on a date (the latest one starting on or before it), or null. */
function classTimetableFor(PDO $db, int $classId, string $date): ?array {
    $st = $db->prepare('SELECT valid_from, slots FROM class_timetables WHERE class_id = :c AND valid_from <= :d
                        ORDER BY valid_from DESC LIMIT 1');
    $st->execute([':c' => $classId, ':d' => $date]);
    $row = $st->fetch();
    if (!$row) return null;
    return ['valid_from' => $row['valid_from'], 'slots' => json_decode($row['slots'], true) ?: []];
}

function classSummaryRow(array $c, int $me): array {
    return [
        'id' => (int)$c['id'], 'name' => $c['name'], 'school' => $c['school'],
        'is_manager' => (int)$c['manager_id'] === $me, 'members' => (int)($c['members'] ?? 0),
    ];
}

function classDetail(PDO $db, array $class, int $me, bool $isAdmin): array {
    $id = (int)$class['id'];
    $canManage = $isAdmin || (int)$class['manager_id'] === $me;

    $st = $db->prepare('SELECT a.id, a.username FROM class_members m JOIN accounts a ON a.id = m.user_id
                        WHERE m.class_id = :c ORDER BY a.username');
    $st->execute([':c' => $id]);
    $members = array_map(fn($r) => [
        'id' => (int)$r['id'], 'username' => $r['username'], 'is_manager' => (int)$r['id'] === (int)$class['manager_id'],
    ], $st->fetchAll());

    $subjects = classSubjects($db, $id);
    $names = array_column($subjects, 'name', 'id');
    $timetable = classTimetableFor($db, $id, classToday($class));
    if ($timetable) {
        $timetable['slots'] = array_map(fn($s) => $s + ['subject' => $names[$s['subject_id']] ?? '?'], $timetable['slots']);
    }
    $st = $db->prepare('SELECT valid_from FROM class_timetables WHERE class_id = :c ORDER BY valid_from DESC');
    $st->execute([':c' => $id]);

    return [
        'id' => $id,
        'name' => $class['name'],
        'school' => $class['school'],
        'status' => $class['status'],
        'is_manager' => (int)$class['manager_id'] === $me,
        'can_manage' => $canManage,
        'invite_code' => $canManage ? $class['invite_code'] : null,
        'timezone' => $class['timezone'],
        'summary_time' => $class['summary_time'],
        'periods' => json_decode($class['periods'], true) ?: [],
        'subjects' => $subjects,
        'timetable' => $timetable,
        'timetable_versions' => $st->fetchAll(PDO::FETCH_COLUMN),
        'members' => $members,
    ];
}
