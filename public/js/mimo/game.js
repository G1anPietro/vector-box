// public/js/mimo/game.js
// "Mimo" screens. Runs inside public/js/spia/app.js (rooms, phones, settings, help, render loop); this file draws the match.
// Teams take turns on a theatre stage: one mime of the team on stage sees a word on their own phone and makes the team guess it with
// gestures. The word is sent by the server ONLY to the phone of the mime. The time is kept by the SERVER: the page shows a countdown
// computed from the seconds-left value of the last state and, when it reaches zero, asks the server (which closes the turn).
window.MimoGame = (() => {
    'use strict';
    let C = null;

    const G = () => C.state.mimo;
    const t = (k, v) => C.t(k, v);
    const h = (...a) => C.h(...a);
    const name = (id) => C.pname(id) || '?';
    const mine = () => C.myPlayers().map((p) => p.id);
    const isMine = (pid) => mine().includes(pid);
    const isHost = () => !!C.state.is_host;
    const lang = () => (window.SpiaApp && window.SpiaApp.lang) || 'en';
    const L = () => (['it', 'en', 'es', 'fr', 'de'].includes(lang()) ? lang() : 'en');
    const MARKS = ['★', '●', '▲'];
    const LOUD = ['timeup', 'go', 'end'];
    const NS = 'http://www.w3.org/2000/svg';

    /** Per match UI state: last event seen, flash, phone passed to the mime, clock. */
    function ui() {
        const g = G();
        if (!C.ui.mm || C.ui.mm.match !== g.match) C.ui.mm = { match: g.match, lastEvent: 0, flash: [], flashUntil: 0, passedTurn: -1, busy: false, timer: null, ref: null, end: 0, asked: 0 };
        return C.ui.mm;
    }

    const teamName = (i) => t('mm_team_n', { n: i + 1 });
    const mark = (i) => h('span', { class: 'mm-mark mm-t' + i, 'aria-hidden': 'true' }, MARKS[i] || '●');

    /** The clock: counts down from the seconds left that the server sent, then asks the server what happened. */
    function keepClock(on) {
        const u = ui();
        if (!on) { clearInterval(u.timer); u.timer = null; return; }
        if (u.timer) return;
        u.timer = setInterval(() => {
            const g = window.SpiaApp && window.SpiaApp.state && window.SpiaApp.state.mimo;
            if (!g || g.phase !== 'play') { keepClock(false); return; }
            const rem = (u.end - Date.now()) / 1000;
            document.querySelectorAll('.mm-time').forEach((n) => { n.textContent = String(Math.max(0, Math.ceil(rem))); });
            document.querySelectorAll('.mm-bar > i').forEach((n) => { n.style.width = Math.max(0, Math.min(100, rem / g.secs * 100)) + '%'; });
            if (rem <= 0 && Date.now() - u.asked > 900 && !document.hidden) { u.asked = Date.now(); window.SpiaApp.refresh(); }
        }, 250);
    }

    function evText(e) {
        const p = e.p ? name(e.p) : '';
        switch (e.t) {
            case 'start': return t('mm_ev_start');
            case 'turn': return t('mm_ev_turn', { t: e.turn + 1, p, n: e.team + 1 });
            case 'go': return t('mm_ev_go', { p });
            case 'timeup': return t('mm_ev_timeup', { n: e.team + 1, s: e.n });
            case 'left': return t('mm_ev_left', { p });
            case 'end': return t('mm_ev_end');
            default: return '';
        }
    }

    function announce() {
        const u = ui();
        const evs = G().events;
        const loud = evs.filter((e) => e.id > u.lastEvent && LOUD.includes(e.t));
        if (u.lastEvent && loud.length) {
            if (loud.some((e) => e.t === 'timeup')) C.vibrate([200, 80, 200]);
            u.flash = loud.filter((e) => e.t !== 'go').slice(-2);
            u.flashUntil = Date.now() + 4000;
            setTimeout(() => C.scheduleRender(), 4100);
        }
        if (evs.length) u.lastEvent = evs[evs.length - 1].id;
        return Date.now() < u.flashUntil ? u.flash : [];
    }

    /** The scoreboard: one card per team, the team on stage is marked. */
    function board() {
        const g = G();
        const ids = Array.from({ length: g.teams }, (_, i) => i);
        return h('ul', { class: 'mm-board', 'aria-label': t('mm_teams_title') }, ids.map((i) => {
            const members = g.order.filter((p) => g.team_of[p] === i && C.playerById(p));
            const on = g.team === i;
            return h('li', { class: 'mm-teamcard mm-t' + i + (on ? ' on' : '') + (g.me.some((m) => m.team === i) ? ' mine' : ''), 'aria-current': on ? 'true' : null },
                h('div', { class: 'mm-teamhead' }, mark(i), h('span', { class: 'mm-teamname' }, teamName(i)), h('span', { class: 'mm-pts' }, h('span', { 'aria-hidden': 'true' }, String(g.score[i])), h('span', { class: 'sr-only' }, t('mm_score_n', { n: g.score[i] })))),
                h('div', { class: 'mm-members' }, members.map((p) => h('span', { class: 'mm-member' + (g.mime === p ? ' star' : '') + (g.gone.includes(p) ? ' gone' : '') }, name(p)))));
        }));
    }

    /** The mime on stage as SVG: a figure in a spotlight; only a constant CSS animation moves it. */
    function stageArt() {
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 200 220');
        svg.setAttribute('class', 'mm-art');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        const add = (parent, tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent.appendChild(e); return e; };
        add(svg, 'polygon', { class: 'mm-beam', points: '82,0 118,0 190,214 10,214' });
        add(svg, 'ellipse', { class: 'mm-pool', cx: '100', cy: '208', rx: '86', ry: '10' });
        const fig = add(svg, 'g', { class: 'mm-fig' });
        add(fig, 'circle', { class: 'mm-head', cx: '100', cy: '56', r: '20' });
        add(fig, 'path', { class: 'mm-hat', d: 'M78 46 H122 M86 46 V30 H114 V46' });
        add(fig, 'path', { class: 'mm-body', d: 'M84 84 H116 L122 150 H78 Z' });
        add(fig, 'path', { class: 'mm-leg', d: 'M90 150 L82 204 M110 150 L118 204' });
        const al = add(fig, 'g', { class: 'mm-arm mm-arm-l' });
        add(al, 'path', { class: 'mm-limb', d: 'M86 90 L52 120 L38 96' });
        const ar = add(fig, 'g', { class: 'mm-arm mm-arm-r' });
        add(ar, 'path', { class: 'mm-limb', d: 'M114 90 L148 120 L162 96' });
        return svg;
    }

    function clock(g) {
        const u = ui();
        if (u.ref !== g) { u.ref = g; u.end = Date.now() + (g.left || 0) * 1000; }
        keepClock(true);
        const rem = Math.max(0, Math.ceil((u.end - Date.now()) / 1000));
        return h('div', { class: 'mm-clock', role: 'timer', 'aria-label': t('mm_time_left', { n: g.secs }) },
            h('span', { class: 'mm-time' }, String(rem)), h('span', { class: 'mm-s', 'aria-hidden': 'true' }, 's'),
            h('span', { class: 'mm-bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.min(100, rem / g.secs * 100) + '%' })));
    }

    function lastCard() {
        const g = G();
        const l = g.last;
        if (!l) return null;
        return h('section', { class: 'mm-last mm-t' + l.team },
            h('h3', null, t('mm_last_title')),
            h('p', { class: 'mm-last-n' }, mark(l.team), ' ', t('mm_last_n', { n: l.team + 1, s: l.n, k: l.skipped })),
            l.words.length ? h('ul', { class: 'mm-words' }, l.words.map((w) => h('li', { lang: L() }, w[L()] || w.en))) : null);
    }

    function readyView() {
        const g = G(), u = ui();
        keepClock(false);
        const mime = g.mime;
        const mineNow = isMine(mime);
        const parts = [h('h2', { class: 'sr-only' }, t('mm_round_n', { n: g.round, m: g.rounds })), stageArt()];
        if (mineNow && mine().length > 1 && u.passedTurn !== g.turn) {
            return C.passView(mime, t('mm_pass_to_mime'), () => { u.passedTurn = g.turn; C.scheduleRender(true); });
        }
        parts.push(h('p', { class: 'mm-who mm-t' + g.team, role: 'status' }, mark(g.team), ' ', t('mm_ready_for', { p: name(mime), n: g.team + 1 })));
        if (mineNow) {
            parts.push(h('p', { class: 'mm-hint' }, t('mm_ready_hint')),
                h('button', { class: 'mm-go', disabled: u.busy, onclick: async () => { if (u.busy) return; u.busy = true; C.vibrate(30); try { await C.run('go'); } finally { u.busy = false; } } },
                    t('mm_go')));
        } else {
            parts.push(h('p', { class: 'mm-hint' }, t('mm_ready_wait', { p: name(mime), n: g.team + 1 })));
        }
        return h('section', { class: 'mm-stage' }, parts);
    }

    function playView_() {
        const g = G(), u = ui();
        const parts = [h('h2', { class: 'sr-only' }, t('mm_round_n', { n: g.round, m: g.rounds })), clock(g)];
        if (g.word) {
            const pid = g.me.find((m) => m.mime);
            const w = g.word[L()] || g.word.en;
            const act = async (action) => { if (u.busy) return; u.busy = true; C.vibrate(action === 'guess' ? 30 : 12); try { await C.run(action, { player_id: pid.player_id }); } finally { u.busy = false; } };
            parts.push(
                h('div', { class: 'mm-card' }, h('span', { class: 'mm-lead' }, t('mm_word_lead')), h('span', { class: 'mm-word', lang: L() }, w)),
                h('p', { class: 'mm-hint' }, t('mm_no_talk')),
                h('button', { class: 'mm-ok', disabled: u.busy, onclick: () => act('guess') }, t('mm_guessed')),
                h('button', { class: 'mm-skip', disabled: u.busy || g.passes_left <= 0, onclick: () => act('skip') }, t('mm_pass'), h('span', { class: 'mm-skip-n' }, t('mm_passes_left', { n: g.passes_left }))),
                h('p', { class: 'mm-got' }, t('mm_got_n', { n: g.got })));
        } else {
            parts.push(stageArt(),
                h('p', { class: 'mm-who mm-t' + g.team, role: 'status' }, mark(g.team), ' ', t('mm_miming', { p: name(g.mime) })),
                h('p', { class: 'mm-hint' }, g.me.some((m) => m.team === g.team) ? t('mm_guess_now', { n: g.team + 1 }) : t('mm_other_team', { n: g.team + 1 })));
        }
        return h('section', { class: 'mm-stage playing' }, parts);
    }

    function feed() {
        const evs = G().events.slice(-8).reverse();
        return h('ol', { class: 'mm-feed' }, evs.map((e) => h('li', { class: LOUD.includes(e.t) ? 'loud' : '' }, evText(e))));
    }

    function hostPanel() {
        if (!isHost()) return null;
        const g = G();
        return h('details', { class: 'panel mm-host' },
            h('summary', null, t('mm_host_tools')),
            h('p', { class: 'small muted' }, t('mm_host_note')),
            g.phase === 'ready' && !isMine(g.mime) ? h('button', { class: 'btn ghost', onclick: () => C.run('go') }, t('mm_go_for', { p: name(g.mime) })) : null,
            g.phase === 'ready' ? h('button', { class: 'btn ghost', onclick: () => C.run('next') }, t('mm_skip_turn')) : null,
            h('button', { class: 'btn ghost', onclick: () => C.askConfirm(t('mm_end_q'), t('mm_end'), () => C.run('end'), true) }, t('mm_end')));
    }

    function playView() {
        const g = G();
        const flash = announce();
        const shell = g.phase === 'play' ? playView_() : readyView();
        if (g.phase !== 'play') keepClock(false);
        return h('div', { class: 'stack mm' + (g.phase === 'play' ? ' on-air' : '') },
            !C.netOk ? h('div', { class: 'banner warn' }, t('connection_lost')) : null,
            flash.length ? h('div', { class: 'mm-flash', role: 'status' }, flash.map((e) => h('div', null, evText(e)))) : null,
            h('div', { class: 'mm-curtain' }, h('span', null, t('mm_round_n', { n: g.round, m: g.rounds }))),
            board(), shell,
            g.phase === 'ready' ? lastCard() : null,
            C.section(t('mm_feed_title'), feed()),
            hostPanel());
    }

    function resultCard() {
        const g = G();
        keepClock(false);
        const res = g.result || { reason: 'host_ended', rows: [], winner: null };
        return h('section', { class: 'panel result mm-result' },
            h('div', { class: 'stamp result-stamp' }, res.winner !== null ? t('mm_winner', { n: res.winner + 1 }) : (res.reason === 'done' ? t('mm_tie') : t('mm_standings'))),
            h('div', { class: 'muted' }, t('mm_reason_' + res.reason)),
            h('ol', { class: 'mm-standings' }, res.rows.map((r) => h('li', { class: 'mm-stand mm-t' + r.team + (res.winner === r.team ? ' win' : '') },
                h('span', { class: 'mm-stand-main' }, mark(r.team), h('b', null, teamName(r.team)), h('span', { class: 'mm-stand-names' }, r.players.filter((p) => C.playerById(p)).map(name).join(', '))),
                h('span', { class: 'mm-stand-n' }, t('mm_score_n', { n: r.score }))))));
    }

    function summary() {
        const s = C.state.settings;
        const chips = [t('mm_sum_teams', { n: s.teams }), t('mm_sum_rounds', { n: s.rounds }), t('mm_sum_secs', { n: s.secs }), t('mm_cat_' + s.cat), t('mm_level_' + s.level)];
        return h('div', { class: 'chips' }, chips.map((c) => h('span', { class: 'chip soft' }, c)));
    }

    function settings(s, { set, host }) {
        const choice = (key, values, label, text) => h('div', { class: 'mm-choices', role: 'group', 'aria-label': label }, values.map((v) => h('button', {
            class: 'btn small' + (s[key] === v ? ' primary' : ' ghost'), disabled: !host, 'aria-pressed': String(s[key] === v), onclick: () => set({ [key]: v }),
        }, text(v))));
        const row = (title, desc, ctrl) => h('div', { class: 'set-row' }, h('div', { class: 'set-text' }, h('span', { class: 'set-title' }, title), h('span', { class: 'set-desc' }, desc)), ctrl);
        const out = [
            row(t('mm_set_teams'), t('mm_set_teams_d'), choice('teams', [2, 3], t('mm_set_teams'), String)),
            row(t('mm_set_rounds'), t('mm_set_rounds_d'), choice('rounds', [2, 3, 5], t('mm_set_rounds'), String)),
            row(t('mm_set_secs'), t('mm_set_secs_d'), choice('secs', [30, 60, 90], t('mm_set_secs'), (v) => t('mm_seconds_n', { n: v }))),
            row(t('mm_set_cat'), t('mm_set_cat_d'), choice('cat', ['film', 'animals', 'actions', 'jobs', 'sports', 'mix'], t('mm_set_cat'), (v) => t('mm_cat_' + v))),
            row(t('mm_set_level'), t('mm_set_level_d'), choice('level', ['easy', 'hard', 'mix'], t('mm_set_level'), (v) => t('mm_level_' + v))),
            row(t('mm_set_assign'), t('mm_set_assign_d'), choice('assign', ['random', 'host'], t('mm_set_assign'), (v) => t('mm_assign_' + v))),
        ];
        if (s.assign === 'host') {
            const map = (C.state.settings && C.state.settings.map) || {};
            out.push(h('div', { class: 'set-row mm-place' }, h('span', { class: 'set-title' }, t('mm_place_title')),
                C.state.players.map((p) => h('div', { class: 'mm-place-row', role: 'group', 'aria-label': t('mm_place_group', { p: p.name }) }, h('span', { class: 'mm-place-name' }, p.name),
                    Array.from({ length: s.teams }, (_, i) => h('button', {
                        class: 'btn small' + (map[p.id] === i ? ' primary' : ' ghost'), disabled: !host, 'aria-pressed': String(map[p.id] === i),
                        onclick: () => C.run('team', { player_id: p.id, team: i }),
                    }, MARKS[i] + ' ' + teamName(i)))))));
        }
        return out;
    }

    return {
        init(core) { C = core; return { playView, resultCard, summary, settings }; },
    };
})();
