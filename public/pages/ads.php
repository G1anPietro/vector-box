<?php
// public/pages/ads.php — "Support vector-box". It used to be an "ad wall" (a page made only of ad
// slots that asked people to keep it open): AdSense bans exactly that, so it is now a real page
// that explains what the site is and what keeps it running, with one labelled ad unit.
define('VB_ADS_PAGE', true);
require_once __DIR__ . '/../includes/head.php';
require_once __DIR__ . '/../includes/ads.php';

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
    <title><?= $it ? 'Supporta vector-box' : 'Support vector-box' ?></title>
    <?= socialMeta($it ? 'Supporta vector-box' : 'Support vector-box', $it ? 'Cos’è vector-box, cosa lo tiene acceso e come dargli una mano.' : 'What vector-box is, what keeps it running and how to help.', '/pages/ads.php') ?>
    <link rel="stylesheet" href="../css/giochi.css?v=1">
    <?= adsScriptTag() ?>
</head>
<body>
    <header class="top">
        <a class="home" href="../index.php">vector-box</a>
        <a class="lang" href="?lang=<?= $other ?>" hreflang="<?= $other ?>"><?= strtoupper($other) ?></a>
    </header>

    <main class="doc">
<?php if ($it): ?>
        <h1>Supporta vector-box</h1>
        <p>vector-box è un sito fatto in casa, nel senso letterale: gira su un vecchio portatile senza schermo, in una casa in Italia, ed è curato da uno studente di informatica. Dentro ci sono una chat, un lettore di libri per gli amici e dei giochi che chiunque può usare gratis, senza account.</p>

        <h2>Cosa costa tenerlo acceso</h2>
        <p>Il server è acceso giorno e notte: corrente, una chiavetta per i backup notturni e, prima o poi, pezzi di ricambio (il disco ha già dato qualche segno di stanchezza). Non sono cifre enormi, ma ci sono.</p>

        <h2>Come dare una mano</h2>
        <ul>
            <li><strong>Giocate e fate giocare.</strong> Nella pagina dei giochi c’è qualche annuncio: ogni visita aiuta un pochino a coprire le spese. Non serve cliccare niente.</li>
            <li><strong>Passate parola.</strong> Chi è la spia?, Lupus e Non ho mai… sono fatti per le serate con gli amici: se vi sono piaciuti, mandate il link a qualcuno.</li>
            <li><strong>Segnalate problemi e idee</strong> con l’Uplink nella pagina principale: arrivano direttamente a chi gestisce il sito.</li>
            <li><strong>Il codice è pubblico</strong> su <a href="https://github.com/G1anPietro/vector-box" rel="noopener">GitHub</a>: se sapete programmare, potete guardarlo e proporre modifiche.</li>
        </ul>
        <a class="cta" href="giochi.php">Vai ai giochi</a>
<?php else: ?>
        <h1>Support vector-box</h1>
        <p>vector-box is home-made, literally: it runs on an old screenless laptop in a house in Italy and is looked after by a computer science student. It has a chat, a book reader for friends, and games anyone can play for free, with no account.</p>

        <h2>What it costs to keep it running</h2>
        <p>The server is on day and night: electricity, a USB drive for the nightly backups and, sooner or later, spare parts (the disk has already shown some signs of wear). Not huge amounts, but they add up.</p>

        <h2>How to help</h2>
        <ul>
            <li><strong>Play, and get others to play.</strong> The games page shows a few ads: every visit helps a little with the costs. There is nothing to click.</li>
            <li><strong>Spread the word.</strong> Who’s the spy?, Lupus and Never have I ever… are made for evenings with friends: if you liked them, send the link to someone.</li>
            <li><strong>Report problems and ideas</strong> through the Uplink on the main page: they go straight to whoever runs the site.</li>
            <li><strong>The code is public</strong> on <a href="https://github.com/G1anPietro/vector-box" rel="noopener">GitHub</a>: if you can program, have a look and suggest changes.</li>
        </ul>
        <a class="cta" href="giochi.php">Go to the games</a>
<?php endif; ?>

        <?= adsSlot('ADSENSE_SLOT_SUPPORT', $lang) ?>
    </main>

    <footer class="foot">
        <a href="giochi.php"><?= $it ? 'Giochi' : 'Games' ?></a>
        <a href="privacy.php">Privacy</a>
        <a href="https://github.com/G1anPietro/vector-box" rel="noopener"><?= $lang === 'it' ? 'Codice sorgente' : 'Source code' ?></a>
        <a href="../index.php"><?= $it ? 'Torna al sito' : 'Back to the site' ?></a>
    </footer>
</body>
</html>
