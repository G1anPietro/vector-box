// public/js/bugiardo/game.js
// "Chi è il bugiardo" (Find the liar) screens. Runs inside public/js/spia/app.js (rooms, phones, settings, help, render loop).
// Everybody answers one secret question in private (the liar got a similar, different one: nothing on screen says who), the answers
// are shown without names in the order the server drew, then everybody votes. Names of players are always put in with textContent
// (h() does that); the server never sends the liar's identity or question to the other phones before the round is over.
window.BugiardoGame = (() => {
    'use strict';
    let C = null;

    const G = () => C.state.bugiardo;
    const t = (k, v) => C.t(k, v);
    const h = (...a) => C.h(...a);
    const name = (id) => C.pname(id) || '?';
    const mine = () => C.myPlayers().map((p) => p.id);
    const isMine = (pid) => mine().includes(pid);
    const isHost = () => !!C.state.is_host;
    const shared = () => mine().length > 1;
    const lang = () => (window.SpiaApp && window.SpiaApp.lang) || 'en';
    const LANGS = ['it', 'en', 'es', 'fr', 'de'];
    const L = () => (LANGS.includes(lang()) ? lang() : 'en');
    const tx = (a) => (Array.isArray(a) ? a[LANGS.indexOf(L())] : '') || '';
    const fmt = (type, v, opts) => (type === 'c' ? (opts && opts[v] ? tx(opts[v]) : '?') : String(v));
    const pts = (n) => t('lb_pts_n', { n });

    /** Per match UI state: what the player has picked or typed so far (kept while the screen is redrawn). */
    function ui() {
        const g = G();
        if (!C.ui.bg || C.ui.bg.match !== g.match) C.ui.bg = { match: g.match, key: '', pick: null, text: '', busy: false };
        return C.ui.bg;
    }

    /** The polygraph line across the top: only decoration (it moves unless the visitor asked for less motion). */
    function trace() {
        const NS = 'http://www.w3.org/2000/svg';
        const s = document.createElementNS(NS, 'svg');
        s.setAttribute('viewBox', '0 0 240 36');
        s.setAttribute('class', 'bg-trace');
        s.setAttribute('aria-hidden', 'true');
        s.setAttribute('preserveAspectRatio', 'none');
        const p = document.createElementNS(NS, 'path');
        p.setAttribute('d', 'M0 18H28l5-12 7 26 6-22 5 14 4-6H92l5-8 7 20 5-12H150l6-14 8 28 6-16 5 8H240');
        p.setAttribute('class', 'bg-trace-line');
        s.appendChild(p);
        return s;
    }

    /** The row of players: who has answered / voted, and the points. */
    function crowd() {
        const g = G();
        const doneList = g.phase === 'answer' ? g.answered : (g.phase === 'vote' ? g.voted : []);
        return h('ul', { class: 'bg-crowd', 'aria-label': t('lb_players') }, g.order.filter((id) => C.playerById(id)).map((id) => {
            const gone = !g.active.includes(id);
            const done = doneList.includes(id);
            return h('li', { class: 'bg-chip' + (gone ? ' gone' : '') + (isMine(id) ? ' me' : '') + (done ? ' done' : '') },
                h('span', { class: 'bg-chip-name' }, name(id)),
                h('span', { class: 'bg-chip-pts' }, pts(g.scores[id] || 0)),
                done ? h('span', { class: 'bg-chip-ok', 'aria-hidden': 'true' }, '✓') : null,
                done ? h('span', { class: 'sr-only' }, t(g.phase === 'vote' ? 'lb_voted_mark' : 'lb_answered_mark')) : null);
        }));
    }

    /** On a shared phone, first hand it to the right person. */
    function withPass(pid, title, draw) {
        if (shared() && C.ui.passed !== pid) {
            return C.passView(pid, title, () => { C.ui.passed = pid; ui().pick = null; C.scheduleRender(); });
        }
        return draw();
    }

    function questionBox(m) {
        return h('div', { class: 'bg-q' },
            h('div', { class: 'bg-q-lead' }, t('lb_your_q')),
            h('div', { class: 'bg-q-text', lang: L() }, tx(m.question)));
    }

    function answerView() {
        const g = G(), u = ui();
        const todo = g.me.filter((m) => m.alive && !m.answered);
        if (todo.length) {
            const m = todo[0], pid = m.player_id;
            return withPass(pid, t('pass_phone_to'), () => {
                const key = `${g.round}:${pid}`;
                if (u.key !== key) { u.key = key; u.pick = null; u.text = ''; }
                const ready = () => (g.qtype === 't' ? u.text.trim() !== '' : u.pick !== null);
                const send = async () => {
                    if (!ready() || u.busy) return;
                    u.busy = true; C.vibrate(25);
                    const value = g.qtype === 't' ? u.text.trim() : u.pick;
                    try { const r = await C.run('answer', { player_id: pid, value }); if (r) { C.ui.passed = null; u.key = ''; } } finally { u.busy = false; }
                };
                const choose = (i) => { C.vibrate(15); u.pick = i; C.scheduleRender(true); };
                const btn = h('button', { class: 'btn primary big', disabled: !ready() || u.busy, onclick: send }, t('lb_lock'));
                let ctl;
                if (g.qtype === 'n') {
                    ctl = h('div', { class: 'bg-scale', role: 'group', 'aria-label': t('lb_scale_hint') }, Array.from({ length: 11 }, (_, i) => h('button', {
                        class: 'bg-num' + (u.pick === i ? ' on' : ''), 'aria-pressed': String(u.pick === i), onclick: () => choose(i) }, String(i))));
                } else if (g.qtype === 'c') {
                    ctl = h('div', { class: 'bg-choices', role: 'group', 'aria-label': t('lb_choose_hint') }, g.opts.map((o, i) => h('button', {
                        class: 'bg-opt' + (u.pick === i ? ' on' : ''), 'aria-pressed': String(u.pick === i), lang: L(), onclick: () => choose(i) }, tx(o))));
                } else {
                    const input = h('input', { class: 'bg-input', type: 'text', maxlength: '40', autocomplete: 'off', spellcheck: 'false', 'aria-label': t('lb_type_hint'), value: u.text });
                    input.addEventListener('input', () => { u.text = input.value; btn.disabled = !ready() || u.busy; });
                    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
                    ctl = input;
                }
                return h('div', { class: 'stack' },
                    shared() ? h('p', { class: 'bg-who' }, t('lb_answering', { p: name(pid) })) : null,
                    questionBox(m),
                    h('p', { class: 'bg-hint' }, t(g.qtype === 'n' ? 'lb_scale_hint' : (g.qtype === 'c' ? 'lb_choose_hint' : 'lb_type_hint'))),
                    ctl, btn);
            });
        }
        return C.section(t('lb_answer_title', { n: g.round }),
            h('p', { class: 'bg-wait' }, g.me.some((m) => m.alive) ? t('lb_answer_wait', { n: g.answered.length, m: g.active.length }) : t('lb_gone')),
            isHost() && g.answered.length ? h('button', { class: 'btn ghost', onclick: () => C.run('next') }, t('lb_show_now')) : null);
    }

    /** The answers on the table: numbered, no names, in the server's random order. Texts go in with textContent only. */
    function answersList() {
        const g = G();
        return h('ol', { class: 'bg-answers', 'aria-label': t('lb_answers_title') }, g.shown.map((a, i) => h('li', { class: 'bg-ans' },
            h('span', { class: 'bg-ans-no', 'aria-hidden': 'true' }, '#' + (i + 1)),
            h('span', { class: 'bg-ans-val', lang: g.qtype === 'c' ? L() : null }, fmt(g.qtype, a.v, g.opts)))));
    }

    /** Re-read my own question (only when the phone is not shared: otherwise the others would see it). */
    function myQuestion() {
        const m = !shared() && G().me.find((x) => x.alive && x.question);
        return m ? h('details', { class: 'bg-mine' }, h('summary', null, t('lb_my_q')), h('p', { class: 'bg-q-text small', lang: L() }, tx(m.question))) : null;
    }

    function showView() {
        const g = G();
        return C.section(t('lb_answers_title'), answersList(), h('p', { class: 'bg-hint' }, t('lb_answers_hint')), myQuestion(),
            isHost() ? h('button', { class: 'btn primary big', onclick: () => C.run('next') }, t('lb_to_vote')) : h('p', { class: 'bg-wait' }, t('lb_talk_wait')));
    }

    function voteView() {
        const g = G(), u = ui();
        const todo = g.me.filter((m) => m.alive && !m.voted);
        if (todo.length) {
            const pid = todo[0].player_id;
            return withPass(pid, t('lb_pass_vote'), () => {
                const key = `${g.round}:v:${pid}`;
                if (u.key !== key) { u.key = key; u.pick = null; }
                const targets = g.active.filter((id) => id !== pid && C.playerById(id));
                return C.section(t('lb_vote_title', { n: g.round }), answersList(),
                    shared() ? h('p', { class: 'bg-who' }, t('lb_voting', { p: name(pid) })) : null,
                    h('p', { class: 'bg-hint' }, t('lb_vote_hint')),
                    h('div', { class: 'bg-choices', role: 'group', 'aria-label': t('lb_vote_hint') }, targets.map((id) => h('button', {
                        class: 'bg-opt' + (u.pick === id ? ' on' : ''), 'aria-pressed': String(u.pick === id),
                        onclick: () => { C.vibrate(15); u.pick = id; C.scheduleRender(true); } }, name(id)))),
                    h('button', {
                        class: 'btn primary big', disabled: u.pick === null || u.busy,
                        onclick: async () => {
                            const target = u.pick;
                            if (target === null || u.busy) return;
                            u.busy = true; C.vibrate(25); C.ui.passed = null; u.pick = null; u.key = '';
                            try { await C.run('vote', { player_id: pid, target }); } finally { u.busy = false; }
                        } }, t('lb_lock')));
            });
        }
        return C.section(t('lb_vote_title', { n: g.round }), answersList(),
            h('p', { class: 'bg-wait' }, g.me.some((m) => m.alive) ? t('lb_vote_wait', { n: g.voted.length, m: g.active.length }) : t('lb_gone')),
            myQuestion(),
            isHost() && g.voted.length ? h('button', { class: 'btn ghost', onclick: () => C.run('next') }, t('lb_count_now')) : null);
    }

    function guessView() {
        const g = G(), u = ui();
        const m = g.me.find((x) => x.guesser);
        const skip = isHost() ? h('button', { class: 'btn ghost', onclick: () => C.run('next') }, t('lb_guess_skip')) : null;
        if (!m) return C.section(t('lb_guess_title'), h('p', { class: 'bg-wait' }, t('lb_guess_wait')), skip);
        const pid = m.player_id;
        return withPass(pid, t('pass_phone_to'), () => C.section(t('lb_guess_title'),
            h('p', { class: 'bg-hint' }, t('lb_guess_p', { p: name(pid) })),
            h('div', { class: 'bg-choices', role: 'group', 'aria-label': t('lb_guess_p', { p: name(pid) }) }, m.options.map((o, i) => h('button', {
                class: 'bg-opt' + (u.pick === i ? ' on' : ''), 'aria-pressed': String(u.pick === i), lang: L(),
                onclick: () => { C.vibrate(15); u.pick = i; C.scheduleRender(true); } }, tx(o)))),
            h('button', {
                class: 'btn primary big', disabled: u.pick === null || u.busy,
                onclick: async () => {
                    const pick = u.pick;
                    if (pick === null || u.busy) return;
                    u.busy = true;
                    try { const r = await C.run('guess', { player_id: pid, pick }); if (r) { C.ui.passed = null; u.pick = null; } } finally { u.busy = false; }
                } }, t('lb_guess_send')), skip));
    }

    function revealView() {
        const g = G(), l = g.last;
        if (!l) return null;
        const left = Math.ceil(g.next_left || 0);
        const rows = g.order.filter((id) => C.playerById(id) && l.answers[id] !== undefined);
        const voteCount = (id) => Object.values(l.votes).filter((v) => v === id).length;
        const last = g.round >= g.total;
        return C.section(t('lb_reveal_title'),
            h('div', { class: 'bg-verdict ' + l.kind, role: 'status' },
                h('div', { class: 'bg-verdict-word' }, t('lb_v_' + l.kind)),
                l.kind !== 'void' ? h('div', { class: 'bg-verdict-liar' }, t('lb_liar_was', { p: name(l.liar) })) : null),
            l.kind === 'caught' && l.pick ? h('p', { class: 'bg-hint' }, t('lb_guess_wrong_line', { q: tx(l.pick) })) : null,
            l.kind === 'stolen' ? h('p', { class: 'bg-hint' }, t('lb_guess_right_line')) : null,
            h('div', { class: 'bg-two' },
                h('div', { class: 'bg-q' }, h('div', { class: 'bg-q-lead' }, t('lb_all_got')), h('div', { class: 'bg-q-text', lang: L() }, tx(l.true))),
                h('div', { class: 'bg-q fake' }, h('div', { class: 'bg-q-lead' }, t('lb_liar_got')), h('div', { class: 'bg-q-text', lang: L() }, tx(l.fake)))),
            h('ul', { class: 'bg-rows' }, rows.map((id) => h('li', { class: 'bg-row' + (id === l.liar ? ' liar' : '') },
                h('span', { class: 'bg-row-name' }, name(id)),
                h('span', { class: 'bg-row-ans', lang: l.type === 'c' ? L() : null }, fmt(l.type, l.answers[id], l.opts)),
                h('span', { class: 'bg-row-n' }, t('lb_votes_n', { n: voteCount(id) }) + (l.pts[id] ? ' · +' + l.pts[id] : ''))))),
            h('p', { class: 'bg-next muted small' }, t(last ? 'lb_results_in' : 'lb_next_in') + ' ' + left),
            isHost() ? h('button', { class: 'btn ghost', onclick: () => C.run('next') }, t(last ? 'lb_see_results' : 'lb_next')) : null);
    }

    function hostPanel() {
        if (!isHost()) return null;
        return h('details', { class: 'panel bg-host' },
            h('summary', null, t('lb_host_tools')),
            h('p', { class: 'small muted' }, t('lb_host_note')),
            h('button', { class: 'btn ghost', onclick: () => C.askConfirm(t('lb_end_q'), t('lb_end'), () => C.run('end'), true) }, t('lb_end')));
    }

    function playView() {
        const g = G();
        const main = { answer: answerView, show: showView, vote: voteView, guess: guessView, reveal: revealView }[g.phase];
        return h('div', { class: 'stack bg' },
            !C.netOk ? h('div', { class: 'banner warn' }, t('connection_lost')) : null,
            h('div', { class: 'bg-top' }, h('span', null, t('lb_round_of', { n: g.round, m: g.total })), trace()),
            crowd(), main ? main() : null, hostPanel());
    }

    function resultCard() {
        const g = G();
        const res = g.result || { reason: 'host_ended', rows: [], winners: [] };
        const rows = res.rows.filter((r) => C.playerById(r.p));
        const names = res.winners.filter((p) => C.playerById(p)).map(name);
        return h('section', { class: 'panel result bg-result' },
            h('div', { class: 'bg-verdict-word' }, names.length === 1 ? t('lb_winner', { p: names[0] }) : (names.length ? t('lb_winners', { p: names.join(', ') }) : t('lb_no_winner'))),
            h('div', { class: 'muted' }, t('lb_reason_' + res.reason)),
            h('h3', { class: 'bg-standings-title' }, t('lb_standings')),
            h('ol', { class: 'bg-standings' }, rows.map((r) => h('li', { class: 'bg-stand' }, h('b', null, name(r.p)), h('span', null, pts(r.pts))))));
    }

    function summary() {
        return h('div', { class: 'chips' }, h('span', { class: 'chip soft' }, t('lb_sum_rounds', { n: C.state.settings.rounds })));
    }

    function settings(s, { set, host }) {
        return [h('div', { class: 'set-row' }, h('div', { class: 'set-text' }, h('span', { class: 'set-title' }, t('lb_set_rounds')), h('span', { class: 'set-desc' }, t('lb_set_rounds_d'))),
            h('div', { class: 'bg-choices-row', role: 'group', 'aria-label': t('lb_set_rounds') }, [3, 5, 8].map((v) => h('button', {
                class: 'btn small' + (s.rounds === v ? ' primary' : ' ghost'), disabled: !host, 'aria-pressed': String(s.rounds === v), onclick: () => set({ rounds: v }) }, String(v)))))];
    }

    return {
        init(core) { C = core; return { playView, resultCard, summary, settings }; },
    };
})();
