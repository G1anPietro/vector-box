// public/menu.js
document.addEventListener("DOMContentLoaded", () => {
    // Primary DOM Cache
    const menuToggleBtn = document.getElementById('menu-toggle-btn');
    const dropdownMenu = document.getElementById('dropdown-menu');

    const loginBtn = document.getElementById('menu-login-btn');
    const loginModal = document.getElementById('login-modal');
    const userInput = document.getElementById('auth-user');
    const passwordInput = document.getElementById('auth-password');
    const errorLog = document.getElementById('login-err');
    const submitBtn = document.getElementById('submit-login-btn');

    const themeToggle = document.getElementById('theme-toggle');
    const themeLabel = document.getElementById('theme-label');
    const scanlineToggle = document.getElementById('scanline-toggle');
    const matrixSpeedSlider = document.getElementById('matrix-speed-slider');

    // --- 1. Dropdown Menu Controller ---
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

    // --- 2. Modal Login Controller ---
    const closeModal = () => {
        if (loginModal) loginModal.classList.add('hidden');
    };

    if (loginBtn && loginModal) {
        loginBtn.addEventListener('click', () => {
            dropdownMenu?.classList.add('hidden');
            loginModal.classList.remove('hidden');
            userInput?.focus();
        });

        loginModal.addEventListener('click', (e) => { 
            if (e.target === loginModal) closeModal(); 
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !loginModal.classList.contains('hidden')) {
                closeModal();
            }
        });
    }

    // --- 3. Authentication Processing ---
    const processLogin = async () => {
        if (!userInput || !passwordInput || !errorLog) return;
        
        const username = userInput.value.trim();
        const password = passwordInput.value;

        if (!username || !password) {
            errorLog.textContent = ">> ERROR: Missing login credentials.";
            return;
        }

        errorLog.textContent = "// Querying verification clusters...";
        if (submitBtn) submitBtn.disabled = true;

        try {
            const authRes = await fetch('api/login.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await authRes.json();
            
            if (data.success) {
                window.location.href = 'pages/dashboard.php';
            } else {
                errorLog.textContent = `>> ACCESS DENIED: ${data.error || 'Invalid credentials sequence.'}`;
            }
        } catch (err) {
            errorLog.textContent = ">> CONNECTION ERROR";
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    };

    if (submitBtn) submitBtn.addEventListener('click', processLogin);
    
    passwordInput?.addEventListener('keydown', (e) => { 
        if (e.key === 'Enter') processLogin(); 
    });

    userInput?.addEventListener('keydown', (e) => { 
        if (e.key === 'Enter') passwordInput?.focus(); 
    });

    // --- 4. Mode & Display Toggles ---
    if (themeToggle && themeLabel) {
        themeToggle.addEventListener('change', () => {
            const isLight = themeToggle.checked;
            document.body.classList.toggle('light-mode', isLight);
            themeLabel.textContent = isLight ? 'MODE: LIGHT' : 'MODE: NIGHT';
            
            window.matrixColor = isLight ? '#008033' : '#00ff66';
            if (typeof window.setSystemCookie === 'function') {
                window.setSystemCookie('theme_mode', isLight ? 'light' : 'night');
            }
        });
    }

    // CRT Scanlines Toggle
    scanlineToggle?.addEventListener('change', () => {
        document.body.classList.toggle('scanlines-active', scanlineToggle.checked);
    });

    // Matrix Speed Control
    matrixSpeedSlider?.addEventListener('input', (e) => {
        const delayMs = 80 - parseInt(e.target.value, 10);
        if (typeof window.updateMatrixSpeed === 'function') {
            window.updateMatrixSpeed(delayMs);
        }
    });
});