<?php
// public/pages/login.php — login / registration page: a server-rendered form that handles its own POST (sessions via establishSession()).
require_once __DIR__ . '/../includes/head.php';
require_once __DIR__ . '/../api/database.php';
require_once __DIR__ . '/../api/totp_lib.php';

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
$needCode = false;   // step two: the password was right and this account asks for a code

// Step two of a two-step login: only the code comes in; WHO is trying was decided by the password step and lives in the session for 5 minutes.
$step2 = $_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'totp';
if ($step2) {
    require_once __DIR__ . '/../api/rate_limiter.php';
    $p = $_SESSION['totp_pending'] ?? null;
    if (!is_array($p) || (int)($p['until'] ?? 0) < time()) {
        $errorMessage = tt('The sign-in expired: enter your username and password again.', 'L’accesso è scaduto: inserisci di nuovo nome utente e password.');
    } else {
        $needCode = true;
        try {
            $db = getDbConnection();
            if (!checkRateLimit('totp_login', 5, 300, (string)(int)$p['id'], true, true)) {
                $errorMessage = tt('Too many attempts. Try again in a few minutes.', 'Troppi tentativi. Riprova tra qualche minuto.');
            } else {
                $st = $db->prepare('SELECT * FROM accounts WHERE id = :i');
                $st->execute([':i' => (int)$p['id']]);
                $acc = $st->fetch(PDO::FETCH_ASSOC) ?: null;
                $st->closeCursor();
                if ($acc && totpEnabled($acc) && totpVerifyLogin($db, $acc, trim((string)($_POST['code'] ?? '')))) {
                    initSession(true);
                    unset($_SESSION['totp_pending']);
                    session_write_close();
                    establishSession($acc);
                    header('Location: ' . $afterLogin);
                    exit();
                }
                $errorMessage = tt('Wrong code.', 'Codice sbagliato.');
            }
        } catch (Throwable $e) {
            require_once __DIR__ . '/../api/debug_logger.php';
            logSystemError('LOGIN_TOTP', $e->getMessage());
            $errorMessage = tt('Authentication server error.', 'Errore del server di accesso.');
        }
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && !$step2) {
    require_once __DIR__ . '/../api/rate_limiter.php';

    // Passwords are trimmed to stay compatible with hashes created by earlier versions
    $username = trim((string)($_POST['username'] ?? ''));
    $password = trim((string)($_POST['password'] ?? ''));
    $action = $_POST['action'] ?? 'login';

    if ($username === '' || $password === '') {
        $errorMessage = tt('Please complete all fields.', 'Compila tutti i campi.');
    } elseif (strlen($username) > 64 || strlen($password) > 1024) {
        $errorMessage = tt('Invalid username or password.', 'Nome utente o password non validi.');
    } else {
        try {
            $db = getDbConnection();

            if ($action === 'register') {
                if (!checkRateLimit('register', 5, 3600, null, true, true)) {
                    $errorMessage = tt('Too many registrations from this address. Try again later.', 'Troppe registrazioni da questo indirizzo. Riprova più tardi.');
                } elseif ($err = validateNewUsername($username) ?? validateNewPassword($password)) {
                    $errorMessage = trMsg($err);
                } elseif (empty($_POST['accept_terms'])) {
                    $errorMessage = trMsg(REGISTER_TERMS_ERROR);
                } elseif (($same = $db->prepare('SELECT 1 FROM accounts WHERE LOWER(username) = LOWER(:u)')) && $same->execute([':u' => $username]) && $same->fetchColumn()) {
                    $errorMessage = "Username is already taken.";
                } else {
                    try {
                        $stmt = $db->prepare("INSERT INTO accounts (username, password_hash, theme, is_admin, lang) VALUES (:u, :p, 'cyan', 0, :l)");
                        $stmt->execute([':u' => $username, ':p' => password_hash($password, PASSWORD_DEFAULT), ':l' => pageLang()]);

                        establishSession(['id' => $db->lastInsertId(), 'username' => $username, 'theme' => 'cyan', 'is_admin' => 0]);
                        header('Location: ' . $afterLogin);
                        exit();
                    } catch (PDOException $e) {
                        if ((string)$e->getCode() !== '23000') throw $e;
                        $errorMessage = "Username is already taken.";
                    }
                }
            } else {
                // per account AND address (a stranger's guesses must not lock the owner out); a limiter error refuses instead of allowing
                if (!checkRateLimit('login_ip', 10, 300, null, true, true) || !checkRateLimit('login_user', 5, 300, strtolower($username) . '|' . getClientIp(), true, true)
        || !checkRateLimit('login_acct', 60, 3600, strtolower($username), true, true)) {   // wide cap on one account from ALL addresses
                    $errorMessage = tt('Too many attempts. Try again in a few minutes.', 'Troppi tentativi. Riprova tra qualche minuto.');
                } else {
                    $stmt = $db->prepare("SELECT * FROM accounts WHERE username = :u");
                    $stmt->execute([':u' => $username]);
                    $account = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;

                    if (verifyPasswordSafe($account, $password)) {
                        if (!totpEnabled($account)) {
                            establishSession($account);
                            header('Location: ' . $afterLogin);
                            exit();
                        }
                        initSession(true);
                        $_SESSION['totp_pending'] = ['id' => (int)$account['id'], 'until' => time() + 300];
                        session_write_close();
                        $needCode = true;
                    } else {
                        $errorMessage = tt('Invalid username or password.', 'Nome utente o password non validi.');
                    }
                }
            }
        } catch (Throwable $e) {
            require_once __DIR__ . '/../api/debug_logger.php';
            logSystemError('LOGIN_PAGE', $e->getMessage());
            $errorMessage = tt('Authentication server error.', 'Errore del server di accesso.');
        }
    }
}
?>
<!DOCTYPE html>
<html lang="<?= pageLang() ?>">
<head>
    <?php renderHead(tt('SYSTEM // AUTHENTICATION', 'SISTEMA // AUTENTICAZIONE'), true); ?>
</head>
<body>
    <canvas id="canvas"></canvas>

    <header class="cyber-header">
        <div class="glitch">// VECTOR-BOX // AUTH_GATEWAY</div>
        <a href="../index.php" class="nav-btn"><_ <?= tt('BACK_TO_DESKTOP', 'TORNA_AL_DESKTOP') ?></a>
    </header>

    <main class="page-container-centered">
        <div class="cyber-panel hack-container" style="max-width: 420px; text-align: left;">
            <h2 class="hack-title" style="text-align: center;">>_ <?= tt('USER_ACCOUNT', 'ACCOUNT_UTENTE') ?></h2>
            
            <?php if (!empty($errorMessage)): ?>
                <div style="color: #ff3333; font-weight: bold; margin-bottom: 12px; font-size: 0.85rem;">>> <?php echo $errorMessage; ?></div>
            <?php endif; ?>

            <?php if ($needCode): ?>
            <form method="POST" action="login.php" style="display: flex; flex-direction: column; gap: 12px;">
                <input type="hidden" name="action" value="totp">
                <?php if ($next !== ''): ?><input type="hidden" name="next" value="<?php echo htmlspecialchars($next); ?>"><?php endif; ?>
                <label class="toggle-label" for="login-code" style="font-size: 0.75rem; color: var(--text-muted);"><?= tt('CODE FROM YOUR AUTHENTICATOR APP (or a backup code)', 'CODICE DALLA TUA APP (o un codice di emergenza)') ?>:</label>
                <input type="text" id="login-code" name="code" class="terminal-input" style="background: rgba(0,0,0,0.85); border: 1px solid var(--border-color); color: #ffffff; padding: 8px; letter-spacing: 0.2em;" required autofocus autocomplete="one-time-code" inputmode="text" autocapitalize="none" spellcheck="false" maxlength="16">
                <button type="submit" class="nav-btn" style="padding: 8px;">>_ <?= tt('CONTINUE', 'CONTINUA') ?></button>
                <a href="login.php" style="font-size: 0.75rem; color: var(--text-muted);"><?= tt('Start again', 'Ricomincia') ?></a>
            </form>
            <?php else: ?>
            <form method="POST" action="login.php" style="display: flex; flex-direction: column; gap: 12px;">
                <?php if ($next !== ''): ?><input type="hidden" name="next" value="<?php echo htmlspecialchars($next); ?>"><?php endif; ?>
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <label class="toggle-label" for="login-username" style="font-size: 0.75rem; color: var(--text-muted);"><?= tt('USERNAME', 'NOME UTENTE') ?>:</label>
                    <input type="text" id="login-username" name="username" class="terminal-input" style="background: rgba(0,0,0,0.85); border: 1px solid var(--border-color); color: #ffffff; padding: 8px;" required autocomplete="username" autocapitalize="none" spellcheck="false">
                </div>

                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <label class="toggle-label" for="login-password" style="font-size: 0.75rem; color: var(--text-muted);">PASSWORD:</label>
                    <input type="password" id="login-password" name="password" class="terminal-input" style="background: rgba(0,0,0,0.85); border: 1px solid var(--border-color); color: #ffffff; padding: 8px;" required autocomplete="current-password">
                </div>

                <label class="toggle-label" style="font-size: 0.72rem; color: var(--text-muted); display: flex; gap: 6px; align-items: flex-start;">
                    <input type="checkbox" name="accept_terms" value="1">
                    <span><?php if (pageLang() === 'it'): ?>Solo per REGISTRARTI: ho letto la <a href="privacy.php" style="color: var(--accent-color);">pagina sulla privacy</a> e ho almeno 14 anni (o un genitore è d'accordo).<?php else: ?>Only to REGISTER: I have read the <a href="privacy.php" style="color: var(--accent-color);">privacy page</a> and I am at least 14 years old (or a parent agrees).<?php endif; ?></span>
                </label>

                <div style="display: flex; gap: 8px; margin-top: 10px;">
                    <button type="submit" name="action" value="login" class="nav-btn" style="flex: 1; padding: 8px;">>_ <?= tt('LOGIN', 'ACCEDI') ?></button>
                    <button type="submit" name="action" value="register" class="nav-btn" style="flex: 1; border-color: var(--text-muted); color: var(--text-muted); padding: 8px;"><?= tt('REGISTER', 'REGISTRATI') ?></button>
                </div>
            </form>
            <?php endif; ?>
        </div>
    </main>
</body>
</html>