<?php
// public/api/database.php

function getDbConnection() {
    // Resolve absolute path to data folder relative to project root
    $projectRoot = dirname(__DIR__, 2);
    $dataDir = $projectRoot . '/data';
    
    if (!file_exists($dataDir)) {
        if (!@mkdir($dataDir, 0777, true)) {
            throw new Exception("Unable to create data directory at: {$dataDir}");
        }
    }

    $dbPath = $dataDir . '/vector_uplink.sqlite';

    try {
        $db = new PDO('sqlite:' . $dbPath);
        $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

        // WAL mode for high concurrency
        $db->exec("PRAGMA journal_mode = WAL;");

        // Schema setup
        $db->exec("CREATE TABLE IF NOT EXISTS transmissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message TEXT NOT NULL,
            sender_ip VARCHAR(45) NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )");

        return $db;
    } catch (PDOException $e) {
        throw new Exception("SQLite Connection Error: " . $e->getMessage() . " [Path: {$dbPath}]");
    }
}