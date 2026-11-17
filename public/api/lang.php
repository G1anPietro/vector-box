<?php
// public/api/lang.php — which language should this visitor see? The same rules as pageLang() (explicit choice, Italy, browser, English),
// for the pages that are plain .html files and cannot ask PHP themselves (js/i18n.js calls this once). Reads no database and
// stores nothing: the country is looked up in the local file, and nothing about the visitor is logged.
//   GET ?lang=it|en (optional, the choice being made)  ->  {success, lang, source, languages}
require_once __DIR__ . '/helpers.php';

header('Content-Type: application/json');
// POST {lang}: a logged-in person picked a language: remember it on the account (e-mails and notifications follow it).
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/database.php';
    initSession();
    if (!empty($_SESSION['user_id'])) requireCsrf();   // a visitor without an account has nothing to save
    $l = strtolower((string)(readJsonBody()['lang'] ?? ''));
    if (!in_array($l, SITE_LANGS, true)) jsonResponse(['success' => false, 'error' => 'Unknown language'], 400);
    if (!empty($_SESSION['user_id'])) {
        try {
            getDbConnection()->prepare('UPDATE accounts SET lang = :l WHERE id = :id')->execute([':l' => $l, ':id' => (int)$_SESSION['user_id']]);
        } catch (Throwable $e) { failInternal('LANG', $e); }
    }
    jsonResponse(['success' => true, 'lang' => $l]);
}
header('Cache-Control: private, no-store');
[$lang, $source] = detectLang(
    $_GET['lang'] ?? null,
    $_COOKIE['vb_lang'] ?? null,
    (string)($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? ''),
    visitorCountry()
);
echo json_encode(['success' => true, 'lang' => $lang, 'source' => $source, 'languages' => SITE_LANGS]);
