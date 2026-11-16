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
<html lang="en">
<head>
    <?php renderHead("SYSTEM // USERS", true); ?>
    <link rel="stylesheet" href="../css/admin_users.css?v=<?php echo $v; ?>">
    <script src="../js/admin_users.js?v=<?php echo $v; ?>" defer></script>
</head>
<body>
    <canvas id="canvas"></canvas>
    <header class="cyber-header">
        <div class="glitch">// VECTOR-BOX // USERS</div>
        <nav class="au-nav">
            <a href="mail.php" class="nav-btn">MAIL BOX</a>
            <a href="account.php" class="nav-btn"><_ ACCOUNT</a>
        </nav>
    </header>
    <main class="au">
        <section id="au-totals" class="au-totals" aria-label="Totals"></section>
        <form id="au-search" class="au-search" role="search">
            <input id="au-q" type="search" class="terminal-input" placeholder="Search by name or e-mail" aria-label="Search by name or e-mail" autocomplete="off">
            <select id="au-filter" class="nav-btn" aria-label="Filter">
                <option value="all">Everyone</option>
                <option value="admins">Admins</option>
                <option value="banned">Banned or timed out</option>
                <option value="email">With an e-mail address</option>
                <option value="news">Confirmed + wants news</option>
                <option value="supporters">Supporters</option>
                <option value="nobooks">Cannot read books</option>
            </select>
            <button type="submit" class="nav-btn">>_ SEARCH</button>
        </form>
        <div class="au-grid">
            <div>
                <div id="au-list" class="au-list" aria-live="polite"></div>
                <div class="au-pager"><button type="button" class="nav-btn" id="au-prev">‹</button><span id="au-page"></span><button type="button" class="nav-btn" id="au-next">›</button></div>
            </div>
            <aside id="au-detail" class="au-detail" hidden aria-label="User details"></aside>
        </div>
    </main>
</body>
</html>
