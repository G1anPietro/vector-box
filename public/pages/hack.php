<?php
// public/pages/hack.php — the "hack" mini-game window (js/hack.js). Opened from the desktop menu.
require_once __DIR__ . '/../includes/head.php';
?>
<!DOCTYPE html>
<html lang="<?= pageLang() ?>">
<head>
    <?php renderHead("TERMINAL // HEX_BREACH", true, ['js/hack.js']); ?>
</head>
<body>
    <canvas id="canvas"></canvas>

    <header class="cyber-header">
        <div class="glitch">// VECTOR-BOX // HEX_BREACH_PROTOCOL</div>
        <a href="../index.php" class="nav-btn"><_ <?= tt('BACK_TO_TERMINAL', 'TORNA_AL_TERMINALE') ?></a>
    </header>

    <main class="page-container-centered">
        <div class="cyber-panel hack-container">
            <h2 class="hack-title">>_ <?= tt('SYSTEM_NODE_BREACH', 'INTRUSIONE_NEL_NODO') ?></h2>
            
            <div class="hack-status-bar">
                <span><?= tt('BUFFER_TIME', 'TEMPO_BUFFER') ?>: <b id="timer-val" class="hack-timer-text">15s</b></span>
                <span><?= tt('SECURITY_LEVEL', 'LIVELLO_SICUREZZA') ?>: <b class="hack-security-text"><?= tt('HIGH', 'ALTO') ?></b></span>
            </div>

            <p class="term-muted hack-instruction-text"><?= tt('MATCH TARGET SEQUENCE IN ORDER:', 'RIPRODUCI LA SEQUENZA BERSAGLIO NELL\'ORDINE:') ?></p>
            <div id="target-container" class="target-sequence"></div>

            <div id="hex-grid" class="hex-grid"></div>

            <div id="hack-result" class="hack-result"></div>

            <div class="hack-btn-container">
                <button id="reset-hack-btn" class="nav-btn hack-reset-btn">>_ <?= tt('RESTART BREACH', 'RICOMINCIA') ?></button>
            </div>
        </div>
    </main>
</body>
</html>