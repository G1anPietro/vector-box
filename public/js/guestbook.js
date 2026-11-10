// public/js/guestbook.js
// GUESTBOOK window: scrolling ticker + list of entries + sign form.
document.addEventListener("DOMContentLoaded", () => {
    const win = document.getElementById('win-guestbook');
    const list = document.getElementById('guestbook-list');
    const ticker = document.getElementById('guestbook-ticker');
    const input = document.getElementById('guestbook-input');
    const status = document.getElementById('guestbook-status');
    if (!win || !list || !input) return;

    let tickerAnim = null;
    let lastLoad = 0;

    const say = (text, color) => {
        if (!status) return;
        status.textContent = text;
        status.style.color = color || '';
    };

    const renderTicker = (entries) => {
        if (!ticker) return;
        if (tickerAnim) tickerAnim.cancel();
        ticker.replaceChildren();
        if (!entries.length) return;

        const track = document.createElement('span');
        track.style.cssText = 'display:inline-block; white-space:nowrap; padding-left:100%;';
        track.textContent = entries.slice(0, 15).map((e) => `${e.username}: ${e.message}`).join('   ///   ');
        ticker.appendChild(track);
        // ~60px per second regardless of length
        const duration = Math.max(8000, (track.textContent.length * 8 / 60) * 1000);
        tickerAnim = track.animate(
            [{ transform: 'translateX(0)' }, { transform: 'translateX(-100%)' }],
            { duration, iterations: Infinity }
        );
    };

    const renderList = (entries) => {
        list.replaceChildren();
        if (!entries.length) {
            const empty = document.createElement('p');
            empty.className = 'term-muted';
            empty.textContent = 'No signatures yet. Be the first to tag the wall.';
            list.appendChild(empty);
            return;
        }
        const isAdmin = !!(window.SESSION_STATE && window.SESSION_STATE.isAdmin);
        entries.forEach((e) => {
            const row = document.createElement('div');
            row.style.cssText = 'padding:4px 0; border-bottom:1px dashed rgba(255,255,255,0.08); font-size:0.82rem; word-break:break-word;';

            const meta = document.createElement('span');
            meta.className = 'term-muted';
            meta.style.cssText = 'font-size:0.72rem; margin-right:6px;';
            meta.textContent = `[${String(e.created_at || '').slice(0, 16)}]`;

            const who = document.createElement('span');
            who.className = 'chat-user-tag';
            who.textContent = `${e.username}: `;

            const msg = document.createElement('span');
            msg.textContent = e.message;

            if (isAdmin) {
                const del = document.createElement('button');
                del.className = 'chat-del-btn';
                del.textContent = '[X]';
                del.title = 'Remove entry';
                del.addEventListener('click', async () => {
                    try {
                        const res = await fetch('api/guestbook.php', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'same-origin',
                            body: JSON.stringify({ action: 'delete', id: e.id })
                        });
                        if ((await res.json()).success) load(true);
                    } catch (err) {}
                });
                row.appendChild(del);
            }
            row.appendChild(meta);
            row.appendChild(who);
            row.appendChild(msg);
            list.appendChild(row);
        });
    };

    const load = async (force = false) => {
        if (!force && Date.now() - lastLoad < 15000) return;
        lastLoad = Date.now();
        try {
            const res = await fetch('api/guestbook.php', { credentials: 'same-origin' });
            const data = await res.json();
            if (!data.success) return;
            renderList(data.entries);
            renderTicker(data.entries);
        } catch (err) {
            say('>> Failed to load the wall.', '#ff3333');
        }
    };

    const sign = async () => {
        const message = input.value.trim();
        if (!message) return;
        try {
            const res = await fetch('api/guestbook.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ action: 'sign', message })
            });
            const data = await res.json();
            if (data.success) {
                input.value = '';
                say('>> Signature burned into the wall.', '#33ff77');
                load(true);
            } else {
                say(`>> ${data.error || 'Failed to sign.'}`, '#ff3333');
            }
        } catch (err) {
            say('>> Uplink error.', '#ff3333');
        }
    };

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); sign(); }
    });
    const btn = document.getElementById('guestbook-sign-btn');
    if (btn) btn.addEventListener('click', sign);

    // Load when opened (and at most every 15s on focus changes)
    new MutationObserver(() => {
        if (!win.classList.contains('hidden')) load();
    }).observe(win, { attributes: true, attributeFilter: ['class'] });
    if (!win.classList.contains('hidden')) load(true);
});
