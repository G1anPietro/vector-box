<?php
// public/pages/login.php — sign-in and registration page: server-rendered forms that handle their own POST (sessions via establishSession()).
// ?mode=register shows the registration form; a failed registration stays on it.
require_once __DIR__ . '/../includes/head.php';
require_once __DIR__ . '/../api/database.php';
require_once __DIR__ . '/../api/totp_lib.php';

initSession();

// Where to go after logging in: only pages on this list (no open redirects)
$next = (string)($_POST['next'] ?? $_GET['next'] ?? '');
$next = in_array($next, ['appunti.php'], true) ? $next : '';
$afterLogin = $next !== '' ? $next : '../index.php';   // the menu shows who you are and where to go

// Redirect to desktop if already authenticated
if (!empty($_SESSION['username']) && !str_starts_with($_SESSION['username'], 'guest_')) {
    header('Location: ' . ($next !== '' ? $next : '../index.php'));
    exit();
}

$errorMessage = '';
$mode = (($_GET['mode'] ?? '') === 'register' || ($_POST['action'] ?? '') === 'register') ? 'register' : 'login';
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
                    $errorMessage = tt('Username is already taken.', 'Nome utente già in uso.');
                } else {
                    try {
                        $stmt = $db->prepare("INSERT INTO accounts (username, password_hash, theme, is_admin, lang) VALUES (:u, :p, 'cyan', 0, :l)");
                        $stmt->execute([':u' => $username, ':p' => password_hash($password, PASSWORD_DEFAULT), ':l' => pageLang()]);

                        establishSession(['id' => $db->lastInsertId(), 'username' => $username, 'theme' => 'cyan', 'is_admin' => 0]);
                        header('Location: ' . $afterLogin);
                        exit();
                    } catch (PDOException $e) {
                        if ((string)$e->getCode() !== '23000') throw $e;
                        $errorMessage = tt('Username is already taken.', 'Nome utente già in uso.');
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
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#16141c">
    <meta name="robots" content="noindex">
    <meta name="vb-lang" content="<?= pageLang() ?>">
    <title><?= $mode === 'register' ? tt('Create an account — vector-box', 'Crea un account — vector-box') : tt('Sign in — vector-box', 'Accedi — vector-box') ?></title>
    <script src="../js/csrf.js?v=<?= APP_VERSION ?>"></script>
    <script src="../js/i18n.js?v=<?= APP_VERSION ?>"></script>
    <link rel="icon" href="../assets/solitario/icon.svg?v=1" type="image/svg+xml">
    <link rel="stylesheet" href="../css/giochi.css?v=4">
    <link rel="stylesheet" href="../css/account.css?v=<?= filemtime(__DIR__ . '/../css/account.css') ?>">
</head>
<body class="shelf-page account-page">
    <header class="top">
        <a class="home" href="../index.php">vector-box</a>
        <a class="back" href="../index.php">&larr; <?= tt('Menu', 'Menu') ?></a>
    </header>

    <main class="acc auth">
        <?php
        $q = $next !== '' ? '&next=' . rawurlencode($next) : '';
        $keepUser = htmlspecialchars(trim((string)($_POST['username'] ?? '')));   // a failed try keeps the name, never the password
        $nextField = $next !== '' ? '<input type="hidden" name="next" value="' . htmlspecialchars($next) . '">' : '';
        $err = $errorMessage !== '' ? '<div class="notice bad" role="alert">' . htmlspecialchars($errorMessage) . '</div>' : '';
        ?>
        <section class="card">
            <?php if ($needCode): ?>
            <h1><?= tt('Enter your code', 'Inserisci il codice') ?></h1>
            <p class="hint"><?= tt('This account uses two-step login.', 'Questo account usa l\'accesso in due passaggi.') ?></p>
            <form method="POST" action="login.php">
                <input type="hidden" name="action" value="totp">
                <?= $nextField ?>
                <label class="field" for="login-code"><?= tt('Code from your authenticator app (or a backup code)', 'Codice dalla tua app (o un codice di emergenza)') ?></label>
                <input type="text" id="login-code" name="code" class="input code" required autofocus autocomplete="one-time-code" inputmode="text" autocapitalize="none" spellcheck="false" maxlength="16">
                <?= $err ?>
                <div class="actions"><button type="submit" class="btn wide"><?= tt('Continue', 'Continua') ?></button></div>
                <p class="swap"><a href="login.php<?= $next !== '' ? '?next=' . rawurlencode($next) : '' ?>"><?= tt('Start again', 'Ricomincia') ?></a></p>
            </form>

            <?php else: ?>
            <nav class="seg" aria-label="<?= tt('Sign in or register', 'Accedi o registrati') ?>">
                <a href="login.php<?= $q !== '' ? '?' . ltrim($q, '&') : '' ?>" <?= $mode === 'login' ? 'aria-current="page"' : '' ?>><?= tt('Sign in', 'Accedi') ?></a>
                <a href="login.php?mode=register<?= $q ?>" <?= $mode === 'register' ? 'aria-current="page"' : '' ?>><?= tt('Register', 'Registrati') ?></a>
            </nav>

            <?php if ($mode === 'register'): ?>
            <h1><?= tt('Create your account', 'Crea il tuo account') ?></h1>
            <p class="hint"><?= tt('Free, and it takes a few seconds. You can play most games without one.', 'È gratis e ci vogliono pochi secondi. Molti giochi si usano anche senza account.') ?></p>
            <form method="POST" action="login.php?mode=register<?= $q ?>">
                <input type="hidden" name="action" value="register">
                <?= $nextField ?>
                <label class="field" for="reg-username"><?= tt('Username', 'Nome utente') ?></label>
                <input type="text" id="reg-username" name="username" class="input" value="<?= $keepUser ?>" required autofocus autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="32">
                <p class="tip"><?= tt('3–32 characters: letters, digits, "_" or "-".', '3–32 caratteri: lettere, numeri, "_" o "-".') ?></p>
                <label class="field" for="reg-password"><?= tt('Password', 'Password') ?></label>
                <input type="password" id="reg-password" name="password" class="input" required autocomplete="new-password" minlength="8" maxlength="72">
                <p class="tip"><?= tt('At least 8 characters.', 'Almeno 8 caratteri.') ?></p>
                <label class="check"><input type="checkbox" name="accept_terms" value="1" required> <span><?php if (pageLang() === 'it'): ?>Ho letto la <a href="privacy.php">pagina sulla privacy</a> e ho almeno 14 anni (o un genitore è d'accordo).<?php else: ?>I have read the <a href="privacy.php">privacy page</a> and I am at least 14 years old (or a parent agrees).<?php endif; ?></span></label>
                <?= $err ?>
                <div class="actions"><button type="submit" class="btn wide"><?= tt('Create account', 'Crea account') ?></button></div>
                <p class="swap"><?= tt('Already have an account?', 'Hai già un account?') ?> <a href="login.php<?= $q !== '' ? '?' . ltrim($q, '&') : '' ?>"><?= tt('Sign in', 'Accedi') ?></a></p>
            </form>

            <?php else: ?>
            <h1><?= tt('Welcome back', 'Bentornato') ?></h1>
            <p class="hint"><?= tt('Sign in to use your account on this device.', 'Accedi per usare il tuo account su questo dispositivo.') ?></p>
            <form method="POST" action="login.php<?= $q !== '' ? '?' . ltrim($q, '&') : '' ?>">
                <input type="hidden" name="action" value="login">
                <?= $nextField ?>
                <label class="field" for="login-username"><?= tt('Username', 'Nome utente') ?></label>
                <input type="text" id="login-username" name="username" class="input" value="<?= $keepUser ?>" required autofocus autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="64">
                <label class="field" for="login-password"><?= tt('Password', 'Password') ?></label>
                <input type="password" id="login-password" name="password" class="input" required autocomplete="current-password">
                <?= $err ?>
                <div class="actions"><button type="submit" class="btn wide"><?= tt('Sign in', 'Accedi') ?></button></div>
                <p class="swap"><?= tt('New here?', 'Sei nuovo?') ?> <a href="login.php?mode=register<?= $q ?>"><?= tt('Create an account', 'Crea un account') ?></a></p>
            </form>
            <?php endif; ?>
            <?php endif; ?>
        </section>
        <div class="auth-lang"><div id="vb-lang" role="group" aria-label="<?= tt('Language', 'Lingua') ?>"></div></div>
    </main>
</body>
</html>
