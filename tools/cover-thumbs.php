<?php
// tools/cover-thumbs.php — makes the small copies of ALL book covers now (otherwise each one is made the first time somebody opens the shelf,
// one ffmpeg per cover). Safe to run again: covers that already have a current copy are skipped.
//   sudo -u www-data php tools/cover-thumbs.php        (as www-data, so the copies belong to the web server)
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/../public/api/cover_lib.php';
$dir = __DIR__ . '/../data/covers';
$made = $skipped = 0;
foreach (glob("$dir/*.{jpg,jpeg,png,gif,webp}", GLOB_BRACE) ?: [] as $f) {
    $before = is_file("$dir/thumb/" . basename($f) . '.jpg') && filemtime("$dir/thumb/" . basename($f) . '.jpg') >= filemtime($f);
    $t = coverThumb($f);
    if ($t !== null && !$before) $made++; else $skipped++;
}
echo "made $made, already there or not needed $skipped\n";
