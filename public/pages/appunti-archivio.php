<?php
// public/pages/appunti-archivio.php — the class material as folders (subject -> lesson day -> files), with a preview:
// columns on a computer (each scrolls on its own, the page does not), one folder at a time on a phone.
// Data from api/appunti.php (tree, items, docs, file_text); rendered by js/appunti-archivio.js.
require_once __DIR__ . '/../includes/head.php';
require_once __DIR__ . '/../includes/appunti-top.php';
require_once __DIR__ . '/../api/database.php';

initSession();
$e = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES);
$v = filemtime(__DIR__ . '/../js/appunti-archivio.js') . '-' . filemtime(__DIR__ . '/../js/appunti-common.js') . '-' . filemtime(__DIR__ . '/../js/appunti-pdf.js') . '-' . filemtime(__DIR__ . '/../css/appunti.css') . '-' . filemtime(__DIR__ . '/../js/dropzone.js') . '-' . filemtime(__DIR__ . '/../js/appunti-upload.js') . '-' . filemtime(__DIR__ . '/../css/dropzone.css');
$v .= '-' . filemtime(__DIR__ . '/../js/csrf.js');   // the cache buster covers csrf.js too (the files are cached for a year)
$v .= '-' . filemtime(__DIR__ . '/../js/i18n.js') . '-' . filemtime(__DIR__ . '/../js/i18n/appunti-en.js') . '-' . filemtime(__DIR__ . '/../js/i18n/appunti-it.js');   // the translations are inside the cache buster too
?>
<!DOCTYPE html>
<html lang="<?= pageLang() ?>" data-lang-server>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#14161b">
    <meta name="robots" content="noindex">
    <title><?= tr(['en' => 'Archive — Class notes', 'it' => 'Archivio — Appunti di classe']) ?></title>
    <link rel="stylesheet" href="../css/appunti.css?v=<?= $e($v) ?>">
    <link rel="stylesheet" href="../css/dropzone.css?v=<?= $e($v) ?>">
    <link rel="manifest" href="../assets/appunti/manifest.json?v=1">
    <link rel="icon" href="../assets/appunti/icon.svg?v=1" type="image/svg+xml">
    <script src="../js/i18n.js?v=<?= $e($v) ?>"></script>
    <script src="../js/i18n/appunti-en.js?v=<?= $e($v) ?>"></script>
    <script src="../js/i18n/appunti-it.js?v=<?= $e($v) ?>"></script>
    <script src="../js/csrf.js?v=<?= $e($v) ?>"></script>
    <script src="../js/appunti-common.js?v=<?= $e($v) ?>" defer></script>
    <script src="../js/dropzone.js?v=<?= $e($v) ?>" defer></script>
    <script src="../js/appunti-upload.js?v=<?= $e($v) ?>" defer></script>
    <script src="../js/appunti-pdf.js?v=<?= $e($v) ?>" defer></script>
    <script src="../js/appunti-archivio.js?v=<?= $e($v) ?>" defer></script>
</head>
<body class="archive">
    <?php appuntiTop('archivio'); ?>
    <div class="page-tools"><select id="class-select" aria-label="<?= $e(tr(['en' => 'Class', 'it' => 'Classe'])) ?>" hidden></select></div>
    <div class="arch-bar">
        <button type="button" id="back-btn" class="ghost mini back-btn" hidden><?= tr(['en' => 'Back', 'it' => 'Indietro']) ?></button>
        <nav class="arch-crumbs" id="crumbs" aria-label="<?= $e(tr(['en' => 'Path', 'it' => 'Percorso'])) ?>"></nav>
        <button type="button" id="view-btn" class="ghost mini view-btn" aria-label="<?= $e(tr(['en' => 'Change view', 'it' => 'Cambia vista'])) ?>"><?= tr(['en' => 'List', 'it' => 'Elenco']) ?></button>
    </div>

    <form class="arch-search" id="search-form" role="search">
        <input type="search" id="search-input" placeholder="<?= $e(tr(['en' => 'Search in the notes, files and documents', 'it' => 'Cerca negli appunti, nei file e nei documenti'])) ?>" aria-label="<?= $e(tr(['en' => 'Search', 'it' => 'Cerca'])) ?>" maxlength="80" autocomplete="off">
        <button class="ghost mini" type="submit"><?= tr(['en' => 'Search', 'it' => 'Cerca']) ?></button>
    </form>
    <section class="search-results" id="search-results" hidden aria-live="polite"></section>

    <main class="arch" id="arch" data-level="0">
        <section class="col" id="col-subjects" aria-label="<?= $e(tr(['en' => 'Subjects', 'it' => 'Materie'])) ?>"></section>
        <section class="col" id="col-folders" aria-label="<?= $e(tr(['en' => 'Folders', 'it' => 'Cartelle'])) ?>"></section>
        <section class="col" id="col-files" aria-label="<?= $e(tr(['en' => 'Files', 'it' => 'File'])) ?>"></section>
        <section class="pv" id="preview" aria-label="<?= $e(tr(['en' => 'Preview', 'it' => 'Anteprima'])) ?>">
            <p class="empty"><?= tr(['en' => 'Choose a subject, then a day: here you see the file without leaving the page.', 'it' => 'Scegli una materia, poi un giorno: qui vedi il file senza uscire dalla pagina.']) ?></p>
        </section>
    </main>
</body>
</html>
