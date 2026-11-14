<?php
// public/pages/appunti-carica.php — every way to add material to a class in one page: take a photo, pick files
// (or drop them), write/paste text, upload a document made with another AI, timetable from a photo (manager).
// Uses api/appunti.php; logic in js/appunti-carica.js.
require_once __DIR__ . '/../includes/head.php';
require_once __DIR__ . '/../includes/appunti-top.php';
require_once __DIR__ . '/../api/database.php';

initSession();
if (empty($_SESSION['user_id'])) {
    header('Location: appunti-guida.php');
    exit();
}
$e = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES);
$v = filemtime(__DIR__ . '/../js/appunti-carica.js') . '-' . filemtime(__DIR__ . '/../js/appunti-common.js') . '-' . filemtime(__DIR__ . '/../js/dropzone.js') . '-' . filemtime(__DIR__ . '/../js/appunti-upload.js') . '-' . filemtime(__DIR__ . '/../js/appunti-prompts.js') . '-' . filemtime(__DIR__ . '/../css/dropzone.css') . '-' . filemtime(__DIR__ . '/../css/appunti.css');
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#14161b">
    <meta name="robots" content="noindex">
    <title>Carica — Appunti di classe</title>
    <link rel="stylesheet" href="../css/appunti.css?v=<?= $e($v) ?>">
    <link rel="stylesheet" href="../css/dropzone.css?v=<?= $e($v) ?>">
    <link rel="manifest" href="../assets/appunti/manifest.json?v=1">
    <link rel="icon" href="../assets/appunti/icon.svg?v=1" type="image/svg+xml">
    <script src="../js/csrf.js?v=<?= $e($v) ?>"></script>
    <script src="../js/appunti-common.js?v=<?= $e($v) ?>" defer></script>
    <script src="../js/dropzone.js?v=<?= $e($v) ?>" defer></script>
    <script src="../js/appunti-upload.js?v=<?= $e($v) ?>" defer></script>
    <script src="../js/appunti-prompts.js?v=<?= $e($v) ?>" defer></script>
    <script src="../js/appunti-carica.js?v=<?= $e($v) ?>" defer></script>
</head>
<body>
    <?php appuntiTop('carica'); ?>
    <div class="page-tools"><select id="class-select" aria-label="Classe" hidden></select></div>

    <main class="wrap upload-page">
        <h1>Carica</h1>
        <p id="status" class="status" role="status" aria-live="polite"></p>

        <div class="methods" role="tablist" aria-label="Come vuoi caricare">
            <button type="button" class="method" data-method="camera" role="tab"><span>📷</span>Scatta una foto<small>dal telefono</small></button>
            <button type="button" class="method" data-method="files" role="tab"><span>📁</span>Scegli file<small>foto, audio, PDF, Word, PowerPoint…</small></button>
            <button type="button" class="method" data-method="text" role="tab"><span>✍️</span>Scrivi o incolla<small>anche testo con **grassetto**</small></button>
            <button type="button" class="method" data-method="ai" role="tab"><span>🤖</span>Con un'altra AI<small>ChatGPT, Gemini, Claude: prompt e documenti</small></button>
            <button type="button" class="method" data-method="timetable" role="tab" hidden><span>🗓</span>Orario da foto<small>rappresentante o chi ha il permesso</small></button>
        </div>

        <!-- Where the material goes (photos, files, text) -->
        <section class="card" id="where" hidden>
            <h2>Di che lezione è?</h2>
            <div class="grid2">
                <label>Giorno <input type="date" id="w-date"></label>
                <label>Tipo
                    <select id="w-kind">
                        <option value="auto">Lo decide l'AI</option>
                        <option value="appunti">Appunti</option>
                        <option value="slide">Slide / materiale del prof</option>
                        <option value="libro">Pagine del libro</option>
                        <option value="domande">Domande del prof (interrogazione)</option>
                        <option value="prova">Verifica di preparazione</option>
                        <option value="altro">Altro</option>
                    </select>
                </label>
            </div>
            <label>Lezione / materia <select id="w-lesson"></select></label>
            <p id="w-hint" class="muted small"></p>
            <label>Titolo (facoltativo) <input id="w-title" maxlength="120"></label>
        </section>

        <section class="card panel" id="p-camera" hidden>
            <h2>📷 Scatta una foto</h2>
            <p class="muted small">Sul telefono si apre la fotocamera. Puoi farne più di una: si aggiungono qui sotto.</p>
            <label class="pick-big">Apri la fotocamera <input type="file" id="camera-input" accept="image/*" capture="environment"></label>
        </section>

        <section class="card panel" id="p-files" hidden>
            <h2>📁 Scegli file</h2>
            <label class="drop" id="drop">
                <input type="file" id="files-input" multiple accept="image/*,audio/*,.pdf,.txt,.md,.docx,.pptx,.odt,.odp,.mp3,.m4a,.aac,.wav,.ogg,.opus,.flac,.webm">
                <b>Trascina qui i file</b><span>o tocca per sceglierli</span>
                <small>Foto, registrazioni audio, PDF, Word, PowerPoint, LibreOffice, testo · fino a 20 alla volta</small>
            </label>
        </section>

        <section class="card panel" id="p-text" hidden>
            <h2>✍️ Scrivi o incolla</h2>
            <p class="muted small">Va bene anche il testo copiato da ChatGPT o Gemini: <b>**grassetto**</b>, <i>*corsivo*</i>, elenchi e titoli
                vengono mostrati formattati.</p>
            <textarea id="text-input" rows="10" maxlength="50000" placeholder="Scrivi qui gli appunti…"></textarea>
            <details><summary>Anteprima</summary><div id="text-preview" class="md text-preview"></div></details>
        </section>

        <!-- Files waiting to be sent -->
        <section class="card" id="queue-box" hidden>
            <h2>Da caricare</h2>
            <ul id="queue" class="plain queue"></ul>
        </section>

        <div class="send-row" id="send-row" hidden>
            <div class="progress" id="progress" hidden><span></span></div>
            <button id="send-btn" type="button">Carica</button>
        </div>
        <p id="limits" class="muted small"></p>

        <section class="card panel" id="p-ai" hidden>
            <h2>Con un'altra AI (ChatGPT, Gemini, Claude)</h2>
            <p class="muted small">Si fa in quattro passi: scegli cosa vuoi ottenere, scarica il materiale della classe, daglielo all'AI con il prompt e carica qui la sua risposta.</p>

            <div class="ai-step">
                <h3 class="step"><span class="n">1</span> Cosa vuoi ottenere?</h3>
                <div class="stack">
                    <label>Documento
                        <select name="kind" form="ai-form">
                            <optgroup label="Per una verifica o interrogazione">
                                <option value="completo">Dispensa completa</option>
                                <option value="riassunto">Riassunto</option>
                                <option value="preparazione">Preparazione mirata</option>
                                <option value="quiz">Quiz</option>
                                <option value="schema">Schema</option>
                            </optgroup>
                            <optgroup label="Per una lezione">
                                <option value="lezione">Appunti della lezione</option>
                            </optgroup>
                        </select>
                    </label>
                    <label class="for-event">Per quale verifica <select name="event_id" form="ai-form"></select></label>
                    <label class="for-lesson" hidden>Materia <select name="subject_id" form="ai-form"></select></label>
                    <label class="for-lesson" hidden>Giorno della lezione <input type="date" name="lesson_date" form="ai-form"></label>
                </div>
            </div>

            <div class="ai-step">
                <h3 class="step"><span class="n">2</span> Scarica il materiale</h3>
                <p class="muted small">È tutto quello che la classe ha caricato, già pronto per l'AI. Se non sai quale scegliere prendi il <b>.md</b>; se l'AI legge meglio i PDF, il <b>PDF</b> ha anche le foto; lo <b>.zip</b> ha i file originali.</p>
                <div class="row">
                    <button type="button" id="aiget-md" class="ico-dl">Scarica per l'AI (.md)</button>
                    <button type="button" id="aiget-pdf" class="ghost ico-dl">PDF con le foto</button>
                    <button type="button" id="aiget-zip" class="ghost ico-dl">File originali (.zip)</button>
                </div>
            </div>

            <div class="ai-step">
                <h3 class="step"><span class="n">3</span> Dai tutto all'AI</h3>
                <p class="muted small">Apri l'AI, allega il file che hai scaricato e incolla questo testo.</p>
                <pre id="aiw-prompt" class="prompt-box">Carico il prompt…</pre>
                <p id="aiw-note" class="muted small"></p>
                <div class="row"><button type="button" id="aiw-copy" class="ghost mini">Copia il prompt</button></div>
                <label class="switch"><input type="checkbox" id="aiget-audio"> Ho anche la registrazione audio della lezione (per le AI che sanno ascoltare, come Gemini)</label>
                <div id="aiw-audio" hidden>
                    <p class="muted small">Allega anche la registrazione e manda prima questo prompt (il file scaricato lo contiene già come "PROMPT A"):</p>
                    <pre id="aiw-audio-prompt" class="prompt-box"></pre>
                    <div class="row"><button type="button" id="aiw-audio-copy" class="ghost mini">Copia il prompt dell'audio</button></div>
                </div>
            </div>

            <form id="ai-form" class="stack ai-step">
                <h3 class="step"><span class="n">4</span> Carica la risposta dell'AI</h3>
                <label>Incolla qui la risposta <textarea name="content" rows="8" placeholder="Il testo che ti ha scritto l'AI"></textarea></label>
                <label>…oppure scegli un file dell'AI (.md, .txt, .json, PDF, Word, PowerPoint, immagine) <input type="file" name="file" accept=".md,.txt,.json,.pdf,.doc,.docx,.odt,.ppt,.pptx,.rtf,image/*,text/plain,text/markdown,application/json,application/pdf"></label>
                <label>Titolo (facoltativo) <input name="title" maxlength="120"></label>
                <p class="muted small">Testo, .md, .txt e .json diventano un documento di studio (lo trovi in Studio e nell'Archivio, con il tuo nome). PDF, Word, PowerPoint e immagini si salvano come materiale della lezione o della verifica: il sito li legge.</p>
                <button>Carica il documento</button>
            </form>

            <details class="prompt-lib" id="prompt-lib">
                <summary>Altri prompt da copiare (studiare, tema, verifica da foto)</summary>
                <div class="stack">
                    <label>Che prompt <select id="pl-key"></select></label>
                    <label id="pl-ai-l">Per quale AI <select id="pl-ai"><option value="gemini">Gemini</option><option value="chatgpt">ChatGPT</option><option value="claude">Claude</option></select></label>
                    <label id="pl-essay-l" class="switch"><input type="checkbox" id="pl-essay"> Aggiungi la parte per allenarmi sul tema</label>
                    <pre id="pl-text" class="prompt-box"></pre>
                    <div class="row"><button type="button" id="pl-copy" class="ghost mini">Copia il prompt</button><button type="button" id="pl-save" class="ghost mini ico-dl">Scarica .txt</button></div>
                </div>
            </details>
        </section>

        <section class="card panel" id="p-timetable" hidden>
            <h2>🗓 Orario da foto</h2>
            <p>L'orario si legge e si controlla nella scheda <em>Classe</em>, dove c'è la tabella da verificare prima di salvare.</p>
            <a class="ghost-link" id="tt-link" href="appunti.php?tab=class">Vai alla scheda Classe</a>
        </section>
    </main>

    <footer class="foot">
        <a href="appunti-guida.php">Guida</a>
        <a href="privacy.php">Privacy</a>
    </footer>
</body>
</html>
