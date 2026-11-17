<?php
// public/pages/novita.php — the news board: what is being built right now, what comes next, what is new.
// The list comes from api/news.php and refreshes by itself (js/novita.js); items are put there with tools/news.php.
require_once __DIR__ . '/../includes/head.php';
$lang = pageLang();
$it = $lang === 'it';
$other = $it ? 'en' : 'it';
?>
<!DOCTYPE html>
<html lang="<?= $lang ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#16141c">
    <title><?= $it ? 'Novità' : 'News' ?> — vector-box</title>
    <?= socialMeta($it ? 'Novità — vector-box' : 'News — vector-box',
        $it ? 'Cosa c\'è di nuovo su vector-box e a cosa stiamo lavorando in questo momento.' : 'What is new on vector-box and what we are working on right now.',
        '/pages/novita.php', '/assets/og/desktop.jpg') ?>
    <link rel="stylesheet" href="../css/giochi.css?v=4">
    <link rel="stylesheet" href="../css/novita.css?v=1">
</head>
<body>
    <header class="top">
        <a class="home" href="../index.php">vector-box</a>
        <a class="lang" href="?lang=<?= $other ?>" hreflang="<?= $other ?>"><?= strtoupper($other) ?></a>
    </header>
    <main class="doc">
        <h1><?= $it ? 'Novità' : 'News' ?></h1>
        <p class="muted" id="nv-live"><?= $it ? 'Si aggiorna da sola.' : 'Updates by itself.' ?></p>
        <section id="nv-doing" hidden><h2><?= $it ? 'In lavorazione adesso' : 'Working on it now' ?></h2><div class="nv-list"></div></section>
        <section id="nv-planned" hidden><h2><?= $it ? 'Prossimamente' : 'Coming next' ?></h2><div class="nv-list"></div></section>
        <section id="nv-done" hidden><h2><?= $it ? 'Novità' : 'What is new' ?></h2><div class="nv-list"></div></section>
        <p id="nv-empty" class="muted" hidden><?= $it ? 'Ancora niente qui.' : 'Nothing here yet.' ?></p>
        <noscript><p><?= $it ? 'Serve JavaScript per vedere l\'elenco.' : 'JavaScript is needed to see the list.' ?></p></noscript>
    </main>
    <script src="../js/novita.js?v=1"></script>
</body>
</html>
