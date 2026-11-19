<?php
// public/index.php — the menu people land on: games, class notes, account, the project and the desktop (desktop.php).
// nginx sends every unknown path here (try_files fallback): only "/" is the home page, the rest is a 404.
$reqPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
if (!in_array($reqPath, ['/', '/index.php', null, false, ''], true)) {
    require_once __DIR__ . '/api/bots.php';
    botBlockIfAbusive();
    $ua = substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 400);
    $probe = botScanLabel((string)$reqPath);
    $status = 404;
    if ($probe !== '') {
        // a scanner: after a few probes in an hour this address is told to go away without the page
        require_once __DIR__ . '/api/rate_limiter.php';
        if (!checkRateLimit('scanner', 8, 3600, null, false)) $status = 429;
    }
    $bot = botClassify($ua);
    if ($probe !== '') botRecord('scanner', $probe, (string)$reqPath, $status);
    elseif ($bot) botRecord($bot[0], $bot[1], (string)$reqPath, $status);
    http_response_code($status);
    header('Content-Type: text/html; charset=UTF-8');
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: no-store');
    if ($status === 429) { header('Retry-After: 3600'); exit("Too many requests.\n"); }
    readfile(__DIR__ . '/errors/404.html');
    exit;
}
require_once __DIR__ . '/includes/head.php';
require_once __DIR__ . '/api/database.php';
require_once __DIR__ . '/includes/home-access.php';

initSession();

$lang = pageLang();
$other = $lang === 'it' ? 'en' : 'it';
$T = fn(array $s) => htmlspecialchars($s[$lang] ?? $s['it']);
$isLoggedIn = !empty($_SESSION['username']) && !str_starts_with($_SESSION['username'], 'guest_');
$who = $isLoggedIn ? (string)$_SESSION['username'] : '';
$access = homeAccess();   // private cards (book reader, statistics) only for those allowed; the pages check again

// To add a card, add an entry here. look: CSS class of the card; glyph: a short symbol shown big.
$CARDS = [
    [
        'look' => 'games', 'href' => 'pages/giochi.php', 'glyph' => '▶',
        'name' => ['it' => 'Giochi', 'en' => 'Games'],
        'line' => ['it' => 'Giochi da festa per il telefono e giochi da soli, gratis e senza account.',
                   'en' => 'Party games for your phone and games to play alone, free and with no account.'],
    ],
    [
        'look' => 'books', 'href' => 'pages/reader.php', 'glyph' => '▤', 'private' => true, 'show' => $access['books'],
        'name' => ['it' => 'Lettore di libri', 'en' => 'Book reader'],
        'line' => ['it' => 'La biblioteca privata: leggi i libri e riprendi da dove eri rimasto.',
                   'en' => 'The private library: read the books and pick up where you left off.'],
    ],
    [
        'look' => 'notes', 'href' => 'pages/appunti.php', 'glyph' => '✎',
        'name' => ['it' => 'Appunti di classe', 'en' => 'Class notes'],
        'line' => ['it' => 'Gli appunti della classe, condivisi: cerca, ripassa e fai i quiz.',
                   'en' => 'The class notes, shared: search, review and take quizzes.'],
    ],
    [
        'look' => 'os', 'href' => 'desktop.php', 'glyph' => '>_',
        'name' => ['it' => 'Sistema operativo', 'en' => 'Operating system'],
        'line' => ['it' => 'Il desktop cyberpunk: terminale, chat, poker e finestre da spostare.',
                   'en' => 'The cyberpunk desktop: terminal, chat, poker and windows you can move.'],
    ],
    [
        'look' => 'account', 'href' => $isLoggedIn ? 'pages/account.php' : 'pages/login.php', 'glyph' => '◉',
        'name' => ['it' => 'Account', 'en' => 'Account'],
        'line' => $isLoggedIn
            ? ['it' => 'Connesso come ' . $who . ': impostazioni, dispositivi e dati.', 'en' => 'Signed in as ' . $who . ': settings, devices and data.']
            : ['it' => 'Accedi o registrati per salvare le tue cose.', 'en' => 'Sign in or register to keep your things.'],
    ],
    [
        'look' => 'news', 'href' => 'pages/novita.php', 'glyph' => '✦',
        'name' => ['it' => 'Novità', 'en' => 'News'],
        'line' => ['it' => 'Cosa c\'è di nuovo, cosa stiamo costruendo e le idee in arrivo.',
                   'en' => 'What is new, what we are building and the ideas on the way.'],
    ],
    [
        'look' => 'project', 'href' => 'pages/progetto.php', 'glyph' => '◇',
        'name' => ['it' => 'Il progetto', 'en' => 'The project'],
        'line' => ['it' => 'Cos\'è vector-box, come è fatto e a che punto siamo.',
                   'en' => 'What vector-box is, how it is built and where we are.'],
    ],
    [
        'look' => 'stats', 'href' => 'pages/stats.php', 'glyph' => '▥', 'private' => true, 'show' => $access['admin'],
        'name' => ['it' => 'Statistiche', 'en' => 'Statistics'],
        'line' => ['it' => 'Visite al sito e pagine più viste.', 'en' => 'Site visits and most viewed pages.'],
    ],
];
$title = $lang === 'it' ? 'vector-box — giochi, appunti e un desktop cyberpunk' : 'vector-box — games, class notes and a cyberpunk desktop';
?>
<!DOCTYPE html>
<html lang="<?= $lang ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#16141c">
    <title><?= htmlspecialchars($title) ?></title>
    <?= socialMeta('vector-box', tt('Games, shared class notes and a cyberpunk desktop in your browser: terminal, chat, party games for your phone and games to play alone.', 'Giochi, appunti di classe condivisi e un desktop cyberpunk nel browser: terminale, chat, giochi da festa per il telefono e giochi da soli.'), '/', '/assets/og/desktop.jpg') ?>
    <link rel="icon" href="assets/solitario/icon.svg?v=1" type="image/svg+xml">
    <link rel="stylesheet" href="css/giochi.css?v=4">
    <link rel="stylesheet" href="css/menu.css?v=<?= filemtime(__DIR__ . '/css/menu.css') ?>">
</head>
<body class="shelf-page menu-page">
    <header class="top">
        <a class="home" href="index.php">vector-box</a>
        <a class="lang" href="?lang=<?= $other ?>" hreflang="<?= $other ?>"><?= strtoupper($other) ?></a>
    </header>

    <main class="wrap">
        <h1>vector-box</h1>
        <p class="lead"><?= $lang === 'it'
            ? 'Giochi, appunti di classe e un desktop cyberpunk nel browser. Scegli dove andare.'
            : 'Games, class notes and a cyberpunk desktop in your browser. Pick where to go.' ?></p>

        <nav class="menu-cards" aria-label="<?= $lang === 'it' ? 'Menu principale' : 'Main menu' ?>">
            <?php foreach ($CARDS as $c): if (isset($c['show']) && !$c['show']) continue; ?>
                <a class="mcard <?= $c['look'] ?>" href="<?= htmlspecialchars($c['href']) ?>">
                    <?php if (!empty($c['private'])): ?><span class="badge"><?= $lang === 'it' ? 'Riservato' : 'Private' ?></span><?php endif; ?>
                    <span class="glyph" aria-hidden="true"><?= $c['glyph'] ?></span>
                    <span class="name"><?= $T($c['name']) ?></span>
                    <span class="line"><?= $T($c['line']) ?></span>
                </a>
            <?php endforeach; ?>
        </nav>

        <a class="support" href="pages/ads.php">
            <span class="heart" aria-hidden="true">&#9829;</span>
            <span class="txt">
                <span class="name"><?= $lang === 'it' ? 'Supporta vector-box' : 'Support vector-box' ?></span>
                <span class="line"><?= $lang === 'it' ? 'È gratis e resta così. Scopri cosa lo tiene acceso e come dargli una mano.' : 'It is free and stays that way. See what keeps it running and how to give it a hand.' ?></span>
            </span>
            <span class="go" aria-hidden="true">&rarr;</span>
        </a>
    </main>

    <footer class="foot">
        <a href="pages/privacy.php">Privacy</a>
        <a href="pages/sicurezza.php"><?= $lang === 'it' ? 'Sicurezza' : 'Security' ?></a>
        <a href="https://github.com/G1anPietro/vector-box" rel="noopener"><?= $lang === 'it' ? 'Codice sorgente' : 'Source code' ?></a>
    </footer>
</body>
</html>
