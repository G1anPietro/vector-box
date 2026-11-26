<?php
// public/pages/newsletter.php — the news e-mails to the people who asked for them (admin only): drafts, sent, the sending queue, and a writing form.
require_once __DIR__ . '/../includes/head.php';   // the site look (giochi.css), not the desktop one: no renderHead()
require_once __DIR__ . '/../api/database.php';

initSession();
if (!sessionIsAdmin()) {
    http_response_code(403);
    header('X-Robots-Tag: noindex');
    exit('Not allowed.');
}
header('X-Robots-Tag: noindex');
$v = max(filemtime(__DIR__ . '/../js/newsletter.js'), filemtime(__DIR__ . '/../css/newsletter.css'), filemtime(__DIR__ . '/../js/i18n-ui.js'));
$other = pageLang() === 'it' ? 'en' : 'it';
?>
<!DOCTYPE html>
<html lang="<?= pageLang() ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#16141c">
    <meta name="robots" content="noindex">
    <title><?= tt('Newsletter', 'Newsletter') ?> — vector-box</title>
    <script src="../js/csrf.js?v=<?= $v ?>"></script>
    <script src="../js/i18n.js?v=<?= $v ?>"></script>
    <script src="../js/i18n-ui.js?v=<?= $v ?>"></script>
    <link rel="stylesheet" href="../css/giochi.css?v=4">
    <link rel="stylesheet" href="../css/newsletter.css?v=<?= $v ?>">
    <script src="../js/newsletter.js?v=<?= $v ?>" defer></script>
</head>
<body>
    <header class="top">
        <a class="home" href="mail.php">← Posta</a>
        <span class="mb-top"><?php if (sessionIsAdmin()): ?><a class="lang" href="admin_users.php"><?= tt('Users', 'Utenti') ?></a> <?php endif; ?><a class="lang" href="?lang=<?= $other ?>" hreflang="<?= $other ?>"><?= strtoupper($other) ?></a></span>
    </header>
    <h1 class="mb-title"><?= tt('Newsletter', 'Newsletter') ?></h1>
<main class="mailbox">
        <aside class="mb-side" aria-label="<?= tt('Folders', 'Cartelle') ?>">
            <button type="button" class="mb-btn mb-compose" id="mb-compose"><span class="mb-ico">✎</span> <?= tt('COMPOSE', 'SCRIVI') ?></button>
            <button type="button" class="mb-btn mb-folder" data-folder="draft"><span class="mb-ico">▤</span> <?= tt('Drafts', 'Bozze') ?></button>
            <button type="button" class="mb-btn mb-folder" data-folder="sent"><span class="mb-ico">➤</span> <?= tt('Sent', 'Inviati') ?></button>
            <button type="button" class="mb-btn mb-folder" data-folder="queue"><span class="mb-ico">⏳</span> <?= tt('Queue', 'Coda') ?></button>
            <div id="mb-status" class="muted mb-status" role="status"></div>
            <button type="button" class="mb-btn" id="mb-process"><?= tt('SEND NOW', 'INVIA ORA') ?></button>
        </aside>
        <section class="mb-main">
            <div id="mb-list" class="mb-list" aria-live="polite"></div>
            <form id="mb-form" class="mb-form" hidden>
                <label for="mb-subject" class="muted"><?= tt('Subject', 'Oggetto') ?></label>
                <input id="mb-subject"  maxlength="150" autocomplete="off">
                <label for="mb-audience" class="muted"><?= tt('To', 'A') ?></label>
                <select id="mb-audience" class="mb-btn">
                    <option value="optin"><?= tt('Everyone who confirmed the address and wants news', 'Tutti quelli che hanno confermato l\'indirizzo e vogliono le novità') ?></option>
                    <option value="supporters"><?= tt('Only supporters (confirmed, wants news)', 'Solo i sostenitori (confermati, vogliono le novità)') ?></option>
                </select>
                <label for="mb-body" class="muted"><?= tt('Text (plain text; the unsubscribe link is added for every person)', 'Testo (solo testo semplice; il link per disiscriversi viene aggiunto per ogni persona)') ?></label>
                <textarea id="mb-body"  rows="14" maxlength="20000"></textarea>
                <div class="mb-actions">
                    <button type="submit" class="mb-btn" id="mb-save"><?= tt('SAVE DRAFT', 'SALVA BOZZA') ?></button>
                    <button type="button" class="mb-btn" id="mb-test"><?= tt('SEND ME A TEST', 'MANDAMI UNA PROVA') ?></button>
                    <button type="button" class="mb-btn mb-danger" id="mb-send"><?= tt('SEND TO EVERYONE', 'INVIA A TUTTI') ?></button>
                    <button type="button" class="mb-btn" id="mb-delete"><?= tt('DELETE DRAFT', 'ELIMINA BOZZA') ?></button>
                </div>
                <div id="mb-msg" class="muted" role="status"></div>
            </form>
        </section>
    </main>
</body>
</html>
