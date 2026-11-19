<?php
// public/pages/account.php — the account page (password, theme, e-mail address and confirmation, data export/delete). Opened from the desktop menu.
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
        $error = tt('Invalid or expired form token. Reload the page and retry.', 'Token del modulo non valido o scaduto. Ricarica la pagina e riprova.');
        $action = '';
    }

    if ($action === 'update_profile') {
        $bio = trim($_POST['bio'] ?? '');
        
        if (textLength($bio) > 250) {
            $error = tt('Bio cannot exceed 250 characters.', 'La bio non può superare i 250 caratteri.');
        } else {
            $upd = $db->prepare("UPDATE accounts SET bio = :b WHERE id = :id");
            $upd->execute([':b' => $bio, ':id' => $account['id']]);
            $account['bio'] = $bio;
            $msg = tt('Profile bio updated successfully.', 'Bio aggiornata.');
        }
    } elseif ($action === 'change_password') {
        $oldPass = $_POST['old_password'] ?? '';
        $newPass = $_POST['new_password'] ?? '';

        if (!empty($oldPass) && !empty($newPass)) {
            if ($pwErr = validateNewPassword($newPass)) {
                $error = trMsg($pwErr);
            } elseif ($account && password_verify($oldPass, $account['password_hash'])) {
                $newHash = password_hash($newPass, PASSWORD_DEFAULT);
                $upd = $db->prepare("UPDATE accounts SET password_hash = :p WHERE id = :id");
                $upd->execute([':p' => $newHash, ':id' => $account['id']]);
                // a changed password signs out every OTHER device (this one stays)
                $db->prepare('DELETE FROM account_sessions WHERE user_id = :u AND sid_hash != :h')->execute([':u' => $account['id'], ':h' => hash('sha256', session_id())]);
                $msg = tt('Password updated successfully.', 'Password aggiornata.');
            } else {
                $error = tt('Incorrect current password.', 'La password attuale non è corretta.');
            }
        } else {
            $error = tt('Please fill in both password fields.', 'Compila entrambi i campi password.');
        }
    } elseif ($action === 'change_username') {
        $new = trim((string)($_POST['new_username'] ?? ''));
        if ($new === '' || !password_verify((string)($_POST['password'] ?? ''), (string)$account['password_hash'])) {
            $error = tt('Incorrect current password.', 'La password attuale non è corretta.');
        } elseif ($nameErr = validateNewUsername($new)) {
            $error = trMsg($nameErr);
        } elseif (!checkRateLimit('account_rename', 3, 86400, 'user:' . (int)$account['id'])) {
            $error = tt('Too many changes, try again tomorrow.', 'Troppi cambi, riprova domani.');
        } else {
            $st = $db->prepare('SELECT 1 FROM accounts WHERE LOWER(username) = LOWER(:u) AND id != :id');
            $st->execute([':u' => $new, ':id' => $account['id']]);
            $taken = (bool)$st->fetchColumn();
            $st->closeCursor();
            if ($taken) {
                $error = tt('That username is already taken.', 'Questo nome utente è già in uso.');
            } elseif ($new === $account['username']) {
                $error = tt('That is already your username.', 'È già il tuo nome utente.');
            } else {
                $old = $account['username'];
                $db->beginTransaction();
                try {
                    $db->prepare('UPDATE accounts SET username = :n WHERE id = :id')->execute([':n' => $new, ':id' => $account['id']]);
                    // the name is also copied into rows of other tables: follow it, so chat, guestbook, poker and uploads stay with their author
                    foreach (['transmissions' => 'username', 'guestbook' => 'username', 'poker_players' => 'username', 'poker_stats' => 'username',
                              'poker_tables' => 'creator_username', 'books' => 'uploaded_by'] as $table => $col) {
                        $db->prepare("UPDATE $table SET $col = :n WHERE $col = :o")->execute([':n' => $new, ':o' => $old]);
                    }
                    // other devices still carry the old name in their session: sign them out (this one stays)
                    $db->prepare('DELETE FROM account_sessions WHERE user_id = :u AND sid_hash != :h')->execute([':u' => $account['id'], ':h' => hash('sha256', session_id())]);
                    $db->commit();
                } catch (Throwable $e) {
                    if ($db->inTransaction()) $db->rollBack();
                    failInternal('ACCOUNT_RENAME', $e);
                }
                $_SESSION['username'] = $new;
                $account['username'] = $username = $new;
                $msg = tt('Username changed.', 'Nome utente cambiato.');
            }
        }
    } elseif ($action === 'save_theme') {
        $selectedTheme = (string)($_POST['theme'] ?? DEFAULT_SYSTEM_THEME);
        if (!isset(SYSTEM_THEMES[$selectedTheme])) $selectedTheme = DEFAULT_SYSTEM_THEME;
        $upd = $db->prepare("UPDATE accounts SET theme = :t WHERE id = :id");
        $upd->execute([':t' => $selectedTheme, ':id' => $account['id']]);
        $_SESSION['theme'] = $selectedTheme;
        $msg = tt('Default theme updated.', 'Tema predefinito aggiornato.');
    } elseif ($action === 'save_email') {
        // The address is optional. A new or re-sent address must be confirmed by a link; news only go to confirmed addresses
        // that also said yes (two separate things: the address, and the consent to news).
        $email = mailLine((string)($_POST['email'] ?? ''), 254);
        $optin = !empty($_POST['email_optin']) ? 1 : 0;
        if ($email === '') {
            $db->prepare("UPDATE accounts SET email = '', email_verified = 0, email_optin = 0, email_optin_at = NULL WHERE id = :id")->execute([':id' => $account['id']]);
            $account['email'] = ''; $account['email_verified'] = 0; $account['email_optin'] = 0;
            $msg = tt('E-mail address removed.', 'Indirizzo e-mail rimosso.');
        } elseif (!mailValidAddress($email)) {
            $error = tt('That e-mail address does not look right.', 'Questo indirizzo e-mail non sembra corretto.');
        } elseif (!checkRateLimit('account_email', 5, 3600, 'user:' . (int)$account['id'])) {
            $error = tt('Too many changes, try again later.', 'Troppe modifiche, riprova più tardi.');
        } else {
            $changed = strcasecmp($email, (string)($account['email'] ?? '')) !== 0;
            $at = $optin ? ((int)($account['email_optin'] ?? 0) && !$changed ? ($account['email_optin_at'] ?: time()) : time()) : null;
            $db->prepare('UPDATE accounts SET email = :e, email_verified = :v, email_optin = :o, email_optin_at = :t WHERE id = :id')
               ->execute([':e' => $email, ':v' => $changed ? 0 : (int)$account['email_verified'], ':o' => $optin, ':t' => $at, ':id' => $account['id']]);
            $account['email'] = $email; $account['email_optin'] = $optin;
            $db->prepare('UPDATE accounts SET lang = :l WHERE id = :id')->execute([':l' => pageLang(), ':id' => $account['id']]);   // the mails follow the language the person is reading now
            $account['lang'] = pageLang();
            if ($changed) $account['email_verified'] = 0;
            if (!(int)$account['email_verified']) {
                if (mailEnabled()) {
                    [$subject, $text] = mailVerifyMessage($db, $account, $email, pageLang());   // the person's own language
                    $verifyRow = mailEnqueue($db, null, (int)$account['id'], $email, $subject, $text, 'verify');
                    mailProcessQueue($db, 1, [$verifyRow]);   // only this confirmation, not whatever else waits
                    $msg = tt('Saved. We sent you a message: click the link in it to confirm the address.', 'Salvato. Ti abbiamo mandato un messaggio: clicca il link per confermare l\'indirizzo.');
                } else {
                    $msg = tt('Saved. E-mail is not switched on yet: when it is, save the address again to get the confirmation link.', 'Salvato. L\'e-mail non è ancora attiva: quando lo sarà, salva di nuovo l\'indirizzo per ricevere il link di conferma.');
                }
            } else {
                $msg = tt('Saved.', 'Salvato.');
            }
        }
    }
}
session_write_close();
?>
<!DOCTYPE html>
<html lang="<?= pageLang() ?>">
<head>
    <?php renderHead(tt('SYSTEM // ACCOUNT_MANAGEMENT', 'SISTEMA // GESTIONE_ACCOUNT'), true); ?>
    <script src="../js/account_data.js?v=<?php echo APP_VERSION; ?>" defer></script>
    <script src="../js/sessions.js?v=<?= filemtime(__DIR__ . '/../js/sessions.js') ?>" defer></script>
    <?php if (!empty($account['is_admin'])): ?><script src="../js/vendor/qrcode.js?v=1.4.4" defer></script><script src="../js/totp.js?v=<?= filemtime(__DIR__ . '/../js/totp.js') ?>" defer></script><?php endif; ?>
</head>
<body>
    <canvas id="canvas"></canvas>

    <header class="cyber-header">
        <div class="glitch">// VECTOR-BOX // ACCOUNT_PANEL</div>
        <a href="../index.php" class="nav-btn"><_ <?= tt('BACK_TO_HOME', 'TORNA_ALLA_HOME') ?></a>
    </header>

    <main class="page-container-centered">
        <div class="cyber-panel hack-container" style="max-width: 480px; text-align: left;">
            <h2 class="hack-title" style="text-align: center;">>_ <?= tt('ACCOUNT_SETTINGS', 'IMPOSTAZIONI_ACCOUNT') ?></h2>

            <?php if ($msg): ?>
                <div style="color: #00ff66; font-weight: bold; margin-bottom: 12px; font-size: 0.85rem;">>> <?php echo htmlspecialchars($msg); ?></div>
            <?php endif; ?>
            <?php if ($error): ?>
                <div style="color: #ff3333; font-weight: bold; margin-bottom: 12px; font-size: 0.85rem;">>> <?php echo htmlspecialchars($error); ?></div>
            <?php endif; ?>

            <div style="border-bottom: 1px dashed var(--border-color); padding-bottom: 10px; margin-bottom: 15px;">
                <p class="term-muted" style="margin: 4px 0;"><?= tt('USER', 'UTENTE') ?>: <span style="color: var(--accent-color); font-weight: bold;"><?php echo htmlspecialchars($username); ?></span></p>
                <p class="term-muted" style="margin: 4px 0;"><?= tt('ROLE', 'RUOLO') ?>: <span style="color: #ffaa00;"><?php echo !empty($account['is_admin']) ? tt('ADMINISTRATOR', 'AMMINISTRATORE') : tt('STANDARD USER', 'UTENTE NORMALE'); ?></span></p>
                <?php if (accountIsSupporter($db, (int)$_SESSION['user_id'])): ?>
                <p class="term-muted" style="margin: 4px 0;"><?= tt('BADGE', 'DISTINTIVO') ?>: <span style="color: #f2c66d; font-weight: bold;">&#9829; <?= tt('SUPPORTER', 'SOSTENITORE') ?></span> <small>(<?= tt('thank you', 'grazie') ?>)</small></p>
                <?php endif; ?>
            </div>

            <!-- Profile Bio Form -->
            <form method="POST" action="account.php" style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px;">
                <input type="hidden" name="csrf_token" value="<?php echo htmlspecialchars($csrfToken); ?>">
                <span class="settings-title">>_ <?= tt('PUBLIC USER BIO (MAX 250 CHARS)', 'BIO PUBBLICA (MAX 250 CARATTERI)') ?></span>
                <textarea name="bio" aria-label="<?= tt('Public user bio', 'Bio pubblica') ?>" class="tools-textarea" maxlength="250" placeholder="<?= tt('Enter custom biography...', 'Scrivi la tua bio...') ?>" style="height: 70px; resize: none;"><?php echo htmlspecialchars($account['bio'] ?? ''); ?></textarea>
                <button type="submit" name="action" value="update_profile" class="nav-btn">>_ <?= tt('SAVE BIO', 'SALVA BIO') ?></button>
            </form>

            <!-- Password Change Form -->
            <form method="POST" action="account.php" style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; border-top: 1px dashed var(--border-color); padding-top: 15px;">
                <input type="hidden" name="csrf_token" value="<?php echo htmlspecialchars($csrfToken); ?>">
                <span class="settings-title">>_ <?= tt('CHANGE PASSWORD', 'CAMBIA PASSWORD') ?></span>
                <input type="password" name="old_password" placeholder="<?= tt('Current Password', 'Password attuale') ?>" aria-label="<?= tt('Current password', 'Password attuale') ?>" autocomplete="current-password" class="terminal-input" style="background: rgba(0,0,0,0.8); border: 1px solid var(--border-color); padding: 8px; color: #fff;" required>
                <input type="password" name="new_password" placeholder="<?= tt('New Password', 'Nuova password') ?>" aria-label="<?= tt('New password', 'Nuova password') ?>" autocomplete="new-password" class="terminal-input" style="background: rgba(0,0,0,0.8); border: 1px solid var(--border-color); padding: 8px; color: #fff;" required>
                <button type="submit" name="action" value="change_password" class="nav-btn">>_ <?= tt('UPDATE PASSWORD', 'AGGIORNA PASSWORD') ?></button>
            </form>

            <!-- Username Change Form -->
            <form method="POST" action="account.php" style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; border-top: 1px dashed var(--border-color); padding-top: 15px;">
                <input type="hidden" name="csrf_token" value="<?php echo htmlspecialchars($csrfToken); ?>">
                <span class="settings-title">>_ <?= tt('CHANGE USERNAME', 'CAMBIA NOME UTENTE') ?></span>
                <input type="text" name="new_username" placeholder="<?= tt('New username', 'Nuovo nome utente') ?>" aria-label="<?= tt('New username', 'Nuovo nome utente') ?>" autocomplete="off" maxlength="32" class="terminal-input" style="background: rgba(0,0,0,0.8); border: 1px solid var(--border-color); padding: 8px; color: #fff;" required>
                <input type="password" name="password" placeholder="<?= tt('Current Password', 'Password attuale') ?>" aria-label="<?= tt('Current password', 'Password attuale') ?>" autocomplete="current-password" class="terminal-input" style="background: rgba(0,0,0,0.8); border: 1px solid var(--border-color); padding: 8px; color: #fff;" required>
                <button type="submit" name="action" value="change_username" class="nav-btn">>_ <?= tt('CHANGE USERNAME', 'CAMBIA NOME UTENTE') ?></button>
            </form>

            <!-- Theme Preference Form -->
            <form method="POST" action="account.php" style="display: flex; flex-direction: column; gap: 8px; border-top: 1px dashed var(--border-color); padding-top: 15px;">
                <input type="hidden" name="csrf_token" value="<?php echo htmlspecialchars($csrfToken); ?>">
                <span class="settings-title">>_ <?= tt('DEFAULT SYSTEM THEME', 'TEMA PREDEFINITO') ?></span>
                <select name="theme" id="rice-selector" class="nav-btn" style="width: 100%; text-align: left; padding: 6px; background: #020304;"><?php echo systemThemeOptions($account['theme'] ?? null); ?></select>
                <button type="submit" name="action" value="save_theme" class="nav-btn">>_ <?= tt('SAVE THEME PREFERENCE', 'SALVA IL TEMA') ?></button>
            </form>

            <!-- Language: the switch reloads the page and remembers the choice on the account (e-mails and notifications follow it) -->
            <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 20px; border-top: 1px dashed var(--border-color); padding-top: 15px;">
                <span class="settings-title">>_ <?= tt('LANGUAGE', 'LINGUA') ?></span>
                <div id="vb-lang" role="group" aria-label="<?= tt('Language', 'Lingua') ?>"></div>
            </div>

            <!-- E-mail (optional) -->
            <form method="POST" action="account.php" style="display: flex; flex-direction: column; gap: 8px; margin-top: 20px; border-top: 1px dashed var(--border-color); padding-top: 15px;">
                <input type="hidden" name="csrf_token" value="<?php echo htmlspecialchars($csrfToken); ?>">
                <span class="settings-title">>_ <?= tt('E-MAIL (OPTIONAL)', 'E-MAIL (FACOLTATIVA)') ?></span>
                <input type="email" name="email" value="<?php echo htmlspecialchars((string)($account['email'] ?? '')); ?>" placeholder="you@example.com" aria-label="<?= tt('E-mail address', 'Indirizzo e-mail') ?>" autocomplete="email" maxlength="254" class="terminal-input" style="background: rgba(0,0,0,0.8); border: 1px solid var(--border-color); padding: 8px; color: #fff;">
                <?php if (!empty($account['email'])): ?>
                <p class="term-muted" style="margin: 0; font-size: 0.8rem;"><?php echo !empty($account['email_verified']) ? tt('Address confirmed.', 'Indirizzo confermato.') : tt('Address not confirmed yet (check your inbox; saving again sends the link again).', 'Indirizzo non ancora confermato (controlla la posta; se salvi di nuovo ti mandiamo di nuovo il link).'); ?></p>
                <?php endif; ?>
                <label class="term-muted" style="font-size: 0.8rem;"><input type="checkbox" name="email_optin" value="1" <?php echo !empty($account['email_optin']) ? 'checked' : ''; ?>> <?= tt('Send me news about vector-box (rare; one click to stop). Leave it unticked and you get only messages about your account.', 'Mandami le novità di vector-box (rare; basta un clic per smettere). Se lo lasci senza spunta ricevi solo i messaggi sul tuo account.') ?></label>
                <button type="submit" name="action" value="save_email" class="nav-btn">>_ <?= tt('SAVE E-MAIL', 'SALVA E-MAIL') ?></button>
            </form>

            <!-- Your data (GDPR): download everything, or delete the account -->
            <div id="your-data" style="display: flex; flex-direction: column; gap: 8px; margin-top: 20px; border-top: 1px dashed var(--border-color); padding-top: 15px;">
                <span class="settings-title">>_ <?= tt('YOUR DATA', 'I TUOI DATI') ?></span>
                <p class="term-muted" style="margin: 0; font-size: 0.8rem;"><?php if (pageLang() === 'it'): ?>Puoi scaricare tutto ciò che vector-box conserva su questo account, oppure eliminare l'account e i suoi dati. I dettagli sono nella <a href="privacy.php" style="color: var(--accent-color);">pagina sulla privacy</a>.<?php else: ?>You can download everything vector-box keeps about this account, or delete the account and its data. See the <a href="privacy.php" style="color: var(--accent-color);">privacy page</a> for the details.<?php endif; ?></p>
                <a href="../api/account_data.php?action=export" class="nav-btn" style="display: block; text-align: center; text-decoration: none;">>_ <?= tt('DOWNLOAD MY DATA (JSON)', 'SCARICA I MIEI DATI (JSON)') ?></a>
                <?php if (empty($account['is_admin'])): ?>
                <form id="delete-account-form" style="display: flex; flex-direction: column; gap: 8px;">
                    <span class="settings-title" style="color: #ff3333;">>_ <?= tt('DELETE MY ACCOUNT', 'ELIMINA IL MIO ACCOUNT') ?></span>
                    <p class="term-muted" style="margin: 0; font-size: 0.8rem;"><?= tt('Deletes your account, chat and private messages, progress, bookmarks and class membership. This cannot be undone. A class manager must hand the class over first.', 'Elimina il tuo account, la chat e i messaggi privati, i progressi, i segnalibri e l\'appartenenza alla classe. Non si può annullare. Chi gestisce una classe deve prima passarla a qualcun altro.') ?></p>
                    <label class="term-muted" style="font-size: 0.8rem;"><input type="checkbox" id="delete-materials" checked> <?= tt('Also delete the class material I uploaded (otherwise it stays in the class, without my name)', 'Elimina anche il materiale di classe che ho caricato (altrimenti resta nella classe, senza il mio nome)') ?></label>
                    <input type="password" id="delete-password" placeholder="<?= tt('Your password, to confirm', 'La tua password, per confermare') ?>" autocomplete="current-password" class="terminal-input" style="background: rgba(0,0,0,0.8); border: 1px solid var(--border-color); padding: 8px; color: #fff;" required>
                    <button type="submit" class="nav-btn" style="border-color: #ff3333; color: #ff3333;">>_ <?= tt('DELETE ACCOUNT FOR GOOD', 'ELIMINA L\'ACCOUNT PER SEMPRE') ?></button>
                    <div id="delete-result" class="term-muted" style="font-size: 0.85rem;" role="status"></div>
                </form>
                <?php endif; ?>
            </div>

            <section id="sessions" style="margin-top: 20px; border-top: 1px dashed var(--border-color); padding-top: 15px;" aria-labelledby="sessions-title">
                <h3 id="sessions-title" style="font-size: 0.9rem;">>_ <?= tt('WHERE YOU ARE SIGNED IN', 'DOVE HAI ESEGUITO L\'ACCESSO') ?></h3>
                <p class="term-muted" id="sessions-state" style="margin: 6px 0;"></p>
                <div id="sessions-body"></div>
            </section>

            <?php if (!empty($account['is_admin'])): ?>
            <section id="totp" style="margin-top: 20px; border-top: 1px dashed var(--border-color); padding-top: 15px;" aria-labelledby="totp-title">
                <h3 id="totp-title" style="font-size: 0.9rem;">>_ <?= tt('TWO-STEP LOGIN', 'ACCESSO IN DUE PASSAGGI') ?></h3>
                <p class="term-muted" id="totp-state" style="margin: 6px 0;"></p>
                <div id="totp-body"></div>
            </section>
            <?php endif; ?>

            <div style="margin-top: 20px; border-top: 1px solid var(--border-color); padding-top: 15px;">
                <?php if (!empty($account['is_admin'])): ?><a href="admin_users.php" class="nav-btn" style="display: block; text-align: center; text-decoration: none; margin-bottom: 8px;">>_ <?= tt('USERS', 'UTENTI') ?></a><a href="mail.php" class="nav-btn" style="display: block; text-align: center; text-decoration: none; margin-bottom: 8px;">>_ <?= tt('MAIL BOX', 'CASELLA E-MAIL') ?></a><?php endif; ?>
                <a href="../api/logout.php" class="nav-btn" style="display: block; text-align: center; border-color: #ff3333; color: #ff3333; text-decoration: none;">>_ <?= tt('LOGOUT SESSION', 'ESCI DALLA SESSIONE') ?></a>
            </div>
        </div>
    </main>
</body>
</html>