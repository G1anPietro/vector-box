<?php
// bin/appunti-whisper.php — transcribes the class notes' audio recordings with Whisper on this server
// (tools/whisper-transcribe.py), with no size limit and no Gemini request. Run it by its own timer, as the web user:
//   sudo -u www-data php /var/www/vector-box/bin/appunti-whisper.php
// .env: WHISPER_CMD (the command; the audio path is appended), optional WHISPER_TIMEOUT (seconds, default 10800).
// One file per run, its own lock: a one-hour lesson can take a long time on an old CPU, and it must not block the
// reminders and summaries of bin/appunti-ai.php.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }

require_once __DIR__ . '/../public/api/database.php';
require_once __DIR__ . '/../public/api/appunti_lib.php';

$cmd = trim((string)envValue('WHISPER_CMD', ''));
if ($cmd === '') { echo "WHISPER_CMD is not set: nothing to do\n"; exit(0); }

$lock = fopen(dirname(__DIR__) . '/data/appunti-whisper.lock', 'c');
if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) { echo "another transcription is running\n"; exit(0); }

$db = getDbConnection();
// Waiting recordings, and those Gemini refused earlier because they were too big
$st = $db->query("SELECT f.* FROM class_item_files f JOIN school_classes c ON c.id = f.class_id AND c.status = 'active'
                  WHERE f.mime LIKE 'audio/%' AND f.text_attempts < 3
                    AND (f.text_status = 'pending' OR (f.text_status = 'failed' AND f.text LIKE '[file troppo grande%'))
                  ORDER BY f.id LIMIT 1");
$f = $st->fetch();
if (!$f) exit(0);

$path = notesDir((int)$f['class_id']) . '/' . basename($f['stored_name']);
$save = $db->prepare('UPDATE class_item_files SET text = :t, text_status = :s, text_attempts = text_attempts + 1 WHERE id = :id');
if (!is_file($path)) { $save->execute([':t' => null, ':s' => 'failed', ':id' => $f['id']]); exit(0); }

$timeout = max(60, (int)envValue('WHISPER_TIMEOUT', '10800'));
$started = time();
echo date('Y-m-d H:i:s') . " transcribing file {$f['id']} ({$f['original_name']}, " . round(filesize($path) / 1048576, 1) . " MB)\n";
// The settings in .env reach the script as environment variables (they are not exported by PHP otherwise)
$env = getenv();
foreach (['WHISPER_MODEL', 'WHISPER_LANGUAGE', 'WHISPER_THREADS', 'WHISPER_MODELS_DIR'] as $k) {
    $v = trim((string)envValue($k, ''));
    if ($v !== '') $env[$k] = $v;
}
if (!empty($env['WHISPER_MODELS_DIR'])) $env['HF_HOME'] = $env['WHISPER_MODELS_DIR'];   // the download cache too
$proc = proc_open($cmd . ' ' . escapeshellarg($path), [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, $env);
if (!is_resource($proc)) { fwrite(STDERR, "cannot start WHISPER_CMD\n"); exit(1); }
stream_set_blocking($pipes[1], false);
stream_set_blocking($pipes[2], false);
$out = '';
$err = '';
while (true) {
    $out .= (string)stream_get_contents($pipes[1]);
    $err .= (string)stream_get_contents($pipes[2]);
    $status = proc_get_status($proc);
    if (!$status['running']) break;
    if (time() - $started > $timeout) { proc_terminate($proc, 9); $status = ['exitcode' => -1]; break; }
    usleep(500000);
}
$out .= (string)stream_get_contents($pipes[1]);
$err .= (string)stream_get_contents($pipes[2]);
fclose($pipes[1]);
fclose($pipes[2]);
$code = $status['exitcode'] ?? proc_close($proc);

$text = trim($out);
if ($code === 0 && $text !== '') {
    $text = textCut($text, NOTE_TEXT_MAX);
    $save->execute([':t' => $text, ':s' => 'done', ':id' => $f['id']]);
    echo date('Y-m-d H:i:s') . " done in " . (time() - $started) . " s, " . strlen($text) . " characters\n";
    exit(0);
}
// A failure: try again at the next run, three times at most
$attempts = (int)$f['text_attempts'] + 1;
$save->execute([':t' => $attempts >= 3 ? '[trascrizione non riuscita]' : $f['text'], ':s' => $attempts >= 3 ? 'failed' : $f['text_status'], ':id' => $f['id']]);
fwrite(STDERR, "whisper failed (exit $code" . ($code === -1 ? ', timeout' : '') . "): " . textCut(trim($err), 500) . "\n");
exit(1);
