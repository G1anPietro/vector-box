<?php
// public/pages/credits.php — static credits page ("CIAO ZUFFI"). No API calls.
require_once __DIR__ . '/../includes/head.php';
?>
<!DOCTYPE html>
<html lang="<?= pageLang() ?>">
<head>
    <?php renderHead("Credits // Ciao Zuffi", true); ?>
</head>
<body>
    <canvas id="canvas"></canvas>
    
    <header class="cyber-header">
        <div class="glitch">// SECURE_ARCHIVE</div>
        <a href="../index.php" class="nav-btn">// <?= tt('RETURN_HOME', 'TORNA_ALLA_HOME') ?></a>
    </header>

    <main class="page-container-centered">
        <div class="cyber-panel credits-box">
            <h1 class="glitch credits-title">CIAO ZUFFI</h1>
            <p class="credits-subtitle"><?= tt('SYSTEM ARCHITECTURE DESIGNED BY DENYS', 'ARCHITETTURA DEL SISTEMA PROGETTATA DA DENYS') ?></p>
            <p class="credits-footer"><?= tt('END OF FILE.', 'FINE DEL FILE.') ?></p>
        </div>
    </main>
</body>
</html>