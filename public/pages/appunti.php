<?php
// public/pages/appunti.php — shared class notes: material per subject and lesson, calendar of tests,
// class management (manager) and class requests (admin). Logged-in users only; data from api/classi.php
// and api/appunti.php, rendered by js/appunti.js with textContent only.
require_once __DIR__ . '/../includes/head.php';
require_once __DIR__ . '/../includes/appunti-top.php';
require_once __DIR__ . '/../api/database.php';

initSession(true);
if (empty($_SESSION['csrf_token'])) $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
$csrf = $_SESSION['csrf_token'];
$isGuest = empty($_SESSION['user_id']);     // no account: only the example class can be looked at
$username = $isGuest ? '' : (string)$_SESSION['username'];
$isAdmin = !empty($_SESSION['is_admin']);
session_write_close();

$e = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES);
$v = filemtime(__DIR__ . '/../js/appunti.js') . '-' . filemtime(__DIR__ . '/../js/appunti-common.js') . '-' . filemtime(__DIR__ . '/../css/appunti.css') . '-' . filemtime(__DIR__ . '/../js/dropzone.js') . '-' . filemtime(__DIR__ . '/../js/appunti-upload.js') . '-' . filemtime(__DIR__ . '/../js/appunti-classifica.js') . '-' . filemtime(__DIR__ . '/../css/dropzone.css')
    . '-' . filemtime(__DIR__ . '/../js/appunti-calendario.js') . '-' . filemtime(__DIR__ . '/../js/appunti-bacheca.js');
$v .= '-' . filemtime(__DIR__ . '/../js/csrf.js');   // the cache buster covers csrf.js too (the files are cached for a year)
$v .= '-' . filemtime(__DIR__ . '/../js/i18n.js') . '-' . filemtime(__DIR__ . '/../js/i18n/appunti-en.js') . '-' . filemtime(__DIR__ . '/../js/i18n/appunti-it.js');   // the translations are inside the cache buster too
?>
<!DOCTYPE html>
<html lang="<?= pageLang() ?>" data-lang-server>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#14161b">
    <meta name="robots" content="noindex">
    <title><?= tr(['en' => 'Class notes — vector-box', 'it' => 'Appunti di classe — vector-box']) ?></title>
    <link rel="stylesheet" href="../css/appunti.css?v=<?= $e($v) ?>">
    <link rel="stylesheet" href="../css/dropzone.css?v=<?= $e($v) ?>">
    <link rel="manifest" href="../assets/appunti/manifest.json?v=1">
    <link rel="icon" href="../assets/appunti/icon.svg?v=1" type="image/svg+xml">
    <link rel="apple-touch-icon" href="../assets/appunti/apple-touch-icon.png?v=1">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-title" content="<?= $e(tr(['en' => 'Class notes', 'it' => 'Appunti'])) ?>">
    <script src="../js/i18n.js?v=<?= $e($v) ?>"></script>
    <script src="../js/i18n/appunti-en.js?v=<?= $e($v) ?>"></script>
    <script src="../js/i18n/appunti-it.js?v=<?= $e($v) ?>"></script>
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
    <?php appuntiTop('appunti', $username); ?>

    <main class="wrap">
        <h1 class="sr"><?= tr(['en' => 'Class notes', 'it' => 'Appunti di classe']) ?></h1>
        <p id="status" class="status" role="status" aria-live="polite"></p>


        <!-- The example class: invented data, read-only -->
        <p id="demo-banner" class="demo-banner" hidden>
            <?= tr(['en' => '<span><b>Example class.</b> Timetable, tests, notes and documents are made up, to show what Class notes does. You can look at everything and try the quizzes, but not change anything.</span>', 'it' => '<span><b>Classe di esempio.</b> Orario, verifiche, appunti e documenti sono inventati, per far vedere cosa fanno gli Appunti. Puoi guardare tutto e provare i quiz, ma non modificare.</span>']) ?>
            <button type="button" id="demo-close" class="ghost mini"><?= tr(['en' => 'Close the example', 'it' => 'Chiudi l\'esempio']) ?></button>
        </p>

        <!-- No class yet: join with a code or ask for a new class -->
        <section id="welcome" class="card" hidden>
            <p id="guest-note" class="muted" hidden><?= tr(['en' => 'To use Class notes with your class you need a free account: <a href="login.php">sign in or sign up</a>. Meanwhile you can look at the example class.', 'it' => 'Per usare gli Appunti con la tua classe serve un account gratuito: <a href="login.php">accedi o registrati</a>. Intanto puoi guardare la classe di esempio.']) ?></p>
            <h2><?= tr(['en' => 'Join your class', 'it' => 'Entra nella tua classe']) ?></h2>
            <p class="muted"><?= tr(['en' => 'If your class already exists, ask the class representative for the invite code. <strong>If it does not exist yet, you can ask for it:</strong> just give the name of the class and of the school, the administrator approves it and you become its representative.', 'it' => 'Se la tua classe c\'è già, chiedi il codice d\'invito al rappresentante. <strong>Se non c\'è ancora, puoi chiederla tu:</strong> di\' solo il nome della classe e della scuola, l\'amministratore la approva e tu ne diventi il rappresentante.']) ?></p>
            <form id="join-form" class="row">
                <input name="code" placeholder="<?= $e(tr(['en' => 'Code (e.g. K7QM-2XPA)', 'it' => 'Codice (es. K7QM-2XPA)'])) ?>" autocomplete="off" required maxlength="20">
                <button><?= tr(['en' => 'Join', 'it' => 'Entra']) ?></button>
            </form>
            <details id="request-box" open>
                <summary><?= tr(['en' => 'Your class is not there? Ask for it', 'it' => 'La tua classe non c\'è? Chiedila']) ?></summary>
                <form id="request-form" class="stack">
                    <input name="name" placeholder="<?= $e(tr(['en' => 'Class (e.g. 5B-I)', 'it' => 'Classe (es. 5B-I)'])) ?>" required maxlength="40">
                    <input name="school" placeholder="<?= $e(tr(['en' => 'School', 'it' => 'Scuola'])) ?>" required maxlength="100">
                    <textarea name="note" placeholder="<?= $e(tr(['en' => 'Notes for the administrator (optional)', 'it' => 'Note per l\'amministratore (facoltative)'])) ?>" maxlength="300" rows="2"></textarea>
                    <label class="check-row"><input type="checkbox" name="adults"> <span><?= tr(['en' => 'All the students of the class are of age (18 or older)', 'it' => 'Tutti gli studenti della classe sono maggiorenni (18 anni compiuti)']) ?></span></label>
                    <p class="muted small"><?= tr(['en' => 'If you tick it, Google\'s AI can summarise the class notes. If you do not, the AI stays off: the class representative can turn it on later in the settings, when everyone is of age. Notes can be uploaded and read anyway.', 'it' => 'Se lo spunti, l\'AI di Google può riassumere gli appunti della classe. Se non lo spunti, l\'AI resta spenta: il rappresentante potrà accenderla più avanti nelle impostazioni, quando tutti saranno maggiorenni. Gli appunti si possono caricare e leggere comunque.']) ?></p>
                    <button><?= tr(['en' => 'Send the request', 'it' => 'Invia la richiesta']) ?></button>
                </form>
                <p id="requests-closed" class="muted" hidden><?= tr(['en' => 'Requests for new classes are closed at the moment.', 'it' => 'Le richieste di nuove classi sono chiuse in questo momento.']) ?></p>
            </details>
            <ul id="my-requests" class="plain"></ul>
            <div id="demo-offer" class="demo-offer" hidden>
                <p class="muted"><?= tr(['en' => 'Want to see how it works first? Look at an example class, with a made-up timetable, tests, notes and quizzes.', 'it' => 'Vuoi prima vedere come funziona? Guarda una classe di esempio, con orario, verifiche, appunti e quiz inventati.']) ?></p>
                <button type="button" id="demo-open" class="ghost"><?= tr(['en' => 'Look at the example class', 'it' => 'Guarda la classe di esempio']) ?></button>
            </div>
        </section>

        <nav id="tabs" class="tabs" hidden>
            <button data-tab="class"><?= tr(['en' => 'Class', 'it' => 'Classe']) ?></button>
            <button data-tab="board" aria-selected="true"><?= tr(['en' => 'Board', 'it' => 'Bacheca']) ?></button>
            <button data-tab="calendar"><?= tr(['en' => 'Calendar', 'it' => 'Calendario']) ?></button>
            <button data-tab="study"><?= tr(['en' => 'Study', 'it' => 'Studio']) ?></button>
            <button data-tab="score"><?= tr(['en' => 'Leaderboard', 'it' => 'Classifica']) ?></button>
            <button data-tab="material"><?= tr(['en' => 'Material', 'it' => 'Materiale']) ?></button>
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
                    <div id="bb-missing" class="bb-block" hidden></div>
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
                    <b><?= tr(['en' => 'Do you have notes, photos or slides of a lesson?', 'it' => 'Hai appunti, foto o slide di una lezione?']) ?></b>
                    <span class="muted small"><?= tr(['en' => 'Photos from the phone, files, text copied from an AI: everything from the Upload page.', 'it' => 'Foto dal telefono, file, testo copiato da un\'AI: tutto dalla pagina Carica.']) ?></span>
                </div>
                <div class="row-actions">
                    <a class="btn-link ico-up" id="upload-link" href="appunti-carica.php"><?= tr(['en' => 'Upload', 'it' => 'Carica']) ?></a>
                    <a class="ghost-link" href="appunti-archivio.php"><?= tr(['en' => 'Archive', 'it' => 'Archivio']) ?></a>
                </div>
            </div>

            <div class="filters row">
                <select id="filter-subject" aria-label="<?= $e(tr(['en' => 'Subject', 'it' => 'Materia'])) ?>"><option value=""><?= tr(['en' => 'All subjects', 'it' => 'Tutte le materie']) ?></option></select>
                <select id="filter-kind" aria-label="<?= $e(tr(['en' => 'Type', 'it' => 'Tipo'])) ?>"><option value=""><?= tr(['en' => 'All types', 'it' => 'Tutti i tipi']) ?></option></select>
                <select id="filter-topic" aria-label="<?= $e(tr(['en' => 'Topic', 'it' => 'Argomento'])) ?>" hidden><option value=""><?= tr(['en' => 'All topics', 'it' => 'Tutti gli argomenti']) ?></option></select>
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
                    <summary><?= tr(['en' => 'Custom quiz', 'it' => 'Quiz su misura']) ?></summary>
                    <form id="cq-form" class="stack">
                        <div class="grid2">
                            <label><?= tr(['en' => 'Subject', 'it' => 'Materia']) ?> <select name="subject_id"></select></label>
                            <label><?= tr(['en' => 'How many questions', 'it' => 'Quante domande']) ?>
                                <select name="n"><option>10</option><option>20</option><option>30</option><option>50</option></select>
                            </label>
                        </div>
                        <div class="grid2">
                            <label><?= tr(['en' => 'Type', 'it' => 'Tipo']) ?>
                                <select name="type"><option value="mc"><?= tr(['en' => 'Multiple choice', 'it' => 'Scelta multipla']) ?></option><option value="tf"><?= tr(['en' => 'True or false', 'it' => 'Vero o falso']) ?></option><option value="mix"><?= tr(['en' => 'Both', 'it' => 'Tutti e due']) ?></option></select>
                            </label>
                            <label><?= tr(['en' => 'From where', 'it' => 'Da dove']) ?>
                                <select name="from"><option value="all"><?= tr(['en' => 'All the questions', 'it' => 'Tutte le domande']) ?></option><option value="prof"><?= tr(['en' => 'The ones asked by the teacher', 'it' => 'Quelle fatte dal prof']) ?></option><option value="wrong"><?= tr(['en' => 'The ones you get wrong', 'it' => 'Quelle che sbagli']) ?></option></select>
                            </label>
                        </div>
                        <p class="muted small"><?= tr(['en' => 'Picks at random from the class quizzes, more often the teacher\'s questions and the ones you get wrong. Wrong answers end up in the daily review.', 'it' => 'Pesca a caso dai quiz della classe, più spesso le domande del prof e quelle che sbagli. Le risposte sbagliate finiscono nel ripasso di ogni giorno.']) ?></p>
                        <button><?= tr(['en' => 'Create the quiz', 'it' => 'Crea il quiz']) ?></button>
                    </form>
                </details>
                <details class="card fold" id="asked-box">
                    <summary><?= tr(['en' => 'Questions asked in class', 'it' => 'Domande fatte in classe']) ?></summary>
                    <div class="row asked-tools">
                        <select id="asked-subject" aria-label="<?= $e(tr(['en' => 'Subject', 'it' => 'Materia'])) ?>"></select>
                        <span id="asked-menu"></span>
                    </div>
                    <div id="asked-list"></div>
                </details>
                <h2 class="section-title"><?= tr(['en' => 'Upcoming written tests and oral exams', 'it' => 'Verifiche e interrogazioni in arrivo']) ?></h2>
                <div id="study-tests"></div>
                <div class="card cta-card">
                    <div>
                        <b><?= tr(['en' => 'Did you make a summary with ChatGPT, Gemini or Claude?', 'it' => 'Hai fatto un riassunto con ChatGPT, Gemini o Claude?']) ?></b>
                        <span class="muted small"><?= tr(['en' => 'Download the "Per AI" file of a test, give it to the AI and upload the answer here.', 'it' => 'Scarica il file "Per AI" di una verifica, dallo all\'AI e carica qui la risposta.']) ?></span>
                    </div>
                    <a class="ghost-link" id="doc-upload-link" href="appunti-carica.php?m=ai"><?= tr(['en' => '+ Upload a document', 'it' => '+ Carica un documento']) ?></a>
                </div>
                <h2 class="section-title"><?= tr(['en' => 'Lesson notes', 'it' => 'Appunti delle lezioni']) ?></h2>
                <div class="filters row">
                    <select id="study-subject" aria-label="<?= $e(tr(['en' => 'Subject', 'it' => 'Materia'])) ?>"><option value=""><?= tr(['en' => 'All subjects', 'it' => 'Tutte le materie']) ?></option></select>
                </div>
                <div id="study-lessons"></div>
            </div>
            <article id="doc-view" class="doc-view" hidden>
                <div class="doc-tools no-print">
                    <button id="doc-back" class="ghost mini back-btn"><?= tr(['en' => 'Back', 'it' => 'Indietro']) ?></button>
                    <span class="spacer"></span>
                    <span id="doc-full-slot"></span>
                    <button id="doc-share" class="ghost mini"><?= tr(['en' => 'Share', 'it' => 'Condividi']) ?></button>
                    <button id="doc-download" class="ghost mini"><?= tr(['en' => 'Download', 'it' => 'Scarica']) ?></button>
                    <button id="doc-print" class="ghost mini"><?= tr(['en' => 'Print / PDF', 'it' => 'Stampa / PDF']) ?></button>
                </div>
                <h2 id="doc-title"></h2>
                <p id="doc-meta" class="muted small"></p>
                <div id="doc-body" class="md"></div>
                <details id="doc-sources" class="no-print"><summary><?= tr(['en' => 'Where it comes from', 'it' => 'Da dove viene']) ?></summary><ol id="doc-sources-list"></ol></details>
                <p class="muted small ai-note"><?= tr(['en' => 'Written by an AI from the uploaded material: it may be wrong, always check with the book and the original notes.', 'it' => 'Scritto da un\'AI a partire dal materiale caricato: può sbagliare, controlla sempre con il libro e gli appunti originali.']) ?></p>
            </article>
        </section>

        <!-- Calendar -->
        <section id="tab-calendar" class="tab" hidden>
            <details class="card" id="event-box">
                <summary id="event-summary"><?= tr(['en' => 'Add a written test or an oral exam', 'it' => 'Aggiungi una verifica o un\'interrogazione']) ?></summary>
                <form id="event-form" class="stack">
                    <div class="grid2">
                        <label><?= tr(['en' => 'Type', 'it' => 'Tipo']) ?>
                            <select name="kind">
                                <option value="verifica"><?= tr(['en' => 'Written test', 'it' => 'Verifica scritta']) ?></option>
                                <option value="interrogazione"><?= tr(['en' => 'Oral exam', 'it' => 'Interrogazione']) ?></option>
                                <option value="altro"><?= tr(['en' => 'Other', 'it' => 'Altro']) ?></option>
                            </select>
                        </label>
                        <label><?= tr(['en' => 'Day', 'it' => 'Giorno']) ?> <input type="date" name="date" required></label>
                    </div>
                    <label><?= tr(['en' => 'Subject', 'it' => 'Materia']) ?> <select name="subject_id" required></select></label>
                    <label><?= tr(['en' => 'Title (optional)', 'it' => 'Titolo (facoltativo)']) ?> <input name="title" maxlength="120"></label>
                    <label><?= tr(['en' => 'Topics the teacher mentioned', 'it' => 'Argomenti detti dal prof']) ?> <textarea name="topics" rows="3" maxlength="2000"></textarea></label>
                    <fieldset class="period-box" id="event-topics" hidden></fieldset>
                    <fieldset class="period-box">
                        <legend><?= tr(['en' => 'Material to study (optional)', 'it' => 'Materiale da studiare (facoltativo)']) ?></legend>
                        <p class="muted small"><?= tr(['en' => 'Usually it is everything after the previous test of the same subject. If the topic started earlier, or you started another one in the meantime, choose the days: the AI will only use those lessons.', 'it' => 'Di solito è tutto quello dopo la verifica precedente della stessa materia. Se l\'argomento è cominciato prima, o nel frattempo ne avete iniziato un altro, scegli i giorni: l\'AI userà solo quelle lezioni.']) ?></p>
                        <div class="grid2">
                            <label><?= tr(['en' => 'From', 'it' => 'Dal']) ?> <input type="date" name="period_from"></label>
                            <label><?= tr(['en' => 'To', 'it' => 'Al']) ?> <input type="date" name="period_to"></label>
                        </div>
                    </fieldset>
                    <div class="row">
                        <button id="event-submit"><?= tr(['en' => 'Add', 'it' => 'Aggiungi']) ?></button>
                        <button type="button" id="event-cancel" class="ghost" hidden><?= tr(['en' => 'Cancel the change', 'it' => 'Annulla la modifica']) ?></button>
                    </div>
                </form>
            </details>
            <div id="cal-tools" class="row cal-tools"></div>
            <div class="cal-view row" id="cal-view"></div>
            <div id="cal-month"></div>
            <h3 class="section-title" id="agenda-title"><?= tr(['en' => 'Agenda', 'it' => 'Agenda']) ?></h3>
            <div id="events"></div>
            <div id="cal-topics"></div>
        </section>

        <!-- Class: members, code, timetable -->
        <section id="tab-class" class="tab" hidden>
            <div class="card" id="tt-card">
                <h2><?= tr(['en' => 'Timetable', 'it' => 'Orario']) ?></h2>
                <div id="tt-days"></div>
                <p class="muted small tt-manage"><?= tr(['en' => 'Like the printed timetable: tap a box to change subject, room and times. Consecutive periods of the same subject become one single lesson (write the lab with the same name as the subject).', 'it' => 'Come l\'orario stampato: tocca una casella per cambiare materia, aula e orari. Le ore di fila della stessa materia diventano una lezione sola (il laboratorio scrivilo con lo stesso nome della materia).']) ?></p>
                <div class="tt-manage">
                <label><?= tr(['en' => 'Valid from', 'it' => 'Valido dal']) ?> <input type="date" id="tt-from"></label>
                <button id="tt-save"><?= tr(['en' => 'Save the timetable', 'it' => 'Salva l\'orario']) ?></button>
                <details class="ai-read-box">
                <summary><?= tr(['en' => 'Fill in from a photo or a PDF with the AI', 'it' => 'Compila da una foto o un PDF con l\'AI']) ?></summary>
                <div class="ai-read">
                    <label><?= tr(['en' => 'Fill in from photos or PDFs: the class timetable and, if you have it, the bell schedule (up to 3 files)', 'it' => 'Compila da foto o PDF: l\'orario della classe e, se ce l\'hai, quello della campanella (fino a 3 file)']) ?>
                        <input type="file" id="tt-files" multiple accept="image/*,.pdf">
                    </label>
                    <button type="button" id="tt-read"><?= tr(['en' => 'Read the timetable', 'it' => 'Leggi l\'orario']) ?></button>
                    <p class="muted small"><?= tr(['en' => 'The AI fills in the table above: check it and then press "Save the timetable".', 'it' => 'L\'AI riempie la tabella qui sopra: controlla e poi premi "Salva l\'orario".']) ?></p>
                </div>
                </details>
                </div>
            </div>
            <p id="admin-note" class="admin-note" hidden><?= tr(['en' => 'You are looking at this class as the site administrator: you are not part of it.', 'it' => 'Stai guardando questa classe come amministratore del sito: non ne fai parte.']) ?></p>
            <details class="card fold" id="members-fold">
                <summary><?= tr(['en' => 'Classmates', 'it' => 'Compagni']) ?></summary>
                <ul id="members" class="plain members"></ul>
                <button id="leave-btn" class="ghost"><?= tr(['en' => 'Leave the class', 'it' => 'Esci dalla classe']) ?></button>
            </details>
            <details class="card fold" id="rep-panel" hidden>
                <summary><?= tr(['en' => 'Class representative panel', 'it' => 'Pannello del rappresentante']) ?></summary>
                <div class="card" id="roles-card" hidden>
                    <div class="card-head"><h3><?= tr(['en' => 'Roles', 'it' => 'Ruoli']) ?></h3><button type="button" id="role-new" class="ghost mini"><?= tr(['en' => '+ New role', 'it' => '+ Nuovo ruolo']) ?></button></div>
                    <p class="muted small"><?= tr(['en' => 'The representative can do everything. The others do what their role allows, plus the permissions given to them personally (from the ⋯ menu next to the name). Whoever has no role has no labels.', 'it' => 'Il rappresentante può fare tutto. Gli altri fanno quello che permette il loro ruolo, più i permessi dati a loro personalmente (dal menu ⋯ accanto al nome). Chi non ha un ruolo non ha etichette.']) ?></p>
                    <ul id="roles" class="plain roles"></ul>
                </div>
                <div class="card" id="log-card" hidden>
                    <h3><?= tr(['en' => 'Change log', 'it' => 'Registro delle modifiche']) ?></h3>
                    <details id="log-details">
                        <summary><?= tr(['en' => 'Who changed or deleted what (last 100)', 'it' => 'Chi ha cambiato o eliminato cosa (ultime 100)']) ?></summary>
                        <ul id="log-list" class="plain log-list"></ul>
                    </details>
                </div>
                <div class="card" id="subjects-card" hidden>
                    <h3><?= tr(['en' => 'Subjects', 'it' => 'Materie']) ?></h3>
                    <p class="muted small"><?= tr(['en' => 'Two subjects that are the same thing? Merge them from the ⋯ menu: the material, the calendar and the timetable hours move to the other one. An empty subject can be deleted.', 'it' => 'Due materie che sono la stessa cosa? Uniscile dal menu ⋯: il materiale, il calendario e le ore dell\'orario passano all\'altra. Una materia vuota si può eliminare.']) ?></p>
                    <ul id="subjects" class="plain subjects-list"></ul>
                </div>
            </details>
            <select id="class-select" aria-label="<?= $e(tr(['en' => 'Class', 'it' => 'Classe'])) ?>" hidden></select>
        </section>

        <!-- Admin: requests, switch, limits -->
        <section id="tab-admin" class="tab" hidden>
            <div class="card">
                <h2><?= tr(['en' => 'Requests for new classes', 'it' => 'Richieste di nuove classi']) ?></h2>
                <label class="switch"><input type="checkbox" id="requests-open"> <?= tr(['en' => 'Accept new requests', 'it' => 'Accetta nuove richieste']) ?></label>
                <ul id="admin-requests" class="plain"></ul>
            </div>
            <div class="card">
                <h2><?= tr(['en' => 'Space limits (the whole site)', 'it' => 'Limiti di spazio (tutto il sito)']) ?></h2>
                <form id="limits-form" class="row">
                    <label><?= tr(['en' => 'MB per file', 'it' => 'MB per file']) ?> <input type="number" name="file_mb" min="1" max="95" required></label>
                    <label><?= tr(['en' => 'MB per class', 'it' => 'MB per classe']) ?> <input type="number" name="class_mb" min="1" required></label>
                    <label><?= tr(['en' => 'Files per upload', 'it' => 'File per invio']) ?> <input type="number" name="files" min="1" max="100" required></label>
                    <label><?= tr(['en' => 'Uploads per hour per person', 'it' => 'Invii all\'ora per persona']) ?> <input type="number" name="per_hour" min="10" max="3000" required></label>
                    <label><?= tr(['en' => 'Unfinished uploads per person', 'it' => 'Invii non finiti per persona']) ?> <input type="number" name="open" min="5" max="200" required></label>
                    <button><?= tr(['en' => 'Save', 'it' => 'Salva']) ?></button>
                </form>
            </div>
            <div class="card">
                <h2><?= tr(['en' => 'All classes', 'it' => 'Tutte le classi']) ?></h2>
                <ul id="admin-classes" class="plain"></ul>
            </div>
        </section>
    </main>

    <footer class="foot">
        <a href="privacy.php"><?= tr(['en' => 'Privacy', 'it' => 'Privacy']) ?></a>
        <a href="sicurezza.php"><?= tr(['en' => 'Security', 'it' => 'Sicurezza']) ?></a>
        <a href="../index.php"><?= tr(['en' => 'Back to the site', 'it' => 'Torna al sito']) ?></a>
    </footer>
</body>
</html>
