// public/js/novita.js — draws the news board from api/news.php and refreshes it (every 15 s while the tab is visible).
(() => {
    const lang = document.documentElement.lang === 'it' ? 'it' : 'en';
    const T = lang === 'it'
        ? { ago: 'aggiornato', live: 'Si aggiorna da sola.', off: 'Connessione persa, riprovo…', kinds: { feature: 'novità', fix: 'correzione', content: 'contenuti', security: 'sicurezza', ops: 'server' } }
        : { ago: 'updated', live: 'Updates by itself.', off: 'Connection lost, retrying…', kinds: { feature: 'feature', fix: 'fix', content: 'content', security: 'security', ops: 'server' } };
    const fmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };

    function card(i) {
        const c = el('article', 'nv-card');
        const h = el('h3');
        if (i.status === 'doing') h.append(el('span', 'nv-pulse'));
        h.append(i.title[lang]);
        c.append(h);
        if (i.body[lang]) c.append(el('p', '', i.body[lang]));
        if (i.status === 'doing' && i.progress !== null) {
            const b = el('div', 'nv-bar'), f = el('i');
            f.style.width = i.progress + '%';
            b.append(f); b.setAttribute('role', 'progressbar'); b.setAttribute('aria-valuenow', i.progress);
            c.append(b);
        }
        const m = el('div', 'nv-meta');
        m.append(el('span', 'nv-tag', T.kinds[i.kind] || i.kind));
        if (i.status === 'doing' && i.progress !== null) m.append(el('span', '', i.progress + '%'));
        if (i.version) m.append(el('span', '', i.version));
        m.append(el('span', '', (i.status === 'done' ? '' : T.ago + ' ') + fmt.format(new Date((i.done_at || i.updated_at) * 1000))));
        c.append(m);
        if (i.updates.length) {
            const ul = el('ul', 'nv-log');
            i.updates.forEach(u => ul.append(el('li', '', u[lang])));
            c.append(ul);
        }
        return c;
    }

    function draw(items) {
        let any = false;
        for (const s of ['doing', 'planned', 'done']) {
            const sec = document.getElementById('nv-' + s), list = items.filter(i => i.status === s);
            sec.hidden = !list.length;
            sec.querySelector('.nv-list').replaceChildren(...list.map(card));
            any = any || list.length > 0;
        }
        document.getElementById('nv-empty').hidden = any;
    }

    async function load() {
        const live = document.getElementById('nv-live');
        try {
            const r = await fetch('../api/news.php', { cache: 'no-store' });
            const d = await r.json();
            if (d.success) { draw(d.items); live.textContent = T.live; }
        } catch (e) { live.textContent = T.off; }
    }
    // ---- tabs and the ideas box ----
    const L = lang === 'it'
        ? { st: { new: 'inviata', considering: 'in valutazione', planned: 'in programma', done: 'fatta', declined: 'non per ora' }, sent: 'Idea inviata, grazie!', err: 'Non è stato possibile inviarla.', none: 'Ancora nessuna idea.', save: 'Salva', del: 'Elimina', reply: 'Risposta (facoltativa)' }
        : { st: { new: 'sent', considering: 'under review', planned: 'planned', done: 'done', declined: 'not for now' }, sent: 'Idea sent, thank you!', err: 'It could not be sent.', none: 'No ideas yet.', save: 'Save', del: 'Delete', reply: 'Answer (optional)' };
    const tabNews = document.getElementById('tab-news'), tabIdeas = document.getElementById('tab-ideas');
    const paneNews = document.getElementById('pane-news'), paneIdeas = document.getElementById('pane-ideas');
    function show(ideas) {
        tabNews.setAttribute('aria-selected', String(!ideas)); tabIdeas.setAttribute('aria-selected', String(ideas));
        paneNews.hidden = ideas; paneIdeas.hidden = !ideas;
        try { history.replaceState(null, '', ideas ? '#idee' : location.pathname + location.search); } catch (e) {}
        if (ideas) loadIdeas();
    }
    tabNews.addEventListener('click', () => show(false));
    tabIdeas.addEventListener('click', () => show(true));

    const idList = document.getElementById('id-list'), idForm = document.getElementById('id-form'), idText = document.getElementById('id-text');
    const idMsg = document.getElementById('id-msg');
    idText.addEventListener('input', () => { document.getElementById('id-count').textContent = idText.value.length + '/500'; });
    async function api(body) {
        const r = await fetch('../api/news_ideas.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return r.json().catch(() => ({ success: false }));
    }
    function ideaCard(i, admin) {
        const c = el('article', 'nv-card');
        c.append(el('p', '', i.text));
        const m = el('div', 'nv-meta');
        m.append(el('span', 'nv-status', L.st[i.status] || i.status));
        if (i.username) m.append(el('span', '', i.username));
        m.append(el('span', '', fmt.format(new Date(i.created_at * 1000))));
        c.append(m);
        if (i.reply) c.append(el('p', '', '→ ' + i.reply));
        const box = el('div', 'nv-admin');
        if (admin) {
            const sel = el('select');
            Object.entries(L.st).forEach(([k, v]) => { const o = el('option', '', v); o.value = k; if (k === i.status) o.selected = true; sel.append(o); });
            const rep = el('input'); rep.maxLength = 300; rep.placeholder = L.reply; rep.value = i.reply || '';
            const sv = el('button', '', L.save); sv.type = 'button';
            sv.addEventListener('click', async () => { const d = await api({ action: 'set', id: i.id, status: sel.value, reply: rep.value }); if (d.success) loadIdeas(); });
            box.append(sel, rep, sv);
        }
        const dl = el('button', '', L.del); dl.type = 'button';
        dl.addEventListener('click', async () => { const d = await api({ action: 'delete', id: i.id }); if (d.success) loadIdeas(); });
        box.append(dl);
        c.append(box);
        return c;
    }
    async function loadIdeas() {
        try {
            const r = await fetch('../api/news_ideas.php', { cache: 'no-store' });
            if (r.status === 401) { document.getElementById('id-login').hidden = false; idForm.hidden = true; idList.replaceChildren(); return; }
            const d = await r.json();
            if (!d.success) return;
            document.getElementById('id-login').hidden = true; idForm.hidden = false;
            idList.replaceChildren(...(d.ideas.length ? d.ideas.map(i => ideaCard(i, d.admin)) : [el('p', 'muted', L.none)]));
        } catch (e) { /* offline: the list stays as it was */ }
    }
    idForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        idMsg.textContent = '';
        const d = await api({ text: idText.value });
        idMsg.textContent = d.success ? L.sent : (d.error || L.err);
        if (d.success) { idText.value = ''; document.getElementById('id-count').textContent = '0/500'; loadIdeas(); }
    });
    if (location.hash === '#idee') show(true);

    load();
    setInterval(() => { if (!document.hidden) load(); }, 15000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();
