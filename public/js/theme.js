// public/theme.js
(function () {
    // Cookie Utility Helpers
    function getCookie(name) {
        const match = document.cookie.match(new RegExp(`(?:^|; )${encodeURIComponent(name)}=([^;]*)`));
        return match ? decodeURIComponent(match[1]) : null;
    }

    function setCookie(name, value, days = 30) {
        if (getCookie("cookie_consent") !== "accepted") return;
        const date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        const isSecure = window.location.protocol === 'https:' ? ';Secure' : '';
        document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)};expires=${date.toUTCString()};path=/;SameSite=Lax${isSecure}`;
    }

    // Theme Presets Registry
    const THEME_PRESETS = {
        'amber': { accent: '#ffb000', border: 'rgba(255, 176, 0, 0.3)', matrix: '#ffb000' },
        'cyberpunk': { accent: '#ff007f', border: 'rgba(0, 243, 255, 0.4)', matrix: '#00f3ff' },
        'dracula': { accent: '#bd93f9', border: 'rgba(189, 147, 249, 0.3)', matrix: '#bd93f9' },
        'matrix': { accent: '#00ff66', border: 'rgba(0, 255, 102, 0.25)', matrix: '#00ff66' }
    };

    // Helper: Apply Theme to DOM Root
    function applyTheme(themeName, customMatrixColor) {
        const preset = THEME_PRESETS[themeName];
        if (preset) {
            const root = document.documentElement;
            root.style.setProperty('--accent-color', preset.accent);
            root.style.setProperty('--border-color', preset.border);
            window.matrixColor = customMatrixColor || preset.matrix;
        } else if (customMatrixColor) {
            window.matrixColor = customMatrixColor;
        }
    }

    // 1. IMMEDIATE EXECUTION: Apply themes synchronously to eliminate FOUC
    const savedTheme = getCookie("selected_theme");
    const savedMatrixColor = getCookie("matrix_color");
    applyTheme(savedTheme, savedMatrixColor);

    // 2. DOM INITIALIZATION: Cookie Banner Setup
    document.addEventListener("DOMContentLoaded", () => {
        const cookieBanner = document.getElementById('cookie-banner');
        const acceptBtn = document.getElementById('cookie-accept-btn');
        const declineBtn = document.getElementById('cookie-decline-btn');
        const consentStatus = getCookie("cookie_consent");

        if (!consentStatus && cookieBanner) {
            cookieBanner.classList.remove('hidden');
        }

        const setConsent = (status) => {
            const date = new Date();
            date.setTime(date.getTime() + (365 * 24 * 60 * 60 * 1000));
            const isSecure = window.location.protocol === 'https:' ? ';Secure' : '';
            document.cookie = `cookie_consent=${status};expires=${date.toUTCString()};path=/;SameSite=Lax${isSecure}`;
            
            cookieBanner?.classList.add('hidden');
        };

        acceptBtn?.addEventListener('click', () => {
            setConsent('accepted');
            // Save active system configurations post-consent acceptance
            if (window.matrixColor) setCookie("matrix_color", window.matrixColor);
            if (savedTheme) setCookie("selected_theme", savedTheme);
        });

        declineBtn?.addEventListener('click', () => {
            setConsent('declined');
        });
    });

    // Expose cookie setter globally for terminal execution access
    window.setSystemCookie = setCookie;
})();