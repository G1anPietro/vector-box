<?php
// public/pages/mail.php — the e-mail box (admin, and the people the admin allows): drafts, sent, the sending queue, and a writing form.
require_once __DIR__ . '/../includes/head.php';
require_once __DIR__ . '/../api/database.php';

initSession();
if (!userCanUseMail(getDbConnection(), (int)($_SESSION['user_id'] ?? 0), sessionIsAdmin())) {
    http_response_code(403);
    header('X-Robots-Tag: noindex');
    exit('Not allowed.');
}
header('X-Robots-Tag: noindex');
$v = max(filemtime(__DIR__ . '/../js/mail.js'), filemtime(__DIR__ . '/../css/mail.css'));
?>
<!DOCTYPE html>
<html lang="<?= pageLang() ?>">
<head>
    <?php renderHead(tt('MAIL // VECTOR-BOX', 'POSTA // VECTOR-BOX'), true); ?>
    <link rel="stylesheet" href="../css/mail.css?v=<?php echo $v; ?>">
    <script src="../js/mail.js?v=<?php echo $v; ?>" defer></script>
</head>
<body>
    <canvas id="canvas"></canvas>
    <header class="cyber-header">
        <div class="glitch">// VECTOR-BOX // <?= tt('MAIL', 'POSTA') ?></div>
        <span><?php if (sessionIsAdmin()): ?><a href="admin_users.php" class="nav-btn"><?= tt('USERS', 'UTENTI') ?></a> <?php endif; ?><a href="../index.php" class="nav-btn"><_ <?= tt('HOME', 'HOME') ?></a></span>
    </header>
    <main class="mailbox">
        <aside class="mb-side" aria-label="<?= tt('Folders', 'Cartelle') ?>">
            <button type="button" class="nav-btn mb-compose" id="mb-compose"><span class="mb-ico">✎</span> <?= tt('COMPOSE', 'SCRIVI') ?></button>
            <button type="button" class="nav-btn mb-folder" data-folder="draft"><span class="mb-ico">▤</span> <?= tt('Drafts', 'Bozze') ?></button>
            <button type="button" class="nav-btn mb-folder" data-folder="sent"><span class="mb-ico">➤</span> <?= tt('Sent', 'Inviati') ?></button>
            <button type="button" class="nav-btn mb-folder" data-folder="queue"><span class="mb-ico">⏳</span> <?= tt('Queue', 'Coda') ?></button>
            <div id="mb-status" class="term-muted mb-status" role="status"></div>
            <button type="button" class="nav-btn" id="mb-process">>_ <?= tt('SEND NOW', 'INVIA ORA') ?></button>
        </aside>
        <section class="mb-main">
            <div id="mb-list" class="mb-list" aria-live="polite"></div>
            <form id="mb-form" class="mb-form" hidden>
                <label for="mb-subject" class="term-muted"><?= tt('Subject', 'Oggetto') ?></label>
                <input id="mb-subject" class="terminal-input" maxlength="150" autocomplete="off">
                <label for="mb-audience" class="term-muted"><?= tt('To', 'A') ?></label>
                <select id="mb-audience" class="nav-btn">
                    <option value="optin"><?= tt('Everyone who confirmed the address and wants news', 'Tutti quelli che hanno confermato l\'indirizzo e vogliono le novità') ?></option>
                    <option value="supporters"><?= tt('Only supporters (confirmed, wants news)', 'Solo i sostenitori (confermati, vogliono le novità)') ?></option>
                </select>
                <label for="mb-body" class="term-muted"><?= tt('Text (plain text; the unsubscribe link is added for every person)', 'Testo (solo testo semplice; il link per disiscriversi viene aggiunto per ogni persona)') ?></label>
                <textarea id="mb-body" class="tools-textarea" rows="14" maxlength="20000"></textarea>
                <div class="mb-actions">
                    <button type="submit" class="nav-btn" id="mb-save">>_ <?= tt('SAVE DRAFT', 'SALVA BOZZA') ?></button>
                    <button type="button" class="nav-btn" id="mb-test">>_ <?= tt('SEND ME A TEST', 'MANDAMI UNA PROVA') ?></button>
                    <button type="button" class="nav-btn mb-danger" id="mb-send">>_ <?= tt('SEND TO EVERYONE', 'INVIA A TUTTI') ?></button>
                    <button type="button" class="nav-btn" id="mb-delete">>_ <?= tt('DELETE DRAFT', 'ELIMINA BOZZA') ?></button>
                </div>
                <div id="mb-msg" class="term-muted" role="status"></div>
            </form>
        </section>
    </main>
</body>
</html>
