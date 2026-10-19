window.onload = () => {
    const canvas = document.getElementById("canvas");
    if (canvas) {
        const ctx = canvas.getContext("2d");
        canvas.height = window.innerHeight; canvas.width = window.innerWidth;
        const alphabet = "0101010101ABCDEFGHIJKLMNOPQRSTUVWXYZ@#$<>[]".split("");
        const fontSize = 14; const columns = canvas.width / fontSize;
        const rainDrops = Array(Math.floor(columns)).fill(1);

        function drawMatrix() {
            ctx.fillStyle = "rgba(6, 8, 12, 0.06)"; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = typeof window.matrixColor !== 'undefined' ? window.matrixColor : "#00ff66"; 
            ctx.font = fontSize + "px monospace";
            for (let i = 0; i < rainDrops.length; i++) {
                const text = alphabet[Math.floor(Math.random() * alphabet.length)];
                ctx.fillText(text, i * fontSize, rainDrops[i] * fontSize);
                if (rainDrops[i] * fontSize > canvas.height && Math.random() > 0.98) rainDrops[i] = 0;
                rainDrops[i]++;
            }
        }
        window.addEventListener('resize', () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; });
        setInterval(drawMatrix, 35);
    }
};

document.addEventListener("DOMContentLoaded", async () => {
    const loginBtn = document.getElementById('menu-login-btn');
    const loginModal = document.getElementById('login-modal');
    const userInput = document.getElementById('auth-user');
    const passwordInput = document.getElementById('auth-password');
    const errorLog = document.getElementById('login-err');
    const submitBtn = document.getElementById('submit-login-btn');

    if (loginBtn && loginModal) {
        loginBtn.addEventListener('click', () => {
            loginModal.classList.remove('hidden');
            if (userInput) userInput.focus();
        });
    }

    if (loginModal) {
        loginModal.addEventListener('click', (e) => { if (e.target === loginModal) loginModal.classList.add('hidden'); });
    }

    const processLogin = async () => {
        if (!userInput || !passwordInput || !errorLog) return;
        const username = userInput.value.trim();
        const password = passwordInput.value;
        if (!username || !password) return;

        errorLog.innerText = "// Querying verification clusters...";
        
        try {
            const authRes = await fetch('login.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            
            const data = await authRes.json();
            if (data.success) {
                window.location.href = 'dashboard.php';
            } else {
                errorLog.innerText = `>> ACCESS DENIED: ${data.error || 'Invalid credentials sequence.'}`;
            }
        } catch (err) {
            errorLog.innerText = ">> CONNECTION ERROR";
        }
    };

    if (submitBtn) submitBtn.addEventListener('click', processLogin);
    if (passwordInput) passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') processLogin(); });
    if (userInput) userInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') passwordInput.focus(); });

    const wakePcBtn = document.getElementById('wake-pc-btn');
    if (wakePcBtn) {
        wakePcBtn.addEventListener('click', async () => {
            wakePcBtn.innerText = "TRANSMITTING WOL PACKET...";
            const formData = new FormData();
            formData.append('action', 'wakemainpc');
            
            try {
                const response = await fetch('dashboard.php', { method: 'POST', body: formData });
                const result = await response.json();
                if (result.success) {
                    alert(">> SUCCESS: Broadcast packet sent. Hardware target booting up.");
                } else {
                    alert(`>> EXCEPTION: ${result.error || 'Unauthorized'}`);
                }
            } catch(e) {
                alert(">> ERROR: Failed to reach backend.");
            }
            wakePcBtn.innerText = ">_ EXECUTE: wakemainpc";
        });
    }

    let isServerOnline = false;
    let currentOnlinePlayers = []; 
    let knownOfflinePlayers = ["denys", "zuffi", "steve", "alex"]; 
    const mcStartBtn = document.getElementById('mc-start-btn');
    const mcStopBtn = document.getElementById('mc-stop-btn');
    const mcLog = document.getElementById('mc-log');

    const writeLog = (text, color = "#fff") => {
        if (!mcLog) return;
        mcLog.innerHTML += `<span style="color: ${color};">${text}</span><br>`;
        mcLog.scrollTop = mcLog.scrollHeight;
    };

    if (mcStartBtn) {
        mcStartBtn.addEventListener('click', async () => {
            if (isServerOnline) {
                writeLog(">> Status Check: The server is already online! Connection active.", "#ffcc00");
                return;
            }

            writeLog(">> starting minecraft server...", "#8ab4f8");
            
            const formData = new FormData();
            formData.append('action', 'start_mc');
            fetch('dashboard.php', { method: 'POST', body: formData });

            setTimeout(() => writeLog(">> starting...", "#cf94ff"), 1000);
            setTimeout(() => {
                writeLog(">> server online on port 25565! Ecosystem functional.", "#00ff66");
                isServerOnline = true;
            }, 2500);
        });
    }

    if (mcStopBtn) {
        mcStopBtn.addEventListener('click', async () => {
            if (!isServerOnline) {
                writeLog(">> Status Check: The server is already offline! Process space is empty.", "#ffcc00");
                return;
            }

            writeLog(">> stopping minecraft server...", "#ff3333");

            const formData = new FormData();
            formData.append('action', 'stop_mc');
            await fetch('dashboard.php', { method: 'POST', body: formData });

            setTimeout(() => writeLog(">> saving data blocks and flush storage buffers...", "#cf94ff"), 800);
            setTimeout(() => {
                writeLog(">> server offline. Environment safe to close.", "#8ab4f8");
                isServerOnline = false;
            }, 2000);
        });
    }

    const mcCmdInput = document.getElementById('mc-cmd-input');
    const ghostText = document.getElementById('ghost-text');
    
    let cmdHistory = [];
    let historyIndex = -1;

    const playerTargetCommands = [
        "kick", "ban", "pardon", "op", "deop", 
        "whitelist add", "whitelist remove", "kill", "tp"
    ];

    if (mcCmdInput) {
        mcCmdInput.addEventListener('input', () => {
            const val = mcCmdInput.value;
            const lowerVal = val.toLowerCase();
            
            if (!val) {
                if (ghostText) ghostText.innerText = '';
                return;
            }

            const words = lowerVal.split(' ');
            const lastWord = words[words.length - 1];
            const baseCommand = val.substring(0, val.lastIndexOf(' ') + 1); 

            const isTargetingPlayer = playerTargetCommands.some(cmd => lowerVal.startsWith(cmd + ' '));

            if (isTargetingPlayer && lastWord.length > 0) {
                let playerMatch = currentOnlinePlayers.find(p => p.toLowerCase().startsWith(lastWord));
                if (!playerMatch) {
                    playerMatch = knownOfflinePlayers.find(p => p.toLowerCase().startsWith(lastWord));
                }

                if (playerMatch && ghostText) {
                    ghostText.innerText = baseCommand + val.substring(val.lastIndexOf(' ') + 1) + playerMatch.substring(lastWord.length);
                    return;
                }
            }

            if (!lowerVal.includes(' ') || playerTargetCommands.some(cmd => cmd.startsWith(lowerVal))) {
                if (typeof mcCommands !== 'undefined') {
                    const cmdMatch = mcCommands.find(cmd => cmd.toLowerCase().startsWith(lowerVal));
                    if (cmdMatch && ghostText) {
                        ghostText.innerText = val + cmdMatch.substring(val.length);
                        return;
                    }
                }
            }

            if (ghostText) ghostText.innerText = '';
        });

        mcCmdInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Tab') {
                e.preventDefault(); 
                if (ghostText && ghostText.innerText) {
                    mcCmdInput.value = ghostText.innerText;
                    ghostText.innerText = ''; 
                }
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (cmdHistory.length > 0 && historyIndex < cmdHistory.length - 1) {
                    historyIndex++;
                    mcCmdInput.value = cmdHistory[cmdHistory.length - 1 - historyIndex];
                }
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (historyIndex > 0) {
                    historyIndex--;
                    mcCmdInput.value = cmdHistory[cmdHistory.length - 1 - historyIndex];
                } else if (historyIndex === 0) {
                    historyIndex = -1;
                    mcCmdInput.value = ''; 
                }
            }

            if (e.key === 'Enter') {
                if (ghostText) ghostText.innerText = '';
                const command = mcCmdInput.value.trim();
                if (!command) return;

                if (cmdHistory[cmdHistory.length - 1] !== command) {
                    cmdHistory.push(command);
                }
                historyIndex = -1;

                writeLog(`> ${command}`, "#00ff66");
                mcCmdInput.value = '';

                try {
                    const res = await fetch('command.php', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ command: command })
                    });
                    
                    if (!res.ok) {
                        writeLog(">> ERROR: Unauthorized or command failed.", "#ff3333");
                        return;
                    }

                    const data = await res.json();
                    if (!data.success) {
                        writeLog(">> ERROR: Command failed. Is the server offline?", "#ff3333");
                    }
                } catch(e) {
                    writeLog(">> ERROR: Command backend unreachable.", "#ff3333");
                }
            }
        });
    }

    const cpuVal = document.getElementById('cpu-val');
    const ramVal = document.getElementById('ram-val');

    if (cpuVal && ramVal) {
        const fetchTelemetry = async () => {
            try {
                const res = await fetch('telemetry.php');
                if (!res.ok) return;
                const data = await res.json();
                
                const cpuBar = document.getElementById('cpu-bar');
                if(cpuVal && cpuBar) {
                    cpuVal.innerText = `${data.cpu}%`;
                    cpuBar.style.width = `${data.cpu}%`;
                }
                
                const ramBar = document.getElementById('ram-bar');
                if(ramVal && ramBar) {
                    ramVal.innerText = `${data.ram}%`;
                    ramBar.style.width = `${data.ram}%`;
                }
            } catch (error) {
                console.error("Failed to compile incoming telemetry:", error);
            }
        };
        
        fetchTelemetry();
        setInterval(fetchTelemetry, 3000);
    }

    // Public Transmission Message Handler (Bottom Box)
    const publicSendBtn = document.getElementById('public-send-btn');
    const publicMsgInput = document.getElementById('public-msg-input');
    const publicMsgStatus = document.getElementById('public-msg-status');

    if (publicSendBtn && publicMsgInput && publicMsgStatus) {
        publicSendBtn.addEventListener('click', async () => {
            const text = publicMsgInput.value.trim();
            if (!text) return;

            publicSendBtn.innerText = "TRANSMITTING...";
            publicMsgStatus.innerHTML = '';

            try {
                const res = await fetch('command.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: text })
                });
                
                const data = await res.json();
                
                if (data.success) {
                    publicMsgStatus.innerHTML = '<span style="color: #00ff66;">// TRANSMISSION DELIVERED</span>';
                    publicMsgInput.value = ''; 
                } else {
                    publicMsgStatus.innerHTML = `<span style="color: #ff3333;">// ERROR: ${data.error || 'Failed'}</span>`;
                }
            } catch (err) {
                publicMsgStatus.innerHTML = '<span style="color: #ff3333;">// UPLINK FAILURE: TARGET UNREACHABLE</span>';
            }

            setTimeout(() => { 
                publicSendBtn.innerText = ">_ TRANSMIT MESSAGE";
            }, 3000);
        });
    }

    const menuToggleBtn = document.getElementById('menu-toggle-btn');
    const dropdownMenu = document.getElementById('dropdown-menu');

    if(menuToggleBtn && dropdownMenu) {
        menuToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation(); 
            dropdownMenu.classList.toggle('hidden');
        });

        document.addEventListener('click', (e) => {
            if (!dropdownMenu.classList.contains('hidden') && 
                !dropdownMenu.contains(e.target) && 
                e.target !== menuToggleBtn) {
                dropdownMenu.classList.add('hidden');
            }
        });
    }

    const themeToggle = document.getElementById('theme-toggle');
    const themeLabel = document.getElementById('theme-label');

    if(themeToggle && themeLabel) {
        themeToggle.addEventListener('change', () => {
            if (themeToggle.checked) {
                document.body.classList.add('light-mode');
                themeLabel.textContent = 'MODE: LIGHT';
                window.matrixColor = '#008033'; 
            } else {
                document.body.classList.remove('light-mode');
                themeLabel.textContent = 'MODE: NIGHT';
                window.matrixColor = '#00ff66';
            }
        });
    }

    // Top Interactive Terminal Shell Handler (Mobile Optimized)
    const guestCmdInput = document.getElementById('guest-cmd-input');
    const guestTermLog = document.getElementById('guest-term-log');

    const printGuestLog = (text, color = "#00ff66") => {
        if (!guestTermLog) return;
        guestTermLog.innerHTML += `<p class="term-white" style="margin: 2px 0; color: ${color};">${text}</p>`;
        const termBox = document.getElementById('guest-term-box');
        if (termBox) termBox.scrollTop = termBox.scrollHeight;
    };

    if (guestCmdInput) {
        const executeGuestCommand = async () => {
            const rawVal = guestCmdInput.value.trim();
            const cmd = rawVal.toLowerCase();
            if (!rawVal) return;

            printGuestLog(`guest@vector-box:~$ ${rawVal}`, "#8ab4f8");
            guestCmdInput.value = '';

            if (cmd === 'help') {
                printGuestLog(">> COMMANDS: help | ip | scan | status | hack | matrix red | matrix cyan | matrix green | nuke | glitch | clear", "#00ff66");
            } else if (cmd === 'ip') {
                printGuestLog(">> Querying remote interface...", "#8ab4f8");
                try {
                    const res = await fetch('get_ip.php');
                    const data = await res.json();
                    printGuestLog(`>> CLIENT_IPV4: ${data.ip}`, "#00ff66");
                } catch (err) {
                    printGuestLog(">> ERROR: Failed to resolve client address.", "#ff3333");
                }
            } else if (cmd === 'scan') {
                printGuestLog(">> INITIATING SUBNET RECONNAISSANCE...", "#8ab4f8");
                setTimeout(() => printGuestLog(">> PORT 22 [SSH]: OPEN / ENCRYPTED", "#00ff66"), 400);
                setTimeout(() => printGuestLog(">> PORT 80 [HTTP]: OPEN / NGINX_APACHE", "#00ff66"), 800);
                setTimeout(() => printGuestLog(">> SCAN COMPLETE. 0 VULNERABILITIES FOUND.", "#8ab4f8"), 1200);
            } else if (cmd === 'status') {
                const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                const nodeType = isMobile ? "MOBILE_NODE" : "DESKTOP_NODE";
                printGuestLog(`>> DEVICE_TYPE: ${nodeType}`, "#00ffff");
                printGuestLog(`>> SCREEN_RES: ${window.innerWidth}x${window.innerHeight}`, "#00ffff");
                printGuestLog(`>> USER_AGENT: ${navigator.userAgent.substring(0, 35)}...`, "#00ffff");
            } else if (cmd === 'hack') {
                printGuestLog(">> REDIRECTING TO NODE BREACH...", "#00ff66");
                setTimeout(() => {
                    window.location.href = 'hack.html';
                }, 800);
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
            if (e.key === 'Enter') {
                e.preventDefault(); // Prevents jumping to the message box
                executeGuestCommand();
                guestCmdInput.blur(); // Closes soft keyboard cleanly on mobile
            }
        });
    }
});