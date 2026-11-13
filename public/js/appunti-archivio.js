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

    function status(msg, kind = '') { const s = $('#status'); s.textContent = msg || ''; s.className = 'status arch-status' + (kind ? ' ' + kind : ''); }
    const fileUrl = (id) => `../api/appunti.php?action=file&id=${id}`;
    const shortDay = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

    function setLevel(n) {
        $('#arch').dataset.level = String(n);
        renderCrumbs();
    }

    function renderCrumbs() {
        const parts = [el('button', { type: 'button', class: 'crumb', text: 'Materie', onclick: () => { sel.subject = null; sel.folder = null; sel.entry = null; renderAll(); setLevel(0); } })];
        const subject = tree.find((s) => s.id === sel.subject);
        if (subject) parts.push(' › ', el('button', { type: 'button', class: 'crumb', text: subject.name, onclick: () => { sel.folder = null; sel.entry = null; renderAll(); setLevel(1); } }));
        if (sel.folder) parts.push(' › ', el('button', { type: 'button', class: 'crumb', text: sel.folder === 'tests' ? 'Verifiche' : shortDay.format(C.parseDate(sel.folder)),
            onclick: () => { sel.entry = null; renderPreview(null); setLevel(2); } }));
        if (sel.entry) parts.push(' › ', el('span', { class: 'crumb now', text: sel.entry.label }));
        $('#crumbs').replaceChildren(...parts);
    }

    function row({ icon, label, meta, active, onclick, title }) {
        return el('button', { type: 'button', class: 'arow' + (active ? ' active' : ''), onclick, title: title || label },
            el('span', { class: 'aicon', text: icon }), el('span', { class: 'alabel' }, el('span', { text: label }), meta ? el('small', { text: meta }) : null));
    }

    /* ---------- columns ---------- */

    function renderSubjects() {
        const col = $('#col-subjects');
        if (!tree.length) { col.replaceChildren(el('p', { class: 'empty', text: 'Ancora nessuna materia: il responsabile deve inserire l\'orario.' })); return; }
        col.replaceChildren(el('h3', { class: 'col-h', text: 'Materie' }), ...tree.map((s) => row({
            icon: '📁', label: s.name, active: s.id === sel.subject,
            meta: s.days.length ? `${s.days.length} ${s.days.length === 1 ? 'giorno' : 'giorni'}` : 'vuota',
            onclick: () => { sel.subject = s.id; sel.folder = null; sel.entry = null; renderAll(); setLevel(1); },
        })));
    }

    function renderFolders() {
        const col = $('#col-folders');
        const subject = tree.find((s) => s.id === sel.subject);
        if (!subject) { col.replaceChildren(); return; }
        const rows = [];
        const testCount = docs.filter((d) => d.subject_id === subject.id && d.event_id).length;
        if (testCount) rows.push(row({ icon: '📘', label: 'Verifiche', meta: `${testCount} documenti di studio`, active: sel.folder === 'tests',
            onclick: () => openFolder('tests') }));
        for (const d of subject.days) {
            const bits = [];
            if (d.files) bits.push(`${d.files} file`);
            if (d.items > d.files) bits.push('testi');
            if (d.docs) bits.push('riassunto AI');
            rows.push(row({ icon: '🗂', label: shortDay.format(C.parseDate(d.date)), meta: bits.join(' · '), active: sel.folder === d.date,
                onclick: () => openFolder(d.date) }));
        }
        col.replaceChildren(el('h3', { class: 'col-h', text: subject.name }),
            ...(rows.length ? rows : [el('p', { class: 'empty', text: 'Ancora niente per questa materia.' })]));
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
            if (folder === 'tests') {
                const byEvent = new Map();
                for (const d of docs.filter((x) => x.subject_id === sel.subject && x.event_id)) {
                    if (!byEvent.has(d.event_id)) byEvent.set(d.event_id, []);
                    byEvent.get(d.event_id).push(d);
                }
                for (const [eid, list] of byEvent) {
                    const ev = events.find((e) => e.id === eid);
                    const head = ev ? `${ev.kind === 'interrogazione' ? 'Interrogazione' : 'Verifica'} del ${C.parseDate(ev.date).toLocaleDateString('it-IT')}${ev.title ? ' · ' + ev.title : ''}`
                        : (list[0].title || 'Verifica');
                    entries.push({ group: head });
                    for (const d of list) entries.push({ type: 'doc', id: d.id, icon: d.kind === 'quiz' ? '❓' : '📘',
                        label: C.DOC_KINDS[d.kind] + (d.manual ? ` · di ${d.author || '?'}` : ''), meta: d.status === 'ok' ? '' : 'non riuscito', disabled: d.status !== 'ok' });
                }
            } else {
                const q = new URLSearchParams({ action: 'items', class_id: classId, subject_id: sel.subject, from: folder, to: folder });
                const { items } = await getJson('../api/appunti.php?' + q);
                for (const d of docs.filter((x) => x.subject_id === sel.subject && x.kind === 'lezione' && x.lesson_date === folder)) {
                    entries.push({ type: 'doc', id: d.id, icon: '📝', label: d.manual ? `Appunti della lezione · di ${d.author || '?'}` : 'Appunti della lezione (AI)',
                        meta: d.status === 'ok' ? 'tutto unito' : 'non riuscito', disabled: d.status !== 'ok' });
                }
                for (const it of items.slice().reverse()) {
                    const who = it.author || '?';
                    const kind = C.KINDS[it.kind] || it.kind;
                    if (it.body) entries.push({ type: 'text', item: it, icon: '✍️', label: it.title || `${kind} scritti`, meta: `${who} · ${kind}` });
                    for (const f of it.files) {
                        const icon = f.mime.startsWith('image/') ? '🖼' : f.mime === 'application/pdf' ? '📕' : /word|opendocument\.text/.test(f.mime) ? '📄'
                            : /presentation/.test(f.mime) ? '📊' : '📃';
                        entries.push({ type: 'file', file: f, item: it, icon, label: f.name, meta: `${who} · ${kind} · ${C.sizeText(f.size)}` });
                    }
                }
            }
        } catch (e) { status(e.message, 'err'); }
        renderFiles();
    }

    function renderFiles() {
        const col = $('#col-files');
        if (!sel.folder) { col.replaceChildren(); return; }
        const title = sel.folder === 'tests' ? 'Verifiche' : shortDay.format(C.parseDate(sel.folder));
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
                const dl = el('a', { class: 'ghost-link', href: fileUrl(f.id), download: f.name, text: '↓ Scarica' });
                const open = el('a', { class: 'ghost-link', href: fileUrl(f.id), target: '_blank', rel: 'noopener', text: 'Apri' });
                const meta = el('p', { class: 'muted small', text: `${en.meta}${f.text_status === 'pending' ? ' · trascrizione in arrivo' : ''}` });
                if (f.mime.startsWith('image/') && !/heic|heif/.test(f.mime)) {
                    pv.replaceChildren(head(f.name, open, dl), meta, el('img', { class: 'pv-img', src: fileUrl(f.id), alt: f.name }), await textBlock(f, true));
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
                const body = doc.kind === 'quiz' ? quizList(doc.content) : el('div', { class: 'md' }, md(doc.content));
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
        const box = el('div', { class: 'pv-transcript' }, el('p', { class: 'muted small', text: isImage ? 'Trascrizione:' : '' }));
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
        } catch (e) { status(e.message, 'err'); }
    })();
})();
