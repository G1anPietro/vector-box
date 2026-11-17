<?php
// public/pages/appunti-carica.php — every way to add material to a class in one page: take a photo, pick files
// (or drop them), write/paste text, upload a document made with another AI, timetable from a photo (manager).
// Uses api/appunti.php; logic in js/appunti-carica.js.
require_once __DIR__ . '/../includes/head.php';
require_once __DIR__ . '/../includes/appunti-top.php';
require_once __DIR__ . '/../api/database.php';

initSession();       // a visitor with no account may open this page (example class only, nothing can be changed)
$e = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES);
$v = filemtime(__DIR__ . '/../js/appunti-carica.js') . '-' . filemtime(__DIR__ . '/../js/appunti-common.js') . '-' . filemtime(__DIR__ . '/../js/dropzone.js') . '-' . filemtime(__DIR__ . '/../js/appunti-upload.js') . '-' . filemtime(__DIR__ . '/../js/appunti-prompts.js') . '-' . filemtime(__DIR__ . '/../css/dropzone.css') . '-' . filemtime(__DIR__ . '/../css/appunti.css');
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
    <title><?= tr(['en' => 'Upload — Class notes', 'it' => 'Carica — Appunti di classe']) ?></title>
    <link rel="stylesheet" href="../css/appunti.css?v=<?= $e($v) ?>">
    <link rel="stylesheet" href="../css/dropzone.css?v=<?= $e($v) ?>">
    <link rel="manifest" href="../assets/appunti/manifest.json?v=1">
    <link rel="icon" href="../assets/appunti/icon.svg?v=1" type="image/svg+xml">
    <script src="../js/i18n.js?v=<?= $e($v) ?>"></script>
    <script src="../js/i18n/appunti-en.js?v=<?= $e($v) ?>"></script>
    <script src="../js/i18n/appunti-it.js?v=<?= $e($v) ?>"></script>
    <script src="../js/csrf.js?v=<?= $e($v) ?>"></script>
    <script src="../js/appunti-common.js?v=<?= $e($v) ?>" defer></script>
    <script src="../js/dropzone.js?v=<?= $e($v) ?>" defer></script>
    <script src="../js/appunti-upload.js?v=<?= $e($v) ?>" defer></script>
    <script src="../js/appunti-prompts.js?v=<?= $e($v) ?>" defer></script>
    <script src="../js/appunti-carica.js?v=<?= $e($v) ?>" defer></script>
</head>
<body>
    <?php appuntiTop('carica'); ?>
    <div class="page-tools"><select id="class-select" aria-label="<?= $e(tr(['en' => 'Class', 'it' => 'Classe'])) ?>" hidden></select></div>

    <main class="wrap upload-page">
        <h1><?= tr(['en' => 'Upload', 'it' => 'Carica']) ?></h1>
        <p id="status" class="status" role="status" aria-live="polite"></p>
        <p id="demo-banner" class="demo-banner" hidden><?= tr(['en' => '<span><b>Example class.</b> You can try the screens, but nothing can be uploaded here. In your class the upload buttons work.</span>', 'it' => '<span><b>Classe di esempio.</b> Puoi provare le schermate, ma qui non si può caricare niente. Nella tua classe i pulsanti per caricare funzionano.</span>']) ?> <a class="ghost-link" href="appunti.php"><?= tr(['en' => 'Back to Notes', 'it' => 'Torna agli Appunti']) ?></a></p>

        <div class="methods" role="tablist" aria-label="<?= $e(tr(['en' => 'How do you want to upload', 'it' => 'Come vuoi caricare'])) ?>">
            <button type="button" class="method" data-method="camera" role="tab"><span>📷</span><?= tr(['en' => 'Take a photo', 'it' => 'Scatta una foto']) ?><small><?= tr(['en' => 'from the phone', 'it' => 'dal telefono']) ?></small></button>
            <button type="button" class="method" data-method="files" role="tab"><span>📁</span><?= tr(['en' => 'Choose files', 'it' => 'Scegli file']) ?><small><?= tr(['en' => 'photos, audio, PDF, Word, PowerPoint…', 'it' => 'foto, audio, PDF, Word, PowerPoint…']) ?></small></button>
            <button type="button" class="method" data-method="text" role="tab"><span>✍️</span><?= tr(['en' => 'Write or paste', 'it' => 'Scrivi o incolla']) ?><small><?= tr(['en' => 'also text with **bold**', 'it' => 'anche testo con **grassetto**']) ?></small></button>
            <button type="button" class="method" data-method="ai" role="tab"><span>🤖</span><?= tr(['en' => 'With another AI', 'it' => 'Con un\'altra AI']) ?><small><?= tr(['en' => 'ChatGPT, Gemini, Claude: prompts and documents', 'it' => 'ChatGPT, Gemini, Claude: prompt e documenti']) ?></small></button>
            <button type="button" class="method" data-method="timetable" role="tab" hidden><span>🗓</span><?= tr(['en' => 'Timetable from a photo', 'it' => 'Orario da foto']) ?><small><?= tr(['en' => 'class representative or whoever has permission', 'it' => 'rappresentante o chi ha il permesso']) ?></small></button>
        </div>

        <!-- Where the material goes (photos, files, text) -->
        <section class="card" id="where" hidden>
            <h2><?= tr(['en' => 'Which lesson is it?', 'it' => 'Di che lezione è?']) ?></h2>
            <div class="grid2">
                <label><?= tr(['en' => 'Day', 'it' => 'Giorno']) ?> <input type="date" id="w-date"></label>
                <label><?= tr(['en' => 'Type', 'it' => 'Tipo']) ?>
                    <select id="w-kind">
                        <option value="auto"><?= tr(['en' => 'The AI decides', 'it' => 'Lo decide l\'AI']) ?></option>
                        <option value="appunti"><?= tr(['en' => 'Notes', 'it' => 'Appunti']) ?></option>
                        <option value="slide"><?= tr(['en' => 'Slides / teacher\'s material', 'it' => 'Slide / materiale del prof']) ?></option>
                        <option value="libro"><?= tr(['en' => 'Book pages', 'it' => 'Pagine del libro']) ?></option>
                        <option value="domande"><?= tr(['en' => 'Teacher\'s questions (oral exam)', 'it' => 'Domande del prof (interrogazione)']) ?></option>
                        <option value="prova"><?= tr(['en' => 'Practice test', 'it' => 'Verifica di preparazione']) ?></option>
                        <option value="altro"><?= tr(['en' => 'Other', 'it' => 'Altro']) ?></option>
                    </select>
                </label>
            </div>
            <details id="w-more" hidden>
                <summary><?= tr(['en' => 'Also valid for other days (representative)', 'it' => 'Vale anche per altri giorni (rappresentante)']) ?></summary>
                <p class="muted small"><?= tr(['en' => 'For material that serves several lessons: it is added to each day chosen below, besides the one above.', 'it' => 'Per il materiale che serve a più lezioni: viene aggiunto a ogni giorno scelto qui sotto, oltre a quello in alto.']) ?></p>
                <div class="row"><input type="date" id="w-more-date"><button type="button" class="ghost mini" id="w-more-add"><?= tr(['en' => 'Add day', 'it' => 'Aggiungi giorno']) ?></button></div>
                <ul id="w-more-list" class="chips plain"></ul>
            </details>
            <label><?= tr(['en' => 'Lesson / subject', 'it' => 'Lezione / materia']) ?> <select id="w-lesson"></select></label>
            <label id="w-topic-l" hidden><?= tr(['en' => 'Topic', 'it' => 'Argomento']) ?> <select id="w-topic"></select></label>
            <p id="w-hint" class="muted small"></p>
            <label><?= tr(['en' => 'Title (optional)', 'it' => 'Titolo (facoltativo)']) ?> <input id="w-title" maxlength="120"></label>
        </section>

        <section class="card panel" id="p-camera" hidden>
            <h2><?= tr(['en' => '📷 Take a photo', 'it' => '📷 Scatta una foto']) ?></h2>
            <p class="muted small"><?= tr(['en' => 'On the phone the camera opens. You can take more than one: they are added below.', 'it' => 'Sul telefono si apre la fotocamera. Puoi farne più di una: si aggiungono qui sotto.']) ?></p>
            <label class="pick-big"><?= tr(['en' => 'Open the camera', 'it' => 'Apri la fotocamera']) ?> <input type="file" id="camera-input" accept="image/*" capture="environment"></label>
        </section>

        <section class="card panel" id="p-files" hidden>
            <h2><?= tr(['en' => '📁 Choose files', 'it' => '📁 Scegli file']) ?></h2>
            <label class="drop" id="drop">
                <input type="file" id="files-input" multiple accept="image/*,audio/*,.pdf,.txt,.md,.html,.htm,.docx,.pptx,.odt,.odp,.mp3,.m4a,.aac,.wav,.ogg,.opus,.flac,.webm">
                <b><?= tr(['en' => 'Drag the files here', 'it' => 'Trascina qui i file']) ?></b><span><?= tr(['en' => 'or tap to choose them', 'it' => 'o tocca per sceglierli']) ?></span>
                <small><?= tr(['en' => 'PDF (also handwritten or scanned), PowerPoint, HTML pages, text and Markdown, Word, LibreOffice, photos, audio · up to 20 at a time', 'it' => 'PDF (anche scritti a mano o scansionati), PowerPoint, pagine HTML, testo e Markdown, Word, LibreOffice, foto, audio · fino a 20 alla volta']) ?></small>
            </label>
            <p class="muted small"><?= tr(['en' => '✍️ <b>Handwritten notes?</b> Upload them as PDF or as photos: the AI reads and transcribes them. HTML pages are cleaned before being saved: scripts, forms and content from other sites are removed, the text stays with headings, lists and tables.', 'it' => '✍️ <b>Appunti scritti a mano?</b> Caricali come PDF o come foto: l\'AI li legge e li trascrive. Le pagine HTML vengono ripulite prima di essere salvate: script, moduli e contenuti da altri siti vengono tolti, resta il testo con titoli, elenchi e tabelle.']) ?></p>
        </section>

        <section class="card panel" id="p-text" hidden>
            <h2><?= tr(['en' => '✍️ Write or paste', 'it' => '✍️ Scrivi o incolla']) ?></h2>
            <p class="muted small"><?= tr(['en' => 'Text copied from ChatGPT or Gemini is fine too: <b>**bold**</b>, <i>*italic*</i>, lists and headings are shown formatted.', 'it' => 'Va bene anche il testo copiato da ChatGPT o Gemini: <b>**grassetto**</b>, <i>*corsivo*</i>, elenchi e titoli vengono mostrati formattati.']) ?></p>
            <textarea id="text-input" rows="10" maxlength="50000" placeholder="<?= $e(tr(['en' => 'Write the notes here…', 'it' => 'Scrivi qui gli appunti…'])) ?>"></textarea>
            <details><summary><?= tr(['en' => 'Preview', 'it' => 'Anteprima']) ?></summary><div id="text-preview" class="md text-preview"></div></details>
        </section>

        <!-- Files waiting to be sent -->
        <section class="card" id="queue-box" hidden>
            <h2><?= tr(['en' => 'To upload', 'it' => 'Da caricare']) ?></h2>
            <ul id="queue" class="plain queue"></ul>
        </section>

        <div class="send-row" id="send-row" hidden>
            <div class="progress" id="progress" hidden><span></span></div>
            <button id="send-btn" type="button"><?= tr(['en' => 'Upload', 'it' => 'Carica']) ?></button>
        </div>
        <p id="limits" class="muted small"></p>

        <section class="card panel" id="p-ai" hidden>
            <h2><?= tr(['en' => 'With another AI (ChatGPT, Gemini, Claude)', 'it' => 'Con un\'altra AI (ChatGPT, Gemini, Claude)']) ?></h2>
            <p class="muted small"><?= tr(['en' => 'It takes four steps: choose what you want to get, download the class material, give it to the AI with the prompt and upload its answer here.', 'it' => 'Si fa in quattro passi: scegli cosa vuoi ottenere, scarica il materiale della classe, daglielo all\'AI con il prompt e carica qui la sua risposta.']) ?></p>

            <div class="ai-step">
                <h3 class="step"><span class="n">1</span> <?= tr(['en' => 'What do you want to get?', 'it' => 'Cosa vuoi ottenere?']) ?></h3>
                <div class="stack">
                    <label><?= tr(['en' => 'Document', 'it' => 'Documento']) ?>
                        <select name="kind" form="ai-form">
                            <optgroup label="<?= $e(tr(['en' => 'For a written test or an oral exam', 'it' => 'Per una verifica o interrogazione'])) ?>">
                                <option value="completo"><?= tr(['en' => 'Full handout', 'it' => 'Dispensa completa']) ?></option>
                                <option value="riassunto"><?= tr(['en' => 'Summary', 'it' => 'Riassunto']) ?></option>
                                <option value="scheda"><?= tr(['en' => 'Cheat sheet to keep at hand', 'it' => 'Scheda da tenere sotto mano']) ?></option>
                                <option value="preparazione"><?= tr(['en' => 'Targeted preparation', 'it' => 'Preparazione mirata']) ?></option>
                                <option value="quiz"><?= tr(['en' => 'Quiz', 'it' => 'Quiz']) ?></option>
                                <option value="schema"><?= tr(['en' => 'Diagram', 'it' => 'Schema']) ?></option>
                            </optgroup>
                            <optgroup label="<?= $e(tr(['en' => 'For a lesson', 'it' => 'Per una lezione'])) ?>">
                                <option value="lezione"><?= tr(['en' => 'Lesson notes', 'it' => 'Appunti della lezione']) ?></option>
                            </optgroup>
                        </select>
                    </label>
                    <label><?= tr(['en' => 'Subject', 'it' => 'Materia']) ?> <select name="subject_id" form="ai-form"></select></label>
                    <label class="for-event"><?= tr(['en' => 'For which test', 'it' => 'Per quale verifica']) ?> <select name="event_id" form="ai-form"></select></label>
                    <label class="for-lesson" hidden><?= tr(['en' => 'Day of the lesson', 'it' => 'Giorno della lezione']) ?> <input type="date" name="lesson_date" form="ai-form"></label>
                    <label class="switch"><input type="checkbox" id="ai-range-on"> <?= tr(['en' => 'I choose from which day to which day to pass the material', 'it' => 'Scelgo io da che giorno a che giorno passare il materiale']) ?></label>
                    <div class="grid2" id="ai-range" hidden>
                        <label><?= tr(['en' => 'From day', 'it' => 'Dal giorno']) ?> <input type="date" id="ai-from"></label>
                        <label><?= tr(['en' => 'To day', 'it' => 'Al giorno']) ?> <input type="date" id="ai-to"></label>
                    </div>
                </div>
            </div>

            <div class="ai-step">
                <h3 class="step"><span class="n">2</span> <?= tr(['en' => 'Download the material', 'it' => 'Scarica il materiale']) ?></h3>
                <p class="muted small"><?= tr(['en' => 'It is everything the class has uploaded, ready for the AI. If you do not know which to choose take the <b>.md</b>; if the AI reads PDFs better, the <b>PDF</b> also has the photos; the <b>.zip</b> has the original files.', 'it' => 'È tutto quello che la classe ha caricato, già pronto per l\'AI. Se non sai quale scegliere prendi il <b>.md</b>; se l\'AI legge meglio i PDF, il <b>PDF</b> ha anche le foto; lo <b>.zip</b> ha i file originali.']) ?></p>
                <div class="row">
                    <button type="button" id="aiget-md" class="ico-dl"><?= tr(['en' => 'Download for the AI (.md)', 'it' => 'Scarica per l\'AI (.md)']) ?></button>
                    <button type="button" id="aiget-pdf" class="ghost ico-dl"><?= tr(['en' => 'PDF with the photos', 'it' => 'PDF con le foto']) ?></button>
                    <button type="button" id="aiget-zip" class="ghost ico-dl"><?= tr(['en' => 'Original files (.zip)', 'it' => 'File originali (.zip)']) ?></button>
                </div>
                <p class="note-box small"><?= tr(['en' => '⚠️ The <b>.zip</b> is for keeping the original files: <b>Gemini, ChatGPT and Claude in the app do not read zip files</b> (they only see unreadable data). For the AI use the <b>.md</b> or the <b>PDF</b>: the text of everything is already inside, even of PowerPoint, PDF and HTML.', 'it' => '⚠️ Il <b>.zip</b> è per tenere i file originali: <b>Gemini, ChatGPT e Claude nell\'app non leggono gli zip</b> (vedono solo dati illeggibili). Per l\'AI usa il <b>.md</b> o il <b>PDF</b>: dentro c\'è già il testo di tutto, anche di PowerPoint, PDF e HTML.']) ?></p>
            </div>

            <div class="ai-step">
                <h3 class="step"><span class="n">3</span> <?= tr(['en' => 'Give everything to the AI', 'it' => 'Dai tutto all\'AI']) ?></h3>
                <p class="muted small"><?= tr(['en' => 'Open the AI, attach the file you downloaded and paste this text.', 'it' => 'Apri l\'AI, allega il file che hai scaricato e incolla questo testo.']) ?></p>
                <pre id="aiw-prompt" class="prompt-box"><?= tr(['en' => 'Loading the prompt…', 'it' => 'Carico il prompt…']) ?></pre>
                <p id="aiw-note" class="muted small"></p>
                <div class="row"><button type="button" id="aiw-copy" class="ghost mini"><?= tr(['en' => 'Copy the prompt', 'it' => 'Copia il prompt']) ?></button></div>
                <label class="switch"><input type="checkbox" id="aiget-audio"> <?= tr(['en' => 'I also have the audio recording of the lesson (for the AIs that can listen, like Gemini)', 'it' => 'Ho anche la registrazione audio della lezione (per le AI che sanno ascoltare, come Gemini)']) ?></label>
                <div id="aiw-audio" hidden>
                    <p class="muted small"><?= tr(['en' => 'Attach the recording too and send this prompt first (the downloaded file already contains it as "PROMPT A"):', 'it' => 'Allega anche la registrazione e manda prima questo prompt (il file scaricato lo contiene già come "PROMPT A"):']) ?></p>
                    <pre id="aiw-audio-prompt" class="prompt-box"></pre>
                    <div class="row"><button type="button" id="aiw-audio-copy" class="ghost mini"><?= tr(['en' => 'Copy the audio prompt', 'it' => 'Copia il prompt dell\'audio']) ?></button></div>
                </div>
            </div>

            <form id="ai-form" class="stack ai-step">
                <h3 class="step"><span class="n">4</span> <?= tr(['en' => 'Upload the AI\'s answer', 'it' => 'Carica la risposta dell\'AI']) ?></h3>
                <p id="ai-format" class="note-box small"></p>
                <label><?= tr(['en' => 'Paste the answer here', 'it' => 'Incolla qui la risposta']) ?> <textarea name="content" rows="8" placeholder="<?= $e(tr(['en' => 'The text the AI wrote for you', 'it' => 'Il testo che ti ha scritto l\'AI'])) ?>"></textarea></label>
                <label><?= tr(['en' => '…or choose a file from the AI (.md, .txt, .json, PDF, Word, PowerPoint, image)', 'it' => '…oppure scegli un file dell\'AI (.md, .txt, .json, PDF, Word, PowerPoint, immagine)']) ?> <input type="file" name="file" accept=".md,.txt,.json,.pdf,.doc,.docx,.odt,.ppt,.pptx,.rtf,image/*,text/plain,text/markdown,application/json,application/pdf"></label>
                <label><?= tr(['en' => 'Title (optional)', 'it' => 'Titolo (facoltativo)']) ?> <input name="title" maxlength="120"></label>
                <p class="muted small"><?= tr(['en' => 'Text, .md, .txt and .json become a study document (you find it in Study and in the Archive, with your name). PDF, Word, PowerPoint and images are saved as material of the lesson or the test: the site reads them.', 'it' => 'Testo, .md, .txt e .json diventano un documento di studio (lo trovi in Studio e nell\'Archivio, con il tuo nome). PDF, Word, PowerPoint e immagini si salvano come materiale della lezione o della verifica: il sito li legge.']) ?></p>
                <button><?= tr(['en' => 'Upload the document', 'it' => 'Carica il documento']) ?></button>
            </form>

            <details class="prompt-lib" id="prompt-lib">
                <summary><?= tr(['en' => 'More prompts to copy (study, essay, test from photos)', 'it' => 'Altri prompt da copiare (studiare, tema, verifica da foto)']) ?></summary>
                <div class="stack">
                    <label><?= tr(['en' => 'Which prompt', 'it' => 'Che prompt']) ?> <select id="pl-key"></select></label>
                    <label id="pl-ai-l"><?= tr(['en' => 'For which AI', 'it' => 'Per quale AI']) ?> <select id="pl-ai"><option value="gemini">Gemini</option><option value="chatgpt">ChatGPT</option><option value="claude">Claude</option></select></label>
                    <label id="pl-essay-l" class="switch"><input type="checkbox" id="pl-essay"> <?= tr(['en' => 'Add the part to practise the essay', 'it' => 'Aggiungi la parte per allenarmi sul tema']) ?></label>
                    <pre id="pl-text" class="prompt-box"></pre>
                    <div class="row"><button type="button" id="pl-copy" class="ghost mini"><?= tr(['en' => 'Copy the prompt', 'it' => 'Copia il prompt']) ?></button><button type="button" id="pl-save" class="ghost mini ico-dl"><?= tr(['en' => 'Download .txt', 'it' => 'Scarica .txt']) ?></button></div>
                </div>
            </details>
        </section>

        <section class="card panel" id="p-timetable" hidden>
            <h2><?= tr(['en' => '🗓 Timetable from a photo', 'it' => '🗓 Orario da foto']) ?></h2>
            <p><?= tr(['en' => 'The timetable is read and checked in the <em>Class</em> tab, where the table to verify before saving is.', 'it' => 'L\'orario si legge e si controlla nella scheda <em>Classe</em>, dove c\'è la tabella da verificare prima di salvare.']) ?></p>
            <a class="ghost-link" id="tt-link" href="appunti.php?tab=class"><?= tr(['en' => 'Go to the Class tab', 'it' => 'Vai alla scheda Classe']) ?></a>
        </section>
    </main>

    <footer class="foot">
        <a href="appunti-guida.php"><?= tr(['en' => 'Guide', 'it' => 'Guida']) ?></a>
        <a href="privacy.php"><?= tr(['en' => 'Privacy', 'it' => 'Privacy']) ?></a>
        <a href="sicurezza.php"><?= tr(['en' => 'Security', 'it' => 'Sicurezza']) ?></a>
    </footer>
</body>
</html>
