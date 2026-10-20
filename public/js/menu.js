document.addEventListener("DOMContentLoaded", () => {
    // Menu Dropdown Controller
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

    // Modal Login Trigger
    const loginBtn = document.getElementById('menu-login-btn');
    const loginModal = document.getElementById('login-modal');
    const userInput = document.getElementById('auth-user');
    const passwordInput = document.getElementById('auth-password');
    const errorLog = document.getElementById('login-err');
    const submitBtn = document.getElementById('submit-login-btn');

    if (loginBtn && loginModal) {
        loginBtn.addEventListener('click', () => {
            if (dropdownMenu) dropdownMenu.classList.add('hidden');
            loginModal.classList.remove('hidden');
            if (userInput) userInput.focus();
        });
    }

    if (loginModal) {
        loginModal.addEventListener('click', (e) => { 
            if (e.target === loginModal) loginModal.classList.add('hidden'); 
        });
    }

    const processLogin = async () => {
        if (!userInput || !passwordInput || !errorLog) return;
        const username = userInput.value.trim();
        const password = passwordInput.value;
        if (!username || !password) return;

        errorLog.innerText = "// Querying verification clusters...";
        
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
                errorLog.innerText = `>> ACCESS DENIED: ${data.error || 'Invalid credentials sequence.'}`;
            }
        } catch (err) {
            errorLog.innerText = ">> CONNECTION ERROR";
        }
    };

    if (submitBtn) submitBtn.addEventListener('click', processLogin);
    if (passwordInput) passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') processLogin(); });
    if (userInput) userInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') passwordInput.focus(); });

    // Mode Switcher
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