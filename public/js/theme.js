// public/js/theme.js
(function () {
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
        const preset = THEME_PRESETS[themeName] || THEME_PRESETS['cyan'];
        const root = document.documentElement;

        root.style.setProperty('--accent-color', preset.accent);
        root.style.setProperty('--border-color', preset.border);
        root.style.setProperty('--text-muted', preset.muted);
        root.style.setProperty('--prompt-color', preset.prompt);

        window.matrixColor = customMatrixColor || preset.matrix;

        fetch('api/save_theme.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ theme: themeName })
        }).catch(() => {});
    }

    window.THEME_PRESETS = THEME_PRESETS;
    window.applySystemTheme = applyTheme;

    // Apply saved theme using global cookie reader
    const savedTheme = (window.getSystemCookie && window.getSystemCookie("selected_theme")) || 'cyan';
    const savedMatrixColor = window.getSystemCookie && window.getSystemCookie("matrix_color");
    applyTheme(savedTheme, savedMatrixColor);
})();