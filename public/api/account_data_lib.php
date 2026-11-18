<?php
// public/api/account_data_lib.php — the owner's rights over their own data (GDPR art. 15 access, 17 erasure, 20 portability):
// accountExport() gathers everything the site keeps about one account; accountErase() removes it.
//
// Erasure rules (kept in step with the privacy page):
//  - chat, guestbook and private messages written or received by the account are deleted (both sides of a conversation);
//  - progress, bookmarks, notifications, push subscriptions, quizzes, scores, share links and class membership are deleted;
//  - class material the person made (notes, files, calendar entries, documents): deleted when $deleteMaterials, otherwise it
//    stays in the class with no author (author_id 0, which the pages show as nobody);
//  - the library keeps the books (shared content) without the uploader's name;
//  - a donation stays for accounting (a legal duty) but loses the link to the account and the name;
//  - an admin, or the manager of a class, cannot be erased here: the class must be handed over or closed first.
// Not reachable from the account (no link to it): the visit counter (hash of IP + browser), rate-limit buckets, server logs;
// they expire by themselves (see retention.php).
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/appunti_lib.php';

const ACCOUNT_ERASED_AUTHOR = 0;

/** Why this account cannot be erased right now, or null. */
function accountEraseBlocker(PDO $db, int $userId): ?string {
    $st = $db->prepare('SELECT is_admin FROM accounts WHERE id = :i');
    $st->execute([':i' => $userId]);
    $row = $st->fetch();
    if (!$row) return 'Account not found.';
    if (!empty($row['is_admin'])) return 'An administrator account cannot be deleted from here.';
    $st = $db->prepare("SELECT name FROM school_classes WHERE manager_id = :i AND status IN ('active', 'pending') AND is_demo = 0 LIMIT 3");
    $st->execute([':i' => $userId]);
    $names = $st->fetchAll(PDO::FETCH_COLUMN);
    if ($names) return 'You manage a class (' . implode(', ', $names) . '): hand it over to someone else or ask the admin to close it before deleting the account.';
    return null;
}

/** Everything the site keeps about the account, as plain arrays (no password hash, no push keys). */
function accountExport(PDO $db, int $userId): array {
    $one = function (string $sql, array $p = []) use ($db) { $st = $db->prepare($sql); $st->execute($p); return $st->fetch() ?: null; };
    $all = function (string $sql, array $p = []) use ($db) { $st = $db->prepare($sql); $st->execute($p); return $st->fetchAll(); };
    $acc = $one('SELECT id, username, theme, is_admin, can_read_books, can_upload_books, is_banned, banned_until, created_at, bio, can_view_resume, ads_free, email, email_verified, email_optin, email_optin_at
                 FROM accounts WHERE id = :i', [':i' => $userId]);
    if (!$acc) return [];
    $u = [':i' => $userId];
    $name = [':i' => $userId, ':n' => $acc['username']];
    return [
        'exported_at' => date('c'),
        'note' => 'Everything vector-box keeps about this account. The password is stored only as a one-way hash and is not included.',
        'account' => $acc,
        'chat_messages' => $all('SELECT id, room_id, message, sender_ip, created_at FROM transmissions WHERE (user_id = :i OR username = :n) AND (is_deleted = 0 OR is_deleted IS NULL)', $name),
        'idea_votes' => $all('SELECT idea_id FROM news_idea_votes WHERE user_id = :i', [':i' => $userId]),
        'admin_actions_on_this_account' => $all('SELECT script, action, detail, created_at FROM admin_log WHERE target_user_id = :i', [':i' => $userId]),
        'news_ideas' => $all('SELECT id, text, status, reply, created_at FROM news_ideas WHERE user_id = :i', [':i' => $userId]),
        'guestbook' => $all('SELECT id, message, sender_ip, created_at FROM guestbook WHERE user_id = :i OR username = :n', $name),
        'private_messages' => $all('SELECT m.id, s.username AS "from", r.username AS "to", m.body, m.created_at, m.read_at FROM dm_messages m
                                    LEFT JOIN accounts s ON s.id = m.sender_id LEFT JOIN accounts r ON r.id = m.recipient_id
                                    WHERE m.sender_id = :i OR m.recipient_id = :i ORDER BY m.id', $u),
        'blocked_users' => $all('SELECT a.username, b.created_at FROM dm_blocks b LEFT JOIN accounts a ON a.id = b.blocked_id WHERE b.blocker_id = :i', $u),
        'poker_stats' => $all('SELECT hands_played, hands_won, chips_won, biggest_pot, updated_at FROM poker_stats WHERE user_id = :i', $u),
        'reading_progress' => $all('SELECT b.title, p.cfi_or_page, p.percentage, p.updated_at FROM reading_progress p LEFT JOIN books b ON b.id = p.book_id WHERE p.user_id = :i', $u),
        'bookmarks' => $all('SELECT b.title, k.location, k.label, k.percentage, k.created_at FROM bookmarks k LEFT JOIN books b ON b.id = k.book_id WHERE k.user_id = :i', $u),
        'classes' => $all('SELECT c.name, c.school, m.joined_at, m.display_name, m.perms, m.settings FROM class_members m JOIN school_classes c ON c.id = m.class_id WHERE m.user_id = :i', $u),
        'class_notes' => $all('SELECT i.id, c.name AS class, i.kind, i.lesson_date, i.title, i.body, i.created_at FROM class_items i JOIN school_classes c ON c.id = i.class_id WHERE i.author_id = :i', $u),
        'class_files' => $all('SELECT f.original_name, f.mime, f.size, f.created_at FROM class_item_files f JOIN class_items i ON i.id = f.item_id WHERE i.author_id = :i', $u),
        'class_calendar' => $all('SELECT kind, event_date, title, topics FROM class_events WHERE author_id = :i', $u),
        'class_homework' => $all('SELECT due_date, body FROM class_homework WHERE author_id = :i', $u),
        'class_activity' => $all('SELECT class_id, action, detail, created_at FROM class_log WHERE user_id = :i', $u),
        'notifications' => $all('SELECT kind, title, body, url, created_at, read_at FROM notifications WHERE user_id = :i', $u),
        'push_subscriptions' => $all('SELECT created_at, last_ok_at FROM push_subscriptions WHERE user_id = :i', $u),
        'quiz_answers' => $all('SELECT doc_id, q_index, choice, correct, points, answered_at FROM quiz_answers WHERE user_id = :i', $u),
        'review_cards' => $all('SELECT doc_id, q_index, box, due_date, question FROM review_cards WHERE user_id = :i', $u),
        'scores' => $all('SELECT kind, points, ref, created_at FROM score_events WHERE user_id = :i', $u),
        'share_links' => $all('SELECT kind, title, expires_at, views, revoked, created_at FROM share_links WHERE user_id = :i', $u),
        'game_scores' => $all('SELECT game, variant, score, created_at FROM game_scores WHERE user_id = :i', $u),
        'parola_stats' => $all('SELECT stats, daily, updated_at FROM parola_stats WHERE user_id = :i', $u),
        'signed_in_devices' => $all('SELECT label, country, created_at, last_seen FROM account_sessions WHERE user_id = :i', $u),
        'donations' => $all('SELECT amount_cents, currency, donated_at, display_name, is_public FROM donors WHERE account_id = :i', $u),
    ];
}

/** Deletes the account and its data (see the rules at the top). Returns what was removed, for the confirmation message. */
function accountErase(PDO $db, int $userId, bool $deleteMaterials): array {
    $st = $db->prepare('SELECT username FROM accounts WHERE id = :i');
    $st->execute([':i' => $userId]);
    $username = $st->fetchColumn();
    if ($username === false) return [];
    $files = [];
    $run = function (string $sql, array $p) use ($db): int { $s = $db->prepare($sql); $s->execute($p); return $s->rowCount(); };
    $u = [':i' => $userId];
    $name = [':i' => $userId, ':n' => $username];
    $gone = [];

    $db->exec('BEGIN IMMEDIATE');
    try {
        $gone['chat'] = $run('DELETE FROM transmissions WHERE user_id = :i OR username = :n', $name);
        $gone['guestbook'] = $run('DELETE FROM guestbook WHERE user_id = :i OR username = :n', $name);
        $gone['private_messages'] = $run('DELETE FROM dm_messages WHERE sender_id = :i OR recipient_id = :i', $u);
        $run('DELETE FROM dm_blocks WHERE blocker_id = :i OR blocked_id = :i', $u);
        $run('DELETE FROM poker_players WHERE user_id = :i', $u);
        $run('DELETE FROM poker_stats WHERE user_id = :i', $u);
        $run("UPDATE poker_tables SET creator_username = 'deleted' WHERE creator_username = :n", [':n' => $username]);
        $run("UPDATE books SET uploaded_by = 'deleted' WHERE uploaded_by = :n", [':n' => $username]);
        foreach (['reading_progress', 'bookmarks', 'read_progress', 'notifications', 'push_subscriptions', 'review_cards', 'custom_quizzes',
                  'quiz_answers', 'quiz_seen', 'score_events', 'game_scores', 'class_log', 'share_links', 'class_members'] as $t) {
            $run("DELETE FROM $t WHERE user_id = :i", $u);
        }
        $run('DELETE FROM account_sessions WHERE user_id = :i', $u);
        $run('DELETE FROM parola_stats WHERE user_id = :i', $u);
        $run('DELETE FROM class_board WHERE user_id = :i', $u);
        $run('DELETE FROM news_idea_votes WHERE user_id = :i OR idea_id IN (SELECT id FROM news_ideas WHERE user_id = :i)', $u);
        $run('DELETE FROM news_ideas WHERE user_id = :i', $u);
        $run("UPDATE admin_log SET target_user_id = NULL, target_name = 'deleted' WHERE target_user_id = :i", $u);

        // class material the person made
        if ($deleteMaterials) {
            $s = $db->prepare('SELECT f.class_id, f.stored_name FROM class_item_files f JOIN class_items i ON i.id = f.item_id WHERE i.author_id = :i');
            $s->execute($u);
            foreach ($s->fetchAll() as $f) $files[] = notesDir((int)$f['class_id']) . '/' . basename((string)$f['stored_name']);
            $run('DELETE FROM class_item_files WHERE item_id IN (SELECT id FROM class_items WHERE author_id = :i)', $u);
            $gone['class_notes'] = $run('DELETE FROM class_items WHERE author_id = :i', $u);
            foreach (['class_events', 'class_homework', 'class_days_off', 'class_turns', 'class_topics', 'class_board'] as $t) $run("DELETE FROM $t WHERE author_id = :i", $u);
            $run('DELETE FROM class_docs WHERE author_id = :i', $u);
        } else {
            foreach (['class_items', 'class_events', 'class_homework', 'class_days_off', 'class_turns', 'class_topics', 'class_board', 'class_docs'] as $t) {
                $run("UPDATE $t SET author_id = " . ACCOUNT_ERASED_AUTHOR . ' WHERE author_id = :i', $u);
            }
        }
        // turns name people in a JSON list
        $t = $db->query("SELECT id, user_ids FROM class_turns WHERE user_ids LIKE '%$userId%'")->fetchAll();
        foreach ($t as $row) {
            $ids = json_decode((string)$row['user_ids'], true);
            if (!is_array($ids)) continue;
            $keep = array_values(array_filter($ids, fn($x) => (int)$x !== $userId));
            if (count($keep) !== count($ids)) $run('UPDATE class_turns SET user_ids = :u WHERE id = :id', [':u' => json_encode($keep), ':id' => $row['id']]);
        }

        // donations stay for accounting, without the person
        $run("UPDATE donors SET account_id = NULL, display_name = '', is_public = 0, note = '' WHERE account_id = :i", $u);
        $run('DELETE FROM mail_queue WHERE account_id = :i', $u);   // messages written for this person
        $gone['account'] = $run('DELETE FROM accounts WHERE id = :i', $u);
        $db->exec('COMMIT');
    } catch (Throwable $e) {
        try { $db->exec('ROLLBACK'); } catch (Throwable $ignored) { /* no active transaction */ }
        throw $e;
    }
    foreach ($files as $f) @unlink($f);   // after the commit: a failed unlink never undoes the erasure
    $gone['files'] = count($files);
    return $gone;
}
