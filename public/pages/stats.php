<?php
// public/pages/stats.php — visit statistics for the admin, read from data/visits.log (+ visits.log.1).
// Each log line is one NEW visit (same IP + browser not seen for VISIT_GAP_MIN minutes), tab separated:
// date time, ip, user, page, device, first|returning, referrer host.
require_once __DIR__ . '/../includes/head.php';
require_once __DIR__ . '/../api/database.php';
require_once __DIR__ . '/../api/bots.php';
require_once __DIR__ . '/../api/geoip.php';

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

// ---- bots and automated requests (bot_stats counters + the latest lines of bots.log) ----
$botDay = array_fill_keys(array_keys($perDay), 0);
$botKind = []; $botLabel = []; $botBlocked = 0; $botTotal = 0;
try {
    $q = getDbConnection()->prepare('SELECT day, kind, label, hits, blocked FROM bot_stats WHERE day >= :s');
    $q->execute([':s' => $since]);
    foreach ($q->fetchAll() as $b) {
        $n = (int)$b['hits'];
        $botTotal += $n; $botBlocked += (int)$b['blocked'];
        if (isset($botDay[$b['day']])) $botDay[$b['day']] += $n;
        $kindName = BOT_KINDS[$b['kind']] ?? $b['kind'];
        $botKind[$kindName] = ($botKind[$kindName] ?? 0) + $n;
        $botLabel[$b['label']] = ($botLabel[$b['label']] ?? 0) + $n;
    }
} catch (Throwable $e) { /* table missing before the first migration: show zeros */ }
arsort($botKind); arsort($botLabel);
$botLabel = array_slice($botLabel, 0, 10, true);
$botToday = $botDay[$today] ?? 0;
$botMax = max(1, max($botDay));
$botRecent = [];
foreach (['bots.log', 'bots.log.1'] as $f) {   // newest file first, each read from the end
    if (!is_file($dir . $f) || count($botRecent) >= 25) continue;
    foreach (array_reverse(file($dir . $f, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES)) as $line) {
        $c = explode("\t", $line);
        if (count($c) < 6) continue;
        $botRecent[] = ['at' => $c[0], 'ip' => $c[1], 'kind' => BOT_KINDS[$c[2]] ?? $c[2], 'label' => $c[3], 'page' => $c[4], 'status' => $c[5]];
        if (count($botRecent) >= 25) break;
    }
}

// ---- where do they come from? (country of every address, from the local DB-IP database; nothing leaves the server) ----
$geoReady = is_file(geoipFile());
$mapData = json_decode((string)@file_get_contents(__DIR__ . '/../assets/stats/world.json'), true) ?: ['viewBox' => '0 0 360 142', 'countries' => []];
$countryName = fn($cc) => $mapData['countries'][$cc]['n'] ?? $cc;
$byCountry = [];        // cc => ['h' => human visits, 'b' => bot requests, 'hip' => [ip => 1], 'bip' => [ip => 1]]
$ipTop = [];            // ip => ['h' => n, 'b' => n, 'label' => ..., 'cc' => ...]
$ccOf = function (string $ip) use ($geoReady) { return $geoReady ? (geoipLookup($ip) ?? '??') : '??'; };
foreach ($rows as $r) {
    $cc = $ccOf($r['ip']);
    $byCountry[$cc]['h'] = ($byCountry[$cc]['h'] ?? 0) + 1;
    $byCountry[$cc]['hip'][$r['ip']] = 1;
    $ipTop[$r['ip']]['h'] = ($ipTop[$r['ip']]['h'] ?? 0) + 1;
    $ipTop[$r['ip']]['cc'] = $cc;
}
foreach (['bots.log', 'bots.log.1'] as $f) {          // every bot line of the period (the log keeps at most RETENTION_BOTS_DAYS)
    if (!is_file($dir . $f)) continue;
    foreach (file($dir . $f, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $c = explode("\t", $line);
        if (count($c) < 6 || substr($c[0], 0, 10) < $since) continue;
        $cc = $ccOf($c[1]);
        $byCountry[$cc]['b'] = ($byCountry[$cc]['b'] ?? 0) + 1;
        $byCountry[$cc]['bip'][$c[1]] = 1;
        $ipTop[$c[1]]['b'] = ($ipTop[$c[1]]['b'] ?? 0) + 1;
        $ipTop[$c[1]]['label'] = $c[3];
        $ipTop[$c[1]]['cc'] = $cc;
    }
}
uasort($byCountry, fn($a, $b) => (($b['h'] ?? 0) + ($b['b'] ?? 0)) <=> (($a['h'] ?? 0) + ($a['b'] ?? 0)));
uasort($ipTop, fn($a, $b) => (($b['h'] ?? 0) + ($b['b'] ?? 0)) <=> (($a['h'] ?? 0) + ($a['b'] ?? 0)));
$ipTop = array_slice($ipTop, 0, 15, true);
$ccKnown = fn($cc) => preg_match('/^[A-Z]{2}$/', $cc) && $cc !== '??';

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
    <link rel="stylesheet" href="../css/stats.css?v=<?= filemtime(__DIR__ . '/../css/stats.css') ?>">
    <script src="../js/stats.js?v=<?= filemtime(__DIR__ . '/../js/stats.js') ?>" defer></script>
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

        <section class="panel-s" id="mappa">
            <h2>Mappa: da dove arrivano visitatori e bot</h2>
            <?php if (!$geoReady): ?>
                <p class="empty">Il database dei paesi non c'è ancora. Si scarica da solo una volta al mese (lo fa il lavoro notturno) oppure subito con <code>php tools/geoip-update.php</code> sul server.</p>
            <?php else: ?>
            <div class="map-modes" role="group" aria-label="Cosa mostrare sulla mappa">
                <button type="button" class="on" data-mode="h" aria-pressed="true">Visitatori</button>
                <button type="button" data-mode="b" aria-pressed="false">Bot</button>
                <button type="button" data-mode="a" aria-pressed="false">Tutti (rosso = più bot)</button>
            </div>
            <svg class="map" viewBox="<?= $h($mapData['viewBox']) ?>" role="img" aria-label="Mappa del mondo colorata per numero di visite" preserveAspectRatio="xMidYMid meet">
                <?php foreach ($mapData['countries'] as $cc => $c): $hv = $byCountry[$cc]['h'] ?? 0; $bv = $byCountry[$cc]['b'] ?? 0; ?>
                    <path d="<?= $c['d'] ?>" data-c="<?= $h($cc) ?>" data-h="<?= $hv ?>" data-b="<?= $bv ?>"
                          data-tip="<?= $h($c['n']) ?>: <?= $hv ?> visit<?= $hv === 1 ? 'a' : 'e' ?>, <?= $bv ?> richiest<?= $bv === 1 ? 'a' : 'e' ?> di bot"></path>
                <?php endforeach; ?>
            </svg>
            <div class="map-legend" aria-hidden="true"><span>meno</span><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><i class="l5"></i><span>più</span></div>
            <?php $known = array_filter($byCountry, fn($v, $k) => $ccKnown($k), ARRAY_FILTER_USE_BOTH); $unknown = ($byCountry['??']['h'] ?? 0) + ($byCountry['??']['b'] ?? 0); ?>
            <?php if (!$known): ?><p class="empty">Ancora nessun indirizzo da mettere sulla mappa.</p><?php else: ?>
            <div class="scroll"><table class="tbl">
                <thead><tr><th>Paese</th><th>Visite</th><th>IP diversi</th><th>Richieste di bot</th><th>IP di bot</th></tr></thead>
                <tbody>
                <?php foreach (array_slice($known, 0, 12, true) as $cc => $v): ?>
                    <tr class="<?= ($v['b'] ?? 0) > ($v['h'] ?? 0) ? 'row-bot' : '' ?>"><td><span class="cc"><?= $h($cc) ?></span> <?= $h($countryName($cc)) ?></td>
                        <td><?= $v['h'] ?? 0 ?></td><td><?= count($v['hip'] ?? []) ?></td><td><?= $v['b'] ?? 0 ?></td><td><?= count($v['bip'] ?? []) ?></td></tr>
                <?php endforeach; ?>
                </tbody>
            </table></div>
            <?php endif; ?>
            <?php if ($unknown): ?><p class="note"><?= $unknown ?> richieste da indirizzi senza paese (rete locale, indirizzi riservati o non nel database).</p><?php endif; ?>
            <h3 class="sub-title">Indirizzi più attivi</h3>
            <?php if (!$ipTop): ?><p class="empty">Ancora nessun dato.</p><?php else: ?>
            <div class="scroll"><table class="tbl">
                <thead><tr><th>IP</th><th>Paese</th><th>Chi</th><th>Visite</th><th>Richieste di bot</th></tr></thead>
                <tbody>
                <?php foreach ($ipTop as $ip => $v): $isBot = ($v['b'] ?? 0) > 0; ?>
                    <tr class="<?= $isBot ? 'row-bot' : '' ?>"><td class="mono"><?= $h($ip) ?></td>
                        <td><?= $ccKnown($v['cc'] ?? '??') ? '<span class="cc">' . $h($v['cc']) . '</span> ' . $h($countryName($v['cc'])) : '–' ?></td>
                        <td><?php if ($isBot): ?><span class="badge-bot">BOT</span> <?= $h($v['label'] ?? '') ?><?php else: ?>persona<?php endif; ?></td>
                        <td><?= $v['h'] ?? 0 ?></td><td><?= $v['b'] ?? 0 ?></td></tr>
                <?php endforeach; ?>
                </tbody>
            </table></div>
            <?php endif; ?>
            <p class="note">Il paese si ricava dall'indirizzo IP con un database scaricato sul server: nessun indirizzo dei visitatori viene mandato a servizi esterni. <a href="https://db-ip.com" rel="noopener noreferrer">IP Geolocation by DB-IP</a> (CC BY 4.0). Un paese non è una persona: VPN, reti mobili e proxy spostano i punti.</p>
            <?php endif; ?>
        </section>

        <section class="panel-s">
            <h2>Ultime visite</h2>
            <?php if (!$recent): ?><p class="empty">Ancora nessuna visita registrata.</p><?php else: ?>
            <div class="scroll"><table class="tbl">
                <thead><tr><th>Quando</th><th>Chi</th><th>Pagina</th><th>Dispositivo</th><th>Da</th><th>IP</th><th>Paese</th></tr></thead>
                <tbody>
                <?php foreach ($recent as $r): ?>
                    <tr><td><?= $h(substr($r['at'], 5, 11)) ?></td>
                        <td><?= $r['user'] !== '-' ? $h($r['user']) : ($r['returning'] ? 'di ritorno' : 'nuovo') ?></td>
                        <td><?= $h($r['page']) ?></td><td><?= $h($r['device']) ?></td>
                        <td><?= $r['ref'] !== '-' ? $h($r['ref']) : '–' ?></td><td class="mono"><?= $h($r['ip']) ?></td>
                        <td><?php $cc = $ccOf($r['ip']); echo $ccKnown($cc) ? '<span class="cc">' . $h($cc) . '</span>' : '–'; ?></td></tr>
                <?php endforeach; ?>
                </tbody>
            </table></div>
            <?php endif; ?>
        </section>
        <h2 class="sect-title" id="bot">Bot e richieste automatiche</h2>
        <section class="tiles">
            <div class="tile"><span class="big"><?= $botToday ?></span><span>richieste di bot oggi</span></div>
            <div class="tile"><span class="big"><?= $botTotal ?></span><span>in <?= $days ?> giorni</span></div>
            <div class="tile"><span class="big"><?= $botBlocked ?></span><span>respinte (403 / 429)</span></div>
            <div class="tile"><span class="big"><?= ($total + $botTotal) ? round(100 * $botTotal / ($total + $botTotal)) : 0 ?>%</span><span>del traffico PHP è dei bot</span></div>
        </section>

        <section class="panel-s">
            <h2>Richieste di bot al giorno</h2>
            <div class="cols" role="img" aria-label="Richieste di bot al giorno, massimo <?= $botMax ?>">
                <span class="ymax"><?= $botMax ?></span>
                <?php $i = 0; foreach ($botDay as $d => $n): ?>
                    <span class="col<?= $d === $today ? ' today' : '' ?>" data-tip="<?= $h($fmtDay($d)) ?>: <?= $n ?> richiest<?= $n === 1 ? 'a' : 'e' ?>">
                        <span class="bar" style="height:<?= $n ? max(2, round(100 * $n / $botMax)) : 0 ?>%"></span>
                        <?php $step = max(1, intdiv($days, 7));
                              if ($d === $today || ($i % $step === 0 && $i < $days - max(2, intdiv($step, 2) + 1))): ?><span class="x"><?= $h($fmtDay($d)) ?></span><?php endif; ?>
                    </span>
                <?php $i++; endforeach; ?>
            </div>
        </section>

        <div class="grid">
            <section class="panel-s"><h2>Tipo di bot</h2><?php barList($botKind, $botTotal, $h); ?></section>
            <section class="panel-s"><h2>Chi sono / cosa cercano</h2><?php barList($botLabel, $botTotal, $h); ?></section>
        </div>

        <section class="panel-s">
            <h2>Ultime richieste di bot</h2>
            <?php if (!$botRecent): ?><p class="empty">Ancora nessuna richiesta di bot registrata.</p><?php else: ?>
            <div class="scroll"><table class="tbl">
                <thead><tr><th>Quando</th><th>Tipo</th><th>Chi / cosa</th><th>Percorso</th><th>Esito</th><th>IP</th><th>Paese</th></tr></thead>
                <tbody>
                <?php foreach ($botRecent as $r): ?>
                    <tr class="row-bot"><td><?= $h(substr($r['at'], 5, 11)) ?></td><td><span class="badge-bot">BOT</span> <?= $h($r['kind']) ?></td><td><?= $h($r['label']) ?></td>
                        <td><?= $h($r['page']) ?></td><td><?= $h($r['status']) ?></td><td class="mono"><?= $h($r['ip']) ?></td>
                        <td><?php $cc = $ccOf($r['ip']); echo $ccKnown($cc) ? '<span class="cc">' . $h($cc) . '</span>' : '–'; ?></td></tr>
                <?php endforeach; ?>
                </tbody>
            </table></div>
            <?php endif; ?>
        </section>
        <p class="note">I bot sono contati solo quando la richiesta arriva a PHP (pagine e indirizzi sconosciuti); quello che nginx scarta da solo non si vede qui. Gli scraper noti (SEO, dati) e chi sonda indirizzi come wp-login o .env più di 8 volte in un'ora vengono respinti. Non sono visite: la tabella "Ultime visite" non li include.</p>
        <p class="note">Una visita è nuova quando lo stesso IP con lo stesso browser non si vedeva da 30 minuti. Robot, controlli del server e anteprime dei link non sono contati.</p>
    </main>
    <div class="tip" id="tip" hidden></div>
</body>
</html>
