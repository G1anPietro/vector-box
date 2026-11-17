<?php
// tools/totp-reset.php — switch off the two-step login of an account that lost its phone AND its backup codes.
//   sudo -u www-data php tools/totp-reset.php <username>
// Run it as www-data (the owner of the database), never as another user: a second user opening the SQLite file leaves side files that break the site.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/../public/api/database.php';
$name = (string)($argv[1] ?? '');
if ($name === '') { fwrite(STDERR, "usage: totp-reset.php <username>\n"); exit(1); }
$db = getDbConnection();
$st = $db->prepare("UPDATE accounts SET totp_enabled = 0, totp_secret = '', totp_last_step = 0, totp_backup = '' WHERE LOWER(username) = LOWER(:u)");
$st->execute([':u' => $name]);
echo $st->rowCount() ? "two-step login switched off for $name\n" : "no such account\n";
exit($st->rowCount() ? 0 : 1);
