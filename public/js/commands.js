// public/js/commands.js

const baseSystemCommands = [
    "help", "ls", "dir", "cd", "pwd", "cat", "nano", "mkdir", "touch", "echo", "rm", 
    "find", "grep", "fortune", "quote", "whoami", "id", "uptime", "history", 
    "syslog", "sudo", "ip", "scan", "nmap", "ping", "traceroute", "status", 
    "decrypt", "ascii", "theme", "matrix", "cmatrix", "nuke", "glitch", "clear",
    "rice", "fetch", "join", "rooms", "create"
];

const COLORS = {
    PRIMARY: "#00f3ff",
    INFO: "#70f8ff",
    CYAN: "#00f3ff",
    WARNING: "#ffaa00",
    ERROR: "#ff3333",
    WHITE: "#ffffff"
};

const COMMAND_DESCRIPTIONS = {
    "help": "Display list of commands or detailed info. Usage: help [command]",
    "ls": "List directory contents. Aliases: dir",
    "dir": "List directory contents. Aliases: ls",
    "cd": "Change current working directory. Usage: cd <dir>",
    "pwd": "Print absolute path of working directory.",
    "cat": "Display virtual file contents. Usage: cat <filename>",
    "nano": "Terminal text editor. Usage: nano <filename>",
    "mkdir": "Create a new directory. Usage: mkdir <dirname>",
    "touch": "Create an empty file. Usage: touch <filename>",
    "echo": "Print text or write to file. Usage: echo <text> > <file>",
    "rm": "Remove file or directory. Usage: rm <target>",
    "find": "Walk and list full virtual filesystem tree.",
    "grep": "Search for pattern inside file. Usage: grep <pattern> <file>",
    "fortune": "Display random cyberpunk quote. Aliases: quote",
    "quote": "Display random cyberpunk quote. Aliases: fortune",
    "whoami": "Show active user identity and user agent. Aliases: id",
    "id": "Show active user identity details. Aliases: whoami",
    "uptime": "Display node running time and load average.",
    "history": "View command history log for current session.",
    "syslog": "Fetch system error logs.",
    "sudo": "Attempt privileged operation.",
    "ip": "Retrieve client IP address.",
    "scan": "Scan local subnet interfaces.",
    "nmap": "Perform port scan on target host. Usage: nmap [host]",
    "ping": "Test packet latency to host. Usage: ping [host]",
    "traceroute": "Trace network route hops.",
    "status": "Display node screen resolution and client environment.",
    "decrypt": "Run dictionary attack sequence on hash. Usage: decrypt [hash]",
    "ascii": "Render ASCII text banner. Usage: ascii [text]",
    "theme": "Set interface theme. Usage: theme <preset>",
    "matrix": "Set Matrix rain color. Usage: matrix <color|#hex>",
    "cmatrix": "Trigger matrix rain animation.",
    "nuke": "Trigger screen invert effect.",
    "glitch": "Trigger screen distortion effect.",
    "clear": "Clear terminal output screen.",
    "rice": "Switch or add desktop rice themes. Usage: rice <preset> OR rice add <name> <bg_hex> <accent_hex>",
    "fetch": "Display system summary, specs, and desktop rice info banner.",
    "join": "Switch active chat channel room. Usage: join <room_id>",
    "rooms": "List all public chat channels.",
    "create": "Create a new chat room channel. Usage: create <room_id> [room_name]",
    "/ban": "Permanently ban user from system. Usage: /ban <username>",
    "/timeout": "Temporarily restrict user for M minutes. Usage: /timeout <username> [minutes]",
    "/unban": "Restore access for banned or timed-out user. Usage: /unban <username>"
};

// Default File System Blueprint with .config/rice.conf and ~/chat/ channel logs included
const defaultFileSystem = {
    '~': {
        type: 'dir',
        children: {
            'motd.txt': { type: 'file', content: "====================================================\n  WELCOME TO VECTOR-BOX NODE v2.4.0 (AARCH64)\n  ALL CONNECTIONS ARE MONITORED AND LOGGED.\n====================================================" },
            'system.log': { type: 'file', content: "[2026-10-20 09:14:02] AUTH_FAIL: root from 192.168.1.45\n[2026-10-20 09:15:11] SERVICE_RESTART: nginx.service\n[2026-10-20 09:22:00] FIREWALL_RULE: DROPPED PACKET FROM 10.0.0.12\n[2026-10-20 10:00:00] TELEMETRY_SYNC: OK" },
            'credits.txt': { type: 'file', content: "DEVELOPED BY: VECTOR-BOX CORE TEAM\nSYSTEM ARCHITECTURE: PURE JS / PHP TELEMETRY\nVISUAL ENGINE: CRT OVERLAY + MATRIX CANVAS" },
            'chat': {
                type: 'dir',
                children: {
                    'general.log': { type: 'file', content: "=== VIRTUAL UPLINK STREAM: #general ===\nType 'join general' to connect terminal input." },
                    'dev.log': { type: 'file', content: "=== VIRTUAL UPLINK STREAM: #dev ===\nType 'join dev' to connect terminal input." },
                    'lounge.log': { type: 'file', content: "=== VIRTUAL UPLINK STREAM: #lounge ===\nType 'join lounge' to connect terminal input." }
                }
            },
            '.config': {
                type: 'dir',
                children: {
                    'rice.conf': { 
                        type: 'file', 
                        content: `# Vector-OS Rice Configuration File (Hyprland / i3 style)\n# Modify values and save with Ctrl+S in nano\n\ntheme = cyberpunk\nbg_color = #06080c\naccent_color = #00ff66\nborder_color = rgba(0, 255, 102, 0.3)\ntext_muted = #8ab4f8\nprompt_color = #00ff66\npanel_bg = rgba(10, 14, 22, 0.95)\nmatrix_color = #00ff66\n` 
                    }
                }
            }
        }
    }
};

const STORAGE_KEY = 'vectorbox_vfs';

function loadFileSystem() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) return JSON.parse(saved);
    } catch (e) {
        console.warn("Failed to load VFS from storage:", e);
    }
    return defaultFileSystem;
}

function saveFileSystem() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(fileSystem));
    } catch (e) {
        console.warn("Failed to save VFS to storage:", e);
    }
}

const fileSystem = loadFileSystem();
let currentPath = ['~'];

function syncVFSChannelLogs() {
    if (!fileSystem['~']?.children) return;
    if (!fileSystem['~'].children['chat']) {
        fileSystem['~'].children['chat'] = { type: 'dir', children: {} };
    }
    const chatDir = fileSystem['~'].children['chat'].children;
    const rooms = window.chatRooms || [{ id: 'general' }, { id: 'dev' }, { id: 'lounge' }];
    
    rooms.forEach(r => {
        const fileName = `${r.id}.log`;
        if (!chatDir[fileName]) {
            chatDir[fileName] = {
                type: 'file',
                content: `=== VIRTUAL UPLINK STREAM: #${r.id} ===\nType 'join ${r.id}' to connect buffer.`
            };
        }
    });
    saveFileSystem();
}

function escapeHTML(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function sanitizeTarget(target) {
    if (!target) return "";
    return target.replace(/\/+$/, "").trim();
}

function getCurrentDir() {
    let current = fileSystem;
    for (const folder of currentPath) {
        if (current[folder] && current[folder].type === 'dir') {
            current = current[folder].children;
        }
    }
    return current;
}

function resolvePath(pathStr) {
    if (!pathStr) return { dir: getCurrentDir(), name: "" };
    
    const parts = pathStr.split('/').filter(Boolean);
    let current = getCurrentDir();
    
    if (pathStr.startsWith('~')) {
        current = fileSystem['~'].children;
        parts.shift();
    }

    for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i];
        if (current[p] && current[p].type === 'dir') {
            current = current[p].children;
        } else {
            return null;
        }
    }

    return {
        dir: current,
        name: parts[parts.length - 1] || ""
    };
}

const getPromptText = () => `guest@vector-box:${currentPath.join('/')}$`;

function getAvailableCommands() {
    return baseSystemCommands;
}

function loadAdminCommandsIfEligible() {
    if (window.SESSION_STATE && window.SESSION_STATE.isAdmin) {
        if (!document.getElementById('admin-commands-script')) {
            const script = document.createElement('script');
            script.id = 'admin-commands-script';
            script.src = 'js/admin_commands.js';
            document.head.appendChild(script);
        }
    }
}

const defaultRices = ["cyberpunk", "nord", "catppuccin", "gruvbox", "dracula", "synthwave", "solarized"];

function applyRiceTheme(themeName) {
    document.body.setAttribute("data-rice", themeName);
    localStorage.setItem("selected_rice", themeName);
}

function parseAndApplyRiceConf(confText) {
    if (!confText) return;

    const lines = confText.split('\n');
    const customStyleId = 'dynamic-rice-conf-style';
    let styleTag = document.getElementById(customStyleId);

    if (!styleTag) {
        styleTag = document.createElement('style');
        styleTag.id = customStyleId;
        document.head.appendChild(styleTag);
    }

    let cssRules = [];
    lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;

        const parts = trimmed.split('=');
        if (parts.length >= 2) {
            const key = parts[0].trim().toLowerCase();
            const val = parts.slice(1).join('=').trim();

            if (key === 'theme') {
                applyRiceTheme(val);
            } else if (key === 'matrix_color') {
                window.matrixColor = val;
            } else {
                const cssVarName = `--${key.replace('_', '-')}`;
                cssRules.push(`${cssVarName}: ${val} !important;`);
            }
        }
    });

    if (cssRules.length > 0) {
        styleTag.textContent = `body { ${cssRules.join(' ')} }`;
    }
}

function registerCustomTheme(name, bgHex, accentHex) {
    const styleId = `custom-theme-${name}`;
    let styleTag = document.getElementById(styleId);
    
    if (!styleTag) {
        styleTag = document.createElement('style');
        styleTag.id = styleId;
        document.head.appendChild(styleTag);
    }

    styleTag.textContent = `
        body[data-rice="${name}"] {
            --bg-color: ${bgHex};
            --accent-color: ${accentHex};
            --border-color: ${accentHex}55;
            --text-muted: #8ab4f8;
            --prompt-color: ${accentHex};
            --panel-bg: ${bgHex}ee;
        }
    `;

    const customThemes = JSON.parse(localStorage.getItem("custom_rices") || "{}");
    customThemes[name] = { bg: bgHex, accent: accentHex };
    localStorage.setItem("custom_rices", JSON.stringify(customThemes));
}

(function initRicingEngine() {
    try {
        const customThemes = JSON.parse(localStorage.getItem("custom_rices") || "{}");
        Object.keys(customThemes).forEach(name => {
            const { bg, accent } = customThemes[name];
            registerCustomTheme(name, bg, accent);
        });

        const activeRice = localStorage.getItem("selected_rice") || "cyberpunk";
        document.body.setAttribute("data-rice", activeRice);

        if (fileSystem['~']?.children?.['.config']?.children?.['rice.conf']) {
            parseAndApplyRiceConf(fileSystem['~'].children['.config'].children['rice.conf'].content);
        }
    } catch (e) {}
})();

const commandHandlers = {
    help(args, printGuestLog) {
        const targetCmd = args[0] ? args[0].toLowerCase().replace(/^\//, '') : null;

        if (targetCmd) {
            const fullKey = COMMAND_DESCRIPTIONS[`/${targetCmd}`] ? `/${targetCmd}` : targetCmd;
            if (COMMAND_DESCRIPTIONS[fullKey]) {
                printGuestLog(`>> COMMAND: ${fullKey}`, COLORS.INFO);
                printGuestLog(`   ${COMMAND_DESCRIPTIONS[fullKey]}`, COLORS.PRIMARY);
            } else {
                printGuestLog(`>> No help entry found for command '${args[0]}'.`, COLORS.ERROR);
            }
            return;
        }

        printGuestLog("=================== AVAILABLE COMMANDS ===================", COLORS.INFO);
        const list = getAvailableCommands();
        printGuestLog(list.join("   "), COLORS.PRIMARY);
        printGuestLog("==========================================================", COLORS.INFO);
        printGuestLog("Type 'help <command>' to view specific command usage.", COLORS.INFO);
    },

    join(args, printGuestLog) {
        const targetRoom = args[0]?.toLowerCase().replace(/^#/, '');
        if (!targetRoom) {
            printGuestLog(">> ERROR: Usage: join <room_id>", COLORS.ERROR);
            return;
        }
        if (typeof window.switchChatRoom === 'function') {
            window.switchChatRoom(targetRoom);
            printGuestLog(`>> UPLINK SWITCH: Connected terminal feed to #${targetRoom}`, COLORS.PRIMARY);
        } else {
            printGuestLog(">> ERROR: Chat engine unavailable.", COLORS.ERROR);
        }
    },

    async rooms(args, printGuestLog) {
        if (typeof window.fetchChatRooms === 'function') {
            await window.fetchChatRooms();
        }
        syncVFSChannelLogs();
        const rooms = window.chatRooms || [];
        printGuestLog("=================== PUBLIC CHATTING ROOMS ===================", COLORS.INFO);
        rooms.forEach(r => {
            const isCurrent = r.id === window.activeRoomId ? " (ACTIVE)" : "";
            printGuestLog(` # ${r.id.padEnd(12)} - ${r.name}${isCurrent}`, COLORS.PRIMARY);
        });
        printGuestLog("==========================================================", COLORS.INFO);
    },

    async create(args, printGuestLog) {
        const roomId = args[0]?.toLowerCase().replace(/^#/, '');
        const roomName = args.slice(1).join(' ') || roomId;

        if (!roomId) {
            printGuestLog(">> ERROR: Usage: create <room_id> [room_name]", COLORS.ERROR);
            return;
        }

        try {
            const res = await fetch('api/rooms.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: roomId, name: roomName })
            });
            const data = await res.json();

            if (data.success) {
                printGuestLog(`>> CHANNEL CREATED: Room #${roomId} is now active!`, COLORS.PRIMARY);
                if (typeof window.fetchChatRooms === 'function') {
                    await window.fetchChatRooms();
                    syncVFSChannelLogs();
                    window.switchChatRoom(roomId);
                }
            } else {
                printGuestLog(`>> ERROR: ${data.error}`, COLORS.ERROR);
            }
        } catch (err) {
            printGuestLog(">> ERROR: Failed to create channel", COLORS.ERROR);
        }
    },

    cd(args, printGuestLog) {
        const rawTarget = args[0];
        if (!rawTarget || rawTarget === '~') {
            currentPath = ['~'];
            return;
        }

        const target = sanitizeTarget(rawTarget);

        if (target === '..') {
            if (currentPath.length > 1) currentPath.pop();
            return;
        }

        const parts = target.split('/').filter(Boolean);
        let tempPath = [...currentPath];

        for (const p of parts) {
            if (p === '..') {
                if (tempPath.length > 1) tempPath.pop();
                continue;
            }
            if (p === '.') continue;

            let currentDir = fileSystem;
            for (const folder of tempPath) {
                if (currentDir[folder] && currentDir[folder].type === 'dir') {
                    currentDir = currentDir[folder].children;
                }
            }

            if (currentDir[p] && currentDir[p].type === 'dir') {
                tempPath.push(p);
            } else if (currentDir[p]?.type === 'file') {
                printGuestLog(`>> cd: not a directory: ${rawTarget}`, COLORS.ERROR);
                return;
            } else {
                printGuestLog(`>> cd: no such file or directory: ${rawTarget}`, COLORS.ERROR);
                return;
            }
        }

        currentPath = tempPath;
    },

    ls(args, printGuestLog) {
        syncVFSChannelLogs();
        const dir = getCurrentDir();
        const items = Object.keys(dir).map(name => {
            return dir[name].type === 'dir' 
                ? `<span style="color: ${COLORS.INFO}; font-weight: bold;">${escapeHTML(name)}/</span>` 
                : `<span style="color: ${COLORS.PRIMARY};">${escapeHTML(name)}</span>`;
        });
        printGuestLog(items.length ? items.join('  ') : '>> (empty directory)', COLORS.WHITE);
    },

    cat(args, printGuestLog) {
        const rawTarget = args[0];
        if (!rawTarget) {
            printGuestLog(">> ERROR: Usage: cat <filename>", COLORS.ERROR);
            return;
        }

        syncVFSChannelLogs();
        const resolved = resolvePath(rawTarget);
        if (!resolved) {
            printGuestLog(`>> cat: ${rawTarget}: No such file or directory`, COLORS.ERROR);
            return;
        }

        const { dir, name } = resolved;
        if (dir[name]?.type === 'file') {
            printGuestLog(escapeHTML(dir[name].content), COLORS.PRIMARY);
        } else if (dir[name]?.type === 'dir') {
            printGuestLog(`>> cat: ${rawTarget}: Is a directory`, COLORS.ERROR);
        } else {
            printGuestLog(`>> cat: ${rawTarget}: No such file or directory`, COLORS.ERROR);
        }
    },

    nano(args, printGuestLog) {
        const rawTarget = args[0];
        if (!rawTarget) {
            printGuestLog(">> ERROR: Usage: nano <filename>", COLORS.ERROR);
            return;
        }

        const resolved = resolvePath(rawTarget);
        if (!resolved) {
            printGuestLog(`>> nano: cannot open ${rawTarget}: Parent directory does not exist`, COLORS.ERROR);
            return;
        }

        const { dir, name } = resolved;
        if (dir[name] && dir[name].type === 'dir') {
            printGuestLog(`>> nano: ${rawTarget}: Is a directory`, COLORS.ERROR);
            return;
        }

        const initialContent = dir[name] ? dir[name].content : "";

        if (typeof window.openNanoEditor === 'function') {
            window.openNanoEditor(name, initialContent, (savedContent) => {
                dir[name] = { type: 'file', content: savedContent };
                saveFileSystem();
                
                if (name === 'rice.conf' || name.endsWith('.conf')) {
                    parseAndApplyRiceConf(savedContent);
                    printGuestLog(`>> Reloaded desktop ricing configuration from '${name}'`, COLORS.CYAN);
                } else {
                    printGuestLog(`>> Saved changes to '${name}'`, COLORS.PRIMARY);
                }
            });
        }
    },

    mkdir(args, printGuestLog) {
        const rawTarget = args[0];
        if (!rawTarget) {
            printGuestLog(">> mkdir: missing operand", COLORS.ERROR);
            return;
        }

        const target = sanitizeTarget(rawTarget);
        const dir = getCurrentDir();

        if (dir[target]) {
            printGuestLog(`>> mkdir: cannot create directory '${target}': File exists`, COLORS.ERROR);
        } else {
            dir[target] = { type: 'dir', children: {} };
            saveFileSystem();
            printGuestLog(`>> Directory created: ${target}`, COLORS.PRIMARY);
        }
    },

    touch(args, printGuestLog) {
        const rawTarget = args[0];
        if (!rawTarget) {
            printGuestLog(">> touch: missing file operand", COLORS.ERROR);
            return;
        }

        const target = sanitizeTarget(rawTarget);
        const dir = getCurrentDir();

        if (!dir[target]) {
            dir[target] = { type: 'file', content: "" };
            saveFileSystem();
            printGuestLog(`>> File created: ${target}`, COLORS.PRIMARY);
        }
    },

    rm(args, printGuestLog) {
        const rawTarget = args[0];
        if (!rawTarget) {
            printGuestLog(">> rm: missing operand", COLORS.ERROR);
            return;
        }

        const target = sanitizeTarget(rawTarget);
        const dir = getCurrentDir();

        if (dir[target]) {
            delete dir[target];
            saveFileSystem();
            printGuestLog(`>> Removed: ${target}`, COLORS.WARNING);
        } else {
            printGuestLog(`>> rm: cannot remove '${rawTarget}': No such file or directory`, COLORS.ERROR);
        }
    },

    echo(args, printGuestLog, rawVal) {
        const echoRaw = rawVal.substring(5).trim();
        const redirectIdx = echoRaw.indexOf('>');

        if (redirectIdx !== -1) {
            const textContent = echoRaw.substring(0, redirectIdx).trim().replace(/^["']|["']$/g, '');
            const rawFileName = echoRaw.substring(redirectIdx + 1).trim();
            const fileName = sanitizeTarget(rawFileName);
            const dir = getCurrentDir();

            if (fileName) {
                dir[fileName] = { type: 'file', content: textContent };
                saveFileSystem();
                if (fileName === 'rice.conf' || fileName.endsWith('.conf')) {
                    parseAndApplyRiceConf(textContent);
                }
                printGuestLog(`>> Written to ${fileName}`, COLORS.PRIMARY);
            } else {
                printGuestLog(">> echo: syntax error near unexpected token 'newline'", COLORS.ERROR);
            }
        } else {
            printGuestLog(escapeHTML(echoRaw.replace(/^["']|["']$/g, '')), COLORS.WHITE);
        }
    },

    rice(args, printGuestLog) {
        const action = args[0]?.toLowerCase();

        if (action === 'add') {
            const themeName = args[1]?.toLowerCase();
            const bgHex = args[2];
            const accentHex = args[3];

            if (!themeName || !bgHex || !accentHex) {
                printGuestLog(">> USAGE: rice add <name> <bg_hex> <accent_hex>", COLORS.ERROR);
                printGuestLog("   EXAMPLE: rice add TokyoNight #1a1b26 #7aa2f7", COLORS.INFO);
                return;
            }

            registerCustomTheme(themeName, bgHex, accentHex);
            applyRiceTheme(themeName);
            printGuestLog(`>> RICE CREATOR: Custom theme '${themeName.toUpperCase()}' registered and applied!`, COLORS.PRIMARY);
            return;
        }

        const customThemes = JSON.parse(localStorage.getItem("custom_rices") || "{}");
        const availableRices = [...defaultRices, ...Object.keys(customThemes)];

        if (!action || !availableRices.includes(action)) {
            printGuestLog(`>> AVAILABLE RICES: ${availableRices.join(" | ")}`, COLORS.INFO);
            printGuestLog(">> USAGE: rice <preset_name> OR rice add <name> <bg_hex> <accent_hex>", COLORS.WARNING);
            return;
        }

        applyRiceTheme(action);
        printGuestLog(`>> RICE ENGINE: Applied preset '${action.toUpperCase()}'`, COLORS.PRIMARY);
    },

    fetch(args, printGuestLog) {
        const activeRice = document.body.getAttribute("data-rice") || "cyberpunk";
        const userAgent = navigator.platform;
        const res = `${window.innerWidth}x${window.innerHeight}`;

        const fetchBanner = `
  <span style="color:var(--accent-color);">/\\_/\\</span>     <span style="color:var(--accent-color); font-weight:bold;">guest@vector-box</span>
 <span style="color:var(--accent-color);">( o.o )</span>    ------------------
  <span style="color:var(--accent-color);">> ^ <</span>     <span style="color:var(--text-muted);">OS:</span> Vector-OS v2.4.0 (aarch64)
            <span style="color:var(--text-muted);">Host:</span> Web-Browser Engine (${escapeHTML(userAgent)})
            <span style="color:var(--text-muted);">WM:</span> WindowManager.js (8-Dir Desktop Stacking)
            <span style="color:var(--text-muted);">Rice Preset:</span> ${activeRice}
            <span style="color:var(--text-muted);">Uptime:</span> 42 days, 13:37
            <span style="color:var(--text-muted);">Screen Res:</span> ${res}
            <span style="color:var(--text-muted);">Shell:</span> web-bash 5.2.15
            
            <span style="background:#000; color:#ff3333;">  </span><span style="background:#000; color:#00ff66;">  </span><span style="background:#000; color:#00f3ff;">  </span><span style="background:#000; color:#ffaa00;">  </span><span style="background:#000; color:#bd93f9;">  </span><span style="background:#000; color:#ffffff;">  </span>
        `;

        printGuestLog(fetchBanner, COLORS.PRIMARY);
    },

    pwd(args, printGuestLog) { printGuestLog(currentPath.join('/'), COLORS.CYAN); },

    find(args, printGuestLog) {
        syncVFSChannelLogs();
        printGuestLog(".", COLORS.INFO);
        function walkTree(node, prefix) {
            Object.keys(node).forEach(name => {
                const item = node[name];
                const fullPath = `${prefix}/${name}`;
                if (item.type === 'dir') {
                    printGuestLog(`${fullPath}/`, COLORS.INFO);
                    walkTree(item.children, fullPath);
                } else {
                    printGuestLog(fullPath, COLORS.PRIMARY);
                }
            });
        }
        walkTree(fileSystem['~'].children, '~');
    },

    grep(args, printGuestLog) {
        if (args.length < 2) {
            printGuestLog(">> Usage: grep <pattern> <filename>", COLORS.ERROR);
            return;
        }
        syncVFSChannelLogs();
        const [pattern, rawFileName] = args;
        const resolved = resolvePath(rawFileName);

        if (resolved && resolved.dir[resolved.name]?.type === 'file') {
            const lines = resolved.dir[resolved.name].content.split('\n');
            const matches = lines.filter(line => line.toLowerCase().includes(pattern.toLowerCase()));
            if (matches.length > 0) {
                matches.forEach(match => printGuestLog(escapeHTML(match), COLORS.PRIMARY));
            } else {
                printGuestLog(`>> No matches found for pattern '${pattern}'`, COLORS.WARNING);
            }
        } else {
            printGuestLog(`>> grep: ${rawFileName}: No such file`, COLORS.ERROR);
        }
    },

    fortune(args, printGuestLog) {
        const fortunes = [
            '"There is no safe system." — Cyberpunk Axiom',
            '"Information wants to be free." — Stewart Brand',
            '"The net is vast and infinite." — Ghost in the Shell',
            '"Hack the planet!" — Hackers (1995)'
        ];
        const choice = fortunes[Math.floor(Math.random() * fortunes.length)];
        printGuestLog(`\n  ${choice}\n`, COLORS.CYAN);
    },

    whoami(args, printGuestLog) { printGuestLog("uid=1000(guest) gid=1000(guest) groups=1000(guest)", COLORS.CYAN); },
    uptime(args, printGuestLog) { printGuestLog(" 11:10:00 up 42 days, 13:37, 1 user, load average: 0.12, 0.08, 0.05", COLORS.PRIMARY); },
    sudo(args, printGuestLog) {
        printGuestLog("[sudo] password for guest:", COLORS.ERROR);
        setTimeout(() => printGuestLog("guest is not in the sudoers file. This incident will be reported.", COLORS.ERROR), 800);
    },
    theme(args, printGuestLog) {
        const themeArg = args[0]?.toLowerCase();
        if (themeArg) applyRiceTheme(themeArg);
    },
    decrypt(args, printGuestLog) {
        printGuestLog(">> INITIATING DICTIONARY ATTACK...", COLORS.WARNING);
        setTimeout(() => printGuestLog(">> DECRYPTED PAYLOAD: ACCESS_GRANTED", COLORS.CYAN), 1200);
    },
    ping(args, printGuestLog) { printGuestLog(">> PING node.vector-box.net (104.26.12.89) 56 bytes of data.", COLORS.INFO); },
    cmatrix(args, printGuestLog) { printGuestLog(">> MATRIX OVERRIDE COMPLETED.", COLORS.INFO); },
    ascii(args, printGuestLog, rawVal, renderNativeAscii) {
        const targetText = args.join(' ') || "VECTOR-BOX";
        const asciiBanner = renderNativeAscii ? renderNativeAscii(targetText) : null;
        if (asciiBanner) {
            printGuestLog(`<pre style="font-family: monospace; margin: 0; line-height: 1.1; white-space: pre;">${escapeHTML(asciiBanner)}</pre>`, COLORS.PRIMARY);
        }
    },
    matrix(args, printGuestLog) {
        const colorArg = args[0]?.toLowerCase();
        if (colorArg) {
            window.matrixColor = colorArg;
            printGuestLog(`>> MATRIX COLOR UPDATED: ${colorArg.toUpperCase()}`, COLORS.PRIMARY);
        }
    },
    traceroute(args, printGuestLog) { printGuestLog(">> TRACEROUTE COMPLETE: TARGET REACHED", COLORS.INFO); },
    async ip(args, printGuestLog) {
        try {
            const res = await fetch('api/get_ip.php');
            const data = await res.json();
            printGuestLog(`>> CLIENT_IPV4: ${escapeHTML(data.ip)}`, COLORS.PRIMARY);
        } catch (err) {
            printGuestLog(">> ERROR: Failed to resolve address.", COLORS.ERROR);
        }
    },
    scan(args, printGuestLog) { printGuestLog(">> SCAN COMPLETE. 0 VULNERABILITIES FOUND.", COLORS.INFO); },
    status(args, printGuestLog) { printGuestLog(`>> SCREEN_RES: ${window.innerWidth}x${window.innerHeight}`, COLORS.CYAN); },
    hack(args, printGuestLog) { printGuestLog(">> REDIRECTING TO BREACH PAGE...", COLORS.PRIMARY); },
    nuke(args, printGuestLog) { printGuestLog(">> SYSTEM RECOVERED", COLORS.PRIMARY); },
    glitch(args, printGuestLog) { printGuestLog(">> SIGNAL STABILIZED", COLORS.PRIMARY); },
    async syslog(args, printGuestLog) {
        try {
            const res = await fetch('api/get_log.php');
            const data = await res.text();
            printGuestLog(data || ">> Log file empty.", COLORS.CYAN);
        } catch (err) {
            printGuestLog(">> ERROR: Failed to read debug log.", COLORS.ERROR);
        }
    }
};

commandHandlers.dir = commandHandlers.ls;
commandHandlers.id = commandHandlers.whoami;
commandHandlers.quote = commandHandlers.fortune;

async function handleCommand(rawVal, printGuestLog, renderNativeAscii) {
    loadAdminCommandsIfEligible();
    const trimmedInput = rawVal.trim();
    if (!trimmedInput) return;

    const parts = trimmedInput.split(/\s+/);
    const commandName = parts[0].toLowerCase();
    const args = parts.slice(1);

    if (commandHandlers[commandName]) {
        await commandHandlers[commandName](args, printGuestLog, rawVal, renderNativeAscii);
    } else {
        printGuestLog(`>> command not found: ${escapeHTML(rawVal)}. Type 'help'.`, COLORS.ERROR);
    }
}