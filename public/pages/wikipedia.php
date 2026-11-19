<?php
// public/pages/wikipedia.php — front page of the offline copy of the Italian Wikipedia that this server hosts.
// The copy itself is served by kiwix-serve (a Docker container on the server, only reachable through nginx at /wiki/);
// this page only explains it, gives a search box and the credit the licence asks for. It sets no cookie and stores nothing.
// shortcut: one fixed copy (Italian, no images); a language/edition picker only if people ask for it.
require_once __DIR__ . '/../includes/head.php';

$lang = pageLang();
$it = $lang === 'it';
$other = $it ? 'en' : 'it';
$ZIM = 'wikipedia_it_all_nopic';   // the "name" kiwix-serve gives the book: /wiki/content/<name>/A/<article>
$edition = '2026-11';
$v = (string)@filemtime(__DIR__ . '/../css/wikipedia.css');
?>
<!DOCTYPE html>
<html lang="<?= $lang ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#16141c">
    <title><?= $it ? 'Wikipedia offline' : 'Offline Wikipedia' ?> — vector-box</title>
    <?= socialMeta($it ? 'Wikipedia offline — vector-box' : 'Offline Wikipedia — vector-box',
        $it ? 'Una copia della Wikipedia in italiano ospitata su vector-box: si legge anche senza internet fuori casa e senza pubblicità.'
            : 'A copy of the Italian Wikipedia hosted on vector-box: no ads, no tracking.',
        '/pages/wikipedia.php', '/assets/og/desktop.jpg') ?>
    <link rel="stylesheet" href="../css/giochi.css?v=4">
    <link rel="stylesheet" href="../css/wikipedia.css?v=<?= $v ?>">
</head>
<body>
    <header class="top">
        <a class="home" href="../index.php">vector-box</a>
        <a class="lang" href="?lang=<?= $other ?>" hreflang="<?= $other ?>"><?= strtoupper($other) ?></a>
    </header>

    <main class="doc">
        <h1><?= $it ? 'Wikipedia offline' : 'Offline Wikipedia' ?></h1>
        <p class="muted"><?= $it ? 'Edizione di novembre 2026, in italiano, senza immagini.' : 'November 2026 edition, in Italian, without images.' ?></p>
        <p><?= $it
            ? 'Questa è una copia di Wikipedia in italiano che vive su questo server: niente pubblicità, niente tracciamento e nessun account. Gli articoli sono quelli della data indicata, quindi non vedi le modifiche più recenti.'
            : 'This is a copy of the Italian Wikipedia that lives on this server: no ads, no tracking and no account. The articles are those of the date shown, so you do not see the latest edits.' ?></p>

        <form class="wiki-search" action="/wiki/search" method="get" role="search">
            <input type="hidden" name="content" value="<?= htmlspecialchars($ZIM) ?>">
            <label for="wiki-q" class="sr-only"><?= $it ? 'Cerca in Wikipedia' : 'Search Wikipedia' ?></label>
            <input id="wiki-q" type="search" name="pattern" required maxlength="200" autocomplete="off"
                   placeholder="<?= $it ? 'Cerca un articolo…' : 'Search for an article…' ?>">
            <button type="submit" class="cta"><?= $it ? 'Cerca' : 'Search' ?></button>
        </form>
        <p><a href="/wiki/"><?= $it ? 'Sfoglia dall\'inizio →' : 'Browse from the start →' ?></a></p>

        <h2><?= $it ? 'Da dove viene' : 'Where it comes from' ?></h2>
        <ul>
            <li><?= $it
                ? 'Il contenuto è di <a href="https://it.wikipedia.org" rel="noopener">Wikipedia</a> e dei suoi autori, sotto licenza <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.it" rel="noopener">Creative Commons Attribuzione – Condividi allo stesso modo 4.0</a>. Ogni articolo ha la sua cronologia e l\'elenco degli autori sul sito originale.'
                : 'The content comes from <a href="https://it.wikipedia.org" rel="noopener">Wikipedia</a> and its authors, under the <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="noopener">Creative Commons Attribution-ShareAlike 4.0</a> licence. Each article has its history and list of authors on the original site.' ?></li>
            <li><?= $it
                ? 'Il pacchetto è preparato dal progetto <a href="https://www.kiwix.org" rel="noopener">Kiwix</a> (formato ZIM) e servito da un loro programma libero.'
                : 'The package is made by the <a href="https://www.kiwix.org" rel="noopener">Kiwix</a> project (ZIM format) and served by their free software.' ?></li>
            <li><?= $it
                ? 'Non è Wikipedia e non è collegato alla Wikimedia Foundation: per correggere un articolo, modificalo sul sito vero.'
                : 'It is not Wikipedia and is not affiliated with the Wikimedia Foundation: to fix an article, edit it on the real site.' ?></li>
        </ul>
        <p class="muted"><?= $it ? 'Privacy: questa pagina non salva nulla; come per tutto il sito vale la' : 'Privacy: this page stores nothing; as for the whole site, see the' ?>
            <a href="privacy.php"><?= $it ? 'pagina privacy' : 'privacy page' ?></a>.</p>
    </main>
</body>
</html>
