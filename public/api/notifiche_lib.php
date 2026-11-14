<?php
// public/api/notifiche_lib.php
// Notifications: rows for the in-site bell, plus Web Push to the phones/browsers the user enabled.
// Test reminders are sent by the worker (bin/appunti-ai.php) 2 days before, the day before and the evening before.
require_once __DIR__ . '/classi_lib.php';
require_once __DIR__ . '/appunti_lib.php';
require_once __DIR__ . '/webpush.php';

const NOTIFY_KEEP = 200;               // notifications kept per user
const NOTIFY_PUSH_MAX_FAILURES = 10;   // a subscription failing this many times in a row is dropped
// Reminder slots: [days before the test, local time from which it is sent]
const REMINDER_SLOTS = ['d2' => [2, '16:00'], 'd1' => [1, '16:00'], 'sera' => [1, '21:00']];
const BELL_LEAD_SEC = 300;             // "next lesson" push: this long before the end of the current one

/** Saves a notification for each user and pushes it to their devices. Returns how many pushes were delivered. */
function notifyUsers(PDO $db, array $userIds, ?int $classId, string $kind, string $title, string $body, string $url, bool $push = true, bool $save = true): int {
    $now = time();
    if (!$save) $userIds = array_values(array_unique($userIds));
    $ins = $db->prepare('INSERT INTO notifications (user_id, class_id, kind, title, body, url, created_at) VALUES (:u, :c, :k, :t, :b, :url, :now)');
    $trim = $db->prepare('DELETE FROM notifications WHERE user_id = :u AND id <= (SELECT id FROM notifications WHERE user_id = :u ORDER BY id DESC LIMIT 1 OFFSET ' . NOTIFY_KEEP . ')');
    foreach ($save ? array_unique($userIds) : [] as $u) {
        $ins->execute([':u' => $u, ':c' => $classId, ':k' => $kind, ':t' => $title, ':b' => $body, ':url' => $url, ':now' => $now]);
        $trim->execute([':u' => $u]);
    }
    if (!$push || !$userIds) return 0;

    $ids = implode(',', array_map('intval', array_unique($userIds)));
    $subs = $db->query("SELECT * FROM push_subscriptions WHERE user_id IN ($ids)")->fetchAll();
    $delivered = 0;
    foreach ($subs as $sub) {
        try {
            $code = webpushSend($sub, ['title' => $title, 'body' => $body, 'url' => $url, 'tag' => $kind . ':' . $classId]);
        } catch (Throwable $e) {
            $code = 410;   // keys we cannot use: drop the subscription
        }
        if ($code >= 200 && $code < 300) {
            $db->prepare('UPDATE push_subscriptions SET last_ok_at = :t, failures = 0 WHERE id = :id')->execute([':t' => $now, ':id' => $sub['id']]);
            $delivered++;
        } elseif ($code === 404 || $code === 410 || (int)$sub['failures'] + 1 >= NOTIFY_PUSH_MAX_FAILURES) {
            $db->prepare('DELETE FROM push_subscriptions WHERE id = :id')->execute([':id' => $sub['id']]);
        } else {
            $db->prepare('UPDATE push_subscriptions SET failures = failures + 1 WHERE id = :id')->execute([':id' => $sub['id']]);
        }
    }
    return $delivered;
}

function classMemberIds(PDO $db, int $classId): array {
    $st = $db->prepare('SELECT user_id FROM class_members WHERE class_id = :c');
    $st->execute([':c' => $classId]);
    return array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN));
}

/**
 * Sends the reminders that are due for upcoming tests and oral exams. If the server was off and several slots are
 * due at once, only the latest one is sent (no burst of old reminders). Returns how many reminders went out.
 */
function remindersRun(PDO $db, int $now): int {
    $sent = 0;
    $classes = $db->query("SELECT * FROM school_classes WHERE status = 'active'")->fetchAll();
    $mark = $db->prepare('INSERT OR IGNORE INTO class_event_reminders (event_id, slot, sent_at) VALUES (:e, :s, :t)');
    $done = $db->prepare('SELECT slot FROM class_event_reminders WHERE event_id = :e');
    foreach ($classes as $class) {
        $local = (new DateTimeImmutable('@' . $now))->setTimezone(classTimezone($class));
        $today = $local->format('Y-m-d');
        $time = $local->format('H:i');
        $st = $db->prepare("SELECT e.*, s.name AS subject FROM class_events e JOIN class_subjects s ON s.id = e.subject_id
                            WHERE e.class_id = :c AND e.kind IN ('verifica', 'interrogazione') AND e.event_date BETWEEN :f AND :t");
        $st->execute([':c' => $class['id'], ':f' => $today, ':t' => $local->modify('+2 days')->format('Y-m-d')]);
        foreach ($st->fetchAll() as $ev) {
            $done->execute([':e' => $ev['id']]);
            $already = array_flip($done->fetchAll(PDO::FETCH_COLUMN));
            $due = [];
            foreach (REMINDER_SLOTS as $slot => [$daysBefore, $from]) {
                $day = (new DateTimeImmutable($ev['event_date']))->modify("-$daysBefore days")->format('Y-m-d');
                if ($day === $today && $time >= $from && !isset($already[$slot])) $due[] = $slot;
            }
            if (!$due) continue;
            foreach ($due as $slot) $mark->execute([':e' => $ev['id'], ':s' => $slot, ':t' => $now]);
            [$title, $body] = reminderText($db, $ev, end($due));
            notifyUsers($db, classMemberIds($db, (int)$class['id']), (int)$class['id'], 'promemoria', $title, $body,
                '/pages/appunti.php?class=' . (int)$class['id'] . '&tab=study');
            $sent++;
        }
    }
    return $sent;
}

/**
 * "Next lesson" pushes: BELL_LEAD_SEC before the end of each lesson, to the members who turned them on, the subject
 * and room of the lesson that follows (none after the last one; hours of the same subject in a row are one lesson).
 * Push only, not kept in the bell list (they would bury the test reminders). Sent once per lesson, even if the worker
 * runs late; never more than BELL_LEAD_SEC early.
 */
function bellsRun(PDO $db, int $now): int {
    $sent = 0;
    $classes = $db->query("SELECT c.* FROM school_classes c WHERE c.status = 'active'
                           AND EXISTS (SELECT 1 FROM class_members m WHERE m.class_id = c.id AND m.bell_notify = 1)")->fetchAll();
    $mark = $db->prepare('INSERT OR IGNORE INTO class_bell_sent (class_id, lesson_date, period, sent_at) VALUES (:c, :d, :p, :t)');
    foreach ($classes as $class) {
        $tz = classTimezone($class);
        $date = (new DateTimeImmutable('@' . $now))->setTimezone($tz)->format('Y-m-d');
        $lessons = notesLessonsOn($db, $class, $date);
        for ($i = 0; $i < count($lessons) - 1; $i++) {
            $end = (new DateTimeImmutable("$date {$lessons[$i]['end']}", $tz))->getTimestamp();
            if ($now < $end - BELL_LEAD_SEC || $now >= $end) continue;
            $mark->execute([':c' => $class['id'], ':d' => $date, ':p' => $lessons[$i]['period_to'], ':t' => $now]);
            if ($mark->rowCount() === 0) continue;   // already sent
            $next = $lessons[$i + 1];
            $subject = notesSubjectOf($db, (int)$class['id'], $next['subject_id']);
            $users = $db->prepare('SELECT user_id FROM class_members WHERE class_id = :c AND bell_notify = 1');
            $users->execute([':c' => $class['id']]);
            $mins = max(1, (int)round(($end - $now) / 60));
            notifyUsers($db, array_map('intval', $users->fetchAll(PDO::FETCH_COLUMN)), (int)$class['id'], 'campanella',
                "Tra $mins minuti: " . ($subject['name'] ?? 'lezione'),
                ($next['room'] !== '' ? 'Aula ' . $next['room'] : 'Aula non indicata nell\'orario') . " · dalle {$next['start']} alle {$next['end']}",
                '/pages/appunti.php?class=' . (int)$class['id'], true, false);
            $sent++;
        }
    }
    $db->prepare('DELETE FROM class_bell_sent WHERE sent_at < :t')->execute([':t' => $now - 7 * 86400]);
    return $sent;
}

/** The afternoon before an oral-exam turn (from 16:00), a reminder to who is on it. Returns how many turns were announced. */
function turnsRun(PDO $db, int $now): int {
    $sent = 0;
    $classes = $db->query("SELECT * FROM school_classes WHERE status = 'active'")->fetchAll();
    foreach ($classes as $class) {
        $local = (new DateTimeImmutable('@' . $now))->setTimezone(classTimezone($class));
        if ($local->format('H:i') < '16:00') continue;
        $st = $db->prepare('SELECT t.*, s.name AS subject FROM class_turns t JOIN class_subjects s ON s.id = t.subject_id
                            WHERE t.class_id = :c AND t.turn_date = :d AND t.notified_at IS NULL');
        $st->execute([':c' => $class['id'], ':d' => $local->modify('+1 day')->format('Y-m-d')]);
        foreach ($st->fetchAll() as $t) {
            $db->prepare('UPDATE class_turns SET notified_at = :n WHERE id = :id AND notified_at IS NULL')->execute([':n' => $now, ':id' => $t['id']]);
            $users = array_values(array_intersect(array_map('intval', json_decode($t['user_ids'], true) ?: []), classMemberIds($db, (int)$class['id'])));
            if (!$users) continue;
            notifyUsers($db, $users, (int)$class['id'], 'turno', "Domani sei interrogato in {$t['subject']}",
                ($t['note'] !== '' ? $t['note'] . '. ' : '') . 'Apri le domande fatte in classe e il ripasso.',
                '/pages/appunti-archivio.php?class=' . (int)$class['id'] . '&subject=' . (int)$t['subject_id']);
            $sent++;
        }
    }
    return $sent;
}

function reminderText(PDO $db, array $ev, string $slot): array {
    $what = $ev['kind'] === 'interrogazione' ? 'Interrogazione' : 'Verifica';
    $when = ['d2' => 'tra 2 giorni', 'd1' => 'domani', 'sera' => 'domani: ultimo ripasso'][$slot];
    $date = (new DateTimeImmutable($ev['event_date']))->format('d/m');
    $st = $db->prepare("SELECT kind FROM class_docs WHERE event_id = :e AND status = 'ok'");
    $st->execute([':e' => $ev['id']]);
    $names = ['completo' => 'dispensa', 'riassunto' => 'riassunto', 'preparazione' => 'preparazione', 'quiz' => 'quiz'];
    $docs = array_values(array_intersect_key($names, array_flip($st->fetchAll(PDO::FETCH_COLUMN))));
    $body = $date . ($ev['title'] !== '' ? ' · ' . $ev['title'] : '')
          . ($ev['topics'] !== '' ? '. Argomenti: ' . textCut($ev['topics'], 120) : '')
          . ($docs ? '. Pronti: ' . implode(', ', $docs) . '.' : '.')
          . ($slot === 'sera' && in_array('quiz', $docs, true) ? ' Fai il quiz prima di dormire!' : '');
    return ["$what di {$ev['subject']} $when", $body];
}
