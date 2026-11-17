// public/js/arg.js
(function () {
    const PUZZLE_KEYS = {
        "VECTOR-2026": () => '>> ' + VBLang.t('arg_ok') + '\n\nACCESS_GRANT: NULL_SECTOR_LOG_01\n"' + VBLang.t('arg_log1') + '"',
        "ZUFFI-HEX": () => '>> ' + VBLang.t('arg_ok') + '\n\nACCESS_GRANT: RICE_OVERRIDE\n' + VBLang.t('arg_log2')
    };

    function handleVaultSubmit() {
        const keyInput = document.getElementById("vault-key-input");
        const vaultOutput = document.getElementById("vault-output");

        if (!keyInput || !vaultOutput) return;

        const enteredKey = keyInput.value.trim().toUpperCase();

        if (!enteredKey) {
            vaultOutput.innerHTML = `<span style="color: var(--text-muted);">>_ ${VBLang.t('arg_enter')}</span>`;
            return;
        }

        if (PUZZLE_KEYS[enteredKey]) {
            const formatted = PUZZLE_KEYS[enteredKey]().replace(/\n/g, '<br>');
            vaultOutput.innerHTML = `<div style="color: var(--accent-color); font-weight: bold; overflow-wrap: break-word; word-break: normal; white-space: normal; line-height: 1.4;">${formatted}</div>`;
        } else {
            // typed text goes in as text, never as HTML
            const denied = document.createElement('span');
            denied.style.cssText = 'color: #ff3333; font-weight: bold;';
            denied.textContent = `>> ${VBLang.t('arg_denied')} '${enteredKey}'`;
            vaultOutput.replaceChildren(denied);
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