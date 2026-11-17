<?php
// public/api/lang.php — which language should this visitor see? The same rules as pageLang() (explicit choice, Italy, browser, English),
// for the pages that are plain .html files and cannot ask PHP themselves (js/i18n.js calls this once). Reads no database and
// stores nothing: the country is looked up in the local file, and nothing about the visitor is logged.
//   GET ?lang=it|en (optional, the choice being made)  ->  {success, lang, source, languages}
require_once __DIR__ . '/helpers.php';

header('Content-Type: application/json');
header('Cache-Control: private, no-store');
[$lang, $source] = detectLang(
    $_GET['lang'] ?? null,
    $_COOKIE['vb_lang'] ?? null,
    (string)($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? ''),
    visitorCountry()
);
echo json_encode(['success' => true, 'lang' => $lang, 'source' => $source, 'languages' => SITE_LANGS]);
