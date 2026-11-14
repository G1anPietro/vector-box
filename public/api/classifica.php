<?php
// public/api/classifica.php
// The class scoreboard (points come from api/appunti.php quiz_answer / review_answer, see classifica_lib.php).
//
// GET  ?action=board&class_id=ID -> {on, who, in, can_see, can_manage, week_start, week:[{user_id,name,points,me}], total:[...],
//                                    mine:{week,total,rank_week,rank_total,count}}
// POST {action:"set_in", class_id, in}            -> I take part (or leave: my points are deleted)
//      {action:"settings", class_id, on, who}     -> class: scoreboard on/off, shown to "all" or only to who has the "scoreboard" permission
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/rate_limiter.php';
require_once __DIR__ . '/classi_lib.php';
require_once __DIR__ . '/classifica_lib.php';

initSession();
requireLogin();
header('Cache-Control: no-store');
$me = (int)$_SESSION['user_id'];
$isAdmin = !empty($_SESSION['is_admin']);

function scFail(string $code, string $msg, int $status = 400): void {
    jsonResponse(['success' => false, 'code' => $code, 'error' => $msg], $status);
}

function scClass(PDO $db, int $id, int $me, bool $isAdmin): array {
    $class = classLoad($db, $id);
    if (!$class || $class['status'] !== 'active' || (!$isAdmin && !classIsMember($db, $id, $me))) scFail('not_found', 'Class not found', 404);
    return [$class, classPerms($db, $class, $me, $isAdmin)];
}

/** [{user_id, name, points, me}] of the members who take part, best first (ties: alphabetical). */
function scTable(PDO $db, int $classId, int $me, int $since): array {
    $st = $db->prepare("SELECT m.user_id, m.settings, CASE WHEN LENGTH(m.display_name) > 0 THEN m.display_name ELSE a.username END AS name,
                               COALESCE((SELECT SUM(e.points) FROM score_events e WHERE e.class_id = m.class_id AND e.user_id = m.user_id AND e.created_at >= :since), 0) AS points
                        FROM class_members m JOIN accounts a ON a.id = m.user_id WHERE m.class_id = :c");
    $st->execute([':c' => $classId, ':since' => $since]);
    $rows = [];
    foreach ($st->fetchAll() as $r) {
        $s = json_decode((string)$r['settings'], true);
        if (is_array($s) && ($s['scoreboard_in'] ?? true) === false) continue;
        $rows[] = ['user_id' => (int)$r['user_id'], 'name' => $r['name'], 'points' => (int)$r['points'], 'me' => (int)$r['user_id'] === $me];
    }
    usort($rows, fn($a, $b) => $b['points'] <=> $a['points'] ?: strcasecmp($a['name'], $b['name']));
    return $rows;
}

try {
    $db = getDbConnection();

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        if ((string)($_GET['action'] ?? '') !== 'board') scFail('unknown_action', 'Unknown action');
        [$class, $perms] = scClass($db, (int)($_GET['class_id'] ?? 0), $me, $isAdmin);
        $set = scoreSettings($class);
        $in = scoreMemberIn($db, (int)$class['id'], $me);
        $canManage = in_array('settings', $perms, true);
        if (!$set['on']) jsonResponse(['success' => true, 'on' => false, 'who' => $set['who'], 'in' => $in, 'can_manage' => $canManage, 'can_see' => false]);

        $weekStart = (new DateTimeImmutable('monday this week 00:00', classTimezone($class)))->getTimestamp();
        $week = scTable($db, (int)$class['id'], $me, $weekStart);
        $total = scTable($db, (int)$class['id'], $me, 0);
        $rank = function (array $rows) use ($me) { foreach ($rows as $i => $r) if ($r['user_id'] === $me) return [$i + 1, $r['points']]; return [null, 0]; };
        [$rw, $pw] = $rank($week);
        [$rt, $pt] = $rank($total);
        // Who may see the whole table: everybody, or (reserved) the representative and who has the "scoreboard" permission
        $canSee = $set['who'] === 'all' || in_array('scoreboard', $perms, true);
        jsonResponse(['success' => true, 'on' => true, 'who' => $set['who'], 'in' => $in, 'can_see' => $canSee, 'can_manage' => $canManage,
            'week_start' => $weekStart,
            'week' => $canSee ? $week : [], 'total' => $canSee ? $total : [],
            'mine' => ['week' => $pw, 'total' => $pt, 'rank_week' => $rw, 'rank_total' => $rt, 'count' => count($week)]]);
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') scFail('method', 'Method not allowed', 405);
    requireCsrf();
    $in = readJsonBody();
    $action = (string)($in['action'] ?? '');
    if (!checkRateLimit('class_score', 60, 3600, 'user:' . $me)) scFail('slow_down', 'Too many changes, try later', 429);
    [$class, $perms] = scClass($db, (int)($in['class_id'] ?? 0), $me, $isAdmin);
    $classId = (int)$class['id'];

    if ($action === 'set_in') {
        if (!classIsMember($db, $classId, $me)) scFail('not_member', 'You are not in this class', 403);
        $want = !empty($in['in']);
        $st = $db->prepare('SELECT settings FROM class_members WHERE class_id = :c AND user_id = :u');
        $st->execute([':c' => $classId, ':u' => $me]);
        $settings = json_decode((string)$st->fetchColumn(), true);
        if (!is_array($settings)) $settings = [];
        $settings['scoreboard_in'] = $want;
        $db->exec('BEGIN IMMEDIATE');
        try {
            $db->prepare('UPDATE class_members SET settings = :s WHERE class_id = :c AND user_id = :u')->execute([':s' => json_encode($settings), ':c' => $classId, ':u' => $me]);
            // Leaving: everything earned so far goes away (coming back starts from zero)
            if (!$want) $db->prepare('DELETE FROM score_events WHERE class_id = :c AND user_id = :u')->execute([':c' => $classId, ':u' => $me]);
            $db->exec('COMMIT');
        } catch (Throwable $e) {
            if ($db->inTransaction()) $db->exec('ROLLBACK');
            throw $e;
        }
        jsonResponse(['success' => true, 'in' => $want]);
    }

    if ($action === 'settings') {
        if (!in_array('settings', $perms, true)) scFail('forbidden', 'You do not have the permission to do this', 403);
        $settings = json_decode((string)($class['settings'] ?? '{}'), true);
        if (!is_array($settings)) $settings = [];
        $settings['scoreboard'] = ['on' => !empty($in['on']), 'who' => ($in['who'] ?? 'all') === 'perm' ? 'perm' : 'all'];
        $db->prepare('UPDATE school_classes SET settings = :s WHERE id = :id')->execute([':s' => json_encode($settings), ':id' => $classId]);
        jsonResponse(['success' => true] + $settings['scoreboard']);
    }

    scFail('unknown_action', 'Unknown action');
} catch (Throwable $e) {
    failInternal('SCORE', $e);
}
