<?php
// public/pages/appunti.php — shared class notes: material per subject and lesson, calendar of tests,
// class management (manager) and class requests (admin). Logged-in users only; data from api/classi.php
// and api/appunti.php, rendered by js/appunti.js with textContent only.
require_once __DIR__ . '/../includes/head.php';
require_once __DIR__ . '/../api/database.php';

initSession(true);
if (empty($_SESSION['user_id'])) {
    session_write_close();
    header('Location: login.php?next=appunti.php');
    exit();
}
if (empty($_SESSION['csrf_token'])) $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
$csrf = $_SESSION['csrf_token'];
$username = (string)$_SESSION['username'];
$isAdmin = !empty($_SESSION['is_admin']);
session_write_close();

$e = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES);
$v = filemtime(__DIR__ . '/../js/appunti.js') . '-' . filemtime(__DIR__ . '/../css/appunti.css');
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
    <script>window.SESSION_STATE = { csrfToken: <?= json_encode($csrf) ?>, username: <?= json_encode($username) ?>, isAdmin: <?= $isAdmin ? 'true' : 'false' ?> };</script>
    <script src="../js/csrf.js?v=<?= $e($v) ?>"></script>
    <script src="../js/appunti.js?v=<?= $e($v) ?>" defer></script>
</head>
<body>
    <header class="top">
        <a class="home" href="../index.php">vector-box</a>
        <span class="who"><?= $e($username) ?></span>
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
            <button data-tab="calendar">Calendario</button>
            <button data-tab="class">Classe</button>
            <button data-tab="admin" hidden>Admin</button>
        </nav>

        <!-- Material -->
        <section id="tab-material" class="tab" hidden>
            <details class="card upload" open>
                <summary>Carica materiale</summary>
                <form id="upload-form" class="stack">
                    <div class="grid2">
                        <label>Tipo
                            <select name="kind">
                                <option value="appunti">Appunti</option>
                                <option value="slide">Slide / materiale del prof</option>
                                <option value="libro">Pagine del libro</option>
                                <option value="domande">Domande del prof (interrogazione)</option>
                                <option value="prova">Verifica di preparazione</option>
                                <option value="altro">Altro</option>
                            </select>
                        </label>
                        <label>Giorno <input type="date" name="lesson_date" required></label>
                    </div>
                    <label>Lezione / materia
                        <select name="lesson" required></select>
                    </label>
                    <label>File (foto, PDF, Word, PowerPoint, testo)
                        <input type="file" name="files" multiple accept="image/*,.pdf,.txt,.md,.docx,.pptx,.odt,.odp">
                    </label>
                    <p id="file-hint" class="muted small"></p>
                    <label>Titolo (facoltativo) <input name="title" maxlength="120"></label>
                    <label>Testo (facoltativo) <textarea name="body" rows="4" maxlength="50000" placeholder="Puoi anche scrivere gli appunti qui"></textarea></label>
                    <button id="upload-btn">Carica</button>
                    <p id="usage" class="muted small"></p>
                </form>
            </details>

            <div class="filters row">
                <select id="filter-subject" aria-label="Materia"><option value="">Tutte le materie</option></select>
                <select id="filter-kind" aria-label="Tipo"><option value="">Tutti i tipi</option></select>
            </div>
            <div id="items"></div>
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
