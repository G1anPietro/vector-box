<?php
// public/pages/resume.php — CV, Italian and English (?lang=it|en), printable (Print / Save as PDF).
// Only things that can be shown: everything listed here exists in this site or on its server.
require_once __DIR__ . '/../includes/head.php';

$lang = pageLang();
$it = $lang === 'it';
$other = $it ? 'en' : 'it';
$L = fn(string $i, string $e) => $it ? $i : $e;
?>
<!DOCTYPE html>
<html lang="<?= $lang ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#16141c">
    <title>Denys Khavruniak — <?= $L('Curriculum', 'Résumé') ?></title>
    <meta name="description" content="<?= $L('Studente di informatica: Linux, reti, server e sviluppo web.', 'Computer science student: Linux, networking, servers and web development.') ?>">
    <link rel="stylesheet" href="../css/resume.css?v=4">
    <script src="../js/resume.js?v=1" defer></script>
</head>
<body>
    <nav class="tools" aria-label="<?= $L('Strumenti', 'Tools') ?>">
        <a href="../index.php"><?= $L('Torna al sito', 'Back to the site') ?></a>
        <span class="spacer"></span>
        <a class="pill" href="?lang=<?= $other ?>" hreflang="<?= $other ?>"><?= $it ? 'English' : 'Italiano' ?></a>
        <button class="pill" type="button" id="print"><?= $L('Stampa o salva PDF', 'Print or save as PDF') ?></button>
    </nav>

    <article class="sheet">
        <header class="who">
            <h1>Denys Khavruniak</h1>
            <p class="role"><?= $L('Studente di informatica', 'Computer science student') ?></p>
            <p class="intro"><?= $L(
                'Mi occupo di Linux, reti e server. Ho trasformato un portatile senza schermo nel server che fa girare questo sito e i servizi della rete di casa, e ho scritto il sito che ci gira sopra: dalla chat in tempo reale ai giochi multigiocatore per telefono.',
                'I work with Linux, networks and servers. I turned a screenless laptop into the server that runs this website and the services of my home network, and I built the site that runs on it: from real-time chat to multiplayer phone games.') ?></p>
        </header>

        <div class="cols">
            <aside class="side">
                <section>
                    <h2><?= $L('Competenze', 'Skills') ?></h2>
                    <dl class="skills">
                        <dt><?= $L('Sistemi', 'Systems') ?></dt>
                        <dd>Linux (Ubuntu, Arch), systemd, cron, Bash, Docker, Proxmox</dd>
                        <dt><?= $L('Reti', 'Networking') ?></dt>
                        <dd>DNS, NAT <?= $L('e', 'and') ?> port forwarding, WireGuard, <?= $L('firewall', 'firewalls') ?>, Pi-hole</dd>
                        <dt>Web</dt>
                        <dd>PHP, JavaScript, Node.js / Express, SQLite, HTML, CSS, nginx</dd>
                        <dt><?= $L('Linguaggi', 'Languages') ?></dt>
                        <dd>C, Java, Python, PHP, JavaScript</dd>
                        <dt><?= $L('Strumenti', 'Tools') ?></dt>
                        <dd>Git, Let’s Encrypt, PM2, fail2ban</dd>
                        <dt><?= $L('Lingue', 'Spoken languages') ?></dt>
                        <dd><?= $L('Italiano, inglese', 'Italian, English') ?></dd>
                    </dl>
                </section>
                <section>
                    <h2><?= $L('Da vedere', 'See it') ?></h2>
                    <p class="small"><?= $L('Il sito e i giochi descritti qui sono online: ', 'The site and games described here are live: ') ?><a href="giochi.php"><?= $L('pagina dei giochi', 'games page') ?></a><span class="print-only"> (vector-box.duckdns.org/pages/giochi.php)</span>.</p>
                </section>
            </aside>
            <div class="main">
                <section>
                    <h2><?= $L('Progetti', 'Projects') ?></h2>

                    <div class="item">
                        <div class="head"><h3>vector-box — <?= $L('sito web', 'website') ?></h3><span class="when">2026 – <?= $L('oggi', 'present') ?></span></div>
                        <p><?= $L('Sito personale con interfaccia in stile desktop (finestre, terminale, barra delle applicazioni), usato ogni giorno da un gruppo di amici.',
                                  'Personal website with a desktop-style interface (windows, terminal, taskbar), used every day by a group of friends.') ?></p>
                        <ul>
                            <li><?= $L('Chat con stanze e messaggi privati: PHP e SQLite, con un hub Node.js che invia i messaggi in tempo reale (Server-Sent Events) e ripiega sul polling se l’hub si ferma.',
                                       'Chat with rooms and private messages: PHP and SQLite, with a Node.js hub that pushes messages in real time (Server-Sent Events) and falls back to polling if the hub stops.') ?></li>
                            <li><?= $L('Giochi multigiocatore per telefono (Chi è la spia?, Lupus) con stanze, ruoli segreti e cinque lingue; solitario, poker e altri giochi.',
                                       'Multiplayer phone games (Who’s the spy?, Lupus) with rooms, secret roles and five languages; solitaire, poker and more.') ?></li>
                            <li><?= $L('Lettore di libri EPUB e PDF privato, con permessi per utente, segnalibri e avanzamento.',
                                       'Private EPUB and PDF reader with per-user permissions, bookmarks and reading progress.') ?></li>
                            <li><?= $L('Sicurezza: protezione CSRF, Content Security Policy, limiti alle richieste, sessioni e password cifrate, migrazioni del database versionate.',
                                       'Security: CSRF protection, Content Security Policy, rate limiting, hardened sessions and password hashing, versioned database migrations.') ?></li>
                            <li><?= $L('Test automatici sulle API (account, permessi delle stanze, chat, giochi) eseguiti prima di ogni rilascio.',
                                       'Automated API tests (accounts, room permissions, chat, games) run before every release.') ?></li>
                        </ul>
                    </div>

                    <div class="item">
                        <div class="head"><h3><?= $L('Server di casa', 'Home server') ?></h3><span class="when">2026 – <?= $L('oggi', 'present') ?></span></div>
                        <p><?= $L('Un portatile senza schermo con Ubuntu Server, acceso giorno e notte, che ospita il sito e i servizi della casa.',
                                  'A screenless laptop running Ubuntu Server around the clock, hosting the website and the household services.') ?></p>
                        <ul>
                            <li><?= $L('nginx come reverse proxy con HTTPS (Let’s Encrypt), HTTP/2, compressione e cache; DNS dinamico con DuckDNS.',
                                       'nginx reverse proxy with HTTPS (Let’s Encrypt), HTTP/2, compression and caching; dynamic DNS with DuckDNS.') ?></li>
                            <li><?= $L('Pi-hole come DNS di tutta la rete di casa e VPN WireGuard per entrare nella rete da fuori; servizi in Docker.',
                                       'Pi-hole as the DNS of the whole home network and a WireGuard VPN to reach it from outside; services in Docker.') ?></li>
                            <li><?= $L('Firewall (ufw) e fail2ban; port forwarding sul router ridotto al minimo.',
                                       'Firewall (ufw) and fail2ban; router port forwarding cut down to the minimum.') ?></li>
                            <li><?= $L('Backup notturni su disco USB con prova di ripristino, e avvisi automatici sul telefono (ntfy) se il sito, il DNS, i backup o il disco hanno problemi.',
                                       'Nightly backups to a USB drive with a tested restore, and automatic phone alerts (ntfy) when the site, DNS, backups or disk have problems.') ?></li>
                            <li><?= $L('Diagnosi di un guasto: il disco NVMe spariva all’avvio per errori sul collegamento PCIe; risolto con i parametri del kernel e tenuto sotto controllo con SMART.',
                                       'Troubleshooting: the NVMe disk vanished at boot because of PCIe link errors; fixed with kernel parameters and monitored with SMART.') ?></li>
                        </ul>
                    </div>

                    <div class="item">
                        <div class="head"><h3><?= $L('Homelab', 'Homelab') ?></h3></div>
                        <p><?= $L('Un secondo server con Proxmox per le macchine virtuali e un server Minecraft gestito con Crafty Controller.',
                                  'A second server running Proxmox for virtual machines, and a Minecraft server managed with Crafty Controller.') ?></p>
                    </div>

                    <div class="item">
                        <div class="head"><h3><?= $L('Hardware', 'Hardware') ?></h3></div>
                        <p><?= $L('Diagnosi di problemi delle schede madri, installazioni multi-boot Windows 11 e Linux, gestione delle partizioni (GParted), scelta e montaggio dei componenti per gli aggiornamenti.',
                                  'Diagnosing motherboard faults, Windows 11 / Linux multi-boot setups, partition management (GParted), choosing and fitting components for upgrades.') ?></p>
                    </div>
                </section>

                <section>
                    <h2><?= $L('Formazione', 'Education') ?></h2>
                    <div class="item">
                        <div class="head"><h3><?= $L('Istituto tecnico, indirizzo Informatica', 'Technical high school, Computer Science track') ?></h3><span class="when"><?= $L('5° anno, 2026/27', 'final year, 2026/27') ?></span></div>
                    </div>
                </section>
            </div>

        </div>
    </article>
</body>
</html>
