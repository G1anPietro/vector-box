document.addEventListener("DOMContentLoaded", () => {
    const guestCmdInput = document.getElementById('guest-cmd-input');
    const guestTermLog = document.getElementById('guest-term-log');

    // Command History Storage
    const cmdHistory = [];
    let historyIndex = -1;

    // Available Commands for Ghost Text Auto-completion
    const availableCommands = [
        "help", "ip", "scan", "traceroute", "status", "hack", "ascii",
        "matrix red", "matrix cyan", "matrix green", "matrix blue", "matrix purple", "matrix gold", "matrix amber",
        "theme matrix", "theme amber", "theme cyberpunk", "theme dracula",
        "whoami", "id", "uptime", "ls", "dir", "history", "sudo", "decrypt",
        "cat motd.txt", "cat system.log", "cat credits.txt", "ping vector-box.net", "cmatrix",
        "nuke", "glitch", "clear"
    ];

    // Simulated Virtual File System for `cat` & `ls`
    const virtualFiles = {
        'motd.txt': "====================================================\n  WELCOME TO VECTOR-BOX NODE v2.4.0 (AARCH64)\n  ALL CONNECTIONS ARE MONITORED AND LOGGED.\n====================================================",
        'system.log': "[2026-10-20 09:14:02] AUTH_FAIL: root from 192.168.1.45\n[2026-10-20 09:15:11] SERVICE_RESTART: nginx.service\n[2026-10-20 09:22:00] FIREWALL_RULE: DROPPED PACKET FROM 10.0.0.12\n[2026-10-20 10:00:00] TELEMETRY_SYNC: OK",
        'credits.txt': "DEVELOPED BY: VECTOR-BOX CORE TEAM\nSYSTEM ARCHITECTURE: PURE JS / PHP TELEMETRY\nVISUAL ENGINE: CRT OVERLAY + MATRIX CANVAS"
    };

    // Native FIGlet Font Parser
    let figletFontData = null;

    fetch('assets/Slant.flf')
        .then(res => res.text())
        .then(text => {
            figletFontData = parseFLF(text);
        })
        .catch(() => console.warn("Local FIGlet font failed to load."));

    function parseFLF(flfText) {
        const lines = flfText.split(/\r?\n/);
        const header = lines[0].split(" ");
        const hardblank = header[0].substr(header[0].length - 1);
        const height = parseInt(header[1], 10);
        
        const chars = {};
        let lineIdx = 1;

        const commentLines = parseInt(header[5], 10) || 0;
        lineIdx += commentLines;

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
        if (termBox) {
            termBox.scrollTop = termBox.scrollHeight;
        }
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
                printGuestLog("=================== SYSTEM COMMANDS ===================", "#8ab4f8");
                printGuestLog("  ls | dir          : List directory contents", "#00ff66");
                printGuestLog("  cat <file>        : Print virtual file contents", "#00ff66");
                printGuestLog("  whoami / id       : Show active user session details", "#00ff66");
                printGuestLog("  uptime            : Print system running time and load", "#00ff66");
                printGuestLog("  history           : View session command log", "#00ff66");
                printGuestLog("  sudo <cmd>        : Attempt privileged execution", "#00ff66");
                printGuestLog("\n=================== NETWORK & RECON ===================", "#8ab4f8");
                printGuestLog("  ip / scan         : Query network interfaces & open ports", "#00ff66");
                printGuestLog("  ping <host>       : Test latency to target IP/domain", "#00ff66");
                printGuestLog("  traceroute        : Trace packet route hops", "#00ff66");
                printGuestLog("  status            : Display node telemetry & screen res", "#00ff66");
                printGuestLog("  decrypt [hash]    : Initiate brute-force sequence", "#00ff66");
                printGuestLog("\n=================== VISUALS & THEMES ==================", "#8ab4f8");
                printGuestLog("  ascii [text]      : Render custom ASCII banner", "#00ff66");
                printGuestLog("  theme <preset>    : Switch UI theme (matrix | amber | cyberpunk | dracula)", "#00ff66");
                printGuestLog("  matrix <color|#>  : Change rain color (red|cyan|green|blue|purple|gold|amber|#HEX)", "#00ff66");
                printGuestLog("  cmatrix           : Trigger matrix rain override", "#00ff66");
                printGuestLog("  nuke / glitch     : Induce screen anomaly effects", "#00ff66");
                printGuestLog("  clear             : Clear terminal output", "#00ff66");
                printGuestLog("=======================================================", "#8ab4f8");
            } else if (cmd === 'whoami' || cmd === 'id') {
                printGuestLog("uid=1000(guest) gid=1000(guest) groups=1000(guest),27(sudo)", "#00ffff");
                printGuestLog(`>> USER_AGENT: ${navigator.userAgent}`, "#8ab4f8");
            } else if (cmd === 'uptime') {
                printGuestLog(" 11:10:00 up 42 days, 13:37, 1 user, load average: 0.12, 0.08, 0.05", "#00ff66");
            } else if (cmd === 'ls' || cmd === 'dir') {
                printGuestLog("drwxr-xr-x 2 guest guest 4096 Oct 20 11:10 .", "#8ab4f8");
                printGuestLog("-rw-r--r-- 1 guest guest  204 Oct 20 09:14 motd.txt", "#00ff66");
                printGuestLog("-rw-r--r-- 1 guest guest  312 Oct 20 10:00 system.log", "#00ff66");
                printGuestLog("-rw-r--r-- 1 guest guest  128 Oct 20 08:30 credits.txt", "#00ff66");
                printGuestLog("-rw------- 1 root  root   512 Oct 20 11:00 .shadow", "#ff3333");
            } else if (cmd === 'history') {
                if (cmdHistory.length === 0) {
                    printGuestLog(">> No commands in session history.", "#8ab4f8");
                } else {
                    cmdHistory.forEach((item, index) => {
                        printGuestLog(` ${index + 1}  ${item}`, "#8ab4f8");
                    });
                }
            } else if (cmd.startsWith('sudo')) {
                printGuestLog("[sudo] password for guest:", "#ff3333");
                setTimeout(() => {
                    printGuestLog("guest is not in the sudoers file. This incident will be reported.", "#ff3333");
                }, 800);
            } else if (cmd.startsWith('theme')) {
                const themeArg = cmd.replace('theme', '').trim();
                const root = document.documentElement;
                
                if (themeArg === 'amber') {
                    root.style.setProperty('--accent-color', '#ffb000');
                    root.style.setProperty('--border-color', 'rgba(255, 176, 0, 0.3)');
                    window.matrixColor = '#ffb000';
                    if (window.setSystemCookie) window.setSystemCookie("selected_theme", "amber");
                    printGuestLog(">> THEME APPLIED: AMBER IBM CRT", "#ffb000");
                } else if (themeArg === 'cyberpunk') {
                    root.style.setProperty('--accent-color', '#ff007f');
                    root.style.setProperty('--border-color', 'rgba(0, 243, 255, 0.4)');
                    window.matrixColor = '#00f3ff';
                    if (window.setSystemCookie) window.setSystemCookie("selected_theme", "cyberpunk");
                    printGuestLog(">> THEME APPLIED: CYBERPUNK NEON", "#ff007f");
                } else if (themeArg === 'dracula') {
                    root.style.setProperty('--accent-color', '#bd93f9');
                    root.style.setProperty('--border-color', 'rgba(189, 147, 249, 0.3)');
                    window.matrixColor = '#bd93f9';
                    if (window.setSystemCookie) window.setSystemCookie("selected_theme", "dracula");
                    printGuestLog(">> THEME APPLIED: DRACULA PURPLE", "#bd93f9");
                } else if (themeArg === 'matrix') {
                    root.style.setProperty('--accent-color', '#00ff66');
                    root.style.setProperty('--border-color', 'rgba(0, 255, 102, 0.25)');
                    window.matrixColor = '#00ff66';
                    if (window.setSystemCookie) window.setSystemCookie("selected_theme", "matrix");
                    printGuestLog(">> THEME APPLIED: CLASSIC MATRIX GREEN", "#00ff66");
                } else {
                    printGuestLog(">> INVALID THEME. Options: matrix | amber | cyberpunk | dracula", "#ff3333");
                }
            } else if (cmd.startsWith('decrypt')) {
                const targetHash = rawVal.substring(7).trim() || "0x7F8B2C";
                printGuestLog(`>> INITIATING DICTIONARY ATTACK ON [${targetHash}]...`, "#ffaa00");
                
                const steps = [
                    "0x000000 -> MISMATCH",
                    "0x1A2F3B -> MISMATCH",
                    "0x4B8C1D -> MISMATCH",
                    "0x6E9F0A -> MATCH FOUND!"
                ];

                steps.forEach((step, idx) => {
                    setTimeout(() => {
                        if (idx === steps.length - 1) {
                            printGuestLog(`[+] ${step}`, "#00ff66");
                            printGuestLog(">> DECRYPTED PAYLOAD: ACCESS_GRANTED_PASS_8841", "#00ffff");
                        } else {
                            printGuestLog(`[-] ${step}`, "#ffaa00");
                        }
                    }, (idx + 1) * 350);
                });
            } else if (cmd.startsWith('cat')) {
                const fileName = rawVal.substring(3).trim().toLowerCase();
                if (!fileName) {
                    printGuestLog(">> ERROR: Usage: cat <filename> (e.g., cat motd.txt)", "#ff3333");
                } else if (virtualFiles[fileName]) {
                    printGuestLog(virtualFiles[fileName], "#00ff66");
                } else if (fileName === '.shadow') {
                    printGuestLog(">> cat: .shadow: Permission denied", "#ff3333");
                } else {
                    printGuestLog(`>> cat: ${fileName}: No such file or directory`, "#ff3333");
                }
            } else if (cmd.startsWith('ping')) {
                const targetHost = rawVal.substring(4).trim() || "node.vector-box.net";
                printGuestLog(`>> PING ${targetHost} (104.26.12.89) 56(84) bytes of data.`, "#8ab4f8");
                
                for (let i = 1; i <= 4; i++) {
                    setTimeout(() => {
                        const ms = (12 + Math.random() * 8).toFixed(2);
                        printGuestLog(`64 bytes from ${targetHost} (104.26.12.89): icmp_seq=${i} ttl=58 time=${ms} ms`, "#00ff66");
                        if (i === 4) {
                            printGuestLog(`\n--- ${targetHost} ping statistics ---`, "#8ab4f8");
                            printGuestLog("4 packets transmitted, 4 received, 0% packet loss, time 3004ms", "#00ffff");
                        }
                    }, i * 600);
                }
            } else if (cmd === 'cmatrix') {
                printGuestLog(">> INITIALIZING MATRIX OVERRIDE...", "#00ff66");
                const matrixChars = "0123456789ABCDEF@#$%&*";
                let count = 0;
                const matrixInterval = setInterval(() => {
                    let line = "";
                    for (let i = 0; i < 45; i++) {
                        line += matrixChars.charAt(Math.floor(Math.random() * matrixChars.length)) + " ";
                    }
                    printGuestLog(line, "#00ff66");
                    count++;
                    if (count > 15) {
                        clearInterval(matrixInterval);
                        printGuestLog(">> MATRIX OVERRIDE COMPLETED.", "#8ab4f8");
                    }
                }, 100);
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
            } else if (cmd.startsWith('matrix ')) {
                const colorArg = cmd.replace('matrix ', '').trim();
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

                if (colors[colorArg]) {
                    window.matrixColor = colors[colorArg];
                    if (window.setSystemCookie) window.setSystemCookie("matrix_color", colors[colorArg]);
                    printGuestLog(`>> MATRIX COLOR UPDATED: ${colorArg.toUpperCase()}`, colors[colorArg]);
                } else if (hexRegex.test(colorArg)) {
                    window.matrixColor = colorArg;
                    if (window.setSystemCookie) window.setSystemCookie("matrix_color", colorArg);
                    printGuestLog(`>> MATRIX COLOR UPDATED: ${colorArg.toUpperCase()}`, colorArg);
                } else {
                    printGuestLog(`>> INVALID COLOR. Use: red | cyan | green | blue | purple | gold | amber or a hex code like #ff00ff`, "#ff3333");
                }
            } else if (cmd === 'traceroute') {
                printGuestLog(">> traceroute to node.vector-box.net (192.168.1.254), 30 hops max, 60 byte packets", "#8ab4f8");
                
                const hops = [
                    " 1  192.168.1.1 (gateway)  1.204 ms  1.102 ms  0.985 ms",
                    " 2  10.244.0.1 (local-router)  12.431 ms  11.890 ms  12.001 ms",
                    " 3  172.16.42.1 (isp-edge)  24.112 ms  23.876 ms  25.043 ms",
                    " 4  104.26.12.89 (backbone-us-east)  45.321 ms  44.981 ms  46.120 ms",
                    " 5  192.168.1.254 (node.vector-box.net)  48.712 ms  48.102 ms  47.998 ms"
                ];

                hops.forEach((hop, index) => {
                    setTimeout(() => {
                        printGuestLog(hop, index === hops.length - 1 ? "#00ff66" : "#00ffff");
                        if (index === hops.length - 1) {
                            printGuestLog(">> TRACEROUTE COMPLETE: TARGET REACHED", "#8ab4f8");
                        }
                    }, (index + 1) * 400);
                });
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

        // Mobile UX: Container click-focus and auto-scroll on keyboard open
        const termBox = document.getElementById('guest-term-box');
        if (termBox && guestCmdInput) {
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
    }
});