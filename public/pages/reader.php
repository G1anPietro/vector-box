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
            <span style="font-size: 0.85rem; color: var(--text-muted);">Utente: <strong><?php echo htmlspecialchars($username); ?></strong></span>
            <a href="../index.php" class="btn">Esci</a>
        </div>
    </header>

    <div class="reader-container">
        <section class="toolbar-section">
            <form id="book-search-form" class="search-box">
                <input type="text" id="book-search-input" class="input-text" placeholder="Cerca libro per titolo o autore..." autocomplete="off">
                <button type="submit" class="btn btn-primary">Cerca</button>
            </form>

            <?php if ($canUpload): ?>
                <form id="book-upload-form" style="display: flex; gap: 0.5rem; align-items: center;" enctype="multipart/form-data">
                    <input type="file" id="book-upload-input" accept=".epub,.pdf" class="input-text" style="padding: 0.35rem;" required>
                    <button type="submit" class="btn btn-primary">Carica Libro</button>
                </form>
            <?php endif; ?>
        </section>

        <main>
            <section id="continue-section" style="display: none; margin-bottom: 1.5rem;">
                <h2 style="font-size: 1.1rem; margin-bottom: 1rem; color: var(--text-secondary);">Continua a leggere</h2>
                <div id="continue-shelf" class="book-grid"></div>
            </section>
            <h2 style="font-size: 1.1rem; margin-bottom: 1rem; color: var(--text-secondary);">La tua Libreria</h2>
            <div id="book-catalog" class="book-grid"></div>
        </main>
    </div>

    <!-- Reader Modal -->
    <div id="viewer-modal" class="viewer-modal" data-theme="light">
        <div class="viewer-header">
            <div style="display: flex; align-items: center; gap: 0.75rem; overflow: hidden;">
                <button id="close-viewer-btn" class="btn" style="padding: 0.2rem 0.6rem;">&larr; Biblioteca</button>
                <span id="viewer-title" style="font-weight: 600; font-size: 0.95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Titolo Libro</span>
            </div>

            <div class="reader-controls">
                <!-- Theme Selector duplicated inside book viewer header -->
                <div class="theme-selector" title="Seleziona Tema">
                    <button class="theme-btn theme-light active" data-theme="light" title="Chiaro"></button>
                    <button class="theme-btn theme-sepia" data-theme="sepia" title="Sepia"></button>
                    <button class="theme-btn theme-dark" data-theme="dark" title="Scuro"></button>
                    <button class="theme-btn theme-black" data-theme="black" title="OLED Nero"></button>
                </div>

                <div class="filter-control" title="Filtro Luce Blu">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="5"></circle>
                        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path>
                    </svg>
                    <input type="range" id="blue-light-slider" min="0" max="60" value="0" step="5" class="slider-bar">
                </div>

                <div style="position: relative; display: flex; gap: 0.35rem;">
                    <button id="add-bookmark-btn" class="btn" title="Aggiungi segnalibro alla posizione attuale">+ Segnalibro</button>
                    <button id="bookmarks-toggle-btn" class="btn" title="Mostra segnalibri">Segnalibri &#9662;</button>
                    <div id="bookmarks-panel" style="display: none; position: absolute; top: 110%; right: 0; z-index: 50; min-width: 260px; max-height: 320px; overflow-y: auto; background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 6px; padding: 0.4rem; box-shadow: var(--shadow-md);"></div>
                </div>

                <a id="download-book-btn" class="btn" href="#" download title="Scarica file originale">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                    <span>Scarica</span>
                </a>

                <div class="nav-controls">
                    <button id="prev-page-btn" class="btn" title="Pagina precedente">&larr;</button>
                    <div class="page-jump-wrapper">
                        <input type="number" id="page-jump-input" min="1" value="1" class="page-input">
                        <span id="page-total-label" style="font-size: 0.8rem; color: var(--text-muted);">/ 100%</span>
                    </div>
                    <button id="next-page-btn" class="btn" title="Pagina successiva">&rarr;</button>
                </div>
            </div>
        </div>

        <div class="viewer-content" id="viewer-stage-container">
            <div id="epub-stage"></div>
            <div id="pdf-stage"></div>
        </div>
    </div>

</body>
</html>