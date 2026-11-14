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
$v = filemtime(__DIR__ . '/../js/appunti.js') . '-' . filemtime(__DIR__ . '/../js/appunti-common.js') . '-' . filemtime(__DIR__ . '/../css/appunti.css') . '-' . filemtime(__DIR__ . '/../js/dropzone.js') . '-' . filemtime(__DIR__ . '/../js/appunti-upload.js') . '-' . filemtime(__DIR__ . '/../js/appunti-classifica.js') . '-' . filemtime(__DIR__ . '/../css/dropzone.css')
    . '-' . filemtime(__DIR__ . '/../js/appunti-calendario.js') . '-' . filemtime(__DIR__ . '/../js/appunti-bacheca.js');
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
    <link rel="stylesheet" href="../css/dropzone.css?v=<?= $e($v) ?>">
    <link rel="manifest" href="../assets/appunti/manifest.json?v=1">
    <link rel="icon" href="../assets/appunti/icon.svg?v=1" type="image/svg+xml">
    <link rel="apple-touch-icon" href="../assets/appunti/apple-touch-icon.png?v=1">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-title" content="Appunti">
    <script src="../js/csrf.js?v=<?= $e($v) ?>"></script>
    <script src="../js/appunti-common.js?v=<?= $e($v) ?>" defer></script>
    <script src="../js/dropzone.js?v=<?= $e($v) ?>" defer></script>
    <script src="../js/appunti-upload.js?v=<?= $e($v) ?>" defer></script>
    <script src="../js/appunti.js?v=<?= $e($v) ?>" defer></script>
    <script src="../js/appunti-calendario.js?v=<?= $e($v) ?>" defer></script>
    <script src="../js/appunti-bacheca.js?v=<?= $e($v) ?>" defer></script>
    <script src="../js/appunti-classifica.js?v=<?= $e($v) ?>" defer></script>
</head>
<body>
    <header class="top">
        <a class="home" href="../index.php">vector-box</a>
        <span class="top-right">
            <a class="top-btn needs-class" href="appunti-archivio.php">Archivio</a>
            <a class="top-btn primary ico-up needs-class" href="appunti-carica.php">Carica</a>
            <a class="top-btn hide-phone" href="appunti-guida.php">Guida</a>
            <span class="who hide-phone"><?= $e($username) ?></span>
            <a id="bell" class="bell" href="appunti-impostazioni.php" aria-label="Impostazioni e notifiche" title="Impostazioni e notifiche">
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>
                <span id="bell-count" class="bell-count" hidden></span>
            </a>
        </span>
    </header>

    <main class="wrap">
        <h1 class="sr">Appunti di classe</h1>
        <p id="status" class="status" role="status" aria-live="polite"></p>


        <!-- No class yet: join with a code or ask for a new class -->
        <section id="welcome" class="card" hidden>
            <h2>Entra nella tua classe</h2>
            <p class="muted">Chiedi il codice d'invito al rappresentante della classe.</p>
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
            <button data-tab="class">Classe</button>
            <button data-tab="board" aria-selected="true">Bacheca</button>
            <button data-tab="calendar">Calendario</button>
            <button data-tab="study">Studio</button>
            <button data-tab="score">Classifica</button>
            <button data-tab="material">Materiale</button>
            <button data-tab="admin" hidden>Admin</button>
        </nav>

        <!-- Material -->
        <!-- Board: now, announcements, the week, what is waiting for you -->
        <section id="tab-board" class="tab" hidden>
            <div id="bb-now" aria-live="polite"></div>
            <div class="bb-cols">
                <div class="bb-col-main">
                    <div id="bb-week" class="bb-block"></div>
                </div>
                <div class="bb-col-side">
                    <div id="bb-you" class="bb-block" hidden></div>
                    <div id="bb-notes" class="bb-block"></div>
                    <div id="bb-fix" class="bb-block" hidden></div>
                </div>
            </div>
        </section>

        <!-- Scoreboard -->
        <section id="tab-score" class="tab" hidden>
            <div id="sc-box"></div>
        </section>

        <section id="tab-material" class="tab" hidden>
            <div class="card cta-card">
                <div>
                    <b>Hai appunti, foto o slide di una lezione?</b>
                    <span class="muted small">Foto dal telefono, file, testo copiato da un'AI: tutto dalla pagina Carica.</span>
                </div>
                <div class="row-actions">
                    <a class="btn-link ico-up" id="upload-link" href="appunti-carica.php">Carica</a>
                    <a class="ghost-link" href="appunti-archivio.php">Archivio</a>
                </div>
            </div>

            <div class="filters row">
                <select id="filter-subject" aria-label="Materia"><option value="">Tutte le materie</option></select>
                <select id="filter-kind" aria-label="Tipo"><option value="">Tutti i tipi</option></select>
                <span id="subject-menu"></span>
            </div>
            <div id="items"></div>
        </section>

        <!-- Study: AI documents -->
        <section id="tab-study" class="tab" hidden>
            <div id="study-list">
                <div class="card ai-bar" id="ai-bar"></div>
                <div class="card review-box" id="review-box" hidden></div>
                <details class="card fold" id="custom-quiz">
                    <summary>Quiz su misura</summary>
                    <form id="cq-form" class="stack">
                        <div class="grid2">
                            <label>Materia <select name="subject_id"></select></label>
                            <label>Quante domande
                                <select name="n"><option>10</option><option>20</option><option>30</option><option>50</option></select>
                            </label>
                        </div>
                        <div class="grid2">
                            <label>Tipo
                                <select name="type"><option value="mc">Scelta multipla</option><option value="tf">Vero o falso</option><option value="mix">Tutti e due</option></select>
                            </label>
                            <label>Da dove
                                <select name="from"><option value="all">Tutte le domande</option><option value="prof">Quelle fatte dal prof</option><option value="wrong">Quelle che sbagli</option></select>
                            </label>
                        </div>
                        <p class="muted small">Pesca a caso dai quiz della classe, più spesso le domande del prof e quelle che sbagli. Le risposte sbagliate finiscono nel ripasso di ogni giorno.</p>
                        <button>Crea il quiz</button>
                    </form>
                </details>
                <details class="card fold" id="asked-box">
                    <summary>Domande fatte in classe</summary>
                    <div class="row asked-tools">
                        <select id="asked-subject" aria-label="Materia"></select>
                        <span id="asked-menu"></span>
                    </div>
                    <div id="asked-list"></div>
                </details>
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
                    <button id="doc-back" class="ghost mini back-btn">Indietro</button>
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
            <details class="card" id="event-box">
                <summary id="event-summary">Aggiungi una verifica o un'interrogazione</summary>
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
                    <fieldset class="period-box" id="event-topics" hidden></fieldset>
                    <fieldset class="period-box">
                        <legend>Materiale da studiare (facoltativo)</legend>
                        <p class="muted small">Di solito è tutto quello dopo la verifica precedente della stessa materia. Se l'argomento è
                            cominciato prima, o nel frattempo ne avete iniziato un altro, scegli i giorni: l'AI userà solo quelle lezioni.</p>
                        <div class="grid2">
                            <label>Dal <input type="date" name="period_from"></label>
                            <label>Al <input type="date" name="period_to"></label>
                        </div>
                    </fieldset>
                    <div class="row">
                        <button id="event-submit">Aggiungi</button>
                        <button type="button" id="event-cancel" class="ghost" hidden>Annulla la modifica</button>
                    </div>
                </form>
            </details>
            <div id="cal-tools" class="row cal-tools"></div>
            <div class="cal-view row" id="cal-view"></div>
            <div id="cal-month"></div>
            <h3 class="section-title" id="agenda-title">Agenda</h3>
            <div id="events"></div>
            <div id="cal-topics"></div>
        </section>

        <!-- Class: members, code, timetable -->
        <section id="tab-class" class="tab" hidden>
            <div class="card" id="tt-card">
                <h2>Orario</h2>
                <div id="tt-days"></div>
                <p class="muted small tt-manage">Come l'orario stampato: tocca una casella per cambiare materia, aula e orari. Le ore di fila della
                    stessa materia diventano una lezione sola (il laboratorio scrivilo con lo stesso nome della materia).</p>
                <div class="tt-manage">
                <label>Valido dal <input type="date" id="tt-from"></label>
                <button id="tt-save">Salva l'orario</button>
                <details class="ai-read-box">
                <summary>Compila da una foto o un PDF con l'AI</summary>
                <div class="ai-read">
                    <label>Compila da foto o PDF: l'orario della classe e, se ce l'hai, quello della campanella (fino a 3 file)
                        <input type="file" id="tt-files" multiple accept="image/*,.pdf">
                    </label>
                    <button type="button" id="tt-read">Leggi l'orario</button>
                    <p class="muted small">L'AI riempie la tabella qui sopra: controlla e poi premi "Salva l'orario".</p>
                </div>
                </details>
                </div>
            </div>
            <p id="admin-note" class="admin-note" hidden>Stai guardando questa classe come amministratore del sito: non ne fai parte.</p>
            <details class="card fold" id="members-fold">
                <summary>Compagni</summary>
                <ul id="members" class="plain members"></ul>
                <button id="leave-btn" class="ghost">Esci dalla classe</button>
            </details>
            <details class="card fold" id="rep-panel" hidden>
                <summary>Pannello del rappresentante</summary>
                <div class="card" id="roles-card" hidden>
                    <div class="card-head"><h3>Ruoli</h3><button type="button" id="role-new" class="ghost mini">+ Nuovo ruolo</button></div>
                    <p class="muted small">Il rappresentante può fare tutto. Gli altri fanno quello che permette il loro ruolo, più i
                        permessi dati a loro personalmente (dal menu ⋯ accanto al nome). Chi non ha un ruolo non ha etichette.</p>
                    <ul id="roles" class="plain roles"></ul>
                </div>
                <div class="card" id="subjects-card" hidden>
                    <h3>Materie</h3>
                    <p class="muted small">Due materie che sono la stessa cosa? Uniscile dal menu ⋯: il materiale, il calendario e le ore
                        dell'orario passano all'altra. Una materia vuota si può eliminare.</p>
                    <ul id="subjects" class="plain subjects-list"></ul>
                </div>
            </details>
            <select id="class-select" aria-label="Classe" hidden></select>
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
