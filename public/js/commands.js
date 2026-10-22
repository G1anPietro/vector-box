// public/commands.js

// Existing Minecraft Commands
const mcCommands = [
    // Vanilla
    "time set day", "time set night", "time set noon", "time set midnight",
    "weather clear", "weather rain", "weather thunder",
    "gamemode creative", "gamemode survival", "gamemode spectator",
    "op", "deop", "stop", "list", "say", "kick", "ban", "pardon",
    "whitelist add", "whitelist remove", "whitelist on", "whitelist off",
    
    // CoreProtect
    "co i", "co l", "co rollback", "co restore", "co purge",
    
    // Spark
    "spark profiler start", "spark profiler stop", "spark health", "spark tps", "spark ping", "spark gc",
    
    // Chunky
    "chunky start", "chunky pause", "chunky continue", "chunky cancel", "chunky radius", "chunky center",
    
    // Geyser / Floodgate
    "geyser reload", "geyser dump", "geyser connections", "geyser version",
    "fwhitelist add", "fwhitelist remove"
];

// Core Terminal Commands
const systemCommands = [
    "help", "ip", "scan", "nmap", "traceroute", "status", "hack", "ascii",
    "matrix red", "matrix cyan", "matrix green", "matrix blue", "matrix purple", "matrix gold", "matrix amber",
    "theme matrix", "theme amber", "theme cyberpunk", "theme dracula",
    "whoami", "id", "uptime", "ls", "dir", "cd", "pwd", "mkdir", "touch", "echo", "rm", "find", "grep", "fortune", "quote", "history", "sudo", "decrypt",
    "cat motd.txt", "cat system.log", "cat credits.txt", "ping vector-box.net", "cmatrix",
    "nuke", "glitch", "clear", "syslog"
];

// Combined list for ghost text auto-completion
const availableCommands = [...systemCommands, ...mcCommands];

// Color Palette Constants
const COLORS = {
    PRIMARY: "#00ff66",
    INFO: "#8ab4f8",
    CYAN: "#00ffff",
    WARNING: "#ffaa00",
    ERROR: "#ff3333",
    WHITE: "#ffffff",
    AMBER: "#ffb000",
    CYBERPUNK: "#ff007f",
    DRACULA: "#bd93f9"
};

// Stateful Virtual File System Tree
const fileSystem = {
    '~': {
        type: 'dir',
        children: {
            'motd.txt': { type: 'file', content: "====================================================\n  WELCOME TO VECTOR-BOX NODE v2.4.0 (AARCH64)\n  ALL CONNECTIONS ARE MONITORED AND LOGGED.\n====================================================" },
            'system.log': { type: 'file', content: "[2026-10-20 09:14:02] AUTH_FAIL: root from 192.168.1.45\n[2026-10-20 09:15:11] SERVICE_RESTART: nginx.service\n[2026-10-20 09:22:00] FIREWALL_RULE: DROPPED PACKET FROM 10.0.0.12\n[2026-10-20 10:00:00] TELEMETRY_SYNC: OK" },
            'credits.txt': { type: 'file', content: "DEVELOPED BY: VECTOR-BOX CORE TEAM\nSYSTEM ARCHITECTURE: PURE JS / PHP TELEMETRY\nVISUAL ENGINE: CRT OVERLAY + MATRIX CANVAS" },
            'logs': {
                type: 'dir',
                children: {
                    'access.log': { type: 'file', content: "127.0.0.1 - - [20/Oct/2026:11:10:00 +0000] \"GET / HTTP/1.1\" 200" }
                }
            }
        }
    }
};

let currentPath = ['~'];

// --- Helper Functions ---
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

function updateTheme(accent, border, matrixColor, themeName) {
    const root = document.documentElement;
    root.style.setProperty('--accent-color', accent);
    root.style.setProperty('--border-color', border);
    window.matrixColor = matrixColor;
    if (window.setSystemCookie) window.setSystemCookie("selected_theme", themeName);
}

// --- Command Handlers ---
const commandHandlers = {
    help(args, printGuestLog) {
        printGuestLog("=================== SYSTEM COMMANDS ===================", COLORS.INFO);
        printGuestLog("  ls | dir          : List directory contents", COLORS.PRIMARY);
        printGuestLog("  cd <dir>          : Change current working directory", COLORS.PRIMARY);
        printGuestLog("  pwd               : Print working directory path", COLORS.PRIMARY);
        printGuestLog("  cat <file>        : Print virtual file contents", COLORS.PRIMARY);
        printGuestLog("  mkdir <dir>       : Create a new sub-directory", COLORS.PRIMARY);
        printGuestLog("  touch <file>      : Create an empty file", COLORS.PRIMARY);
        printGuestLog("  echo <txt> > file : Write content to file", COLORS.PRIMARY);
        printGuestLog("  rm <target>       : Remove file or directory", COLORS.PRIMARY);
        printGuestLog("  find              : Walk entire directory tree", COLORS.PRIMARY);
        printGuestLog("  grep <pat> <file> : Search for text pattern inside file", COLORS.PRIMARY);
        printGuestLog("  fortune / quote   : Display random cyberpunk quote", COLORS.PRIMARY);
        printGuestLog("  whoami / id       : Show active user session details", COLORS.PRIMARY);
        printGuestLog("  uptime            : Print system running time and load", COLORS.PRIMARY);
        printGuestLog("  history           : View session command log", COLORS.PRIMARY);
        printGuestLog("  syslog            : Inspect system debug & error logs", COLORS.PRIMARY);
        printGuestLog("  sudo <cmd>        : Attempt privileged execution", COLORS.PRIMARY);
        printGuestLog("\n=================== NETWORK & RECON ===================", COLORS.INFO);
        printGuestLog("  ip / scan         : Query network interfaces & open ports", COLORS.PRIMARY);
        printGuestLog("  nmap <host>       : Port scan target host", COLORS.PRIMARY);
        printGuestLog("  ping <host>       : Test latency to target IP/domain", COLORS.PRIMARY);
        printGuestLog("  traceroute        : Trace packet route hops", COLORS.PRIMARY);
        printGuestLog("  status            : Display node telemetry & screen res", COLORS.PRIMARY);
        printGuestLog("  decrypt [hash]    : Initiate brute-force sequence", COLORS.PRIMARY);
        printGuestLog("\n=================== VISUALS & THEMES ==================", COLORS.INFO);
        printGuestLog("  ascii [text]      : Render custom ASCII banner", COLORS.PRIMARY);
        printGuestLog("  theme <preset>    : Switch UI theme (matrix | amber | cyberpunk | dracula)", COLORS.PRIMARY);
        printGuestLog("  matrix <color|#>  : Change rain color (red|cyan|green|blue|purple|gold|amber|#HEX)", COLORS.PRIMARY);
        printGuestLog("  cmatrix           : Trigger matrix rain override", COLORS.PRIMARY);
        printGuestLog("  nuke / glitch     : Induce screen anomaly effects", COLORS.PRIMARY);
        printGuestLog("  clear             : Clear terminal output", COLORS.PRIMARY);
        printGuestLog("=======================================================", COLORS.INFO);
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
        } else if (fileName === '.shadow') {
            printGuestLog(">> cat: .shadow: Permission denied", COLORS.ERROR);
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
            '"Hack the planet!" — Hackers (1995)',
            '"Code is poetry, security is the rhythm."',
            '"LOGGED: Everything you type is monitored by node root."'
        ];
        const choice = fortunes[Math.floor(Math.random() * fortunes.length)];
        printGuestLog(`\n  ${choice}\n`, COLORS.CYAN);
    },

    nmap(args, printGuestLog) {
        const target = args[0] || "127.0.0.1";
        printGuestLog(`>> Starting Nmap 7.94 ( https://nmap.org ) against [${target}]...`, COLORS.INFO);
        
        const ports = [
            { port: "22/tcp", state: "OPEN", service: "ssh" },
            { port: "80/tcp", state: "OPEN", service: "http (nginx)" },
            { port: "443/tcp", state: "OPEN", service: "https" },
            { port: "3306/tcp", state: "FILTERED", service: "mysql" },
            { port: "8080/tcp", state: "OPEN", service: "http-proxy" }
        ];

        setTimeout(() => {
            printGuestLog(`>> PORT       STATE    SERVICE`, COLORS.CYAN);
            ports.forEach((p, idx) => {
                setTimeout(() => {
                    const color = p.state === "OPEN" ? COLORS.PRIMARY : COLORS.WARNING;
                    printGuestLog(`   ${p.port.padEnd(10)} ${p.state.padEnd(8)} ${p.service}`, color);
                    if (idx === ports.length - 1) {
                        printGuestLog(`\nNmap done: 1 IP address scanned in 2.14 seconds.`, COLORS.INFO);
                    }
                }, idx * 300);
            });
        }, 600);
    },

    whoami(args, printGuestLog) {
        printGuestLog("uid=1000(guest) gid=1000(guest) groups=1000(guest),27(sudo)", COLORS.CYAN);
        printGuestLog(`>> USER_AGENT: ${navigator.userAgent}`, COLORS.INFO);
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
        
        switch (themeArg) {
            case 'amber':
                updateTheme(COLORS.AMBER, 'rgba(255, 176, 0, 0.3)', COLORS.AMBER, 'amber');
                printGuestLog(">> THEME APPLIED: AMBER IBM CRT", COLORS.AMBER);
                break;
            case 'cyberpunk':
                updateTheme(COLORS.CYBERPUNK, 'rgba(0, 243, 255, 0.4)', '#00f3ff', 'cyberpunk');
                printGuestLog(">> THEME APPLIED: CYBERPUNK NEON", COLORS.CYBERPUNK);
                break;
            case 'dracula':
                updateTheme(COLORS.DRACULA, 'rgba(189, 147, 249, 0.3)', COLORS.DRACULA, 'dracula');
                printGuestLog(">> THEME APPLIED: DRACULA PURPLE", COLORS.DRACULA);
                break;
            case 'matrix':
                updateTheme(COLORS.PRIMARY, 'rgba(0, 255, 102, 0.25)', COLORS.PRIMARY, 'matrix');
                printGuestLog(">> THEME APPLIED: CLASSIC MATRIX GREEN", COLORS.PRIMARY);
                break;
            default:
                printGuestLog(">> INVALID THEME. Options: matrix | amber | cyberpunk | dracula", COLORS.ERROR);
        }
    },

    decrypt(args, printGuestLog) {
        const targetHash = args[0] || "0x7F8B2C";
        printGuestLog(`>> INITIATING DICTIONARY ATTACK ON [${targetHash}]...`, COLORS.WARNING);
        
        const steps = [
            "0x000000 -> MISMATCH",
            "0x1A2F3B -> MISMATCH",
            "0x4B8C1D -> MISMATCH",
            "0x6E9F0A -> MATCH FOUND!"
        ];

        steps.forEach((step, idx) => {
            setTimeout(() => {
                if (idx === steps.length - 1) {
                    printGuestLog(`[+] ${step}`, COLORS.PRIMARY);
                    printGuestLog(">> DECRYPTED PAYLOAD: ACCESS_GRANTED_PASS_8841", COLORS.CYAN);
                } else {
                    printGuestLog(`[-] ${step}`, COLORS.WARNING);
                }
            }, (idx + 1) * 350);
        });
    },

    ping(args, printGuestLog) {
        const targetHost = args[0] || "node.vector-box.net";
        printGuestLog(`>> PING ${targetHost} (104.26.12.89) 56(84) bytes of data.`, COLORS.INFO);
        
        for (let i = 1; i <= 4; i++) {
            setTimeout(() => {
                const ms = (12 + Math.random() * 8).toFixed(2);
                printGuestLog(`64 bytes from ${targetHost} (104.26.12.89): icmp_seq=${i} ttl=58 time=${ms} ms`, COLORS.PRIMARY);
                if (i === 4) {
                    printGuestLog(`\n--- ${targetHost} ping statistics ---`, COLORS.INFO);
                    printGuestLog("4 packets transmitted, 4 received, 0% packet loss, time 3004ms", COLORS.CYAN);
                }
            }, i * 600);
        }
    },

    cmatrix(args, printGuestLog) {
        printGuestLog(">> INITIALIZING MATRIX OVERRIDE...", COLORS.PRIMARY);
        const matrixChars = "0123456789ABCDEF@#$%&*";
        let count = 0;
        const matrixInterval = setInterval(() => {
            let line = "";
            for (let i = 0; i < 45; i++) {
                line += matrixChars.charAt(Math.floor(Math.random() * matrixChars.length)) + " ";
            }
            printGuestLog(line, COLORS.PRIMARY);
            count++;
            if (count > 15) {
                clearInterval(matrixInterval);
                printGuestLog(">> MATRIX OVERRIDE COMPLETED.", COLORS.INFO);
            }
        }, 100);
    },

    ascii(args, printGuestLog, rawVal, renderNativeAscii) {
        const targetText = args.join(' ') || "VECTOR-BOX";
        
        if (targetText.length > 15) {
            printGuestLog(">> ERROR: Text length exceeds maximum buffer limit (15 chars).", COLORS.ERROR);
        } else {
            const asciiBanner = renderNativeAscii ? renderNativeAscii(targetText) : null;
            if (asciiBanner) {
                printGuestLog(`<pre style="font-family: monospace; margin: 0; line-height: 1.1; white-space: pre;">${escapeHTML(asciiBanner)}</pre>`, COLORS.PRIMARY);
            } else {
                printGuestLog(">> ERROR: Local font initializing...", COLORS.WARNING);
            }
        }
    },

    matrix(args, printGuestLog) {
        const colorArg = args[0]?.toLowerCase();
        const colors = {
            'red': '#ff0055',
            'cyan': '#00ffff',
            'green': '#00ff66',
            'blue': '#0066ff',
            'purple': '#b026ff',
            'gold': '#ffd700',
            'amber': '#ffbf00'
        };

        const hexRegex = /^#([0-9a-fA-F]{3}){1,2}$/;
        const selectedColor = colors[colorArg] || (hexRegex.test(colorArg) ? colorArg : null);

        if (selectedColor) {
            window.matrixColor = selectedColor;
            if (window.setSystemCookie) window.setSystemCookie("matrix_color", selectedColor);
            printGuestLog(`>> MATRIX COLOR UPDATED: ${colorArg.toUpperCase()}`, selectedColor);
        } else {
            printGuestLog(`>> INVALID COLOR. Use: red | cyan | green | blue | purple | gold | amber or a hex code like #ff00ff`, COLORS.ERROR);
        }
    },

    traceroute(args, printGuestLog) {
        printGuestLog(">> traceroute to node.vector-box.net (192.168.1.254), 30 hops max, 60 byte packets", COLORS.INFO);
        
        const hops = [
            " 1  192.168.1.1 (gateway)  1.204 ms  1.102 ms  0.985 ms",
            " 2  10.244.0.1 (local-router)  12.431 ms  11.890 ms  12.001 ms",
            " 3  172.16.42.1 (isp-edge)  24.112 ms  23.876 ms  25.043 ms",
            " 4  104.26.12.89 (backbone-us-east)  45.321 ms  44.981 ms  46.120 ms",
            " 5  192.168.1.254 (node.vector-box.net)  48.712 ms  48.102 ms  47.998 ms"
        ];

        hops.forEach((hop, index) => {
            setTimeout(() => {
                printGuestLog(hop, index === hops.length - 1 ? COLORS.PRIMARY : COLORS.CYAN);
                if (index === hops.length - 1) {
                    printGuestLog(">> TRACEROUTE COMPLETE: TARGET REACHED", COLORS.INFO);
                }
            }, (index + 1) * 400);
        });
    },

    async ip(args, printGuestLog) {
        printGuestLog(">> Querying remote interface...", COLORS.INFO);
        try {
            const res = await fetch('api/get_ip.php');
            const data = await res.json();
            printGuestLog(`>> CLIENT_IPV4: ${escapeHTML(data.ip)}`, COLORS.PRIMARY);
        } catch (err) {
            printGuestLog(">> ERROR: Failed to resolve client address.", COLORS.ERROR);
        }
    },

    scan(args, printGuestLog) {
        printGuestLog(">> INITIATING SUBNET RECONNAISSANCE...", COLORS.INFO);
        setTimeout(() => printGuestLog(">> PORT 22 [SSH]: OPEN / ENCRYPTED", COLORS.PRIMARY), 400);
        setTimeout(() => printGuestLog(">> PORT 80 [HTTP]: OPEN / NGINX_APACHE", COLORS.PRIMARY), 800);
        setTimeout(() => printGuestLog(">> PORT 25565 [MINECRAFT]: ECOSYSTEM_ONLINE", COLORS.PRIMARY), 1200);
        setTimeout(() => printGuestLog(">> SCAN COMPLETE. 0 VULNERABILITIES FOUND.", COLORS.INFO), 1600);
    },

    status(args, printGuestLog) {
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        printGuestLog(`>> DEVICE_TYPE: ${isMobile ? "MOBILE_NODE" : "DESKTOP_NODE"}`, COLORS.CYAN);
        printGuestLog(`>> SCREEN_RES: ${window.innerWidth}x${window.innerHeight}`, COLORS.CYAN);
    },

    hack(args, printGuestLog) {
        printGuestLog(">> REDIRECTING TO NODE BREACH...", COLORS.PRIMARY);
        setTimeout(() => { window.location.href = 'pages/hack.html'; }, 800);
    },

    nuke(args, printGuestLog) {
        document.body.style.transition = 'filter 0.2s ease';
        document.body.style.filter = 'invert(1)';
        printGuestLog(">> SYSTEM ANOMALY DETECTED!", COLORS.ERROR);
        setTimeout(() => {
            document.body.style.filter = 'none';
            printGuestLog(">> SYSTEM RECOVERED", COLORS.PRIMARY);
        }, 1500);
    },

    glitch(args, printGuestLog) {
        document.body.style.animation = 'glitch-anim 0.1s infinite';
        printGuestLog(">> SIGNAL DISTORTION ENGAGED", COLORS.WARNING);
        setTimeout(() => {
            document.body.style.animation = 'none';
            printGuestLog(">> SIGNAL STABILIZED", COLORS.PRIMARY);
        }, 2000);
    },

    async syslog(args, printGuestLog) {
        printGuestLog(">> Fetching system debug log...", COLORS.INFO);
        try {
            const res = await fetch('api/get_log.php');
            const data = await res.text();
            printGuestLog(data || ">> Log file empty.", COLORS.CYAN);
        } catch (err) {
            printGuestLog(">> ERROR: Failed to read debug log.", COLORS.ERROR);
        }
    }
};

// Aliases
commandHandlers.dir = commandHandlers.ls;
commandHandlers.id = commandHandlers.whoami;
commandHandlers.quote = commandHandlers.fortune;

// Main Terminal Command Router
async function handleCommand(rawVal, printGuestLog, renderNativeAscii) {
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