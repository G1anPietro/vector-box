// public/js/theme.js
(function () {
    const THEME_PRESETS = {
        'cyan':       { accent: '#00f3ff', border: 'rgba(0, 243, 255, 0.35)',  muted: '#70f8ff', prompt: '#00f3ff', matrix: '#00f3ff' },
        'matrix':     { accent: '#00ff66', border: 'rgba(0, 255, 102, 0.35)',  muted: '#00cc52', prompt: '#00ff66', matrix: '#00ff66' },
        'cyberpunk':  { accent: '#ff007f', border: 'rgba(255, 0, 127, 0.45)',  muted: '#ffcc00', prompt: '#00f3ff', matrix: '#ff007f' },
        'amber':      { accent: '#ffb000', border: 'rgba(255, 176, 0, 0.3)',   muted: '#cc8d00', prompt: '#ffb000', matrix: '#ffb000' },
        'dracula':    { accent: '#bd93f9', border: 'rgba(189, 147, 249, 0.3)', muted: '#8be9fd', prompt: '#ff79c6', matrix: '#bd93f9' },
        'synthwave':  { accent: '#ff71ce', border: 'rgba(255, 113, 206, 0.4)', muted: '#01cdfe', prompt: '#05ffa1', matrix: '#ff71ce' },
        'nord':       { accent: '#88c0d0', border: 'rgba(136, 192, 208, 0.3)', muted: '#81a1c1', prompt: '#a3be8c', matrix: '#88c0d0' },
        'monochrome': { accent: '#ffffff', border: 'rgba(255, 255, 255, 0.3)', muted: '#aaaaaa', prompt: '#ffffff', matrix: '#ffffff' },
        'blood':      { accent: '#ff3333', border: 'rgba(255, 51, 51, 0.4)',   muted: '#cc0000', prompt: '#ff6666', matrix: '#ff3333' }
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

    const savedTheme = localStorage.getItem('selected_theme') || getDirectCookie('selected_theme') || 'cyan';
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