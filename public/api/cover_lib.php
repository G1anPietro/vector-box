<?php
// public/api/cover_lib.php — small copies of book covers (used by books.php and tools/cover-thumbs.php).

/** A small JPEG of a cover (360 px wide) made with ffmpeg (no shell: the arguments go in as a list) and kept in data/covers/thumb/.
 *  Returns null when the picture is already small or ffmpeg is not there or fails: the caller then serves the original.
 *  shortcut: ffmpeg is the only image tool on the server (no GD); if php-gd is ever installed, resize with it and drop the process. */
function coverThumb(string $src): ?string {
    if ((int)@filesize($src) < 60000 || @getimagesize($src) === false) return null;   // only real pictures reach ffmpeg (it would sniff the content, not the extension)
    $dir = dirname($src) . '/thumb';
    $dest = $dir . '/' . basename($src) . '.jpg';
    if (is_file($dest) && filemtime($dest) >= filemtime($src)) return $dest;
    $ff = null;
    foreach (['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'] as $c) if (is_executable($c)) { $ff = $c; break; }
    if ($ff === null || !function_exists('proc_open') || (!is_dir($dir) && !@mkdir($dir, 0770, true))) return null;
    $tmp = $dest . '.' . bin2hex(random_bytes(4)) . '.jpg';
    $p = @proc_open([$ff, '-v', 'error', '-y', '-f', 'image2', '-protocol_whitelist', 'file', '-i', $src, '-vf', "scale='min(360,iw)':-2", '-frames:v', '1', '-q:v', '5', $tmp],
                    [0 => ['file', '/dev/null', 'r'], 1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes);
    if (!is_resource($p)) return null;
    for ($i = 0; $i < 80 && proc_get_status($p)['running']; $i++) usleep(100000);   // at most 8 s
    if (proc_get_status($p)['running']) proc_terminate($p, 9);
    proc_close($p);
    if (!is_file($tmp) || filesize($tmp) < 500 || !@rename($tmp, $dest)) { @unlink($tmp); return null; }
    return $dest;
}
