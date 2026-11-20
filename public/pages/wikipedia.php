<?php
// public/pages/wikipedia.php — front page of the offline copy of the Italian Wikipedia that this server hosts.
// The copy itself is served by kiwix-serve (a Docker container on the server, only reachable through nginx at /wiki/);
// this page only explains it, gives a search box and the credit the licence asks for. It sets no cookie and stores nothing.
// shortcut: one fixed copy (Italian, no images); a language/edition picker only if people ask for it.
require_once __DIR__ . '/../includes/head.php';

$lang = pageLang();
$it = $lang === 'it';
$other = $it ? 'en' : 'it';
$full = true;   // false: the small provisional copy (only the introduction of the most read articles); true once the full file (30 GB, with images) is served
$ZIM = $full ? 'wikipedia_it_all_maxi_2026-08' : 'wikipedia_it_top_mini_2026-10';   // kiwix-serve names a book after its file (without .zim): /wiki/content/<name>/<article>
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
        <p class="muted"><?= $full
            ? ($it ? 'Edizione di agosto 2026, in italiano, con le immagini.' : 'August 2026 edition, in Italian, with images.')
            : ($it ? 'Versione provvisoria di ottobre 2026, in italiano.' : 'Provisional October 2026 version, in Italian.') ?></p>
<?php if (!$full): ?>
        <p class="notice-prov"><?= $it
            ? 'Per ora c\'è solo una copia piccola: per ogni articolo trovi l\'introduzione, senza immagini, e solo per gli articoli più letti. La versione completa, con tutti gli articoli e le immagini, è in arrivo.'
            : 'For now this is a small copy: each article has only its introduction, without images, and only the most read articles are included. The full version, with every article and the images, is on its way.' ?></p>
<?php endif; ?>
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
