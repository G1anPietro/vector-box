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
    load();
    setInterval(() => { if (!document.hidden) load(); }, 15000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();
