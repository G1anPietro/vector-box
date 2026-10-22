// public/js/theme.js
(function () {
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

    // Expanded Theme Presets Registry with Electric Cyan
    const THEME_PRESETS = {
        'cyan':       { accent: '#00f3ff', border: 'rgba(0, 243, 255, 0.35)',  muted: '#70f8ff', prompt: '#00f3ff', matrix: '#00f3ff' },
        'matrix':     { accent: '#00ff66', border: 'rgba(0, 255, 102, 0.3)',   muted: '#00cc52', prompt: '#00ff66', matrix: '#00ff66' },
        'amber':      { accent: '#ffb000', border: 'rgba(255, 176, 0, 0.3)',   muted: '#cc8d00', prompt: '#ffb000', matrix: '#ffb000' },
        'cyberpunk':  { accent: '#ff007f', border: 'rgba(255, 0, 127, 0.4)',   muted: '#00f3ff', prompt: '#00f3ff', matrix: '#00f3ff' },
        'dracula':    { accent: '#bd93f9', border: 'rgba(189, 147, 249, 0.3)', muted: '#8be9fd', prompt: '#ff79c6', matrix: '#bd93f9' },
        'synthwave':  { accent: '#ff71ce', border: 'rgba(255, 113, 206, 0.4)', muted: '#01cdfe', prompt: '#05ffa1', matrix: '#ff71ce' },
        'nord':       { accent: '#88c0d0', border: 'rgba(136, 192, 208, 0.3)', muted: '#81a1c1', prompt: '#a3be8c', matrix: '#88c0d0' },
        'monochrome': { accent: '#ffffff', border: 'rgba(255, 255, 255, 0.3)', muted: '#aaaaaa', prompt: '#ffffff', matrix: '#ffffff' },
        'blood':      { accent: '#ff3333', border: 'rgba(255, 51, 51, 0.4)',   muted: '#cc0000', prompt: '#ff6666', matrix: '#ff3333' }
    };

    function applyTheme(themeName, customMatrixColor) {
        const preset = THEME_PRESETS[themeName] || THEME_PRESETS['matrix'];
        const root = document.documentElement;

        root.style.setProperty('--accent-color', preset.accent);
        root.style.setProperty('--border-color', preset.border);
        root.style.setProperty('--text-muted', preset.muted);
        root.style.setProperty('--prompt-color', preset.prompt);

        window.matrixColor = customMatrixColor || preset.matrix;
    }

    window.THEME_PRESETS = THEME_PRESETS;
    window.applySystemTheme = applyTheme;

    const savedTheme = getCookie("selected_theme") || 'cyan';
    const savedMatrixColor = getCookie("matrix_color");
    applyTheme(savedTheme, savedMatrixColor);

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
            if (window.matrixColor) setCookie("matrix_color", window.matrixColor);
            if (savedTheme) setCookie("selected_theme", savedTheme);
        });

        declineBtn?.addEventListener('click', () => {
            setConsent('declined');
        });
    });

    window.setSystemCookie = setCookie;
})();