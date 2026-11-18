<?php
// public/pages/classifiche.php — the Top 10 of every arcade game that has a leaderboard (data: api/game_scores.php, drawn by js/arcade-scores.js).
// To add a board: a rule in api/game_scores_lib.php, then an entry in $BOARDS below.
require_once __DIR__ . '/../includes/head.php';

$lang = pageLang();
$it = $lang === 'it';
$other = $it ? 'en' : 'it';
// [game id, [title it, title en], page, variants (variant id => [it, en]) or null]
$BOARDS = [
    ['tetris', ['Tetris', 'Tetris'], 'tetris.html', null],
    ['dueamila', ['2048', '2048'], 'dueamila.html', null],
    ['snake', ['Snake', 'Snake'], 'snake.html', null],
    ['minato', ['Campo minato (tempo migliore)', 'Minesweeper (best time)'], 'minato.html',
        ['easy' => ['Facile', 'Easy'], 'medium' => ['Medio', 'Medium'], 'hard' => ['Difficile', 'Hard']]],
];
$h = fn(string $s) => htmlspecialchars($s);
$title = $it ? 'Classifiche — vector-box' : 'Leaderboards — vector-box';
?>
<!DOCTYPE html>
<html lang="<?= $lang ?>" data-lang-server>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#16141c">
    <title><?= $h($title) ?></title>
    <?= socialMeta($title, $it ? 'Le classifiche dei giochi: Tetris, 2048, Snake e Campo minato. Serve un account per entrarci.'
                               : 'The game leaderboards: Tetris, 2048, Snake and Minesweeper. You need an account to enter.', '/pages/classifiche.php') ?>
    <link rel="stylesheet" href="../css/giochi.css?v=4">
    <link rel="stylesheet" href="../css/arcade-scores.css?v=<?= (int)@filemtime(__DIR__ . '/../css/arcade-scores.css') ?>">
    <script src="../js/i18n.js?v=<?= (int)@filemtime(__DIR__ . '/../js/i18n.js') ?>"></script>
    <script src="../js/arcade-scores.js?v=<?= (int)@filemtime(__DIR__ . '/../js/arcade-scores.js') ?>" defer></script>
</head>
<body class="shelf-page">
    <header class="top">
        <a class="home" href="../index.php">vector-box</a>
        <a class="lang" href="?lang=<?= $other ?>" hreflang="<?= $other ?>"><?= strtoupper($other) ?></a>
    </header>

    <main class="wrap">
        <h1><?= $it ? 'Classifiche' : 'Leaderboards' ?></h1>
        <p class="lead"><?= $it
            ? 'I migliori risultati dei giochi. Per entrare in classifica serve un account: il risultato si invia da solo a fine partita e resta solo il tuo migliore.'
            : 'The best results of the games. You need an account to enter: your result is sent by itself when a game ends and only your best is kept.' ?></p>
        <?php foreach ($BOARDS as [$id, $name, $page, $variants]): ?>
            <section class="group">
                <h2><a href="<?= $h($page) ?>"><?= $h($name[$it ? 0 : 1]) ?></a></h2>
                <div class="vbs-grid">
                <?php foreach ($variants ?? ['' => null] as $v => $label): ?>
                    <div class="vbs-cell">
                        <?php if ($label): ?><h3><?= $h($label[$it ? 0 : 1]) ?></h3><?php endif; ?>
                        <div class="vbs-slot" data-vbs="<?= $h($id) ?>" data-variant="<?= $h((string)$v) ?>"></div>
                    </div>
                <?php endforeach; ?>
                </div>
            </section>
        <?php endforeach; ?>
    </main>

    <footer class="foot">
        <a href="giochi.php"><?= $it ? 'Tutti i giochi' : 'All games' ?></a>
        <a href="privacy.php">Privacy</a>
        <a href="../index.php"><?= $it ? 'Torna al sito' : 'Back to the site' ?></a>
    </footer>
</body>
</html>
