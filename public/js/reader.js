// public/js/reader.js

document.addEventListener('DOMContentLoaded', () => {
    const viewerModal = document.getElementById('viewer-modal');
    const viewerTitle = document.getElementById('viewer-title');
    const closeViewerBtn = document.getElementById('close-viewer-btn');
    const prevPageBtn = document.getElementById('prev-page-btn');
    const nextPageBtn = document.getElementById('next-page-btn');
    const downloadBookBtn = document.getElementById('download-book-btn');
    
    const pageJumpInput = document.getElementById('page-jump-input');
    const pageTotalLabel = document.getElementById('page-total-label');
    const blueLightSlider = document.getElementById('blue-light-slider');
    const viewerStageContainer = document.getElementById('viewer-stage-container');

    const epubStage = document.getElementById('epub-stage');
    const pdfStage = document.getElementById('pdf-stage');
    
    const searchForm = document.getElementById('book-search-form');
    const searchInput = document.getElementById('book-search-input');
    const uploadForm = document.getElementById('book-upload-form');
    const uploadInput = document.getElementById('book-upload-input');
    const catalogContainer = document.getElementById('book-catalog');

    let currentBookId = null;
    let currentFormat = null;
    let epubBook = null;
    let epubRendition = null;
    let pdfDoc = null;
    let pdfCurrentPage = 1;
    let pdfTotalPages = 1;
    let epubTotalPages = 1;
    let epubCurrentPage = 1;
    let currentTheme = localStorage.getItem('vector_reader_theme') || 'light';
    let progressDebounceTimer = null;
    let currentLocation = null;   // EPUB CFI or PDF page number (string)
    let currentPct = 0;
    let catalogBooks = [];
    let progressMap = new Map();  // book_id -> { percentage, updated_at }

    const continueSection = document.getElementById('continue-section');
    const continueShelf = document.getElementById('continue-shelf');
    const addBookmarkBtn = document.getElementById('add-bookmark-btn');
    const bookmarksToggleBtn = document.getElementById('bookmarks-toggle-btn');
    const bookmarksPanel = document.getElementById('bookmarks-panel');

    // Reading settings ("Aa" panel): text size / PDF zoom, one or two pages
    const settingsBtn = document.getElementById('settings-btn');
    const settingsPanel = document.getElementById('settings-panel');
    const zoomInBtn = document.getElementById('zoom-in-btn');
    const zoomOutBtn = document.getElementById('zoom-out-btn');
    const zoomLabel = document.getElementById('zoom-label');
    const zoomFitBtn = document.getElementById('zoom-fit-btn');
    const spreadRow = document.getElementById('spread-row');
    const spreadBtns = [...document.querySelectorAll('[data-spread]')];
    const pageRange = document.getElementById('page-range');
    const toastEl = document.getElementById('reader-toast');
    const pref = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } };
    const setPref = (k, v) => { try { localStorage.setItem(k, String(v)); } catch (e) { /* private mode */ } };
    let fontPct = Math.min(200, Math.max(70, parseInt(pref('vector_reader_font', '100'), 10) || 100));
    let pdfZoom = Math.min(3, Math.max(0.5, parseFloat(pref('vector_reader_pdf_zoom', '1')) || 1));
    let spread = pref('vector_reader_spread', 'none') === 'auto' ? 'auto' : 'none';
    // Bottom bar: 'auto' = hidden while reading, shown by a tap in the middle of the page; 'always' = fixed
    let footerMode = pref('vector_reader_footer', 'auto') === 'always' ? 'always' : 'auto';
    let pdfRenderTask = null;

    let toastTimer = null;
    function toast(msg, ms = 2200) {
        if (!toastEl) return;
        toastEl.textContent = msg;
        toastEl.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
    }

    const THEME_STYLES = {
        light: { bg: '#ffffff', color: '#212529' },
        sepia: { bg: '#f4ecd8', color: '#5b4636' },
        dark:  { bg: '#2b2b2b', color: '#e0e0e0' },
        black: { bg: '#000000', color: '#cccccc' }
    };

    applyTheme(currentTheme);
    loadCatalog();

    if (searchForm) {
        searchForm.addEventListener('submit', (e) => {
            e.preventDefault();
            loadCatalog(searchInput.value.trim());
        });
        let searchTimer = null;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => loadCatalog(searchInput.value.trim()), 350);
        });
    }

    if (uploadForm && uploadInput) {
        const uploadStatus = document.getElementById('book-upload-status');
        const uploadButton = uploadForm.querySelector('.upload-btn');
        const say = (text, cls = '') => {
            if (!uploadStatus) return;
            uploadStatus.textContent = text;
            uploadStatus.className = 'upload-status' + (cls ? ' ' + cls : '');
        };
        let uploading = false;

        // Several books: one request per file (each stays under the server's size limit),
        // one after the other, with progress and a summary at the end.
        const uploadFiles = async (files) => {
            const list = Array.from(files).filter((f) => /\.(epub|pdf)$/i.test(f.name));
            if (!list.length || uploading) {
                if (!list.length) say('Solo file .epub o .pdf.', 'err');
                return;
            }
            uploading = true;
            uploadInput.disabled = true;
            const failed = [];
            let done = 0;
            for (const [i, file] of list.entries()) {
                say(`Caricamento ${i + 1} di ${list.length}: ${file.name}`);
                const formData = new FormData();
                formData.append('book_file', file);
                try {
                    const res = await fetch('../api/books.php?action=upload', { method: 'POST', body: formData });
                    let data = null;
                    try { data = await res.json(); } catch (err) { /* nginx error page, e.g. file too large */ }
                    if (data && data.success) done++;
                    else failed.push(`${file.name} (${(data && data.error) || (res.status === 413 ? 'file troppo grande' : 'errore ' + res.status)})`);
                } catch (err) {
                    failed.push(`${file.name} (rete)`);
                }
            }
            uploading = false;
            uploadInput.disabled = false;
            uploadInput.value = '';
            say(`${done === 1 ? '1 libro caricato' : done + ' libri caricati'}` + (failed.length ? `. Non caricati: ${failed.join(', ')}` : '.'), failed.length ? 'err' : 'ok');
            if (done) loadCatalog();
        };

        uploadForm.addEventListener('submit', (e) => {
            e.preventDefault();
            uploadFiles(uploadInput.files);
        });
        // Choosing the files is enough: no second button to press
        uploadInput.addEventListener('change', () => { uploadFiles(uploadInput.files); uploadInput.value = ''; });
        // Drag the files onto the upload box
        const dropZone = uploadForm.parentElement;
        ['dragenter', 'dragover'].forEach((t) => dropZone.addEventListener(t, (e) => {
            if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
            e.preventDefault();
            dropZone.classList.add('drop-target');
        }));
        ['dragleave', 'drop'].forEach((t) => dropZone.addEventListener(t, (e) => {
            if (t === 'dragleave' && dropZone.contains(e.relatedTarget)) return;
            dropZone.classList.remove('drop-target');
        }));
        dropZone.addEventListener('drop', (e) => {
            if (!e.dataTransfer || !e.dataTransfer.files.length) return;
            e.preventDefault();
            uploadFiles(e.dataTransfer.files);
        });
    }

    if (closeViewerBtn) closeViewerBtn.addEventListener('click', () => closeViewer());
    // Menus ("Aa", bookmarks): one open at a time; a transparent layer over the page closes them when you tap
    // anywhere else (taps inside the EPUB's own frame would never reach this page otherwise)
    const backdrop = document.getElementById('reader-backdrop');
    function closePanels() {
        if (settingsPanel) settingsPanel.hidden = true;
        if (settingsBtn) settingsBtn.setAttribute('aria-expanded', 'false');
        if (bookmarksPanel) bookmarksPanel.style.display = 'none';
        if (backdrop) backdrop.hidden = true;
    }
    function openPanel(which) {
        const wasOpen = which === 'settings' ? !settingsPanel.hidden : bookmarksPanel.style.display !== 'none';
        closePanels();
        if (wasOpen) return;
        if (which === 'settings') { settingsPanel.hidden = false; settingsBtn.setAttribute('aria-expanded', 'true'); }
        else bookmarksPanel.style.display = 'block';
        if (backdrop) backdrop.hidden = false;
    }
    if (backdrop) backdrop.addEventListener('click', closePanels);
    if (settingsBtn && settingsPanel) {
        settingsBtn.addEventListener('click', (e) => { e.stopPropagation(); openPanel('settings'); });
        settingsPanel.addEventListener('click', (e) => e.stopPropagation());
    }

    // Bars: tap the middle of the page (or the button in "Aa") to hide/show them and read full screen
    const barsBtn = document.getElementById('bars-btn');
    const exitFullBtn = document.getElementById('exit-full-btn');
    let exitFadeTimer = null;
    /** In full screen the ✕ button is clear for a few seconds, then stays faint (still tappable). */
    function wakeExitButton() {
        if (!exitFullBtn || !viewerModal.classList.contains('bars-hidden')) return;
        exitFullBtn.classList.remove('faint');
        clearTimeout(exitFadeTimer);
        exitFadeTimer = setTimeout(() => exitFullBtn.classList.add('faint'), 3000);
    }
    function toggleBars(force, fromHistory = false) {
        const hide = typeof force === 'boolean' ? force : !viewerModal.classList.contains('bars-hidden');
        if (hide === viewerModal.classList.contains('bars-hidden')) return;
        viewerModal.classList.toggle('bars-hidden', hide);
        closePanels();
        requestAnimationFrame(() => {
            if (epubRendition) { try { epubRendition.resize(); } catch (e) { /* not ready */ } }
            if (currentFormat === 'pdf' && pdfDoc) renderPdfPage(pdfCurrentPage);
        });
        if (hide) {
            // the phone's back button leaves full screen first
            history.pushState({ reader: 'full' }, '');
            wakeExitButton();
            toast('Schermo intero. Per uscire: ✕ in alto, un tocco al centro o il tasto indietro.', 4500);
        } else if (!fromHistory && history.state && history.state.reader === 'full') {
            ignorePop = true;
            history.back();
        }
    }
    if (barsBtn) barsBtn.addEventListener('click', () => toggleBars(true));
    if (exitFullBtn) exitFullBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleBars(false); });
    ['pointermove', 'pointerdown', 'keydown'].forEach((t) => viewerModal.addEventListener(t, wakeExitButton));

    // Phone back button: full screen -> menus -> reader -> (only then) leave the page
    let ignorePop = false;
    window.addEventListener('popstate', () => {
        if (ignorePop) { ignorePop = false; return; }
        if (viewerModal.classList.contains('bars-hidden')) { toggleBars(false, true); return; }
        if (viewerModal.classList.contains('active')) closeViewer(true);
    });
    function isMiddleTap(x, width) { return x > width * 0.3 && x < width * 0.7; }

    // The bottom bar in "Quando serve" mode floats over the page (no relayout of the text) and hides again by itself
    const footerEl = document.querySelector('.viewer-footer');
    let footerTimer = null;
    function showFooter(show) {
        viewerModal.classList.toggle('footer-shown', show);
        clearTimeout(footerTimer);
        if (show) footerTimer = setTimeout(() => { if (!footerEl.matches(':hover') && !footerEl.contains(document.activeElement)) showFooter(false); }, 6000);
    }
    if (footerEl) {
        ['pointerdown', 'input', 'focusin'].forEach((t) => footerEl.addEventListener(t, () => { if (viewerModal.classList.contains('footer-shown')) showFooter(true); }));
    }
    function applyFooterMode() {
        viewerModal.classList.toggle('footer-auto', footerMode === 'auto');
        document.querySelectorAll('[data-footer]').forEach((b) => b.classList.toggle('on', b.dataset.footer === footerMode));
        showFooter(false);
    }
    document.querySelectorAll('[data-footer]').forEach((b) => b.addEventListener('click', () => {
        footerMode = b.dataset.footer;
        setPref('vector_reader_footer', footerMode);
        applyFooterMode();
        // a fixed bar takes space from the page: lay it out again
        requestAnimationFrame(() => {
            if (epubRendition) { try { epubRendition.resize(); } catch (e) { /* not ready */ } }
            if (currentFormat === 'pdf' && pdfDoc) renderPdfPage(pdfCurrentPage);
        });
    }));
    applyFooterMode();

    /** A tap in the middle of the page: leave full screen, else show/hide the bottom bar (or both bars). */
    function middleTap() {
        if (viewerModal.classList.contains('bars-hidden')) { toggleBars(false); return; }
        if (footerMode === 'auto') showFooter(!viewerModal.classList.contains('footer-shown'));
        else toggleBars(true);
    }

    function updateProgressLine(pct) {
        const line = document.getElementById('progress-line');
        if (line) line.style.width = Math.max(0, Math.min(100, pct || 0)) + '%';
    }

    if (pdfStage) pdfStage.addEventListener('click', (e) => {
        if (pdfZoom > 1) return;
        const r = pdfStage.getBoundingClientRect();
        if (isMiddleTap(e.clientX - r.left, r.width)) middleTap();
    });
    if (zoomInBtn) zoomInBtn.addEventListener('click', () => zoom(1));
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => zoom(-1));
    if (zoomFitBtn) zoomFitBtn.addEventListener('click', () => zoom(0));
    spreadBtns.forEach((b) => b.addEventListener('click', () => setSpread(b.dataset.spread)));
    document.getElementById('tap-prev')?.addEventListener('click', () => turnPage(-1));
    document.getElementById('tap-next')?.addEventListener('click', () => turnPage(1));
    if (pageRange) {
        pageRange.addEventListener('input', () => { pageJumpInput.value = pageRange.value; });
        pageRange.addEventListener('change', () => jumpToPage(parseInt(pageRange.value, 10)));
    }
    if (pdfStage) addSwipe(pdfStage);
    let resizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { if (currentFormat === 'pdf' && pdfDoc) renderPdfPage(pdfCurrentPage); }, 200);
    });
    if (prevPageBtn) prevPageBtn.addEventListener('click', () => turnPage(-1));
    if (nextPageBtn) nextPageBtn.addEventListener('click', () => turnPage(1));

    if (pageJumpInput) {
        pageJumpInput.addEventListener('change', (e) => {
            const val = parseInt(e.target.value, 10);
            jumpToPage(val);
        });
    }

    if (blueLightSlider) {
        blueLightSlider.addEventListener('input', (e) => {
            const val = e.target.value;
            if (viewerStageContainer) {
                viewerStageContainer.style.filter = `sepia(${val}%) hue-rotate(-30deg)`;
            }
        });
    }

    // Colour buttons (library header and "Aa" panel): direct listeners, because the panel stops clicks
    // from reaching the document (so that clicking inside it does not close it)
    document.querySelectorAll('.theme-btn').forEach((btn) => btn.addEventListener('click', () => {
        if (!btn.dataset.theme) return;
        applyTheme(btn.dataset.theme);
        saveUserTheme(btn.dataset.theme);
    }));

    document.addEventListener('keydown', (e) => {
        if (!viewerModal.classList.contains('active')) return;
        if (e.target && e.target.tagName === 'INPUT') return;
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') turnPage(-1);
        if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); turnPage(1); }
        if (e.key === '+' || e.key === '=') zoom(1);
        if (e.key === '-') zoom(-1);
        if (e.key === 'Escape') {
            if ((settingsPanel && !settingsPanel.hidden) || (bookmarksPanel && bookmarksPanel.style.display !== 'none')) closePanels();
            else if (viewerModal.classList.contains('bars-hidden')) toggleBars(false);
            else closeViewer();
        }
    });

    async function loadCatalog(query = '') {
        if (!catalogContainer) return;
        catalogContainer.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--text-muted);">Caricamento libreria...</p>';

        try {
            const url = `../api/books.php?action=list${query ? `&q=${encodeURIComponent(query)}` : ''}`;
            const res = await fetch(url);
            const data = await res.json();

            if (data.success) {
                catalogBooks = data.books || [];
                await loadProgressMap();
                renderCatalog(catalogBooks);
                renderContinueShelf(query ? [] : catalogBooks);
                if (data.can_upload) makeMissingPdfCovers(catalogBooks);
            } else {
                const p = document.createElement('p');
                p.style.cssText = 'grid-column: 1/-1; color: red;';
                p.textContent = `Error: ${data.error || 'unknown'}`;
                catalogContainer.replaceChildren(p);
            }
        } catch (err) {
            catalogContainer.innerHTML = '<p style="grid-column: 1/-1; color: red;">Impossibile caricare i libri.</p>';
        }
    }

    // PDFs have no cover until someone who can upload opens the library: page 1 is drawn here with pdf.js
    // and sent to the server, one book at a time, in the background.
    let coversRunning = false;
    async function makeMissingPdfCovers(books) {
        if (coversRunning || typeof pdfjsLib === 'undefined') return;
        const missing = books.filter((b) => b.format === 'pdf' && !b.cover_path);
        if (!missing.length) return;
        coversRunning = true;
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        let made = 0;
        for (const book of missing) {
            try {
                const pdf = await pdfjsLib.getDocument({ url: `../api/books.php?action=stream&id=${book.id}`, disableAutoFetch: true }).promise;
                const page = await pdf.getPage(1);
                const base = page.getViewport({ scale: 1 });
                const viewport = page.getViewport({ scale: Math.min(2, 480 / base.width) });
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(viewport.width);
                canvas.height = Math.round(viewport.height);
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#fff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                await page.render({ canvasContext: ctx, viewport }).promise;
                pdf.destroy();
                const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
                if (!blob) continue;
                const fd = new FormData();
                fd.append('book_id', book.id);
                fd.append('cover', blob, 'cover.jpg');
                const res = await fetch('../api/books.php?action=set_cover', { method: 'POST', body: fd });
                if (res.ok) made++;
            } catch (e) {
                // It keeps the "PDF" label; tell the server why, so the admin can see it in the log
                try {
                    const fd = new FormData();
                    fd.append('book_id', book.id);
                    fd.append('reason', `${(e && e.name) || 'Error'}: ${(e && e.message) || e}`.slice(0, 200));
                    await fetch('../api/books.php?action=cover_failed', { method: 'POST', body: fd });
                } catch (e2) { /* offline */ }
            }
        }
        coversRunning = false;
        if (made) loadCatalog(searchInput && searchInput.value ? searchInput.value.trim() : '');
    }

    async function loadProgressMap() {
        progressMap = new Map();
        try {
            const res = await fetch('../api/progress.php?all=1');
            const data = await res.json();
            if (data.success) {
                data.progress.forEach((p) => progressMap.set(p.book_id, p));
            }
        } catch (err) { /* guests / offline: no progress */ }
    }

    // Covers come from api/books.php, which nginx rate-limits (burst 10): load them a few at a time,
    // and retry once or twice a cover that was refused, instead of asking for all of them at once.
    const coverQueue = [];
    let coversLoading = 0;
    const COVER_PARALLEL = 3;
    function pumpCovers() {
        while (coversLoading < COVER_PARALLEL && coverQueue.length) {
            const { img, src, tries } = coverQueue.shift();
            if (!img.isConnected) continue;
            coversLoading++;
            const done = (ok) => {
                coversLoading--;
                if (!ok && tries < 2) setTimeout(() => { coverQueue.push({ img, src, tries: tries + 1 }); pumpCovers(); }, 1500 * (tries + 1));
                pumpCovers();
            };
            img.addEventListener('load', () => done(true), { once: true });
            img.addEventListener('error', () => done(false), { once: true });
            img.src = src + (tries ? (src.includes('?') ? '&' : '?') + 'r=' + tries : '');
        }
    }
    function queueCover(img, src) {
        coverQueue.push({ img, src, tries: 0 });
        setTimeout(pumpCovers, 0);   // after the card is in the page
    }

    // One card, built with DOM methods (no innerHTML / inline handlers)
    function buildBookCard(book) {
        const card = document.createElement('div');
        card.className = 'book-card';

        const cover = document.createElement('div');
        cover.className = 'book-cover';
        if (book.cover_path) {
            const img = document.createElement('img');
            queueCover(img, book.cover_path);
            img.alt = book.title || '';
            img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
            cover.appendChild(img);
        } else {
            const fmt = document.createElement('span');
            fmt.textContent = String(book.format || '').toUpperCase();
            cover.appendChild(fmt);
        }

        const prog = progressMap.get(Number(book.id));
        if (prog && prog.percentage > 0) {
            const track = document.createElement('div');
            track.title = `${Math.round(prog.percentage)}% letto`;
            track.style.cssText = 'width:100%; height:4px; background:var(--bg-tertiary); margin-top:auto;';
            const fill = document.createElement('div');
            fill.style.cssText = `height:100%; width:${Math.min(100, prog.percentage)}%; background:var(--accent-color);`;
            track.appendChild(fill);
            cover.style.position = 'relative';
            track.style.position = 'absolute';
            track.style.bottom = '0';
            track.style.left = '0';
            cover.appendChild(track);
        }

        const info = document.createElement('div');
        info.className = 'book-info';

        const title = document.createElement('div');
        title.className = 'book-title';
        title.title = book.title || '';
        title.textContent = book.title || '';

        const author = document.createElement('div');
        author.className = 'book-author';
        author.textContent = book.author || 'Autore Sconosciuto';

        const footer = document.createElement('div');
        footer.className = 'card-footer';
        const badge = document.createElement('span');
        badge.className = 'book-badge';
        badge.textContent = prog && prog.percentage > 0 ? `${book.format} \u00B7 ${Math.round(prog.percentage)}%` : book.format;
        const dl = document.createElement('a');
        dl.href = `../api/books.php?action=download&id=${encodeURIComponent(book.id)}`;
        dl.className = 'btn';
        dl.style.cssText = 'padding:0.15rem 0.4rem; font-size:0.75rem;';
        dl.title = 'Scarica';
        dl.textContent = '\u2193';
        dl.addEventListener('click', (e) => e.stopPropagation());
        footer.appendChild(badge);
        footer.appendChild(dl);

        info.appendChild(title);
        info.appendChild(author);
        info.appendChild(footer);
        card.appendChild(cover);
        card.appendChild(info);

        cover.addEventListener('click', () => openBook(book));
        title.addEventListener('click', () => openBook(book));
        return card;
    }

    function renderCatalog(books) {
        if (!books || books.length === 0) {
            const p = document.createElement('p');
            p.style.cssText = 'grid-column: 1/-1; text-align: center; color: var(--text-muted);';
            p.textContent = 'Nessun libro trovato.';
            catalogContainer.replaceChildren(p);
            return;
        }
        catalogContainer.replaceChildren(...books.map(buildBookCard));
    }

    // Books started but not finished, most recently read first
    function renderContinueShelf(books) {
        if (!continueSection || !continueShelf) return;
        const byId = new Map(books.map((b) => [Number(b.id), b]));
        const reading = [...progressMap.values()]
            .filter((p) => p.percentage > 0 && p.percentage < 99 && byId.has(p.book_id))
            .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
            .slice(0, 6)
            .map((p) => byId.get(p.book_id));
        continueSection.style.display = reading.length ? '' : 'none';
        continueShelf.replaceChildren(...reading.map(buildBookCard));
    }

    async function getCachedBookBuffer(bookId, fetchUrl) {
        return new Promise((resolve) => {
            const request = indexedDB.open('VectorReaderDB', 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('books')) {
                    db.createObjectStore('books');
                }
            };
            request.onsuccess = (e) => {
                const db = e.target.result;
                const tx = db.transaction('books', 'readonly');
                const store = tx.objectStore('books');
                const getReq = store.get(bookId);

                getReq.onsuccess = async () => {
                    if (getReq.result) {
                        resolve(getReq.result);
                    } else {
                        try {
                            const response = await fetch(fetchUrl);
                            const buffer = await response.arrayBuffer();
                            const writeTx = db.transaction('books', 'readwrite');
                            writeTx.objectStore('books').put(buffer, bookId);
                            resolve(buffer);
                        } catch (err) {
                            resolve(null);
                        }
                    }
                };
            };
            request.onerror = () => resolve(null);
        });
    }

    async function openBook(book) {
        currentBookId = book.id;
        currentFormat = book.format.toLowerCase();
        viewerTitle.textContent = book.title;

        if (downloadBookBtn) {
            downloadBookBtn.href = `../api/books.php?action=download&id=${book.id}`;
        }

        epubStage.style.display = 'none';
        pdfStage.style.display = 'none';
        epubStage.innerHTML = '';
        pdfStage.innerHTML = '';

        viewerModal.classList.add('active');
        document.body.classList.add('reading');
        history.pushState({ reader: 'book' }, '');
        viewerModal.classList.remove('zoomed', 'bars-hidden', 'footer-shown');
        updateProgressLine(0);
        closePanels();
        updateReadingUI();
        applyTheme(currentTheme);
        currentLocation = null;
        currentPct = 0;
        if (bookmarksPanel) bookmarksPanel.style.display = 'none';
        loadBookmarks();

        const savedProgress = await getSavedProgress(book.id);
        const fileUrl = `../api/books.php?action=stream&id=${book.id}`;

        if (currentFormat === 'epub') {
            initEpubReader(book.id, fileUrl, savedProgress?.cfi_or_page);
        } else if (currentFormat === 'pdf') {
            initPdfReader(fileUrl, savedProgress?.cfi_or_page);
        }
    }

    function closeViewer(fromHistory = false) {
        if (!viewerModal.classList.contains('active')) return;
        // closing with the ← button: remove the history entries the reader added
        if (!fromHistory && history.state && history.state.reader) {
            const steps = history.state.reader === 'full' ? 2 : 1;
            ignorePop = true;
            history.go(-steps);
        }
        viewerModal.classList.remove('active', 'bars-hidden');
        document.body.classList.remove('reading');
        if (epubRendition) {
            try { epubRendition.destroy(); } catch (e) {}
            epubRendition = null;
        }
        epubBook = null;
        pdfDoc = null;
        currentBookId = null;
        if (bookmarksPanel) bookmarksPanel.style.display = 'none';
        // Refresh progress bars / continue shelf after reading (give the debounced save time to land)
        setTimeout(async () => {
            await loadProgressMap();
            renderCatalog(catalogBooks);
            renderContinueShelf(searchInput && searchInput.value.trim() ? [] : catalogBooks);
        }, 2500);
    }

    // ---- Bookmarks -------------------------------------------------------------
    let bookmarks = [];

    async function loadBookmarks() {
        bookmarks = [];
        renderBookmarks();
        if (!currentBookId) return;
        try {
            const res = await fetch(`../api/bookmarks.php?book_id=${encodeURIComponent(currentBookId)}`);
            const data = await res.json();
            if (data.success) {
                bookmarks = data.bookmarks;
                renderBookmarks();
            }
        } catch (err) {}
    }

    function goToBookmark(bm) {
        if (currentFormat === 'epub' && epubRendition) {
            epubRendition.display(bm.location);
        } else if (currentFormat === 'pdf' && pdfDoc) {
            const page = parseInt(bm.location, 10);
            if (page >= 1 && page <= pdfTotalPages) renderPdfPage(page);
        }
        closePanels();
    }

    async function deleteBookmark(id) {
        try {
            const res = await fetch('../api/bookmarks.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'delete', id })
            });
            if ((await res.json()).success) {
                bookmarks = bookmarks.filter((b) => b.id !== id);
                renderBookmarks();
            }
        } catch (err) {}
    }

    function renderBookmarks() {
        if (bookmarksToggleBtn) bookmarksToggleBtn.textContent = bookmarks.length ? `Segnalibri (${bookmarks.length})` : 'Segnalibri';
        if (!bookmarksPanel) return;
        bookmarksPanel.replaceChildren();
        if (!bookmarks.length) {
            const empty = document.createElement('div');
            empty.style.cssText = 'font-size:0.8rem; color:var(--text-muted); padding:0.3rem;';
            empty.textContent = 'Nessun segnalibro. Usa "+ Segnalibro" per salvare la posizione attuale.';
            bookmarksPanel.appendChild(empty);
            return;
        }
        bookmarks.forEach((bm) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; align-items:center; gap:0.4rem; padding:0.25rem 0.3rem; border-bottom:1px solid var(--border-color); font-size:0.82rem;';
            const go = document.createElement('button');
            go.className = 'btn';
            go.style.cssText = 'flex:1; text-align:left; padding:0.2rem 0.4rem; font-size:0.8rem;';
            go.textContent = bm.label || `${Math.round(bm.percentage)}%`;
            go.title = String(bm.created_at || '');
            go.addEventListener('click', () => goToBookmark(bm));
            const del = document.createElement('button');
            del.className = 'btn';
            del.style.cssText = 'padding:0.2rem 0.45rem; font-size:0.75rem;';
            del.title = 'Elimina segnalibro';
            del.textContent = '\u2715';
            del.addEventListener('click', () => deleteBookmark(bm.id));
            row.appendChild(go);
            row.appendChild(del);
            bookmarksPanel.appendChild(row);
        });
    }

    let addingBookmark = false;
    async function addBookmark() {
        if (!currentBookId || !currentLocation) { toast('Aspetta che la pagina sia caricata.'); return; }
        if (addingBookmark) return;
        addingBookmark = true;
        if (addBookmarkBtn) addBookmarkBtn.disabled = true;
        const label = currentFormat === 'pdf'
            ? `Pagina ${currentLocation} (${currentPct}%)`
            : `Pagina ${epubCurrentPage} (${currentPct}%)`;
        try {
            const res = await fetch('../api/bookmarks.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'add', book_id: currentBookId, location: currentLocation, label, percentage: currentPct })
            });
            const data = await res.json();
            if (data.success) {
                await loadBookmarks();
                toast(`Segnalibro salvato: ${label}`);
            } else {
                toast(data.error || 'Impossibile salvare il segnalibro.');
            }
        } catch (err) {
            toast('Connessione assente: segnalibro non salvato.');
        } finally {
            addingBookmark = false;
            if (addBookmarkBtn) addBookmarkBtn.disabled = false;
        }
    }

    if (addBookmarkBtn) addBookmarkBtn.addEventListener('click', addBookmark);
    if (bookmarksToggleBtn && bookmarksPanel) {
        bookmarksToggleBtn.addEventListener('click', (e) => { e.stopPropagation(); openPanel('bookmarks'); });
        bookmarksPanel.addEventListener('click', (e) => e.stopPropagation());
    }

    function turnPage(direction) {
        if (currentFormat === 'epub' && epubRendition) {
            if (direction > 0) epubRendition.next();
            else epubRendition.prev();
        } else if (currentFormat === 'pdf' && pdfDoc) {
            const targetPage = pdfCurrentPage + direction;
            if (targetPage >= 1 && targetPage <= pdfTotalPages) {
                renderPdfPage(targetPage);
            }
        }
    }

    function jumpToPage(val) {
        if (currentFormat === 'epub' && epubRendition && epubBook && epubBook.locations) {
            const pageNum = Math.min(Math.max(1, val), epubTotalPages);
            const cfi = epubBook.locations.cfiFromLocation(pageNum - 1);
            if (cfi) {
                epubRendition.display(cfi);
            }
        } else if (currentFormat === 'pdf' && pdfDoc) {
            const target = Math.min(Math.max(1, val), pdfTotalPages);
            renderPdfPage(target);
        }
    }

    async function initEpubReader(bookId, url, savedCfi) {
        epubStage.style.display = 'block';
        if (typeof ePub === 'undefined') return;

        try {
            const buffer = await getCachedBookBuffer(bookId, url);
            if (!buffer) throw new Error("Could not download book file.");

            epubBook = ePub(buffer);

            // Pre-register spine content hook: strip broken @font-face declarations before rendering
            epubBook.spine.hooks.content.register((contents) => {
                const doc = contents.document;
                if (doc) {
                    const styleElements = doc.querySelectorAll('style');
                    styleElements.forEach(styleEl => {
                        if (styleEl.textContent.includes('@font-face')) {
                            styleEl.textContent = styleEl.textContent.replace(/@font-face\s*\{[^}]*\}/gi, '');
                        }
                    });

                    applyEpubThemeToDoc(doc, currentTheme);
                }
            });

            epubRendition = epubBook.renderTo('epub-stage', {
                width: '100%',
                height: '100%',
                flow: 'paginated',
                // one page at a time unless the reader asked for two (never on a phone)
                spread: window.innerWidth > 800 ? spread : 'none',
            });
            epubRendition.themes.fontSize(fontPct + '%');
            // a tap in the middle of the text hides/shows the bars (not when selecting text)
            epubRendition.on('click', (e) => {
                const sel = e.view && e.view.getSelection ? String(e.view.getSelection()) : '';
                if (sel) return;
                // the frame is as wide as the whole chapter: subtract how far the pages are scrolled
                const cont = epubStage.querySelector('.epub-container');
                const x = e.clientX - (cont ? cont.scrollLeft : 0);
                if (isMiddleTap(x, epubStage.clientWidth)) middleTap();
            });

            // Content hook fallback for iframe section updates
            epubRendition.hooks.content.register((contents) => {
                if (contents && contents.document) {
                    applyEpubThemeToDoc(contents.document, currentTheme);
                    addSwipe(contents.document);
                }
            });

            await epubRendition.display(savedCfi || undefined);

            epubBook.ready.then(() => {
                return epubBook.locations.generate(1024);
            }).then(() => {
                epubTotalPages = epubBook.locations.total || 1;
                pageTotalLabel.textContent = `/ ${epubTotalPages}`;
                pageJumpInput.max = epubTotalPages;
                if (pageRange) pageRange.max = epubTotalPages;

                const currentLocation = epubRendition.currentLocation();
                if (currentLocation && currentLocation.start) {
                    updateEpubPageNumber(currentLocation.start.cfi);
                }
            });

            epubRendition.on('relocated', (location) => {
                if (!location || !location.start) return;
                const cfi = location.start.cfi;
                const percentage = Math.round((location.start.percentage || 0) * 100);

                if (epubRendition.getContents) {
                    const contents = epubRendition.getContents();
                    contents.forEach(c => {
                        if (c && c.document) applyEpubThemeToDoc(c.document, currentTheme);
                    });
                }

                updateEpubPageNumber(cfi);
                currentLocation = cfi;
                currentPct = percentage;
                updateProgressLine(percentage);
                saveProgress(currentBookId, cfi, percentage);
            });

        } catch (err) {
            console.error(err);
        }
    }

    function updateEpubPageNumber(cfi) {
        if (epubBook && epubBook.locations && epubBook.locations.total > 0) {
            const loc = epubBook.locations.locationFromCfi(cfi);
            if (loc !== undefined && loc !== -1) {
                epubCurrentPage = loc + 1;
                pageJumpInput.value = epubCurrentPage;
                if (pageRange) { pageRange.max = epubTotalPages; pageRange.value = epubCurrentPage; }
            }
        }
    }

    async function initPdfReader(url, savedPage) {
        pdfStage.style.display = 'block';
        if (typeof pdfjsLib === 'undefined') return;

        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

        try {
            pdfDoc = await pdfjsLib.getDocument(url).promise;
            pdfTotalPages = pdfDoc.numPages;
            pdfCurrentPage = parseInt(savedPage, 10) || 1;

            pageTotalLabel.textContent = `/ ${pdfTotalPages}`;
            pageJumpInput.max = pdfTotalPages;

            renderPdfPage(pdfCurrentPage);
        } catch (err) {
            console.error(err);
        }
    }

    async function renderPdfPage(pageNum) {
        if (!pdfDoc) return;
        pdfCurrentPage = pageNum;

        const page = await pdfDoc.getPage(pageNum);
        // Zoom 100% = the whole page fits the screen (one page at a time); more = bigger, moved with the finger
        const base = page.getViewport({ scale: 1 });
        const boxW = Math.max(200, pdfStage.clientWidth - 16);
        const boxH = Math.max(200, pdfStage.clientHeight - 16);
        const fit = Math.min(boxW / base.width, boxH / base.height);
        const scale = fit * pdfZoom;
        const viewport = page.getViewport({ scale });
        const dpr = Math.min(window.devicePixelRatio || 1, 3);

        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = Math.floor(viewport.width) + 'px';
        canvas.style.height = Math.floor(viewport.height) + 'px';
        const context = canvas.getContext('2d');

        if (pdfRenderTask) { try { pdfRenderTask.cancel(); } catch (e) { /* already done */ } }
        pdfRenderTask = page.render({ canvasContext: context, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null });
        try {
            await pdfRenderTask.promise;
        } catch (e) {
            return;   // cancelled by a newer page turn
        }
        if (pdfCurrentPage !== pageNum) return;
        pdfStage.replaceChildren(canvas);
        pdfStage.scrollTop = 0;
        viewerModal.classList.toggle('zoomed', pdfZoom > 1);

        const percentage = Math.round((pageNum / pdfTotalPages) * 100);
        pageJumpInput.value = pageNum;
        if (pageRange) { pageRange.max = pdfTotalPages; pageRange.value = pageNum; }

        currentLocation = pageNum.toString();
        currentPct = percentage;
        updateProgressLine(percentage);
        saveProgress(currentBookId, pageNum.toString(), percentage);
    }

    // ---- Text size / zoom, one or two pages ---------------------------------------
    function updateReadingUI() {
        const isPdf = currentFormat === 'pdf';
        if (zoomLabel) zoomLabel.textContent = isPdf ? `${Math.round(pdfZoom * 100)}%` : `${fontPct}%`;
        if (zoomFitBtn) zoomFitBtn.hidden = !isPdf || pdfZoom === 1;
        if (spreadRow) spreadRow.hidden = isPdf;
        viewerModal.classList.toggle('two-pages', !isPdf && spread === 'auto' && window.innerWidth > 800);
        spreadBtns.forEach((b) => b.classList.toggle('on', b.dataset.spread === spread));
        if (zoomOutBtn) zoomOutBtn.textContent = isPdf ? '\u2212' : 'A\u2212';
        if (zoomInBtn) zoomInBtn.textContent = isPdf ? '+' : 'A+';
    }

    function zoom(step) {
        if (currentFormat === 'pdf') {
            pdfZoom = step === 0 ? 1 : Math.min(3, Math.max(0.5, Math.round((pdfZoom + step * 0.25) * 100) / 100));
            setPref('vector_reader_pdf_zoom', pdfZoom);
            renderPdfPage(pdfCurrentPage);
        } else {
            fontPct = step === 0 ? 100 : Math.min(200, Math.max(70, fontPct + step * 10));
            setPref('vector_reader_font', fontPct);
            if (epubRendition) {
                const here = currentLocation;
                epubRendition.themes.fontSize(fontPct + '%');
                // the pages are laid out again: go back to the same place, or a blank/cut page would show
                setTimeout(() => {
                    try { epubRendition.resize(); } catch (e) { /* not ready */ }
                    if (here) epubRendition.display(here);
                }, 60);
            }
        }
        updateReadingUI();
    }

    function setSpread(value) {
        spread = value;
        setPref('vector_reader_spread', value);
        updateReadingUI();   // the column width changes first
        if (epubRendition) {
            epubRendition.spread(window.innerWidth > 800 ? value : 'none');
            requestAnimationFrame(() => {
                try { epubRendition.resize(); } catch (e) { /* not ready */ }
                if (currentLocation) epubRendition.display(currentLocation);
            });
        }
    }

    // Swipe left/right to turn the page (also inside the EPUB's own frame)
    function addSwipe(target) {
        let x0 = null;
        let y0 = null;
        target.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) { x0 = null; return; }
            x0 = e.touches[0].clientX;
            y0 = e.touches[0].clientY;
        }, { passive: true });
        target.addEventListener('touchend', (e) => {
            if (x0 === null || (currentFormat === 'pdf' && pdfZoom > 1)) return;
            const dx = e.changedTouches[0].clientX - x0;
            const dy = e.changedTouches[0].clientY - y0;
            x0 = null;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) turnPage(dx < 0 ? 1 : -1);
        }, { passive: true });
    }

    function applyTheme(theme) {
        currentTheme = theme;

        document.documentElement.setAttribute('data-theme', theme);
        document.body.setAttribute('data-theme', theme);
        if (viewerModal) viewerModal.setAttribute('data-theme', theme);

        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === theme);
        });

        if (epubRendition && epubRendition.getContents) {
            const contents = epubRendition.getContents();
            contents.forEach(content => {
                if (content && content.document) {
                    applyEpubThemeToDoc(content.document, theme);
                }
            });
        }
    }

    function applyEpubThemeToDoc(doc, theme) {
        if (!doc) return;
        const style = THEME_STYLES[theme] || THEME_STYLES.light;

        let styleTag = doc.getElementById('vector-reader-custom-theme');
        if (!styleTag) {
            styleTag = doc.createElement('style');
            styleTag.id = 'vector-reader-custom-theme';
            doc.head.appendChild(styleTag);
        }

        styleTag.textContent = `
            html, body {
                background-color: ${style.bg} !important;
                color: ${style.color} !important;
            }
            p, span, div, h1, h2, h3, h4, h5, h6, a, li, blockquote {
                color: ${style.color} !important;
                background-color: transparent !important;
            }
        `;
    }

    async function saveUserTheme(theme) {
        localStorage.setItem('vector_reader_theme', theme);
        try {
            await fetch('../api/save_theme.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ theme: theme })
            });
        } catch (e) {}
    }

    async function getSavedProgress(bookId) {
        const localData = localStorage.getItem(`read_progress_${bookId}`);
        if (localData) {
            try { return JSON.parse(localData); } catch (e) {}
        }
        try {
            const res = await fetch(`../api/progress.php?book_id=${bookId}`);
            const data = await res.json();
            if (data.success && data.progress) return data.progress;
        } catch (e) {}
        return null;
    }

    function saveProgress(bookId, cfiOrPage, percentage) {
        if (!bookId) return;

        const progressData = {
            cfi_or_page: cfiOrPage,
            percentage: percentage,
            updated_at: new Date().toISOString()
        };

        localStorage.setItem(`read_progress_${bookId}`, JSON.stringify(progressData));

        clearTimeout(progressDebounceTimer);
        progressDebounceTimer = setTimeout(async () => {
            try {
                await fetch('../api/progress.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        book_id: bookId,
                        cfi_or_page: cfiOrPage,
                        percentage: percentage
                    })
                });
            } catch (e) {}
        }, 1500);
    }

    function escapeHTML(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
});