// public/js/appunti.js — shared class notes page (pages/appunti.php).
// Talks to api/classi.php and api/appunti.php. Every user-written string goes in with textContent.
(() => {
    'use strict';

    // No inline script on the page (CSP): csrf.js fetches the token itself, the admin flag comes from the API
    let isAdmin = false;
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
    const KINDS = {
        appunti: VBLang.t('notes'), slide: VBLang.t('slides_teacher'), libro: VBLang.t('book'), domande: VBLang.t('teacher_s_questions_2'), prova: VBLang.t('practice_test'), altro: VBLang.t('other'),
    };
    const EVENT_KINDS = { verifica: VBLang.t('written_test'), interrogazione: VBLang.t('oral_exam'), altro: VBLang.t('other') };
    const DAYS = [VBLang.t('monday'), VBLang.t('tuesday'), VBLang.t('wednesday'), VBLang.t('thursday'), VBLang.t('friday'), VBLang.t('saturday'), VBLang.t('sunday')];
    const STORE_KEY = 'vb_appunti_class';
    const DEMO_KEY = 'vb_appunti_demo';
    let demoClass = null;
    const TAB_KEY = 'vb_appunti_tab';
    const DOC_KEY = 'vb_appunti_doc';

    let classes = [];
    let current = null;          // class detail from api/classi.php
    // the tab you were on, read before anything can overwrite it (opening a class shows the board first)
    const startTab = (() => {
        try {
            const open = localStorage.getItem('vb_open_tab') || 'last';   // Impostazioni › "Gli Appunti si aprono su"
            return open === 'last' ? localStorage.getItem('vb_appunti_tab') : open;
        } catch (e) { return null; }
    })();
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
        bad_code: VBLang.t('invalid_code'), requests_closed: VBLang.t('requests_for_new_classes_are_closed_2'),
        too_many: VBLang.t('you_already_have_pending_requests'), slow_down: VBLang.t('too_many_attempts_try_again_shortly'),
        empty: VBLang.t('add_a_file_or_write_some'), bad_subject: VBLang.t('choose_the_subject'), file_too_large: null,
        class_full: VBLang.t('the_class_has_run_out_of'), bad_type: null, too_large: VBLang.t('the_upload_is_too_big'),
        manager_cannot_leave: VBLang.t('first_hand_the_class_over_to'), forbidden: VBLang.t('you_cannot_edit_it'),
        not_manager: VBLang.t('you_do_not_have_permission_to'),
    };
    function errText(json, fallback = VBLang.t('something_went_wrong')) {
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
    const dayFmt = new Intl.DateTimeFormat(VBLang.t('locale'), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const shortMonth = new Intl.DateTimeFormat(VBLang.t('locale'), { month: 'short' });
    const shortDay = new Intl.DateTimeFormat(VBLang.t('locale'), { weekday: 'short' });
    function sizeText(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
    function subjectName(id) { const s = current && current.subjects.find((x) => x.id === id); return s ? s.name : '?'; }
    function hue(id) { return `hsl(${(id * 67) % 360} 70% 62%)`; }

    /* ---------- classes ---------- */

    async function loadMine(selectId) {
        const mine = await getJson('../api/classi.php?action=mine');
        const real = mine.classes;
        demoClass = mine.demo || null;
        // The example class (invented data, read-only) is offered when you have no class yet, or after you asked to see it
        const showDemo = !!demoClass && (!!mine.guest || stored(DEMO_KEY) === '1' || Number(selectId) === demoClass.id);
        classes = showDemo ? [...real, demoClass] : real;
        isAdmin = mine.is_admin;
        const sel = $('#class-select');
        sel.replaceChildren(...classes.map((c) => el('option', { value: c.id, text: c.demo ? VBLang.t('example_class', { name: c.name }) : `${c.name} · ${c.school}${c.is_member ? '' : VBLang.t('by_admin')}` })));
        $('#demo-offer').hidden = !demoClass || showDemo;
        // a visitor with no account: only the example class, no join/request forms
        ['#join-form', '#request-box', '#demo-close'].forEach((q) => { $(q).hidden = !!mine.guest; });
        $('#guest-note').hidden = !mine.guest;
        $('[data-tab="admin"]').hidden = !mine.is_admin;

        $('#request-form').hidden = !mine.requests_open && !mine.is_admin;
        $('#requests-closed').hidden = mine.requests_open || mine.is_admin;
        const reqStatus = { pending: VBLang.t('waiting_for_approval'), rejected: VBLang.t('req_rejected') };
        $('#my-requests').replaceChildren(...mine.requests.map((r) =>
            el('li', {}, el('span', { text: VBLang.t('request', { name: r.name, status: r.school }) }), el('span', { class: 'muted small', text: reqStatus[r.status] || r.status }))));

        $$('.needs-class').forEach((x) => { x.hidden = classes.length === 0; });
        if (!classes.length) {
            $('#welcome').hidden = false;
            $('#tabs').hidden = !mine.is_admin;
            $$('.tab').forEach((t) => { t.hidden = true; });
            if (mine.is_admin) { $$('#tabs button').forEach((b) => { b.hidden = b.dataset.tab !== 'admin'; }); showTab('admin'); }
            current = null;
            return;
        }
        $('#welcome').hidden = real.length > 0;      // no class of your own yet: the "join" box stays on top, under the example
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
        document.body.classList.toggle('is-demo', !!current.demo);
        $('#demo-banner').hidden = !current.demo;
        fillSubjectSelects();
        showTab(currentTab === 'admin' && !isAdmin ? 'material' : currentTab);
    }

    function fillSubjectSelects() {
        const opts = () => current.subjects.map((s) => el('option', { value: s.id, text: s.name }));
        $('#filter-subject').replaceChildren(el('option', { value: '', text: VBLang.t('all_subjects') }), ...opts());
        $('#filter-kind').replaceChildren(el('option', { value: '', text: VBLang.t('all_types') }),
            ...Object.entries(KINDS).map(([k, v]) => el('option', { value: k, text: v })));
        $('#event-form [name="subject_id"]').replaceChildren(el('option', { value: '', text: VBLang.t('choose') }), ...opts());
        $('#study-subject').replaceChildren(el('option', { value: '', text: VBLang.t('all_subjects') }), ...opts());
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
        status(action === 'zip' ? VBLang.t('preparing_the_zip') : asPdf ? VBLang.t('preparing_the_pdf') : VBLang.t('preparing_the_file_for_the_ai'));
        try {
            const r = await fetch('../api/appunti.php?' + q, { credentials: 'same-origin' });
            if (!r.ok) {
                const j = await r.json().catch(() => null);
                throw new Error(j && j.code === 'nothing' ? j.error : errText(j, VBLang.t('download_failed')));
            }
            const cd = r.headers.get('content-disposition') || '';
            const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
            const name = m ? decodeURIComponent(m[1]) : (action === 'zip' ? 'appunti.zip' : asPdf ? VBLang.t('notes_for_ai_pdf') : VBLang.t('notes_for_ai_md'));
            const url = URL.createObjectURL(await r.blob());
            const a = el('a', { href: url, download: name });
            document.body.append(a);
            a.click();
            setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
            status(action === 'zip'
                ? VBLang.t('downloaded_prompt_txt_is_inside_too_2')
                : VBLang.t('downloaded_attach_it_to_chatgpt_claude'), 'ok');
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
        if ($('#filter-topic').value !== '') q.set('topic_id', $('#filter-topic').value);
        const box = $('#items');
        try {
            const { items } = await getJson('../api/appunti.php?' + q);
            if (!items.length) { box.replaceChildren(el('p', { class: 'empty', text: VBLang.t('nothing_here_yet_upload_the_first') })); return; }
            const days = new Map();
            for (const it of items) { if (!days.has(it.lesson_date)) days.set(it.lesson_date, []); days.get(it.lesson_date).push(it); }
            const sid = $('#filter-subject').value;
            box.replaceChildren(...[...days].map(([d, list]) => el('section', { class: 'day' },
                el('div', { class: 'day-head' }, el('h3', { text: dayFmt.format(parseDate(d)) }),
                    C.menu([
                        { label: VBLang.t('for_another_ai_md'), onclick: (ev) => downloadZip(sid ? { scope: 'day', date: d, subject_id: sid } : { scope: 'day', date: d }, ev.target, 'ai_pack') },
                        { label: VBLang.t('for_another_ai_pdf_with_the'), onclick: (ev) => downloadZip(sid ? { scope: 'day', date: d, subject_id: sid } : { scope: 'day', date: d }, ev.target, 'pdf') },
                        { label: VBLang.t('all_the_material_zip'), onclick: (ev) => downloadZip(sid ? { scope: 'day', date: d, subject_id: sid } : { scope: 'day', date: d }, ev.target) }], VBLang.t('download_this_day'))),
                ...list.map(renderItem))));
        } catch (e) {
            box.replaceChildren(el('p', { class: 'empty', text: e.message }));
        }
    }
    /** The topic filter only exists once a subject is chosen and it has topics ("Senza argomento" for uploads no topic covers). */
    function fillTopicFilter() {
        const sid = Number($('#filter-subject').value) || 0;
        const list = sid ? (current.topics || []).filter((t) => t.subject_id === sid) : [];
        const sel = $('#filter-topic');
        sel.hidden = !list.length;
        sel.replaceChildren(el('option', { value: '', text: VBLang.t('all_topics') }), ...list.map((t) => el('option', { value: t.id, text: t.name })), ...(list.length ? [el('option', { value: '0', text: VBLang.t('no_topic') })] : []));
    }
    $('#filter-topic').addEventListener('change', loadItems);
    $('#filter-subject').addEventListener('change', () => {
        fillTopicFilter();
        const sid = $('#filter-subject').value;
        $('#subject-menu').replaceChildren(...(sid ? [C.menu([
            { label: VBLang.t('the_whole_subject_for_another_ai'), onclick: (ev) => downloadZip({ scope: 'subject', subject_id: sid }, ev.target, 'ai_pack') },
            { label: VBLang.t('the_whole_subject_for_another_ai_2'), onclick: (ev) => downloadZip({ scope: 'subject', subject_id: sid }, ev.target, 'pdf') },
            { label: VBLang.t('the_whole_subject_zip'), onclick: (ev) => downloadZip({ scope: 'subject', subject_id: sid }, ev.target) }], VBLang.t('download_the_subject'))] : []));
        loadItems();
    });
    $('#filter-kind').addEventListener('change', loadItems);

    /** Long notes show a few lines and a "Mostra tutto" button (no box scrolling inside the page). */
    function collapsible(body) {
        body.classList.add('clamped');
        const btn = el('button', { type: 'button', class: 'ghost mini more-btn', text: VBLang.t('show_all_2'), hidden: true });
        btn.addEventListener('click', () => {
            const open = body.classList.toggle('clamped');
            btn.textContent = open ? VBLang.t('show_all_2') : VBLang.t('show_less');
        });
        // only when the text is really longer than the preview
        requestAnimationFrame(() => { btn.hidden = body.scrollHeight <= body.clientHeight + 4; });
        return el('div', {}, body, btn);
    }

    const topicName = (it) => { const t = it.topic_id && (current.topics || []).find((x) => x.id === it.topic_id); return t ? t.name : ''; };

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
                it.period ? el('span', { text: VBLang.t('period', { n: it.period }) }) : null,
                topicName(it) ? el('span', { class: 'topic-chip', text: topicName(it) }) : null,
                el('span', { text: VBLang.t('from_3', { name: it.author || '?' }) })),
            it.title ? el('div', { class: 'title', text: it.title }) : null,
            it.body ? collapsible(window.AppuntiCommon.looksLikeMarkdown(it.body)
                ? el('div', { class: 'body md' }, md(it.body))
                : el('div', { class: 'body', text: it.body })) : null,
            files.length ? el('div', { class: 'files' }, files) : null,
            it.can_edit ? el('div', { class: 'actions' }, C.menu([
                { label: VBLang.t('edit_2'), onclick: () => editItem(it, card) },
                { label: it.files.length || it.body ? VBLang.t('delete_everything') : VBLang.t('delete'), danger: true, onclick: () => deleteItem(it) },
                ...(it.files.length > 1 || (it.files.length === 1 && it.body) ? it.files.filter((f) => f.can_delete).map((f) => ({ label: VBLang.t('delete_only', { name: f.name }), danger: true, onclick: () => deleteFile(f, loadItems) })) : [])])) : null);
        card.style.setProperty('--sub', hue(it.subject_id));
        return card;
    }

    /** Deletes one file after a confirmation (the server checks who may). */
    async function deleteFile(f, reload) {
        if (!confirm(VBLang.t('delete_the_file_this_cannot_be', { name: f.name }))) return;
        try { await notes_({ action: 'delete_file', id: f.id }); status(VBLang.t('file_deleted'), 'ok'); reload(); } catch (e) { status(e.message, 'err'); }
    }

    function editItem(it, card) {
        const form = el('form', { class: 'stack' },
            el('div', { class: 'grid2' },
                el('label', { text: VBLang.t('subject') }, el('select', { name: 'subject_id' },
                    ...current.subjects.map((s) => el('option', { value: s.id, text: s.name, selected: s.id === it.subject_id })))),
                el('label', { text: VBLang.t('day_2') }, el('input', { type: 'date', name: 'lesson_date', value: it.lesson_date, required: true }))),
            el('label', { text: VBLang.t('type') }, el('select', { name: 'kind' },
                ...Object.entries(KINDS).map(([k, v]) => el('option', { value: k, text: v, selected: k === it.kind })))),
            el('label', { text: VBLang.t('topic') }, el('select', { name: 'topic_id' }, el('option', { value: '0', text: VBLang.t('the_site_decides_based_on_the') }),
                ...(current.topics || []).filter((t) => t.subject_id === it.subject_id).map((t) => el('option', { value: t.id, text: t.name, selected: t.id === it.topic_id })))),
            el('label', { text: VBLang.t('title') }, el('input', { name: 'title', value: it.title, maxLength: 120 })),
            el('label', { text: VBLang.t('text') }, el('textarea', { name: 'body', rows: 5, maxLength: 50000, value: it.body })),
            el('div', { class: 'row' }, el('button', { text: VBLang.t('save') }), el('button', { type: 'button', class: 'ghost', text: VBLang.t('cancel'), onclick: () => loadItems() })));
        form.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            try {
                await notes_({
                    action: 'edit_item', id: it.id, subject_id: Number(form.subject_id.value), kind: form.kind.value,
                    lesson_date: form.lesson_date.value, period: form.subject_id.value === String(it.subject_id) && form.lesson_date.value === it.lesson_date ? it.period : null,
                    title: form.title.value, body: form.body.value, topic_id: form.subject_id.value === String(it.subject_id) ? Number(form.topic_id.value) : 0,
                });
                status(VBLang.t('saved_2'), 'ok');
                loadItems();
            } catch (e) { status(e.message, 'err'); }
        });
        card.replaceChildren(form);
    }

    async function deleteItem(it) {
        if (!confirm(VBLang.t('delete_this_material_and_its_files'))) return;
        try { await notes_({ action: 'delete_item', id: it.id }); status(VBLang.t('deleted_2'), 'ok'); loadItems(); } catch (e) { status(e.message, 'err'); }
    }


    /* ---------- study: AI documents ---------- */

    const DOC_KINDS = { completo: VBLang.t('full'), riassunto: VBLang.t('summary'), scheda: VBLang.t('sheet'), preparazione: VBLang.t('preparation'), quiz: VBLang.t('quiz'), lezione: VBLang.t('lesson'), schema: VBLang.t('diagram'), domande: VBLang.t('questions_2') };
    const DOC_ORDER = ['completo', 'riassunto', 'scheda', 'preparazione', 'quiz', 'schema'];
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
        const subjects = [el('option', { value: '', text: VBLang.t('all_subjects') }), ...current.subjects.map((s) => el('option', { value: s.id, text: s.name }))];
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
            $('#doc-title').textContent = VBLang.t('custom_quiz');
            $('#doc-meta').textContent = VBLang.t('n_questions_avail', { n: r.questions.length, extra: r.questions.length < Number(choice.n) ? VBLang.t('all_available', { n: r.pool }) : '' });
            $('#doc-download').hidden = true;
            $('#doc-sources').hidden = true;
            $('#doc-body').replaceChildren(renderQuiz({ questions: r.questions }, (n, k) => C.rawPost('../api/appunti.php', { action: 'custom_quiz_answer', id: r.id, i: n, choice: k }), { practice: true, noRestart: true }));
            window.scrollTo(0, 0);
        } catch (e) {
            status(e.json && e.json.code === 'empty_pool' ? (choice.from === 'wrong' ? VBLang.t('you_have_no_wrong_questions_to') : VBLang.t('there_are_no_questions_for_this')) : e.message, 'err');
        }
    });

    let askedLoaded = null;
    async function loadAsked() {
        const sid = Number($('#asked-subject').value) || 0;
        const box = $('#asked-list');
        box.replaceChildren(el('p', { class: 'muted', text: VBLang.t('loading') }));
        try {
            const { questions } = await getJson(`../api/appunti.php?action=question_pool&class_id=${current.id}&subject_id=${sid}`);
            askedLoaded = { sid, questions };
            $('#asked-menu').replaceChildren(...(questions.length ? [C.menu([
                { label: VBLang.t('study_with_cards_spaced_review'), accent: true, onclick: () => startCards() },
                { label: VBLang.t('export_for_anki_txt'), onclick: () => exportAnki() },
                { label: VBLang.t('download_the_prompt_to_be_questioned'), onclick: () => downloadAskedPrompt() },
                { label: VBLang.t('copy_the_prompt'), onclick: () => copyAskedPrompt() }], VBLang.t('open_questions'))] : []));
            box.replaceChildren(...(questions.length ? questions.map((q) => el('div', { class: 'asked' },
                el('div', { class: 'asked-q' }, el('span', { class: 'qa-badge ' + (q.origine === 'prof' ? 'prof' : 'ai'), text: q.origine === 'prof' ? (q.count > 1 ? VBLang.t('asked_times', { n: q.count }) : VBLang.t('made_by_the_teacher')) : VBLang.t('likely') }), ' ', q.domanda),
                q.risposta ? el('details', {}, el('summary', { text: VBLang.t('answer') }), el('div', { class: 'md' }, md(q.risposta))) : null))
                : [el('p', { class: 'empty', text: VBLang.t('no_questions_yet_they_arrive_with') })]));
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
        $('#doc-title').textContent = VBLang.t('cards_to_review');
        $('#doc-meta').textContent = cards.length ? VBLang.t('cards_today_think_of_the_answer', { n: cards.length }) : VBLang.t('you_are_done_for_today_the');
        $('#doc-download').hidden = true;
        $('#doc-sources').hidden = true;
        const body = $('#doc-body');
        let i = 0;
        const next = () => {
            if (i >= cards.length) { body.replaceChildren(el('p', { class: 'empty', text: VBLang.t('done_come_back_tomorrow_for_the') })); return; }
            const c = cards[i];
            const answer = el('div', { class: 'fc-answer md', hidden: true }, md(c.q.risposta));
            const know = (yes) => {
                const box = yes ? Math.min(c.st.box + 1, FC_DAYS.length) : 0;
                const all = fcLoad();
                all[c.id] = box >= FC_DAYS.length ? { box: FC_DAYS.length, due: dayPlus(60) } : { box, due: dayPlus(FC_DAYS[box]) };
                store(fcKey(), JSON.stringify(all));
                i++; next();
            };
            const show = el('button', { type: 'button', text: VBLang.t('show_the_answer'), onclick: () => { answer.hidden = false; show.hidden = true; row.hidden = false; } });
            const row = el('div', { class: 'row', hidden: true }, el('button', { type: 'button', text: VBLang.t('i_knew_it'), onclick: () => know(true) }), el('button', { type: 'button', class: 'ghost', text: VBLang.t('to_review_again'), onclick: () => know(false) }));
            body.replaceChildren(el('p', { class: 'muted small', text: VBLang.t('card_x_of_y', { i: i + 1, n: cards.length, extra: c.q.count > 1 ? VBLang.t('asked_by_prof_n', { n: c.q.count }) : '' }) }),
                el('div', { class: 'fc-card' }, el('div', { class: 'fc-q' }, c.q.domanda,
                    C.canSpeak() ? el('button', { type: 'button', class: 'ghost mini speak-btn', text: VBLang.t('read'), onclick: () => C.speak(c.q.domanda) }) : null), answer), show, row);
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
        status(VBLang.t('downloaded_in_anki_choose_file_import'), 'ok');
    }

    /** A prompt that turns another AI into an examiner: one open question at a time, correction, final summary. */
    function askedPrompt() {
        const subject = (current.subjects.find((s) => s.id === askedLoaded.sid) || {}).name || VBLang.t('this_subject');
        const lines = askedLoaded.questions.map((q, i) => `${i + 1}. ${q.domanda}${q.origine === 'prof' ? (q.count > 1 ? VBLang.t('pq_prof_n', { n: q.count }) : VBLang.t('pq_prof')) : VBLang.t('pq_likely')}${q.risposta ? VBLang.t('pq_ref', { a: q.risposta }) : ''}`);
        return VBLang.t('asked_prompt', { subject, lines: lines.join('\n') });
    }
    function downloadAskedPrompt() {
        const a = el('a', { href: URL.createObjectURL(new Blob([askedPrompt()], { type: 'text/plain;charset=utf-8' })), download: 'interrogazione-con-un-altra-AI.txt' });
        document.body.append(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        status(VBLang.t('downloaded_paste_the_text_into_chatgpt'), 'ok');
    }
    async function copyAskedPrompt() {
        try { await navigator.clipboard.writeText(askedPrompt()); status(VBLang.t('prompt_copied_paste_it_into_the_2'), 'ok'); } catch (e) { status(VBLang.t('cannot_copy_use_download'), 'err'); }
    }

    function renderAiBar(ai) {
        const bar = $('#ai-bar');
        if (current.demo) { bar.replaceChildren(el('p', { class: 'muted', text: VBLang.t('these_documents_are_written_by_hand') })); return; }
        if (!ai.configured) { bar.replaceChildren(el('p', { class: 'muted', text: VBLang.t('the_ai_is_not_active_on') })); return; }
        if (ai.allowed === false) { bar.replaceChildren(el('p', { class: 'muted', text: VBLang.t('the_ai_is_off_for_this_2') })); return; }
        const now = Date.now() / 1000;
        const wait = ai.next_manual_at > now;
        const at = new Date(ai.next_manual_at * 1000).toLocaleTimeString(VBLang.t('locale'), { hour: '2-digit', minute: '2-digit' });
        const lr = ai.last_run;
        let last = null;
        if (lr && lr.at) {
            const when = new Date(lr.at * 1000).toLocaleString(VBLang.t('locale'), { weekday: 'short', hour: '2-digit', minute: '2-digit' });
            const made = lr.lessons + lr.tests;
            const why = lr.stop === 'busy' ? VBLang.t('google_was_overloaded_i_will_try')
                : lr.stop === 'quota' ? VBLang.t('the_free_requests_for_today_are')
                : lr.stop === 'fault' ? VBLang.t('there_was_a_problem_with_the')
                : lr.pending ? VBLang.t('waiting_for_the_transcript_of_files', { n: lr.pending })
                : made ? '' : VBLang.t('no_new_material_to_summarise_documents');
            last = el('span', { class: 'muted small', text: VBLang.t('last_round', { kind: lr.manual ? VBLang.t('kind_manual') : VBLang.t('kind_auto'), when, text: made ? (made === 1 ? VBLang.t('made_docs_one') : VBLang.t('made_docs_n', { n: made })) + (why ? '; ' + why : '.') : why }) });
        }
        const state = ai.summary_on === false ? VBLang.t('automatic_summary_off') : VBLang.t('automatic_summary_every_day_at', { time: ai.summary_time });
        const sub = (ai.pending_files ? VBLang.t('files_to_transcribe', { n: ai.pending_files }) : '')
            + (ai.requested ? VBLang.t('request_queued_it_takes_a_few') : wait ? VBLang.t('you_can_ask_again_at', { time: at }) : '');
        bar.replaceChildren(el('div', { class: 'ai-bar-row' },
            el('p', {}, el('b', { text: state }), sub ? el('br') : null, sub ? el('span', { class: 'muted small', text: sub }) : null, last ? el('br') : null, last),
            C.menu([
                { label: ai.requested ? VBLang.t('already_queued') : wait ? VBLang.t('generate_now_from', { time: at }) : VBLang.t('generate_now'), onclick: () => { if (!ai.requested && !wait) generateNow(); } },
                { label: VBLang.t('generate_on_chosen_days'), onclick: () => rangeDialog() }], VBLang.t('generate_the_documents'))));
    }

    async function generateNow(range = null) {
        try {
            await notes_({ action: 'generate', class_id: current.id, ...(range || {}) });
            status(range ? VBLang.t('request_sent_i_redo_the_notes', { from: fmtDay(range.from), to: fmtDay(range.to) })
                : VBLang.t('request_sent_the_documents_arrive_within'), 'ok');
        } catch (e) {
            status(e.json && e.json.code === 'too_soon' ? VBLang.t('already_asked_in_the_last_hour') : e.json && e.json.code === 'ai_off' ? VBLang.t('the_ai_is_not_active')
                : e.json && e.json.code === 'bad_range' ? VBLang.t('check_the_dates_the_start_before') : e.message, 'err');
        }
        loadStudy();
    }
    const fmtDay = (iso) => parseDate(iso).toLocaleDateString(VBLang.t('locale'), { day: 'numeric', month: 'short' });

    /** "Genera ora" on chosen days: when a topic spans weeks, or notes were caught up late. */
    function rangeDialog() {
        C.dialogForm(VBLang.t('generate_on_chosen_days_2'), (form) => {
            form.append(el('p', { class: 'muted small', text: VBLang.t('redoes_the_notes_questions_and_diagrams') }),
                el('label', { text: VBLang.t('from_2') }, el('input', { type: 'date', name: 'from', required: true })),
                el('label', { text: VBLang.t('to_2') }, el('input', { type: 'date', name: 'to', required: true, value: todayStr() })));
        }, async (form) => { await generateNow({ from: form.from.value, to: form.to.value }); }, VBLang.t('generate'));
    }

    /* ---------- spaced review ---------- */

    async function loadReview() {
        const box = $('#review-box');
        try {
            const r = await getJson(`../api/appunti.php?action=review&class_id=${current.id}`);
            if (!r.due.length) {
                box.hidden = !r.later;
                box.replaceChildren(el('p', {}, el('b', { text: VBLang.t('review_nothing_for_today') }), el('br'),
                    el('span', { class: 'muted small', text: (r.later === 1 ? VBLang.t('later_one') : VBLang.t('later_n', { n: r.later })) })));
                return;
            }
            box.hidden = false;
            box.replaceChildren(el('div', {}, el('b', { text: (r.due.length === 1 ? VBLang.t('review_today_one') : VBLang.t('review_today_n', { n: r.due.length })) }), el('br'),
                el('span', { class: 'muted small', text: VBLang.t('the_ones_you_got_wrong_in') })),
                el('button', { text: VBLang.t('start_the_review'), onclick: () => startReview(r.due) }));
        } catch (e) { box.hidden = true; }
    }

    function startReview(due) {
        openDoc = null;
        $('#study-list').hidden = true;
        $('#doc-view').hidden = false;
        $('#doc-title').textContent = VBLang.t('today_s_review');
        $('#doc-meta').textContent = VBLang.t('the_questions_you_got_wrong_in');
        $('#doc-download').hidden = true;
        $('#doc-sources').hidden = true;
        $('#doc-body').replaceChildren(renderQuiz({ questions: due.map((q) => ({ ...q, topic: q.topic || q.from })) },
            (n, choice) => C.rawPost('../api/appunti.php', { action: 'review_answer', doc_id: due[n].doc_id, q: due[n].q, choice })));
        window.scrollTo(0, 0);
    }

    const shortDate = (d) => d.toLocaleDateString(VBLang.t('locale'), { weekday: 'short', day: 'numeric', month: 'short' });

    function renderStudyTests(events, ai) {
        const box = $('#study-tests');
        if (!events.length) { box.replaceChildren(el('p', { class: 'empty', text: VBLang.t('no_test_in_the_calendar_add') })); return; }
        box.replaceChildren(...events.map((e) => {
            const docs = DOC_ORDER.map((k) => studyDocs.find((d) => d.event_id === e.id && d.kind === k && !d.manual)).filter(Boolean)
                .concat(studyDocs.filter((d) => d.event_id === e.id && d.manual));
            const d = parseDate(e.date);
            const docItems = docs.map((doc) => ({ label: DOC_KINDS[doc.kind] + (doc.manual ? VBLang.t('by_author', { name: doc.author || '?' }) : '') + (doc.status === 'ok' ? '' : ' (errore)'),
                accent: true, onclick: () => { if (doc.status === 'ok') showDoc(doc.id); else status(VBLang.t('this_document_failed_it_is_redone'), 'err'); } }));
            const delItems = docs.filter((doc) => doc.can_delete).map((doc) => ({ label: VBLang.t('delete_3', { name: DOC_KINDS[doc.kind] }), danger: true, onclick: () => deleteDoc(doc) }));
            return el('div', { class: 'test-card' },
                el('div', { class: 'test-head' },
                    el('div', { class: 'what' }, el('span', { class: 'badge ' + e.kind, text: EVENT_KINDS[e.kind] }), el('b', { text: e.subject }),
                        ` · ${shortDate(d)}`, e.title ? ` · ${e.title}` : ''),
                    docs.length ? el('span', { class: 'muted small test-ready', text: (docs.length === 1 ? VBLang.t('docs_ready_one') : VBLang.t('docs_ready_n', { n: docs.length })) }) : null,
                    C.menu([...docItems,
                        { label: VBLang.t('for_another_ai_md'), onclick: (ev) => downloadZip({ scope: 'event', event_id: e.id }, ev.target, 'ai_pack') },
                        { label: VBLang.t('for_another_ai_pdf_with_the'), onclick: (ev) => downloadZip({ scope: 'event', event_id: e.id }, ev.target, 'pdf') },
                        { label: VBLang.t('all_the_material_zip'), onclick: (ev) => downloadZip({ scope: 'event', event_id: e.id }, ev.target) },
                        { label: VBLang.t('upload_a_document_made_with_another'), onclick: () => { location.href = caricaUrl({ m: 'ai', event: e.id }); } },
                        ...delItems], VBLang.t('documents_and_actions'))));
        }));
    }

    function renderStudyLessons() {
        const sid = Number($('#study-subject').value) || 0;
        const list = studyDocs.filter((d) => d.kind === 'lezione' && (!sid || d.subject_id === sid));
        const box = $('#study-lessons');
        if (!list.length) { box.replaceChildren(el('p', { class: 'empty', text: VBLang.t('no_lesson_summaries_yet') })); return; }
        box.replaceChildren(...list.map((d) => {
            const sub = (kind) => studyDocs.filter((x) => x.kind === kind && x.status === 'ok' && x.subject_id === d.subject_id && x.lesson_date === d.lesson_date && (kind === 'schema' ? !x.event_id : true))[0];
            const schema = sub('schema'); const questions = sub('domande');
            return el('div', { class: 'doc-row' },
                el('span', { class: 'doc-row-text' }, el('b', { text: d.subject }), ' · ', d.lesson_date ? shortDate(parseDate(d.lesson_date)) : '',
                    d.manual ? el('span', { class: 'muted small', text: VBLang.t('by_author', { name: d.author || '?' }) }) : null,
                    d.status !== 'ok' ? el('span', { class: 'err', text: VBLang.t('failed_2') }) : null),
                el('span', { class: 'row-actions' },
                    el('button', { class: 'ghost mini', text: VBLang.t('open'), disabled: d.status !== 'ok', onclick: () => showDoc(d.id) }),
                    C.menu([schema ? { label: VBLang.t('diagram'), accent: true, onclick: () => showDoc(schema.id) } : null,
                        questions ? { label: VBLang.t('questions_2'), accent: true, onclick: () => showDoc(questions.id) } : null,
                        d.can_delete ? { label: VBLang.t('delete_these_notes'), danger: true, onclick: () => deleteDoc(d) } : null,
                        schema && schema.can_delete ? { label: VBLang.t('delete_the_diagram'), danger: true, onclick: () => deleteDoc(schema) } : null,
                        questions && questions.can_delete ? { label: VBLang.t('delete_the_questions'), danger: true, onclick: () => deleteDoc(questions) } : null])));
        }));
    }
    $('#study-subject').addEventListener('change', renderStudyLessons);

    async function deleteDoc(d) {
        const ai = d.manual === false;
        if (!confirm(VBLang.t('confirm_delete_doc', { name: d.title || DOC_KINDS[d.kind] || VBLang.t('this_document'), extra: ai ? VBLang.t('ai_wrote_redo') : '' }))) return;
        try { await notes_({ action: 'delete_doc', id: d.id }); loadStudy(); } catch (e) { status(e.message, 'err'); }
    }

    async function showDoc(id) {
        try {
            const { doc } = await getJson(`../api/appunti.php?action=doc&id=${id}`);
            openDoc = doc;
            $('#study-list').hidden = true;
            $('#doc-view').hidden = false;
            $('#doc-title').textContent = doc.title;
            $('#doc-meta').textContent = (doc.manual ? VBLang.t('made_with_another_ai_and_uploaded', { name: doc.author || '?' }) : '')
                + VBLang.t('updated_on', { date: new Date(doc.updated_at * 1000).toLocaleString(VBLang.t('locale'), { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) });
            const body = $('#doc-body');
            if (doc.kind === 'quiz') {
                let quiz = null;
                try { quiz = JSON.parse(doc.content); } catch (e) { /* shown as text below */ }
                body.replaceChildren(quiz ? renderQuiz(quiz, (n, choice) => C.rawPost('../api/appunti.php', { action: 'quiz_answer', doc_id: doc.id, q: n, choice })) : el('p', { text: VBLang.t('quiz_cannot_be_read') }));
            } else if (doc.kind === 'schema') {
                body.replaceChildren(window.AppuntiCommon.renderSchema(doc.content, { ref: { kind: 'doc', id: doc.id } }));
            } else if (doc.kind === 'domande') {
                body.replaceChildren(window.AppuntiCommon.renderQuestions(doc.content));
            } else {
                body.replaceChildren(md(doc.content));
                C.addIndex(body, 'doc' + doc.id);
            }
            store(DOC_KEY, String(doc.id));
            $('#doc-download').hidden = ['quiz', 'schema', 'domande'].includes(doc.kind);
            $('#doc-share').hidden = ['quiz', 'domande'].includes(doc.kind);
            $('#doc-full-slot').hidden = doc.kind === 'schema';
            $('#doc-sources').hidden = !doc.sources.length;
            const kinds = { appunti: VBLang.t('src_appunti'), slide: VBLang.t('src_slide'), libro: VBLang.t('src_libro'), domande: VBLang.t('src_domande'), prova: VBLang.t('src_prova'), altro: VBLang.t('src_altro') };
            $('#doc-sources-list').replaceChildren(...doc.sources.map((s) => el('li', { value: s.n,
                text: VBLang.t('src_line', { kind: kinds[s.kind] || s.kind, author: s.author || '?', title: s.title ? ' — ' + s.title : '' }) })));
            window.scrollTo(0, 0);
        } catch (e) { status(e.message, 'err'); }
    }
    $('#doc-back').addEventListener('click', () => { store(DOC_KEY, ''); $('#doc-view').hidden = true; $('#study-list').hidden = false; if (!openDoc) loadReview(); });
    $('#doc-print').addEventListener('click', () => window.print());
    $('#doc-full-slot').append(C.fullButton(() => $('#doc-view')));
    $('#doc-share').addEventListener('click', () => {
        if (!openDoc) return;
        const ref = { kind: 'doc', id: openDoc.id };
        if (openDoc.kind === 'schema') {
            let data = null; try { data = JSON.parse(openDoc.content); } catch (e) { return; }
            C.shareDialog(openDoc.title, C.schemaChoices(data), ref);
        } else C.shareDialog(openDoc.title, C.textChoices(openDoc.title, openDoc.content), ref);
    });
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
        // Laid out like a Moodle quiz: a "Navigazione del quiz" block with numbered squares, and for each question a grey box on the
        // left (number, state, max score, flag) and the question with its answers on the right.
        const qs = quiz.questions || [];
        const MAXPTS = '10,00';
        let answered = 0;
        let right = 0;
        let points = 0;
        const score = el('p', { class: 'quiz-score', text: `0 / ${qs.length}` });
        const navBtns = qs.map((q, n) => el('button', { type: 'button', class: 'qnbutton', 'aria-label': VBLang.t('go_to_question', { n: n + 1 }), onclick: () => {
            const t = document.getElementById('quiz-q-' + n);
            if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } }, el('span', { class: 'qnnum', text: String(n + 1) }), el('span', { class: 'qnflag', hidden: true, text: '⚑' })));
        const nav = el('aside', { class: 'quiz-nav', 'aria-label': VBLang.t('quiz_navigation') },
            el('h3', { text: VBLang.t('quiz_navigation') }), el('div', { class: 'qngrid' }, ...navBtns), score);
        const list = el('div', { class: 'quiz-list' });
        const box = el('div', { class: 'quiz-moodle' }, list, nav);
        const paintScore = () => {
            score.textContent = answered === qs.length
                ? VBLang.t('attempt_completed_out_of', { done: right, total: qs.length, pct: Math.round(100 * right / qs.length) })
                : VBLang.t('answers_given_out_of', { done: answered, total: qs.length });
            if (points) score.textContent += VBLang.t('points', { n: points });
        };
        let firstOpen = -1;
        qs.forEach((q, n) => {
            const state = el('div', { class: 'state', text: VBLang.t('answer_not_given_yet') });
            const got = el('div', { class: 'grade', text: practice ? VBLang.t('practice_no_points') : VBLang.t('max_score', { n: MAXPTS }) });
            const flag = el('button', { type: 'button', class: 'qflag', 'aria-pressed': 'false', onclick: () => {
                const on = card.classList.toggle('flagged');
                flag.setAttribute('aria-pressed', String(on));
                flag.textContent = on ? VBLang.t('question_flagged') : VBLang.t('flag_question');
                navBtns[n].querySelector('.qnflag').hidden = !on;
            }, text: VBLang.t('flag_question') });
            const why = el('div', { class: 'outcome why', hidden: true });
            const opts = el('div', { class: 'opts' });
            const show = (k, res) => {
                opts.dataset.done = '1';
                answered++;
                if (res.correct) right++;
                [...opts.children].forEach((b) => { b.disabled = true; });
                const mark = (i, ok) => { const b = opts.children[i]; if (!b) return; b.classList.add(ok ? 'right' : 'wrong'); b.querySelector('.qmark').textContent = ok ? '✓' : '✗'; };
                mark(k, res.correct);
                if (!res.correct) mark(res.answer, true);
                opts.children[k].querySelector('input').checked = true;
                card.classList.add(res.correct ? 'correct' : 'incorrect');
                navBtns[n].classList.add(res.correct ? 'correct' : 'incorrect');
                state.textContent = res.correct ? VBLang.t('right_answer') : VBLang.t('wrong_answer');
                if (!practice && Number.isFinite(res.points)) got.textContent = VBLang.t('score_obtained_out_of', { a: String(res.points).replace('.', ','), b: res.points % 1 ? '' : ',00', c: MAXPTS });
                why.replaceChildren();
                if (!res.correct && q.options[res.answer] !== undefined) why.append(el('p', { class: 'rightanswer' }, VBLang.t('the_right_answer_is'), el('b', { text: q.options[res.answer] })));
                if (res.explanation) why.append(el('p', { text: res.explanation }));
                if (res.points) { points += res.points; why.append(el('p', { class: 'muted small', text: VBLang.t('points_2', { n: res.points }) })); }
                else if (res.too_fast) why.append(el('p', { class: 'muted small', text: VBLang.t('answer_too_fast_no_points') }));
                // a wrong answer: where to look in the class material (the site's own search, no AI)
                if (!res.correct) {
                    const words = (q.question || '').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3).slice(0, 6).join(' ');
                    if (words && current) why.append(el('p', {}, el('a', { href: `appunti-archivio.php?class=${current.id}&q=${encodeURIComponent(words)}`, text: VBLang.t('search_in_the_material') })));
                }
                why.hidden = !why.childNodes.length;
                paintScore();
            };
            const choose = async (k) => {
                if (opts.dataset.done || opts.dataset.busy) return;
                opts.dataset.busy = '1';
                try { show(k, await grade(n, k)); }
                catch (e) { status(e.message, 'err'); [...opts.querySelectorAll('input')].forEach((i) => { i.checked = false; }); }
                finally { delete opts.dataset.busy; }
            };
            q.options.forEach((o, k) => opts.append(el('button', { type: 'button', class: 'qopt ' + (k % 2 ? 'r1' : 'r0'), onclick: () => choose(k) },
                el('input', { type: 'radio', name: `quiz-${n}-${Math.random().toString(36).slice(2, 6)}`, tabIndex: -1, 'aria-hidden': 'true' }),
                el('span', { class: 'qlabel', text: q.type === 'tf' ? o : `${'abcd'[k]}. ${o}` }), el('span', { class: 'qmark', 'aria-hidden': 'true' }))));
            const card = el('div', { class: 'quiz-q que', id: `quiz-q-${n}` },
                el('div', { class: 'info' }, el('h4', { class: 'no' }, VBLang.t('question_word'), el('span', { class: 'qno', text: String(n + 1) })), state, got, flag),
                el('div', { class: 'content' },
                    el('div', { class: 'formulation' },
                        q.topic || q.prof ? el('div', { class: 'topic' }, q.prof ? el('span', { class: 'qa-badge prof', text: VBLang.t('teacher_s_question') }) : null, q.topic || '') : null,
                        q.fails >= 2 ? el('div', { class: 'fails-note', text: VBLang.t('you_have_been_getting_this_wrong', { n: q.fails }) }) : null,
                        el('div', { class: 'quiz-qtext' }, el('div', { class: 'qtext', text: q.question }),
                            C.canSpeak() ? el('button', { type: 'button', class: 'ghost mini speak-btn', text: VBLang.t('read'), 'aria-label': VBLang.t('read_the_question_aloud'), onclick: () => C.speak(`${q.question}. ${q.type === 'tf' ? VBLang.t('tf_question') : q.options.map((o, k) => `${'ABCD'[k]}: ${o}`).join('. ')}`) }) : null),
                        el('div', { class: 'prompt', text: q.type === 'tf' ? VBLang.t('choose_an_answer') : VBLang.t('select_an_answer') }),
                        opts),
                    why));
            // answered in an earlier visit: the server sent the answer for this question only
            if (!practice && Number.isInteger(q.my_choice) && Number.isInteger(q.answer)) show(q.my_choice, { correct: q.my_choice === q.answer, answer: q.answer, explanation: q.explanation });
            else if (firstOpen < 0) firstOpen = n;
            list.append(card);
        });
        points = 0;   // the points shown are the ones of this visit
        paintScore();
        if (answered && answered < qs.length) {
            list.insertBefore(el('p', { class: 'muted small', text: VBLang.t('quiz_resumed_you_have_already_answered', { n: answered }) }), list.firstChild);
            setTimeout(() => { const t = box.querySelector('#quiz-q-' + firstOpen); if (t) t.scrollIntoView({ block: 'center' }); }, 50);
        }
        if (!noRestart && (answered === qs.length || practice)) list.append(el('button', { class: 'ghost', text: VBLang.t('start_again_practice_no_points'),
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
        $('#event-summary').textContent = VBLang.t('change_the_date');
        $('#event-submit').textContent = VBLang.t('save_the_changes');
        $('#event-cancel').hidden = false;
        $('#event-box').open = true;
        $('#event-box').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function resetEventForm() {
        editingEvent = null;
        $('#event-form').reset();
        if (window.AppuntiCalendar) window.AppuntiCalendar.setEventTopics([]);
        $('#event-summary').textContent = VBLang.t('add_a_test_or_an_oral');
        $('#event-submit').textContent = VBLang.t('add');
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
            status(editingEvent ? VBLang.t('changes_saved') : VBLang.t('added_to_the_calendar'), 'ok');
            resetEventForm();
            $('#event-box').open = false;
            loadEvents();
        } catch (e) {
            status(e.json && e.json.code === 'bad_period' ? VBLang.t('material_to_study_the_first_day') : e.message, 'err');
        }
    });

    async function deleteEvent(e) {
        if (!confirm(VBLang.t('delete_this_date_from_the_calendar'))) return;
        try { await notes_({ action: 'delete_event', id: e.id }); loadEvents(); } catch (err) { status(err.message, 'err'); }
    }

    /* ---------- class tab ---------- */

    function renderClass() {
        const c = current;
        $('#admin-note').hidden = c.is_member || c.demo;

        renderMembers(c);
        renderRoles(c);
        renderSubjects(c);
        $('#rep-panel').hidden = !can('roles') && !can('subjects') && !can('settings');
        $('#log-card').hidden = !can('settings');
        $('#log-details').open = false;
        $('#leave-btn').hidden = c.is_manager || !c.is_member || c.demo;

        $$('.tt-manage').forEach((x) => { x.hidden = !can('timetable'); });
        if (can('timetable')) $('#tt-from').value = c.timetable ? c.timetable.valid_from : todayStr();
        renderTimetable();
    }

    $('#log-details').addEventListener('toggle', async () => {
        if (!$('#log-details').open || !current) return;
        const box = $('#log-list');
        box.replaceChildren(el('li', { class: 'muted', text: VBLang.t('loading') }));
        try {
            const { log } = await getJson(`../api/classi.php?action=log&id=${current.id}`);
            box.replaceChildren(...(log.length ? log.map((l) => el('li', {}, el('b', { text: l.action }), l.detail ? el('span', { text: ` · ${l.detail}` }) : null, el('br'),
                el('span', { class: 'muted small', text: `${l.who} · ${new Date(l.at * 1000).toLocaleString(VBLang.t('locale'), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` })))
                : [el('li', { class: 'muted', text: VBLang.t('nothing_yet') })]));
        } catch (e) { box.replaceChildren(el('li', { class: 'err', text: e.message })); }
    });

    const can = (perm) => !!current && (current.perms || []).includes(perm);

    function myNameForm(c) {
        const me = c.members.find((m) => m.is_me) || null;
        const input = el('input', { name: 'name', maxLength: 40, placeholder: VBLang.t('first_and_last_name'), value: me ? me.display_name : '' });
        const form = el('form', { class: 'row my-name' }, el('label', { text: VBLang.t('your_name_in_this_class') }, input), el('button', { class: 'ghost', text: VBLang.t('save') }));
        form.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            try { await classes_({ action: 'display_name', id: c.id, name: input.value }); await openClass(c.id); status(VBLang.t('name_saved_in_class_your_classmates'), 'ok'); }
            catch (e) { status(e.message, 'err'); }
        });
        return el('div', {}, form, el('p', { class: 'muted small', text: VBLang.t('only_classmates_of_this_class_see') }));
    }

    function roleChip(c, m) {
        if (m.is_manager) return el('span', { class: 'role rep', text: VBLang.t('representative') });
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
                can('roles') ? { label: VBLang.t('role_and_permissions'), onclick: () => editAccess(c, m) } : null,
                can('members') ? { label: VBLang.t('change_the_name'), onclick: () => editName(c, m) } : null,
                c.is_manager || isAdmin ? { label: VBLang.t('make_representative'), onclick: () => setManager(m) } : null,
                can('members') ? { label: VBLang.t('remove_from_the_class'), danger: true, onclick: () => removeMember(m) } : null,
            ], VBLang.t('actions_for', { name: m.name })))));
    }

    const permBoxes = (c, chosen) => Object.entries(c.perm_labels).map(([k, label]) =>
        el('label', { class: 'switch perm' }, el('input', { type: 'checkbox', name: 'perm', value: k, checked: chosen.includes(k) }), label));
    const checkedPerms = (form) => [...form.querySelectorAll('input[name=perm]:checked')].map((x) => x.value);

    function editAccess(c, m) {
        C.dialogForm(VBLang.t('role_and_permissions_2', { name: m.name }), (form) => {
            form.append(el('label', { text: VBLang.t('role') }, el('select', { name: 'role' },
                el('option', { value: '', text: VBLang.t('no_role') }), ...c.roles.map((r) => el('option', { value: r.id, text: r.name, selected: r.id === m.role_id })))),
            el('p', { class: 'muted small', text: VBLang.t('extra_permissions_only_for_this_person') }),
            ...permBoxes(c, m.perms));
        }, async (form) => {
            await classes_({ action: 'set_member_access', id: c.id, user_id: m.id, role_id: Number(form.role.value) || 0, perms: checkedPerms(form) });
            await openClass(c.id);
            status(VBLang.t('permissions_saved'), 'ok');
        });
    }

    function editName(c, m) {
        C.dialogForm(VBLang.t('class_name_of', { name: m.username }), (form) => {
            form.append(el('label', { text: VBLang.t('name') }, el('input', { name: 'name', maxLength: 40, value: m.display_name })));
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
            return el('li', {}, el('span', {}, chip, el('span', { class: 'muted small', text: ` ${r.perms.length === 1 ? VBLang.t('perm_one') : VBLang.t('perm_n', { n: r.perms.length })}${who.length ? ' · ' + who.join(', ') : ''}` })),
                C.menu([{ label: VBLang.t('edit'), onclick: () => editRole(c, r) }, { label: VBLang.t('delete'), danger: true, onclick: () => deleteRole(c, r) }]));
        }) : [el('li', { class: 'muted small', text: VBLang.t('no_role_create_one_with_new') })]));
    }

    function editRole(c, r = null) {
        C.dialogForm(r ? VBLang.t('role_2', { name: r.name }) : VBLang.t('new_role'), (form) => {
            form.append(el('div', { class: 'row' },
                el('label', { text: VBLang.t('name') }, el('input', { name: 'name', maxLength: 30, required: true, value: r ? r.name : '', placeholder: VBLang.t('the_name_of_the_role_as') })),
                el('label', { text: VBLang.t('colour') }, el('input', { type: 'color', name: 'color', value: r ? r.color : '#5b8def' }))),
            el('p', { class: 'muted small', text: VBLang.t('what_whoever_has_this_role_can') }), ...permBoxes(c, r ? r.perms : []));
        }, async (form) => {
            await classes_({ action: 'save_role', id: c.id, role_id: r ? r.id : 0, name: form.name.value, color: form.color.value, perms: checkedPerms(form) });
            await openClass(c.id);
            status(VBLang.t('role_saved'), 'ok');
        });
    }

    async function deleteRole(c, r) {
        if (!confirm(VBLang.t('delete_the_role_whoever_has_it', { name: r.name }))) return;
        try { await classes_({ action: 'delete_role', id: c.id, role_id: r.id }); await openClass(c.id); } catch (e) { status(e.message, 'err'); }
    }
    $('#role-new').addEventListener('click', () => editRole(current));

    function renderSubjects(c) {
        $('#subjects-card').hidden = !can('subjects');
        if (!can('subjects')) return;
        $('#subjects').replaceChildren(...c.subjects.map((s) => el('li', {}, el('span', { text: s.name }), C.menu([
            c.subjects.length > 1 ? { label: VBLang.t('merge_into'), onclick: () => mergeSubject(c, s) } : null,
            { label: VBLang.t('delete'), danger: true, onclick: () => deleteSubject(c, s) }]))));
    }

    function mergeSubject(c, s) {
        C.dialogForm(VBLang.t('merge_into_2', { name: s.name }), (form) => {
            form.append(el('label', { text: VBLang.t('subject_that_stays') }, el('select', { name: 'into' },
                ...c.subjects.filter((x) => x.id !== s.id).map((x) => el('option', { value: x.id, text: x.name })))),
            el('p', { class: 'muted small', text: VBLang.t('the_material_the_calendar_dates_and', { from: s.name, to: s.name }) }));
        }, async (form) => {
            await classes_({ action: 'merge_subject', id: c.id, subject_id: s.id, into: Number(form.into.value) });
            await openClass(c.id);
            status(VBLang.t('subjects_merged'), 'ok');
        }, VBLang.t('merge'));
    }

    async function deleteSubject(c, s) {
        if (!confirm(VBLang.t('delete_the_subject_its_hours_in', { name: s.name }))) return;
        try { await classes_({ action: 'delete_subject', id: c.id, subject_id: s.id }); await openClass(c.id); status(VBLang.t('subject_deleted'), 'ok'); }
        catch (e) { status(e.json && e.json.code === 'not_empty' ? VBLang.t('this_subject_has_material_use_merge') : e.message, 'err'); }
    }

    async function setManager(m) {
        if (!confirm(VBLang.t('make_the_representative_of_the_class', { name: m.name }))) return;
        try { await classes_({ action: 'set_manager', id: current.id, user_id: m.id }); await openClass(current.id); } catch (e) { status(e.message, 'err'); }
    }
    async function removeMember(m) {
        if (!confirm(VBLang.t('remove_from_the_class_2', { name: m.name }))) return;
        try { await classes_({ action: 'remove_member', id: current.id, user_id: m.id }); await openClass(current.id); } catch (e) { status(e.message, 'err'); }
    }
    $('#leave-btn').addEventListener('click', async () => {
        if (!confirm(VBLang.t('leave_the_class_to_come_back'))) return;
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
    /** One colour per subject of the timetable, taken in turn from a short hand-picked palette (a lighter variant after 12 subjects). */
    function ttColors() {
        const names = [...new Set(Object.values(tt).flat().map((h) => (h.subject || '').trim().toLowerCase()).filter(Boolean))].sort();
        const map = new Map();
        const PALETTE = [212, 8, 152, 42, 276, 184, 334, 92, 24, 244, 62, 308];   // hand-picked, calm and far apart
        names.forEach((n, i) => map.set(n, { h: PALETTE[i % PALETTE.length], l: i < PALETTE.length ? 25 : 31 }));
        return (subject) => map.get((subject || '').trim().toLowerCase());
    }
    /** Consecutive hours of the same subject in a day are shown as one block: [{idx, n}]. */
    function ttRuns(list) {
        const runs = [];
        for (let i = 0; i < list.length; i++) {
            const s = (list[i].subject || '').trim().toLowerCase();
            const last = runs[runs.length - 1];
            if (s && last && (list[last.idx].subject || '').trim().toLowerCase() === s) last.n++;
            else runs.push({ idx: i, n: 1 });
        }
        return runs;
    }

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
        const colorOf = ttColors();
        const at = (row, col, span = 1) => `grid-row: ${row} / span ${span}; grid-column: ${col}`;
        grid.append(el('div', { class: 'tt-corner', style: at(1, 1) }));
        days.forEach((d, di) => {
            grid.append(el('div', { class: 'tt-head' + (d === String(focusDay(days)) ? ' today' : ''), style: at(1, di + 2), 'data-day': d }, el('b', { text: DAYS[d - 1] }),
                !edit ? null : el('span', { class: 'tt-head-actions' },
                    el('button', { type: 'button', class: 'ghost mini', text: VBLang.t('period_2'), title: VBLang.t('add_a_period_at_the_bottom'), onclick: () => {
                        const last = tt[d][tt[d].length - 1];
                        tt[d].push({ start: last ? last.end : '08:00', end: addMinutes(last ? last.end : '08:00', 60), subject: '', room: '' });
                        drawTimetable();
                    } }),
                    el('button', { type: 'button', class: 'ghost mini', text: '✕', title: VBLang.t('remove_2', { name: DAYS[d - 1] }), 'aria-label': VBLang.t('remove_2', { name: DAYS[d - 1] }), onclick: () => {
                        if (!confirm(VBLang.t('remove_from_the_timetable_the_hours', { name: DAYS[d - 1] }))) return;
                        delete tt[d];
                        drawTimetable();
                    } }))));
        });
        grid.append(el('div', { class: 'tt-corner', style: at(1, days.length + 2) }));
        for (let r = 0; r < rows; r++) {
            grid.append(el('div', { class: 'tt-num', text: `${r + 1}ª`, style: at(r + 2, 1) }));
            grid.append(el('div', { class: 'tt-num tt-num-end', text: `${r + 1}ª`, style: at(r + 2, days.length + 2) }));
        }
        days.forEach((d, di) => {
            for (const { idx, n } of ttRuns(tt[d])) {
                const h = tt[d][idx];
                const end = tt[d][idx + n - 1].end;
                const cell = el(edit ? 'button' : 'div', { type: edit ? 'button' : null, class: 'tt-cell' + (h.subject ? '' : ' empty') + (n > 1 ? ' tall' : ''), style: at(idx + 2, di + 2, n),
                    onclick: edit ? () => editHour(d, idx, n) : null },
                    el('span', { class: 'tt-time', text: `${h.start}–${end}` }),
                    el('b', { class: 'tt-subj', text: h.subject || (edit ? VBLang.t('subject_2') : '—') }),
                    n > 1 ? el('span', { class: 'tt-room', text: VBLang.t('hours', { n }) }) : null,
                    h.room ? el('span', { class: 'tt-room', text: h.room }) : null);
                const c = h.subject && colorOf(h.subject);
                if (c) { cell.style.setProperty('--h', c.h); cell.style.setProperty('--l', c.l + '%'); }
                grid.append(cell);
            }
        });
        const missing = [1, 2, 3, 4, 5, 6, 7].map(String).filter((d) => !tt[d]);
        const add = missing.length && edit ? el('div', { class: 'row tt-add' },
            el('select', { 'aria-label': VBLang.t('day_to_add') }, ...missing.map((d) => el('option', { value: d, text: DAYS[d - 1] }))),
            el('button', { type: 'button', class: 'ghost', text: VBLang.t('add_day'), onclick: (ev) => {
                const d = ev.target.previousElementSibling.value;
                const copy = tt['1'] || tt[Object.keys(tt)[0]] || [{ start: '08:00', end: '09:00' }];
                tt[d] = copy.map((h) => ({ start: h.start, end: h.end, subject: '', room: '' }));
                drawTimetable();
            } })) : null;
        box.replaceChildren(
            el('datalist', { id: 'tt-subjects' }, ...current.subjects.map((s) => el('option', { value: s.name }))),
            days.length ? el('div', { class: 'tt-scroll' }, grid) : el('p', { class: 'empty', text: edit ? VBLang.t('no_day_add_one') : VBLang.t('the_timetable_is_not_there_yet') }),
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
    function editHour(day, idx, n = 1) {
        const h = tt[day][idx];
        const dlg = el('dialog', { class: 'tt-dialog' });
        const form = el('form', { method: 'dialog', class: 'stack' },
            el('h3', { text: `${DAYS[day - 1]}, ${n > 1 ? VBLang.t('period_range_dash', { from: idx + 1, to: idx + n }) : VBLang.t('period_one_h', { n: idx + 1 })}` }),
            el('label', { text: VBLang.t('subject') }, el('input', { name: 'subject', value: h.subject, list: 'tt-subjects', maxLength: 60, placeholder: VBLang.t('empty_free_hour') })),
            el('label', { text: VBLang.t('room_optional') }, el('input', { name: 'room', value: h.room, maxLength: 30 })),
            el('div', { class: 'grid2' },
                el('label', { text: VBLang.t('start') }, el('input', { type: 'time', name: 'start', value: h.start, required: true })),
                el('label', { text: VBLang.t('end') }, el('input', { type: 'time', name: 'end', value: h.end, required: true }))),
            el('label', { class: 'switch' }, el('input', { type: 'checkbox', name: 'all' }), VBLang.t('same_times_for_period_on_all', { n: idx + 1 })),
            el('div', { class: 'row' },
                el('button', { value: 'save', text: VBLang.t('save') }),
                el('button', { type: 'button', class: 'ghost', text: VBLang.t('cancel'), onclick: () => dlg.close() }),
                el('button', { type: 'button', class: 'danger', text: n > 1 ? VBLang.t('remove_these_hours', { n }) : VBLang.t('remove_this_hour'), onclick: () => {
                    tt[day].splice(idx, n);
                    if (!tt[day].length) delete tt[day];
                    dlg.close();
                    drawTimetable();
                } })));
        form.addEventListener('submit', (ev) => {
            if (!form.start.value || !form.end.value || form.start.value >= form.end.value) { ev.preventDefault(); status(VBLang.t('the_hour_must_end_after_it'), 'err'); return; }
            Object.assign(h, { subject: form.subject.value.trim(), room: form.room.value.trim(), start: form.start.value, end: form.end.value });
            for (let k = 1; k < n; k++) Object.assign(tt[day][idx + k], { subject: h.subject, room: h.room });
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
        if (!files.length) { status(VBLang.t('choose_the_photo_or_the_pdf'), 'err'); return; }
        const fd = new FormData();
        fd.set('action', 'read_timetable');
        fd.set('id', current.id);
        files.slice(0, 3).forEach((f) => fd.append('files[]', f, f.name));
        const btn = $('#tt-read');
        btn.disabled = true;
        status(VBLang.t('reading_the_timetable_it_can_take'));
        try {
            const r = await post('../api/classi.php', fd);
            renderTimetable(r.periods, r.slots);
            status(VBLang.t('timetable_read', { model: r.model ? VBLang.t('with_model', { model: r.model }) : '', n: r.slots.length, bells: r.bells_read ? VBLang.t('bells_read') : VBLang.t('bells_missing') })
                + VBLang.t('check_the_table_and_press_save') + (r.notes ? VBLang.t('note_from_the_ai', { note: r.notes }) : ''), 'ok');
            $('#tt-days').scrollIntoView({ behavior: 'smooth' });
        } catch (e) {
            const msg = { ai_off: VBLang.t('the_ai_is_not_active_on_2'), ai_quota: VBLang.t('the_ai_has_used_up_today'),
                ai_failed: VBLang.t('the_ai_could_not_read_the'), bad_type: VBLang.t('use_a_photo_or_a_pdf'),
                ai_busy: VBLang.t('gemini_is_overloaded_right_now_it'),
                ai_unreadable: null,
                slow_down: VBLang.t('too_many_attempts_try_again_in') };
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
            status(VBLang.t('timetable_saved'), 'ok');
        } catch (e) { status(e.message, 'err'); }
    });

    /* ---------- join / request ---------- */

    async function join(ev) {
        ev.preventDefault();
        try {
            const r = await classes_({ action: 'join', code: ev.target.code.value });
            ev.target.reset();
            status(VBLang.t('you_joined', { name: r.name }), 'ok');
            await loadMine(r.id);
        } catch (e) { status(e.message, 'err'); }
    }
    $('#join-form').addEventListener('submit', join);
    $('#demo-open').addEventListener('click', () => { store(DEMO_KEY, '1'); loadMine(demoClass.id).catch((e) => status(e.message, 'err')); });
    $('#demo-close').addEventListener('click', () => { try { localStorage.removeItem(DEMO_KEY); } catch (e) { /* private mode */ } loadMine().catch((e) => status(e.message, 'err')); });

    $('#request-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const f = ev.target;
        try {
            await classes_({ action: 'request', name: f.name.value, school: f.school.value, note: f.note.value, adults: f.adults.checked });
            f.reset();
            status(VBLang.t('request_sent_you_will_see_it'), 'ok');
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
            if (all.upload_limits) { lf.files.value = all.upload_limits.files; lf.per_hour.value = all.upload_limits.per_hour; lf.open.value = all.upload_limits.open; }
            const pending = all.classes.filter((c) => c.status === 'pending');
            $('#admin-requests').replaceChildren(...(pending.length ? pending.map((c) => el('li', {},
                el('span', {}, el('b', { text: `${c.name} · ${c.school}` }), el('br'),
                    el('span', { class: 'muted small', text: VBLang.t('req_line', { who: c.manager || '?', note: c.note ? ' — ' + c.note : '', adults: c.all_adults ? VBLang.t('all_adults_yes') : VBLang.t('all_adults_no') }) })),
                el('span', {},
                    el('button', { class: 'mini', text: VBLang.t('approve'), onclick: () => decide(c, true) }), ' ',
                    el('button', { class: 'danger mini', text: VBLang.t('reject'), onclick: () => decide(c, false) }))))
                : [el('li', { class: 'muted', text: VBLang.t('no_pending_requests') })]));
            const stLabel = { active: 'attiva', pending: 'in attesa', rejected: 'rifiutata' };
            $('#admin-classes').replaceChildren(...all.classes.filter((c) => c.status !== 'pending').map((c) => el('li', {},
                el('span', {}, el('b', { text: `${c.name} · ${c.school}` }), el('br'),
                    el('span', { class: 'muted small', text: VBLang.t('members_representative_mb_file_mb', { school: stLabel[c.status] || c.status, n: c.members, manager: c.manager || '?', file: c.limits_mb.file, total: c.limits_mb.class }) })),
                el('button', { class: 'danger mini', text: VBLang.t('delete'), onclick: () => deleteClass(c) }))));
        } catch (e) { status(e.message, 'err'); }
    }
    async function decide(c, approve) {
        try { await classes_({ action: 'decide', id: c.id, approve }); status(approve ? VBLang.t('class_approved') : VBLang.t('request_rejected'), 'ok'); loadAdmin(); } catch (e) { status(e.message, 'err'); }
    }
    async function deleteClass(c) {
        if (!confirm(VBLang.t('delete_with_all_the_material_this', { name: c.name, school: c.school }))) return;
        try { await classes_({ action: 'delete_class', id: c.id }); status(VBLang.t('class_deleted'), 'ok'); await loadMine(); showTab('admin'); } catch (e) { status(e.message, 'err'); }
    }
    $('#requests-open').addEventListener('change', async (ev) => {
        try { await classes_({ action: 'set_requests_open', open: ev.target.checked }); status(ev.target.checked ? VBLang.t('requests_open') : VBLang.t('requests_closed'), 'ok'); } catch (e) { status(e.message, 'err'); }
    });
    $('#limits-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        try {
            await classes_({ action: 'set_limits', file_mb: Number(ev.target.file_mb.value), class_mb: Number(ev.target.class_mb.value),
                files: Number(ev.target.files.value), per_hour: Number(ev.target.per_hour.value), open: Number(ev.target.open.value) });
            status(VBLang.t('limits_saved'), 'ok');
            loadAdmin();
        } catch (e) { status(e.message, 'err'); }
    });


    /* ---------- notifications: bell and push ---------- */

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
    window.VBDrop.attach({ label: VBLang.t('drop_them_here'), hint: VBLang.t('they_open_in_the_upload_page'), onFiles: (files) => { if (current) C.handOff(files); else C.toast(VBLang.t('to_upload_you_have_to_be'), 'err'); } });
    loadMine(Number(startParams.get('class')) || null)
        .then(() => applyParams(startParams))
        .catch((e) => status(e.message, 'err'));
})();
