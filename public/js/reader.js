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
                renderCatalog(data.books);
            } else {
                catalogContainer.innerHTML = `<p style="grid-column: 1/-1; color: red;">Error: ${data.error}</p>`;
            }
        } catch (err) {
            catalogContainer.innerHTML = '<p style="grid-column: 1/-1; color: red;">Impossibile caricare i libri.</p>';
        }
    }

    function renderCatalog(books) {
        if (!books || books.length === 0) {
            catalogContainer.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--text-muted);">Nessun libro trovato.</p>';
            return;
        }

        catalogContainer.innerHTML = '';
        books.forEach(book => {
            const card = document.createElement('div');
            card.className = 'book-card';
            card.innerHTML = `
                <div class="book-cover">
                    ${book.cover_path 
                        ? `<img src="${book.cover_path}" alt="${escapeHTML(book.title)}" style="width:100%;height:100%;object-fit:cover;">` 
                        : `<span>${escapeHTML(book.format.toUpperCase())}</span>`}
                </div>
                <div class="book-info">
                    <div class="book-title" title="${escapeHTML(book.title)}">${escapeHTML(book.title)}</div>
                    <div class="book-author">${escapeHTML(book.author || 'Autore Sconosciuto')}</div>
                    <div class="card-footer">
                        <span class="book-badge">${escapeHTML(book.format)}</span>
                        <a href="../api/books.php?action=download&id=${book.id}" class="btn" style="padding:0.15rem 0.4rem; font-size:0.75rem;" onclick="event.stopPropagation();" title="Scarica">
                            &darr;
                        </a>
                    </div>
                </div>
            `;
            
            card.querySelector('.book-cover').addEventListener('click', () => openBook(book));
            card.querySelector('.book-title').addEventListener('click', () => openBook(book));
            catalogContainer.appendChild(card);
        });
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