<?php
// public/pages/account.php — the account page (profile, password, devices, language, e-mail, data export/delete). Opened from the home menu.
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
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#16141c">
    <meta name="robots" content="noindex">
    <meta name="vb-lang" content="<?= pageLang() ?>">
    <title><?= tt('Account — vector-box', 'Account — vector-box') ?></title>
    <script src="../js/csrf.js?v=<?= APP_VERSION ?>"></script>
    <script src="../js/i18n.js?v=<?= APP_VERSION ?>"></script>
    <script src="../js/i18n-ui.js?v=<?= APP_VERSION ?>"></script>
    <link rel="icon" href="../assets/solitario/icon.svg?v=1" type="image/svg+xml">
    <link rel="stylesheet" href="../css/giochi.css?v=4">
    <link rel="stylesheet" href="../css/account.css?v=<?= filemtime(__DIR__ . '/../css/account.css') ?>">
    <script src="../js/account_data.js?v=<?php echo APP_VERSION; ?>" defer></script>
    <script src="../js/sessions.js?v=<?= filemtime(__DIR__ . '/../js/sessions.js') ?>" defer></script>
    <script src="../js/account-ui.js?v=<?= filemtime(__DIR__ . '/../js/account-ui.js') ?>" defer></script>
    <?php if (!empty($account['is_admin'])): ?><script src="../js/vendor/qrcode.js?v=1.4.4" defer></script><script src="../js/totp.js?v=<?= filemtime(__DIR__ . '/../js/totp.js') ?>" defer></script><?php endif; ?>
</head>
<body class="shelf-page account-page">
    <header class="top">
        <a class="home" href="../index.php">vector-box</a>
        <a class="back" href="../index.php">&larr; <?= tt('Menu', 'Menu') ?></a>
    </header>

    <main class="acc">
        <section class="who card" aria-label="<?= tt('Your account', 'Il tuo account') ?>">
            <span class="avatar" aria-hidden="true"><?= htmlspecialchars(strtoupper(textCut((string)$username, 1))) ?></span>
            <div class="who-text">
                <h1><?= htmlspecialchars($username) ?></h1>
                <p class="chips">
                    <span class="chip"><?= !empty($account['is_admin']) ? tt('Administrator', 'Amministratore') : tt('Standard user', 'Utente normale') ?></span>
                    <?php if (accountIsSupporter($db, (int)$_SESSION['user_id'])): ?><span class="chip gold">&#9829; SUPPORTER</span><?php endif; ?>
                </p>
            </div>
        </section>

        <?php
        // the result of a save is shown inside the card you used; anything else (a bad form token) goes up here
        $formAction = $action ?? '';
        $inCard = in_array($formAction, ['update_profile', 'change_username', 'change_password', 'save_email'], true);
        $notice = function (string $for) use ($msg, $error, $formAction): void {
            if ($formAction !== $for) return;
            if ($msg) echo '<div class="notice ok" role="status">' . htmlspecialchars($msg) . '</div>';
            if ($error) echo '<div class="notice bad" role="alert">' . htmlspecialchars($error) . '</div>';
        };
        if (!$inCard): ?>
            <?php if ($msg): ?><div class="notice ok" role="status"><?= htmlspecialchars($msg) ?></div><?php endif; ?>
            <?php if ($error): ?><div class="notice bad" role="alert"><?= htmlspecialchars($error) ?></div><?php endif; ?>
        <?php endif; ?>

        <nav class="tabs" aria-label="<?= tt('Sections', 'Sezioni') ?>">
            <a href="#profile"><?= tt('Profile', 'Profilo') ?></a>
            <a href="#security"><?= tt('Security', 'Sicurezza') ?></a>
            <a href="#preferences"><?= tt('Preferences', 'Preferenze') ?></a>
            <a href="#data"><?= tt('Your data', 'I tuoi dati') ?></a>
            <?php if (!empty($account['is_admin'])): ?><a href="#admin"><?= tt('Admin', 'Admin') ?></a><?php endif; ?>
        </nav>

        <!-- PROFILE -->
        <section id="profile" class="group" aria-labelledby="h-profile">
            <h2 id="h-profile"><?= tt('Profile', 'Profilo') ?></h2>

            <form method="POST" action="account.php" class="card">
                <input type="hidden" name="csrf_token" value="<?php echo htmlspecialchars($csrfToken); ?>">
                <h3><label for="bio"><?= tt('Public bio', 'Bio pubblica') ?></label></h3>
                <p class="hint"><?= tt('Other people can see it. Up to 250 characters.', 'La vedono gli altri. Fino a 250 caratteri.') ?></p>
                <textarea id="bio" name="bio" class="input" maxlength="250" rows="3" placeholder="<?= tt('Write something about you...', 'Scrivi qualcosa su di te...') ?>"><?php echo htmlspecialchars($account['bio'] ?? ''); ?></textarea>
                <?php $notice('update_profile'); ?>
                <div class="actions"><button type="submit" name="action" value="update_profile" class="btn"><?= tt('Save bio', 'Salva la bio') ?></button></div>
            </form>

            <form method="POST" action="account.php" class="card">
                <input type="hidden" name="csrf_token" value="<?php echo htmlspecialchars($csrfToken); ?>">
                <h3><?= tt('Username', 'Nome utente') ?></h3>
                <p class="hint"><?= tt('Your messages and guestbook entries follow the new name. Your other devices are signed out.', 'I tuoi messaggi e le firme sul muro seguono il nuovo nome. Gli altri tuoi dispositivi vengono scollegati.') ?></p>
                <label class="field" for="new_username"><?= tt('New username', 'Nuovo nome utente') ?></label>
                <input id="new_username" type="text" name="new_username" class="input" autocomplete="off" maxlength="32" required>
                <label class="field" for="rename_password"><?= tt('Current password', 'Password attuale') ?></label>
                <input id="rename_password" type="password" name="password" class="input" autocomplete="current-password" required>
                <?php $notice('change_username'); ?>
                <div class="actions"><button type="submit" name="action" value="change_username" class="btn ghost"><?= tt('Change username', 'Cambia nome utente') ?></button></div>
            </form>
        </section>

        <!-- SECURITY -->
        <section id="security" class="group" aria-labelledby="h-security">
            <h2 id="h-security"><?= tt('Security', 'Sicurezza') ?></h2>

            <form method="POST" action="account.php" class="card">
                <input type="hidden" name="csrf_token" value="<?php echo htmlspecialchars($csrfToken); ?>">
                <h3><?= tt('Password', 'Password') ?></h3>
                <p class="hint"><?= tt('At least 8 characters.', 'Almeno 8 caratteri.') ?></p>
                <input type="text" value="<?= htmlspecialchars($username) ?>" autocomplete="username" hidden aria-hidden="true" tabindex="-1">   <!-- lets password managers file the new password under this username -->
                <label class="field" for="old_password"><?= tt('Current password', 'Password attuale') ?></label>
                <input id="old_password" type="password" name="old_password" class="input" autocomplete="current-password" required>
                <label class="field" for="new_password"><?= tt('New password', 'Nuova password') ?></label>
                <input id="new_password" type="password" name="new_password" class="input" autocomplete="new-password" required>
                <?php $notice('change_password'); ?>
                <div class="actions"><button type="submit" name="action" value="change_password" class="btn"><?= tt('Update password', 'Aggiorna la password') ?></button></div>
            </form>

            <section id="sessions" class="card" aria-labelledby="sessions-title">
                <h3 id="sessions-title"><?= tt('Where you are signed in', 'Dove hai eseguito l\'accesso') ?></h3>
                <p class="hint" id="sessions-state"></p>
                <div id="sessions-body"></div>
            </section>

            <?php if (!empty($account['is_admin'])): ?>
            <section id="totp" class="card" aria-labelledby="totp-title">
                <h3 id="totp-title"><?= tt('Two-step login', 'Accesso in due passaggi') ?></h3>
                <p class="hint" id="totp-state"></p>
                <div id="totp-body"></div>
            </section>
            <?php endif; ?>
        </section>

        <!-- PREFERENCES -->
        <section id="preferences" class="group" aria-labelledby="h-preferences">
            <h2 id="h-preferences"><?= tt('Preferences', 'Preferenze') ?></h2>

            <!-- Language: the switch reloads the page and remembers the choice on the account (e-mails and notifications follow it) -->
            <div class="card">
                <h3><?= tt('Language', 'Lingua') ?></h3>
                <p class="hint"><?= tt('Also used for the e-mails and notifications we send you.', 'La usiamo anche per le e-mail e le notifiche che ti mandiamo.') ?></p>
                <div id="vb-lang" role="group" aria-label="<?= tt('Language', 'Lingua') ?>"></div>
            </div>

            <form method="POST" action="account.php" class="card">
                <input type="hidden" name="csrf_token" value="<?php echo htmlspecialchars($csrfToken); ?>">
                <h3><label for="email"><?= tt('E-mail (optional)', 'E-mail (facoltativa)') ?></label></h3>
                <input id="email" type="email" name="email" value="<?php echo htmlspecialchars((string)($account['email'] ?? '')); ?>" placeholder="you@example.com" autocomplete="email" maxlength="254" class="input">
                <?php if (!empty($account['email'])): ?>
                <p class="status <?= !empty($account['email_verified']) ? 'good' : 'warn' ?>"><?php echo !empty($account['email_verified']) ? tt('Address confirmed.', 'Indirizzo confermato.') : tt('Address not confirmed yet (check your inbox; saving again sends the link again).', 'Indirizzo non ancora confermato (controlla la posta; se salvi di nuovo ti mandiamo di nuovo il link).'); ?></p>
                <?php endif; ?>
                <label class="check"><input type="checkbox" name="email_optin" value="1" <?php echo !empty($account['email_optin']) ? 'checked' : ''; ?>> <span><?= tt('Send me news about vector-box (rare; one click to stop). Leave it unticked and you get only messages about your account.', 'Mandami le novità di vector-box (rare; basta un clic per smettere). Se lo lasci senza spunta ricevi solo i messaggi sul tuo account.') ?></span></label>
                <?php $notice('save_email'); ?>
                <div class="actions"><button type="submit" name="action" value="save_email" class="btn"><?= tt('Save e-mail', 'Salva l\'e-mail') ?></button></div>
            </form>
        </section>

        <!-- YOUR DATA (GDPR): download everything, or delete the account -->
        <section id="data" class="group" aria-labelledby="h-data">
            <h2 id="h-data"><?= tt('Your data', 'I tuoi dati') ?></h2>
            <div class="card" id="your-data">
                <p class="hint"><?php if (pageLang() === 'it'): ?>Puoi scaricare tutto ciò che vector-box conserva su questo account, oppure eliminare l'account e i suoi dati. I dettagli sono nella <a href="privacy.php">pagina sulla privacy</a>.<?php else: ?>You can download everything vector-box keeps about this account, or delete the account and its data. See the <a href="privacy.php">privacy page</a> for the details.<?php endif; ?></p>
                <div class="actions left"><a href="../api/account_data.php?action=export" class="btn ghost"><?= tt('Download my data (JSON)', 'Scarica i miei dati (JSON)') ?></a></div>
            </div>

            <?php if (empty($account['is_admin'])): ?>
            <details class="card danger">
                <summary><?= tt('Delete my account', 'Elimina il mio account') ?></summary>
                <form id="delete-account-form">
                    <p class="hint"><?= tt('Deletes your account, chat and private messages, progress, bookmarks and class membership. This cannot be undone. A class manager must hand the class over first.', 'Elimina il tuo account, la chat e i messaggi privati, i progressi, i segnalibri e l\'appartenenza alla classe. Non si può annullare. Chi gestisce una classe deve prima passarla a qualcun altro.') ?></p>
                    <label class="check"><input type="checkbox" id="delete-materials" checked> <span><?= tt('Also delete the class material I uploaded (otherwise it stays in the class, without my name)', 'Elimina anche il materiale di classe che ho caricato (altrimenti resta nella classe, senza il mio nome)') ?></span></label>
                    <label class="field" for="delete-password"><?= tt('Your password, to confirm', 'La tua password, per confermare') ?></label>
                    <input type="password" id="delete-password" class="input" autocomplete="current-password" required>
                    <div class="actions"><button type="submit" class="btn danger"><?= tt('Delete account for good', 'Elimina l\'account per sempre') ?></button></div>
                    <div id="delete-result" class="hint" role="status"></div>
                </form>
            </details>
            <?php endif; ?>
        </section>

        <?php if (!empty($account['is_admin'])): ?>
        <!-- ADMIN -->
        <section id="admin" class="group" aria-labelledby="h-admin">
            <h2 id="h-admin"><?= tt('Administration', 'Amministrazione') ?></h2>
            <div class="card links">
                <a href="admin_users.php" class="btn ghost"><?= tt('Users', 'Utenti') ?></a>
                <a href="mail.php" class="btn ghost"><?= tt('Mail box', 'Casella e-mail') ?></a>
            </div>
        </section>
        <?php endif; ?>

        <div class="signout">
            <a href="../api/logout.php" class="btn ghost danger"><?= tt('Log out of this session', 'Esci dalla sessione') ?></a>
        </div>
    </main>
</body>
</html>
