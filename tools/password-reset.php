<?php
// tools/password-reset.php — set a new password for an account (a person who lost it and has no confirmed e-mail, or an admin).
//   sudo -u www-data php tools/password-reset.php <username> [new-password]     (without the password it is asked on the terminal)
// Run it as www-data (the owner of the database), never as another user: a second user opening the SQLite file leaves side files that break the site.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/../public/api/database.php';
require_once __DIR__ . '/../public/api/helpers.php';
$name = (string)($argv[1] ?? '');
if ($name === '') { fwrite(STDERR, "usage: password-reset.php <username> [new-password]\n"); exit(1); }
$pw = $argv[2] ?? null;
if ($pw === null) { fwrite(STDERR, "New password: "); system('stty -echo 2>/dev/null'); $pw = rtrim((string)fgets(STDIN), "\r\n"); system('stty echo 2>/dev/null'); fwrite(STDERR, "\n"); }
if ($err = validateNewPassword($pw)) { fwrite(STDERR, "$err\n"); exit(1); }
$st = getDbConnection()->prepare('UPDATE accounts SET password_hash = :h WHERE LOWER(username) = LOWER(:u)');
$st->execute([':h' => password_hash($pw, PASSWORD_DEFAULT), ':u' => $name]);
echo $st->rowCount() ? "password changed for $name\n" : "no such account\n";
exit($st->rowCount() ? 0 : 1);
