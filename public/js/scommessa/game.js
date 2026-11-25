// public/js/scommessa/game.js
// "Bet buddy" screens. Runs inside public/js/spia/app.js (rooms, phones, settings, help, render loop); this file draws the match.
// A casino-style table with PRETEND chips (never money). The challenger sees a secret challenge, picks a player and a stake; the player
// accepts or refuses; if accepted they do it live and the jury (everybody else) votes "pulled off" / "failed" in secret; the SERVER judges
// (a tie counts as pulled off) and moves the chips. Everybody in the jury may also bet 1 chip on the verdict. On a shared phone every
// local player is asked behind a "pass the phone" screen. The countdown is drawn from the time left that the server reports.
window.ScommessaGame = (() => {
    'use strict';
    let C = null;
    let ticker = null;

    const G = () => C.state.scommessa;
    const t = (k, v) => C.t(k, v);
    const h = (...a) => C.h(...a);
    const name = (id) => C.pname(id) || '?';
    const mine = () => C.myPlayers().map((p) => p.id);
    const isMine = (pid) => mine().includes(pid);
    const isHost = () => !!C.state.is_host;
    const lang = () => (window.SpiaApp && window.SpiaApp.lang) || 'en';
    const L = () => (['it', 'en', 'es', 'fr', 'de'].includes(lang()) ? lang() : 'en');
    const LOUD = ['done', 'failed', 'refused', 'refuse', 'out', 'void', 'skip', 'left', 'end'];
    const CATS = ['easy', 'company', 'move', 'mind'];
    const chipsOf = (id) => (G().chips[id] === undefined ? 0 : G().chips[id]);

    function ui() {
        const g = G();
        if (!C.ui.sc || C.ui.sc.match !== g.match) C.ui.sc = { match: g.match, lastEvent: 0, flash: [], flashUntil: 0, seen: '', anchor: null, timer: null, busy: false, target: null, stake: 1, betWith: {} };
        return C.ui.sc;
    }

    function endsAt(kind, left) {
        const u = ui(), g = G();
        const key = `${kind}:${g.round}:${g.phase}`;
        if (!u.anchor || u.anchor.key !== key) u.anchor = { key, at: Date.now() + left * 1000 };
        return u.anchor.at;
    }

    function refreshAt(at) {
        const u = ui();
        clearTimeout(u.timer);
        u.timer = setTimeout(() => { if (window.SpiaApp) window.SpiaApp.refresh(); }, Math.max(150, at - Date.now() + 250));
    }

    function countdown(at, total) {
        const left = Math.max(0, (at - Date.now()) / 1000);
        const bar = h('div', { class: 'sc-bar', 'aria-hidden': 'true' }, h('div', { class: 'sc-bar-fill', style: `animation-duration:${total}s;animation-delay:-${Math.max(0, total - left).toFixed(2)}s` }));
        const num = h('span', { class: 'sc-count' }, String(Math.ceil(left)));
        clearInterval(ticker);
        ticker = setInterval(() => {
            if (!num.isConnected) { clearInterval(ticker); return; }
            num.textContent = String(Math.max(0, Math.ceil((at - Date.now()) / 1000)));
        }, 250);
        return h('div', { class: 'sc-clock' }, bar, num);
    }

    function evText(e) {
        const p = e.p ? name(e.p) : '', q = e.q ? name(e.q) : '';
        const k = 'sc_ev_' + e.t;
        return ['start', 'round', 'pick', 'accept', 'refuse', 'vote', 'bet', 'done', 'failed', 'refused', 'out', 'skip', 'void', 'left', 'end', 'swap'].includes(e.t)
            ? t(k, { p, q, n: e.n || 0 }) : '';
    }

    function announce() {
        const u = ui();
        const evs = G().events;
        const loud = evs.filter((e) => e.id > u.lastEvent && LOUD.includes(e.t));
        if (u.lastEvent && loud.length) {
            C.vibrate(loud.some((e) => e.t === 'done' && isMine(e.p)) ? [200, 60, 200] : [60, 40, 60]);
            u.flash = loud.slice(-2);
            u.flashUntil = Date.now() + 4500;
            setTimeout(() => C.scheduleRender(), 4600);
        }
        if (evs.length) u.lastEvent = evs[evs.length - 1].id;
        return Date.now() < u.flashUntil ? u.flash : [];
    }

    /** A stack of pretend chips (decorative: the number is always written next to it). */
    function stack(n) {
        const shown = Math.min(n, 12);
        return h('span', { class: 'sc-stack', 'aria-hidden': 'true' }, Array.from({ length: shown }, (_, i) => h('span', { class: 'sc-chip c' + (i % 4), style: `--i:${i}` })));
    }

    /** The players around the table: name, chips, who is challenger / challenged, who already voted or bet (only that, never what). */
    function seats() {
        const g = G();
        const voting = g.phase === 'vote';
        const live = ['respond', 'perform', 'vote'].includes(g.phase);
        return h('ul', { class: 'sc-seats', 'aria-label': t('sc_players') }, g.order.filter((id) => C.playerById(id)).map((id) => {
            const present = g.present.includes(id);
            const out = present && chipsOf(id) === 0;
            const cur = g.cur === id, tar = g.target === id;
            const voted = voting && g.voted.includes(id);
            const bet = live && g.betted.includes(id);
            return h('li', { class: 'sc-seat' + (present ? '' : ' gone') + (out ? ' out' : '') + (isMine(id) ? ' me' : '') + (cur ? ' cur' : '') + (tar ? ' tar' : '') },
                h('span', { class: 'sc-seat-name' }, name(id)),
                h('span', { class: 'sc-seat-chips' }, stack(chipsOf(id)), h('b', null, t('sc_chips_n', { n: chipsOf(id) }))),
                cur ? h('span', { class: 'sc-tag' }, t('sc_challenger_mark')) : null,
                tar ? h('span', { class: 'sc-tag alt' }, t('sc_target_mark')) : null,
                voted ? h('span', { class: 'sc-tag ok' }, '✓', h('span', { class: 'sr-only' }, ' ' + t('sc_voted_mark'))) : null,
                bet ? h('span', { class: 'sc-tag ok' }, '●', h('span', { class: 'sr-only' }, ' ' + t('sc_betted_mark'))) : null,
                out ? h('span', { class: 'sr-only' }, ' ' + t('sc_out_mark')) : null);
        }));
    }

    function card(extraClass) {
        const c = G().card;
        if (!c) return null;
        return h('div', { class: 'sc-card ' + (extraClass || '') },
            h('div', { class: 'sc-card-cat' }, t('sc_card_cat_' + c.cat)),
            h('p', { class: 'sc-card-text', lang: L() }, c.text[L()] || c.text.en));
    }

    function gate(pid, key, then) {
        const u = ui();
        if (mine().length > 1 && u.seen !== key) {
            return C.passView(pid, t('sc_pass_phone_to'), () => { u.seen = key; C.scheduleRender(); });
        }
        return then();
    }

    function act(action, extra) {
        const u = ui();
        return async () => {
            if (u.busy) return;
            u.busy = true;
            C.vibrate(20);
            try { await C.run(action, extra); } finally { u.busy = false; }
        };
    }

    const head = () => h('h2', { class: 'sr-only' }, t('sc_round_n', { n: G().round, m: G().rounds }));
    const stakeLine = () => h('p', { class: 'sc-headline' }, t('sc_challenge_head', { p: name(G().cur), q: name(G().target), n: G().stake }));

    /** Optional bet of 1 chip, for the jury of a phone with ONE local player (on a shared phone the bet is a tick box in the vote). */
    function betPanel() {
        const g = G();
        const m = g.me.find((x) => x.can_vote && !x.voted);
        if (!m || mine().length > 1) return null;
        if (m.bet) return h('p', { class: 'sc-betnote', role: 'status' }, t('sc_bet_placed', { v: t(m.bet === 'ok' ? 'sc_bet_ok' : 'sc_bet_no') }));
        if (m.chips < 1) return null;
        const place = (v) => act('bet', { player_id: m.player_id, v });
        return h('section', { class: 'sc-bet', 'aria-label': t('sc_bet_title') },
            h('h3', { class: 'sc-bet-h' }, t('sc_bet_title')),
            h('p', { class: 'sc-small' }, t('sc_bet_note')),
            h('div', { class: 'sc-picks' },
                h('button', { class: 'sc-pick yes small', onclick: place('ok') }, t('sc_bet_ok')),
                h('button', { class: 'sc-pick no small', onclick: place('no') }, t('sc_bet_no'))));
    }

    function pickView() {
        const g = G(), u = ui();
        if (!isMine(g.cur)) return h('section', { class: 'sc-round' }, head(), h('p', { class: 'sc-wait' }, t('sc_picking', { p: name(g.cur) })));
        if (u.pickRound !== g.round) { u.pickRound = g.round; u.target = null; u.stake = 1; }
        const me = chipsOf(g.cur);
        const targets = g.active.filter((id) => id !== g.cur && C.playerById(id));
        if (!targets.includes(u.target)) u.target = null;
        const maxStake = Math.max(1, Math.min(3, me, u.target ? chipsOf(u.target) : 3));
        if (u.stake > maxStake) u.stake = maxStake;
        return gate(g.cur, `p${g.round}`, () => h('section', { class: 'sc-round' }, head(),
            h('p', { class: 'sc-lead' }, mine().length > 1 ? name(g.cur) : t('sc_you_challenger')),
            h('p', { class: 'sc-small' }, t('sc_secret_card')),
            card('secret'),
            h('button', { class: 'btn ghost', disabled: g.swapped, onclick: act('swap', { player_id: g.cur }) }, t(g.swapped ? 'sc_swap_gone' : 'sc_swap')),
            h('h3', { class: 'sc-ask' }, t('sc_pick_who')),
            h('div', { class: 'sc-picks', role: 'group', 'aria-label': t('sc_pick_who') }, targets.map((id) => h('button', {
                class: 'sc-pick who' + (u.target === id ? ' on' : ''), 'aria-pressed': String(u.target === id),
                onclick: () => { u.target = id; C.scheduleRender(); },
            }, h('span', null, name(id)), h('small', null, t('sc_chips_n', { n: chipsOf(id) }))))),
            h('h3', { class: 'sc-ask' }, t('sc_pick_stake')),
            h('div', { class: 'sc-stakes', role: 'group', 'aria-label': t('sc_pick_stake') }, [1, 2, 3].map((n) => h('button', {
                class: 'sc-stake' + (u.stake === n ? ' on' : ''), disabled: n > maxStake, 'aria-pressed': String(u.stake === n),
                'aria-label': t('sc_stake_label', { n }), onclick: () => { u.stake = n; C.scheduleRender(); },
            }, h('b', null, String(n)), stack(n)))),
            h('button', { class: 'btn primary big sc-send', disabled: !u.target, onclick: act('pick', { player_id: g.cur, target: u.target, stake: u.stake }) }, t('sc_send'))));
    }

    function respondView() {
        const g = G();
        const body = [head(), stakeLine(), card('open')];
        if (!isMine(g.target)) return h('section', { class: 'sc-round' }, body, h('p', { class: 'sc-wait' }, t('sc_wait_answer', { p: name(g.target) })), betPanel());
        return gate(g.target, `r${g.round}`, () => h('section', { class: 'sc-round' }, body,
            h('p', { class: 'sc-lead' }, t('sc_you_challenged')),
            h('div', { class: 'sc-picks', role: 'group', 'aria-label': t('sc_you_challenged') },
                h('button', { class: 'sc-pick yes', onclick: act('accept', { player_id: g.target }) }, t('sc_accept')),
                h('button', { class: 'sc-pick no', onclick: () => C.askConfirm(t('sc_refuse_q', { p: name(g.cur) }), t('sc_refuse_yes'), act('refuse', { player_id: g.target }), true) }, t('sc_refuse')))));
    }

    function performView() {
        const g = G();
        const body = [head(), stakeLine(), card('open')];
        if (!isMine(g.target)) return h('section', { class: 'sc-round' }, body, h('p', { class: 'sc-wait' }, t('sc_wait_doing', { p: name(g.target) })), betPanel());
        return gate(g.target, `d${g.round}`, () => h('section', { class: 'sc-round' }, body,
            h('p', { class: 'sc-wait' }, t('sc_perform_you')),
            h('button', { class: 'btn primary big sc-send', onclick: act('done', { player_id: g.target }) }, t('sc_done'))));
    }

    function voteView() {
        const g = G(), u = ui();
        const at = endsAt('v', g.left || 0);
        refreshAt(at);
        const todo = g.me.filter((m) => m.can_vote && !m.voted);
        const top = [head(), countdown(at, 40), stakeLine(), card('open')];
        if (todo.length) {
            const m = todo[0];
            return gate(m.player_id, `v${g.round}:${m.player_id}`, () => {
                const vote = (v) => async () => {
                    if (u.busy) return;
                    u.busy = true;
                    C.vibrate(25);
                    u.seen = '';
                    try { await C.run('vote', { player_id: m.player_id, v, bet: !!u.betWith[m.player_id] && !m.bet && m.chips > 0 }); } finally { u.busy = false; }
                };
                return h('section', { class: 'sc-round' }, top,
                    h('p', { class: 'sc-lead' }, t('sc_vote_q', { p: name(g.target) })),
                    mine().length > 1 ? h('p', { class: 'sc-wait' }, t('sc_voting_as', { p: name(m.player_id) })) : null,
                    h('div', { class: 'sc-picks', role: 'group', 'aria-label': t('sc_vote_q', { p: name(g.target) }) },
                        h('button', { class: 'sc-pick yes', onclick: vote('ok') }, t('sc_vote_ok')),
                        h('button', { class: 'sc-pick no', onclick: vote('no') }, t('sc_vote_no'))),
                    m.chips > 0 && !m.bet ? h('label', { class: 'sc-betbox' },
                        h('input', { type: 'checkbox', checked: !!u.betWith[m.player_id], onchange: (e) => { u.betWith[m.player_id] = e.target.checked; } }),
                        h('span', null, t('sc_bet_also'))) : null,
                    m.bet ? h('p', { class: 'sc-betnote', role: 'status' }, t('sc_bet_placed', { v: t(m.bet === 'ok' ? 'sc_bet_ok' : 'sc_bet_no') })) : null,
                    h('p', { class: 'sc-small' }, t('sc_bet_note')));
            });
        }
        const self = g.me.some((m) => m.current || m.target);
        return h('section', { class: 'sc-round' }, top,
            h('p', { class: 'sc-wait' }, self ? t('sc_vote_self') : t('sc_vote_wait', { n: g.voted.length, m: g.present.length - 2 })));
    }

    /** The chips that slide from the loser to the winner of the round. */
    function flow(from, to, n) {
        return h('div', { class: 'sc-flow', 'aria-hidden': 'true' },
            h('span', { class: 'sc-flow-name' }, name(from)),
            h('span', { class: 'sc-flow-lane' }, Array.from({ length: Math.min(n, 6) }, (_, i) => h('span', { class: 'sc-chip c' + (i % 4), style: `--d:${i * 0.18}s` }))),
            h('span', { class: 'sc-flow-name' }, name(to)));
    }

    function revealView() {
        const g = G(), r = g.reveal;
        if (!r) return null;
        const at = endsAt('r', g.next_left || 0);
        refreshAt(at);
        const p = name(g.target), q = name(g.cur), n = t('sc_chips_n', { n: r.amount });
        const verdict = r.result === 'done' ? t('sc_rv_done', { p, q, n }) : r.result === 'failed' ? t('sc_rv_failed', { p, q, n }) : t('sc_rv_refused', { p, q, n });
        const winner = r.result === 'done' ? g.target : g.cur;
        const loser = r.result === 'done' ? g.cur : g.target;
        const total = r.ok + r.no;
        const pct = total ? Math.round((r.ok / total) * 100) : 0;
        const last = g.round >= g.rounds;
        return h('section', { class: 'sc-round' },
            h('h2', { class: 'sc-title' }, t('sc_reveal_title')),
            card('open'),
            r.amount ? flow(loser, winner, r.amount) : null,
            h('p', { class: 'sc-verdict ' + r.result, role: 'status' }, verdict),
            r.result !== 'refused' ? [
                h('div', { class: 'sc-tally', 'aria-hidden': 'true' }, h('div', { class: 'sc-tally-ok', style: `width:${pct}%` })),
                h('p', { class: 'sc-votes' }, t('sc_votes_n', { a: r.ok, b: r.no })),
                r.ok === r.no ? h('p', { class: 'sc-small' }, t('sc_tie_note')) : null,
            ] : null,
            r.bets.length ? h('ul', { class: 'sc-bets' }, r.bets.map((b) => h('li', { class: b.win ? 'win' : 'lose' },
                t(b.win ? 'sc_bet_won' : 'sc_bet_lost', { p: name(b.p) })))) : null,
            h('p', { class: 'sc-next sc-small' }, t(last ? 'sc_results_in' : 'sc_next_in'), ' ', h('b', { class: 'sc-count' }, String(Math.ceil(Math.max(0, (at - Date.now()) / 1000))))),
            isHost() ? h('button', { class: 'btn ghost', onclick: () => C.run('next') }, t(last ? 'sc_see_results' : 'sc_next')) : null);
    }

    function feed() {
        const evs = G().events.slice(-8).reverse();
        return h('ol', { class: 'sc-feed' }, evs.map((e) => h('li', { class: LOUD.includes(e.t) ? 'loud' : '' }, evText(e))));
    }

    function hostPanel() {
        if (!isHost()) return null;
        const g = G();
        return h('details', { class: 'panel sc-host' },
            h('summary', null, t('sc_host_tools')),
            h('p', { class: 'small muted' }, t('sc_host_note')),
            g.phase !== 'reveal' ? h('button', { class: 'btn ghost', onclick: () => C.askConfirm(t('sc_skip_q', { p: name(g.cur) }), t('sc_skip'), () => C.run('skip'), true) }, t('sc_skip')) : null,
            h('button', { class: 'btn ghost', onclick: () => C.askConfirm(t('sc_end_q'), t('sc_end'), () => C.run('end'), true) }, t('sc_end')));
    }

    function playView() {
        const g = G();
        const flash = announce();
        if (g.phase !== 'vote') clearTimeout(ui().timer);
        const body = g.phase === 'pick' ? pickView() : g.phase === 'respond' ? respondView() : g.phase === 'perform' ? performView() : g.phase === 'vote' ? voteView() : revealView();
        return h('div', { class: 'stack sc' },
            !C.netOk ? h('div', { class: 'banner warn' }, t('connection_lost')) : null,
            h('div', { class: 'sc-fake', role: 'note' }, h('b', null, t('sc_fake')), h('span', null, t('sc_fake_d'))),
            flash.length ? h('div', { class: 'sc-flash', role: 'status' }, flash.map((e) => h('div', null, evText(e)))) : null,
            h('div', { class: 'sc-top' }, h('span', null, t('sc_round_n', { n: g.round, m: g.rounds }))),
            seats(), body,
            C.section(t('sc_feed_title'), feed()),
            hostPanel());
    }

    function resultCard() {
        const g = G();
        const res = g.result || { reason: 'host_ended', rows: [], winners: [], titles: [] };
        const rows = res.rows.filter((r) => C.playerById(r.p));
        const w = res.winners.filter((id) => C.playerById(id)).map(name);
        const titles = (res.titles || []).filter((x) => x.ps.some((id) => C.playerById(id)));
        return h('section', { class: 'panel result sc-result' },
            h('div', { class: 'sc-fake', role: 'note' }, h('b', null, t('sc_fake')), h('span', null, t('sc_fake_d'))),
            h('div', { class: 'stamp result-stamp' }, w.length === 1 ? t('sc_winner', { p: w[0] }) : w.length > 1 ? t('sc_tie', { p: w.join(', ') }) : t('sc_standings')),
            h('div', { class: 'muted' }, t('sc_reason_' + res.reason)),
            h('ol', { class: 'sc-standings' }, rows.map((r) => h('li', { class: 'sc-stand' + (res.winners.includes(r.p) ? ' win' : '') },
                h('span', { class: 'sc-stand-main' }, h('b', null, name(r.p)), stack(r.chips), h('span', { class: 'sc-stand-pts' }, t('sc_chips_n', { n: r.chips }))),
                h('span', { class: 'sc-stand-n' }, t('sc_stand_n', { a: r.acc, r: r.ref }))))),
            titles.length ? h('h3', { class: 'sc-ask' }, t('sc_titles_h')) : null,
            titles.length ? h('ul', { class: 'sc-titles' }, titles.map((x) => h('li', null,
                h('b', null, t('sc_title_' + x.k)), ' — ', x.ps.filter((id) => C.playerById(id)).map(name).join(', '), h('span', { class: 'sc-small' }, ' (' + t('sc_title_' + x.k + '_d') + ')')))) : null);
    }

    function summary() {
        const s = C.state.settings;
        const chips = [t('sc_sum_rounds', { n: s.rounds }), ...CATS.filter((k) => s[k]).map((k) => t('sc_cat_' + k))];
        return h('div', null, h('div', { class: 'chips' }, chips.map((c) => h('span', { class: 'chip soft' }, c))), fakeRibbon());
    }

    const fakeRibbon = () => h('div', { class: 'sc-fake sc-fake-inline', role: 'note' }, h('b', null, t('sc_fake')), h('span', null, t('sc_fake_d')));
    const lobbyExtra = fakeRibbon;

    function settings(s, { set, toggle, host }) {
        return [
            h('div', { class: 'set-row' },
                h('div', { class: 'set-text' }, h('span', { class: 'set-title' }, t('sc_set_rounds')), h('span', { class: 'set-desc' }, t('sc_set_rounds_d'))),
                h('div', { class: 'sc-choices', role: 'group', 'aria-label': t('sc_set_rounds') }, [6, 10, 15].map((v) => h('button', {
                    class: 'btn small' + (s.rounds === v ? ' primary' : ' ghost'), disabled: !host, 'aria-pressed': String(s.rounds === v), onclick: () => set({ rounds: v }),
                }, String(v))))),
            h('h3', { class: 'set-group' }, t('sc_set_cats')),
            toggle('easy', t('sc_cat_easy'), t('sc_cat_d')),
            toggle('company', t('sc_cat_company'), ''),
            toggle('move', t('sc_cat_move'), ''),
            toggle('mind', t('sc_cat_mind'), ''),
        ];
    }

    return {
        init(core) { C = core; return { playView, resultCard, summary, settings, lobbyExtra }; },
    };
})();
