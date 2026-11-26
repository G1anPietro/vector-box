<?php
// public/api/book_convert.php — MOBI, AZW3, FB2 and LIT books are converted to EPUB when they are uploaded,
// so the reader (highlights, search, text options, progress) works the same for every book.
// The conversion is done by Calibre's `ebook-convert` (EBOOK_CONVERT in .env, or the usual install paths).

const BOOK_CONVERT_EXT = ['mobi', 'azw3', 'fb2', 'lit'];

/** The real content must match the extension (the extension alone proves nothing). */
function bookConvertMagicOk(string $path, string $ext): bool {
    $fh = fopen($path, 'rb');
    if (!$fh) return false;
    $head = (string)fread($fh, 2048);
    fclose($fh);
    return match ($ext) {
        'mobi', 'azw3' => in_array(substr($head, 60, 8), ['BOOKMOBI', 'TEXtREAd'], true),
        'lit' => strncmp($head, 'ITOLITLS', 8) === 0,
        'fb2' => str_contains($head, '<FictionBook'),
        default => false,
    };
}

function bookConvertBinary(): ?string {
    $paths = array_filter([envValue('EBOOK_CONVERT'), '/usr/bin/ebook-convert', '/usr/local/bin/ebook-convert', '/opt/calibre/ebook-convert']);
    foreach ($paths as $p) if (is_file($p) && is_executable($p)) return $p;
    return null;
}

/**
 * Converts $src (extension $ext) into the EPUB $dest. Returns '' on success, otherwise an error code:
 * CONVERTER_MISSING (Calibre is not installed) or CONVERSION_FAILED (damaged file, DRM, or timeout).
 */
function bookConvertToEpub(string $src, string $ext, string $dest): string {
    $bin = bookConvertBinary();
    if ($bin === null) return 'CONVERTER_MISSING';
    $work = sys_get_temp_dir() . '/vb-convert-' . bin2hex(random_bytes(6));
    if (!mkdir($work, 0700)) return 'CONVERSION_FAILED';
    $in = "$work/in.$ext";
    $ok = copy($src, $in);   // ebook-convert decides the format by the extension; the upload has none
    $code = 1;
    if ($ok) {
        $p = proc_open(['timeout', '-k', '5', '150', $bin, $in, $dest], [0 => ['file', '/dev/null', 'r'], 1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']],
            $pipes, $work, ['HOME' => $work, 'PATH' => '/usr/local/bin:/usr/bin:/bin', 'QT_QPA_PLATFORM' => 'offscreen']);
        if (is_resource($p)) $code = proc_close($p);
    }
    // Calibre writes its settings into HOME (= $work): remove the whole folder
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($work, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST) as $f) {
        $f->isDir() && !$f->isLink() ? @rmdir($f->getPathname()) : @unlink($f->getPathname());
    }
    @rmdir($work);
    $fh = $code === 0 && is_file($dest) ? fopen($dest, 'rb') : false;
    $zip = $fh ? fread($fh, 4) === "PK\x03\x04" : false;
    if ($fh) fclose($fh);
    if (!$zip) { @unlink($dest); return 'CONVERSION_FAILED'; }
    return '';
}
