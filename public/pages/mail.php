<?php
// public/pages/mail.php — personal mail (accounts the admin allows): inbox, starred, sent, drafts, trash, search, writing window.
// The admin also makes the addresses here. The news e-mails are in newsletter.php.
require_once __DIR__ . '/../includes/head.php';
require_once __DIR__ . '/../api/database.php';

initSession();
if (!userCanUseMail(getDbConnection(), (int)($_SESSION['user_id'] ?? 0), sessionIsAdmin())) {
    http_response_code(403);
    header('X-Robots-Tag: noindex');
    exit('Not allowed.');
}
header('X-Robots-Tag: noindex');
$v = max(filemtime(__DIR__ . '/../js/webmail.js'), filemtime(__DIR__ . '/../js/window_manager.js'), filemtime(__DIR__ . '/../css/mail.css'), filemtime(__DIR__ . '/../js/csrf.js'));
$other = pageLang() === 'it' ? 'en' : 'it';
?>
<!DOCTYPE html>
<html lang="<?= pageLang() ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#16141c">
    <meta name="robots" content="noindex">
    <title><?= tt('Mail', 'Posta') ?> — vector-box</title>
    <script src="../js/csrf.js?v=<?= $v ?>"></script>
    <link rel="stylesheet" href="../css/giochi.css?v=4">
    <link rel="stylesheet" href="../css/mail.css?v=<?= $v ?>">
    <script src="../js/window_manager.js?v=<?= $v ?>" defer></script>
    <script src="../js/webmail.js?v=<?= $v ?>" defer></script>
</head>
<body class="wm" data-admin="<?= sessionIsAdmin() ? '1' : '0' ?>">
    <header class="wm-top">
        <button type="button" class="wm-burger" id="wm-burger" aria-label="<?= tt('Menu', 'Menu') ?>" aria-expanded="false">☰</button>
        <a class="wm-home" href="../index.php">vector-box</a>
        <form id="wm-search" class="wm-search" role="search">
            <input id="wm-q" type="search" placeholder="<?= tt('Search mail', 'Cerca nella posta') ?>" aria-label="<?= tt('Search mail', 'Cerca nella posta') ?>" autocomplete="off">
        </form>
        <span class="wm-links">
            <?php if (sessionIsAdmin()): ?><a class="wm-pill" href="admin_users.php"><?= tt('Users', 'Utenti') ?></a><a class="wm-pill" href="newsletter.php">Newsletter</a><?php endif; ?>
            <a class="wm-pill" href="?lang=<?= $other ?>" hreflang="<?= $other ?>"><?= strtoupper($other) ?></a>
        </span>
    </header>
    <div class="wm-scrim" id="wm-scrim" hidden></div>
    <div class="wm-body">
        <nav class="wm-rail" id="wm-rail" aria-label="<?= tt('Folders', 'Cartelle') ?>">
            <a class="wm-rail-home" href="../index.php">vector-box</a>
            <button type="button" class="wm-compose" id="wm-compose">✎ <?= tt('Compose', 'Scrivi') ?></button>
            <button type="button" class="wm-folder" data-folder="inbox">📥 <span><?= tt('Inbox', 'In arrivo') ?></span><b id="wm-n-inbox"></b></button>
            <button type="button" class="wm-folder" data-folder="starred">★ <span><?= tt('Starred', 'Speciali') ?></span></button>
            <button type="button" class="wm-folder" data-folder="sent">➤ <span><?= tt('Sent', 'Inviata') ?></span></button>
            <button type="button" class="wm-folder" data-folder="draft">▤ <span><?= tt('Drafts', 'Bozze') ?></span><b id="wm-n-draft"></b></button>
            <button type="button" class="wm-folder" data-folder="trash">🗑 <span><?= tt('Trash', 'Cestino') ?></span></button>
            <?php if (sessionIsAdmin()): ?><button type="button" class="wm-folder" data-folder="system">⚙ <span><?= tt('Site mail', 'Mail del sito') ?></span></button><button type="button" class="wm-folder" data-folder="addresses">⚙ <span><?= tt('Addresses', 'Indirizzi') ?></span></button><?php endif; ?>
            <p id="wm-mine" class="wm-mine"></p>
            <?php if (sessionIsAdmin()): ?><select id="wm-switch" class="wm-switch" aria-label="<?= tt('Address in use', 'Indirizzo in uso') ?>" hidden></select><?php endif; ?>
            <div class="wm-rail-links">
                <?php if (sessionIsAdmin()): ?><a href="admin_users.php"><?= tt('Users', 'Utenti') ?></a><a href="newsletter.php">Newsletter</a><?php endif; ?>
                <a href="?lang=<?= $other ?>" hreflang="<?= $other ?>"><?= $other === 'en' ? 'English' : 'Italiano' ?></a>
            </div>
        </nav>
        <main class="wm-main">
            <div class="wm-bar" id="wm-bar">
                <button type="button" class="wm-ico" id="wm-back" hidden title="<?= tt('Back', 'Indietro') ?>">←</button>
                <button type="button" class="wm-ico" id="wm-refresh" title="<?= tt('Refresh', 'Aggiorna') ?>">⟳</button>
                <button type="button" class="wm-ico" data-bulk="read" title="<?= tt('Mark as read', 'Segna come letto') ?>">✉</button>
                <button type="button" class="wm-ico" data-bulk="unread" title="<?= tt('Mark as unread', 'Segna come non letto') ?>">●</button>
                <button type="button" class="wm-ico" data-bulk="trash" title="<?= tt('Move to trash', 'Sposta nel cestino') ?>">🗑</button>
                <button type="button" class="wm-ico" data-bulk="restore" title="<?= tt('Restore', 'Ripristina') ?>" hidden>↩</button>
                <button type="button" class="wm-ico" data-bulk="delete" title="<?= tt('Delete forever', 'Elimina per sempre') ?>" hidden>✖</button>
                <button type="button" class="wm-ico" id="wm-empty" title="<?= tt('Empty the trash', 'Svuota il cestino') ?>" hidden>🗑 <?= tt('Empty', 'Svuota') ?></button>
                <span id="wm-note" class="muted" role="status"></span>
            </div>
            <div id="wm-list" class="wm-list" aria-live="polite"></div>
            <article id="wm-read" class="wm-read" hidden></article>
            <section id="wm-addr" class="wm-addr" hidden></section>
        </main>
    </div>
    <button type="button" class="wm-fab" id="wm-fab" aria-label="<?= tt('Compose', 'Scrivi') ?>">✎ <span><?= tt('Compose', 'Scrivi') ?></span></button>
    <form id="wm-win" class="wm-win" hidden aria-label="<?= tt('New message', 'Nuovo messaggio') ?>">
        <div class="wm-win-head"><b id="wm-win-title"><?= tt('New message', 'Nuovo messaggio') ?></b><button type="button" class="wm-ico" id="wm-win-close" title="<?= tt('Save and close', 'Salva e chiudi') ?>">✕</button></div>
        <select id="wm-from" aria-label="<?= tt('From', 'Da') ?>"></select>
        <datalist id="wm-contacts"></datalist>
        <input id="wm-to" list="wm-contacts" placeholder="<?= tt('To (separate with commas)', 'A (separa con virgole)') ?>" autocomplete="off" maxlength="600">
        <input id="wm-subject" placeholder="<?= tt('Subject', 'Oggetto') ?>" maxlength="150" autocomplete="off">
        <textarea id="wm-body" rows="12" maxlength="20000"></textarea>
        <div class="wm-win-foot"><button type="submit" class="wm-send" id="wm-send"><?= tt('Send', 'Invia') ?></button><span id="wm-win-msg" class="muted" role="status"></span></div>
    </form>
    <script type="application/json" id="wm-i18n"><?= json_encode(pageLang() === 'it' ? [
        'noaddr' => 'Non hai ancora un indirizzo: chiedilo all\'admin.', 'you' => 'Tu', 'nothing' => 'Niente qui.', 'nosub' => '(senza oggetto)', 'to' => 'A', 'from' => 'Da',
        'reply' => 'Rispondi', 'forward' => 'Inoltra', 'trash' => 'Cestino', 'saved' => 'Bozza salvata.', 'sent' => 'Inviato.', 'sentext' => 'Inviato (all\'esterno: in coda).', 'newm' => 'Nuovo messaggio',
        'wrote' => 'ha scritto', 'confirm_del' => 'Eliminare per sempre?', 'confirm_empty' => 'Svuotare il cestino?', 'mine' => 'I tuoi indirizzi', 'off' => 'Per ora puoi scrivere solo agli indirizzi @talvera.site: l\'invio all\'esterno non è ancora attivato.',
        'all_addr' => 'Tutti i miei indirizzi', 'a_new' => 'Nuovo indirizzo', 'a_local' => 'parte prima della @', 'a_user' => 'nome utente', 'a_make' => 'Crea', 'a_del' => 'Elimina', 'a_made' => 'Creato: ', 'local_only' => 'Puoi scrivere agli indirizzi @talvera.site; l\'invio all\'esterno è riservato all\'admin.', 'a_none' => 'Nessun indirizzo.', 'a_owner' => 'di', 'a_sure' => 'Eliminare l\'indirizzo? I messaggi restano.',
        'wrong' => 'Qualcosa è andato storto.', 'moved' => 'Spostato nel cestino.', 'restored' => 'Ripristinato.', 'deleted' => 'Eliminato.', 'draft_to' => 'Bozza'
    ] : [
        'noaddr' => 'You have no address yet: ask the admin.', 'you' => 'Me', 'nothing' => 'Nothing here.', 'nosub' => '(no subject)', 'to' => 'To', 'from' => 'From',
        'reply' => 'Reply', 'forward' => 'Forward', 'trash' => 'Trash', 'saved' => 'Draft saved.', 'sent' => 'Sent.', 'sentext' => 'Sent (to another address: queued).', 'newm' => 'New message',
        'wrote' => 'wrote', 'confirm_del' => 'Delete forever?', 'confirm_empty' => 'Empty the trash?', 'mine' => 'Your addresses', 'off' => 'For now you can only write to @talvera.site addresses: sending to other addresses is not switched on yet.',
        'all_addr' => 'All my addresses', 'a_new' => 'New address', 'a_local' => 'part before the @', 'a_user' => 'username', 'a_make' => 'Create', 'a_del' => 'Delete', 'a_made' => 'Created: ', 'local_only' => 'You can write to @talvera.site addresses; sending outside is for the admin only.', 'a_none' => 'No addresses.', 'a_owner' => 'owner', 'a_sure' => 'Delete the address? The messages stay.',
        'wrong' => 'Something went wrong.', 'moved' => 'Moved to trash.', 'restored' => 'Restored.', 'deleted' => 'Deleted.', 'draft_to' => 'Draft'
    ], JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP) ?></script>
</body>
</html>
