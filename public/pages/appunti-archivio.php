<?php
// public/pages/appunti-archivio.php — the class material as folders (subject -> lesson day -> files), with a preview:
// columns on a computer (each scrolls on its own, the page does not), one folder at a time on a phone.
// Data from api/appunti.php (tree, items, docs, file_text); rendered by js/appunti-archivio.js.
require_once __DIR__ . '/../includes/head.php';
require_once __DIR__ . '/../api/database.php';

initSession();
if (empty($_SESSION['user_id'])) {
    header('Location: appunti-guida.php');
    exit();
}
$e = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES);
$v = filemtime(__DIR__ . '/../js/appunti-archivio.js') . '-' . filemtime(__DIR__ . '/../js/appunti-common.js') . '-' . filemtime(__DIR__ . '/../css/appunti.css');
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#14161b">
    <meta name="robots" content="noindex">
    <title>Archivio — Appunti di classe</title>
    <link rel="stylesheet" href="../css/appunti.css?v=<?= $e($v) ?>">
    <link rel="manifest" href="../assets/appunti/manifest.json?v=1">
    <link rel="icon" href="../assets/appunti/icon.svg?v=1" type="image/svg+xml">
    <script src="../js/csrf.js?v=<?= $e($v) ?>"></script>
    <script src="../js/appunti-common.js?v=<?= $e($v) ?>" defer></script>
    <script src="../js/appunti-archivio.js?v=<?= $e($v) ?>" defer></script>
</head>
<body class="archive">
    <header class="arch-top">
        <a class="home" href="appunti.php">← Appunti</a>
        <b class="arch-title">Archivio</b>
        <select id="class-select" aria-label="Classe"></select>
        <a class="ghost-link" href="appunti-carica.php">+ Carica</a>
    </header>
    <nav class="arch-crumbs" id="crumbs" aria-label="Percorso"></nav>
    <p id="status" class="status arch-status" role="status" aria-live="polite"></p>

    <main class="arch" id="arch" data-level="0">
        <section class="col" id="col-subjects" aria-label="Materie"></section>
        <section class="col" id="col-folders" aria-label="Cartelle"></section>
        <section class="col" id="col-files" aria-label="File"></section>
        <section class="pv" id="preview" aria-label="Anteprima">
            <p class="empty">Scegli una materia, poi un giorno: qui vedi il file senza uscire dalla pagina.</p>
        </section>
    </main>
</body>
</html>
