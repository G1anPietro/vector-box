<?php
// public/api/database.php

require_once __DIR__ . '/helpers.php';

const DB_SCHEMA_VERSION = 12;

/**
 * Session bootstrap.
 * By default the session is released immediately (read-only) so background polling never blocks.
 * Pass $writable = true when the request has to modify $_SESSION (the caller must then close it).
 */
function initSession(bool $writable = false) {
    startWritableSession();

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
        theme VARCHAR(30) DEFAULT 'cyan',
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
        $db->exec('PRAGMA user_version = ' . DB_SCHEMA_VERSION);
        $db->exec('COMMIT');
    } catch (Throwable $e) {
        try { $db->exec('ROLLBACK'); } catch (Throwable $ignored) { /* no active transaction */ }
        throw $e;
    }
}

function getDbConnection() {
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

    // Schema work happens only when the DB is behind, not on every request
    if ((int)$db->query('PRAGMA user_version')->fetchColumn() < DB_SCHEMA_VERSION) {
        runMigrations($db);
    }

    return $db;
}
