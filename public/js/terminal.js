// public/terminal.js
document.addEventListener("DOMContentLoaded", () => {
    // Primary DOM Cache
    const guestCmdInput = document.getElementById('guest-cmd-input');
    const guestTermLog = document.getElementById('guest-term-log');
    const termBox = document.getElementById('guest-term-box');

    // Command History & Autocomplete Cycling State
    const cmdHistory = [];
    let historyIndex = -1;
    let tabMatchList = [];
    let tabMatchIndex = -1;
    let lastTabPrefix = "";

    // FIGlet Font Parser Cache
    let figletFontData = null;

    // Universal Scroll-to-Bottom Engine
    const scrollToBottom = () => {
        const containers = [guestTermLog, termBox].filter(Boolean);
        
        containers.forEach(el => {
            requestAnimationFrame(() => {
                el.scrollTop = el.scrollHeight;
            });
        });

        setTimeout(() => {
            containers.forEach(el => {
                el.scrollTop = el.scrollHeight;
            });
        }, 20);
    };

    // Auto-scroll on content height changes
    if (guestTermLog && typeof ResizeObserver !== 'undefined') {
        const logObserver = new ResizeObserver(() => {
            scrollToBottom();
        });
        logObserver.observe(guestTermLog);
    }

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

    // High-performance DOM logger
    const printGuestLog = (text, color = "#00ff66") => {
        if (!guestTermLog) return;

        const p = document.createElement('p');
        p.className = 'term-white';
        p.style.cssText = `margin: 2px 0; color: ${color}; white-space: pre-wrap;`;
        
        if (typeof text === 'string' && text.includes('<') && text.includes('>')) {
            p.innerHTML = text;
        } else {
            p.textContent = text;
        }

        guestTermLog.appendChild(p);
        scrollToBottom();
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

    // Advanced Autocomplete Engine (Commands, Paths, Arguments, Sub-commands, Channels)
    const getContextCompletions = (inputVal) => {
        const parts = inputVal.split(/\s+/);

        // 1. Root Command Level Completion
        if (parts.length === 1) {
            const val = parts[0].toLowerCase();
            const commandsList = typeof getAvailableCommands === 'function' 
                ? getAvailableCommands() 
                : (typeof availableCommands !== 'undefined' ? availableCommands : []);
            
            return commandsList
                .filter(cmd => cmd.toLowerCase().startsWith(val))
                .map(cmd => cmd);
        }

        // 2. Multi-word Command / Argument Level Completion
        const cmdName = parts[0].toLowerCase();
        const argPrefix = parts[parts.length - 1].toLowerCase();
        const pathCommands = ['cd', 'cat', 'nano', 'rm', 'grep', 'touch'];

        // Path / File Name Autocomplete
        if (pathCommands.includes(cmdName)) {
            let entries = [];
            if (typeof getCurrentDir === 'function') {
                const currentDir = getCurrentDir();
                entries = Object.keys(currentDir).map(name => {
                    return currentDir[name].type === 'dir' ? `${name}/` : name;
                });
            }

            if (cmdName === 'cd') {
                entries = entries.filter(item => item.endsWith('/'));
            }

            return entries
                .filter(entry => entry.toLowerCase().startsWith(argPrefix))
                .map(match => {
                    const prefixParts = [...parts];
                    prefixParts[prefixParts.length - 1] = match;
                    return prefixParts.join(' ');
                });
        }

        // Join Room Channel Autocomplete
        if (cmdName === 'join') {
            const roomList = (window.chatRooms || [{ id: 'general' }, { id: 'dev' }, { id: 'lounge' }]).map(r => r.id);
            return roomList
                .filter(rId => rId.toLowerCase().startsWith(argPrefix))
                .map(match => `${parts[0]} ${match}`);
        }

        // Sub-commands & Presets Autocomplete
        if (cmdName === 'rice') {
            const defaultRices = ["cyberpunk", "nord", "catppuccin", "gruvbox", "dracula", "synthwave", "solarized", "add"];
            const customThemes = JSON.parse(localStorage.getItem("custom_rices") || "{}");
            const allRices = [...defaultRices, ...Object.keys(customThemes)];

            return allRices
                .filter(preset => preset.toLowerCase().startsWith(argPrefix))
                .map(match => `${parts[0]} ${match}`);
        }

        if (cmdName === 'theme') {
            const presets = typeof window.THEME_PRESETS !== 'undefined' 
                ? Object.keys(window.THEME_PRESETS) 
                : ["cyberpunk", "nord", "catppuccin", "gruvbox", "dracula", "synthwave", "solarized"];

            return presets
                .filter(preset => preset.toLowerCase().startsWith(argPrefix))
                .map(match => `${parts[0]} ${match}`);
        }

        return [];
    };

    // Update Ghost Text View
    const updateGhostText = () => {
        const val = guestCmdInput.value;
        if (!val || !ghostText) {
            if (ghostText) ghostText.textContent = '';
            return;
        }

        const matches = getContextCompletions(val);
        if (matches.length > 0) {
            const bestMatch = matches[0];
            if (bestMatch.toLowerCase().startsWith(val.toLowerCase())) {
                ghostText.textContent = val + bestMatch.substring(val.length);
            } else {
                ghostText.textContent = '';
            }
        } else {
            ghostText.textContent = '';
        }
    };

    // Dynamic Autocomplete Input Event
    guestCmdInput.addEventListener('input', () => {
        tabMatchList = [];
        tabMatchIndex = -1;
        lastTabPrefix = "";
        updateGhostText();
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
        tabMatchList = [];
        tabMatchIndex = -1;
        lastTabPrefix = "";

        printGuestLog(`${typeof getPromptText === 'function' ? getPromptText() : 'guest@vector-box:$'} ${rawVal}`, "#8ab4f8");
        guestCmdInput.value = '';
        if (ghostText) ghostText.textContent = '';
        scrollToBottom();

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
        } else if (rawVal.startsWith('/')) {
            try {
                const res = await fetch('api/uplink_send.php', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': window.SESSION_STATE?.csrfToken || ''
                    },
                    credentials: 'same-origin',
                    body: JSON.stringify({ message: rawVal })
                });
                const data = await res.json();
                if (data.error) {
                    printGuestLog(`>> ${data.error}`, "#ff3333");
                }
            } catch (err) {
                printGuestLog(">> ERROR: Failed to execute terminal command", "#ff3333");
            }
        } else if (typeof handleCommand === 'function') {
            await handleCommand(rawVal, printGuestLog, renderNativeAscii);
        }

        scrollToBottom();
    };

    // Keyboard Event Handling (Tab Cycling + Key Navigation)
    guestCmdInput.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            const currentVal = guestCmdInput.value;
            if (!currentVal) return;

            // Initialize or cycle tab match list
            if (tabMatchList.length === 0 || lastTabPrefix !== currentVal) {
                lastTabPrefix = currentVal;
                tabMatchList = getContextCompletions(currentVal);
                tabMatchIndex = 0;
            } else {
                tabMatchIndex = (tabMatchIndex + 1) % tabMatchList.length;
            }

            if (tabMatchList.length > 0) {
                guestCmdInput.value = tabMatchList[tabMatchIndex];
                if (ghostText) ghostText.textContent = '';
            }
            return;
        }

        // Reset tab cycle on any non-Tab keypress
        tabMatchList = [];
        tabMatchIndex = -1;
        lastTabPrefix = "";

        switch (e.key) {
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

    // Focus & Click handlers
    if (termBox) {
        termBox.addEventListener('click', (e) => {
            if (e.target !== guestCmdInput) {
                guestCmdInput.focus();
            }
        });

        guestCmdInput.addEventListener('focus', () => {
            scrollToBottom();
        });
    }
});

// GNU Nano Text Editor Engine
window.openNanoEditor = function(fileName, initialContent, onSaveCallback) {
    if (document.getElementById('nano-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'nano-modal';
    modal.style.cssText = `
        position: absolute;
        top: 0; left: 0; width: 100%; height: 100%;
        background: #020304;
        z-index: 1000;
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
        border: 1px solid var(--accent-color, #00ff66);
        font-family: monospace;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
        background: var(--accent-color, #00ff66);
        color: #000;
        padding: 4px 8px;
        font-weight: bold;
        display: flex;
        justify-content: space-between;
        font-size: 0.85rem;
    `;
    header.innerHTML = `<span> GNU nano 2.9.8</span><span>File: ${fileName}</span><span>Modified</span>`;

    const textarea = document.createElement('textarea');
    textarea.value = initialContent;
    textarea.style.cssText = `
        flex: 1;
        background: transparent;
        color: #ffffff;
        border: none;
        outline: none;
        padding: 10px;
        font-family: inherit;
        font-size: 0.9rem;
        resize: none;
        line-height: 1.4;
    `;

    const footer = document.createElement('div');
    footer.style.cssText = `
        background: rgba(0, 255, 102, 0.1);
        border-top: 1px solid var(--border-color, rgba(0, 255, 102, 0.25));
        padding: 6px 10px;
        display: flex;
        gap: 15px;
        font-size: 0.75rem;
        color: var(--text-muted, #8ab4f8);
    `;
    footer.innerHTML = `
        <span><strong style="color:var(--accent-color);">^O</strong> Save (Ctrl+S)</span>
        <span><strong style="color:var(--accent-color);">^X</strong> Exit (Esc)</span>
    `;

    modal.appendChild(header);
    modal.appendChild(textarea);
    modal.appendChild(footer);

    const termBox = document.getElementById('guest-term-box');
    (termBox || document.body).appendChild(modal);

    textarea.focus();

    const closeNano = () => {
        modal.remove();
        const input = document.getElementById('guest-cmd-input');
        if (input) input.focus();
    };

    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            closeNano();
        }

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            onSaveCallback(textarea.value);
            closeNano();
        }
    });
};