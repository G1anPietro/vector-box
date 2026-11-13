<?php
// public/pages/appunti.php — shared class notes: material per subject and lesson, calendar of tests,
// class management (manager) and class requests (admin). Logged-in users only; data from api/classi.php
// and api/appunti.php, rendered by js/appunti.js with textContent only.
require_once __DIR__ . '/../includes/head.php';
require_once __DIR__ . '/../api/database.php';

initSession(true);
if (empty($_SESSION['user_id'])) {
    // Guests first see what the notes are (with the login button)
    session_write_close();
    header('Location: appunti-guida.php');
    exit();
}
if (empty($_SESSION['csrf_token'])) $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
$csrf = $_SESSION['csrf_token'];
$username = (string)$_SESSION['username'];
$isAdmin = !empty($_SESSION['is_admin']);
session_write_close();

$e = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES);
$v = filemtime(__DIR__ . '/../js/appunti.js') . '-' . filemtime(__DIR__ . '/../js/appunti-common.js') . '-' . filemtime(__DIR__ . '/../css/appunti.css');
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#14161b">
    <meta name="robots" content="noindex">
    <title>Appunti di classe — vector-box</title>
    <link rel="stylesheet" href="../css/appunti.css?v=<?= $e($v) ?>">
    <link rel="manifest" href="../assets/appunti/manifest.json?v=1">
    <link rel="icon" href="../assets/appunti/icon.svg?v=1" type="image/svg+xml">
    <link rel="apple-touch-icon" href="../assets/appunti/apple-touch-icon.png?v=1">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-title" content="Appunti">
    <script src="../js/csrf.js?v=<?= $e($v) ?>"></script>
    <script src="../js/appunti-common.js?v=<?= $e($v) ?>" defer></script>
    <script src="../js/appunti.js?v=<?= $e($v) ?>" defer></script>
</head>
<body>
    <header class="top">
        <a class="home" href="../index.php">vector-box</a>
        <span class="top-right">
            <a class="ghost-link" href="appunti-archivio.php">Archivio</a>
            <a class="ghost-link" href="appunti-carica.php">+ Carica</a>
            <a class="ghost-link hide-phone" href="appunti-guida.php">Guida</a>
            <span class="who"><?= $e($username) ?></span>
            <button id="bell" class="bell" type="button" aria-label="Notifiche" aria-expanded="false">
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1Z"/></svg>
                <span id="bell-count" class="bell-count" hidden></span>
            </button>
        </span>
    </header>

    <main class="wrap">
        <div class="head">
            <h1>Appunti di classe</h1>
            <label class="pick">
                <span class="sr">Classe</span>
                <select id="class-select" aria-label="Classe"></select>
            </label>
        </div>
        <p id="status" class="status" role="status" aria-live="polite"></p>

        <section id="notif-panel" class="card notif-panel" hidden>
            <div class="notif-head">
                <h2>Notifiche</h2>
                <button id="notif-close" class="ghost mini" type="button">Chiudi</button>
            </div>
            <div id="push-box" class="push-box"></div>
            <ul id="notif-list" class="plain notif-list"></ul>
        </section>

        <!-- No class yet: join with a code or ask for a new class -->
        <section id="welcome" class="card" hidden>
            <h2>Entra nella tua classe</h2>
            <p class="muted">Chiedi il codice d'invito al responsabile della classe.</p>
            <form id="join-form" class="row">
                <input name="code" placeholder="Codice (es. K7QM-2XPA)" autocomplete="off" required maxlength="20">
                <button>Entra</button>
            </form>
            <details id="request-box">
                <summary>La tua classe non c'è? Chiedila</summary>
                <form id="request-form" class="stack">
                    <input name="name" placeholder="Classe (es. 5B-I)" required maxlength="40">
                    <input name="school" placeholder="Scuola" required maxlength="100">
                    <textarea name="note" placeholder="Note per l'amministratore (facoltative)" maxlength="300" rows="2"></textarea>
                    <button>Invia la richiesta</button>
                </form>
                <p id="requests-closed" class="muted" hidden>Le richieste di nuove classi sono chiuse in questo momento.</p>
            </details>
            <ul id="my-requests" class="plain"></ul>
        </section>

        <nav id="tabs" class="tabs" hidden>
            <button data-tab="material" aria-selected="true">Materiale</button>
            <button data-tab="study">Studio</button>
            <button data-tab="calendar">Calendario</button>
            <button data-tab="class">Classe</button>
            <button data-tab="admin" hidden>Admin</button>
        </nav>

        <!-- Material -->
        <section id="tab-material" class="tab" hidden>
            <div class="card cta-card">
                <div>
                    <b>Hai appunti, foto o slide di una lezione?</b>
                    <span class="muted small">Foto dal telefono, file, testo copiato da un'AI: tutto dalla pagina Carica.</span>
                </div>
                <div class="row-actions">
                    <a class="btn-link" id="upload-link" href="appunti-carica.php">+ Carica</a>
                    <a class="ghost-link" href="appunti-archivio.php">Archivio</a>
                </div>
            </div>

            <div class="filters row">
                <select id="filter-subject" aria-label="Materia"><option value="">Tutte le materie</option></select>
                <select id="filter-kind" aria-label="Tipo"><option value="">Tutti i tipi</option></select>
                <button id="ai-subject" class="ghost" type="button" hidden>↓ Materia per AI (.md)</button>
                <button id="zip-subject" class="ghost" type="button" hidden>↓ Tutta la materia (.zip)</button>
            </div>
            <div id="items"></div>
        </section>

        <!-- Study: AI documents -->
        <section id="tab-study" class="tab" hidden>
            <div id="study-list">
                <div class="card ai-bar" id="ai-bar"></div>
                <h2 class="section-title">Verifiche e interrogazioni in arrivo</h2>
                <div id="study-tests"></div>
                <div class="card cta-card">
                    <div>
                        <b>Hai fatto un riassunto con ChatGPT, Gemini o Claude?</b>
                        <span class="muted small">Scarica il file "Per AI" di una verifica, dallo all'AI e carica qui la risposta.</span>
                    </div>
                    <a class="ghost-link" id="doc-upload-link" href="appunti-carica.php?m=ai">+ Carica un documento</a>
                </div>
                <h2 class="section-title">Appunti delle lezioni</h2>
                <div class="filters row">
                    <select id="study-subject" aria-label="Materia"><option value="">Tutte le materie</option></select>
                </div>
                <div id="study-lessons"></div>
            </div>
            <article id="doc-view" class="doc-view" hidden>
                <div class="doc-tools no-print">
                    <button id="doc-back" class="ghost mini">← Indietro</button>
                    <span class="spacer"></span>
                    <button id="doc-download" class="ghost mini">Scarica</button>
                    <button id="doc-print" class="ghost mini">Stampa / PDF</button>
                </div>
                <h2 id="doc-title"></h2>
                <p id="doc-meta" class="muted small"></p>
                <div id="doc-body" class="md"></div>
                <details id="doc-sources" class="no-print"><summary>Da dove viene</summary><ol id="doc-sources-list"></ol></details>
                <p class="muted small ai-note">Scritto da un'AI a partire dal materiale caricato: può sbagliare, controlla sempre con il libro e gli appunti originali.</p>
            </article>
        </section>

        <!-- Calendar -->
        <section id="tab-calendar" class="tab" hidden>
            <details class="card">
                <summary>Aggiungi una data</summary>
                <form id="event-form" class="stack">
                    <div class="grid2">
                        <label>Tipo
                            <select name="kind">
                                <option value="verifica">Verifica scritta</option>
                                <option value="interrogazione">Interrogazione</option>
                                <option value="altro">Altro</option>
                            </select>
                        </label>
                        <label>Giorno <input type="date" name="date" required></label>
                    </div>
                    <label>Materia <select name="subject_id" required></select></label>
                    <label>Titolo (facoltativo) <input name="title" maxlength="120"></label>
                    <label>Argomenti detti dal prof <textarea name="topics" rows="3" maxlength="2000"></textarea></label>
                    <button>Aggiungi</button>
                </form>
            </details>
            <div id="events"></div>
        </section>

        <!-- Class: members, code, timetable -->
        <section id="tab-class" class="tab" hidden>
            <div class="card" id="class-info"></div>
            <div class="card" id="manage-box" hidden>
                <h2>Gestione</h2>
                <form id="settings-form" class="row">
                    <label>Ora del riassunto automatico <input type="time" name="summary_time" required></label>
                    <button>Salva</button>
                </form>
                <h3>Orario</h3>
                <p class="muted small">Per ogni giorno: gli orari della campanella e la materia di ogni ora. Le ore di fila della
                    stessa materia diventano una lezione sola. "Etichetta" serve a distinguere, per esempio, il laboratorio
                    ("Lab TPSIT") dalla teoria ("TPSIT"): gli appunti finiscono comunque nella stessa materia.</p>
                <div class="ai-read">
                    <label>Compila da foto o PDF: l'orario della classe e, se ce l'hai, quello della campanella (fino a 3 file)
                        <input type="file" id="tt-files" multiple accept="image/*,.pdf">
                    </label>
                    <button type="button" id="tt-read">Leggi l'orario</button>
                    <p class="muted small">L'AI riempie la tabella qui sotto: controlla e poi premi "Salva l'orario".</p>
                </div>
                <label>Valido dal <input type="date" id="tt-from"></label>
                <div id="tt-days"></div>
                <button id="tt-save">Salva l'orario</button>
            </div>
            <div class="card">
                <h2>Compagni</h2>
                <ul id="members" class="plain members"></ul>
                <button id="leave-btn" class="ghost">Esci dalla classe</button>
            </div>
            <div class="card">
                <h2>Altre classi</h2>
                <form id="join-form-2" class="row">
                    <input name="code" placeholder="Codice d'invito" autocomplete="off" required maxlength="20">
                    <button>Entra</button>
                </form>
                <button id="show-request" class="ghost">Chiedi una nuova classe</button>
            </div>
        </section>

        <!-- Admin: requests, switch, limits -->
        <section id="tab-admin" class="tab" hidden>
            <div class="card">
                <h2>Richieste di nuove classi</h2>
                <label class="switch"><input type="checkbox" id="requests-open"> Accetta nuove richieste</label>
                <ul id="admin-requests" class="plain"></ul>
            </div>
            <div class="card">
                <h2>Limiti di spazio (tutto il sito)</h2>
                <form id="limits-form" class="row">
                    <label>MB per file <input type="number" name="file_mb" min="1" max="95" required></label>
                    <label>MB per classe <input type="number" name="class_mb" min="1" required></label>
                    <button>Salva</button>
                </form>
            </div>
            <div class="card">
                <h2>Tutte le classi</h2>
                <ul id="admin-classes" class="plain"></ul>
            </div>
        </section>
    </main>

    <footer class="foot">
        <a href="privacy.php">Privacy</a>
        <a href="../index.php">Torna al sito</a>
    </footer>
</body>
</html>
