// public/js/reader-tools.js
// Extras of the library and the book reader, loaded before js/reader.js (which gives them window.VBReaderCtx):
//  - the book menu: tabs Indice (table of contents), Cerca (search in the book), Note (bookmarks, highlights, notes), Testo
//  - text options for EPUBs: font, line spacing, margins, alignment
//  - highlights on a selection (EPUB) and notes on a page (EPUB and PDF), exported as Markdown
//  - the library: filter by shelf (labels), sort, "Continue reading" decorations, reading statistics, tidy titles
// User text (titles, notes, labels) is always put in with textContent.
(() => {
    'use strict';
    const $ = (id) => document.getElementById(id);
    const ctx = () => window.VBReaderCtx;
    const pref = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } };
    const setPref = (k, v) => { try { localStorage.setItem(k, String(v)); } catch (e) { /* private mode */ } };
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
    const post = async (url, body) => {
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return r.json().catch(() => ({ success: false }));
    };
    const getJson = async (url) => { try { return await (await fetch(url)).json(); } catch (e) { return { success: false }; } };
    const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

    // ------------------------------------------------------------------ text options (EPUB) ---
    const FONTS = { book: '', serif: 'Georgia, "Times New Roman", serif', sans: 'system-ui, "Segoe UI", Roboto, Arial, sans-serif', easy: 'Verdana, Tahoma, "DejaVu Sans", sans-serif' };
    // side margins = padding of the page area (the EPUB layout keeps its own 20px inside it and forces them on the body)
const MARGINS = { normal: 0, wide: 24, xwide: 48 };
    const text = (() => {
        let saved = {};
        try { saved = JSON.parse(pref('vector_reader_text', '{}')) || {}; } catch (e) { saved = {}; }
        return {
            font: FONTS[saved.font] !== undefined ? saved.font : 'book',
            lh: Math.min(2.2, Math.max(1.2, Number(saved.lh) || 1.5)),
            margin: MARGINS[saved.margin] !== undefined ? saved.margin : 'normal',
            justify: saved.justify === 'justify' ? 'justify' : 'left',
            lhSet: saved.lh !== undefined,       // line spacing is only forced once the reader touched it
        };
    })();
    const saveText = () => setPref('vector_reader_text', JSON.stringify({ font: text.font, lh: text.lhSet ? text.lh : undefined, margin: text.margin, justify: text.justify }));

    /** CSS added to every EPUB page (reader.js appends it to its theme style). Only what the reader changed is forced. */
    function extraCss() {
        const rules = [];
        if (FONTS[text.font]) rules.push(`html, body, p, span, div, li, blockquote { font-family: ${FONTS[text.font]} !important; }`);
        if (text.lhSet) rules.push(`p, li, blockquote, div { line-height: ${text.lh} !important; }`);
        if (text.justify === 'justify') rules.push('p, li, blockquote { text-align: justify !important; hyphens: auto; }');
        return rules.join('\n');
    }

    function paintText() {
        document.querySelectorAll('[data-font]').forEach((b) => b.classList.toggle('on', b.dataset.font === text.font));
        document.querySelectorAll('[data-margin]').forEach((b) => b.classList.toggle('on', b.dataset.margin === text.margin));
        document.querySelectorAll('[data-justify]').forEach((b) => b.classList.toggle('on', b.dataset.justify === text.justify));
        const lab = $('lh-label');
        if (lab) lab.textContent = text.lhSet ? String(text.lh.toFixed(1)).replace('.', ',') : 'Auto';
        const pdf = ctx() && ctx().format === 'pdf';
        document.querySelectorAll('.epub-only').forEach((r) => { r.hidden = !!pdf; });
    }
    function applyMargins() {
        const stage = $('epub-stage');
        if (stage) { const m = MARGINS[text.margin] || 0; stage.style.paddingLeft = stage.style.paddingRight = m + 'px'; stage.style.boxSizing = 'border-box'; }
    }
    function applyText() {
        saveText();
        paintText();
        applyMargins();
        const c = ctx();
        if (c && c.rendition) {
            c.reapplyTheme();
            setTimeout(() => c.relayout(), 80);   // the pages are laid out again
        }
    }
    function bindText() {
        document.querySelectorAll('[data-font]').forEach((b) => b.addEventListener('click', () => { text.font = b.dataset.font; applyText(); }));
        document.querySelectorAll('[data-margin]').forEach((b) => b.addEventListener('click', () => { text.margin = b.dataset.margin; applyText(); }));
        document.querySelectorAll('[data-justify]').forEach((b) => b.addEventListener('click', () => { text.justify = b.dataset.justify; applyText(); }));
        const step = (d) => { text.lh = Math.round(Math.min(2.2, Math.max(1.2, text.lh + d)) * 10) / 10; text.lhSet = true; applyText(); };
        if ($('lh-down-btn')) $('lh-down-btn').addEventListener('click', () => step(-0.1));
        if ($('lh-up-btn')) $('lh-up-btn').addEventListener('click', () => step(0.1));
        paintText();
    }

    // ---------------------------------------------------------------------------- menu tabs ---
    function showTab(name) {
        setPref('vector_reader_tab', name);
        document.querySelectorAll('.menu-tab-btn').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
        document.querySelectorAll('.menu-tab').forEach((t) => { t.hidden = t.id !== 'tab-' + name; });
        if (name === 'search') { const i = $('inbook-search-input'); if (i && matchMedia('(hover: hover)').matches) i.focus(); }
        if (name === 'notes') loadHighlights();
    }
    function bindTabs() {
        document.querySelectorAll('.menu-tab-btn').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); showTab(b.dataset.tab); }));
        const last = pref('vector_reader_tab', 'toc');
        showTab(['toc', 'search', 'notes', 'text'].includes(last) ? last : 'toc');
        document.addEventListener('reader:menu', (e) => { if (e.detail.open) { paintText(); loadHighlights(); } });
    }

    // ---------------------------------------------------------------------------------- index ---
    let tocFor = null;
    async function buildToc() {
        const c = ctx(), box = $('toc-list');
        if (!box) return;
        box.replaceChildren(el('p', 'set-hint', 'Carico l’indice…'));
        const items = [];
        try {
            if (c.format === 'epub' && c.epubBook) {
                const nav = await c.epubBook.loaded.navigation;
                const walk = (list, depth) => (list || []).forEach((t) => { items.push({ label: (t.label || '').trim(), depth, go: () => c.goEpub(t.href) }); walk(t.subitems, depth + 1); });
                walk(nav.toc, 0);
            } else if (c.format === 'pdf' && c.pdfDoc) {
                const outline = await c.pdfDoc.getOutline();
                const walk = async (list, depth) => {
                    for (const o of list || []) {
                        let page = null;
                        try {
                            const dest = typeof o.dest === 'string' ? await c.pdfDoc.getDestination(o.dest) : o.dest;
                            if (dest) page = (await c.pdfDoc.getPageIndex(dest[0])) + 1;
                        } catch (e) { /* a broken entry */ }
                        if (page) items.push({ label: (o.title || '').trim(), depth, go: () => c.goPdf(page), page });
                        await walk(o.items, depth + 1);
                    }
                };
                await walk(outline, 0);
            }
        } catch (e) { /* no index */ }
        tocFor = c.bookId;
        if (!items.length) { box.replaceChildren(el('p', 'set-hint', 'Questo libro non ha un indice.')); return; }
        box.replaceChildren(...items.slice(0, 600).map((it) => {
            const b = el('button', 'toc-item', it.label || '—');
            b.type = 'button';
            b.style.paddingLeft = (0.6 + Math.min(it.depth, 4) * 0.9) + 'rem';
            if (it.page) b.append(el('span', 'toc-page', String(it.page)));
            b.addEventListener('click', () => { it.go(); c.closeMenu(); });
            return b;
        }));
    }

    // ------------------------------------------------------------------------ search in book ---
    let searchToken = 0;
    const pdfText = new Map();   // page -> text, per open book
    async function searchBook(q) {
        const c = ctx(), out = $('inbook-search-results'), status = $('inbook-search-status');
        const my = ++searchToken;
        out.replaceChildren();
        q = q.trim();
        if (q.length < 2) { status.textContent = 'Scrivi almeno 2 lettere.'; return; }
        status.textContent = 'Cerco…';
        const results = [];
        const add = (r) => { results.push(r); if (results.length <= 100) out.append(resultRow(r)); };
        try {
            if (c.format === 'epub' && c.epubBook) {
                const spine = c.epubBook.spine.spineItems;
                for (let i = 0; i < spine.length && results.length < 100; i++) {
                    if (my !== searchToken) return;
                    const item = spine[i];
                    status.textContent = `Cerco… (${i + 1}/${spine.length})`;
                    try {
                        await item.load(c.epubBook.load.bind(c.epubBook));
                        (item.find(q) || []).slice(0, 20).forEach((m) => add({ excerpt: m.excerpt, go: () => c.goEpub(m.cfi) }));
                    } finally { item.unload(); }
                }
            } else if (c.format === 'pdf' && c.pdfDoc) {
                const low = q.toLowerCase();
                for (let p = 1; p <= c.pdfPages && results.length < 100; p++) {
                    if (my !== searchToken) return;
                    if (p % 5 === 0) status.textContent = `Cerco… (pagina ${p}/${c.pdfPages})`;
                    let t = pdfText.get(p);
                    if (t === undefined) {
                        const content = await (await c.pdfDoc.getPage(p)).getTextContent();
                        t = content.items.map((it) => it.str).join(' ').replace(/\s+/g, ' ');
                        pdfText.set(p, t);
                    }
                    let from = 0, at;
                    while ((at = t.toLowerCase().indexOf(low, from)) !== -1 && results.length < 100) {
                        add({ excerpt: '…' + t.slice(Math.max(0, at - 40), at + q.length + 60) + '…', page: p, go: () => c.goPdf(p) });
                        from = at + q.length;
                        if (from - at > 0 && results.filter((r) => r.page === p).length >= 5) break;
                    }
                }
            }
        } catch (e) { /* a broken chapter: keep what was found */ }
        if (my !== searchToken) return;
        status.textContent = results.length ? `${results.length >= 100 ? 'Più di 100' : results.length} risultati.` : 'Nessun risultato.';
    }
    function resultRow(r) {
        const li = el('li');
        const b = el('button', 'result-item');
        b.type = 'button';
        b.textContent = String(r.excerpt || '').replace(/\s+/g, ' ').trim();
        if (r.page) b.append(el('span', 'toc-page', 'p. ' + r.page));
        b.addEventListener('click', () => { r.go(); ctx().closeMenu(); });
        li.append(b);
        return li;
    }

    // -------------------------------------------------------------------- highlights and notes ---
    let items = [];              // this book's highlights and notes
    let shown = new Set();       // highlight ids already drawn on the EPUB
    const COLORS = { yellow: '#ffd23f', green: '#5ad17a', blue: '#5aa9ff', pink: '#ff7fb0' };
    async function loadHighlights() {
        const c = ctx();
        if (!c || !c.bookId) { renderHighlights(); return; }
        const data = await getJson(`../api/highlights.php?book_id=${encodeURIComponent(c.bookId)}`);
        if (c.bookId && data.success) { items = data.items; drawHighlights(); }
        renderHighlights();
    }
    function drawHighlights() {
        const c = ctx();
        if (!c || !c.rendition || c.format !== 'epub') return;
        items.filter((h) => h.kind === 'hl' && !shown.has(h.id)).forEach((h) => {
            try {
                c.rendition.annotations.highlight(h.location, { id: h.id }, () => { showTab('notes'); if ($('settings-panel').hidden) $('settings-btn').click(); }, 'vr-hl', { fill: COLORS[h.color] || COLORS.yellow, 'fill-opacity': '0.4', 'mix-blend-mode': 'multiply' });
                shown.add(h.id);
            } catch (e) { /* a location that does not exist in this layout */ }
        });
    }
    function undraw(h) {
        const c = ctx();
        if (c && c.rendition && h.kind === 'hl') { try { c.rendition.annotations.remove(h.location, 'highlight'); } catch (e) { /* gone */ } }
        shown.delete(h.id);
    }
    function renderHighlights() {
        const box = $('highlights-list'), exp = $('export-notes-btn'), c = ctx();
        if (!box) return;
        if (exp) { exp.hidden = !items.length; if (c && c.bookId) exp.href = `../api/highlights.php?book_id=${encodeURIComponent(c.bookId)}&export=1`; }
        const hint = $('hl-hint'); if (hint) hint.hidden = !(c && c.format === 'epub');
        if (!items.length) { box.replaceChildren(el('p', 'set-hint', 'Ancora niente. Seleziona un pezzo di testo per evidenziarlo, oppure scrivi una nota.')); return; }
        box.replaceChildren(...items.map((h) => {
            const row = el('div', 'hl-item');
            row.style.borderLeftColor = COLORS[h.color] || COLORS.yellow;
            if (h.kind === 'hl') row.append(el('blockquote', 'hl-text', h.text));
            const note = el('div', 'hl-note', h.note || (h.kind === 'note' ? '' : ''));
            if (h.note) row.append(note);
            const bar = el('div', 'hl-bar');
            bar.append(el('span', 'hl-pct', `${Math.round(h.percentage)}%`));
            const go = el('button', 'btn small-btn', 'Vai'); go.type = 'button';
            go.addEventListener('click', () => { if (c.format === 'epub') c.goEpub(h.location); else c.goPdf(parseInt(h.location, 10)); c.closeMenu(); });
            const edit = el('button', 'btn small-btn', h.note ? 'Modifica nota' : 'Aggiungi nota'); edit.type = 'button';
            edit.addEventListener('click', async () => {
                const v = prompt('Nota', h.note || '');
                if (v === null) return;
                if (h.kind === 'note' && !v.trim()) return;
                if ((await post('../api/highlights.php', { action: 'update', id: h.id, note: v })).success) { h.note = v.trim(); renderHighlights(); }
            });
            const del = el('button', 'btn small-btn', 'Elimina'); del.type = 'button';
            del.addEventListener('click', async () => {
                if (!confirm(h.kind === 'hl' ? 'Togliere questa evidenziazione?' : 'Eliminare questa nota?')) return;
                if ((await post('../api/highlights.php', { action: 'delete', id: h.id })).success) { undraw(h); items = items.filter((x) => x.id !== h.id); renderHighlights(); }
            });
            bar.append(go, edit, del);
            row.append(bar);
            return row;
        }));
    }
    async function saveHighlight(body) {
        const c = ctx();
        const data = await post('../api/highlights.php', { action: 'add', book_id: c.bookId, percentage: c.pct, ...body });
        if (!data.success) { c.toast(data.error || 'Non sono riuscito a salvare.'); return false; }
        await loadHighlights();
        return true;
    }
    async function addPageNote() {
        const c = ctx();
        if (!c || !c.bookId || !c.location) { c.toast('Aspetta che la pagina sia caricata.'); return; }
        const note = prompt(`Nota a pagina ${c.page}`, '');
        if (!note || !note.trim()) return;
        if (await saveHighlight({ kind: 'note', location: String(c.location), note: note.trim() })) c.toast('Nota salvata.');
    }

    // selection bar (EPUB): choose a colour to highlight, or add a note to the passage
    let pendingSel = null;
    function hideSelBar() { const b = $('sel-bar'); if (b) b.hidden = true; pendingSel = null; }
    function bindSelection() {
        const bar = $('sel-bar');
        if (!bar) return;
        bar.querySelectorAll('.sel-color').forEach((b) => b.addEventListener('click', async () => {
            if (!pendingSel) return;
            const s = pendingSel; hideSelBar();
            if (await saveHighlight({ kind: 'hl', location: s.cfi, text: s.text, color: b.dataset.color })) ctx().toast('Evidenziato.');
        }));
        $('sel-note-btn').addEventListener('click', async () => {
            if (!pendingSel) return;
            const s = pendingSel;
            const note = prompt('Nota su questo passo', '');
            hideSelBar();
            if (note === null) return;
            if (await saveHighlight({ kind: 'hl', location: s.cfi, text: s.text, note: note.trim(), color: 'yellow' })) ctx().toast('Evidenziato con nota.');
        });
        $('sel-cancel-btn').addEventListener('click', () => { hideSelBar(); try { ctx().rendition.getContents().forEach((x) => x.window.getSelection().removeAllRanges()); } catch (e) { /* none */ } });
    }
    function hookSelection() {
        const c = ctx();
        if (!c || !c.rendition || c.format !== 'epub') return;
        c.rendition.on('selected', (cfiRange, contents) => {
            const t = String(contents.window.getSelection() || '').trim();
            if (!t) { hideSelBar(); return; }
            pendingSel = { cfi: cfiRange, text: t.slice(0, 600) };
            $('sel-bar').hidden = false;
        });
        c.rendition.on('relocated', () => { hideSelBar(); });
    }

    // ---------------------------------------------------------------------- reading statistics ---
    let sec = 0, pages = 0, tick = null, lastActive = 0, skipPage = false;
    function startClock() {
        stopClock(false);
        sec = 0; pages = 0; skipPage = true;   // opening the book shows a page: it is not a turn
        tick = setInterval(() => {
            const c = ctx();
            const reading = c && c.bookId && !document.hidden && document.hasFocus() !== false && Date.now() - lastActive < 120000;   // two minutes without touching anything: not reading
            if (reading) sec++;
            if (sec >= 60) flush();
        }, 1000);
        lastActive = Date.now();
    }
    function flush() {
        if (!sec && !pages) return;
        const body = { seconds: sec, pages, day: today() };
        sec = 0; pages = 0;
        fetch('../api/reading_stats.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => { /* offline: this minute is lost */ });
    }
    function stopClock(send = true) { clearInterval(tick); tick = null; if (send) flush(); }
    ['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach((t) => document.addEventListener(t, () => { lastActive = Date.now(); }, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
    window.addEventListener('pagehide', flush);

    async function renderStats() {
        const body = $('stats-body');
        if (!body) return;
        const d = await getJson(`../api/reading_stats.php?today=${today()}`);
        if (!d.success) { body.textContent = 'Non riesco a caricare le statistiche.'; return; }
        const mins = (s) => Math.round(s / 60);
        const fmt = (s) => (s > 0 && s < 60 ? 'meno di 1 min' : mins(s) + ' min');
        const goal = Math.max(0, parseInt(pref('vector_reader_goal', '0'), 10) || 0);
        const week = mins(d.week.seconds);
        const bars = el('div', 'stat-bars');
        const byDay = new Map(d.days.map((x) => [x.day, x]));
        let max = 1;
        const last7 = [];
        for (let i = 6; i >= 0; i--) {
            const dt = new Date(); dt.setDate(dt.getDate() - i);
            const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
            const x = byDay.get(key) || { seconds: 0, pages: 0 };
            last7.push([dt, x]); max = Math.max(max, x.seconds);
        }
        last7.forEach(([dt, x]) => {
            const col = el('div', 'stat-col');
            const bar = el('div', 'stat-bar'); bar.style.height = Math.max(3, Math.round(x.seconds / max * 70)) + 'px';
            bar.title = `${fmt(x.seconds)}, ${x.pages} pagine`;
            col.append(el('span', 'stat-min', x.seconds ? (x.seconds < 60 ? '<1' : String(mins(x.seconds))) : ''), bar, el('span', 'stat-day', dt.toLocaleDateString('it-IT', { weekday: 'short' }).slice(0, 2)));
            bars.append(col);
        });
        const facts = el('ul', 'stat-facts');
        [[fmt(d.week.seconds), 'questa settimana'], [`${d.week.pages}`, 'pagine questa settimana'], [fmt(d.month.seconds), 'negli ultimi 30 giorni'], [`${d.streak}`, d.streak === 1 ? 'giorno di fila' : 'giorni di fila']].forEach(([n, l]) => {
            const li = el('li'); li.append(el('b', '', n), document.createTextNode(' ' + l)); facts.append(li);
        });
        const goalRow = el('div', 'goal-row');
        const label = el('label', '', 'Obiettivo settimanale (minuti) ');
        const inp = el('input', 'input-text goal-input'); inp.type = 'number'; inp.min = '0'; inp.max = '5000'; inp.value = goal || ''; inp.placeholder = 'es. 120';
        inp.addEventListener('change', () => { setPref('vector_reader_goal', Math.max(0, Math.min(5000, parseInt(inp.value, 10) || 0))); renderStats(); });
        label.append(inp); goalRow.append(label);
        const parts = [bars, facts, goalRow];
        if (goal) {
            const track = el('div', 'goal-track'); const fill = el('div', 'goal-fill'); fill.style.width = Math.min(100, Math.round(week / goal * 100)) + '%'; track.append(fill);
            parts.push(track, el('p', 'set-hint', week >= goal ? 'Obiettivo raggiunto, bravo!' : `Ti mancano ${goal - week} minuti.`));
        }
        body.replaceChildren(...parts);
    }

    // ------------------------------------------------------------------------- library shelves ---
    let tagsByBook = {}, allTags = [], counts = {};
    // Filters combine (all of them must match). Saved on this phone.
    const NO_FILTER = { status: 'all', format: 'all', author: 'all', tag: 'all', notes: false, marks: false, recent: false };
    let F = (() => {
        let f = {};
        try { f = JSON.parse(pref('vector_reader_filters', '{}')) || {}; } catch (e) { f = {}; }
        const old = pref('vector_reader_filter', '');                      // the first version saved a single string
        if (old.startsWith('tag:')) f.tag = old.slice(4); else if (['reading', 'new', 'done'].includes(old)) f.status = old;
        return { ...NO_FILTER, ...f };
    })();
    let sort = pref('vector_reader_sort', 'recent');
    let seed = 1 + Math.floor(Math.random() * 9000);   // "A caso": a new order every time you ask for it, the same while you scroll
    const saveF = () => { setPref('vector_reader_filters', JSON.stringify(F)); setPref('vector_reader_filter', ''); };
    async function loadTags() {
        const [t, c] = await Promise.all([getJson('../api/book_tags.php'), getJson('../api/highlights.php?summary=1')]);
        if (t.success) { tagsByBook = t.tags || {}; allTags = t.all || []; }
        if (c.success) counts = c.counts || {};
        paintFilters();
    }
    const activeCount = () => ['status', 'format', 'author', 'tag'].filter((k) => F[k] !== 'all').length + ['notes', 'marks', 'recent'].filter((k) => F[k]).length;
    const chip = (label, on, fn) => { const b = el('button', 'chip-btn', label); b.type = 'button'; b.setAttribute('aria-pressed', String(on)); b.addEventListener('click', fn); return b; };
    const changed = () => { saveF(); paintFilters(); ctx().refreshCatalog(); };
    function paintFilters() {
        const books = (ctx() && ctx().books) || [];
        if (F.tag !== 'all' && F.tag !== '__none__' && !allTags.includes(F.tag)) F.tag = 'all';
        if (F.author !== 'all' && books.length && !books.some((b) => (b.author || '') === F.author)) F.author = 'all';
        const box = $('shelf-filters');
        if (!box) return;
        box.replaceChildren(...[['all', 'Tutti'], ['reading', 'In corso'], ['new', 'Da iniziare'], ['done', 'Finiti']].map(([k, l]) => chip(l, F.status === k, () => { F.status = k; changed(); })));
        const fmts = [...new Set(books.map((b) => String(b.format || '').toLowerCase()))].filter(Boolean).sort();
        $('f-format').replaceChildren(...[['all', 'Tutti'], ...fmts.map((x) => [x, x.toUpperCase()])].map(([k, l]) => chip(l, F.format === k, () => { F.format = k; changed(); })));
        // authors, each with how many books
        const byAuthor = new Map();
        books.forEach((b) => { const a = b.author && b.author !== 'Unknown' ? b.author : ''; if (a) byAuthor.set(a, (byAuthor.get(a) || 0) + 1); });
        const coll = new Intl.Collator('it', { sensitivity: 'base' });
        const au = $('f-author');
        au.replaceChildren(new Option('Tutti gli autori', 'all'), ...[...byAuthor].sort((x, y) => coll.compare(x[0], y[0])).map(([a, n]) => new Option(`${a} (${n})`, a)));
        au.value = byAuthor.has(F.author) ? F.author : 'all';
        au.onchange = () => { F.author = au.value; changed(); };
        const tg = $('f-tag');
        tg.replaceChildren(new Option('Tutte le etichette', 'all'), new Option('Senza etichetta', '__none__'), ...allTags.map((t) => new Option('🏷 ' + t, t)));
        tg.value = F.tag;
        tg.onchange = () => { F.tag = tg.value; changed(); };
        $('f-flags').replaceChildren(
            chip('Con note o evidenziazioni', F.notes, () => { F.notes = !F.notes; changed(); }),
            chip('Con segnalibri', F.marks, () => { F.marks = !F.marks; changed(); }),
            chip('Aggiunti negli ultimi 30 giorni', F.recent, () => { F.recent = !F.recent; changed(); }));
        const n = activeCount();
        $('more-filters-sum').textContent = 'Altri filtri' + (['format', 'author', 'tag'].some((k) => F[k] !== 'all') || F.notes || F.marks || F.recent ? ` (${['format', 'author', 'tag'].filter((k) => F[k] !== 'all').length + [F.notes, F.marks, F.recent].filter(Boolean).length})` : '');
        const rs = $('filters-reset');
        rs.hidden = n === 0;
        rs.onclick = () => { F = { ...NO_FILTER }; changed(); };
    }
    /** The books to show: all the filters, then the sort. `prog` is reader.js's map book_id -> {percentage, updated_at}. */
    function arrange(books, prog) {
        const pct = (b) => (prog.get(Number(b.id)) || {}).percentage || 0;
        const when = (b) => String((prog.get(Number(b.id)) || {}).updated_at || '');
        const monthAgo = Date.now() - 30 * 86400000;
        const added = (b) => { const d = new Date(String(b.created_at || '').replace(' ', 'T') + 'Z'); return isNaN(d) ? 0 : d.getTime(); };
        let out = books.filter((b) => {
            const p = pct(b), c = counts[b.id] || { hl: 0, notes: 0, bookmarks: 0 };
            if (F.status === 'reading' && !(p > 0 && p < 99)) return false;
            if (F.status === 'new' && p > 0) return false;
            if (F.status === 'done' && p < 99) return false;
            if (F.format !== 'all' && String(b.format || '').toLowerCase() !== F.format) return false;
            if (F.author !== 'all' && (b.author || '') !== F.author) return false;
            const tg = tagsByBook[b.id] || [];
            if (F.tag === '__none__' && tg.length) return false;
            if (F.tag !== 'all' && F.tag !== '__none__' && !tg.includes(F.tag)) return false;
            if (F.notes && !(c.hl + c.notes > 0)) return false;
            if (F.marks && !(c.bookmarks > 0)) return false;
            if (F.recent && added(b) < monthAgo) return false;
            return true;
        });
        const count = $('shelf-count');
        if (count) count.textContent = out.length === books.length ? (books.length === 1 ? '1 libro' : `${books.length} libri`) : `${out.length} di ${books.length} libri`;
        const coll = new Intl.Collator('it', { sensitivity: 'base', numeric: true });
        const byTitle = (a, b) => coll.compare(a.title || '', b.title || '');
        const cnt = (b, k) => (counts[b.id] || {})[k] || 0;
        const size = (b) => Number(b.file_size) || 0;
        const inProg = (b) => { const p = pct(b); return p > 0 && p < 99; };
        out = out.slice();
        const by = {
            oldest: () => out.reverse(),
            title: () => out.sort(byTitle),
            'title-desc': () => out.sort((a, b) => byTitle(b, a)),
            author: () => out.sort((a, b) => coll.compare(a.author || '', b.author || '') || byTitle(a, b)),
            'author-desc': () => out.sort((a, b) => coll.compare(b.author || '', a.author || '') || byTitle(a, b)),
            progress: () => out.sort((a, b) => pct(b) - pct(a)),
            unread: () => out.sort((a, b) => pct(a) - pct(b) || byTitle(a, b)),
            finish: () => out.sort((a, b) => (inProg(b) - inProg(a)) || (inProg(a) && inProg(b) ? pct(b) - pct(a) : 0)),   // started and not finished first, the nearest to the end on top
            read: () => out.sort((a, b) => when(b).localeCompare(when(a))),
            notes: () => out.sort((a, b) => (cnt(b, 'hl') + cnt(b, 'notes')) - (cnt(a, 'hl') + cnt(a, 'notes')) || byTitle(a, b)),
            marks: () => out.sort((a, b) => cnt(b, 'bookmarks') - cnt(a, 'bookmarks') || byTitle(a, b)),
            big: () => out.sort((a, b) => size(b) - size(a)),
            small: () => out.sort((a, b) => size(a) - size(b)),
            format: () => out.sort((a, b) => String(a.format).localeCompare(String(b.format)) || byTitle(a, b)),
            random: () => out.sort((a, b) => ((a.id * seed) % 9973) - ((b.id * seed) % 9973)),
        };
        if (by[sort]) by[sort]();
        return out;                // 'recent' = the order of the list (newest upload first)
    }
    /** On every card: a clear "finished" / "% read" mark, the date of the last reading and the labels with an edit button. */
    function decorateCard(card, book, prog) {
        const cover = card.querySelector('.book-cover');
        const pct = prog && prog.percentage > 0 ? Math.round(prog.percentage) : 0;
        if (pct >= 99 && cover) cover.append(el('span', 'ribbon-done', 'Finito ✓'));
        else if (pct > 0 && cover) cover.append(el('span', 'ribbon-pct', pct + '%'));
        const info = card.querySelector('.book-info');
        if (!info) return;
        if (prog && prog.updated_at && pct > 0 && pct < 99) {
            const d = new Date(String(prog.updated_at).replace(' ', 'T') + (String(prog.updated_at).includes('Z') ? '' : 'Z'));
            if (!isNaN(d)) info.append(el('div', 'book-when', 'Letto ' + d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })));
        }
        const tags = tagsByBook[book.id] || [];
        const row = el('div', 'book-tags');
        tags.forEach((t) => { const c = el('button', 'tag-chip', t); c.type = 'button'; c.addEventListener('click', () => { F.tag = t; changed(); }); row.append(c); });
        const add = el('button', 'tag-add', tags.length ? '✎' : '+ etichetta'); add.type = 'button'; add.title = 'Etichette (scaffali) di questo libro'; add.setAttribute('aria-label', (tags.length ? '✎ Modifica le etichette di ' : '+ etichetta: ') + (book.title || 'questo libro'));
        add.addEventListener('click', (e) => { e.stopPropagation(); openTagDialog(book); });
        row.append(add);
        info.append(row);
    }
    function openTagDialog(book) {
        const dlg = $('tag-dialog'), input = $('tag-input');
        $('tag-dialog-book').textContent = book.title || '';
        input.value = (tagsByBook[book.id] || []).join(', ');
        const sug = $('tag-suggest');
        sug.replaceChildren(...allTags.map((t) => { const b = el('button', 'chip-btn', t); b.type = 'button'; b.addEventListener('click', () => { const cur = input.value.split(',').map((x) => x.trim()).filter(Boolean); if (!cur.some((x) => x.toLowerCase() === t.toLowerCase())) cur.push(t); input.value = cur.join(', '); }); return b; }));
        dlg.hidden = false;
        input.focus();
        dlg.dataset.book = String(book.id);
    }
    function bindTagDialog() {
        const dlg = $('tag-dialog');
        if (!dlg) return;
        const close = () => { dlg.hidden = true; };
        $('tag-cancel').addEventListener('click', close);
        dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !dlg.hidden) close(); });
        $('tag-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = Number(dlg.dataset.book);
            const d = await post('../api/book_tags.php', { book_id: id, tags: $('tag-input').value });
            if (!d.success) { ctx().toast('Non sono riuscito a salvare le etichette.'); return; }
            close();
            await loadTags();
            ctx().refreshCatalog();
        });
    }

    // ------------------------------------------------------------------------------ tidy titles ---
    function bindTidy() {
        const btn = $('tidy-titles-btn'), panel = $('tidy-panel');
        if (!btn || !panel) return;
        btn.addEventListener('click', async () => {
            const d = await post('../api/books.php?action=clean_titles', {});
            if (!d.success) { ctx().toast('Non riesco a controllare i titoli.'); return; }
            if (!d.changes.length) { panel.hidden = false; panel.replaceChildren(el('p', '', 'I titoli sono già in ordine.')); setTimeout(() => { panel.hidden = true; }, 3000); return; }
            const list = el('ul', 'tidy-list');
            d.changes.forEach((c) => {
                const li = el('li');
                li.append(el('s', '', c.title), document.createTextNode(' → '), el('b', '', c.new_title));
                if (c.new_author !== c.author) li.append(el('span', 'set-hint', ` (autore: ${c.author} → ${c.new_author})`));
                list.append(li);
            });
            const apply = el('button', 'btn btn-primary', `Applica (${d.changes.length})`); apply.type = 'button';
            const cancel = el('button', 'btn', 'Annulla'); cancel.type = 'button';
            cancel.addEventListener('click', () => { panel.hidden = true; });
            apply.addEventListener('click', async () => {
                const r = await post('../api/books.php?action=clean_titles', { apply: true });
                panel.hidden = true;
                if (r.success) { ctx().toast(`${r.changes.length} titoli sistemati.`); ctx().reloadCatalog(); }
            });
            const bar = el('div', 'tag-actions'); bar.append(cancel, apply);
            panel.replaceChildren(el('h3', '', 'Titoli da sistemare'), list, bar);
            panel.hidden = false;
        });
    }

    // ------------------------------------------------------------------------------------- init ---
    document.addEventListener('DOMContentLoaded', () => {
        bindTabs();
        bindText();
        bindSelection();
        bindTagDialog();
        bindTidy();
        if ($('add-note-btn')) $('add-note-btn').addEventListener('click', addPageNote);
        if ($('inbook-search-form')) $('inbook-search-form').addEventListener('submit', (e) => { e.preventDefault(); searchBook($('inbook-search-input').value); });
        const sel = $('shelf-sort'), shuffle = $('shuffle-btn');
        if (sel) {
            if ([...sel.options].some((o) => o.value === sort)) sel.value = sort; else sort = 'recent';
            const show = () => { if (shuffle) shuffle.hidden = sort !== 'random'; };
            show();
            sel.addEventListener('change', () => { sort = sel.value; seed = 1 + Math.floor(Math.random() * 9000); setPref('vector_reader_sort', sort); show(); ctx().refreshCatalog(); });
            if (shuffle) shuffle.addEventListener('click', () => { seed = 1 + Math.floor(Math.random() * 9000); ctx().refreshCatalog(); });
        }
        const stats = $('stats-section');
        if (stats) stats.addEventListener('toggle', () => { if (stats.open) renderStats(); });
        paintFilters();
    });

    document.addEventListener('reader:ready', () => {
        const c = ctx();
        items = []; shown = new Set(); pdfText.clear(); tocFor = null;
        paintText();
        applyMargins();
        $('toc-list').replaceChildren();
        buildToc();
        $('inbook-search-results').replaceChildren(); $('inbook-search-status').textContent = '';
        hookSelection();
        loadHighlights();
        startClock();
        if (c && c.format === 'epub') c.reapplyTheme();   // the saved text options reach the first page
    });
    document.addEventListener('reader:page', () => { if (skipPage) { skipPage = false; return; } pages++; lastActive = Date.now(); });
    document.addEventListener('reader:close', () => { setTimeout(async () => { await loadTags(); ctx().refreshCatalog(); }, 2900); stopClock(true); items = []; shown = new Set(); hideSelBar(); if ($('stats-section') && $('stats-section').open) setTimeout(renderStats, 2800); });

    window.VBReaderTools = { extraCss, arrange, decorateCard, loadTags };
})();
