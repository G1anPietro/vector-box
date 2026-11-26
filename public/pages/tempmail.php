<?php
// public/pages/tempmail.php — temporary e-mail addresses, open to everybody (no account). API: api/tempmail.php.
require_once __DIR__ . '/../includes/head.php';
require_once __DIR__ . '/../api/tempmail_lib.php';

header('Referrer-Policy: no-referrer');
header('Cache-Control: no-store');
$v = max(filemtime(__DIR__ . '/../js/tempmail.js'), filemtime(__DIR__ . '/../css/tempmail.css'), filemtime(__DIR__ . '/../js/csrf.js'));
$other = pageLang() === 'it' ? 'en' : 'it';
?>
<!DOCTYPE html>
<html lang="<?= pageLang() ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#16141c">
    <meta name="referrer" content="no-referrer">
    <title><?= tt('Temporary mail', 'Mail temporanea') ?> — vector-box</title>
    <script src="../js/csrf.js?v=<?= $v ?>"></script>
    <link rel="stylesheet" href="../css/giochi.css?v=4">
    <link rel="stylesheet" href="../css/tempmail.css?v=<?= $v ?>">
    <script src="../js/tempmail.js?v=<?= $v ?>" defer></script>
</head>
<body class="tm" data-on="<?= tmEnabled() ? '1' : '0' ?>">
    <header class="tm-top">
        <a class="tm-home" href="../index.php">vector-box</a>
        <a class="tm-pill" href="?lang=<?= $other ?>" hreflang="<?= $other ?>"><?= strtoupper($other) ?></a>
    </header>
    <main class="tm-wrap">
        <h1><?= tt('Temporary mail', 'Mail temporanea') ?></h1>
        <p class="muted"><?= tt('A free address that works for one hour: use it to sign up somewhere without giving your real one. You only receive here, you cannot send. No account needed.',
            'Un indirizzo gratuito che funziona per un\'ora: usalo per registrarti da qualche parte senza dare il tuo vero indirizzo. Qui si riceve soltanto, non si può inviare. Non serve un account.') ?></p>
        <p id="tm-off" class="tm-warn" hidden><?= tt('This service is switched off for now.', 'Questo servizio per ora è spento.') ?></p>
        <section id="tm-start" class="tm-card" hidden>
            <input type="text" id="tm-website" class="tm-trap" tabindex="-1" autocomplete="off" aria-hidden="true">
            <button type="button" class="tm-btn" id="tm-new"><?= tt('Get a temporary address', 'Crea un indirizzo temporaneo') ?></button>
            <span id="tm-msg" class="muted" role="status"></span>
        </section>
        <section id="tm-box" class="tm-card" hidden>
            <div class="tm-addr-row">
                <code id="tm-addr" class="tm-addr"></code>
                <button type="button" class="tm-btn" id="tm-copy"><?= tt('Copy', 'Copia') ?></button>
            </div>
            <p class="muted"><?= tt('Expires in', 'Scade tra') ?> <b id="tm-left">--:--</b> · <span id="tm-note" role="status"></span></p>
            <div class="tm-acts">
                <button type="button" class="tm-pill" id="tm-refresh">⟳ <?= tt('Refresh', 'Aggiorna') ?></button>
                <button type="button" class="tm-pill" id="tm-extend">+ <?= tt('Extend', 'Prolunga') ?></button>
                <button type="button" class="tm-pill" id="tm-burn">🗑 <?= tt('Delete address', 'Elimina indirizzo') ?></button>
            </div>
            <div id="tm-list" class="tm-list" aria-live="polite"></div>
            <article id="tm-read" class="tm-read" hidden></article>
        </section>
        <p class="muted tm-fine"><?= tt('Messages are plain text only: pictures and links in them are not loaded or clickable, so nothing can track you. Do not use it for anything important or private: anyone who knows the address can try to send to it, and the address is deleted with its messages when it expires. Do not use it to hide abuse.',
            'I messaggi sono solo testo: immagini e link non vengono caricati né sono cliccabili, quindi nessuno può tracciarti. Non usarlo per cose importanti o private: chi conosce l\'indirizzo può scrivergli, e l\'indirizzo viene cancellato con i suoi messaggi alla scadenza. Non usarlo per nascondere abusi.') ?></p>
    </main>
    <script type="application/json" id="tm-i18n"><?= json_encode(pageLang() === 'it' ? [
        'working' => 'Verifica in corso…', 'copied' => 'Copiato.', 'nomsg' => 'Nessun messaggio ancora. Questa pagina si aggiorna da sola.', 'nosub' => '(senza oggetto)', 'back' => '← Indietro', 'del' => 'Elimina',
        'gone' => 'L\'indirizzo è scaduto o non esiste più.', 'slow' => 'Troppe richieste, aspetta un po\'.', 'wrong' => 'Qualcosa è andato storto, riprova.', 'extended' => 'Prolungato.', 'max' => 'Più di così non si può.',
        'sure' => 'Eliminare l\'indirizzo e tutti i messaggi?', 'from' => 'Da', 'busy' => 'Nessun indirizzo libero adesso, riprova tra poco.', 'min' => 'min'
    ] : [
        'working' => 'Checking…', 'copied' => 'Copied.', 'nomsg' => 'No messages yet. This page refreshes by itself.', 'nosub' => '(no subject)', 'back' => '← Back', 'del' => 'Delete',
        'gone' => 'The address has expired or no longer exists.', 'slow' => 'Too many requests, wait a little.', 'wrong' => 'Something went wrong, try again.', 'extended' => 'Extended.', 'max' => 'It cannot last longer than this.',
        'sure' => 'Delete the address and all its messages?', 'from' => 'From', 'busy' => 'No free address right now, try again soon.', 'min' => 'min'
    ], JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP) ?></script>
</body>
</html>
