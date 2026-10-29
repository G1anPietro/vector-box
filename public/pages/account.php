<?php
require_once __DIR__ . '/../includes/head.php';
require_once __DIR__ . '/../api/database.php';

initSession();

if (empty($_SESSION['username'])) {
    header("Location: login.php");
    exit();
}

$db = getDbConnection();
$username =$_SESSION['username'];
$msg = '';$error = '';

// Fetch current user details
$stmt =$db->prepare("SELECT * FROM accounts WHERE username = :u");
$stmt->execute([':u' =>$username]);
$account =$stmt->fetch();

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action =$_POST['action'] ?? '';

    if ($action === 'change_password') {
        $oldPass =$_POST['old_password'] ?? '';
        $newPass =$_POST['new_password'] ?? '';

        if (!empty($oldPass) && !empty($newPass)) {
            if ($account && password_verify($oldPass,$account['password_hash'])) {
                $newHash = password_hash($newPass, PASSWORD_BCRYPT);
                $upd =$db->prepare("UPDATE accounts SET password_hash = :p WHERE id = :id");
                $upd->execute([':p' =>$newHash, ':id' => $account['id']]);$msg = "Password updated successfully!";
            } else {
                $error = "Incorrect current password.";
            }
        } else {
            $error = "Please fill in both password fields.";
        }
    } elseif ($action === 'save_theme') {
        $selectedTheme =$_POST['theme'] ?? 'cyan';
        $upd =$db->prepare("UPDATE accounts SET theme = :t WHERE id = :id");
        $upd->execute([':t' => $selectedTheme, ':id' =>$account['id']]);
        $_SESSION['theme'] =$selectedTheme;
        $msg = "Default theme updated!";
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <?php renderHead("SYSTEM // ACCOUNT_MANAGEMENT", true); ?>
</head>
<body>
    <canvas id="canvas"></canvas>

    <header class="cyber-header">
        <div class="glitch">// VECTOR-BOX // ACCOUNT_PANEL</div>
        <a href="../index.php" class="nav-btn"><_ BACK_TO_DESKTOP</a>
    </header>

    <main class="page-container-centered">
        <div class="cyber-panel hack-container" style="max-width: 460px; text-align: left;">
            <h2 class="hack-title" style="text-align: center;">>_ ACCOUNT_SETTINGS</h2>

            <?php if ($msg): ?>
                <div style="color: #00ff66; font-weight: bold; margin-bottom: 12px; font-size: 0.85rem;">>> <?php echo htmlspecialchars($msg); ?></div>
            <?php endif; ?>
            <?php if ($error): ?>
                <div style="color: #ff3333; font-weight: bold; margin-bottom: 12px; font-size: 0.85rem;">>> <?php echo htmlspecialchars($error); ?></div>
            <?php endif; ?>

            <div style="border-bottom: 1px dashed var(--border-color); padding-bottom: 10px; margin-bottom: 15px;">
                <p class="term-muted" style="margin: 4px 0;">USER: <span style="color: var(--accent-color); font-weight: bold;"><?php echo htmlspecialchars($username); ?></span></p>
                <p class="term-muted" style="margin: 4px 0;">ROLE: <span style="color: #ffaa00;"><?php echo !empty($account['is_admin']) ? 'ADMINISTRATOR' : 'STANDARD USER'; ?></span></p>
            </div>

            <!-- Password Change Form -->
            <form method="POST" action="account.php" style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px;">
                <span class="settings-title">>_ CHANGE PASSWORD</span>
                <input type="password" name="old_password" placeholder="Current Password" class="terminal-input" style="background: rgba(0,0,0,0.8); border: 1px solid var(--border-color); padding: 8px; color: #fff;" required>
                <input type="password" name="new_password" placeholder="New Password" class="terminal-input" style="background: rgba(0,0,0,0.8); border: 1px solid var(--border-color); padding: 8px; color: #fff;" required>
                <button type="submit" name="action" value="change_password" class="nav-btn">>_ UPDATE PASSWORD</button>
            </form>

            <!-- Theme Preference Form -->
            <form method="POST" action="account.php" style="display: flex; flex-direction: column; gap: 10px; border-top: 1px dashed var(--border-color); padding-top: 15px;">
                <span class="settings-title">>_ DEFAULT SYSTEM THEME</span>
                <select name="theme" class="nav-btn" style="width: 100%; text-align: left; padding: 6px; background: #020304;">
                    <option value="cyan" <?php if(($account['theme']??'')==='cyan') echo 'selected'; ?>>Cyan (Default)</option>
                    <option value="matrix" <?php if(($account['theme']??'')==='matrix') echo 'selected'; ?>>Matrix</option>
                    <option value="amber" <?php if(($account['theme']??'')==='amber') echo 'selected'; ?>>Amber</option>
                    <option value="cyberpunk" <?php if(($account['theme']??'')==='cyberpunk') echo 'selected'; ?>>Cyberpunk</option>
                    <option value="dracula" <?php if(($account['theme']??'')==='dracula') echo 'selected'; ?>>Dracula</option>
                    <option value="synthwave" <?php if(($account['theme']??'')==='synthwave') echo 'selected'; ?>>Synthwave</option>
                    <option value="nord" <?php if(($account['theme']??'')==='nord') echo 'selected'; ?>>Nord</option>
                    <option value="blood" <?php if(($account['theme']??'')==='blood') echo 'selected'; ?>>Blood</option>
                </select>
                <button type="submit" name="action" value="save_theme" class="nav-btn">>_ SAVE THEME PREFERENCE</button>
            </form>

            <div style="margin-top: 20px; border-top: 1px solid var(--border-color); padding-top: 15px;">
                <a href="../api/logout.php" class="nav-btn" style="display: block; text-align: center; border-color: #ff3333; color: #ff3333; text-decoration: none;">>_ LOGOUT SESSION</a>
            </div>
        </div>
    </main>
</body>
</html>