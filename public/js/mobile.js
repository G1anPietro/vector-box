// public/js/mobile.js
// Phone mode for the desktop page (screens up to 768px): one app at a time, full screen,
// switched from a one-row tab bar. Styles in css/mobile.css, all under body.m-app.
// On wider screens this does nothing and the draggable desktop works as before.
document.addEventListener('DOMContentLoaded', () => {
    const bar = document.querySelector('.taskbar-apps');
    if (!bar) return;

    const mq = window.matchMedia('(max-width: 768px)');
    const SHORT = {
        'win-terminal': 'TERM', 'win-chatfeed': 'CHAT', 'win-msgbox': 'UPLINK', 'win-poker': 'POKER',
        'win-tools': 'TOOLS', 'win-vault': 'VAULT', 'win-status': 'STATUS', 'win-guestbook': 'WALL', 'win-dm': 'DM',
    };
    const KEY = 'm_app';
    const DEFAULT_APP = 'win-chatfeed';

    let current = null;
    const unhidden = new Map(); // apps we un-hid ourselves -> were they hidden before?
    const store = {
        get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } },
        set(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* private mode */ } },
    };

    function show(id) {
        const win = document.getElementById(id);
        if (!win) return;
        if (current && current !== id) {
            const prev = document.getElementById(current);
            if (prev) {
                prev.classList.remove('m-active');
                // put back the desktop's own open/closed state
                if (unhidden.get(current)) { prev.classList.add('hidden'); prev.style.display = 'none'; }
            }
            unhidden.delete(current);
        }
        if (!unhidden.has(id)) unhidden.set(id, win.classList.contains('hidden'));
        // other scripts (wall, DM, status) load when their window stops being hidden
        win.classList.remove('hidden');
        win.style.display = 'flex';
        win.classList.add('m-active');
        current = id;
        store.set(id);
        bar.querySelectorAll('.taskbar-btn').forEach((b) => {
            b.classList.toggle('m-current', b.id === 'tb-' + id);
            if (b.id === 'tb-' + id) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
        });
        const btn = document.getElementById('tb-' + id);
        if (btn) btn.scrollIntoView({ inline: 'center', block: 'nearest' });
    }

    // Taskbar taps: in phone mode, switch app instead of minimising/restoring windows
    bar.addEventListener('click', (e) => {
        if (!document.body.classList.contains('m-app')) return;
        const btn = e.target.closest('button.taskbar-btn');
        if (!btn) return; // links (READER) keep working normally
        e.stopPropagation();
        e.preventDefault();
        show(btn.id.replace(/^tb-/, ''));
    }, true);

    // Hide the tab bar while the keyboard is up
    const isField = (el) => el && (el.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea, select, [contenteditable="true"]'));
    document.addEventListener('focusin', (e) => {
        if (document.body.classList.contains('m-app') && isField(e.target)) document.body.classList.add('m-typing');
    });
    document.addEventListener('focusout', () => {
        setTimeout(() => { if (!isField(document.activeElement)) document.body.classList.remove('m-typing'); }, 50);
    });

    function enable() {
        document.body.classList.add('m-app');
        bar.querySelectorAll('.taskbar-btn').forEach((b) => {
            const id = (b.id || '').replace(/^tb-/, '');
            if (b.dataset.full === undefined) b.dataset.full = b.textContent;
            b.textContent = SHORT[id] || b.dataset.full.replace(/^>_\s*/, '');
        });
        const saved = store.get();
        show(saved && document.getElementById(saved) ? saved : DEFAULT_APP);
    }

    function disable() {
        document.body.classList.remove('m-app', 'm-typing');
        bar.querySelectorAll('.taskbar-btn').forEach((b) => {
            if (b.dataset.full !== undefined) b.textContent = b.dataset.full;
            b.classList.remove('m-current');
            b.removeAttribute('aria-current');
        });
        if (current) {
            const win = document.getElementById(current);
            if (win) {
                win.classList.remove('m-active');
                if (unhidden.get(current)) { win.classList.add('hidden'); win.style.display = 'none'; }
            }
        }
        unhidden.clear();
        current = null;
    }

    if (mq.matches) enable();
    mq.addEventListener('change', (e) => (e.matches ? enable() : disable()));
});
