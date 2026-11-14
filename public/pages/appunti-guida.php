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
    <?php if ($logged): ?><script src="../js/csrf.js?v=<?= $e($v) ?>"></script><script src="../js/appunti-common.js?v=<?= $e($v) ?>" defer></script><?php endif; ?>
</head>
<body>
    <?php if ($logged): appuntiTop('guida'); else: ?>
    <header class="top">
        <a class="home" href="../index.php">vector-box</a>
        <span class="top-right"><a class="ghost-link" href="<?= $e($login) ?>">Accedi</a></span>
    </header>
    <?php endif; ?>

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
                <li><strong>Schemi:</strong> col pulsante <em>Scarica</em> sopra lo schema li prendi come <strong>SVG</strong> (si modifica con Inkscape,
                    Illustrator, Figma, LibreOffice Draw: testi e riquadri restano separati) o come <strong>PNG</strong> (immagine da mandare), a colori o in
                    bianco e nero per stamparli.</li>
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

    <footer class="foot">
        <a href="privacy.php">Privacy</a>
        <a href="../index.php">Torna al sito</a>
    </footer>
</body>
</html>
