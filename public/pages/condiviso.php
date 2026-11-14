<?php
// public/pages/condiviso.php — opens ONE piece of class material from a temporary link (no login). Data from api/condividi.php,
// drawn by js/condiviso.js with the same viewers as the archive (schema with zoom/full screen/download, PDF, pictures, text).
require_once __DIR__ . '/../includes/head.php';
$e = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES);
$v = filemtime(__DIR__ . '/../js/condiviso.js') . '-' . filemtime(__DIR__ . '/../js/appunti-common.js') . '-' . filemtime(__DIR__ . '/../js/appunti-pdf.js') . '-' . filemtime(__DIR__ . '/../css/appunti.css');
header('X-Robots-Tag: noindex, nofollow');
header('Referrer-Policy: no-referrer');
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#14161b">
    <meta name="robots" content="noindex, nofollow">
    <meta name="referrer" content="no-referrer">
    <title>Appunti condivisi</title>
    <link rel="stylesheet" href="../css/appunti.css?v=<?= $e($v) ?>">
    <link rel="icon" href="../assets/appunti/icon.svg?v=1" type="image/svg+xml">
    <script src="../js/appunti-common.js?v=<?= $e($v) ?>" defer></script>
    <script src="../js/appunti-pdf.js?v=<?= $e($v) ?>" defer></script>
    <script src="../js/condiviso.js?v=<?= $e($v) ?>" defer></script>
</head>
<body>
    <main class="wrap shared-page">
        <p class="muted small">Appunti di classe · materiale condiviso con un link temporaneo</p>
        <h1 id="s-title">Apro il materiale…</h1>
        <p id="s-meta" class="muted small"></p>
        <div id="s-actions" class="row no-print"></div>
        <div id="s-body"></div>
        <p class="muted small" id="s-foot"></p>
    </main>
</body>
</html>
