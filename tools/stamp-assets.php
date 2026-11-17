<?php
// tools/stamp-assets.php — gives every local css/js file of the static pages (public/*.html, public/pages/*.html) a ?v= made from a hash of ITS CONTENT.
//   php tools/stamp-assets.php            rewrite the pages (run it after editing any css/js a static page loads, before committing)
//   php tools/stamp-assets.php --check    exit 1 if a page is out of date (npm test runs this)
// Why: nginx keeps a file for a year only when ?v= is a long number (10 digits, see the map in docs/DEPLOY.md). Hand-written ?v=3 made the
// browser ask "did it change?" for every file on every visit (15 requests for the dungeon). The number is 10 digits, "1" + a hash, so it
// is the same on every machine, and it changes exactly when the file changes.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$check = in_array('--check', $argv, true);
$root = realpath(__DIR__ . '/../public');
$stale = [];
foreach (array_merge(glob("$root/*.html"), glob("$root/pages/*.html")) as $page) {
    $html = file_get_contents($page);
    $new = preg_replace_callback('~(<(?:script|link)\b[^>]*?\b(?:src|href)=")((?:\.\./|\./)?[^":?#]+\.(?:js|css))(\?v=[^"]*)?(")~', function ($m) use ($page, $root) {
        $file = realpath(dirname($page) . '/' . $m[2]);
        if ($file === false || !str_starts_with($file, $root . '/') || preg_match('~^https?:~', $m[2])) return $m[0];   // not a local file: untouched
        $stamp = '1' . str_pad((string)(crc32(file_get_contents($file)) % 1000000000), 9, '0', STR_PAD_LEFT);
        return $m[1] . $m[2] . '?v=' . $stamp . $m[4];
    }, $html);
    if ($new !== $html) {
        $stale[] = substr($page, strlen($root) + 1);
        if (!$check) file_put_contents($page, $new);
    }
}
if ($check) {
    if ($stale) { fwrite(STDERR, "out of date (run: php tools/stamp-assets.php): " . implode(', ', $stale) . "\n"); exit(1); }
    echo "assets stamps ok\n"; exit(0);
}
echo count($stale) ? 'updated: ' . implode(', ', $stale) . "\n" : "nothing to do\n";
