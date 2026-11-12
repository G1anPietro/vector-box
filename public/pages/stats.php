<?php
// public/pages/stats.php — visit statistics for the admin, read from data/visits.log (+ visits.log.1).
// Each log line is one NEW visit (same IP + browser not seen for VISIT_GAP_MIN minutes), tab separated:
// date time, ip, user, page, device, first|returning, referrer host.
require_once __DIR__ . '/../includes/head.php';
require_once __DIR__ . '/../api/database.php';

initSession();
if (empty($_SESSION['is_admin'])) {
    http_response_code(403);
    header('X-Robots-Tag: noindex');
    exit('Admin only.');
}

$days = (int)($_GET['days'] ?? 30);
if (!in_array($days, [7, 30, 90], true)) $days = 30;
$today = date('Y-m-d');
$since = date('Y-m-d', strtotime("-" . ($days - 1) . " days"));

$rows = [];
$dir = dirname(__DIR__, 2) . '/data/';
foreach (['visits.log.1', 'visits.log'] as $f) {
    if (!is_file($dir . $f)) continue;
    foreach (file($dir . $f, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $c = explode("\t", $line);
        if (count($c) < 7) continue;
        $day = substr($c[0], 0, 10);
        if ($day < $since || $day > $today) continue;
        $rows[] = ['at' => $c[0], 'day' => $day, 'ip' => $c[1], 'user' => $c[2], 'page' => $c[3], 'device' => $c[4],
                   'returning' => $c[5] === 'returning', 'ref' => $c[6]];
    }
}

$perDay = [];
for ($i = $days - 1; $i >= 0; $i--) $perDay[date('Y-m-d', strtotime("-$i days"))] = 0;
$count = fn(callable $key) => (function () use ($rows, $key) {
    $n = [];
    foreach ($rows as $r) { $k = $key($r); if ($k !== null) $n[$k] = ($n[$k] ?? 0) + 1; }
    arsort($n);
    return array_slice($n, 0, 8, true);
})();
foreach ($rows as $r) if (isset($perDay[$r['day']])) $perDay[$r['day']]++;
$pages = $count(fn($r) => $r['page']);
$refs = $count(fn($r) => $r['ref'] === '-' ? 'diretto / app' : $r['ref']);
$devices = $count(fn($r) => $r['device']);
$users = $count(fn($r) => $r['user'] === '-' ? null : $r['user']);
$total = count($rows);
$unique = count(array_unique(array_map(fn($r) => $r['ip'] . '|' . $r['device'], $rows)));
$returning = count(array_filter($rows, fn($r) => $r['returning']));
$todayCount = $perDay[$today] ?? 0;
$maxDay = max(1, max($perDay));
$recent = array_slice(array_reverse($rows), 0, 25);
$h = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES);
$months = ['01' => 'gen', '02' => 'feb', '03' => 'mar', '04' => 'apr', '05' => 'mag', '06' => 'giu', '07' => 'lug',
           '08' => 'ago', '09' => 'set', '10' => 'ott', '11' => 'nov', '12' => 'dic'];
$fmtDay = fn($d) => (int)substr($d, 8, 2) . ' ' . $months[substr($d, 5, 2)];

function barList(array $items, int $total, callable $h): void {
    if (!$items) { echo '<p class="empty">Ancora nessun dato.</p>'; return; }
    $max = max($items);
    echo '<ol class="bars">';
    foreach ($items as $label => $n) {
        $w = max(2, round(100 * $n / $max));
        $pct = $total ? round(100 * $n / $total) : 0;
        echo '<li><span class="label" title="' . $h($label) . '">' . $h($label) . '</span>'
           . '<span class="track"><span class="fill" style="width:' . $w . '%"></span></span>'
           . '<span class="value">' . $n . ' <small>' . $pct . '%</small></span></li>';
    }
    echo '</ol>';
}
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <?php renderHead('Statistiche // Vector-Box', true); ?>
    <meta name="robots" content="noindex">
    <link rel="stylesheet" href="../css/stats.css?v=2">
    <script src="../js/stats.js?v=1" defer></script>
</head>
<body class="stats-page">
    <header class="cyber-header">
        <div class="glitch">// STATISTICHE</div>
        <a href="../index.php" class="nav-btn">// RETURN</a>
    </header>

    <main class="stats">
        <nav class="range" aria-label="Periodo">
            <?php foreach ([7, 30, 90] as $d): ?>
                <a href="?days=<?= $d ?>" class="<?= $d === $days ? 'on' : '' ?>" <?= $d === $days ? 'aria-current="page"' : '' ?>>Ultimi <?= $d ?> giorni</a>
            <?php endforeach; ?>
        </nav>

        <section class="tiles">
            <div class="tile"><span class="big"><?= $todayCount ?></span><span>visite oggi</span></div>
            <div class="tile"><span class="big"><?= $total ?></span><span>visite in <?= $days ?> giorni</span></div>
            <div class="tile"><span class="big"><?= $unique ?></span><span>visitatori diversi</span></div>
            <div class="tile"><span class="big"><?= $total ? round(100 * $returning / $total) : 0 ?>%</span><span>tornano (<?= $returning ?>)</span></div>
        </section>

        <section class="panel-s">
            <h2>Visite al giorno</h2>
            <div class="cols" role="img" aria-label="Visite al giorno, massimo <?= $maxDay ?>">
                <span class="ymax"><?= $maxDay ?></span>
                <?php $i = 0; foreach ($perDay as $d => $n): ?>
                    <span class="col<?= $d === $today ? ' today' : '' ?>" data-tip="<?= $h($fmtDay($d)) ?>: <?= $n ?> visit<?= $n === 1 ? 'a' : 'e' ?>">
                        <span class="bar" style="height:<?= $n ? max(2, round(100 * $n / $maxDay)) : 0 ?>%"></span>
                        <?php $step = max(1, intdiv($days, 7));
                              if ($d === $today || ($i % $step === 0 && $i < $days - max(2, intdiv($step, 2) + 1))): ?><span class="x"><?= $h($fmtDay($d)) ?></span><?php endif; ?>
                    </span>
                <?php $i++; endforeach; ?>
            </div>
            <details>
                <summary>Mostra come tabella</summary>
                <table class="tbl"><thead><tr><th>Giorno</th><th>Visite</th></tr></thead><tbody>
                    <?php foreach (array_reverse($perDay, true) as $d => $n): ?><tr><td><?= $h($fmtDay($d)) ?></td><td><?= $n ?></td></tr><?php endforeach; ?>
                </tbody></table>
            </details>
        </section>

        <div class="grid">
            <section class="panel-s"><h2>Pagine di arrivo</h2><?php barList($pages, $total, $h); ?></section>
            <section class="panel-s"><h2>Da dove arrivano</h2><?php barList($refs, $total, $h); ?></section>
            <section class="panel-s"><h2>Dispositivi</h2><?php barList($devices, $total, $h); ?></section>
            <section class="panel-s"><h2>Utenti con account</h2><?php barList($users, $total, $h); ?></section>
        </div>

        <section class="panel-s">
            <h2>Ultime visite</h2>
            <?php if (!$recent): ?><p class="empty">Ancora nessuna visita registrata.</p><?php else: ?>
            <div class="scroll"><table class="tbl">
                <thead><tr><th>Quando</th><th>Chi</th><th>Pagina</th><th>Dispositivo</th><th>Da</th><th>IP</th></tr></thead>
                <tbody>
                <?php foreach ($recent as $r): ?>
                    <tr><td><?= $h(substr($r['at'], 5, 11)) ?></td>
                        <td><?= $r['user'] !== '-' ? $h($r['user']) : ($r['returning'] ? 'di ritorno' : 'nuovo') ?></td>
                        <td><?= $h($r['page']) ?></td><td><?= $h($r['device']) ?></td>
                        <td><?= $r['ref'] !== '-' ? $h($r['ref']) : '–' ?></td><td class="mono"><?= $h($r['ip']) ?></td></tr>
                <?php endforeach; ?>
                </tbody>
            </table></div>
            <?php endif; ?>
        </section>
        <p class="note">Una visita è nuova quando lo stesso IP con lo stesso browser non si vedeva da 30 minuti. Robot, controlli del server e anteprime dei link non sono contati.</p>
    </main>
    <div class="tip" id="tip" hidden></div>
</body>
</html>
