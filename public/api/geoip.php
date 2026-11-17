<?php
// public/api/geoip.php — which country does an IP address belong to? Used by the admin statistics (map of visitors and bots).
//
// Everything stays on this server: the data is the free "IP to Country Lite" database of DB-IP (CC BY 4.0, https://db-ip.com),
// downloaded once a month and turned into a small binary file data/geoip-country.bin. An address is looked up in that file;
// nothing about a visitor is ever sent anywhere (the download is a plain file fetch with no visitor data).
//
// File format "VBG1": magic(4) | n4 uint32 | n6 uint32 | n4 records of [start uint32 big-endian][cc 2 bytes] | n6 records of
// [first 8 bytes of the IPv6 address][cc 2 bytes]. Records are sorted and contiguous: a record covers [start, next start).
// "ZZ" = no information. Lookup is a binary search with fseek, so the file is never loaded whole.
require_once __DIR__ . '/helpers.php';

const GEOIP_MAGIC = 'VBG1';
const GEOIP_MAX_AGE_DAYS = 35;

function geoipFile(): string { return dirname(__DIR__, 2) . '/data/geoip-country.bin'; }

/** ISO country code ("IT") of an address, or null when unknown / private / no database yet. */
function geoipLookup(string $ip, ?string $file = null): ?string {
    static $cache = [];
    $file ??= geoipFile();
    $key = $file . '|' . $ip;
    if (array_key_exists($key, $cache)) return $cache[$key];
    $bin = @inet_pton($ip);
    if ($bin === false || !is_file($file) || ($fh = @fopen($file, 'rb')) === false) return $cache[$key] = null;
    $cc = null;
    try {
        $head = fread($fh, 12);
        if (strlen($head) < 12 || substr($head, 0, 4) !== GEOIP_MAGIC) return $cache[$key] = null;
        [, $n4, $n6] = unpack('N2', substr($head, 4));
        if (strlen($bin) === 4) { $n = $n4; $rec = 6; $base = 12; $needle = $bin; $klen = 4; }
        else { $n = $n6; $rec = 10; $base = 12 + $n4 * 6; $needle = substr($bin, 0, 8); $klen = 8; }
        $lo = 0; $hi = $n - 1; $found = -1;
        while ($lo <= $hi) {                                   // the last record whose start <= the address
            $mid = ($lo + $hi) >> 1;
            fseek($fh, $base + $mid * $rec);
            $r = fread($fh, $rec);
            if (strcmp(substr($r, 0, $klen), $needle) <= 0) { $found = $mid; $lo = $mid + 1; } else { $hi = $mid - 1; }
        }
        if ($found >= 0) {
            fseek($fh, $base + $found * $rec + $klen);
            $code = fread($fh, 2);
            $cc = ($code !== false && preg_match('/^[A-Z]{2}$/', $code) && $code !== 'ZZ') ? $code : null;
        }
    } finally { fclose($fh); }
    return $cache[$key] = $cc;
}

/** The address one step after the end of a range, for gap detection. 4 bytes (IPv4) or 8 bytes (top half of IPv6). */
function geoipNext(string $b): string {
    for ($i = strlen($b) - 1; $i >= 0; $i--) {
        $v = ord($b[$i]) + 1;
        if ($v <= 255) { $b[$i] = chr($v); return $b; }
        $b[$i] = "\0";
    }
    return $b;                                                 // wrapped: end of the space
}

/**
 * Builds the binary file from the DB-IP CSV (start,end,country per line; IPv4 lines first, IPv6 after). Streaming: memory stays small.
 * Returns [n4, n6]. Writes to $out atomically (temp file then rename).
 */
function geoipBuild(string $csvGz, string $out, int $minIpv4 = 1000): array {
    $in = gzopen($csvGz, 'rb');
    if (!$in) throw new RuntimeException('cannot open the CSV');
    $tmp = $out . '.tmp';
    $w = fopen($tmp, 'wb');
    fwrite($w, GEOIP_MAGIC . pack('N2', 0, 0));
    $n = ['4' => 0, '6' => 0];
    $pos = ['4' => "\0\0\0\0", '6' => "\0\0\0\0\0\0\0\0"];
    $last = ['4' => null, '6' => null];
    $emit = function (string $fam, string $start, string $cc) use ($w, &$n, &$last) {
        if ($last[$fam] === $cc) return;                       // same country as the record before: no new record
        fwrite($w, $start . $cc); $n[$fam]++; $last[$fam] = $cc;
    };
    $switched = false;
    while (($line = gzgets($in)) !== false) {
        $c = explode(',', trim($line));
        if (count($c) < 3 || !preg_match('/^[A-Z]{2}$/', $c[2])) continue;
        $a = @inet_pton($c[0]); $b = @inet_pton($c[1]);
        if ($a === false || $b === false || strlen($a) !== strlen($b)) continue;
        $fam = strlen($a) === 4 ? '4' : '6';
        if ($fam === '6' && !$switched) { $switched = true; }
        if ($fam === '4' && $switched) continue;               // the file is sorted: IPv4 first
        $len = $fam === '4' ? 4 : 8;
        $s = substr($a, 0, $len); $e = substr($b, 0, $len);
        if (strcmp($s, $pos[$fam]) > 0) $emit($fam, $pos[$fam], 'ZZ');   // a hole nobody owns
        $emit($fam, $s, $c[2]);
        $pos[$fam] = geoipNext($e);
    }
    gzclose($in);
    // the records were written IPv4 then IPv6 in the order read: patch the header with the counts
    fseek($w, 4); fwrite($w, pack('N2', $n['4'], $n['6']));
    fclose($w);
    if ($n['4'] < $minIpv4) { @unlink($tmp); throw new RuntimeException('the CSV looks too small to be the country database'); }
    rename($tmp, $out);
    return [$n['4'], $n['6']];
}

/** Downloads the current (or previous) month's file and rebuilds the database. Returns true on success. Never throws. */
function geoipRefresh(): bool {
    $out = geoipFile();
    $tmp = tempnam(sys_get_temp_dir(), 'vbgeo');
    try {
        foreach ([date('Y-m'), date('Y-m', strtotime('first day of last month'))] as $month) {
            $url = "https://download.db-ip.com/free/dbip-country-lite-$month.csv.gz";
            $ch = curl_init($url);
            $fh = fopen($tmp, 'wb');
            curl_setopt_array($ch, [CURLOPT_FILE => $fh, CURLOPT_TIMEOUT => 120, CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_SSL_VERIFYPEER => true, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS]);
            $ok = curl_exec($ch) !== false && (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE) === 200;
            curl_close($ch); fclose($fh);
            if ($ok && filesize($tmp) > 100000) { geoipBuild($tmp, $out); return true; }
        }
    } catch (Throwable $e) {
        require_once __DIR__ . '/debug_logger.php';
        logSystemError('GEOIP', get_class($e) . ': ' . $e->getMessage());
    } finally { @unlink($tmp); }
    return false;
}

/** Once a day at most, and only when the database is missing or older than GEOIP_MAX_AGE_DAYS: refresh it. Called by the retention job. */
function geoipRefreshIfDue(): void {
    $f = geoipFile();
    if (is_file($f) && filemtime($f) > time() - GEOIP_MAX_AGE_DAYS * 86400) return;
    $try = dirname($f) . '/geoip.try';
    if (is_file($try) && filemtime($try) > time() - 86400) return;
    @touch($try);
    geoipRefresh();
}
