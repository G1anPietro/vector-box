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
$d = attacksBuild($ssh, $web, $ban);
$tmp = attacksFile() . '.tmp';
if (file_put_contents($tmp, json_encode($d), LOCK_EX) === false || !rename($tmp, attacksFile())) { fwrite(STDERR, "cannot write " . attacksFile() . "\n"); exit(1); }
@chgrp(attacksFile(), 'www-data');   // the web server (group www-data) reads it; the owner's user is a member of that group
@chmod(attacksFile(), 0660);
echo "ssh {$d['ssh']['total']}  web {$d['web']['total']}  bans {$d['bans']['total']}\n";
