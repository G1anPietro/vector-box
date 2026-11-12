<?php
// public/api/appunti_lib.php
// Study material of a class (api/appunti.php): which lesson a moment belongs to, file storage,
// local text extraction (plain text and Office files; photos and PDFs are transcribed later by the AI).
require_once __DIR__ . '/classi_lib.php';

const NOTE_KINDS = ['appunti', 'slide', 'libro', 'domande', 'prova', 'altro'];
const EVENT_KINDS = ['verifica', 'interrogazione', 'altro'];
const NOTE_TITLE_MAX = 120;
const NOTE_BODY_MAX = 50000;
const NOTE_MAX_FILES = 20;
const NOTE_TEXT_MAX = 400000;          // characters kept from one extracted file
const EVENT_TOPICS_MAX = 2000;

// Accepted uploads: extension => mime types finfo may report for it
const NOTE_FILE_TYPES = [
    'jpg' => ['image/jpeg'], 'jpeg' => ['image/jpeg'], 'png' => ['image/png'], 'webp' => ['image/webp'],
    'heic' => ['image/heic', 'image/heif'], 'heif' => ['image/heif', 'image/heic'],
    'pdf' => ['application/pdf'],
    'txt' => ['text/plain'], 'md' => ['text/plain', 'text/markdown'],
    'docx' => ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', 'application/octet-stream'],
    'pptx' => ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/zip', 'application/octet-stream'],
    'odt' => ['application/vnd.oasis.opendocument.text', 'application/zip'],
    'odp' => ['application/vnd.oasis.opendocument.presentation', 'application/zip'],
];
const NOTE_MIME_OUT = [
    'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp',
    'heic' => 'image/heic', 'heif' => 'image/heif', 'pdf' => 'application/pdf',
    'txt' => 'text/plain', 'md' => 'text/markdown',
    'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'pptx' => 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'odt' => 'application/vnd.oasis.opendocument.text',
    'odp' => 'application/vnd.oasis.opendocument.presentation',
];

function notesDir(int $classId): string {
    return dirname(__DIR__, 2) . '/data/appunti/' . $classId;
}

/** Bytes used by a class's files. */
function notesUsedBytes(PDO $db, int $classId): int {
    $st = $db->prepare('SELECT COALESCE(SUM(size), 0) FROM class_item_files WHERE class_id = :c');
    $st->execute([':c' => $classId]);
    return (int)$st->fetchColumn();
}

/**
 * The lessons of a day, with consecutive hours of the same subject merged into one lesson
 * (e.g. a two-hour lab). Each: {period, period_to, subject_id, label, room, start, end}.
 */
function notesLessonsOn(PDO $db, array $class, string $date): array {
    $weekday = (int)(new DateTimeImmutable($date))->format('N');
    if ($weekday > CLASS_MAX_DAYS) return [];
    $timetable = classTimetableFor($db, (int)$class['id'], $date);
    if (!$timetable) return [];
    $bells = classPeriods($class)[(string)$weekday] ?? [];

    $slots = array_values(array_filter($timetable['slots'], fn($s) => (int)$s['day'] === $weekday && isset($bells[$s['period'] - 1])));
    usort($slots, fn($a, $b) => $a['period'] <=> $b['period']);
    $out = [];
    foreach ($slots as $s) {
        $bell = $bells[$s['period'] - 1];
        $last = $out ? count($out) - 1 : -1;
        if ($last >= 0 && $out[$last]['subject_id'] === (int)$s['subject_id'] && $out[$last]['period_to'] === $s['period'] - 1) {
            $out[$last]['period_to'] = (int)$s['period'];
            $out[$last]['end'] = $bell['end'];
            continue;
        }
        $out[] = [
            'period' => (int)$s['period'], 'period_to' => (int)$s['period'], 'subject_id' => (int)$s['subject_id'],
            'label' => (string)($s['label'] ?? ''), 'room' => (string)($s['room'] ?? ''),
            'start' => $bell['start'], 'end' => $bell['end'],
        ];
    }
    return $out;
}

/**
 * Which lesson a moment belongs to: the one in progress, else the last one that ended that day
 * (notes uploaded after class). Returns {date, lesson|null}.
 */
function notesSuggest(PDO $db, array $class, int $ts): array {
    $local = (new DateTimeImmutable('@' . $ts))->setTimezone(classTimezone($class));
    $date = $local->format('Y-m-d');
    $time = $local->format('H:i');
    $pick = null;
    foreach (notesLessonsOn($db, $class, $date) as $lesson) {
        if ($lesson['start'] <= $time) $pick = $lesson;
    }
    return ['date' => $date, 'lesson' => $pick];
}

function notesSubjectOf(PDO $db, int $classId, int $subjectId): ?array {
    $st = $db->prepare('SELECT id, name FROM class_subjects WHERE id = :s AND class_id = :c');
    $st->execute([':s' => $subjectId, ':c' => $classId]);
    return $st->fetch() ?: null;
}

/** Checks an uploaded file's real type. Returns [ext, mime] or null. */
function notesFileType(string $path, string $originalName): ?array {
    $ext = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
    if (!isset(NOTE_FILE_TYPES[$ext])) return null;
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($path) ?: '';
    if (!in_array($mime, NOTE_FILE_TYPES[$ext], true)) return null;
    // Office files are zips: make sure the expected part is inside
    $inner = ['docx' => 'word/document.xml', 'pptx' => 'ppt/presentation.xml', 'odt' => 'content.xml', 'odp' => 'content.xml'][$ext] ?? null;
    if ($inner !== null) {
        $zip = new ZipArchive();
        if ($zip->open($path, ZipArchive::RDONLY) !== true) return null;
        $ok = $zip->locateName($inner) !== false;
        $zip->close();
        if (!$ok) return null;
    }
    return [$ext, NOTE_MIME_OUT[$ext]];
}

/** Plain text of an XML part: one line per paragraph, entities decoded. */
function notesXmlText(string $xml, string $paragraphTag): string {
    $xml = preg_replace('#</' . preg_quote($paragraphTag, '#') . '>#', "\n", $xml) ?? '';
    $xml = preg_replace('#<(w:tab|text:tab)[^>]*/>#', "\t", $xml) ?? '';
    $xml = preg_replace('#<(w:br|a:br|text:line-break)[^>]*/>#', "\n", $xml) ?? '';
    $text = html_entity_decode(strip_tags($xml), ENT_QUOTES | ENT_XML1, 'UTF-8');
    return trim(preg_replace("/\n{3,}/", "\n\n", $text) ?? '');
}

/**
 * Text that can be read without the AI. Returns [text, status]: status 'done' with the text,
 * 'pending' for photos and PDFs (transcribed by the AI later), 'failed' if a document is unreadable.
 */
function notesExtractText(string $path, string $ext): array {
    if (in_array($ext, ['txt', 'md'], true)) {
        $text = (string)file_get_contents($path, false, null, 0, NOTE_TEXT_MAX * 4);
        if (!preg_match('//u', $text)) {   // not UTF-8: old Windows text files (mbstring may be missing)
            $text = function_exists('mb_convert_encoding')
                ? mb_convert_encoding($text, 'UTF-8', 'Windows-1252')
                : (string)iconv('Windows-1252', 'UTF-8//IGNORE', $text);
        }
        return [textCut($text, NOTE_TEXT_MAX), 'done'];
    }
    if (!in_array($ext, ['docx', 'pptx', 'odt', 'odp'], true)) return [null, 'pending'];

    $zip = new ZipArchive();
    if ($zip->open($path, ZipArchive::RDONLY) !== true) return [null, 'failed'];
    $parts = [];
    if ($ext === 'docx') {
        $parts[] = notesXmlText((string)$zip->getFromName('word/document.xml'), 'w:p');
    } elseif ($ext === 'pptx') {
        $slides = [];
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $name = (string)$zip->getNameIndex($i);
            if (preg_match('#^ppt/slides/slide(\d+)\.xml$#', $name, $m)) $slides[(int)$m[1]] = $name;
        }
        ksort($slides);
        foreach ($slides as $n => $name) {
            $text = notesXmlText((string)$zip->getFromName($name), 'a:p');
            $notes = $zip->getFromName("ppt/notesSlides/notesSlide$n.xml");
            $parts[] = "--- Slide $n ---\n" . $text
                . ($notes !== false && ($nt = notesXmlText($notes, 'a:p')) !== '' ? "\n[Note: $nt]" : '');
        }
    } else {
        $parts[] = notesXmlText((string)$zip->getFromName('content.xml'), 'text:p');
    }
    $zip->close();
    $text = trim(implode("\n\n", $parts));
    return $text === '' ? [null, 'failed'] : [textCut($text, NOTE_TEXT_MAX), 'done'];
}

function notesFormatItem(array $item, array $files, int $me, bool $canManage): array {
    return [
        'id' => (int)$item['id'],
        'subject_id' => (int)$item['subject_id'],
        'subject' => $item['subject'] ?? '',
        'kind' => $item['kind'],
        'lesson_date' => $item['lesson_date'],
        'period' => $item['period'] !== null ? (int)$item['period'] : null,
        'title' => $item['title'],
        'body' => $item['body'],
        'author' => $item['author'] ?? null,
        'mine' => (int)$item['author_id'] === $me,
        'can_edit' => $canManage || (int)$item['author_id'] === $me,
        'source' => $item['source'],
        'created_at' => (int)$item['created_at'],
        'files' => array_map(fn($f) => [
            'id' => (int)$f['id'], 'name' => $f['original_name'], 'mime' => $f['mime'],
            'size' => (int)$f['size'], 'text_status' => $f['text_status'],
        ], $files),
    ];
}

function notesFormatEvent(array $e, int $me, bool $canManage): array {
    return [
        'id' => (int)$e['id'], 'subject_id' => (int)$e['subject_id'], 'subject' => $e['subject'] ?? '',
        'kind' => $e['kind'], 'date' => $e['event_date'], 'title' => $e['title'], 'topics' => $e['topics'],
        'author' => $e['author'] ?? null, 'can_edit' => $canManage || (int)$e['author_id'] === $me,
    ];
}
