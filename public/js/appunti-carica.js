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
        sel.replaceChildren(el('option', { value: '', text: current.subjects.length ? 'Scegli…' : 'Il responsabile deve ancora inserire l\'orario' }), ...groups);
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
        suggest(Math.min(...files.map((f) => f.lastModified || Date.now())) / 1000, true);
    }

    function renderQueue() {
        $('#queue-box').hidden = !queue.length || method === 'text';
        $('#queue').replaceChildren(...queue.map((f, i) => {
            const thumb = f.type.startsWith('image/') && !/heic|heif/.test(f.type)
                ? el('img', { class: 'qthumb', alt: '', src: URL.createObjectURL(f) }) : el('span', { class: 'qthumb icon', text: f.type === 'application/pdf' ? '📕' : '📄' });
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

    $('#text-input').addEventListener('input', () => { $('#text-preview').replaceChildren(C.md($('#text-input').value)); });

    /* ---------- send (XHR for the progress bar) ---------- */

    $('#send-btn').addEventListener('click', () => {
        const [subjectId, period] = ($('#w-lesson').value || '').split('|');
        if (!subjectId) { status('Scegli la lezione o la materia.', 'err'); return; }
        const text = method === 'text' ? $('#text-input').value.trim() : '';
        if (method !== 'text' && !queue.length) { status('Aggiungi almeno una foto o un file.', 'err'); return; }
        if (method === 'text' && !text) { status('Scrivi qualcosa.', 'err'); return; }

        const fd = new FormData();
        fd.set('action', 'upload');
        fd.set('class_id', current.id);
        fd.set('subject_id', subjectId);
        fd.set('period', period || '');
        fd.set('kind', $('#w-kind').value);
        fd.set('lesson_date', $('#w-date').value);
        fd.set('title', $('#w-title').value);
        fd.set('body', text);
        if (method !== 'text') queue.forEach((f) => fd.append('files[]', f, f.name));

        const xhr = new XMLHttpRequest();
        const bar = $('#progress');
        bar.hidden = false;
        bar.firstElementChild.style.width = '0%';
        $('#send-btn').disabled = true;
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) bar.firstElementChild.style.width = Math.round(100 * e.loaded / e.total) + '%'; };
        xhr.onloadend = () => {
            $('#send-btn').disabled = false;
            bar.hidden = true;
            let j = null;
            try { j = JSON.parse(xhr.responseText); } catch (e) { /* not JSON */ }
            if (xhr.status === 200 && j && j.success) {
                status(`Caricato in ${subjectName(Number(subjectId))}. Grazie! Lo trovi nell'Archivio.`, 'ok');
                $('#send-btn').textContent = 'Carica altro';
                queue = []; renderQueue();
                $('#text-input').value = ''; $('#text-preview').replaceChildren(); $('#w-title').value = ''; $('#w-hint').textContent = '';
                updateLimits();
            } else {
                const msg = { file_too_large: null, class_full: 'La classe ha finito lo spazio.', bad_type: null, too_large: 'Il caricamento è troppo grande.' };
                status((j && (msg[j.code] || j.error)) || 'Caricamento non riuscito: riprova.', 'err');
            }
        };
        xhr.onerror = () => status('Connessione persa durante il caricamento: riprova.', 'err');
        xhr.open('POST', '../api/appunti.php');
        xhr.setRequestHeader('X-CSRF-Token', csrf);
        xhr.send(fd);
        status('Caricamento…');
    });

    async function updateLimits() {
        try {
            const u = await getJson(`../api/appunti.php?action=usage&class_id=${current.id}`);
            $('#limits').textContent = `Massimo ${u.limits_mb.file} MB per file · spazio della classe usato: ${C.sizeText(u.used_bytes)} su ${u.limits_mb.class >= 1024 ? (u.limits_mb.class / 1024).toFixed(1) + ' GB' : u.limits_mb.class + ' MB'}.`;
        } catch (e) { /* ignore */ }
    }

    /* ---------- AI document ---------- */

    async function fillAiForm() {
        const f = $('#ai-form');
        f.subject_id.replaceChildren(...current.subjects.map((s) => el('option', { value: s.id, text: s.name })));
        let events = [];
        try { events = (await getJson(`../api/appunti.php?action=events&class_id=${current.id}`)).events.filter((e) => e.kind !== 'altro'); } catch (e) { /* none */ }
        events.sort((a, b) => (a.date < b.date ? 1 : -1));
        f.event_id.replaceChildren(...(events.length
            ? events.map((e) => el('option', { value: e.id, text: `${EVENT_KINDS[e.kind]} di ${e.subject} · ${C.dayFmt.format(C.parseDate(e.date))}` }))
            : [el('option', { value: '', text: 'Nessuna verifica in calendario' })]));
        f.lesson_date.value = f.lesson_date.value || todayStr();
        toggleAiTarget();
    }
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
            const msg = { bad_quiz: 'Il quiz deve essere il JSON scritto dall\'AI (PROMPT 4).', empty: 'Incolla il testo o scegli un file.',
                bad_event: 'Scegli una verifica: aggiungila prima nel Calendario.', bad_file: 'Usa un file .md, .txt o .json (massimo 2 MB).' };
            status((e.json && msg[e.json.code]) || e.message, 'err');
        }
    });

    /* ---------- start ---------- */

    async function openClass(id) {
        current = (await getJson(`../api/classi.php?action=class&id=${id}`)).class;
        C.store(C.CLASS_KEY, String(id));
        $('[data-method="timetable"]').hidden = !current.can_manage;
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
            const ev = params.get('event');
            if (ev && [...$('#ai-form').event_id.options].some((o) => o.value === ev)) $('#ai-form').event_id.value = ev;
        } catch (e) { status(e.message, 'err'); }
    })();
})();
