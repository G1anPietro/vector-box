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
     * The schema as a picture file: a tidy tree drawn left to right, in plain SVG (text stays text, boxes stay shapes: it opens and
     * can be edited in Inkscape, Illustrator, Figma, Affinity or LibreOffice Draw). `mono` = black on white, for printing.
     */
    function schemaSvg(data, mono) {
        const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const plain = (t) => String(t || '').replace(/[*_`]/g, '');
        const wrap = (t, max) => {
            const lines = []; let cur = '';
            for (const w of plain(t).split(/\s+/).filter(Boolean)) {
                if (cur && (cur + ' ' + w).length > max) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
            }
            if (cur) lines.push(cur);
            return lines.slice(0, 6);
        };
        const CW = 7.4; const CN = 6.4; const LH = 18; const NH = 15; const PAD = 10; const GAPY = 12; const GAPX = 46;
        const HUES = [8, 32, 150, 200, 265, 320, 95, 230];
        const mk = (n, depth, hue) => {
            const label = wrap(n.label, 26); const note = wrap(n.note, 34);
            const w = Math.max(60, Math.max(...label.map((l) => l.length * CW), ...note.map((l) => l.length * CN), 0) + PAD * 2);
            const h = label.length * LH + note.length * NH + PAD * 2 - (note.length ? 0 : 2);
            return { label, note, w, h, depth, hue, kids: (Array.isArray(n.children) ? n.children : []).map((c, i) => mk(c, depth + 1, depth === 0 ? HUES[i % HUES.length] : hue)) };
        };
        const root = mk({ label: data.title || 'Schema', children: [] }, 0, 0);
        const tops = (Array.isArray(data.children) ? data.children : []).map((c, i) => mk(c, 1, HUES[i % HUES.length]));
        // same balance as on the site: about half of the nodes on each side
        const weight = (n) => 1 + n.kids.reduce((x, k) => x + weight(k), 0);
        const total = tops.reduce((x, n) => x + weight(n), 0);
        let acc = 0; const right = []; const left = [];
        tops.forEach((n) => { (acc < total / 2 || tops.length < 3 ? right : left).push(n); acc += weight(n); });
        // the pseudo root has no box: place its children directly
        const placeSide = (list, dir) => {
            const colW = [];
            const walk = (n) => { colW[n.depth] = Math.max(colW[n.depth] || 0, n.w); n.kids.forEach(walk); };
            list.forEach(walk);
            const edge = []; let e = 0;
            for (let d = 1; d < colW.length; d++) { edge[d] = e + GAPX; e = edge[d] + colW[d]; }
            let cursor = 0;
            const place = (n) => {
                n.x = dir > 0 ? root.w / 2 + edge[n.depth] : -root.w / 2 - edge[n.depth] - n.w;
                if (!n.kids.length) { n.y = cursor; cursor += n.h + GAPY; return; }
                n.kids.forEach(place);
                n.y = (n.kids[0].y + n.kids[n.kids.length - 1].y + n.kids[n.kids.length - 1].h) / 2 - n.h / 2;
            };
            list.forEach(place);
            return Math.max(0, cursor - GAPY);
        };
        const hR = placeSide(right, 1); const hL = placeSide(left, -1);
        const HH = Math.max(hR, hL, root.h);
        const shift = (list, h) => { const off = (HH - h) / 2; const mv = (n) => { n.y += off; n.kids.forEach(mv); }; list.forEach(mv); };
        shift(right, hR); shift(left, hL);
        root.x = -root.w / 2; root.y = (HH - root.h) / 2;
        root.kids = [...right, ...left];
        let minX = Infinity; let maxX = -Infinity;
        (function bounds(n) { minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x + n.w); n.kids.forEach(bounds); })(root);
        const dx = 20 - minX; const dy = 20;
        const W = maxX - minX + 40; const H = HH + 40;
        const out = [];
        const color = (n, what) => {
            if (mono) return what === 'fill' ? '#ffffff' : '#000000';
            if (n.depth === 0) return what === 'fill' ? '#23304a' : what === 'stroke' ? '#23304a' : '#ffffff';
            return what === 'fill' ? `hsl(${n.hue} 75% ${n.depth === 1 ? 86 : 94}%)` : what === 'stroke' ? `hsl(${n.hue} 60% 42%)` : '#1b1b1b';
        };
        (function links(n) {
            for (const k of n.kids) {
                const dir = k.x > n.x ? 1 : -1;
                const x1 = dir > 0 ? n.x + n.w : n.x; const x2 = dir > 0 ? k.x : k.x + k.w;
                const y1 = n.y + n.h / 2; const y2 = k.y + k.h / 2; const mid = (x1 + x2) / 2;
                out.push(`<path d="M ${x1 + dx} ${y1 + dy} C ${mid + dx} ${y1 + dy}, ${mid + dx} ${y2 + dy}, ${x2 + dx} ${y2 + dy}" fill="none" stroke="${mono ? '#000' : `hsl(${k.hue} 60% 48%)`}" stroke-width="${mono ? 1.5 : 2.5}" stroke-linecap="round"/>`);
                links(k);
            }
        })(root);
        (function boxes(n) {
            const x = n.x + dx; const y = n.y + dy;
            out.push(`<g><rect x="${x}" y="${y}" width="${n.w}" height="${n.h}" rx="10" fill="${color(n, 'fill')}" stroke="${color(n, 'stroke')}" stroke-width="1.5"/>`);
            let ty = y + PAD + 13;
            for (const l of n.label) { out.push(`<text x="${x + PAD}" y="${ty}" font-size="14" font-weight="700" fill="${color(n, 'text')}">${esc(l)}</text>`); ty += LH; }
            for (const l of n.note) { out.push(`<text x="${x + PAD}" y="${ty - 2}" font-size="12" fill="${mono ? '#000' : n.depth === 0 ? '#dfe6f5' : '#444'}">${esc(l)}</text>`); ty += NH; }
            out.push('</g>');
            n.kids.forEach(boxes);
        })(root);
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(W)}" height="${Math.ceil(H)}" viewBox="0 0 ${Math.ceil(W)} ${Math.ceil(H)}" font-family="Arial, Helvetica, sans-serif"><title>${esc(plain(data.title || 'Schema'))}</title><rect width="100%" height="100%" fill="#ffffff"/>${out.join('')}</svg>`;
    }

    /** Saves a Blob as a file (works on phones too: the browser's own download). */
    function saveBlob(blob, name) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }

    /** The schema as a file: SVG (editable) or PNG (an image), in colour or black and white. Returns {blob, name}. */
    async function schemaBlob(data, format, mono, name) {
        const svg = schemaSvg(data, mono);
        const base = (String(name || 'schema').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'schema') + (mono ? '-bn' : '-colori');
        if (format === 'svg') return { blob: new Blob([svg], { type: 'image/svg+xml' }), name: base + '.svg' };
        const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        try {
            const img = new Image();
            await new Promise((ok, ko) => { img.onload = ok; img.onerror = ko; img.src = url; });
            const k = Math.min(3, 6000 / Math.max(img.width, img.height, 1));   // sharp, but never a huge canvas
            const cv = document.createElement('canvas');
            cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
            const cx = cv.getContext('2d');
            cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
            cx.drawImage(img, 0, 0, cv.width, cv.height);
            const blob = await new Promise((ok) => cv.toBlob(ok, 'image/png'));
            if (!blob) throw new Error('png');
            return { blob, name: base + '.png' };
        } finally { URL.revokeObjectURL(url); }
    }
    async function downloadSchema(data, format, mono, name) {
        const f = await schemaBlob(data, format, mono, name);
        saveBlob(f.blob, f.name);
    }

    /**
     * Sends something out with the phone's own share sheet (Gmail, WhatsApp, Drive...: the person's own account, not the site's).
     * {blob, name, title} shares a file; {text, title} shares text (it becomes the body of an e-mail). Without a share sheet (a computer):
     * a file is downloaded to attach, a text opens the e-mail program with the text already in it.
     */
    async function shareOut({ blob, name, title, text }) {
        try {
            if (blob && navigator.canShare) {
                const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
                if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: title || name }); return 'shared'; }
            }
            if (text && navigator.share) { await navigator.share({ title: title || '', text }); return 'shared'; }
        } catch (e) { if (e && e.name === 'AbortError') return 'cancel'; }
        if (blob) { saveBlob(blob, name); toast('Scaricato: allegalo alla tua e-mail o a WhatsApp.', 'ok'); return 'saved'; }
        if (text) {
            window.open('mailto:?subject=' + encodeURIComponent(title || '') + '&body=' + encodeURIComponent(text.slice(0, 1800)), '_self');
            return 'mailto';
        }
        return 'none';
    }
    const markdownFile = (title, content) => ({ blob: new Blob([`# ${title}\n\n${content}\n`], { type: 'text/plain;charset=utf-8' }), name: String(title).replace(/[\\/:*?"<>|]+/g, '-') + '.md' });

    /**
     * Full screen for a block (a document, a schema, a preview): the browser's own full screen when there is one (not on iPhone),
     * otherwise the block just covers the page. A "Chiudi" button is always there.
     */
    let fsOn = null;
    function toggleFull(target, onChange) {
        const exit = () => {
            if (!fsOn) return;
            const { t, cb, btn } = fsOn; fsOn = null;
            t.classList.remove('is-fs'); btn.remove();
            document.documentElement.classList.remove('has-fs');
            if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
            if (cb) cb(false);
        };
        if (fsOn) { exit(); return; }
        const btn = el('button', { type: 'button', class: 'fs-close', text: 'Chiudi', onclick: exit });
        target.classList.add('is-fs'); target.append(btn);
        document.documentElement.classList.add('has-fs');
        fsOn = { t: target, cb: onChange, btn, exit };
        if (target.requestFullscreen) target.requestFullscreen().catch(() => {});
        if (onChange) onChange(true);
    }
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && fsOn) fsOn.exit(); });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && fsOn) fsOn.exit(); });
    const fullButton = (getTarget, onChange) => el('button', { type: 'button', class: 'ghost mini fs-btn', text: 'Schermo intero', onclick: () => toggleFull(getTarget(), onChange) });

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
            requestAnimationFrame(drawLinks);
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
            if (kids.length) box.addEventListener('click', () => { if (!moved) { b.classList.toggle('collapsed'); requestAnimationFrame(drawLinks); } });
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
        const SVGNS = 'http://www.w3.org/2000/svg';
        const links = document.createElementNS(SVGNS, 'svg');
        links.setAttribute('class', 'mm-links');
        links.setAttribute('aria-hidden', 'true');
        const center = el('div', { class: 'mm-center' }, inline(String(data.title || 'Schema')));
        const canvas = el('div', { class: 'mm-canvas' }, links,
            el('div', { class: 'mm-side left' }, ...left), center, el('div', { class: 'mm-side right' }, ...right));
        /** Position of an element inside the canvas (layout pixels, not affected by the zoom). */
        const posIn = (node) => { let x = 0; let y = 0; for (let n = node; n && n !== canvas; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; } return { x, y, w: node.offsetWidth, h: node.offsetHeight }; };
        /** A curve from the centre to every main branch, so that each branch is really connected to the main topic. */
        function drawLinks() {
            const W = canvas.offsetWidth; const H = canvas.offsetHeight;
            if (!W || !H) return;
            links.setAttribute('width', String(W)); links.setAttribute('height', String(H)); links.setAttribute('viewBox', `0 0 ${W} ${H}`);
            const c = posIn(center);
            const paths = [];
            for (const [list, side] of [[left, -1], [right, 1]]) {
                for (const b of list) {
                    const n = posIn(b.querySelector(':scope > .mm-node'));
                    const x1 = side > 0 ? c.x + c.w : c.x; const y1 = c.y + c.h / 2;
                    const x2 = side > 0 ? n.x : n.x + n.w; const y2 = n.y + n.h / 2;
                    const mid = (x1 + x2) / 2;
                    const path = document.createElementNS(SVGNS, 'path');
                    path.setAttribute('d', `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`);
                    path.setAttribute('stroke', b.style.getPropertyValue('--c'));
                    path.setAttribute('fill', 'none');
                    path.setAttribute('stroke-width', '3');
                    path.setAttribute('stroke-linecap', 'round');
                    paths.push(path);
                }
            }
            links.replaceChildren(...paths);
        }
        const map = el('div', { class: 'mm', tabIndex: 0, 'aria-label': 'Mappa dello schema: trascina per spostarti' }, canvas);
        let scale = 1;
        const zoom = (z) => { scale = Math.max(0.3, Math.min(2, z)); canvas.style.zoom = String(scale); };
        const fit = () => { canvas.style.zoom = '1'; drawLinks(); const w = canvas.scrollWidth || 1; zoom(Math.min(1, (map.clientWidth - 16) / w));
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
        const closeMenu = () => { menu.hidden = true; dlBtn.setAttribute('aria-expanded', 'false'); };
        const run = (fn) => async () => { closeMenu(); try { await fn(); } catch (e) { toast('Non sono riuscito a creare il file.', 'err'); } };
        const item = (label, hint, fn) => el('button', { type: 'button', class: 'ghost', onclick: run(fn) }, el('span', { text: label }), el('small', { class: 'muted', text: hint }));
        const menu = el('div', { class: 'schema-dl-menu', hidden: true },
            item('PNG a colori', 'immagine', () => downloadSchema(data, 'png', false, data.title)),
            item('PNG bianco e nero', 'immagine', () => downloadSchema(data, 'png', true, data.title)),
            item('SVG a colori', 'modificabile', () => downloadSchema(data, 'svg', false, data.title)),
            item('SVG bianco e nero', 'modificabile', () => downloadSchema(data, 'svg', true, data.title)),
            item('Condividi…', 'Gmail, WhatsApp…', async () => { const f = await schemaBlob(data, 'png', false, data.title); await shareOut({ blob: f.blob, name: f.name, title: String(data.title || 'Schema') }); }));
        const dlBtn = el('button', { type: 'button', class: 'mini dl-btn', text: 'Scarica', 'aria-expanded': 'false', onclick: (ev) => { ev.stopPropagation(); const open = menu.hidden; menu.hidden = !open; dlBtn.setAttribute('aria-expanded', String(open)); } });
        document.addEventListener('click', (ev) => { if (!menu.hidden && !menu.contains(ev.target)) closeMenu(); });
        const dl = el('span', { class: 'schema-dl' }, dlBtn, menu);
        wrap.querySelector('.schema-tools').append(fullButton(() => wrap, () => requestAnimationFrame(() => { if (wrap.dataset.view === 'map') fit(); })), dl);
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

    // Left-handed mode (Impostazioni): header, menus and button rows are mirrored so the thumb does not cross the screen
    try { if (localStorage.getItem('vb_lefty') === '1') document.documentElement.classList.add('lefty'); } catch (e) { /* private mode */ }

    /* ---------- "⋯" menu: the actions of an element without a row of big buttons ---------- */
    function closeMenus() { document.querySelectorAll('.kebab-list:not([hidden])').forEach((l) => { l.hidden = true; }); }
    document.addEventListener('click', closeMenus);
    window.addEventListener('scroll', closeMenus, { passive: true });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeMenus(); });
    /** items: [{label, onclick, danger?}] (falsy entries are skipped). Returns null when there is nothing to do. */
    function menu(items, label = 'Altre azioni') {
        const list = items.filter(Boolean);
        if (!list.length) return null;
        const box = el('div', { class: 'kebab-list', hidden: true, role: 'menu' }, ...list.map((i) => el('button', {
            type: 'button', role: 'menuitem', class: i.danger ? 'danger-item' : i.accent ? 'accent-item' : '', text: i.label,
            onclick: (ev) => { ev.stopPropagation(); box.hidden = true; i.onclick(ev); } })));
        const btn = el('button', { type: 'button', class: 'kebab-btn', text: '⋯', title: label, 'aria-label': label, 'aria-haspopup': 'menu',
            onclick: (ev) => {
                ev.stopPropagation();
                const was = box.hidden; closeMenus(); box.hidden = !was;
                if (box.hidden) return;
                // the list is placed on screen from the button's position, so that it never runs off the edge of a phone
                const r = btn.getBoundingClientRect();
                const w = Math.min(box.offsetWidth || 220, window.innerWidth - 16);
                box.style.position = 'fixed';
                // left-handed mode: the list opens towards the right, away from the thumb's corner
                const edge = document.documentElement.classList.contains('lefty') ? r.left : r.right - w;
                box.style.left = `${Math.max(8, Math.min(edge, window.innerWidth - w - 8))}px`;
                box.style.right = 'auto';
                const h = box.offsetHeight;
                box.style.top = `${r.bottom + 4 + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 4) : r.bottom + 4}px`;
            } });
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
        // on a phone the keyboard must not pop up by itself: it would hide the form and the user has not chosen a field yet
        const first = form.querySelector('input, select, textarea');
        if (first && !window.matchMedia('(pointer: coarse)').matches) first.focus();
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
        // the same place on every device: what the server remembers wins when it is further than this device's
        let pushTimer = null;
        const push = () => { clearTimeout(pushTimer); pushTimer = setTimeout(() => { rawPost('../api/appunti.php', { action: 'progress_set', ref: key, idx: furthest }).catch(() => {}); }, 1500); };
        getJson('../api/appunti.php?action=progress&ref=' + encodeURIComponent(key)).then((r) => {
            if (Number.isInteger(r.idx) && r.idx > furthest && r.idx < heads.length) {
                furthest = r.idx; store(k, String(furthest)); paint();
                if (furthest < heads.length - 1 && !box.querySelector('.idx-resume')) {
                    const w = box.querySelector('.doc-index-wrap');
                    if (w) w.append(el('button', { type: 'button', class: 'idx-resume', text: `Riprendi da «${heads[furthest].textContent}»`, onclick: () => heads[furthest].scrollIntoView({ behavior: 'smooth', block: 'start' }) }));
                }
            } else if (furthest > (r.idx ?? -1)) push();
        }).catch(() => {});
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
            if (now > furthest) { furthest = now; store(k, String(furthest)); paint(); push(); }
        };
        const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(check); } };
        document.addEventListener('scroll', onScroll, { capture: true, passive: true });
        readStop = () => document.removeEventListener('scroll', onScroll, { capture: true });
    }

    /* ---------- files dropped on a page that is not the upload page: handed over through IndexedDB ---------- */
    const idb = () => new Promise((resolve, reject) => {
        const r = indexedDB.open('vb-appunti-drop', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('files', { autoIncrement: true });
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });
    /** Keeps the dropped files and opens the upload page, which queues them. */
    async function handOff(files) {
        try {
            const db = await idb();
            await new Promise((resolve, reject) => {
                const tx = db.transaction('files', 'readwrite');
                tx.objectStore('files').clear();
                files.forEach((f) => tx.objectStore('files').add(f));
                tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
            });
            location.href = 'appunti-carica.php?m=files&drop=1';
        } catch (e) { toast('Non riesco a passare i file alla pagina Carica: usa il pulsante Carica.', 'err'); }
    }
    /** On the upload page: the files that were dropped elsewhere (and forgets them). */
    async function takeHandOff() {
        try {
            const db = await idb();
            const files = await new Promise((resolve, reject) => {
                const tx = db.transaction('files', 'readwrite');
                const all = tx.objectStore('files').getAll();
                tx.objectStore('files').clear();
                tx.oncomplete = () => resolve(all.result || []); tx.onerror = () => reject(tx.error);
            });
            return files;
        } catch (e) { return []; }
    }

    /* ---------- recording date inside an audio file (m4a/mp4, mp3, wav): better than the file's date, which a copy changes ---------- */
    async function mediaTime(file) {
        const u8 = async (a, b) => new Uint8Array(await file.slice(a, b).arrayBuffer());
        const ascii = (arr, a, b) => String.fromCharCode(...arr.subarray(a, b));
        const plausible = (ms) => (ms > Date.UTC(2015, 0, 1) && ms < Date.now() + 86400000 ? ms : null);
        try {
            const head = await u8(0, 12);
            if (ascii(head, 4, 8) === 'ftyp') {                         // mp4 / m4a: creation time in moov > mvhd (seconds since 1904)
                let off = 0;
                for (let guard = 0; guard < 40 && off < file.size; guard++) {
                    const h = await u8(off, off + 16);
                    const dv = new DataView(h.buffer);
                    let size = dv.getUint32(0); const type = ascii(h, 4, 8);
                    let hdr = 8;
                    if (size === 1) { size = Number(dv.getBigUint64(8)); hdr = 16; } else if (size === 0) size = file.size - off;
                    if (size < hdr) return null;
                    if (type === 'moov') {
                        const body = await u8(off + hdr, off + Math.min(size, hdr + 4096));
                        for (let i = 0; i + 24 < body.length; i++) {
                            if (ascii(body, i, i + 4) !== 'mvhd') continue;
                            const v = new DataView(body.buffer, i + 4);
                            const secs = v.getUint8(0) === 1 ? Number(v.getBigUint64(4)) : v.getUint32(4);
                            return secs ? plausible((secs - 2082844800) * 1000) : null;
                        }
                        return null;
                    }
                    off += size;
                }
                return null;
            }
            if (ascii(head, 0, 3) === 'ID3') {                         // mp3: the recording date frame (TDRC, or TYER+TDAT)
                const size = ((head[6] & 127) << 21) | ((head[7] & 127) << 14) | ((head[8] & 127) << 7) | (head[9] & 127);
                const tag = await u8(10, 10 + Math.min(size, 65536));
                let year = null;
                for (let i = 0; i + 10 < tag.length;) {
                    const id = ascii(tag, i, i + 4);
                    const fsize = (tag[i + 4] << 24) | (tag[i + 5] << 16) | (tag[i + 6] << 8) | tag[i + 7];
                    if (!/^[A-Z0-9]{4}$/.test(id) || fsize <= 0 || i + 10 + fsize > tag.length) break;
                    if (id === 'TDRC' || id === 'TYER') {
                        const text = new TextDecoder(tag[i + 10] === 1 ? 'utf-16' : 'utf-8').decode(tag.subarray(i + 11, i + 10 + fsize)).replace(/\0/g, '');
                        const m = /(\d{4})(?:-(\d\d))?(?:-(\d\d))?(?:T(\d\d):(\d\d))?/.exec(text);
                        if (m && m[2]) return plausible(Date.UTC(+m[1], +m[2] - 1, +(m[3] || 1), +(m[4] || 12), +(m[5] || 0)));
                        if (m) year = m[1];
                    }
                    i += 10 + fsize;
                }
                return null;
            }
            if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WAVE') {   // wav: bext (origination date) or LIST/INFO ICRD
                const data = await u8(12, Math.min(file.size, 65536));
                for (let i = 0; i + 8 < data.length;) {
                    const id = ascii(data, i, i + 4);
                    const sz = new DataView(data.buffer).getUint32(i + 4, true);
                    if (id === 'bext' && i + 8 + 330 < data.length) {
                        const m = /(\d{4})-(\d\d)-(\d\d)/.exec(ascii(data, i + 8 + 320, i + 8 + 330));
                        if (m) return plausible(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
                    }
                    if (id === 'LIST') {
                        const m = /ICRD\W{0,6}(\d{4})-(\d\d)-(\d\d)/.exec(ascii(data, i + 8, Math.min(data.length, i + 8 + sz)));
                        if (m) return plausible(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
                    }
                    i += 8 + sz + (sz & 1);
                }
            }
        } catch (e) { /* unreadable: the file's own date is used */ }
        return null;
    }

    /* ---------- reading questions aloud (the browser's own speech synthesis; voice and speed are chosen in Impostazioni) ---------- */
    const canSpeak = () => 'speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function';
    function speak(text) {
        if (!canSpeak()) return;
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'it-IT';
        const uri = stored('vb_tts_voice');
        const voice = speechSynthesis.getVoices().find((v) => v.voiceURI === uri);
        if (voice) { u.voice = voice; u.lang = voice.lang; }
        u.rate = Number(stored('vb_tts_rate')) || 1;
        speechSynthesis.speak(u);
    }

    // The bar at the top (includes/appunti-top.php) on every page: the unread count on the gear, and no Archivio / Carica for who is in no class
    (() => {
        const run = async () => {
            const badge = document.querySelector('#bell-count');
            const needs = document.querySelectorAll('.needs-class');
            if (!badge && !needs.length) return;
            const count = async () => {
                try { const r = await getJson('../api/notifiche.php?action=list'); badge.hidden = r.unread === 0; badge.textContent = r.unread > 9 ? '9+' : String(r.unread); } catch (e) { /* offline */ }
            };
            if (badge) { count(); setInterval(() => { if (document.visibilityState === 'visible') count(); }, 60000); }
            if (needs.length) {
                try { const m = await getJson('../api/classi.php?action=mine'); needs.forEach((x) => { x.hidden = m.classes.length === 0; }); } catch (e) { /* keep them */ }
            }
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
    })();

    window.AppuntiCommon = { shareOut, markdownFile, schemaBlob, toggleFull, fullButton, weekStart, el, addIndex, mediaTime, canSpeak, speak, handOff, takeHandOff, menu, dialogForm, getJson, post, rawPost, toast, busy, md, renderSchema, renderQuestions, inline, looksLikeMarkdown, dayFmt, parseDate, sizeText, store, stored,
        CLASS_KEY: 'vb_appunti_class',
        KINDS: { appunti: 'Appunti', slide: 'Slide / prof', libro: 'Libro', domande: 'Domande del prof', prova: 'Verifica di prova', altro: 'Altro' },
        DOC_KINDS: { completo: 'Completo', riassunto: 'Riassunto', scheda: 'Scheda', preparazione: 'Preparazione', quiz: 'Quiz', lezione: 'Lezione', schema: 'Schema', domande: 'Domande' } };
})();
