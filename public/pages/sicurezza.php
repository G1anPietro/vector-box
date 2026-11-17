<?php
// public/pages/sicurezza.php — how the site protects accounts and data, its honest limits, and how to report a
// vulnerability (/.well-known/security.txt points here).
// Keep it true: every sentence describes something the code does. If the code changes, change this page with it.
require_once __DIR__ . '/../includes/head.php';
require_once __DIR__ . '/../api/retention.php';

$lang = pageLang();
$it = $lang === 'it';
$other = $it ? 'en' : 'it';
$email = trim((string)envValue('CONTACT_EMAIL', ''));
$email = filter_var($email, FILTER_VALIDATE_EMAIL) ? $email : '';
$mailto = $email ? '<a href="mailto:' . htmlspecialchars($email) . '">' . htmlspecialchars($email) . '</a>' : '';
$cspOn = strtolower((string)envValue('CSP_ENFORCE', 'false')) === 'true';   // the same test as sendPageSecurityHeaders()
$updated = '2026-11-17';
?>
<!DOCTYPE html>
<html lang="<?= $lang ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#16141c">
    <title><?= $it ? 'Sicurezza' : 'Security' ?> — vector-box</title>
    <?= socialMeta($it ? 'Sicurezza — vector-box' : 'Security — vector-box',
        $it ? 'Come vector-box protegge account, password e dati, quali sono i suoi limiti e come segnalare una vulnerabilità.'
            : 'How vector-box protects accounts, passwords and data, what its limits are and how to report a vulnerability.',
        '/pages/sicurezza.php', '/assets/og/desktop.jpg') ?>
    <link rel="stylesheet" href="../css/giochi.css?v=4">
</head>
<body>
    <header class="top">
        <a class="home" href="../index.php">vector-box</a>
        <a class="lang" href="?lang=<?= $other ?>" hreflang="<?= $other ?>"><?= strtoupper($other) ?></a>
    </header>

    <main class="doc">
<?php if ($it): ?>
        <h1>Sicurezza</h1>
        <p class="muted">Ultimo aggiornamento: <?= $updated ?></p>
        <p>Questa pagina spiega in parole semplici come vector-box protegge gli account e i dati, dove non arriva, e come
        segnalare un problema di sicurezza. Quali dati vengono tenuti, perché e per quanto tempo è scritto nella
        <a href="privacy.php">pagina privacy</a>. Il codice è pubblico: chiunque può controllare quello che c'è scritto qui
        (<a href="https://github.com/G1anPietro/vector-box" rel="noopener">codice sorgente</a>).</p>

        <h2>Account e password</h2>
        <ul>
            <li><strong>La password non viene mai salvata.</strong> Il sito tiene solo la sua impronta (un hash bcrypt, fatto
            apposta per essere lento da provare): nemmeno chi gestisce il sito può leggerla. Una password nuova deve avere da 8 a 72 caratteri.</li>
            <li><strong>Tentativi di accesso limitati:</strong> al massimo 10 ogni 5 minuti da uno stesso indirizzo e 5 ogni 5 minuti
            sulla stessa coppia account + indirizzo, così chi prova password a raffica viene fermato senza bloccare il vero proprietario.
            Le registrazioni sono al massimo 5 all'ora per indirizzo. Se il contatore stesso si guasta, accesso e registrazione
            rifiutano invece di lasciar passare.</li>
            <li><strong>Stessa risposta</strong> ("credenziali non valide") sia per un nome che non esiste sia per una password sbagliata.</li>
            <li><strong>Verifica in due passaggi per gli amministratori:</strong> chi gestisce il sito entra con la password e un codice a 6 cifre che cambia ogni 30 secondi (app tipo Aegis o Google Authenticator), e ogni codice vale una volta sola. Il segreto è salvato cifrato; i codici di emergenza sono salvati solo come impronta.</li>
            <li><strong>Nomi unici</strong> anche cambiando maiuscole e minuscole, e i nomi che sembrano dello staff
            (admin, moderator, support…) sono riservati: nessuno può fingersi il gestore.</li>
            <li><strong>Puoi andartene:</strong> dalla pagina Account scarichi tutti i tuoi dati e cancelli l'account da solo
            (per cancellarlo serve di nuovo la password).</li>
        </ul>

        <h2>Sessioni</h2>
        <ul>
            <li>Restare collegati dipende da un cookie che il JavaScript della pagina non può leggere (<code>HttpOnly</code>),
            che non viaggia nelle richieste fatte di nascosto da altri siti (<code>SameSite=Lax</code>) e, in HTTPS, solo su connessioni cifrate (<code>Secure</code>). Dura 7 giorni.</li>
            <li>Il codice della sessione cambia a ogni accesso, e un codice inventato da qualcun altro viene rifiutato.</li>
            <li>A ogni azione che richiede l'accesso il sito ricontrolla nel database che l'account esista ancora e se è amministratore: un account
            cancellato esce subito anche dagli altri dispositivi, e un permesso tolto smette di valere subito.</li>
        </ul>

        <h2>Richieste false da altri siti (CSRF)</h2>
        <p>Le azioni che modificano qualcosa (scrivere, caricare, cancellare, cambiare impostazioni) vogliono un codice segreto legato
        alla tua sessione, che un altro sito non conosce: senza, la richiesta è rifiutata. Le eccezioni, dette chiaramente: l'accesso e
        la registrazione (protetti dai limiti qui sopra), l'uscita (rifiutata se parte da un altro sito) e i link dentro le e-mail,
        che portano una loro firma.</p>

        <h2>Testo e codice nelle pagine (XSS)</h2>
        <ul>
            <li>Quello che scrivono gli utenti viene messo nelle pagine come testo, non come HTML: non può diventare codice. Vale anche per i testi scritti dall'AI negli appunti.</li>
            <li>Le pagine HTML caricate negli appunti vengono riscritte tenendo solo i tag ammessi (niente script, moduli, frame) e mostrate in un riquadro isolato.</li>
            <li>Una <strong>Content-Security-Policy</strong> dice al browser da dove possono arrivare gli script.
            <?= $cspOn ? 'In questo momento è applicata.' : 'In questo momento è in modalità "solo segnalazione": il browser avvisa ma non blocca.' ?>
            Gli stili scritti dentro la pagina restano permessi.</li>
            <li>Le pagine PHP mandano anche le intestazioni contro il clickjacking e l'indovinare il tipo dei file, e in HTTPS chiedono al browser di non tornare più a HTTP (HSTS).</li>
            <li>Le librerie esterne del lettore di libri (da due CDN) sono caricate con un controllo di integrità: se il file cambia, il browser non lo esegue.</li>
        </ul>

        <h2>Limiti contro gli abusi</h2>
        <p>Oltre all'accesso, hanno un limite di richieste la chat, i messaggi privati, il muro, il modulo Uplink, i codici d'invito
        delle classi, i caricamenti, i link temporanei, le stanze dei giochi e altro. I programmi che raschiano il sito vengono
        rifiutati, e chi cerca a tappeto pagine di amministrazione che qui non esistono viene rallentato.</p>

        <h2>File caricati</h2>
        <ul>
            <li>Si controlla il <strong>contenuto vero</strong> del file, non solo l'estensione, e sono ammessi solo i tipi previsti (per i libri: EPUB e PDF, e solo da chi ha il permesso).</li>
            <li>I file stanno <strong>fuori dalla cartella pubblica</strong>: non hanno un indirizzo diretto, li consegna il sito dopo aver controllato chi li chiede.</li>
            <li>Negli appunti di classe ci sono limiti di dimensione per file e per classe, e il materiale lo vedono solo i membri della classe e l'amministratore.</li>
            <li>I <strong>link temporanei</strong> al materiale sono codici casuali lunghi: il server ne tiene solo l'impronta, scadono, si possono revocare e possono avere un numero massimo di aperture.</li>
        </ul>

        <h2>Chat e messaggi privati</h2>
        <p>Nelle funzioni del sito non esiste un modo, nemmeno per l'amministratore, di leggere i messaggi privati di altri. I messaggi però
        sono salvati in chiaro nel database (vedi i limiti più sotto). La chat in tempo reale usa un biglietto firmato che vale 60 secondi e una sola connessione.</p>

        <h2>E-mail</h2>
        <p>L'indirizzo e-mail è facoltativo. Vale solo dopo che lo hai confermato con un link firmato, valido solo per quell'indirizzo.
        Le novità arrivano solo a chi le ha chieste con una casella separata, e ogni messaggio ha un link per smettere; il consenso
        viene ricontrollato al momento dell'invio. La chiave del servizio di posta sta solo nella configurazione del server, mai nel codice.</p>

        <h2>Dove stanno i dati e le copie</h2>
        <ul>
            <li>Tutto sta su un piccolo server di casa: un database e una cartella di file, fuori dalla parte pubblica del sito. I dettagli su cosa e per quanto tempo sono nella <a href="privacy.php">pagina privacy</a>.</li>
            <li>I dati vecchi si cancellano da soli una volta al giorno (per esempio gli indirizzi IP dei messaggi dopo <?= retentionDays('IP') ?> giorni).</li>
            <li>Ogni notte è prevista una copia di sicurezza del database, controllata prima di essere salvata, su un secondo disco; le copie giornaliere sono tenute 30 giorni, quelle settimanali 12 settimane e quelle mensili 12 mesi.</li>
            <li>Gli errori del server finiscono in un registro che vede solo l'amministratore: al browser arriva un messaggio generico.</li>
        </ul>

        <h2>I limiti, detti onestamente</h2>
        <ul>
            <li>È il progetto di <strong>una persona sola</strong>, non di un'azienda. Ci sono centinaia di test automatici e più giri di revisione, ma <strong>nessun controllo di sicurezza fatto da professionisti esterni</strong>.</li>
            <li><strong>Non c'è l'accesso in due passaggi</strong> (2FA) e non c'è il recupero automatico della password dimenticata: usa una password lunga e solo per questo sito.</li>
            <li>Il database <strong>non è cifrato sul disco</strong>: chi gestisce il server può tecnicamente leggere quello che c'è salvato, messaggi privati compresi (le password no: ci sono solo le impronte).</li>
            <li>Le copie di sicurezza <strong>non sono cifrate</strong> e stanno nella stessa casa del server: un furto o un incendio colpirebbero tutti e due.</li>
            <li>I link temporanei e quelli nelle e-mail portano il codice nell'indirizzo, che resta nei registri del server: trattali come una chiave.</li>
            <li>Se il contatore dei limiti si guasta, quasi tutti i limiti lasciano passare invece di fermare il sito (accesso e registrazione no).</li>
            <li>Il materiale degli appunti di classe può essere letto da un servizio esterno di intelligenza artificiale: quando e come è scritto nella pagina privacy. Non caricare dati personali.</li>
            <li>È un server di casa: può restare spento o irraggiungibile.</li>
        </ul>

        <h2 id="segnala">Segnalare una vulnerabilità</h2>
        <p>Se trovi un problema di sicurezza, scrivimi: <?= $mailto ? $mailto . ', oppure usa ' : 'usa ' ?>l'<strong>Uplink</strong> nella
        <a href="../index.php">pagina principale</a> (arriva solo al gestore; è corto, quindi lascia un modo per risponderti e i dettagli te li chiedo io). In italiano o in inglese.</p>
        <ul>
            <li>Dimmi cosa hai trovato, dove, e come si riproduce.</li>
            <li>Per favore <strong>non renderlo pubblico</strong> prima che sia stato corretto: dammi un tempo ragionevole.</li>
            <li>Prova solo sul <strong>tuo</strong> account: non leggere, modificare o cancellare i dati di altri, non mandare richieste a raffica per far cadere il sito, niente spam e niente inganni alle persone.</li>
            <li><strong>Non ci sono ricompense in denaro</strong>: è un sito personale senza scopo di lucro. Se vuoi, ti ringrazio per nome.</li>
            <li>Rispondo appena posso: sono una persona sola.</li>
        </ul>
        <p class="muted">Per i programmi: <a href="../.well-known/security.txt">/.well-known/security.txt</a>.</p>
<?php else: ?>
        <h1>Security</h1>
        <p class="muted">Last updated: <?= $updated ?></p>
        <p>This page explains in plain words how vector-box protects accounts and data, where it falls short, and how to report
        a security problem. Which data is kept, why and for how long is on the <a href="privacy.php">privacy page</a>. The code is
        public: anyone can check what is written here (<a href="https://github.com/G1anPietro/vector-box" rel="noopener">source code</a>).</p>

        <h2>Accounts and passwords</h2>
        <ul>
            <li><strong>Your password is never stored.</strong> The site keeps only its fingerprint (a bcrypt hash, made to be slow
            to guess): not even the owner can read it. A new password must be 8 to 72 characters long.</li>
            <li><strong>Limited login attempts:</strong> at most 10 every 5 minutes from one address and 5 every 5 minutes for the same
            account + address pair, so someone trying passwords in bulk is stopped without locking the real owner out. Sign-ups are
            limited to 5 an hour per address. If the counter itself breaks, login and sign-up refuse instead of letting requests through.</li>
            <li><strong>The same answer</strong> ("invalid credentials") for a name that does not exist and for a wrong password.</li>
            <li><strong>Two-step login for administrators:</strong> whoever runs the site signs in with the password and a 6-digit code that changes every 30 seconds (an app like Aegis or Google Authenticator), and each code works only once. The secret is stored encrypted; backup codes are stored only as hashes.</li>
            <li><strong>Names are unique</strong> even when only the capital letters differ, and names that look like staff
            (admin, moderator, support…) are reserved: nobody can pose as the owner.</li>
            <li><strong>You can leave:</strong> on the Account page you can download all your data and delete the account yourself
            (deleting asks for the password again).</li>
        </ul>

        <h2>Sessions</h2>
        <ul>
            <li>Staying logged in relies on a cookie that the page's JavaScript cannot read (<code>HttpOnly</code>), that is not sent
            with requests made by other sites behind your back (<code>SameSite=Lax</code>) and, on HTTPS, only over encrypted connections (<code>Secure</code>). It lasts 7 days.</li>
            <li>The session code changes at every login, and a code invented by someone else is refused.</li>
            <li>On every action that needs a login the site asks the database again whether the account still exists and whether it is an admin: a deleted
            account is logged out on its other devices at once, and a removed permission stops working at once.</li>
        </ul>

        <h2>Forged requests from other sites (CSRF)</h2>
        <p>Actions that change something (writing, uploading, deleting, changing settings) need a secret code tied to your session,
        which another site does not know: without it the request is refused. The exceptions, stated plainly: login and sign-up
        (protected by the limits above), logout (refused when it starts from another site) and the links inside e-mails, which carry
        their own signature.</p>

        <h2>Text and code in pages (XSS)</h2>
        <ul>
            <li>What users write is put into pages as text, not as HTML: it cannot become code. The same goes for the text the AI writes in class notes.</li>
            <li>HTML pages uploaded to class notes are rewritten keeping only allowed tags (no scripts, forms, frames) and shown in an isolated frame.</li>
            <li>A <strong>Content-Security-Policy</strong> tells the browser where scripts may come from.
            <?= $cspOn ? 'It is enforced right now.' : 'Right now it is in "report-only" mode: the browser warns but does not block.' ?>
            Styles written inside the page remain allowed.</li>
            <li>PHP pages also send the headers against clickjacking and file-type guessing, and on HTTPS ask the browser never to go back to HTTP (HSTS).</li>
            <li>The book reader's outside libraries (from two CDNs) are loaded with an integrity check: if the file changes, the browser does not run it.</li>
        </ul>

        <h2>Limits against abuse</h2>
        <p>Besides login, there are request limits on the chat, private messages, the wall, the Uplink form, class invite codes,
        uploads, temporary links, game rooms and more. Programs that scrape the site are refused, and whoever sweeps for admin pages
        that do not exist here is slowed down.</p>

        <h2>Uploaded files</h2>
        <ul>
            <li>The file's <strong>real content</strong> is checked, not just its extension, and only the expected types are accepted (for books: EPUB and PDF, and only from accounts with the permission).</li>
            <li>Files live <strong>outside the public folder</strong>: they have no direct address; the site hands them out after checking who is asking.</li>
            <li>Class notes have size limits per file and per class, and the material is visible only to the members of the class and the admin.</li>
            <li><strong>Temporary links</strong> to material are long random codes: the server keeps only their fingerprint, they expire, can be revoked and can have a maximum number of openings.</li>
        </ul>

        <h2>Chat and private messages</h2>
        <p>The site has no feature, not even for the admin, to read other people's private messages. The messages are, however, stored
        unencrypted in the database (see the limits below). The live chat uses a signed ticket valid for 60 seconds and one connection.</p>

        <h2>E-mail</h2>
        <p>The e-mail address is optional. It counts only after you confirm it through a signed link, valid for that address only.
        News goes only to those who asked for it with a separate checkbox, and every message has a link to stop; consent is checked
        again at the moment of sending. The mail service key lives only in the server's configuration, never in the code.</p>

        <h2>Where the data and the copies are</h2>
        <ul>
            <li>Everything is on a small home server: one database and one folder of files, outside the public part of the site. What is kept and for how long is on the <a href="privacy.php">privacy page</a>.</li>
            <li>Old data is deleted automatically once a day (for example the IP addresses of messages after <?= retentionDays('IP') ?> days).</li>
            <li>A backup copy of the database is scheduled every night, checked before it is saved, on a second disk; daily copies are kept 30 days, weekly ones 12 weeks and monthly ones 12 months.</li>
            <li>Server errors go to a log only the admin can see: the browser gets a generic message.</li>
        </ul>

        <h2>The limits, honestly</h2>
        <ul>
            <li>This is <strong>one person's</strong> project, not a company's. There are hundreds of automated tests and several review passes, but <strong>no security audit by outside professionals</strong>.</li>
            <li>There is <strong>no two-step login</strong> (2FA) and no automatic recovery of a forgotten password: use a long password, for this site only.</li>
            <li>The database is <strong>not encrypted on disk</strong>: whoever runs the server can technically read what is stored, private messages included (not passwords: only their fingerprints are there).</li>
            <li>Backups are <strong>not encrypted</strong> and are kept in the same house as the server: a theft or a fire would hit both.</li>
            <li>Temporary links and the links in e-mails carry their code in the address, which stays in the server's logs: treat them like a key.</li>
            <li>If the limit counter breaks, almost all limits let requests through rather than stopping the site (login and sign-up do not).</li>
            <li>Class-notes material can be read by an outside artificial-intelligence service: when and how is on the privacy page. Do not upload personal data.</li>
            <li>It is a home server: it can be off or unreachable.</li>
        </ul>

        <h2 id="segnala">Reporting a vulnerability</h2>
        <p>If you find a security problem, write to me: <?= $mailto ? $mailto . ', or use ' : 'use ' ?>the <strong>Uplink</strong> on the
        <a href="../index.php">main page</a> (it reaches only the owner; it is short, so leave a way to answer you and I will ask for the details). In Italian or English.</p>
        <ul>
            <li>Tell me what you found, where, and how to reproduce it.</li>
            <li>Please <strong>do not make it public</strong> before it is fixed: give me a reasonable time.</li>
            <li>Test only on <strong>your own</strong> account: do not read, change or delete other people's data, do not flood the site to bring it down, no spam and no tricking people.</li>
            <li><strong>There are no money rewards</strong>: this is a personal, non-profit site. If you like, I will thank you by name.</li>
            <li>I answer as soon as I can: I am one person.</li>
        </ul>
        <p class="muted">For programs: <a href="../.well-known/security.txt">/.well-known/security.txt</a>.</p>
<?php endif; ?>
    </main>

    <footer class="foot">
        <a href="giochi.php"><?= $it ? 'Giochi' : 'Games' ?></a>
        <a href="privacy.php">Privacy</a>
        <a href="progetto.php"><?= $it ? 'Il progetto' : 'About the project' ?></a>
        <a href="../index.php"><?= $it ? 'Torna al sito' : 'Back to the site' ?></a>
    </footer>
</body>
</html>
