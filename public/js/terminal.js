document.addEventListener("DOMContentLoaded", () => {
    const guestCmdInput = document.getElementById('guest-cmd-input');
    const guestTermLog = document.getElementById('guest-term-log');

    // Command History Storage
    const cmdHistory = [];
    let historyIndex = -1;

    // Available Commands for Ghost Text Auto-completion
    const availableCommands = [
        "help", "ip", "scan", "status", "hack", "ascii",
        "matrix red", "matrix cyan", "matrix green", "nuke", "glitch", "clear"
    ];

    // Native FIGlet Font Parser
    let figletFontData = null;

    // Carica il font locale personalizzato dalla cartella assets
    fetch('assets/Slant.flf')
        .then(res => res.text())
        .then(text => {
            figletFontData = parseFLF(text);
        })
        .catch(() => console.warn("Errore nel caricamento del font FIGlet locale."));

    function parseFLF(flfText) {
        const lines = flfText.split(/\r?\n/);
        const header = lines[0].split(" ");
        const hardblank = header[0].substr(header[0].length - 1);
        const height = parseInt(header[1], 10);
        
        const chars = {};
        let lineIdx = 1;

        // Salta le linee di commento specificate nell'header
        const commentLines = parseInt(header[5], 10) || 0;
        lineIdx += commentLines;

        // Caratteri ASCII standard da 32 a 126
        for (let code = 32; code <= 126; code++) {
            const charLines = [];
            for (let h = 0; h < height; h++) {
                let line = lines[lineIdx++] || "";
                line = line.replace(/[@#]+$/, "");
                line = line.split(hardblank).join(" ");
                charLines.push(line);
            }
            chars[code] = charLines;
        }

        return { height, chars };
    }

    function renderNativeAscii(text) {
        if (!figletFontData) return null;
        
        const { height, chars } = figletFontData;
        const outputLines = Array(height).fill("");

        for (let i = 0; i < text.length; i++) {
            const code = text.charCodeAt(i);
            const charGlyph = chars[code] || chars[32];
            
            for (let h = 0; h < height; h++) {
                outputLines[h] += charGlyph[h] || "";
            }
        }

        return outputLines.join("\n");
    }

    const printGuestLog = (text, color = "#00ff66") => {
        if (!guestTermLog) return;
        guestTermLog.innerHTML += `<p class="term-white" style="margin: 2px 0; color: ${color}; white-space: pre-wrap;">${text}</p>`;
        const termBox = document.getElementById('guest-term-box');
        if (termBox) termBox.scrollTop = termBox.scrollHeight;
    };

    if (guestCmdInput) {
        const inputParent = guestCmdInput.parentElement;
        if (inputParent && !document.getElementById('guest-ghost-text')) {
            inputParent.style.position = 'relative';
            const ghostSpan = document.createElement('span');
            ghostSpan.id = 'guest-ghost-text';
            ghostSpan.style.cssText = 'position: absolute; left: 0; color: #444; pointer-events: none; white-space: pre; font-family: inherit; font-size: inherit; z-index: 1;';
            inputParent.insertBefore(ghostSpan, guestCmdInput);
            guestCmdInput.style.position = 'relative';
            guestCmdInput.style.zIndex = '2';
            guestCmdInput.style.background = 'transparent';
        }

        const ghostText = document.getElementById('guest-ghost-text');

        guestCmdInput.addEventListener('input', () => {
            const val = guestCmdInput.value.toLowerCase();
            if (!val) {
                if (ghostText) ghostText.innerText = '';
                return;
            }

            const match = availableCommands.find(cmd => cmd.startsWith(val));
            if (match && ghostText) {
                ghostText.innerText = guestCmdInput.value + match.substring(val.length);
            } else if (ghostText) {
                ghostText.innerText = '';
            }
        });

        const executeGuestCommand = async () => {
            const rawVal = guestCmdInput.value.trim();
            const cmd = rawVal.toLowerCase();
            if (!rawVal) return;

            if (cmdHistory[cmdHistory.length - 1] !== rawVal) {
                cmdHistory.push(rawVal);
            }
            historyIndex = -1;

            printGuestLog(`guest@vector-box:~$ ${rawVal}`, "#8ab4f8");
            guestCmdInput.value = '';
            if (ghostText) ghostText.innerText = '';

            if (cmd === 'help') {
                printGuestLog(">> COMMANDS: help | ip | scan | status | hack | ascii [text] | matrix red | matrix cyan | matrix green | nuke | glitch | clear", "#00ff66");
            } else if (cmd.startsWith('ascii')) {
                const inputArg = rawVal.substring(5).trim();
                const targetText = inputArg.length > 0 ? inputArg : "VECTOR-BOX";
                
                if (targetText.length > 15) {
                    printGuestLog(">> ERROR: Text length exceeds maximum buffer limit (15 chars).", "#ff3333");
                } else {
                    const asciiBanner = renderNativeAscii(targetText);
                    if (asciiBanner) {
                        printGuestLog(`<pre style="font-family: monospace; margin: 0; line-height: 1.1; white-space: pre;">${asciiBanner}</pre>`, "#00ff66");
                    } else {
                        printGuestLog(">> ERROR: Local font initializing...", "#ffaa00");
                    }
                }
            } else if (cmd === 'ip') {
                printGuestLog(">> Querying remote interface...", "#8ab4f8");
                try {
                    const res = await fetch('api/get_ip.php');
                    const data = await res.json();
                    printGuestLog(`>> CLIENT_IPV4: ${data.ip}`, "#00ff66");
                } catch (err) {
                    printGuestLog(">> ERROR: Failed to resolve client address.", "#ff3333");
                }
            } else if (cmd === 'scan') {
                printGuestLog(">> INITIATING SUBNET RECONNAISSANCE...", "#8ab4f8");
                setTimeout(() => printGuestLog(">> PORT 22 [SSH]: OPEN / ENCRYPTED", "#00ff66"), 400);
                setTimeout(() => printGuestLog(">> PORT 80 [HTTP]: OPEN / NGINX_APACHE", "#00ff66"), 800);
                setTimeout(() => printGuestLog(">> PORT 25565 [MINECRAFT]: ECOSYSTEM_ONLINE", "#00ff66"), 1200);
                setTimeout(() => printGuestLog(">> SCAN COMPLETE. 0 VULNERABILITIES FOUND.", "#8ab4f8"), 1600);
            } else if (cmd === 'status') {
                const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                printGuestLog(`>> DEVICE_TYPE: ${isMobile ? "MOBILE_NODE" : "DESKTOP_NODE"}`, "#00ffff");
                printGuestLog(`>> SCREEN_RES: ${window.innerWidth}x${window.innerHeight}`, "#00ffff");
            } else if (cmd === 'hack') {
                printGuestLog(">> REDIRECTING TO NODE BREACH...", "#00ff66");
                setTimeout(() => { window.location.href = 'pages/hack.html'; }, 800);
            } else if (cmd === 'matrix red') {
                window.matrixColor = '#ff0055';
                printGuestLog(">> MATRIX COLOR: RED", "#ff0055");
            } else if (cmd === 'matrix cyan') {
                window.matrixColor = '#00ffff';
                printGuestLog(">> MATRIX COLOR: CYAN", "#00ffff");
            } else if (cmd === 'matrix green') {
                window.matrixColor = '#00ff66';
                printGuestLog(">> MATRIX COLOR: GREEN", "#00ff66");
            } else if (cmd === 'nuke') {
                document.body.style.transition = 'filter 0.2s ease';
                document.body.style.filter = 'invert(1)';
                printGuestLog(">> SYSTEM ANOMALY DETECTED!", "#ff3333");
                setTimeout(() => {
                    document.body.style.filter = 'none';
                    printGuestLog(">> SYSTEM RECOVERED", "#00ff66");
                }, 1500);
            } else if (cmd === 'glitch') {
                document.body.style.animation = 'glitch-anim 0.1s infinite';
                printGuestLog(">> SIGNAL DISTORTION ENGAGED", "#ffaa00");
                setTimeout(() => {
                    document.body.style.animation = 'none';
                    printGuestLog(">> SIGNAL STABILIZED", "#00ff66");
                }, 2000);
            } else if (cmd === 'clear') {
                if (guestTermLog) guestTermLog.innerHTML = '';
            } else {
                printGuestLog(`>> command not found: ${rawVal}. Type 'help'.`, "#ff3333");
            }
        };

        guestCmdInput.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                if (ghostText && ghostText.innerText) {
                    guestCmdInput.value = ghostText.innerText;
                    ghostText.innerText = '';
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (cmdHistory.length > 0 && historyIndex < cmdHistory.length - 1) {
                    historyIndex++;
                    guestCmdInput.value = cmdHistory[cmdHistory.length - 1 - historyIndex];
                    if (ghostText) ghostText.innerText = '';
                }
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (historyIndex > 0) {
                    historyIndex--;
                    guestCmdInput.value = cmdHistory[cmdHistory.length - 1 - historyIndex];
                } else if (historyIndex === 0) {
                    historyIndex = -1;
                    guestCmdInput.value = '';
                }
                if (ghostText) ghostText.innerText = '';
            } else if (e.key === 'Enter') {
                e.preventDefault();
                executeGuestCommand();
            }
        });
    }
});