// public/js/tempmail.js — the temporary mail page. The token of the box lives in localStorage; nothing the senders write is ever put in with innerHTML.
(() => {
    'use strict';
    const $ = (id) => document.getElementById(id);
    const T = JSON.parse($('tm-i18n').textContent);
    const API = '../api/tempmail.php';
    const KEY = 'tm_token';
    let token = '', expires = 0, openId = 0, timer = 0, poll = 0;

    const store = {
        get() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } },
        set(v) { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch (e) { /* private window: the box lives until the page is closed */ } },
    };
    const api = async (action, { post = false, body = {}, query = '' } = {}) => {
        const headers = token ? { 'X-Tempmail-Token': token } : {};
        const res = post
            ? await fetch(API, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...body }) })
            : await fetch(`${API}?action=${action}${query}`, { headers, cache: 'no-store' });
        let j = {}; try { j = await res.json(); } catch (e) { /* not JSON */ }
        return { status: res.status, ...j };
    };
    const note = (el, t) => { $(el).textContent = t || ''; };
    const when = (ts) => new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const err = (r) => (r.code === 'slow_down' ? T.slow : r.code === 'busy' ? T.busy : r.code === 'gone' ? T.gone : T.wrong);

    // proof of work: find a counter so that sha256(challenge:counter) starts with `zeros` hex zeros (a second or two, only when making an address)
    const solve = async (challenge, zeros) => {
        const enc = new TextEncoder(), want = '0'.repeat(zeros);
        for (let base = 0; ; base += 512) {
            const hs = await Promise.all(Array.from({ length: 512 }, (_, i) => crypto.subtle.digest('SHA-256', enc.encode(`${challenge}:${base + i}`))));
            for (let i = 0; i < hs.length; i++) {
                const hex = Array.from(new Uint8Array(hs[i]).subarray(0, 2), (b) => b.toString(16).padStart(2, '0')).join('');
                if (hex.startsWith(want)) return base + i;
            }
        }
    };

    const show = (box) => { $('tm-start').hidden = box; $('tm-box').hidden = !box; };
    const tick = () => {
        const left = Math.max(0, expires - Math.floor(Date.now() / 1000));
        $('tm-left').textContent = String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0');
        if (left === 0 && expires > 0 && token) gone();
    };
    const gone = () => {
        token = ''; store(''); clearInterval(poll); show(false); note('tm-msg', T.gone);
    };

    const render = (msgs) => {
        const list = $('tm-list'); list.replaceChildren();
        if (!msgs.length) { const p = document.createElement('p'); p.className = 'tm-empty muted'; p.textContent = T.nomsg; list.append(p); return; }
        for (const m of msgs) {
            const b = document.createElement('button'); b.type = 'button'; b.className = 'tm-row';
            const s = document.createElement('b'); s.textContent = m.subject || T.nosub;
            const d = document.createElement('span'); d.className = 'tm-d'; d.textContent = when(m.created_at);
            const f = document.createElement('span'); f.className = 'tm-f'; f.textContent = m.from;
            b.append(s, d, f); b.addEventListener('click', () => open(m.id)); list.append(b);
        }
    };
    const refresh = async () => {
        if (!token) return;
        const r = await api('list');
        if (r.status === 404) return gone();
        if (!r.success) return note('tm-note', err(r));
        expires = r.expires_at; $('tm-addr').textContent = r.address; tick(); note('tm-note', '');
        if (!openId) render(r.messages);
    };
    const open = async (id) => {
        const r = await api('get', { query: '&id=' + id });
        if (!r.success) return note('tm-note', err(r));
        openId = id; const m = r.message, a = $('tm-read'); a.replaceChildren();
        const back = document.createElement('button'); back.type = 'button'; back.className = 'tm-pill'; back.textContent = T.back;
        back.addEventListener('click', () => { openId = 0; a.hidden = true; $('tm-list').hidden = false; refresh(); });
        const del = document.createElement('button'); del.type = 'button'; del.className = 'tm-pill'; del.textContent = '🗑 ' + T.del;
        del.addEventListener('click', async () => { await api('delete_message', { post: true, body: { id } }); back.click(); });
        const bar = document.createElement('div'); bar.className = 'tm-acts'; bar.append(back, del);
        const h = document.createElement('h2'); h.textContent = m.subject || T.nosub;
        const f = document.createElement('div'); f.className = 'muted'; f.textContent = `${T.from}: ${m.from} · ${when(m.created_at)}`;
        const body = document.createElement('pre'); body.className = 'tm-text'; body.textContent = m.body;
        a.append(bar, h, f, body); a.hidden = false; $('tm-list').hidden = true;
    };

    const start = (t) => {
        token = t; store(t); show(true); openId = 0; $('tm-read').hidden = true; $('tm-list').hidden = false;
        clearInterval(poll); clearInterval(timer);
        poll = setInterval(() => { if (!document.hidden) refresh(); }, 10000);
        timer = setInterval(tick, 1000);
        return refresh();
    };

    $('tm-new').addEventListener('click', async () => {
        const btn = $('tm-new'); btn.disabled = true; note('tm-msg', T.working);
        try {
            const p = await api('pow');
            if (!p.success) return note('tm-msg', err(p));
            const counter = await solve(p.challenge, p.zeros);
            const r = await api('create', { post: true, body: { challenge: p.challenge, counter: String(counter), website: $('tm-website').value } });
            if (!r.success) return note('tm-msg', err(r));
            note('tm-msg', ''); expires = r.expires_at; await start(r.token);
        } catch (e) { note('tm-msg', T.wrong); } finally { btn.disabled = false; }
    });
    $('tm-copy').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText($('tm-addr').textContent); note('tm-note', T.copied); }
        catch (e) { const r = document.createRange(); r.selectNodeContents($('tm-addr')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    });
    $('tm-refresh').addEventListener('click', refresh);
    $('tm-extend').addEventListener('click', async () => {
        const before = expires, r = await api('extend', { post: true });
        if (!r.success) return r.status === 404 ? gone() : note('tm-note', err(r));
        expires = r.expires_at; tick(); note('tm-note', expires <= before + 5 ? T.max : T.extended);
    });
    $('tm-burn').addEventListener('click', async () => {
        if (!confirm(T.sure)) return;
        await api('delete', { post: true }); token = ''; store(''); clearInterval(poll); clearInterval(timer); show(false); note('tm-msg', '');
    });

    if (document.body.dataset.on !== '1') { $('tm-off').hidden = false; return; }
    const saved = store.get();
    if (saved) start(saved); else show(false);
})();
