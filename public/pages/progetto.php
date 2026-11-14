<?php
// public/pages/progetto.php — the project told for the "maturità" oral exam: what it is, how it works, security,
// the home server, real problems and how they were solved. Public: no addresses, ports or private details.
require_once __DIR__ . '/../includes/head.php';
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#16141c">
    <title>Il progetto vector-box</title>
    <?= socialMeta('Il progetto vector-box', 'Un sito e un server costruiti da zero da uno studente di informatica: architettura, sicurezza, giochi multigiocatore e i problemi veri risolti lungo la strada.', '/pages/progetto.php', '/assets/og/desktop.jpg') ?>
    <link rel="stylesheet" href="../css/giochi.css?v=3">
    <link rel="stylesheet" href="../css/progetto.css?v=1">
</head>
<body>
    <header class="top">
        <a class="home" href="../index.php">vector-box</a>
    </header>

    <main class="doc project">
        <h1>Il progetto vector-box</h1>
        <p class="lead">Un sito e il server che lo fa girare, costruiti da zero in un portatile senza schermo. È nato per gioco
        tra amici ed è diventato il posto dove ho imparato come funziona davvero un servizio web: dal codice alla rete di casa.</p>

        <figure><img src="../assets/og/desktop.jpg" alt="Il desktop di vector-box nel browser" width="1200" height="630" loading="lazy">
            <figcaption>La home: un desktop con finestre, terminale e chat, nel browser.</figcaption></figure>

        <nav class="toc" aria-label="Indice">
            <a href="#cosa">Cos'è</a><a href="#come">Come funziona</a><a href="#parti">Le parti</a><a href="#sicurezza">Sicurezza</a>
            <a href="#server">Il server</a><a href="#problemi">Problemi risolti</a><a href="#numeri">In numeri</a><a href="#imparato">Cosa ho imparato</a>
        </nav>

        <h2 id="cosa">Cos'è</h2>
        <p>vector-box è un sito in stile "desktop cyberpunk": si apre nel browser e sembra un sistema operativo, con finestre da
        trascinare, un terminale con i suoi comandi e una barra delle applicazioni. Dentro ci sono una chat con stanze e messaggi
        privati, una biblioteca di libri da leggere online per gli amici, gli appunti condivisi di una classe di scuola e una serie di giochi: giochi da festa da fare con il
        telefono (Chi è la spia?, Lupus, Non ho mai…) e giochi da soli come il Solitario. Lo usa ogni giorno un gruppo di amici.</p>

        <h2 id="come">Come funziona</h2>
        <div class="flow" role="img" aria-label="Schema: il browser parla con nginx; nginx passa le pagine a PHP, che usa il database SQLite, e la chat in tempo reale a Node.js">
            <div class="node">Browser<small>telefono o computer</small></div>
            <div class="arrow">HTTPS</div>
            <div class="node">nginx<small>certificato, compressione, cache</small></div>
            <div class="split">
                <div class="branch"><div class="arrow">pagine e API</div><div class="node">PHP<small>account, chat, giochi, libri</small></div><div class="arrow">SQL</div><div class="node">SQLite<small>un solo file di database</small></div></div>
                <div class="branch"><div class="arrow">chat in diretta</div><div class="node">Node.js<small>hub: una connessione per browser</small></div></div>
            </div>
        </div>
        <p><strong>PHP</strong> è la "fonte di verità": salva ogni messaggio, controlla chi può fare cosa e fa girare i giochi.
        Il database è <strong>SQLite</strong>, un unico file, con le modifiche alla struttura numerate (oggi siamo alla versione 26)
        e applicate da sole a ogni aggiornamento. Per la chat in tempo reale c'è un piccolo server <strong>Node.js</strong>: invece di
        far chiedere a ogni browser "ci sono messaggi nuovi?" ogni pochi secondi, tiene aperta una sola connessione
        (<abbr title="Server-Sent Events">SSE</abbr>) e spinge i messaggi appena arrivano. Se Node si ferma, il sito torna da solo al
        sistema di riserva in PHP e non si perde nessun messaggio.</p>

        <h2 id="parti">Le parti più interessanti</h2>
        <ul>
            <li><strong>Giochi multigiocatore senza account:</strong> chi crea una stanza riceve un codice di 4 lettere; ogni telefono è
            riconosciuto da un token. Il server distribuisce i ruoli segreti e ogni telefono vede solo la sua parte, così nessuno può
            sbirciare dal codice della pagina. Tutte le mosse avvengono dentro una transazione del database, per evitare che due
            telefoni che votano insieme si "pestino i piedi".</li>
            <li><strong>Cinque lingue</strong> nei giochi (italiano, inglese, spagnolo, francese, tedesco).</li>
            <li><strong>Pensato prima per il telefono:</strong> su schermo piccolo il desktop diventa un'app alla volta con una barra di
            schede; i giochi si installano come app e il Solitario funziona anche offline.</li>
            <li><strong>Messaggi privati</strong> con blocco degli utenti, e i messaggi vecchi che si caricano da soli scorrendo.</li>
            <li><strong>Biblioteca</strong> con lettore EPUB e PDF, copertine, segnalibri e avanzamento salvato.</li>
            <li><strong>Appunti di classe:</strong> gli studenti caricano foto, audio e file delle lezioni (a pezzi, così riprendono anche se cade la
            connessione) e un'AI li unisce in appunti, schemi, dispense, riassunti e quiz per ogni verifica, divisi per materia, giorno e
            argomento. C'è una ricerca nel materiale, un calendario, i turni delle interrogazioni, una classifica in cui i punti li conta il
            server (la pagina non conosce la risposta giusta prima che tu risponda) e promemoria sul telefono scelti da ciascuno.</li>
            <li><strong>Test automatici:</strong> oltre 200 test che avviano ogni volta una copia del sito con un database vuoto e controllano
            account, permessi, chat, giochi, sicurezza. Prima di ogni modifica pubblicata devono passare tutti.</li>
        </ul>

        <h2 id="sicurezza">Sicurezza</h2>
        <p>Un sito aperto su Internet riceve tentativi di attacco ogni giorno. Le difese principali:</p>
        <ul>
            <li><strong>CSRF:</strong> ogni azione che modifica qualcosa richiede un token segreto legato alla sessione, così un altro sito
            non può far compiere azioni al tuo browser a tua insaputa.</li>
            <li><strong>XSS:</strong> il testo scritto dagli utenti viene sempre inserito come testo, mai come HTML, quindi non può
            contenere codice.</li>
            <li><strong>Content-Security-Policy:</strong> il browser esegue solo gli script del sito e di pochi indirizzi fidati.</li>
            <li><strong>Sessioni</strong> con cookie protetti e ID rigenerato a ogni accesso; <strong>password</strong> salvate solo come
            impronta (hash); <strong>limiti di richieste</strong> contro i tentativi a raffica.</li>
            <li><strong>File caricati</strong> controllati per contenuto, non solo per estensione, e salvati fuori dalla cartella pubblica.</li>
            <li><strong>Token monouso</strong> per la chat in diretta, perché finiscono nei registri del server.</li>
        </ul>

        <h2 id="server">Il server di casa</h2>
        <p>Tutto gira su un vecchio portatile senza schermo con <strong>Ubuntu Server</strong>, acceso giorno e notte. Sopra:</p>
        <ul>
            <li><strong>nginx</strong> davanti a tutto, con certificati <strong>Let's Encrypt</strong> e un nome di dominio che segue
            l'indirizzo di casa quando cambia (DNS dinamico).</li>
            <li><strong>Pi-hole</strong> come DNS di tutta la rete di casa (blocca pubblicità e tracciamento) e una <strong>VPN
            WireGuard</strong> per entrare nella rete da fuori; servizi in <strong>Docker</strong>.</li>
            <li><strong>Firewall</strong> e <strong>fail2ban</strong>; dal router passa solo lo stretto necessario.</li>
            <li><strong>Backup</strong> ogni notte su un disco USB, con il ripristino provato davvero su una copia.</li>
            <li><strong>Avvisi sul telefono</strong> (ntfy) se il sito, il DNS, i backup, il disco o la batteria hanno problemi, e una
            notifica a ogni nuova visita.</li>
        </ul>

        <h2 id="problemi">Problemi veri e come li ho risolti</h2>
        <dl class="problems">
            <dt>Il server non si avviava più</dt>
            <dd>Una notte il portatile si è bloccato e al riavvio il disco non veniva visto. Nei registri c'erano da settimane migliaia
            di errori sul collegamento PCIe del disco NVMe, legati al risparmio energetico. Con due parametri del kernel gli errori sono
            scesi a zero; poi ho ritrovato un equilibrio per non far scaldare il disco (da 70 a 52 °C).</dd>
            <dt>Le copertine dei libri sul server non comparivano</dt>
            <dd>In locale funzionava, sul server no. Causa: mancavano due estensioni di PHP (zip e xml). In più il codice segnava i libri
            come "già controllati" anche quando non riusciva a leggerli: l'ho corretto perché aspetti e lo segnali nel registro.</dd>
            <dt>Il sito è caduto per 13 minuti</dt>
            <dd>Ho aperto il database del server con uno strumento da riga di comando con un utente diverso da quello del sito: SQLite
            ha creato dei file di appoggio con i permessi sbagliati e il sito non riusciva più ad aprirlo. Lezione: sul server si lavora
            su una copia del database.</dd>
            <dt>Una password finita su GitHub</dt>
            <dd>All'inizio un file di configurazione con delle password era stato pubblicato per errore. Le password vanno cambiate (quello
            che è stato pubblico va considerato visto) e la storia del repository è stata riscritta per toglierlo.</dd>
            <dt>Server a batteria</dt>
            <dd>Staccando il caricatore la batteria è scesa al 4% e le porte USB hanno iniziato a staccarsi (rete e disco dei backup). Nessun
            dato perso; ora un avviso arriva appena il caricatore si stacca.</dd>
        </dl>

        <h2 id="numeri">In numeri</h2>
        <div class="numbers">
            <div><b>~46.000</b><span>righe di codice e testo</span></div>
            <div><b>190+</b><span>modifiche registrate (commit)</span></div>
            <div><b>200+</b><span>test automatici</span></div>
            <div><b>26</b><span>versioni della struttura del database</span></div>
            <div><b>8</b><span>giochi</span></div>
            <div><b>5</b><span>lingue</span></div>
        </div>

        <h2 id="imparato">Cosa ho imparato</h2>
        <ul>
            <li>Che un sito "che funziona" e un sito che regge davvero online sono due cose diverse: sicurezza, backup e avvisi contano
            quanto le funzioni.</li>
            <li>A leggere i registri di sistema per trovare la causa vera di un guasto, invece di tirare a indovinare.</li>
            <li>A lavorare per piccoli passi verificati: una modifica, i test, un commit, l'aggiornamento del server.</li>
            <li>A usare gli strumenti giusti, compreso un assistente AI per scrivere e rivedere il codice, controllando sempre il risultato
            con test e prove vere.</li>
        </ul>
        <p class="muted">Prossimi passi: un dominio proprio, un secondo computer per backup e servizi di casa, nuovi giochi.</p>
        <p><a class="cta" href="giochi.php">Prova i giochi</a></p>
    </main>

    <footer class="foot">
        <a href="giochi.php">Giochi</a>
        <a href="https://github.com/G1anPietro/vector-box" rel="noopener">Codice sorgente</a>
        <a href="../index.php">Torna al sito</a>
    </footer>
</body>
</html>
