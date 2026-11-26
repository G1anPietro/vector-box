<?php
// public/pages/admin_users.php — the people of the site (admin only): search, filters, one person at a time.
require_once __DIR__ . '/../includes/head.php';
require_once __DIR__ . '/../api/database.php';

initSession();
if (!sessionIsAdmin()) {
    http_response_code(403);
    header('X-Robots-Tag: noindex');
    exit('Admin only.');
}
header('X-Robots-Tag: noindex');
$v = max(filemtime(__DIR__ . '/../js/admin_users.js'), filemtime(__DIR__ . '/../css/admin_users.css'), filemtime(__DIR__ . '/../js/i18n-ui.js'), filemtime(__DIR__ . '/../js/csrf.js'));
?>
<!DOCTYPE html>
<html lang="<?= pageLang() ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#16141c">
    <meta name="robots" content="noindex">
    <title><?= tt('Users', 'Utenti') ?> — vector-box</title>
    <script src="../js/csrf.js?v=<?= $v ?>"></script>
    <script src="../js/i18n.js?v=<?= $v ?>"></script>
    <script src="../js/i18n-ui.js?v=<?= $v ?>"></script>
    <link rel="stylesheet" href="../css/giochi.css?v=4">
    <link rel="stylesheet" href="../css/admin_users.css?v=<?= $v ?>">
    <script src="../js/admin_users.js?v=<?= $v ?>" defer></script>
</head>
<body>
    <header class="top">
        <a class="home" href="../index.php">vector-box</a>
        <nav class="au-nav">
            <a href="mail.php" class="lang au-wide"><?= tt('Mail', 'Posta') ?></a>
            <a href="newsletter.php" class="lang au-wide">Newsletter</a>
            <a href="account.php" class="lang au-wide"><?= tt('Account', 'Account') ?></a>
        </nav>
    </header>
    <h1 class="au-title"><?= tt('Users', 'Utenti') ?></h1>
    <main class="au">
        <section id="au-totals" class="au-totals" aria-label="<?= tt('Totals', 'Totali') ?>"></section>
        <form id="au-search" class="au-search" role="search">
            <input id="au-q" type="search"  placeholder="<?= tt('Search by name or e-mail', 'Cerca per nome o e-mail') ?>" aria-label="<?= tt('Search by name or e-mail', 'Cerca per nome o e-mail') ?>" autocomplete="off">
            <select id="au-filter" class="nav-btn" aria-label="<?= tt('Filter', 'Filtro') ?>">
                <option value="all"><?= tt('Everyone', 'Tutti') ?></option>
                <option value="admins"><?= tt('Admins', 'Amministratori') ?></option>
                <option value="banned"><?= tt('Banned or timed out', 'Bannati o sospesi') ?></option>
                <option value="email"><?= tt('With an e-mail address', 'Con un indirizzo e-mail') ?></option>
                <option value="news"><?= tt('Confirmed + wants news', 'Confermati + vogliono le novità') ?></option>
                <option value="supporters"><?= tt('Supporters', 'Sostenitori') ?></option>
                <option value="nobooks"><?= tt('Cannot read books', 'Non possono leggere i libri') ?></option>
            </select>
            <button type="submit" class="nav-btn"><?= tt('SEARCH', 'CERCA') ?></button>
        </form>
        <div class="au-grid">
            <div>
                <div id="au-list" class="au-list" aria-live="polite"></div>
                <div class="au-pager"><button type="button" class="nav-btn" id="au-prev">‹</button><span id="au-page"></span><button type="button" class="nav-btn" id="au-next">›</button></div>
            </div>
            <aside id="au-detail" class="au-detail" hidden aria-label="<?= tt('User details', 'Dettagli utente') ?>"></aside>
        </div>
        <section class="au-logbox" aria-labelledby="au-log-title">
            <h2 id="au-log-title"><?= tt('Admin actions', 'Azioni degli admin') ?></h2>
            <div id="au-log" class="au-log" aria-live="polite"></div>
            <button type="button" class="nav-btn" id="au-log-more" hidden><?= tt('Older', 'Più vecchie') ?></button>
        </section>
    </main>
</body>
</html>
