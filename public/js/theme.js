// public/js/theme.js — the desktop themes: one list, used by the menu, the terminal (`theme`, `rice`) and the account settings.
// The ids must match SYSTEM_THEMES in api/helpers.php (tests/temi.test.js checks it). A logged-in user's theme is saved on the
// account (api/save_theme.php) and written into <meta name="vb-theme"> by the server, so every device and every place agree.
(function () {
    const DEFAULT_THEME = 'monochrome';
    // bg = page, panel = windows, accent = main colour, muted = secondary text, prompt = terminal prompt, matrix = background rain
    const THEMES = {
        monochrome: { label: 'Monocromatico', bg: '#050505', accent: '#f2f2f2', muted: '#b5b5b5', prompt: '#ffffff', panel: 'rgba(12, 12, 12, 0.95)', matrix: '#cfcfcf' },
        cyan:       { label: 'Cyan',          bg: '#06080c', accent: '#00f3ff', muted: '#8ab4f8', prompt: '#00f3ff', panel: 'rgba(10, 14, 22, 0.95)', matrix: '#00f3ff' },
        matrix:     { label: 'Matrix',        bg: '#020b05', accent: '#00ff66', muted: '#55ff99', prompt: '#00ff66', panel: 'rgba(2, 16, 8, 0.96)', matrix: '#00ff66' },
        amber:      { label: 'Amber',         bg: '#0c0800', accent: '#ffb000', muted: '#ffd166', prompt: '#ffb000', panel: 'rgba(20, 13, 0, 0.95)', matrix: '#ffb000' },
        cyberpunk:  { label: 'Cyberpunk',     bg: '#0d020d', accent: '#ff007f', muted: '#ffea70', prompt: '#00f3ff', panel: 'rgba(20, 3, 20, 0.95)', matrix: '#ff007f' },
        dracula:    { label: 'Dracula',       bg: '#282a36', accent: '#bd93f9', muted: '#d6acff', prompt: '#ff79c6', panel: 'rgba(40, 42, 54, 0.95)', matrix: '#bd93f9' },
        synthwave:  { label: 'Synthwave',     bg: '#1a102f', accent: '#ff71ce', muted: '#70f8ff', prompt: '#05ffa1', panel: 'rgba(24, 14, 46, 0.95)', matrix: '#ff71ce' },
        nord:       { label: 'Nord',          bg: '#2e3440', accent: '#88c0d0', muted: '#e5e9f0', prompt: '#a3be8c', panel: 'rgba(43, 48, 59, 0.95)', matrix: '#88c0d0' },
        blood:      { label: 'Blood',         bg: '#120204', accent: '#ff4d6d', muted: '#ff99a8', prompt: '#ff4d6d', panel: 'rgba(24, 4, 8, 0.96)', matrix: '#ff4d6d' },
        catppuccin: { label: 'Catppuccin',    bg: '#1e1e2e', accent: '#cba6f7', muted: '#b4befe', prompt: '#f5e0dc', panel: 'rgba(30, 30, 46, 0.95)', matrix: '#cba6f7' },
        gruvbox:    { label: 'Gruvbox',       bg: '#282828', accent: '#fabd2f', muted: '#fe8019', prompt: '#b8bb26', panel: 'rgba(60, 56, 54, 0.95)', matrix: '#fabd2f' },
        solarized:  { label: 'Solarized',     bg: '#002b36', accent: '#2aa198', muted: '#93a1a1', prompt: '#b58900', panel: 'rgba(0, 43, 54, 0.95)', matrix: '#2aa198' },
        tokyonight: { label: 'Tokyo Night',   bg: '#1a1b26', accent: '#7aa2f7', muted: '#a9b1d6', prompt: '#bb9af7', panel: 'rgba(26, 27, 38, 0.95)', matrix: '#7aa2f7' },
        rosepine:   { label: 'Rosé Pine',     bg: '#191724', accent: '#ebbcba', muted: '#e0def4', prompt: '#c4a7e7', panel: 'rgba(25, 23, 36, 0.95)', matrix: '#ebbcba' },
        ocean:      { label: 'Oceano',        bg: '#021824', accent: '#29b6f6', muted: '#81d4fa', prompt: '#4dd0e1', panel: 'rgba(3, 28, 42, 0.95)', matrix: '#29b6f6' },
        forest:     { label: 'Foresta',       bg: '#0b140d', accent: '#8bc34a', muted: '#c5e1a5', prompt: '#a5d6a7', panel: 'rgba(14, 26, 16, 0.95)', matrix: '#8bc34a' },
        sunset:     { label: 'Tramonto',      bg: '#1a0b14', accent: '#ff7a59', muted: '#ffc09f', prompt: '#ffd166', panel: 'rgba(32, 13, 24, 0.95)', matrix: '#ff7a59' },
        ice:        { label: 'Ghiaccio',      bg: '#0a1118', accent: '#b3e5fc', muted: '#e1f5fe', prompt: '#80deea', panel: 'rgba(12, 20, 28, 0.95)', matrix: '#b3e5fc' },
    };
    const SCRIPT_SRC = document.currentScript ? document.currentScript.src : '';

    const rgba = (hex, a) => {
        const n = parseInt(hex.slice(1), 16);
        return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
    };
    function getDirectCookie(name) {
        const match = document.cookie.match(new RegExp(`(?:^|; )${encodeURIComponent(name)}=([^;]*)`));
        return match ? decodeURIComponent(match[1]) : null;
    }
    const read = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
    const write = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };

    /** Shows a theme on this page and remembers it in this browser. Unknown names (custom `rice add` themes) keep the default colours. */
    function applyTheme(name, customMatrixColor) {
        const t = THEMES[name] || THEMES[DEFAULT_THEME];
        const root = document.documentElement;
        root.style.setProperty('--bg-color', t.bg);
        root.style.setProperty('--accent-color', t.accent);
        root.style.setProperty('--border-color', rgba(t.accent, 0.45));
        root.style.setProperty('--text-muted', t.muted);
        root.style.setProperty('--prompt-color', t.prompt);
        root.style.setProperty('--panel-bg', t.panel);
        root.setAttribute('data-rice', name);
        if (document.body) document.body.setAttribute('data-rice', name);
        window.matrixColor = customMatrixColor || t.matrix;
        window.matrixFade = rgba(t.bg, 0.06);
        write('selected_theme', name);
        write('selected_rice', name);
        document.cookie = `selected_theme=${encodeURIComponent(name)}; path=/; max-age=31536000; SameSite=Lax`;
        document.querySelectorAll('select#rice-selector').forEach((s) => { if (s.value !== name) s.value = name; });
        window.dispatchEvent(new CustomEvent('vb-theme-change', { detail: { theme: name } }));
    }

    /** What the user picks (menu, terminal, settings): shows it, and saves it on the account so the other places and devices follow. */
    function setTheme(name) {
        applyTheme(name);
        if (!THEMES[name] || !SCRIPT_SRC) return;
        try {
            fetch(new URL('../api/save_theme.php', SCRIPT_SRC).href, {
                method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme: name }),
            }).catch(() => {});   // a guest gets a 401: the choice stays in this browser
        } catch (e) { /* no network */ }
    }

    window.THEMES = THEMES;
    window.THEME_PRESETS = THEMES;      // old name, still read by the terminal
    window.DEFAULT_THEME = DEFAULT_THEME;
    window.applySystemTheme = applyTheme;
    window.setSystemTheme = setTheme;

    // Which theme to start with: the account's (server), else this browser's, else the default.
    // The old default was cyan: a browser that never chose keeps no cyan from before the change.
    const meta = document.querySelector('meta[name="vb-theme"]');
    let start = meta && THEMES[meta.content] ? meta.content : null;
    if (!start) {
        const local = read('selected_theme') || getDirectCookie('selected_theme');
        const migrated = read('vb_theme_v2') === '1';
        write('vb_theme_v2', '1');
        start = (!migrated && local === 'cyan') ? DEFAULT_THEME : (local || DEFAULT_THEME);
    }
    applyTheme(start);

    document.addEventListener('DOMContentLoaded', () => {
        if (document.body) document.body.setAttribute('data-rice', document.documentElement.getAttribute('data-rice') || start);
        document.querySelectorAll('select#rice-selector').forEach((sel) => {
            if (!sel.options.length) {
                Object.keys(THEMES).forEach((id) => sel.add(new Option(THEMES[id].label + (id === DEFAULT_THEME ? ' (predefinito)' : ''), id)));
            }
            sel.value = document.documentElement.getAttribute('data-rice') || start;
            sel.addEventListener('change', (e) => setTheme(e.target.value));
        });

        // Scanlines: only on the desktop (index), a CRT effect over the whole screen
        const scanlineToggle = document.getElementById('scanline-toggle');
        if (scanlineToggle) {
            const on = read('scanlines_active') === 'true';
            scanlineToggle.checked = on;
            document.body.classList.toggle('scanlines-active', on);
            scanlineToggle.addEventListener('change', () => {
                document.body.classList.toggle('scanlines-active', scanlineToggle.checked);
                write('scanlines_active', scanlineToggle.checked ? 'true' : 'false');
            });
        }
    });
})();
