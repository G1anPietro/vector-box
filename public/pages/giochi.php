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
        'group' => 'friends', 'look' => 'botola', 'href' => 'botola.html', 'icon' => '../assets/botola/icon.svg',
        'name' => ['it' => 'Botola', 'en' => 'Botola'],
        'line' => ['it' => 'Quiz a eliminazione: sbagli e la botola si apre sotto di te.',
                   'en' => 'Elimination quiz: get it wrong and the trapdoor opens under you.'],
        'who'  => ['it' => '2–8 giocatori', 'en' => '2–8 players'],
        'how'  => ['it' => 'un telefono da passare', 'en' => 'one phone to pass around'],
    ],
    [
        'group' => 'friends', 'look' => 'cucu', 'href' => 'cucu.html', 'icon' => '../assets/cucu/icon.svg',
        'name' => ['it' => 'Cucù', 'en' => 'Cucù'],
        'line' => ['it' => 'Una carta a testa: tieni o cambia col vicino, il Re blocca. Le vite si ricordano a memoria.',
                   'en' => 'One card each: keep it or swap with your neighbour, the King blocks. Lives are kept in your head.'],
        'who'  => ['it' => '2–20 giocatori', 'en' => '2–20 players'],
        'how'  => ['it' => 'un telefono a testa', 'en' => 'one phone each'],
    ],
    [
        'group' => 'friends', 'look' => 'poker', 'href' => '../desktop.php', 'icon' => '♠',
        'name' => ['it' => 'Poker', 'en' => 'Poker'],
        'line' => ['it' => 'Texas Hold’em a fiches finte, nella finestra POKER del desktop.',
                   'en' => 'Texas Hold’em with play chips, in the POKER window of the desktop.'],
        'who'  => ['it' => 'fino a 4 al tavolo, anche con i bot', 'en' => 'up to 4 at the table, bots included'],
        'how'  => ['it' => 'serve un account', 'en' => 'needs an account'],
    ],
    [
        'group' => 'solo', 'look' => 'skillcheck', 'href' => 'skillcheck.html', 'icon' => '../assets/skillcheck/icon.svg',
        'name' => ['it' => 'Skill check', 'en' => 'Skill check'],
        'line' => ['it' => 'La lancetta gira: tocca quando è nella zona verde. Più vai avanti, più è piccola e veloce.',
                   'en' => 'The needle goes round: tap when it is in the green zone. The further you go, the smaller and faster.'],
        'who'  => ['it' => '1 giocatore', 'en' => '1 player'],
        'how'  => ['it' => 'funziona anche offline', 'en' => 'works offline too'],
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
        'group' => 'solo', 'look' => 'breach', 'href' => 'parola.html', 'icon' => '../assets/parola/icon.svg',
        'name' => ['it' => 'Parola del giorno', 'en' => 'Word of the day'],
        'line' => ['it' => 'Indovina la parola italiana di 5 lettere in 6 tentativi: una nuova ogni giorno, uguale per tutti.',
                   'en' => 'Guess the 5-letter Italian word in 6 tries: a new one every day, the same for everybody.'],
        'who'  => ['it' => '1 giocatore', 'en' => '1 player'],
        'how'  => ['it' => 'serie di vittorie, senza account', 'en' => 'win streaks, no account'],
    ],
    [
        'group' => 'solo', 'look' => 'breach', 'href' => 'dungeon.html', 'icon' => '../assets/dungeon/icon.svg',
        'name' => ['it' => 'Il Dungeon del Server', 'en' => 'The Server Dungeon'],
        'line' => ['it' => 'Roguelike a turni: scendi nel datacentre sotto la scuola tra bug, script e chiavette. Salva da solo a ogni turno.',
                   'en' => 'Turn-based roguelike: descend into the datacentre under the school past bugs, scripts and USB sticks. Saves itself every turn.'],
        'who'  => ['it' => '1 giocatore', 'en' => '1 player'],
        'how'  => ['it' => 'si gioca col pollice o da tastiera', 'en' => 'thumb or keyboard'],
    ],
    [
        'group' => 'solo', 'look' => 'breach', 'href' => 'tetris.html', 'icon' => '../assets/tetris/icon.svg',
        'name' => ['it' => 'Tetris', 'en' => 'Tetris'],
        'line' => ['it' => 'I pezzi cadono, tu completi le righe: livelli sempre più veloci, anteprima e caduta veloce.',
                   'en' => 'The pieces fall, you complete the lines: faster levels, next-piece preview and hard drop.'],
        'who'  => ['it' => '1 giocatore', 'en' => '1 player'],
        'how'  => ['it' => 'tastiera o tasti sullo schermo', 'en' => 'keyboard or on-screen buttons'],
    ],
    [
        'group' => 'solo', 'look' => 'breach', 'href' => 'forza4.html', 'icon' => '../assets/forza4/icon.svg',
        'name' => ['it' => 'Forza 4', 'en' => 'Connect Four'],
        'line' => ['it' => 'Quattro dischi in fila per vincere: contro il computer (tre livelli) o in due sullo stesso schermo.',
                   'en' => 'Four discs in a row to win: against the computer (three levels) or two players on one screen.'],
        'who'  => ['it' => '1–2 giocatori', 'en' => '1–2 players'],
        'how'  => ['it' => 'senza account', 'en' => 'no account'],
    ],
    [
        'group' => 'solo', 'look' => 'breach', 'href' => 'impiccato.html', 'icon' => '../assets/impiccato/icon.svg',
        'name' => ['it' => 'Impiccato', 'en' => 'Hangman'],
        'line' => ['it' => 'Indovina la parola italiana prima di finire le vite: animali, cibo, città, scuola, oggetti.',
                   'en' => 'Guess the Italian word before you run out of lives: animals, food, cities, school, objects.'],
        'who'  => ['it' => '1 giocatore', 'en' => '1 player'],
        'how'  => ['it' => 'serie di vittorie, senza account', 'en' => 'win streaks, no account'],
    ],
    [
        'group' => 'solo', 'look' => 'breach', 'href' => 'simon.html', 'icon' => '../assets/simon/icon.svg',
        'name' => ['it' => 'Simon', 'en' => 'Simon'],
        'line' => ['it' => 'Guarda la sequenza di luci e suoni e ripetila: ogni turno una in più.',
                   'en' => 'Watch the sequence of lights and sounds and repeat it: one more each round.'],
        'who'  => ['it' => '1 giocatore', 'en' => '1 player'],
        'how'  => ['it' => 'con o senza suono', 'en' => 'with or without sound'],
    ],
    [
        'group' => 'solo', 'look' => 'breach', 'href' => 'memory.html', 'icon' => '../assets/memory/icon.svg',
        'name' => ['it' => 'Memory', 'en' => 'Memory'],
        'line' => ['it' => 'Trova tutte le coppie con meno mosse possibile: tre livelli e record personali.',
                   'en' => 'Find all the pairs in as few moves as you can: three levels and personal bests.'],
        'who'  => ['it' => '1 giocatore', 'en' => '1 player'],
        'how'  => ['it' => 'senza account', 'en' => 'no account'],
    ],
    [
        'group' => 'solo', 'look' => 'breach', 'href' => 'tris.html', 'icon' => '../assets/tris/icon.svg',
        'name' => ['it' => 'Tris', 'en' => 'Tic-tac-toe'],
        'line' => ['it' => 'Contro il computer (facile, medio o imbattibile) o in due sullo stesso schermo.',
                   'en' => 'Against the computer (easy, medium or unbeatable) or two players on one screen.'],
        'who'  => ['it' => '1–2 giocatori', 'en' => '1–2 players'],
        'how'  => ['it' => 'senza account', 'en' => 'no account'],
    ],
    [
        'group' => 'solo', 'look' => 'breach', 'href' => 'snake.html', 'icon' => '../assets/snake/icon.svg',
        'name' => ['it' => 'Snake', 'en' => 'Snake'],
        'line' => ['it' => 'Mangia, cresci e non toccare i muri né te stesso. Più mangi, più corri.',
                   'en' => 'Eat, grow and do not touch the walls or yourself. The more you eat, the faster it gets.'],
        'who'  => ['it' => '1 giocatore', 'en' => '1 player'],
        'how'  => ['it' => 'frecce o scorrimento', 'en' => 'arrow keys or swipe'],
    ],
    [
        'group' => 'solo', 'look' => 'breach', 'href' => 'difesa.html', 'icon' => '../assets/difesa/icon.svg',
        'name' => ['it' => 'Difendi il server', 'en' => 'Defend the server'],
        'line' => ['it' => 'Tower defense: costruisci firewall, antivirus e IDS per fermare i virus prima che arrivino al nucleo. 30 ondate.',
                   'en' => 'Tower defense: build firewalls, antivirus and IDS towers to stop the viruses before they reach the core. 30 waves.'],
        'who'  => ['it' => '1 giocatore', 'en' => '1 player'],
        'how'  => ['it' => 'a partite lunghe, senza account', 'en' => 'longer games, no account'],
    ],
    [
        'group' => 'solo', 'look' => 'breach', 'href' => 'vita.html', 'icon' => '../assets/vita/icon.svg',
        'name' => ['it' => 'Gioco della vita', 'en' => 'Game of Life'],
        'line' => ['it' => 'Disegna le cellule e guardale nascere e morire secondo le regole di Conway. Con alianti, pulsar e un cannone.',
                   'en' => 'Draw cells and watch them be born and die by Conway\'s rules. With gliders, a pulsar and a glider gun.'],
        'who'  => ['it' => '1 giocatore', 'en' => '1 player'],
        'how'  => ['it' => 'senza fretta, senza account', 'en' => 'no rush, no account'],
    ],
    [
        'group' => 'solo', 'look' => 'breach', 'href' => 'dueamila.html', 'icon' => '../assets/dueamila/icon.svg',
        'name' => ['it' => '2048', 'en' => '2048'],
        'line' => ['it' => 'Scorri per unire i numeri uguali e arriva a 2048. Frecce, tasti W A S D o dito sulla griglia.',
                   'en' => 'Slide to merge equal numbers and reach 2048. Arrow keys, W A S D or a finger on the grid.'],
        'who'  => ['it' => '1 giocatore', 'en' => '1 player'],
        'how'  => ['it' => 'record personale, senza account', 'en' => 'personal best, no account'],
    ],
    [
        'group' => 'solo', 'look' => 'breach', 'href' => 'minato.html', 'icon' => '../assets/minato/icon.svg',
        'name' => ['it' => 'Campo minato', 'en' => 'Minesweeper'],
        'line' => ['it' => 'Tre livelli, bandierine, tocco lungo sul telefono e frecce sulla tastiera. Il primo clic è sempre sicuro.',
                   'en' => 'Three levels, flags, long-press on a phone and arrow keys on a keyboard. The first click is always safe.'],
        'who'  => ['it' => '1 giocatore', 'en' => '1 player'],
        'how'  => ['it' => 'record personali, senza account', 'en' => 'personal bests, no account'],
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
    <?= socialMeta($lang === 'it' ? 'Giochi — vector-box' : 'Games — vector-box', $lang === 'it'
        ? 'Giochi da festa da fare con il telefono (Chi è la spia?, Lupus, Non ho mai…) e giochi da soli, gratis nel browser.'
        : 'Party games to play with your phone (Who’s the spy?, Lupus, Never have I ever…) and solo games, free in the browser.',
        '/pages/giochi.php') ?>
    <link rel="icon" href="../assets/solitario/icon.svg?v=1" type="image/svg+xml">
    <link rel="stylesheet" href="../css/giochi.css?v=4">
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

        <p class="lead"><a href="classifiche.php"><?= $lang === 'it' ? 'Classifiche dei giochi →' : 'Game leaderboards →' ?></a></p>

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
        <?php if (donationsOn()): ?><a href="dona.php">☕ <?= $lang === 'it' ? 'Offrimi un caffè' : 'Buy me a coffee' ?></a><?php endif; ?>
        <a href="ads.php"><?= $lang === 'it' ? 'Supporta vector-box' : 'Support vector-box' ?></a>
        <a href="progetto.php"><?= $lang === 'it' ? 'Il progetto' : 'About the project' ?></a>
        <a href="privacy.php">Privacy</a>
        <a href="sicurezza.php"><?= $lang === 'it' ? 'Sicurezza' : 'Security' ?></a>
        <?= adsCookieLink($lang) ?>
        <a href="https://github.com/G1anPietro/vector-box" rel="noopener"><?= $lang === 'it' ? 'Codice sorgente' : 'Source code' ?></a>
        <a href="../index.php"><?= $lang === 'it' ? 'Torna al sito' : 'Back to the site' ?></a>
    </footer>
</body>
</html>
