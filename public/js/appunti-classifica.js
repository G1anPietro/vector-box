// public/js/appunti-classifica.js — the "Classifica" tab: my points, the weekly and total tables, joining or leaving.
// Points are given by the server (api/classifica.php, quiz_answer / review_answer).
(() => {
    'use strict';
    const C = window.AppuntiCommon;
    const { el, getJson, toast } = C;
    let view = 'week';
    let all = false;
    let data = null;

    const P = () => window.AppuntiPage;
    const join = async (on) => {
        if (!on && !confirm(VBLang.t('if_you_leave_the_leaderboard_your'))) return;
        try { await C.post('../api/classifica.php', { action: 'set_in', class_id: P().current.id, in: on }); load(); } catch (e) { toast(e.message, 'err'); }
    };

    function draw() {
        const box = document.querySelector('#sc-box');
        const sc = data;
        if (!sc || sc.on === false) {
            box.replaceChildren(el('div', { class: 'card' }, el('h2', { text: VBLang.t('leaderboard') }),
                el('p', { class: 'muted', text: VBLang.t('the_leaderboard_is_off_for_this') + (sc && sc.can_manage ? VBLang.t('you_can_turn_it_back_on') : '') })));
            return;
        }
        const mine = sc.mine || {};
        const head = el('div', { class: 'card sc-mine' },
            sc.in
                ? el('div', {}, el('b', { class: 'sc-big', text: String(mine.week || 0) }), VBLang.t('points_this_week'), el('br'),
                    el('span', { class: 'muted small', text: VBLang.t('in_total', { n: mine.total || 0 }) + (mine.rank_week ? VBLang.t('of_this_week', { rank: mine.rank_week, total: mine.count }) : '') }))
                : el('p', { class: 'muted', text: VBLang.t('you_are_not_in_the_leaderboard') }),
            el('button', { type: 'button', class: 'ghost mini', text: sc.in ? VBLang.t('leave_the_leaderboard') : VBLang.t('join'), onclick: () => join(!sc.in) }));
        const parts = [head];
        if (sc.in && !sc.can_see) {
            parts.push(el('p', { class: 'muted', text: VBLang.t('only_people_with_permission_can_see') }));
        } else if (sc.in) {
            const rows = view === 'week' ? sc.week : sc.total;
            const shown = all ? rows : rows.slice(0, 10).concat(rows.slice(10).filter((r) => r.me));
            parts.push(el('div', { class: 'card' },
                el('div', { class: 'bb-head' }, el('h2', { text: VBLang.t('leaderboard') }),
                    el('span', { class: 'bb-seg' }, ...[['week', VBLang.t('this_week')], ['total', VBLang.t('all_time')]].map(([k, t]) =>
                        el('button', { type: 'button', class: 'ghost mini', 'aria-pressed': String(view === k), text: t, onclick: () => { view = k; draw(); } })))),
                rows.length ? el('ol', { class: 'bb-score' }, ...shown.map((r) => el('li', { class: r.me ? 'me' : '' },
                    el('span', { class: 'rk', text: String(rows.indexOf(r) + 1) }), el('span', { class: 'nm', text: r.name + (r.me ? ' (tu)' : '') }), el('b', { text: String(r.points) }))))
                    : el('p', { class: 'muted', text: VBLang.t('nobody_yet') }),
                rows.length > 10 ? el('button', { type: 'button', class: 'ghost mini', text: all ? VBLang.t('show_less') : VBLang.t('show_all'), onclick: () => { all = !all; draw(); } }) : null));
        }
        parts.push(el('div', { class: 'card' }, el('h3', { text: VBLang.t('how_points_are_earned') }),
            el('ul', { class: 'plain sc-how' },
                el('li', { text: VBLang.t('10_points_for_every_right_answer') }),
                el('li', { text: VBLang.t('5_points_for_every_right_question') }),
                el('li', { text: VBLang.t('redoing_a_quiz_is_just_practice') }),
                el('li', { text: VBLang.t('at_most_250_points_a_day') })),
            el('a', { href: 'appunti-impostazioni.php?class=' + P().current.id, text: VBLang.t('leaderboard_settings') })));
        box.replaceChildren(...parts);
    }

    async function load() {
        const c = P().current;
        if (!c) return;
        try { data = await getJson(`../api/classifica.php?action=board&class_id=${c.id}`); } catch (e) { data = null; toast(e.message, 'err'); }
        draw();
    }

    window.AppuntiScore = { load };
})();
