<?php
require_once __DIR__ . '/../includes/head.php';
require_once __DIR__ . '/../api/database.php';
require_once __DIR__ . '/../api/mailer.php';
require_once __DIR__ . '/../api/rate_limiter.php';

initSession(true);

if (empty($_SESSION['username']) || empty($_SESSION['user_id'])) {
    session_write_close();
    header("Location: login.php");
    exit();
}

$db = getDbConnection();

if (empty($_SESSION['csrf_token'])) {
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
}
$csrfToken = $_SESSION['csrf_token'];

$username = $_SESSION['username'];
$msg = ''; 
$error = '';

$stmt = $db->prepare("SELECT * FROM accounts WHERE username = :u");
$stmt->execute([':u' => $username]);
$account = $stmt->fetch();
$stmt->closeCursor();   // an open read would make a later write (after the rate limiter's own commit) fail with "database is locked"

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? '';

    if (!hash_equals($csrfToken, (string)($_POST['csrf_token'] ?? ''))) {
        http_response_code(403);
        $error = "Invalid or expired form token. Reload the page and retry.";
        $action = '';
    }

    if ($action === 'update_profile') {
        $bio = trim($_POST['bio'] ?? '');
        
        if (textLength($bio) > 250) {
            $error = "Bio cannot exceed 250 characters.";
        } else {
            $upd = $db->prepare("UPDATE accounts SET bio = :b WHERE id = :id");
            $upd->execute([':b' => $bio, ':id' => $account['id']]);
            $account['bio'] = $bio;
            $msg = "Profile bio updated successfully.";
        }
    } elseif ($action === 'change_password') {
        $oldPass = $_POST['old_password'] ?? '';
        $newPass = $_POST['new_password'] ?? '';

        if (!empty($oldPass) && !empty($newPass)) {
            if ($pwErr = validateNewPassword($newPass)) {
                $error = $pwErr;
            } elseif ($account && password_verify($oldPass, $account['password_hash'])) {
                $newHash = password_hash($newPass, PASSWORD_DEFAULT);
                $upd = $db->prepare("UPDATE accounts SET password_hash = :p WHERE id = :id");
                $upd->execute([':p' => $newHash, ':id' => $account['id']]);
                $msg = "Password updated successfully.";
            } else {
                $error = "Incorrect current password.";
            }
        } else {
            $error = "Please fill in both password fields.";
        }
    } elseif ($action === 'save_theme') {
        $selectedTheme = (string)($_POST['theme'] ?? DEFAULT_SYSTEM_THEME);
        if (!isset(SYSTEM_THEMES[$selectedTheme])) $selectedTheme = DEFAULT_SYSTEM_THEME;
        $upd = $db->prepare("UPDATE accounts SET theme = :t WHERE id = :id");
        $upd->execute([':t' => $selectedTheme, ':id' => $account['id']]);
        $_SESSION['theme'] = $selectedTheme;
        $msg = "Default theme updated.";
    } elseif ($action === 'save_email') {
        // The address is optional. A new or re-sent address must be confirmed by a link; news only go to confirmed addresses
        // that also said yes (two separate things: the address, and the consent to news).
        $email = mailLine((string)($_POST['email'] ?? ''), 254);
        $optin = !empty($_POST['email_optin']) ? 1 : 0;
        if ($email === '') {
            $db->prepare("UPDATE accounts SET email = '', email_verified = 0, email_optin = 0, email_optin_at = NULL WHERE id = :id")->execute([':id' => $account['id']]);
            $account['email'] = ''; $account['email_verified'] = 0; $account['email_optin'] = 0;
            $msg = 'E-mail address removed.';
        } elseif (!mailValidAddress($email)) {
            $error = 'That e-mail address does not look right.';
        } elseif (!checkRateLimit('account_email', 5, 3600, 'user:' . (int)$account['id'])) {
            $error = 'Too many changes, try again later.';
        } else {
            $changed = strcasecmp($email, (string)($account['email'] ?? '')) !== 0;
            $at = $optin ? ((int)($account['email_optin'] ?? 0) && !$changed ? ($account['email_optin_at'] ?: time()) : time()) : null;
            $db->prepare('UPDATE accounts SET email = :e, email_verified = :v, email_optin = :o, email_optin_at = :t WHERE id = :id')
               ->execute([':e' => $email, ':v' => $changed ? 0 : (int)$account['email_verified'], ':o' => $optin, ':t' => $at, ':id' => $account['id']]);
            $account['email'] = $email; $account['email_optin'] = $optin;
            if ($changed) $account['email_verified'] = 0;
            if (!(int)$account['email_verified']) {
                if (mailEnabled()) {
                    mailEnqueue($db, null, (int)$account['id'], $email, 'Confirm your e-mail address',
                        "Hello,\n\nsomeone (hopefully you) added this address to the account \"{$account['username']}\" on vector-box.\nConfirm it here: "
                        . siteUrl() . '/api/mail_link.php?a=verify&t=' . mailToken($db, 'verify', (int)$account['id'])
                        . "\n\nIf it was not you, ignore this message: nothing happens without the click.\n", 'verify');
                    mailProcessQueue($db, 3);
                    $msg = 'Saved. We sent you a message: click the link in it to confirm the address.';
                } else {
                    $msg = 'Saved. E-mail is not switched on yet: the address will be confirmed when it is.';
                }
            } else {
                $msg = 'Saved.';
            }
        }
    }
}
session_write_close();
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <?php renderHead("SYSTEM // ACCOUNT_MANAGEMENT", true); ?>
    <script src="../js/account_data.js?v=<?php echo APP_VERSION; ?>" defer></script>
</head>
<body>
    <canvas id="canvas"></canvas>

    <header class="cyber-header">
        <div class="glitch">// VECTOR-BOX // ACCOUNT_PANEL</div>
        <a href="../index.php" class="nav-btn"><_ BACK_TO_DESKTOP</a>
    </header>

    <main class="page-container-centered">
        <div class="cyber-panel hack-container" style="max-width: 480px; text-align: left;">
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
                <?php if (accountIsSupporter($db, (int)$_SESSION['user_id'])): ?>
                <p class="term-muted" style="margin: 4px 0;">BADGE: <span style="color: #f2c66d; font-weight: bold;">&#9829; SUPPORTER</span> <small>(thank you)</small></p>
                <?php endif; ?>
            </div>

            <!-- Profile Bio Form -->
            <form method="POST" action="account.php" style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px;">
                <input type="hidden" name="csrf_token" value="<?php echo htmlspecialchars($csrfToken); ?>">
                <span class="settings-title">>_ PUBLIC USER BIO (MAX 250 CHARS)</span>
                <textarea name="bio" aria-label="Public user bio" class="tools-textarea" maxlength="250" placeholder="Enter custom biography..." style="height: 70px; resize: none;"><?php echo htmlspecialchars($account['bio'] ?? ''); ?></textarea>
                <button type="submit" name="action" value="update_profile" class="nav-btn">>_ SAVE BIO</button>
            </form>

            <!-- Password Change Form -->
            <form method="POST" action="account.php" style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; border-top: 1px dashed var(--border-color); padding-top: 15px;">
                <input type="hidden" name="csrf_token" value="<?php echo htmlspecialchars($csrfToken); ?>">
                <span class="settings-title">>_ CHANGE PASSWORD</span>
                <input type="password" name="old_password" placeholder="Current Password" aria-label="Current password" autocomplete="current-password" class="terminal-input" style="background: rgba(0,0,0,0.8); border: 1px solid var(--border-color); padding: 8px; color: #fff;" required>
                <input type="password" name="new_password" placeholder="New Password" aria-label="New password" autocomplete="new-password" class="terminal-input" style="background: rgba(0,0,0,0.8); border: 1px solid var(--border-color); padding: 8px; color: #fff;" required>
                <button type="submit" name="action" value="change_password" class="nav-btn">>_ UPDATE PASSWORD</button>
            </form>

            <!-- Theme Preference Form -->
            <form method="POST" action="account.php" style="display: flex; flex-direction: column; gap: 8px; border-top: 1px dashed var(--border-color); padding-top: 15px;">
                <input type="hidden" name="csrf_token" value="<?php echo htmlspecialchars($csrfToken); ?>">
                <span class="settings-title">>_ DEFAULT SYSTEM THEME</span>
                <select name="theme" id="rice-selector" class="nav-btn" style="width: 100%; text-align: left; padding: 6px; background: #020304;"><?php echo systemThemeOptions($account['theme'] ?? null); ?></select>
                <button type="submit" name="action" value="save_theme" class="nav-btn">>_ SAVE THEME PREFERENCE</button>
            </form>

            <!-- E-mail (optional) -->
            <form method="POST" action="account.php" style="display: flex; flex-direction: column; gap: 8px; margin-top: 20px; border-top: 1px dashed var(--border-color); padding-top: 15px;">
                <input type="hidden" name="csrf_token" value="<?php echo htmlspecialchars($csrfToken); ?>">
                <span class="settings-title">>_ E-MAIL (OPTIONAL)</span>
                <input type="email" name="email" value="<?php echo htmlspecialchars((string)($account['email'] ?? '')); ?>" placeholder="you@example.com" aria-label="E-mail address" autocomplete="email" maxlength="254" class="terminal-input" style="background: rgba(0,0,0,0.8); border: 1px solid var(--border-color); padding: 8px; color: #fff;">
                <?php if (!empty($account['email'])): ?>
                <p class="term-muted" style="margin: 0; font-size: 0.8rem;"><?php echo !empty($account['email_verified']) ? 'Address confirmed.' : 'Address not confirmed yet (check your inbox; saving again sends the link again).'; ?></p>
                <?php endif; ?>
                <label class="term-muted" style="font-size: 0.8rem;"><input type="checkbox" name="email_optin" value="1" <?php echo !empty($account['email_optin']) ? 'checked' : ''; ?>> Send me news about vector-box (rare; one click to stop). Leave it unticked and you get only messages about your account.</label>
                <button type="submit" name="action" value="save_email" class="nav-btn">>_ SAVE E-MAIL</button>
            </form>

            <!-- Your data (GDPR): download everything, or delete the account -->
            <div id="your-data" style="display: flex; flex-direction: column; gap: 8px; margin-top: 20px; border-top: 1px dashed var(--border-color); padding-top: 15px;">
                <span class="settings-title">>_ YOUR DATA</span>
                <p class="term-muted" style="margin: 0; font-size: 0.8rem;">You can download everything vector-box keeps about this account, or delete the account and its data. See the <a href="privacy.php" style="color: var(--accent-color);">privacy page</a> for the details.</p>
                <a href="../api/account_data.php?action=export" class="nav-btn" style="display: block; text-align: center; text-decoration: none;">>_ DOWNLOAD MY DATA (JSON)</a>
                <?php if (empty($account['is_admin'])): ?>
                <form id="delete-account-form" style="display: flex; flex-direction: column; gap: 8px;">
                    <span class="settings-title" style="color: #ff3333;">>_ DELETE MY ACCOUNT</span>
                    <p class="term-muted" style="margin: 0; font-size: 0.8rem;">Deletes your account, chat and private messages, progress, bookmarks and class membership. This cannot be undone. A class manager must hand the class over first.</p>
                    <label class="term-muted" style="font-size: 0.8rem;"><input type="checkbox" id="delete-materials" checked> Also delete the class material I uploaded (otherwise it stays in the class, without my name)</label>
                    <input type="password" id="delete-password" placeholder="Your password, to confirm" autocomplete="current-password" class="terminal-input" style="background: rgba(0,0,0,0.8); border: 1px solid var(--border-color); padding: 8px; color: #fff;" required>
                    <button type="submit" class="nav-btn" style="border-color: #ff3333; color: #ff3333;">>_ DELETE ACCOUNT FOR GOOD</button>
                    <div id="delete-result" class="term-muted" style="font-size: 0.85rem;" role="status"></div>
                </form>
                <?php endif; ?>
            </div>

            <div style="margin-top: 20px; border-top: 1px solid var(--border-color); padding-top: 15px;">
                <?php if (!empty($account['is_admin'])): ?><a href="mail.php" class="nav-btn" style="display: block; text-align: center; text-decoration: none; margin-bottom: 8px;">>_ MAIL BOX</a><?php endif; ?>
                <a href="../api/logout.php" class="nav-btn" style="display: block; text-align: center; border-color: #ff3333; color: #ff3333; text-decoration: none;">>_ LOGOUT SESSION</a>
            </div>
        </div>
    </main>
</body>
</html>