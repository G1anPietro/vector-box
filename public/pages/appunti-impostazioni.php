<?php
// public/pages/appunti-impostazioni.php — personal settings for one class: name in the class, which notifications to
// receive and when, how the week and the PDFs are shown. Logic in js/appunti-impostazioni.js (api/notifiche.php, api/classi.php).
require_once __DIR__ . '/../includes/head.php';
require_once __DIR__ . '/../api/database.php';

initSession();
if (empty($_SESSION['user_id'])) {
    header('Location: appunti-guida.php');
    exit();
}
$e = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES);
$v = filemtime(__DIR__ . '/../js/appunti-impostazioni.js') . '-' . filemtime(__DIR__ . '/../js/appunti-common.js') . '-' . filemtime(__DIR__ . '/../css/appunti.css') . '-' . filemtime(__DIR__ . '/../js/dropzone.js') . '-' . filemtime(__DIR__ . '/../css/dropzone.css');
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#14161b">
    <meta name="robots" content="noindex">
    <title>Impostazioni — Appunti di classe</title>
    <link rel="stylesheet" href="../css/appunti.css?v=<?= $e($v) ?>">
    <link rel="stylesheet" href="../css/dropzone.css?v=<?= $e($v) ?>">
    <link rel="manifest" href="../assets/appunti/manifest.json?v=1">
    <link rel="icon" href="../assets/appunti/icon.svg?v=1" type="image/svg+xml">
    <script src="../js/csrf.js?v=<?= $e($v) ?>"></script>
    <script src="../js/appunti-common.js?v=<?= $e($v) ?>" defer></script>
    <script src="../js/dropzone.js?v=<?= $e($v) ?>" defer></script>
    <script src="../js/appunti-impostazioni.js?v=<?= $e($v) ?>" defer></script>
</head>
<body>
    <header class="top">
        <a class="home back-link" href="appunti.php">Appunti</a>
    </header>
    <main class="wrap settings-page">
        <h1>Impostazioni</h1>
        <p id="status" class="status" role="status" aria-live="polite"></p>
        <div id="settings-root"></div>
    </main>
</body>
</html>
