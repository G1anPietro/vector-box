<?php
// public/includes/wiki-proxy.php — /wiki/...: relays the request to the Kiwix server (offline Wikipedia) that runs on this machine,
// reachable only on localhost. index.php calls wikiProxy() before its 404 handling.
// shortcut: PHP relays the traffic (one PHP worker per request) because nginx was not changed. When nginx gets
//   location /wiki/ { proxy_pass http://127.0.0.1:8081; }
// this file and its hook in index.php can be deleted; better still, host it on its own subdomain: Wikipedia's HTML is not ours
// and here it shares the origin (and so the cookies) of the site.
require_once __DIR__ . '/../api/helpers.php';
require_once __DIR__ . '/../api/rate_limiter.php';

const WIKI_MAX_PARALLEL = 6;   // of the 20 PHP-FPM workers: the site must stay usable even if someone hammers /wiki/

function wikiPlain(int $status, string $text, array $headers = []): never {
    http_response_code($status);
    header('Content-Type: text/plain; charset=UTF-8');
    header('Cache-Control: no-store');
    header('X-Robots-Tag: noindex, nofollow');
    foreach ($headers as $h) header($h);
    exit($text . "\n");
}

function wikiProxy(string $path): never {
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($method !== 'GET' && $method !== 'HEAD') wikiPlain(405, 'Method not allowed.', ['Allow: GET, HEAD']);
    if ($path === '/wiki') { header('Location: /wiki/', true, 301); exit; }
    $decoded = rawurldecode($path);
    if (!str_starts_with($path, '/wiki/') || preg_match('~(^|/)\.\.(/|$)|[\x00-\x1f\\\\]~', $decoded)) wikiPlain(400, 'Bad request.');

    $query = (string)($_SERVER['QUERY_STRING'] ?? '');
    if (strlen($query) > 2000) wikiPlain(414, 'Request too long.');
    if (!checkRateLimit('wiki', 600, 60, null, false, false)) wikiPlain(429, 'Too many requests.', ['Retry-After: 60']);

    // at most WIKI_MAX_PARALLEL relays at once: one lock file per slot, released when the script ends
    $slot = null;
    for ($i = 0; $i < WIKI_MAX_PARALLEL && !$slot; $i++) {
        $f = @fopen(sys_get_temp_dir() . "/vb-wiki-slot-$i.lock", 'c');
        if ($f && flock($f, LOCK_EX | LOCK_NB)) $slot = $f;
        elseif ($f) fclose($f);
    }
    if (!$slot) wikiPlain(503, 'Busy, try again in a moment. / Occupato, riprova tra poco.', ['Retry-After: 5']);

    $base = rtrim((string)envValue('WIKI_UPSTREAM', 'http://127.0.0.1:8081'), '/');
    $url = $base . $path . ($query !== '' ? '?' . $query : '');

    $out = [];          // headers to pass on, collected while curl reads the upstream's
    $status = 502;
    $started = false;
    $send = function () use (&$out, &$status, &$started) {
        if ($started) return;
        $started = true;
        http_response_code($status);
        foreach ($out as $h) header($h);
        header('X-Robots-Tag: noindex, nofollow');
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: same-origin');
        if (!preg_grep('/^Cache-Control:/i', $out)) header('Cache-Control: public, max-age=3600');
    };

    $req = [];
    foreach (['Range' => 'HTTP_RANGE', 'If-None-Match' => 'HTTP_IF_NONE_MATCH', 'If-Modified-Since' => 'HTTP_IF_MODIFIED_SINCE'] as $name => $key)
        if (!empty($_SERVER[$key])) $req[] = $name . ': ' . substr(preg_replace('/[\r\n]/', '', (string)$_SERVER[$key]), 0, 200);   // never cookies or credentials

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_HTTPHEADER => $req, CURLOPT_NOBODY => $method === 'HEAD', CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 2, CURLOPT_TIMEOUT => 60, CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
        CURLOPT_HEADERFUNCTION => function ($c, $line) use (&$out, &$status) {
            if (preg_match('~^HTTP/\S+ (\d{3})~', $line, $m)) { $status = (int)$m[1]; $out = []; }
            elseif (preg_match('~^(Content-Type|Content-Length|Content-Range|Accept-Ranges|ETag|Last-Modified|Cache-Control|Location|Content-Language):~i', $line))
                $out[] = trim($line);   // a list to pass on: Set-Cookie and the rest are dropped
            return strlen($line);
        },
        CURLOPT_WRITEFUNCTION => function ($c, $data) use ($send) { $send(); echo $data; flush(); return strlen($data); },
    ]);
    $ok = curl_exec($ch);
    curl_close($ch);
    if (!$started) {
        if ($ok === false) wikiPlain(503, "Wikipedia is not available right now. Try again later.\nWikipedia non è disponibile in questo momento. Riprova più tardi.", ['Retry-After: 600']);
        $send();   // an answer with no body (304, HEAD, redirect)
    }
    exit;
}
