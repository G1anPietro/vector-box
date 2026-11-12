<?php
// public/pages/giochi.php — every game on the site, as a shelf of game boxes.
// Each box wears its game's own colours and type. To add a game, add an entry to $GAMES.
define('VB_ADS_PAGE', true);
require_once __DIR__ . '/../includes/head.php';
require_once __DIR__ . '/../includes/ads.php';

$lang = pageLang();
$T = fn(array $s) => htmlspecialchars($s[$lang] ?? $s['it']);

// group: 'friends' | 'solo'. look: CSS class of the box. icon: image path or a single glyph.
$GAMES = [
    [
        'group' => 'friends', 'look' => 'spia', 'href' => 'spia.html', 'icon' => '../assets/spia/icon.svg',
        'name' => ['it' => 'Chi è la spia?', 'en' => "Who's the spy?"],
        'line' => ['it' => 'Tutti conoscono il luogo segreto, tranne la spia. Fate domande, bluffate, votate.',
                   'en' => 'Everyone knows the secret place except the spy. Ask, bluff, vote.'],
        'who'  => ['it' => '3–20 giocatori', 'en' => '3–20 players'],
        'how'  => ['it' => 'un telefono da passare, o uno a testa', 'en' => 'one phone to pass around, or one each'],
    ],
    [
        'group' => 'friends', 'look' => 'lupus', 'href' => 'lupus.html', 'icon' => '../assets/lupus/icon.svg',
        'name' => ['it' => 'Lupus', 'en' => 'Lupus'],
        'line' => ['it' => 'Di notte gli assassini scelgono una vittima, di giorno il villaggio sceglie chi giustiziare.',
                   'en' => 'At night the killers pick a victim; by day the village picks who to hang.'],
        'who'  => ['it' => '4–20 giocatori', 'en' => '4–20 players'],
        'how'  => ['it' => 'un telefono a testa, o uno da passare', 'en' => 'one phone each, or one to pass around'],
    ],
    [
        'group' => 'friends', 'look' => 'nonhomai', 'href' => 'nonhomai.html', 'icon' => '../assets/nonhomai/icon.svg',
        'name' => ['it' => 'Non ho mai…', 'en' => 'Never have I ever…'],
        'line' => ['it' => 'Un sottobicchiere, una frase alla volta. Chi l’ha fatto perde una vita.',
                   'en' => 'One coaster, one sentence at a time. If you have done it, you lose a life.'],
        'who'  => ['it' => '2 o più giocatori', 'en' => '2 or more players'],
        'how'  => ['it' => 'un telefono in mezzo al tavolo', 'en' => 'one phone in the middle of the table'],
    ],
    [
        'group' => 'friends', 'look' => 'poker', 'href' => '../index.php', 'icon' => '♠',
        'name' => ['it' => 'Poker', 'en' => 'Poker'],
        'line' => ['it' => 'Texas Hold’em a fiches finte, nella finestra POKER del desktop.',
                   'en' => 'Texas Hold’em with play chips, in the POKER window of the desktop.'],
        'who'  => ['it' => 'fino a 4 al tavolo, anche con i bot', 'en' => 'up to 4 at the table, bots included'],
        'how'  => ['it' => 'serve un account', 'en' => 'needs an account'],
    ],
    [
        'group' => 'solo', 'look' => 'solitario', 'href' => 'solitario.html', 'icon' => '../assets/solitario/icon.svg',
        'name' => ['it' => 'Solitario', 'en' => 'Solitaire'],
        'line' => ['it' => 'Il Klondike di sempre: trascina, doppio clic, suggerimenti, quattro tavoli.',
                   'en' => 'Classic Klondike: drag, double-click, hints, four tables.'],
        'who'  => ['it' => '1 giocatore', 'en' => '1 player'],
        'how'  => ['it' => 'funziona anche offline', 'en' => 'works offline too'],
    ],
    [
        'group' => 'solo', 'look' => 'breach', 'href' => 'hack.php', 'icon' => '⌗',
        'name' => ['it' => 'Node Breach', 'en' => 'Node Breach'],
        'line' => ['it' => 'Trova la sequenza esadecimale nella griglia prima che scada il tempo.',
                   'en' => 'Find the hex sequence in the grid before time runs out.'],
        'who'  => ['it' => '1 giocatore', 'en' => '1 player'],
        'how'  => ['it' => 'manche da 15 secondi', 'en' => '15-second rounds'],
    ],
    [
        'group' => 'solo', 'look' => 'vault', 'href' => 'vault.php', 'icon' => '⚿',
        'name' => ['it' => 'ARG Vault', 'en' => 'ARG Vault'],
        'line' => ['it' => 'Le chiavi sono nascoste in giro per il sito. Trovale e apri i file riservati.',
                   'en' => 'The keys are hidden around the site. Find them and open the classified files.'],
        'who'  => ['it' => '1 giocatore', 'en' => '1 player'],
        'how'  => ['it' => 'caccia al tesoro, senza fretta', 'en' => 'a treasure hunt, no rush'],
    ],
];

$GROUPS = [
    'friends' => ['it' => 'Con gli amici', 'en' => 'With friends'],
    'solo'    => ['it' => 'Da solo', 'en' => 'On your own'],
];
$other = $lang === 'it' ? 'en' : 'it';

function gameBox(array $g, callable $T): void { ?>
    <a class="box <?= htmlspecialchars($g['look']) ?>" href="<?= htmlspecialchars($g['href']) ?>">
        <span class="lid">
            <?php if (str_contains($g['icon'], '/')): ?>
                <img class="icon" src="<?= htmlspecialchars($g['icon']) ?>?v=2" alt="" width="56" height="56">
            <?php else: ?>
                <span class="icon glyph" aria-hidden="true"><?= htmlspecialchars($g['icon']) ?></span>
            <?php endif; ?>
            <span class="name"><?= $T($g['name']) ?></span>
        </span>
        <span class="line"><?= $T($g['line']) ?></span>
        <span class="facts"><b><?= $T($g['who']) ?></b><span><?= $T($g['how']) ?></span></span>
    </a>
<?php }
?>
<!DOCTYPE html>
<html lang="<?= $lang ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#16141c">
    <title><?= $lang === 'it' ? 'Giochi — vector-box' : 'Games — vector-box' ?></title>
    <meta name="description" content="<?= $lang === 'it'
        ? 'Giochi da festa da fare con il telefono (Chi è la spia?, Lupus, Non ho mai…) e giochi da soli, gratis nel browser.'
        : 'Party games to play with your phone (Who’s the spy?, Lupus, Never have I ever…) and solo games, free in the browser.' ?>">
    <link rel="icon" href="../assets/solitario/icon.svg?v=1" type="image/svg+xml">
    <link rel="stylesheet" href="../css/giochi.css?v=1">
    <?= adsScriptTag() ?>
</head>
<body class="shelf-page">
    <header class="top">
        <a class="home" href="../index.php">vector-box</a>
        <a class="lang" href="?lang=<?= $other ?>" hreflang="<?= $other ?>"><?= strtoupper($other) ?></a>
    </header>

    <main class="wrap">
        <h1><?= $lang === 'it' ? 'Giochi' : 'Games' ?></h1>
        <p class="lead"><?= $lang === 'it'
            ? 'Si gioca dal browser, senza scaricare niente e senza account (tranne il poker). Per i giochi da festa basta un telefono in mezzo al tavolo.'
            : 'Play in the browser, nothing to install and no account needed (except poker). For the party games one phone on the table is enough.' ?></p>

        <?php $first = true; foreach ($GROUPS as $key => $title): ?>
            <?php if (!$first) echo adsSlot('ADSENSE_SLOT_GAMES', $lang); $first = false; ?>
            <section class="group">
                <h2><?= $T($title) ?></h2>
                <div class="boxes">
                    <?php foreach ($GAMES as $g) if ($g['group'] === $key) gameBox($g, $T); ?>
                </div>
            </section>
        <?php endforeach; ?>
    </main>

    <footer class="foot">
        <a href="ads.php"><?= $lang === 'it' ? 'Supporta vector-box' : 'Support vector-box' ?></a>
        <a href="privacy.php">Privacy</a>
        <a href="https://github.com/G1anPietro/vector-box" rel="noopener"><?= $lang === 'it' ? 'Codice sorgente' : 'Source code' ?></a>
        <a href="../index.php"><?= $lang === 'it' ? 'Torna al sito' : 'Back to the site' ?></a>
    </footer>
</body>
</html>
