// public/js/appunti-pdf.js — PDF viewer of the class archive: zoom (buttons, pinch, Ctrl+wheel), light/dark page and a
// "Testo" view that re-sets the text like the AI notes (bold, italic, headings from the font size) for easy reading on a phone.
// pdf.js comes from cdnjs, as in the book reader (the CSP already allows it). window.AppuntiPdf.view(url, name) -> element
(() => {
    'use strict';
    const { el } = window.AppuntiCommon;
    const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
    const THEME_KEY = 'vb_pdf_dark';
    const ZOOMS = [0.6, 0.8, 1, 1.25, 1.5, 2, 2.5, 3];
    let loading = null;

    function loadLib() {
        if (window.pdfjsLib) return Promise.resolve();
        if (!loading) {
            loading = new Promise((resolve, reject) => {
                const s = el('script', { src: PDFJS + 'pdf.min.js' });
                s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; resolve(); };
                s.onerror = () => { loading = null; reject(new Error('Non riesco a caricare il lettore PDF')); };
                document.head.append(s);
            });
        }
        return loading;
    }
    const get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
    const put = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };

    /**
     * Lines of text with their style, rebuilt from the pdf.js text items. Pages laid out in columns (a CV, a worksheet) are
     * read one column after the other instead of line by line across the page.
     */
    async function pageLines(page) {
        const tc = await page.getTextContent();
        const rows = [];
        for (const it of tc.items) {
            if (!it.str) continue;
            const size = Math.abs(it.transform[3]) || it.height || 10;
            const fam = (tc.styles[it.fontName] && tc.styles[it.fontName].fontFamily) || '';
            const name = (it.fontName || '') + ' ' + fam;
            rows.push({ y: Math.round(it.transform[5]), x: it.transform[4], w: it.width, size, str: it.str,
                bold: /bold|black|heavy|semibold|demi/i.test(name), italic: /italic|oblique/i.test(name) });
        }
        const real = rows;
        // 1) pieces on the same baseline, split wherever there is a wide gap: one segment per column cell
        const lines = [];
        for (const r of real.slice().sort((a, b) => b.y - a.y || a.x - b.x)) {
            let line = lines.find((l) => Math.abs(l.y - r.y) <= Math.max(2, r.size * 0.4));
            if (!line) { line = { y: r.y, pieces: [] }; lines.push(line); }
            line.pieces.push(r);
        }
        const segments = [];
        for (const l of lines) {
            l.pieces.sort((a, b) => a.x - b.x);
            let seg = null;
            for (const p of l.pieces) {
                const gap = seg ? p.x - (seg.parts[seg.parts.length - 1].x + seg.parts[seg.parts.length - 1].w) : 0;
                if (!seg || gap > Math.max(p.size, 8) * 2.5) { seg = { y: l.y, x0: p.x, size: 0, parts: [] }; segments.push(seg); }
                else if (gap > p.size * 0.15 && !/\s$/.test(seg.parts[seg.parts.length - 1].str) && !/^\s/.test(p.str)) seg.parts.push({ x: p.x, w: 0, str: ' ', size: p.size, bold: false, italic: false });
                seg.size = Math.max(seg.size, p.size);
                seg.parts.push(p);
            }
        }
        // 2) column anchors: left edges shared by at least three segments, and not just the indent of a paragraph
        const xs = segments.map((s) => s.x0).sort((a, b) => a - b);
        const anchors = [];
        for (const x of xs) {
            const last = anchors[anchors.length - 1];
            if (last && x - last.x < 14) last.n++;
            else anchors.push({ x, n: 1 });
        }
        const cols = anchors.filter((a) => a.n >= 3).map((a) => a.x);
        if (!cols.length) cols.push(0);
        const colOf = (x) => { let c = 0; cols.forEach((cx, i) => { if (x >= cx - 14) c = i; }); return c; };
        segments.sort((a, b) => colOf(a.x0) - colOf(b.x0) || b.y - a.y);
        return segments.map((s) => ({ y: s.y, size: s.size, col: colOf(s.x0), parts: s.parts }));
    }

    /** Joins the lines of every page into blocks: headings (bigger or all-bold short lines), paragraphs, bullets. */
    async function buildText(pdf, onProgress) {
        const pages = [];
        const sizes = [];
        for (let n = 1; n <= pdf.numPages; n++) {
            const rows = await pageLines(await pdf.getPage(n));
            pages.push(rows);
            rows.forEach((r) => sizes.push(r.size));
            onProgress(n, pdf.numPages);
        }
        sizes.sort((a, b) => a - b);
        const body = sizes[Math.floor(sizes.length / 2)] || 10;
        const out = el('div', { class: 'md pdf-text' });
        let para = null;
        const flush = () => { if (para && para.childNodes.length) out.append(para); para = null; };
        for (const rows of pages) {
            let prevY = null; let prevCol = -1;
            for (const r of rows) {
                if (r.col !== prevCol) { flush(); prevY = null; prevCol = r.col; }
                const text = r.parts.map((p) => p.str).join('').replace(/\s+/g, ' ').trim();
                if (!text) { flush(); continue; }
                const allBold = r.parts.filter((p) => p.str.trim()).every((p) => p.bold);
                const level = r.size >= body * 1.5 ? 'h2' : r.size >= body * 1.2 || (allBold && text.length < 70) ? 'h3' : null;
                if (level) { flush(); out.append(el(level, { text })); prevY = r.y; continue; }
                const bullet = /^([•▪◦\-–*]|\d+[.)])\s+/.test(text);
                // a bigger gap than a normal line starts a new paragraph
                const gap = prevY !== null && (prevY - r.y) > r.size * 1.9;
                if (!para || bullet || gap) { flush(); para = el('p'); } else para.append(' ');
                for (const p of r.parts) {
                    if (!p.str) continue;
                    para.append(p.bold && p.italic ? el('strong', {}, el('em', { text: p.str })) : p.bold ? el('strong', { text: p.str }) : p.italic ? el('em', { text: p.str }) : p.str);
                }
                prevY = r.y;
            }
            flush();
        }
        if (!out.children.length) out.append(el('p', { class: 'empty', text: 'Questo PDF non ha testo selezionabile (è una scansione): usa la vista Pagine.' }));
        return out;
    }

    function view(url, name) {
        const pages = el('div', { class: 'pdf-pages', tabindex: '0', 'aria-label': name });
        const textBox = el('div', { class: 'pdf-textbox', hidden: true });
        let pdf = null; let zoom = 1; let dark = get(THEME_KEY) !== '0'; let mode = 'pages'; let textFont = 1;
        const zoomLabel = el('span', { class: 'pdf-zoom-label', text: '100%' });
        const root = el('div', { class: 'pdf-view' });
        const btn = (text, title, onclick) => el('button', { type: 'button', class: 'ghost mini', text, title, 'aria-label': title, onclick });
        const darkBtn = btn('', 'Scuro', () => { dark = !dark; put(THEME_KEY, dark ? '1' : '0'); paintTheme(); });
        const modeBtn = btn('Testo', 'Passa al testo facile da leggere', () => setMode(mode === 'pages' ? 'text' : 'pages'));
        const zoomBox = el('span', { class: 'pdf-group' }, btn('–', 'Rimpicciolisci', () => stepZoom(-1)), zoomLabel, btn('+', 'Ingrandisci', () => stepZoom(1)), btn('Adatta', 'Adatta alla larghezza', () => setZoom(1)));
        const fontBox = el('span', { class: 'pdf-group', hidden: true }, btn('A–', 'Testo più piccolo', () => setFont(-0.1)), btn('A+', 'Testo più grande', () => setFont(0.1)));
        const bar = el('div', { class: 'pdf-bar' }, zoomBox, fontBox, darkBtn, modeBtn);
        root.append(bar, pages, textBox);

        function paintTheme() {
            root.classList.toggle('pdf-dark', dark);
            darkBtn.textContent = dark ? 'Chiaro' : 'Scuro';
            darkBtn.title = dark ? 'Pagine chiare' : 'Pagine scure';
        }
        function setFont(d) { textFont = Math.min(1.8, Math.max(0.8, textFont + d)); textBox.style.fontSize = `${Math.round(textFont * 100)}%`; }
        function stepZoom(d) {
            const i = ZOOMS.reduce((best, z, k) => (Math.abs(z - zoom) < Math.abs(ZOOMS[best] - zoom) ? k : best), 0);
            setZoom(ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, i + d))]);
        }
        let io = null;
        function setZoom(z) {
            zoom = Math.min(3, Math.max(0.5, z));
            zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
            if (pdf) drawPages();
        }
        async function drawPages() {
            if (io) io.disconnect();
            const keepTop = pages.scrollTop / Math.max(1, pages.scrollHeight);
            const width = Math.max(240, pages.clientWidth - 4);
            const first = await pdf.getPage(1);
            const base = width / first.getViewport({ scale: 1 }).width;
            const holders = [];
            for (let n = 1; n <= pdf.numPages; n++) {
                const h = el('div', { class: 'pdf-page', 'data-n': n });
                const vp = first.getViewport({ scale: base * zoom });
                h.style.width = `${Math.floor(vp.width)}px`; h.style.height = `${Math.floor(vp.height)}px`;
                holders.push(h);
            }
            pages.replaceChildren(...holders);
            pages.scrollTop = keepTop * pages.scrollHeight;
            io = new IntersectionObserver((entries) => {
                for (const e of entries) {
                    if (!e.isIntersecting || e.target.dataset.done) continue;
                    e.target.dataset.done = '1';
                    renderOne(e.target, base * zoom);
                }
            }, { root: pages, rootMargin: '600px 0px' });
            holders.forEach((h) => io.observe(h));
        }
        async function renderOne(holder, scale) {
            const page = await pdf.getPage(Number(holder.dataset.n));
            const ratio = Math.min(window.devicePixelRatio || 1, 2);
            const vp = page.getViewport({ scale: scale * ratio });
            const canvas = el('canvas', { 'aria-label': `Pagina ${holder.dataset.n}` });
            canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
            canvas.style.width = '100%'; canvas.style.height = '100%';
            await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
            holder.replaceChildren(canvas);
        }
        async function setMode(m) {
            mode = m;
            pages.hidden = m !== 'pages'; textBox.hidden = m !== 'text';
            zoomBox.hidden = m !== 'pages'; fontBox.hidden = m !== 'text';
            modeBtn.textContent = m === 'pages' ? 'Testo' : 'Pagine';
            if (m === 'text' && !textBox.dataset.ready && pdf) {
                textBox.replaceChildren(el('p', { class: 'muted', text: 'Preparo il testo…' }));
                try {
                    const t = await buildText(pdf, (n, tot) => { textBox.firstChild.textContent = `Preparo il testo… ${n} di ${tot}`; });
                    textBox.replaceChildren(t);
                    window.AppuntiCommon.addIndex(textBox, 'pdf' + name);
                    textBox.dataset.ready = '1';
                } catch (e) { textBox.replaceChildren(el('p', { class: 'err', text: 'Non riesco a leggere il testo di questo PDF.' })); }
            }
        }

        // pinch on a phone, Ctrl+wheel on a computer
        let pinch = null;
        const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
        pages.addEventListener('touchstart', (ev) => { if (ev.touches.length === 2) pinch = { d: dist(ev.touches), z: zoom }; }, { passive: true });
        pages.addEventListener('touchmove', (ev) => {
            if (pinch && ev.touches.length === 2) { pinch.next = pinch.z * dist(ev.touches) / pinch.d; }
        }, { passive: true });
        pages.addEventListener('touchend', () => { if (pinch && pinch.next) setZoom(pinch.next); pinch = null; });
        pages.addEventListener('wheel', (ev) => { if (ev.ctrlKey) { ev.preventDefault(); setZoom(zoom * (ev.deltaY < 0 ? 1.1 : 0.9)); } }, { passive: false });

        paintTheme();
        pages.append(el('p', { class: 'muted', text: 'Carico il PDF…' }));
        loadLib().then(() => window.pdfjsLib.getDocument({ url }).promise).then((doc) => { pdf = doc; drawPages(); })
            .catch((e) => { pages.replaceChildren(el('p', { class: 'err', text: e.message || 'PDF non leggibile.' }), el('a', { class: 'ghost-link', href: url, target: '_blank', rel: 'noopener', text: 'Aprilo in una nuova scheda' })); });
        return root;
    }

    window.AppuntiPdf = { view };
})();
