// --- Complete Integrated Matrix Backdrop Array ---
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
            ctx.fillStyle = "#00ff66"; ctx.font = fontSize + "px monospace";
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
    // Check core authorization profiles from backend handshake
    const sessionRes = await fetch('/api/session');
    const currentUser = await sessionRes.json();

    // --- Dashboard View State Interceptor ---
    if (window.location.pathname.includes('dashboard.html')) {
        if (!currentUser) {
            window.location.href = '/index.html';
            return;
        }
        
        document.getElementById('dash-welcome').innerText = `// PROFILED_LAYER: ${currentUser.name.toUpperCase()}`;
        
        // Hide/Show hardware grids explicitly based on security profile assignments
        const pcPanel = document.getElementById('pc-panel');
        if (pcPanel) {
            if (currentUser.role === 'admin') {
                pcPanel.classList.remove('hidden');
            } else {
                pcPanel.classList.add('hidden'); // Guests physically see no power loops
            }
        }
    }

    // --- Modal Portal Triggers ---
    const loginBtn = document.getElementById('menu-login-btn');
    const loginModal = document.getElementById('login-modal');
    const userInput = document.getElementById('auth-user');
    const passwordInput = document.getElementById('auth-password');
    const errorLog = document.getElementById('login-err');
    const submitBtn = document.getElementById('submit-login-btn');

    if (loginBtn) {
        loginBtn.addEventListener('click', () => {
            loginModal.classList.remove('hidden');
            if (userInput) userInput.focus();
        });
    }

    if (loginModal) {
        loginModal.addEventListener('click', (e) => { if (e.target === loginModal) loginModal.classList.add('hidden'); });
    }

    const processLogin = async () => {
        const username = userInput.value.trim();
        const password = passwordInput.value;
        if (!username || !password) return;

        errorLog.innerText = "// Querying verification clusters...";
        
        const authRes = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await authRes.json();
        if (data.success) {
            window.location.href = '/dashboard.html';
        } else {
            errorLog.innerText = `>> ACCESS DENIED: ${data.error || 'Invalid credentials sequence.'}`;
        }
    };

    if (submitBtn) submitBtn.addEventListener('click', processLogin);
    if (passwordInput) passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') processLogin(); });
    if (userInput) userInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') passwordInput.focus(); });

    // --- Hardware Power Hook ---
    const wakePcBtn = document.getElementById('wake-pc-btn');
    if (wakePcBtn) {
        wakePcBtn.addEventListener('click', async () => {
            wakePcBtn.innerText = "TRANSMITTING WOL PACKET...";
            const response = await fetch('/api/action/wakemainpc', { method: 'POST' });
            const result = await response.json();
            if (result.success) {
                alert(">> SUCCESS: Broadcast packet sent. Hardware target booting up.");
            } else {
                alert(`>> EXCEPTION: ${result.error}`);
            }
            wakePcBtn.innerText = ">_ EXECUTE: wakemainpc";
        });
    }

    // --- State-Aware Minecraft Console Engine ---
    let isServerOnline = false; // Internal tracking engine
    // --- Player Tracking Memory ---
    let currentOnlinePlayers = []; 
    let knownOfflinePlayers = ["denys", "zuffi", "steve", "alex"]; // Base dictionary of known operatives
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
            
            // Dispatch real process signal asynchronously to backend endpoint
            fetch('/api/action/minecraft', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'start' })
            });

            // Timed sequences for simulated shell feedback verbosity
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

            const res = await fetch('/api/action/minecraft', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'stop' })
            });
            const result = await res.json();

            setTimeout(() => writeLog(">> saving data blocks and flush storage buffers...", "#cf94ff"), 800);
            setTimeout(() => {
                writeLog(">> server offline. Environment safe to close.", "#8ab4f8");
                isServerOnline = false;
            }, 2000);
        });
    }

    // --- Live Console Input Engine (Upgraded) ---
    const mcCmdInput = document.getElementById('mc-cmd-input');
    
    // Command History Memory
    let cmdHistory = [];
    let historyIndex = -1;

    // Custom Autocomplete Dictionary
    const ghostText = document.getElementById('ghost-text');
    const playerTargetCommands = [
        "kick", "ban", "pardon", "op", "deop", 
        "whitelist add", "whitelist remove", "kill", "tp"
    ];

    if (mcCmdInput) {
        mcCmdInput.addEventListener('input', () => {
            const val = mcCmdInput.value;
            const lowerVal = val.toLowerCase();
            
            if (!val) {
                ghostText.innerText = '';
                return;
            }

            // Break input into chunks to analyze the current argument
            const words = lowerVal.split(' ');
            const lastWord = words[words.length - 1];
            
            // Preserve the original casing for everything before the word currently being typed
            const baseCommand = val.substring(0, val.lastIndexOf(' ') + 1); 

            // 1. IS IT A PLAYER-TARGETED COMMAND?
            const isTargetingPlayer = playerTargetCommands.some(cmd => lowerVal.startsWith(cmd + ' '));

            if (isTargetingPlayer && lastWord.length > 0) {
                // Prioritize online players first, then fall back to offline history
                let playerMatch = currentOnlinePlayers.find(p => p.toLowerCase().startsWith(lastWord));
                
                if (!playerMatch) {
                    playerMatch = knownOfflinePlayers.find(p => p.toLowerCase().startsWith(lastWord));
                }

                if (playerMatch) {
                    // Combine the base command + what the user typed + the ghost completion
                    ghostText.innerText = baseCommand + val.substring(val.lastIndexOf(' ') + 1) + playerMatch.substring(lastWord.length);
                    return;
                }
            }

            // 2. STANDARD COMMAND AUTOCOMPLETE
            // Only trigger if we haven't typed a space yet (meaning we are still typing the base command)
            if (!lowerVal.includes(' ') || playerTargetCommands.some(cmd => cmd.startsWith(lowerVal))) {
                const cmdMatch = mcCommands.find(cmd => cmd.toLowerCase().startsWith(lowerVal));
                if (cmdMatch) {
                    ghostText.innerText = val + cmdMatch.substring(val.length);
                    return;
                }
            }

            // No matches found
            ghostText.innerText = '';
        });

        mcCmdInput.addEventListener('keydown', async (e) => {
            
            // 1. AUTOCOMPLETE (Tab Key)
            if (e.key === 'Tab') {
                e.preventDefault(); 
                if (ghostText.innerText) {
                    mcCmdInput.value = ghostText.innerText;
                    ghostText.innerText = ''; // Clear ghost text after applying
                }
            }
            // 2. COMMAND HISTORY (Up/Down Arrows)
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (cmdHistory.length > 0 && historyIndex < cmdHistory.length - 1) {
                    historyIndex++;
                    // Read array backwards so index 0 is the most recent command
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
                    mcCmdInput.value = ''; // Clear input if we scroll back to the present
                }
            }

            // 3. EXECUTE COMMAND (Enter Key)
            if (e.key === 'Enter') {
                ghostText.innerText = '';
                const command = mcCmdInput.value.trim();
                if (!command) return;

                // Save to history and reset index
                if (cmdHistory[cmdHistory.length - 1] !== command) {
                    cmdHistory.push(command);
                }
                historyIndex = -1;

                writeLog(`> ${command}`, "#00ff66");
                mcCmdInput.value = '';

                const res = await fetch('/api/command', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ command: command })
                });

                const data = await res.json();
                if (!data.success) {
                    writeLog(">> ERROR: Command failed. Is the server offline?", "#ff3333");
                }
            }
        });
    }

// --- Live Server Output & Telemetry Listener (Upgraded for Named Events) ---
    const stream = new EventSource('/api/stream');
    
    // Catch standard console log stream messages
    stream.addEventListener('log', (event) => {
        const logData = event.data.trim(); 
        if (logData) {
            writeLog(logData, "#ffffff");
        }
    });

    // Catch system resource telemetry packets
    stream.addEventListener('telemetry', (event) => {
        try {
            const telemetry = JSON.parse(event.data);
            
            // Re-render CPU tracking components
            document.getElementById('cpu-val').innerText = `${telemetry.cpu}%`;
            document.getElementById('cpu-bar').style.width = `${telemetry.cpu}%`;
            
            // Re-render RAM tracking components
            document.getElementById('ram-val').innerText = `${telemetry.ram}%`;
            document.getElementById('ram-bar').style.width = `${telemetry.ram}%`;
            
        } catch (error) {
            console.error("Failed to compile incoming telemetry block matrix:", error);
        }
    });

    stream.addEventListener('players', (event) => {
        try {
            const players = JSON.parse(event.data);
            currentOnlinePlayers = players;
            
            // Learn new players for offline autocomplete memory
            players.forEach(p => {
                if (!knownOfflinePlayers.includes(p)) {
                    knownOfflinePlayers.push(p);
                }
            });

            // Re-render UI
            const container = document.getElementById('player-list-container');
            if (players.length === 0) {
                container.innerHTML = '<span style="color: #555;">// NO_PLAYERS_DETECTED</span>';
                return;
            }
            container.innerHTML = players.map(p => 
                `<span style="background: rgba(0,255,102,0.1); border: 1px solid var(--accent-color); color: var(--accent-color); padding: 2px 8px; border-radius: 2px; font-size: 0.85rem;">${p}</span>`
            ).join('');
        } catch (err) {
            console.error("Player array parsing error:", err);
        }
    });

    // ==========================================
    // PUBLIC TRANSMISSION TERMINAL UPLINK
    // ==========================================
    const publicSendBtn = document.getElementById('public-send-btn');
    const publicMsgInput = document.getElementById('public-msg-input');
    const publicMsgStatus = document.getElementById('public-msg-status');

    if (publicSendBtn && publicMsgInput) {
        publicSendBtn.addEventListener('click', async () => {
            const text = publicMsgInput.value.trim();
            if (!text) return;

            publicSendBtn.innerText = "TRANSMITTING...";
            publicMsgStatus.innerHTML = '';

            try {
                const res = await fetch('/api/message', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: text })
                });
                
                const data = await res.json();
                
                if (data.success) {
                    publicMsgStatus.innerHTML = '<span style="color: #00ff66;">// TRANSMISSION DELIVERED</span>';
                    publicMsgInput.value = ''; // Clear the input field
                } else {
                    // Display the dynamic error (Spam warnings, lockout durations, permanent ban alerts)
                    publicMsgStatus.innerHTML = `<span style="color: #ff3333;">// ERROR: ${data.error}</span>`;
                }
            } catch (err) {
                publicMsgStatus.innerHTML = '<span style="color: #ff3333;">// UPLINK FAILURE: TARGET UNREACHABLE</span>';
            }

            // Restore button text after 3 seconds
            setTimeout(() => { 
                publicSendBtn.innerText = ">_ TRANSMIT MESSAGE";
            }, 3000);
        });
    }

    // Dropdown Menu Toggling Logic
    const menuToggleBtn = document.getElementById('menu-toggle-btn');
    const dropdownMenu = document.getElementById('dropdown-menu');

    menuToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Avoid immediately triggering the document click handler
        dropdownMenu.classList.toggle('hidden');
    });

    // Close dropdown automatically if you click anywhere else on the page
    document.addEventListener('click', (e) => {
        if (!dropdownMenu.classList.contains('hidden') && 
            !dropdownMenu.contains(e.target) && 
            e.target !== menuToggleBtn) {
            dropdownMenu.classList.add('hidden');
        }
    });

    // Light / Night Mode Theme Switching Logic
    const themeToggle = document.getElementById('theme-toggle');
    const themeLabel = document.getElementById('theme-label');

    themeToggle.addEventListener('change', () => {
        if (themeToggle.checked) {
            document.body.classList.add('light-mode');
            themeLabel.textContent = 'MODE: LIGHT';
            
            // Dynamic Matrix Inversion: Tells your canvas script to print darker characters
            if (typeof window.matrixColor !== 'undefined') {
                window.matrixColor = '#008033'; 
            }
        } else {
            document.body.classList.remove('light-mode');
            themeLabel.textContent = 'MODE: NIGHT';
            
            if (typeof window.matrixColor !== 'undefined') {
                window.matrixColor = '#00ff66';
            }
        }
    });
});