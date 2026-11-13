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
            'js/reader.js'
        ], 
        true
    ); 
    ?>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js"></script>
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
            <a href="../index.php" class="btn">&larr; Sito</a>
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
            <section id="continue-section" style="display: none;" class="shelf-section">
                <h2 class="shelf-title">Continua a leggere</h2>
                <div id="continue-shelf" class="book-grid continue-row"></div>
            </section>
            <h2 class="shelf-title">La tua libreria</h2>
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
                <div class="pop-wrap">
                    <button id="bookmarks-toggle-btn" class="btn" title="Segnalibri">Segnalibri</button>
                    <div id="bookmarks-panel" class="popover" style="display: none;"></div>
                </div>
                <div class="pop-wrap">
                    <button id="settings-btn" class="btn icon-btn aa-btn" title="Testo, pagine e colori" aria-label="Testo, pagine e colori" aria-expanded="false">Aa</button>
                    <div id="settings-panel" class="popover settings-panel" hidden>
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
                        <div class="set-row">
                            <label class="set-label" for="blue-light-slider">Filtro luce blu</label>
                            <input type="range" id="blue-light-slider" min="0" max="60" value="0" step="5" class="slider-bar">
                        </div>
                        <button id="bars-btn" class="btn small-btn" type="button">Nascondi le barre (tocca il centro della pagina per riaverle)</button>
                        <a id="download-book-btn" class="btn small-btn" href="#" download>Scarica il file originale</a>
                    </div>
                </div>
            </div>
        </div>

        <div id="reader-backdrop" class="reader-backdrop" hidden></div>
        <div class="viewer-content" id="viewer-stage-container">
            <div id="epub-stage"></div>
            <div id="pdf-stage"></div>
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
    <div id="reader-toast" class="reader-toast" role="status" aria-live="polite" hidden></div>

</body>
</html>