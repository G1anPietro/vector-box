// public/js/appunti-carica.js — the upload page: camera, files (with drag and drop), text, AI document.
// Photos/files/text become one upload (api/appunti.php action=upload) with a progress bar; the lesson is guessed
// from the photo time and the timetable, like on the main page.
(() => {
    'use strict';
    const C = window.AppuntiCommon;
    const { el, getJson, post } = C;
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => [...document.querySelectorAll(s)];
    const EVENT_KINDS = { verifica: 'Verifica', interrogazione: 'Interrogazione' };

    let classes = [];
    let current = null;
    let method = null;
    let queue = [];          // File objects waiting to be sent
    let csrf = '';

    // Messages in a toast at the bottom of the screen (the buttons are far from the top of the page)
    function status(msg, kind = '') { if (msg) C.toast(msg, kind); }
    const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const subjectName = (id) => (current.subjects.find((s) => s.id === id) || {}).name || '?';

    /* ---------- methods ---------- */

    function choose(m) {
        method = m;
        $('#send-btn').textContent = 'Carica';
        $$('.method').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.method === m)));
        $$('.panel').forEach((p) => { p.hidden = p.id !== 'p-' + m; });
        const material = ['camera', 'files', 'text'].includes(m);
        $('#where').hidden = !material;
        $('#queue-box').hidden = !material || m === 'text' || !queue.length;
        $('#send-row').hidden = !material;
        status('');
        if (m === 'camera') $('#camera-input').click();
    }
    $$('.method').forEach((b) => b.addEventListener('click', () => choose(b.dataset.method)));

    /* ---------- where: lesson suggestion ---------- */

    async function fillLessons(date, preferred) {
        const sel = $('#w-lesson');
        let lessons = [];
        try { lessons = (await getJson(`../api/appunti.php?action=lessons&class_id=${current.id}&date=${date}`)).lessons; } catch (e) { /* none */ }
        const groups = [];
        if (lessons.length) {
            groups.push(el('optgroup', { label: 'Lezioni del giorno' }, ...lessons.map((l) => el('option', {
                value: `${l.subject_id}|${l.period}`,
                text: `${l.period === l.period_to ? l.period + 'ª ora' : `${l.period}ª-${l.period_to}ª ora`} · ${l.label || subjectName(l.subject_id)} (${l.start}–${l.end})` }))));
        }
        groups.push(el('optgroup', { label: lessons.length ? 'Altra materia' : 'Materia' }, ...current.subjects.map((s) => el('option', { value: `${s.id}|`, text: s.name }))));
        sel.replaceChildren(el('option', { value: '', text: current.subjects.length ? 'Scegli…' : 'Il rappresentante deve ancora inserire l\'orario' }), ...groups);
        if (preferred && [...sel.options].some((o) => o.value === preferred)) sel.value = preferred;
    }

    async function suggest(tsSeconds, fromFile) {
        try {
            const s = await getJson(`../api/appunti.php?action=suggest&class_id=${current.id}&ts=${Math.floor(tsSeconds)}`);
            $('#w-date').value = s.date;
            await fillLessons(s.date, s.lesson ? `${s.lesson.subject_id}|${s.lesson.period}` : null);
            if (fromFile) {
                const when = new Date(tsSeconds * 1000).toLocaleString('it-IT', { weekday: 'long', hour: '2-digit', minute: '2-digit' });
                $('#w-hint').textContent = s.lesson ? `Foto del ${when}: ho scelto la lezione di quell'ora. Cambiala se è sbagliata.` : `Foto del ${when}: scegli tu la lezione.`;
            }
        } catch (e) { /* keep what is there */ }
    }
    $('#w-date').addEventListener('change', (ev) => fillLessons(ev.target.value));

    /* ---------- queue ---------- */

    function addFiles(list) {
        const files = [...list];
        if (!files.length) return;
        queue.push(...files);
        if (queue.length > 20) { queue = queue.slice(0, 20); status('Al massimo 20 file alla volta: gli altri caricali dopo.', 'err'); }
        renderQueue();
        // an audio file says when it was recorded inside itself; the date of the file is only the fallback
        Promise.all(files.map(async (f) => (f.type.startsWith('audio/') && await C.mediaTime(f)) || f.lastModified || Date.now()))
            .then((times) => suggest(Math.min(...times) / 1000, true));
    }

    function renderQueue() {
        $('#queue-box').hidden = !queue.length || method === 'text';
        $('#queue').replaceChildren(...queue.map((f, i) => {
            const thumb = f.type.startsWith('image/') && !/heic|heif/.test(f.type)
                ? el('img', { class: 'qthumb', alt: '', src: URL.createObjectURL(f) })
                : el('span', { class: 'qthumb icon', text: f.type.startsWith('audio/') ? '🎧' : f.type === 'application/pdf' ? '📕' : '📄' });
            return el('li', {}, thumb, el('span', { class: 'qname', text: `${f.name} · ${C.sizeText(f.size)}` }),
                el('button', { type: 'button', class: 'ghost mini', text: '×', 'aria-label': 'Togli', onclick: () => { queue.splice(i, 1); renderQueue(); } }));
        }));
    }

    $('#camera-input').addEventListener('change', (ev) => { addFiles(ev.target.files); ev.target.value = ''; });
    $('#files-input').addEventListener('change', (ev) => { addFiles(ev.target.files); ev.target.value = ''; });
    const drop = $('#drop');
    ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (ev) => { ev.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (ev) => { ev.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (ev) => addFiles(ev.dataTransfer.files));
    // files can be dropped anywhere on the page: they go to the queue (the "Scegli file" way), whatever the way chosen before
    window.VBDrop.attach({ label: 'Mettili qui', hint: 'foto, audio, PDF, Word, PowerPoint', onFiles: (files) => { if (!['camera', 'files'].includes(method)) choose('files'); addFiles(files); } });

    $('#text-input').addEventListener('input', () => { $('#text-preview').replaceChildren(C.md($('#text-input').value)); });

    /* ---------- send (XHR for the progress bar) ---------- */

    $('#send-btn').addEventListener('click', () => {
        const [subjectId, period] = ($('#w-lesson').value || '').split('|');
        if (!subjectId) { status('Scegli la lezione o la materia.', 'err'); return; }
        const text = method === 'text' ? $('#text-input').value.trim() : '';
        if (method !== 'text' && !queue.length) { status('Aggiungi almeno una foto o un file.', 'err'); return; }
        if (method === 'text' && !text) { status('Scrivi qualcosa.', 'err'); return; }

        // The queue (js/appunti-upload.js) sends it in pieces, survives a lost connection or a reload, and keeps going on the other pages
        const files = method !== 'text' ? queue.slice() : [];
        window.AppuntiUpload.enqueue({
            class_id: current.id, label: subjectName(Number(subjectId)),
            fields: { subject_id: subjectId, period: period || '', kind: $('#w-kind').value, lesson_date: $('#w-date').value, title: $('#w-title').value, body: text },
            files,
        }).then(() => {
            status(files.length ? 'Messo in coda: parte da solo e riprende se la connessione cade.' : 'Invio…', 'ok');
            $('#send-btn').textContent = 'Carica altro';
            queue = []; renderQueue();
            $('#text-input').value = ''; $('#text-preview').replaceChildren(); $('#w-title').value = ''; $('#w-hint').textContent = '';
        }).catch((e) => status('Non riesco a preparare i file: ' + e.message, 'err'));
    });
    window.AppuntiUpload.on('done', (job, info) => {
        status(`Caricato in ${job.label || 'classe'}. Grazie! Lo trovi nell'Archivio.` + (info.duplicates.length ? ` Già presenti e saltati: ${info.duplicates.join(', ')}.` : ''), 'ok');
        if (current && current.id === job.class_id) updateLimits();
    });

    async function updateLimits() {
        try {
            const u = await getJson(`../api/appunti.php?action=usage&class_id=${current.id}`);
            $('#limits').textContent = `Massimo ${u.limits_mb.file} MB per file · spazio della classe usato: ${C.sizeText(u.used_bytes)} su ${u.limits_mb.class >= 1024 ? (u.limits_mb.class / 1024).toFixed(1) + ' GB' : u.limits_mb.class + ' MB'}.`;
        } catch (e) { /* ignore */ }
    }

    /* ---------- AI document ---------- */

    let aiEvents = [];
    async function fillAiForm() {
        const f = $('#ai-form');
        f.subject_id.replaceChildren(...current.subjects.map((s) => el('option', { value: s.id, text: s.name })));
        let events = [];
        try { events = (await getJson(`../api/appunti.php?action=events&class_id=${current.id}`)).events.filter((e) => e.kind !== 'altro'); } catch (e) { /* none */ }
        events.sort((a, b) => (a.date < b.date ? 1 : -1));
        aiEvents = events;
        f.event_id.replaceChildren(...(events.length
            ? events.map((e) => el('option', { value: e.id, text: `${EVENT_KINDS[e.kind]} di ${e.subject} · ${C.dayFmt.format(C.parseDate(e.date))}` }))
            : [el('option', { value: '', text: 'Nessuna verifica in calendario' })]));
        f.lesson_date.value = f.lesson_date.value || todayStr();
        toggleAiTarget();
        // the "take the material" block uses the same lists
        $('#aiget-event').replaceChildren(...[...f.event_id.options].map((o) => el('option', { value: o.value, text: o.textContent })));
        $('#aiget-subject').replaceChildren(...current.subjects.map((s) => el('option', { value: s.id, text: s.name })));
        $('#aiget-date').value = $('#aiget-date').value || todayStr();
        toggleGetScope();
    }
    function toggleGetScope() {
        const sc = $('#aiget-scope').value;
        $('#aiget-event-l').hidden = sc !== 'event';
        $('#aiget-subject-l').hidden = sc === 'event';
        $('#aiget-date-l').hidden = sc !== 'day';
    }
    $('#aiget-scope').addEventListener('change', toggleGetScope);
    /** Downloads the material of the chosen scope: the .md for an AI (text + prompts) or the .zip of the original files. */
    async function getMaterial(action, btn) {
        const sc = $('#aiget-scope').value;
        const q = new URLSearchParams({ action, class_id: current.id, scope: sc });
        if (sc === 'event') { if (!$('#aiget-event').value) { status('Scegli una verifica: aggiungila prima nel Calendario.', 'err'); return; } q.set('event_id', $('#aiget-event').value); }
        else q.set('subject_id', $('#aiget-subject').value);
        if (sc === 'day') { if (!$('#aiget-date').value) { status('Scegli il giorno.', 'err'); return; } q.set('date', $('#aiget-date').value); }
        if ($('#aiget-audio').checked) q.set('audio', '1');
        btn.disabled = true;
        status(action === 'zip' ? 'Preparo lo .zip…' : 'Preparo il file per l\'AI…');
        try {
            const r = await fetch('../api/appunti.php?' + q, { credentials: 'same-origin' });
            if (!r.ok) { const j = await r.json().catch(() => null); throw new Error(j && j.error ? j.error : 'Download non riuscito.'); }
            const cd = r.headers.get('content-disposition') || '';
            const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
            const name = m ? decodeURIComponent(m[1]) : (action === 'zip' ? 'appunti.zip' : 'appunti-per-AI.md');
            const url = URL.createObjectURL(await r.blob());
            const a = el('a', { href: url, download: name });
            document.body.append(a); a.click();
            setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
            status(action === 'zip' ? 'Scaricato: dentro c\'è anche PROMPT.txt.' : 'Scaricato: allegalo all\'AI e manda il PROMPT 1 che trovi all\'inizio del file.', 'ok');
        } catch (e) { status(e.message, 'err'); } finally { btn.disabled = false; }
    }
    $('#aiget-md').addEventListener('click', (ev) => getMaterial('ai_pack', ev.currentTarget));
    $('#aiget-zip').addEventListener('click', (ev) => getMaterial('zip', ev.currentTarget));
    function toggleAiTarget() {
        const lesson = $('#ai-form').kind.value === 'lezione';
        $$('#ai-form .for-lesson').forEach((x) => { x.hidden = !lesson; });
        $$('#ai-form .for-event').forEach((x) => { x.hidden = lesson; });
    }
    $('#ai-form [name="kind"]').addEventListener('change', toggleAiTarget);
    $('#ai-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const f = ev.target;
        const lesson = f.kind.value === 'lezione';
        const picked = f.file.files[0];
        // A PDF, Word, slides or an image from the AI cannot be shown as a study document: it is saved as material of that
        // lesson or test (the site reads it like any file) and the .md / .txt / .json ones stay documents
        if (picked && !/\.(md|txt|json)$/i.test(picked.name) && !f.content.value.trim()) {
            const e = lesson ? null : aiEvents.find((x) => String(x.id) === f.event_id.value);
            if (!lesson && !e) { status('Scegli una verifica: aggiungila prima nel Calendario.', 'err'); return; }
            const up = new FormData();
            up.set('action', 'upload');
            up.set('class_id', current.id);
            up.set('subject_id', lesson ? f.subject_id.value : e.subject_id);
            up.set('lesson_date', lesson ? f.lesson_date.value : e.date);
            up.set('kind', 'altro');
            up.set('title', f.title.value || `${f.kind.selectedOptions[0].textContent} fatto con un'altra AI`);
            up.append('files[]', picked, picked.name);
            try {
                await post('../api/appunti.php', up);
                f.title.value = ''; f.file.value = '';
                status('File caricato come materiale: il sito lo legge e lo trovi nell\'Archivio, nella cartella del giorno.', 'ok');
            } catch (er) { status(er.message, 'err'); }
            return;
        }
        const fd = new FormData();
        fd.set('action', 'upload_doc');
        fd.set('class_id', current.id);
        fd.set('kind', f.kind.value);
        fd.set('target', lesson ? 'lesson' : 'event');
        if (lesson) { fd.set('subject_id', f.subject_id.value); fd.set('lesson_date', f.lesson_date.value); } else fd.set('event_id', f.event_id.value);
        fd.set('title', f.title.value);
        fd.set('content', f.content.value);
        if (f.file.files[0]) fd.append('file', f.file.files[0], f.file.files[0].name);
        try {
            await post('../api/appunti.php', fd);
            f.title.value = ''; f.content.value = ''; f.file.value = '';
            status('Documento caricato: lo trovi in Studio e nell\'Archivio, con il tuo nome.', 'ok');
        } catch (e) {
            const msg = { bad_quiz: 'Il quiz deve essere il JSON scritto dall\'AI (PROMPT 4).', bad_schema: 'Lo schema deve essere il JSON scritto dall\'AI (l\'ultimo PROMPT del file "Per AI").', empty: 'Incolla il testo o scegli un file.',
                bad_event: 'Scegli una verifica: aggiungila prima nel Calendario.', bad_file: 'Per un documento di studio usa un file .md, .txt o .json (massimo 2 MB); PDF, Word e immagini si caricano come materiale.' };
            status((e.json && msg[e.json.code]) || e.message, 'err');
        }
    });

    /* ---------- prompts to copy ---------- */
    (() => {
        const P = window.AppuntiPrompts;
        const key = $('#pl-key');
        key.replaceChildren(...P.list.map((p) => el('option', { value: p.key, text: p.title })));
        const draw = () => {
            const p = P.list.find((x) => x.key === key.value);
            $('#pl-ai-l').hidden = !p.hasAi;
            $('#pl-essay-l').hidden = !p.hasEssay;
            $('#pl-text').textContent = p.text({ ai: $('#pl-ai').value, essay: $('#pl-essay').checked });
        };
        ['pl-key', 'pl-ai', 'pl-essay'].forEach((id) => $('#' + id).addEventListener('change', draw));
        $('#pl-copy').addEventListener('click', async () => {
            try { await navigator.clipboard.writeText($('#pl-text').textContent); status('Prompt copiato.', 'ok'); } catch (e) { status('Non riesco a copiare: usa "Scarica .txt".', 'err'); }
        });
        $('#pl-save').addEventListener('click', () => {
            const a = el('a', { href: URL.createObjectURL(new Blob([$('#pl-text').textContent], { type: 'text/plain;charset=utf-8' })), download: `prompt-${key.value}.txt` });
            document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        });
        draw();
    })();

    /* ---------- start ---------- */

    async function openClass(id) {
        current = (await getJson(`../api/classi.php?action=class&id=${id}`)).class;
        C.store(C.CLASS_KEY, String(id));
        $('[data-method="timetable"]').hidden = !(current.perms || []).includes('timetable');
        $('#tt-link').href = `appunti.php?class=${id}&tab=class`;
        $('#w-date').value = todayStr();
        await suggest(Date.now() / 1000, false);
        await fillAiForm();
        updateLimits();
    }

    (async () => {
        try {
            // XMLHttpRequest (for the progress bar) is not wrapped by csrf.js: get the token here
            const r = await fetch('../api/check_session.php', { credentials: 'same-origin', cache: 'no-store' });
            csrf = (await r.json()).csrf_token || '';
            const mine = await getJson('../api/classi.php?action=mine');
            classes = mine.classes;
            if (!classes.length) { location.href = 'appunti.php'; return; }
            const params = new URLSearchParams(location.search);
            const want = Number(params.get('class') || C.stored(C.CLASS_KEY));
            const pick = classes.find((c) => c.id === want) || classes[0];
            const select = $('#class-select');
            select.replaceChildren(...classes.map((c) => el('option', { value: c.id, text: `${c.name} · ${c.school}`, selected: c.id === pick.id })));
            select.addEventListener('change', () => openClass(Number(select.value)).catch((e) => status(e.message, 'err')));
            await openClass(pick.id);
            choose(['camera', 'files', 'text', 'ai'].includes(params.get('m')) ? params.get('m') : 'files');
            // Coming from a test in the Study tab: that test is already selected
            // coming from "Appunti mancanti": that lesson is already chosen
            if (/^\d{4}-\d\d-\d\d$/.test(params.get('date') || '') && params.get('subject')) {
                $('#w-date').value = params.get('date');
                await fillLessons(params.get('date'), null);
                const opt = [...$('#w-lesson').options].find((o) => o.value.startsWith(params.get('subject') + '|'));
                if (opt) $('#w-lesson').value = opt.value;
                choose('files');
            }
            if (params.get('drop')) { const dropped = await C.takeHandOff(); if (dropped.length) { choose('files'); addFiles(dropped); } history.replaceState(null, '', 'appunti-carica.php'); }
            const ev = params.get('event');
            if (ev && [...$('#ai-form').event_id.options].some((o) => o.value === ev)) $('#ai-form').event_id.value = ev;
        } catch (e) { status(e.message, 'err'); }
    })();
})();
