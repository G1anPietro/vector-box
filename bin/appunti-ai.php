<?php
// bin/appunti-ai.php — the class-notes AI worker. Run it every 5 minutes (systemd timer or cron) as the web user:
//   sudo -u www-data php /var/www/vector-box/bin/appunti-ai.php
// It transcribes new photos/PDFs and writes the lesson documents of the classes whose time has come.
// Options: --models  lists the models the key can use (to pick GEMINI_MODEL_FAST / GEMINI_MODEL_SMART).
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }

require_once __DIR__ . '/../public/api/database.php';
require_once __DIR__ . '/../public/api/appunti_ai.php';

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

if (!geminiConfigured()) { echo "GEMINI_API_KEY is not set: nothing to do\n"; exit(0); }

// One worker at a time: a long run must not overlap the next timer tick
$lock = fopen(dirname(__DIR__) . '/data/appunti-ai.lock', 'c');
if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) { echo "another run is in progress\n"; exit(0); }

try {
    $stats = aiRun(getDbConnection(), time());
    if ($stats['transcribed'] || $stats['lessons'] || $stats['classes']) {
        aiLog("transcribed {$stats['transcribed']}, lesson docs {$stats['lessons']}, classes {$stats['classes']}");
    }
} catch (Throwable $e) {
    require_once __DIR__ . '/../public/api/debug_logger.php';
    logSystemError('NOTES_AI', $e->getMessage());
    fwrite(STDERR, 'error: ' . $e->getMessage() . "\n");
    exit(1);
} finally {
    flock($lock, LOCK_UN);
}
