// public/js/tools.js
document.addEventListener("DOMContentLoaded", () => {
    const input = document.getElementById("tool-input");
    const output = document.getElementById("tool-output");
    const modeSelect = document.getElementById("tool-mode");

    if (!input || !output || !modeSelect) return;

    async function processTool() {
        const val = input.value;
        const mode = modeSelect.value;
        if (!val) { output.value = ""; return; }

        try {
            switch (mode) {
                case "b64-enc":
                    output.value = btoa(val);
                    break;
                case "b64-dec":
                    output.value = atob(val);
                    break;
                case "url-enc":
                    output.value = encodeURIComponent(val);
                    break;
                case "url-dec":
                    output.value = decodeURIComponent(val);
                    break;
                case "hex-enc":
                    output.value = Array.from(new TextEncoder().encode(val))
                        .map(b => b.toString(16).padStart(2, '0')).join(' ');
                    break;
                case "sha256":
                    const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(val));
                    output.value = Array.from(new Uint8Array(hashBuffer))
                        .map(b => b.toString(16).padStart(2, '0')).join('');
                    break;
            }
        } catch (e) {
            output.value = ">> ERROR: INVALID INPUT FOR SELECTED MODE";
        }
    }

    input.addEventListener("input", processTool);
    modeSelect.addEventListener("change", processTool);
});