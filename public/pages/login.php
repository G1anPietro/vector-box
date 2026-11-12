<?php
require_once __DIR__ . '/../includes/head.php';
require_once __DIR__ . '/../api/database.php';

initSession();

// Where to go after logging in: only pages on this list (no open redirects)
$next = (string)($_POST['next'] ?? $_GET['next'] ?? '');
$next = in_array($next, ['appunti.php'], true) ? $next : '';
$afterLogin = $next !== '' ? $next : 'account.php';

// Redirect to desktop if already authenticated
if (!empty($_SESSION['username']) && !str_starts_with($_SESSION['username'], 'guest_')) {
    header('Location: ' . ($next !== '' ? $next : '../index.php'));
    exit();
}

$errorMessage = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../api/rate_limiter.php';

    // Passwords are trimmed to stay compatible with hashes created by earlier versions
    $username = trim((string)($_POST['username'] ?? ''));
    $password = trim((string)($_POST['password'] ?? ''));
    $action = $_POST['action'] ?? 'login';

    if ($username === '' || $password === '') {
        $errorMessage = "Please complete all fields.";
    } elseif (strlen($username) > 64 || strlen($password) > 1024) {
        $errorMessage = "Invalid username or password.";
    } else {
        try {
            $db = getDbConnection();

            if ($action === 'register') {
                if (!checkRateLimit('register', 5, 3600)) {
                    $errorMessage = "Too many registrations from this address. Try again later.";
                } elseif ($err = validateNewUsername($username) ?? validateNewPassword($password)) {
                    $errorMessage = $err;
                } else {
                    try {
                        $stmt = $db->prepare("INSERT INTO accounts (username, password_hash, theme, is_admin) VALUES (:u, :p, 'cyan', 0)");
                        $stmt->execute([':u' => $username, ':p' => password_hash($password, PASSWORD_DEFAULT)]);

                        establishSession(['id' => $db->lastInsertId(), 'username' => $username, 'theme' => 'cyan', 'is_admin' => 0]);
                        header('Location: ' . $afterLogin);
                        exit();
                    } catch (PDOException $e) {
                        if ((string)$e->getCode() !== '23000') throw $e;
                        $errorMessage = "Username is already taken.";
                    }
                }
            } else {
                if (!checkRateLimit('login_ip', 10, 300) || !checkRateLimit('login_user', 5, 300, strtolower($username))) {
                    $errorMessage = "Too many attempts. Try again in a few minutes.";
                } else {
                    $stmt = $db->prepare("SELECT * FROM accounts WHERE username = :u");
                    $stmt->execute([':u' => $username]);
                    $account = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;

                    if (verifyPasswordSafe($account, $password)) {
                        establishSession($account);
                        header('Location: ' . $afterLogin);
                        exit();
                    }
                    $errorMessage = "Invalid username or password.";
                }
            }
        } catch (Throwable $e) {
            require_once __DIR__ . '/../api/debug_logger.php';
            logSystemError('LOGIN_PAGE', $e->getMessage());
            $errorMessage = "Authentication server error.";
        }
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
                <?php if ($next !== ''): ?><input type="hidden" name="next" value="<?php echo htmlspecialchars($next); ?>"><?php endif; ?>
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