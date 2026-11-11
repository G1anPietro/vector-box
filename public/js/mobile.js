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

    // Hide the tab bar only while the on-screen keyboard is really open. A focused field is
    // not enough: the terminal keeps its focus after the keyboard is closed (back button), and
    // the bar must come back then. The keyboard is "open" when the visible height drops well
    // below the tallest height seen in this orientation.
    const isField = (el) => el && el.matches && el.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]), textarea, select, [contenteditable="true"]');
    const vv = window.visualViewport;
    let fullHeight = 0;
    const visibleHeight = () => (vv ? vv.height : window.innerHeight);
    const updateTyping = () => {
        const h = visibleHeight();
        fullHeight = Math.max(fullHeight, h, window.innerHeight);
        const keyboardOpen = h < fullHeight * 0.78;
        const typing = document.body.classList.contains('m-app') && keyboardOpen && isField(document.activeElement);
        document.body.classList.toggle('m-typing', typing);
    };
    // the keyboard animates in: check again a little later too
    const updateSoon = () => { updateTyping(); setTimeout(updateTyping, 150); setTimeout(updateTyping, 450); };
    document.addEventListener('focusin', updateSoon);
    document.addEventListener('focusout', updateSoon);
    (vv || window).addEventListener('resize', updateTyping);
    window.addEventListener('orientationchange', () => { fullHeight = 0; setTimeout(updateTyping, 300); });

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
