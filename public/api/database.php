<?php
// public/api/database.php

require_once __DIR__ . '/helpers.php';

const DB_SCHEMA_VERSION = 52;

/**
 * Session bootstrap.
 * By default the session is released immediately (read-only) so background polling never blocks.
 * Pass $writable = true when the request has to modify $_SESSION (the caller must then close it).
 */
function initSession(bool $writable = false) {
    startWritableSession();

    // The session caches user_id / is_admin for days: believe the database instead. A deleted account is a guest again,
    // a demoted admin is no longer admin (one primary-key read, and only for logged-in sessions).
    if (!empty($_SESSION['user_id'])) {
        try {
            $st = getDbConnection()->prepare('SELECT is_admin FROM accounts WHERE id = :id');
            $st->execute([':id' => (int)$_SESSION['user_id']]);
            $acc = $st->fetch();
            require_once __DIR__ . '/sessions_lib.php';
            if (!$acc || !sessionCheck((int)$_SESSION['user_id'])) {   // deleted account, or this device was signed out from the Account page
                unset($_SESSION['user_id'], $_SESSION['username'], $_SESSION['is_admin'], $_SESSION['theme']);
            } else {
                $_SESSION['is_admin'] = (int)$acc['is_admin'];
            }
        } catch (Throwable $e) { /* the DB is busy: keep what the session says rather than logging everybody out */ }
    }

    // Ensure guest sessions get a unique session-bound handle (8 hex chars: collisions are negligible)
    if (!isset($_SESSION['username'])) {
        $_SESSION['username'] = 'guest_' . substr(hash('sha256', session_id()), 0, 8);
    }

    if (!$writable && session_status() === PHP_SESSION_ACTIVE) {
        session_write_close();
    }
}

function addColumnIfMissing(PDO $db, string $table, string $column, string $ddl): void {
    $cols = $db->query("PRAGMA table_info($table)")->fetchAll(PDO::FETCH_COLUMN, 1);
    if (!in_array($column, $cols, true)) {
        $db->exec("ALTER TABLE $table ADD COLUMN $column $ddl");
    }
}

function migrateV1(PDO $db): void {
    // Accounts table
    $db->exec("CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        theme VARCHAR(30) DEFAULT 'monochrome',
        is_admin INTEGER DEFAULT 0,
        can_read_books INTEGER DEFAULT 0,
        can_upload_books INTEGER DEFAULT 0,
        is_banned INTEGER DEFAULT 0,
        banned_until DATETIME NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )");

    // Rooms table
    $db->exec("CREATE TABLE IF NOT EXISTS rooms (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(50) NOT NULL,
        is_private INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )");

    // Seed default rooms if table is empty
    $roomCount = $db->query("SELECT COUNT(*) FROM rooms")->fetchColumn();
    if ((int)$roomCount === 0) {
        $stmt = $db->prepare("INSERT INTO rooms (id, name, is_private) VALUES (:id, :name, :is_priv)");
        $defaultRooms = [
            ['id' => 'general', 'name' => 'General', 'is_priv' => 0],
            ['id' => 'dev', 'name' => 'Dev Ops', 'is_priv' => 0],
            ['id' => 'lounge', 'name' => 'Cyber Lounge', 'is_priv' => 0],
            ['id' => 'admin', 'name' => 'Root Sanctuary', 'is_priv' => 1]
        ];
        foreach ($defaultRooms as $r) {
            $stmt->execute([':id' => $r['id'], ':name' => $r['name'], ':is_priv' => $r['is_priv']]);
        }
    }

    // Transmissions table
    $db->exec("CREATE TABLE IF NOT EXISTS transmissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id VARCHAR(50) DEFAULT 'general',
        message TEXT NOT NULL,
        sender_ip VARCHAR(45) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )");

    // Poker Tables
    $db->exec("CREATE TABLE IF NOT EXISTS poker_tables (
        id VARCHAR(50) PRIMARY KEY,
        room_code VARCHAR(50) NULL,
        creator_username VARCHAR(50) DEFAULT 'system',
        max_players INTEGER DEFAULT 4,
        bot_count INTEGER DEFAULT 1,
        pot INTEGER DEFAULT 0,
        current_bet INTEGER DEFAULT 0,
        community_cards TEXT DEFAULT '[]',
        game_stage VARCHAR(30) DEFAULT 'waiting',
        current_turn_seat INTEGER DEFAULT 0,
        last_winner_msg TEXT DEFAULT '',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )");

    // Poker Players state
    $db->exec("CREATE TABLE IF NOT EXISTS poker_players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_id VARCHAR(50) NOT NULL,
        user_id INTEGER NULL,
        username VARCHAR(50) NOT NULL,
        seat INTEGER NOT NULL,
        chips INTEGER DEFAULT 1000,
        current_bet INTEGER DEFAULT 0,
        hole_cards TEXT DEFAULT '[]',
        is_folded INTEGER DEFAULT 0,
        is_bot INTEGER DEFAULT 0,
        UNIQUE(table_id, seat)
    )");

    // Books Library table
    $db->exec("CREATE TABLE IF NOT EXISTS books (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title VARCHAR(255) NOT NULL,
        author VARCHAR(255) DEFAULT 'Unknown',
        description TEXT DEFAULT '',
        format VARCHAR(10) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        cover_path VARCHAR(500) DEFAULT '',
        file_size INTEGER DEFAULT 0,
        uploaded_by VARCHAR(50) DEFAULT 'system',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )");

    // Reading Progress table
    $db->exec("CREATE TABLE IF NOT EXISTS reading_progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        book_id INTEGER NOT NULL,
        cfi_or_page TEXT NOT NULL,
        percentage REAL DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, book_id)
    )");


    // Rate limiting (replaces per-IP JSON files)
    $db->exec("CREATE TABLE IF NOT EXISTS rate_limits (
        bucket VARCHAR(200) NOT NULL,
        ts INTEGER NOT NULL
    )");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_rate_limits_bucket ON rate_limits(bucket, ts)");

    // Columns for databases created by older versions
    addColumnIfMissing($db, 'poker_tables', 'room_code', 'VARCHAR(50) NULL');
    addColumnIfMissing($db, 'poker_tables', 'creator_username', "VARCHAR(50) DEFAULT 'system'");
    addColumnIfMissing($db, 'poker_tables', 'max_players', 'INTEGER DEFAULT 4');
    addColumnIfMissing($db, 'poker_tables', 'bot_count', 'INTEGER DEFAULT 1');

    addColumnIfMissing($db, 'transmissions', 'room_id', "VARCHAR(50) DEFAULT 'general'");
    addColumnIfMissing($db, 'transmissions', 'username', "VARCHAR(50) DEFAULT 'guest'");
    addColumnIfMissing($db, 'transmissions', 'user_id', 'INTEGER NULL');
    addColumnIfMissing($db, 'transmissions', 'is_deleted', 'INTEGER DEFAULT 0');

    addColumnIfMissing($db, 'accounts', 'is_admin', 'INTEGER DEFAULT 0');
    addColumnIfMissing($db, 'accounts', 'can_read_books', 'INTEGER DEFAULT 0');
    addColumnIfMissing($db, 'accounts', 'can_upload_books', 'INTEGER DEFAULT 0');
    addColumnIfMissing($db, 'accounts', 'is_banned', 'INTEGER DEFAULT 0');
    addColumnIfMissing($db, 'accounts', 'banned_until', 'DATETIME NULL');
    addColumnIfMissing($db, 'accounts', 'bio', "TEXT DEFAULT ''");

    // is_private  = only admins can POST (announcement channel, readable by everyone)
    // is_hidden   = only admins can READ  (e.g. the admin room)
    addColumnIfMissing($db, 'rooms', 'is_hidden', 'INTEGER DEFAULT 0');

    $db->exec("INSERT OR IGNORE INTO rooms (id, name, is_private) VALUES ('general', 'General', 0)");
    $db->exec("INSERT OR IGNORE INTO rooms (id, name, is_private) VALUES ('announcements', 'Announcements Board', 1)");
    $db->exec("UPDATE rooms SET is_hidden = 1 WHERE id = 'admin'");

    $db->exec("CREATE INDEX IF NOT EXISTS idx_transmissions_room_id ON transmissions(room_id, id)");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_poker_players_table ON poker_players(table_id)");
}

function migrateV2(PDO $db): void {
    // Tracks whether the one-time EPUB metadata repair has already been attempted
    addColumnIfMissing($db, 'books', 'meta_checked', 'INTEGER DEFAULT 0');
}

function migrateV3(PDO $db): void {
    // Public guestbook / graffiti wall
    $db->exec("CREATE TABLE IF NOT EXISTS guestbook (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NULL,
        username VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        sender_ip VARCHAR(45) NOT NULL,
        is_deleted INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_guestbook_visible ON guestbook(is_deleted, id)");
}

function migrateV4(PDO $db): void {
    // Per-user reader bookmarks (EPUB CFI or PDF page number in `location`)
    $db->exec("CREATE TABLE IF NOT EXISTS bookmarks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        book_id INTEGER NOT NULL,
        location TEXT NOT NULL,
        label VARCHAR(100) NOT NULL DEFAULT '',
        percentage REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_bookmarks_user_book ON bookmarks(user_id, book_id)");
}

function migrateV5(PDO $db): void {
    // Poker leaderboard: lifetime stats per account (bots/guests not tracked)
    $db->exec("CREATE TABLE IF NOT EXISTS poker_stats (
        user_id INTEGER PRIMARY KEY,
        username VARCHAR(50) NOT NULL,
        hands_played INTEGER NOT NULL DEFAULT 0,
        hands_won INTEGER NOT NULL DEFAULT 0,
        chips_won INTEGER NOT NULL DEFAULT 0,
        biggest_pot INTEGER NOT NULL DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_poker_stats_rank ON poker_stats(hands_won DESC, chips_won DESC)");
}

function migrateV6(PDO $db): void {
    // "Who's the Spy" multiplayer rooms. Times are unix seconds.
    $db->exec("CREATE TABLE IF NOT EXISTS spia_rooms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code VARCHAR(8) NOT NULL UNIQUE,
        host_device_id INTEGER NOT NULL DEFAULT 0,
        settings TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        round_id INTEGER NULL,
        round_count INTEGER NOT NULL DEFAULT 0,
        recent_locations TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    )");
    $db->exec("CREATE TABLE IF NOT EXISTS spia_devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER NOT NULL,
        token_hash CHAR(64) NOT NULL UNIQUE,
        joined_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
    )");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_spia_devices_room ON spia_devices(room_id)");
    $db->exec("CREATE TABLE IF NOT EXISTS spia_players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER NOT NULL,
        device_id INTEGER NOT NULL,
        name VARCHAR(40) NOT NULL,
        score INTEGER NOT NULL DEFAULT 0,
        is_owner INTEGER NOT NULL DEFAULT 0,
        removed INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
    )");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_spia_players_room ON spia_players(room_id, removed)");
    $db->exec("CREATE TABLE IF NOT EXISTS spia_rounds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER NOT NULL,
        number INTEGER NOT NULL,
        location_id VARCHAR(40) NOT NULL,
        pool TEXT NOT NULL,
        rules TEXT NOT NULL,
        spy_count INTEGER NOT NULL,
        deal_players INTEGER NOT NULL,
        status VARCHAR(10) NOT NULL DEFAULT 'play',
        result TEXT NULL,
        vote_no INTEGER NOT NULL DEFAULT 0,
        vote_open INTEGER NOT NULL DEFAULT 0,
        vote_forced INTEGER NOT NULL DEFAULT 0,
        timer_ends INTEGER NULL,
        starter_player_id INTEGER NULL,
        log TEXT NOT NULL DEFAULT '[]',
        started_at INTEGER NOT NULL,
        ended_at INTEGER NULL
    )");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_spia_rounds_room ON spia_rounds(room_id)");
    $db->exec("CREATE TABLE IF NOT EXISTS spia_assign (
        round_id INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        is_spy INTEGER NOT NULL DEFAULT 0,
        role INTEGER NULL,
        fake_role INTEGER NULL,
        seen INTEGER NOT NULL DEFAULT 0,
        out_reason VARCHAR(10) NULL,
        PRIMARY KEY (round_id, player_id)
    )");
    $db->exec("CREATE TABLE IF NOT EXISTS spia_votes (
        round_id INTEGER NOT NULL,
        vote_no INTEGER NOT NULL,
        voter_id INTEGER NOT NULL,
        target_id INTEGER NOT NULL,
        PRIMARY KEY (round_id, vote_no, voter_id)
    )");
}

function migrateV7(PDO $db): void {
    // Rooms can host different games; Lupus (werewolf) keeps its whole match state as JSON
    addColumnIfMissing($db, 'spia_rooms', 'game', "VARCHAR(10) NOT NULL DEFAULT 'spia'");
    $db->exec("CREATE TABLE IF NOT EXISTS lupus_games (
        room_id INTEGER PRIMARY KEY,
        state TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    )");
}

function migrateV8(PDO $db): void {
    // Private messages between registered users. No admin access path exists in the API.
    $db->exec("CREATE TABLE IF NOT EXISTS dm_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER NOT NULL,
        recipient_id INTEGER NOT NULL,
        body TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        read_at DATETIME NULL
    )");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_dm_pair ON dm_messages(sender_id, recipient_id, id)");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_dm_inbox ON dm_messages(recipient_id, read_at)");
    $db->exec("CREATE TABLE IF NOT EXISTS dm_blocks (
        blocker_id INTEGER NOT NULL,
        blocked_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (blocker_id, blocked_id)
    )");
}

function migrateV9(PDO $db): void {
    // Visit log: one row per visitor (hash of IP + browser), to tell a new visit from a page view
    $db->exec("CREATE TABLE IF NOT EXISTS visitors (
        vhash TEXT PRIMARY KEY,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        last_new INTEGER NOT NULL,
        visits INTEGER NOT NULL DEFAULT 1
    )");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_visitors_new ON visitors(last_new)");
    // EPUB covers: books checked while PHP had no zip extension got no cover and were never
    // retried. Check them again (the repair now waits until ZipArchive is available).
    $db->exec("UPDATE books SET meta_checked = 0 WHERE format = 'epub' AND (cover_path IS NULL OR cover_path = '')");
}

function migrateV10(PDO $db): void {
    // The CV page is private, like the library: only accounts the admin allows (/grantcv)
    addColumnIfMissing($db, 'accounts', 'can_view_resume', 'INTEGER DEFAULT 0');
}

function migrateV11(PDO $db): void {
    // Cucù (card game on the shared rooms): the whole match state as JSON, like lupus_games
    $db->exec("CREATE TABLE IF NOT EXISTS cucu_games (
        room_id INTEGER PRIMARY KEY,
        state TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    )");
}

function migrateV12(PDO $db): void {
    // Shared class notes: classes (one per school class, approved by the admin), members,
    // subjects and timetables. Times are unix seconds; lesson times are local to the class timezone.
    $db->exec("CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )");
    $db->exec("CREATE TABLE IF NOT EXISTS school_classes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        school TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        manager_id INTEGER NOT NULL,
        invite_code TEXT UNIQUE,
        request_note TEXT NOT NULL DEFAULT '',
        timezone TEXT NOT NULL DEFAULT 'Europe/Rome',
        periods TEXT NOT NULL DEFAULT '[]',
        summary_time TEXT NOT NULL DEFAULT '18:00',
        max_file_mb INTEGER,
        max_class_mb INTEGER,
        ai_requested_at INTEGER,
        ai_last_manual INTEGER,
        ai_last_auto TEXT,
        created_at INTEGER NOT NULL,
        decided_at INTEGER
    )");
    $db->exec('CREATE INDEX IF NOT EXISTS idx_school_classes_status ON school_classes(status)');
    $db->exec("CREATE TABLE IF NOT EXISTS class_members (
        class_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        joined_at INTEGER NOT NULL,
        PRIMARY KEY (class_id, user_id)
    )");
    $db->exec('CREATE INDEX IF NOT EXISTS idx_class_members_user ON class_members(user_id)');
    $db->exec("CREATE TABLE IF NOT EXISTS class_subjects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        UNIQUE (class_id, name)
    )");
    // One row per timetable version: slots is JSON [{day, period, subject_id, label, room}]
    $db->exec("CREATE TABLE IF NOT EXISTS class_timetables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class_id INTEGER NOT NULL,
        valid_from TEXT NOT NULL,
        slots TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (class_id, valid_from)
    )");
    // Study material: notes, the teacher's slides, book pages, oral-exam questions, practice tests.
    // Each item belongs to a subject and a day (the lesson it comes from, or the day it was handed out).
    $db->exec("CREATE TABLE IF NOT EXISTS class_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class_id INTEGER NOT NULL,
        subject_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        lesson_date TEXT NOT NULL,
        period INTEGER,
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        author_id INTEGER NOT NULL,
        source TEXT NOT NULL DEFAULT 'site',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    )");
    $db->exec('CREATE INDEX IF NOT EXISTS idx_class_items_lesson ON class_items(class_id, subject_id, lesson_date)');
    // Files of an item, stored in data/appunti/<class>/. `text` is the transcription: extracted on upload
    // for text/Office files, by the AI once for photos and PDFs (text_status 'pending' until then).
    $db->exec("CREATE TABLE IF NOT EXISTS class_item_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL,
        class_id INTEGER NOT NULL,
        stored_name TEXT NOT NULL,
        original_name TEXT NOT NULL,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        text TEXT,
        text_status TEXT NOT NULL,
        text_attempts INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
    )");
    $db->exec('CREATE INDEX IF NOT EXISTS idx_class_item_files_item ON class_item_files(item_id)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_class_item_files_class ON class_item_files(class_id, text_status)');
    // Class calendar: written tests, oral exams, other dates
    $db->exec("CREATE TABLE IF NOT EXISTS class_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class_id INTEGER NOT NULL,
        subject_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        event_date TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        topics TEXT NOT NULL DEFAULT '',
        author_id INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    )");
    $db->exec('CREATE INDEX IF NOT EXISTS idx_class_events_date ON class_events(class_id, event_date)');
    // Documents written by the AI: one row per doc_key (e.g. "lezione:<subject>:<date>"), rewritten only when
    // the material it comes from changes (input_hash). content is Markdown.
    $db->exec("CREATE TABLE IF NOT EXISTS class_docs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class_id INTEGER NOT NULL,
        doc_key TEXT NOT NULL,
        subject_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        lesson_date TEXT,
        event_id INTEGER,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        sources TEXT NOT NULL DEFAULT '[]',
        input_hash TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'ok',
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (class_id, doc_key)
    )");
    $db->exec('CREATE INDEX IF NOT EXISTS idx_class_docs_subject ON class_docs(class_id, subject_id, kind)');
    // Requests sent to the AI per model and day (Google's free quota resets at midnight Pacific time)
    $db->exec("CREATE TABLE IF NOT EXISTS ai_usage (
        day TEXT NOT NULL,
        model TEXT NOT NULL,
        requests INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, model)
    )");
}

function migrateV13(PDO $db): void {
    // Notifications: the in-site list (bell), Web Push subscriptions of each browser/phone,
    // and which test reminders were already sent (2 days before, 1 day before, the evening before)
    $db->exec("CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        class_id INTEGER,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        read_at INTEGER
    )");
    $db->exec('CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, id)');
    $db->exec("CREATE TABLE IF NOT EXISTS push_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_ok_at INTEGER,
        failures INTEGER NOT NULL DEFAULT 0
    )");
    $db->exec('CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id)');
    $db->exec("CREATE TABLE IF NOT EXISTS class_event_reminders (
        event_id INTEGER NOT NULL,
        slot TEXT NOT NULL,
        sent_at INTEGER NOT NULL,
        PRIMARY KEY (event_id, slot)
    )");
}

function migrateV14(PDO $db): void {
    // Study documents made with another AI and uploaded by hand: who uploaded them (NULL = written by the site's AI)
    addColumnIfMissing($db, 'class_docs', 'author_id', 'INTEGER');
}

function migrateV15(PDO $db): void {
    // A test can say which material to study (from/to), when the topic does not start after the previous test
    addColumnIfMissing($db, 'class_events', 'period_from', 'TEXT');
    addColumnIfMissing($db, 'class_events', 'period_to', 'TEXT');
    // "Genera ora" on a chosen range of lesson days
    addColumnIfMissing($db, 'school_classes', 'ai_range_from', 'TEXT');
    addColumnIfMissing($db, 'school_classes', 'ai_range_to', 'TEXT');
    // Push 5 minutes before the end of each lesson: what comes next and where (each member chooses)
    addColumnIfMissing($db, 'class_members', 'bell_notify', 'INTEGER NOT NULL DEFAULT 0');
    $db->exec("CREATE TABLE IF NOT EXISTS class_bell_sent (
        class_id INTEGER NOT NULL,
        lesson_date TEXT NOT NULL,
        period INTEGER NOT NULL,
        sent_at INTEGER NOT NULL,
        PRIMARY KEY (class_id, lesson_date, period)
    )");
    // Spaced review: quiz questions answered wrong come back after 1, 3, 7, 14, 30 days until known
    $db->exec("CREATE TABLE IF NOT EXISTS review_cards (
        user_id INTEGER NOT NULL,
        doc_id INTEGER NOT NULL,
        q_index INTEGER NOT NULL,
        class_id INTEGER NOT NULL,
        box INTEGER NOT NULL DEFAULT 0,
        due_date TEXT NOT NULL,
        question TEXT NOT NULL,             -- a copy of the question (JSON): the quiz may be rewritten later
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, doc_id, q_index)
    )");
    $db->exec('CREATE INDEX IF NOT EXISTS idx_review_due ON review_cards(user_id, class_id, due_date)');
}

function migrateV16(PDO $db): void {
    // Class roles made by the representative (name, colour, permissions) and per-member extras
    $db->exec("CREATE TABLE IF NOT EXISTS class_roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#5b8def',
        perms TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL
    )");
    $db->exec('CREATE INDEX IF NOT EXISTS idx_class_roles_class ON class_roles(class_id)');
    addColumnIfMissing($db, 'class_members', 'role_id', 'INTEGER');
    addColumnIfMissing($db, 'class_members', 'perms', "TEXT NOT NULL DEFAULT '[]'");
    // The name shown inside the class (real name), instead of the site username
    addColumnIfMissing($db, 'class_members', 'display_name', 'TEXT');
}

/** v37: the language of the person (accounts.lang, 'en' or 'it'): the e-mails and notifications we send follow it, not the admin's. */
/** v38: the news board (pages/novita.php): what is new, what is being worked on right now, what comes next. Texts in both languages. */
/** v39: ideas the people with an account suggest on the news page (api/news_ideas.php). */
/** v40: the admin action log (every successful admin POST, see adminLogRequest in helpers.php) and the votes on ideas. */
/** v44: the arcade leaderboards (api/game_scores.php): ONE row per account, game and variant: its best score (or best time). */
function migrateV52(PDO $db): void {
    // "Obbligo o verità" (obbligo, on the shared rooms): the whole match state as JSON, like bomba_games
    $db->exec("CREATE TABLE IF NOT EXISTS obbligo_games (
        room_id INTEGER PRIMARY KEY,
        state TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    )");
}

function migrateV51(PDO $db): void {
    // "Undercover" (undercover, on the shared rooms): the whole match state as JSON (roles and words included), like bomba_games
    $db->exec("CREATE TABLE IF NOT EXISTS undercover_games (
        room_id INTEGER PRIMARY KEY,
        state TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    )");
}

function migrateV50(PDO $db): void {
    // "La bomba" (bomba, on the shared rooms): the whole match state as JSON (the hidden fuse included), like preferiresti_games
    $db->exec("CREATE TABLE IF NOT EXISTS bomba_games (
        room_id INTEGER PRIMARY KEY,
        state TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    )");
}

function migrateV49(PDO $db): void {
    // "Preferiresti…?" (preferiresti, on the shared rooms): the whole match state as JSON, like probabile_games
    $db->exec("CREATE TABLE IF NOT EXISTS preferiresti_games (
        room_id INTEGER PRIMARY KEY,
        state TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    )");
}

function migrateV48(PDO $db): void {
    // "Chi è più probabile che…" (probabile, on the shared rooms): the whole match state as JSON, like botola_games
    $db->exec("CREATE TABLE IF NOT EXISTS probabile_games (
        room_id INTEGER PRIMARY KEY,
        state TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    )");
}

function migrateV47(PDO $db): void {
    // Personal records of the solo games (private to the account, not a leaderboard): the best result per game and variant
    $db->exec("CREATE TABLE IF NOT EXISTS personal_records (
        user_id INTEGER NOT NULL,
        game TEXT NOT NULL,
        variant TEXT NOT NULL DEFAULT '',
        best INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, game, variant)
    )");
}

function migrateV46(PDO $db): void {
    // Library: highlights and notes, labels ("shelves") per account, reading time per day, and a file hash to spot duplicates
    $db->exec("CREATE TABLE IF NOT EXISTS book_highlights (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        book_id INTEGER NOT NULL,
        kind TEXT NOT NULL DEFAULT 'hl',
        location TEXT NOT NULL,
        text TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL DEFAULT 'yellow',
        percentage REAL NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )");
    $db->exec('CREATE INDEX IF NOT EXISTS idx_book_highlights ON book_highlights(user_id, book_id)');
    $db->exec("CREATE TABLE IF NOT EXISTS book_tags (
        user_id INTEGER NOT NULL,
        book_id INTEGER NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY (user_id, book_id, tag)
    )");
    $db->exec("CREATE TABLE IF NOT EXISTS reading_log (
        user_id INTEGER NOT NULL,
        day TEXT NOT NULL,
        seconds INTEGER NOT NULL DEFAULT 0,
        pages INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, day)
    )");
    addColumnIfMissing($db, 'books', 'file_sha1', "TEXT NOT NULL DEFAULT ''");
}

function migrateV45(PDO $db): void {
    // Botola (quiz on the shared rooms): the whole match state as JSON, like cucu_games
    $db->exec("CREATE TABLE IF NOT EXISTS botola_games (
        room_id INTEGER PRIMARY KEY,
        state TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    )");
}

function migrateV44(PDO $db): void {
    $db->exec("CREATE TABLE IF NOT EXISTS game_scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        game TEXT NOT NULL,
        variant TEXT NOT NULL DEFAULT '',
        score INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (user_id, game, variant)
    )");
    $db->exec('CREATE INDEX IF NOT EXISTS idx_game_scores_board ON game_scores(game, variant, score DESC)');
}

/** v42: where you are signed in: one row per signed-in browser (hash of the session id, a label, the country, dates; no IP). */
function migrateV42(PDO $db): void {
    $db->exec("CREATE TABLE IF NOT EXISTS account_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        sid_hash TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL DEFAULT '',
        country TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
    )");
    $db->exec('CREATE INDEX IF NOT EXISTS idx_account_sessions_user ON account_sessions(user_id)');
}

/** v43: "Parola del giorno" streak, stats and today's saved game for people with an account (api/parola.php), as JSON texts. */
function migrateV43(PDO $db): void {
    $db->exec("CREATE TABLE IF NOT EXISTS parola_stats (
        user_id INTEGER PRIMARY KEY,
        stats TEXT NOT NULL DEFAULT '{}',
        daily TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL
    )");
}

/** v41: two-step login (TOTP) for admins: the encrypted secret, whether it is on, the last accepted 30-second step, the hashed backup codes. */
function migrateV41(PDO $db): void {
    addColumnIfMissing($db, 'accounts', 'totp_secret', "TEXT NOT NULL DEFAULT ''");
    addColumnIfMissing($db, 'accounts', 'totp_enabled', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing($db, 'accounts', 'totp_last_step', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing($db, 'accounts', 'totp_backup', "TEXT NOT NULL DEFAULT ''");
}

function migrateV40(PDO $db): void {
    $db->exec("CREATE TABLE IF NOT EXISTS admin_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_id INTEGER NOT NULL, admin_name TEXT NOT NULL,
        script TEXT NOT NULL, action TEXT NOT NULL DEFAULT '',
        target_user_id INTEGER, target_name TEXT NOT NULL DEFAULT '',
        detail TEXT NOT NULL DEFAULT '',                -- JSON of a short whitelist of fields: never texts, passwords or mail bodies
        created_at INTEGER NOT NULL
    )");
    $db->exec('CREATE INDEX IF NOT EXISTS idx_admin_log_time ON admin_log(id DESC)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_admin_log_target ON admin_log(target_user_id)');
    $db->exec('CREATE TABLE IF NOT EXISTS news_idea_votes (
        idea_id INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY (idea_id, user_id)
    ) WITHOUT ROWID');
}

function migrateV39(PDO $db): void {
    $db->exec("CREATE TABLE IF NOT EXISTS news_ideas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        text TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'new',            -- new | considering | planned | done | declined
        reply TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
    )");
    $db->exec('CREATE INDEX IF NOT EXISTS idx_ideas_user ON news_ideas(user_id, id)');
}

function migrateV38(PDO $db): void {
    $db->exec("CREATE TABLE IF NOT EXISTS news_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL DEFAULT 'feature',          -- feature | fix | content | security | ops
        status TEXT NOT NULL DEFAULT 'doing',          -- planned | doing | done
        title_en TEXT NOT NULL DEFAULT '', title_it TEXT NOT NULL DEFAULT '',
        body_en TEXT NOT NULL DEFAULT '', body_it TEXT NOT NULL DEFAULT '',
        progress INTEGER,                              -- 0-100 or NULL (unknown)
        version TEXT NOT NULL DEFAULT '',              -- the site version it went live in
        is_public INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, done_at INTEGER
    )");
    $db->exec('CREATE INDEX IF NOT EXISTS idx_news_status ON news_items(status, updated_at)');
    $db->exec("CREATE TABLE IF NOT EXISTS news_updates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL,
        text_en TEXT NOT NULL, text_it TEXT NOT NULL,
        created_at INTEGER NOT NULL
    )");
    $db->exec('CREATE INDEX IF NOT EXISTS idx_news_updates ON news_updates(item_id, id)');
}

function migrateV37(PDO $db): void {
    $had = (bool)$db->query("SELECT 1 FROM pragma_table_info('accounts') WHERE name = 'lang'")->fetchColumn();
    addColumnIfMissing($db, 'accounts', 'lang', "TEXT NOT NULL DEFAULT 'en'");
    // the people who signed up before this were reading the Italian site: keep their notifications Italian until they choose
    if (!$had) $db->exec("UPDATE accounts SET lang = 'it'");
}

/** v30: a temporary link can be limited to a number of openings (0 = no limit). */
/** v33: the AI (Google Gemini) only reads the material of a class declared to have adult students only: the requester says so
 *  (adults_declared) and the representative can switch it on later (the students grow up). Classes that already existed keep it on. */
/** v36: the notes list (newest day first, 300 rows) read its rows through a temp sort of the whole class; this index serves the order. */
function migrateV36(PDO $db): void {
    $db->exec('CREATE INDEX IF NOT EXISTS idx_items_day ON class_items(class_id, lesson_date DESC, id DESC)');
}

/** v35: the e-mail box. An account may give an e-mail address (optional; verified by a link) and agree to site news;
 *  the admin writes messages (drafts / sent) and the site sends them through a queue (api/mailer.php). Nothing is sent
 *  unless MAIL_DRIVER is set in .env. */
function migrateV35(PDO $db): void {
    addColumnIfMissing($db, 'accounts', 'email', "TEXT NOT NULL DEFAULT ''");
    addColumnIfMissing($db, 'accounts', 'email_verified', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing($db, 'accounts', 'email_optin', 'INTEGER NOT NULL DEFAULT 0');       // agreed to site news (separate from the address)
    addColumnIfMissing($db, 'accounts', 'email_optin_at', 'INTEGER');                         // when: proof of consent
    $db->exec("CREATE TABLE IF NOT EXISTS mail_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        folder TEXT NOT NULL DEFAULT 'draft',          -- draft | sent
        subject TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        audience TEXT NOT NULL DEFAULT 'optin',        -- optin | supporters | test
        created_by INTEGER,
        recipients INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        sent_at INTEGER
    )");
    $db->exec("CREATE TABLE IF NOT EXISTS mail_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER,
        account_id INTEGER,
        to_email TEXT NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'bulk',             -- bulk | verify | test
        status TEXT NOT NULL DEFAULT 'pending',        -- pending | sent | failed
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        sent_at INTEGER
    )");
    $db->exec('CREATE INDEX IF NOT EXISTS idx_mail_queue_status ON mail_queue(status, id)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_mail_queue_message ON mail_queue(message_id)');
}

/** v34: user names are unique regardless of case (no "Admin" next to "admin"). Skipped, not failed, if old accounts already clash:
 *  the registration check in login.php covers new ones anyway. */
function migrateV34(PDO $db): void {
    $clash = (int)$db->query('SELECT COUNT(*) FROM (SELECT 1 FROM accounts GROUP BY LOWER(username) HAVING COUNT(*) > 1)')->fetchColumn();
    if ($clash === 0) $db->exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_username_nocase ON accounts(username COLLATE NOCASE)');
}

function migrateV33(PDO $db): void {
    addColumnIfMissing($db, 'school_classes', 'ai_allowed', 'INTEGER NOT NULL DEFAULT 1');
    addColumnIfMissing($db, 'school_classes', 'ai_adults_at', 'INTEGER');      // when someone declared "all adults" (NULL: before this rule)
    addColumnIfMissing($db, 'school_classes', 'ai_adults_by', 'INTEGER');      // who declared it
}

/** v32: people who donated (kept by the admin by hand: name as they want it shown, amount, optional account for the badge)
 *  and accounts that never see ads. No e-mail, no payment data: the donation services keep those. */
function migrateV32(PDO $db): void {
    $db->exec("CREATE TABLE IF NOT EXISTS donors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER,
        display_name TEXT NOT NULL DEFAULT '',
        amount_cents INTEGER NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'EUR',
        donated_at TEXT NOT NULL,
        is_public INTEGER NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
    )");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_donors_account ON donors(account_id)");
    addColumnIfMissing($db, 'accounts', 'ads_free', 'INTEGER NOT NULL DEFAULT 0');
}

/** v31: daily counters of bot requests (see bots.php), shown on the statistics page. */
function migrateV31(PDO $db): void {
    $db->exec("CREATE TABLE IF NOT EXISTS bot_stats (
        day TEXT NOT NULL,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        hits INTEGER NOT NULL DEFAULT 0,
        blocked INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, kind, label)
    ) WITHOUT ROWID");
}

function migrateV30(PDO $db): void {
    addColumnIfMissing($db, 'share_links', 'max_views', 'INTEGER NOT NULL DEFAULT 0');
}

/** v29: the example class (fake data, read-only for everybody, made by bin/appunti-demo.php). */
function migrateV29(PDO $db): void {
    addColumnIfMissing($db, 'school_classes', 'is_demo', 'INTEGER NOT NULL DEFAULT 0');
}

/** v28: the default desktop theme is now the monochrome one (accounts that never chose still have the old 'cyan' default). */
function migrateV28(PDO $db): void {
    $db->exec("UPDATE accounts SET theme = 'monochrome' WHERE theme IS NULL OR theme IN ('', 'cyan', 'light', 'sepia', 'dark', 'black', 'emerald', 'slate', 'classic')");
}

function migrateV27(PDO $db): void {
    // Temporary links to one piece of class material (a file, a study document, a note): the token is stored only as a hash
    $db->exec("CREATE TABLE IF NOT EXISTS share_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_hash TEXT NOT NULL UNIQUE,
        class_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        ref_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        views INTEGER NOT NULL DEFAULT 0,
        revoked INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
    )");
    $db->exec('CREATE INDEX IF NOT EXISTS idx_share_user ON share_links(user_id, created_at)');
}

function migrateV26(PDO $db): void {
    // Material by date AND topic: which topic of the subject an upload belongs to (topic_manual = chosen by a person, never
    // changed by the automatic assignment), and which topic a study document is about (when its material is all of one topic)
    addColumnIfMissing($db, 'class_items', 'topic_id', 'INTEGER');
    addColumnIfMissing($db, 'class_items', 'topic_manual', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing($db, 'class_docs', 'topic_id', 'INTEGER');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_items_topic ON class_items(class_id, topic_id)');
}

function migrateV25(PDO $db): void {
    // How far each user got in a long document (index of the last heading passed), the same on phone and computer
    $db->exec("CREATE TABLE IF NOT EXISTS read_progress (
        user_id INTEGER NOT NULL,
        ref TEXT NOT NULL,
        idx INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, ref)
    )");
}

function migrateV24(PDO $db): void {
    // AI check of each upload: '' = not checked yet, 'auto' = the uploader asked the AI to decide the type, 'done' = checked
    addColumnIfMissing($db, 'class_items', 'ai_state', "TEXT NOT NULL DEFAULT ''");
    $db->exec("UPDATE class_items SET ai_state = 'done' WHERE ai_state = ''");   // what exists already is not checked retroactively
}

function migrateV23(PDO $db): void {
    // How many times a question of the review was answered wrongly ("you have been getting this one wrong for a while")
    addColumnIfMissing($db, 'review_cards', 'fails', 'INTEGER NOT NULL DEFAULT 0');
}

function migrateV22(PDO $db): void {
    // Change log of a class (who deleted, changed roles, removed members...): for the representative to look at
    $db->exec("CREATE TABLE IF NOT EXISTS class_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class_id INTEGER NOT NULL,
        user_id INTEGER,
        action TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
    )");
    $db->exec('CREATE INDEX IF NOT EXISTS idx_class_log ON class_log(class_id, id)');
}

function migrateV21(PDO $db): void {
    // "Quiz su misura": questions drawn from the class quizzes for one user; the answers stay on the server until the user answers
    $db->exec("CREATE TABLE IF NOT EXISTS custom_quizzes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        class_id INTEGER NOT NULL,
        subject_id INTEGER,
        items TEXT NOT NULL,
        answered TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
    )");
    $db->exec('CREATE INDEX IF NOT EXISTS idx_custom_quizzes ON custom_quizzes(user_id, created_at)');
}

function migrateV20(PDO $db): void {
    // Full-text search (SQLite FTS5, no AI) over the typed notes, the text of files (transcriptions, Word, slides) and the written
    // study documents. Triggers keep it up to date, so the code that writes the material does not have to know about it.
    $db->exec("CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(title, body, class_id UNINDEXED, kind UNINDEXED, ref UNINDEXED,
               subject_id UNINDEXED, lesson_date UNINDEXED, tokenize = 'unicode61 remove_diacritics 2')");
    $docKinds = "('lezione', 'completo', 'riassunto', 'preparazione', 'domande')";
    $db->exec("DROP TRIGGER IF EXISTS fts_items_ai"); $db->exec("DROP TRIGGER IF EXISTS fts_items_au"); $db->exec("DROP TRIGGER IF EXISTS fts_items_ad");
    $db->exec("DROP TRIGGER IF EXISTS fts_files_ai"); $db->exec("DROP TRIGGER IF EXISTS fts_files_au"); $db->exec("DROP TRIGGER IF EXISTS fts_files_ad");
    $db->exec("DROP TRIGGER IF EXISTS fts_docs_ai"); $db->exec("DROP TRIGGER IF EXISTS fts_docs_au"); $db->exec("DROP TRIGGER IF EXISTS fts_docs_ad");
    // typed notes of an item
    $db->exec("CREATE TRIGGER fts_items_ai AFTER INSERT ON class_items WHEN LENGTH(TRIM(new.body)) > 0 BEGIN
        INSERT INTO notes_fts (title, body, class_id, kind, ref, subject_id, lesson_date) VALUES (new.title, new.body, new.class_id, 'item', 'i:' || new.id, new.subject_id, new.lesson_date); END");
    $db->exec("CREATE TRIGGER fts_items_au AFTER UPDATE ON class_items BEGIN
        DELETE FROM notes_fts WHERE ref = 'i:' || old.id;
        INSERT INTO notes_fts (title, body, class_id, kind, ref, subject_id, lesson_date) SELECT new.title, new.body, new.class_id, 'item', 'i:' || new.id, new.subject_id, new.lesson_date WHERE LENGTH(TRIM(new.body)) > 0;
        UPDATE notes_fts SET subject_id = new.subject_id, lesson_date = new.lesson_date WHERE ref IN (SELECT 'f:' || id FROM class_item_files WHERE item_id = new.id); END");
    $db->exec("CREATE TRIGGER fts_items_ad AFTER DELETE ON class_items BEGIN DELETE FROM notes_fts WHERE ref = 'i:' || old.id; END");
    // text of a file
    $db->exec("CREATE TRIGGER fts_files_ai AFTER INSERT ON class_item_files WHEN new.text IS NOT NULL AND LENGTH(TRIM(new.text)) > 0 BEGIN
        INSERT INTO notes_fts (title, body, class_id, kind, ref, subject_id, lesson_date)
        SELECT new.original_name, new.text, new.class_id, 'file', 'f:' || new.id, i.subject_id, i.lesson_date FROM class_items i WHERE i.id = new.item_id; END");
    $db->exec("CREATE TRIGGER fts_files_au AFTER UPDATE OF text ON class_item_files BEGIN
        DELETE FROM notes_fts WHERE ref = 'f:' || old.id;
        INSERT INTO notes_fts (title, body, class_id, kind, ref, subject_id, lesson_date)
        SELECT new.original_name, new.text, new.class_id, 'file', 'f:' || new.id, i.subject_id, i.lesson_date FROM class_items i WHERE i.id = new.item_id AND new.text IS NOT NULL AND LENGTH(TRIM(new.text)) > 0; END");
    $db->exec("CREATE TRIGGER fts_files_ad AFTER DELETE ON class_item_files BEGIN DELETE FROM notes_fts WHERE ref = 'f:' || old.id; END");
    // written study documents
    $db->exec("CREATE TRIGGER fts_docs_ai AFTER INSERT ON class_docs WHEN new.kind IN $docKinds AND new.status = 'ok' BEGIN
        INSERT INTO notes_fts (title, body, class_id, kind, ref, subject_id, lesson_date) VALUES (new.title, new.content, new.class_id, 'doc', 'd:' || new.id, new.subject_id, new.lesson_date); END");
    $db->exec("CREATE TRIGGER fts_docs_au AFTER UPDATE ON class_docs BEGIN
        DELETE FROM notes_fts WHERE ref = 'd:' || old.id;
        INSERT INTO notes_fts (title, body, class_id, kind, ref, subject_id, lesson_date) SELECT new.title, new.content, new.class_id, 'doc', 'd:' || new.id, new.subject_id, new.lesson_date WHERE new.kind IN $docKinds AND new.status = 'ok'; END");
    $db->exec("CREATE TRIGGER fts_docs_ad AFTER DELETE ON class_docs BEGIN DELETE FROM notes_fts WHERE ref = 'd:' || old.id; END");
    // what exists already
    $db->exec("DELETE FROM notes_fts");
    $db->exec("INSERT INTO notes_fts (title, body, class_id, kind, ref, subject_id, lesson_date) SELECT title, body, class_id, 'item', 'i:' || id, subject_id, lesson_date FROM class_items WHERE LENGTH(TRIM(body)) > 0");
    $db->exec("INSERT INTO notes_fts (title, body, class_id, kind, ref, subject_id, lesson_date) SELECT f.original_name, f.text, f.class_id, 'file', 'f:' || f.id, i.subject_id, i.lesson_date
               FROM class_item_files f JOIN class_items i ON i.id = f.item_id WHERE f.text IS NOT NULL AND LENGTH(TRIM(f.text)) > 0");
    $db->exec("INSERT INTO notes_fts (title, body, class_id, kind, ref, subject_id, lesson_date) SELECT title, content, class_id, 'doc', 'd:' || id, subject_id, lesson_date FROM class_docs WHERE kind IN $docKinds AND status = 'ok'");
}

function migrateV19(PDO $db): void {
    // Scoreboard. The answers of a quiz are judged by the server and kept (first try only); points go in score_events so
    // that a member who leaves the scoreboard can have all of theirs deleted in one go.
    $db->exec("CREATE TABLE IF NOT EXISTS quiz_answers (
        user_id INTEGER NOT NULL,
        doc_id INTEGER NOT NULL,
        q_index INTEGER NOT NULL,
        class_id INTEGER NOT NULL,
        choice INTEGER NOT NULL,
        correct INTEGER NOT NULL,
        points INTEGER NOT NULL DEFAULT 0,
        answered_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, doc_id, q_index)
    )");
    $db->exec("CREATE TABLE IF NOT EXISTS quiz_seen (
        user_id INTEGER NOT NULL,
        doc_id INTEGER NOT NULL,
        seen_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, doc_id)
    )");
    $db->exec("CREATE TABLE IF NOT EXISTS score_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        points INTEGER NOT NULL,
        ref TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
    )");
    $db->exec('CREATE INDEX IF NOT EXISTS idx_score_class ON score_events(class_id, created_at)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_score_user ON score_events(class_id, user_id)');
}

function migrateV18(PDO $db): void {
    // Fingerprint (sha256) of each uploaded file: the same file sent twice to a class is recognised and not stored again
    addColumnIfMissing($db, 'class_item_files', 'sha256', "TEXT NOT NULL DEFAULT ''");
    $db->exec('CREATE INDEX IF NOT EXISTS idx_item_files_hash ON class_item_files(class_id, sha256)');
}

function migrateV17(PDO $db): void {
    // Topics of a subject: from a day to a day (end NULL = still being explained). 'proposed' = suggested by the AI.
    $db->exec("CREATE TABLE IF NOT EXISTS class_topics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class_id INTEGER NOT NULL,
        subject_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT,
        status TEXT NOT NULL DEFAULT 'ok',
        author_id INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    )");
    $db->exec('CREATE INDEX IF NOT EXISTS idx_class_topics ON class_topics(class_id, subject_id, start_date)');
    // Topics of the period that a test does NOT cover (unticked in the calendar)
    addColumnIfMissing($db, 'class_events', 'topics_off', "TEXT NOT NULL DEFAULT '[]'");
    $db->exec("CREATE TABLE IF NOT EXISTS class_homework (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class_id INTEGER NOT NULL,
        subject_id INTEGER NOT NULL,
        due_date TEXT NOT NULL,
        body TEXT NOT NULL,
        author_id INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    )");
    $db->exec('CREATE INDEX IF NOT EXISTS idx_class_homework ON class_homework(class_id, due_date)');
    // Days (or single hours) without lessons: holidays, strikes, trips, absent teacher
    $db->exec("CREATE TABLE IF NOT EXISTS class_days_off (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class_id INTEGER NOT NULL,
        date_from TEXT NOT NULL,
        date_to TEXT NOT NULL,
        period INTEGER,
        reason TEXT NOT NULL DEFAULT '',
        author_id INTEGER NOT NULL,
        created_at INTEGER NOT NULL
    )");
    $db->exec('CREATE INDEX IF NOT EXISTS idx_class_days_off ON class_days_off(class_id, date_from, date_to)');
    // Oral-exam turns: who is examined on which day; the class keeps one order (template) used for every subject
    $db->exec("CREATE TABLE IF NOT EXISTS class_turns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class_id INTEGER NOT NULL,
        subject_id INTEGER NOT NULL,
        turn_date TEXT NOT NULL,
        user_ids TEXT NOT NULL DEFAULT '[]',
        note TEXT NOT NULL DEFAULT '',
        notified_at INTEGER,
        author_id INTEGER NOT NULL,
        created_at INTEGER NOT NULL
    )");
    $db->exec('CREATE INDEX IF NOT EXISTS idx_class_turns ON class_turns(class_id, turn_date)');
    addColumnIfMissing($db, 'school_classes', 'turn_order', "TEXT NOT NULL DEFAULT '[]'");
    // Board: announcements, things the AI is not sure about, proposals to confirm
    $db->exec("CREATE TABLE IF NOT EXISTS class_board (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        data TEXT NOT NULL DEFAULT '{}',
        user_id INTEGER,
        status TEXT NOT NULL DEFAULT 'open',
        pinned INTEGER NOT NULL DEFAULT 0,
        author_id INTEGER,
        created_at INTEGER NOT NULL
    )");
    $db->exec('CREATE INDEX IF NOT EXISTS idx_class_board ON class_board(class_id, status, created_at)');
    // Settings: of the class (scoreboard, missing notes, weekly digest) and of each member (notifications, uploads)
    addColumnIfMissing($db, 'school_classes', 'settings', "TEXT NOT NULL DEFAULT '{}'");
    addColumnIfMissing($db, 'class_members', 'settings', "TEXT NOT NULL DEFAULT '{}'");
}

/** Runs pending migrations once, under an exclusive lock. */
function runMigrations(PDO $db): void {
    $db->exec('BEGIN IMMEDIATE');
    try {
        $current = (int)$db->query('PRAGMA user_version')->fetchColumn();
        if ($current < 1) {
            migrateV1($db);
        }
        if ($current < 2) {
            migrateV2($db);
        }
        if ($current < 3) {
            migrateV3($db);
        }
        if ($current < 4) {
            migrateV4($db);
        }
        if ($current < 5) {
            migrateV5($db);
        }
        if ($current < 6) {
            migrateV6($db);
        }
        if ($current < 7) {
            migrateV7($db);
        }
        if ($current < 8) {
            migrateV8($db);
        }
        if ($current < 9) {
            migrateV9($db);
        }
        if ($current < 10) {
            migrateV10($db);
        }
        if ($current < 11) {
            migrateV11($db);
        }
        if ($current < 12) {
            migrateV12($db);
        }
        if ($current < 13) {
            migrateV13($db);
        }
        if ($current < 14) {
            migrateV14($db);
        }
        if ($current < 15) {
            migrateV15($db);
        }
        if ($current < 16) {
            migrateV16($db);
        }
        if ($current < 17) {
            migrateV17($db);
        }
        if ($current < 18) {
            migrateV18($db);
        }
        if ($current < 19) {
            migrateV19($db);
        }
        if ($current < 20) {
            migrateV20($db);
        }
        if ($current < 21) {
            migrateV21($db);
        }
        if ($current < 22) {
            migrateV22($db);
        }
        if ($current < 23) {
            migrateV23($db);
        }
        if ($current < 24) {
            migrateV24($db);
        }
        if ($current < 25) {
            migrateV25($db);
        }
        if ($current < 26) {
            migrateV26($db);
        }
        if ($current < 27) {
            migrateV27($db);
        }
        if ($current < 28) {
            migrateV28($db);
        }
        if ($current < 29) {
            migrateV29($db);
        }
        if ($current < 30) {
            migrateV30($db);
        }
        if ($current < 31) {
            migrateV31($db);
        }
        if ($current < 32) {
            migrateV32($db);
        }
        if ($current < 33) {
            migrateV33($db);
        }
        if ($current < 34) {
            migrateV34($db);
        }
        if ($current < 35) {
            migrateV35($db);
        }
        if ($current < 36) {
            migrateV36($db);
        }
        if ($current < 37) {
            migrateV37($db);
        }
        if ($current < 38) {
            migrateV38($db);
        }
        if ($current < 39) {
            migrateV39($db);
        }
        if ($current < 40) {
            migrateV40($db);
        }
        if ($current < 41) {
            migrateV41($db);
        }
        if ($current < 42) {
            migrateV42($db);
        }
        if ($current < 43) {
            migrateV43($db);
        }
        if ($current < 44) {
            migrateV44($db);
        }
        if ($current < 45) {
            migrateV45($db);
        }
        if ($current < 46) {
            migrateV46($db);
        }
        if ($current < 47) {
            migrateV47($db);
        }
        if ($current < 48) {
            migrateV48($db);
        }
        if ($current < 49) {
            migrateV49($db);
        }
        if ($current < 50) {
            migrateV50($db);
        }
        if ($current < 51) {
            migrateV51($db);
        }
        if ($current < 52) {
            migrateV52($db);
        }
        $db->exec('PRAGMA user_version = ' . DB_SCHEMA_VERSION);
        $db->exec('COMMIT');
    } catch (Throwable $e) {
        try { $db->exec('ROLLBACK'); } catch (Throwable $ignored) { /* no active transaction */ }
        throw $e;
    }
}

/**
 * The database connection of this request: opened once and shared (opening costs ~1.7 ms, a query costs microseconds).
 * $dedicated = true gives a separate connection of its own: only the rate limiter uses it, so its short write
 * transactions never run on the connection of a caller that may have a read still open.
 */
function getDbConnection(bool $dedicated = false) {
    static $shared = null;
    if (!$dedicated && $shared !== null) return $shared;
    $dataDir = dirname(__DIR__, 2) . '/data';

    if (!is_dir($dataDir)) {
        @mkdir($dataDir, 0750, true);
    }

    $db = new PDO('sqlite:' . $dataDir . '/vector_uplink.sqlite');
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

    $db->exec("PRAGMA busy_timeout = 5000;");
    $db->exec("PRAGMA journal_mode = WAL;");
    $db->exec("PRAGMA synchronous = NORMAL;");
    $db->exec("PRAGMA temp_store = MEMORY;");
    $db->exec("PRAGMA cache_size = -8000;");   // 8 MB of page cache per connection

    // Schema work happens only when the DB is behind, not on every request
    if ((int)$db->query('PRAGMA user_version')->fetchColumn() < DB_SCHEMA_VERSION) {
        runMigrations($db);
    }

    if (!$dedicated) $shared = $db;
    return $db;
}
