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
    // Older pages of the open conversation: loaded by themselves when scrolling up
    let threadGen = 0;    // bumped on every openThread(): late answers for another conversation are dropped
    let oldestId = 0;
    let hasMore = false;
    let loadingOlder = false;
    let topEl = null;     // sentinel at the top of #dm-thread: "loading..." / "start of the conversation"
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

    function messageEl(m) {
        const d = el('div', 'dm-msg ' + (m.mine ? 'mine' : 'theirs'), m.body);
        d.dataset.id = m.id;
        d.appendChild(el('span', 'dm-time', String(m.created_at || '').slice(5, 16).replace('T', ' ')));
        return d;
    }

    function addMessage(m) {
        threadEl.appendChild(messageEl(m));
        lastId = Math.max(lastId, m.id);
    }

    const knownIds = () => new Set([...threadEl.querySelectorAll('.dm-msg')].map((x) => +x.dataset.id));

    function setTop(state) {
        if (!topEl) return;
        topEl.className = 'dm-top' + (state === 'loading' ? ' loading' : '');
        topEl.textContent = state === 'loading' ? 'loading older messages…' : state === 'start' ? 'start of the conversation' : '';
    }

    /** Loads the 50 messages before the oldest one shown and puts them on top, keeping the view still. */
    async function loadOlder() {
        if (loadingOlder || !hasMore || !current || !oldestId) return;
        loadingOlder = true;
        const gen = threadGen;
        setTop('loading');
        try {
            const r = await api(`?action=thread&with=${encodeURIComponent(current.id)}&before=${oldestId}`);
            if (gen !== threadGen) return;            // another conversation was opened meanwhile
            const known = knownIds();
            const frag = document.createDocumentFragment();
            r.messages.filter((m) => !known.has(m.id)).forEach((m) => frag.appendChild(messageEl(m)));
            if (r.messages.length) oldestId = Math.min(oldestId, ...r.messages.map((m) => m.id));
            const before = threadEl.scrollHeight;
            topEl.after(frag);
            threadEl.scrollTop += threadEl.scrollHeight - before;   // the message being read stays put
            hasMore = !!r.more && r.messages.length > 0;
            setTop(hasMore ? '' : 'start');
        } catch (e) {
            if (gen === threadGen) setTop('');          // try again on the next scroll, no retry loop
        } finally {
            if (gen === threadGen) loadingOlder = false;
        }
        if (gen === threadGen) fillIfShort();
    }

    // A page that doesn't fill the box can't be scrolled: keep loading until it can (or the start is reached)
    function fillIfShort() {
        if (hasMore && !loadingOlder && threadEl.scrollHeight <= threadEl.clientHeight + 4) loadOlder();
    }

    threadEl.addEventListener('scroll', () => {
        if (threadEl.scrollTop < 200) loadOlder();
    }, { passive: true });

    async function openThread(user) {
        current = user;
        const gen = ++threadGen;
        loadingOlder = false;
        hasMore = false;
        oldestId = 0;
        layout.classList.add('in-thread');
        withEl.textContent = user.username;
        withEl.className = '';
        say('');
        try {
            const t = await api(`?action=thread&with=${encodeURIComponent(user.id)}`);
            if (gen !== threadGen) return;
            topEl = el('div', 'dm-top');
            threadEl.replaceChildren(topEl);
            t.messages.forEach(addMessage);
            oldestId = t.messages.length ? Math.min(...t.messages.map((m) => m.id)) : 0;
            hasMore = !!t.more && t.messages.length > 0;
            setTop(hasMore || !t.messages.length ? '' : 'start');
            threadEl.scrollTop = threadEl.scrollHeight;
            blockBtn.classList.remove('hidden');
            blockBtn.textContent = t.blocked ? 'UNBLOCK' : 'BLOCK';
            blockBtn.dataset.blocked = t.blocked ? '1' : '';
            form.classList.toggle('hidden', !t.can_send);
            if (!t.can_send) say(t.blocked ? 'You blocked this user.' : 'You cannot write to this user.');
            else text.focus();
            loadConvs();
            requestAnimationFrame(fillIfShort);
        } catch (e) { if (gen === threadGen) say(e.message); }
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
                    const known = knownIds();
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
