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
$v = max(filemtime(__DIR__ . '/../js/admin_users.js'), filemtime(__DIR__ . '/../css/admin_users.css'));
?>
<!DOCTYPE html>
<html lang="<?= pageLang() ?>">
<head>
    <?php renderHead(tt('SYSTEM // USERS', 'SISTEMA // UTENTI'), true); ?>
    <link rel="stylesheet" href="../css/admin_users.css?v=<?php echo $v; ?>">
    <script src="../js/admin_users.js?v=<?php echo $v; ?>" defer></script>
</head>
<body>
    <canvas id="canvas"></canvas>
    <header class="cyber-header">
        <div class="glitch">// VECTOR-BOX // <?= tt('USERS', 'UTENTI') ?></div>
        <nav class="au-nav">
            <a href="mail.php" class="nav-btn"><?= tt('MAIL BOX', 'CASELLA E-MAIL') ?></a>
            <a href="account.php" class="nav-btn"><_ <?= tt('ACCOUNT', 'ACCOUNT') ?></a>
        </nav>
    </header>
    <main class="au">
        <section id="au-totals" class="au-totals" aria-label="<?= tt('Totals', 'Totali') ?>"></section>
        <form id="au-search" class="au-search" role="search">
            <input id="au-q" type="search" class="terminal-input" placeholder="<?= tt('Search by name or e-mail', 'Cerca per nome o e-mail') ?>" aria-label="<?= tt('Search by name or e-mail', 'Cerca per nome o e-mail') ?>" autocomplete="off">
            <select id="au-filter" class="nav-btn" aria-label="<?= tt('Filter', 'Filtro') ?>">
                <option value="all"><?= tt('Everyone', 'Tutti') ?></option>
                <option value="admins"><?= tt('Admins', 'Amministratori') ?></option>
                <option value="banned"><?= tt('Banned or timed out', 'Bannati o sospesi') ?></option>
                <option value="email"><?= tt('With an e-mail address', 'Con un indirizzo e-mail') ?></option>
                <option value="news"><?= tt('Confirmed + wants news', 'Confermati + vogliono le novità') ?></option>
                <option value="supporters"><?= tt('Supporters', 'Sostenitori') ?></option>
                <option value="nobooks"><?= tt('Cannot read books', 'Non possono leggere i libri') ?></option>
            </select>
            <button type="submit" class="nav-btn">>_ <?= tt('SEARCH', 'CERCA') ?></button>
        </form>
        <div class="au-grid">
            <div>
                <div id="au-list" class="au-list" aria-live="polite"></div>
                <div class="au-pager"><button type="button" class="nav-btn" id="au-prev">‹</button><span id="au-page"></span><button type="button" class="nav-btn" id="au-next">›</button></div>
            </div>
            <aside id="au-detail" class="au-detail" hidden aria-label="<?= tt('User details', 'Dettagli utente') ?>"></aside>
        </div>
    </main>
</body>
</html>
