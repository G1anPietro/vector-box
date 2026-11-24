<?php
// public/pages/stats.php — visit statistics for the admin, read from data/visits.log (+ visits.log.1).
// Each log line is one NEW visit (same IP + browser not seen for VISIT_GAP_MIN minutes), tab separated:
// date time, ip, user, page, device, first|returning, referrer host.
require_once __DIR__ . '/../includes/head.php';
require_once __DIR__ . '/../api/database.php';
require_once __DIR__ . '/../api/bots.php';
require_once __DIR__ . '/../api/geoip.php';
require_once __DIR__ . '/../api/attacks.php';

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
$refs = $count(fn($r) => $r['ref'] === '-' ? tt('direct / app', 'diretto / app') : $r['ref']);
$devices = $count(fn($r) => $r['device']);
$users = $count(fn($r) => $r['user'] === '-' ? null : $r['user']);
$total = count($rows);
$unique = count(array_unique(array_map(fn($r) => $r['ip'] . '|' . $r['device'], $rows)));
$returning = count(array_filter($rows, fn($r) => $r['returning']));
$todayCount = $perDay[$today] ?? 0;
$maxDay = max(1, max($perDay));
$recent = array_slice(array_reverse($rows), 0, 25);
$h = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES);
$months = pageLang() === 'it'
    ? ['01' => 'gen', '02' => 'feb', '03' => 'mar', '04' => 'apr', '05' => 'mag', '06' => 'giu', '07' => 'lug', '08' => 'ago', '09' => 'set', '10' => 'ott', '11' => 'nov', '12' => 'dic']
    : ['01' => 'Jan', '02' => 'Feb', '03' => 'Mar', '04' => 'Apr', '05' => 'May', '06' => 'Jun', '07' => 'Jul', '08' => 'Aug', '09' => 'Sep', '10' => 'Oct', '11' => 'Nov', '12' => 'Dec'];
$fmtDay = fn($d) => (int)substr($d, 8, 2) . ' ' . $months[substr($d, 5, 2)];
/** "1 visit" / "2 visits" (English), "1 visita" / "2 visite" (Italian). */
$nVisits = fn($n) => $n . ' ' . (pageLang() === 'it' ? ($n === 1 ? 'visita' : 'visite') : ($n === 1 ? 'visit' : 'visits'));
$nReq = fn($n) => $n . ' ' . (pageLang() === 'it' ? ($n === 1 ? 'richiesta' : 'richieste') : ($n === 1 ? 'request' : 'requests'));
/** The names of the kinds of bot, in the language of the page. */
$kindOf = fn($k) => pageLang() === 'it' ? (BOT_KINDS[$k] ?? $k) : (['crawler' => 'Search engines and link previews', 'ai' => 'AI crawlers', 'abusive' => 'Blocked scrapers',
                   'tool' => 'Scripts and tools', 'scanner' => 'Vulnerability scanners'][$k] ?? $k);

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
        $kindName = $kindOf($b['kind']);
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
        $botRecent[] = ['at' => $c[0], 'ip' => $c[1], 'kind' => $kindOf($c[2]), 'label' => $c[3], 'page' => $c[4], 'status' => $c[5]];
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
    if (!$items) { echo '<p class="empty">' . tt('No data yet.', 'Ancora nessun dato.') . '</p>'; return; }
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
<html lang="<?= pageLang() ?>">
<head>
    <?php renderHead(tt('Statistics // Vector-Box', 'Statistiche // Vector-Box'), true); ?>
    <meta name="robots" content="noindex">
    <link rel="stylesheet" href="../css/stats.css?v=<?= filemtime(__DIR__ . '/../css/stats.css') ?>">
    <script src="../js/stats.js?v=<?= filemtime(__DIR__ . '/../js/stats.js') ?>" defer></script>
</head>
<body class="stats-page">
    <header class="cyber-header">
        <div class="glitch">// <?= tt('STATISTICS', 'STATISTICHE') ?></div>
        <a href="../desktop.php" class="nav-btn">// <?= tt('RETURN', 'INDIETRO') ?></a>
    </header>

    <main class="stats">
        <h1 class="sr-only"><?= tt('Statistics', 'Statistiche') ?></h1>
        <nav class="range" aria-label="<?= tt('Period', 'Periodo') ?>">
            <?php foreach ([7, 30, 90] as $d): ?>
                <a href="?days=<?= $d ?>" class="<?= $d === $days ? 'on' : '' ?>" <?= $d === $days ? 'aria-current="page"' : '' ?>><?= tt("Last $d days", "Ultimi $d giorni") ?></a>
            <?php endforeach; ?>
        </nav>

        <section class="tiles">
            <div class="tile"><span class="big"><?= $todayCount ?></span><span><?= tt('visits today', 'visite oggi') ?></span></div>
            <div class="tile"><span class="big"><?= $total ?></span><span><?= tt("visits in $days days", "visite in $days giorni") ?></span></div>
            <div class="tile"><span class="big"><?= $unique ?></span><span><?= tt('different visitors', 'visitatori diversi') ?></span></div>
            <div class="tile"><span class="big"><?= $total ? round(100 * $returning / $total) : 0 ?>%</span><span><?= tt("return ($returning)", "tornano ($returning)") ?></span></div>
        </section>

        <section class="panel-s">
            <h2><?= tt('Visits per day', 'Visite al giorno') ?></h2>
            <div class="cols" role="img" aria-label="<?= tt("Visits per day, maximum $maxDay", "Visite al giorno, massimo $maxDay") ?>">
                <span class="ymax"><?= $maxDay ?></span>
                <?php $i = 0; foreach ($perDay as $d => $n): ?>
                    <span class="col<?= $d === $today ? ' today' : '' ?>" data-tip="<?= $h($fmtDay($d)) ?>: <?= $nVisits($n) ?>">
                        <span class="bar" style="height:<?= $n ? max(2, round(100 * $n / $maxDay)) : 0 ?>%"></span>
                        <?php $step = max(1, intdiv($days, 7));
                              if ($d === $today || ($i % $step === 0 && $i < $days - max(2, intdiv($step, 2) + 1))): ?><span class="x"><?= $h($fmtDay($d)) ?></span><?php endif; ?>
                    </span>
                <?php $i++; endforeach; ?>
            </div>
            <details>
                <summary><?= tt('Show as a table', 'Mostra come tabella') ?></summary>
                <table class="tbl"><thead><tr><th><?= tt('Day', 'Giorno') ?></th><th><?= tt('Visits', 'Visite') ?></th></tr></thead><tbody>
                    <?php foreach (array_reverse($perDay, true) as $d => $n): ?><tr><td><?= $h($fmtDay($d)) ?></td><td><?= $n ?></td></tr><?php endforeach; ?>
                </tbody></table>
            </details>
        </section>

        <div class="grid">
            <section class="panel-s"><h2><?= tt('Landing pages', 'Pagine di arrivo') ?></h2><?php barList($pages, $total, $h); ?></section>
            <section class="panel-s"><h2><?= tt('Where they come from', 'Da dove arrivano') ?></h2><?php barList($refs, $total, $h); ?></section>
            <section class="panel-s"><h2><?= tt('Devices', 'Dispositivi') ?></h2><?php barList($devices, $total, $h); ?></section>
            <section class="panel-s"><h2><?= tt('Users with an account', 'Utenti con account') ?></h2><?php barList($users, $total, $h); ?></section>
        </div>

        <section class="panel-s" id="mappa">
            <h2><?= tt('Map: where visitors and bots come from', 'Mappa: da dove arrivano visitatori e bot') ?></h2>
            <?php if (!$geoReady): ?>
                <p class="empty"><?php if (pageLang() === 'it'): ?>Il database dei paesi non c'è ancora. Si scarica da solo una volta al mese (lo fa il lavoro notturno) oppure subito con <code>php tools/geoip-update.php</code> sul server.<?php else: ?>The country database is not there yet. It downloads itself once a month (the nightly job does it) or right now with <code>php tools/geoip-update.php</code> on the server.<?php endif; ?></p>
            <?php else: ?>
            <div class="map-modes" role="group" aria-label="<?= tt('What to show on the map', 'Cosa mostrare sulla mappa') ?>">
                <button type="button" class="on" data-mode="h" aria-pressed="true"><?= tt('Visitors', 'Visitatori') ?></button>
                <button type="button" data-mode="b" aria-pressed="false">Bot</button>
                <button type="button" data-mode="a" aria-pressed="false"><?= tt('All (red = more bots)', 'Tutti (rosso = più bot)') ?></button>
            </div>
            <div class="map-wrap">
            <div class="map-zoom" role="group" aria-label="<?= tt('Map zoom', 'Zoom della mappa') ?>"><button type="button" data-z="in" aria-label="<?= tt('Zoom in', 'Ingrandisci') ?>">+</button><button type="button" data-z="out" aria-label="<?= tt('Zoom out', 'Rimpicciolisci') ?>">−</button><button type="button" data-z="reset" aria-label="<?= tt('Show the whole world', 'Mostra tutto il mondo') ?>">⟲</button></div>
            <svg class="map" viewBox="<?= $h($mapData['viewBox']) ?>" role="img" aria-label="<?= tt('World map coloured by number of visits', 'Mappa del mondo colorata per numero di visite') ?>" preserveAspectRatio="xMidYMid meet">
                <?php foreach ($mapData['countries'] as $cc => $c): $hv = $byCountry[$cc]['h'] ?? 0; $bv = $byCountry[$cc]['b'] ?? 0; ?>
                    <path d="<?= $c['d'] ?>" data-c="<?= $h($cc) ?>" data-h="<?= $hv ?>" data-b="<?= $bv ?>"
                          data-tip="<?= $h($c['n']) ?>: <?= $nVisits($hv) ?>, <?= $nReq($bv) ?> <?= tt('from bots', 'di bot') ?>"></path>
                <?php endforeach; ?>
            </svg>
            </div>
            <p class="note map-hint"><?= tt('Zoom: mouse wheel, two fingers or the buttons; drag to move around; double click to zoom in.', 'Zoom: rotella del mouse, due dita o i tasti; trascina per spostarti; doppio clic per avvicinarti.') ?></p>
            <div class="map-legend" aria-hidden="true"><span><?= tt('less', 'meno') ?></span><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><i class="l5"></i><span><?= tt('more', 'più') ?></span></div>
            <?php $known = array_filter($byCountry, fn($v, $k) => $ccKnown($k), ARRAY_FILTER_USE_BOTH); $unknown = ($byCountry['??']['h'] ?? 0) + ($byCountry['??']['b'] ?? 0); ?>
            <?php if (!$known): ?><p class="empty"><?= tt('No address to put on the map yet.', 'Ancora nessun indirizzo da mettere sulla mappa.') ?></p><?php else: ?>
            <div class="scroll"><table class="tbl">
                <thead><tr><th><?= tt('Country', 'Paese') ?></th><th><?= tt('Visits', 'Visite') ?></th><th><?= tt('Different IPs', 'IP diversi') ?></th><th><?= tt('Bot requests', 'Richieste di bot') ?></th><th><?= tt('Bot IPs', 'IP di bot') ?></th></tr></thead>
                <tbody>
                <?php foreach (array_slice($known, 0, 12, true) as $cc => $v): ?>
                    <tr class="<?= ($v['b'] ?? 0) > ($v['h'] ?? 0) ? 'row-bot' : '' ?>"><td><span class="cc"><?= $h($cc) ?></span> <?= $h($countryName($cc)) ?></td>
                        <td><?= $v['h'] ?? 0 ?></td><td><?= count($v['hip'] ?? []) ?></td><td><?= $v['b'] ?? 0 ?></td><td><?= count($v['bip'] ?? []) ?></td></tr>
                <?php endforeach; ?>
                </tbody>
            </table></div>
            <?php endif; ?>
            <?php if ($unknown): ?><p class="note"><?= tt("$unknown requests from addresses with no country (local network, reserved addresses or not in the database).", "$unknown richieste da indirizzi senza paese (rete locale, indirizzi riservati o non nel database).") ?></p><?php endif; ?>
            <h3 class="sub-title"><?= tt('Most active addresses', 'Indirizzi più attivi') ?></h3>
            <?php if (!$ipTop): ?><p class="empty"><?= tt('No data yet.', 'Ancora nessun dato.') ?></p><?php else: ?>
            <div class="scroll"><table class="tbl">
                <thead><tr><th>IP</th><th><?= tt('Country', 'Paese') ?></th><th><?= tt('Who', 'Chi') ?></th><th><?= tt('Visits', 'Visite') ?></th><th><?= tt('Bot requests', 'Richieste di bot') ?></th></tr></thead>
                <tbody>
                <?php foreach ($ipTop as $ip => $v): $isBot = ($v['b'] ?? 0) > 0; ?>
                    <tr class="<?= $isBot ? 'row-bot' : '' ?>"><td class="mono"><?= $h($ip) ?></td>
                        <td><?= $ccKnown($v['cc'] ?? '??') ? '<span class="cc">' . $h($v['cc']) . '</span> ' . $h($countryName($v['cc'])) : '–' ?></td>
                        <td><?php if ($isBot): ?><span class="badge-bot">BOT</span> <?= $h($v['label'] ?? '') ?><?php else: ?><?= tt('person', 'persona') ?><?php endif; ?></td>
                        <td><?= $v['h'] ?? 0 ?></td><td><?= $v['b'] ?? 0 ?></td></tr>
                <?php endforeach; ?>
                </tbody>
            </table></div>
            <?php endif; ?>
            <p class="note"><?php if (pageLang() === 'it'): ?>Il paese si ricava dall'indirizzo IP con un database scaricato sul server: nessun indirizzo dei visitatori viene mandato a servizi esterni. <?php else: ?>The country comes from the IP address, using a database downloaded to the server: no visitor address is sent to outside services. <?php endif; ?><a href="https://db-ip.com" rel="noopener noreferrer">IP Geolocation by DB-IP</a> (CC BY 4.0). <?= tt('A country is not a person: VPNs, mobile networks and proxies move the dots.', 'Un paese non è una persona: VPN, reti mobili e proxy spostano i punti.') ?></p>
            <?php endif; ?>
        </section>

        <section class="panel-s">
            <h2><?= tt('Latest visits', 'Ultime visite') ?></h2>
            <?php if (!$recent): ?><p class="empty"><?= tt('No visit recorded yet.', 'Ancora nessuna visita registrata.') ?></p><?php else: ?>
            <div class="scroll"><table class="tbl">
                <thead><tr><th><?= tt('When', 'Quando') ?></th><th><?= tt('Who', 'Chi') ?></th><th><?= tt('Page', 'Pagina') ?></th><th><?= tt('Device', 'Dispositivo') ?></th><th><?= tt('From', 'Da') ?></th><th>IP</th><th><?= tt('Country', 'Paese') ?></th></tr></thead>
                <tbody>
                <?php foreach ($recent as $r): ?>
                    <tr><td><?= $h(substr($r['at'], 5, 11)) ?></td>
                        <td><?= $r['user'] !== '-' ? $h($r['user']) : ($r['returning'] ? tt('returning', 'di ritorno') : tt('new', 'nuovo')) ?></td>
                        <td><?= $h($r['page']) ?></td><td><?= $h($r['device']) ?></td>
                        <td><?= $r['ref'] !== '-' ? $h($r['ref']) : '–' ?></td><td class="mono"><?= $h($r['ip']) ?></td>
                        <td><?php $cc = $ccOf($r['ip']); echo $ccKnown($cc) ? '<span class="cc">' . $h($cc) . '</span>' : '–'; ?></td></tr>
                <?php endforeach; ?>
                </tbody>
            </table></div>
            <?php endif; ?>
        </section>
        <h2 class="sect-title" id="bot"><?= tt('Bots and automated requests', 'Bot e richieste automatiche') ?></h2>
        <section class="tiles">
            <div class="tile"><span class="big"><?= $botToday ?></span><span><?= tt('bot requests today', 'richieste di bot oggi') ?></span></div>
            <div class="tile"><span class="big"><?= $botTotal ?></span><span><?= tt("in $days days", "in $days giorni") ?></span></div>
            <div class="tile"><span class="big"><?= $botBlocked ?></span><span><?= tt('turned away (403 / 429)', 'respinte (403 / 429)') ?></span></div>
            <div class="tile"><span class="big"><?= ($total + $botTotal) ? round(100 * $botTotal / ($total + $botTotal)) : 0 ?>%</span><span><?= tt('of the PHP traffic is bots', 'del traffico PHP è dei bot') ?></span></div>
        </section>

        <section class="panel-s">
            <h2><?= tt('Bot requests per day', 'Richieste di bot al giorno') ?></h2>
            <div class="cols" role="img" aria-label="<?= tt("Bot requests per day, maximum $botMax", "Richieste di bot al giorno, massimo $botMax") ?>">
                <span class="ymax"><?= $botMax ?></span>
                <?php $i = 0; foreach ($botDay as $d => $n): ?>
                    <span class="col<?= $d === $today ? ' today' : '' ?>" data-tip="<?= $h($fmtDay($d)) ?>: <?= $nReq($n) ?>">
                        <span class="bar" style="height:<?= $n ? max(2, round(100 * $n / $botMax)) : 0 ?>%"></span>
                        <?php $step = max(1, intdiv($days, 7));
                              if ($d === $today || ($i % $step === 0 && $i < $days - max(2, intdiv($step, 2) + 1))): ?><span class="x"><?= $h($fmtDay($d)) ?></span><?php endif; ?>
                    </span>
                <?php $i++; endforeach; ?>
            </div>
        </section>

        <div class="grid">
            <section class="panel-s"><h2><?= tt('Kind of bot', 'Tipo di bot') ?></h2><?php barList($botKind, $botTotal, $h); ?></section>
            <section class="panel-s"><h2><?= tt('Who they are / what they look for', 'Chi sono / cosa cercano') ?></h2><?php barList($botLabel, $botTotal, $h); ?></section>
        </div>

        <section class="panel-s">
            <h2><?= tt('Latest bot requests', 'Ultime richieste di bot') ?></h2>
            <?php if (!$botRecent): ?><p class="empty"><?= tt('No bot request recorded yet.', 'Ancora nessuna richiesta di bot registrata.') ?></p><?php else: ?>
            <div class="scroll"><table class="tbl">
                <thead><tr><th><?= tt('When', 'Quando') ?></th><th><?= tt('Kind', 'Tipo') ?></th><th><?= tt('Who / what', 'Chi / cosa') ?></th><th><?= tt('Path', 'Percorso') ?></th><th><?= tt('Result', 'Esito') ?></th><th>IP</th><th><?= tt('Country', 'Paese') ?></th></tr></thead>
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
        <?php $atk = attacksRead(); ?>
        <h2 class="sect-title" id="attacchi"><?= tt('Attacks on the server', 'Attacchi al server') ?></h2>
        <?php if (!$atk): ?>
            <p class="empty"><?= tt('Not collected yet: the collector (bin/attacks-collect.php) has not run.', 'Non ancora raccolti: il raccoglitore (bin/attacks-collect.php) non è ancora partito.') ?></p>
        <?php else: $A = $atk['ssh']; $W = $atk['web']; $B = $atk['bans']; ?>
        <section class="tiles">
            <div class="tile"><span class="big"><?= (int)$A['total'] ?></span><span><?= tt('SSH attempts in 7 days', 'tentativi SSH in 7 giorni') ?></span></div>
            <div class="tile"><span class="big"><?= (int)$A['logins'] ?></span><span><?= tt('tried a user name (password login is off)', 'hanno provato un nome utente (il login con password è spento)') ?></span></div>
            <div class="tile"><span class="big"><?= (int)$W['total'] ?></span><span><?= tt('web probes (.env, wp-login…)', 'sondaggi web (.env, wp-login…)') ?></span></div>
            <div class="tile"><span class="big"><?= (int)$B['total'] ?></span><span><?= tt('addresses banned by fail2ban', 'indirizzi bannati da fail2ban') ?></span></div>
        </section>
        <section class="panel-s">
            <h2><?= tt('Attacks per day', 'Attacchi al giorno') ?></h2>
            <?php $atkDay = []; foreach ($A['per_day'] as $d => $n) $atkDay[$d] = $n + ($W['per_day'][$d] ?? 0); $atkMax = max(1, max($atkDay)); ?>
            <div class="cols" role="img" aria-label="<?= tt("SSH attempts and web probes per day, maximum $atkMax", "Tentativi SSH e sondaggi web al giorno, massimo $atkMax") ?>">
                <span class="ymax"><?= $atkMax ?></span>
                <?php foreach ($atkDay as $d => $n): ?>
                    <span class="col<?= $d === $today ? ' today' : '' ?>" data-tip="<?= $h($fmtDay($d)) ?>: SSH <?= (int)$A['per_day'][$d] ?> + web <?= (int)($W['per_day'][$d] ?? 0) ?>">
                        <span class="bar" style="height:<?= $n ? max(2, round(100 * $n / $atkMax)) : 0 ?>%"></span><span class="x"><?= $h($fmtDay($d)) ?></span>
                    </span>
                <?php endforeach; ?>
            </div>
        </section>
        <div class="grid">
            <section class="panel-s"><h2><?= tt('User names tried over SSH', 'Nomi utente provati via SSH') ?></h2><?php barList($A['top_keys'], max(1, (int)$A['logins']), $h); ?></section>
            <section class="panel-s"><h2><?= tt('What the web probes ask for', 'Cosa chiedono i sondaggi web') ?></h2><?php barList($W['top_keys'], max(1, (int)$W['total']), $h); ?></section>
            <section class="panel-s"><h2><?= tt('Countries (SSH)', 'Paesi (SSH)') ?></h2><?php barList($A['countries'], max(1, (int)$A['total']), $h); ?></section>
            <section class="panel-s"><h2><?= tt('Countries (web probes)', 'Paesi (sondaggi web)') ?></h2><?php barList($W['countries'], max(1, (int)$W['total']), $h); ?></section>
        </div>
        <section class="panel-s">
            <h2><?= tt('Most active attackers', 'Attaccanti più attivi') ?></h2>
            <?php $rowsA = []; foreach (['SSH' => $A['top_ips'], 'web' => $W['top_ips']] as $via => $list) foreach ($list as $t) $rowsA[] = $t + ['via' => $via];
                  usort($rowsA, fn($x, $y) => $y['n'] <=> $x['n']); $rowsA = array_slice($rowsA, 0, 15); ?>
            <?php if (!$rowsA): ?><p class="empty"><?= tt('Nothing recorded.', 'Niente di registrato.') ?></p><?php else: ?>
            <div class="scroll"><table class="tbl">
                <thead><tr><th><?= tt('Via', 'Da') ?></th><th>IP</th><th><?= tt('Country', 'Paese') ?></th><th><?= tt('Attempts', 'Tentativi') ?></th><th><?= tt('Last seen', 'Ultimo') ?></th></tr></thead>
                <tbody><?php foreach ($rowsA as $t): ?>
                    <tr class="row-bot"><td><span class="badge-bot"><?= $h($t['via']) ?></span></td><td class="mono"><?= $h($t['ip']) ?></td>
                        <td><?= $ccKnown((string)($t['cc'] ?? '')) ? '<span class="cc">' . $h($t['cc']) . '</span>' : '–' ?></td><td><?= (int)$t['n'] ?></td><td><?= $h(date('m-d H:i', (int)$t['last'])) ?></td></tr>
                <?php endforeach; ?></tbody>
            </table></div><?php endif; ?>
        </section>
        <?php if (!empty($B['recent'])): ?>
        <section class="panel-s">
            <h2><?= tt('Latest bans (fail2ban)', 'Ultimi ban (fail2ban)') ?></h2>
            <div class="scroll"><table class="tbl"><tbody><?php foreach ($B['recent'] as $t): ?>
                <tr><td><?= $h(date('m-d H:i', (int)$t['ts'])) ?></td><td><?= $h($t['jail']) ?></td><td class="mono"><?= $h($t['ip']) ?></td><td><?= $ccKnown((string)($t['cc'] ?? '')) ? $h($t['cc']) : '–' ?></td></tr>
            <?php endforeach; ?></tbody></table></div>
        </section>
        <?php endif; ?>
        <p class="note"><?= tt('Collected every 10 minutes from the system logs (the web server never reads them), last 7 days, local network addresses left out. Updated: ', 'Raccolti ogni 10 minuti dai log del sistema (il web server non li legge), ultimi 7 giorni, indirizzi della rete locale esclusi. Aggiornato: ') ?><?= $h(date('Y-m-d H:i', (int)$atk['generated_at'])) ?></p>
        <?php endif; ?>
        <?php $spd = $atk['speed'] ?? null; if ($spd && !empty($spd['n'])): $ms = fn($v) => number_format((float)$v, 0) . ' ms';
              $slow = array_filter($spd['endpoints'], fn($e) => $e['n'] >= 5); uasort($slow, fn($a, $b) => $b['p95'] <=> $a['p95']); $slow = array_slice($slow, 0, 8, true); ?>
        <h2 class="sect-title" id="velocita"><?= tt('Speed', 'Velocità') ?></h2>
        <section class="tiles">
            <div class="tile"><span class="big"><?= $h($ms($spd['p50'])) ?></span><span><?= tt('median response time, last 24 h', 'tempo di risposta mediano, ultime 24 ore') ?></span></div>
            <div class="tile"><span class="big"><?= $h($ms($spd['p95'])) ?></span><span><?= tt('95% of requests faster than this', '95% delle richieste più veloci di così') ?></span></div>
            <div class="tile"><span class="big"><?= $h($ms($spd['p99'])) ?></span><span><?= tt('99% faster than this', '99% più veloci di così') ?></span></div>
            <div class="tile"><span class="big"><?= (int)$spd['n'] ?></span><span><?= tt('requests measured', 'richieste misurate') ?></span></div>
        </section>
        <section class="panel-s">
            <h2><?= tt('Slowest endpoints (p95, at least 5 requests)', 'Indirizzi più lenti (p95, almeno 5 richieste)') ?></h2>
            <?php if (!$slow): ?><p class="empty"><?= tt('Nothing recorded.', 'Niente di registrato.') ?></p><?php else: ?>
            <div class="scroll"><table class="tbl">
                <thead><tr><th><?= tt('Endpoint', 'Indirizzo') ?></th><th><?= tt('Requests', 'Richieste') ?></th><th>p50</th><th>p95</th><th>max</th></tr></thead>
                <tbody><?php foreach ($slow as $p => $e): ?>
                    <tr><td class="mono"><?= $h($p) ?></td><td><?= (int)$e['n'] ?></td><td><?= $h($ms($e['p50'])) ?></td><td><?= $h($ms($e['p95'])) ?></td><td><?= $h($ms($e['max'])) ?></td></tr>
                <?php endforeach; ?></tbody>
            </table></div><?php endif; ?>
        </section>
        <?php endif; ?>
        <p class="note"><?php if (pageLang() === 'it'): ?>I bot sono contati solo quando la richiesta arriva a PHP (pagine e indirizzi sconosciuti); quello che nginx scarta da solo non si vede qui. Gli scraper noti (SEO, dati) e chi sonda indirizzi come wp-login o .env più di 8 volte in un'ora vengono respinti. Non sono visite: la tabella "Ultime visite" non li include.<?php else: ?>Bots are counted only when the request reaches PHP (pages and unknown addresses); whatever nginx drops by itself does not show here. Known scrapers (SEO, data) and anyone probing addresses such as wp-login or .env more than 8 times in an hour are turned away. They are not visits: the "Latest visits" table does not include them.<?php endif; ?></p>
        <p class="note"><?= tt('A visit counts as new when the same IP with the same browser was not seen for 30 minutes. Robots, server checks and link previews are not counted.', 'Una visita è nuova quando lo stesso IP con lo stesso browser non si vedeva da 30 minuti. Robot, controlli del server e anteprime dei link non sono contati.') ?></p>
    </main>
    <div class="tip" id="tip" hidden></div>
</body>
</html>
