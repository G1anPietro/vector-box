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
    const DAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
    const STORE_KEY = 'vb_appunti_class';

    let classes = [];
    let current = null;          // class detail from api/classi.php
    let currentTab = 'material';

    /* ---------- helpers ---------- */

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
        not_manager: 'Solo il responsabile può farlo.',
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
        sel.replaceChildren(...classes.map((c) => el('option', { value: c.id, text: `${c.name} · ${c.school}` })));
        sel.parentElement.hidden = classes.length === 0;
        $('[data-tab="admin"]').hidden = !mine.is_admin;

        $('#request-form').hidden = !mine.requests_open && !mine.is_admin;
        $('#requests-closed').hidden = mine.requests_open || mine.is_admin;
        const reqStatus = { pending: 'in attesa di approvazione', rejected: 'rifiutata' };
        $('#my-requests').replaceChildren(...mine.requests.map((r) =>
            el('li', {}, el('span', { text: `Richiesta: ${r.name} · ${r.school}` }), el('span', { class: 'muted small', text: reqStatus[r.status] || r.status }))));

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
        $$('#tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
        $$('.tab').forEach((t) => { t.hidden = t.id !== 'tab-' + name; });
        status('');
        if (name === 'material' && current) { $('#upload-link').href = caricaUrl(); loadItems(); }
        if (name === 'calendar' && current) loadEvents();
        if (name === 'study' && current) loadStudy();
        if (name === 'class' && current) renderClass();
        if (name === 'admin') loadAdmin();
    }

    /* ---------- material: uploads happen on pages/appunti-carica.php ---------- */

    const caricaUrl = (params = {}) => 'appunti-carica.php?' + new URLSearchParams({ class: current.id, ...params });

    /* ---------- material: list ---------- */

    /** Downloads a .zip of the material (and the AI documents, and PROMPT.txt) for a lesson day, a subject or a test. */
    async function downloadZip(params, btn, action = 'zip') {
        const q = new URLSearchParams({ action, class_id: current.id, ...params });
        if (btn) btn.disabled = true;
        status(action === 'zip' ? 'Preparo lo .zip…' : 'Preparo il file per l\'AI…');
        try {
            const r = await fetch('../api/appunti.php?' + q, { credentials: 'same-origin' });
            if (!r.ok) {
                const j = await r.json().catch(() => null);
                throw new Error(j && j.code === 'nothing' ? j.error : errText(j, 'Download non riuscito.'));
            }
            const cd = r.headers.get('content-disposition') || '';
            const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
            const name = m ? decodeURIComponent(m[1]) : (action === 'zip' ? 'appunti.zip' : 'appunti-per-AI.md');
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
                    el('span', { class: 'row-actions' },
                        el('button', { class: 'ghost mini', type: 'button', text: '↓ Per AI', title: 'Un file .md con tutto il testo e i prompt, da dare a un\'altra AI',
                            onclick: (ev) => downloadZip(sid ? { scope: 'day', date: d, subject_id: sid } : { scope: 'day', date: d }, ev.target, 'ai_pack') }),
                        el('button', { class: 'ghost mini', type: 'button', text: '↓ .zip', title: 'Scarica tutto il materiale originale di questo giorno',
                            onclick: (ev) => downloadZip(sid ? { scope: 'day', date: d, subject_id: sid } : { scope: 'day', date: d }, ev.target) }))),
                ...list.map(renderItem))));
        } catch (e) {
            box.replaceChildren(el('p', { class: 'empty', text: e.message }));
        }
    }
    $('#filter-subject').addEventListener('change', () => {
        $('#zip-subject').hidden = $('#ai-subject').hidden = !$('#filter-subject').value;
        loadItems();
    });
    $('#zip-subject').addEventListener('click', (ev) => downloadZip({ scope: 'subject', subject_id: $('#filter-subject').value }, ev.target));
    $('#ai-subject').addEventListener('click', (ev) => downloadZip({ scope: 'subject', subject_id: $('#filter-subject').value }, ev.target, 'ai_pack'));
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
            it.can_edit ? el('div', { class: 'actions' },
                el('button', { class: 'ghost mini', text: 'Modifica', onclick: () => editItem(it, card) }),
                el('button', { class: 'danger mini', text: 'Elimina', onclick: () => deleteItem(it) })) : null);
        card.style.setProperty('--sub', hue(it.subject_id));
        return card;
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

    const DOC_KINDS = { completo: 'Completo', riassunto: 'Riassunto', preparazione: 'Preparazione', quiz: 'Quiz', lezione: 'Lezione', schema: 'Schema' };
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
            renderStudyTests(ev.events.filter((e) => e.date >= ev.today && e.kind !== 'altro'), d.ai);
            renderStudyLessons();
        } catch (e) { status(e.message, 'err'); }
    }

    function renderAiBar(ai) {
        const bar = $('#ai-bar');
        if (!ai.configured) { bar.replaceChildren(el('p', { class: 'muted', text: 'L\'AI non è ancora attiva su questo server: i riassunti arriveranno appena viene accesa.' })); return; }
        const now = Date.now() / 1000;
        const wait = ai.next_manual_at > now;
        const at = new Date(ai.next_manual_at * 1000).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
        const btn = el('button', { text: ai.requested ? 'In coda…' : 'Genera ora', disabled: ai.requested || wait, onclick: generateNow });
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
        bar.replaceChildren(
            el('p', {}, el('b', { text: `Riassunto automatico ogni giorno alle ${ai.summary_time}.` }),
                el('br'), el('span', { class: 'muted small', text:
                    (ai.pending_files ? `${ai.pending_files} file da trascrivere. ` : '')
                    + (ai.requested ? 'Richiesta in coda: ci vuole qualche minuto.' : wait ? `"Genera ora" di nuovo alle ${at}.` : 'Puoi chiedere di farlo subito (una volta l\'ora).') }),
                last ? el('br') : null, last),
            btn);
    }

    async function generateNow() {
        try {
            await notes_({ action: 'generate', class_id: current.id });
            status('Richiesta inviata: i documenti arrivano entro qualche minuto.', 'ok');
        } catch (e) {
            status(e.json && e.json.code === 'too_soon' ? 'Già chiesto nell\'ultima ora.' : e.json && e.json.code === 'ai_off' ? 'L\'AI non è attiva.' : e.message, 'err');
        }
        loadStudy();
    }

    function renderStudyTests(events, ai) {
        const box = $('#study-tests');
        if (!events.length) { box.replaceChildren(el('p', { class: 'empty', text: 'Nessuna verifica in calendario. Aggiungile nella scheda Calendario: i documenti per studiare si preparano da soli.' })); return; }
        box.replaceChildren(...events.map((e) => {
            const docs = DOC_ORDER.map((k) => studyDocs.find((d) => d.event_id === e.id && d.kind === k && !d.manual)).filter(Boolean)
                .concat(studyDocs.filter((d) => d.event_id === e.id && d.manual));
            const d = parseDate(e.date);
            return el('div', { class: 'test-card' },
                el('div', { class: 'what' }, el('span', { class: 'badge ' + e.kind, text: EVENT_KINDS[e.kind] }), el('b', { text: e.subject }),
                    ` · ${dayFmt.format(d)}`, e.title ? ` · ${e.title}` : ''),
                docs.length
                    ? el('div', { class: 'docs' }, ...docs.map((doc) => el('button', {
                        class: doc.status !== 'ok' ? 'ghost' : doc.manual ? 'manual' : '',
                        text: DOC_KINDS[doc.kind] + (doc.manual ? ` · di ${doc.author || '?'}` : '') + (doc.status === 'ok' ? '' : ' (errore)'),
                        disabled: doc.status !== 'ok', onclick: () => showDoc(doc.id) })))
                    : el('p', { class: 'muted small', text: ai.configured
                        ? `I documenti arrivano con il prossimo riassunto (alle ${ai.summary_time}) o con "Genera ora", se c'è materiale caricato.`
                        : 'I documenti arriveranno quando l\'AI sarà attiva.' }),
                el('div', { class: 'row' },
                    el('button', { class: 'ghost mini', type: 'button', text: '↓ Per un\'altra AI (.md)',
                        onclick: (ev) => downloadZip({ scope: 'event', event_id: e.id }, ev.target, 'ai_pack') }),
                    el('button', { class: 'ghost mini', type: 'button', text: '↓ Tutto il materiale (.zip)',
                        onclick: (ev) => downloadZip({ scope: 'event', event_id: e.id }, ev.target) }),
                    el('a', { class: 'ghost-link mini-link', href: caricaUrl({ m: 'ai', event: e.id }), text: '+ Carica un documento fatto con un\'altra AI' })));
        }));
    }

    function renderStudyLessons() {
        const sid = Number($('#study-subject').value) || 0;
        const list = studyDocs.filter((d) => d.kind === 'lezione' && (!sid || d.subject_id === sid));
        const box = $('#study-lessons');
        if (!list.length) { box.replaceChildren(el('p', { class: 'empty', text: 'Ancora nessun riassunto delle lezioni.' })); return; }
        box.replaceChildren(...list.map((d) => el('div', { class: 'doc-row' },
            el('span', {}, el('b', { text: d.subject }), ' · ', d.lesson_date ? dayFmt.format(parseDate(d.lesson_date)) : '',
                d.manual ? el('span', { class: 'muted small', text: ` · caricato da ${d.author || '?'}` }) : null,
                d.status !== 'ok' ? el('span', { class: 'err', text: ' (non riuscito, riprova più tardi)' }) : null),
            el('span', { class: 'row-actions' },
                el('button', { class: 'ghost mini', text: 'Apri', disabled: d.status !== 'ok', onclick: () => showDoc(d.id) }),
                ...studyDocs.filter((x) => x.kind === 'schema' && !x.event_id && x.status === 'ok' && x.subject_id === d.subject_id && x.lesson_date === d.lesson_date)
                    .slice(0, 1).map((x) => el('button', { class: 'ghost mini', text: '🧠 Schema', onclick: () => showDoc(x.id) })),
                d.can_delete ? el('button', { class: 'danger mini', text: 'Elimina', onclick: () => deleteDoc(d) }) : null))));
    }
    $('#study-subject').addEventListener('change', renderStudyLessons);

    async function deleteDoc(d) {
        if (!confirm('Eliminare questo documento caricato a mano?')) return;
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
                body.replaceChildren(quiz ? renderQuiz(quiz) : el('p', { text: 'Quiz non leggibile.' }));
            } else if (doc.kind === 'schema') {
                body.replaceChildren(window.AppuntiCommon.renderSchema(doc.content));
            } else {
                body.replaceChildren(md(doc.content));
            }
            $('#doc-download').hidden = doc.kind === 'quiz' || doc.kind === 'schema';
            $('#doc-sources').hidden = !doc.sources.length;
            const kinds = { appunti: 'appunti', slide: 'slide del prof', libro: 'libro', domande: 'domande del prof', prova: 'verifica di prova', altro: 'altro' };
            $('#doc-sources-list').replaceChildren(...doc.sources.map((s) => el('li', { value: s.n,
                text: `${kinds[s.kind] || s.kind} di ${s.author || '?'}${s.title ? ' — ' + s.title : ''}` })));
            window.scrollTo(0, 0);
        } catch (e) { status(e.message, 'err'); }
    }
    $('#doc-back').addEventListener('click', () => { $('#doc-view').hidden = true; $('#study-list').hidden = false; });
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

    function renderQuiz(quiz) {
        const qs = quiz.questions || [];
        let answered = 0;
        let right = 0;
        const score = el('p', { class: 'quiz-score', text: `0 / ${qs.length}` });
        const box = el('div', {}, score);
        qs.forEach((q, n) => {
            const why = el('p', { class: 'why', hidden: true, text: q.explanation });
            const opts = el('div', { class: 'opts' });
            q.options.forEach((o, k) => opts.append(el('button', { type: 'button', text: `${'ABCD'[k]}. ${o}`, onclick: (ev) => {
                if (opts.dataset.done) return;
                opts.dataset.done = '1';
                answered++;
                if (k === q.answer) right++;
                ev.target.classList.add(k === q.answer ? 'right' : 'wrong');
                opts.children[q.answer].classList.add('right');
                why.hidden = !q.explanation;
                score.textContent = `${right} / ${qs.length}` + (answered === qs.length ? ` · ${Math.round(100 * right / qs.length)}%` : '');
            } })));
            box.append(el('div', { class: 'quiz-q' },
                q.topic ? el('div', { class: 'topic', text: q.topic }) : null,
                el('div', {}, el('b', { text: `${n + 1}. ` }), q.question), opts, why));
        });
        box.append(el('button', { class: 'ghost', text: 'Ricomincia', onclick: () => $('#doc-body').replaceChildren(renderQuiz(quiz)) }));
        return box;
    }

    /* ---------- calendar ---------- */

    async function loadEvents() {
        const box = $('#events');
        $('#event-form [name="date"]').min = '';
        try {
            const { events, today } = await getJson(`../api/appunti.php?action=events&class_id=${current.id}`);
            if (!events.length) { box.replaceChildren(el('p', { class: 'empty', text: 'Nessuna verifica in calendario.' })); return; }
            const t0 = parseDate(today);
            const upcoming = events.filter((e) => e.date >= today);
            const past = events.filter((e) => e.date < today).reverse();
            const row = (e) => {
                const d = parseDate(e.date);
                const diff = Math.round((d - t0) / 86400000);
                const soon = diff === 0 ? 'oggi' : diff === 1 ? 'domani' : diff > 1 && diff <= 14 ? `tra ${diff} giorni` : '';
                return el('div', { class: 'event' + (e.date < today ? ' past' : '') },
                    el('div', { class: 'date' }, el('span', { text: shortDay.format(d) }), el('b', { text: String(d.getDate()) }), el('span', { text: shortMonth.format(d) })),
                    el('div', {},
                        el('div', { class: 'what' }, el('span', { class: 'badge ' + e.kind, text: EVENT_KINDS[e.kind] || e.kind }), e.subject,
                            e.title ? ` · ${e.title}` : '', soon ? el('span', { class: 'soon', text: ` · ${soon}` }) : null),
                        e.topics ? el('div', { class: 'topics', text: e.topics }) : null,
                        el('div', { class: 'muted small' }, `aggiunta da ${e.author || '?'}`,
                            e.can_edit ? el('button', { class: 'danger mini', style: 'margin-left:10px', text: 'Elimina', onclick: () => deleteEvent(e) }) : null)));
            };
            box.replaceChildren(
                upcoming.length ? el('div', {}, ...upcoming.map(row)) : el('p', { class: 'empty', text: 'Nessuna verifica in arrivo.' }),
                ...(past.length ? [el('details', {}, el('summary', { text: `Passate (${past.length})` }), ...past.map(row))] : []));
        } catch (e) {
            box.replaceChildren(el('p', { class: 'empty', text: e.message }));
        }
    }

    $('#event-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const f = ev.target;
        try {
            await notes_({ action: 'add_event', class_id: current.id, subject_id: Number(f.subject_id.value), kind: f.kind.value,
                date: f.date.value, title: f.title.value, topics: f.topics.value });
            f.reset();
            status('Aggiunta al calendario.', 'ok');
            loadEvents();
        } catch (e) { status(e.message, 'err'); }
    });

    async function deleteEvent(e) {
        if (!confirm('Eliminare questa data dal calendario?')) return;
        try { await notes_({ action: 'delete_event', id: e.id }); loadEvents(); } catch (err) { status(err.message, 'err'); }
    }

    /* ---------- class tab ---------- */

    function renderClass() {
        const c = current;
        const info = $('#class-info');
        info.replaceChildren(
            el('h2', { text: `${c.name} · ${c.school}` }),
            c.invite_code ? el('div', {},
                el('p', { class: 'muted small', text: 'Codice d\'invito (dallo solo ai compagni):' }),
                el('div', { class: 'row' }, el('span', { class: 'code', text: c.invite_code }),
                    el('button', { class: 'ghost mini', text: 'Copia', onclick: () => navigator.clipboard && navigator.clipboard.writeText(c.invite_code).then(() => status('Codice copiato.', 'ok')) }),
                    el('button', { class: 'ghost mini', text: 'Nuovo codice', onclick: regenCode })))
                : el('p', { class: 'muted small', text: 'Il codice d\'invito lo ha il responsabile della classe.' }),
            el('p', { class: 'muted small', text: `Riassunto automatico ogni giorno alle ${c.summary_time}.` }));

        $('#members').replaceChildren(...c.members.map((m) => el('li', {},
            el('span', {}, m.username, m.is_manager ? el('span', { class: 'role', text: 'responsabile' }) : null),
            c.can_manage && !m.is_manager ? el('span', {},
                el('button', { class: 'ghost mini', text: 'Rendi responsabile', onclick: () => setManager(m) }), ' ',
                el('button', { class: 'danger mini', text: 'Togli', onclick: () => removeMember(m) })) : null)));
        $('#leave-btn').hidden = c.is_manager;

        $('#manage-box').hidden = !c.can_manage;
        if (c.can_manage) {
            $('#settings-form').summary_time.value = c.summary_time;
            $('#tt-from').value = c.timetable ? c.timetable.valid_from : todayStr();
            renderTimetable();
        }
    }

    async function regenCode() {
        if (!confirm('Il codice vecchio smetterà di funzionare. Continuare?')) return;
        try { await classes_({ action: 'regen_code', id: current.id }); await openClass(current.id); status('Nuovo codice creato.', 'ok'); } catch (e) { status(e.message, 'err'); }
    }
    async function setManager(m) {
        if (!confirm(`Passare la gestione della classe a ${m.username}?`)) return;
        try { await classes_({ action: 'set_manager', id: current.id, user_id: m.id }); await openClass(current.id); } catch (e) { status(e.message, 'err'); }
    }
    async function removeMember(m) {
        if (!confirm(`Togliere ${m.username} dalla classe?`)) return;
        try { await classes_({ action: 'remove_member', id: current.id, user_id: m.id }); await openClass(current.id); } catch (e) { status(e.message, 'err'); }
    }
    $('#leave-btn').addEventListener('click', async () => {
        if (!confirm('Uscire dalla classe? Per rientrare servirà di nuovo il codice.')) return;
        try { await classes_({ action: 'leave', id: current.id }); await loadMine(); } catch (e) { status(e.message, 'err'); }
    });

    $('#settings-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        try {
            await classes_({ action: 'settings', id: current.id, summary_time: ev.target.summary_time.value, timezone: current.timezone });
            await openClass(current.id);
            status('Salvato.', 'ok');
        } catch (e) { status(e.message, 'err'); }
    });

    function ttRow(p = {}, slot = {}) {
        const row = el('div', { class: 'tt-row' },
            el('span', { class: 'n' }),
            el('input', { type: 'time', class: 'start', value: p.start || '', 'aria-label': 'Inizio', required: true }),
            el('input', { type: 'time', class: 'end', value: p.end || '', 'aria-label': 'Fine', required: true }),
            el('input', { class: 'subject', value: slot.subject || '', placeholder: 'Materia', 'aria-label': 'Materia', maxLength: 60, list: 'tt-subjects' }),
            el('input', { class: 'label', value: slot.label || '', placeholder: 'Etichetta', 'aria-label': 'Etichetta', maxLength: 30 }),
            el('input', { class: 'room', value: slot.room || '', placeholder: 'Aula', 'aria-label': 'Aula', maxLength: 30 }),
            el('button', { type: 'button', class: 'ghost mini', text: '×', 'aria-label': 'Togli l\'ora', onclick: () => { row.remove(); numberRows(); } }));
        return row;
    }
    function numberRows() { $$('.tt-day').forEach((d) => $$('.tt-row', d).forEach((r, i) => { $('.n', r).textContent = `${i + 1}ª`; })); }

    function renderTimetable(periods = current.periods, slots = (current.timetable && current.timetable.slots) || []) {
        const box = $('#tt-days');
        const datalist = el('datalist', { id: 'tt-subjects' }, ...current.subjects.map((s) => el('option', { value: s.name })));
        const days = DAYS.map((name, i) => {
            const day = String(i + 1);
            const rowsBox = el('div', { class: 'rows' });
            (periods[day] || []).forEach((p, k) => {
                rowsBox.append(ttRow(p, slots.find((s) => s.day === i + 1 && s.period === k + 1) || {}));
            });
            return el('div', { class: 'tt-day', 'data-day': day },
                el('h4', {}, name, el('span', {},
                    i > 0 ? el('button', { type: 'button', class: 'ghost mini', text: 'Orari come lunedì', onclick: () => copyBells(rowsBox) }) : null, ' ',
                    el('button', { type: 'button', class: 'ghost mini', text: '+ ora', onclick: () => { addRow(rowsBox); } }))),
                rowsBox);
        });
        box.replaceChildren(datalist, ...days);
        numberRows();
    }
    function addRow(rowsBox) {
        const last = $$('.tt-row', rowsBox).pop();
        const start = last ? $('.end', last).value : '08:00';
        const [h, m] = (start || '08:00').split(':').map(Number);
        const endMin = h * 60 + m + 60;
        rowsBox.append(ttRow({ start, end: `${String(Math.floor(endMin / 60) % 24).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}` }));
        numberRows();
    }
    function copyBells(rowsBox) {
        const monday = $$('.tt-day[data-day="1"] .tt-row');
        const rows = $$('.tt-row', rowsBox);
        monday.forEach((mr, i) => {
            const r = rows[i] || rowsBox.appendChild(ttRow());
            $('.start', r).value = $('.start', mr).value;
            $('.end', r).value = $('.end', mr).value;
        });
        rows.slice(monday.length).forEach((r) => r.remove());
        numberRows();
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
        for (const d of $$('.tt-day')) {
            const day = d.dataset.day;
            periods[day] = [];
            $$('.tt-row', d).forEach((r, i) => {
                periods[day].push({ start: $('.start', r).value, end: $('.end', r).value });
                const subject = $('.subject', r).value.trim();
                if (subject) slots.push({ day: Number(day), period: i + 1, subject, label: $('.label', r).value.trim(), room: $('.room', r).value.trim() });
            });
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
    $('#join-form-2').addEventListener('submit', join);

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
    $('#show-request').addEventListener('click', () => {
        $('#welcome').hidden = false;
        $('#request-box').open = true;
        $('#welcome').scrollIntoView({ behavior: 'smooth' });
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
                    el('span', { class: 'muted small', text: `${stLabel[c.status] || c.status} · ${c.members} iscritti · responsabile ${c.manager || '?'} · ${c.limits_mb.file} MB/file, ${c.limits_mb.class} MB` })),
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

    const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    let notifs = [];
    let devices = 0;

    function b64uToBytes(s) {
        const raw = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
        return Uint8Array.from(raw, (c) => c.charCodeAt(0));
    }

    async function loadNotifs() {
        try {
            const r = await getJson('../api/notifiche.php?action=list');
            notifs = r.notifications;
            devices = r.devices;
            const badge = $('#bell-count');
            badge.hidden = r.unread === 0;
            badge.textContent = r.unread > 9 ? '9+' : String(r.unread);
            if (!$('#notif-panel').hidden) renderNotifs();
        } catch (e) { /* offline: try later */ }
    }

    function renderNotifs() {
        const when = (t) => new Date(t * 1000).toLocaleString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        $('#notif-list').replaceChildren(...(notifs.length ? notifs.map((n) => el('li', { class: n.read ? '' : 'unread', onclick: () => openNotif(n) },
            el('b', { text: n.title }), el('br'), n.body ? el('span', { text: n.body }) : null, el('br'), el('span', { class: 'when', text: when(n.created_at) })))
            : [el('li', { class: 'muted', text: 'Nessuna notifica. Qui arrivano i promemoria delle verifiche (2 giorni prima, il giorno prima e la sera prima).' })]));
        renderPushBox();
    }

    function openNotif(n) {
        $('#notif-panel').hidden = true;
        const u = new URL(n.url || '/pages/appunti.php', location.origin);
        if (u.origin !== location.origin) return;
        if (u.pathname === location.pathname) applyParams(u.searchParams);
        else location.href = u.href;
    }

    async function renderPushBox() {
        const box = $('#push-box');
        if (!pushSupported) {
            box.replaceChildren(el('span', { text: isIos && !isStandalone
                ? 'Per ricevere i promemoria sull\'iPhone: tocca Condividi → "Aggiungi alla schermata Home", poi apri gli Appunti da quell\'icona e attiva qui le notifiche.'
                : 'Questo browser non supporta le notifiche push: i promemoria li trovi comunque qui, nella campanella.' }));
            return;
        }
        let sub = null;
        try { const reg = await navigator.serviceWorker.getRegistration('./'); sub = reg && await reg.pushManager.getSubscription(); } catch (e) { /* none */ }
        if (Notification.permission === 'denied') {
            box.replaceChildren(el('span', { text: 'Hai bloccato le notifiche per questo sito: riattivale dalle impostazioni del browser (lucchetto accanto all\'indirizzo).' }));
            return;
        }
        box.replaceChildren(sub
            ? el('div', {}, el('span', { text: `Notifiche attive su questo dispositivo${devices > 1 ? ` (e su altri ${devices - 1})` : ''}.` }),
                el('div', { class: 'row' }, el('button', { class: 'ghost mini', text: 'Manda una prova', onclick: testPush }),
                    el('button', { class: 'ghost mini', text: 'Disattiva qui', onclick: disablePush })))
            : el('div', {}, el('span', { text: 'Ricevi i promemoria delle verifiche anche a sito chiuso.' }),
                el('div', { class: 'row' }, el('button', { class: 'mini', text: 'Attiva le notifiche su questo dispositivo', onclick: enablePush }))));
    }

    async function enablePush() {
        try {
            if (await Notification.requestPermission() !== 'granted') { status('Senza il permesso del browser le notifiche non possono arrivare.', 'err'); renderPushBox(); return; }
            const reg = await navigator.serviceWorker.register('appunti-sw.js', { scope: './' });
            await navigator.serviceWorker.ready;
            const { public_key: key } = await getJson('../api/notifiche.php?action=vapid');
            let sub = await reg.pushManager.getSubscription();
            if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(key) });
            const j = sub.toJSON();
            await post('../api/notifiche.php', { action: 'subscribe', endpoint: j.endpoint, keys: j.keys });
            status('Notifiche attivate.', 'ok');
            await loadNotifs();
            renderPushBox();
        } catch (e) { status('Non sono riuscito ad attivare le notifiche: ' + e.message, 'err'); }
    }

    async function disablePush() {
        try {
            const reg = await navigator.serviceWorker.getRegistration('./');
            const sub = reg && await reg.pushManager.getSubscription();
            if (sub) {
                await post('../api/notifiche.php', { action: 'unsubscribe', endpoint: sub.endpoint });
                await sub.unsubscribe();
            }
            status('Notifiche disattivate su questo dispositivo.', 'ok');
            await loadNotifs();
            renderPushBox();
        } catch (e) { status(e.message, 'err'); }
    }

    async function testPush() {
        try {
            const r = await post('../api/notifiche.php', { action: 'test' });
            status(r.delivered ? 'Prova inviata: dovrebbe arrivare tra pochi secondi.' : 'La prova non è partita: riattiva le notifiche.', r.delivered ? 'ok' : 'err');
            loadNotifs();
        } catch (e) { status(e.message, 'err'); }
    }

    $('#bell').addEventListener('click', async () => {
        const panel = $('#notif-panel');
        panel.hidden = !panel.hidden;
        $('#bell').setAttribute('aria-expanded', String(!panel.hidden));
        if (panel.hidden) return;
        renderNotifs();
        if (notifs.some((n) => !n.read)) {
            try { await post('../api/notifiche.php', { action: 'read_all' }); } catch (e) { /* ignore */ }
            $('#bell-count').hidden = true;
        }
    });
    $('#notif-close').addEventListener('click', () => { $('#notif-panel').hidden = true; loadNotifs(); });
    setInterval(() => { if (document.visibilityState === 'visible') loadNotifs(); }, 60000);

    /** ?class=ID&tab=study (links from notifications) */
    async function applyParams(params) {
        const cid = Number(params.get('class'));
        const tab = params.get('tab');
        if (cid && classes.some((c) => c.id === cid) && (!current || current.id !== cid)) {
            $('#class-select').value = String(cid);
            await openClass(cid);
        }
        if (tab && ['material', 'study', 'calendar', 'class'].includes(tab) && current) showTab(tab);
    }

    /* ---------- start ---------- */

    $$('#tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
    $('#class-select').addEventListener('change', (ev) => { openClass(Number(ev.target.value)).catch((e) => status(e.message, 'err')); });
    const startParams = new URLSearchParams(location.search);
    loadMine(Number(startParams.get('class')) || null)
        .then(() => applyParams(startParams))
        .catch((e) => status(e.message, 'err'));
    loadNotifs();
})();
