<?php
// tools/geoip-update.php — builds data/geoip-country.bin now (normally the daily retention job does it by itself, monthly).
//   php tools/geoip-update.php                 download the current DB-IP Lite country file and build the database
//   php tools/geoip-update.php file.csv.gz     build from a file you already have
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/../public/api/geoip.php';
if (isset($argv[1])) {
    [$a, $b] = geoipBuild($argv[1], geoipFile());
    echo "built: $a IPv4 and $b IPv6 ranges -> " . geoipFile() . "\n";
} else {
    $ok = geoipRefresh();
    echo $ok ? "built " . geoipFile() . " (" . round(filesize(geoipFile()) / 1e6, 1) . " MB)\n" : "download or build failed (see data/system_errors.log)\n";
    exit($ok ? 0 : 1);
}
