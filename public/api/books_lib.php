<?php
// public/api/books_lib.php — small helpers of the library: tidy titles/authors, normalise labels.

/** Strips what download sites leave in a title: "(z-library.sk, 1lib.sk, z-lib.sk)", "123456_" prefixes, ".epub", "[PDF]", "(Author)" tails. */
function bookCleanTitle(string $title, ?string $author = null): string {
    $t = preg_replace('/\.(epub|pdf)$/i', '', trim($title)) ?? $title;
    $t = preg_replace('/^\d{6,}[_\s-]+/', '', $t) ?? $t;                                        // 1794062593_Title
    $t = preg_replace('/\s*[\(\[][^)\]]*\b(z-?lib(?:rary)?|1lib|b-ok|libgen|annas?-archive)[^)\]]*[\)\]]/i', '', $t) ?? $t;
    $t = preg_replace('/\s*\[[^\]]*\b(epub|pdf|ocr|ebook|e-book|mobi)\b[^\]]*\]/i', '', $t) ?? $t;
    if (!str_contains($t, ' ') && substr_count($t, '_') >= 2) $t = str_replace('_', ' ', $t);   // File_Name_Style
    $t = preg_replace('/\b(?:z-?lib(?:rary)?|1lib|b-ok|libgen)\b(?:[ .](?:sk|org|is|se|com|rs)\b)?/i', '', $t) ?? $t;   // site names left in a file-name style title
    $t = preg_replace('/\s+/', ' ', $t) ?? $t;
    $t = trim($t, " \t-–—_.,;");
    // "Title (Author Name)" or "Title - Author Name": the author is already in its own field
    if ($author !== null && $author !== '' && strcasecmp($author, 'Unknown') !== 0) {
        $a = preg_quote($author, '/');
        $t2 = preg_replace('/\s*[\(\[]\s*' . $a . '[^)\]]*[\)\]]\s*$/iu', '', $t) ?? $t;
        $t2 = preg_replace('/\s+[-–—]\s+' . $a . '\s*$/iu', '', $t2) ?? $t2;
        if (trim($t2) !== '') $t = trim($t2);
    }
    // a trailing unbalanced "(" from a cut-off author list: "La Lupa (Giovanni Verga David Lan [Verga etc."
    $t = preg_replace('/\s*\([^)]*$/u', '', $t) ?? $t;
    $t = trim($t, " \t-–—_.,;");
    return $t === '' ? trim($title) : $t;
}

/** Same for the author: no site names, tidy spaces. */
function bookCleanAuthor(string $author): string {
    $a = preg_replace('/\s*[\(\[][^)\]]*\b(z-?lib(?:rary)?|1lib|b-ok|libgen)[^)\]]*[\)\]]/i', '', $author) ?? $author;
    $a = trim(preg_replace('/\s+/', ' ', $a) ?? $a, " \t,;");
    return $a === '' ? 'Unknown' : $a;
}

/** Lower-case letters and digits only: two titles that differ by case or punctuation are the same book. */
function bookNormKey(string $s): string {
    $s = function_exists('mb_strtolower') ? mb_strtolower($s, 'UTF-8') : strtolower($s);
    return (string)preg_replace('/[^\p{L}\p{N}]+/u', '', $s);
}

/** Labels typed by the reader: up to 8, 1-30 characters each, no control characters, no duplicates (case-insensitive). */
function bookCleanTags($raw): array {
    if (is_string($raw)) $raw = explode(',', $raw);
    if (!is_array($raw)) return [];
    $out = [];
    foreach ($raw as $t) {
        $t = trim(preg_replace('/[\x00-\x1F\x7F]+/', ' ', (string)$t) ?? '');
        $t = trim(preg_replace('/\s+/', ' ', $t) ?? $t);
        if ($t === '') continue;
        $t = function_exists('mb_substr') ? mb_substr($t, 0, 30, 'UTF-8') : substr($t, 0, 30);
        $k = function_exists('mb_strtolower') ? mb_strtolower($t, 'UTF-8') : strtolower($t);
        if (!isset($out[$k])) $out[$k] = $t;   // the first spelling wins
    }
    return array_slice(array_values($out), 0, 8);
}
