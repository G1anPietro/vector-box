// public/js/theme.js
(function () {
    const THEME_PRESETS = {
        'cyan':       { accent: '#00f3ff', border: 'rgba(0, 243, 255, 0.45)',  muted: '#8ab4f8', prompt: '#00f3ff', matrix: '#00f3ff' },
        'matrix':     { accent: '#00ff66', border: 'rgba(0, 255, 102, 0.45)',  muted: '#55ff99', prompt: '#00ff66', matrix: '#00ff66' },
        'cyberpunk':  { accent: '#ff007f', border: 'rgba(255, 0, 127, 0.55)',  muted: '#ffe600', prompt: '#00f3ff', matrix: '#ff007f' },
        'amber':      { accent: '#ffb000', border: 'rgba(255, 176, 0, 0.45)',  muted: '#ffd166', prompt: '#ffb000', matrix: '#ffb000' },
        'dracula':    { accent: '#bd93f9', border: 'rgba(189, 147, 249, 0.45)', muted: '#d6acff', prompt: '#ff79c6', matrix: '#bd93f9' },
        'synthwave':  { accent: '#ff71ce', border: 'rgba(255, 113, 206, 0.5)',  muted: '#70f8ff', prompt: '#05ffa1', matrix: '#ff71ce' },
        'nord':       { accent: '#88c0d0', border: 'rgba(136, 192, 208, 0.45)', muted: '#e5e9f0', prompt: '#a3be8c', matrix: '#88c0d0' },
        'monochrome': { accent: '#ffffff', border: 'rgba(255, 255, 255, 0.45)', muted: '#e0e0e0', prompt: '#ffffff', matrix: '#ffffff' },
        'blood':      { accent: '#ff4d6d', border: 'rgba(255, 77, 109, 0.55)', muted: '#ff99a8', prompt: '#ff4d6d', matrix: '#ff4d6d' }
    };

    function getDirectCookie(name) {
        const match = document.cookie.match(new RegExp(`(?:^|; )${encodeURIComponent(name)}=([^;]*)`));
        return match ? decodeURIComponent(match[1]) : null;
    }

    function applyTheme(themeName, customMatrixColor) {
        const preset = THEME_PRESETS[themeName] || THEME_PRESETS['cyan'];
        const root = document.documentElement;

        root.style.setProperty('--accent-color', preset.accent);
        root.style.setProperty('--border-color', preset.border);
        root.style.setProperty('--text-muted', preset.muted);
        root.style.setProperty('--prompt-color', preset.prompt);
        
        root.setAttribute('data-rice', themeName);
        if (document.body) {
            document.body.setAttribute('data-rice', themeName);
        }

        window.matrixColor = customMatrixColor || preset.matrix;

        try {
            localStorage.setItem('selected_theme', themeName);
            localStorage.setItem('selected_rice', themeName);
        } catch (e) {}

        document.cookie = `selected_theme=${encodeURIComponent(themeName)}; path=/; max-age=31536000; SameSite=Lax`;
    }

    window.THEME_PRESETS = THEME_PRESETS;
    window.applySystemTheme = applyTheme;

    const savedTheme = localStorage.getItem('selected_theme') || getDirectCookie('selected_theme') || 'cyberpunk';
    applyTheme(savedTheme);

    document.addEventListener("DOMContentLoaded", () => {
        if (document.body) {
            document.body.setAttribute('data-rice', savedTheme);
        }

        // 1. Rice Selector
        const riceSelector = document.getElementById('rice-selector');
        if (riceSelector) {
            riceSelector.value = savedTheme;
            riceSelector.addEventListener('change', (e) => {
                applyTheme(e.target.value);
            });
        }

        // 2. High Contrast Toggle
        const contrastToggle = document.getElementById('contrast-toggle');
        if (contrastToggle) {
            const isHighContrast = localStorage.getItem('high_contrast') === 'true';
            contrastToggle.checked = isHighContrast;
            if (isHighContrast) document.body.classList.add('high-contrast');

            contrastToggle.addEventListener('change', (e) => {
                if (e.target.checked) {
                    document.body.classList.add('high-contrast');
                    localStorage.setItem('high_contrast', 'true');
                } else {
                    document.body.classList.remove('high-contrast');
                    localStorage.setItem('high_contrast', 'false');
                }
            });
        }

        // 3. Scanline Effect Toggle
        const scanlineToggle = document.getElementById('scanline-toggle');
        if (scanlineToggle) {
            const isScanlines = localStorage.getItem('scanlines_active') === 'true';
            scanlineToggle.checked = isScanlines;
            if (isScanlines) document.body.classList.add('scanlines-active');

            scanlineToggle.addEventListener('change', (e) => {
                if (e.target.checked) {
                    document.body.classList.add('scanlines-active');
                    localStorage.setItem('scanlines_active', 'true');
                } else {
                    document.body.classList.remove('scanlines-active');
                    localStorage.setItem('scanlines_active', 'false');
                }
            });
        }
    });
})();