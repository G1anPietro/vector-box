<?php
// public/pages/appunti-guida.php — what "Appunti di classe" is and how to use it. Public: it is what guests see
// when they open the notes from the menu (pages/appunti.php sends them here), and the guide for members.
require_once __DIR__ . '/../includes/head.php';
require_once __DIR__ . '/../includes/appunti-top.php';
require_once __DIR__ . '/../api/database.php';

initSession();
$logged = !empty($_SESSION['user_id']);
$isAdmin = !empty($_SESSION['is_admin']);
$e = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES);
$v = (string)filemtime(__DIR__ . '/../css/appunti.css') . '-' . filemtime(__DIR__ . '/../js/appunti-common.js');
$v .= '-' . filemtime(__DIR__ . '/../js/csrf.js');   // the cache buster covers csrf.js too (the files are cached for a year)
$v .= '-' . filemtime(__DIR__ . '/../js/i18n.js') . '-' . filemtime(__DIR__ . '/../js/i18n/appunti-en.js') . '-' . filemtime(__DIR__ . '/../js/i18n/appunti-it.js');
$login = 'login.php?next=appunti.php';
?>
<!DOCTYPE html>
<html lang="<?= pageLang() ?>" data-lang-server>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#14161b">
    <title><?= tr(['en' => 'Class notes — how it works', 'it' => 'Appunti di classe — come funziona']) ?></title>
    <?= socialMeta(tr(['en' => 'Class notes — vector-box', 'it' => 'Appunti di classe — vector-box']),
        tr(['en' => 'The notes of the whole class in one place: an AI puts them in order, prepares handouts, summaries and quizzes for every written test and reminds you of the dates.',
            'it' => 'Gli appunti di tutta la classe in un posto solo: un\'AI li mette in ordine, prepara dispense, riassunti e quiz per ogni verifica e ti ricorda le date.']),
        '/pages/appunti-guida.php') ?>
    <link rel="stylesheet" href="../css/appunti.css?v=<?= $e($v) ?>">
    <link rel="icon" href="../assets/appunti/icon.svg?v=1" type="image/svg+xml">
    <script src="../js/i18n.js?v=<?= $e($v) ?>"></script>
    <script src="../js/i18n/appunti-en.js?v=<?= $e($v) ?>"></script>
    <script src="../js/i18n/appunti-it.js?v=<?= $e($v) ?>"></script>
    <?php if ($logged): ?><script src="../js/csrf.js?v=<?= $e($v) ?>"></script><script src="../js/appunti-common.js?v=<?= $e($v) ?>" defer></script><?php endif; ?>
</head>
<body>
    <?php if ($logged): appuntiTop('guida'); else: ?>
    <header class="top">
        <a class="home" href="../index.php">vector-box</a>
        <span class="top-right"><span id="vb-lang" class="app-lang"></span><a class="ghost-link" href="<?= $e($login) ?>"><?= tr(['en' => 'Sign in', 'it' => 'Accedi']) ?></a></span>
    </header>
    <?php endif; ?>

    <?php if (pageLang() === 'it'): ?>
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
            <div class="step"><b>1</b><h3>Entra nella classe</h3><p>Con il codice d'invito che ti dà il rappresentante. Ogni classe vede solo i suoi appunti.</p></div>
            <div class="step"><b>2</b><h3>Carica quello che hai</h3><p>Una foto a fine lezione basta: il sito capisce da solo di che lezione è, guardando l'orario.</p></div>
            <div class="step"><b>3</b><h3>Studia dai documenti</h3><p>Dispense, riassunti, domande e quiz arrivano da soli ogni sera e prima di ogni verifica.</p></div>
        </section>

        <nav class="toc card">
            <b>In questa guida:</b>
            <a href="#compagni">Per chi è in una classe</a> ·
            <a href="#rappresentante">Per il rappresentante</a> ·
            <a href="#nuova">Chiedere una classe</a> ·
            <a href="#altra-ai">Usare un'altra AI</a> ·
            <a href="#novita">Bacheca, classifica e ricerca</a> ·
            <a href="#notifiche">Notifiche</a> ·
            <a href="#privacy"><?= tr(['en' => 'Privacy', 'it' => 'Privacy']) ?></a> ·
            <a href="#domande">Domande</a>
            <?php if ($isAdmin): ?> · <a href="#admin">Amministratore</a><?php endif; ?>
        </nav>

        <section id="compagni" class="card">
            <h2>Per chi è in una classe</h2>
            <h3>Materiale</h3>
            <ul>
                <li><strong>Cosa caricare:</strong> appunti (foto, testo scritto lì, Word), slide o PDF del prof, foto delle pagine del
                    libro, le <strong>domande che il prof fa alle interrogazioni</strong>, le verifiche di preparazione. Più materiale c'è, più
                    i documenti sono completi. Vanno bene <strong>PDF</strong> (anche scritti a mano), <strong>PowerPoint</strong>, <strong>pagine HTML</strong>,
                    testo, Markdown, Word e foto. Le pagine HTML vengono ripulite al caricamento: via script, moduli e contenuti da altri siti, restano testo, tabelle e lo stile (colori, dimensioni). Le presentazioni PowerPoint si sfogliano nell'Archivio come slide (testo, immagini e tabelle; niente animazioni).
                    Il <strong>rappresentante</strong> può caricare lo stesso materiale per più giorni ("Vale anche per altri giorni") e cambiare il giorno di un materiale dall'Archivio (⋯, "Cambia il giorno"). Nell'Archivio, con <strong>Seleziona</strong>, si scelgono più file insieme per spostarli a un altro giorno o argomento o eliminarli; dal ⋯ della cartella si sposta o si elimina tutta la cartella. Per le altre AI, nel passo 1 si può scegliere da che giorno a che giorno prendere il materiale.</li>
                <li><strong>La lezione giusta:</strong> scegliendo le foto, il sito guarda l'ora in cui le hai scattate e l'orario della
                    classe, e propone la lezione (con le ore e la materia dell'orario della tua classe). Se sbaglia, cambiala.</li>
                <li><strong>Pagina Carica</strong> (in alto, <em>Carica</em>): tutti i modi per caricare in un posto solo, cioè fotocamera,
                    file (anche trascinandoli), testo scritto o copiato da un'AI (il <b>**grassetto**</b> di ChatGPT e Gemini viene mostrato
                    formattato) e documenti fatti con un'altra AI, con la barra di avanzamento.</li>
                <li><strong>Per argomento:</strong> ogni caricamento va sotto l'argomento (messo nel Calendario) che copre quel giorno; se nello stesso giorno
                    ne corrono due, lo scegli tu (o lo sceglie l'AI leggendo il testo). Se due argomenti dividono un giorno, l'AI scrive un documento per
                    ciascuno. Nell'Archivio trovi le cartelle <em>Per argomento</em>, in Materiale c'è il filtro, e una verifica lascia fuori il materiale
                    degli argomenti che togli dalla sua lista.</li>
                <li><strong>Archivio</strong> (in alto): tutto il materiale a cartelle, Materia → Giorno → file, con l'anteprima accanto
                    (foto, PDF, testi, trascrizioni, documenti dell'AI) senza dover scorrere la pagina.</li>
                <li><strong>Tutti vedono tutto</strong>, con il nome di chi l'ha caricato. Puoi modificare o cancellare solo quello che hai
                    caricato tu (il rappresentante può anche il resto).</li>
                <li><strong>Scaricare:</strong> tocca una foto per aprirla intera; ogni giorno ha un menu <em>⋯</em> con <em>Per un'altra AI</em> (un file di
                    testo con tutto, per ChatGPT, Claude o Gemini) e <em>.zip</em> (i file originali); con il filtro di una materia
                    ci sono gli stessi per tutta la materia. Nella pagina Carica trovi anche i prompt da copiare (studiare, tema, audio).</li>
            </ul>
            <h3>Calendario</h3>
            <p>Segna verifiche scritte e interrogazioni, con gli argomenti che ha detto il prof. Le date le aggiungono tutti; i
                documenti per studiare partono da qui.</p>
            <h3>Studio</h3>
            <ul>
                <li><strong>Appunti delle lezioni:</strong> ogni sera (all'ora scelta dal rappresentante) l'AI unisce gli appunti di tutti in
                    un documento per lezione, segna con ⚠️ dove due compagni dicono cose diverse e aggiunge le <strong>possibili domande
                    all'interrogazione</strong> su quella lezione.</li>
                <li><strong>Per ogni verifica</strong> dei prossimi 30 giorni, con tutto il materiale dalla verifica precedente:
                    <strong>Completo</strong> (la dispensa divisa per argomento, con le lezioni di cui mancano gli appunti),
                    <strong>Riassunto</strong>, <strong>Scheda da tenere sotto mano</strong> (una pagina di soli punti chiave, senza spiegazioni:
                    per chi può consultare gli appunti durante la verifica), <strong>Preparazione mirata</strong> (come interroga il prof, domande probabili con le
                    risposte, verifica di prova svolta) e <strong>Quiz</strong> da fare lì sul telefono.</li>
                <li><strong>I quiz sono fatti come quelli di Moodle:</strong> a sinistra di ogni domanda c'è il riquadro grigio (numero, stato, punteggio, <em>Contrassegna domanda</em>), a destra la domanda con le risposte a, b, c, d; dopo aver risposto vedi <em>Risposta corretta</em> o <em>Risposta errata</em> e la spiegazione. Il blocco <em>Navigazione del quiz</em> ha un quadratino per ogni domanda (verde giusta, rosso sbagliata).</li>
                <li><strong>Link temporaneo:</strong> in <em>Condividi</em> scegli <em>Manda il link</em> (vale 1, 7 o 30 giorni): chi lo apre vede il file o il
                    documento in una pagina, senza account, e può ingrandire, scaricare e condividere (gli schemi anche in PNG e SVG). Nelle <em>Impostazioni</em>
                    vedi i tuoi link e puoi revocarli. Puoi anche dire quante volte si può aprire (una sola volta, 5 o 20: conta le aperture della pagina). Chi ha il link vede solo quel materiale. Il rappresentante, dalle Impostazioni, può <strong>spegnere i link per tutta la classe</strong>.</li>
                <li><strong>Gesti sugli schemi e sulle foto:</strong> due dita per zoomare, un dito per muoverti, doppio tocco per adattare o ingrandire.</li>
                <li><strong>Schermo intero e Condividi:</strong> documenti, schemi e file hanno l'icona <em>schermo intero</em> (le quattro frecce agli angoli, in alto a destra; <em>Chiudi</em> in basso) e <em>Condividi</em>:
                    scegli prima in che formato (per uno schema: PNG, SVG, testo) e poi si apre il menu del telefono: scegli Gmail, WhatsApp, Drive… con il tuo account, non quello del sito. Su computer il file si scarica
                    (da allegare) o si apre la tua posta con il testo già scritto.</li>
                <li><strong>Schemi:</strong> col pulsante <em>Scarica</em> sopra lo schema li prendi come <strong>SVG</strong> (si modifica con Inkscape,
                    Illustrator, Figma, LibreOffice Draw: testi e riquadri restano separati) o come <strong>PNG</strong> (immagine da mandare), a colori o in
                    bianco e nero per stamparli. A schermo intero puoi spostarti fino ai bordi e girare il telefono in orizzontale: lo schema si adatta.</li>
                <li><strong>Solo per classi di maggiorenni:</strong> l'AI legge gli appunti solo se, quando si chiede la classe, si spunta "tutti gli studenti sono maggiorenni". Altrimenti l'AI resta spenta (gli appunti si caricano e si leggono comunque) e il rappresentante può accenderla più avanti dalle Impostazioni, confermando di nuovo.</li>
                <li><strong>Genera ora:</strong> se non vuoi aspettare la sera, una volta l'ora per classe.</li>
                <li>Ogni documento si scarica o si stampa in PDF. <strong>L'AI può sbagliare:</strong> controlla sempre con il libro e
                    con gli appunti originali (ogni parte dice da quali appunti viene).</li>
            </ul>
        </section>

        <section id="rappresentante" class="card">
            <h2>Per il rappresentante della classe</h2>
            <p>Chi ha chiesto la classe ne è il rappresentante; può passare il ruolo a un compagno dalla scheda <em>Classe</em>.</p>
            <ul>
                <li><strong>Codice d'invito</strong> (in <em>Impostazioni</em>): dallo solo ai compagni. <em>Invita la classe</em> prepara un messaggio
                    breve, il link e il codice da incollare uno dopo l'altro nel gruppo. Se il codice gira dove non deve, premi
                    <em>Nuovo codice</em>: quello vecchio smette di funzionare.</li>
                <li><strong>Orario:</strong> nella scheda <em>Classe</em> premi <em>Compila da foto o PDF</em> e carica lo screenshot
                    dell'orario e, se ce l'hai, la foto degli orari della campanella. L'AI riempie la tabella: controllala e premi
                    <em>Salva l'orario</em>. Gli orari possono essere diversi da un giorno all'altro; "Lab TPSIT" e "TPSIT" sono la
                    stessa materia (cambia solo l'etichetta). Quando arriva l'orario definitivo, salvalo con la nuova data
                    "Valido dal": gli appunti vecchi restano sulle lezioni giuste. Le ore di fila della stessa materia si vedono come un
                    unico blocco, e ogni materia ha un colore diverso.</li>
                <li><strong>Riassunto automatico, riepilogo della settimana, appunti mancanti e classifica</strong> si accendono, spengono e
                    regolano in <em>Impostazioni</em> (il riassunto parte alle 18:00 se non cambi l'ora).</li>
                <li><strong>Pannello del rappresentante</strong> (scheda <em>Classe</em>): ruoli e permessi, unire o eliminare materie e il
                    registro di chi ha cambiato o eliminato cosa. Dai compagni puoi togliere chi non c'entra.</li>
                <li><strong>Eliminare:</strong> dal menu <em>⋯</em> si elimina anche un solo file o un documento dell'AI (chiede sempre conferma).</li>
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
            <p>Tutto si fa dalla pagina <em>Carica</em>, scheda <em>Con un'altra AI</em>, in quattro passi:</p>
            <ol>
                <li><strong>Cosa vuoi ottenere?</strong> Scegli il documento (dispensa completa, riassunto, preparazione mirata, quiz, schema
                    oppure gli appunti di una lezione) e per quale verifica o per quale giorno.</li>
                <li><strong>Scarica il materiale.</strong> Il <strong>.md</strong> ha tutto il testo (foto e PDF già trascritti); il
                    <strong>PDF</strong> è lo stesso con anche le foto originali, per le AI che leggono meglio i PDF; lo <strong>.zip</strong> ha i file
                    come li avete caricati (molte AI, come l'app di Gemini, non leggono gli zip: allega i file estratti).</li>
                <li><strong>Dai tutto all'AI.</strong> Allega il file e incolla il testo che trovi lì, con il pulsante <em>Copia il prompt</em>
                    (dice anche in che ordine mandare gli altri). Se hai la registrazione audio della lezione, spunta la casella: compare il
                    prompt per le AI che sanno ascoltare.</li>
                <li><strong>Carica la risposta.</strong> Incollala o scegli il file (il quiz e lo schema vanno caricati così come sono, in JSON).
                    Comparirà accanto agli altri documenti, con il tuo nome.</li>
            </ol>
            <p>Sotto trovi anche altri prompt da copiare: studiare una materia (una versione per ogni AI), allenarsi sul tema, la verifica da foto
                e il report degli errori dei temi. Dalla scheda <em>Studio</em>, il menu <em>⋯</em> di ogni verifica scarica gli stessi file.</p>
        </section>

        <section id="novita" class="card">
            <h2>Bacheca, classifica, ricerca e quiz su misura</h2>
            <ul>
                <li><strong>Bacheca:</strong> che materia c'è adesso e quale dopo (con l'aula), gli annunci del rappresentante, la settimana
                    (verifiche, compiti, turni, giorni senza lezione), il ripasso di oggi e, se la classe lo accende, gli <em>appunti
                    mancanti</em> (lezioni fatte per cui nessuno ha caricato niente).</li>
                <li><strong>Calendario:</strong> sul computer la vista a mese, sul telefono l'agenda; si può filtrare per materia. Ci sono
                    anche compiti, argomenti, giorni senza lezione e i <strong>turni delle interrogazioni</strong>.</li>
                <li><strong>Cerca:</strong> nell'Archivio la casella <em>Cerca</em> trova una parola in tutti gli appunti, nei testi dei file e
                    nei documenti. Dopo una risposta sbagliata in un quiz il link <em>Cerca nel materiale</em> ti porta dove studiarla.</li>
                <li><strong>Quiz su misura</strong> (Studio): scegli quante domande, la materia, scelta multipla o vero/falso e da dove
                    (tutte, quelle del prof, quelle che sbagli). Le domande sbagliate tornano nel ripasso di ogni giorno. In
                    <em>Domande fatte in classe</em> vedi quante volte il prof ha chiesto la stessa domanda, le studi a carte, le
                    esporti per Anki o le dai a un'altra AI che ti interroga.</li>
                <li><strong>Classifica:</strong> 10 punti per ogni risposta giusta al primo tentativo in un quiz e 5 per ogni domanda giusta del
                    ripasso. I punti li conta il sito, non si possono inventare. Puoi uscire quando vuoi: i tuoi punti vengono cancellati.</li>
                <li><strong>Trascina i file</strong> da qualsiasi parte delle pagine Appunti: compare "Mettili qui" e si aprono nella pagina Carica.
                    I caricamenti riprendono da soli se la connessione cade.</li>
                <li><strong>La barra in alto</strong> è uguale in tutte le pagine degli Appunti: <em>Archivio</em>, <em>Carica</em>, <em>Guida</em> e
                    l'ingranaggio delle <em>Impostazioni</em> (con il numero delle notifiche non lette).</li>
                <li><strong>Mancino?</strong> In Impostazioni, <em>Come lo vedo</em>, c'è la modalità mancina: testata, menu e pulsanti si specchiano
                    verso sinistra.</li>
                <li><strong>Impostazioni</strong> (l'ingranaggio in alto): notifiche, il tuo nome in classe, cambio classe, codice della
                    classe, riassunto automatico, riepilogo settimanale, appunti mancanti, classifica, voce che legge le domande, caricamenti. Da lì puoi anche
                    mandare l'invito alla classe: un messaggio breve, il link e il codice, da incollare uno dopo l'altro nel gruppo.</li>
            </ul>
        </section>

        <section id="notifiche" class="card">
            <h2>Notifiche</h2>
            <p>I promemoria di ogni verifica e interrogazione arrivano <strong>2 giorni prima</strong> e <strong>il giorno prima</strong> alle 16:00 e
                <strong>la sera prima</strong> alle 21:00; la domenica alle 19:00 (a scelta della classe) il riepilogo della settimana. Quali
                ricevere lo scegli in <em>Impostazioni</em> (l'ingranaggio), dove trovi anche l'elenco delle notifiche arrivate.</p>
            <ul>
                <li><strong>Sul telefono anche a sito chiuso:</strong> Impostazioni → <em>Attiva le notifiche su questo dispositivo</em> →
                    consenti. Poi <em>Manda una notifica di prova</em> per controllare.</li>
                <li><strong>iPhone:</strong> prima, in Safari, Condividi → <em>Aggiungi alla schermata Home</em>; apri gli Appunti da
                    quell'icona e attiva lì le notifiche, da Impostazioni (serve iOS 16.4 o successivo).</li>
            </ul>
        </section>

        <section id="privacy" class="card">
            <h2><?= tr(['en' => 'Privacy', 'it' => 'Privacy']) ?></h2>
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
                <em>Genera ora</em>, solo se c'è materiale nuovo e le foto sono già state trascritte. Se Google è sovraccarico o ha dato errore, il sito
                <strong>non riprova da solo</strong> (ogni tentativo consuma le richieste gratuite del giorno): premi <em>Genera ora</em> quando vuoi riprovare.</p></details>
            <details><summary>L'AI ha scritto una cosa sbagliata.</summary><p>Succede. Ogni parte indica da quali appunti viene: controlla
                lì e nel libro, e se serve carica gli appunti corretti; il documento si rifà da solo.</p></details>
            <details><summary>Posso usarlo per un'altra scuola?</summary><p>Sì: chiedi la tua classe, ogni classe è separata dalle altre.</p></details>
            <details><summary>Ho perso il codice d'invito.</summary><p>Chiedilo al rappresentante della classe: lo vede nella scheda <em>Classe</em>.</p></details>
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
    <?php else: ?>
    <main class="wrap guide">
        <section class="hero">
            <p class="kicker">Class notes</p>
            <h1>The notes of the whole class, put in order for you.</h1>
            <p class="lead">Everybody uploads what they have: photos of the notebook, the teacher's slides, pages of the book, the questions
                from oral exams ("interrogazioni"). An artificial intelligence merges everything, lesson by lesson, and before each written test ("verifica")
                prepares the complete handout, the summary, the likely questions and a quiz. And it reminds you of the dates.</p>
            <div class="cta">
                <?php if ($logged): ?>
                    <a class="btn" href="appunti.php">Open your notes</a>
                <?php else: ?>
                    <a class="btn" href="<?= $e($login) ?>">Sign in or create an account</a>
                    <span class="muted small">Free. You need an account on the site and the code of your class.</span>
                <?php endif; ?>
            </div>
        </section>

        <section class="steps">
            <div class="step"><b>1</b><h3>Join the class</h3><p>With the invite code the class representative gives you. Each class only sees its own notes.</p></div>
            <div class="step"><b>2</b><h3>Upload what you have</h3><p>One photo at the end of the lesson is enough: the site works out which lesson it is by looking at the timetable.</p></div>
            <div class="step"><b>3</b><h3>Study from the documents</h3><p>Handouts, summaries, questions and quizzes arrive by themselves every evening and before each test.</p></div>
        </section>

        <nav class="toc card">
            <b>In this guide:</b>
            <a href="#compagni">For people in a class</a> ·
            <a href="#rappresentante">For the class representative</a> ·
            <a href="#nuova">Asking for a class</a> ·
            <a href="#altra-ai">Using another AI</a> ·
            <a href="#novita">Board, leaderboard and search</a> ·
            <a href="#notifiche">Notifications</a> ·
            <a href="#privacy"><?= tr(['en' => 'Privacy', 'it' => 'Privacy']) ?></a> ·
            <a href="#domande">Questions</a>
            <?php if ($isAdmin): ?> · <a href="#admin">Administrator</a><?php endif; ?>
        </nav>

        <p class="muted small">A few Italian school words: a <em>verifica</em> is a written test, an <em>interrogazione</em> is an oral exam in front of the class, the
            <em>rappresentante</em> is the class representative, and the <em>tema</em> is the essay of the Italian language class.</p>

        <section id="compagni" class="card">
            <h2>For people in a class</h2>
            <h3>Material</h3>
            <ul>
                <li><strong>What to upload:</strong> notes (photos, text written there, Word), the teacher's slides or PDFs, photos of the book pages,
                    the <strong>questions the teacher asks at oral exams</strong>, practice tests. The more material there is, the more complete
                    the documents are. <strong>PDF</strong> (also handwritten), <strong>PowerPoint</strong>, <strong>HTML pages</strong>,
                    text, Markdown, Word and photos all work. HTML pages are cleaned on upload: scripts, forms and content from other sites are removed, text, tables and style (colours, sizes) stay. PowerPoint presentations can be browsed in the Archive as slides (text, images and tables; no animations).
                    The <strong>representative</strong> can upload the same material for several days ("Also valid for other days") and change the day of a piece of material from the Archive (⋯, "Change the day"). In the Archive, with <strong>Select</strong>, you pick several files together to move them to another day or topic or delete them; from the ⋯ of the folder you move or delete the whole folder. For the other AIs, in step 1 you can choose from which day to which day to take the material.</li>
                <li><strong>The right lesson:</strong> when you choose the photos, the site looks at the time you took them and at the class
                    timetable, and suggests the lesson (with the periods and the subject of your class timetable). If it is wrong, change it.</li>
                <li><strong>Upload page</strong> (at the top, <em>Upload</em>): all the ways to upload in one place, that is camera,
                    files (also by dragging them), text written or copied from an AI (the <b>**bold**</b> of ChatGPT and Gemini is shown
                    formatted) and documents made with another AI, with a progress bar.</li>
                <li><strong>By topic:</strong> every upload goes under the topic (set in the Calendar) that covers that day; if two
                    run on the same day, you choose (or the AI chooses by reading the text). If two topics share a day, the AI writes one document for
                    each. In the Archive you find the <em>By topic</em> folders, in Material there is the filter, and a test leaves out the material
                    of the topics you remove from its list.</li>
                <li><strong>Archive</strong> (at the top): all the material in folders, Subject → Day → file, with the preview next to it
                    (photos, PDFs, texts, transcripts, AI documents) without having to scroll the page.</li>
                <li><strong>Everybody sees everything</strong>, with the name of who uploaded it. You can edit or delete only what you
                    uploaded yourself (the representative can do the rest too).</li>
                <li><strong>Downloading:</strong> tap a photo to open it full size; every day has a <em>⋯</em> menu with <em>For another AI</em> (a text
                    file with everything, for ChatGPT, Claude or Gemini) and <em>.zip</em> (the original files); with a subject filter
                    there are the same for the whole subject. In the Upload page you also find the prompts to copy (study, essay, audio).</li>
            </ul>
            <h3>Calendar</h3>
            <p>It records written tests and oral exams, with the topics the teacher mentioned. Everybody adds the dates; the
                study documents start from here.</p>
            <h3>Study</h3>
            <ul>
                <li><strong>Lesson notes:</strong> every evening (at the time chosen by the representative) the AI merges everybody's notes into
                    one document per lesson, marks with ⚠️ where two classmates say different things and adds the <strong>possible oral
                    exam questions</strong> on that lesson.</li>
                <li><strong>For each test</strong> in the next 30 days, with all the material since the previous test:
                    <strong>Full</strong> (the handout split by topic, with the lessons whose notes are missing),
                    <strong>Summary</strong>, <strong>Cheat sheet</strong> (a page of key points only, no explanations:
                    for those who may look at their notes during the test), <strong>Targeted preparation</strong> (how the teacher questions, likely questions with
                    answers, a solved practice test) and a <strong>Quiz</strong> to do right there on the phone.</li>
                <li><strong>Quizzes are made like Moodle ones:</strong> on the left of each question there is the grey box (number, status, score, <em>Flag question</em>), on the right the question with answers a, b, c, d; after answering you see <em>Right answer</em> or <em>Wrong answer</em> and the explanation. The <em>Quiz navigation</em> block has a small square for each question (green right, red wrong).</li>
                <li><strong>Temporary link:</strong> in <em>Share</em> choose <em>Send the link</em> (valid 1, 7 or 30 days): whoever opens it sees the file or the
                    document in a page, without an account, and can zoom, download and share (diagrams also as PNG and SVG). In <em>Settings</em>
                    you see your links and can revoke them. You can also say how many times it can be opened (only once, 5 or 20: it counts the page openings). Whoever has the link only sees that material. The representative, from Settings, can <strong>turn the links off for the whole class</strong>.</li>
                <li><strong>Gestures on diagrams and photos:</strong> two fingers to zoom, one finger to move around, double tap to fit or enlarge.</li>
                <li><strong>Full screen and Share:</strong> documents, diagrams and files have the <em>full screen</em> icon (the four arrows at the corners, top right; <em>Close</em> at the bottom) and <em>Share</em>:
                    first choose the format (for a diagram: PNG, SVG, text) and then the phone menu opens: choose Gmail, WhatsApp, Drive… with your own account, not the site's. On a computer the file is downloaded
                    (to attach) or your mail opens with the text already written.</li>
                <li><strong>Diagrams:</strong> with the <em>Download</em> button above the diagram you get them as <strong>SVG</strong> (editable with Inkscape,
                    Illustrator, Figma, LibreOffice Draw: texts and boxes stay separate) or as <strong>PNG</strong> (an image to send), in colour or in
                    black and white for printing. In full screen you can move to the edges and turn the phone sideways: the diagram adapts.</li>
                <li><strong>Only for classes of adults:</strong> the AI reads the notes only if, when the class is requested, "all the students are of age" is ticked. Otherwise the AI stays off (notes can still be uploaded and read) and the representative can turn it on later from Settings, confirming again.</li>
                <li><strong>Generate now:</strong> if you do not want to wait for the evening, once an hour per class.</li>
                <li>Every document can be downloaded or printed as a PDF. <strong>The AI can be wrong:</strong> always check with the book and
                    with the original notes (every part says which notes it comes from).</li>
            </ul>
        </section>

        <section id="rappresentante" class="card">
            <h2>For the class representative</h2>
            <p>Whoever asked for the class is its representative; they can pass the role to a classmate from the <em>Class</em> tab.</p>
            <ul>
                <li><strong>Invite code</strong> (in <em>Settings</em>): give it only to classmates. <em>Invite the class</em> prepares a short message,
                    the link and the code to paste one after the other in the group chat. If the code goes where it should not, press
                    <em>New code</em>: the old one stops working.</li>
                <li><strong>Timetable:</strong> in the <em>Class</em> tab press <em>Fill in from a photo or PDF</em> and upload the screenshot
                    of the timetable and, if you have it, the photo of the bell schedule. The AI fills in the table: check it and press
                    <em>Save the timetable</em>. Times can differ from one day to the next; "Lab TPSIT" and "TPSIT" are the
                    same subject (only the label changes). When the final timetable arrives, save it with the new "Valid from"
                    date: the old notes stay on the right lessons. Consecutive periods of the same subject are shown as a
                    single block, and every subject has a different colour.</li>
                <li><strong>Automatic summary, weekly summary, missing notes and leaderboard</strong> are turned on, off and
                    adjusted in <em>Settings</em> (the summary runs at 18:00 if you do not change the time).</li>
                <li><strong>Representative panel</strong> (<em>Class</em> tab): roles and permissions, merging or deleting subjects and the
                    log of who changed or deleted what. From the classmates you can remove whoever does not belong.</li>
                <li><strong>Deleting:</strong> from the <em>⋯</em> menu you can also delete a single file or an AI document (it always asks for confirmation).</li>
            </ul>
        </section>

        <section id="nuova" class="card">
            <h2>Your class is not there? Ask for it</h2>
            <p>From the notes page: <em>Your class is not there? Ask for it</em>, with the name of the class and of the school. The
                request is approved by the site administrator (usually the same day); sometimes new requests are closed.
                It works for any school: every class has its own timetable and its own notes, separate from all the others.</p>
        </section>

        <section id="altra-ai" class="card">
            <h2>Using another AI (ChatGPT, Claude, Gemini…)</h2>
            <p>Everything is done from the <em>Upload</em> page, <em>With another AI</em> tab, in four steps:</p>
            <ol>
                <li><strong>What do you want to get?</strong> Choose the document (full handout, summary, targeted preparation, quiz, diagram
                    or the notes of a lesson) and for which test or which day.</li>
                <li><strong>Download the material.</strong> The <strong>.md</strong> has all the text (photos and PDFs already transcribed); the
                    <strong>PDF</strong> is the same with the original photos too, for the AIs that read PDFs better; the <strong>.zip</strong> has the files
                    as you uploaded them (many AIs, like the Gemini app, do not read zip files: attach the extracted files).</li>
                <li><strong>Give everything to the AI.</strong> Attach the file and paste the text you find there, with the <em>Copy the prompt</em> button
                    (it also says in which order to send the others). If you have the audio recording of the lesson, tick the box: the
                    prompt for the AIs that can listen appears.</li>
                <li><strong>Upload the answer.</strong> Paste it or choose the file (the quiz and the diagram must be uploaded as they are, in JSON).
                    It will appear next to the other documents, with your name.</li>
            </ol>
            <p>Below you also find more prompts to copy: studying a subject (one version for each AI), practising the essay, the test from photos
                and the error report of the essays. From the <em>Study</em> tab, the <em>⋯</em> menu of each test downloads the same files.</p>
        </section>

        <section id="novita" class="card">
            <h2>Board, leaderboard, search and custom quizzes</h2>
            <ul>
                <li><strong>Board:</strong> which subject is on now and which is next (with the room), the representative's announcements, the week
                    (tests, homework, turns, days without lessons), today's review and, if the class turns it on, the <em>missing
                    notes</em> (lessons held for which nobody has uploaded anything).</li>
                <li><strong>Calendar:</strong> on a computer the month view, on the phone the agenda; you can filter by subject. There are
                    also homework, topics, days without lessons and the <strong>oral exam turns</strong>.</li>
                <li><strong>Search:</strong> in the Archive the <em>Search</em> box finds a word in all the notes, in the texts of the files and
                    in the documents. After a wrong answer in a quiz the <em>Search in the material</em> link takes you where to study it.</li>
                <li><strong>Custom quiz</strong> (Study): choose how many questions, the subject, multiple choice or true/false and from where
                    (all, the teacher's, the ones you get wrong). Wrong questions come back in the daily review. In
                    <em>Questions asked in class</em> you see how many times the teacher asked the same question, you study them with cards, you
                    export them for Anki or give them to another AI that questions you.</li>
                <li><strong>Leaderboard:</strong> 10 points for each right answer on the first try in a quiz and 5 for each right question in the
                    review. The site counts the points, they cannot be made up. You can leave whenever you want: your points are deleted.</li>
                <li><strong>Drag files</strong> from anywhere on the Notes pages: "Drop them here" appears and they open in the Upload page.
                    Uploads resume by themselves if the connection drops.</li>
                <li><strong>The bar at the top</strong> is the same on all the Notes pages: <em>Archive</em>, <em>Upload</em>, <em>Guide</em> and
                    the <em>Settings</em> gear (with the number of unread notifications).</li>
                <li><strong>Left-handed?</strong> In Settings, <em>How I see it</em>, there is the left-handed mode: header, menus and buttons are mirrored
                    to the left.</li>
                <li><strong>Settings</strong> (the gear at the top): notifications, your name in class, switching class, class
                    code, automatic summary, weekly summary, missing notes, leaderboard, the voice that reads the questions, uploads. From there you can also
                    send the invitation to the class: a short message, the link and the code, to paste one after the other in the group chat.</li>
            </ul>
        </section>

        <section id="notifiche" class="card">
            <h2>Notifications</h2>
            <p>The reminders for each test and oral exam arrive <strong>2 days before</strong> and <strong>the day before</strong> at 16:00 and
                <strong>the evening before</strong> at 21:00; on Sunday at 19:00 (the class can change this) the weekly summary. Which ones to
                receive you choose in <em>Settings</em> (the gear), where you also find the list of the notifications received.</p>
            <ul>
                <li><strong>On the phone even when the site is closed:</strong> Settings → <em>Turn on notifications on this device</em> →
                    allow. Then <em>Send a test notification</em> to check.</li>
                <li><strong>iPhone:</strong> first, in Safari, Share → <em>Add to Home Screen</em>; open Class notes from
                    that icon and turn on notifications there, from Settings (iOS 16.4 or later is needed).</li>
            </ul>
        </section>

        <section id="privacy" class="card">
            <h2><?= tr(['en' => 'Privacy', 'it' => 'Privacy']) ?></h2>
            <p>The material is only seen by the classmates and the site administrator. To transcribe the photos and write the
                documents it is read by <strong>Google Gemini</strong>, in the free version: Google may use this content to
                improve its products. For this reason <strong>do not upload personal data</strong> (yours or other people's), grades, identity
                documents or health information. Details in the <a href="privacy.php">privacy page</a>.</p>
        </section>

        <section id="domande" class="card">
            <h2>Questions</h2>
            <details><summary>How much does it cost?</summary><p>Nothing. The site uses the free version of Gemini, which has a limit of requests
                per day: with many classes, some documents may arrive the next day.</p></details>
            <details><summary>The document has not arrived.</summary><p>It arrives at the summary time, or a few minutes after
                <em>Generate now</em>, only if there is new material and the photos have already been transcribed. If Google is overloaded or gave an error, the site
                <strong>does not retry by itself</strong> (every attempt uses up the free requests of the day): press <em>Generate now</em> when you want to try again.</p></details>
            <details><summary>The AI wrote something wrong.</summary><p>It happens. Every part says which notes it comes from: check
                there and in the book, and if needed upload the correct notes; the document is redone by itself.</p></details>
            <details><summary>Can I use it for another school?</summary><p>Yes: ask for your class, every class is separate from the others.</p></details>
            <details><summary>I lost the invite code.</summary><p>Ask the class representative: they see it in the <em>Class</em> tab.</p></details>
        </section>

        <?php if ($isAdmin): ?>
        <section id="admin" class="card">
            <h2>For the administrator</h2>
            <ul>
                <li><strong>Admin tab</strong> of the notes page: you approve or reject the requests for new classes,
                    the <em>Accept new requests</em> switch closes them, the space limits (40 MB per file and 5 GB per class to
                    start with; they can be changed for the whole site or for one class), the list of all the classes and their deletion.</li>
                <li>You see and manage every class even if you are not part of it.</li>
                <li>On the server: the AI worker runs every 5 minutes (<code>vector-box-appunti-ai.timer</code>, log with
                    <code>journalctl -u vector-box-appunti-ai</code>); key and models in the <code>.env</code> (<code>GEMINI_*</code>);
                    an ntfy alert arrives if it really fails 3 times in a row. Technical details in <code>docs/DOCUMENTAZIONE.md</code>.</li>
            </ul>
        </section>
        <?php endif; ?>

        <section class="hero end">
            <h2>Ready?</h2>
            <div class="cta">
                <?php if ($logged): ?><a class="btn" href="appunti.php">Open your notes</a>
                <?php else: ?><a class="btn" href="<?= $e($login) ?>">Sign in or create an account</a><?php endif; ?>
            </div>
        </section>
    </main>
    <?php endif; ?>

    <footer class="foot">
        <a href="privacy.php"><?= tr(['en' => 'Privacy', 'it' => 'Privacy']) ?></a>
        <a href="sicurezza.php"><?= tr(['en' => 'Security', 'it' => 'Sicurezza']) ?></a>
        <a href="../index.php"><?= tr(['en' => 'Back to the site', 'it' => 'Torna al sito']) ?></a>
    </footer>
</body>
</html>
