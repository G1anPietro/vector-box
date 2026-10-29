// public/js/menu.js
document.addEventListener("DOMContentLoaded", () => {
    const menuToggleBtn = document.getElementById('menu-toggle-btn');
    const dropdownMenu = document.getElementById('dropdown-menu');

    const loginBtn = document.getElementById('menu-login-btn');
    const loginModal = document.getElementById('login-modal');
    const modalTitle = loginModal?.querySelector('h2');
    const userInput = document.getElementById('auth-user');
    const passwordInput = document.getElementById('auth-password');
    const errorLog = document.getElementById('login-err');
    const submitBtn = document.getElementById('submit-login-btn');

    const themeToggle = document.getElementById('theme-toggle');
    const themeLabel = document.getElementById('theme-label');
    const scanlineToggle = document.getElementById('scanline-toggle');
    const matrixSpeedSlider = document.getElementById('matrix-speed-slider');

    let authMode = 'login';

    function getCookie(name) {
        const match = document.cookie.match(new RegExp(`(?:^|; )${encodeURIComponent(name)}=([^;]*)`));
        return match ? decodeURIComponent(match[1]) : null;
    }

    const activeUser = getCookie('username');
    if (loginBtn) {
        if (activeUser) {
            loginBtn.textContent = `// LOGOUT [${activeUser}]`;
        } else {
            loginBtn.textContent = "// USER_ACCOUNT";
        }
    }

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

    // --- 2. Modal Controller ---
    const closeModal = () => {
        if (loginModal) loginModal.classList.add('hidden');
        if (errorLog) errorLog.textContent = '';
    };

    if (loginBtn && loginModal) {
        loginBtn.addEventListener('click', async () => {
            dropdownMenu?.classList.add('hidden');

            if (getCookie('username')) {
                try {
                    await fetch('api/logout.php', { method: 'POST', credentials: 'same-origin' });
                    document.cookie = "username=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
                    location.reload();
                } catch (err) {
                    console.error('Logout error:', err);
                }
                return;
            }

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

    // Toggle Login / Register
    let toggleAuthBtn = document.getElementById('toggle-auth-mode-btn');
    if (!toggleAuthBtn && loginModal) {
        toggleAuthBtn = document.createElement('button');
        toggleAuthBtn.id = 'toggle-auth-mode-btn';
        toggleAuthBtn.type = 'button';
        toggleAuthBtn.className = 'nav-btn';
        toggleAuthBtn.style.cssText = 'margin-top: 10px; width: 100%; font-size: 0.75rem;';
        toggleAuthBtn.textContent = 'Need an account? Register here';
        
        const modalContent = loginModal.querySelector('.modal-content');
        modalContent?.appendChild(toggleAuthBtn);

        toggleAuthBtn.addEventListener('click', () => {
            authMode = authMode === 'login' ? 'register' : 'login';
            if (modalTitle) modalTitle.textContent = authMode === 'login' ? 'ACCOUNT_LOGIN' : 'ACCOUNT_REGISTER';
            if (submitBtn) submitBtn.textContent = authMode === 'login' ? 'AUTHENTICATE' : 'CREATE ACCOUNT';
            toggleAuthBtn.textContent = authMode === 'login' ? 'Need an account? Register here' : 'Already have an account? Login';
            if (errorLog) errorLog.textContent = '';
        });
    }

    // --- 3. Process Authentication ---
    const processLogin = async () => {
        if (!userInput || !passwordInput || !errorLog) return;
        
        const username = userInput.value.trim();
        const password = passwordInput.value;

        if (!username || !password) {
            errorLog.textContent = ">> ERROR: Missing login credentials.";
            return;
        }

        errorLog.textContent = "// Querying account database...";
        if (submitBtn) submitBtn.disabled = true;

        try {
            const authRes = await fetch('api/login.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin', // Essential for session persistence across requests
                body: JSON.stringify({ action: authMode, username, password })
            });

            const data = await authRes.json();
            
            if (data.success) {
                // Save client cookie for UI display
                if (typeof window.setSystemCookie === 'function') {
                    window.setSystemCookie('username', data.username);
                }

                if (data.theme && typeof window.applySystemTheme === 'function') {
                    window.applySystemTheme(data.theme);
                }

                closeModal();
                location.reload();
            } else {
                errorLog.textContent = `>> ACCESS DENIED: ${data.error || 'Invalid authentication sequence.'}`;
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
    const contrastToggle = document.getElementById('contrast-toggle');

    // Mode & Display Toggles
    const savedTheme = localStorage.getItem('selected_theme') || 'cyan';
    const riceSelector = document.getElementById('rice-selector');
    if (riceSelector) {
        riceSelector.value = savedTheme;
    }

    if (contrastToggle) {
        const savedContrast = localStorage.getItem('high_contrast_mode') === 'true';
        contrastToggle.checked = savedContrast;
        document.body.classList.toggle('high-contrast', savedContrast);

        contrastToggle.addEventListener('change', () => {
            const isHighContrast = contrastToggle.checked;
            document.body.classList.toggle('high-contrast', isHighContrast);
            localStorage.setItem('high_contrast_mode', isHighContrast);
        });
    }

    scanlineToggle?.addEventListener('change', () => {
        document.body.classList.toggle('scanlines-active', scanlineToggle.checked);
    });

    matrixSpeedSlider?.addEventListener('input', (e) => {
        const delayMs = 80 - parseInt(e.target.value, 10);
        if (typeof window.updateMatrixSpeed === 'function') {
            window.updateMatrixSpeed(delayMs);
        }
    });
});