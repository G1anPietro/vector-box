// public/js/appunti-bacheca.js — the Board tab of pages/appunti.php: what is happening now (lesson in progress and the next one),
// announcements, what matters this week as a diary, what is waiting for the student, and AI proposals to confirm.
// Data: api/bacheca.php (now, announcements), api/appunti.php (events, review), api/calendario.php (homework, turns, days off, topics).
// Every user-written string goes in with textContent (the shared el() builder).
(() => {
    'use strict';
    const C = window.AppuntiCommon;
    const P = () => window.AppuntiPage;
    const { el, getJson, post, toast } = C;
    const $ = (s, r = document) => r.querySelector(s);
    const set = (node, ...kids) => node.replaceChildren(...kids.filter((k) => k !== null && k !== undefined && k !== false));
    const cal = (body) => post('../api/calendario.php', body);
    const board = (body) => post('../api/bacheca.php', body);

    const WEEK_DAYS = 7;
    const weekday = new Intl.DateTimeFormat('it-IT', { weekday: 'short' });
    const dayLong = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
    const shortDate = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' });
    const KIND = { verifica: 'Verifica', interrogazione: 'Interrogazione', altro: 'Altro' };

    let state = null;          // overview from api/bacheca.php
    let timer = null;
    let clock = { base: 0, at: 0 };   // class-local seconds since midnight, and when we learned it

    const minutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
    const nowSec = () => clock.base + (performance.now() - clock.at) / 1000;
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const room = (l) => (l.room ? `aula ${l.room}` : 'aula non indicata');
    const dayWord = (iso, today) => {
        const diff = Math.round((C.parseDate(iso) - C.parseDate(today)) / 86400000);
        return diff === 0 ? 'oggi' : diff === 1 ? 'domani' : dayLong.format(C.parseDate(iso));
    };

    /* ---------- now and next ---------- */

    /** What the class is doing at this moment: {title, line, next, progress, hue}. Pure, so it can be tested by reading it. */
    function nowView() {
        const lessons = state.lessons;
        const t = nowSec() / 60;   // minutes
        const hue = (l) => P().hue(l.subject_id);
        const nextDayLine = () => {
            if (!state.next_day) return 'Nei prossimi giorni non ci sono lezioni in orario.';
            const l = state.next_day.lesson;
            return `${dayWord(state.next_day.date, state.today)} si comincia alle ${l.start} con ${l.subject}, ${room(l)}.`;
        };
        if (state.day_off) return { title: 'Oggi niente lezione', line: state.day_off, next: nextDayLine() };
        if (!lessons.length) return { title: 'Oggi non ci sono lezioni', line: '', next: nextDayLine() };
        const cur = lessons.find((l) => minutes(l.start) <= t && t < minutes(l.end));
        if (cur) {
            const i = lessons.indexOf(cur);
            const left = Math.max(1, Math.ceil(minutes(cur.end) - t));
            const nxt = lessons[i + 1];
            return {
                label: 'Adesso', title: cur.subject, hue: hue(cur),
                line: `${room(cur)}, finisce alle ${cur.end} (${left === 1 ? 'manca 1 minuto' : `mancano ${left} minuti`})`,
                progress: (t - minutes(cur.start)) / (minutes(cur.end) - minutes(cur.start)), start: cur.start, end: cur.end,
                next: nxt ? `Poi ${nxt.subject}, ${room(nxt)}, alle ${nxt.start}.` : 'Questa è l\'ultima lezione di oggi.',
            };
        }
        const upcoming = lessons.find((l) => minutes(l.start) > t);
        if (upcoming) {
            const wait = Math.ceil(minutes(upcoming.start) - t);
            const first = upcoming === lessons[0];
            return {
                label: first ? 'Tra poco' : 'Intervallo', title: upcoming.subject, hue: hue(upcoming),
                line: `${room(upcoming)}, alle ${upcoming.start} (${wait === 1 ? 'tra 1 minuto' : `tra ${wait} minuti`})`,
                next: first ? 'La scuola non è ancora cominciata.' : '',
            };
        }
        return { title: 'Le lezioni di oggi sono finite', line: '', next: nextDayLine() };
    }

    function renderNow() {
        const v = nowView();
        const box = $('#bb-now');
        const card = el('div', { class: 'bb-now' + (v.hue ? ' live' : '') },
            el('div', { class: 'bb-now-main' },
                v.label ? el('span', { class: 'bb-now-label', text: v.label }) : null,
                el('h2', { class: 'bb-now-title', text: v.title }),
                v.line ? el('p', { class: 'bb-now-line', text: v.line }) : null),
            v.progress !== undefined ? el('div', { class: 'bb-bell', role: 'progressbar', 'aria-label': 'Quanto è passato dell\'ora',
                'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(v.progress * 100) },
                el('span', { class: 'bb-bell-fill', style: `width:${Math.round(v.progress * 100)}%` }),
                el('span', { class: 'bb-bell-from', text: v.start }), el('span', { class: 'bb-bell-to', text: v.end })) : null,
            v.next ? el('p', { class: 'bb-next', text: v.next }) : null);
        if (v.hue) card.style.setProperty('--sub', v.hue);
        set(box, card);
    }

    /* ---------- announcements ---------- */

    function announcementDialog(a = null) {
        C.dialogForm(a ? 'Modifica l\'annuncio' : 'Nuovo annuncio', (f) => {
            f.append(
                el('label', { text: 'Titolo' }, el('input', { name: 'title', required: true, maxLength: 100, value: a ? a.title : '', placeholder: 'es. Domani si esce alle 12' })),
                el('label', { text: 'Testo (facoltativo)' }, el('textarea', { name: 'body', rows: 5, maxLength: 2000, value: a ? a.body : '' })),
                el('label', { class: 'switch perm' }, el('input', { type: 'checkbox', name: 'pinned', checked: a ? a.pinned : false }), 'Tienilo in alto'),
                a ? null : el('label', { class: 'switch perm' }, el('input', { type: 'checkbox', name: 'notify', checked: true }), 'Avvisa tutti con una notifica'));
        }, async (f) => {
            const r = await board({ action: 'save_announcement', class_id: P().current.id, id: a ? a.id : 0, title: f.title.value, body: f.body.value,
                pinned: f.pinned.checked, notify: f.notify ? f.notify.checked : false });
            toast(a ? 'Annuncio salvato.' : (r.pushed ? `Annuncio pubblicato, notifica a ${plural(r.pushed, 'dispositivo', 'dispositivi')}.` : 'Annuncio pubblicato.'), 'ok');
            load();
        }, a ? 'Salva' : 'Pubblica');
    }

    function renderNotes() {
        const box = $('#bb-notes');
        const list = state.announcements;
        set(box,
            el('div', { class: 'bb-head' }, el('h3', { text: 'Annunci' }),
                state.can_post ? el('button', { type: 'button', class: 'ghost mini', text: 'Scrivi un annuncio', onclick: () => announcementDialog() }) : null),
            list.length ? el('div', { class: 'bb-notes' }, ...list.map((a) => el('article', { class: 'bb-note' + (a.pinned ? ' pinned' : '') },
                el('div', { class: 'bb-note-top' }, el('h4', { text: a.title }),
                    a.can_edit ? C.menu([{ label: 'Modifica…', onclick: () => announcementDialog(a) },
                        { label: 'Elimina', danger: true, onclick: async () => {
                            if (!confirm('Eliminare questo annuncio?')) return;
                            try { await board({ action: 'delete_announcement', id: a.id }); toast('Annuncio eliminato.', 'ok'); load(); } catch (e) { toast(e.message, 'err'); }
                        } }]) : null),
                a.body ? el('p', { class: 'bb-note-body', text: a.body }) : null,
                el('p', { class: 'bb-note-foot' }, a.pinned ? el('span', { class: 'bb-pin', text: 'In alto' }) : null,
                    el('span', { text: a.author || '?' }), el('span', { text: shortDate.format(new Date(a.created_at * 1000)) })))))
                : el('p', { class: 'bb-empty', text: state.can_post ? 'Nessun annuncio. Scrivi qui le cose che la classe deve sapere: uscite, cambi d\'orario, scadenze.' : 'Nessun annuncio per ora.' }));
    }

    /* ---------- scoreboard (points are given by the server for quiz answers at the first try and for the daily review) ---------- */

    let scoreView = 'week';
    let scoreAll = false;
    function renderScore(sc) {
        const box = $('#bb-score');
        box.hidden = !sc || sc.on === false;
        if (box.hidden) return;
        const join = async (on) => { try { await C.post('../api/classifica.php', { action: 'set_in', class_id: P().current.id, in: on }); load(); } catch (e) { toast(e.message, 'err'); } };
        if (!sc.in) {
            set(box, el('div', { class: 'bb-head' }, el('h3', { text: 'Classifica' })),
                el('p', { class: 'bb-empty', text: 'Non partecipi alla classifica: i tuoi punti non si contano e non compari.' }),
                el('button', { type: 'button', class: 'ghost mini', text: 'Partecipa', onclick: () => join(true) }));
            return;
        }
        const mine = sc.mine || {};
        if (!sc.can_see) {
            set(box, el('div', { class: 'bb-head' }, el('h3', { text: 'Classifica' })),
                el('p', { class: 'bb-empty', text: `Hai ${mine.week || 0} punti questa settimana e ${mine.total || 0} in tutto. La classifica la vede solo chi ha il permesso.` }));
            return;
        }
        const rows = (scoreView === 'week' ? sc.week : sc.total);
        const shown = scoreAll ? rows : rows.slice(0, 5).concat(rows.slice(5).filter((r) => r.me));
        set(box,
            el('div', { class: 'bb-head' }, el('h3', { text: 'Classifica' }),
                el('span', { class: 'bb-seg' },
                    ...[['week', 'Settimana'], ['total', 'Sempre']].map(([k, t]) => el('button', { type: 'button', class: 'ghost mini', 'aria-pressed': String(scoreView === k), text: t, onclick: () => { scoreView = k; renderScore(sc); } })))),
            rows.length ? el('ol', { class: 'bb-score' }, ...shown.map((r) => el('li', { class: r.me ? 'me' : '' },
                el('span', { class: 'rk', text: String(rows.indexOf(r) + 1) }), el('span', { class: 'nm', text: r.name + (r.me ? ' (tu)' : '') }), el('b', { text: String(r.points) }))))
                : el('p', { class: 'bb-empty', text: 'Ancora nessuno.' }),
            rows.length > shown.length || scoreAll ? el('button', { type: 'button', class: 'ghost mini', text: scoreAll ? 'Mostra meno' : 'Mostra tutti', onclick: () => { scoreAll = !scoreAll; renderScore(sc); } }) : null,
            el('p', { class: 'muted small', text: 'Punti per le risposte giuste al primo tentativo nei quiz e per il ripasso di ogni giorno.' }));
    }

    /* ---------- the week as a diary ---------- */

    function weekRows(events, ov) {
        const today = state.today;
        const end = new Date(C.parseDate(today)); end.setDate(end.getDate() + WEEK_DAYS);
        const last = (d) => { const x = C.parseDate(d); return x <= end; };
        const rows = new Map();
        const put = (date, row) => { if (date >= today && last(date)) { if (!rows.has(date)) rows.set(date, []); rows.get(date).push(row); } };
        const meId = P().me();
        events.forEach((e) => put(e.date, { order: 1, subject_id: e.subject_id, label: KIND[e.kind] || e.kind, text: e.subject + (e.title ? `: ${e.title}` : ''), strong: e.kind !== 'altro' }));
        ov.homework.forEach((h) => put(h.due, { order: 3, subject_id: h.subject_id, label: 'Compito', text: `${h.subject}: ${h.body}` }));
        ov.turns.forEach((t) => put(t.date, { order: 2, subject_id: t.subject_id, label: 'Interrogati', mine: t.user_ids.includes(meId),
            text: `${t.subject}: ${t.user_ids.map((id) => { const m = P().current.members.find((x) => x.id === id); return m ? m.name : '?'; }).join(', ') || 'nessuno'}` }));
        ov.days_off.forEach((o) => {
            for (let d = new Date(C.parseDate(o.from)); d <= C.parseDate(o.to) && d <= end; d.setDate(d.getDate() + 1)) {
                const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                put(iso, { order: 0, label: o.period ? `Niente ${o.period}ª ora` : 'Niente lezione', text: o.reason || '', off: true });
            }
        });
        return [...rows.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, list]) => [date, list.sort((a, b) => a.order - b.order)]);
    }

    function renderWeek(events, ov) {
        const days = weekRows(events, ov);
        set($('#bb-week'),
            el('div', { class: 'bb-head' }, el('h3', { text: 'Questa settimana' }),
                el('button', { type: 'button', class: 'ghost mini', text: 'Apri il calendario', onclick: () => P().showTab('calendar') })),
            days.length ? el('div', { class: 'bb-diary' }, ...days.map(([date, list]) => {
                const d = C.parseDate(date);
                return el('section', { class: 'bb-day' + (date === state.today ? ' today' : '') },
                    el('div', { class: 'bb-day-gutter' }, el('b', { text: String(d.getDate()) }), el('span', { text: weekday.format(d) }),
                        date === state.today ? el('em', { text: 'oggi' }) : null),
                    el('ul', { class: 'bb-rows' }, ...list.map((r) => {
                        const li = el('li', { class: 'bb-row' + (r.off ? ' off' : '') + (r.mine ? ' mine' : '') + (r.strong ? ' strong' : '') },
                            el('span', { class: 'bb-row-label', text: r.label }), el('span', { class: 'bb-row-text', text: r.text }));
                        if (r.subject_id) li.style.setProperty('--sub', P().hue(r.subject_id));
                        return li;
                    })));
            })) : el('p', { class: 'bb-empty', text: 'Niente in calendario per i prossimi 7 giorni. Verifiche, compiti e turni si aggiungono dal Calendario.' }));
    }

    /* ---------- for you / to fix ---------- */

    function renderYou(review, ov) {
        const meId = P().me();
        const myTurns = ov.turns.filter((t) => t.user_ids.includes(meId) && t.date >= state.today && t.date <= weekEnd());
        const lines = [];
        if (review.due.length) {
            lines.push(el('div', { class: 'bb-you-row' },
                el('p', { text: `Hai ${plural(review.due.length, 'domanda', 'domande')} da ripassare oggi.` }),
                el('button', { type: 'button', text: 'Inizia il ripasso', onclick: () => P().showTab('study') })));
        }
        myTurns.forEach((t) => lines.push(el('div', { class: 'bb-you-row' },
            el('p', { text: `Sei interrogato in ${t.subject} ${dayWord(t.date, state.today)}.` }),
            el('a', { class: 'btn-link small', href: `appunti-archivio.php?class=${P().current.id}&subject=${t.subject_id}`, text: 'Apri la materia' }))));
        set($('#bb-you'), lines.length ? el('h3', { text: 'Per te' }) : null, ...lines);
        $('#bb-you').hidden = !lines.length;
    }
    const weekEnd = () => { const d = C.parseDate(state.today); d.setDate(d.getDate() + WEEK_DAYS); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

    function renderFix(ov) {
        const box = $('#bb-fix');
        const proposed = (P().current.perms || []).includes('topics') ? ov.topics.filter((t) => t.proposed) : [];
        box.hidden = !proposed.length;
        if (!proposed.length) return;
        set(box, el('h3', { text: 'Da sistemare' }),
            ...proposed.map((t) => el('div', { class: 'bb-fix-row' },
                el('p', {}, el('b', { text: t.name }), ` in ${t.subject}, dal ${shortDate.format(C.parseDate(t.start))}: l'AI pensa che sia un argomento nuovo.`),
                el('span', { class: 'row-actions' },
                    el('button', { type: 'button', class: 'mini', text: 'Conferma', onclick: async () => {
                        try { await cal({ action: 'confirm_topic', id: t.id }); toast('Argomento confermato.', 'ok'); load(); } catch (e) { toast(e.message, 'err'); }
                    } }),
                    el('button', { type: 'button', class: 'ghost mini', text: 'Rivedi nel calendario', onclick: () => P().showTab('calendar') })))));
    }

    /* ---------- load ---------- */

    async function load() {
        const c = P().current;
        if (!c) return;
        clearInterval(timer);
        try {
            const [bb, ev, ov, rv, sc] = await Promise.all([
                getJson(`../api/bacheca.php?action=overview&class_id=${c.id}`),
                getJson(`../api/appunti.php?action=events&class_id=${c.id}`),
                getJson(`../api/calendario.php?action=overview&class_id=${c.id}`),
                getJson(`../api/appunti.php?action=review&class_id=${c.id}`).catch(() => ({ due: [], later: 0 })),
                getJson(`../api/classifica.php?action=board&class_id=${c.id}`).catch(() => null),
            ]);
            state = bb;
            const [h, m, s] = bb.now.split(':').map(Number);
            clock = { base: h * 3600 + m * 60 + s, at: performance.now() };
            renderNow();
            renderNotes();
            renderScore(sc);
            renderWeek(ev.events, ov);
            renderYou(rv, ov);
            renderFix(ov);
            // keep "Adesso" true while the tab stays open
            timer = setInterval(() => { if ($('#tab-board').hidden) clearInterval(timer); else renderNow(); }, 20000);
        } catch (e) {
            set($('#bb-now'), el('p', { class: 'bb-empty', text: e.message }));
        }
    }

    window.AppuntiBoard = { load, nowView: () => (state ? nowView() : null) };
})();
