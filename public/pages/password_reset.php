<?php
// public/pages/password_reset.php — "forgot my password": ask for a link by username or confirmed e-mail, then choose a new password.
// Same answer whether the account exists or not (no way to find out who has an account). Two-step steps: request -> mail -> ?t=link -> new password.
require_once __DIR__ . '/../includes/head.php';
require_once __DIR__ . '/../api/database.php';
require_once __DIR__ . '/../api/rate_limiter.php';
require_once __DIR__ . '/../api/password_reset_lib.php';

initSession(true);
if (empty($_SESSION['csrf_token'])) $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
$csrf = (string)$_SESSION['csrf_token'];
session_write_close();
header('X-Robots-Tag: noindex');
header('Referrer-Policy: no-referrer');
header('Cache-Control: no-store');

$db = getDbConnection();
$token = (string)($_GET['t'] ?? $_POST['t'] ?? '');
$state = 'ask';   // ask | sent | new | done | bad
$err = '';
$post = ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST';
if ($post && !hash_equals($csrf, (string)($_POST['csrf'] ?? ''))) { http_response_code(403); $post = false; $err = tt('The page expired, try again.', 'La pagina è scaduta, riprova.'); }

try {
    if ($token !== '') {
        $acc = prCheck($db, $token);
        $state = $acc ? 'new' : 'bad';
        if ($acc && $post) {
            $pw = (string)($_POST['password'] ?? '');
            if (!checkRateLimit('pw_reset', 10, 3600, null, true, true)) { http_response_code(429); $err = tt('Too many tries, wait a little.', 'Troppi tentativi, aspetta un po\'.'); }
            elseif ($pw !== (string)($_POST['password2'] ?? '')) $err = tt('The two passwords are different.', 'Le due password sono diverse.');
            elseif ($e = validateNewPassword($pw)) $err = $e === 'Password must be at least 8 characters' ? tt($e, 'La password deve avere almeno 8 caratteri') : tt($e, 'La password è troppo lunga (massimo 72 byte)');
            else {
                $db->prepare('UPDATE accounts SET password_hash = :h WHERE id = :i')->execute([':h' => password_hash($pw, PASSWORD_DEFAULT), ':i' => $acc['id']]);
                $state = 'done';
            }
        }
    } elseif ($post && $err === '') {
        $who = trim((string)($_POST['who'] ?? ''));
        if (!checkRateLimit('pw_ask', 5, 3600, null, true, true) || !checkRateLimit('pw_ask_who', 3, 3600, hash('sha256', strtolower($who)), false, true)) {
            http_response_code(429); $err = tt('Too many requests, try again later.', 'Troppe richieste, riprova più tardi.');
        } else {
            $qid = prRequest($db, $who);
            $state = 'sent';
            if ($qid) register_shutdown_function(function () use ($db, $qid) {   // the page is already answered; sending takes a moment
                if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
                try { mailProcessQueue($db, 5, [$qid]); } catch (Throwable $e) { /* stays in the queue */ }
            });
        }
    }
} catch (Throwable $e) {
    require_once __DIR__ . '/../api/debug_logger.php';
    logSystemError('PASSWORD_RESET', $e->getMessage());
    $state = 'bad'; http_response_code(500);
}
$h = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES);
?>
<!DOCTYPE html>
<html lang="<?= pageLang() ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#16141c">
    <meta name="robots" content="noindex">
    <title><?= tt('Password recovery — vector-box', 'Recupero password — vector-box') ?></title>
    <link rel="stylesheet" href="../css/giochi.css?v=4">
    <link rel="stylesheet" href="../css/account.css?v=<?= filemtime(__DIR__ . '/../css/account.css') ?>">
</head>
<body class="shelf-page account-page">
    <header class="top"><a class="home" href="../index.php">vector-box</a><a class="back" href="login.php">&larr; <?= tt('Sign in', 'Accedi') ?></a></header>
    <main class="acc auth"><section class="card">
        <h1><?= tt('Password recovery', 'Recupero password') ?></h1>
        <?php if ($state === 'ask'): ?>
            <p class="hint"><?= tt('Write your username or the e-mail address you confirmed on your account: we will send you a link to choose a new password.', 'Scrivi il tuo nome utente o l\'indirizzo e-mail che hai confermato sull\'account: ti mandiamo un link per scegliere una nuova password.') ?></p>
            <form method="POST" action="password_reset.php">
                <input type="hidden" name="csrf" value="<?= $h($csrf) ?>">
                <label class="field" for="pr-who"><?= tt('Username or e-mail', 'Nome utente o e-mail') ?></label>
                <input type="text" id="pr-who" name="who" class="input" required autofocus maxlength="254" autocomplete="username" autocapitalize="none" spellcheck="false">
                <?php if ($err !== ''): ?><div class="notice bad" role="alert"><?= $h($err) ?></div><?php endif; ?>
                <div class="actions"><button type="submit" class="btn wide"><?= tt('Send the link', 'Manda il link') ?></button></div>
            </form>
            <p class="hint"><?= tt('No confirmed e-mail on the account, or you are the admin? Ask the owner of the site to reset it.', 'Non hai un\'e-mail confermata sull\'account, o sei l\'admin? Chiedi al gestore del sito di reimpostarla.') ?></p>
        <?php elseif ($state === 'sent'): ?>
            <p class="hint"><?= tt('If an account with a confirmed e-mail address matches, we have just sent a link (valid 30 minutes). Check your spam folder too.', 'Se c\'è un account con un\'e-mail confermata che corrisponde, abbiamo appena mandato un link (valido 30 minuti). Controlla anche lo spam.') ?></p>
        <?php elseif ($state === 'new'): ?>
            <form method="POST" action="password_reset.php">
                <input type="hidden" name="csrf" value="<?= $h($csrf) ?>"><input type="hidden" name="t" value="<?= $h($token) ?>">
                <label class="field" for="pr-pw"><?= tt('New password (at least 8 characters)', 'Nuova password (almeno 8 caratteri)') ?></label>
                <input type="password" id="pr-pw" name="password" class="input" required autofocus minlength="8" maxlength="72" autocomplete="new-password">
                <label class="field" for="pr-pw2"><?= tt('Again', 'Ripetila') ?></label>
                <input type="password" id="pr-pw2" name="password2" class="input" required minlength="8" maxlength="72" autocomplete="new-password">
                <?php if ($err !== ''): ?><div class="notice bad" role="alert"><?= $h($err) ?></div><?php endif; ?>
                <div class="actions"><button type="submit" class="btn wide"><?= tt('Save the password', 'Salva la password') ?></button></div>
            </form>
        <?php elseif ($state === 'done'): ?>
            <p class="hint"><?= tt('Done: your password is changed.', 'Fatto: la password è cambiata.') ?></p>
            <div class="actions"><a class="btn wide" href="login.php"><?= tt('Sign in', 'Accedi') ?></a></div>
        <?php else: ?>
            <div class="notice bad" role="alert"><?= tt('This link is not valid or has expired.', 'Questo link non è valido o è scaduto.') ?></div>
            <div class="actions"><a class="btn wide" href="password_reset.php"><?= tt('Ask for a new link', 'Chiedi un nuovo link') ?></a></div>
        <?php endif; ?>
    </section></main>
</body>
</html>
