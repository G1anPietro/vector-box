<?php
// public/pages/soldi.php — "Where the money goes": what the site costs, what came in, and who chose to be thanked.
// Costs come from data/soldi.json (outside the web root, edited by the owner: see docs/soldi.example.json); donations
// come from the donors table (api/donors.php). Without the file the page explains the headings and says the figures
// are coming: nothing is invented. Only donors marked "public" are listed, by the name they chose, never with amounts.
require_once __DIR__ . '/../includes/head.php';
require_once __DIR__ . '/../api/database.php';

$lang = pageLang();
$it = $lang === 'it';
$other = $it ? 'en' : 'it';
$e = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES);
$eur = fn($n) => ($it ? number_format($n, abs($n - round($n)) < 0.005 ? 0 : 2, ',', '.') : number_format($n, abs($n - round($n)) < 0.005 ? 0 : 2)) . ' €';

// ---- costs (owner's file) ----
$costs = []; $updated = ''; $note = '';
$file = dirname(__DIR__, 2) . '/data/soldi.json';
if (is_file($file)) {
    $j = json_decode((string)file_get_contents($file), true);
    if (is_array($j)) {
        $updated = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($j['updated'] ?? '')) ? $j['updated'] : '';
        $note = textCut(trim((string)($j['note'] ?? '')), 400);
        foreach (array_slice((array)($j['costs'] ?? []), 0, 20) as $c) {
            if (!is_array($c) || trim((string)($c['label'] ?? '')) === '') continue;
            $costs[] = ['label' => textCut(trim((string)$c['label']), 60),
                        'eur' => max(0.0, (float)($c['eur_month'] ?? 0)),
                        'note' => textCut(trim((string)($c['note'] ?? '')), 120)];
        }
    }
}
$monthly = array_sum(array_column($costs, 'eur'));

// ---- what came in ----
$db = getDbConnection();
$in = $db->query('SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS cents FROM donors WHERE amount_cents > 0')->fetch();
$raised = ((int)$in['cents']) / 100;
$count = (int)$in['n'];
$since = $db->query('SELECT MIN(donated_at) FROM donors WHERE amount_cents > 0')->fetchColumn();
$wall = $db->query("SELECT CASE WHEN LENGTH(d.display_name) > 0 THEN d.display_name ELSE a.username END AS who, MAX(d.donated_at) AS last
                    FROM donors d LEFT JOIN accounts a ON a.id = d.account_id
                    WHERE d.is_public = 1 AND (LENGTH(d.display_name) > 0 OR a.username IS NOT NULL)
                    GROUP BY LOWER(who) ORDER BY last DESC LIMIT 60")->fetchAll();
$goal = donateGoal();
?>
<!DOCTYPE html>
<html lang="<?= $lang ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#16141c">
    <title><?= $it ? 'Dove vanno i soldi — vector-box' : 'Where the money goes — vector-box' ?></title>
    <?= socialMeta($it ? 'Dove vanno i soldi — vector-box' : 'Where the money goes — vector-box',
        $it ? 'Quanto costa tenere acceso vector-box, cosa è arrivato e a cosa servono le donazioni.' : 'What it costs to keep vector-box running, what came in and what donations pay for.',
        '/pages/soldi.php') ?>
    <link rel="stylesheet" href="../css/giochi.css?v=3">
    <link rel="stylesheet" href="../css/dona.css?v=<?= $e(APP_VERSION) ?>">
</head>
<body>
    <header class="top">
        <a class="home" href="../index.php">vector-box</a>
        <a class="lang" href="?lang=<?= $other ?>" hreflang="<?= $other ?>"><?= strtoupper($other) ?></a>
    </header>

    <main class="doc dona">
        <h1><?= $it ? 'Dove vanno i soldi' : 'Where the money goes' ?></h1>
        <p class="lead"><?= $it
            ? 'vector-box non è un’azienda: è un progetto personale che gira su un computer in casa. Qui trovi, senza giri di parole, cosa costa tenerlo acceso e cosa fa il sito con le donazioni e con la pubblicità.'
            : 'vector-box is not a company: it is a personal project that runs on a computer at home. Here, plainly, is what it costs to keep it on and what the site does with donations and ad money.' ?></p>

        <h2><?= $it ? 'Cosa costa' : 'What it costs' ?></h2>
        <?php if ($costs): ?>
            <ul class="costs">
                <?php foreach ($costs as $c): $w = $monthly > 0 ? max(2, round(100 * $c['eur'] / $monthly)) : 0; ?>
                    <li>
                        <div class="goal-head"><strong><?= $e($c['label']) ?></strong><span><?= $eur($c['eur']) ?> <?= $it ? 'al mese' : '/ month' ?></span></div>
                        <div class="goal-bar" aria-hidden="true"><span style="width: <?= $w ?>%"></span></div>
                        <?php if ($c['note'] !== ''): ?><p class="muted small"><?= $e($c['note']) ?></p><?php endif; ?>
                    </li>
                <?php endforeach; ?>
            </ul>
            <p><strong><?= $it ? 'Totale' : 'Total' ?>: <?= $eur($monthly) ?> <?= $it ? 'al mese' : 'a month' ?></strong>
               (<?= $eur($monthly * 12) ?> <?= $it ? 'all’anno' : 'a year' ?>).</p>
            <?php if ($note !== ''): ?><p class="muted"><?= $e($note) ?></p><?php endif; ?>
            <?php if ($updated !== ''): ?><p class="muted small"><?= $it ? 'Cifre aggiornate al' : 'Figures updated on' ?> <?= $e($updated) ?>.</p><?php endif; ?>
        <?php else: ?>
            <p class="notice"><?= $it
                ? 'Le cifre precise arriveranno presto. Le voci sono sempre le stesse: corrente del server, un dominio, un disco di ricambio, una seconda copia dei backup.'
                : 'The exact figures are coming soon. The items are always the same: server electricity, a domain name, a spare disk, a second copy of the backups.' ?></p>
        <?php endif; ?>

        <h2><?= $it ? 'Cosa è arrivato' : 'What came in' ?></h2>
        <?php if ($count > 0): ?>
            <p><?= $it
                ? '<strong>' . $e($eur($raised)) . '</strong> da <strong>' . $count . '</strong> donazion' . ($count === 1 ? 'e' : 'i') . ($since ? ' dal ' . $e($since) : '') . '.'
                : '<strong>' . $e($eur($raised)) . '</strong> from <strong>' . $count . '</strong> donation' . ($count === 1 ? '' : 's') . ($since ? ' since ' . $e($since) : '') . '.' ?></p>
        <?php else: ?>
            <p class="muted"><?= $it ? 'Ancora nessuna donazione registrata.' : 'No donations recorded yet.' ?></p>
        <?php endif; ?>
        <?php if ($goal): [$what, $target, $r] = $goal; $pct = min(100, round(100 * $r / $target)); ?>
            <section class="goal" aria-label="<?= $it ? 'Obiettivo' : 'Goal' ?>">
                <div class="goal-head"><strong><?= $e($what) ?></strong><span><?= $eur($r) ?> <?= $it ? 'su' : 'of' ?> <?= $eur($target) ?></span></div>
                <div class="goal-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="<?= $pct ?>"><span style="width: <?= $pct ?>%"></span></div>
            </section>
        <?php endif; ?>

        <h2><?= $it ? 'E se i soldi avanzano?' : 'What if there is money left over?' ?></h2>
        <p><?= $it
            ? 'Quello che supera le spese viene tenuto da parte per rimpiazzare i pezzi che si rompono (il disco, il computer) e per i costi dell’anno dopo. Se un giorno ci sarà molto più del necessario lo dirò qui, e deciderò con chi usa il sito dove destinarlo.'
            : 'Whatever goes beyond the costs is kept aside to replace parts that break (the disk, the computer) and for next year’s costs. If one day there is much more than needed I will say so here and decide with the people who use the site where it should go.' ?></p>

        <h2><?= $it ? 'Pubblicità e donazioni' : 'Ads and donations' ?></h2>
        <p><?= $it
            ? 'Le donazioni sono volontarie e non danno vantaggi: nessuna funzione si sblocca a pagamento. Se sul sito vedi degli annunci, il loro ricavo va nelle stesse voci di questa pagina. Il sito non vede né conserva i dati dei pagamenti: restano al servizio di donazioni.'
            : 'Donations are voluntary and give no advantages: no feature is locked behind a payment. If you see ads on the site, what they earn goes to the same items on this page. The site never sees or keeps payment data: it stays with the donation service.' ?></p>

        <?php if ($wall): ?>
            <h2><?= $it ? 'Grazie a' : 'Thanks to' ?></h2>
            <p class="supporters"><?php foreach ($wall as $i => $w) echo ($i ? ' · ' : '') . '<span>&#9829; ' . $e($w['who']) . '</span>'; ?></p>
            <p class="muted small"><?= $it ? 'Compaiono solo le persone che hanno scelto di comparire, con il nome che hanno scelto. Se vuoi essere tolto o aggiunto, scrivimi.' : 'Only people who chose to appear are listed, under the name they chose. To be added or removed, write to me.' ?></p>
        <?php endif; ?>

        <p class="give"><a class="cta coffee" href="dona.php">☕ <?= $it ? 'Offrimi un caffè' : 'Buy me a coffee' ?></a></p>
    </main>

    <footer class="foot">
        <a href="giochi.php"><?= $it ? 'Giochi' : 'Games' ?></a>
        <a href="dona.php"><?= $it ? 'Dona' : 'Donate' ?></a>
        <a href="privacy.php">Privacy</a>
        <a href="../index.php"><?= $it ? 'Torna al sito' : 'Back to the site' ?></a>
    </footer>
</body>
</html>
