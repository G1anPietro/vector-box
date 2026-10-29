<?php
require_once __DIR__ . '/../includes/head.php';
require_once __DIR__ . '/../api/database.php';

initSession();

// Redirect to desktop if already authenticated
if (!empty($_SESSION['username']) && !str_starts_with($_SESSION['username'], 'guest_')) {
    header("Location: ../index.php");
    exit();
}

$errorMessage = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = trim($_POST['username'] ?? '');
    $password = trim($_POST['password'] ?? '');
    $action = $_POST['action'] ?? 'login';

    if (!empty($username) && !empty($password)) {
        try {
            $db = getDbConnection();

            if ($action === 'register') {
                $checkStmt = $db->prepare("SELECT COUNT(*) FROM accounts WHERE username = :u");
                $checkStmt->execute([':u' => $username]);

                if ($checkStmt->fetchColumn() > 0) {
                    $errorMessage = "Username is already taken.";
                } else {
                    $hash = password_hash($password, PASSWORD_BCRYPT);
                    $stmt = $db->prepare("INSERT INTO accounts (username, password_hash, theme, is_admin) VALUES (:u, :p, 'cyan', 0)");
                    $stmt->execute([':u' => $username, ':p' => $hash]);

                    if (session_status() === PHP_SESSION_NONE) {
                        session_start();
                    }
                    $_SESSION['user_id'] = (int)$db->lastInsertId();
                    $_SESSION['username'] = $username;
                    $_SESSION['theme'] = 'cyan';
                    $_SESSION['is_admin'] = 0;
                    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));

                    header("Location: account.php");
                    exit();
                }
            } else {
                $stmt = $db->prepare("SELECT * FROM accounts WHERE username = :u");
                $stmt->execute([':u' => $username]);
                $account = $stmt->fetch(PDO::FETCH_ASSOC);

                if ($account && password_verify($password, $account['password_hash'])) {
                    if (session_status() === PHP_SESSION_NONE) {
                        session_start();
                    }
                    $_SESSION['user_id'] = (int)$account['id'];
                    $_SESSION['username'] = $account['username'];
                    $_SESSION['theme'] = $account['theme'] ?? 'cyan';
                    $_SESSION['is_admin'] = (int)($account['is_admin'] ?? 0);
                    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));

                    header("Location: account.php");
                    exit();
                } else {
                    $errorMessage = "Invalid username or password.";
                }
            }
        } catch (Exception $e) {
            $errorMessage = "Authentication server error: " . htmlspecialchars($e->getMessage());
        }
    } else {
        $errorMessage = "Please complete all fields.";
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <?php renderHead("SYSTEM // AUTHENTICATION", true); ?>
</head>
<body>
    <canvas id="canvas"></canvas>

    <header class="cyber-header">
        <div class="glitch">// VECTOR-BOX // AUTH_GATEWAY</div>
        <a href="../index.php" class="nav-btn"><_ BACK_TO_DESKTOP</a>
    </header>

    <main class="page-container-centered">
        <div class="cyber-panel hack-container" style="max-width: 420px; text-align: left;">
            <h2 class="hack-title" style="text-align: center;">>_ USER_ACCOUNT</h2>
            
            <?php if (!empty($errorMessage)): ?>
                <div style="color: #ff3333; font-weight: bold; margin-bottom: 12px; font-size: 0.85rem;">>> <?php echo $errorMessage; ?></div>
            <?php endif; ?>

            <form method="POST" action="login.php" style="display: flex; flex-direction: column; gap: 12px;">
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <label class="toggle-label" style="font-size: 0.75rem; color: var(--text-muted);">USERNAME:</label>
                    <input type="text" name="username" class="terminal-input" style="background: rgba(0,0,0,0.85); border: 1px solid var(--border-color); color: #ffffff; padding: 8px; outline: none;" required autocomplete="off">
                </div>

                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <label class="toggle-label" style="font-size: 0.75rem; color: var(--text-muted);">PASSWORD:</label>
                    <input type="password" name="password" class="terminal-input" style="background: rgba(0,0,0,0.85); border: 1px solid var(--border-color); color: #ffffff; padding: 8px; outline: none;" required>
                </div>

                <div style="display: flex; gap: 8px; margin-top: 10px;">
                    <button type="submit" name="action" value="login" class="nav-btn" style="flex: 1; padding: 8px;">>_ LOGIN</button>
                    <button type="submit" name="action" value="register" class="nav-btn" style="flex: 1; border-color: var(--text-muted); color: var(--text-muted); padding: 8px;">REGISTER</button>
                </div>
            </form>
        </div>
    </main>
</body>
</html>