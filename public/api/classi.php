<?php
// public/api/classi.php
// School classes for the shared notes. A registered user asks for a class, the admin approves it
// (and can close new requests); the requester becomes the class manager, classmates join with the
// invite code. The manager keeps the subjects, bell times, timetable and summary time up to date.
//
// GET  ?action=mine              -> my classes, my requests, whether requests are open
// GET  ?action=class&id=ID       -> one class (members and admin only)
// GET  ?action=requests          -> pending requests (admin)
// GET  ?action=all               -> every class (admin)
// POST {action:"request", name, school, note}
//      {action:"decide", id, approve}                 (admin)
//      {action:"set_requests_open", open}             (admin)
//      {action:"set_limits", file_mb, class_mb[, id]} (admin; with id: that class only, empty = site default)
//      {action:"delete_class", id}                    (admin)
//      {action:"join", code} | {action:"leave", id}
//      {action:"regen_code", id} | {action:"remove_member", id, user_id} | {action:"set_manager", id, user_id}
//      {action:"settings", id, summary_time, timezone, summary_on?}
//      multipart {action:"read_timetable", id, files[]}: the AI reads a photo/PDF of the timetable (and of the bell
//                times) and returns {periods, slots} to review in the editor; nothing is saved
//      {action:"save_timetable", id, valid_from, periods:{"1":[{start,end}],...,"6":[...]} (or one list for Mon-Fri),
//                                slots:[{day,period,subject,label,room}]}
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/rate_limiter.php';
require_once __DIR__ . '/classi_lib.php';

initSession();
requireLogin();
header('Cache-Control: no-store');

$me = (int)$_SESSION['user_id'];
$isAdmin = !empty($_SESSION['is_admin']);

function clFail(string $code, string $message, int $status = 400): void {
    jsonResponse(['success' => false, 'code' => $code, 'error' => $message], $status);
}

/** Loads a class the caller may see (member or admin), or stops with 404. */
function clVisible(PDO $db, int $id, int $me, bool $isAdmin): array {
    $class = classLoad($db, $id);
    if (!$class || (!$isAdmin && !classIsMember($db, $id, $me))) clFail('not_found', 'Class not found', 404);
    return $class;
}

/** Loads an active class where the caller has a permission (the representative and the admin have all), or stops. */
function clManaged(PDO $db, int $id, int $me, bool $isAdmin, string $perm = 'settings'): array {
    $class = clVisible($db, $id, $me, $isAdmin);
    if ($class['status'] !== 'active') clFail('not_active', 'This class is not active', 409);
    if (!in_array($perm, classPerms($db, $class, $me, $isAdmin), true)) clFail('not_manager', 'You do not have the permission to do this', 403);
    return $class;
}

/** Only the representative (or the site admin). */
function clRepresentative(PDO $db, int $id, int $me, bool $isAdmin): array {
    $class = clVisible($db, $id, $me, $isAdmin);
    if ($class['status'] !== 'active') clFail('not_active', 'This class is not active', 409);
    if (!$isAdmin && (int)$class['manager_id'] !== $me) clFail('not_manager', 'Only the representative can do this', 403);
    return $class;
}

function clRoleOf(PDO $db, int $classId, int $roleId): ?array {
    $st = $db->prepare('SELECT * FROM class_roles WHERE id = :r AND class_id = :c');
    $st->execute([':r' => $roleId, ':c' => $classId]);
    return $st->fetch() ?: null;
}

function clText($value, int $max): string {
    $s = trim(preg_replace('/[\x00-\x1F\x7F]+/u', ' ', (string)$value) ?? '');
    return textCut($s, $max);
}

try {
    $db = getDbConnection();

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $action = (string)($_GET['action'] ?? '');

        if ($action === 'mine') {
            // The site admin sees every active class (marked when not a member)
            $st = $db->prepare("SELECT c.*, (SELECT COUNT(*) FROM class_members m2 WHERE m2.class_id = c.id) AS members,
                                       EXISTS (SELECT 1 FROM class_members m WHERE m.class_id = c.id AND m.user_id = :me) AS is_member
                                FROM school_classes c WHERE c.status = 'active'
                                " . ($isAdmin ? '' : 'AND EXISTS (SELECT 1 FROM class_members m WHERE m.class_id = c.id AND m.user_id = :me)') . "
                                ORDER BY is_member DESC, c.school, c.name");
            $st->execute([':me' => $me]);
            $classes = array_map(fn($c) => classSummaryRow($c, $me), $st->fetchAll());

            $st = $db->prepare("SELECT * FROM school_classes WHERE manager_id = :me AND status IN ('pending','rejected')
                                ORDER BY created_at DESC LIMIT 10");
            $st->execute([':me' => $me]);
            $requests = array_map(fn($c) => [
                'id' => (int)$c['id'], 'name' => $c['name'], 'school' => $c['school'],
                'status' => $c['status'], 'created_at' => (int)$c['created_at'],
            ], $st->fetchAll());

            jsonResponse([
                'success' => true,
                'is_admin' => $isAdmin,
                'requests_open' => classRequestsOpen($db),
                'classes' => $classes,
                'requests' => $requests,
            ]);
        }

        if ($action === 'class') {
            $class = clVisible($db, (int)($_GET['id'] ?? 0), $me, $isAdmin);
            jsonResponse(['success' => true, 'class' => classDetail($db, $class, $me, $isAdmin)]);
        }

        if ($action === 'requests' || $action === 'all') {
            requireAdmin();
            $where = $action === 'requests' ? "WHERE c.status = 'pending'" : '';
            $rows = $db->query("SELECT c.*, a.username AS manager_name,
                                       (SELECT COUNT(*) FROM class_members m WHERE m.class_id = c.id) AS members
                                FROM school_classes c LEFT JOIN accounts a ON a.id = c.manager_id
                                $where ORDER BY c.created_at DESC LIMIT 200")->fetchAll();
            jsonResponse([
                'success' => true,
                'requests_open' => classRequestsOpen($db),
                'default_limits_mb' => classDefaultLimits($db),
                'classes' => array_map(fn($c) => [
                    'id' => (int)$c['id'], 'name' => $c['name'], 'school' => $c['school'],
                    'status' => $c['status'], 'note' => $c['request_note'],
                    'manager' => $c['manager_name'], 'members' => (int)$c['members'],
                    'limits_mb' => classLimits($db, $c),
                    'created_at' => (int)$c['created_at'],
                ], $rows),
            ]);
        }

        clFail('unknown_action', 'Unknown action');
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') clFail('method', 'Method not allowed', 405);
    requireCsrf();
    $in = str_starts_with((string)($_SERVER['CONTENT_TYPE'] ?? ''), 'multipart/') ? $_POST : readJsonBody();
    $action = (string)($in['action'] ?? '');
    $id = (int)($in['id'] ?? 0);

    if ($action === 'request') {
        $restriction = accountRestriction($db, $me);
        if ($restriction) clFail('restricted', $restriction, 403);
        if (!$isAdmin && !classRequestsOpen($db)) clFail('requests_closed', 'New class requests are closed right now', 403);
        if (!checkRateLimit('class_request', 5, 3600, 'user:' . $me)) clFail('slow_down', 'Too many requests, try later', 429);

        $name = clText($in['name'] ?? '', CLASS_NAME_MAX);
        $school = clText($in['school'] ?? '', CLASS_SCHOOL_MAX);
        $note = clText($in['note'] ?? '', CLASS_NOTE_MAX);
        if ($name === '') clFail('bad_name', 'Write the name of the class');
        if (textLength($school) < 2) clFail('bad_school', 'Write the name of the school');

        $st = $db->prepare("SELECT COUNT(*) FROM school_classes WHERE manager_id = :me AND status = 'pending'");
        $st->execute([':me' => $me]);
        if ((int)$st->fetchColumn() >= CLASS_MAX_PENDING) clFail('too_many', 'You already have requests waiting');

        $db->prepare("INSERT INTO school_classes (name, school, status, manager_id, request_note, periods, created_at)
                      VALUES (:n, :s, 'pending', :me, :note, :p, :t)")
           ->execute([':n' => $name, ':s' => $school, ':me' => $me, ':note' => $note,
                      ':p' => json_encode(classDefaultPeriods()), ':t' => time()]);
        jsonResponse(['success' => true, 'id' => (int)$db->lastInsertId(), 'status' => 'pending']);
    }

    if ($action === 'decide') {
        requireAdmin();
        $class = classLoad($db, $id);
        if (!$class) clFail('not_found', 'Class not found', 404);
        if ($class['status'] !== 'pending') clFail('already_decided', 'This request was already decided', 409);
        $approve = !empty($in['approve']);

        $db->exec('BEGIN IMMEDIATE');
        try {
            if ($approve) {
                $db->prepare("UPDATE school_classes SET status = 'active', invite_code = :c, decided_at = :t WHERE id = :id")
                   ->execute([':c' => classNewInviteCode($db), ':t' => time(), ':id' => $id]);
                $db->prepare('INSERT OR IGNORE INTO class_members (class_id, user_id, joined_at) VALUES (:c, :u, :t)')
                   ->execute([':c' => $id, ':u' => $class['manager_id'], ':t' => time()]);
            } else {
                $db->prepare("UPDATE school_classes SET status = 'rejected', decided_at = :t WHERE id = :id")
                   ->execute([':t' => time(), ':id' => $id]);
            }
            $db->exec('COMMIT');
        } catch (Throwable $e) {
            $db->exec('ROLLBACK');
            throw $e;
        }
        jsonResponse(['success' => true, 'status' => $approve ? 'active' : 'rejected']);
    }

    if ($action === 'set_requests_open') {
        requireAdmin();
        $open = !empty($in['open']);
        appSettingSet($db, 'class_requests_open', $open ? '1' : '0');
        jsonResponse(['success' => true, 'requests_open' => $open]);
    }

    if ($action === 'set_limits') {
        requireAdmin();
        $file = classParseLimit($in['file_mb'] ?? null, CLASS_LIMIT_FILE_MB_MAX);
        $class = classParseLimit($in['class_mb'] ?? null, CLASS_LIMIT_CLASS_MB_MAX);
        if (is_string($file)) clFail('bad_limit', $file);
        if (is_string($class)) clFail('bad_limit', $class);
        if ($id > 0) {
            $row = classLoad($db, $id);
            if (!$row) clFail('not_found', 'Class not found', 404);
            $db->prepare('UPDATE school_classes SET max_file_mb = :f, max_class_mb = :c WHERE id = :id')
               ->execute([':f' => $file, ':c' => $class, ':id' => $id]);
            jsonResponse(['success' => true, 'limits_mb' => classLimits($db, classLoad($db, $id))]);
        }
        if ($file === null || $class === null) clFail('bad_limit', 'Both site-wide limits are required');
        appSettingSet($db, 'notes_max_file_mb', (string)$file);
        appSettingSet($db, 'notes_max_class_mb', (string)$class);
        jsonResponse(['success' => true, 'limits_mb' => classDefaultLimits($db)]);
    }

    if ($action === 'delete_class') {
        requireAdmin();
        if (!classLoad($db, $id)) clFail('not_found', 'Class not found', 404);
        classDelete($db, $id);
        jsonResponse(['success' => true]);
    }

    if ($action === 'join') {
        $restriction = accountRestriction($db, $me);
        if ($restriction) clFail('restricted', $restriction, 403);
        // Invite codes must not be guessable by trying: tight limits per account and per address
        if (!checkRateLimit('class_join', 10, 600, 'user:' . $me) || !checkRateLimit('class_join_ip', 20, 600)) {
            clFail('slow_down', 'Too many attempts, try again in a few minutes', 429);
        }
        $code = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string)($in['code'] ?? '')) ?? '');
        $st = $db->prepare("SELECT * FROM school_classes WHERE invite_code = :c AND status = 'active'");
        $st->execute([':c' => $code]);
        $class = $code === '' ? null : ($st->fetch() ?: null);
        if (!$class) clFail('bad_code', 'Invalid invite code', 404);

        $db->prepare('INSERT OR IGNORE INTO class_members (class_id, user_id, joined_at) VALUES (:c, :u, :t)')
           ->execute([':c' => $class['id'], ':u' => $me, ':t' => time()]);
        jsonResponse(['success' => true, 'id' => (int)$class['id'], 'name' => $class['name'], 'school' => $class['school']]);
    }

    if ($action === 'leave') {
        $class = clVisible($db, $id, $me, false);
        if ((int)$class['manager_id'] === $me) clFail('manager_cannot_leave', 'Give the class to another member before leaving', 409);
        $db->prepare('DELETE FROM class_members WHERE class_id = :c AND user_id = :u')->execute([':c' => $id, ':u' => $me]);
        jsonResponse(['success' => true]);
    }

    if ($action === 'regen_code') {
        clManaged($db, $id, $me, $isAdmin, 'members');
        $code = classNewInviteCode($db);
        $db->prepare('UPDATE school_classes SET invite_code = :c WHERE id = :id')->execute([':c' => $code, ':id' => $id]);
        jsonResponse(['success' => true, 'invite_code' => $code]);
    }

    if ($action === 'remove_member' || $action === 'set_manager') {
        $class = $action === 'set_manager' ? clRepresentative($db, $id, $me, $isAdmin) : clManaged($db, $id, $me, $isAdmin, 'members');
        $userId = (int)($in['user_id'] ?? 0);
        if (!classIsMember($db, $id, $userId)) clFail('not_member', 'That user is not in the class', 404);
        if ($action === 'remove_member') {
            if ($userId === (int)$class['manager_id']) clFail('is_manager', 'The manager cannot be removed', 409);
            $db->prepare('DELETE FROM class_members WHERE class_id = :c AND user_id = :u')->execute([':c' => $id, ':u' => $userId]);
        } else {
            $db->prepare('UPDATE school_classes SET manager_id = :u WHERE id = :id')->execute([':u' => $userId, ':id' => $id]);
        }
        jsonResponse(['success' => true]);
    }

    if (in_array($action, ['display_name', 'save_role', 'delete_role', 'set_member_access', 'merge_subject', 'delete_subject'], true)
        && !checkRateLimit('class_manage', 120, 3600, 'user:' . $me)) {
        clFail('slow_down', 'Too many changes, try later', 429);
    }

    if ($action === 'display_name') {
        // My name in this class (or another member's, for whoever manages members)
        $class = clVisible($db, $id, $me, $isAdmin);
        $userId = (int)($in['user_id'] ?? $me);
        if ($userId !== $me) clManaged($db, $id, $me, $isAdmin, 'members');
        if (!classIsMember($db, $id, $userId)) clFail('not_member', 'That user is not in the class', 404);
        $name = clText($in['name'] ?? '', 40);
        $db->prepare('UPDATE class_members SET display_name = :n WHERE class_id = :c AND user_id = :u')
           ->execute([':n' => $name !== '' ? $name : null, ':c' => $id, ':u' => $userId]);
        jsonResponse(['success' => true]);
    }

    if ($action === 'save_role') {
        // Create (no role_id) or change a role: name, colour, permissions
        clManaged($db, $id, $me, $isAdmin, 'roles');
        $name = clText($in['name'] ?? '', 30);
        if ($name === '') clFail('bad_name', 'Give the role a name');
        $color = preg_match('/^#[0-9a-fA-F]{6}$/', (string)($in['color'] ?? '')) ? (string)$in['color'] : '#5b8def';
        $perms = json_encode(classCleanPerms($in['perms'] ?? []));
        $roleId = (int)($in['role_id'] ?? 0);
        if ($roleId) {
            if (!clRoleOf($db, $id, $roleId)) clFail('not_found', 'Role not found', 404);
            $db->prepare('UPDATE class_roles SET name = :n, color = :col, perms = :p WHERE id = :r')
               ->execute([':n' => $name, ':col' => $color, ':p' => $perms, ':r' => $roleId]);
        } else {
            $n = $db->prepare('SELECT COUNT(*) FROM class_roles WHERE class_id = :c');
            $n->execute([':c' => $id]);
            if ((int)$n->fetchColumn() >= 20) clFail('too_many', 'At most 20 roles');
            $db->prepare('INSERT INTO class_roles (class_id, name, color, perms, created_at) VALUES (:c, :n, :col, :p, :t)')
               ->execute([':c' => $id, ':n' => $name, ':col' => $color, ':p' => $perms, ':t' => time()]);
            $roleId = (int)$db->lastInsertId();
        }
        jsonResponse(['success' => true, 'role_id' => $roleId]);
    }

    if ($action === 'delete_role') {
        clManaged($db, $id, $me, $isAdmin, 'roles');
        $roleId = (int)($in['role_id'] ?? 0);
        if (!clRoleOf($db, $id, $roleId)) clFail('not_found', 'Role not found', 404);
        $db->prepare('UPDATE class_members SET role_id = NULL WHERE class_id = :c AND role_id = :r')->execute([':c' => $id, ':r' => $roleId]);
        $db->prepare('DELETE FROM class_roles WHERE id = :r')->execute([':r' => $roleId]);
        jsonResponse(['success' => true]);
    }

    if ($action === 'set_member_access') {
        // A member's role and personal permissions (on top of the role's)
        $class = clManaged($db, $id, $me, $isAdmin, 'roles');
        $userId = (int)($in['user_id'] ?? 0);
        if (!classIsMember($db, $id, $userId)) clFail('not_member', 'That user is not in the class', 404);
        if ($userId === (int)$class['manager_id']) clFail('is_manager', 'The representative already has every permission', 409);
        $roleId = (int)($in['role_id'] ?? 0);
        if ($roleId && !clRoleOf($db, $id, $roleId)) clFail('not_found', 'Role not found', 404);
        $db->prepare('UPDATE class_members SET role_id = :r, perms = :p WHERE class_id = :c AND user_id = :u')
           ->execute([':r' => $roleId ?: null, ':p' => json_encode(classCleanPerms($in['perms'] ?? [])), ':c' => $id, ':u' => $userId]);
        jsonResponse(['success' => true]);
    }

    if ($action === 'merge_subject' || $action === 'delete_subject') {
        // Merge "Lab Informatica" into "Informatica" (material, calendar, documents, timetable), or delete an empty subject
        clManaged($db, $id, $me, $isAdmin, 'subjects');
        $from = (int)($in['subject_id'] ?? 0);
        $subs = array_column(classSubjects($db, $id), 'name', 'id');
        if (!isset($subs[$from])) clFail('not_found', 'Subject not found', 404);
        $into = (int)($in['into'] ?? 0);
        if ($action === 'merge_subject' && (!isset($subs[$into]) || $into === $from)) clFail('bad_target', 'Choose another subject of this class');
        $used = 0;
        foreach (['class_items', 'class_events', 'class_docs'] as $t) {
            $q = $db->prepare("SELECT COUNT(*) FROM $t WHERE class_id = :c AND subject_id = :s");
            $q->execute([':c' => $id, ':s' => $from]);
            $used += (int)$q->fetchColumn();
        }
        if ($action === 'delete_subject' && $used > 0) clFail('not_empty', 'This subject has material: merge it into another one instead');
        $db->exec('BEGIN IMMEDIATE');
        try {
            if ($action === 'merge_subject') {
                foreach (['class_items', 'class_events'] as $t) {
                    $db->prepare("UPDATE $t SET subject_id = :to WHERE class_id = :c AND subject_id = :s")->execute([':to' => $into, ':c' => $id, ':s' => $from]);
                }
                // Documents made by hand move; the site's AI documents are rewritten for the merged subject at the next run
                $db->prepare('UPDATE class_docs SET subject_id = :to WHERE class_id = :c AND subject_id = :s AND author_id IS NOT NULL')
                   ->execute([':to' => $into, ':c' => $id, ':s' => $from]);
                $db->prepare('DELETE FROM class_docs WHERE class_id = :c AND (subject_id = :s OR subject_id = :to) AND author_id IS NULL AND event_id IS NULL')
                   ->execute([':c' => $id, ':s' => $from, ':to' => $into]);
            }
            // Timetable versions: the hours of the old subject become the new one's (merge) or free hours (delete)
            $tts = $db->prepare('SELECT id, slots FROM class_timetables WHERE class_id = :c');
            $tts->execute([':c' => $id]);
            $upd = $db->prepare('UPDATE class_timetables SET slots = :s WHERE id = :id');
            foreach ($tts->fetchAll() as $tt) {
                $slots = [];
                foreach (json_decode($tt['slots'], true) ?: [] as $sl) {
                    if ((int)$sl['subject_id'] === $from) {
                        if ($action === 'delete_subject') continue;
                        $sl['subject_id'] = $into;
                    }
                    $slots[] = $sl;
                }
                $upd->execute([':s' => json_encode($slots), ':id' => $tt['id']]);
            }
            $db->prepare('DELETE FROM class_subjects WHERE id = :s AND class_id = :c')->execute([':s' => $from, ':c' => $id]);
            $db->exec('COMMIT');
        } catch (Throwable $e) {
            $db->exec('ROLLBACK');
            throw $e;
        }
        jsonResponse(['success' => true]);
    }

    if ($action === 'settings') {
        $class = clManaged($db, $id, $me, $isAdmin, 'settings');
        $time = (string)($in['summary_time'] ?? '');
        if (!classValidTime($time)) clFail('bad_time', 'Time must be HH:MM');
        $tz = (string)($in['timezone'] ?? 'Europe/Rome');
        if (!in_array($tz, timezone_identifiers_list(), true)) clFail('bad_timezone', 'Unknown time zone');
        // the automatic daily summary can be switched off (kept in the class settings; "Genera ora" still works)
        $settings = json_decode((string)($class['settings'] ?? '{}'), true);
        if (!is_array($settings)) $settings = [];
        if (array_key_exists('summary_on', $in)) $settings['summary_on'] = !empty($in['summary_on']);
        if (array_key_exists('missing_on', $in)) {
            // "Appunti mancanti": on/off, dates, subjects left out (the lessons marked "not needed" are kept)
            $m = notesMissingSettings($class);
            $m['on'] = !empty($in['missing_on']);
            if (array_key_exists('missing_from', $in)) $m['from'] = classValidDate((string)$in['missing_from']) ? (string)$in['missing_from'] : '';
            if (array_key_exists('missing_to', $in)) $m['to'] = classValidDate((string)$in['missing_to']) ? (string)$in['missing_to'] : '';
            if (array_key_exists('missing_subjects_off', $in)) $m['subjects_off'] = array_values(array_filter(array_map('intval', (array)$in['missing_subjects_off']), fn($i) => in_array($i, array_map('intval', array_column(classSubjects($db, (int)$class['id']), 'id')), true)));
            if ($m['on'] && $m['from'] === '') $m['from'] = classToday($class);
            $settings['missing'] = $m;
        }
        if (array_key_exists('digest_on', $in) || array_key_exists('digest_day', $in) || array_key_exists('digest_hour', $in)) {
            $d = is_array($settings['digest'] ?? null) ? $settings['digest'] : [];
            if (array_key_exists('digest_on', $in)) $d['on'] = !empty($in['digest_on']);
            if (array_key_exists('digest_day', $in)) $d['day'] = max(0, min(6, (int)$in['digest_day']));
            if (array_key_exists('digest_hour', $in)) $d['hour'] = max(0, min(23, (int)$in['digest_hour']));
            $settings['digest'] = $d;
        }
        $db->prepare('UPDATE school_classes SET summary_time = :s, timezone = :z, settings = :j WHERE id = :id')
           ->execute([':s' => $time, ':z' => $tz, ':j' => json_encode($settings), ':id' => $id]);
        jsonResponse(['success' => true]);
    }

    if ($action === 'read_timetable') {
        require_once __DIR__ . '/classi_ai.php';
        $class = clManaged($db, $id, $me, $isAdmin);
        if (!geminiConfigured()) clFail('ai_off', 'The AI is not configured on this server', 503);
        if (!checkRateLimit('timetable_ai', 5, 3600, 'class:' . $id)) clFail('slow_down', 'Too many attempts, try again later', 429);
        $files = [];
        $raw = $_FILES['files'] ?? null;
        if (is_array($raw) && isset($raw['name'])) {
            foreach ((array)$raw['name'] as $i => $name) {
                $err = (int)((array)$raw['error'])[$i];
                if ($err === UPLOAD_ERR_NO_FILE) continue;
                $tmp = (string)((array)$raw['tmp_name'])[$i];
                if ($err !== UPLOAD_ERR_OK || !is_uploaded_file($tmp) || filesize($tmp) > TIMETABLE_AI_MAX_BYTES) clFail('bad_file', 'Upload a photo or PDF up to 15 MB');
                $type = timetableFileType($tmp, (string)$name);
                if (!$type) clFail('bad_type', 'Use a photo (JPG, PNG, WEBP, HEIC) or a PDF');
                $files[] = ['mime' => $type, 'data' => (string)file_get_contents($tmp)];
            }
        }
        if (!$files || count($files) > 3) clFail('no_file', 'Upload one to three photos or PDFs');
        set_time_limit(170);
        try {
            $result = timetableFromImages($db, $class, $files);
        } catch (GeminiError $e) {
            require_once __DIR__ . '/debug_logger.php';
            logSystemError('TIMETABLE_AI', $e->getMessage());
            if ($e->busy) clFail('ai_busy', 'Gemini is busy right now, try again in a few minutes', 503);
            clFail($e->quota ? 'ai_quota' : 'ai_failed', $e->quota ? 'The AI has no requests left today' : 'The AI could not read the timetable', 502);
        }
        require_once __DIR__ . '/debug_logger.php';
        logSystemError('TIMETABLE_AI', 'class ' . $id . ': ' . (is_string($result) ? 'unreadable' : 'read') . ' with ' . ($result['model'] ?? 'the AI'));
        if (is_string($result)) clFail('ai_unreadable', $result, 422);
        jsonResponse(['success' => true] + $result);
    }

    if ($action === 'save_timetable') {
        $class = clManaged($db, $id, $me, $isAdmin);
        $periods = classParsePeriods($in['periods'] ?? null);
        if (is_string($periods)) clFail('bad_periods', $periods);
        $slots = classParseSlots($in['slots'] ?? null, $periods);
        if (is_string($slots)) clFail('bad_slots', $slots);
        $validFrom = (string)($in['valid_from'] ?? '');
        if ($validFrom === '') $validFrom = classToday($class);
        if (!classValidDate($validFrom)) clFail('bad_date', 'Date must be YYYY-MM-DD');

        $db->exec('BEGIN IMMEDIATE');
        try {
            $subjectIds = classEnsureSubjects($db, $id, array_column($slots, 'subject'));
            $stored = array_map(fn($s) => [
                'day' => $s['day'], 'period' => $s['period'], 'subject_id' => $subjectIds[$s['subject']],
                'label' => $s['label'], 'room' => $s['room'],
            ], $slots);
            $db->prepare('UPDATE school_classes SET periods = :p WHERE id = :id')
               ->execute([':p' => json_encode($periods), ':id' => $id]);
            $db->prepare('INSERT INTO class_timetables (class_id, valid_from, slots, created_at) VALUES (:c, :f, :s, :t)
                          ON CONFLICT(class_id, valid_from) DO UPDATE SET slots = excluded.slots, created_at = excluded.created_at')
               ->execute([':c' => $id, ':f' => $validFrom, ':s' => json_encode($stored), ':t' => time()]);
            $db->exec('COMMIT');
        } catch (Throwable $e) {
            $db->exec('ROLLBACK');
            throw $e;
        }
        jsonResponse(['success' => true, 'valid_from' => $validFrom]);
    }

    clFail('unknown_action', 'Unknown action');
} catch (Throwable $e) {
    failInternal('CLASSES', $e);
}
