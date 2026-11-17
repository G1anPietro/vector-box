// public/js/appunti-calendario.js — the Calendar tab of pages/appunti.php: one agenda with tests, homework, oral-exam
// turns, days without lessons and the topics of each subject. Data from api/appunti.php (events) and api/calendario.php.
// Every user-written string goes in with textContent (the shared el() builder).
(() => {
    'use strict';
    const C = window.AppuntiCommon;
    const P = () => window.AppuntiPage;
    const { el, getJson, post, toast } = C;
    const $ = (s, r = document) => r.querySelector(s);
    const cal = (body) => post('../api/calendario.php', body);
    const KIND = { verifica: VBLang.t('written_test'), interrogazione: VBLang.t('oral_exam'), altro: VBLang.t('other') };
    const dayLong = new Intl.DateTimeFormat(VBLang.t('locale'), { weekday: 'long', day: 'numeric', month: 'long' });
    const dayShort = (iso) => C.parseDate(iso).toLocaleDateString(VBLang.t('locale'), { day: 'numeric', month: 'short' });
    const set = (node, ...kids) => node.replaceChildren(...kids.filter((k) => k !== null && k !== undefined && k !== false));
    let data = null;      // overview from api/calendario.php
    let events = [];
    let today = '';
    let perms = [];
    let view = C.stored('vb_cal_view') || (window.innerWidth >= 900 ? 'month' : 'agenda');   // month on a computer, agenda on a phone
    let monthRef = null;      // first day of the month shown
    let pickedDay = null;     // a day chosen in the month: the list shows only that day
    let subjectFilter = 0;
    const can = (p) => perms.includes(p);
    const members = () => P().current.members;
    const nameOf = (id) => { const m = members().find((x) => x.id === id); return m ? m.name : '?'; };
    const subjectOptions = (sel) => P().current.subjects.map((s) => el('option', { value: s.id, text: s.name, selected: s.id === sel }));

    async function load() {
        const c = P().current;
        if (!c) return;
        try {
            const [ev, ov] = await Promise.all([
                getJson(`../api/appunti.php?action=events&class_id=${c.id}`),
                getJson(`../api/calendario.php?action=overview&class_id=${c.id}`),
            ]);
            events = ev.events;
            data = ov;
            today = ov.today;
            perms = ov.perms;
            render();
        } catch (e) { $('#events').replaceChildren(el('p', { class: 'empty', text: e.message })); }
    }

    /* ---------- toolbar ---------- */

    function renderTools() {
        set($('#cal-tools'),
            el('button', { type: 'button', class: 'ghost hw-add', text: VBLang.t('homework_2'), onclick: () => editHomework() }),
            can('topics') ? el('button', { type: 'button', class: 'ghost', text: VBLang.t('topic_3'), onclick: () => editTopic() }) : null,
            can('daysoff') ? el('button', { type: 'button', class: 'ghost', text: VBLang.t('day_without_lessons'), onclick: () => addDayOff() }) : null,
            can('turns') ? el('button', { type: 'button', class: 'ghost', text: VBLang.t('oral_exam_turns'), onclick: () => turnsDialog() }) : null);
    }

    /* ---------- topics ---------- */

    function renderTopics() {
        const box = $('#cal-topics');
        const list = data.topics.filter((t) => t.proposed || !t.end || t.end >= today).slice(0, 30);
        const older = data.topics.filter((t) => !t.proposed && t.end && t.end < today);
        const row = (t) => {
            const chip = el('div', { class: 'topic-row' + (t.proposed ? ' proposed' : '') },
                el('div', {}, el('b', { text: t.name }), el('span', { class: 'muted small', text: ` · ${t.subject}` }), el('br'),
                    el('span', { class: 'muted small', text: VBLang.t('from', { date: dayShort(t.start) }) + (t.end ? VBLang.t('to', { date: dayShort(t.end) }) : VBLang.t('ongoing'))
                        + (t.proposed ? VBLang.t('suggested_by_the_ai_to_be') : '') })),
                el('span', { class: 'row-actions' },
                    el('a', { class: 'ghost-link mini-link', href: `appunti-archivio.php?class=${P().current.id}&subject=${t.subject_id}`, text: VBLang.t('open') }),
                    t.proposed && can('topics') ? el('button', { type: 'button', class: 'mini', text: VBLang.t('confirm'), onclick: () => act({ action: 'confirm_topic', id: t.id }, VBLang.t('topic_confirmed')) }) : null,
                    can('topics') ? C.menu([{ label: VBLang.t('edit'), onclick: () => editTopic(t) },
                        { label: VBLang.t('delete'), danger: true, onclick: () => confirm(VBLang.t('delete_the_topic_the_material_stays', { name: t.name })) && act({ action: 'delete_topic', id: t.id }) }]) : null));
            chip.style.setProperty('--sub', P().hue(t.subject_id));
            return chip;
        };
        set(box,
            el('h3', { class: 'section-title', text: VBLang.t('topics') }),
            list.length ? el('div', { class: 'topic-list' }, ...list.map(row))
                : el('p', { class: 'muted small', text: can('topics') ? VBLang.t('no_topic_in_progress_with_topic')
                    : VBLang.t('no_topic_in_progress') }),
            older.length ? el('details', {}, el('summary', { text: VBLang.t('finished_topics', { n: older.length }) }), el('div', { class: 'topic-list' }, ...older.map(row))) : null);
    }

    function editTopic(t = null) {
        C.dialogForm(t ? VBLang.t('edit_the_topic') : VBLang.t('new_topic'), (f) => {
            f.append(
                el('label', { text: VBLang.t('subject') }, el('select', { name: 'subject_id', required: true }, ...subjectOptions(t && t.subject_id))),
                el('label', { text: VBLang.t('topic_name') }, el('input', { name: 'name', required: true, maxLength: 80, value: t ? t.name : '', placeholder: VBLang.t('what_the_teacher_calls_it') })),
                el('div', { class: 'grid2' },
                    el('label', { text: VBLang.t('started_on') }, el('input', { type: 'date', name: 'start', required: true, value: t ? t.start : today })),
                    el('label', { text: VBLang.t('finished_on_empty_in_progress') }, el('input', { type: 'date', name: 'end', value: t && t.end ? t.end : '' }))),
                el('p', { class: 'muted small', text: VBLang.t('leave_the_end_empty_until_you') }));
        }, async (f) => {
            await cal({ action: 'save_topic', class_id: P().current.id, id: t ? t.id : 0, subject_id: Number(f.subject_id.value), name: f.name.value, start: f.start.value, end: f.end.value });
            toast(VBLang.t('topic_saved'), 'ok');
            load();
        });
    }

    /* ---------- homework, days off ---------- */

    function editHomework(h = null) {
        C.dialogForm(h ? VBLang.t('edit_the_homework') : VBLang.t('new_homework'), (f) => {
            f.append(
                el('div', { class: 'grid2' },
                    el('label', { text: VBLang.t('subject') }, el('select', { name: 'subject_id', required: true }, ...subjectOptions(h && h.subject_id))),
                    el('label', { text: VBLang.t('for_the_day') }, el('input', { type: 'date', name: 'due', required: true, value: h ? h.due : '' }))),
                el('label', { text: VBLang.t('what_to_do') }, el('textarea', { name: 'body', rows: 4, maxLength: 2000, required: true, value: h ? h.body : '', placeholder: VBLang.t('what_you_have_to_do_and') })),
                el('p', { class: 'muted small', text: VBLang.t('the_ai_uses_the_homework_to') }));
        }, async (f) => {
            await cal({ action: 'save_homework', class_id: P().current.id, id: h ? h.id : 0, subject_id: Number(f.subject_id.value), due: f.due.value, body: f.body.value });
            toast(VBLang.t('homework_saved'), 'ok');
            load();
        });
    }

    function addDayOff() {
        C.dialogForm(VBLang.t('day_without_lessons_2'), (f) => {
            f.append(
                el('label', { text: VBLang.t('reason') }, el('input', { name: 'reason', maxLength: 80, placeholder: VBLang.t('e_g_strike_trip_christmas_holidays') })),
                el('div', { class: 'grid2' },
                    el('label', { text: VBLang.t('from_day') }, el('input', { type: 'date', name: 'from', required: true, value: today })),
                    el('label', { text: VBLang.t('to_day_empty_a_single_day') }, el('input', { type: 'date', name: 'to' }))),
                el('label', { text: VBLang.t('only_one_hour_empty_the_whole') }, el('select', { name: 'period' },
                    el('option', { value: '', text: VBLang.t('whole_day') }), ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => el('option', { value: n, text: VBLang.t('period', { n }) })))),
                el('p', { class: 'muted small', text: VBLang.t('on_those_days_no_end_of') }));
        }, async (f) => {
            await cal({ action: 'save_dayoff', class_id: P().current.id, from: f.from.value, to: f.to.value, period: Number(f.period.value) || 0, reason: f.reason.value });
            toast(VBLang.t('saved'), 'ok');
            load();
        });
    }

    async function act(body, okText) {
        try { await cal(body); if (okText) toast(okText, 'ok'); load(); } catch (e) { toast(e.message, 'err'); }
    }

    /* ---------- turns ---------- */

    function turnsDialog() {
        // The class order: alphabetical by class name the first time; drag with the arrows, or shuffle
        const known = new Set(members().map((m) => m.id));
        let order = data.turn_order.filter((id) => known.has(id));
        if (!order.length) order = [...members()].sort((a, b) => a.name.localeCompare(b.name, 'it')).map((m) => m.id);
        const dlg = el('dialog', { class: 'tt-dialog wide' });
        const list = el('ol', { class: 'turn-order' });
        const draw = () => list.replaceChildren(...order.map((id, i) => el('li', {}, el('span', { text: nameOf(id) }), el('span', {},
            el('button', { type: 'button', class: 'ghost mini', text: '↑', 'aria-label': VBLang.t('up'), disabled: i === 0, onclick: () => { [order[i - 1], order[i]] = [order[i], order[i - 1]]; draw(); } }),
            el('button', { type: 'button', class: 'ghost mini', text: '↓', 'aria-label': VBLang.t('down'), disabled: i === order.length - 1, onclick: () => { [order[i + 1], order[i]] = [order[i], order[i + 1]]; draw(); } }),
            el('button', { type: 'button', class: 'ghost mini', text: '✕', 'aria-label': VBLang.t('remove_from_the_turns'), onclick: () => { order.splice(i, 1); draw(); } })))));
        const missing = () => members().filter((m) => !order.includes(m.id));
        const subject = el('select', { name: 'subject_id' }, ...subjectOptions());
        const start = el('input', { type: 'date', name: 'start', value: today });
        const per = el('input', { type: 'number', name: 'per', min: 1, max: 10, value: 2 });
        const saveOrder = () => cal({ action: 'save_turn_order', class_id: P().current.id, order });
        dlg.append(el('div', { class: 'stack' },
            el('h3', { text: VBLang.t('oral_exam_turns') }),
            el('p', { class: 'muted small', text: VBLang.t('one_single_order_for_the_class') }),
            el('div', { class: 'row' },
                el('button', { type: 'button', class: 'ghost', text: 'A–Z', onclick: () => { order = [...members()].sort((a, b) => a.name.localeCompare(b.name, 'it')).map((m) => m.id); draw(); } }),
                el('button', { type: 'button', class: 'ghost', text: VBLang.t('shuffle'), onclick: () => { for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; } draw(); } }),
                el('button', { type: 'button', class: 'ghost', text: VBLang.t('put_everyone_back'), onclick: () => { order.push(...missing().map((m) => m.id)); draw(); } }),
                el('button', { type: 'button', text: VBLang.t('save_the_order'), onclick: async () => { try { await saveOrder(); toast(VBLang.t('order_saved'), 'ok'); } catch (e) { toast(e.message, 'err'); } } })),
            list,
            el('h3', { text: VBLang.t('put_the_turns_in_the_calendar') }),
            el('div', { class: 'grid2' }, el('label', { text: VBLang.t('subject') }, subject), el('label', { text: VBLang.t('from_day') }, start)),
            el('label', { text: VBLang.t('questioned_per_lesson') }, per),
            el('div', { class: 'row' },
                el('button', { type: 'button', text: VBLang.t('create_the_turns'), onclick: async () => {
                    try {
                        await saveOrder();
                        const r = await cal({ action: 'make_turns', class_id: P().current.id, subject_id: Number(subject.value), start: start.value, per_lesson: Number(per.value) || 2 });
                        toast(VBLang.t(r.dates.length === 1 ? 'turns_created_on_one' : 'turns_created_on_n', { n: r.dates.length, date: dayShort(r.dates[r.dates.length - 1]) }), 'ok');
                        dlg.close();
                        load();
                    } catch (e) {
                        toast(e.json && e.json.code === 'no_lessons' ? VBLang.t('there_are_not_enough_lessons_of') : e.message, 'err');
                    }
                } }),
                el('button', { type: 'button', class: 'danger', text: VBLang.t('remove_the_future_turns_of_this'), onclick: async () => {
                    if (!confirm(VBLang.t('remove_all_the_turns_from_today'))) return;
                    await act({ action: 'clear_turns', class_id: P().current.id, subject_id: Number(subject.value) }, VBLang.t('turns_removed'));
                    dlg.close();
                } }),
                el('button', { type: 'button', class: 'ghost', text: VBLang.t('close'), onclick: () => dlg.close() }))));
        dlg.addEventListener('close', () => dlg.remove());
        dlg.addEventListener('click', (ev) => { if (ev.target === dlg) dlg.close(); });
        document.body.append(dlg);
        draw();
        dlg.showModal();
    }

    function editTurn(t) {
        C.dialogForm(VBLang.t('turn_of', { name: t.subject }), (f) => {
            f.append(el('label', { text: VBLang.t('day_2') }, el('input', { type: 'date', name: 'date', required: true, value: t.date })),
                el('p', { class: 'muted small', text: VBLang.t('who_is_being_questioned') }),
                el('div', { class: 'who-list' }, ...members().map((m) => el('label', { class: 'switch perm' },
                    el('input', { type: 'checkbox', name: 'who', value: m.id, checked: t.user_ids.includes(m.id) }), m.name))),
                el('label', { text: VBLang.t('note_optional') }, el('input', { name: 'note', maxLength: 120, value: t.note, placeholder: VBLang.t('e_g_make_up_volunteers') })));
        }, async (f) => {
            await cal({ action: 'save_turn', id: t.id, date: f.date.value, note: f.note.value,
                user_ids: [...f.querySelectorAll('input[name=who]:checked')].map((x) => Number(x.value)) });
            toast(VBLang.t('turn_saved'), 'ok');
            load();
        });
    }

    /* ---------- agenda ---------- */

    function topicsOf(e) {
        // topics of the subject that overlap the test's period
        if (!e.period) return [];
        return data.topics.filter((t) => !t.proposed && t.subject_id === e.subject_id && t.start <= e.period[1] && (t.end || e.date) >= e.period[0]);
    }

    function eventRow(e) {
        const d = C.parseDate(e.date);
        const diff = Math.round((d - C.parseDate(today)) / 86400000);
        const soon = diff === 0 ? VBLang.t('today') : diff === 1 ? VBLang.t('tomorrow') : diff > 1 && diff <= 14 ? VBLang.t('in_n_days', { n: diff }) : '';
        const tps = e.kind === 'altro' ? [] : topicsOf(e).filter((t) => !e.topics_off.includes(t.id));
        return el('div', { class: 'ag-item event-item' },
            el('div', { class: 'what' }, el('span', { class: 'badge ' + e.kind, text: KIND[e.kind] || e.kind }), e.subject,
                e.title ? ` · ${e.title}` : '', soon ? el('span', { class: 'soon', text: ` · ${soon}` }) : null),
            e.topics ? el('div', { class: 'topics', text: e.topics }) : null,
            tps.length ? el('div', { class: 'muted small', text: VBLang.t('topics_2') + tps.map((t) => t.name).join(', ') }) : null,
            e.period && e.kind !== 'altro' ? el('div', { class: 'muted small', text: VBLang.t('material_lessons_from_to', { from: dayShort(e.period[0]), to: dayShort(e.period[1]) }) + (e.period_from ? VBLang.t('chosen_by_hand') : '') }) : null,
            el('div', { class: 'muted small event-actions' }, VBLang.t('added_by', { name: e.author || '?' }),
                e.kind !== 'altro' ? el('a', { class: 'ghost-link mini-link', href: `appunti-archivio.php?class=${P().current.id}&subject=${e.subject_id}`, text: VBLang.t('open_the_subject') }) : null,
                e.can_edit ? C.menu([{ label: VBLang.t('edit_2'), onclick: () => P().editEvent(e) }, { label: VBLang.t('delete'), danger: true, onclick: () => P().deleteEvent(e) }]) : null));
    }

    const homeworkRow = (h) => el('div', { class: 'ag-item' },
        el('div', { class: 'what' }, el('span', { class: 'badge hw', text: VBLang.t('homework') }), h.subject),
        el('div', { class: 'topics', text: h.body }),
        el('div', { class: 'muted small event-actions' }, VBLang.t('added_by_2', { name: h.author || '?' }),
            h.can_edit ? C.menu([{ label: VBLang.t('edit_2'), onclick: () => editHomework(h) },
                { label: VBLang.t('delete'), danger: true, onclick: () => confirm(VBLang.t('delete_this_homework')) && act({ action: 'delete_homework', id: h.id }) }]) : null));

    /** The teacher asks on the programme: the topics of the subject up to that day (the open one included). */
    function programOf(t) {
        const list = data.topics.filter((x) => !x.proposed && x.subject_id === t.subject_id && x.start <= t.date).map((x) => x.name);
        return list.length ? el('div', { class: 'muted small turn-program', text: VBLang.t('turn_program_until', { list: list.slice(-8).join(', '), more: list.length > 8 ? VBLang.t('and_earlier') : '' }) }) : null;
    }
    const turnRow = (t) => el('div', { class: 'ag-item' + (t.user_ids.includes(P().me()) ? ' mine' : '') },
        el('div', { class: 'what' }, el('span', { class: 'badge turn', text: VBLang.t('oral_exam_2') }), t.subject, t.note ? ` · ${t.note}` : ''),
        el('div', { class: 'topics', text: t.user_ids.length ? t.user_ids.map(nameOf).join(', ') : 'nessuno' }),
        programOf(t),
        el('div', { class: 'muted small event-actions' },
            el('a', { class: 'ghost-link mini-link', href: `appunti-archivio.php?class=${P().current.id}&subject=${t.subject_id}`, text: VBLang.t('open_the_subject') }),
            can('turns') ? C.menu([{ label: VBLang.t('move_or_change'), onclick: () => editTurn(t) },
                { label: VBLang.t('delete'), danger: true, onclick: () => confirm(VBLang.t('delete_this_turn')) && act({ action: 'delete_turn', id: t.id }) }]) : null));

    const offRow = (o) => el('div', { class: 'ag-item off' },
        el('div', { class: 'what' }, el('span', { class: 'badge off', text: o.period ? VBLang.t('no_period', { n: o.period }) : VBLang.t('no_lessons') }), o.reason || '',
            o.from !== o.to ? el('span', { class: 'muted small', text: VBLang.t('until', { date: dayShort(o.to) }) }) : null),
        can('daysoff') ? el('div', { class: 'event-actions' }, C.menu([{ label: VBLang.t('remove'), danger: true, onclick: () => act({ action: 'delete_dayoff', id: o.id }) }])) : null);

    function renderAgenda() {
        const days = new Map();
        const put = (date, node, order) => { if (!days.has(date)) days.set(date, []); days.get(date).push([order, node]); };
        const mine = (x) => !subjectFilter || x.subject_id === subjectFilter;
        events.filter(mine).forEach((e) => put(e.date, eventRow(e), 1));
        data.turns.filter(mine).forEach((t) => put(t.date, turnRow(t), 2));
        data.homework.filter(mine).forEach((h) => put(h.due, homeworkRow(h), 3));
        data.days_off.forEach((o) => put(o.from < today && o.to >= today ? today : o.from, offRow(o), 0));
        let dates = [...days.keys()].sort();
        if (pickedDay) dates = dates.filter((d) => d === pickedDay);
        const block = (date) => {
            const d = C.parseDate(date);
            return el('div', { class: 'ag-day' + (date === today ? ' today' : '') + (date < today ? ' past' : '') },
                el('div', { class: 'date' }, el('span', { text: d.toLocaleDateString(VBLang.t('locale'), { weekday: 'short' }) }), el('b', { text: String(d.getDate()) }),
                    el('span', { text: d.toLocaleDateString(VBLang.t('locale'), { month: 'short' }) })),
                el('div', { class: 'ag-items' }, ...days.get(date).sort((a, b) => a[0] - b[0]).map((x) => x[1])));
        };
        const upcoming = pickedDay ? dates : dates.filter((d) => d >= today);
        const past = pickedDay ? [] : dates.filter((d) => d < today).reverse();
        $('#agenda-title').textContent = pickedDay ? VBLang.t('on', { date: dayLong.format(C.parseDate(pickedDay)) }) : VBLang.t('agenda');
        $('#events').replaceChildren(
            ...(pickedDay ? [el('button', { type: 'button', class: 'ghost mini', text: VBLang.t('show_the_whole_agenda'), onclick: () => { pickedDay = null; render(); } })] : []),
            upcoming.length ? el('div', {}, ...upcoming.map(block)) : el('p', { class: 'empty', text: pickedDay ? VBLang.t('nothing_on_this_day') : VBLang.t('nothing_in_the_calendar_in_the') }),
            ...(past.length ? [el('details', {}, el('summary', { text: VBLang.t('past_days', { n: past.length }) }), ...past.map(block))] : []));
    }

    /* ---------- month view (computer) and the subject filter ---------- */

    function renderViewBar() {
        const subjects = P().current.subjects;
        const sel = el('select', { 'aria-label': VBLang.t('subject'), onchange: (ev) => { subjectFilter = Number(ev.target.value) || 0; render(); } },
            el('option', { value: '', text: VBLang.t('all_subjects') }), ...subjects.map((s) => el('option', { value: s.id, text: s.name, selected: s.id === subjectFilter })));
        set($('#cal-view'),
            el('span', { class: 'bb-seg' }, ...[['month', VBLang.t('month')], ['agenda', VBLang.t('agenda')]].map(([k, t]) =>
                el('button', { type: 'button', class: 'ghost mini', 'aria-pressed': String(view === k), text: t, onclick: () => { view = k; pickedDay = null; C.store('vb_cal_view', k); render(); } }))),
            sel);
    }

    function renderMonth() {
        const box = $('#cal-month');
        box.hidden = view !== 'month';
        if (view !== 'month') { box.replaceChildren(); return; }
        const ref = monthRef || (monthRef = new Date(C.parseDate(today).getFullYear(), C.parseDate(today).getMonth(), 1));
        const ws = C.weekStart();                      // 1 = Monday, 0 = Sunday
        const first = new Date(ref.getFullYear(), ref.getMonth(), 1);
        const lead = (first.getDay() - ws + 7) % 7;
        const start = new Date(first); start.setDate(1 - lead);
        const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const mine = (x) => !subjectFilter || x.subject_id === subjectFilter;
        const per = new Map();
        const add = (date, label, cls, subjectId) => { if (!per.has(date)) per.set(date, []); per.get(date).push({ label, cls, subjectId }); };
        events.filter(mine).forEach((e) => add(e.date, `${KIND[e.kind] || ''} ${e.subject}`.trim(), e.kind, e.subject_id));
        data.homework.filter(mine).forEach((h) => add(h.due, VBLang.t('homework_3', { subject: h.subject }), 'compito', h.subject_id));
        data.turns.filter(mine).forEach((t) => add(t.date, VBLang.t('turn', { subject: t.subject }), 'turno', t.subject_id));
        data.days_off.forEach((o) => { for (let d = C.parseDate(o.from), end = C.parseDate(o.to); d <= end && per.size < 4000; d.setDate(d.getDate() + 1)) add(iso(d), o.reason || VBLang.t('no_lessons'), 'off', 0); });
        const names = [];
        for (let i = 0; i < 7; i++) { const d = new Date(2024, 0, 7 + ws + i); names.push(d.toLocaleDateString(VBLang.t('locale'), { weekday: 'short' })); }
        const cells = [];
        for (let i = 0; i < 42; i++) {
            const d = new Date(start); d.setDate(start.getDate() + i);
            const key = iso(d);
            const items = per.get(key) || [];
            const cell = el('button', { type: 'button', class: 'mc' + (d.getMonth() !== ref.getMonth() ? ' other' : '') + (key === today ? ' today' : '') + (key === pickedDay ? ' picked' : ''),
                'aria-label': VBLang.t('items_2', { day: dayLong.format(d), n: items.length }), onclick: () => { pickedDay = pickedDay === key ? null : key; render(); } },
                el('span', { class: 'mc-n', text: String(d.getDate()) }),
                ...items.slice(0, 3).map((x) => { const chip = el('span', { class: 'mc-chip ' + x.cls, text: x.label }); if (x.subjectId) chip.style.setProperty('--h', P().hue(x.subjectId)); return chip; }),
                items.length > 3 ? el('span', { class: 'mc-more', text: `+${items.length - 3}` }) : null);
            cells.push(cell);
        }
        const title = ref.toLocaleDateString(VBLang.t('locale'), { month: 'long', year: 'numeric' });
        const go = (n) => { monthRef = new Date(ref.getFullYear(), ref.getMonth() + n, 1); pickedDay = null; render(); };
        set(box,
            el('div', { class: 'mc-head' }, el('button', { type: 'button', class: 'ghost mini', text: VBLang.t('previous'), onclick: () => go(-1) }), el('b', { text: title }),
                el('button', { type: 'button', class: 'ghost mini', text: VBLang.t('next'), onclick: () => go(1) }),
                el('button', { type: 'button', class: 'ghost mini', text: VBLang.t('today_2'), onclick: () => { monthRef = null; pickedDay = null; render(); } })),
            el('div', { class: 'mc-grid' }, ...names.map((n) => el('div', { class: 'mc-dow', text: n })), ...cells));
    }

    /* ---------- the topics of a test, in the test form ---------- */

    let offNow = [];
    function drawEventTopics() {
        const f = $('#event-form');
        const box = $('#event-topics');
        if (!box || !data) return;
        const sid = Number(f.subject_id.value) || 0;
        const date = f.date.value;
        const list = !sid || !date || f.kind.value === 'altro' ? [] : data.topics.filter((t) => !t.proposed && t.subject_id === sid && t.start <= date
            && (!f.period_from.value || (t.end || date) >= f.period_from.value));
        box.hidden = list.length === 0;
        box.replaceChildren(el('legend', { text: VBLang.t('topics_of_this_test') }),
            el('p', { class: 'muted small', text: VBLang.t('untick_the_ones_that_do_not') }),
            ...list.slice(0, 20).map((t) => el('label', { class: 'switch perm' },
                el('input', { type: 'checkbox', name: 'topic_on', value: t.id, checked: !offNow.includes(t.id) }),
                VBLang.t('topic_range', { name: t.name, from: dayShort(t.start), to: t.end ? VBLang.t('topic_range_to', { date: dayShort(t.end) }) : VBLang.t('topic_range_ongoing') }))));
    }
    /** Topic ids unticked in the test form (sent as topics_off). */
    function topicsOff() {
        return [...document.querySelectorAll('#event-topics input[name=topic_on]:not(:checked)')].map((x) => Number(x.value));
    }
    function setEventTopics(off) { offNow = off || []; drawEventTopics(); }
    ['change', 'input'].forEach((evName) => $('#event-form').addEventListener(evName, (ev) => {
        if (['subject_id', 'date', 'kind', 'period_from'].includes(ev.target.name)) drawEventTopics();
    }));

    function render() {
        renderViewBar();
        renderMonth();
        renderTools();
        renderTopics();
        renderAgenda();
        drawEventTopics();
    }

    window.AppuntiCalendar = { load, topicsOff, setEventTopics };
})();
