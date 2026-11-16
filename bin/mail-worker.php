<?php
// bin/mail-worker.php — sends what waits in the e-mail queue. Run every minute as the PHP user, e.g. cron:
//   * * * * * www-data php /var/www/vector-box/bin/mail-worker.php
// Does nothing (and says so) while MAIL_DRIVER is empty in .env.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/../public/api/mailer.php';

$r = mailProcessQueue(getDbConnection(), 50);
echo $r['off'] ? "MAIL_DRIVER is not set: nothing sent ({$r['left']} waiting).\n" : "sent {$r['sent']}, gave up {$r['failed']}, waiting {$r['left']}\n";
