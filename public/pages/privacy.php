<?php
// public/pages/privacy.php — privacy and cookie notice (needed for AdSense and the GDPR).
// Keep it true: if the site starts storing something new, update this page.
require_once __DIR__ . '/../includes/head.php';

$lang = pageLang();
$it = $lang === 'it';
$other = $it ? 'en' : 'it';
$email = trim((string)envValue('CONTACT_EMAIL', ''));
$email = filter_var($email, FILTER_VALIDATE_EMAIL) ? $email : '';
$adsOn = adsenseClient() !== '';
$updated = '2026-11-11';
?>
<!DOCTYPE html>
<html lang="<?= $lang ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#16141c">
    <title>Privacy — vector-box</title>
    <link rel="stylesheet" href="../css/giochi.css?v=3">
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

        <h2>Chi gestisce il sito</h2>
        <p>vector-box è un sito personale e senza scopo commerciale gestito da Denys Khavruniak, in Italia. Per qualsiasi richiesta sui tuoi dati:
            <?= $email ? '<a href="mailto:' . htmlspecialchars($email) . '">' . htmlspecialchars($email) . '</a>, oppure ' : '' ?>l’Uplink nella pagina principale.</p>

        <h2>Cosa viene salvato</h2>
        <ul>
            <li><strong>Se crei un account:</strong> nome utente, password (salvata solo in forma cifrata, non leggibile), preferenze, messaggi della chat e privati, statistiche del poker, segnalibri e avanzamento dei libri.</li>
            <li><strong>Indirizzo IP:</strong> registrato con i messaggi e nei registri del server, per sicurezza e per bloccare abusi (per esempio troppi tentativi di accesso).</li>
            <li><strong>Visite:</strong> per ogni nuova visita vengono annotati data e ora, indirizzo IP, pagina, tipo di browser e sistema, e il sito da cui arrivi. Servono a chi gestisce il sito per sapere chi lo usa; il registro si sovrascrive da solo quando diventa grande.</li>
            <li><strong>Giochi:</strong> partite, impostazioni e statistiche restano nel tuo browser (memoria locale). Per le stanze multigiocatore il server conserva i nomi scelti e lo stato della partita.</li>
        </ul>
        <p>I dati stanno sul server di casa del sito, non vengono venduti né ceduti a nessuno.</p>

        <h2>Cookie</h2>
        <ul>
            <li><strong>Tecnici, sempre attivi:</strong> il cookie di sessione (per restare collegati e proteggere i moduli) e <code>vb_lang</code> (la lingua scelta).</li>
            <li><strong>Preferenze, solo se accetti:</strong> il tema grafico del desktop.</li>
            <li><strong>Pubblicità (Google AdSense):</strong> <?= $adsOn ? 'le pagine Giochi e Supporta mostrano annunci di Google.' : 'quando saranno attivi, le pagine Giochi e Supporta mostreranno annunci di Google.' ?> Google e i suoi partner possono usare cookie e identificatori per mostrare e misurare gli annunci solo dopo che hai dato il consenso nel messaggio di Google; puoi rifiutare o cambiare idea in ogni momento. Come Google usa questi dati: <a href="https://policies.google.com/technologies/partner-sites?hl=it" rel="noopener">policies.google.com/technologies/partner-sites</a>.</li>
        </ul>

        <h2>Servizi esterni</h2>
        <p>Il bottone "Offrimi un caffè", se presente, porta alla pagina di un servizio di donazioni esterno: il pagamento
        avviene lì, e vector-box non vede né salva alcun dato di pagamento.</p>
        <p>Il lettore di libri (solo per gli account autorizzati) carica alcune librerie da cdnjs.cloudflare.com e cdn.jsdelivr.net, che vedono il tuo indirizzo IP come qualsiasi sito che visiti.</p>

        <h2>Quanto tempo</h2>
        <p>I dati dell’account restano finché l’account esiste; i registri del server vengono cancellati automaticamente dopo un periodo limitato. Puoi chiedere in ogni momento di vedere, correggere o cancellare i tuoi dati, e hai diritto di presentare reclamo al Garante per la protezione dei dati personali (<a href="https://www.garanteprivacy.it" rel="noopener">garanteprivacy.it</a>).</p>
<?php else: ?>
        <h1>Privacy and cookies</h1>
        <p class="muted">Last updated: <?= $updated ?></p>

        <h2>Who runs the site</h2>
        <p>vector-box is a personal, non-commercial website run by Denys Khavruniak, in Italy. For any request about your data:
            <?= $email ? '<a href="mailto:' . htmlspecialchars($email) . '">' . htmlspecialchars($email) . '</a>, or ' : '' ?>the Uplink on the main page.</p>

        <h2>What is stored</h2>
        <ul>
            <li><strong>If you create an account:</strong> username, password (stored only as a one-way hash), preferences, chat and private messages, poker statistics, book bookmarks and reading progress.</li>
            <li><strong>IP address:</strong> stored with messages and in the server logs, for security and to stop abuse (for example too many login attempts).</li>
            <li><strong>Visits:</strong> for each new visit the date and time, IP address, page, browser and system, and the site you came from are noted down, so whoever runs the site knows who uses it; the log overwrites itself when it grows large.</li>
            <li><strong>Games:</strong> games, settings and statistics stay in your browser (local storage). For multiplayer rooms the server keeps the chosen names and the game state.</li>
        </ul>
        <p>The data lives on the site’s home server and is never sold or handed to anyone.</p>

        <h2>Cookies</h2>
        <ul>
            <li><strong>Technical, always on:</strong> the session cookie (to stay logged in and protect forms) and <code>vb_lang</code> (your chosen language).</li>
            <li><strong>Preferences, only if you accept:</strong> the desktop’s visual theme.</li>
            <li><strong>Advertising (Google AdSense):</strong> <?= $adsOn ? 'the Games and Support pages show Google ads.' : 'once enabled, the Games and Support pages will show Google ads.' ?> Google and its partners may use cookies and identifiers to show and measure ads only after you consent in Google’s message; you can refuse or change your mind at any time. How Google uses this data: <a href="https://policies.google.com/technologies/partner-sites" rel="noopener">policies.google.com/technologies/partner-sites</a>.</li>
        </ul>

        <h2>External services</h2>
        <p>The "Buy me a coffee" button, when present, leads to an external donation service: payment happens there, and
        vector-box never sees or stores any payment details.</p>
        <p>The book reader (authorised accounts only) loads some libraries from cdnjs.cloudflare.com and cdn.jsdelivr.net, which see your IP address like any site you visit.</p>

        <h2>How long</h2>
        <p>Account data is kept while the account exists; server logs are deleted automatically after a limited time. You can ask at any time to see, correct or delete your data, and you have the right to complain to the Italian data protection authority (<a href="https://www.garanteprivacy.it" rel="noopener">garanteprivacy.it</a>).</p>
<?php endif; ?>
    </main>

    <footer class="foot">
        <a href="giochi.php"><?= $it ? 'Giochi' : 'Games' ?></a>
        <a href="ads.php"><?= $it ? 'Supporta vector-box' : 'Support vector-box' ?></a>
        <a href="../index.php"><?= $it ? 'Torna al sito' : 'Back to the site' ?></a>
    </footer>
</body>
</html>
