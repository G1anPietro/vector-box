// public/js/arg.js
(function () {
    const PUZZLE_KEYS = {
        "VECTOR-2026": ">> DECRYPTION SUCCESSFUL\n\nACCESS_GRANT: NULL_SECTOR_LOG_01\n\"System architecture designed by Denys. All nodes operational under Ubuntu kernel 6.8.0.\"",
        "ZUFFI-HEX": ">> DECRYPTION SUCCESSFUL\n\nACCESS_GRANT: RICE_OVERRIDE\nTry running 'theme matrix' or 'theme cyberpunk' inside the shell terminal."
    };

    function handleVaultSubmit() {
        const keyInput = document.getElementById("vault-key-input");
        const vaultOutput = document.getElementById("vault-output");

        if (!keyInput || !vaultOutput) return;

        const enteredKey = keyInput.value.trim().toUpperCase();

        if (!enteredKey) {
            vaultOutput.innerHTML = `<span style="color: var(--text-muted);">>_ ENTER PASSPHRASE...</span>`;
            return;
        }

        if (PUZZLE_KEYS[enteredKey]) {
            const formatted = PUZZLE_KEYS[enteredKey].replace(/\n/g, '<br>');
            vaultOutput.innerHTML = `<div style="color: var(--accent-color); font-weight: bold; overflow-wrap: break-word; word-break: normal; white-space: normal; line-height: 1.4;">${formatted}</div>`;
        } else {
            vaultOutput.innerHTML = `<span style="color: #ff3333; font-weight: bold;">>> ACCESS DENIED: INVALID KEY '${enteredKey}'</span>`;
        }
    }

    document.addEventListener("click", function (e) {
        if (e.target && e.target.id === "vault-unlock-btn") {
            e.preventDefault();
            handleVaultSubmit();
        }
    });

    document.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && e.target && e.target.id === "vault-key-input") {
            e.preventDefault();
            handleVaultSubmit();
        }
    });
})();