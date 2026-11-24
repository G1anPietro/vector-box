// public/js/proibita/game.js
// "Forbidden word" screens. Runs inside public/js/spia/app.js (rooms, phones, settings, help, render loop); this file draws the match.
// Two teams (red and white). In a turn one player gives clues about a secret word without saying it or the 5 forbidden words; his team
// guesses out loud; a player of the OTHER team (the guardian) presses BUZZ when he hears a forbidden word. The card and the clock
// belong to the SERVER: the page only draws what it is sent (the end time arrives with the state, the cards only reach the clue-giver's
// and the guardian's phones). One shared phone: the phone goes to the clue-giver, the guardian taps the big BUZZ button on the same screen.
window.ProibitaGame = (() => {
    'use strict';
    let C = null;

    const G = () => C.state.proibita;
    const t = (k, v) => C.t(k, v);
    const h = (...a) => C.h(...a);
    const name = (id) => C.pname(id) || '?';
    const mine = () => C.myPlayers().map((p) => p.id);
    const isHost = () => !!C.state.is_host;
    const lang = () => (window.SpiaApp && window.SpiaApp.lang) || 'en';
    const L = () => (['it', 'en', 'es', 'fr', 'de'].includes(lang()) ? lang() : 'en');
    const teamName = (k) => t(k === 'A' ? 'pb_team_a' : 'pb_team_b');
    const LOUD = ['ok', 'buzz', 'skip', 'time', 'left', 'end'];

    /** Per match UI state: last event seen, flash, the clock, the fast refresh timer, who already took the phone for this turn. */
    function ui() {
        const g = G();
        if (!C.ui.pb || C.ui.pb.match !== g.match) {
            if (C.ui.pb) { clearInterval(C.ui.pb.poll); clearInterval(C.ui.pb.clock); }
            C.ui.pb = { match: g.match, lastEvent: 0, flash: [], flashUntil: 0, poll: null, clock: null, src: null, deadline: 0, fired: '', busy: false, passed: '' };
        }
        return C.ui.pb;
    }

    /** While a turn runs ask the server for news every second (a BUZZ pressed on another phone must show up at once). */
    function keepPolling(on) {
        const u = ui();
        if (!on) { clearInterval(u.poll); u.poll = null; clearInterval(u.clock); u.clock = null; return; }
        if (!u.poll) {
            u.poll = setInterval(() => {
                const b = window.SpiaApp && window.SpiaApp.state && window.SpiaApp.state.proibita;
                if (!b || b.phase !== 'play') { keepPolling(false); return; }
                if (!document.hidden) window.SpiaApp.refresh();
            }, 1000);
        }
        if (!u.clock) u.clock = setInterval(drawClock, 250);
    }

    /** The remaining time is counted from the end the server sent (the phone's own clock is only used for the difference since the message arrived). */
    function secondsLeft() {
        const g = G(), u = ui();
        if (u.src !== g) { u.src = g; u.deadline = Date.now() + (g.left || 0) * 1000; }
        return Math.max(0, Math.ceil((u.deadline - Date.now()) / 1000));
    }

    function drawClock() {
        const g = G();
        if (!g || g.phase !== 'play') return;
        const n = secondsLeft();
        const el = document.querySelector('.pb-clock-n');
        if (el) el.textContent = String(n);
        const bar = document.querySelector('.pb-bar-fill');
        if (bar) bar.style.width = Math.min(100, (n / g.rules.time) * 100) + '%';
        const u = ui();
        const key = `${g.match}:${g.turn}`;
        if (n <= 0 && u.fired !== key) { u.fired = key; window.SpiaApp.refresh(); }   // the server closes the turn: ask for it
    }

    function evText(e) {
        const p = e.p ? name(e.p) : '';
        switch (e.t) {
            case 'start': return t('pb_ev_start');
            case 'turn': return t('pb_ev_turn', { team: teamName(e.team), p, q: name(e.q) });
            case 'begin': return t('pb_ev_begin');
            case 'ok': return t('pb_ev_ok', { p });
            case 'skip': return t('pb_ev_skip', { p });
            case 'buzz': return t('pb_ev_buzz', { p });
            case 'time': return t('pb_ev_time', { team: teamName(e.team), n: e.n });
            case 'left': return t('pb_ev_left', { p });
            case 'end': return t('pb_ev_end');
            default: return '';
        }
    }

    function announce() {
        const u = ui();
        const evs = G().events;
        const loud = evs.filter((e) => e.id > u.lastEvent && LOUD.includes(e.t));
        if (u.lastEvent && loud.length) {
            if (loud.some((e) => e.t === 'buzz')) C.vibrate([250, 80, 250]);
            else if (loud.some((e) => e.t === 'time')) C.vibrate([120, 60, 400]);
            u.flash = loud.slice(-2);
            u.flashUntil = Date.now() + 3500;
            setTimeout(() => C.scheduleRender(), 3600);
        }
        if (evs.length) u.lastEvent = evs[evs.length - 1].id;
        return Date.now() < u.flashUntil ? u.flash : [];
    }

    const roles = () => {
        const me = G().me;
        return { giver: me.find((m) => m.giver) || null, guardian: me.find((m) => m.guardian) || null };
    };

    /** The two team scores: the team on the field has a thick frame and a whistle mark. */
    function scoreboard() {
        const g = G();
        return h('div', { class: 'pb-board', role: 'group', 'aria-label': t('pb_score') }, ['A', 'B'].map((k) => h('div', { class: `pb-team ${k.toLowerCase()}` + (g.team === k && g.status === 'play' ? ' on' : '') },
            h('span', { class: 'pb-team-name' }, teamName(k)),
            h('span', { class: 'pb-team-n' }, String(g.score[k])),
            g.team === k && g.status === 'play' ? h('span', { class: 'pb-team-mark' }, t('pb_playing')) : null)));
    }

    function teamsList() {
        const g = G();
        return h('ul', { class: 'pb-roster' }, ['A', 'B'].map((k) => h('li', { class: 'pb-roster-row ' + k.toLowerCase() },
            h('b', null, teamName(k)),
            h('span', null, g.teams[k].filter((id) => C.playerById(id) && !g.gone.includes(id)).map((id) => name(id) + (mine().includes(id) ? ' ' + t('pb_you_mark') : '')).join(', ')))));
    }

    function cardEl(c) {
        const row = c.text[L()] || c.text.en;
        return h('div', { class: 'pb-card' },
            h('div', { class: 'pb-card-top' }, h('span', { class: 'pb-lead' }, t('pb_word_lead')), h('span', { class: 'pb-word', lang: L() }, row[0])),
            h('div', { class: 'pb-card-bad' },
                h('span', { class: 'pb-lead red' }, t('pb_taboo_lead')),
                h('ul', { class: 'pb-taboo', lang: L() }, row.slice(1).map((w) => h('li', null, h('span', { class: 'pb-x', 'aria-hidden': 'true' }, '✕'), h('s', null, w), h('span', { class: 'sr-only' }, ' ' + t('pb_forbidden_sr')))))));
    }

    async function act(action, extra) {
        const u = ui();
        if (u.busy) return;
        u.busy = true;
        C.vibrate(25);
        try { await C.run(action, extra); } finally { u.busy = false; }
    }

    function readyView() {
        const g = G(), u = ui();
        const r = roles();
        const key = `${g.match}:${g.turn}`;
        const head = h('div', { class: 'pb-whistle' },
            h('span', { class: 'pb-lead' }, t('pb_team_turn')),
            h('span', { class: 'pb-whistle-team ' + g.team.toLowerCase() }, teamName(g.team)));
        const who = h('ul', { class: 'pb-roles' },
            h('li', null, h('span', { class: 'pb-role-k' }, t('pb_giver')), h('b', null, name(g.giver))),
            h('li', null, h('span', { class: 'pb-role-k' }, t('pb_guardian')), h('b', null, name(g.guardian))));
        if (r.giver) {
            if (C.myPlayers().length > 1 && u.passed !== key) {
                return C.passView(g.giver, t('pass_phone_to'), () => { u.passed = key; C.scheduleRender(true); });
            }
            return h('section', { class: 'pb-round' }, head, who, h('p', { class: 'pb-msg' }, t('pb_ready_giver', { n: g.rules.time })),
                h('div', { class: 'bottom-bar' }, h('button', { class: 'pb-go', onclick: () => act('begin', { player_id: g.giver }) }, t('pb_begin'))));
        }
        return h('section', { class: 'pb-round' }, head, who,
            h('p', { class: 'pb-msg' }, r.guardian ? t('pb_ready_guardian') : t('pb_ready_wait', { p: name(g.giver) })));
    }

    function playBody() {
        const g = G();
        const r = roles();
        keepPolling(true);
        const n = secondsLeft();
        const clock = h('div', { class: 'pb-clock', role: 'timer', 'aria-label': t('pb_time_left') },
            h('span', { class: 'pb-clock-n' }, String(n)), h('span', { class: 'pb-clock-s' }, t('pb_seconds_short')),
            h('span', { class: 'pb-bar', 'aria-hidden': 'true' }, h('span', { class: 'pb-bar-fill', style: `width:${Math.min(100, (n / g.rules.time) * 100)}%` })));
        const parts = [clock];
        if (g.card) parts.push(cardEl(g.card));
        else {
            const onField = C.myPlayers().some((p) => g.teams[g.team].includes(p.id));
            parts.push(h('p', { class: 'pb-msg big' }, onField ? t('pb_guess_msg', { p: name(g.giver) }) : t('pb_watch_msg', { team: teamName(g.team), q: name(g.guardian) })));
        }
        const bar = [];
        if (r.giver) {
            bar.push(h('div', { class: 'pb-row2' },
                h('button', { class: 'pb-ok', onclick: () => act('right', { player_id: g.giver, n: g.card_n }) }, h('span', { class: 'pb-btn-big' }, t('pb_got')), h('span', { class: 'pb-btn-sub' }, '+1')),
                h('button', { class: 'pb-skip', disabled: g.skips_left < 1, onclick: () => act('skip', { player_id: g.giver, n: g.card_n }) }, h('span', { class: 'pb-btn-big' }, t('pb_skip')), h('span', { class: 'pb-btn-sub' }, t('pb_skips_n', { n: g.skips_left })))));
        }
        if (r.guardian) {
            bar.push(h('button', { class: 'pb-buzz', onclick: () => act('buzz', { player_id: g.guardian, n: g.card_n }) }, h('span', { class: 'pb-buzz-big' }, t('pb_buzz')), h('span', { class: 'pb-buzz-sub' }, t('pb_buzz_hint'))));
        }
        return h('section', { class: 'pb-round play' }, parts, bar.length ? h('div', { class: 'bottom-bar pb-actions' }, bar) : null);
    }

    function overView() {
        const g = G();
        keepPolling(false);
        const pts = g.turn_pts;
        const icon = { ok: '✓', buzz: '✕', skip: '→', time: '⏱' };
        return h('section', { class: 'pb-round over' },
            h('p', { class: 'pb-stop', role: 'status' }, t('pb_time_up')),
            h('p', { class: 'pb-verdict' }, t('pb_turn_pts', { team: teamName(g.team), n: (pts > 0 ? '+' : '') + pts })),
            g.log.length ? h('ol', { class: 'pb-log', 'aria-label': t('pb_log_title') }, g.log.map((l) => h('li', { class: 'pb-log-' + l.r },
                h('span', { class: 'pb-log-ic', 'aria-hidden': 'true' }, icon[l.r]),
                h('span', { class: 'pb-log-w', lang: L() }, l.word[L()] || l.word.en),
                h('span', { class: 'pb-log-r' }, t('pb_r_' + l.r))))) : h('p', { class: 'pb-msg' }, t('pb_log_empty')),
            h('p', { class: 'pb-next muted small' }, t('pb_next_in', { n: Math.ceil(g.next_left || 0) })),
            isHost() ? h('button', { class: 'btn ghost', onclick: () => C.run('next') }, t('pb_next')) : null);
    }

    function feed() {
        const evs = G().events.filter((e) => e.t !== 'begin').slice(-8).reverse();
        return h('ol', { class: 'pb-feed' }, evs.map((e) => h('li', { class: LOUD.includes(e.t) ? 'loud ev-' + e.t : 'ev-' + e.t }, evText(e))));
    }

    function hostPanel() {
        if (!isHost()) return null;
        const g = G();
        return h('details', { class: 'panel pb-host' },
            h('summary', null, t('pb_host_tools')),
            h('p', { class: 'small muted' }, t('pb_host_note')),
            g.phase === 'ready' ? h('button', { class: 'btn ghost', onclick: () => C.run('next') }, t('pb_skip_turn')) : null,
            h('button', { class: 'btn ghost', onclick: () => C.askConfirm(t('pb_end_q'), t('pb_end'), () => C.run('end'), true) }, t('pb_end')));
    }

    function playView() {
        const g = G();
        const flash = announce();
        const shell = g.phase === 'ready' ? readyView() : (g.phase === 'play' ? playBody() : overView());
        if (g.phase !== 'play') keepPolling(false);
        // the "pass the phone" screen takes the whole screen
        if (g.phase === 'ready' && shell.className === 'pass') return shell;
        return h('div', { class: 'stack pb' + (g.phase === 'play' ? ' playing' : '') },
            !C.netOk ? h('div', { class: 'banner warn' }, t('connection_lost')) : null,
            flash.length ? h('div', { class: 'pb-flash', role: 'status' }, flash.map((e) => h('div', null, evText(e)))) : null,
            h('div', { class: 'pb-top' }, h('span', null, t('pb_turn_n', { n: g.turn + 1, m: g.turns }))),
            scoreboard(), shell,
            g.phase === 'ready' ? C.section(t('pb_teams_title'), teamsList()) : null,
            C.section(t('pb_feed_title'), feed()),
            hostPanel());
    }

    function resultCard() {
        const g = G();
        keepPolling(false);
        const res = g.result || { reason: 'host_ended', rows: [], winner: null, score: g.score };
        return h('section', { class: 'panel result pb-result' },
            h('div', { class: 'stamp result-stamp' }, res.winner ? t('pb_winner', { team: teamName(res.winner) }) : t('pb_tie')),
            h('div', { class: 'pb-final' }, ['A', 'B'].map((k) => h('span', { class: `pb-final-n ${k.toLowerCase()}` + (res.winner === k ? ' win' : '') }, teamName(k) + ': ' + res.score[k]))),
            h('div', { class: 'muted' }, t('pb_reason_' + res.reason)),
            h('ol', { class: 'pb-standings' }, res.rows.filter((r) => C.playerById(r.p)).map((r) => h('li', { class: 'pb-stand ' + r.team.toLowerCase() },
                h('b', null, name(r.p)), h('span', { class: 'pb-stand-n' }, teamName(r.team) + ' · ' + t('pb_stand_n', { a: r.ok, b: r.buzz }))))));
    }

    function summary() {
        const s = C.state.settings;
        const chips = [t('pb_rounds_n', { n: s.rounds }), t('pb_seconds_n', { n: s.time }), t('pb_level_' + s.level)];
        return h('div', { class: 'chips' }, chips.map((c) => h('span', { class: 'chip soft' }, c)));
    }

    function settings(s, { set, host }) {
        const choice = (key, values, label, text) => h('div', { class: 'pb-choices', role: 'group', 'aria-label': label }, values.map((v) => h('button', {
            class: 'btn small' + (s[key] === v ? ' primary' : ' ghost'), disabled: !host, 'aria-pressed': String(s[key] === v), onclick: () => set({ [key]: v }),
        }, text(v))));
        const row = (title, desc, ctrl) => h('div', { class: 'set-row' }, h('div', { class: 'set-text' }, h('span', { class: 'set-title' }, title), h('span', { class: 'set-desc' }, desc)), ctrl);
        return [
            row(t('pb_set_rounds'), t('pb_set_rounds_d'), choice('rounds', [2, 3, 5], t('pb_set_rounds'), (v) => t('pb_rounds_n', { n: v }))),
            row(t('pb_set_time'), t('pb_set_time_d'), choice('time', [45, 60, 90], t('pb_set_time'), (v) => t('pb_seconds_n', { n: v }))),
            row(t('pb_set_level'), t('pb_set_level_d'), choice('level', ['easy', 'hard', 'mix'], t('pb_set_level'), (v) => t('pb_level_' + v))),
        ];
    }

    return {
        init(core) { C = core; return { playView, resultCard, summary, settings }; },
    };
})();
