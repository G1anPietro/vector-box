<?php
// bin/appunti-ai.php — the class-notes AI worker. Run it every 5 minutes (systemd timer or cron) as the web user:
//   sudo -u www-data php /var/www/vector-box/bin/appunti-ai.php
// It sends the test reminders (2 days, 1 day and the evening before), transcribes new photos/PDFs and writes the
// study documents of the classes whose time has come.
// Options: --models  lists the models the key can use (to pick GEMINI_MODEL_FAST / GEMINI_MODEL_SMART).
//          --now=UNIX  pretend it is that moment (tests of the reminder times).
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }

require_once __DIR__ . '/../public/api/database.php';
require_once __DIR__ . '/../public/api/appunti_ai.php';
require_once __DIR__ . '/../public/api/notifiche_lib.php';

$now = time();
foreach ($argv as $arg) {
    if (preg_match('/^--now=(\d+)$/', $arg, $m)) $now = (int)$m[1];
}

if (in_array('--models', $argv, true)) {
    $key = (string)envValue('GEMINI_API_KEY', '');
    $auth = strtolower((string)envValue('GEMINI_AUTH', 'header')) === 'bearer' ? 'Authorization: Bearer ' : 'x-goog-api-key: ';
    $ch = curl_init(rtrim((string)envValue('GEMINI_BASE_URL', GEMINI_DEFAULT_BASE), '/') . '/models?pageSize=200');
    curl_setopt_array($ch, [CURLOPT_HTTPHEADER => [$auth . $key], CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30]);
    $json = json_decode((string)curl_exec($ch), true);
    foreach (($json['models'] ?? []) as $m) {
        if (in_array('generateContent', $m['supportedGenerationMethods'] ?? [], true)) {
            echo str_replace('models/', '', $m['name']) . "\t" . ($m['displayName'] ?? '') . "\n";
        }
    }
    exit(isset($json['models']) ? 0 : 1);
}

// One worker at a time: a long run must not overlap the next timer tick
$lock = fopen(dirname(__DIR__) . '/data/appunti-ai.lock', 'c');
if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) { echo "another run is in progress\n"; exit(0); }

try {
    $db = getDbConnection();
    // Test reminders first: they need no AI and must not wait behind a long AI run
    $reminders = remindersRun($db, $now);
    if ($reminders) aiLog("reminders sent: $reminders");
    if (!geminiConfigured()) { echo "GEMINI_API_KEY is not set: nothing to do\n"; exit(0); }
    $stats = aiRun($db, $now);
    if ($stats['transcribed'] || $stats['lessons'] || $stats['tests'] || $stats['classes']) {
        aiLog("transcribed {$stats['transcribed']}, lesson docs {$stats['lessons']}, test docs {$stats['tests']}, classes {$stats['classes']}");
    }
    // Exit code for systemd and the ntfy check: 1 = a real fault (Gemini unreachable, key refused, wrong model name,
    // database error); 0 = done, nothing to do, or only the daily quota reached (not a fault)
    if (GeminiError::$serviceFailures > 0) {
        fwrite(STDERR, 'error: Gemini failed ' . GeminiError::$serviceFailures . " time(s) in this run, see the lines above\n");
        $exit = 1;
    }
} catch (Throwable $e) {
    require_once __DIR__ . '/../public/api/debug_logger.php';
    logSystemError('NOTES_AI', $e->getMessage());
    fwrite(STDERR, 'error: ' . $e->getMessage() . "\n");
    exit(1);
} finally {
    flock($lock, LOCK_UN);
}
exit($exit ?? 0);
