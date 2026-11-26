<?php
// public/pages/contatti.php — how to reach the owner: one support address (default support@MAIL_DOMAIN, or SUPPORT_EMAIL in .env).
// Mail to it arrives in the owner's mailbox (pages/mail.php) through the Cloudflare Worker, like every address on the domain.
require_once __DIR__ . '/../includes/head.php';
require_once __DIR__ . '/../api/helpers.php';

$addr = trim((string)envValue('SUPPORT_EMAIL', ''));
if ($addr === '') $addr = 'support@' . strtolower(trim((string)envValue('MAIL_DOMAIN', 'talvera.site')));
$h = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES);
?>
<!DOCTYPE html>
<html lang="<?= pageLang() ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#16141c">
    <title><?= tt('Contact — vector-box', 'Contatti — vector-box') ?></title>
    <link rel="stylesheet" href="../css/giochi.css?v=4">
    <link rel="stylesheet" href="../css/account.css?v=<?= filemtime(__DIR__ . '/../css/account.css') ?>">
</head>
<body class="shelf-page account-page">
    <header class="top"><a class="home" href="../index.php">vector-box</a><a class="back" href="../index.php">&larr; <?= tt('Menu', 'Menu') ?></a></header>
    <main class="acc auth"><section class="card">
        <h1><?= tt('Contact', 'Contatti') ?></h1>
        <p class="hint"><?= tt('Questions, problems with your account, ideas or something to report? Write to us:', 'Domande, problemi con l\'account, idee o qualcosa da segnalare? Scrivici:') ?></p>
        <p><a class="btn wide" href="mailto:<?= $h($addr) ?>"><?= $h($addr) ?></a></p>
        <p class="hint"><?= tt('Please do not send passwords. Forgot yours? Use "Forgot your password?" on the sign-in page; if your account has no confirmed e-mail, write to us from any address and say your username.', 'Non mandare password. Hai dimenticato la tua? Usa "Password dimenticata?" nella pagina di accesso; se il tuo account non ha un\'e-mail confermata, scrivici da qualsiasi indirizzo indicando il nome utente.') ?></p>
    </section></main>
</body>
</html>
