<?php
// tools/news.php — put work on the site's news board from the command line.
//   php tools/news.php slug --title "EN | IT" --status doing --progress 30 --kind feature --body "EN | IT" --note "EN | IT" --version v2.4.130
//   add --remote to send it to the live site (NEWS_URL, NEWS_TOKEN)
//   php tools/news.php slug --done                 (status done, 100%)       php tools/news.php --list
// Text options take "English | Italiano" (one language alone is used for both).
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/../public/api/news_lib.php';
$a = array_slice($argv, 1);
// --remote: send to the live site instead of the local database (NEWS_URL e.g. https://host/api/news.php, NEWS_TOKEN in the environment or .env)
$remote = false;
if (($k = array_search('--remote', $a, true)) !== false) { $remote = true; array_splice($a, $k, 1); }
$db = $remote ? null : getDbConnection();
if (($a[0] ?? '') === '--list') {
    foreach (newsBoard($db) as $i) printf("%-8s %-28s %3s%%  %s\n", $i['status'], $i['slug'], $i['progress'] ?? '-', $i['title']['en']);
    exit(0);
}
$slug = array_shift($a);
$f = [];
for ($i = 0; $i < count($a); $i++) {
    $k = ltrim($a[$i], '-');
    if ($k === 'done') { $f['status'] = 'done'; continue; }
    $v = $a[++$i] ?? '';
    if (in_array($k, ['title', 'body', 'note'], true)) {
        [$en, $it] = array_pad(array_map('trim', explode('|', $v, 2)), 2, '');
        $f[$k . '_en'] = $en !== '' ? $en : $it;
        $f[$k . '_it'] = $it !== '' ? $it : $en;
    } else $f[$k] = $v;
}
if ($remote) {
    $url = (string)(getenv('NEWS_URL') ?: envValue('NEWS_URL', ''));
    $tok = (string)(getenv('NEWS_TOKEN') ?: envValue('NEWS_TOKEN', ''));
    if (!str_starts_with($url, 'https://') || $tok === '') { fwrite(STDERR, "set NEWS_URL (https) and NEWS_TOKEN\n"); exit(1); }
    $ctx = stream_context_create(['http' => ['method' => 'POST', 'timeout' => 15, 'ignore_errors' => true,
        'header' => "Content-Type: application/json\r\nX-News-Token: $tok\r\n", 'content' => json_encode(['slug' => $slug] + $f)]]);
    $res = @file_get_contents($url, false, $ctx);
    echo ($res === false ? 'failed' : $res) . "\n";
    exit($res !== false && str_contains($res, '"success":true') ? 0 : 1);
}
try { echo 'ok: ' . newsSave($db, (string)$slug, $f) . "\n"; }
catch (Throwable $e) { fwrite(STDERR, $e->getMessage() . "\n"); exit(1); }
