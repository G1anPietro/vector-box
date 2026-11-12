// public/js/appunti.js — shared class notes page (pages/appunti.php).
// Talks to api/classi.php and api/appunti.php. Every user-written string goes in with textContent.
(() => {
    'use strict';

    const S = window.SESSION_STATE || {};
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

    function status(msg, kind = '') {
        const s = $('#status');
        s.textContent = msg || '';
        s.className = 'status' + (kind ? ' ' + kind : '');
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
    async function post(url, body) {
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
        showTab(currentTab === 'admin' && !S.isAdmin ? 'material' : currentTab);
    }

    function fillSubjectSelects() {
        const opts = () => current.subjects.map((s) => el('option', { value: s.id, text: s.name }));
        $('#filter-subject').replaceChildren(el('option', { value: '', text: 'Tutte le materie' }), ...opts());
        $('#filter-kind').replaceChildren(el('option', { value: '', text: 'Tutti i tipi' }),
            ...Object.entries(KINDS).map(([k, v]) => el('option', { value: k, text: v })));
        $('#event-form [name="subject_id"]').replaceChildren(el('option', { value: '', text: 'Scegli…' }), ...opts());
    }

    function showTab(name) {
        currentTab = name;
        $$('#tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
        $$('.tab').forEach((t) => { t.hidden = t.id !== 'tab-' + name; });
        status('');
        if (name === 'material' && current) { prepareUpload(); loadItems(); }
        if (name === 'calendar' && current) loadEvents();
        if (name === 'class' && current) renderClass();
        if (name === 'admin') loadAdmin();
    }

    /* ---------- material: upload ---------- */

    async function fillLessons(date, preferred) {
        const sel = $('#upload-form [name="lesson"]');
        let lessons = [];
        try { lessons = (await getJson(`../api/appunti.php?action=lessons&class_id=${current.id}&date=${date}`)).lessons; } catch (e) { /* none */ }
        const groups = [];
        if (lessons.length) {
            groups.push(el('optgroup', { label: 'Lezioni del giorno' }, ...lessons.map((l) => {
                const hours = l.period === l.period_to ? `${l.period}ª ora` : `${l.period}ª-${l.period_to}ª ora`;
                const name = l.label || subjectName(l.subject_id);
                return el('option', { value: `${l.subject_id}|${l.period}`, text: `${hours} · ${name} (${l.start}–${l.end})` });
            })));
        }
        groups.push(el('optgroup', { label: lessons.length ? 'Altra materia' : 'Materia' },
            ...current.subjects.map((s) => el('option', { value: `${s.id}|`, text: s.name }))));
        sel.replaceChildren(el('option', { value: '', text: current.subjects.length ? 'Scegli…' : 'Il responsabile deve ancora inserire l\'orario' }), ...groups);
        if (preferred && [...sel.options].some((o) => o.value === preferred)) sel.value = preferred;
    }

    async function suggestFor(tsSeconds) {
        try {
            const s = await getJson(`../api/appunti.php?action=suggest&class_id=${current.id}&ts=${Math.floor(tsSeconds)}`);
            $('#upload-form [name="lesson_date"]').value = s.date;
            await fillLessons(s.date, s.lesson ? `${s.lesson.subject_id}|${s.lesson.period}` : null);
            return s;
        } catch (e) { return null; }
    }

    async function prepareUpload() {
        const form = $('#upload-form');
        if (form.dataset.classId !== String(current.id)) {
            form.dataset.classId = String(current.id);
            await suggestFor(Date.now() / 1000);
            updateUsage();
        }
    }

    async function updateUsage() {
        try {
            const u = await getJson(`../api/appunti.php?action=usage&class_id=${current.id}`);
            $('#usage').textContent = `Spazio usato: ${sizeText(u.used_bytes)} su ${u.limits_mb.class >= 1024 ? (u.limits_mb.class / 1024).toFixed(1) + ' GB' : u.limits_mb.class + ' MB'} · massimo ${u.limits_mb.file} MB per file`;
        } catch (e) { /* ignore */ }
    }

    $('#upload-form [name="lesson_date"]').addEventListener('change', (ev) => fillLessons(ev.target.value));
    $('#upload-form [name="files"]').addEventListener('change', async (ev) => {
        const files = [...ev.target.files];
        const hint = $('#file-hint');
        if (!files.length) { hint.textContent = ''; return; }
        // On phones a photo's "last modified" is when it was taken: use it to guess the lesson
        const oldest = Math.min(...files.map((f) => f.lastModified || Date.now()));
        const s = await suggestFor(oldest / 1000);
        const when = new Date(oldest).toLocaleString('it-IT', { weekday: 'long', hour: '2-digit', minute: '2-digit' });
        hint.textContent = s && s.lesson
            ? `File del ${when}: ho scelto la lezione di quell'ora. Cambiala se è sbagliata.`
            : `File del ${when}: scegli tu la lezione.`;
    });

    $('#upload-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const form = ev.target;
        const [subjectId, period] = (form.lesson.value || '').split('|');
        if (!subjectId) { status('Scegli la lezione o la materia.', 'err'); return; }
        const fd = new FormData();
        fd.set('action', 'upload');
        fd.set('class_id', current.id);
        fd.set('subject_id', subjectId);
        fd.set('period', period || '');
        for (const k of ['kind', 'lesson_date', 'title', 'body']) fd.set(k, form[k].value);
        for (const f of form.files.files) fd.append('files[]', f, f.name);
        const btn = $('#upload-btn');
        btn.disabled = true;
        status('Caricamento…');
        try {
            await post('../api/appunti.php', fd);
            status('Caricato. Grazie!', 'ok');
            form.title.value = ''; form.body.value = ''; form.files.value = ''; $('#file-hint').textContent = '';
            loadItems();
            updateUsage();
        } catch (e) {
            status(e.message, 'err');
        } finally {
            btn.disabled = false;
        }
    });

    /* ---------- material: list ---------- */

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
            box.replaceChildren(...[...days].map(([d, list]) =>
                el('section', { class: 'day' }, el('h3', { text: dayFmt.format(parseDate(d)) }), ...list.map(renderItem))));
        } catch (e) {
            box.replaceChildren(el('p', { class: 'empty', text: e.message }));
        }
    }
    $('#filter-subject').addEventListener('change', loadItems);
    $('#filter-kind').addEventListener('change', loadItems);

    function renderItem(it) {
        const fileUrl = (f) => `../api/appunti.php?action=file&id=${f.id}`;
        const files = it.files.map((f) => f.mime.startsWith('image/') && f.mime !== 'image/heic' && f.mime !== 'image/heif'
            ? el('a', { class: 'thumb', href: fileUrl(f), target: '_blank', rel: 'noopener', title: f.name },
                el('img', { src: fileUrl(f), alt: f.name, loading: 'lazy' }))
            : el('a', { href: fileUrl(f), target: '_blank', rel: 'noopener', text: `📄 ${f.name} · ${sizeText(f.size)}` }));
        const card = el('article', { class: 'item' },
            el('div', { class: 'meta' },
                el('span', { class: 'subject', text: it.subject }),
                el('span', { class: 'kind', text: KINDS[it.kind] || it.kind }),
                it.period ? el('span', { text: `${it.period}ª ora` }) : null,
                el('span', { text: `da ${it.author || '?'}` })),
            it.title ? el('div', { class: 'title', text: it.title }) : null,
            it.body ? el('div', { class: 'body', text: it.body }) : null,
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
        try { await notes_({ action: 'delete_item', id: it.id }); status('Eliminato.', 'ok'); loadItems(); updateUsage(); } catch (e) { status(e.message, 'err'); }
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

    function renderTimetable() {
        const box = $('#tt-days');
        const slots = (current.timetable && current.timetable.slots) || [];
        const datalist = el('datalist', { id: 'tt-subjects' }, ...current.subjects.map((s) => el('option', { value: s.name })));
        const days = DAYS.map((name, i) => {
            const day = String(i + 1);
            const rowsBox = el('div', { class: 'rows' });
            (current.periods[day] || []).forEach((p, k) => {
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
            $('#upload-form').dataset.classId = '';
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

    /* ---------- start ---------- */

    $$('#tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
    $('#class-select').addEventListener('change', (ev) => { $('#upload-form').dataset.classId = ''; openClass(Number(ev.target.value)).catch((e) => status(e.message, 'err')); });
    loadMine().catch((e) => status(e.message, 'err'));
})();
