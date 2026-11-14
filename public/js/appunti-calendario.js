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
    const KIND = { verifica: 'Verifica', interrogazione: 'Interrogazione', altro: 'Altro' };
    const dayLong = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
    const dayShort = (iso) => C.parseDate(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
    const set = (node, ...kids) => node.replaceChildren(...kids.filter((k) => k !== null && k !== undefined && k !== false));
    let data = null;      // overview from api/calendario.php
    let events = [];
    let today = '';
    let perms = [];
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
            el('button', { type: 'button', class: 'ghost', text: '+ Compito', onclick: () => editHomework() }),
            can('topics') ? el('button', { type: 'button', class: 'ghost', text: '+ Argomento', onclick: () => editTopic() }) : null,
            can('daysoff') ? el('button', { type: 'button', class: 'ghost', text: '+ Giorno senza lezione', onclick: () => addDayOff() }) : null,
            can('turns') ? el('button', { type: 'button', class: 'ghost', text: 'Turni delle interrogazioni', onclick: () => turnsDialog() }) : null);
    }

    /* ---------- topics ---------- */

    function renderTopics() {
        const box = $('#cal-topics');
        const list = data.topics.filter((t) => t.proposed || !t.end || t.end >= today).slice(0, 30);
        const older = data.topics.filter((t) => !t.proposed && t.end && t.end < today);
        const row = (t) => {
            const chip = el('div', { class: 'topic-row' + (t.proposed ? ' proposed' : '') },
                el('div', {}, el('b', { text: t.name }), el('span', { class: 'muted small', text: ` · ${t.subject}` }), el('br'),
                    el('span', { class: 'muted small', text: `dal ${dayShort(t.start)} ` + (t.end ? `al ${dayShort(t.end)}` : '· in corso')
                        + (t.proposed ? ' · proposto dall\'AI: da confermare' : '') })),
                el('span', { class: 'row-actions' },
                    el('a', { class: 'ghost-link mini-link', href: `appunti-archivio.php?class=${P().current.id}&subject=${t.subject_id}`, text: 'Apri' }),
                    t.proposed && can('topics') ? el('button', { type: 'button', class: 'mini', text: 'Conferma', onclick: () => act({ action: 'confirm_topic', id: t.id }, 'Argomento confermato.') }) : null,
                    can('topics') ? C.menu([{ label: 'Modifica…', onclick: () => editTopic(t) },
                        { label: 'Elimina', danger: true, onclick: () => confirm(`Eliminare l'argomento "${t.name}"? Il materiale resta.`) && act({ action: 'delete_topic', id: t.id }) }]) : null));
            chip.style.setProperty('--sub', P().hue(t.subject_id));
            return chip;
        };
        set(box,
            el('h3', { class: 'section-title', text: 'Argomenti' }),
            list.length ? el('div', { class: 'topic-list' }, ...list.map(row))
                : el('p', { class: 'muted small', text: can('topics') ? 'Nessun argomento in corso. Con "+ Argomento" dici all\'AI da quando parte: riassume solo quelle lezioni.'
                    : 'Nessun argomento in corso.' }),
            older.length ? el('details', {}, el('summary', { text: `Argomenti finiti (${older.length})` }), el('div', { class: 'topic-list' }, ...older.map(row))) : null);
    }

    function editTopic(t = null) {
        C.dialogForm(t ? 'Modifica l\'argomento' : 'Nuovo argomento', (f) => {
            f.append(
                el('label', { text: 'Materia' }, el('select', { name: 'subject_id', required: true }, ...subjectOptions(t && t.subject_id))),
                el('label', { text: 'Nome dell\'argomento' }, el('input', { name: 'name', required: true, maxLength: 80, value: t ? t.name : '', placeholder: 'es. Napoleone' })),
                el('div', { class: 'grid2' },
                    el('label', { text: 'Iniziato il' }, el('input', { type: 'date', name: 'start', required: true, value: t ? t.start : today })),
                    el('label', { text: 'Finito il (vuoto = in corso)' }, el('input', { type: 'date', name: 'end', value: t && t.end ? t.end : '' }))),
                el('p', { class: 'muted small', text: 'Lascia vuota la fine finché non sapete quando c\'è la verifica: si chiude da solo quando la fissate.' }));
        }, async (f) => {
            await cal({ action: 'save_topic', class_id: P().current.id, id: t ? t.id : 0, subject_id: Number(f.subject_id.value), name: f.name.value, start: f.start.value, end: f.end.value });
            toast('Argomento salvato.', 'ok');
            load();
        });
    }

    /* ---------- homework, days off ---------- */

    function editHomework(h = null) {
        C.dialogForm(h ? 'Modifica il compito' : 'Nuovo compito', (f) => {
            f.append(
                el('div', { class: 'grid2' },
                    el('label', { text: 'Materia' }, el('select', { name: 'subject_id', required: true }, ...subjectOptions(h && h.subject_id))),
                    el('label', { text: 'Per il giorno' }, el('input', { type: 'date', name: 'due', required: true, value: h ? h.due : '' }))),
                el('label', { text: 'Cosa c\'è da fare' }, el('textarea', { name: 'body', rows: 4, maxLength: 2000, required: true, value: h ? h.body : '', placeholder: 'es. Esercizi 12-18 pag. 240; finire il programma sulle liste' })),
                el('p', { class: 'muted small', text: 'L\'AI usa i compiti per capire cosa chiede il prof: domande, esercizi, codice.' }));
        }, async (f) => {
            await cal({ action: 'save_homework', class_id: P().current.id, id: h ? h.id : 0, subject_id: Number(f.subject_id.value), due: f.due.value, body: f.body.value });
            toast('Compito salvato.', 'ok');
            load();
        });
    }

    function addDayOff() {
        C.dialogForm('Giorno senza lezione', (f) => {
            f.append(
                el('label', { text: 'Motivo' }, el('input', { name: 'reason', maxLength: 80, placeholder: 'es. Sciopero, gita, vacanze di Natale, prof assente' })),
                el('div', { class: 'grid2' },
                    el('label', { text: 'Dal giorno' }, el('input', { type: 'date', name: 'from', required: true, value: today })),
                    el('label', { text: 'Al giorno (vuoto = un giorno solo)' }, el('input', { type: 'date', name: 'to' }))),
                el('label', { text: 'Solo un\'ora? (vuoto = tutto il giorno)' }, el('select', { name: 'period' },
                    el('option', { value: '', text: 'Tutto il giorno' }), ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => el('option', { value: n, text: `${n}ª ora` })))),
                el('p', { class: 'muted small', text: 'In quei giorni niente avvisi di fine ora, niente turni e nessuna lezione "senza appunti".' }));
        }, async (f) => {
            await cal({ action: 'save_dayoff', class_id: P().current.id, from: f.from.value, to: f.to.value, period: Number(f.period.value) || 0, reason: f.reason.value });
            toast('Segnato.', 'ok');
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
            el('button', { type: 'button', class: 'ghost mini', text: '↑', 'aria-label': 'Su', disabled: i === 0, onclick: () => { [order[i - 1], order[i]] = [order[i], order[i - 1]]; draw(); } }),
            el('button', { type: 'button', class: 'ghost mini', text: '↓', 'aria-label': 'Giù', disabled: i === order.length - 1, onclick: () => { [order[i + 1], order[i]] = [order[i], order[i + 1]]; draw(); } }),
            el('button', { type: 'button', class: 'ghost mini', text: '✕', 'aria-label': 'Togli dai turni', onclick: () => { order.splice(i, 1); draw(); } })))));
        const missing = () => members().filter((m) => !order.includes(m.id));
        const subject = el('select', { name: 'subject_id' }, ...subjectOptions());
        const start = el('input', { type: 'date', name: 'start', value: today });
        const per = el('input', { type: 'number', name: 'per', min: 1, max: 10, value: 2 });
        const saveOrder = () => cal({ action: 'save_turn_order', class_id: P().current.id, order });
        dlg.append(el('div', { class: 'stack' },
            el('h3', { text: 'Turni delle interrogazioni' }),
            el('p', { class: 'muted small', text: 'Un ordine solo per la classe, usato per tutte le materie. Poi scegli la materia e da che giorno: il sito mette i nomi sulle prossime lezioni, saltando i giorni senza lezione.' }),
            el('div', { class: 'row' },
                el('button', { type: 'button', class: 'ghost', text: 'A–Z', onclick: () => { order = [...members()].sort((a, b) => a.name.localeCompare(b.name, 'it')).map((m) => m.id); draw(); } }),
                el('button', { type: 'button', class: 'ghost', text: '🎲 Mescola', onclick: () => { for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; } draw(); } }),
                el('button', { type: 'button', class: 'ghost', text: 'Rimetti tutti', onclick: () => { order.push(...missing().map((m) => m.id)); draw(); } }),
                el('button', { type: 'button', text: 'Salva l\'ordine', onclick: async () => { try { await saveOrder(); toast('Ordine salvato.', 'ok'); } catch (e) { toast(e.message, 'err'); } } })),
            list,
            el('h3', { text: 'Metti i turni nel calendario' }),
            el('div', { class: 'grid2' }, el('label', { text: 'Materia' }, subject), el('label', { text: 'Dal giorno' }, start)),
            el('label', { text: 'Interrogati per lezione' }, per),
            el('div', { class: 'row' },
                el('button', { type: 'button', text: 'Crea i turni', onclick: async () => {
                    try {
                        await saveOrder();
                        const r = await cal({ action: 'make_turns', class_id: P().current.id, subject_id: Number(subject.value), start: start.value, per_lesson: Number(per.value) || 2 });
                        toast(`Turni creati su ${r.dates.length} lezion${r.dates.length === 1 ? 'e' : 'i'}, fino al ${dayShort(r.dates[r.dates.length - 1])}.`, 'ok');
                        dlg.close();
                        load();
                    } catch (e) {
                        toast(e.json && e.json.code === 'no_lessons' ? 'Nell\'orario non ci sono abbastanza lezioni di questa materia: controlla l\'orario.' : e.message, 'err');
                    }
                } }),
                el('button', { type: 'button', class: 'danger', text: 'Togli i turni futuri di questa materia', onclick: async () => {
                    if (!confirm('Togliere tutti i turni da oggi in poi di questa materia?')) return;
                    await act({ action: 'clear_turns', class_id: P().current.id, subject_id: Number(subject.value) }, 'Turni tolti.');
                    dlg.close();
                } }),
                el('button', { type: 'button', class: 'ghost', text: 'Chiudi', onclick: () => dlg.close() }))));
        dlg.addEventListener('close', () => dlg.remove());
        dlg.addEventListener('click', (ev) => { if (ev.target === dlg) dlg.close(); });
        document.body.append(dlg);
        draw();
        dlg.showModal();
    }

    function editTurn(t) {
        C.dialogForm(`Turno di ${t.subject}`, (f) => {
            f.append(el('label', { text: 'Giorno' }, el('input', { type: 'date', name: 'date', required: true, value: t.date })),
                el('p', { class: 'muted small', text: 'Chi viene interrogato:' }),
                el('div', { class: 'who-list' }, ...members().map((m) => el('label', { class: 'switch perm' },
                    el('input', { type: 'checkbox', name: 'who', value: m.id, checked: t.user_ids.includes(m.id) }), m.name))),
                el('label', { text: 'Nota (facoltativa)' }, el('input', { name: 'note', maxLength: 120, value: t.note, placeholder: 'es. Recupero, volontari' })));
        }, async (f) => {
            await cal({ action: 'save_turn', id: t.id, date: f.date.value, note: f.note.value,
                user_ids: [...f.querySelectorAll('input[name=who]:checked')].map((x) => Number(x.value)) });
            toast('Turno salvato.', 'ok');
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
        const soon = diff === 0 ? 'oggi' : diff === 1 ? 'domani' : diff > 1 && diff <= 14 ? `tra ${diff} giorni` : '';
        const tps = e.kind === 'altro' ? [] : topicsOf(e).filter((t) => !e.topics_off.includes(t.id));
        return el('div', { class: 'ag-item event-item' },
            el('div', { class: 'what' }, el('span', { class: 'badge ' + e.kind, text: KIND[e.kind] || e.kind }), e.subject,
                e.title ? ` · ${e.title}` : '', soon ? el('span', { class: 'soon', text: ` · ${soon}` }) : null),
            e.topics ? el('div', { class: 'topics', text: e.topics }) : null,
            tps.length ? el('div', { class: 'muted small', text: 'Argomenti: ' + tps.map((t) => t.name).join(', ') }) : null,
            e.period && e.kind !== 'altro' ? el('div', { class: 'muted small', text: `Materiale: lezioni dal ${dayShort(e.period[0])} al ${dayShort(e.period[1])}` + (e.period_from ? ' (scelto a mano)' : '') }) : null,
            el('div', { class: 'muted small event-actions' }, `aggiunta da ${e.author || '?'}`,
                e.kind !== 'altro' ? el('a', { class: 'ghost-link mini-link', href: `appunti-archivio.php?class=${P().current.id}&subject=${e.subject_id}`, text: 'Apri la materia' }) : null,
                e.can_edit ? C.menu([{ label: 'Modifica', onclick: () => P().editEvent(e) }, { label: 'Elimina', danger: true, onclick: () => P().deleteEvent(e) }]) : null));
    }

    const homeworkRow = (h) => el('div', { class: 'ag-item' },
        el('div', { class: 'what' }, el('span', { class: 'badge hw', text: 'Compito' }), h.subject),
        el('div', { class: 'topics', text: h.body }),
        el('div', { class: 'muted small event-actions' }, `messo da ${h.author || '?'}`,
            h.can_edit ? C.menu([{ label: 'Modifica', onclick: () => editHomework(h) },
                { label: 'Elimina', danger: true, onclick: () => confirm('Eliminare questo compito?') && act({ action: 'delete_homework', id: h.id }) }]) : null));

    const turnRow = (t) => el('div', { class: 'ag-item' + (t.user_ids.includes(P().me()) ? ' mine' : '') },
        el('div', { class: 'what' }, el('span', { class: 'badge turn', text: 'Interrogati' }), t.subject, t.note ? ` · ${t.note}` : ''),
        el('div', { class: 'topics', text: t.user_ids.length ? t.user_ids.map(nameOf).join(', ') : 'nessuno' }),
        el('div', { class: 'muted small event-actions' },
            el('a', { class: 'ghost-link mini-link', href: `appunti-archivio.php?class=${P().current.id}&subject=${t.subject_id}`, text: 'Apri la materia' }),
            can('turns') ? C.menu([{ label: 'Sposta o cambia…', onclick: () => editTurn(t) },
                { label: 'Elimina', danger: true, onclick: () => confirm('Eliminare questo turno?') && act({ action: 'delete_turn', id: t.id }) }]) : null));

    const offRow = (o) => el('div', { class: 'ag-item off' },
        el('div', { class: 'what' }, el('span', { class: 'badge off', text: o.period ? `Niente ${o.period}ª ora` : 'Niente lezione' }), o.reason || '',
            o.from !== o.to ? el('span', { class: 'muted small', text: ` · fino al ${dayShort(o.to)}` }) : null),
        can('daysoff') ? el('div', { class: 'event-actions' }, C.menu([{ label: 'Togli', danger: true, onclick: () => act({ action: 'delete_dayoff', id: o.id }) }])) : null);

    function renderAgenda() {
        const days = new Map();
        const put = (date, node, order) => { if (!days.has(date)) days.set(date, []); days.get(date).push([order, node]); };
        events.forEach((e) => put(e.date, eventRow(e), 1));
        data.turns.forEach((t) => put(t.date, turnRow(t), 2));
        data.homework.forEach((h) => put(h.due, homeworkRow(h), 3));
        data.days_off.forEach((o) => put(o.from < today && o.to >= today ? today : o.from, offRow(o), 0));
        const dates = [...days.keys()].sort();
        const block = (date) => {
            const d = C.parseDate(date);
            return el('div', { class: 'ag-day' + (date === today ? ' today' : '') + (date < today ? ' past' : '') },
                el('div', { class: 'date' }, el('span', { text: d.toLocaleDateString('it-IT', { weekday: 'short' }) }), el('b', { text: String(d.getDate()) }),
                    el('span', { text: d.toLocaleDateString('it-IT', { month: 'short' }) })),
                el('div', { class: 'ag-items' }, ...days.get(date).sort((a, b) => a[0] - b[0]).map((x) => x[1])));
        };
        const upcoming = dates.filter((d) => d >= today);
        const past = dates.filter((d) => d < today).reverse();
        $('#events').replaceChildren(
            upcoming.length ? el('div', {}, ...upcoming.map(block)) : el('p', { class: 'empty', text: 'Niente in calendario nei prossimi giorni.' }),
            ...(past.length ? [el('details', {}, el('summary', { text: `Passati (${past.length} giorni)` }), ...past.map(block))] : []));
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
        box.replaceChildren(el('legend', { text: 'Argomenti di questa verifica' }),
            el('p', { class: 'muted small', text: 'Togli la spunta a quelli che non c\'entrano: l\'AI non userà le loro lezioni.' }),
            ...list.slice(0, 20).map((t) => el('label', { class: 'switch perm' },
                el('input', { type: 'checkbox', name: 'topic_on', value: t.id, checked: !offNow.includes(t.id) }),
                `${t.name} (dal ${dayShort(t.start)}${t.end ? ' al ' + dayShort(t.end) : ', in corso'})`)));
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
        renderTools();
        renderTopics();
        renderAgenda();
        drawEventTopics();
    }

    window.AppuntiCalendar = { load, topicsOff, setEventTopics };
})();
