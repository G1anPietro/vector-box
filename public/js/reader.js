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
    }

    if (uploadForm && uploadInput) {
        uploadForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const file = uploadInput.files[0];
            if (!file) return;

            const formData = new FormData();
            formData.append('book_file', file);

            try {
                const res = await fetch('../api/books.php?action=upload', {
                    method: 'POST',
                    body: formData
                });
                const data = await res.json();
                if (data.success) {
                    uploadInput.value = '';
                    loadCatalog();
                } else {
                    alert(`Upload Error: ${data.error}`);
                }
            } catch (err) {
                alert('Failed to upload file.');
            }
        });
    }

    if (closeViewerBtn) closeViewerBtn.addEventListener('click', closeViewer);
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

    // Attach listeners across all theme-btn buttons on page and modal header
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.theme-btn');
        if (btn && btn.dataset.theme) {
            const theme = btn.dataset.theme;
            applyTheme(theme);
            saveUserTheme(theme);
        }
    });

    document.addEventListener('keydown', (e) => {
        if (!viewerModal.classList.contains('active')) return;
        if (e.key === 'ArrowLeft') turnPage(-1);
        if (e.key === 'ArrowRight') turnPage(1);
        if (e.key === 'Escape') closeViewer();
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

    // One card, built with DOM methods (no innerHTML / inline handlers)
    function buildBookCard(book) {
        const card = document.createElement('div');
        card.className = 'book-card';

        const cover = document.createElement('div');
        cover.className = 'book-cover';
        if (book.cover_path) {
            const img = document.createElement('img');
            img.src = book.cover_path;
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

    function closeViewer() {
        viewerModal.classList.remove('active');
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
        if (bookmarksPanel) bookmarksPanel.style.display = 'none';
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
        if (bookmarksToggleBtn) bookmarksToggleBtn.textContent = `Segnalibri (${bookmarks.length}) \u25BE`;
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

    async function addBookmark() {
        if (!currentBookId || !currentLocation) return;
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
                if (addBookmarkBtn) {
                    addBookmarkBtn.textContent = '\u2713 Salvato';
                    setTimeout(() => { addBookmarkBtn.textContent = '+ Segnalibro'; }, 1500);
                }
            } else {
                alert(data.error || 'Impossibile salvare il segnalibro.');
            }
        } catch (err) {}
    }

    if (addBookmarkBtn) addBookmarkBtn.addEventListener('click', addBookmark);
    if (bookmarksToggleBtn && bookmarksPanel) {
        bookmarksToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            bookmarksPanel.style.display = bookmarksPanel.style.display === 'none' ? 'block' : 'none';
        });
        bookmarksPanel.addEventListener('click', (e) => e.stopPropagation());
        document.addEventListener('click', () => { bookmarksPanel.style.display = 'none'; });
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
                flow: 'paginated'
            });

            // Content hook fallback for iframe section updates
            epubRendition.hooks.content.register((contents) => {
                if (contents && contents.document) {
                    applyEpubThemeToDoc(contents.document, currentTheme);
                }
            });

            await epubRendition.display(savedCfi || undefined);

            epubBook.ready.then(() => {
                return epubBook.locations.generate(1024);
            }).then(() => {
                epubTotalPages = epubBook.locations.total || 1;
                pageTotalLabel.textContent = `/ ${epubTotalPages}`;
                pageJumpInput.max = epubTotalPages;

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
        const viewport = page.getViewport({ scale: 1.2 });

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        pdfStage.innerHTML = '';
        pdfStage.appendChild(canvas);

        await page.render({ canvasContext: context, viewport: viewport }).promise;

        const percentage = Math.round((pageNum / pdfTotalPages) * 100);
        pageJumpInput.value = pageNum;

        currentLocation = pageNum.toString();
        currentPct = percentage;
        saveProgress(currentBookId, pageNum.toString(), percentage);
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