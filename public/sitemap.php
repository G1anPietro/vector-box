<?php
// public/sitemap.php — list of the public pages for search engines (robots.txt points here).
// Private pages (library, CV, account) are left out on purpose.
require_once __DIR__ . '/api/helpers.php';
header('Content-Type: application/xml; charset=utf-8');
$base = siteUrl();
$pages = [
    ['/', 'weekly', '1.0'],
    ['/pages/giochi.php', 'weekly', '0.9'],
    ['/pages/spia.html', 'monthly', '0.8'],
    ['/pages/lupus.html', 'monthly', '0.8'],
    ['/pages/nonhomai.html', 'monthly', '0.8'],
    ['/pages/solitario.html', 'monthly', '0.8'],
    ['/pages/progetto.php', 'monthly', '0.6'],
    ['/pages/ads.php', 'monthly', '0.4'],
    ['/pages/privacy.php', 'yearly', '0.2'],
];
$root = __DIR__;
echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
echo '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";
foreach ($pages as [$path, $freq, $prio]) {
    $file = $root . ($path === '/' ? '/index.php' : $path);
    if (!is_file($file)) continue;
    printf("  <url><loc>%s</loc><lastmod>%s</lastmod><changefreq>%s</changefreq><priority>%s</priority></url>\n",
        htmlspecialchars($base . $path, ENT_XML1), date('Y-m-d', filemtime($file)), $freq, $prio);
}
echo "</urlset>\n";
