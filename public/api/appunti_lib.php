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
const AI_PERIOD_MAX_DAYS = 120;            // first test of a subject: material of at most this many days before
const REVIEW_DAYS = [1, 3, 7, 14, 30];     // spaced review: days before a question comes back, box by box
const AI_RANGE_MAX_DAYS = 120;   // "Genera ora" on chosen days: at most this long a range

// Accepted uploads: extension => mime types finfo may report for it
const NOTE_FILE_TYPES = [
    'jpg' => ['image/jpeg'], 'jpeg' => ['image/jpeg'], 'png' => ['image/png'], 'webp' => ['image/webp'],
    'heic' => ['image/heic', 'image/heif'], 'heif' => ['image/heif', 'image/heic'],
    'pdf' => ['application/pdf'],
    'txt' => ['text/plain'], 'md' => ['text/plain', 'text/markdown'],
    // recordings of lessons (phone voice recorders, WhatsApp voice notes, ...)
    'mp3' => ['audio/mpeg', 'audio/mp3'], 'm4a' => ['audio/mp4', 'audio/x-m4a', 'video/mp4', 'audio/aac'],
    'aac' => ['audio/aac', 'audio/x-hx-aac-adts'], 'wav' => ['audio/wav', 'audio/x-wav', 'audio/wave'],
    'ogg' => ['audio/ogg', 'application/ogg'], 'opus' => ['audio/ogg', 'audio/opus'], 'flac' => ['audio/flac', 'audio/x-flac'],
    'webm' => ['audio/webm', 'video/webm'],
    'docx' => ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', 'application/octet-stream'],
    'pptx' => ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/zip', 'application/octet-stream'],
    'odt' => ['application/vnd.oasis.opendocument.text', 'application/zip'],
    'odp' => ['application/vnd.oasis.opendocument.presentation', 'application/zip'],
];
const NOTE_MIME_OUT = [
    'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp',
    'heic' => 'image/heic', 'heif' => 'image/heif', 'pdf' => 'application/pdf',
    'txt' => 'text/plain', 'md' => 'text/markdown',
    'mp3' => 'audio/mpeg', 'm4a' => 'audio/mp4', 'aac' => 'audio/aac', 'wav' => 'audio/wav', 'ogg' => 'audio/ogg',
    'opus' => 'audio/ogg', 'flac' => 'audio/flac', 'webm' => 'audio/webm',
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
    // Days (or single hours) without lessons: holidays, strikes, trips, absent teacher
    $off = $db->prepare('SELECT period FROM class_days_off WHERE class_id = :c AND date_from <= :d AND date_to >= :d');
    $off->execute([':c' => $class['id'], ':d' => $date]);
    $offPeriods = [];
    foreach ($off->fetchAll(PDO::FETCH_COLUMN) as $p) {
        if ($p === null) return [];
        $offPeriods[(int)$p] = true;
    }
    $timetable = classTimetableFor($db, (int)$class['id'], $date);
    if (!$timetable) return [];
    $bells = classPeriods($class)[(string)$weekday] ?? [];

    $slots = array_values(array_filter($timetable['slots'], fn($s) => (int)$s['day'] === $weekday && isset($bells[$s['period'] - 1])
        && !isset($offPeriods[(int)$s['period']])));
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

/**
 * The study period of a test or oral exam: from the day after the previous test of the same subject
 * (or AI_PERIOD_MAX_DAYS before) to the test day. Returns [from, to] as YYYY-MM-DD.
 */
function notesEventPeriod(PDO $db, array $ev): array {
    if (!empty($ev['period_from'])) return [$ev['period_from'], $ev['period_to'] ?: $ev['event_date']];   // chosen by hand
    $prev = $db->prepare("SELECT MAX(event_date) FROM class_events WHERE class_id = :c AND subject_id = :s
                          AND kind IN ('verifica', 'interrogazione') AND event_date < :d");
    $prev->execute([':c' => $ev['class_id'], ':s' => $ev['subject_id'], ':d' => $ev['event_date']]);
    $prevDate = $prev->fetchColumn() ?: null;
    $from = $prevDate
        ? (new DateTimeImmutable($prevDate))->modify('+1 day')->format('Y-m-d')
        : (new DateTimeImmutable($ev['event_date']))->modify('-' . AI_PERIOD_MAX_DAYS . ' days')->format('Y-m-d');
    // With topics in the calendar: from the start of the earliest topic of this test (it may have begun before the
    // previous test), not from a guess
    $off = array_flip(array_map('intval', json_decode($ev['topics_off'] ?? '[]', true) ?: []));
    $starts = [];
    foreach (notesTopics($db, (int)$ev['class_id'], (int)$ev['subject_id']) as $t) {
        if (isset($off[(int)$t['id']]) || $t['start_date'] > $ev['event_date']) continue;
        if ($t['end_date'] !== null && $t['end_date'] < $from) continue;   // finished before this period
        $starts[] = $t['start_date'];
    }
    if ($starts) $from = min($starts);
    return [$from, $ev['event_date']];
}

/** Confirmed topics of a subject (or of the whole class), oldest first. */
function notesTopics(PDO $db, int $classId, ?int $subjectId = null): array {
    $st = $db->prepare("SELECT * FROM class_topics WHERE class_id = :c AND status = 'ok'" . ($subjectId !== null ? ' AND subject_id = :s' : '') . ' ORDER BY start_date, id');
    $st->execute([':c' => $classId] + ($subjectId !== null ? [':s' => $subjectId] : []));
    return $st->fetchAll();
}

/**
 * Which lesson days a test covers inside its period: every day, except those that belong only to topics unticked
 * for this test. Returns a function(date): bool.
 */
function notesEventDayFilter(PDO $db, array $ev): callable {
    $off = array_flip(array_map('intval', json_decode($ev['topics_off'] ?? '[]', true) ?: []));
    if (!$off) return fn(string $d): bool => true;
    $topics = notesTopics($db, (int)$ev['class_id'], (int)$ev['subject_id']);
    $last = $ev['event_date'];
    return function (string $d) use ($topics, $off, $last): bool {
        $inOff = false;
        foreach ($topics as $t) {
            if ($d < $t['start_date'] || $d > ($t['end_date'] ?: $last)) continue;
            if (!isset($off[(int)$t['id']])) return true;   // also part of a topic that is in the test
            $inOff = true;
        }
        return !$inOff;
    };
}

/**
 * Which lessons the daily AI run works on. With no topics in the class: all (as before). With topics: only the lessons
 * of a topic still open (no end yet) or inside the period of a coming test, so finished topics are left alone.
 * Returns a function(subjectId, date): bool, or null for "all".
 */
function notesAiScope(PDO $db, array $class): ?callable {
    $topics = notesTopics($db, (int)$class['id']);
    if (!$topics) return null;
    $today = classToday($class);
    $st = $db->prepare("SELECT * FROM class_events WHERE class_id = :c AND kind IN ('verifica', 'interrogazione') AND event_date >= :d");
    $st->execute([':c' => $class['id'], ':d' => (new DateTimeImmutable($today))->modify('-1 day')->format('Y-m-d')]);
    $events = [];
    foreach ($st->fetchAll() as $ev) $events[] = [(int)$ev['subject_id'], notesEventPeriod($db, $ev), notesEventDayFilter($db, $ev)];
    return function (int $subjectId, string $date) use ($topics, $events): bool {
        foreach ($topics as $t) {
            if ((int)$t['subject_id'] === $subjectId && $t['end_date'] === null && $date >= $t['start_date']) return true;
        }
        foreach ($events as [$sid, [$from, $to], $ok]) {
            if ($sid === $subjectId && $date >= $from && $date <= $to && $ok($date)) return true;
        }
        return false;
    };
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
            'size' => (int)$f['size'], 'text_status' => $f['text_status'], 'can_delete' => $canManage || (int)$item['author_id'] === $me,
        ], $files),
    ];
}

function notesFormatEvent(array $e, int $me, bool $canManage): array {
    return [
        'id' => (int)$e['id'], 'subject_id' => (int)$e['subject_id'], 'subject' => $e['subject'] ?? '',
        'kind' => $e['kind'], 'date' => $e['event_date'], 'title' => $e['title'], 'topics' => $e['topics'],
        'period_from' => $e['period_from'] ?? null, 'period_to' => $e['period_to'] ?? null,
        'topics_off' => array_map('intval', json_decode($e['topics_off'] ?? '[]', true) ?: []),
        'author' => $e['author'] ?? null, 'can_edit' => $canManage || (int)$e['author_id'] === $me,
    ];
}


/* ---------- question pools: custom quizzes and the questions asked in class ---------- */

/** The multiple-choice questions of the class quizzes: [{doc_id, q, question, options, answer, explanation, prof, topic, subject_id}]. */
function notesQuizPool(PDO $db, int $classId, int $subjectId = 0): array {
    $st = $db->prepare("SELECT id, subject_id, content FROM class_docs WHERE class_id = :c AND kind = 'quiz' AND status = 'ok'" . ($subjectId ? ' AND subject_id = :s' : ''));
    $st->execute($subjectId ? [':c' => $classId, ':s' => $subjectId] : [':c' => $classId]);
    $pool = [];
    foreach ($st->fetchAll() as $d) {
        $qs = json_decode($d['content'], true)['questions'] ?? [];
        foreach ($qs as $i => $q) {
            if (!is_array($q) || !isset($q['question'], $q['options'], $q['answer']) || !is_array($q['options']) || count($q['options']) < 2) continue;
            $pool[] = ['doc_id' => (int)$d['id'], 'q' => (int)$i, 'question' => (string)$q['question'], 'options' => array_map('strval', array_values($q['options'])),
                       'answer' => (int)$q['answer'], 'explanation' => (string)($q['explanation'] ?? ''), 'prof' => !empty($q['prof']),
                       'topic' => (string)($q['topic'] ?? ''), 'subject_id' => (int)$d['subject_id']];
        }
    }
    return $pool;
}

/** Meaningful words of a question (3+ letters, no filler words), to recognise the same question asked in other words. */
function notesWords(string $s): array {
    static $stop = ['che', 'per', 'del', 'della', 'delle', 'dei', 'degli', 'come', 'cosa', 'qual', 'quale', 'quali', 'sono', 'nel', 'nella', 'nelle', 'alla', 'alle', 'allo',
                    'con', 'una', 'uno', 'gli', 'fra', 'tra', 'spiega', 'spiegare', 'dimmi', 'dici', 'parla', 'perché', 'perche', 'cos', 'più', 'sul', 'sulla', 'dal', 'dalla', 'questo', 'questa'];
    preg_match_all('/[\p{L}\p{N}]{3,}/u', function_exists('mb_strtolower') ? mb_strtolower($s) : strtolower($s), $m);
    return array_values(array_diff(array_unique($m[0]), $stop));
}

/**
 * The open questions asked in class (documents "domande"), the same question asked on different days counted together:
 * [{domanda, risposta, origine, count, dates[], subject_id}] with the most asked first (the teacher's before the AI's).
 */
function notesAskedQuestions(PDO $db, int $classId, int $subjectId = 0): array {
    $st = $db->prepare("SELECT subject_id, lesson_date, content FROM class_docs WHERE class_id = :c AND kind = 'domande' AND status = 'ok'" . ($subjectId ? ' AND subject_id = :s' : '') . ' ORDER BY lesson_date');
    $st->execute($subjectId ? [':c' => $classId, ':s' => $subjectId] : [':c' => $classId]);
    $groups = [];
    foreach ($st->fetchAll() as $d) {
        foreach ((json_decode($d['content'], true)['domande'] ?? []) as $q) {
            if (!is_array($q) || trim((string)($q['domanda'] ?? '')) === '') continue;
            $w = notesWords((string)$q['domanda']);
            $hit = null;
            foreach ($groups as $k => $g) {
                if ($g['subject_id'] !== (int)$d['subject_id']) continue;
                $common = count(array_intersect($w, $g['words']));
                $small = min(count($w), count($g['words']));
                // the same question in other words: most of the shorter one's words are in the other (a very short one must match almost fully)
                if ($small > 0 && $common >= min(2, $small) && $common / $small >= ($small <= 3 ? 0.8 : 0.6)) { $hit = $k; break; }
            }
            $prof = ($q['origine'] ?? '') === 'prof';
            if ($hit === null) {
                $groups[] = ['domanda' => (string)$q['domanda'], 'risposta' => (string)($q['risposta'] ?? ''), 'origine' => $prof ? 'prof' : 'ai', 'words' => $w,
                             'count' => $prof ? 1 : 0, 'dates' => $d['lesson_date'] ? [$d['lesson_date']] : [], 'subject_id' => (int)$d['subject_id']];
            } else {
                $g = &$groups[$hit];
                if ($prof) { $g['count']++; $g['origine'] = 'prof'; }
                if ($d['lesson_date'] && !in_array($d['lesson_date'], $g['dates'], true)) $g['dates'][] = $d['lesson_date'];
                if ($g['risposta'] === '' && !empty($q['risposta'])) $g['risposta'] = (string)$q['risposta'];
                unset($g);
            }
        }
    }
    usort($groups, fn($a, $b) => ($b['origine'] === 'prof') <=> ($a['origine'] === 'prof') ?: $b['count'] <=> $a['count'] ?: strcmp($a['domanda'], $b['domanda']));
    return array_map(function ($g) { unset($g['words']); return $g; }, $groups);
}


/**
 * Lessons already held (days before today, inside the chosen dates, at most 60 days back) for which nobody uploaded anything:
 * [{date, subject_id, subject}], newest first. Empty when the option is off. Days without lessons are not counted.
 */
function notesMissing(PDO $db, array $class): array {
    $set = notesMissingSettings($class);
    if (!$set['on'] || !classValidDate($set['from'])) return [];
    $today = classToday($class);
    $last = (new DateTimeImmutable($today))->modify('-1 day')->format('Y-m-d');
    if (classValidDate($set['to']) && $set['to'] < $last) $last = $set['to'];
    $first = max($set['from'], (new DateTimeImmutable($today))->modify('-60 days')->format('Y-m-d'));
    if ($first > $last) return [];
    $st = $db->prepare('SELECT DISTINCT subject_id, lesson_date FROM class_items WHERE class_id = :c AND lesson_date BETWEEN :f AND :t');
    $st->execute([':c' => $class['id'], ':f' => $first, ':t' => $last]);
    $have = [];
    foreach ($st->fetchAll() as $r) $have[$r['lesson_date'] . ':' . $r['subject_id']] = true;
    $names = array_column(classSubjects($db, (int)$class['id']), 'name', 'id');
    $out = [];
    for ($d = new DateTimeImmutable($last); $d->format('Y-m-d') >= $first; $d = $d->modify('-1 day')) {
        $date = $d->format('Y-m-d');
        $seen = [];
        foreach (notesLessonsOn($db, $class, $date) as $l) {
            $sid = (int)$l['subject_id'];
            if (isset($seen[$sid]) || in_array($sid, $set['subjects_off'], true) || in_array("$date:$sid", $set['skip'], true) || isset($have["$date:$sid"])) continue;
            $seen[$sid] = true;
            $out[] = ['date' => $date, 'subject_id' => $sid, 'subject' => $names[$sid] ?? '?'];
        }
    }
    return $out;
}
