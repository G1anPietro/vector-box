// public/js/appunti.js — shared class notes page (pages/appunti.php).
// Talks to api/classi.php and api/appunti.php. Every user-written string goes in with textContent.
(() => {
    'use strict';

    // No inline script on the page (CSP): csrf.js fetches the token itself, the admin flag comes from the API
    let isAdmin = false;
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
    const KINDS = {
        appunti: 'Appunti', slide: 'Slide / prof', libro: 'Libro', domande: 'Domande del prof', prova: 'Verifica di prova', altro: 'Altro',
    };
    const EVENT_KINDS = { verifica: 'Verifica', interrogazione: 'Interrogazione', altro: 'Altro' };
    const DAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
    const STORE_KEY = 'vb_appunti_class';
    const TAB_KEY = 'vb_appunti_tab';
    const DOC_KEY = 'vb_appunti_doc';

    let classes = [];
    let current = null;          // class detail from api/classi.php
    // the tab you were on, read before anything can overwrite it (opening a class shows the board first)
    const startTab = (() => { try { return localStorage.getItem('vb_appunti_tab'); } catch (e) { return null; } })();
    let currentTab = 'board';

    /* ---------- helpers ---------- */
    const C = window.AppuntiCommon;

    function el(tag, props = {}, ...children) {
        const n = document.createElement(tag);
        let value = null;
        for (const [k, v] of Object.entries(props)) {
            if (v === undefined || v === null || v === false) continue;
            if (k === 'value') value = v;            // set after the children (textarea, select)
            else if (k === 'text') n.textContent = v;
            else if (k === 'class') n.className = v;
            else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
            else if (k in n && typeof v !== 'string') n[k] = v;
            else n.setAttribute(k, v === true ? '' : v);
        }
        for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c);
        if (value !== null) {
            if (tag === 'option') n.setAttribute('value', value);
            else n.value = value;
        }
        return n;
    }

    // Messages go in a toast at the bottom of the screen (visible wherever the page is scrolled)
    function status(msg, kind = '') {
        if (msg) window.AppuntiCommon.toast(msg, kind);
    }

    const ERRORS = {
        bad_code: 'Codice non valido.', requests_closed: 'Le richieste di nuove classi sono chiuse.',
        too_many: 'Hai già richieste in attesa.', slow_down: 'Troppi tentativi, riprova tra poco.',
        empty: 'Aggiungi un file o scrivi del testo.', bad_subject: 'Scegli la materia.', file_too_large: null,
        class_full: 'La classe ha finito lo spazio.', bad_type: null, too_large: 'Il caricamento è troppo grande.',
        manager_cannot_leave: 'Prima passa la classe a un altro compagno.', forbidden: 'Non puoi modificarlo.',
        not_manager: 'Non hai il permesso di farlo (chiedi al rappresentante).',
    };
    function errText(json, fallback = 'Qualcosa è andato storto.') {
        if (!json) return fallback;
        return ERRORS[json.code] || json.error || fallback;
    }

    async function getJson(url) {
        const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j || !j.success) throw Object.assign(new Error(errText(j)), { json: j, status: r.status });
        return j;
    }
    // The pressed button stays disabled ("…") until the answer arrives: no double submissions
    function post(url, body) { return window.AppuntiCommon.busy(null, () => rawPost(url, body)); }
    async function rawPost(url, body) {
        const isForm = body instanceof FormData;
        const r = await fetch(url, {
            method: 'POST', credentials: 'same-origin',
            headers: isForm ? {} : { 'Content-Type': 'application/json' },
            body: isForm ? body : JSON.stringify(body),
        });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j || !j.success) throw Object.assign(new Error(errText(j)), { json: j, status: r.status });
        return j;
    }
    const classes_ = (body) => post('../api/classi.php', body);
    const notes_ = (body) => post('../api/appunti.php', body);

    function store(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* private mode */ } }
    function stored(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }

    function todayStr() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
    const dayFmt = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const shortMonth = new Intl.DateTimeFormat('it-IT', { month: 'short' });
    const shortDay = new Intl.DateTimeFormat('it-IT', { weekday: 'short' });
    function sizeText(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
    function subjectName(id) { const s = current && current.subjects.find((x) => x.id === id); return s ? s.name : '?'; }
    function hue(id) { return `hsl(${(id * 67) % 360} 70% 62%)`; }

    /* ---------- classes ---------- */

    async function loadMine(selectId) {
        const mine = await getJson('../api/classi.php?action=mine');
        classes = mine.classes;
        isAdmin = mine.is_admin;
        const sel = $('#class-select');
        sel.replaceChildren(...classes.map((c) => el('option', { value: c.id, text: `${c.name} · ${c.school}${c.is_member ? '' : ' (admin)'}` })));
        $('[data-tab="admin"]').hidden = !mine.is_admin;

        $('#request-form').hidden = !mine.requests_open && !mine.is_admin;
        $('#requests-closed').hidden = mine.requests_open || mine.is_admin;
        const reqStatus = { pending: 'in attesa di approvazione', rejected: 'rifiutata' };
        $('#my-requests').replaceChildren(...mine.requests.map((r) =>
            el('li', {}, el('span', { text: `Richiesta: ${r.name} · ${r.school}` }), el('span', { class: 'muted small', text: reqStatus[r.status] || r.status }))));

        $$('.needs-class').forEach((x) => { x.hidden = classes.length === 0; });
        if (!classes.length) {
            $('#welcome').hidden = false;
            $('#tabs').hidden = !mine.is_admin;
            $$('.tab').forEach((t) => { t.hidden = true; });
            if (mine.is_admin) { $$('#tabs button').forEach((b) => { b.hidden = b.dataset.tab !== 'admin'; }); showTab('admin'); }
            current = null;
            return;
        }
        $('#welcome').hidden = true;
        $('#tabs').hidden = false;
        $$('#tabs button').forEach((b) => { b.hidden = b.dataset.tab === 'admin' && !mine.is_admin; });
        const want = Number(selectId || stored(STORE_KEY));
        const pick = classes.find((c) => c.id === want) || classes[0];
        sel.value = String(pick.id);
        await openClass(pick.id);
    }

    async function openClass(id) {
        current = (await getJson(`../api/classi.php?action=class&id=${id}`)).class;
        store(STORE_KEY, String(id));
        fillSubjectSelects();
        showTab(currentTab === 'admin' && !isAdmin ? 'material' : currentTab);
    }

    function fillSubjectSelects() {
        const opts = () => current.subjects.map((s) => el('option', { value: s.id, text: s.name }));
        $('#filter-subject').replaceChildren(el('option', { value: '', text: 'Tutte le materie' }), ...opts());
        $('#filter-kind').replaceChildren(el('option', { value: '', text: 'Tutti i tipi' }),
            ...Object.entries(KINDS).map(([k, v]) => el('option', { value: k, text: v })));
        $('#event-form [name="subject_id"]').replaceChildren(el('option', { value: '', text: 'Scegli…' }), ...opts());
        $('#study-subject').replaceChildren(el('option', { value: '', text: 'Tutte le materie' }), ...opts());
    }

    function showTab(name) {
        currentTab = name;
        if (name !== 'admin') store(TAB_KEY, name);
        $$('#tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
        $$('.tab').forEach((t) => { t.hidden = t.id !== 'tab-' + name; });
        status('');
        if (name === 'board' && current && window.AppuntiBoard) window.AppuntiBoard.load();
        if (name === 'material' && current) { $('#upload-link').href = caricaUrl(); loadItems(); }
        if (name === 'calendar' && current) loadEvents();
        if (name === 'study' && current) loadStudy();
        if (name === 'score' && current && window.AppuntiScore) window.AppuntiScore.load();
        if (name === 'class' && current) { renderClass(); centerTimetable(); }
        if (name === 'admin') loadAdmin();
    }

    /* ---------- material: uploads happen on pages/appunti-carica.php ---------- */

    const caricaUrl = (params = {}) => 'appunti-carica.php?' + new URLSearchParams({ class: current.id, ...params });

    /* ---------- material: list ---------- */

    /** Downloads a .zip of the material (and the AI documents, and PROMPT.txt) for a lesson day, a subject or a test. */
    async function downloadZip(params, btn, action = 'zip') {
        const asPdf = action === 'pdf';          // one PDF with prompts, texts and the original photos
        if (asPdf) action = 'ai_pack';
        const q = new URLSearchParams({ action, class_id: current.id, ...params, ...(asPdf ? { format: 'pdf' } : {}) });
        if (btn) btn.disabled = true;
        status(action === 'zip' ? 'Preparo lo .zip…' : asPdf ? 'Preparo il PDF…' : 'Preparo il file per l\'AI…');
        try {
            const r = await fetch('../api/appunti.php?' + q, { credentials: 'same-origin' });
            if (!r.ok) {
                const j = await r.json().catch(() => null);
                throw new Error(j && j.code === 'nothing' ? j.error : errText(j, 'Download non riuscito.'));
            }
            const cd = r.headers.get('content-disposition') || '';
            const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
            const name = m ? decodeURIComponent(m[1]) : (action === 'zip' ? 'appunti.zip' : asPdf ? 'appunti-per-AI.pdf' : 'appunti-per-AI.md');
            const url = URL.createObjectURL(await r.blob());
            const a = el('a', { href: url, download: name });
            document.body.append(a);
            a.click();
            setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
            status(action === 'zip'
                ? 'Scaricato. Dentro c\'è anche PROMPT.txt per usarlo con un\'altra AI.'
                : 'Scaricato: allegalo a ChatGPT, Claude o Gemini e manda il PROMPT 1 che trovi all\'inizio del file.', 'ok');
        } catch (e) {
            status(e.message, 'err');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    async function loadItems() {
        const q = new URLSearchParams({ action: 'items', class_id: current.id });
        if ($('#filter-subject').value) q.set('subject_id', $('#filter-subject').value);
        if ($('#filter-kind').value) q.set('kind', $('#filter-kind').value);
        const box = $('#items');
        try {
            const { items } = await getJson('../api/appunti.php?' + q);
            if (!items.length) { box.replaceChildren(el('p', { class: 'empty', text: 'Ancora niente qui. Carica i primi appunti!' })); return; }
            const days = new Map();
            for (const it of items) { if (!days.has(it.lesson_date)) days.set(it.lesson_date, []); days.get(it.lesson_date).push(it); }
            const sid = $('#filter-subject').value;
            box.replaceChildren(...[...days].map(([d, list]) => el('section', { class: 'day' },
                el('div', { class: 'day-head' }, el('h3', { text: dayFmt.format(parseDate(d)) }),
                    C.menu([
                        { label: 'Per un\'altra AI (.md)', onclick: (ev) => downloadZip(sid ? { scope: 'day', date: d, subject_id: sid } : { scope: 'day', date: d }, ev.target, 'ai_pack') },
                        { label: 'Per un\'altra AI (.pdf con le foto)', onclick: (ev) => downloadZip(sid ? { scope: 'day', date: d, subject_id: sid } : { scope: 'day', date: d }, ev.target, 'pdf') },
                        { label: 'Tutto il materiale (.zip)', onclick: (ev) => downloadZip(sid ? { scope: 'day', date: d, subject_id: sid } : { scope: 'day', date: d }, ev.target) }], 'Scarica questo giorno')),
                ...list.map(renderItem))));
        } catch (e) {
            box.replaceChildren(el('p', { class: 'empty', text: e.message }));
        }
    }
    $('#filter-subject').addEventListener('change', () => {
        const sid = $('#filter-subject').value;
        $('#subject-menu').replaceChildren(...(sid ? [C.menu([
            { label: 'Tutta la materia per un\'altra AI (.md)', onclick: (ev) => downloadZip({ scope: 'subject', subject_id: sid }, ev.target, 'ai_pack') },
            { label: 'Tutta la materia per un\'altra AI (.pdf con le foto)', onclick: (ev) => downloadZip({ scope: 'subject', subject_id: sid }, ev.target, 'pdf') },
            { label: 'Tutta la materia (.zip)', onclick: (ev) => downloadZip({ scope: 'subject', subject_id: sid }, ev.target) }], 'Scarica la materia')] : []));
        loadItems();
    });
    $('#filter-kind').addEventListener('change', loadItems);

    /** Long notes show a few lines and a "Mostra tutto" button (no box scrolling inside the page). */
    function collapsible(body) {
        body.classList.add('clamped');
        const btn = el('button', { type: 'button', class: 'ghost mini more-btn', text: 'Mostra tutto', hidden: true });
        btn.addEventListener('click', () => {
            const open = body.classList.toggle('clamped');
            btn.textContent = open ? 'Mostra tutto' : 'Mostra meno';
        });
        // only when the text is really longer than the preview
        requestAnimationFrame(() => { btn.hidden = body.scrollHeight <= body.clientHeight + 4; });
        return el('div', {}, body, btn);
    }

    function renderItem(it) {
        const fileUrl = (f) => `../api/appunti.php?action=file&id=${f.id}`;
        const files = it.files.map((f) => f.mime.startsWith('image/') && f.mime !== 'image/heic' && f.mime !== 'image/heif'
            ? el('a', { class: 'thumb', href: fileUrl(f), target: '_blank', rel: 'noopener', title: f.name },
                el('img', { src: fileUrl(f), alt: f.name, loading: 'lazy' }))
            : f.mime.startsWith('audio/')
                ? el('div', { class: 'audio-file' }, el('span', { class: 'muted small', text: `🎧 ${f.name} · ${sizeText(f.size)}` }),
                    el('audio', { controls: true, preload: 'none', src: fileUrl(f) }))
                : el('a', { href: fileUrl(f), target: '_blank', rel: 'noopener', text: `📄 ${f.name} · ${sizeText(f.size)}` }));
        const card = el('article', { class: 'item' },
            el('div', { class: 'meta' },
                el('span', { class: 'subject', text: it.subject }),
                el('span', { class: 'kind', text: KINDS[it.kind] || it.kind }),
                it.period ? el('span', { text: `${it.period}ª ora` }) : null,
                el('span', { text: `da ${it.author || '?'}` })),
            it.title ? el('div', { class: 'title', text: it.title }) : null,
            it.body ? collapsible(window.AppuntiCommon.looksLikeMarkdown(it.body)
                ? el('div', { class: 'body md' }, md(it.body))
                : el('div', { class: 'body', text: it.body })) : null,
            files.length ? el('div', { class: 'files' }, files) : null,
            it.can_edit ? el('div', { class: 'actions' }, C.menu([
                { label: 'Modifica', onclick: () => editItem(it, card) },
                { label: it.files.length || it.body ? 'Elimina tutto' : 'Elimina', danger: true, onclick: () => deleteItem(it) },
                ...(it.files.length > 1 || (it.files.length === 1 && it.body) ? it.files.filter((f) => f.can_delete).map((f) => ({ label: `Elimina solo «${f.name}»`, danger: true, onclick: () => deleteFile(f, loadItems) })) : [])])) : null);
        card.style.setProperty('--sub', hue(it.subject_id));
        return card;
    }

    /** Deletes one file after a confirmation (the server checks who may). */
    async function deleteFile(f, reload) {
        if (!confirm(`Eliminare il file «${f.name}»? Non si può annullare.`)) return;
        try { await notes_({ action: 'delete_file', id: f.id }); status('File eliminato.', 'ok'); reload(); } catch (e) { status(e.message, 'err'); }
    }

    function editItem(it, card) {
        const form = el('form', { class: 'stack' },
            el('div', { class: 'grid2' },
                el('label', { text: 'Materia' }, el('select', { name: 'subject_id' },
                    ...current.subjects.map((s) => el('option', { value: s.id, text: s.name, selected: s.id === it.subject_id })))),
                el('label', { text: 'Giorno' }, el('input', { type: 'date', name: 'lesson_date', value: it.lesson_date, required: true }))),
            el('label', { text: 'Tipo' }, el('select', { name: 'kind' },
                ...Object.entries(KINDS).map(([k, v]) => el('option', { value: k, text: v, selected: k === it.kind })))),
            el('label', { text: 'Titolo' }, el('input', { name: 'title', value: it.title, maxLength: 120 })),
            el('label', { text: 'Testo' }, el('textarea', { name: 'body', rows: 5, maxLength: 50000, value: it.body })),
            el('div', { class: 'row' }, el('button', { text: 'Salva' }), el('button', { type: 'button', class: 'ghost', text: 'Annulla', onclick: () => loadItems() })));
        form.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            try {
                await notes_({
                    action: 'edit_item', id: it.id, subject_id: Number(form.subject_id.value), kind: form.kind.value,
                    lesson_date: form.lesson_date.value, period: form.subject_id.value === String(it.subject_id) && form.lesson_date.value === it.lesson_date ? it.period : null,
                    title: form.title.value, body: form.body.value,
                });
                status('Salvato.', 'ok');
                loadItems();
            } catch (e) { status(e.message, 'err'); }
        });
        card.replaceChildren(form);
    }

    async function deleteItem(it) {
        if (!confirm('Eliminare questo materiale e i suoi file?')) return;
        try { await notes_({ action: 'delete_item', id: it.id }); status('Eliminato.', 'ok'); loadItems(); } catch (e) { status(e.message, 'err'); }
    }


    /* ---------- study: AI documents ---------- */

    const DOC_KINDS = { completo: 'Completo', riassunto: 'Riassunto', preparazione: 'Preparazione', quiz: 'Quiz', lezione: 'Lezione', schema: 'Schema', domande: 'Domande' };
    const DOC_ORDER = ['completo', 'riassunto', 'preparazione', 'quiz', 'schema'];
    let studyDocs = [];
    let openDoc = null;

    async function loadStudy() {
        $('#doc-view').hidden = true;
        $('#study-list').hidden = false;
        try {
            const [d, ev] = await Promise.all([
                getJson(`../api/appunti.php?action=docs&class_id=${current.id}`),
                getJson(`../api/appunti.php?action=events&class_id=${current.id}`),
            ]);
            studyDocs = d.docs;
            $('#doc-upload-link').href = caricaUrl({ m: 'ai' });
            renderAiBar(d.ai);
            loadReview();
            renderStudyTests(ev.events.filter((e) => e.date >= ev.today && e.kind !== 'altro'), d.ai);
            renderStudyLessons();
            fillCustomQuiz();
        } catch (e) { status(e.message, 'err'); }
    }

    /* ---------- quiz made to measure, and the questions asked in class ---------- */

    const CQ_KEY = 'vb_custom_quiz';
    function fillCustomQuiz() {
        const f = $('#cq-form');
        const subjects = [el('option', { value: '', text: 'Tutte le materie' }), ...current.subjects.map((s) => el('option', { value: s.id, text: s.name }))];
        f.subject_id.replaceChildren(...subjects);
        $('#asked-subject').replaceChildren(...current.subjects.map((s) => el('option', { value: s.id, text: s.name })));
        let saved = {};
        try { saved = JSON.parse(stored(CQ_KEY) || '{}') || {}; } catch (e) { saved = {}; }
        for (const k of ['n', 'type', 'from']) if (saved[k]) f[k].value = saved[k];
        if (saved.subject_id && current.subjects.some((s) => String(s.id) === String(saved.subject_id))) f.subject_id.value = saved.subject_id;
    }
    $('#cq-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const f = ev.target;
        const choice = { subject_id: f.subject_id.value, n: f.n.value, type: f.type.value, from: f.from.value };
        store(CQ_KEY, JSON.stringify(choice));   // the choices are remembered
        try {
            const r = await notes_({ action: 'custom_quiz_create', class_id: current.id, subject_id: Number(choice.subject_id) || 0, n: Number(choice.n), type: choice.type, from: choice.from });
            openDoc = null;
            $('#study-list').hidden = true;
            $('#doc-view').hidden = false;
            $('#doc-title').textContent = 'Quiz su misura';
            $('#doc-meta').textContent = `${r.questions.length} domande${r.questions.length < Number(choice.n) ? ` (tutte quelle disponibili: ${r.pool})` : ''}. Allenamento: niente punti.`;
            $('#doc-download').hidden = true;
            $('#doc-sources').hidden = true;
            $('#doc-body').replaceChildren(renderQuiz({ questions: r.questions }, (n, k) => C.rawPost('../api/appunti.php', { action: 'custom_quiz_answer', id: r.id, i: n, choice: k }), { practice: true, noRestart: true }));
            window.scrollTo(0, 0);
        } catch (e) {
            status(e.json && e.json.code === 'empty_pool' ? (choice.from === 'wrong' ? 'Non hai domande sbagliate da ripassare: bravo!' : 'Per questa scelta non ci sono ancora domande: arrivano con i quiz delle verifiche.') : e.message, 'err');
        }
    });

    let askedLoaded = null;
    async function loadAsked() {
        const sid = Number($('#asked-subject').value) || 0;
        const box = $('#asked-list');
        box.replaceChildren(el('p', { class: 'muted', text: 'Carico…' }));
        try {
            const { questions } = await getJson(`../api/appunti.php?action=question_pool&class_id=${current.id}&subject_id=${sid}`);
            askedLoaded = { sid, questions };
            $('#asked-menu').replaceChildren(...(questions.length ? [C.menu([
                { label: 'Studia a carte (ripasso a intervalli)', accent: true, onclick: () => startCards() },
                { label: 'Esporta per Anki (.txt)', onclick: () => exportAnki() },
                { label: 'Scarica il prompt per farti interrogare da un\'altra AI', onclick: () => downloadAskedPrompt() },
                { label: 'Copia il prompt', onclick: () => copyAskedPrompt() }], 'Domande aperte')] : []));
            box.replaceChildren(...(questions.length ? questions.map((q) => el('div', { class: 'asked' },
                el('div', { class: 'asked-q' }, el('span', { class: 'qa-badge ' + (q.origine === 'prof' ? 'prof' : 'ai'), text: q.origine === 'prof' ? (q.count > 1 ? `Chiesta ${q.count} volte` : 'Fatta dal prof') : 'Probabile' }), ' ', q.domanda),
                q.risposta ? el('details', {}, el('summary', { text: 'Risposta' }), el('div', { class: 'md' }, md(q.risposta))) : null))
                : [el('p', { class: 'empty', text: 'Ancora nessuna domanda: arrivano con i riassunti delle lezioni.' })]));
        } catch (e) { box.replaceChildren(el('p', { class: 'empty', text: e.message })); }
    }
    $('#asked-box').addEventListener('toggle', () => { if ($('#asked-box').open) loadAsked(); });
    $('#asked-subject').addEventListener('change', loadAsked);

    /* ---------- flashcards from the open questions: say the answer aloud, look, say if you knew it (spaced, on this device) ---------- */

    const FC_DAYS = [1, 3, 7, 14, 30];
    const fcKey = () => `vb_cards_${current.id}`;
    const fcLoad = () => { try { return JSON.parse(stored(fcKey()) || '{}') || {}; } catch (e) { return {}; } };
    const hashOf = (t) => { let h = 5381; for (const c of t) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0; return h.toString(36); };
    const dayPlus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

    function startCards() {
        const state = fcLoad();
        const today = todayStr();
        const cards = askedLoaded.questions.filter((q) => q.risposta).map((q) => ({ q, id: hashOf(q.domanda), st: state[hashOf(q.domanda)] || { box: 0, due: today } }))
            .filter((c) => c.st.due <= today).sort((a, b) => b.q.count - a.q.count);
        openDoc = null;
        $('#study-list').hidden = true;
        $('#doc-view').hidden = false;
        $('#doc-title').textContent = 'Carte da ripassare';
        $('#doc-meta').textContent = cards.length ? `${cards.length} carte oggi: pensa la risposta, poi guardala.` : 'Per oggi hai finito. Le carte tornano dopo 1, 3, 7, 14, 30 giorni.';
        $('#doc-download').hidden = true;
        $('#doc-sources').hidden = true;
        const body = $('#doc-body');
        let i = 0;
        const next = () => {
            if (i >= cards.length) { body.replaceChildren(el('p', { class: 'empty', text: 'Fatto! Torna domani per le carte in scadenza.' })); return; }
            const c = cards[i];
            const answer = el('div', { class: 'fc-answer md', hidden: true }, md(c.q.risposta));
            const know = (yes) => {
                const box = yes ? Math.min(c.st.box + 1, FC_DAYS.length) : 0;
                const all = fcLoad();
                all[c.id] = box >= FC_DAYS.length ? { box: FC_DAYS.length, due: dayPlus(60) } : { box, due: dayPlus(FC_DAYS[box]) };
                store(fcKey(), JSON.stringify(all));
                i++; next();
            };
            const show = el('button', { type: 'button', text: 'Mostra la risposta', onclick: () => { answer.hidden = false; show.hidden = true; row.hidden = false; } });
            const row = el('div', { class: 'row', hidden: true }, el('button', { type: 'button', text: 'La sapevo', onclick: () => know(true) }), el('button', { type: 'button', class: 'ghost', text: 'Da rivedere', onclick: () => know(false) }));
            body.replaceChildren(el('p', { class: 'muted small', text: `Carta ${i + 1} di ${cards.length}${c.q.count > 1 ? ` · chiesta ${c.q.count} volte` : ''}` }),
                el('div', { class: 'fc-card' }, el('div', { class: 'fc-q' }, c.q.domanda,
                    C.canSpeak() ? el('button', { type: 'button', class: 'ghost mini speak-btn', text: 'Leggi', onclick: () => C.speak(c.q.domanda) }) : null), answer), show, row);
        };
        next();
        window.scrollTo(0, 0);
    }

    /** Anki: a text file with "front<TAB>back" per line (import it with File > Import). */
    function exportAnki() {
        const clean = (t) => String(t).replace(/[\t\r\n]+/g, ' ').trim();
        const lines = ['#separator:tab', '#html:false', ...askedLoaded.questions.filter((q) => q.risposta).map((q) => `${clean(q.domanda)}\t${clean(q.risposta)}`)];
        const a = el('a', { href: URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' })), download: 'domande-anki.txt' });
        document.body.append(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        status('Scaricato: in Anki scegli File › Importa e questo file; ogni riga è una carta (domanda, risposta).', 'ok');
    }

    /** A prompt that turns another AI into an examiner: one open question at a time, correction, final summary. */
    function askedPrompt() {
        const subject = (current.subjects.find((s) => s.id === askedLoaded.sid) || {}).name || 'questa materia';
        const lines = askedLoaded.questions.map((q, i) => `${i + 1}. ${q.domanda}${q.origine === 'prof' ? (q.count > 1 ? ` (chiesta dal prof ${q.count} volte)` : ' (chiesta dal prof)') : ' (probabile)'}${q.risposta ? `\n   Risposta di riferimento: ${q.risposta}` : ''}`);
        return `Fai l'esaminatore: devi interrogarmi in ${subject}, come farebbe il mio professore.
Qui sotto trovi le domande che il professore ha fatto in classe (le più chieste per prime) e alcune probabili, con la risposta di riferimento.

Come si fa:
1) Fammi UNA domanda alla volta e aspetta la mia risposta. Non dire la risposta prima che io abbia risposto.
2) Dopo la mia risposta dimmi cosa era giusto, cosa mancava e cosa era sbagliato; poi dai la risposta corretta in parole semplici.
3) Parti dalle più chieste. Le domande che sbaglio rifalle alla fine.
4) Alla fine fai il riepilogo: un voto indicativo, gli argomenti da ripassare e le domande più deboli.
5) Usa solo queste domande e quello che sai con certezza sulla materia; se non sei sicuro dillo.

DOMANDE
${lines.join('\n')}
`;
    }
    function downloadAskedPrompt() {
        const a = el('a', { href: URL.createObjectURL(new Blob([askedPrompt()], { type: 'text/plain;charset=utf-8' })), download: 'interrogazione-con-un-altra-AI.txt' });
        document.body.append(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        status('Scaricato: incolla il testo in ChatGPT, Gemini o Claude e rispondi a voce o per iscritto.', 'ok');
    }
    async function copyAskedPrompt() {
        try { await navigator.clipboard.writeText(askedPrompt()); status('Prompt copiato: incollalo nell\'AI.', 'ok'); } catch (e) { status('Non riesco a copiare: usa "Scarica".', 'err'); }
    }

    function renderAiBar(ai) {
        const bar = $('#ai-bar');
        if (!ai.configured) { bar.replaceChildren(el('p', { class: 'muted', text: 'L\'AI non è ancora attiva su questo server: i riassunti arriveranno appena viene accesa.' })); return; }
        const now = Date.now() / 1000;
        const wait = ai.next_manual_at > now;
        const at = new Date(ai.next_manual_at * 1000).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
        const lr = ai.last_run;
        let last = null;
        if (lr && lr.at) {
            const when = new Date(lr.at * 1000).toLocaleString('it-IT', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
            const made = lr.lessons + lr.tests;
            const why = lr.stop === 'busy' ? 'Google era sovraccarico: riprovo da solo tra qualche minuto.'
                : lr.stop === 'quota' ? 'finite le richieste gratuite di oggi: il resto arriva domani.'
                : lr.stop === 'fault' ? 'c\'è stato un problema con l\'AI (l\'amministratore è stato avvisato).'
                : lr.pending ? `aspetto la trascrizione di ${lr.pending} file.`
                : made ? '' : 'nessun materiale nuovo da riassumere (i documenti si rifanno solo quando arriva materiale nuovo o modificato).';
            last = el('span', { class: 'muted small', text: `Ultimo giro (${lr.manual ? '"Genera ora"' : 'automatico'}, ${when}): `
                + (made ? `${made} document${made === 1 ? 'o' : 'i'} nuov${made === 1 ? 'o' : 'i'}${why ? '; ' + why : '.'}` : why) });
        }
        const state = ai.summary_on === false ? 'Riassunto automatico spento.' : `Riassunto automatico ogni giorno alle ${ai.summary_time}.`;
        const sub = (ai.pending_files ? `${ai.pending_files} file da trascrivere. ` : '')
            + (ai.requested ? 'Richiesta in coda: ci vuole qualche minuto.' : wait ? `Si può chiedere di nuovo alle ${at}.` : '');
        bar.replaceChildren(el('div', { class: 'ai-bar-row' },
            el('p', {}, el('b', { text: state }), sub ? el('br') : null, sub ? el('span', { class: 'muted small', text: sub }) : null, last ? el('br') : null, last),
            C.menu([
                { label: ai.requested ? 'Già in coda' : wait ? `Genera ora (dalle ${at})` : 'Genera ora', onclick: () => { if (!ai.requested && !wait) generateNow(); } },
                { label: 'Genera su giorni scelti…', onclick: () => rangeDialog() }], 'Genera i documenti')));
    }

    async function generateNow(range = null) {
        try {
            await notes_({ action: 'generate', class_id: current.id, ...(range || {}) });
            status(range ? `Richiesta inviata: rifaccio appunti, domande e schemi delle lezioni dal ${fmtDay(range.from)} al ${fmtDay(range.to)}. Ci vuole qualche minuto.`
                : 'Richiesta inviata: i documenti arrivano entro qualche minuto.', 'ok');
        } catch (e) {
            status(e.json && e.json.code === 'too_soon' ? 'Già chiesto nell\'ultima ora.' : e.json && e.json.code === 'ai_off' ? 'L\'AI non è attiva.'
                : e.json && e.json.code === 'bad_range' ? 'Controlla le date: l\'inizio prima della fine, niente giorni futuri, al massimo 4 mesi.' : e.message, 'err');
        }
        loadStudy();
    }
    const fmtDay = (iso) => parseDate(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });

    /** "Genera ora" on chosen days: when a topic spans weeks, or notes were caught up late. */
    function rangeDialog() {
        C.dialogForm('Genera su giorni scelti', (form) => {
            form.append(el('p', { class: 'muted small', text: 'Rifà appunti, domande e schemi delle lezioni di quei giorni (al massimo 4 mesi, niente giorni futuri).' }),
                el('label', { text: 'Dal' }, el('input', { type: 'date', name: 'from', required: true })),
                el('label', { text: 'Al' }, el('input', { type: 'date', name: 'to', required: true, value: todayStr() })));
        }, async (form) => { await generateNow({ from: form.from.value, to: form.to.value }); }, 'Genera');
    }

    /* ---------- spaced review ---------- */

    async function loadReview() {
        const box = $('#review-box');
        try {
            const r = await getJson(`../api/appunti.php?action=review&class_id=${current.id}`);
            if (!r.due.length) {
                box.hidden = !r.later;
                box.replaceChildren(el('p', {}, el('b', { text: 'Ripasso: niente per oggi ✓' }), el('br'),
                    el('span', { class: 'muted small', text: `${r.later} domand${r.later === 1 ? 'a tornerà' : 'e torneranno'} nei prossimi giorni.` })));
                return;
            }
            box.hidden = false;
            box.replaceChildren(el('div', {}, el('b', { text: `Ripasso di oggi: ${r.due.length} domand${r.due.length === 1 ? 'a' : 'e'}` }), el('br'),
                el('span', { class: 'muted small', text: 'Quelle che hai sbagliato nei quiz. Se rispondi giusto tornano tra 3, 7, 14, 30 giorni; se sbagli, domani.' })),
                el('button', { text: 'Inizia il ripasso', onclick: () => startReview(r.due) }));
        } catch (e) { box.hidden = true; }
    }

    function startReview(due) {
        openDoc = null;
        $('#study-list').hidden = true;
        $('#doc-view').hidden = false;
        $('#doc-title').textContent = 'Ripasso di oggi';
        $('#doc-meta').textContent = 'Le domande sbagliate nei quiz, finché non le sai.';
        $('#doc-download').hidden = true;
        $('#doc-sources').hidden = true;
        $('#doc-body').replaceChildren(renderQuiz({ questions: due.map((q) => ({ ...q, topic: q.topic || q.from })) },
            (n, choice) => C.rawPost('../api/appunti.php', { action: 'review_answer', doc_id: due[n].doc_id, q: due[n].q, choice })));
        window.scrollTo(0, 0);
    }

    const shortDate = (d) => d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });

    function renderStudyTests(events, ai) {
        const box = $('#study-tests');
        if (!events.length) { box.replaceChildren(el('p', { class: 'empty', text: 'Nessuna verifica in calendario. Aggiungile nella scheda Calendario: i documenti per studiare si preparano da soli.' })); return; }
        box.replaceChildren(...events.map((e) => {
            const docs = DOC_ORDER.map((k) => studyDocs.find((d) => d.event_id === e.id && d.kind === k && !d.manual)).filter(Boolean)
                .concat(studyDocs.filter((d) => d.event_id === e.id && d.manual));
            const d = parseDate(e.date);
            const docItems = docs.map((doc) => ({ label: DOC_KINDS[doc.kind] + (doc.manual ? ` · di ${doc.author || '?'}` : '') + (doc.status === 'ok' ? '' : ' (errore)'),
                accent: true, onclick: () => { if (doc.status === 'ok') showDoc(doc.id); else status('Questo documento non è riuscito: si rifà con il prossimo riassunto.', 'err'); } }));
            const delItems = docs.filter((doc) => doc.can_delete).map((doc) => ({ label: `Elimina «${DOC_KINDS[doc.kind]}»…`, danger: true, onclick: () => deleteDoc(doc) }));
            return el('div', { class: 'test-card' },
                el('div', { class: 'test-head' },
                    el('div', { class: 'what' }, el('span', { class: 'badge ' + e.kind, text: EVENT_KINDS[e.kind] }), el('b', { text: e.subject }),
                        ` · ${shortDate(d)}`, e.title ? ` · ${e.title}` : ''),
                    C.menu([...docItems,
                        { label: 'Per un\'altra AI (.md)', onclick: (ev) => downloadZip({ scope: 'event', event_id: e.id }, ev.target, 'ai_pack') },
                        { label: 'Per un\'altra AI (.pdf con le foto)', onclick: (ev) => downloadZip({ scope: 'event', event_id: e.id }, ev.target, 'pdf') },
                        { label: 'Tutto il materiale (.zip)', onclick: (ev) => downloadZip({ scope: 'event', event_id: e.id }, ev.target) },
                        { label: 'Carica un documento fatto con un\'altra AI', onclick: () => { location.href = caricaUrl({ m: 'ai', event: e.id }); } },
                        ...delItems], 'Documenti e azioni')));
        }));
    }

    function renderStudyLessons() {
        const sid = Number($('#study-subject').value) || 0;
        const list = studyDocs.filter((d) => d.kind === 'lezione' && (!sid || d.subject_id === sid));
        const box = $('#study-lessons');
        if (!list.length) { box.replaceChildren(el('p', { class: 'empty', text: 'Ancora nessun riassunto delle lezioni.' })); return; }
        box.replaceChildren(...list.map((d) => {
            const sub = (kind) => studyDocs.filter((x) => x.kind === kind && x.status === 'ok' && x.subject_id === d.subject_id && x.lesson_date === d.lesson_date && (kind === 'schema' ? !x.event_id : true))[0];
            const schema = sub('schema'); const questions = sub('domande');
            return el('div', { class: 'doc-row' },
                el('span', { class: 'doc-row-text' }, el('b', { text: d.subject }), ' · ', d.lesson_date ? shortDate(parseDate(d.lesson_date)) : '',
                    d.manual ? el('span', { class: 'muted small', text: ` · di ${d.author || '?'}` }) : null,
                    d.status !== 'ok' ? el('span', { class: 'err', text: ' (non riuscito)' }) : null),
                el('span', { class: 'row-actions' },
                    el('button', { class: 'ghost mini', text: 'Apri', disabled: d.status !== 'ok', onclick: () => showDoc(d.id) }),
                    C.menu([schema ? { label: 'Schema', accent: true, onclick: () => showDoc(schema.id) } : null,
                        questions ? { label: 'Domande', accent: true, onclick: () => showDoc(questions.id) } : null,
                        d.can_delete ? { label: 'Elimina questi appunti…', danger: true, onclick: () => deleteDoc(d) } : null,
                        schema && schema.can_delete ? { label: 'Elimina lo schema…', danger: true, onclick: () => deleteDoc(schema) } : null,
                        questions && questions.can_delete ? { label: 'Elimina le domande…', danger: true, onclick: () => deleteDoc(questions) } : null])));
        }));
    }
    $('#study-subject').addEventListener('change', renderStudyLessons);

    async function deleteDoc(d) {
        const ai = d.manual === false;
        if (!confirm(`Eliminare «${d.title || DOC_KINDS[d.kind] || 'questo documento'}»?${ai ? ' È stato scritto dall\'AI: se c\'è ancora il materiale, può rifarlo al prossimo riassunto.' : ''} Non si può annullare.`)) return;
        try { await notes_({ action: 'delete_doc', id: d.id }); loadStudy(); } catch (e) { status(e.message, 'err'); }
    }

    async function showDoc(id) {
        try {
            const { doc } = await getJson(`../api/appunti.php?action=doc&id=${id}`);
            openDoc = doc;
            $('#study-list').hidden = true;
            $('#doc-view').hidden = false;
            $('#doc-title').textContent = doc.title;
            $('#doc-meta').textContent = (doc.manual ? `Fatto con un'altra AI e caricato da ${doc.author || '?'} · ` : '')
                + `Aggiornato il ${new Date(doc.updated_at * 1000).toLocaleString('it-IT', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`;
            const body = $('#doc-body');
            if (doc.kind === 'quiz') {
                let quiz = null;
                try { quiz = JSON.parse(doc.content); } catch (e) { /* shown as text below */ }
                body.replaceChildren(quiz ? renderQuiz(quiz, (n, choice) => C.rawPost('../api/appunti.php', { action: 'quiz_answer', doc_id: doc.id, q: n, choice })) : el('p', { text: 'Quiz non leggibile.' }));
            } else if (doc.kind === 'schema') {
                body.replaceChildren(window.AppuntiCommon.renderSchema(doc.content));
            } else if (doc.kind === 'domande') {
                body.replaceChildren(window.AppuntiCommon.renderQuestions(doc.content));
            } else {
                body.replaceChildren(md(doc.content));
                C.addIndex(body, 'doc' + doc.id);
            }
            store(DOC_KEY, String(doc.id));
            $('#doc-download').hidden = ['quiz', 'schema', 'domande'].includes(doc.kind);
            $('#doc-sources').hidden = !doc.sources.length;
            const kinds = { appunti: 'appunti', slide: 'slide del prof', libro: 'libro', domande: 'domande del prof', prova: 'verifica di prova', altro: 'altro' };
            $('#doc-sources-list').replaceChildren(...doc.sources.map((s) => el('li', { value: s.n,
                text: `${kinds[s.kind] || s.kind} di ${s.author || '?'}${s.title ? ' — ' + s.title : ''}` })));
            window.scrollTo(0, 0);
        } catch (e) { status(e.message, 'err'); }
    }
    $('#doc-back').addEventListener('click', () => { store(DOC_KEY, ''); $('#doc-view').hidden = true; $('#study-list').hidden = false; if (!openDoc) loadReview(); });
    $('#doc-print').addEventListener('click', () => window.print());
    $('#doc-download').addEventListener('click', () => {
        if (!openDoc) return;
        const blob = new Blob([`# ${openDoc.title}\n\n${openDoc.content}\n`], { type: 'text/markdown;charset=utf-8' });
        const a = el('a', { href: URL.createObjectURL(blob), download: openDoc.title.replace(/[\\/:*?"<>|]+/g, '-') + '.md' });
        document.body.append(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    });

    // Markdown of AI documents and notes: the shared safe renderer (js/appunti-common.js)
    const md = (text) => window.AppuntiCommon.md(text);

    /**
     * A quiz. Every answer is judged by the SERVER, which also keeps the first answer of each question, gives the points and
     * sends back the right answer and the explanation: the page never has them before the answer. `grade(n, k)` returns
     * {correct, answer, explanation, points, too_fast}. Questions answered in an earlier visit (my_choice) come back answered, so an
     * interrupted quiz continues where it stopped; "Ricomincia" is practice (no new points).
     */
    function renderQuiz(quiz, grade, { practice = false, noRestart = false } = {}) {
        const qs = quiz.questions || [];
        let answered = 0;
        let right = 0;
        let points = 0;
        const score = el('p', { class: 'quiz-score', text: `0 / ${qs.length}` });
        const box = el('div', {}, score);
        const paintScore = () => {
            score.textContent = `${right} / ${qs.length}` + (answered === qs.length ? ` · ${Math.round(100 * right / qs.length)}%` : answered ? ` · domanda ${Math.min(answered + 1, qs.length)} di ${qs.length}` : '')
                + (points ? ` · +${points} punti` : '');
        };
        let firstOpen = -1;
        qs.forEach((q, n) => {
            const why = el('p', { class: 'why', hidden: true, text: q.explanation || '' });
            const opts = el('div', { class: 'opts' });
            const show = (k, res) => {
                opts.dataset.done = '1';
                answered++;
                if (res.correct) right++;
                opts.children[k].classList.add(res.correct ? 'right' : 'wrong');
                if (opts.children[res.answer]) opts.children[res.answer].classList.add('right');
                why.textContent = res.explanation || '';
                why.hidden = !res.explanation;
                if (res.points) { points += res.points; why.textContent += (why.textContent ? ' ' : '') + `+${res.points} punti.`; why.hidden = false; }
                else if (res.too_fast) { why.textContent += (why.textContent ? ' ' : '') + 'Risposta troppo veloce: niente punti.'; why.hidden = false; }
                // a wrong answer: where to look in the class material (the site's own search, no AI)
                if (!res.correct) {
                    const words = (q.question || '').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3).slice(0, 6).join(' ');
                    if (words && current) { why.append(' ', el('a', { href: `appunti-archivio.php?class=${current.id}&q=${encodeURIComponent(words)}`, text: 'Cerca nel materiale' })); why.hidden = false; }
                }
                paintScore();
            };
            const choose = async (k) => {
                if (opts.dataset.done || opts.dataset.busy) return;
                opts.dataset.busy = '1';
                try { show(k, await grade(n, k)); }
                catch (e) { status(e.message, 'err'); }
                finally { delete opts.dataset.busy; }
            };
            q.options.forEach((o, k) => opts.append(el('button', { type: 'button', text: q.type === 'tf' ? o : `${'ABCD'[k]}. ${o}`, onclick: () => choose(k) })));
            // answered in an earlier visit: the server sent the answer for this question only
            if (!practice && Number.isInteger(q.my_choice) && Number.isInteger(q.answer)) show(q.my_choice, { correct: q.my_choice === q.answer, answer: q.answer, explanation: q.explanation });
            else if (firstOpen < 0) firstOpen = n;
            box.append(el('div', { class: 'quiz-q', id: `quiz-q-${n}` },
                q.topic || q.prof ? el('div', { class: 'topic' }, q.prof ? el('span', { class: 'qa-badge prof', text: 'Domanda del prof' }) : null, q.topic || '') : null,
                q.fails >= 2 ? el('div', { class: 'fails-note', text: `La stai sbagliando da un po' (${q.fails} volte): rileggi la parte degli appunti, poi riprova.` }) : null,
                el('div', { class: 'quiz-qtext' }, el('b', { text: `${n + 1}. ` }), q.question,
                    C.canSpeak() ? el('button', { type: 'button', class: 'ghost mini speak-btn', text: 'Leggi', 'aria-label': 'Leggi la domanda a voce', onclick: () => C.speak(`${q.question}. ${q.type === 'tf' ? 'Vero o falso?' : q.options.map((o, k) => `${'ABCD'[k]}: ${o}`).join('. ')}`) }) : null),
                opts, why));
        });
        points = 0;   // the points shown are the ones of this visit
        if (answered && answered < qs.length) {
            box.insertBefore(el('p', { class: 'muted small', text: `Quiz ripreso: hai già risposto a ${answered} domande.` }), score.nextSibling);
            setTimeout(() => { const t = box.querySelector('#quiz-q-' + firstOpen); if (t) t.scrollIntoView({ block: 'center' }); }, 50);
        }
        if (!noRestart && (answered === qs.length || practice)) box.append(el('button', { class: 'ghost', text: 'Ricomincia (allenamento, senza punti)',
            onclick: () => $('#doc-body').replaceChildren(renderQuiz(blank(quiz), grade, { practice: true })) }));
        return box;
    }
    /** The same quiz without what was answered, for practising again. */
    const blank = (quiz) => ({ ...quiz, questions: quiz.questions.map((q) => { const c = { ...q }; delete c.my_choice; return c; }) });

    /* ---------- calendar ---------- */

    // The agenda (tests, homework, turns, days off, topics) is drawn by js/appunti-calendario.js
    async function loadEvents() {
        $('#event-form [name="date"]').min = '';
        if (window.AppuntiCalendar) await window.AppuntiCalendar.load();
    }

    let editingEvent = null;
    function editEvent(e) {
        const f = $('#event-form');
        editingEvent = e.id;
        f.kind.value = e.kind;
        f.date.value = e.date;
        f.subject_id.value = String(e.subject_id);
        f.title.value = e.title || '';
        f.topics.value = e.topics || '';
        f.period_from.value = e.period_from || '';
        f.period_to.value = e.period_to || '';
        if (window.AppuntiCalendar) window.AppuntiCalendar.setEventTopics(e.topics_off);
        $('#event-summary').textContent = 'Modifica la data';
        $('#event-submit').textContent = 'Salva le modifiche';
        $('#event-cancel').hidden = false;
        $('#event-box').open = true;
        $('#event-box').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function resetEventForm() {
        editingEvent = null;
        $('#event-form').reset();
        if (window.AppuntiCalendar) window.AppuntiCalendar.setEventTopics([]);
        $('#event-summary').textContent = 'Aggiungi una verifica o un\'interrogazione';
        $('#event-submit').textContent = 'Aggiungi';
        $('#event-cancel').hidden = true;
    }
    $('#event-cancel').addEventListener('click', () => { resetEventForm(); $('#event-box').open = false; });

    $('#event-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const f = ev.target;
        const fields = { subject_id: Number(f.subject_id.value), kind: f.kind.value, date: f.date.value, title: f.title.value,
            topics: f.topics.value, period_from: f.period_from.value, period_to: f.period_to.value,
            topics_off: window.AppuntiCalendar ? window.AppuntiCalendar.topicsOff() : [] };
        try {
            if (editingEvent) await notes_({ action: 'edit_event', id: editingEvent, ...fields });
            else await notes_({ action: 'add_event', class_id: current.id, ...fields });
            status(editingEvent ? 'Modifiche salvate.' : 'Aggiunta al calendario.', 'ok');
            resetEventForm();
            $('#event-box').open = false;
            loadEvents();
        } catch (e) {
            status(e.json && e.json.code === 'bad_period' ? 'Materiale da studiare: il primo giorno deve venire prima dell\'ultimo, e non dopo la verifica.' : e.message, 'err');
        }
    });

    async function deleteEvent(e) {
        if (!confirm('Eliminare questa data dal calendario?')) return;
        try { await notes_({ action: 'delete_event', id: e.id }); loadEvents(); } catch (err) { status(err.message, 'err'); }
    }

    /* ---------- class tab ---------- */

    function renderClass() {
        const c = current;
        $('#admin-note').hidden = c.is_member;

        renderMembers(c);
        renderRoles(c);
        renderSubjects(c);
        $('#rep-panel').hidden = !can('roles') && !can('subjects') && !can('settings');
        $('#log-card').hidden = !can('settings');
        $('#log-details').open = false;
        $('#leave-btn').hidden = c.is_manager || !c.is_member;

        $$('.tt-manage').forEach((x) => { x.hidden = !can('timetable'); });
        if (can('timetable')) $('#tt-from').value = c.timetable ? c.timetable.valid_from : todayStr();
        renderTimetable();
    }

    $('#log-details').addEventListener('toggle', async () => {
        if (!$('#log-details').open || !current) return;
        const box = $('#log-list');
        box.replaceChildren(el('li', { class: 'muted', text: 'Carico…' }));
        try {
            const { log } = await getJson(`../api/classi.php?action=log&id=${current.id}`);
            box.replaceChildren(...(log.length ? log.map((l) => el('li', {}, el('b', { text: l.action }), l.detail ? el('span', { text: ` · ${l.detail}` }) : null, el('br'),
                el('span', { class: 'muted small', text: `${l.who} · ${new Date(l.at * 1000).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` })))
                : [el('li', { class: 'muted', text: 'Ancora niente.' })]));
        } catch (e) { box.replaceChildren(el('li', { class: 'err', text: e.message })); }
    });

    const can = (perm) => !!current && (current.perms || []).includes(perm);

    function myNameForm(c) {
        const me = c.members.find((m) => m.is_me) || null;
        const input = el('input', { name: 'name', maxLength: 40, placeholder: 'Nome e cognome', value: me ? me.display_name : '' });
        const form = el('form', { class: 'row my-name' }, el('label', { text: 'Il tuo nome in questa classe' }, input), el('button', { class: 'ghost', text: 'Salva' }));
        form.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            try { await classes_({ action: 'display_name', id: c.id, name: input.value }); await openClass(c.id); status('Nome salvato: in classe i compagni vedono questo.', 'ok'); }
            catch (e) { status(e.message, 'err'); }
        });
        return el('div', {}, form, el('p', { class: 'muted small', text: 'Lo vedono solo i compagni di questa classe; nel resto del sito resta il tuo nome utente.' }));
    }

    function roleChip(c, m) {
        if (m.is_manager) return el('span', { class: 'role rep', text: 'Rappresentante' });
        const r = c.roles.find((x) => x.id === m.role_id);
        if (!r) return null;
        const chip = el('span', { class: 'role', text: r.name });
        chip.style.setProperty('--role', r.color);
        return chip;
    }

    function renderMembers(c) {
        $('#members').replaceChildren(...c.members.map((m) => el('li', {},
            el('span', { class: 'member' }, el('b', { text: m.name }), m.name !== m.username ? el('span', { class: 'muted small', text: ` @${m.username}` }) : null,
                ' ', roleChip(c, m)),
            m.is_manager ? null : C.menu([
                can('roles') ? { label: 'Ruolo e permessi…', onclick: () => editAccess(c, m) } : null,
                can('members') ? { label: 'Cambia il nome…', onclick: () => editName(c, m) } : null,
                c.is_manager || isAdmin ? { label: 'Rendi rappresentante', onclick: () => setManager(m) } : null,
                can('members') ? { label: 'Togli dalla classe', danger: true, onclick: () => removeMember(m) } : null,
            ], `Azioni per ${m.name}`))));
    }

    const permBoxes = (c, chosen) => Object.entries(c.perm_labels).map(([k, label]) =>
        el('label', { class: 'switch perm' }, el('input', { type: 'checkbox', name: 'perm', value: k, checked: chosen.includes(k) }), label));
    const checkedPerms = (form) => [...form.querySelectorAll('input[name=perm]:checked')].map((x) => x.value);

    function editAccess(c, m) {
        C.dialogForm(`${m.name}: ruolo e permessi`, (form) => {
            form.append(el('label', { text: 'Ruolo' }, el('select', { name: 'role' },
                el('option', { value: '', text: 'Nessun ruolo' }), ...c.roles.map((r) => el('option', { value: r.id, text: r.name, selected: r.id === m.role_id })))),
            el('p', { class: 'muted small', text: 'Permessi in più, solo per questa persona (si sommano a quelli del ruolo):' }),
            ...permBoxes(c, m.perms));
        }, async (form) => {
            await classes_({ action: 'set_member_access', id: c.id, user_id: m.id, role_id: Number(form.role.value) || 0, perms: checkedPerms(form) });
            await openClass(c.id);
            status('Permessi salvati.', 'ok');
        });
    }

    function editName(c, m) {
        C.dialogForm(`Nome in classe di @${m.username}`, (form) => {
            form.append(el('label', { text: 'Nome' }, el('input', { name: 'name', maxLength: 40, value: m.display_name })));
        }, async (form) => {
            await classes_({ action: 'display_name', id: c.id, user_id: m.id, name: form.name.value });
            await openClass(c.id);
        });
    }

    function renderRoles(c) {
        $('#roles-card').hidden = !can('roles');
        if (!can('roles')) return;
        $('#roles').replaceChildren(...(c.roles.length ? c.roles.map((r) => {
            const chip = el('span', { class: 'role', text: r.name });
            chip.style.setProperty('--role', r.color);
            const who = c.members.filter((m) => m.role_id === r.id).map((m) => m.name);
            return el('li', {}, el('span', {}, chip, el('span', { class: 'muted small', text: ` ${r.perms.length} permess${r.perms.length === 1 ? 'o' : 'i'}${who.length ? ' · ' + who.join(', ') : ''}` })),
                C.menu([{ label: 'Modifica…', onclick: () => editRole(c, r) }, { label: 'Elimina', danger: true, onclick: () => deleteRole(c, r) }]));
        }) : [el('li', { class: 'muted small', text: 'Nessun ruolo: crealo con "+ Nuovo ruolo".' })]));
    }

    function editRole(c, r = null) {
        C.dialogForm(r ? `Ruolo: ${r.name}` : 'Nuovo ruolo', (form) => {
            form.append(el('div', { class: 'row' },
                el('label', { text: 'Nome' }, el('input', { name: 'name', maxLength: 30, required: true, value: r ? r.name : '', placeholder: 'Il nome del ruolo, come lo chiamate voi' })),
                el('label', { text: 'Colore' }, el('input', { type: 'color', name: 'color', value: r ? r.color : '#5b8def' }))),
            el('p', { class: 'muted small', text: 'Cosa può fare chi ha questo ruolo:' }), ...permBoxes(c, r ? r.perms : []));
        }, async (form) => {
            await classes_({ action: 'save_role', id: c.id, role_id: r ? r.id : 0, name: form.name.value, color: form.color.value, perms: checkedPerms(form) });
            await openClass(c.id);
            status('Ruolo salvato.', 'ok');
        });
    }

    async function deleteRole(c, r) {
        if (!confirm(`Eliminare il ruolo "${r.name}"? Chi lo ha resta in classe, senza ruolo.`)) return;
        try { await classes_({ action: 'delete_role', id: c.id, role_id: r.id }); await openClass(c.id); } catch (e) { status(e.message, 'err'); }
    }
    $('#role-new').addEventListener('click', () => editRole(current));

    function renderSubjects(c) {
        $('#subjects-card').hidden = !can('subjects');
        if (!can('subjects')) return;
        $('#subjects').replaceChildren(...c.subjects.map((s) => el('li', {}, el('span', { text: s.name }), C.menu([
            c.subjects.length > 1 ? { label: 'Unisci a…', onclick: () => mergeSubject(c, s) } : null,
            { label: 'Elimina', danger: true, onclick: () => deleteSubject(c, s) }]))));
    }

    function mergeSubject(c, s) {
        C.dialogForm(`Unisci "${s.name}" a…`, (form) => {
            form.append(el('label', { text: 'Materia che resta' }, el('select', { name: 'into' },
                ...c.subjects.filter((x) => x.id !== s.id).map((x) => el('option', { value: x.id, text: x.name })))),
            el('p', { class: 'muted small', text: `Il materiale, le date del calendario e le ore dell'orario di "${s.name}" passano alla materia scelta; poi "${s.name}" sparisce. I documenti dell'AI vengono rifatti al prossimo giro.` }));
        }, async (form) => {
            await classes_({ action: 'merge_subject', id: c.id, subject_id: s.id, into: Number(form.into.value) });
            await openClass(c.id);
            status('Materie unite.', 'ok');
        }, 'Unisci');
    }

    async function deleteSubject(c, s) {
        if (!confirm(`Eliminare la materia "${s.name}"? Le sue ore nell'orario diventano libere.`)) return;
        try { await classes_({ action: 'delete_subject', id: c.id, subject_id: s.id }); await openClass(c.id); status('Materia eliminata.', 'ok'); }
        catch (e) { status(e.json && e.json.code === 'not_empty' ? 'Questa materia ha del materiale: usa "Unisci a…".' : e.message, 'err'); }
    }

    async function setManager(m) {
        if (!confirm(`Far diventare ${m.name} rappresentante della classe? Tu perdi il ruolo.`)) return;
        try { await classes_({ action: 'set_manager', id: current.id, user_id: m.id }); await openClass(current.id); } catch (e) { status(e.message, 'err'); }
    }
    async function removeMember(m) {
        if (!confirm(`Togliere ${m.name} dalla classe?`)) return;
        try { await classes_({ action: 'remove_member', id: current.id, user_id: m.id }); await openClass(current.id); } catch (e) { status(e.message, 'err'); }
    }
    $('#leave-btn').addEventListener('click', async () => {
        if (!confirm('Uscire dalla classe? Per rientrare servirà di nuovo il codice.')) return;
        try { await classes_({ action: 'leave', id: current.id }); await loadMine(); } catch (e) { status(e.message, 'err'); }
    });

    /* Timetable editor: a grid like the printed timetable (days in columns, hours in rows); a cell opens a small editor */
    let tt = {};   // day ("1".."6") -> [{start, end, subject, room}]

    function ttFrom(periods, slots) {
        tt = {};
        for (let d = 1; d <= 7; d++) {
            const day = String(d);
            const bells = periods[day] || [];
            if (!bells.length) continue;
            tt[day] = bells.map((p, k) => {
                const s = slots.find((x) => x.day === d && x.period === k + 1) || {};
                return { start: p.start, end: p.end, subject: s.subject || '', room: s.room || '' };
            });
        }
    }

    const addMinutes = (hhmm, min) => {
        const [h, m] = (hhmm || '08:00').split(':').map(Number);
        const t = Math.min(23 * 60 + 59, h * 60 + m + min);
        return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    };
    const subjectHue = (name) => { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

    function renderTimetable(periods = current.periods, slots = (current.timetable && current.timetable.slots) || []) {
        if (periods) ttFrom(periods, slots);
        drawTimetable();
    }

    function drawTimetable() {
        const box = $('#tt-days');
        const days = Object.keys(tt).sort();
        const rows = Math.max(0, ...days.map((d) => tt[d].length));
        const edit = can('timetable');
        const grid = el('div', { class: 'tt-grid', style: `grid-template-columns: 34px repeat(${days.length}, minmax(96px, 1fr)) 34px` });
        grid.append(el('div', { class: 'tt-corner' }));
        for (const d of days) {
            grid.append(el('div', { class: 'tt-head' + (d === String(focusDay(days)) ? ' today' : ''), 'data-day': d }, el('b', { text: DAYS[d - 1] }),
                !edit ? null : el('span', { class: 'tt-head-actions' },
                    el('button', { type: 'button', class: 'ghost mini', text: '+ ora', title: 'Aggiungi un\'ora in fondo', onclick: () => {
                        const last = tt[d][tt[d].length - 1];
                        tt[d].push({ start: last ? last.end : '08:00', end: addMinutes(last ? last.end : '08:00', 60), subject: '', room: '' });
                        drawTimetable();
                    } }),
                    el('button', { type: 'button', class: 'ghost mini', text: '✕', title: `Togli ${DAYS[d - 1]}`, 'aria-label': `Togli ${DAYS[d - 1]}`, onclick: () => {
                        if (!confirm(`Togliere ${DAYS[d - 1]} dall'orario? (Le ore si cancellano quando premi "Salva l'orario".)`)) return;
                        delete tt[d];
                        drawTimetable();
                    } }))));
        }
        grid.append(el('div', { class: 'tt-corner' }));
        for (let r = 0; r < rows; r++) {
            grid.append(el('div', { class: 'tt-num', text: `${r + 1}ª` }));
            for (const d of days) {
                const h = tt[d][r];
                if (!h) { grid.append(el('div', { class: 'tt-cell none' })); continue; }
                const cell = el(edit ? 'button' : 'div', { type: edit ? 'button' : null, class: 'tt-cell' + (h.subject ? '' : ' empty'), onclick: edit ? () => editHour(d, r) : null },
                    el('span', { class: 'tt-time', text: `${h.start}–${h.end}` }),
                    el('b', { class: 'tt-subj', text: h.subject || (edit ? '+ materia' : '—') }),
                    h.room ? el('span', { class: 'tt-room', text: h.room }) : null);
                if (h.subject) cell.style.setProperty('--h', subjectHue(h.subject));
                grid.append(cell);
            }
            grid.append(el('div', { class: 'tt-num tt-num-end', text: `${r + 1}ª` }));
        }
        const missing = [1, 2, 3, 4, 5, 6, 7].map(String).filter((d) => !tt[d]);
        const add = missing.length && edit ? el('div', { class: 'row tt-add' },
            el('select', { 'aria-label': 'Giorno da aggiungere' }, ...missing.map((d) => el('option', { value: d, text: DAYS[d - 1] }))),
            el('button', { type: 'button', class: 'ghost', text: '+ Aggiungi giorno', onclick: (ev) => {
                const d = ev.target.previousElementSibling.value;
                const copy = tt['1'] || tt[Object.keys(tt)[0]] || [{ start: '08:00', end: '09:00' }];
                tt[d] = copy.map((h) => ({ start: h.start, end: h.end, subject: '', room: '' }));
                drawTimetable();
            } })) : null;
        box.replaceChildren(
            el('datalist', { id: 'tt-subjects' }, ...current.subjects.map((s) => el('option', { value: s.name }))),
            days.length ? el('div', { class: 'tt-scroll' }, grid) : el('p', { class: 'empty', text: edit ? 'Nessun giorno: aggiungine uno.' : 'L\'orario non c\'è ancora: lo inserisce il rappresentante della classe.' }),
            ...(add ? [add] : []));
        centerTimetable();
    }

    /** The weekday (1 = Monday) the timetable opens on: today, or the next day that has lessons (Sunday -> Monday). */
    function focusDay(days) {
        const today = (new Date().getDay() + 6) % 7 + 1;
        for (let i = 0; i < 7; i++) { const d = (today - 1 + i) % 7 + 1; if (days.includes(String(d))) return d; }
        return 0;
    }

    /** Scrolls the timetable sideways so that today's column is in the middle: no hunting for it on a phone. */
    function centerTimetable() {
        requestAnimationFrame(() => {
            const box = document.querySelector('#tt-days .tt-scroll');
            const head = box && box.querySelector('.tt-head.today');
            if (!box || !head || !box.clientWidth) return;
            box.scrollLeft = head.offsetLeft - (box.clientWidth - head.offsetWidth) / 2;
        });
    }

    /** The small editor of one hour: subject, room, times; or remove the hour. */
    function editHour(day, idx) {
        const h = tt[day][idx];
        const dlg = el('dialog', { class: 'tt-dialog' });
        const form = el('form', { method: 'dialog', class: 'stack' },
            el('h3', { text: `${DAYS[day - 1]}, ${idx + 1}ª ora` }),
            el('label', { text: 'Materia' }, el('input', { name: 'subject', value: h.subject, list: 'tt-subjects', maxLength: 60, placeholder: 'Vuoto = ora libera' })),
            el('label', { text: 'Aula (facoltativa)' }, el('input', { name: 'room', value: h.room, maxLength: 30 })),
            el('div', { class: 'grid2' },
                el('label', { text: 'Inizio' }, el('input', { type: 'time', name: 'start', value: h.start, required: true })),
                el('label', { text: 'Fine' }, el('input', { type: 'time', name: 'end', value: h.end, required: true }))),
            el('label', { class: 'switch' }, el('input', { type: 'checkbox', name: 'all' }), `Stessi orari per la ${idx + 1}ª ora di tutti i giorni`),
            el('div', { class: 'row' },
                el('button', { value: 'save', text: 'Salva' }),
                el('button', { type: 'button', class: 'ghost', text: 'Annulla', onclick: () => dlg.close() }),
                el('button', { type: 'button', class: 'danger', text: 'Togli quest\'ora', onclick: () => {
                    tt[day].splice(idx, 1);
                    if (!tt[day].length) delete tt[day];
                    dlg.close();
                    drawTimetable();
                } })));
        form.addEventListener('submit', (ev) => {
            if (!form.start.value || !form.end.value || form.start.value >= form.end.value) { ev.preventDefault(); status('L\'ora deve finire dopo l\'inizio.', 'err'); return; }
            Object.assign(h, { subject: form.subject.value.trim(), room: form.room.value.trim(), start: form.start.value, end: form.end.value });
            if (form.all.checked) Object.values(tt).forEach((list) => { if (list[idx]) Object.assign(list[idx], { start: h.start, end: h.end }); });
            drawTimetable();
        });
        dlg.append(form);
        dlg.addEventListener('close', () => dlg.remove());
        dlg.addEventListener('click', (ev) => { if (ev.target === dlg) dlg.close(); });   // tap outside closes
        document.body.append(dlg);
        dlg.showModal();
        if (!window.matchMedia('(pointer: coarse)').matches) form.subject.focus();
    }

    $('#tt-read').addEventListener('click', async () => {
        const files = [...$('#tt-files').files];
        if (!files.length) { status('Scegli prima la foto o il PDF dell\'orario.', 'err'); return; }
        const fd = new FormData();
        fd.set('action', 'read_timetable');
        fd.set('id', current.id);
        files.slice(0, 3).forEach((f) => fd.append('files[]', f, f.name));
        const btn = $('#tt-read');
        btn.disabled = true;
        status('Leggo l\'orario… può volerci fino a due minuti.');
        try {
            const r = await post('../api/classi.php', fd);
            renderTimetable(r.periods, r.slots);
            status(`Letto${r.model ? ` con ${r.model}` : ''}: ${r.slots.length} ore${r.bells_read ? ' e gli orari della campanella' : ' (orari della campanella non trovati: controllali)'}. `
                + 'Controlla la tabella e premi "Salva l\'orario".' + (r.notes ? ` Nota dell'AI: ${r.notes}` : ''), 'ok');
            $('#tt-days').scrollIntoView({ behavior: 'smooth' });
        } catch (e) {
            const msg = { ai_off: 'L\'AI non è attiva sul server.', ai_quota: 'L\'AI ha finito le richieste di oggi: riprova domani o compila a mano.',
                ai_failed: 'L\'AI non è riuscita a leggere l\'orario: riprova tra poco.', bad_type: 'Usa una foto o un PDF.',
                ai_busy: 'Gemini è sovraccarico in questo momento (succede, è un problema di Google): riprova tra qualche minuto.',
                ai_unreadable: null,
                slow_down: 'Troppi tentativi: riprova tra un\'ora.' };
            status((e.json && msg[e.json.code]) || e.message, 'err');
        } finally {
            btn.disabled = false;
        }
    });

    $('#tt-save').addEventListener('click', async () => {
        const periods = {};
        const slots = [];
        for (let d = 1; d <= 7; d++) {
            const day = String(d);
            periods[day] = (tt[day] || []).map((h) => ({ start: h.start, end: h.end }));
            (tt[day] || []).forEach((h, i) => { if (h.subject) slots.push({ day: d, period: i + 1, subject: h.subject, label: '', room: h.room }); });
        }
        try {
            await classes_({ action: 'save_timetable', id: current.id, valid_from: $('#tt-from').value, periods, slots });
            await openClass(current.id);
            status('Orario salvato.', 'ok');
        } catch (e) { status(e.message, 'err'); }
    });

    /* ---------- join / request ---------- */

    async function join(ev) {
        ev.preventDefault();
        try {
            const r = await classes_({ action: 'join', code: ev.target.code.value });
            ev.target.reset();
            status(`Sei entrato in ${r.name}.`, 'ok');
            await loadMine(r.id);
        } catch (e) { status(e.message, 'err'); }
    }
    $('#join-form').addEventListener('submit', join);

    $('#request-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const f = ev.target;
        try {
            await classes_({ action: 'request', name: f.name.value, school: f.school.value, note: f.note.value });
            f.reset();
            status('Richiesta inviata: la vedrai attiva quando l\'amministratore la approva.', 'ok');
            await loadMine(current && current.id);
            $('#welcome').hidden = false;
        } catch (e) { status(e.message, 'err'); }
    });

    /* ---------- admin ---------- */

    async function loadAdmin() {
        try {
            const all = await getJson('../api/classi.php?action=all');
            $('#requests-open').checked = all.requests_open;
            const lf = $('#limits-form');
            lf.file_mb.value = all.default_limits_mb.file;
            lf.class_mb.value = all.default_limits_mb.class;
            const pending = all.classes.filter((c) => c.status === 'pending');
            $('#admin-requests').replaceChildren(...(pending.length ? pending.map((c) => el('li', {},
                el('span', {}, el('b', { text: `${c.name} · ${c.school}` }), el('br'),
                    el('span', { class: 'muted small', text: `da ${c.manager || '?'}${c.note ? ' — ' + c.note : ''}` })),
                el('span', {},
                    el('button', { class: 'mini', text: 'Approva', onclick: () => decide(c, true) }), ' ',
                    el('button', { class: 'danger mini', text: 'Rifiuta', onclick: () => decide(c, false) }))))
                : [el('li', { class: 'muted', text: 'Nessuna richiesta in attesa.' })]));
            const stLabel = { active: 'attiva', pending: 'in attesa', rejected: 'rifiutata' };
            $('#admin-classes').replaceChildren(...all.classes.filter((c) => c.status !== 'pending').map((c) => el('li', {},
                el('span', {}, el('b', { text: `${c.name} · ${c.school}` }), el('br'),
                    el('span', { class: 'muted small', text: `${stLabel[c.status] || c.status} · ${c.members} iscritti · rappresentante ${c.manager || '?'} · ${c.limits_mb.file} MB/file, ${c.limits_mb.class} MB` })),
                el('button', { class: 'danger mini', text: 'Elimina', onclick: () => deleteClass(c) }))));
        } catch (e) { status(e.message, 'err'); }
    }
    async function decide(c, approve) {
        try { await classes_({ action: 'decide', id: c.id, approve }); status(approve ? 'Classe approvata.' : 'Richiesta rifiutata.', 'ok'); loadAdmin(); } catch (e) { status(e.message, 'err'); }
    }
    async function deleteClass(c) {
        if (!confirm(`Eliminare ${c.name} (${c.school}) con TUTTO il materiale? Non si può annullare.`)) return;
        try { await classes_({ action: 'delete_class', id: c.id }); status('Classe eliminata.', 'ok'); await loadMine(); showTab('admin'); } catch (e) { status(e.message, 'err'); }
    }
    $('#requests-open').addEventListener('change', async (ev) => {
        try { await classes_({ action: 'set_requests_open', open: ev.target.checked }); status(ev.target.checked ? 'Richieste aperte.' : 'Richieste chiuse.', 'ok'); } catch (e) { status(e.message, 'err'); }
    });
    $('#limits-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        try {
            await classes_({ action: 'set_limits', file_mb: Number(ev.target.file_mb.value), class_mb: Number(ev.target.class_mb.value) });
            status('Limiti salvati.', 'ok');
            loadAdmin();
        } catch (e) { status(e.message, 'err'); }
    });


    /* ---------- notifications: bell and push ---------- */

    // The notification list, the device switch and the choices live on the settings page; here only the badge on its button.
    async function loadNotifs() {
        try {
            const r = await getJson('../api/notifiche.php?action=list');
            const badge = $('#bell-count');
            badge.hidden = r.unread === 0;
            badge.textContent = r.unread > 9 ? '9+' : String(r.unread);
        } catch (e) { /* offline: try later */ }
    }
    setInterval(() => { if (document.visibilityState === 'visible') loadNotifs(); }, 60000);

    /** ?class=ID&tab=study (links from notifications) */
    async function applyParams(params) {
        const cid = Number(params.get('class'));
        const tab = params.get('tab') || startTab;
        if (cid && classes.some((c) => c.id === cid) && (!current || current.id !== cid)) {
            $('#class-select').value = String(cid);
            await openClass(cid);
        }
        if (tab && ['board', 'material', 'study', 'calendar', 'class', 'score'].includes(tab) && current) showTab(tab);
        // a reload (or coming back from another page) reopens the document you were reading
        const lastDoc = Number(stored(DOC_KEY));
        if (!params.get('tab') && tab === 'study' && lastDoc && current) {
            try { await showDoc(lastDoc); } catch (e) { store(DOC_KEY, ''); }
            if ($('#doc-view').hidden) store(DOC_KEY, '');
        }
    }

    /* ---------- start ---------- */

    $$('#tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
    $('#class-select').addEventListener('change', (ev) => { openClass(Number(ev.target.value)).catch((e) => status(e.message, 'err')); });
    const startParams = new URLSearchParams(location.search);
    // For the calendar module (js/appunti-calendario.js)
    window.AppuntiPage = { get current() { return current; }, editEvent, deleteEvent, hue, showTab,
        me: () => { const m = current && current.members.find((x) => x.is_me); return m ? m.id : 0; } };

    // files dropped anywhere on the page go to the upload page (only for who is in a class)
    window.VBDrop.attach({ label: 'Mettili qui', hint: 'si aprono nella pagina Carica', onFiles: (files) => { if (current) C.handOff(files); else C.toast('Per caricare devi far parte di una classe.', 'err'); } });
    loadMine(Number(startParams.get('class')) || null)
        .then(() => applyParams(startParams))
        .catch((e) => status(e.message, 'err'));
    loadNotifs();
})();
