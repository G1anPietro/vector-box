// public/js/dm.js
// PRIVATE_MSG window: conversations on the left, the open thread on the right.
// Polls for new messages only while the window is open. All user text goes in with textContent.
document.addEventListener('DOMContentLoaded', () => {
    const win = document.getElementById('win-dm');
    if (!win) return; // not logged in: the window is not rendered

    const $ = (id) => document.getElementById(id);
    const layout = win.querySelector('.dm-layout');
    const convsEl = $('dm-convs');
    const threadEl = $('dm-thread');
    const withEl = $('dm-with');
    const blockBtn = $('dm-block');
    const form = $('dm-form');
    const text = $('dm-text');
    const note = $('dm-note');
    const search = $('dm-search');
    const results = $('dm-search-results');

    let current = null;   // { id, username }
    let lastId = 0;       // newest message id seen
    let pollTimer = null;
    let searchTimer = null;

    const el = (tag, cls, txt) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (txt !== undefined) e.textContent = txt;
        return e;
    };
    const isOpen = () => !win.classList.contains('hidden') && win.style.display !== 'none';
    const say = (msg) => { note.textContent = msg || ''; };

    async function api(query, body) {
        const opts = { credentials: 'same-origin', cache: 'no-store' };
        if (body) {
            opts.method = 'POST';
            opts.headers = { 'Content-Type': 'application/json' };
            opts.body = JSON.stringify(body);
        }
        const res = await fetch('api/dm.php' + (query || ''), opts);
        const data = await res.json().catch(() => ({ success: false, error: 'Bad response' }));
        if (!data.success) throw new Error(data.error || 'Error');
        return data;
    }

    function renderConvs(list) {
        convsEl.replaceChildren();
        if (!list.length) {
            convsEl.appendChild(el('p', 'term-muted', 'No conversations yet. Find a user above to start one.'));
            return;
        }
        for (const c of list) {
            const b = el('button', 'dm-item' + (current && current.id === c.user.id ? ' active' : ''));
            if (c.unread) b.appendChild(el('span', 'dm-unread', String(c.unread)));
            b.appendChild(el('span', 'dm-name', c.user.username + (c.blocked ? ' (blocked)' : '')));
            b.appendChild(el('span', 'dm-preview', (c.last.mine ? 'you: ' : '') + c.last.body.replace(/\s+/g, ' ')));
            b.addEventListener('click', () => openThread(c.user));
            convsEl.appendChild(b);
            lastId = Math.max(lastId, c.last.id);
        }
    }

    async function loadConvs() {
        try { renderConvs((await api('?action=conversations')).conversations); } catch (e) { say(e.message); }
    }

    function addMessage(m) {
        const d = el('div', 'dm-msg ' + (m.mine ? 'mine' : 'theirs'), m.body);
        d.dataset.id = m.id;
        d.appendChild(el('span', 'dm-time', String(m.created_at || '').slice(5, 16).replace('T', ' ')));
        threadEl.appendChild(d);
        lastId = Math.max(lastId, m.id);
    }

    async function openThread(user) {
        current = user;
        layout.classList.add('in-thread');
        withEl.textContent = user.username;
        withEl.className = '';
        say('');
        try {
            const t = await api(`?action=thread&with=${encodeURIComponent(user.id)}`);
            threadEl.replaceChildren();
            t.messages.forEach(addMessage);
            threadEl.scrollTop = threadEl.scrollHeight;
            blockBtn.classList.remove('hidden');
            blockBtn.textContent = t.blocked ? 'UNBLOCK' : 'BLOCK';
            blockBtn.dataset.blocked = t.blocked ? '1' : '';
            form.classList.toggle('hidden', !t.can_send);
            if (!t.can_send) say(t.blocked ? 'You blocked this user.' : 'You cannot write to this user.');
            else text.focus();
            loadConvs();
        } catch (e) { say(e.message); }
    }

    async function send() {
        const body = text.value.trim();
        if (!body || !current) return;
        try {
            const r = await api('', { action: 'send', to: current.id, body });
            text.value = '';
            addMessage(r.message);
            threadEl.scrollTop = threadEl.scrollHeight;
            say('');
            loadConvs();
        } catch (e) { say(e.message); }
    }

    async function poll() {
        clearTimeout(pollTimer);
        if (isOpen()) {
            try {
                const r = await api(`?action=since&after=${lastId}`);
                if (r.messages.length) {
                    const forThread = r.messages.filter((m) => current && (m.from === current.id || m.to === current.id));
                    const known = new Set([...threadEl.querySelectorAll('.dm-msg')].map((x) => +x.dataset.id));
                    forThread.filter((m) => !known.has(m.id)).forEach(addMessage);
                    r.messages.forEach((m) => { lastId = Math.max(lastId, m.id); });
                    if (forThread.length) {
                        threadEl.scrollTop = threadEl.scrollHeight;
                        // mark what we just saw as read
                        if (forThread.some((m) => !m.mine)) api(`?action=thread&with=${current.id}`).catch(() => {});
                    }
                    loadConvs();
                }
            } catch (e) { /* offline: try again later */ }
        }
        pollTimer = setTimeout(poll, isOpen() ? 4000 : 15000);
    }

    form.addEventListener('submit', (e) => { e.preventDefault(); send(); });
    text.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    $('dm-back').addEventListener('click', () => { layout.classList.remove('in-thread'); });
    blockBtn.addEventListener('click', async () => {
        if (!current) return;
        const blocked = blockBtn.dataset.blocked === '1';
        if (!blocked && !confirm(`Block ${current.username}? Neither of you will be able to write to the other.`)) return;
        try {
            await api('', { action: blocked ? 'unblock' : 'block', user_id: current.id });
            openThread(current);
        } catch (e) { say(e.message); }
    });

    search.addEventListener('input', () => {
        clearTimeout(searchTimer);
        const q = search.value.trim();
        if (!q) { results.replaceChildren(); return; }
        searchTimer = setTimeout(async () => {
            try {
                const r = await api(`?action=users&q=${encodeURIComponent(q)}`);
                results.replaceChildren();
                if (!r.users.length) results.appendChild(el('div', 'term-muted dm-item', 'No user found'));
                for (const u of r.users) {
                    const b = el('button', 'dm-item', u.username);
                    b.addEventListener('click', () => { search.value = ''; results.replaceChildren(); openThread(u); });
                    results.appendChild(b);
                }
            } catch (e) { say(e.message); }
        }, 250);
    });

    // Load when the window opens (dragging also changes `style`: react only to closed -> open)
    let wasOpen = isOpen();
    new MutationObserver(() => {
        const open = isOpen();
        if (open && !wasOpen) { loadConvs(); poll(); }
        wasOpen = open;
    }).observe(win, { attributes: true, attributeFilter: ['class', 'style'] });
    if (isOpen()) loadConvs();
    poll();
});
