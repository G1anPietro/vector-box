<?php
// public/pages/privacy.php — privacy and cookie notice (needed for AdSense and the GDPR).
// Keep it true: if the site starts storing something new, update this page.
require_once __DIR__ . '/../includes/head.php';
require_once __DIR__ . '/../api/retention.php';
require_once __DIR__ . '/../includes/ads.php';

$lang = pageLang();
$it = $lang === 'it';
$other = $it ? 'en' : 'it';
$email = trim((string)envValue('CONTACT_EMAIL', ''));
$email = filter_var($email, FILTER_VALIDATE_EMAIL) ? $email : '';
$adsOn = adsenseClient() !== '';
$updated = '2026-11-16';
?>
<!DOCTYPE html>
<html lang="<?= $lang ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#16141c">
    <title>Privacy — vector-box</title>
    <?php if ($adsOn && !adsHiddenForViewer()): ?><meta name="vb-ads" content="<?= adsConsentMode() ?>"><script src="../js/cookie_consent.js?v=<?= htmlspecialchars(defined('APP_VERSION') ? APP_VERSION : '1') ?>"></script><?php endif; ?>
    <link rel="stylesheet" href="../css/giochi.css?v=4">
</head>
<body>
    <header class="top">
        <a class="home" href="../index.php">vector-box</a>
        <a class="lang" href="?lang=<?= $other ?>" hreflang="<?= $other ?>"><?= strtoupper($other) ?></a>
    </header>

    <main class="doc">
<?php if ($it): ?>
        <h1>Privacy e cookie</h1>
        <p class="muted">Ultimo aggiornamento: <?= $updated ?></p>
        <p>Questa pagina spiega, in modo semplice, quali dati personali tratta vector-box, perché, per quanto tempo, a chi arrivano e
        come puoi esercitare i tuoi diritti (Regolamento UE 2016/679, "GDPR", e D.Lgs. 196/2003).</p>

        <h2>Chi è il titolare del trattamento</h2>
        <p>vector-box è un sito personale e senza scopo commerciale gestito da Denys Khavruniak, in Italia, che decide perché e come
            si trattano i dati (titolare del trattamento). Per qualsiasi richiesta sui tuoi dati:
            <?= $email ? '<a href="mailto:' . htmlspecialchars($email) . '">' . htmlspecialchars($email) . '</a>, oppure ' : '' ?>l’Uplink nella pagina principale.
            Non è stato nominato un responsabile della protezione dei dati (DPO) perché non è obbligatorio per un sito di questo tipo.</p>

        <h2>Quali dati, perché e per quanto tempo</h2>
        <p>Per ogni trattamento: i dati, lo scopo, la base giuridica (la ragione per cui la legge lo permette) e per quanto tempo restano.</p>
        <ul>
            <li><strong>Account</strong> (se lo crei): nome utente, password (salvata solo in forma cifrata e non leggibile, nemmeno da chi gestisce il sito), tema, biografia, data di creazione e i permessi (per un amministratore che attiva l’accesso in due passaggi: il segreto, salvato cifrato, e i codici di emergenza, salvati solo come impronta). Le azioni che un amministratore compie sul tuo account (ban, permessi, badge) vengono registrate con la data e conservate <?= retentionDays('ADMINLOG') ?> giorni.
                <em>Scopo:</em> farti entrare e usare il sito. <em>Base:</em> esecuzione del servizio che chiedi (art. 6.1.b GDPR).
                <em>Quanto:</em> finché non cancelli l’account (puoi farlo da solo dalla pagina Account).</li>
            <li><strong>Chat, messaggi privati, libro degli ospiti e scatola delle idee:</strong> il testo che scrivi, il tuo nome utente e, per sicurezza, l’indirizzo IP. Un’idea che un amministratore sta valutando è mostrata alle altre persone con un account senza il tuo nome, e se l’amministratore la mette nella bacheca delle novità il suo testo è mostrato lì a tutti, sempre senza il tuo nome, e i tuoi voti alle idee sono salvati con il tuo account.
                <em>Base:</em> esecuzione del servizio; l’IP per il legittimo interesse alla sicurezza (art. 6.1.f).
                <em>Quanto:</em> l’indirizzo IP <?= retentionDays('IP') ?> giorni; i messaggi pubblici, il libro degli ospiti e le idee <?= retentionDays('CHAT') ?> giorni; i messaggi privati <?= retentionDays('DM') ?> giorni; poi si cancellano da soli. Se cancelli l’account spariscono subito.</li>
            <li><strong>Indirizzo IP e registri tecnici:</strong> tentativi di accesso, limiti di velocità, errori del server.
                <em>Scopo:</em> sicurezza e blocco degli abusi. <em>Base:</em> legittimo interesse (art. 6.1.f).
                <em>Quanto:</em> i contatori dei limiti circa un giorno; il registro degli errori è piccolo e si sovrascrive da solo.</li>
            <li><strong>Visite:</strong> per ogni nuova visita data e ora, indirizzo IP, pagina, tipo di browser e sistema, e il sito da cui arrivi; un codice non reversibile (impronta di IP e browser) serve a riconoscere chi torna. Ogni nuova visita può inviare una notifica al gestore.
                <em>Scopo:</em> sapere se il sito è usato e individuare problemi. <em>Base:</em> legittimo interesse (art. 6.1.f).
                <em>Quanto:</em> <?= retentionDays('VISITS') ?> giorni. I bot e i programmi automatici non sono visite: se arrivano a una pagina se ne annotano IP, tipo e indirizzo cercato per <?= retentionDays('BOTS') ?> giorni, e restano solo i totali giornalieri, senza IP, per circa un anno.</li>
            <li><strong>Libreria e lettore di libri</strong> (solo account autorizzati): segnalibri e avanzamento di lettura. <em>Base:</em> servizio. <em>Quanto:</em> finché l’account esiste.</li>
            <li><strong>Giochi:</strong> partite, impostazioni e statistiche restano nel tuo browser (memoria locale). Per le stanze multigiocatore il server conserva i nomi scelti e lo stato della partita finché la stanza è attiva. Le statistiche del poker sono legate all’account.</li>
            <li><strong>Classifiche dei giochi</strong> (Tetris, 2048, Snake, Campo minato; solo se hai un account): per ogni gioco il tuo miglior risultato, con il tuo nome utente e la data. Sono <em>pubblici</em>: li vede chiunque nella pagina Classifiche, anche senza account. Non si salvano né IP né altri dati. <em>Base:</em> servizio che chiedi. <em>Quanto:</em> finché non cancelli l’account (spariscono subito).</li>
            <li><strong>Appunti di classe:</strong> il materiale che carichi (testi, foto, file, audio), con il tuo nome utente, la data e la materia, il calendario, i compiti e i documenti di studio ricavati; anche i punteggi di quiz e classifica, la tua appartenenza alla classe e le opzioni che scegli. Li vedono solo i compagni della stessa classe e l’amministratore.
                <em>Base:</em> servizio. <em>Quanto:</em> finché esiste la classe, oppure finché tu, il responsabile o l’amministratore li cancellate. Se cancelli l’account puoi scegliere se cancellare anche il materiale che hai caricato, o lasciarlo nella classe senza il tuo nome.</li>
            <li><strong>Richieste di classe:</strong> nome della classe, scuola, la nota che scrivi e il tuo account; per limitare lo spam si conta anche quante richieste arrivano dallo stesso indirizzo IP. <em>Base:</em> servizio e legittimo interesse. <em>Quanto:</em> finché la classe esiste o fino alla risposta.</li>
            <li><strong>Dispositivi collegati</strong> (se hai un account): per ogni browser in cui hai eseguito l’accesso, un nome ricavato dal browser (per esempio “Firefox su Linux”), il paese (dall’indirizzo IP, che non viene salvato) e le date di accesso e ultimo utilizzo; dell’identificativo di sessione si salva solo un’impronta. <em>Scopo:</em> farti vedere e chiudere le tue sessioni. <em>Base:</em> esecuzione del servizio (art. 6.1.b GDPR). <em>Quanto:</em> finché esci, cancelli l’account o per <?= retentionDays('SESSIONS') ?> giorni di inattività.</li>
            <li><strong>Link temporanei:</strong> il server salva solo una versione cifrata del codice, la scadenza e quante volte è stato aperto. Chi apre il link non ha bisogno di un account. <em>Quanto:</em> fino a <?= retentionDays('SHARE') ?> giorni dopo la scadenza.</li>
            <li><strong>Notifiche:</strong> avvisi nel sito e, solo se li attivi dal browser, notifiche push (il browser ci dà un indirizzo tecnico per inviartele). <em>Base:</em> il tuo consenso (il permesso del browser, che puoi ritirare quando vuoi). <em>Quanto:</em> le notifiche <?= retentionDays('NOTIF') ?> giorni; l’iscrizione push finché non la togli.</li>
            <li><strong>Classe di esempio:</strong> la classe "5ª A" è finta (compagni, appunti, voti e date inventati) e la può guardare chiunque, anche senza account, solo in lettura. I visitatori senza account non caricano né scaricano nulla e non lasciano dati nella classe; il materiale di esempio non viene mai inviato all’intelligenza artificiale.</li>
            <li><strong>Donazioni:</strong> se doni, il pagamento avviene sul servizio esterno (vector-box non vede né salva dati di pagamento). Il gestore può annotare a mano importo, data e il nome che preferisci, e collegare il tuo account per il distintivo di sostenitore. Il nome compare in "Dove vanno i soldi" solo se lo hai chiesto. <em>Base:</em> il tuo consenso per nome e distintivo; l’obbligo di legge (contabilità e fisco) per importo e data. <em>Quanto:</em> importo e data fino a 10 anni, come richiede la legge; nome, distintivo e collegamento all’account finché non chiedi di toglierli.</li>
            <li><strong>E-mail</strong> (facoltativa): se aggiungi un indirizzo nelle impostazioni dell’account lo conserviamo, la conferma (clic su un link che ti mandiamo) e, se hai scelto di ricevere le novità, la data in cui l’hai fatto. Ti scriviamo per confermare l’indirizzo e, solo se hai spuntato la casella, per le novità del sito (poche, con un link per smettere con un clic). L’invio passa da un servizio di posta esterno scelto dal gestore, che riceve l’indirizzo e il testo del messaggio solo per consegnarlo.
                <em>Base:</em> il tuo consenso (art. 6.1.a) per le novità; per il messaggio di conferma, il servizio che chiedi. <em>Quanto:</em> finché non li togli dalle impostazioni o non cancelli l’account; i messaggi già inviati restano nella coda tecnica fino alla cancellazione dell’account.</li>
        </ul>
        <p>I dati stanno sul server di casa del sito, non vengono venduti né ceduti a nessuno per pubblicità. Ogni notte se ne fa una copia di sicurezza: le copie sono tenute 30 giorni, quindi un dato cancellato sparisce anche dalle copie entro 30 giorni.</p>

        <h2>Con chi li condivido e dove vanno</h2>
        <ul>
            <li><strong>Google Gemini</strong> (intelligenza artificiale, Google, anche negli Stati Uniti): per trascrivere le foto e preparare riassunti, dispense e quiz, il materiale caricato in una classe (con i nomi utente di chi l’ha caricato) viene inviato a Gemini, <strong>solo se la classe è stata dichiarata di soli studenti maggiorenni</strong> (lo si dichiara quando si chiede la classe; il rappresentante può accendere o spegnere l’AI dalle impostazioni, per esempio quando tutti diventano maggiorenni), sul livello gratuito: secondo i termini di Google, in questo caso Google può usare i contenuti per migliorare i propri prodotti e alcune persone possono leggerli. Per questo <strong>non caricare dati personali</strong> (tuoi o di altri), voti, documenti d’identità o informazioni sulla salute. I testi che ne escono sono generati automaticamente e possono contenere errori; nessuna decisione che riguarda le persone è presa da un sistema automatico. Termini di Google: <a href="https://ai.google.dev/gemini-api/terms" rel="noopener">ai.google.dev/gemini-api/terms</a>.</li>
            <li><strong>Notifiche al gestore (ntfy):</strong> alcuni avvisi (nuova visita, errori, backup) arrivano al telefono del gestore tramite un servizio di notifiche; contengono tra l’altro IP, pagina e browser di chi visita.</li>
            <li><strong>Librerie del lettore</strong> (cdnjs.cloudflare.com, cdn.jsdelivr.net): vedono il tuo indirizzo IP, come ogni sito che visiti.</li>
            <li><strong>Pubblicità (Google AdSense):</strong> <?= $adsOn ? 'attiva sulle pagine dei giochi' : 'non ancora attiva; quando lo sarà, comparirà sulle pagine dei giochi' ?>. Google e i suoi partner usano cookie e identificatori solo dopo il tuo consenso nel messaggio di Google. Non vedono i tuoi messaggi né i tuoi appunti. Come li usa Google: <a href="https://policies.google.com/technologies/partner-sites?hl=it" rel="noopener">policies.google.com/technologies/partner-sites</a>.</li>
            <li><strong>Servizio di donazioni</strong> (Ko-fi, PayPal o simili, se presente): quando clicchi su "Dona" passi alla loro pagina e vale la loro informativa.</li>
        </ul>
        <p>Google e gli altri servizi esterni possono trattare i dati anche fuori dall’Unione Europea (per esempio negli Stati Uniti), con le garanzie previste dal GDPR (clausole contrattuali standard o decisione di adeguatezza del Data Privacy Framework).</p>

        <h2>I tuoi diritti e come esercitarli</h2>
        <ul>
            <li><strong>Vedere e scaricare i tuoi dati</strong> (accesso e portabilità): dalla pagina <a href="account.php">Account</a> il pulsante "Download my data" scarica un file con tutto.</li>
            <li><strong>Correggerli:</strong> biografia e password si cambiano dalla pagina Account; per il resto scrivi al contatto qui sopra.</li>
            <li><strong>Cancellarli</strong> (diritto all’oblio): dalla pagina Account, "Delete my account" cancella subito l’account, i messaggi, i progressi e l’appartenenza alle classi. Chi gestisce una classe deve prima cederla o chiuderla. Le donazioni restano senza il tuo nome solo per la contabilità. Se non hai un account o non riesci, scrivimi e rispondo entro un mese.</li>
            <li><strong>Opporti, limitare il trattamento, ritirare il consenso</strong> (per esempio alle notifiche o alla pubblicità personalizzata): scrivimi o usa le impostazioni del browser e il messaggio sulla pubblicità.</li>
            <li><strong>Reclamo:</strong> hai diritto di presentare reclamo al Garante per la protezione dei dati personali (<a href="https://www.garanteprivacy.it" rel="noopener">garanteprivacy.it</a>).</li>
        </ul>

        <h2>Età minima</h2>
        <p>In Italia si può dare il consenso al trattamento dei propri dati online dai <strong>14 anni</strong>. Se hai meno di 14 anni, per creare un account serve il consenso di un genitore o di chi ne fa le veci; i giochi si possono usare senza account. Non raccolgo di proposito dati di bambini piccoli: se scopro un account di qualcuno troppo giovane senza consenso, lo cancello.</p>

        <h2>Sicurezza</h2>
        <p>Il sito usa HTTPS, le password sono salvate cifrate, l’accesso ai dati è limitato al gestore e il server è aggiornato e protetto da limiti contro gli abusi. Se capitasse una violazione che mette a rischio i tuoi dati, la segnalerei al Garante entro 72 ore e avviserei chi è coinvolto. Come sono protetti account e dati, i limiti e come segnalare un problema: <a href="sicurezza.php">pagina Sicurezza</a>.</p>

        <h2>Cookie e memoria del browser</h2>
        <p>Un cookie è un piccolo file che il browser salva; la "memoria locale" (localStorage) è lo stesso, ma resta solo nel tuo browser. Qui trovi tutto quello che il sito salva, diviso per tipo.</p>
        <ul>
            <li><strong>Tecnici e di funzionalità (non serve il tuo consenso):</strong> servono a darti il servizio che chiedi o a ricordare una scelta che hai fatto tu, e non vanno a nessun altro.
                <ul>
                    <li>Il cookie di sessione (<code>PHPSESSID</code> o simile): restare collegati e proteggere i moduli. Finisce quando chiudi il browser o dopo pochi giorni.</li>
                    <li><code>vb_lang</code> (la lingua scelta, un anno) e <code>vb_chat_ticket</code> (collega la chat in tempo reale a chi sei).</li>
                    <li><code>vb_consent</code> (6 mesi): ricorda cosa hai scelto sulla pubblicità, così non ti chiedo ogni volta.</li>
                    <li>Il tema grafico e le opzioni del menu (sfondo matrix, vetro smerigliato, mano sinistra), la posizione delle finestre, la scheda aperta, il tema e l’avanzamento del lettore, le partite dei giochi: nel cookie <code>selected_theme</code> e nella memoria locale del tuo browser. Se hai un account il tema si salva anche lì.</li>
                </ul></li>
            <li><strong>Pubblicità (Google AdSense), solo con il tuo consenso:</strong> <?= $adsOn ? 'le pagine dei giochi mostrano annunci di Google' : 'quando saranno attivi, le pagine dei giochi mostreranno annunci di Google' ?>. Finché non premi "Accetta" nel messaggio sui cookie, il sito <strong>non carica nulla da Google</strong> e non compare nessun annuncio. Se accetti, Google e i suoi partner possono usare cookie e identificatori per mostrare e misurare gli annunci. "Rifiuta" e "Accetta" valgono allo stesso modo; puoi cambiare idea in ogni momento con il link "Cookie" in fondo alle pagine dei giochi<?= $adsOn ? '' : ' (comparirà quando gli annunci saranno attivi)' ?>, e la scelta si richiede dopo 6 mesi. Non c’è pubblicità negli appunti di classe, nell’account né nel lettore.<?= ($adsOn && !adsHiddenForViewer()) ? ' <button type="button" data-vb-cookie>Cambia la tua scelta sulla pubblicità</button>' : '' ?></li>
            <li><strong>Statistiche:</strong> il sito non usa Google Analytics né altri strumenti di statistica di terzi: le visite si contano solo sul server (vedi sopra).</li>
        </ul>

        <h2>Modifiche</h2>
        <p>Se cambia qualcosa nei dati che il sito tratta, questa pagina viene aggiornata <em>prima</em> e la data in alto cambia. Per le novità importanti lo dico anche sul sito.</p>
<?php else: ?>
        <h1>Privacy and cookies</h1>
        <p class="muted">Last updated: <?= $updated ?></p>
        <p>This page explains, in plain words, which personal data vector-box handles, why, for how long, who receives it and how you can use
        your rights (EU Regulation 2016/679, "GDPR", and Italian Legislative Decree 196/2003).</p>

        <h2>Who is the data controller</h2>
        <p>vector-box is a personal, non-commercial website run by Denys Khavruniak, in Italy, who decides why and how data is handled (the
            data controller). For any request about your data:
            <?= $email ? '<a href="mailto:' . htmlspecialchars($email) . '">' . htmlspecialchars($email) . '</a>, or ' : '' ?>the Uplink on the main page.
            No Data Protection Officer has been appointed because one is not required for a site like this.</p>

        <h2>Which data, why and for how long</h2>
        <p>For each use: the data, the purpose, the legal basis (the reason the law allows it) and how long it is kept.</p>
        <ul>
            <li><strong>Account</strong> (if you create one): username, password (stored only as a one-way hash, unreadable even to the site’s owner), theme, bio, creation date and permissions (for an administrator who turns on two-step login: the secret, stored encrypted, and backup codes, stored only as hashes). Actions an administrator takes on your account (ban, permissions, badge) are written to a log with the date and kept for <?= retentionDays('ADMINLOG') ?> days.
                <em>Purpose:</em> to let you in and use the site. <em>Basis:</em> performing the service you ask for (art. 6.1.b GDPR).
                <em>How long:</em> until you delete the account (you can do it yourself from the Account page).</li>
            <li><strong>Chat, private messages, guestbook and ideas box:</strong> the text you write, your username and, for security, your IP address. An idea that an administrator is considering is shown to the other logged-in people without your name, and if the administrator puts it on the public news board its text is shown there to everybody, still without your name, and your votes on ideas are stored with your account.
                <em>Basis:</em> the service; the IP, a legitimate interest in security (art. 6.1.f).
                <em>How long:</em> the IP address <?= retentionDays('IP') ?> days; public messages, the guestbook and the ideas <?= retentionDays('CHAT') ?> days; private messages <?= retentionDays('DM') ?> days; then they are deleted automatically. If you delete the account they go at once.</li>
            <li><strong>IP address and technical logs:</strong> login attempts, rate limits, server errors.
                <em>Purpose:</em> security and stopping abuse. <em>Basis:</em> legitimate interest (art. 6.1.f).
                <em>How long:</em> rate-limit counters about a day; the error log is small and overwrites itself.</li>
            <li><strong>Visits:</strong> for each new visit the date and time, IP address, page, browser and system, and the site you came from; a one-way code (fingerprint of IP and browser) recognises who comes back. Each new visit may send a notification to the owner.
                <em>Purpose:</em> to know whether the site is used and spot problems. <em>Basis:</em> legitimate interest (art. 6.1.f).
                <em>How long:</em> <?= retentionDays('VISITS') ?> days. Bots and automated programs are not visits: when they reach a page their IP, type and requested address are noted for <?= retentionDays('BOTS') ?> days, and only daily totals, with no IP, stay for about a year.</li>
            <li><strong>Library and book reader</strong> (authorised accounts only): bookmarks and reading progress. <em>Basis:</em> the service. <em>How long:</em> while the account exists.</li>
            <li><strong>Games:</strong> games, settings and statistics stay in your browser (local storage). For multiplayer rooms the server keeps the chosen names and the game state while the room is active. Poker statistics are tied to the account.</li>
            <li><strong>Game leaderboards</strong> (Tetris, 2048, Snake, Minesweeper; only if you have an account): for each game your best result, with your username and the date. They are <em>public</em>: anyone can see them on the Leaderboards page, even without an account. No IP or other data is stored. <em>Basis:</em> the service you ask for. <em>How long:</em> until you delete the account (they disappear at once).</li>
            <li><strong>Class notes:</strong> the material you upload (text, photos, files, audio) with your username, date and subject, the calendar, homework and the study documents made from them; also quiz and leaderboard scores, your class membership and the options you choose. Only classmates in the same class and the admin can see them.
                <em>Basis:</em> the service. <em>How long:</em> while the class exists, or until you, the manager or the admin delete them. When you delete your account you can choose to delete the material you uploaded too, or leave it in the class without your name.</li>
            <li><strong>Class requests:</strong> the class name, school, the note you write and your account; to limit spam, requests per IP address are also counted. <em>Basis:</em> the service and legitimate interest. <em>How long:</em> while the class exists or until it is answered.</li>
            <li><strong>Signed-in devices</strong> (if you have an account): for each browser you signed in from, a name made from the browser (for example “Firefox on Linux”), the country (looked up from the IP address, which is not stored) and the dates of sign-in and last use; of the session identifier only a hash is kept. <em>Purpose:</em> so you can see and end your own sessions. <em>Basis:</em> performing the service (art. 6.1.b GDPR). <em>How long:</em> until you sign out, delete the account or <?= retentionDays('SESSIONS') ?> days of inactivity.</li>
            <li><strong>Temporary links:</strong> the server stores only a hashed version of the code, the expiry and how many times it was opened. Whoever opens the link needs no account. <em>How long:</em> up to <?= retentionDays('SHARE') ?> days after it expires.</li>
            <li><strong>Notifications:</strong> alerts in the site and, only if you turn them on in the browser, push notifications (the browser gives us a technical address to send them). <em>Basis:</em> your consent (the browser permission, which you can withdraw any time). <em>How long:</em> notifications <?= retentionDays('NOTIF') ?> days; the push subscription until you remove it.</li>
            <li><strong>Example class:</strong> the "5ª A" class is fake (invented classmates, notes, scores and dates) and anyone can look at it, even without an account, read-only. Visitors without an account cannot upload or download anything and leave no data in the class; the example material is never sent to the AI.</li>
            <li><strong>Donations:</strong> if you donate, payment happens on the external service (vector-box never sees or stores payment details). The owner may note by hand the amount, the date and the name you prefer, and link your account for the supporter badge. The name appears on "Where the money goes" only if you asked for it. <em>Basis:</em> your consent for name and badge; a legal duty (accounting and tax) for amount and date. <em>How long:</em> amount and date up to 10 years, as the law requires; name, badge and the link to your account until you ask to remove them.</li>
            <li><strong>E-mail</strong> (optional): if you add an address in the account settings we keep it, the confirmation (a click on a link we send you) and, if you chose to get news, the date you did so. We write to confirm the address and, only if you ticked the box, for site news (few, with a one-click way to stop). Sending goes through an outside mail service chosen by the owner, which receives the address and the text of the message only to deliver it.
                <em>Basis:</em> your consent (art. 6.1.a) for news; for the confirmation message, the service you ask for. <em>How long:</em> until you remove them in the settings or delete the account; messages already sent stay in the technical queue until the account is deleted.</li>
        </ul>
        <p>The data lives on the site’s home server and is never sold or handed to anyone for advertising. A backup copy is made every night: copies are kept 30 days, so a deleted item also disappears from the backups within 30 days.</p>

        <h2>Who it is shared with and where it goes</h2>
        <ul>
            <li><strong>Google Gemini</strong> (artificial intelligence, Google, also in the United States): to transcribe photos and write summaries, handouts and quizzes, the material uploaded to a class (with the usernames of who uploaded it) is sent to Gemini, <strong>only if the class has been declared to have adult students only</strong> (declared when the class is requested; the representative can switch the AI on or off in the settings, for instance once everybody is of age), on its free tier: under Google’s terms, Google may then use the content to improve its products and some people may read it. So <strong>do not upload personal data</strong> (yours or others’), grades, ID documents or health information. The texts it produces are generated automatically and may contain mistakes; no decision about people is taken by an automatic system. Google’s terms: <a href="https://ai.google.dev/gemini-api/terms" rel="noopener">ai.google.dev/gemini-api/terms</a>.</li>
            <li><strong>Notifications to the owner (ntfy):</strong> some alerts (new visit, errors, backups) reach the owner’s phone through a notification service; they include, among other things, the IP, page and browser of the visitor.</li>
            <li><strong>Reader libraries</strong> (cdnjs.cloudflare.com, cdn.jsdelivr.net): they see your IP address, like any site you visit.</li>
            <li><strong>Advertising (Google AdSense):</strong> <?= $adsOn ? 'active on the games pages' : 'not active yet; when it is, it will appear on the games pages' ?>. Google and its partners use cookies and identifiers only after you consent in Google’s message. They do not see your messages or your notes. How Google uses them: <a href="https://policies.google.com/technologies/partner-sites" rel="noopener">policies.google.com/technologies/partner-sites</a>.</li>
            <li><strong>Donation service</strong> (Ko-fi, PayPal or similar, if present): when you click "Donate" you move to their page and their notice applies.</li>
        </ul>
        <p>Google and other external services may handle data outside the European Union (for example in the United States), with the safeguards the GDPR requires (standard contractual clauses or the Data Privacy Framework adequacy decision).</p>

        <h2>Your rights and how to use them</h2>
        <ul>
            <li><strong>See and download your data</strong> (access and portability): on the <a href="account.php">Account</a> page the "Download my data" button gives you a file with everything.</li>
            <li><strong>Correct it:</strong> bio and password can be changed on the Account page; for anything else write to the contact above.</li>
            <li><strong>Delete it</strong> (right to erasure): on the Account page, "Delete my account" removes the account, messages, progress and class membership at once. Class managers must hand the class over or close it first. Donations stay without your name for accounting only. If you have no account or cannot manage it, write to me and I will answer within a month.</li>
            <li><strong>Object, restrict processing, withdraw consent</strong> (for instance to notifications or personalised ads): write to me, or use the browser settings and the ads message.</li>
            <li><strong>Complaint:</strong> you have the right to complain to the Italian data protection authority (<a href="https://www.garanteprivacy.it" rel="noopener">garanteprivacy.it</a>).</li>
        </ul>

        <h2>Minimum age</h2>
        <p>In Italy you can give consent to the processing of your own data online from <strong>14 years</strong>. If you are under 14, creating an account needs the consent of a parent or guardian; the games can be used without an account. I do not knowingly collect data from small children: if I find an account of someone too young without consent, I delete it.</p>

        <h2>Security</h2>
        <p>The site uses HTTPS, passwords are stored hashed, access to the data is limited to the owner and the server is kept updated and protected by limits against abuse. If a breach put your data at risk, I would report it to the Italian authority within 72 hours and tell the people involved. How accounts and data are protected, the limits and how to report a problem: <a href="sicurezza.php">Security page</a>.</p>

        <h2>Cookies and browser storage</h2>
        <p>A cookie is a small file the browser keeps; "local storage" is the same, but stays only in your own browser. Here is everything the site keeps, by type.</p>
        <ul>
            <li><strong>Technical and functional (no consent needed):</strong> they give you the service you ask for or remember a choice you made, and go to nobody else.
                <ul>
                    <li>The session cookie (<code>PHPSESSID</code> or similar): stay logged in and protect forms. It ends when you close the browser or after a few days.</li>
                    <li><code>vb_lang</code> (your chosen language, one year) and <code>vb_chat_ticket</code> (ties the live chat to who you are).</li>
                    <li><code>vb_consent</code> (6 months): remembers what you chose about ads, so I do not ask every time.</li>
                    <li>The visual theme and the menu options (matrix background, frosted glass, left-handed mode), window positions, the open tab, the reader theme and progress, the games’ data: in the <code>selected_theme</code> cookie and in your browser’s local storage. With an account the theme is also saved there.</li>
                </ul></li>
            <li><strong>Advertising (Google AdSense), only with your consent:</strong> <?= $adsOn ? 'the games pages show Google ads' : 'once enabled, the games pages will show Google ads' ?>. Until you press "Accept" in the cookie message the site <strong>loads nothing from Google</strong> and no ad appears. If you accept, Google and its partners may use cookies and identifiers to show and measure ads. "Reject" and "Accept" count the same; you can change your mind any time with the "Cookies" link at the bottom of the games pages<?= $adsOn ? '' : ' (it appears once ads are enabled)' ?>, and the choice is asked again after 6 months. There are no ads in class notes, the account or the reader.<?= ($adsOn && !adsHiddenForViewer()) ? ' <button type="button" data-vb-cookie>Change your choice about ads</button>' : '' ?></li>
            <li><strong>Statistics:</strong> the site uses no Google Analytics or other third-party statistics: visits are counted only on the server (see above).</li>
        </ul>

        <h2>Changes</h2>
        <p>If something changes in the data the site handles, this page is updated <em>first</em> and the date above changes. For important news I also say so on the site.</p>
<?php endif; ?>
    </main>

    <footer class="foot">
        <a href="giochi.php"><?= $it ? 'Giochi' : 'Games' ?></a>
        <a href="ads.php"><?= $it ? 'Supporta vector-box' : 'Support vector-box' ?></a>
        <a href="sicurezza.php"><?= $it ? 'Sicurezza' : 'Security' ?></a>
        <?= adsCookieLink($lang) ?>
        <a href="../index.php"><?= $it ? 'Torna al sito' : 'Back to the site' ?></a>
    </footer>
</body>
</html>
