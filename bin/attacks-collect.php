<?php
// bin/attacks-collect.php — cron (every 10 minutes) as the owner's user (member of group adm, so it may read the system logs):
//   */10 * * * * php /var/www/vector-box/bin/attacks-collect.php
// Writes data/attacks.json, which the admin's stats page shows. The web server never reads the logs itself.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/../public/api/attacks.php';

function collectLines(string $cmd): array {
    $out = shell_exec($cmd . ' 2>/dev/null');
    return $out ? explode("\n", $out) : [];
}
$since = '--since "' . ATTACK_DAYS . ' days ago" -o short-iso --no-pager';
$ssh = collectLines("journalctl _COMM=sshd-session $since");
$ssh = array_merge($ssh, collectLines("journalctl _COMM=sshd $since"));
$ban = collectLines("journalctl -u fail2ban $since");
$web = [];
$log = getenv('NGINX_ACCESS_LOG') ?: '/var/log/nginx/access.log';
if (is_readable($log)) {                           // the last ~40000 lines are plenty for a week of this site
    $web = explode("\n", (string)shell_exec('tail -n 40000 ' . escapeshellarg($log)));
}
$prev = attacksRead();
$d = attacksBuild($ssh, $web, $ban);
$d['speed'] = attacksSpeed($web, time());
$tmp = attacksFile() . '.tmp';
$json = json_encode($d, JSON_INVALID_UTF8_SUBSTITUTE);   // a user name cut in the middle of a character must not turn the whole file into 0 bytes
if ($json === false || file_put_contents($tmp, $json, LOCK_EX) === false || !rename($tmp, attacksFile())) { fwrite(STDERR, "cannot write " . attacksFile() . "\n"); exit(1); }
@chgrp(attacksFile(), 'www-data');   // the web server (group www-data) reads it; the owner's user is a member of that group
@chmod(attacksFile(), 0660);
$push = attacksAlerts($prev, $d);
// Daily digest + disk alert; state in data/digest.state (small JSON, atomic write). The state is written BEFORE anything is pushed:
// if it cannot be written, nothing is sent, so a full disk can never turn into a push every 10 minutes.
$stFile = dirname(attacksFile()) . '/digest.state';
$st = json_decode((string)@file_get_contents($stFile), true); $st = is_array($st) ? $st : null;
$now = time(); $today = date('Y-m-d', $now); $dirty = false;
$disk = attacksDiskPct(dirname(attacksFile()));
if ($disk < 15 && ($st['disk_alert_date'] ?? '') !== $today) {
    $push[] = ['Disk space low', "Free space of the data disk: $disk%"];
    $st['disk_alert_date'] = $today; $dirty = true;
}
if (attacksShouldDigest($st, $now)) {
    $errLog = dirname(attacksFile()) . '/system_errors.log';
    // the first digest has nothing to compare with: start counting from now instead of reporting the whole history as new
    [$errs, $off] = isset($st['err_offset']) ? attacksNewErrors($errLog, (int)$st['err_offset']) : [0, (int)@filesize($errLog)];
    if ($m = attacksDigest($d, $errs, $disk, $now)) $push[] = $m;
    $st['digest_date'] = $today; $st['err_offset'] = $off; $dirty = true;
}
$stateOk = !$dirty || (file_put_contents($stFile . '.tmp', json_encode($st), LOCK_EX) !== false && rename($stFile . '.tmp', $stFile));
if ($stateOk) foreach ($push as [$t, $m]) attacksNotify($t, $m);   // after the files are written: a slow phone service never loses the summary
else fwrite(STDERR, "cannot write $stFile: no push sent\n");
echo "ssh {$d['ssh']['total']}  web {$d['web']['total']}  bans {$d['bans']['total']}\n";
