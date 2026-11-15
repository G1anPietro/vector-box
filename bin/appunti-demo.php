<?php
// bin/appunti-demo.php — writes (or rewrites) the example class of the class notes: fake timetable, notes, documents, tests.
//   php bin/appunti-demo.php          writes it when missing and refreshes the dates once a day
//   php bin/appunti-demo.php --force  rewrites it now
// The worker (bin/appunti-ai.php) does the same every run, so normally there is nothing to do by hand.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/../public/api/database.php';
require_once __DIR__ . '/../public/api/appunti_demo.php';
$wrote = demoEnsure(getDbConnection(), in_array('--force', $argv, true));
echo $wrote ? "example class written\n" : "example class already up to date\n";
