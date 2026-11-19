<?php
// includes/home-access.php — who may see the private entries (book reader, statistics, dossier) on the home menu and in the desktop menu.
// This only decides what is SHOWN: the pages themselves (reader.php, stats.php, resume.php) check the permission again on every request.
require_once __DIR__ . '/../api/database.php';

/** @return array{admin: bool, books: bool, resume: bool} for the current session (call after initSession()). */
function homeAccess(): array {
    $admin = !empty($_SESSION['is_admin']);
    $books = $admin;
    $resume = $admin;   // the CV is private too: admin, or accounts allowed with /grantcv
    $userId = $_SESSION['user_id'] ?? null;
    if ($userId && !$admin) {
        try {
            $stmt = getDbConnection()->prepare('SELECT can_read_books, can_view_resume FROM accounts WHERE id = :id');
            $stmt->execute([':id' => $userId]);
            $acc = $stmt->fetch();
            if ($acc) {
                $books = (int)$acc['can_read_books'] === 1;
                $resume = (int)($acc['can_view_resume'] ?? 0) === 1;
            }
        } catch (Exception $e) {
            $books = false;
        }
    }
    return ['admin' => $admin, 'books' => $books, 'resume' => $resume];
}
