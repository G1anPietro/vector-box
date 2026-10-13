// --- Matrix Rain Canvas Effect ---
window.onload = () => {
    const canvas = document.getElementById("canvas");
    if (canvas) {
        const ctx = canvas.getContext("2d");
        canvas.height = window.innerHeight; 
        canvas.width = window.innerWidth;
        const alphabet = "0101010101ABCDEFGHIJKLMNOPQRSTUVWXYZ@#$<>[]".split("");
        const fontSize = 14; 
        const columns = canvas.width / fontSize;
        const rainDrops = Array(Math.floor(columns)).fill(1);

        function drawMatrix() {
            ctx.fillStyle = "rgba(6, 8, 12, 0.06)"; 
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = window.matrixColor || "#00ff66"; 
            ctx.font = fontSize + "px monospace";
            for (let i = 0; i < rainDrops.length; i++) {
                const text = alphabet[Math.floor(Math.random() * alphabet.length)];
                ctx.fillText(text, i * fontSize, rainDrops[i] * fontSize);
                if (rainDrops[i] * fontSize > canvas.height && Math.random() > 0.98) rainDrops[i] = 0;
                rainDrops[i]++;
            }
        }
        window.addEventListener('resize', () => { 
            canvas.width = window.innerWidth; 
            canvas.height = window.innerHeight; 
        });
        setInterval(drawMatrix, 35);
    }
};

document.addEventListener("DOMContentLoaded", () => {

    // --- Dropdown Menu Control ---
    const menuToggleBtn = document.getElementById('menu-toggle-btn');
    const dropdownMenu = document.getElementById('dropdown-menu');

    if (menuToggleBtn && dropdownMenu) {
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

    // --- Login Modal Controls ---
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

        loginModal.addEventListener('click', (e) => { 
            if (e.target === loginModal) loginModal.classList.add('hidden'); 
        });
    }

    const processLogin = async () => {
        if (!userInput || !passwordInput) return;
        const username = userInput.value.trim();
        const password = passwordInput.value;
        if (!username || !password) return;

        if (errorLog) errorLog.innerText = "// Authenticating...";
        
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
                if (errorLog) errorLog.innerText = `>> ACCESS DENIED: ${data.error || 'Invalid credentials.'}`;
            }
        } catch (err) {
            if (errorLog) errorLog.innerText = ">> CONNECTION ERROR";
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
            const formData = new FormData();
            formData.append('action', 'wakemainpc');
            
            try {
                const response = await fetch('dashboard.php', { method: 'POST', body: formData });
                const result = await response.json();
                if (result.success) {
                    alert(">> SUCCESS: Broadcast packet sent. Hardware target booting up.");
                } else {
                    alert(`>> EXCEPTION: ${result.error || 'Execution failed'}`);
                }
            } catch (err) {
                alert(">> ERROR: Failed to reach backend script.");
            }
            wakePcBtn.innerText = ">_ EXECUTE: wakemainpc";
        });
    }

    // --- Minecraft Action Controls ---
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
            writeLog(">> Triggering server launch sequence...", "#8ab4f8");
            const formData = new FormData();
            formData.append('action', 'start_mc');
            await fetch('dashboard.php', { method: 'POST', body: formData });
            setTimeout(() => writeLog(">> Server instance active in screen session.", "#00ff66"), 1500);
        });
    }

    if (mcStopBtn) {
        mcStopBtn.addEventListener('click', async () => {
            writeLog(">> Issuing server shutdown signal...", "#ff3333");
            const formData = new FormData();
            formData.append('action', 'stop_mc');
            await fetch('dashboard.php', { method: 'POST', body: formData });
            setTimeout(() => writeLog(">> Server instance terminated.", "#8ab4f8"), 1500);
        });
    }

    // --- Live System Telemetry Polling ---
    const cpuVal = document.getElementById('cpu-val');
    const cpuBar = document.getElementById('cpu-bar');
    const ramVal = document.getElementById('ram-val');
    const ramBar = document.getElementById('ram-bar');

    if (cpuVal && ramVal) {
        const fetchTelemetry = async () => {
            try {
                const res = await fetch('telemetry.php');
                if (!res.ok) return;
                const data = await res.json();
                
                cpuVal.innerText = `${data.cpu}%`;
                cpuBar.style.width = `${data.cpu}%`;
                ramVal.innerText = `${data.ram}%`;
                ramBar.style.width = `${data.ram}%`;
            } catch (err) {
                console.error("Telemetry fetch error:", err);
            }
        };

        fetchTelemetry();
        setInterval(fetchTelemetry, 3000); // Refresh telemetry every 3 seconds
    }

    // --- Console Command Input Engine ---
    const mcCmdInput = document.getElementById('mc-cmd-input');
    if (mcCmdInput) {
        mcCmdInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                const command = mcCmdInput.value.trim();
                if (!command) return;

                writeLog(`> ${command}`, "#00ff66");
                mcCmdInput.value = '';

                try {
                    const res = await fetch('command.php', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ command })
                    });
                    const data = await res.json();
                    if (!data.success) {
                        writeLog(">> ERROR: Command failed to dispatch.", "#ff3333");
                    }
                } catch (err) {
                    writeLog(">> ERROR: Could not transmit command.", "#ff3333");
                }
            }
        });
    }

    // --- Theme Toggle Controls ---
    const themeToggle = document.getElementById('theme-toggle');
    const themeLabel = document.getElementById('theme-label');

    if (themeToggle && themeLabel) {
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
});