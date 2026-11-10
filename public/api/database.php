<?php
// public/api/database.php

require_once __DIR__ . '/helpers.php';

const DB_SCHEMA_VERSION = 2;

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
