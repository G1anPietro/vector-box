<?php
// public/api/attacks.php — what the server saw of attacks in the last 7 days (SSH, web probes, fail2ban bans), shown on the stats page.
// bin/attacks-collect.php (cron, as the owner's user, who may read the system logs) calls attacksBuild() and writes data/attacks.json;
// the web server only ever reads that summary, never the logs.
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/geoip.php';

const ATTACK_DAYS = 7;
/** Paths nobody on this site asks for: scanners looking for other people's software, secrets and backups. */
const ATTACK_WEB_RE = '#(?:wp-(?:login|admin|content|includes)|xmlrpc\.php|/\.env|/\.git/|phpmyadmin|/pma/|/cgi-bin/|phpunit|/actuator|/boaform|/HNAP1|/vendor/|\.php\?(?:id|page)=|/config\.(?:json|php|bak)|/backup|\.sql(?:\.gz)?$|/etc/passwd|/\.aws|/\.ssh|/shell\?|/eval-stdin)#i';

function attacksFile(): string { return dirname(__DIR__, 2) . '/data/attacks.json'; }

function attackIsLocal(string $ip): bool {
    return $ip === '' || !filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE);
}

/** One sshd log line (journalctl -o short-iso) -> ['ts','ip','kind'=>'login'|'scan','user'] or null. 'login' = someone tried a user name. */
function attacksParseSsh(string $line): ?array {
    if (!preg_match('/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(Z|[+-]\d\d:?\d\d)?\S*\s+\S+\s+sshd(?:-session)?\[\d+\]:\s+(.*)$/', $line, $m)) return null;
    $ofs = $m[2] ?: 'Z';                       // journalctl -o short-iso writes the server's own offset: honour it (the day buckets and the alerts are in UTC)
    $msg = $m[3];
    $ip = ''; $kind = ''; $user = '';
    // one event per attempt: "Invalid user X from IP", or "Failed password for X from IP" for a real account (the other lines repeat these)
    if (preg_match('/^(?:Invalid user|Failed \w+ for (?!invalid user))\s*(\S+)\s+from\s+(\S+)/', $msg, $x)
        && filter_var($x[2], FILTER_VALIDATE_IP)) { $kind = 'login'; $user = $x[1]; $ip = $x[2]; }
    elseif (preg_match('/(?:Connection closed by|Connection reset by|Timeout before authentication for|Unable to negotiate with|banner exchange: Connection from|Did not receive identification string from|Bad protocol version identification .* from)\s+(?:connection from\s+)?(\d[\d.]+|[0-9a-f:]{3,})/i', $msg, $x)
        && filter_var($x[1], FILTER_VALIDATE_IP) && (str_contains($msg, 'preauth') || !str_contains($msg, 'authenticating') && !str_contains($msg, 'user'))) { $kind = 'scan'; $ip = $x[1]; }
    if ($kind === '' || attackIsLocal($ip)) return null;
    return ['ts' => strtotime($m[1] . $ofs) ?: 0, 'ip' => $ip, 'kind' => $kind, 'user' => textCut($user, 32)];
}

/** One nginx combined-log line -> ['ts','ip','path','status'] when the request is a probe (see ATTACK_WEB_RE), else null. */
function attacksParseWeb(string $line): ?array {
    if (!preg_match('/^(\S+) \S+ \S+ \[([^\]]+)\] "(?:GET|POST|HEAD|PUT|PROPFIND)\s+(\S+)[^"]*" (\d{3})/', $line, $m)) return null;
    if (!preg_match(ATTACK_WEB_RE, $m[3]) || attackIsLocal($m[1])) return null;
    $ts = DateTime::createFromFormat('d/M/Y:H:i:s O', $m[2]);
    return ['ts' => $ts ? $ts->getTimestamp() : 0, 'ip' => $m[1], 'path' => textCut((string)strtok($m[3], '?'), 80), 'status' => (int)$m[4]];
}

/** "Ban 1.2.3.4" lines of fail2ban (journalctl -o short-iso) -> ['ts','ip'] or null. */
function attacksParseBan(string $line): ?array {
    if (!preg_match('/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(Z|[+-]\d\d:?\d\d)?\S*\s.*\]:?\s+NOTICE\s+\[(\S+)\]\s+Ban\s+(\S+)/', $line, $m) || !filter_var($m[4], FILTER_VALIDATE_IP)) return null;
    return ['ts' => strtotime($m[1] . ($m[2] ?: 'Z')) ?: 0, 'ip' => $m[4], 'jail' => $m[3]];
}

/** Count events (each with ts, ip, optional user/path/kind) per day, per address and per extra key. */
function attacksTally(array $events, string $key, int $now, ?string $geoFile = null): array {
    $since = $now - ATTACK_DAYS * 86400;
    $perDay = []; $ips = []; $keys = []; $total = 0;
    for ($d = ATTACK_DAYS - 1; $d >= 0; $d--) $perDay[gmdate('Y-m-d', $now - $d * 86400)] = 0;
    foreach ($events as $e) {
        if ($e['ts'] < $since) continue;
        $total++;
        $day = gmdate('Y-m-d', $e['ts']);
        if (isset($perDay[$day])) $perDay[$day]++;
        $ips[$e['ip']] ??= ['ip' => $e['ip'], 'n' => 0, 'last' => 0];
        $ips[$e['ip']]['n']++;
        $ips[$e['ip']]['last'] = max($ips[$e['ip']]['last'], $e['ts']);
        if ($key !== '' && ($e[$key] ?? '') !== '') $keys[$e[$key]] = ($keys[$e[$key]] ?? 0) + 1;
    }
    uasort($ips, fn($a, $b) => $b['n'] <=> $a['n']);
    arsort($keys);
    $top = array_slice(array_values($ips), 0, 15);
    foreach ($top as &$t) $t['cc'] = geoipLookup($t['ip'], $geoFile);
    unset($t);
    $byCc = [];
    foreach ($ips as $i) { $cc = geoipLookup($i['ip'], $geoFile) ?? '??'; $byCc[$cc] = ($byCc[$cc] ?? 0) + $i['n']; }
    arsort($byCc);
    return ['total' => $total, 'addresses' => count($ips), 'per_day' => $perDay, 'top_ips' => $top,
            'top_keys' => array_slice($keys, 0, 12, true), 'countries' => array_slice($byCc, 0, 10, true)];
}

/** Percent of free space on the disk holding $dir (0 when unknown). */
function attacksDiskPct(string $dir): int {
    $f = @disk_free_space($dir); $t = @disk_total_space($dir);
    return $f !== false && $t ? (int)round(100 * $f / $t) : 0;
}
function attacksHealthOk(bool $db, int $diskPct): bool { return $db && $diskPct >= 5; }

/** p-th percentile (nearest rank) of an ascending-sorted list of floats. */
function attacksPct(array $sorted, float $p): float {
    return $sorted ? $sorted[max(0, (int)ceil($p / 100 * count($sorted)) - 1)] : 0.0;
}

/** Response times of the last 24 h from nginx "timed" lines (request time as the last field; lines without it are skipped).
 *  Streaming endpoints are left out. Returns ['n','p50','p95','p99','endpoints'=>[path=>[n,p50,p95,max]]] in milliseconds. No query strings, no IPs. */
function attacksSpeed(array $lines, int $now): array {
    $all = []; $per = [];
    foreach ($lines as $l) {
        if (!preg_match('/\[([^\]]+)\] "[A-Z]+\s+(\S+)[^"]*" \d{3} .* (\d+\.\d{3})\s*$/', $l, $m)) continue;
        $path = strtok($m[2], '?');
        if ($path === false || stripos($path, 'stream') !== false) continue;
        $ts = DateTime::createFromFormat('d/M/Y:H:i:s O', $m[1]);
        if (!$ts || $ts->getTimestamp() < $now - 86400) continue;
        $ms = (float)$m[3] * 1000;
        $key = preg_match('#^/(?:js|css)/|\.(?:png|jpe?g|gif|webp|svg|ico|avif)$#i', $path) ? 'static' : textCut($path, 80);
        $all[] = $ms; $per[$key][] = $ms;
    }
    sort($all);
    $eps = [];
    foreach ($per as $k => $v) { sort($v); $eps[$k] = ['n' => count($v), 'p50' => attacksPct($v, 50), 'p95' => attacksPct($v, 95), 'max' => end($v)]; }
    return ['n' => count($all), 'p50' => attacksPct($all, 50), 'p95' => attacksPct($all, 95), 'p99' => attacksPct($all, 99), 'endpoints' => $eps];
}

/** Daily digest due? First run at or after 08:00 server time, once per day. */
function attacksShouldDigest(?array $state, int $now): bool {
    return (int)date('G', $now) >= 8 && ($state['digest_date'] ?? '') !== date('Y-m-d', $now);
}

/** New lines in the error log since $offset (a byte offset) -> [count, new offset]. Never returns text. */
function attacksNewErrors(string $file, int $offset): array {
    $size = @filesize($file);
    if ($size === false) return [0, 0];
    if ($size < $offset) $offset = 0;                     // log rotated
    $txt = $size > $offset ? (string)@file_get_contents($file, false, null, $offset) : '';
    return [substr_count($txt, "\n"), $size];
}

/** The daily message [title, body] (yesterday's numbers, UTC days like the summary), or null without a summary. */
function attacksDigest(array $summary, int $newErrors, int $diskPct, ?int $now = null): ?array {
    if (!isset($summary['ssh'], $summary['web'], $summary['bans'])) return null;
    $y = gmdate('Y-m-d', ($now ?? time()) - 86400);
    $n = fn($k) => (int)($summary[$k]['per_day'][$y] ?? 0);
    return ['Daily digest', "Yesterday: {$n('ssh')} SSH attempts, {$n('web')} web probes, {$n('bans')} new bans. New errors in the log: $newErrors. Disk free: $diskPct%."];
}

/** The summary shown on the stats page, from raw log lines. */
function attacksBuild(array $sshLines, array $webLines, array $banLines, ?int $now = null, ?string $geoFile = null): array {
    $now ??= time();
    $ssh = $web = $bans = [];
    foreach ($sshLines as $l) if ($e = attacksParseSsh($l)) $ssh[] = $e;
    foreach ($webLines as $l) if ($e = attacksParseWeb($l)) $web[] = $e;
    foreach ($banLines as $l) if ($e = attacksParseBan($l)) $bans[] = $e;
    $s = attacksTally($ssh, 'user', $now, $geoFile);
    $s['logins'] = count(array_filter($ssh, fn($e) => $e['kind'] === 'login' && $e['ts'] >= $now - ATTACK_DAYS * 86400));
    $s['scans'] = $s['total'] - $s['logins'];
    $b = attacksTally($bans, '', $now, $geoFile);
    usort($bans, fn($x, $y) => $y['ts'] <=> $x['ts']);
    $b['recent'] = array_map(fn($e) => $e + ['cc' => geoipLookup($e['ip'], $geoFile)], array_slice($bans, 0, 10));
    return ['generated_at' => $now, 'days' => ATTACK_DAYS, 'ssh' => $s, 'web' => attacksTally($web, 'path', $now, $geoFile), 'bans' => $b];
}

/** The last summary written by the collector, or null (never collected / unreadable). */
function attacksRead(): ?array {
    $j = @file_get_contents(attacksFile());
    $d = $j === false ? null : json_decode($j, true);
    return is_array($d) && isset($d['ssh']) ? $d : null;   // 'speed' may be missing (older files)
}

/** What deserves a phone notification, comparing the previous summary with the new one: addresses fail2ban banned since the last run, and a burst
 *  of SSH login guesses (20+ more than before; shortcut: the 7-day window slides, so the difference can undercount, fine for a burst). */
function attacksAlerts(?array $prev, array $now): array {
    if (!$prev) return [];                                   // first run: nothing to compare with
    $out = [];
    foreach ($now['bans']['recent'] as $b) {
        if ($b['ts'] > $prev['generated_at']) $out[] = ['Banned: ' . $b['jail'], $b['ip'] . ' (' . ($b['cc'] ?? '??') . ') was banned by fail2ban'];
    }
    $burst = $now['ssh']['logins'] - $prev['ssh']['logins'];
    if ($burst >= 20) $out[] = ['SSH guessing', "$burst login attempts since the last check"];
    return array_slice($out, 0, 3);                          // never a flood on the phone
}

function attacksNotify(string $title, string $body): void {
    $url = (string)envValue('NTFY_TOPIC_URL', '');
    if ($url === '' || strtolower((string)envValue('ATTACK_NOTIFY', 'true')) === 'false') return;
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_HTTPHEADER => ['Title: ' . preg_replace('/[^\x20-\x7E]/', '', $title), 'Tags: warning'],
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 5, CURLOPT_SSL_VERIFYPEER => true]);
    curl_exec($ch);
    curl_close($ch);
}
