// public/terminal.js
document.addEventListener("DOMContentLoaded", () => {
    // Primary DOM Cache
    const guestCmdInput = document.getElementById('guest-cmd-input');
    const guestTermLog = document.getElementById('guest-term-log');
    const termBox = document.getElementById('guest-term-box');

    // Command History Storage
    const cmdHistory = [];
    let historyIndex = -1;

    // FIGlet Font Parser Cache
    let figletFontData = null;

    // Load Local FIGlet Font
    (async function loadFont() {
        try {
            const res = await fetch('assets/Slant.flf');
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            const text = await res.text();
            figletFontData = parseFLF(text);
        } catch (err) {
            console.warn("Local FIGlet font failed to load:", err);
        }
    })();

    function parseFLF(flfText) {
        const lines = flfText.split(/\r?\n/);
        const header = lines[0].split(" ");
        const hardblank = header[0].slice(-1);
        const height = parseInt(header[1], 10) || 0;
        const commentLines = parseInt(header[5], 10) || 0;
        
        const chars = {};
        let lineIdx = 1 + commentLines;

        for (let code = 32; code <= 126; code++) {
            const charLines = [];
            for (let h = 0; h < height; h++) {
                let line = lines[lineIdx++] || "";
                line = line.replace(/[@#]+$/, "").replaceAll(hardblank, " ");
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

    // High-performance DOM logger (Avoids full innerHTML repaints)
    const printGuestLog = (text, color = "#00ff66") => {
        if (!guestTermLog) return;

        const p = document.createElement('p');
        p.className = 'term-white';
        p.style.cssText = `margin: 2px 0; color: ${color}; white-space: pre-wrap;`;
        
        // If string contains HTML structures (like <pre> or <span> tags), inject via innerHTML; otherwise use safe textContent
        if (text.includes('<') && text.includes('>')) {
            p.innerHTML = text;
        } else {
            p.textContent = text;
        }

        guestTermLog.appendChild(p);

        if (termBox) {
            termBox.scrollTop = termBox.scrollHeight;
        }
    };

    if (!guestCmdInput) return;

    // Ghost Text Autocomplete Setup
    const inputParent = guestCmdInput.parentElement;
    let ghostText = document.getElementById('guest-ghost-text');

    if (inputParent && !ghostText) {
        inputParent.style.position = 'relative';
        ghostText = document.createElement('span');
        ghostText.id = 'guest-ghost-text';
        ghostText.style.cssText = 'position: absolute; left: 0; color: #444; pointer-events: none; white-space: pre; font-family: inherit; font-size: inherit; z-index: 1;';
        inputParent.insertBefore(ghostText, guestCmdInput);
        
        guestCmdInput.style.position = 'relative';
        guestCmdInput.style.zIndex = '2';
        guestCmdInput.style.background = 'transparent';
    }

    // Dynamic Autocomplete Matcher
    guestCmdInput.addEventListener('input', () => {
        const val = guestCmdInput.value.toLowerCase();
        if (!val || !ghostText) {
            if (ghostText) ghostText.textContent = '';
            return;
        }

        const match = typeof availableCommands !== 'undefined' 
            ? availableCommands.find(cmd => cmd.startsWith(val)) 
            : null;

        ghostText.textContent = match ? guestCmdInput.value + match.substring(val.length) : '';
    });

    // Command Execution Logic
    const executeGuestCommand = async () => {
        const rawVal = guestCmdInput.value.trim();
        const cmd = rawVal.toLowerCase();
        if (!rawVal) return;

        if (cmdHistory[cmdHistory.length - 1] !== rawVal) {
            cmdHistory.push(rawVal);
        }
        historyIndex = -1;

        printGuestLog(`${typeof getPromptText === 'function' ? getPromptText() : 'guest@vector-box:$'} ${rawVal}`, "#8ab4f8");
        guestCmdInput.value = '';
        if (ghostText) ghostText.textContent = '';

        if (cmd === 'clear') {
            if (guestTermLog) guestTermLog.innerHTML = '';
        } else if (cmd === 'history') {
            if (cmdHistory.length === 0) {
                printGuestLog(">> No commands in session history.", "#8ab4f8");
            } else {
                cmdHistory.forEach((item, index) => {
                    printGuestLog(` ${index + 1}  ${item}`, "#8ab4f8");
                });
            }
        } else if (typeof handleCommand === 'function') {
            await handleCommand(rawVal, printGuestLog, renderNativeAscii);
        }
    };

    // Keyboard Event Handling
    guestCmdInput.addEventListener('keydown', (e) => {
        switch (e.key) {
            case 'Tab':
                e.preventDefault();
                if (ghostText?.textContent) {
                    guestCmdInput.value = ghostText.textContent;
                    ghostText.textContent = '';
                }
                break;

            case 'ArrowUp':
                e.preventDefault();
                if (cmdHistory.length > 0 && historyIndex < cmdHistory.length - 1) {
                    historyIndex++;
                    guestCmdInput.value = cmdHistory[cmdHistory.length - 1 - historyIndex];
                    if (ghostText) ghostText.textContent = '';
                }
                break;

            case 'ArrowDown':
                e.preventDefault();
                if (historyIndex > 0) {
                    historyIndex--;
                    guestCmdInput.value = cmdHistory[cmdHistory.length - 1 - historyIndex];
                } else if (historyIndex === 0) {
                    historyIndex = -1;
                    guestCmdInput.value = '';
                }
                if (ghostText) ghostText.textContent = '';
                break;

            case 'Enter':
                e.preventDefault();
                executeGuestCommand();
                break;
        }
    });

    // Mobile & UX Improvements
    if (termBox) {
        termBox.addEventListener('click', (e) => {
            if (e.target !== guestCmdInput) {
                guestCmdInput.focus();
            }
        });

        guestCmdInput.addEventListener('focus', () => {
            setTimeout(() => {
                termBox.scrollTop = termBox.scrollHeight;
            }, 300);
        });
    }
});