<?php
require_once __DIR__ . '/../includes/head.php';
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <?php renderHead("SYSTEM // CIPHER_VAULT", true, ['js/arg.js']); ?>
</head>
<body>
    <canvas id="canvas"></canvas>

    <header class="cyber-header">
        <div class="glitch">// ENCRYPTED_VAULT // ARG_DECRYPTOR</div>
        <a href="../index.php" class="nav-btn"><_ BACK_TO_TERMINAL</a>
    </header>

    <main class="page-container-centered">
        <div class="cyber-panel hack-container vault-container">
            <h2 class="hack-title">>_ CIPHER_DECRYPTION_TERMINAL</h2>
            <p class="term-muted">Enter a decrypted key string discovered across the network logs to access classified system files.</p>
            
            <div class="terminal-input-line">
                <span class="prompt-symbol">KEY:</span>
                <input type="text" id="vault-key-input" class="terminal-input" placeholder="Enter key..." autocomplete="off">
            </div>

            <button id="vault-unlock-btn" class="nav-btn hack-reset-btn">>_ SUBMIT KEY</button>

            <div id="vault-output" class="vault-output-box"></div>
        </div>
    </main>
</body>
</html>