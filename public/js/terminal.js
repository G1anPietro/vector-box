document.addEventListener("DOMContentLoaded", () => {
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
                const nodeType = isMobile ? "MOBILE_NODE" : "DESKTOP_NODE";
                printGuestLog(`>> DEVICE_TYPE: ${nodeType}`, "#00ffff");
                printGuestLog(`>> SCREEN_RES: ${window.innerWidth}x${window.innerHeight}`, "#00ffff");
                printGuestLog(`>> USER_AGENT: ${navigator.userAgent.substring(0, 35)}...`, "#00ffff");
            } else if (cmd === 'hack') {
                printGuestLog(">> REDIRECTING TO NODE BREACH...", "#00ff66");
                setTimeout(() => { window.location.href = 'hack.html'; }, 800);
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

            if (!('ontouchstart' in window || navigator.maxTouchPoints > 0)) {
                guestCmdInput.focus();
            }
        };

        guestCmdInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                executeGuestCommand();
            }
        });
    }
});