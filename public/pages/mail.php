<?php
// public/pages/mail.php — the e-mail box (admin only): drafts, sent, the sending queue, and a writing form.
require_once __DIR__ . '/../includes/head.php';
require_once __DIR__ . '/../api/database.php';

initSession();
if (!sessionIsAdmin()) {
    http_response_code(403);
    header('X-Robots-Tag: noindex');
    exit('Admin only.');
}
header('X-Robots-Tag: noindex');
$v = max(filemtime(__DIR__ . '/../js/mail.js'), filemtime(__DIR__ . '/../css/mail.css'));
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <?php renderHead("SYSTEM // MAIL_BOX", true); ?>
    <link rel="stylesheet" href="../css/mail.css?v=<?php echo $v; ?>">
    <script src="../js/mail.js?v=<?php echo $v; ?>" defer></script>
</head>
<body>
    <canvas id="canvas"></canvas>
    <header class="cyber-header">
        <div class="glitch">// VECTOR-BOX // MAIL_BOX</div>
        <a href="account.php" class="nav-btn"><_ BACK_TO_ACCOUNT</a>
    </header>
    <main class="mailbox">
        <aside class="mb-side" aria-label="Folders">
            <button type="button" class="nav-btn mb-compose" id="mb-compose">>_ COMPOSE</button>
            <button type="button" class="nav-btn mb-folder" data-folder="draft">Drafts</button>
            <button type="button" class="nav-btn mb-folder" data-folder="sent">Sent</button>
            <button type="button" class="nav-btn mb-folder" data-folder="queue">Queue</button>
            <div id="mb-status" class="term-muted mb-status" role="status"></div>
            <button type="button" class="nav-btn" id="mb-process">>_ SEND NOW</button>
        </aside>
        <section class="mb-main">
            <div id="mb-list" class="mb-list" aria-live="polite"></div>
            <form id="mb-form" class="mb-form" hidden>
                <label for="mb-subject" class="term-muted">Subject</label>
                <input id="mb-subject" class="terminal-input" maxlength="150" autocomplete="off">
                <label for="mb-audience" class="term-muted">To</label>
                <select id="mb-audience" class="nav-btn">
                    <option value="optin">Everyone who confirmed the address and wants news</option>
                    <option value="supporters">Only supporters (confirmed, wants news)</option>
                </select>
                <label for="mb-body" class="term-muted">Text (plain text; the unsubscribe link is added for every person)</label>
                <textarea id="mb-body" class="tools-textarea" rows="14" maxlength="20000"></textarea>
                <div class="mb-actions">
                    <button type="submit" class="nav-btn" id="mb-save">>_ SAVE DRAFT</button>
                    <button type="button" class="nav-btn" id="mb-test">>_ SEND ME A TEST</button>
                    <button type="button" class="nav-btn mb-danger" id="mb-send">>_ SEND TO EVERYONE</button>
                    <button type="button" class="nav-btn" id="mb-delete">>_ DELETE DRAFT</button>
                </div>
                <div id="mb-msg" class="term-muted" role="status"></div>
            </form>
        </section>
    </main>
</body>
</html>
