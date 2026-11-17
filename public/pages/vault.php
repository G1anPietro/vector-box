<?php
// public/pages/vault.php — the CIPHER_VAULT puzzle page (js/arg.js). Opened from the desktop; no API calls of its own.
require_once __DIR__ . '/../includes/head.php';
?>
<!DOCTYPE html>
<html lang="<?= pageLang() ?>">
<head>
    <?php renderHead("SYSTEM // CIPHER_VAULT", true, ['js/arg.js']); ?>
</head>
<body>
    <canvas id="canvas"></canvas>

    <header class="cyber-header">
        <div class="glitch">// ENCRYPTED_VAULT // ARG_DECRYPTOR</div>
        <a href="../index.php" class="nav-btn"><_ <?= tt('BACK_TO_TERMINAL', 'TORNA_AL_TERMINALE') ?></a>
    </header>

    <main class="page-container-centered">
        <div class="cyber-panel hack-container vault-container">
            <h2 class="hack-title">>_ <?= tt('CIPHER_DECRYPTION_TERMINAL', 'TERMINALE_DECIFRATURA') ?></h2>
            <p class="term-muted"><?= tt('Enter a decrypted key string discovered across the network logs to access classified system files.', 'Inserisci una chiave decifrata trovata nei log di rete per accedere ai file riservati del sistema.') ?></p>
            
            <div class="terminal-input-line">
                <span class="prompt-symbol"><?= tt('KEY', 'CHIAVE') ?>:</span>
                <input type="text" id="vault-key-input" class="terminal-input" placeholder="<?= tt('Enter key...', 'Inserisci la chiave...') ?>" autocomplete="off">
            </div>

            <button id="vault-unlock-btn" class="nav-btn hack-reset-btn">>_ <?= tt('SUBMIT KEY', 'INVIA CHIAVE') ?></button>

            <div id="vault-output" class="vault-output-box"></div>
        </div>
    </main>
</body>
</html>