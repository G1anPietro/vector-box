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
            toggle.textContent = opened ? 'Chiudi tutto' : 'Apri tutto';
        } });
        return el('div', { class: 'schema' },
            el('div', { class: 'schema-head' }, el('b', { class: 'schema-title' }, inline(String(data.title || 'Schema'))), toggle),
            tree);
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

    window.AppuntiCommon = { el, getJson, post, rawPost, toast, busy, md, renderSchema, inline, looksLikeMarkdown, dayFmt, parseDate, sizeText, store, stored,
        CLASS_KEY: 'vb_appunti_class',
        KINDS: { appunti: 'Appunti', slide: 'Slide / prof', libro: 'Libro', domande: 'Domande del prof', prova: 'Verifica di prova', altro: 'Altro' },
        DOC_KINDS: { completo: 'Completo', riassunto: 'Riassunto', preparazione: 'Preparazione', quiz: 'Quiz', lezione: 'Lezione', schema: 'Schema' } };
})();
