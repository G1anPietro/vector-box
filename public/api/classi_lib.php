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
// Upload limits: site-wide defaults the admin can change (app_settings), and per-class overrides
const CLASS_DEFAULT_FILE_MB = 40;
const CLASS_DEFAULT_CLASS_MB = 5 * 1024;
const CLASS_LIMIT_FILE_MB_MAX = 95;          // stays under post_max_size in .user.ini (100M)
const CLASS_LIMIT_CLASS_MB_MAX = 200 * 1024;
// Starting bell times for a new class (the manager changes them): Monday-Friday, six 60-minute lessons from 8:00
const CLASS_DEFAULT_DAY = [
    ['start' => '08:00', 'end' => '09:00'], ['start' => '09:00', 'end' => '10:00'],
    ['start' => '10:00', 'end' => '11:00'], ['start' => '11:00', 'end' => '12:00'],
    ['start' => '12:00', 'end' => '13:00'], ['start' => '13:00', 'end' => '14:00'],
];

function classDefaultPeriods(): array {
    $out = [];
    for ($d = 1; $d <= CLASS_MAX_DAYS; $d++) $out[(string)$d] = $d <= 5 ? CLASS_DEFAULT_DAY : [];
    return $out;
}

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
    return appSetting($db, 'class_requests_open', '1') === '1';
}

function appSetting(PDO $db, string $key, ?string $default = null): ?string {
    $st = $db->prepare('SELECT value FROM app_settings WHERE key = :k');
    $st->execute([':k' => $key]);
    $v = $st->fetchColumn();
    return $v === false ? $default : (string)$v;
}

function appSettingSet(PDO $db, string $key, string $value): void {
    $db->prepare('INSERT INTO app_settings (key, value) VALUES (:k, :v) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
       ->execute([':k' => $key, ':v' => $value]);
}

/** Site-wide upload limits in MB: ['file' => .., 'class' => ..]. */
function classDefaultLimits(PDO $db): array {
    return [
        'file' => (int)appSetting($db, 'notes_max_file_mb', (string)CLASS_DEFAULT_FILE_MB),
        'class' => (int)appSetting($db, 'notes_max_class_mb', (string)CLASS_DEFAULT_CLASS_MB),
    ];
}

/** Limits in force for one class (its override, else the site default), in MB. */
function classLimits(PDO $db, array $class): array {
    $d = classDefaultLimits($db);
    return [
        'file' => $class['max_file_mb'] !== null ? (int)$class['max_file_mb'] : $d['file'],
        'class' => $class['max_class_mb'] !== null ? (int)$class['max_class_mb'] : $d['class'],
    ];
}

/** Validates a limit in MB; null/'' means "use the default". Returns int|null, or an error string. */
function classParseLimit($v, int $max) {
    if ($v === null || $v === '') return null;
    if (!is_numeric($v) || (int)$v < 1 || (int)$v > $max) return "Limit must be between 1 and $max MB";
    return (int)$v;
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
        foreach (['class_members', 'class_subjects', 'class_timetables', 'class_items', 'class_item_files', 'class_events'] as $table) {
            $db->prepare("DELETE FROM $table WHERE class_id = :id")->execute([':id' => $id]);
        }
        $db->prepare('DELETE FROM school_classes WHERE id = :id')->execute([':id' => $id]);
        $db->exec('COMMIT');
    } catch (Throwable $e) {
        $db->exec('ROLLBACK');
        throw $e;
    }
    // Uploaded files live in data/appunti/<id>/
    $dir = dirname(__DIR__, 2) . '/data/appunti/' . $id;
    if (is_dir($dir)) {
        foreach (glob($dir . '/*') ?: [] as $f) @unlink($f);
        @rmdir($dir);
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

/** One day's bell times: {start, end} in order, without overlaps. Returns the list or an error string. */
function classParseDayPeriods($raw, string $dayLabel) {
    if (!is_array($raw) || count($raw) > CLASS_MAX_PERIODS) return "$dayLabel: at most " . CLASS_MAX_PERIODS . ' lessons';
    $out = [];
    $prevEnd = '00:00';
    foreach (array_values($raw) as $i => $p) {
        $start = is_array($p) ? str_replace('.', ':', (string)($p['start'] ?? '')) : '';
        $end = is_array($p) ? str_replace('.', ':', (string)($p['end'] ?? '')) : '';
        $n = $i + 1;
        if (!classValidTime($start) || !classValidTime($end)) return "$dayLabel, lesson $n: times must be HH:MM";
        if ($start >= $end) return "$dayLabel, lesson $n ends before it starts";
        if ($start < $prevEnd) return "$dayLabel, lesson $n overlaps the one before";
        $out[] = ['start' => $start, 'end' => $end];
        $prevEnd = $end;
    }
    return $out;
}

/**
 * Bell times per weekday, because schools often have shorter hours on some days.
 * Accepts {"1": [...], ..., "6": [...]} (missing days = no lessons) or a single list used Monday-Friday.
 * Returns ["1" => [...], ..., "6" => [...]] or an error string.
 */
function classParsePeriods($raw) {
    if (!is_array($raw)) return 'Invalid bell times';
    $isList = array_keys($raw) === range(0, count($raw) - 1);
    $out = [];
    $total = 0;
    for ($d = 1; $d <= CLASS_MAX_DAYS; $d++) {
        $dayRaw = $isList ? ($d <= 5 ? $raw : []) : ($raw[(string)$d] ?? $raw[$d] ?? []);
        $day = classParseDayPeriods($dayRaw, "Day $d");
        if (is_string($day)) return $day;
        $out[(string)$d] = $day;
        $total += count($day);
    }
    if ($total === 0) return 'Add at least one lesson';
    return $out;
}

/** Bell times of a stored class, always as day => list. */
function classPeriods(array $class): array {
    $p = json_decode($class['periods'] ?? '', true);
    $parsed = is_array($p) && $p ? classParsePeriods($p) : null;
    return is_array($parsed) ? $parsed : classDefaultPeriods();
}

/** Timetable cells: {day 1-6, period, subject, label?, room?}, one per cell; period must exist that day. Returns the list or an error string. */
function classParseSlots($raw, array $periods) {
    if (!is_array($raw) || count($raw) > CLASS_MAX_DAYS * CLASS_MAX_PERIODS) return 'Invalid timetable';
    $out = [];
    $seen = [];
    foreach ($raw as $s) {
        if (!is_array($s)) return 'Invalid timetable';
        $day = (int)($s['day'] ?? 0);
        $period = (int)($s['period'] ?? 0);
        if ($day < 1 || $day > CLASS_MAX_DAYS) return 'Day must be 1 (Monday) to ' . CLASS_MAX_DAYS;
        if ($period < 1 || $period > count($periods[(string)$day] ?? [])) return 'Lesson number out of range for that day';
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
        'periods' => classPeriods($class),
        'subjects' => $subjects,
        'timetable' => $timetable,
        'timetable_versions' => $st->fetchAll(PDO::FETCH_COLUMN),
        'members' => $members,
        'limits_mb' => classLimits($db, $class),
    ];
}
