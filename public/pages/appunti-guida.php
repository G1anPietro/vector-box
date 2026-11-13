<?php
// public/pages/appunti-guida.php — what "Appunti di classe" is and how to use it. Public: it is what guests see
// when they open the notes from the menu (pages/appunti.php sends them here), and the guide for members.
require_once __DIR__ . '/../includes/head.php';
require_once __DIR__ . '/../api/database.php';

initSession();
$logged = !empty($_SESSION['user_id']);
$isAdmin = !empty($_SESSION['is_admin']);
$e = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES);
$v = (string)filemtime(__DIR__ . '/../css/appunti.css');
$login = 'login.php?next=appunti.php';
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#14161b">
    <title>Appunti di classe — come funziona</title>
    <?= socialMeta('Appunti di classe — vector-box',
        'Gli appunti di tutta la classe in un posto solo: un\'AI li mette in ordine, prepara dispense, riassunti e quiz per ogni verifica e ti ricorda le date.',
        '/pages/appunti-guida.php') ?>
    <link rel="stylesheet" href="../css/appunti.css?v=<?= $e($v) ?>">
    <link rel="icon" href="../assets/appunti/icon.svg?v=1" type="image/svg+xml">
</head>
<body>
    <header class="top">
        <a class="home" href="../index.php">vector-box</a>
        <span class="top-right">
            <?php if ($logged): ?><a class="ghost-link" href="appunti.php">Apri i tuoi appunti →</a>
            <?php else: ?><a class="ghost-link" href="<?= $e($login) ?>">Accedi</a><?php endif; ?>
        </span>
    </header>

    <main class="wrap guide">
        <section class="hero">
            <p class="kicker">Appunti di classe</p>
            <h1>Gli appunti di tutta la classe, messi in ordine per te.</h1>
            <p class="lead">Ognuno carica quello che ha: foto del quaderno, slide del prof, pagine del libro, le domande delle
                interrogazioni. Un'intelligenza artificiale unisce tutto, lezione per lezione, e prima di ogni verifica prepara
                la dispensa completa, il riassunto, le domande probabili e un quiz. E ti ricorda le date.</p>
            <div class="cta">
                <?php if ($logged): ?>
                    <a class="btn" href="appunti.php">Apri i tuoi appunti</a>
                <?php else: ?>
                    <a class="btn" href="<?= $e($login) ?>">Accedi o crea un account</a>
                    <span class="muted small">Gratis. Serve un account del sito e il codice della tua classe.</span>
                <?php endif; ?>
            </div>
        </section>

        <section class="steps">
            <div class="step"><b>1</b><h3>Entra nella classe</h3><p>Con il codice d'invito che ti dà il responsabile. Ogni classe vede solo i suoi appunti.</p></div>
            <div class="step"><b>2</b><h3>Carica quello che hai</h3><p>Una foto a fine lezione basta: il sito capisce da solo di che lezione è, guardando l'orario.</p></div>
            <div class="step"><b>3</b><h3>Studia dai documenti</h3><p>Dispense, riassunti, domande e quiz arrivano da soli ogni sera e prima di ogni verifica.</p></div>
        </section>

        <nav class="toc card">
            <b>In questa guida:</b>
            <a href="#compagni">Per chi è in una classe</a> ·
            <a href="#responsabile">Per il responsabile</a> ·
            <a href="#nuova">Chiedere una classe</a> ·
            <a href="#altra-ai">Usare un'altra AI</a> ·
            <a href="#notifiche">Notifiche</a> ·
            <a href="#privacy">Privacy</a> ·
            <a href="#domande">Domande</a>
            <?php if ($isAdmin): ?> · <a href="#admin">Amministratore</a><?php endif; ?>
        </nav>

        <section id="compagni" class="card">
            <h2>Per chi è in una classe</h2>
            <h3>Materiale</h3>
            <ul>
                <li><strong>Cosa caricare:</strong> appunti (foto, testo scritto lì, Word), slide o PDF del prof, foto delle pagine del
                    libro, le <strong>domande che il prof fa alle interrogazioni</strong>, le verifiche di preparazione. Più materiale c'è, più
                    i documenti sono completi.</li>
                <li><strong>La lezione giusta:</strong> scegliendo le foto, il sito guarda l'ora in cui le hai scattate e l'orario della
                    classe, e propone la lezione (per esempio "3ª-4ª ora · Lab SISI"). Se sbaglia, cambiala.</li>
                <li><strong>Tutti vedono tutto</strong>, con il nome di chi l'ha caricato. Puoi modificare o cancellare solo quello che hai
                    caricato tu (il responsabile può anche il resto).</li>
                <li><strong>Scaricare:</strong> tocca una foto per aprirla intera; ogni giorno ha il pulsante <em>↓ .zip</em> con tutto il
                    materiale, e con il filtro di una materia c'è <em>Tutta la materia (.zip)</em>.</li>
            </ul>
            <h3>Calendario</h3>
            <p>Segna verifiche scritte e interrogazioni, con gli argomenti che ha detto il prof. Le date le aggiungono tutti; i
                documenti per studiare partono da qui.</p>
            <h3>Studio</h3>
            <ul>
                <li><strong>Appunti delle lezioni:</strong> ogni sera (all'ora scelta dal responsabile) l'AI unisce gli appunti di tutti in
                    un documento per lezione, segna con ⚠️ dove due compagni dicono cose diverse e aggiunge le <strong>possibili domande
                    all'interrogazione</strong> su quella lezione.</li>
                <li><strong>Per ogni verifica</strong> dei prossimi 30 giorni, con tutto il materiale dalla verifica precedente:
                    <strong>Completo</strong> (la dispensa divisa per argomento, con le lezioni di cui mancano gli appunti),
                    <strong>Riassunto</strong>, <strong>Preparazione mirata</strong> (come interroga il prof, domande probabili con le
                    risposte, verifica di prova svolta) e <strong>Quiz</strong> da fare lì sul telefono.</li>
                <li><strong>Genera ora:</strong> se non vuoi aspettare la sera, una volta l'ora per classe.</li>
                <li>Ogni documento si scarica o si stampa in PDF. <strong>L'AI può sbagliare:</strong> controlla sempre con il libro e
                    con gli appunti originali (ogni parte dice da quali appunti viene).</li>
            </ul>
        </section>

        <section id="responsabile" class="card">
            <h2>Per il responsabile della classe</h2>
            <p>Chi ha chiesto la classe ne è il responsabile; può passare il ruolo a un compagno dalla scheda <em>Classe</em>.</p>
            <ul>
                <li><strong>Codice d'invito:</strong> dallo solo ai compagni (gruppo della classe). Se gira dove non deve, premi
                    <em>Nuovo codice</em>: quello vecchio smette di funzionare.</li>
                <li><strong>Orario:</strong> nella scheda <em>Classe</em> premi <em>Compila da foto o PDF</em> e carica lo screenshot
                    dell'orario e, se ce l'hai, la foto degli orari della campanella. L'AI riempie la tabella: controllala e premi
                    <em>Salva l'orario</em>. Gli orari possono essere diversi da un giorno all'altro; "Lab TPSIT" e "TPSIT" sono la
                    stessa materia (cambia solo l'etichetta). Quando arriva l'orario definitivo, salvalo con la nuova data
                    "Valido dal": gli appunti vecchi restano sulle lezioni giuste.</li>
                <li><strong>Ora del riassunto:</strong> 18:00 se non la cambi.</li>
                <li><strong>Compagni:</strong> puoi togliere chi non c'entra.</li>
            </ul>
        </section>

        <section id="nuova" class="card">
            <h2>La tua classe non c'è? Chiedila</h2>
            <p>Dalla pagina degli appunti: <em>La tua classe non c'è? Chiedila</em>, con il nome della classe e della scuola. La
                richiesta la approva l'amministratore del sito (di solito in giornata); a volte le richieste nuove sono chiuse.
                Funziona per qualsiasi scuola: ogni classe ha il suo orario e i suoi appunti, separati da tutti gli altri.</p>
        </section>

        <section id="altra-ai" class="card">
            <h2>Usare un'altra AI (ChatGPT, Claude, Gemini…)</h2>
            <ol>
                <li>Scarica lo <strong>.zip</strong> di un giorno, di una materia o di una verifica (nella scheda <em>Studio</em>, sotto ogni
                    verifica: <em>Materiale + prompt per un'altra AI</em>).</li>
                <li>Dentro ci sono il materiale (foto e file originali, testi, trascrizioni), <code>INDICE.txt</code> (chi ha scritto
                    cosa) e <code>PROMPT.txt</code> con le istruzioni e i prompt pronti da incollare.</li>
                <li>Allega i file all'AI che preferisci e incolla il prompt.</li>
                <li>Copia la risposta e caricala in <em>Studio → Carica un documento fatto con un'altra AI</em>, scegliendo il tipo
                    (il quiz va caricato così com'è, in JSON). Comparirà accanto agli altri, con il tuo nome.</li>
            </ol>
        </section>

        <section id="notifiche" class="card">
            <h2>Notifiche</h2>
            <p>La campanella in alto nella pagina raccoglie i promemoria di ogni verifica e interrogazione: <strong>2 giorni prima</strong>
                e <strong>il giorno prima</strong> alle 16:00, e <strong>la sera prima</strong> alle 21:00.</p>
            <ul>
                <li><strong>Sul telefono anche a sito chiuso:</strong> campanella → <em>Attiva le notifiche su questo dispositivo</em> →
                    consenti. Poi <em>Manda una prova</em> per controllare.</li>
                <li><strong>iPhone:</strong> prima, in Safari, Condividi → <em>Aggiungi alla schermata Home</em>; apri gli Appunti da
                    quell'icona e attiva lì le notifiche (serve iOS 16.4 o successivo).</li>
            </ul>
        </section>

        <section id="privacy" class="card">
            <h2>Privacy</h2>
            <p>Il materiale lo vedono solo i compagni della classe e l'amministratore del sito. Per trascrivere le foto e scrivere i
                documenti viene letto da <strong>Google Gemini</strong>, nella versione gratuita: Google può usare questi contenuti per
                migliorare i suoi prodotti. Per questo <strong>non caricare dati personali</strong> (tuoi o di altri), voti, documenti
                d'identità o informazioni sulla salute. Dettagli nella <a href="privacy.php">pagina privacy</a>.</p>
        </section>

        <section id="domande" class="card">
            <h2>Domande</h2>
            <details><summary>Quanto costa?</summary><p>Niente. Il sito usa la versione gratuita di Gemini, che ha un limite di richieste
                al giorno: con molte classi, qualche documento può arrivare il giorno dopo.</p></details>
            <details><summary>Il documento non è arrivato.</summary><p>Arriva all'ora del riassunto, o qualche minuto dopo
                <em>Genera ora</em>, solo se c'è materiale nuovo e le foto sono già state trascritte. Se Google è sovraccarico, il sito
                riprova da solo ogni 5 minuti.</p></details>
            <details><summary>L'AI ha scritto una cosa sbagliata.</summary><p>Succede. Ogni parte indica da quali appunti viene: controlla
                lì e nel libro, e se serve carica gli appunti corretti; il documento si rifà da solo.</p></details>
            <details><summary>Posso usarlo per un'altra scuola?</summary><p>Sì: chiedi la tua classe, ogni classe è separata dalle altre.</p></details>
            <details><summary>Ho perso il codice d'invito.</summary><p>Chiedilo al responsabile della classe: lo vede nella scheda <em>Classe</em>.</p></details>
        </section>

        <?php if ($isAdmin): ?>
        <section id="admin" class="card">
            <h2>Per l'amministratore</h2>
            <ul>
                <li><strong>Scheda Admin</strong> della pagina degli appunti: approvi o rifiuti le richieste di nuove classi,
                    l'interruttore <em>Accetta nuove richieste</em> le chiude, i limiti di spazio (40 MB per file e 5 GB per classe di
                    partenza; si possono cambiare per tutto il sito o per una classe), l'elenco di tutte le classi e la loro cancellazione.</li>
                <li>Vedi e gestisci ogni classe anche se non ne fai parte.</li>
                <li>Sul server: il lavoratore AI gira ogni 5 minuti (<code>vector-box-appunti-ai.timer</code>, log con
                    <code>journalctl -u vector-box-appunti-ai</code>); chiave e modelli nel <code>.env</code> (<code>GEMINI_*</code>);
                    un avviso ntfy arriva se fallisce davvero 3 volte di fila. Dettagli tecnici in <code>docs/DOCUMENTAZIONE.md</code>.</li>
            </ul>
        </section>
        <?php endif; ?>

        <section class="hero end">
            <h2>Pronto?</h2>
            <div class="cta">
                <?php if ($logged): ?><a class="btn" href="appunti.php">Apri i tuoi appunti</a>
                <?php else: ?><a class="btn" href="<?= $e($login) ?>">Accedi o crea un account</a><?php endif; ?>
            </div>
        </section>
    </main>

    <footer class="foot">
        <a href="privacy.php">Privacy</a>
        <a href="../index.php">Torna al sito</a>
    </footer>
</body>
</html>
