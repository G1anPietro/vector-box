<?php
// public/pages/come-funziona.php — "How vector-box works": a short page for whoever arrives for the first time.
// Static text (no database, no cookie). The picture is a real screenshot of the home menu on a phone (assets/home-menu.jpg).
require_once __DIR__ . '/../includes/head.php';

$lang = pageLang();
$it = $lang === 'it';
$other = $it ? 'en' : 'it';
$v = (string)@filemtime(__DIR__ . '/../css/come-funziona.css');
$title = $it ? 'Come funziona vector-box' : 'How vector-box works';
$desc = $it
    ? 'Cos\'è vector-box e come si usa in tre mosse: scegli dal menu, gioca o leggi subito, crea un account solo se ti serve.'
    : 'What vector-box is and how to use it in three steps: pick from the menu, play or read right away, create an account only if you need one.';
?>
<!DOCTYPE html>
<html lang="<?= $lang ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#16141c">
    <title><?= htmlspecialchars($title) ?> — vector-box</title>
    <?= socialMeta($title . ' — vector-box', $desc, '/pages/come-funziona.php', '/assets/og/giochi.jpg') ?>
    <link rel="stylesheet" href="../css/giochi.css?v=4">
    <link rel="stylesheet" href="../css/come-funziona.css?v=<?= $v ?>">
</head>
<body>
    <header class="top">
        <a class="home" href="../index.php">vector-box</a>
        <a class="lang" href="?lang=<?= $other ?>" hreflang="<?= $other ?>"><?= strtoupper($other) ?></a>
    </header>

    <main class="doc how">
        <h1><?= htmlspecialchars($title) ?></h1>
        <p class="lead"><?= $it
            ? 'vector-box è un sito di giochi, appunti di classe e strumenti, fatto da uno studente e ospitato su un piccolo server di casa. Si usa dal telefono o dal computer, è gratis e quasi tutto funziona senza account.'
            : 'vector-box is a site of games, shared class notes and tools, built by a student and hosted on a small home server. It works on a phone or a computer, it is free, and almost everything works without an account.' ?></p>

        <figure class="shot">
            <img src="../assets/home-menu.jpg" width="390" height="844" loading="lazy" decoding="async"
                 alt="<?= $it ? 'La pagina iniziale di vector-box sul telefono: un menu di schede grandi (Giochi, Appunti di classe, Wikipedia offline, Sistema operativo, Account, Novità, Il progetto).'
                              : 'The vector-box home page on a phone: a menu of big cards (Games, Class notes, Offline Wikipedia, Operating system, Account, News, The project).' ?>">
            <figcaption><?= $it ? 'La pagina iniziale: un menu, una scheda per ogni cosa.' : 'The home page: a menu, one card for each thing.' ?></figcaption>
        </figure>

        <h2><?= $it ? 'In tre mosse' : 'In three steps' ?></h2>
        <ol class="steps">
            <li>
                <h3><?= $it ? 'Scegli dove andare' : 'Pick where to go' ?></h3>
                <p><?= $it
                    ? 'La pagina iniziale è un menu: Giochi, Appunti di classe, Wikipedia offline, il desktop cyberpunk, Account, Novità e Il progetto. Tocca una scheda per entrare. Per tornare al menu usa il pulsante «Menu» o la scritta «vector-box» in alto.'
                    : 'The home page is a menu: Games, Class notes, Offline Wikipedia, the cyberpunk desktop, Account, News and The project. Tap a card to go in. To come back to the menu use the “Menu” button or the “vector-box” name at the top.' ?></p>
            </li>
            <li>
                <h3><?= $it ? 'Gioca o leggi subito' : 'Play or read right away' ?></h3>
                <p><?= $it
                    ? 'I giochi da soli e Wikipedia offline non chiedono niente. I giochi da festa (Chi è la spia, Lupus, Cucù, Botola) si fanno con gli amici: uno crea la stanza e gli altri entrano con il codice, ognuno dal proprio telefono, oppure se ne passa uno solo. Gli appunti hanno una classe di esempio da guardare.'
                    : 'The solo games and the offline Wikipedia ask for nothing. The party games (Who’s the spy, Lupus, Cucù, Botola) are played with friends: one creates the room and the others join with the code, each on their own phone, or you pass a single one around. The class notes have an example class you can look at.' ?></p>
            </li>
            <li>
                <h3><?= $it ? 'Un account solo se ti serve' : 'An account only if you need one' ?></h3>
                <p><?= $it
                    ? 'Con un account i tuoi record dei giochi ti seguono da un telefono all’altro, puoi scrivere in chat e usare le classi. Bastano un nome utente e una password; l’e-mail è facoltativa. Dalla pagina Account scarichi tutti i tuoi dati o cancelli l’account quando vuoi.'
                    : 'With an account your game records follow you from phone to phone, and you can write in the chat and use the classes. A username and a password are enough; the e-mail is optional. On the Account page you download all your data or delete the account whenever you like.' ?></p>
            </li>
        </ol>

        <h2><?= $it ? 'Da dove cominciare' : 'Where to start' ?></h2>
        <p class="actions">
            <a class="cta" href="giochi.php"><?= $it ? 'Giochi' : 'Games' ?></a>
            <a class="cta secondary" href="appunti.php"><?= $it ? 'Appunti di classe' : 'Class notes' ?></a>
            <a class="cta secondary" href="wikipedia.php"><?= $it ? 'Wikipedia offline' : 'Offline Wikipedia' ?></a>
        </p>

        <h2><?= $it ? 'Domande che si fanno in tanti' : 'Questions people ask' ?></h2>
        <details>
            <summary><?= $it ? 'È davvero gratis?' : 'Is it really free?' ?></summary>
            <p><?= $it ? 'Sì, e resta così. In fondo al menu c’è un invito a dare una mano se ti va, ma è solo un invito.' : 'Yes, and it stays that way. At the bottom of the menu there is an invitation to give a hand if you like, but it is only an invitation.' ?></p>
        </details>
        <details>
            <summary><?= $it ? 'Che dati raccogliete?' : 'What data do you collect?' ?></summary>
            <p><?= $it ? 'Il minimo che serve. Cosa, perché e per quanto tempo è scritto, voce per voce, nella <a href="privacy.php">pagina privacy</a>; e c’è anche una <a href="sicurezza.php">pagina sulla sicurezza</a>.' : 'The minimum it takes. What, why and for how long is written, item by item, on the <a href="privacy.php">privacy page</a>; there is also a <a href="sicurezza.php">security page</a>.' ?></p>
        </details>
        <details>
            <summary><?= $it ? 'Chi lo fa?' : 'Who makes it?' ?></summary>
            <p><?= $it ? 'Uno studente di informatica, da solo. Il codice è pubblico su <a href="https://github.com/G1anPietro/vector-box" rel="noopener">GitHub</a> e la pagina <a href="progetto.php">Il progetto</a> racconta com’è fatto.' : 'A computer-science student, alone. The code is public on <a href="https://github.com/G1anPietro/vector-box" rel="noopener">GitHub</a> and the <a href="progetto.php">The project</a> page tells how it is built.' ?></p>
        </details>
        <details>
            <summary><?= $it ? 'Dove vedo cosa c’è di nuovo?' : 'Where do I see what is new?' ?></summary>
            <p><?= $it ? 'Nella scheda <a href="novita.php">Novità</a> del menu: cosa è appena uscito, cosa si sta costruendo e le idee in arrivo.' : 'On the <a href="novita.php">News</a> card of the menu: what just came out, what is being built and the ideas on the way.' ?></p>
        </details>
    </main>

    <footer class="foot">
        <a href="privacy.php">Privacy</a>
        <a href="sicurezza.php"><?= $it ? 'Sicurezza' : 'Security' ?></a>
        <a href="../index.php"><?= $it ? 'Menu' : 'Menu' ?></a>
    </footer>
</body>
</html>
