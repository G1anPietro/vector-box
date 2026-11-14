<?php
// public/api/classifica_lib.php — the class scoreboard: who takes part, how points are given, caps.
//
// Points (all judged by the server, never by the page):
//   quiz: SCORE_QUIZ for a right answer at the FIRST try of that question (once per question, ever), not when the answer
//         comes less than SCORE_MIN_GAP seconds after the quiz was opened or the previous answer;
//   review: SCORE_REVIEW for a right answer to a card that was due (the card then goes away for days, so it cannot be farmed).
// A member can leave the scoreboard: their points are deleted and no new ones are kept. The class can switch it off or
// show the table only to who has the "scoreboard" permission.
const SCORE_QUIZ = 10;
const SCORE_REVIEW = 5;
const SCORE_MIN_GAP = 2;          // seconds
const SCORE_DAILY_CAP = 250;      // points a member can earn in one class per day

function scoreSettings(array $class): array {
    $s = json_decode((string)($class['settings'] ?? '{}'), true);
    $b = is_array($s) && is_array($s['scoreboard'] ?? null) ? $s['scoreboard'] : [];
    return ['on' => ($b['on'] ?? true) !== false, 'who' => ($b['who'] ?? 'all') === 'perm' ? 'perm' : 'all'];
}

function scoreMemberIn(PDO $db, int $classId, int $userId): bool {
    $st = $db->prepare('SELECT settings FROM class_members WHERE class_id = :c AND user_id = :u');
    $st->execute([':c' => $classId, ':u' => $userId]);
    $row = $st->fetchColumn();
    if ($row === false) return false;
    $s = json_decode((string)$row, true);
    return !is_array($s) || ($s['scoreboard_in'] ?? true) !== false;
}

/** Gives points when the class has the scoreboard on and the member takes part. Returns the points really given. */
function scoreAward(PDO $db, array $class, int $userId, string $kind, int $points, string $ref): int {
    if ($points <= 0 || !scoreSettings($class)['on'] || !scoreMemberIn($db, (int)$class['id'], $userId)) return 0;
    $day = (new DateTimeImmutable('today', classTimezone($class)))->getTimestamp();
    $got = $db->prepare('SELECT COALESCE(SUM(points), 0) FROM score_events WHERE class_id = :c AND user_id = :u AND created_at >= :d');
    $got->execute([':c' => $class['id'], ':u' => $userId, ':d' => $day]);
    $points = min($points, SCORE_DAILY_CAP - (int)$got->fetchColumn());
    if ($points <= 0) return 0;
    $db->prepare('INSERT INTO score_events (class_id, user_id, kind, points, ref, created_at) VALUES (:c, :u, :k, :p, :r, :t)')
       ->execute([':c' => $class['id'], ':u' => $userId, ':k' => $kind, ':p' => $points, ':r' => $ref, ':t' => time()]);
    return $points;
}
