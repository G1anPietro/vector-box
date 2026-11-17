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
    const shortDay = new Intl.DateTimeFormat(VBLang.t('locale'), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

    // On a phone one level is shown at a time: each deeper level is a history entry, so the phone's back
    // button (and "‹ Indietro") goes up one folder instead of leaving the page
    let level = 0;
    function setLevel(n, fromHistory = false) {
        if (!fromHistory && n > level) history.pushState({ level: n }, '');
        level = n;
        $('#arch').dataset.level = String(n);
        $('#back-btn').hidden = n === 0;
        renderCrumbs();
        saveState();
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
    // Where you are (subject, folder, file) is remembered on this device: a reload or coming back from another page lands on the same file
    const PATH_KEY = 'vb_arch_path';
    const entryKey = (en) => !en ? null : en.type === 'file' ? 'f' + en.file.id : en.type === 'doc' ? 'd' + en.id : en.item ? 't' + en.item.id : null;
    function saveState() {
        if (restoring) return;
        C.store(PATH_KEY, JSON.stringify({ c: classId, s: sel.subject, f: sel.folder, e: entryKey(sel.entry) }));
    }
    let restoring = true;   // true while the page starts, so that the empty first view does not overwrite the saved place
    async function restoreState() {
        let st = null;
        try { st = JSON.parse(C.stored(PATH_KEY) || 'null'); } catch (e) { st = null; }
        if (!st || st.c !== classId || !tree.some((x) => x.id === st.s)) return;
        restoring = true;
        try {
            sel.subject = st.s; sel.folder = null; sel.entry = null; renderAll(); setLevel(1);
            if (st.f) {
                await openFolder(st.f);
                const en = st.e && entries.find((x) => entryKey(x) === st.e);
                if (en && !en.disabled) await openEntry(en);
            }
        } finally { restoring = false; saveState(); }
    }

    function goBack() {
        if (level > 0 && history.state && history.state.level === level) history.back();
        else { const n = Math.max(0, level - 1); window.dispatchEvent(new PopStateEvent('popstate', { state: { level: n } })); }
    }

    function renderCrumbs() {
        const parts = [el('button', { type: 'button', class: 'crumb', text: VBLang.t('subjects'), onclick: () => { sel.subject = null; sel.folder = null; sel.entry = null; renderAll(); setLevel(0); } })];
        const subject = tree.find((s) => s.id === sel.subject);
        if (subject) parts.push(' › ', el('button', { type: 'button', class: 'crumb', text: subject.name, onclick: () => { sel.folder = null; sel.entry = null; renderAll(); setLevel(1); } }));
        if (sel.folder) parts.push(' › ', el('button', { type: 'button', class: 'crumb', text: folderTitle(sel.folder),
            onclick: () => { sel.entry = null; renderPreview(null); setLevel(2); } }));
        if (sel.entry) parts.push(' › ', el('span', { class: 'crumb now', text: sel.entry.label }));
        $('#crumbs').replaceChildren(...parts);
    }

    function folderTitle(folder) {
        if (folder.startsWith('topic:')) { const t = ((tree.find((s) => s.id === sel.subject) || {}).topics || []).find((x) => x.id === Number(folder.slice(6))); return t ? t.name : VBLang.t('topic'); }
        if (folder.startsWith('cat:')) { const c = catOf(folder.slice(4)); return c ? c[2] : folder; }
        return shortDay.format(C.parseDate(folder));
    }

    function row({ icon, label, meta, active, onclick, title, check }) {
        return el('button', { type: 'button', class: 'arow' + (active ? ' active' : '') + (check === true ? ' picked' : ''), onclick, title: title || label, ...(check === undefined ? {} : { role: 'checkbox', 'aria-checked': String(check) }) },
            check === undefined ? null : el('span', { class: 'acheck', 'aria-hidden': 'true', text: check ? '☑' : '☐' }),
            el('span', { class: 'aicon', text: icon }), el('span', { class: 'alabel' }, el('span', { text: label }), meta ? el('small', { text: meta }) : null));
    }

    /* ---------- columns ---------- */

    function renderSubjects() {
        const col = $('#col-subjects');
        if (!tree.length) { col.replaceChildren(el('p', { class: 'empty', text: VBLang.t('no_subjects_yet_the_class_representative') })); return; }
        col.replaceChildren(el('h3', { class: 'col-h', text: VBLang.t('subjects') }), ...tree.map((s) => row({
            icon: '📁', label: s.name, active: s.id === sel.subject,
            meta: s.days.length ? plural(s.days.length, VBLang.t('day'), VBLang.t('days')) : VBLang.t('empty_f'),
            onclick: () => { sel.subject = s.id; sel.folder = null; sel.entry = null; renderAll(); setLevel(1); },
        })));
    }

    // Folders by type inside a subject: [key, icon, label, count from the tree]
    const CATS = [
        ['appunti', '📝', VBLang.t('notes'), (c) => c.appunti || 0],
        ['foto', '🖼', VBLang.t('photos'), (c) => c.foto || 0],
        ['audio', '🎧', VBLang.t('audio'), (c) => c.audio || 0],
        ['domande', '❓', VBLang.t('questions_2'), (c) => (c.domande || 0) + (c.domande_ai || 0)],
        ['slide', '📊', VBLang.t('teacher_s_slides_and_material'), (c) => c.slide || 0],
        ['libro', '📖', VBLang.t('book'), (c) => c.libro || 0],
        ['prova', '📋', VBLang.t('practice_tests'), (c) => c.prova || 0],
        ['ai', '🤖', VBLang.t('notes_made_by_the_ai'), (c) => c.ai || 0],
        ['schemi', '🧠', VBLang.t('diagrams'), (c) => c.schemi || 0],
        ['tests', '📘', VBLang.t('tests_study_documents'), (c) => c.verifiche || 0],
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
            if (d.files) bits.push(VBLang.t('n_files', { n: d.files }));
            if (d.items > d.files) bits.push(VBLang.t('texts'));
            if (d.docs) bits.push(VBLang.t('ai_summary'));
            return row({ icon: '🗂', label: shortDay.format(C.parseDate(d.date)), meta: bits.join(' · '), active: sel.folder === d.date,
                onclick: () => openFolder(d.date) });
        });
        // by topic: the topics of the subject that hold uploads or documents
        const byTopic = (subject.topics || []).map((t) => {
            const nDocs = docs.filter((d) => d.topic_id === t.id).length;
            return (t.items || nDocs) ? row({ icon: '🧭', label: t.name, meta: plural(t.items, VBLang.t('item'), VBLang.t('items')) + (nDocs ? VBLang.t('n_by_the_ai', { n: nDocs }) : ''),
                active: sel.folder === 'topic:' + t.id, onclick: () => openFolder('topic:' + t.id) }) : null;
        }).filter(Boolean);
        col.replaceChildren(el('h3', { class: 'col-h', text: subject.name }),
            ...(byTopic.length ? [el('p', { class: 'agroup', text: VBLang.t('by_topic') }), ...byTopic] : []),
            ...(byType.length ? [el('p', { class: 'agroup', text: VBLang.t('by_type') }), ...byType] : []),
            ...(byDay.length ? [el('p', { class: 'agroup', text: VBLang.t('by_day') }), ...byDay] : []),
            ...(!byType.length && !byDay.length ? [el('p', { class: 'empty', text: VBLang.t('nothing_for_this_subject_yet') })] : []));
    }

    const fileIcon = (f) => f.mime.startsWith('image/') ? '🖼' : f.mime.startsWith('audio/') ? '🎧' : f.mime === 'application/pdf' ? '📕'
        : f.mime === 'text/html' ? '🌐' : /word|opendocument\.text/.test(f.mime) ? '📄' : /presentation/.test(f.mime) ? '📊' : '📃';
    const docEntry = (d, label) => ({ type: 'doc', id: d.id, kind: d.kind, can_delete: d.can_delete, rawTitle: d.title, manualAi: !d.manual, icon: d.kind === 'schema' ? '🧠' : d.kind === 'quiz' || d.kind === 'domande' ? '❓' : d.event_id ? '📘' : '📝',
        label: label + (d.manual ? VBLang.t('by', { name: d.author || '?' }) : ''), meta: d.status === 'ok' ? (d.lesson_date ? shortDay.format(C.parseDate(d.lesson_date)) : '') : VBLang.t('failed'),
        disabled: d.status !== 'ok' });
    /** Entries of one item: its text and its files (optionally only some files). */
    function itemEntries(it, withDate, fileFilter = () => true, withText = true) {
        const out = [];
        const who = it.author || '?';
        const kind = C.KINDS[it.kind] || it.kind;
        const when = withDate ? ' · ' + shortDay.format(C.parseDate(it.lesson_date)) : '';
        if (withText && it.body) out.push({ type: 'text', item: it, icon: '✍️', label: it.title || VBLang.t('written', { kind }), meta: `${who} · ${kind}${when}` });
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
        selecting = false; picked.clear(); bulkForm = null;
        sel.folder = folder;
        sel.entry = null;
        renderFolders();
        renderPreview(null);
        setLevel(2);
        const col = $('#col-files');
        col.replaceChildren(el('p', { class: 'empty', text: VBLang.t('loading') }));
        entries = [];
        try {
            const cat = folder.startsWith('cat:') ? folder.slice(4) : null;
            const subjDocs = docs.filter((x) => x.subject_id === sel.subject);
            if (folder.startsWith('topic:')) {
                const tid = Number(folder.slice(6));
                const mine = subjDocs.filter((d) => d.topic_id === tid && !d.event_id);
                const kinds = [['lezione', VBLang.t('lesson_notes')], ['schema', VBLang.t('lesson_diagram')], ['domande', VBLang.t('lesson_questions')]];
                for (const [k, label] of kinds) for (const d of mine.filter((x) => x.kind === k)) entries.push(docEntry(d, `${label}${d.lesson_date ? ' · ' + shortDay.format(C.parseDate(d.lesson_date)) : ''}`));
                const q = new URLSearchParams({ action: 'items', class_id: classId, subject_id: sel.subject, topic_id: tid });
                const { items } = await getJson('../api/appunti.php?' + q);
                if (entries.length && items.length) entries.push({ group: VBLang.t('uploaded_material') });
                for (const it of items) entries.push(...itemEntries(it, true));
            } else if (cat === 'tests') {
                const byEvent = new Map();
                for (const d of subjDocs.filter((x) => x.event_id && x.kind !== 'schema')) {
                    if (!byEvent.has(d.event_id)) byEvent.set(d.event_id, []);
                    byEvent.get(d.event_id).push(d);
                }
                for (const [eid, list] of byEvent) {
                    const ev = events.find((e) => e.id === eid);
                    entries.push({ group: ev ? VBLang.t('kind_on_date', { kind: ev.kind === 'interrogazione' ? VBLang.t('oral_exam') : VBLang.t('written_test'), date: C.parseDate(ev.date).toLocaleDateString(VBLang.t('locale')) }) + (ev.title ? ' · ' + ev.title : '')
                        : (list[0].title || VBLang.t('written_test')) });
                    for (const d of list) entries.push(docEntry(d, C.DOC_KINDS[d.kind] || d.kind));
                }
            } else if (cat === 'ai') {
                for (const d of subjDocs.filter((x) => x.kind === 'lezione')) entries.push(docEntry(d, VBLang.t('lesson_notes')));
            } else if (cat === 'schemi') {
                for (const d of subjDocs.filter((x) => x.kind === 'schema')) {
                    const ev = d.event_id ? events.find((e) => e.id === d.event_id) : null;
                    entries.push(docEntry(d, ev ? VBLang.t('diagram_for_exam', { kind: ev.kind === 'interrogazione' ? VBLang.t('oral_exam_lc') : VBLang.t('written_test_lc') }) + (ev.title ? ' · ' + ev.title : '') : VBLang.t('lesson_diagram')));
                }
            } else if (cat === 'domande') {
                // the lesson questions written by the AI (teacher's questions first), then those uploaded by classmates
                for (const d of subjDocs.filter((x) => x.kind === 'domande')) entries.push(docEntry(d, VBLang.t('lesson_questions')));
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
                for (const d of subjDocs.filter((x) => x.kind === 'lezione' && x.lesson_date === folder)) entries.push(docEntry(d, d.manual ? VBLang.t('lesson_notes') : VBLang.t('lesson_notes_ai')));
                for (const d of subjDocs.filter((x) => x.kind === 'schema' && !x.event_id && x.lesson_date === folder)) entries.push(docEntry(d, VBLang.t('lesson_diagram')));
                for (const d of subjDocs.filter((x) => x.kind === 'domande' && x.lesson_date === folder)) entries.push(docEntry(d, VBLang.t('lesson_questions')));
                for (const it of items.slice().reverse()) entries.push(...itemEntries(it, false));
            }
        } catch (e) { status(e.message, 'err'); }
        renderFiles();
    }

    /* ---------- selecting several files, moving or deleting a whole folder ---------- */

    let selecting = false;
    const picked = new Set();                                   // entryKey of the ticked rows
    const selectable = (en) => !en.group && !en.disabled && entryKey(en) !== null;
    const itemIdsOf = (list) => [...new Set(list.filter((e) => e.item && e.item.can_edit).map((e) => e.item.id))];
    let bulkForm = null;                                        // the little form under the column title (day, topic, confirm)

    function setSelecting(on) {
        selecting = on;
        picked.clear();
        bulkForm = null;
        renderFiles();
    }

    /** A small form in the files column: a question, one field, "OK" and "Annulla". */
    function ask(label, field, okText, run) {
        const form = el('form', { class: 'row move-day' }, el('label', { text: label + ' ' }, field),
            el('button', { class: 'mini', text: okText }), el('button', { type: 'button', class: 'ghost mini', text: VBLang.t('cancel'), onclick: () => { bulkForm = null; renderFiles(); } }));
        form.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const btn = form.querySelector('button'); btn.disabled = true;
            try { await run(); } catch (e) { C.toast(e.message, 'err'); btn.disabled = false; }
        });
        bulkForm = form;
        renderFiles();
        field.focus && field.focus();
    }
    function done(msg) {
        C.toast(msg, 'ok');
        // the folder may be empty now: the page opens again on the subject
        sel.folder = null; sel.entry = null; saveState();
        setTimeout(() => location.reload(), 600);
    }
    function moveToDay(ids, what) {
        if (!ids.length) { C.toast(VBLang.t('nothing_to_move_here_you_can'), 'err'); return; }
        const first = (sel.folder && /^\d{4}-/.test(sel.folder)) ? sel.folder : '';
        const input = el('input', { type: 'date', value: first, required: true });
        ask(VBLang.t('move_to_day', { what }), input, VBLang.t('move'), async () => {
            if (!input.value) throw new Error(VBLang.t('choose_the_day'));
            const r = await C.post('../api/appunti.php', { action: 'move_items', ids, lesson_date: input.value });
            done(VBLang.t('moved_n_to_date', { n: plural(r.done, VBLang.t('submission'), VBLang.t('submissions')), date: input.value }) + (r.skipped ? VBLang.t('n_not_moved_perm', { n: r.skipped }) : ''));
        });
    }
    function moveToTopic(ids, what) {
        const subject = tree.find((s) => s.id === sel.subject) || {};
        if (!ids.length) { C.toast(VBLang.t('nothing_to_move_here'), 'err'); return; }
        if (!(subject.topics || []).length) { C.toast(VBLang.t('this_subject_has_no_topics_yet'), 'err'); return; }
        const pick = el('select', {}, el('option', { value: '0', text: VBLang.t('the_site_decides_based_on_the') }),
            ...subject.topics.map((t) => el('option', { value: t.id, text: t.name })));
        ask(VBLang.t('move_to_the_topic', { what }), pick, VBLang.t('move'), async () => {
            const r = await C.post('../api/appunti.php', { action: 'move_items', ids, topic_id: Number(pick.value) });
            done(VBLang.t('moved_n', { n: plural(r.done, VBLang.t('submission'), VBLang.t('submissions')) }) + (r.skipped ? VBLang.t('n_not_moved', { n: r.skipped }) : ''));
        });
    }
    function deleteItems(ids, what) {
        if (!ids.length) { C.toast(VBLang.t('nothing_to_delete_here_you_can'), 'err'); return; }
        const ok = el('input', { type: 'text', placeholder: VBLang.t('type_delete'), required: true, autocomplete: 'off' });
        ask(VBLang.t('confirm_delete_what', { what }), ok, VBLang.t('delete'), async () => {
            if (ok.value.trim().toUpperCase() !== VBLang.t('delete_word')) throw new Error(VBLang.t('to_confirm_type_delete'));
            const r = await C.post('../api/appunti.php', { action: 'delete_items', ids });
            done(VBLang.t('deleted_n', { n: plural(r.done, VBLang.t('submission'), VBLang.t('submissions')) }));
        });
    }
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

    /** The ⋯ menu of the open folder: move it all or delete it (days and topics). */
    function folderMenu() {
        const all = entries.filter(selectable);
        const ids = itemIdsOf(all);
        const isDay = /^\d{4}-\d{2}-\d{2}$/.test(sel.folder || '');
        const isTopic = (sel.folder || '').startsWith('topic:');
        if (!ids.length || (!isDay && !isTopic)) return null;
        const files = all.filter((e) => e.type === 'file' && e.item.can_edit).length;
        const what = VBLang.t('folder_what', { subs: plural(ids.length, VBLang.t('submission'), VBLang.t('submissions')), files: plural(files, VBLang.t('file_lc'), VBLang.t('files_lc')) });
        return C.menu([
            ...(isDay ? [{ label: VBLang.t('move_the_whole_folder_to_another'), onclick: () => moveToDay(ids, VBLang.t('the_whole_folder')) }] : []),
            ...(isTopic ? [{ label: VBLang.t('move_the_whole_folder_to_another_2'), onclick: () => moveToTopic(ids, VBLang.t('the_whole_folder')) }, { label: VBLang.t('move_the_whole_folder_to_another'), onclick: () => moveToDay(ids, VBLang.t('the_whole_folder')) }] : []),
            { label: VBLang.t('delete_the_folder'), danger: true, onclick: () => deleteItems(ids, what) }], VBLang.t('actions_on_the_folder'));
    }

    function bulkBar() {
        const sels = entries.filter((e) => selectable(e) && picked.has(entryKey(e)));
        const ids = itemIdsOf(sels);
        const files = sels.filter((e) => e.type === 'file' && e.file.can_delete);
        const docsDel = sels.filter((e) => e.type === 'doc' && e.can_delete);
        const bar = el('div', { class: 'row bulk-bar' },
            el('span', { class: 'muted small', text: VBLang.t('selected', { n: picked.size }) }),
            el('button', { type: 'button', class: 'ghost mini', text: VBLang.t('all'), onclick: () => { entries.filter(selectable).forEach((e) => picked.add(entryKey(e))); renderFiles(); } }),
            el('button', { type: 'button', class: 'ghost mini', text: VBLang.t('none'), onclick: () => { picked.clear(); renderFiles(); } }),
            el('button', { type: 'button', class: 'mini', text: VBLang.t('move_to_day_2'), disabled: !ids.length, onclick: () => moveToDay(ids, plural(ids.length, 'invio', 'invii')) }),
            el('button', { type: 'button', class: 'ghost mini', text: VBLang.t('topic_2'), disabled: !ids.length, onclick: () => moveToTopic(ids, plural(ids.length, 'invio', 'invii')) }),
            el('button', { type: 'button', class: 'danger mini', text: VBLang.t('delete'), disabled: !files.length && !docsDel.length, onclick: async () => {
                if (!confirm(VBLang.t('confirm_delete_what', { what: plural(files.length, VBLang.t('file_lc'), VBLang.t('files_lc')) + (docsDel.length ? VBLang.t('and_join') + plural(docsDel.length, VBLang.t('document_lc'), VBLang.t('documents_lc')) : '') }))) return;
                try {
                    for (const e of files) await C.post('../api/appunti.php', { action: 'delete_file', id: e.file.id });
                    for (const e of docsDel) await C.post('../api/appunti.php', { action: 'delete_doc', id: e.id });
                    done(VBLang.t('deleted'));
                } catch (e) { C.toast(e.message, 'err'); }
            } }));
        return bar;
    }

    function renderFiles() {
        const col = $('#col-files');
        if (!sel.folder) { col.replaceChildren(); return; }
        const title = folderTitle(sel.folder);
        const canSelect = entries.some(selectable);
        const head = el('div', { class: 'col-h-row' }, el('h3', { class: 'col-h', text: title }),
            canSelect ? el('div', { class: 'row-actions' },
                el('button', { type: 'button', class: 'ghost mini', text: selecting ? VBLang.t('done_3') : VBLang.t('select'), onclick: () => setSelecting(!selecting) }), folderMenu()) : null);
        col.replaceChildren(head, ...(selecting ? [bulkBar()] : []), ...(bulkForm ? [bulkForm] : []), ...(entries.length ? entries.map((en) => en.group
            ? el('p', { class: 'agroup', text: en.group })
            : row({ icon: en.icon, label: en.label, meta: en.meta, check: selecting && selectable(en) ? picked.has(entryKey(en)) : undefined,
                active: !selecting && sel.entry === en,
                onclick: () => {
                    if (selecting) { if (selectable(en)) { const k = entryKey(en); if (picked.has(k)) picked.delete(k); else picked.add(k); renderFiles(); } return; }
                    if (!en.disabled) openEntry(en);
                } }))
            : [el('p', { class: 'empty', text: VBLang.t('empty_folder') })]));
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
        if (!en) { pv.replaceChildren(el('p', { class: 'empty', text: sel.folder ? VBLang.t('choose_a_file') : VBLang.t('choose_a_subject_then_a_day') })); return; }
        const head = (title, ...actions) => el('div', { class: 'pv-head' }, el('h2', { text: title }), el('div', { class: 'row-actions' }, ...actions, shareBtn(en, title), en.type === 'doc' && en.kind === 'schema' ? null : C.fullButton(() => pv), deleteMenu(en)));
        /** "Condividi": the phone's share sheet with the person's own mail/WhatsApp (a file is fetched first; a document goes as text or picture). */
        function shareBtn(en, title) {
            return el('button', { type: 'button', class: 'ghost mini', text: VBLang.t('share'), onclick: async (ev) => {
                const b = ev.currentTarget; b.disabled = true;
                try {
                    if (en.type === 'file') {
                        C.shareDialog(en.file.name, [{ file: true, label: VBLang.t('the_file'), hint: en.file.name, get: async () => {
                            const r = await fetch(fileUrl(en.file.id), { credentials: 'same-origin' });
                            if (!r.ok) throw new Error(VBLang.t('cannot_read_the_file'));
                            return { blob: await r.blob(), name: en.file.name };
                        } }], { kind: 'file', id: en.file.id });
                    } else if (en.type === 'text') {
                        C.shareDialog(title, C.textChoices(title, en.item.body), { kind: 'item', id: en.item.id });
                    } else {
                        const { doc } = await getJson(`../api/appunti.php?action=doc&id=${en.id}`);
                        const ref = ['quiz', 'domande'].includes(doc.kind) ? null : { kind: 'doc', id: doc.id };
                        if (doc.kind === 'schema') C.shareDialog(doc.title, C.schemaChoices(JSON.parse(doc.content)), ref);
                        else C.shareDialog(doc.title, C.textChoices(doc.title, doc.content), ref);
                    }
                } catch (e) { C.toast(VBLang.t('cannot_share_it_use_download'), 'err'); } finally { b.disabled = false; }
            } });
        }
        // "⋯ > Elimina": only shown to who may (the server checks again); always asks first
        function deleteMenu(en) {
            const isFile = en.type === 'file' && en.file.can_delete;
            const isDoc = en.type === 'doc' && en.can_delete;
            const canMove = (en.type === 'file' || en.type === 'text') && en.item && en.item.can_edit;
            if (!isFile && !isDoc && !canMove) return null;
            const name = isFile ? en.file.name : (en.rawTitle || en.label);
            const actions = [];
            if (canMove) actions.push({ label: VBLang.t('change_the_day'), onclick: () => moveDay(en) });
            if (isFile || isDoc) actions.push({ label: isFile ? VBLang.t('delete_this_file') : VBLang.t('delete_this_document'), danger: true, onclick: async () => {
                if (!confirm(VBLang.t('confirm_delete_named', { name, extra: isDoc && en.manualAi ? VBLang.t('ai_can_redo') : '' }))) return;
                try {
                    await C.post('../api/appunti.php', { action: isFile ? 'delete_file' : 'delete_doc', id: isFile ? en.file.id : en.id });
                    location.reload();
                } catch (e) { C.toast(e.message, 'err'); }
            } });
            return C.menu(actions, VBLang.t('more_actions'));
        }
        /** Moves the whole upload (the item the file or text belongs to) to another lesson day: the server checks who may. */
        function moveDay(en) {
            const it = en.item;
            const input = el('input', { type: 'date', value: it.lesson_date, required: true });
            const bar = el('form', { class: 'row move-day' }, el('label', { text: VBLang.t('lesson_day') }, input),
                el('button', { class: 'mini', text: VBLang.t('move') }), el('button', { type: 'button', class: 'ghost mini', text: VBLang.t('cancel'), onclick: () => bar.remove() }));
            bar.addEventListener('submit', async (ev) => {
                ev.preventDefault();
                if (!input.value || input.value === it.lesson_date) { bar.remove(); return; }
                try {
                    await C.post('../api/appunti.php', { action: 'edit_item', id: it.id, subject_id: it.subject_id, kind: it.kind, lesson_date: input.value, period: '', title: it.title, body: it.body });
                    C.toast(VBLang.t('moved_to') + input.value + '.', 'ok');
                    location.reload();
                } catch (e) { C.toast(e.message, 'err'); }
            });
            const old = pv.querySelector('.move-day'); if (old) old.remove();
            pv.querySelector('.pv-head').after(bar);
            input.focus();
        }
        try {
            if (en.type === 'file') {
                const f = en.file;
                const dl = el('a', { class: 'ghost-link ico-dl', href: fileUrl(f.id), download: f.name, text: VBLang.t('download') });
                const open = el('a', { class: 'ghost-link', href: fileUrl(f.id), target: '_blank', rel: 'noopener', text: VBLang.t('open') });
                const meta = el('p', { class: 'muted small', text: `${en.meta}${f.text_status === 'pending' ? VBLang.t('transcript_coming') : ''}` });
                if (f.mime.startsWith('image/') && !/heic|heif/.test(f.mime)) {
                    pv.replaceChildren(head(f.name, open, dl), meta, imageBox(fileUrl(f.id), f.name), await textBlock(f, true));
                } else if (f.mime.startsWith('audio/')) {
                    pv.replaceChildren(head(f.name, dl), meta, el('audio', { class: 'pv-audio', controls: true, preload: 'metadata', src: fileUrl(f.id) }), await textBlock(f, true));
                } else if (f.mime === 'application/pdf') {
                    pv.replaceChildren(head(f.name, open, dl), meta, window.AppuntiPdf.view(fileUrl(f.id), f.name));
                } else if (/presentationml\.presentation$/.test(f.mime)) {
                    // slides drawn by the server as sandboxed HTML; the extracted text stays below as a fallback
                    const frame = el('iframe', { class: 'pv-html pv-slides', src: fileUrl(f.id) + '&view=1', sandbox: '', referrerpolicy: 'no-referrer', title: f.name, loading: 'lazy' });
                    pv.replaceChildren(head(f.name, el('a', { class: 'ghost-link', href: fileUrl(f.id) + '&view=1', target: '_blank', rel: 'noopener', text: VBLang.t('open') }), dl), meta, frame, el('details', {}, el('summary', { text: VBLang.t('text_only') }), await textBlock(f, false)));
                } else if (f.mime === 'text/html') {
                    // sandbox="" : no script, no forms, not even the site's origin (the server adds the same limits)
                    const frame = el('iframe', { class: 'pv-html', src: fileUrl(f.id), sandbox: '', referrerpolicy: 'no-referrer', title: f.name, loading: 'lazy' });
                    pv.replaceChildren(head(f.name, open, dl), meta, frame);
                } else {
                    pv.replaceChildren(head(f.name, dl), meta, await textBlock(f, false));
                }
            } else if (en.type === 'text') {
                const it = en.item;
                pv.replaceChildren(head(en.label), el('p', { class: 'muted small', text: en.meta }),
                    C.looksLikeMarkdown(it.body) ? el('div', { class: 'md' }, md(it.body)) : el('div', { class: 'pv-text', text: it.body }));
            } else {
                const { doc } = await getJson(`../api/appunti.php?action=doc&id=${en.id}`);
                const body = doc.kind === 'quiz' ? quizList(doc.content) : doc.kind === 'schema' ? C.renderSchema(doc.content, { ref: { kind: 'doc', id: doc.id } })
                    : doc.kind === 'domande' ? C.renderQuestions(doc.content) : el('div', { class: 'md' }, md(doc.content));
                pv.replaceChildren(head(doc.title, el('a', { class: 'ghost-link', href: `appunti.php?class=${classId}&tab=study`, text: VBLang.t('open_in_study') })),
                    el('p', { class: 'muted small', text: doc.manual ? VBLang.t('made_with_another_ai_uploaded_by', { name: doc.author || '?' }) : VBLang.t('written_by_the_ai_from_the') }),
                    body);
                const mdBox = pv.querySelector('.md');
                if (mdBox && doc.kind !== 'quiz') C.addIndex(mdBox, 'doc' + doc.id);
            }
            pv.scrollTop = 0;
        } catch (e) { pv.replaceChildren(el('p', { class: 'empty', text: e.message })); }
    }

    /** A picture in a frame: two-finger zoom and double tap on a phone. */
    function imageBox(src, alt) {
        const img = el('img', { class: 'pv-img', src, alt });
        const box = el('div', { class: 'shared-img' }, img);
        C.enableZoom(box, img);
        return box;
    }

    /** The text the site has for a file: what was extracted (Word, slides, text) or the AI transcription (photos, PDF). */
    async function textBlock(f, isImage) {
        if (f.text_status !== 'done') {
            return isImage ? el('span') : el('p', { class: 'empty', text: f.text_status === 'pending'
                ? VBLang.t('the_transcript_is_coming_soon_meanwhile') : VBLang.t('preview_not_available_download_the_file') });
        }
        const t = await getJson(`../api/appunti.php?action=file_text&id=${f.id}`);
        if (!t.text) return el('span');
        const box = el('div', { class: 'pv-transcript' }, el('p', { class: 'muted small', text: isImage ? (f.mime.startsWith('audio/') ? VBLang.t('transcript_of_the_recording') : VBLang.t('transcript')) : '' }));
        box.append(C.looksLikeMarkdown(t.text) ? el('div', { class: 'md' }, md(t.text)) : el('div', { class: 'pv-text', text: t.text }));
        return box;
    }

    function quizList(content) {
        let quiz = null;
        try { quiz = JSON.parse(content); } catch (e) { return el('p', { text: VBLang.t('quiz_cannot_be_read') }); }
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

    // On a phone folders and files can be shown as tiles (two per row, no scrolling to reach the bottom) or as a list: remembered
    const VIEW_KEY = 'vb_arch_view';
    function paintView() {
        const tiles = C.stored(VIEW_KEY) !== 'list';
        $('#arch').classList.toggle('tiles', tiles);
        $('#view-btn').textContent = tiles ? VBLang.t('list') : VBLang.t('table');
        $('#view-btn').title = tiles ? VBLang.t('show_as_list') : VBLang.t('show_as_table');
    }
    $('#view-btn').addEventListener('click', () => { C.store(VIEW_KEY, C.stored(VIEW_KEY) === 'list' ? 'tiles' : 'list'); paintView(); });
    paintView();
    window.VBDrop.attach({ label: VBLang.t('drop_them_here'), hint: VBLang.t('they_open_in_the_upload_page'), onFiles: (files) => C.handOff(files) });
    /* ---------- search (FTS5 on the server) ---------- */
    const highlight = (text) => {
        const out = [];
        String(text).split(/(\[\[.*?\]\])/).forEach((part) => {
            if (part.startsWith('[[') && part.endsWith(']]')) out.push(el('mark', { text: part.slice(2, -2) })); else if (part) out.push(part);
        });
        return out;
    };
    function closeSearch() { $('#search-results').hidden = true; $('#arch').hidden = false; }
    async function goToResult(r) {
        closeSearch();
        sel.subject = r.subject_id; sel.folder = null; sel.entry = null;
        renderAll(); setLevel(1);
        const folder = r.lesson_date;
        if (folder && tree.find((x) => x.id === r.subject_id).days.some((d) => d.date === folder)) {
            await openFolder(folder);
            const key = r.file ? 'f' + r.file.id : r.kind === 'doc' ? 'd' + r.id : r.item ? 't' + r.item.id : null;
            const en = entries.find((x) => entryKey(x) === key);
            if (en && !en.disabled) await openEntry(en);
        }
    }
    async function runSearch(q) {
        const box = $('#search-results');
        if (!q.trim()) { closeSearch(); return; }
        $('#arch').hidden = true;
        box.hidden = false;
        box.replaceChildren(el('p', { class: 'empty', text: VBLang.t('searching') }));
        try {
            const { results } = await getJson(`../api/appunti.php?action=search&class_id=${classId}&q=${encodeURIComponent(q)}`);
            const label = (r) => r.kind === 'doc' ? (C.DOC_KINDS[r.doc_kind] || VBLang.t('document')) + (r.manual ? VBLang.t('uploaded_paren') : VBLang.t('by_the_ai')) : r.kind === 'file' ? VBLang.t('file') : VBLang.t('written_notes');
            box.replaceChildren(el('div', { class: 'sr-head' }, el('b', { text: results.length ? (results.length === 1 ? VBLang.t('one_result') : VBLang.t('n_results', { n: results.length })) : VBLang.t('no_results') }),
                el('button', { type: 'button', class: 'ghost mini', text: VBLang.t('close_the_search'), onclick: () => { $('#search-input').value = ''; closeSearch(); } })),
                ...results.map((r) => el('button', { type: 'button', class: 'sr-item', onclick: () => goToResult(r) },
                    el('span', { class: 'sr-title' }, el('b', { text: r.file ? r.file.name : r.title || label(r) }), el('span', { class: 'muted small', text: ` · ${label(r)} · ${r.subject}${r.lesson_date ? ' · ' + shortDay.format(C.parseDate(r.lesson_date)) : ''}` })),
                    el('span', { class: 'sr-snip' }, ...highlight(r.snippet)))));
            if (!results.length) box.append(el('p', { class: 'empty', text: VBLang.t('try_fewer_words_or_the_start') }));
        } catch (e) { box.replaceChildren(el('p', { class: 'empty', text: e.message })); }
    }
    $('#search-form').addEventListener('submit', (ev) => { ev.preventDefault(); runSearch($('#search-input').value); });
    $('#back-btn').addEventListener('click', goBack);
    history.replaceState({ level: 0 }, '');

    (async () => {
        try {
            const mine = await getJson('../api/classi.php?action=mine');
            classes = mine.classes;
            if (mine.demo && (mine.guest || C.stored('vb_appunti_demo') === '1' || Number(new URLSearchParams(location.search).get('class')) === mine.demo.id)) classes = [...classes, mine.demo];   // the example class, read-only
            if (!classes.length) { location.href = 'appunti.php'; return; }
            const want = Number(new URLSearchParams(location.search).get('class') || C.stored(C.CLASS_KEY));
            const pick = classes.find((c) => c.id === want) || classes[0];
            const select = $('#class-select');
            select.replaceChildren(...classes.map((c) => el('option', { value: c.id, text: c.demo ? VBLang.t('example_class', { name: c.name }) : `${c.name} · ${c.school}`, selected: c.id === pick.id })));
            select.hidden = classes.length < 2;
            select.addEventListener('change', () => openClass(Number(select.value)));
            await openClass(pick.id);
            // a link from the calendar: straight into a subject
            const wantSubject = Number(new URLSearchParams(location.search).get('subject'));
            if (wantSubject && tree.some((x) => x.id === wantSubject)) { sel.subject = wantSubject; sel.folder = null; sel.entry = null; renderAll(); setLevel(1); }
            else await restoreState();
            const wantQ = new URLSearchParams(location.search).get('q');
            if (wantQ) { $('#search-input').value = wantQ; runSearch(wantQ); }
            restoring = false;
            saveState();
        } catch (e) { status(e.message, 'err'); }
    })();
})();
