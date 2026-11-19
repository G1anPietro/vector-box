// js/sessions.js — "where you are signed in" (Account page). Everything from the server goes in with textContent.
(() => {
    const it = document.documentElement.lang === 'it';
    const T = it
        ? { none: 'Nessun dispositivo registrato.', here: 'questo dispositivo', in: 'Accesso', seen: 'Ultimo uso', out: 'Esci', others: 'Esci da tutti gli altri', err: 'Non è andata, riprova.', st: 'Sei collegato in questi browser.' }
        : { none: 'No devices recorded.', here: 'this device', in: 'Signed in', seen: 'Last seen', out: 'Sign out', others: 'Sign out all the others', err: 'That did not work, try again.', st: 'You are signed in on these browsers.' };
    const $ = (id) => document.getElementById(id);
    const fmt = (t) => new Date(t * 1000).toLocaleString(it ? 'it-IT' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' });
    const el = (tag, props = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'text') n.textContent = v; else n.setAttribute(k, v); } n.append(...kids); return n; };
    const btn = (text, fn, cls = 'btn ghost small') => { const b = el('button', { type: 'button', class: cls, text }); b.addEventListener('click', fn); return b; };
    async function api(body) {
        const r = await fetch('../api/sessions.php', body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
        return r.json().catch(() => ({ success: false }));
    }
    async function act(body) { const d = await api(body); $('sessions-state').textContent = d.success ? T.st : T.err; if (d.success) render(); }
    async function render() {
        const d = await api();
        if (!d.success) return;
        $('sessions-state').textContent = d.sessions.length ? T.st : T.none;
        const rows = d.sessions.map((s) => el('div', { class: 'dev' },
            el('div', { text: s.label + (s.country ? ' · ' + s.country : '') + (s.current ? ' · ' + T.here : '') }),
            el('div', { class: 'meta', text: T.in + ': ' + fmt(s.created_at) + ' · ' + T.seen + ': ' + fmt(s.last_seen) }),
            s.current ? el('span') : btn(T.out, () => act({ action: 'revoke', id: s.id }))));
        if (d.sessions.length > 1) rows.push(btn(T.others, () => act({ action: 'revoke_others' }), 'btn ghost small danger'));
        $('sessions-body').replaceChildren(...rows);
    }
    render();
})();
