<?php
require_once __DIR__ . '/../includes/head.php';
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <?php renderHead("TERMINAL // HEX_BREACH", true, ['js/hack.js']); ?>
</head>
<body>
    <canvas id="canvas"></canvas>

    <header class="cyber-header">
        <div class="glitch">// VECTOR-BOX // HEX_BREACH_PROTOCOL</div>
        <a href="../index.php" class="nav-btn"><_ BACK_TO_TERMINAL</a>
    </header>

    <main class="page-container-centered">
        <div class="cyber-panel hack-container">
            <h2 class="hack-title">>_ SYSTEM_NODE_BREACH</h2>
            
            <div class="hack-status-bar">
                <span>BUFFER_TIME: <b id="timer-val" class="hack-timer-text">15s</b></span>
                <span>SECURITY_LEVEL: <b class="hack-security-text">HIGH</b></span>
            </div>

            <p class="term-muted hack-instruction-text">MATCH TARGET SEQUENCE IN ORDER:</p>
            <div id="target-container" class="target-sequence"></div>

            <div id="hex-grid" class="hex-grid"></div>

            <div id="hack-result" class="hack-result"></div>

            <div class="hack-btn-container">
                <button id="reset-hack-btn" class="nav-btn hack-reset-btn">>_ RESTART BREACH</button>
            </div>
        </div>
    </main>
</body>
</html>