<?php
// public/pages/reader.php
require_once __DIR__ . '/../api/database.php';
require_once __DIR__ . '/../includes/head.php';

initSession();

$db = getDbConnection();
$userId =$_SESSION['user_id'] ?? null;
$username =$_SESSION['username'] ?? 'guest';
$isAdmin = !empty($_SESSION['is_admin']);

$canRead =$isAdmin;
$canUpload =$isAdmin;

if ($userId && !$isAdmin) {
    $stmt =$db->prepare("SELECT can_read_books, can_upload_books FROM accounts WHERE id = :id");
    $stmt->execute([':id' =>$userId]);
    $account =$stmt->fetch();
    if ($account) {
        $canRead = (int)$account['can_read_books'] === 1;
        $canUpload = (int)$account['can_upload_books'] === 1;
    }
}

if (!$canRead) {
    http_response_code(403);
    echo "<div style='padding: 2rem; font-family: sans-serif; text-align: center; color: #721c24; background-color: #f8d7da;'>";
    echo "<h2>Accesso Negato</h2>";
    echo "<p>Non disponi dei permessi necessari per accedere alla biblioteca ed al lettore di libri.</p>";
    echo "<a href='../index.php' style='color: #721c24; font-weight: bold;'>Torna alla Home</a>";
    echo "</div>";
    exit();
}
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <?php 
    renderHead(
        "Biblioteca & Lettore // Vector-OS", 
        true, 
        [
            'js/dropzone.js',
            'js/reader-tools.js',
            'js/reader.js'
        ], 
        true
    ); 
    ?>
    <link rel="stylesheet" href="../css/dropzone.css?v=<?= APP_VERSION ?>">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js" integrity="sha384-+mbV2IY1Zk/X1p/nWllGySJSUN8uMs+gUAN10Or95UBH0fpj6GfKgPmgC5EXieXG" crossorigin="anonymous"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js" integrity="sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e" crossorigin="anonymous"></script>
    <script src="https://cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js" integrity="sha384-ZqmkDa/1AGF4SKdSmXgEG+3G+Gsb6yNqUSq2Mqp0jDf1GWk+UY5eNbEd7hgwiywI" crossorigin="anonymous"></script>
</head>
<body>

    <header class="reader-header">
        <a href="../index.php" class="reader-brand">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
            </svg>
            <span>Vector Reader</span>
        </a>

        <!-- Global Theme Selector -->
        <div class="reader-nav">
            <div class="theme-selector" title="Seleziona Tema">
                <button class="theme-btn theme-light active" data-theme="light" title="Chiaro"></button>
                <button class="theme-btn theme-sepia" data-theme="sepia" title="Sepia"></button>
                <button class="theme-btn theme-dark" data-theme="dark" title="Scuro"></button>
                <button class="theme-btn theme-black" data-theme="black" title="OLED Nero"></button>
            </div>
            <span class="who">Utente: <strong><?php echo htmlspecialchars($username); ?></strong></span>
            <a href="../index.php" class="btn menu-btn" title="Torna al menu principale di vector-box" aria-label="Torna al menu principale di vector-box">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"></path></svg>
                <span>Menu</span>
            </a>
        </div>
    </header>

    <div class="reader-container">
        <section class="toolbar-section">
            <form id="book-search-form" class="search-box" role="search">
                <input type="search" id="book-search-input" class="input-text search-input" placeholder="Cerca per titolo o autore" autocomplete="off" aria-label="Cerca un libro">
                <button type="submit" class="btn btn-primary">Cerca</button>
            </form>

            <?php if ($canUpload): ?>
                <form id="book-upload-form" class="upload-row" enctype="multipart/form-data">
                    <label class="btn upload-btn">+ Carica libri
                        <input type="file" id="book-upload-input" accept=".epub,.pdf" multiple>
                    </label>
                    <p id="book-upload-status" class="upload-status" aria-live="polite">EPUB o PDF, anche più di uno insieme (sul computer anche trascinandoli qui).</p>
                </form>
            <?php endif; ?>
        </section>

        <main>
            <details id="stats-section" class="stats-section">
                <summary>Le tue letture</summary>
                <div id="stats-body" class="stats-body" aria-live="polite">Caricamento…</div>
            </details>
            <section id="continue-section" style="display: none;" class="shelf-section">
                <h2 class="shelf-title">Continua a leggere</h2>
                <div id="continue-shelf" class="book-grid continue-row"></div>
            </section>
            <h2 class="shelf-title">La tua libreria</h2>
            <div class="shelf-tools" id="shelf-tools">
                <div id="shelf-filters" class="chips" role="group" aria-label="Stato di lettura"></div>
                <details id="more-filters" class="more-filters">
                    <summary id="more-filters-sum">Altri filtri</summary>
                    <div class="filter-grid">
                        <div class="filter-group"><span class="set-label">Formato</span>
                            <div id="f-format" class="chips" role="group" aria-label="Formato"></div></div>
                        <label class="filter-group"><span class="set-label">Autore</span>
                            <select id="f-author" class="input-text sort-select"></select></label>
                        <label class="filter-group"><span class="set-label">Etichetta</span>
                            <select id="f-tag" class="input-text sort-select"></select></label>
                        <div class="filter-group"><span class="set-label">Solo i libri…</span>
                            <div id="f-flags" class="chips" role="group" aria-label="Altri criteri"></div></div>
                    </div>
                </details>
                <div class="filter-status"><span id="shelf-count" aria-live="polite"></span> <button type="button" id="filters-reset" class="link-btn" hidden>Azzera i filtri</button></div>
                <label class="sort-label">Ordina per
                    <select id="shelf-sort" class="input-text sort-select">
                        <optgroup label="Aggiunta">
                            <option value="recent">Aggiunti di recente</option>
                            <option value="oldest">Aggiunti da più tempo</option>
                        </optgroup>
                        <optgroup label="Nome">
                            <option value="title">Titolo (A-Z)</option>
                            <option value="title-desc">Titolo (Z-A)</option>
                            <option value="author">Autore (A-Z)</option>
                            <option value="author-desc">Autore (Z-A)</option>
                        </optgroup>
                        <optgroup label="Lettura">
                            <option value="read">Letti di recente</option>
                            <option value="progress">Più avanti nella lettura</option>
                            <option value="finish">Da finire (i più vicini alla fine)</option>
                            <option value="unread">Da iniziare prima</option>
                        </optgroup>
                        <optgroup label="Contenuto">
                            <option value="notes">Con più note ed evidenziazioni</option>
                            <option value="marks">Con più segnalibri</option>
                            <option value="big">Più grandi (file)</option>
                            <option value="small">Più piccoli (file)</option>
                            <option value="format">Formato (EPUB, poi PDF)</option>
                        </optgroup>
                        <optgroup label="Altro">
                            <option value="random">A caso</option>
                        </optgroup>
                    </select>
                    <button type="button" id="shuffle-btn" class="btn small-btn" hidden title="Mischia di nuovo">🔀 Mischia</button>
                </label>
                <?php if ($canUpload): ?><button type="button" id="tidy-titles-btn" class="btn small-btn" title="Toglie dai titoli i resti dei siti di download">Sistema i titoli</button><?php endif; ?>
            </div>
            <div id="tidy-panel" class="tidy-panel" hidden></div>
            <div id="book-catalog" class="book-grid"></div>
        </main>
    </div>

    <!-- Reader: top bar (back, title, bookmarks, "Aa"), the page, bottom bar (page turn and position) -->
    <div id="viewer-modal" class="viewer-modal" data-theme="light">
        <div class="viewer-header">
            <button id="close-viewer-btn" class="btn icon-btn" title="Torna alla biblioteca" aria-label="Torna alla biblioteca">&larr;</button>
            <span id="viewer-title" class="viewer-title">Titolo Libro</span>
            <div class="viewer-actions">
                <button id="add-bookmark-btn" class="btn icon-btn" title="Aggiungi un segnalibro qui" aria-label="Aggiungi un segnalibro qui">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/><path d="M12 7v6M9 10h6"/></svg>
                </button>
                <form id="top-page-form" class="top-page" novalidate title="Pagina: scrivi un numero e premi Invio per andarci" hidden>
                    <input id="top-page-input" class="top-page-input" type="number" inputmode="numeric" min="1" value="1" aria-label="Numero di pagina: scrivilo e premi Invio per andarci" enterkeyhint="go">
                    <span id="top-page-total" class="top-page-total">/ 1</span>
                </form>
                <div class="pop-wrap">
                    <button id="settings-btn" class="btn menu-open-btn" title="Menu del libro: indice, cerca, note, testo" aria-label="Menu del libro: indice, cerca, note e testo" aria-expanded="false" aria-controls="settings-panel">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"></path></svg>
                        <span>Menu</span>
                    </button>
                    <div id="settings-panel" class="popover settings-panel menu-panel" hidden>
                        <div class="menu-tabs" role="tablist" aria-label="Menu del libro">
                            <button type="button" class="menu-tab-btn" role="tab" data-tab="toc" aria-selected="true">Indice</button>
                            <button type="button" class="menu-tab-btn" role="tab" data-tab="search" aria-selected="false">Cerca</button>
                            <button type="button" class="menu-tab-btn" role="tab" data-tab="notes" aria-selected="false">Note</button>
                            <button type="button" class="menu-tab-btn" role="tab" data-tab="text" aria-selected="false">Testo</button>
                        </div>
                        <section id="tab-toc" class="menu-tab" role="tabpanel">
                            <div id="toc-list" class="toc-list"></div>
                        </section>
                        <section id="tab-search" class="menu-tab" role="tabpanel" hidden>
                            <form id="inbook-search-form" class="inbook-search" role="search">
                                <input type="search" id="inbook-search-input" class="input-text" placeholder="Cerca nel libro" autocomplete="off" aria-label="Cerca nel libro">
                                <button type="submit" class="btn btn-primary">Cerca</button>
                            </form>
                            <div id="inbook-search-status" class="set-hint" aria-live="polite"></div>
                            <ol id="inbook-search-results" class="search-results"></ol>
                        </section>
                        <section id="tab-notes" class="menu-tab" role="tabpanel" hidden>
                            <div class="notes-actions">
                                <button type="button" id="add-note-btn" class="btn small-btn">+ Nota in questa pagina</button>
                                <a id="export-notes-btn" class="btn small-btn" href="#" download>Esporta note</a>
                            </div>
                            <h3 class="menu-h">Segnalibri</h3>
                            <div id="bookmarks-panel" class="bm-list"></div>
                            <h3 class="menu-h">Evidenziazioni e note</h3>
                            <div id="highlights-list" class="hl-list"></div>
                            <p class="set-hint" id="hl-hint">Per evidenziare, seleziona un pezzo di testo (solo EPUB).</p>
                        </section>
                        <section id="tab-text" class="menu-tab" role="tabpanel" hidden>
                        <div class="set-row">
                            <span class="set-label" id="size-label-title">Dimensione del testo</span>
                            <div class="stepper" role="group" aria-labelledby="size-label-title">
                                <button id="zoom-out-btn" class="btn" aria-label="Più piccolo">A&minus;</button>
                                <span id="zoom-label" class="zoom-label">100%</span>
                                <button id="zoom-in-btn" class="btn" aria-label="Più grande">A+</button>
                            </div>
                            <button id="zoom-fit-btn" class="btn small-btn" hidden>Adatta alla larghezza</button>
                        </div>
                        <div class="set-row" id="spread-row">
                            <span class="set-label">Pagine</span>
                            <div class="segmented" role="group" aria-label="Pagine">
                                <button id="spread-one-btn" class="btn" data-spread="none">Una alla volta</button>
                                <button id="spread-two-btn" class="btn" data-spread="auto">Due affiancate</button>
                            </div>
                        </div>
                        <div class="set-row">
                            <span class="set-label">Colori</span>
                            <div class="theme-selector" title="Seleziona Tema">
                                <button class="theme-btn theme-light active" data-theme="light" title="Chiaro"></button>
                                <button class="theme-btn theme-sepia" data-theme="sepia" title="Seppia"></button>
                                <button class="theme-btn theme-dark" data-theme="dark" title="Scuro"></button>
                                <button class="theme-btn theme-black" data-theme="black" title="Nero (OLED)"></button>
                            </div>
                        </div>
                        <div class="set-row epub-only">
                            <span class="set-label">Carattere</span>
                            <div class="segmented" role="group" aria-label="Carattere">
                                <button class="btn" data-font="book">Del libro</button>
                                <button class="btn" data-font="serif">Serif</button>
                                <button class="btn" data-font="sans">Sans</button>
                                <button class="btn" data-font="easy">Facile</button>
                            </div>
                        </div>
                        <div class="set-row epub-only">
                            <span class="set-label" id="lh-label-title">Interlinea</span>
                            <div class="stepper" role="group" aria-labelledby="lh-label-title">
                                <button id="lh-down-btn" class="btn" aria-label="Interlinea più stretta">−</button>
                                <span id="lh-label" class="zoom-label">1,5</span>
                                <button id="lh-up-btn" class="btn" aria-label="Interlinea più larga">+</button>
                            </div>
                        </div>
                        <div class="set-row epub-only">
                            <span class="set-label">Margini</span>
                            <div class="segmented" role="group" aria-label="Margini">
                                <button class="btn" data-margin="normal">Normali</button>
                                <button class="btn" data-margin="wide">Larghi</button>
                                <button class="btn" data-margin="xwide">Molto larghi</button>
                            </div>
                        </div>
                        <div class="set-row epub-only">
                            <span class="set-label">Allineamento</span>
                            <div class="segmented" role="group" aria-label="Allineamento">
                                <button class="btn" data-justify="left">A sinistra</button>
                                <button class="btn" data-justify="justify">Giustificato</button>
                            </div>
                        </div>
                        <div class="set-row">
                            <label class="set-label" for="blue-light-slider">Filtro luce blu</label>
                            <input type="range" id="blue-light-slider" min="0" max="60" value="0" step="5" class="slider-bar">
                        </div>
                        <div class="set-row">
                            <span class="set-label">Cambio pagina</span>
                            <div class="segmented" role="group" aria-label="Cambio pagina">
                                <button class="btn" data-flip="none">Subito</button>
                                <button class="btn" data-flip="book">Come un libro</button>
                            </div>
                            <span class="set-hint">"Come un libro": la pagina si gira come un foglio di carta (si spegne da sola se il telefono chiede meno animazioni).</span>
                        </div>
                        <div class="set-row">
                            <span class="set-label">Barra in basso</span>
                            <div class="segmented" role="group" aria-label="Barra in basso">
                                <button class="btn" data-footer="auto">Quando serve</button>
                                <button class="btn" data-footer="always">Sempre</button>
                            </div>
                            <span class="set-hint">"Quando serve": tocca il centro della pagina per vederla.</span>
                        </div>
                        <button id="bars-btn" class="btn small-btn" type="button">Schermo intero</button>
                        <span class="set-hint">Per uscire: il pulsante ✕ in alto a destra, un tocco al centro della pagina, il tasto
                            indietro del telefono o Esc.</span>
                        <details class="howto">
                            <summary>Come si usa</summary>
                            <ul>
                                <li><b>Girare pagina:</b> tocca il bordo destro o sinistro, scorri con il dito, oppure ← → sulla tastiera.</li>
                                <li><b>Barra in basso</b> (posizione e numero di pagina): tocca il centro della pagina.</li>
                                <li><b>Schermo intero:</b> qui sopra; per uscire ✕ in alto, tocco al centro, indietro o Esc.</li>
                                <li><b>Testo più grande o più piccolo:</b> A+ e A− (nei PDF è lo zoom; + e − sulla tastiera).</li>
                                <li><b>Segnalibro:</b> l'icona in alto salva la pagina; "Segnalibri" li elenca.</li>
                                <li><b>Chiudere un menu:</b> tocca in un punto qualsiasi fuori.</li>
                            </ul>
                        </details>
                        <a id="download-book-btn" class="btn small-btn" href="#" download>Scarica il file originale</a>
                        </section>
                    </div>
                </div>
            </div>
        </div>

        <div id="reader-backdrop" class="reader-backdrop" hidden></div>
        <div class="viewer-content" id="viewer-stage-container">
            <div id="epub-stage"></div>
            <div id="pdf-stage"></div>
            <div class="progress-line" aria-hidden="true"><span id="progress-line"></span></div>
            <button id="exit-full-btn" class="exit-full" type="button" aria-label="Esci da schermo intero">✕ Esci</button>
            <button id="tap-prev" class="tap-zone tap-prev" aria-label="Pagina precedente" tabindex="-1"></button>
            <button id="tap-next" class="tap-zone tap-next" aria-label="Pagina successiva" tabindex="-1"></button>
        </div>

        <div class="viewer-footer">
            <button id="prev-page-btn" class="btn nav-btn" title="Pagina precedente (←)" aria-label="Pagina precedente">&lsaquo;</button>
            <div class="position">
                <input type="range" id="page-range" min="1" max="1" value="1" aria-label="Posizione nel libro">
                <div class="page-jump-wrapper">
                    <input type="number" id="page-jump-input" min="1" value="1" class="page-input" aria-label="Vai alla pagina">
                    <span id="page-total-label">/ 1</span>
                </div>
            </div>
            <button id="next-page-btn" class="btn nav-btn" title="Pagina successiva (→)" aria-label="Pagina successiva">&rsaquo;</button>
        </div>
    </div>
    <div id="sel-bar" class="sel-bar" role="toolbar" aria-label="Evidenzia il testo selezionato" hidden>
        <span class="sel-colors">
            <button type="button" class="sel-color c-yellow" data-color="yellow" aria-label="Evidenzia in giallo"></button>
            <button type="button" class="sel-color c-green" data-color="green" aria-label="Evidenzia in verde"></button>
            <button type="button" class="sel-color c-blue" data-color="blue" aria-label="Evidenzia in azzurro"></button>
            <button type="button" class="sel-color c-pink" data-color="pink" aria-label="Evidenzia in rosa"></button>
        </span>
        <button type="button" id="sel-note-btn" class="btn small-btn">+ Nota</button>
        <button type="button" id="sel-cancel-btn" class="btn small-btn" aria-label="Annulla">✕</button>
    </div>
    <div id="tag-dialog" class="tag-dialog" role="dialog" aria-modal="true" aria-labelledby="tag-dialog-title" hidden>
        <form id="tag-form" class="tag-card">
            <h3 id="tag-dialog-title">Etichette del libro</h3>
            <p class="set-hint" id="tag-dialog-book"></p>
            <input type="text" id="tag-input" class="input-text" placeholder="maturità, da rileggere, informatica" autocomplete="off" maxlength="240" aria-label="Etichette separate da virgole">
            <div id="tag-suggest" class="chips"></div>
            <div class="tag-actions"><button type="button" id="tag-cancel" class="btn">Annulla</button><button type="submit" class="btn btn-primary">Salva</button></div>
        </form>
    </div>
    <div id="reader-toast" class="reader-toast" role="status" aria-live="polite" hidden></div>

</body>
</html>