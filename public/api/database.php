<?php
// public/api/database.php

function initSession() {
    $projectRoot = dirname(__DIR__, 2);
    $sessionDir = $projectRoot . '/data/sessions';

    if (!file_exists($sessionDir)) {
        @mkdir($sessionDir, 0777, true);
    }

    if (session_status() === PHP_SESSION_NONE) {
        session_save_path($sessionDir); // Overrides empty system save path
        session_set_cookie_params([
            'lifetime' => 86400 * 7,
            'path' => '/',
            'httponly' => true,
            'samesite' => 'Lax'
        ]);
        session_start();
    }
}

function getDbConnection() {
    $projectRoot = dirname(__DIR__, 2);
    $dataDir = $projectRoot . '/data';
    
    if (!file_exists($dataDir)) {
        @mkdir($dataDir, 0777, true);
    }

    $dbPath = $dataDir . '/vector_uplink.sqlite';

    $db = new PDO('sqlite:' . $dbPath);
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

    $db->exec("PRAGMA journal_mode = WAL;");

    // Accounts
    $db->exec("CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        theme VARCHAR(30) DEFAULT 'cyan',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )");

    // Base Transmissions Table
    $db->exec("CREATE TABLE IF NOT EXISTS transmissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message TEXT NOT NULL,
        sender_ip VARCHAR(45) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )");

    // Safely add missing columns to existing DB
    $cols = $db->query("PRAGMA table_info(transmissions)")->fetchAll(PDO::FETCH_COLUMN, 1);
    
    if (!in_array('username', $cols)) {
        $db->exec("ALTER TABLE transmissions ADD COLUMN username VARCHAR(50) DEFAULT 'guest'");
    }
    if (!in_array('user_id', $cols)) {
        $db->exec("ALTER TABLE transmissions ADD COLUMN user_id INTEGER NULL");
    }
    if (!in_array('is_deleted', $cols)) {
        $db->exec("ALTER TABLE transmissions ADD COLUMN is_deleted INTEGER DEFAULT 0");
    }

    return $db;
}