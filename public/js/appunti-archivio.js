// public/js/appunti-archivio.js — archive of a class as folders: Subjects | Folders (lesson days, Tests) | Files | Preview.
// On a computer the four columns sit side by side and scroll on their own; on a phone one level at a time (data-level).
(() => {
    'use strict';
    const C = window.AppuntiCommon;
    const { el, getJson, md } = C;
    const $ = (s) => document.querySelector(s);

    let classes = [];
    let classId = null;
    let tree = [];          // subjects with days
    let docs = [];          // AI documents of the class (no text)
    let events = [];
    const sel = { subject: null, folder: null, entry: null };   // folder: 'tests' | 'YYYY-MM-DD'

    function status(msg, kind = '') { if (msg) C.toast(msg, kind); }
    const fileUrl = (id) => `../api/appunti.php?action=file&id=${id}`;
    const shortDay = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

    // On a phone one level is shown at a time: each deeper level is a history entry, so the phone's back
    // button (and "‹ Indietro") goes up one folder instead of leaving the page
    let level = 0;
    function setLevel(n, fromHistory = false) {
        if (!fromHistory && n > level) history.pushState({ level: n }, '');
        level = n;
        $('#arch').dataset.level = String(n);
        $('#back-btn').hidden = n === 0;
        renderCrumbs();
        if (window.matchMedia('(max-width: 760px)').matches) window.scrollTo(0, 0);
    }
    window.addEventListener('popstate', (ev) => {
        let n = ev.state && Number.isInteger(ev.state.level) ? ev.state.level : 0;
        // after a jump with the path links, history can point deeper than what is still selected
        n = Math.min(n, sel.entry ? 3 : sel.folder ? 2 : sel.subject ? 1 : 0);
        if (n < 3) sel.entry = null;
        if (n < 2) sel.folder = null;
        if (n < 1) sel.subject = null;
        renderAll();
        if (n < 3) renderPreview(null);
        setLevel(n, true);
    });
    function goBack() {
        if (level > 0 && history.state && history.state.level === level) history.back();
        else { const n = Math.max(0, level - 1); window.dispatchEvent(new PopStateEvent('popstate', { state: { level: n } })); }
    }

    function renderCrumbs() {
        const parts = [el('button', { type: 'button', class: 'crumb', text: 'Materie', onclick: () => { sel.subject = null; sel.folder = null; sel.entry = null; renderAll(); setLevel(0); } })];
        const subject = tree.find((s) => s.id === sel.subject);
        if (subject) parts.push(' › ', el('button', { type: 'button', class: 'crumb', text: subject.name, onclick: () => { sel.folder = null; sel.entry = null; renderAll(); setLevel(1); } }));
        if (sel.folder) parts.push(' › ', el('button', { type: 'button', class: 'crumb', text: folderTitle(sel.folder),
            onclick: () => { sel.entry = null; renderPreview(null); setLevel(2); } }));
        if (sel.entry) parts.push(' › ', el('span', { class: 'crumb now', text: sel.entry.label }));
        $('#crumbs').replaceChildren(...parts);
    }

    function folderTitle(folder) {
        if (folder.startsWith('cat:')) { const c = catOf(folder.slice(4)); return c ? c[2] : folder; }
        return shortDay.format(C.parseDate(folder));
    }

    function row({ icon, label, meta, active, onclick, title }) {
        return el('button', { type: 'button', class: 'arow' + (active ? ' active' : ''), onclick, title: title || label },
            el('span', { class: 'aicon', text: icon }), el('span', { class: 'alabel' }, el('span', { text: label }), meta ? el('small', { text: meta }) : null));
    }

    /* ---------- columns ---------- */

    function renderSubjects() {
        const col = $('#col-subjects');
        if (!tree.length) { col.replaceChildren(el('p', { class: 'empty', text: 'Ancora nessuna materia: il rappresentante deve inserire l\'orario.' })); return; }
        col.replaceChildren(el('h3', { class: 'col-h', text: 'Materie' }), ...tree.map((s) => row({
            icon: '📁', label: s.name, active: s.id === sel.subject,
            meta: s.days.length ? `${s.days.length} ${s.days.length === 1 ? 'giorno' : 'giorni'}` : 'vuota',
            onclick: () => { sel.subject = s.id; sel.folder = null; sel.entry = null; renderAll(); setLevel(1); },
        })));
    }

    // Folders by type inside a subject: [key, icon, label, count from the tree]
    const CATS = [
        ['appunti', '📝', 'Appunti', (c) => c.appunti || 0],
        ['foto', '🖼', 'Foto', (c) => c.foto || 0],
        ['audio', '🎧', 'Audio', (c) => c.audio || 0],
        ['domande', '❓', 'Domande', (c) => (c.domande || 0) + (c.domande_ai || 0)],
        ['slide', '📊', 'Slide e materiale del prof', (c) => c.slide || 0],
        ['libro', '📖', 'Libro', (c) => c.libro || 0],
        ['prova', '📋', 'Verifiche di prova', (c) => c.prova || 0],
        ['ai', '🤖', 'Appunti fatti dall\'AI', (c) => c.ai || 0],
        ['schemi', '🧠', 'Schemi', (c) => c.schemi || 0],
        ['tests', '📘', 'Verifiche (documenti di studio)', (c) => c.verifiche || 0],
    ];
    const catOf = (key) => CATS.find((c) => c[0] === key);

    function renderFolders() {
        const col = $('#col-folders');
        const subject = tree.find((s) => s.id === sel.subject);
        if (!subject) { col.replaceChildren(); return; }
        const cats = subject.cats || {};
        const byType = CATS.filter(([, , , n]) => n(cats) > 0).map(([key, icon, label, n]) => row({
            icon, label, meta: String(n(cats)), active: sel.folder === 'cat:' + key, onclick: () => openFolder('cat:' + key) }));
        const byDay = subject.days.map((d) => {
            const bits = [];
            if (d.files) bits.push(`${d.files} file`);
            if (d.items > d.files) bits.push('testi');
            if (d.docs) bits.push('riassunto AI');
            return row({ icon: '🗂', label: shortDay.format(C.parseDate(d.date)), meta: bits.join(' · '), active: sel.folder === d.date,
                onclick: () => openFolder(d.date) });
        });
        col.replaceChildren(el('h3', { class: 'col-h', text: subject.name }),
            ...(byType.length ? [el('p', { class: 'agroup', text: 'Per tipo' }), ...byType] : []),
            ...(byDay.length ? [el('p', { class: 'agroup', text: 'Per giorno' }), ...byDay] : []),
            ...(!byType.length && !byDay.length ? [el('p', { class: 'empty', text: 'Ancora niente per questa materia.' })] : []));
    }

    const fileIcon = (f) => f.mime.startsWith('image/') ? '🖼' : f.mime.startsWith('audio/') ? '🎧' : f.mime === 'application/pdf' ? '📕'
        : /word|opendocument\.text/.test(f.mime) ? '📄' : /presentation/.test(f.mime) ? '📊' : '📃';
    const docEntry = (d, label) => ({ type: 'doc', id: d.id, kind: d.kind, icon: d.kind === 'schema' ? '🧠' : d.kind === 'quiz' || d.kind === 'domande' ? '❓' : d.event_id ? '📘' : '📝',
        label: label + (d.manual ? ` · di ${d.author || '?'}` : ''), meta: d.status === 'ok' ? (d.lesson_date ? shortDay.format(C.parseDate(d.lesson_date)) : '') : 'non riuscito',
        disabled: d.status !== 'ok' });
    /** Entries of one item: its text and its files (optionally only some files). */
    function itemEntries(it, withDate, fileFilter = () => true, withText = true) {
        const out = [];
        const who = it.author || '?';
        const kind = C.KINDS[it.kind] || it.kind;
        const when = withDate ? ' · ' + shortDay.format(C.parseDate(it.lesson_date)) : '';
        if (withText && it.body) out.push({ type: 'text', item: it, icon: '✍️', label: it.title || `${kind} scritti`, meta: `${who} · ${kind}${when}` });
        for (const f of it.files.filter(fileFilter)) out.push({ type: 'file', file: f, item: it, icon: fileIcon(f), label: f.name, meta: `${who}${when} · ${C.sizeText(f.size)}` });
        return out;
    }

    let subjectItems = { id: null, items: [] };
    async function itemsOfSubject() {
        if (subjectItems.id !== sel.subject) {
            const q = new URLSearchParams({ action: 'items', class_id: classId, subject_id: sel.subject });
            subjectItems = { id: sel.subject, items: (await getJson('../api/appunti.php?' + q)).items };
        }
        return subjectItems.items;
    }

    let entries = [];
    async function openFolder(folder) {
        sel.folder = folder;
        sel.entry = null;
        renderFolders();
        renderPreview(null);
        setLevel(2);
        const col = $('#col-files');
        col.replaceChildren(el('p', { class: 'empty', text: 'Carico…' }));
        entries = [];
        try {
            const cat = folder.startsWith('cat:') ? folder.slice(4) : null;
            const subjDocs = docs.filter((x) => x.subject_id === sel.subject);
            if (cat === 'tests') {
                const byEvent = new Map();
                for (const d of subjDocs.filter((x) => x.event_id && x.kind !== 'schema')) {
                    if (!byEvent.has(d.event_id)) byEvent.set(d.event_id, []);
                    byEvent.get(d.event_id).push(d);
                }
                for (const [eid, list] of byEvent) {
                    const ev = events.find((e) => e.id === eid);
                    entries.push({ group: ev ? `${ev.kind === 'interrogazione' ? 'Interrogazione' : 'Verifica'} del ${C.parseDate(ev.date).toLocaleDateString('it-IT')}${ev.title ? ' · ' + ev.title : ''}`
                        : (list[0].title || 'Verifica') });
                    for (const d of list) entries.push(docEntry(d, C.DOC_KINDS[d.kind] || d.kind));
                }
            } else if (cat === 'ai') {
                for (const d of subjDocs.filter((x) => x.kind === 'lezione')) entries.push(docEntry(d, 'Appunti della lezione'));
            } else if (cat === 'schemi') {
                for (const d of subjDocs.filter((x) => x.kind === 'schema')) {
                    const ev = d.event_id ? events.find((e) => e.id === d.event_id) : null;
                    entries.push(docEntry(d, ev ? `Schema per la ${ev.kind === 'interrogazione' ? 'interrogazione' : 'verifica'}${ev.title ? ' · ' + ev.title : ''}` : 'Schema della lezione'));
                }
            } else if (cat === 'domande') {
                // the lesson questions written by the AI (teacher's questions first), then those uploaded by classmates
                for (const d of subjDocs.filter((x) => x.kind === 'domande')) entries.push(docEntry(d, 'Domande della lezione'));
                for (const it of await itemsOfSubject()) if (it.kind === 'domande') entries.push(...itemEntries(it, true));
            } else if (cat) {
                const items = await itemsOfSubject();
                for (const it of items) {
                    if (cat === 'foto') entries.push(...itemEntries(it, true, (f) => f.mime.startsWith('image/'), false));
                    else if (cat === 'audio') entries.push(...itemEntries(it, true, (f) => f.mime.startsWith('audio/'), false));
                    else if (it.kind === cat) entries.push(...itemEntries(it, true));
                }
            } else {
                const q = new URLSearchParams({ action: 'items', class_id: classId, subject_id: sel.subject, from: folder, to: folder });
                const { items } = await getJson('../api/appunti.php?' + q);
                for (const d of subjDocs.filter((x) => x.kind === 'lezione' && x.lesson_date === folder)) entries.push(docEntry(d, d.manual ? 'Appunti della lezione' : 'Appunti della lezione (AI)'));
                for (const d of subjDocs.filter((x) => x.kind === 'schema' && !x.event_id && x.lesson_date === folder)) entries.push(docEntry(d, 'Schema della lezione'));
                for (const d of subjDocs.filter((x) => x.kind === 'domande' && x.lesson_date === folder)) entries.push(docEntry(d, 'Domande della lezione'));
                for (const it of items.slice().reverse()) entries.push(...itemEntries(it, false));
            }
        } catch (e) { status(e.message, 'err'); }
        renderFiles();
    }

    function renderFiles() {
        const col = $('#col-files');
        if (!sel.folder) { col.replaceChildren(); return; }
        const title = folderTitle(sel.folder);
        col.replaceChildren(el('h3', { class: 'col-h', text: title }), ...(entries.length ? entries.map((en) => en.group
            ? el('p', { class: 'agroup', text: en.group })
            : row({ icon: en.icon, label: en.label, meta: en.meta, active: sel.entry === en, onclick: () => { if (!en.disabled) openEntry(en); } }))
            : [el('p', { class: 'empty', text: 'Cartella vuota.' })]));
    }

    async function openEntry(en) {
        sel.entry = en;
        renderFiles();
        setLevel(3);
        await renderPreview(en);
    }

    /* ---------- preview ---------- */

    async function renderPreview(en) {
        const pv = $('#preview');
        if (!en) { pv.replaceChildren(el('p', { class: 'empty', text: sel.folder ? 'Scegli un file.' : 'Scegli una materia, poi un giorno: qui vedi il file senza uscire dalla pagina.' })); return; }
        const head = (title, ...actions) => el('div', { class: 'pv-head' }, el('h2', { text: title }), el('div', { class: 'row-actions' }, ...actions));
        try {
            if (en.type === 'file') {
                const f = en.file;
                const dl = el('a', { class: 'ghost-link ico-dl', href: fileUrl(f.id), download: f.name, text: 'Scarica' });
                const open = el('a', { class: 'ghost-link', href: fileUrl(f.id), target: '_blank', rel: 'noopener', text: 'Apri' });
                const meta = el('p', { class: 'muted small', text: `${en.meta}${f.text_status === 'pending' ? ' · trascrizione in arrivo' : ''}` });
                if (f.mime.startsWith('image/') && !/heic|heif/.test(f.mime)) {
                    pv.replaceChildren(head(f.name, open, dl), meta, el('img', { class: 'pv-img', src: fileUrl(f.id), alt: f.name }), await textBlock(f, true));
                } else if (f.mime.startsWith('audio/')) {
                    pv.replaceChildren(head(f.name, dl), meta, el('audio', { class: 'pv-audio', controls: true, preload: 'metadata', src: fileUrl(f.id) }), await textBlock(f, true));
                } else if (f.mime === 'application/pdf') {
                    pv.replaceChildren(head(f.name, open, dl), meta, el('iframe', { class: 'pv-frame', src: fileUrl(f.id), title: f.name }));
                } else {
                    pv.replaceChildren(head(f.name, dl), meta, await textBlock(f, false));
                }
            } else if (en.type === 'text') {
                const it = en.item;
                pv.replaceChildren(head(en.label), el('p', { class: 'muted small', text: en.meta }),
                    C.looksLikeMarkdown(it.body) ? el('div', { class: 'md' }, md(it.body)) : el('div', { class: 'pv-text', text: it.body }));
            } else {
                const { doc } = await getJson(`../api/appunti.php?action=doc&id=${en.id}`);
                const body = doc.kind === 'quiz' ? quizList(doc.content) : doc.kind === 'schema' ? C.renderSchema(doc.content)
                    : doc.kind === 'domande' ? C.renderQuestions(doc.content) : el('div', { class: 'md' }, md(doc.content));
                pv.replaceChildren(head(doc.title, el('a', { class: 'ghost-link', href: `appunti.php?class=${classId}&tab=study`, text: 'Apri in Studio' })),
                    el('p', { class: 'muted small', text: doc.manual ? `Fatto con un'altra AI, caricato da ${doc.author || '?'}` : 'Scritto dall\'AI dal materiale della classe: può sbagliare, controlla.' }),
                    body);
            }
            pv.scrollTop = 0;
        } catch (e) { pv.replaceChildren(el('p', { class: 'empty', text: e.message })); }
    }

    /** The text the site has for a file: what was extracted (Word, slides, text) or the AI transcription (photos, PDF). */
    async function textBlock(f, isImage) {
        if (f.text_status !== 'done') {
            return isImage ? el('span') : el('p', { class: 'empty', text: f.text_status === 'pending'
                ? 'La trascrizione arriva tra poco: intanto puoi scaricare il file.' : 'Anteprima non disponibile: scarica il file.' });
        }
        const t = await getJson(`../api/appunti.php?action=file_text&id=${f.id}`);
        if (!t.text) return el('span');
        const box = el('div', { class: 'pv-transcript' }, el('p', { class: 'muted small', text: isImage ? (f.mime.startsWith('audio/') ? 'Trascrizione della registrazione:' : 'Trascrizione:') : '' }));
        box.append(C.looksLikeMarkdown(t.text) ? el('div', { class: 'md' }, md(t.text)) : el('div', { class: 'pv-text', text: t.text }));
        return box;
    }

    function quizList(content) {
        let quiz = null;
        try { quiz = JSON.parse(content); } catch (e) { return el('p', { text: 'Quiz non leggibile.' }); }
        return el('ol', { class: 'quiz-plain' }, ...(quiz.questions || []).map((q) => el('li', {},
            el('b', { text: q.question }),
            el('ol', { type: 'A' }, ...q.options.map((o, k) => el('li', { class: k === q.answer ? 'right' : '', text: o + (k === q.answer ? '  ✓' : '') }))),
            q.explanation ? el('p', { class: 'muted small', text: q.explanation }) : null)));
    }

    /* ---------- load ---------- */

    function renderAll() { renderSubjects(); renderFolders(); renderFiles(); renderCrumbs(); }

    async function openClass(id) {
        classId = id;
        C.store(C.CLASS_KEY, String(id));
        sel.subject = sel.folder = sel.entry = null;
        subjectItems = { id: null, items: [] };
        status('');
        try {
            const [t, d, ev] = await Promise.all([
                getJson(`../api/appunti.php?action=tree&class_id=${id}`),
                getJson(`../api/appunti.php?action=docs&class_id=${id}`),
                getJson(`../api/appunti.php?action=events&class_id=${id}&from=2000-01-01&to=2999-12-31`),
            ]);
            tree = t.subjects;
            docs = d.docs;
            events = ev.events;
        } catch (e) { status(e.message, 'err'); }
        renderAll();
        renderPreview(null);
        setLevel(0);
    }

    $('#back-btn').addEventListener('click', goBack);
    history.replaceState({ level: 0 }, '');

    (async () => {
        try {
            const mine = await getJson('../api/classi.php?action=mine');
            classes = mine.classes;
            if (!classes.length) { location.href = 'appunti.php'; return; }
            const want = Number(new URLSearchParams(location.search).get('class') || C.stored(C.CLASS_KEY));
            const pick = classes.find((c) => c.id === want) || classes[0];
            const select = $('#class-select');
            select.replaceChildren(...classes.map((c) => el('option', { value: c.id, text: `${c.name} · ${c.school}`, selected: c.id === pick.id })));
            select.addEventListener('change', () => openClass(Number(select.value)));
            await openClass(pick.id);
            // a link from the calendar: straight into a subject
            const wantSubject = Number(new URLSearchParams(location.search).get('subject'));
            if (wantSubject && tree.some((x) => x.id === wantSubject)) { sel.subject = wantSubject; sel.folder = null; sel.entry = null; renderAll(); setLevel(1); }
        } catch (e) { status(e.message, 'err'); }
    })();
})();
