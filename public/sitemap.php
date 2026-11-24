<?php
// public/sitemap.php — list of the public pages for search engines (robots.txt points here).
// Private pages (library, CV, account) are left out on purpose.
require_once __DIR__ . '/api/helpers.php';
header('Content-Type: application/xml; charset=utf-8');
$base = siteUrl();
$pages = [
    ['/', 'weekly', '1.0'],
    ['/pages/giochi.php', 'weekly', '0.9'],
    ['/pages/classifiche.php', 'weekly', '0.5'],
    ['/pages/spia.html', 'monthly', '0.8'],
    ['/pages/lupus.html', 'monthly', '0.8'],
    ['/pages/nonhomai.html', 'monthly', '0.8'],
    ['/pages/probabile.html', 'monthly', '0.8'],
    ['/pages/preferiresti.html', 'monthly', '0.8'],
    ['/pages/bomba.html', 'monthly', '0.8'],
    ['/pages/obbligo.html', 'monthly', '0.8'],
    ['/pages/solitario.html', 'monthly', '0.8'],
    ['/pages/cucu.html', 'monthly', '0.8'],
    ['/pages/minato.html', 'monthly', '0.7'],
    ['/pages/dueamila.html', 'monthly', '0.7'],
    ['/pages/memory.html', 'monthly', '0.7'],
    ['/pages/parola.html', 'monthly', '0.7'],
    ['/pages/tris.html', 'monthly', '0.7'],
    ['/pages/botola.html', 'monthly', '0.8'],
    ['/pages/skillcheck.html', 'monthly', '0.7'],
    ['/pages/snake.html', 'monthly', '0.7'],
    ['/pages/vita.html', 'monthly', '0.7'],
    ['/pages/difesa.html', 'monthly', '0.7'],
    ['/pages/forza4.html', 'monthly', '0.7'],
    ['/pages/tetris.html', 'monthly', '0.7'],
    ['/pages/dungeon.html', 'monthly', '0.7'],
    ['/pages/impiccato.html', 'monthly', '0.7'],
    ['/pages/simon.html', 'monthly', '0.7'],
    ['/pages/progetto.php', 'monthly', '0.6'],
    ['/pages/appunti-guida.php', 'monthly', '0.6'],
    ['/pages/ads.php', 'monthly', '0.4'],
    ['/pages/dona.php', 'monthly', '0.3'],
    ['/pages/soldi.php', 'monthly', '0.3'],
    ['/pages/privacy.php', 'yearly', '0.2'],
    ['/pages/sicurezza.php', 'yearly', '0.2'],
    ['/pages/come-funziona.php', 'monthly', '0.6'],
    ['/pages/wikipedia.php', 'yearly', '0.3'],
    ['/pages/novita.php', 'weekly', '0.3'],
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
