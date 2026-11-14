// public/js/appunti-common.js — shared by the class notes pages (appunti.php, appunti-carica.php, appunti-archivio.php):
// DOM builder, JSON helpers and a safe Markdown renderer. Everything written by users or AIs goes in as text
// (textContent / text nodes), never as HTML.
(() => {
    'use strict';

    function el(tag, props = {}, ...children) {
        const n = document.createElement(tag);
        let value = null;
        for (const [k, v] of Object.entries(props)) {
            if (v === undefined || v === null || v === false) continue;
            if (k === 'value') value = v;
            else if (k === 'text') n.textContent = v;
            else if (k === 'class') n.className = v;
            else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
            else if (k in n && typeof v !== 'string') n[k] = v;
            else n.setAttribute(k, v === true ? '' : v);
        }
        for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c);
        if (value !== null) {
            if (tag === 'option') n.setAttribute('value', value);
            else n.value = value;
        }
        return n;
    }

    /* ---------- feedback: toasts and busy buttons ---------- */

    // A message in a fixed box at the bottom of the screen: visible wherever the page is scrolled.
    let toastBox = null;
    function toast(msg, kind = '', ms) {
        if (!msg) return;
        if (!toastBox) {
            toastBox = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
            document.body.append(toastBox);
        }
        const t = el('div', { class: 'toast' + (kind ? ' ' + kind : '') }, el('span', { text: msg }),
            el('button', { type: 'button', class: 'toast-x', 'aria-label': 'Chiudi', text: '×', onclick: () => t.remove() }));
        toastBox.append(t);
        while (toastBox.children.length > 3) toastBox.firstElementChild.remove();
        setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms || (kind === 'err' ? 7000 : 3500));
        return t;
    }

    /**
     * Runs fn() while `btn` is disabled and shows "…": a second press does nothing until the first one is done
     * (people press again when nothing seems to happen). Without btn, uses the button that has focus.
     */
    // Safari does not focus a button when it is tapped: remember the last pressed one
    let lastPressed = null;
    let lastPressedAt = 0;
    document.addEventListener('click', (ev) => {
        const b = ev.target && ev.target.closest ? ev.target.closest('button') : null;
        if (b) { lastPressed = b; lastPressedAt = Date.now(); }
    }, true);
    document.addEventListener('submit', (ev) => {
        const b = ev.submitter || (ev.target && ev.target.querySelector('button:not([type="button"])'));
        if (b) { lastPressed = b; lastPressedAt = Date.now(); }
    }, true);

    function pressedButton() {
        const a = document.activeElement;
        if (a && a.tagName === 'BUTTON') return a;
        if (lastPressed && Date.now() - lastPressedAt < 1500 && lastPressed.isConnected) return lastPressed;
        return null;
    }

    async function busy(btn, fn) {
        const b = btn || pressedButton();
        if (b && b.dataset.busy) return undefined;
        if (b) { b.dataset.busy = '1'; b.disabled = true; b.classList.add('is-busy'); }
        try {
            return await fn();
        } finally {
            if (b) { delete b.dataset.busy; b.disabled = false; b.classList.remove('is-busy'); }
        }
    }

    async function getJson(url) {
        const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j || !j.success) throw Object.assign(new Error((j && j.error) || 'Qualcosa è andato storto.'), { json: j, status: r.status });
        return j;
    }

    function post(url, body) { return busy(null, () => rawPost(url, body)); }

    async function rawPost(url, body) {
        const isForm = body instanceof FormData;
        const r = await fetch(url, {
            method: 'POST', credentials: 'same-origin',
            headers: isForm ? {} : { 'Content-Type': 'application/json' },
            body: isForm ? body : JSON.stringify(body),
        });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j || !j.success) throw Object.assign(new Error((j && j.error) || 'Qualcosa è andato storto.'), { json: j, status: r.status });
        return j;
    }

    /* ---------- Markdown (the dialect ChatGPT, Gemini and Claude write) ---------- */

    // **bold**, __bold__, *italic*, _italic_, `code`, ~~strike~~, [L1]/[2] source references
    function inline(text) {
        const frag = document.createDocumentFragment();
        const re = /(`[^`]+`|\*\*(?=\S)[\s\S]*?\S\*\*|__(?=\S)[\s\S]*?\S__|~~(?=\S)[\s\S]*?\S~~|\*(?=[^\s*])[^*]*?[^\s*]\*|\*[^\s*]\*|(?<![\w])_(?=\S)[^_]*?\S_(?![\w])|\[L?\d+\])/g;
        let last = 0;
        for (const m of text.matchAll(re)) {
            if (m.index > last) frag.append(text.slice(last, m.index));
            const t = m[0];
            if (t.startsWith('`')) frag.append(el('code', { text: t.slice(1, -1) }));
            else if (t.startsWith('**') || t.startsWith('__')) frag.append(el('strong', {}, inline(t.slice(2, -2))));
            else if (t.startsWith('~~')) frag.append(el('s', {}, inline(t.slice(2, -2))));
            else if (t.startsWith('[')) frag.append(el('span', { class: 'cite', text: t }));
            else frag.append(el('em', {}, inline(t.slice(1, -1))));
            last = m.index + t.length;
        }
        if (last < text.length) frag.append(text.slice(last));
        return frag;
    }

    const LIST_RE = /^(\s*)([-*+•]|\d+[.)])\s+(.*)$/;
    const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
    const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

    /** Next non-empty line index from i (or lines.length). */
    function nextFilled(lines, i) {
        while (i < lines.length && !lines[i].trim()) i++;
        return i;
    }

    function md(src) {
        const out = document.createDocumentFragment();
        const lines = String(src || '').replace(/\r/g, '').replace(/ /g, ' ').split('\n');
        let i = 0;
        while (i < lines.length) {
            const line = lines[i];
            if (!line.trim()) { i++; continue; }
            if (/^\s*```/.test(line)) {
                const buf = [];
                i++;
                while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
                i++;
                out.append(el('pre', {}, el('code', { text: buf.join('\n') })));
                continue;
            }
            const h = /^\s*(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
            if (h) { out.append(el('h' + Math.min(5, h[1].length + 1), {}, inline(h[2]))); i++; continue; }
            if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.append(el('hr')); i++; continue; }
            if (/^\s*>/.test(line)) {
                const buf = [];
                while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
                out.append(el('blockquote', {}, md(buf.join('\n'))));
                continue;
            }
            if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
                const head = cells(line);
                i += 2;
                const rows = [];
                while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
                out.append(el('div', { class: 'table-wrap' }, el('table', {},
                    el('thead', {}, el('tr', {}, ...head.map((c) => el('th', {}, inline(c))))),
                    el('tbody', {}, ...rows.map((r) => el('tr', {}, ...r.map((c) => el('td', {}, inline(c)))))))));
                continue;
            }
            const first = LIST_RE.exec(line);
            if (first) {
                // A list goes on across blank lines (AIs put one between items) while list items keep coming
                const ordered = /\d/.test(first[2]);
                const list = el(ordered ? 'ol' : 'ul');
                if (ordered && parseInt(first[2], 10) > 1) list.start = parseInt(first[2], 10);
                const baseIndent = first[1].length;
                while (i < lines.length) {
                    const j = nextFilled(lines, i);
                    if (j >= lines.length) { i = j; break; }
                    const m = LIST_RE.exec(lines[j]);
                    if (m) {
                        const sameKind = /\d/.test(m[2]) === ordered;
                        const indented = m[1].length > baseIndent;
                        // "1. **Domanda**" followed by "* **Risposta:**" at the same indent: the bullet belongs to the
                        // numbered item, like Gemini means it
                        if ((indented || (!sameKind && ordered)) && list.lastChild) {
                            const subOrdered = /\d/.test(m[2]);
                            let sub = list.lastChild.lastElementChild;
                            if (!sub || sub.tagName !== (subOrdered ? 'OL' : 'UL')) { sub = el(subOrdered ? 'ol' : 'ul'); list.lastChild.append(sub); }
                            sub.append(el('li', {}, inline(m[3])));
                            i = j + 1;
                            continue;
                        }
                        if (!sameKind) break;
                        list.append(el('li', {}, inline(m[3])));
                        i = j + 1;
                        continue;
                    }
                    // continuation line of the previous item (indented, right below it)
                    if (j === i && /^\s{2,}\S/.test(lines[j]) && list.lastChild) {
                        list.lastChild.append(' ', inline(lines[j].trim()));
                        i = j + 1;
                        continue;
                    }
                    break;
                }
                out.append(list);
                continue;
            }
            const buf = [];
            while (i < lines.length && lines[i].trim() && !/^\s*(#{1,6}\s|```|>)/.test(lines[i]) && !LIST_RE.test(lines[i])
                && !(lines[i].includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]))) buf.push(lines[i++].trim());
            if (!buf.length) buf.push(lines[i++].trim());
            out.append(el('p', {}, inline(buf.join(' '))));
        }
        return out;
    }

    /**
     * A schema (concept map) written by the AI as JSON {title, children:[{label, note, children}]}: drawn as a tree with
     * branches that open and close. Text only (light, fast, readable without the picture).
     */
    function renderSchema(content) {
        let data = null;
        try { data = typeof content === 'string' ? JSON.parse(content) : content; } catch (e) { /* below */ }
        if (!data || !Array.isArray(data.children)) return el('p', { class: 'empty', text: 'Schema non leggibile.' });
        const node = (n, depth) => {
            const label = el('span', { class: 'sc-label' }, inline(String(n.label || '')));
            const note = n.note ? el('span', { class: 'sc-note' }, inline(String(n.note))) : null;
            const kids = Array.isArray(n.children) && n.children.length
                ? el('ul', {}, ...n.children.map((c) => node(c, depth + 1))) : null;
            if (!kids) return el('li', { class: 'sc-leaf' }, el('div', { class: 'sc-box' }, label, note));
            return el('li', {}, el('details', { open: depth < 2 },
                el('summary', { class: 'sc-box' }, label, note), kids));
        };
        const tree = el('ul', { class: 'schema-tree' }, ...data.children.map((c) => node(c, 1)));
        let opened = false;
        const toggle = el('button', { type: 'button', class: 'ghost mini', text: 'Apri tutto', onclick: () => {
            opened = !opened;
            tree.querySelectorAll('details').forEach((d) => { d.open = opened; });
            map.querySelectorAll('.mm-branch.has-kids').forEach((b) => b.classList.toggle('collapsed', !opened));
            toggle.textContent = opened ? 'Chiudi tutto' : 'Apri tutto';
        } });

        /* The same data as a two-dimensional map: the main topic in the centre, branches to the right and to the left,
           one colour per branch. Drag to move, +/- to zoom, tap a node to close or open its branch. */
        const HUES = [8, 32, 150, 200, 265, 320, 95, 230];
        const branch = (n, depth) => {
            const kids = Array.isArray(n.children) ? n.children : [];
            const box = el('div', { class: 'mm-node d' + Math.min(depth, 3) }, el('span', { class: 'mm-label' }, inline(String(n.label || ''))),
                n.note ? el('span', { class: 'mm-note' }, inline(String(n.note))) : null);
            const b = el('div', { class: 'mm-branch' + (kids.length ? ' has-kids' : '') + (kids.length && depth >= 2 ? ' collapsed' : '') }, box,
                kids.length ? el('div', { class: 'mm-kids' }, ...kids.map((c) => branch(c, depth + 1))) : null);
            if (kids.length) box.addEventListener('click', () => { if (!moved) b.classList.toggle('collapsed'); });
            return b;
        };
        const tops = data.children.map((c, i) => { const b = branch(c, 1); b.style.setProperty('--c', `hsl(${HUES[i % HUES.length]} 70% 60%)`); return b; });
        // more branches on the right; the left side takes the rest (balanced by number of nodes)
        const weight = (n) => 1 + (Array.isArray(n.children) ? n.children.reduce((a, c) => a + weight(c), 0) : 0);
        const total = data.children.reduce((a, c) => a + weight(c), 0);
        let acc = 0;
        const right = [];
        const left = [];
        data.children.forEach((c, i) => { (acc < total / 2 || data.children.length < 3 ? right : left).push(tops[i]); acc += weight(c); });
        const canvas = el('div', { class: 'mm-canvas' },
            el('div', { class: 'mm-side left' }, ...left),
            el('div', { class: 'mm-center' }, inline(String(data.title || 'Schema'))),
            el('div', { class: 'mm-side right' }, ...right));
        const map = el('div', { class: 'mm', tabIndex: 0, 'aria-label': 'Mappa dello schema: trascina per spostarti' }, canvas);
        let scale = 1;
        const zoom = (z) => { scale = Math.max(0.3, Math.min(2, z)); canvas.style.zoom = String(scale); };
        const fit = () => { canvas.style.zoom = '1'; const w = canvas.scrollWidth || 1; zoom(Math.min(1, (map.clientWidth - 16) / w));
            map.scrollLeft = (map.scrollWidth - map.clientWidth) / 2; };
        // drag to pan (mouse); touch screens scroll natively
        let moved = false;
        let drag = null;
        map.addEventListener('pointerdown', (ev) => { if (ev.pointerType === 'mouse') { drag = { x: ev.clientX, y: ev.clientY, l: map.scrollLeft, t: map.scrollTop }; moved = false; } });
        map.addEventListener('pointermove', (ev) => {
            if (!drag) return;
            if (Math.abs(ev.clientX - drag.x) + Math.abs(ev.clientY - drag.y) > 5) { moved = true; map.classList.add('dragging'); }
            map.scrollLeft = drag.l - (ev.clientX - drag.x);
            map.scrollTop = drag.t - (ev.clientY - drag.y);
        });
        ['pointerup', 'pointerleave', 'pointercancel'].forEach((n) => map.addEventListener(n, () => { drag = null; map.classList.remove('dragging'); setTimeout(() => { moved = false; }, 0); }));

        const VIEW_KEY = 'vb_schema_view';
        const wrap = el('div', { class: 'schema' });
        const setView = (v) => {
            wrap.dataset.view = v;
            store(VIEW_KEY, v);
            viewBtn.textContent = v === 'map' ? 'Elenco' : 'Mappa';
            if (v === 'map') requestAnimationFrame(fit);
        };
        const viewBtn = el('button', { type: 'button', class: 'ghost mini', onclick: () => setView(wrap.dataset.view === 'map' ? 'list' : 'map') });
        const zoomBtns = el('span', { class: 'mm-zoom' },
            el('button', { type: 'button', class: 'ghost mini', text: '−', 'aria-label': 'Rimpicciolisci', onclick: () => zoom(scale - 0.15) }),
            el('button', { type: 'button', class: 'ghost mini', text: '+', 'aria-label': 'Ingrandisci', onclick: () => zoom(scale + 0.15) }),
            el('button', { type: 'button', class: 'ghost mini', text: 'Adatta', onclick: fit }));
        wrap.append(
            el('div', { class: 'schema-head' }, el('b', { class: 'schema-title' }, inline(String(data.title || 'Schema'))),
                el('span', { class: 'schema-tools' }, zoomBtns, toggle, viewBtn)),
            map, tree);
        setView(stored(VIEW_KEY) || (window.innerWidth >= 700 ? 'map' : 'list'));
        return wrap;
    }

    /**
     * The questions of a lesson (JSON {domande:[{domanda, risposta, origine: 'prof'|'ai', fonte}]}): the teacher's first,
     * each answer hidden until you open it (to test yourself).
     */
    function renderQuestions(content) {
        let data = null;
        try { data = typeof content === 'string' ? JSON.parse(content) : content; } catch (e) { /* below */ }
        const list = data && Array.isArray(data.domande) ? data.domande : null;
        if (!list) return el('p', { class: 'empty', text: 'Domande non leggibili.' });
        const prof = list.filter((q) => q.origine === 'prof');
        const ai = list.filter((q) => q.origine !== 'prof');
        const item = (q) => el('li', { class: 'qa' },
            el('div', { class: 'qa-q' }, el('span', { class: 'qa-badge ' + (q.origine === 'prof' ? 'prof' : 'ai'), text: q.origine === 'prof' ? 'Fatta dal prof' : 'Probabile' }),
                inline(String(q.domanda || '')), q.fonte ? el('span', { class: 'cite', text: ' ' + q.fonte }) : null),
            q.risposta ? el('details', {}, el('summary', { text: 'Risposta' }), el('div', { class: 'qa-a md' }, md(String(q.risposta)))) : null);
        return el('div', { class: 'questions' },
            prof.length ? el('h3', { text: `Domande del prof (${prof.length})` }) : el('p', { class: 'muted small', text: 'Nel materiale non ci sono domande fatte dal prof: queste sono quelle probabili.' }),
            prof.length ? el('ol', { class: 'qa-list' }, ...prof.map(item)) : null,
            ai.length ? el('h3', { text: prof.length ? `Altre domande probabili (${ai.length})` : `Domande probabili (${ai.length})` }) : null,
            ai.length ? el('ol', { class: 'qa-list' }, ...ai.map(item)) : null);
    }

    /** True when a plain text looks like Markdown written by an AI or a person (so it is worth rendering). */
    function looksLikeMarkdown(s) {
        return /(^|\n)\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|```)|\*\*\S|__\S|\|\s*-{3,}/.test(String(s || ''));
    }

    const dayFmt = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
    function sizeText(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
    function store(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* private mode */ } }
    function stored(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }

    /* ---------- Date picker: week from Monday (Italy) or Sunday, the viewer's choice ----------
       Every <input type="date"> of the notes pages becomes a button that opens a month calendar. The input stays in the
       page (hidden, same name/id) and keeps a YYYY-MM-DD value, so forms and scripts read and set .value as before. */
    const WEEK_KEY = 'vb_week_start';
    const weekStart = () => (stored(WEEK_KEY) === 'sun' ? 0 : 1);
    const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
    const WD = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const shortFmt = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    const valueDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

    function enhanceDate(input) {
        if (input.dataset.dp) return;
        input.dataset.dp = '1';
        input.type = 'text';
        input.classList.add('dp-native');
        input.tabIndex = -1;
        input.setAttribute('aria-hidden', 'true');
        const btn = el('button', { type: 'button', class: 'dp-btn' });
        const label = () => {
            const v = valueDesc.get.call(input);
            btn.textContent = /^\d{4}-\d{2}-\d{2}$/.test(v) ? '📅 ' + shortFmt.format(parseDate(v)) : '📅 Scegli il giorno';
            btn.classList.toggle('dp-empty', !v);
        };
        Object.defineProperty(input, 'value', { configurable: true, get() { return valueDesc.get.call(this); }, set(v) { valueDesc.set.call(this, v); label(); } });
        if (input.form) input.form.addEventListener('reset', () => setTimeout(label, 0));
        btn.addEventListener('click', () => openPicker(input));
        input.after(btn);
        label();
    }

    function openPicker(input) {
        const cur = /^\d{4}-\d{2}-\d{2}$/.test(input.value) ? parseDate(input.value) : new Date();
        let y = cur.getFullYear();
        let m = cur.getMonth();
        const dlg = el('dialog', { class: 'dp-dialog', 'aria-label': 'Scegli il giorno' });
        const pick = (v) => {
            input.value = v;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            dlg.close();
        };
        const draw = () => {
            const ws = weekStart();
            const first = new Date(y, m, 1);
            const offset = (first.getDay() - ws + 7) % 7;
            const days = new Date(y, m + 1, 0).getDate();
            const today = iso(new Date());
            const grid = el('div', { class: 'dp-grid' }, ...[0, 1, 2, 3, 4, 5, 6].map((i) => el('span', { class: 'dp-wd', text: WD[(i + ws) % 7] })));
            for (let i = 0; i < offset; i++) grid.append(el('span'));
            for (let d = 1; d <= days; d++) {
                const date = new Date(y, m, d);
                const v = iso(date);
                const out = (input.min && v < input.min) || (input.max && v > input.max);
                grid.append(el('button', { type: 'button', text: String(d), disabled: !!out,
                    class: 'dp-day' + (v === input.value ? ' sel' : '') + (v === today ? ' today' : '') + (date.getDay() === 0 ? ' sun' : ''),
                    onclick: () => pick(v) }));
            }
            dlg.replaceChildren(
                el('div', { class: 'dp-head' },
                    el('button', { type: 'button', class: 'ghost mini', text: '‹', 'aria-label': 'Mese prima', onclick: () => { if (--m < 0) { m = 11; y--; } draw(); } }),
                    el('b', { text: `${MONTHS[m]} ${y}` }),
                    el('button', { type: 'button', class: 'ghost mini', text: '›', 'aria-label': 'Mese dopo', onclick: () => { if (++m > 11) { m = 0; y++; } draw(); } })),
                grid,
                el('div', { class: 'dp-foot' },
                    el('button', { type: 'button', class: 'ghost mini', text: 'Oggi', onclick: () => pick(today) }),
                    input.required ? null : el('button', { type: 'button', class: 'ghost mini', text: 'Nessuna', onclick: () => pick('') }),
                    el('label', { class: 'dp-week' }, 'Settimana da ',
                        el('select', { 'aria-label': 'La settimana inizia', onchange: (ev) => { store(WEEK_KEY, ev.target.value); draw(); } },
                            el('option', { value: 'mon', text: 'lunedì', selected: ws === 1 }),
                            el('option', { value: 'sun', text: 'domenica', selected: ws === 0 })))));
            const sel = dlg.querySelector('.dp-day.sel') || dlg.querySelector('.dp-day.today');
            if (sel) sel.focus();
        };
        dlg.addEventListener('close', () => { dlg.remove(); input.nextElementSibling && input.nextElementSibling.focus(); });
        dlg.addEventListener('click', (ev) => { if (ev.target === dlg) dlg.close(); });   // tap outside closes
        document.body.append(dlg);
        draw();
        dlg.showModal();
    }

    function enhanceAll(root) {
        if (root.matches && root.matches('input[type="date"]')) enhanceDate(root);
        if (root.querySelectorAll) root.querySelectorAll('input[type="date"]').forEach(enhanceDate);
    }
    enhanceAll(document);
    new MutationObserver((list) => list.forEach((r) => r.addedNodes.forEach((n) => { if (n.nodeType === 1) enhanceAll(n); })))
        .observe(document.documentElement, { childList: true, subtree: true });

    /* ---------- "⋯" menu: the actions of an element without a row of big buttons ---------- */
    function closeMenus() { document.querySelectorAll('.kebab-list:not([hidden])').forEach((l) => { l.hidden = true; }); }
    document.addEventListener('click', closeMenus);
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeMenus(); });
    /** items: [{label, onclick, danger?}] (falsy entries are skipped). Returns null when there is nothing to do. */
    function menu(items, label = 'Altre azioni') {
        const list = items.filter(Boolean);
        if (!list.length) return null;
        const box = el('div', { class: 'kebab-list', hidden: true, role: 'menu' }, ...list.map((i) => el('button', {
            type: 'button', role: 'menuitem', class: i.danger ? 'danger-item' : '', text: i.label,
            onclick: (ev) => { ev.stopPropagation(); box.hidden = true; i.onclick(ev); } })));
        const btn = el('button', { type: 'button', class: 'kebab-btn', text: '⋯', title: label, 'aria-label': label, 'aria-haspopup': 'menu',
            onclick: (ev) => { ev.stopPropagation(); const was = box.hidden; closeMenus(); box.hidden = !was; } });
        return el('span', { class: 'kebab' }, btn, box);
    }

    /** A small modal form. build(form) appends the fields; onSave(form) may throw to keep it open. */
    function dialogForm(title, build, onSave, saveText = 'Salva') {
        const dlg = el('dialog', { class: 'tt-dialog' });
        const form = el('form', { method: 'dialog', class: 'stack' }, el('h3', { text: title }));
        build(form);
        form.append(el('div', { class: 'row' }, el('button', { value: 'save', text: saveText }),
            el('button', { type: 'button', class: 'ghost', text: 'Annulla', onclick: () => dlg.close() })));
        form.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            try { await onSave(form); dlg.close(); } catch (e) { toast(e.message, 'err'); }
        });
        dlg.append(form);
        dlg.addEventListener('close', () => dlg.remove());
        dlg.addEventListener('click', (ev) => { if (ev.target === dlg) dlg.close(); });
        document.body.append(dlg);
        dlg.showModal();
        const first = form.querySelector('input, select, textarea');
        if (first) first.focus();
        return dlg;
    }

    /* ---------- reading index: headings of a long document and where you got to ---------- */
    let readStop = null;
    /**
     * Puts a collapsible index at the top of a rendered document (the headings h2/h3 inside `box`) and remembers how far the
     * reader scrolled, per document, on this device: the headings already passed are ticked, "Riprendi" jumps to the last one.
     */
    function addIndex(box, key) {
        if (readStop) { readStop(); readStop = null; }
        const heads = [...box.querySelectorAll('h2, h3')];
        if (heads.length < 3) return;
        const k = 'vb_read_' + key;
        let furthest = Number(stored(k));
        if (!Number.isInteger(furthest) || furthest < -1 || furthest >= heads.length) furthest = -1;
        const links = heads.map((h, i) => el('button', { type: 'button', class: 'idx-link' + (h.tagName === 'H3' ? ' sub' : ''), text: h.textContent,
            onclick: () => { h.scrollIntoView({ behavior: 'smooth', block: 'start' }); idx.open = false; } }));
        const paint = () => links.forEach((l, i) => l.classList.toggle('read', i <= furthest));
        const resume = furthest >= 0 && furthest < heads.length - 1
            ? el('button', { type: 'button', class: 'idx-resume', text: `Riprendi da «${heads[furthest].textContent}»`,
                onclick: () => { heads[furthest].scrollIntoView({ behavior: 'smooth', block: 'start' }); } }) : null;
        const idx = el('details', { class: 'doc-index' },
            el('summary', { text: `Indice (${heads.length})` }), ...links);
        box.insertBefore(el('div', { class: 'doc-index-wrap' }, idx, resume), box.firstChild);
        paint();
        let queued = false;
        const check = () => {
            queued = false;
            let now = -1;
            heads.forEach((h, i) => { if (h.getBoundingClientRect().top < window.innerHeight * 0.45) now = i; });
            // only forwards, so that scrolling up to re-read does not lose the place
            if (now > furthest) { furthest = now; store(k, String(furthest)); paint(); }
        };
        const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(check); } };
        document.addEventListener('scroll', onScroll, { capture: true, passive: true });
        readStop = () => document.removeEventListener('scroll', onScroll, { capture: true });
    }

    window.AppuntiCommon = { el, addIndex, menu, dialogForm, getJson, post, rawPost, toast, busy, md, renderSchema, renderQuestions, inline, looksLikeMarkdown, dayFmt, parseDate, sizeText, store, stored,
        CLASS_KEY: 'vb_appunti_class',
        KINDS: { appunti: 'Appunti', slide: 'Slide / prof', libro: 'Libro', domande: 'Domande del prof', prova: 'Verifica di prova', altro: 'Altro' },
        DOC_KINDS: { completo: 'Completo', riassunto: 'Riassunto', preparazione: 'Preparazione', quiz: 'Quiz', lezione: 'Lezione', schema: 'Schema', domande: 'Domande' } };
})();
