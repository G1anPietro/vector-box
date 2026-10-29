<?php
// public/api/database.php

function initSession() {
    $projectRoot = dirname(__DIR__, 2);
    $sessionDir =$projectRoot . '/data/sessions';

    if (!file_exists($sessionDir)) {
        @mkdir($sessionDir, 0777, true);
    }

    if (session_status() === PHP_SESSION_NONE) {
        session_save_path($sessionDir);
        session_set_cookie_params([
            'lifetime' => 86400 * 7,
            'path' => '/',
            'httponly' => true,
            'samesite' => 'Lax'
        ]);
        session_start();
    }

    // Ensure guest sessions get a unique session-bound handle
    if (!isset($_SESSION['username'])) {$suffix = substr(md5(session_id()), 0, 4);
        $_SESSION['username'] = 'guest_' .$suffix;
    }

    // Release session lock to prevent blocking during background polling
    session_write_close();
}

function getDbConnection() {
    $projectRoot = dirname(__DIR__, 2);
    $dataDir =$projectRoot . '/data';
    
    if (!file_exists($dataDir)) {
        @mkdir($dataDir, 0777, true);
    }

    $dbPath =$dataDir . '/vector_uplink.sqlite';

    $db = new PDO('sqlite:' .$dbPath);
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);$db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

    // Optimized SQLite performance pragmas for concurrent access
    $db->exec("PRAGMA busy_timeout = 5000;");
    $db->exec("PRAGMA journal_mode = WAL;");
    $db->exec("PRAGMA synchronous = NORMAL;");

    // Accounts table
    $db->exec("CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        theme VARCHAR(30) DEFAULT 'cyan',
        is_admin INTEGER DEFAULT 0,
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
    $roomCount =$db->query("SELECT COUNT(*) FROM rooms")->fetchColumn();
    if ((int)$roomCount === 0) {
        $stmt =$db->prepare("INSERT INTO rooms (id, name, is_private) VALUES (:id, :name, :is_priv)");
        $defaultRooms = [
            ['id' => 'general', 'name' => 'General', 'is_priv' => 0],
            ['id' => 'dev', 'name' => 'Dev Ops', 'is_priv' => 0],
            ['id' => 'lounge', 'name' => 'Cyber Lounge', 'is_priv' => 0],
            ['id' => 'admin', 'name' => 'Root Sanctuary', 'is_priv' => 1]
        ];
        foreach ($defaultRooms as$r) {
            $stmt->execute([':id' =>$r['id'], ':name' => $r['name'], ':is_priv' =>$r['is_priv']]);
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

    // Safely inject metadata columns if table existed
    $pokerCols =$db->query("PRAGMA table_info(poker_tables)")->fetchAll(PDO::FETCH_COLUMN, 1);
    if (!in_array('room_code', $pokerCols)) {$db->exec("ALTER TABLE poker_tables ADD COLUMN room_code VARCHAR(50) NULL");
    }
    if (!in_array('creator_username', $pokerCols)) {$db->exec("ALTER TABLE poker_tables ADD COLUMN creator_username VARCHAR(50) DEFAULT 'system'");
    }
    if (!in_array('max_players', $pokerCols)) {$db->exec("ALTER TABLE poker_tables ADD COLUMN max_players INTEGER DEFAULT 4");
    }
    if (!in_array('bot_count', $pokerCols)) {$db->exec("ALTER TABLE poker_tables ADD COLUMN bot_count INTEGER DEFAULT 1");
    }

    // Safely inject columns if legacy schema exists
    $cols =$db->query("PRAGMA table_info(transmissions)")->fetchAll(PDO::FETCH_COLUMN, 1);
    if (!in_array('room_id', $cols)) {$db->exec("ALTER TABLE transmissions ADD COLUMN room_id VARCHAR(50) DEFAULT 'general'");
    }
    if (!in_array('username', $cols)) {$db->exec("ALTER TABLE transmissions ADD COLUMN username VARCHAR(50) DEFAULT 'guest'");
    }
    if (!in_array('user_id', $cols)) {$db->exec("ALTER TABLE transmissions ADD COLUMN user_id INTEGER NULL");
    }
    if (!in_array('is_deleted', $cols)) {$db->exec("ALTER TABLE transmissions ADD COLUMN is_deleted INTEGER DEFAULT 0");
    }

    $accCols =$db->query("PRAGMA table_info(accounts)")->fetchAll(PDO::FETCH_COLUMN, 1);
    if (!in_array('is_admin', $accCols)) {$db->exec("ALTER TABLE accounts ADD COLUMN is_admin INTEGER DEFAULT 0");
    }
    if (!in_array('is_banned', $accCols)) {$db->exec("ALTER TABLE accounts ADD COLUMN is_banned INTEGER DEFAULT 0");
    }
    if (!in_array('banned_until', $accCols)) {$db->exec("ALTER TABLE accounts ADD COLUMN banned_until DATETIME NULL");
    }

    return $db;
}