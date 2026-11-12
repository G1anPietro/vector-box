<?php
// public/pages/dona.php — donations: what the money is for, an optional goal bar, and buttons to the donation
// services (Ko-fi / Buy Me a Coffee / Liberapay via DONATE_URL, PayPal.me via DONATE_PAYPAL_URL). Payment happens on
// their pages: the site never sees or stores payment data. Goal: DONATE_GOAL_TEXT, DONATE_GOAL_EUR, DONATE_RAISED_EUR.
require_once __DIR__ . '/../includes/head.php';

$lang = pageLang();
$it = $lang === 'it';
$other = $it ? 'en' : 'it';
$main = donateUrl();
$paypal = donatePaypalUrl();
$goal = donateGoal();
$e = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES);
$eur = fn($n) => ($it ? number_format($n, $n == (int)$n ? 0 : 2, ',', '.') : number_format($n, $n == (int)$n ? 0 : 2)) . ' €';
$service = $main ? (preg_match('#ko-fi\.com#', $main) ? 'Ko-fi' : (preg_match('#buymeacoffee\.com#', $main) ? 'Buy Me a Coffee' : (preg_match('#liberapay\.com#', $main) ? 'Liberapay' : ''))) : '';
?>
<!DOCTYPE html>
<html lang="<?= $lang ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#16141c">
    <title><?= $it ? 'Offrimi un caffè — vector-box' : 'Buy me a coffee — vector-box' ?></title>
    <?= socialMeta($it ? 'Offrimi un caffè — vector-box' : 'Buy me a coffee — vector-box',
        $it ? 'vector-box è gratis e senza account per i giochi: se ti va, aiuta a tenerlo acceso.' : 'vector-box is free, games need no account: if you like, help keep it running.',
        '/pages/dona.php') ?>
    <link rel="stylesheet" href="../css/giochi.css?v=3">
    <link rel="stylesheet" href="../css/dona.css?v=1">
</head>
<body>
    <header class="top">
        <a class="home" href="../index.php">vector-box</a>
        <a class="lang" href="?lang=<?= $other ?>" hreflang="<?= $other ?>"><?= strtoupper($other) ?></a>
    </header>

    <main class="doc dona">
        <h1><?= $it ? 'Offrimi un caffè' : 'Buy me a coffee' ?></h1>
        <p class="lead"><?= $it
            ? 'vector-box è gratis, senza pubblicità invadenti e senza bisogno di un account per giocare. Gira su un vecchio portatile acceso giorno e notte in casa mia. Se ti ha fatto passare una bella serata e ti va, puoi aiutarmi a tenerlo acceso.'
            : 'vector-box is free, without intrusive ads and with no account needed to play. It runs on an old laptop that is on day and night at my home. If it gave you a good evening and you feel like it, you can help keep it running.' ?></p>

        <?php if ($goal): [$what, $target, $raised] = $goal; $pct = min(100, round(100 * $raised / $target)); ?>
            <section class="goal" aria-label="<?= $it ? 'Obiettivo' : 'Goal' ?>">
                <div class="goal-head"><strong><?= $e($what) ?></strong><span><?= $eur($raised) ?> <?= $it ? 'su' : 'of' ?> <?= $eur($target) ?></span></div>
                <div class="goal-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="<?= $pct ?>"><span style="width: <?= $pct ?>%"></span></div>
                <p class="muted small"><?= $pct >= 100 ? ($it ? 'Obiettivo raggiunto: grazie a tutti!' : 'Goal reached: thank you all!') : ($it ? "Siamo al $pct%." : "We're at $pct%.") ?></p>
            </section>
        <?php endif; ?>

        <?php if ($main || $paypal): ?>
            <div class="give">
                <?php if ($main): ?>
                    <a class="cta coffee" href="<?= $e($main) ?>" rel="noopener" target="_blank">☕ <?= $it ? 'Dona' : 'Donate' ?><?= $service ? ' ' . ($it ? 'con' : 'with') . ' ' . $service : '' ?></a>
                <?php endif; ?>
                <?php if ($paypal): ?>
                    <a class="cta secondary" href="<?= $e($paypal) ?>" rel="noopener" target="_blank"><?= $it ? 'Dona con PayPal' : 'Donate with PayPal' ?></a>
                <?php endif; ?>
            </div>
            <p class="muted small"><?= $it
                ? 'Si apre la pagina del servizio di donazioni: il pagamento avviene lì, il sito non vede né salva nessun dato. Puoi donare una volta sola, anche pochi euro.'
                : 'The donation service\'s page opens: payment happens there, the site never sees or stores any data. You can give once, even a few euros.' ?></p>
        <?php else: ?>
            <p class="notice"><?= $it ? 'Le donazioni non sono ancora attive. Intanto puoi aiutare giocando e facendo conoscere il sito.' : "Donations aren't open yet. Meanwhile you can help by playing and telling people about the site." ?></p>
        <?php endif; ?>

        <h2><?= $it ? 'A cosa servono' : 'What it pays for' ?></h2>
        <ul>
            <?php if ($it): ?>
                <li><strong>Corrente:</strong> il server è acceso 24 ore su 24.</li>
                <li><strong>Pezzi di ricambio:</strong> il disco ha già dato segni di stanchezza; il prossimo acquisto è un disco nuovo.</li>
                <li><strong>Backup:</strong> un secondo computer silenzioso per tenere una copia di tutto in un altro posto.</li>
                <li><strong>Un dominio vero</strong> al posto dell'indirizzo gratuito di oggi.</li>
            <?php else: ?>
                <li><strong>Electricity:</strong> the server is on around the clock.</li>
                <li><strong>Spare parts:</strong> the disk has already shown signs of wear; the next purchase is a new one.</li>
                <li><strong>Backups:</strong> a second quiet computer to keep a copy of everything somewhere else.</li>
                <li><strong>A real domain name</strong> instead of today's free address.</li>
            <?php endif; ?>
        </ul>

        <h2><?= $it ? 'Altri modi per aiutare' : 'Other ways to help' ?></h2>
        <ul>
            <li><?= $it ? 'Gioca e porta gli amici: i giochi da festa sono fatti per quello.' : 'Play, and bring your friends: the party games are made for it.' ?></li>
            <li><?= $it ? 'Segnala problemi o idee con l\'Uplink nella pagina principale.' : 'Report problems or ideas through the Uplink on the main page.' ?></li>
            <li><?= $it ? 'Se programmi, il codice è su' : 'If you code, the source is on' ?> <a href="https://github.com/G1anPietro/vector-box" rel="noopener">GitHub</a>.</li>
        </ul>
        <p class="thanks"><?= $it ? 'Grazie, davvero.' : 'Thank you, really.' ?></p>
    </main>

    <footer class="foot">
        <a href="giochi.php"><?= $it ? 'Giochi' : 'Games' ?></a>
        <a href="ads.php"><?= $it ? 'Supporta vector-box' : 'Support vector-box' ?></a>
        <a href="privacy.php">Privacy</a>
        <a href="../index.php"><?= $it ? 'Torna al sito' : 'Back to the site' ?></a>
    </footer>
</body>
</html>
