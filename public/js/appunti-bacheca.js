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
    const weekday = new Intl.DateTimeFormat(VBLang.t('locale'), { weekday: 'short' });
    const dayLong = new Intl.DateTimeFormat(VBLang.t('locale'), { weekday: 'long', day: 'numeric', month: 'long' });
    const shortDate = new Intl.DateTimeFormat(VBLang.t('locale'), { day: 'numeric', month: 'short' });
    const KIND = { verifica: VBLang.t('written_test'), interrogazione: VBLang.t('oral_exam'), altro: VBLang.t('other') };

    let state = null;          // overview from api/bacheca.php
    let timer = null;
    let clock = { base: 0, at: 0 };   // class-local seconds since midnight, and when we learned it

    const minutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
    const nowSec = () => clock.base + (performance.now() - clock.at) / 1000;
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const room = (l) => (l.room ? VBLang.t('room', { room: l.room }) : VBLang.t('room_not_specified'));
    const dayWord = (iso, today) => {
        const diff = Math.round((C.parseDate(iso) - C.parseDate(today)) / 86400000);
        return diff === 0 ? VBLang.t('today') : diff === 1 ? VBLang.t('tomorrow') : dayLong.format(C.parseDate(iso));
    };

    /* ---------- now and next ---------- */

    /** What the class is doing at this moment: {title, line, next, progress, hue}. Pure, so it can be tested by reading it. */
    function nowView() {
        const lessons = state.lessons;
        const t = nowSec() / 60;   // minutes
        const hue = (l) => P().hue(l.subject_id);
        const nextDayLine = () => {
            if (!state.next_day) return VBLang.t('no_lessons_in_the_timetable_in');
            const l = state.next_day.lesson;
            return VBLang.t('lessons_start_at_with', { when: dayWord(state.next_day.date, state.today), time: l.start, subject: l.subject, room: room(l) });
        };
        if (state.day_off) return { title: VBLang.t('no_lessons_today'), line: state.day_off, next: nextDayLine() };
        if (!lessons.length) return { title: VBLang.t('there_are_no_lessons_today'), line: '', next: nextDayLine() };
        const cur = lessons.find((l) => minutes(l.start) <= t && t < minutes(l.end));
        if (cur) {
            const i = lessons.indexOf(cur);
            const left = Math.max(1, Math.ceil(minutes(cur.end) - t));
            const nxt = lessons[i + 1];
            return {
                label: VBLang.t('now'), title: cur.subject, hue: hue(cur),
                line: VBLang.t('room_ends_at', { room: room(cur), end: cur.end, left: left === 1 ? VBLang.t('one_minute_left') : VBLang.t('n_minutes_left', { n: left }) }),
                progress: (t - minutes(cur.start)) / (minutes(cur.end) - minutes(cur.start)), start: cur.start, end: cur.end,
                next: nxt ? VBLang.t('then_at', { subject: nxt.subject, room: room(nxt), time: nxt.start }) : VBLang.t('this_is_the_last_lesson_of'),
            };
        }
        const upcoming = lessons.find((l) => minutes(l.start) > t);
        if (upcoming) {
            const wait = Math.ceil(minutes(upcoming.start) - t);
            const first = upcoming === lessons[0];
            return {
                label: first ? VBLang.t('soon') : VBLang.t('break'), title: upcoming.subject, hue: hue(upcoming),
                line: VBLang.t('room_at_time', { room: room(upcoming), start: upcoming.start, wait: wait === 1 ? VBLang.t('in_one_minute') : VBLang.t('in_n_minutes', { n: wait }) }),
                next: first ? VBLang.t('school_has_not_started_yet') : '',
            };
        }
        return { title: VBLang.t('today_s_lessons_are_over'), line: '', next: nextDayLine() };
    }

    function renderNow() {
        const v = nowView();
        const box = $('#bb-now');
        const card = el('div', { class: 'bb-now' + (v.hue ? ' live' : '') },
            el('div', { class: 'bb-now-main' },
                v.label ? el('span', { class: 'bb-now-label', text: v.label }) : null,
                el('h2', { class: 'bb-now-title', text: v.title }),
                v.line ? el('p', { class: 'bb-now-line', text: v.line }) : null),
            v.progress !== undefined ? el('div', { class: 'bb-bell', role: 'progressbar', 'aria-label': VBLang.t('how_much_of_the_lesson_has'),
                'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(v.progress * 100) },
                el('span', { class: 'bb-bell-fill', style: `width:${Math.round(v.progress * 100)}%` }),
                el('span', { class: 'bb-bell-from', text: v.start }), el('span', { class: 'bb-bell-to', text: v.end })) : null,
            v.next ? el('p', { class: 'bb-next', text: v.next }) : null);
        if (v.hue) card.style.setProperty('--sub', v.hue);
        set(box, card);
    }

    /* ---------- announcements ---------- */

    function announcementDialog(a = null) {
        C.dialogForm(a ? VBLang.t('edit_the_announcement') : VBLang.t('new_announcement'), (f) => {
            f.append(
                el('label', { text: VBLang.t('title') }, el('input', { name: 'title', required: true, maxLength: 100, value: a ? a.title : '', placeholder: VBLang.t('e_g_tomorrow_we_get_out') })),
                el('label', { text: VBLang.t('text_optional') }, el('textarea', { name: 'body', rows: 5, maxLength: 2000, value: a ? a.body : '' })),
                el('label', { class: 'switch perm' }, el('input', { type: 'checkbox', name: 'pinned', checked: a ? a.pinned : false }), VBLang.t('keep_it_at_the_top')),
                a ? null : el('label', { class: 'switch perm' }, el('input', { type: 'checkbox', name: 'notify', checked: true }), VBLang.t('notify_everyone_with_a_notification')));
        }, async (f) => {
            const r = await board({ action: 'save_announcement', class_id: P().current.id, id: a ? a.id : 0, title: f.title.value, body: f.body.value,
                pinned: f.pinned.checked, notify: f.notify ? f.notify.checked : false });
            toast(a ? VBLang.t('announcement_saved') : (r.pushed ? VBLang.t('announcement_published_notified', { n: plural(r.pushed, VBLang.t('device'), VBLang.t('devices')) }) : VBLang.t('announcement_published')), 'ok');
            load();
        }, a ? VBLang.t('save') : VBLang.t('publish'));
    }

    function renderNotes() {
        const box = $('#bb-notes');
        const list = state.announcements;
        set(box,
            el('div', { class: 'bb-head' }, el('h3', { text: VBLang.t('announcements') }),
                state.can_post ? el('button', { type: 'button', class: 'ghost mini', text: VBLang.t('write_an_announcement'), onclick: () => announcementDialog() }) : null),
            list.length ? el('div', { class: 'bb-notes' }, ...list.map((a) => el('article', { class: 'bb-note' + (a.pinned ? ' pinned' : '') },
                el('div', { class: 'bb-note-top' }, el('h4', { text: a.title }),
                    a.can_edit ? C.menu([{ label: VBLang.t('edit'), onclick: () => announcementDialog(a) },
                        { label: VBLang.t('delete'), danger: true, onclick: async () => {
                            if (!confirm(VBLang.t('delete_this_announcement'))) return;
                            try { await board({ action: 'delete_announcement', id: a.id }); toast(VBLang.t('announcement_deleted'), 'ok'); load(); } catch (e) { toast(e.message, 'err'); }
                        } }]) : null),
                a.body ? el('p', { class: 'bb-note-body', text: a.body }) : null,
                el('p', { class: 'bb-note-foot' }, a.pinned ? el('span', { class: 'bb-pin', text: VBLang.t('pinned') }) : null,
                    el('span', { text: a.author || '?' }), el('span', { text: shortDate.format(new Date(a.created_at * 1000)) })))))
                : el('p', { class: 'bb-empty', text: state.can_post ? VBLang.t('no_announcements_write_here_the_things') : VBLang.t('no_announcements_for_now') }));
    }

    /* ---------- notes still missing: lessons already held with nothing uploaded (the class turns this on in the settings) ---------- */

    function renderMissing() {
        const box = $('#bb-missing');
        const list = state.missing || [];
        box.hidden = !list.length;
        if (!list.length) return;
        const c = P().current;
        set(box, el('div', { class: 'bb-head' }, el('h3', { text: VBLang.t('missing_notes') })),
            el('p', { class: 'muted small', text: VBLang.t('lessons_already_held_for_which_nobody') }),
            el('ul', { class: 'plain bb-miss' }, ...list.map((m) => el('li', {},
                el('span', { text: `${m.subject} · ${shortDate.format(C.parseDate(m.date))}` }),
                el('span', { class: 'row-actions' },
                    el('a', { class: 'ghost-link', href: `appunti-carica.php?class=${c.id}&date=${m.date}&subject=${m.subject_id}`, text: VBLang.t('upload') }),
                    state.can_skip ? C.menu([{ label: VBLang.t('not_needed_for_this_lesson'), onclick: async () => {
                        try { await board({ action: 'skip_missing', class_id: c.id, date: m.date, subject_id: m.subject_id }); load(); } catch (e) { toast(e.message, 'err'); }
                    } }]) : null)))));
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
        ov.homework.forEach((h) => put(h.due, { order: 3, subject_id: h.subject_id, label: VBLang.t('homework'), text: `${h.subject}: ${h.body}` }));
        ov.turns.forEach((t) => put(t.date, { order: 2, subject_id: t.subject_id, label: VBLang.t('oral_exam_2'), mine: t.user_ids.includes(meId),
            text: `${t.subject}: ${t.user_ids.map((id) => { const m = P().current.members.find((x) => x.id === id); return m ? m.name : '?'; }).join(', ') || VBLang.t('nobody')}` }));
        ov.days_off.forEach((o) => {
            for (let d = new Date(C.parseDate(o.from)); d <= C.parseDate(o.to) && d <= end; d.setDate(d.getDate() + 1)) {
                const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                put(iso, { order: 0, label: o.period ? VBLang.t('no_period', { n: o.period }) : VBLang.t('no_lessons'), text: o.reason || '', off: true });
            }
        });
        return [...rows.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, list]) => [date, list.sort((a, b) => a.order - b.order)]);
    }

    function renderWeek(events, ov) {
        const days = weekRows(events, ov);
        set($('#bb-week'),
            el('div', { class: 'bb-head' }, el('h3', { text: VBLang.t('this_week_2') }),
                el('button', { type: 'button', class: 'ghost mini', text: VBLang.t('open_the_calendar'), onclick: () => P().showTab('calendar') })),
            days.length ? el('div', { class: 'bb-diary' }, ...days.map(([date, list]) => {
                const d = C.parseDate(date);
                return el('section', { class: 'bb-day' + (date === state.today ? ' today' : '') },
                    el('div', { class: 'bb-day-gutter' }, el('b', { text: String(d.getDate()) }), el('span', { text: weekday.format(d) }),
                        date === state.today ? el('em', { text: VBLang.t('today') }) : null),
                    el('ul', { class: 'bb-rows' }, ...list.map((r) => {
                        const li = el('li', { class: 'bb-row' + (r.off ? ' off' : '') + (r.mine ? ' mine' : '') + (r.strong ? ' strong' : '') },
                            el('span', { class: 'bb-row-label', text: r.label }), el('span', { class: 'bb-row-text', text: r.text }));
                        if (r.subject_id) li.style.setProperty('--sub', P().hue(r.subject_id));
                        return li;
                    })));
            })) : el('p', { class: 'bb-empty', text: VBLang.t('nothing_in_the_calendar_for_the') }));
    }

    /* ---------- for you / to fix ---------- */

    function renderYou(review, ov) {
        const meId = P().me();
        const myTurns = ov.turns.filter((t) => t.user_ids.includes(meId) && t.date >= state.today && t.date <= weekEnd());
        const lines = [];
        if (review.due.length) {
            lines.push(el('div', { class: 'bb-you-row' },
                el('p', { text: VBLang.t('you_have_to_review_today', { n: plural(review.due.length, VBLang.t('question'), VBLang.t('questions')) }) }),
                el('button', { type: 'button', text: VBLang.t('start_the_review'), onclick: () => P().showTab('study') })));
        }
        myTurns.forEach((t) => lines.push(el('div', { class: 'bb-you-row' },
            el('p', { text: VBLang.t('you_have_an_oral_exam_in', { subject: t.subject, when: dayWord(t.date, state.today) }) }),
            el('a', { class: 'btn-link small', href: `appunti-archivio.php?class=${P().current.id}&subject=${t.subject_id}`, text: VBLang.t('open_the_subject') }))));
        set($('#bb-you'), lines.length ? el('h3', { text: VBLang.t('for_you') }) : null, ...lines);
        $('#bb-you').hidden = !lines.length;
    }
    const weekEnd = () => { const d = C.parseDate(state.today); d.setDate(d.getDate() + WEEK_DAYS); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

    /** "Da sistemare": topics the AI proposed, and what it found in the uploads (a doubtful type, subject or date; a test it heard about). Always the person decides. */
    function renderFix(ov) {
        const box = $('#bb-fix');
        const proposed = (P().current.perms || []).includes('topics') ? ov.topics.filter((t) => t.proposed) : [];
        const reports = state.reports || [];
        box.hidden = !proposed.length && !reports.length;
        if (box.hidden) return;
        const resolve = async (r, accept) => {
            try { await board({ action: 'resolve_report', id: r.id, accept }); toast(accept ? VBLang.t('done_2') : VBLang.t('left_as_it_is'), 'ok'); load(); } catch (e) { toast(e.message, 'err'); }
        };
        set(box, el('h3', { text: VBLang.t('to_fix') }),
            ...reports.map((r) => el('div', { class: 'bb-fix-row' },
                el('p', {}, el('b', { text: r.title }), el('br'), r.body),
                el('span', { class: 'row-actions' },
                    el('button', { type: 'button', class: 'mini', text: r.kind === 'proposta_verifica' ? VBLang.t('add_to_the_calendar') : VBLang.t('correct_as_suggested'), onclick: () => resolve(r, true) }),
                    el('button', { type: 'button', class: 'ghost mini', text: r.kind === 'proposta_verifica' ? VBLang.t('ignore') : VBLang.t('leave_as_it_is'), onclick: () => resolve(r, false) })))),
            ...proposed.map((t) => el('div', { class: 'bb-fix-row' },
                el('p', {}, el('b', { text: t.name }), VBLang.t('in_since_the_ai_thinks_it', { subject: t.subject, date: shortDate.format(C.parseDate(t.start)) })),
                el('span', { class: 'row-actions' },
                    el('button', { type: 'button', class: 'mini', text: VBLang.t('confirm'), onclick: async () => {
                        try { await cal({ action: 'confirm_topic', id: t.id }); toast(VBLang.t('topic_confirmed'), 'ok'); load(); } catch (e) { toast(e.message, 'err'); }
                    } }),
                    el('button', { type: 'button', class: 'ghost mini', text: VBLang.t('review_in_the_calendar'), onclick: () => P().showTab('calendar') })))));
    }

    /* ---------- load ---------- */

    async function load() {
        const c = P().current;
        if (!c) return;
        clearInterval(timer);
        try {
            const [bb, ev, ov, rv] = await Promise.all([
                getJson(`../api/bacheca.php?action=overview&class_id=${c.id}`),
                getJson(`../api/appunti.php?action=events&class_id=${c.id}`),
                getJson(`../api/calendario.php?action=overview&class_id=${c.id}`),
                getJson(`../api/appunti.php?action=review&class_id=${c.id}`).catch(() => ({ due: [], later: 0 })),
            ]);
            state = bb;
            const [h, m, s] = bb.now.split(':').map(Number);
            clock = { base: h * 3600 + m * 60 + s, at: performance.now() };
            renderNow();
            renderNotes();
            renderMissing();
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
