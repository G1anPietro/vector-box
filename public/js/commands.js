// public/js/commands.js

const baseSystemCommands = [
    "help", "ls", "dir", "cd", "pwd", "cat", "mkdir", "touch", "echo", "rm", 
    "find", "grep", "fortune", "quote", "whoami", "id", "uptime", "history", 
    "syslog", "sudo", "ip", "scan", "nmap", "ping", "traceroute", "status", 
    "decrypt", "ascii", "theme", "matrix", "cmatrix", "nuke", "glitch", "clear"
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
    "theme": "Set interface theme. Presets: cyan|matrix|amber|cyberpunk|dracula|synthwave|nord|monochrome|blood",
    "matrix": "Set Matrix rain color. Usage: matrix <color|#hex>",
    "cmatrix": "Trigger matrix rain animation.",
    "nuke": "Trigger screen invert effect.",
    "glitch": "Trigger screen distortion effect.",
    "clear": "Clear terminal output screen.",
    "/ban": "Permanently ban user from system. Usage: /ban <username>",
    "/timeout": "Temporarily restrict user for M minutes. Usage: /timeout <username> [minutes]",
    "/unban": "Restore access for banned or timed-out user. Usage: /unban <username>"
};

const fileSystem = {
    '~': {
        type: 'dir',
        children: {
            'motd.txt': { type: 'file', content: "====================================================\n  WELCOME TO VECTOR-BOX NODE v2.4.0 (AARCH64)\n  ALL CONNECTIONS ARE MONITORED AND LOGGED.\n====================================================" },
            'system.log': { type: 'file', content: "[2026-10-20 09:14:02] AUTH_FAIL: root from 192.168.1.45\n[2026-10-20 09:15:11] SERVICE_RESTART: nginx.service\n[2026-10-20 09:22:00] FIREWALL_RULE: DROPPED PACKET FROM 10.0.0.12\n[2026-10-20 10:00:00] TELEMETRY_SYNC: OK" },
            'credits.txt': { type: 'file', content: "DEVELOPED BY: VECTOR-BOX CORE TEAM\nSYSTEM ARCHITECTURE: PURE JS / PHP TELEMETRY\nVISUAL ENGINE: CRT OVERLAY + MATRIX CANVAS" }
        }
    }
};

let currentPath = ['~'];

function escapeHTML(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
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

const getPromptText = () => `guest@vector-box:${currentPath.join('/')}$`;

function getAvailableCommands() {
    return baseSystemCommands;
}

// Dynamically load admin commands script if user is admin
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

const commandHandlers = {
    help(args, printGuestLog) {
        const targetCmd = args[0] ? args[0].toLowerCase().replace(/^\//, '') : null;

        if (targetCmd) {
            // Detailed single command help
            const fullKey = COMMAND_DESCRIPTIONS[`/${targetCmd}`] ? `/${targetCmd}` : targetCmd;
            if (COMMAND_DESCRIPTIONS[fullKey]) {
                printGuestLog(`>> COMMAND: ${fullKey}`, COLORS.INFO);
                printGuestLog(`   ${COMMAND_DESCRIPTIONS[fullKey]}`, COLORS.PRIMARY);
            } else {
                printGuestLog(`>> No help entry found for command '${args[0]}'.`, COLORS.ERROR);
            }
            return;
        }

        // Compact list of available commands
        printGuestLog("=================== AVAILABLE COMMANDS ===================", COLORS.INFO);
        
        const list = getAvailableCommands();
        const formattedList = list.join("   ");
        printGuestLog(formattedList, COLORS.PRIMARY);
        
        printGuestLog("==========================================================", COLORS.INFO);
        printGuestLog("Type 'help <command>' to view specific command usage.", COLORS.INFO);
    },

    pwd(args, printGuestLog) {
        printGuestLog(currentPath.join('/'), COLORS.CYAN);
    },

    ls(args, printGuestLog) {
        const dir = getCurrentDir();
        const items = Object.keys(dir).map(name => {
            return dir[name].type === 'dir' 
                ? `<span style="color: ${COLORS.INFO}; font-weight: bold;">${escapeHTML(name)}/</span>` 
                : `<span style="color: ${COLORS.PRIMARY};">${escapeHTML(name)}</span>`;
        });
        printGuestLog(items.length ? items.join('  ') : '>> (empty directory)', COLORS.WHITE);
    },

    cd(args, printGuestLog) {
        const target = args[0];
        const dir = getCurrentDir();

        if (!target || target === '~') {
            currentPath = ['~'];
        } else if (target === '..') {
            if (currentPath.length > 1) currentPath.pop();
        } else if (dir[target]?.type === 'dir') {
            currentPath.push(target);
        } else if (dir[target]?.type === 'file') {
            printGuestLog(`>> cd: not a directory: ${target}`, COLORS.ERROR);
        } else {
            printGuestLog(`>> cd: no such file or directory: ${target}`, COLORS.ERROR);
        }
    },

    cat(args, printGuestLog) {
        const fileName = args[0];
        const dir = getCurrentDir();

        if (!fileName) {
            printGuestLog(">> ERROR: Usage: cat <filename>", COLORS.ERROR);
        } else if (dir[fileName]?.type === 'file') {
            printGuestLog(escapeHTML(dir[fileName].content), COLORS.PRIMARY);
        } else if (dir[fileName]?.type === 'dir') {
            printGuestLog(`>> cat: ${fileName}: Is a directory`, COLORS.ERROR);
        } else {
            printGuestLog(`>> cat: ${fileName}: No such file or directory`, COLORS.ERROR);
        }
    },

    mkdir(args, printGuestLog) {
        const folderName = args[0];
        const dir = getCurrentDir();

        if (!folderName) {
            printGuestLog(">> mkdir: missing operand", COLORS.ERROR);
        } else if (dir[folderName]) {
            printGuestLog(`>> mkdir: cannot create directory '${folderName}': File exists`, COLORS.ERROR);
        } else {
            dir[folderName] = { type: 'dir', children: {} };
            printGuestLog(`>> Directory created: ${folderName}`, COLORS.PRIMARY);
        }
    },

    touch(args, printGuestLog) {
        const fileName = args[0];
        const dir = getCurrentDir();

        if (!fileName) {
            printGuestLog(">> touch: missing file operand", COLORS.ERROR);
        } else if (!dir[fileName]) {
            dir[fileName] = { type: 'file', content: "" };
            printGuestLog(`>> File created: ${fileName}`, COLORS.PRIMARY);
        }
    },

    echo(args, printGuestLog, rawVal) {
        const echoRaw = rawVal.substring(5).trim();
        const redirectIdx = echoRaw.indexOf('>');

        if (redirectIdx !== -1) {
            const textContent = echoRaw.substring(0, redirectIdx).trim().replace(/^["']|["']$/g, '');
            const fileName = echoRaw.substring(redirectIdx + 1).trim();
            const dir = getCurrentDir();

            if (fileName) {
                dir[fileName] = { type: 'file', content: textContent };
                printGuestLog(`>> Written to ${fileName}`, COLORS.PRIMARY);
            } else {
                printGuestLog(">> echo: syntax error near unexpected token 'newline'", COLORS.ERROR);
            }
        } else {
            printGuestLog(escapeHTML(echoRaw.replace(/^["']|["']$/g, '')), COLORS.WHITE);
        }
    },

    rm(args, printGuestLog) {
        const targetName = args[0];
        const dir = getCurrentDir();

        if (dir[targetName]) {
            delete dir[targetName];
            printGuestLog(`>> Removed: ${targetName}`, COLORS.WARNING);
        } else {
            printGuestLog(`>> rm: cannot remove '${targetName}': No such file or directory`, COLORS.ERROR);
        }
    },

    find(args, printGuestLog) {
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
        const [pattern, fileName] = args;
        const dir = getCurrentDir();

        if (dir[fileName]?.type === 'file') {
            const lines = dir[fileName].content.split('\n');
            const matches = lines.filter(line => line.toLowerCase().includes(pattern.toLowerCase()));
            if (matches.length > 0) {
                matches.forEach(match => printGuestLog(escapeHTML(match), COLORS.PRIMARY));
            } else {
                printGuestLog(`>> No matches found for pattern '${pattern}'`, COLORS.WARNING);
            }
        } else {
            printGuestLog(`>> grep: ${fileName}: No such file`, COLORS.ERROR);
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

    whoami(args, printGuestLog) {
        printGuestLog("uid=1000(guest) gid=1000(guest) groups=1000(guest)", COLORS.CYAN);
    },

    uptime(args, printGuestLog) {
        printGuestLog(" 11:10:00 up 42 days, 13:37, 1 user, load average: 0.12, 0.08, 0.05", COLORS.PRIMARY);
    },

    sudo(args, printGuestLog) {
        printGuestLog("[sudo] password for guest:", COLORS.ERROR);
        setTimeout(() => {
            printGuestLog("guest is not in the sudoers file. This incident will be reported.", COLORS.ERROR);
        }, 800);
    },

    theme(args, printGuestLog) {
        const themeArg = args[0]?.toLowerCase();
        if (window.applySystemTheme && window.THEME_PRESETS && window.THEME_PRESETS[themeArg]) {
            window.applySystemTheme(themeArg);
            printGuestLog(`>> THEME APPLIED: ${themeArg.toUpperCase()}`, window.THEME_PRESETS[themeArg].accent);
        } else {
            printGuestLog(">> INVALID THEME. Usage: theme <preset>", COLORS.ERROR);
        }
    },

    decrypt(args, printGuestLog) {
        printGuestLog(">> INITIATING DICTIONARY ATTACK...", COLORS.WARNING);
        setTimeout(() => printGuestLog(">> DECRYPTED PAYLOAD: ACCESS_GRANTED", COLORS.CYAN), 1200);
    },

    ping(args, printGuestLog) {
        const targetHost = args[0] || "node.vector-box.net";
        printGuestLog(`>> PING ${targetHost} (104.26.12.89) 56 bytes of data.`, COLORS.INFO);
    },

    cmatrix(args, printGuestLog) {
        printGuestLog(">> MATRIX OVERRIDE COMPLETED.", COLORS.INFO);
    },

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

    traceroute(args, printGuestLog) {
        printGuestLog(">> TRACEROUTE COMPLETE: TARGET REACHED", COLORS.INFO);
    },

    async ip(args, printGuestLog) {
        try {
            const res = await fetch('api/get_ip.php');
            const data = await res.json();
            printGuestLog(`>> CLIENT_IPV4: ${escapeHTML(data.ip)}`, COLORS.PRIMARY);
        } catch (err) {
            printGuestLog(">> ERROR: Failed to resolve address.", COLORS.ERROR);
        }
    },

    scan(args, printGuestLog) {
        printGuestLog(">> SCAN COMPLETE. 0 VULNERABILITIES FOUND.", COLORS.INFO);
    },

    status(args, printGuestLog) {
        printGuestLog(`>> SCREEN_RES: ${window.innerWidth}x${window.innerHeight}`, COLORS.CYAN);
    },

    hack(args, printGuestLog) {
        printGuestLog(">> REDIRECTING TO BREACH PAGE...", COLORS.PRIMARY);
    },

    nuke(args, printGuestLog) {
        printGuestLog(">> SYSTEM RECOVERED", COLORS.PRIMARY);
    },

    glitch(args, printGuestLog) {
        printGuestLog(">> SIGNAL STABILIZED", COLORS.PRIMARY);
    },

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