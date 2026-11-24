// public/js/obbligo/game.js
// "Truth or dare" screens. Runs inside public/js/spia/app.js (rooms, phones, settings, help, render loop); this file draws the match.
// A bottle on a round table points at the player whose turn it is. They pick Truth or Dare, a card is turned, they answer or do it
// and press Done; everybody else votes "done" / "not valid" in secret and the SERVER decides (strict majority scores). On a shared
// phone every local player is asked behind a "pass the phone" screen. The vote countdown is drawn from the time left that the
// server reports, so a wrong clock changes nothing.
window.ObbligoGame = (() => {
    'use strict';
    let C = null;
    let ticker = null;

    const G = () => C.state.obbligo;
    const t = (k, v) => C.t(k, v);
    const h = (...a) => C.h(...a);
    const name = (id) => C.pname(id) || '?';
    const mine = () => C.myPlayers().map((p) => p.id);
    const isMine = (pid) => mine().includes(pid);
    const isHost = () => !!C.state.is_host;
    const lang = () => (window.SpiaApp && window.SpiaApp.lang) || 'en';
    const L = () => (['it', 'en', 'es', 'fr', 'de'].includes(lang()) ? lang() : 'en');
    const LOUD = ['done', 'fail', 'none', 'pass', 'skip', 'left', 'end'];
    const CATS = ['calm', 'friends', 'spicy'];

    /** Per match UI state: last event seen, flash, "who holds the phone" markers, animation anchors, timers. */
    function ui() {
        const g = G();
        if (!C.ui.ob || C.ui.ob.match !== g.match) C.ui.ob = { match: g.match, lastEvent: 0, flash: [], flashUntil: 0, seen: '', spinKey: null, spinAt: 0, cardKey: null, cardAt: 0, anchor: null, timer: null, busy: false };
        return C.ui.ob;
    }

    function endsAt(kind, left) {
        const u = ui(), g = G();
        const key = `${kind}:${g.turn}:${g.phase}`;
        if (!u.anchor || u.anchor.key !== key) u.anchor = { key, at: Date.now() + left * 1000 };
        return u.anchor.at;
    }

    /** One refresh right after the time is up, so the vote is resolved without waiting for the next 2 s poll. */
    function refreshAt(at) {
        const u = ui();
        clearTimeout(u.timer);
        u.timer = setTimeout(() => { if (window.SpiaApp) window.SpiaApp.refresh(); }, Math.max(150, at - Date.now() + 250));
    }

    function countdown(at, total) {
        const left = Math.max(0, (at - Date.now()) / 1000);
        const bar = h('div', { class: 'ob-bar', 'aria-hidden': 'true' }, h('div', { class: 'ob-bar-fill', style: `animation-duration:${total}s;animation-delay:-${Math.max(0, total - left).toFixed(2)}s` }));
        const num = h('span', { class: 'ob-count' }, String(Math.ceil(left)));
        clearInterval(ticker);
        ticker = setInterval(() => {
            if (!num.isConnected) { clearInterval(ticker); return; }
            num.textContent = String(Math.max(0, Math.ceil((at - Date.now()) / 1000)));
        }, 250);
        return h('div', { class: 'ob-clock' }, bar, num);
    }

    function evText(e) {
        const p = e.p ? name(e.p) : '';
        switch (e.t) {
            case 'start': return t('ob_ev_start');
            case 'turn': return t('ob_ev_turn', { p });
            case 'truth': return t('ob_ev_truth', { p });
            case 'dare': return t('ob_ev_dare', { p });
            case 'swap': return t('ob_ev_swap', { p });
            case 'pass': return t('ob_ev_pass', { p });
            case 'vote': return t('ob_ev_vote', { p });
            case 'done': return t('ob_ev_done', { p });
            case 'fail': return t('ob_ev_fail', { p });
            case 'none': return t('ob_ev_none', { p });
            case 'skip': return t('ob_ev_skip', { p });
            case 'left': return t('ob_ev_left', { p });
            case 'end': return t('ob_ev_end');
            default: return '';
        }
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

    /** The row of players: points, who is in the spotlight, who already voted (only that, never what). */
    function crowd() {
        const g = G();
        const voting = g.phase === 'vote';
        return h('ul', { class: 'ob-crowd', 'aria-label': t('ob_players') }, g.order.filter((id) => C.playerById(id)).map((id) => {
            const active = g.active.includes(id);
            const spot = g.cur === id;
            const done = voting && g.voted.includes(id);
            return h('li', { class: 'ob-chip' + (active ? '' : ' gone') + (isMine(id) ? ' me' : '') + (spot ? ' spot' : '') + (done ? ' done' : '') },
                h('span', { class: 'ob-chip-name' }, name(id)),
                h('span', { class: 'ob-chip-pts' }, t('ob_pts_n', { n: g.pts[id] || 0 })),
                done ? h('span', { class: 'ob-chip-mark', 'aria-hidden': 'true' }, '✓') : null,
                done ? h('span', { class: 'sr-only' }, ' ' + t('ob_voted_mark')) : null,
                spot ? h('span', { class: 'sr-only' }, ' ' + t('ob_spot_mark')) : null);
        }));
    }

    /** The round table: a seat per player and a bottle that spins when a new turn begins and stops pointing at the player in the spotlight. */
    function table() {
        const g = G(), u = ui();
        const ids = g.order.filter((id) => C.playerById(id));
        const n = Math.max(1, ids.length);
        const idx = Math.max(0, ids.indexOf(g.cur));
        const angle = Math.round((idx / n) * 360);
        const key = `${g.turn}`;
        let spinMs = 0;
        if (u.spinKey === null) { u.spinKey = key; u.spinAt = 0; }
        else if (u.spinKey !== key) { u.spinKey = key; u.spinAt = Date.now(); }
        if (u.spinAt) { const el = Date.now() - u.spinAt; if (el < 2400) spinMs = el; }
        const seats = ids.map((id, i) => {
            const a = (i / n) * 2 * Math.PI;
            return h('li', { class: 'ob-seat' + (g.cur === id ? ' on' : ''), style: `left:${(50 + 44 * Math.sin(a)).toFixed(1)}%;top:${(50 - 44 * Math.cos(a)).toFixed(1)}%`, 'aria-hidden': 'true' }, Array.from(name(id))[0] || '?');
        });
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 40 120'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false'); svg.setAttribute('class', 'ob-bottle-art');
        const part = (tag, attrs) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) e.setAttribute(k, attrs[k]); svg.appendChild(e); };
        part('path', { class: 'ob-glass', d: 'M14 4h12v8c0 6 8 10 8 24v74c0 4-3 6-6 6H12c-3 0-6-2-6-6V36c0-14 8-18 8-24z' });
        part('rect', { class: 'ob-label', x: '9', y: '56', width: '22', height: '30', rx: '3' });
        part('path', { class: 'ob-tip', d: 'M20 2l-5 8h10z' });
        const style = `--a:${angle}deg` + (spinMs ? `;animation:ob-spin 2.4s cubic-bezier(.12,.7,.2,1) ${-spinMs}ms both` : '');
        return h('div', { class: 'ob-table', role: 'img', 'aria-label': t('ob_bottle', { p: name(g.cur) }) },
            h('div', { class: 'ob-felt', 'aria-hidden': 'true' }),
            h('ul', { class: 'ob-seats' }, seats),
            h('div', { class: 'ob-bottle', style }, svg));
    }

    /** The card: it turns over when drawn (or changed). */
    function card() {
        const g = G(), u = ui(), c = g.card;
        const key = `${g.turn}:${c.k}:${c.text.en}`;
        let flipMs = 0;
        if (u.cardKey === null) { u.cardKey = key; u.cardAt = 0; }
        else if (u.cardKey !== key) { u.cardKey = key; u.cardAt = Date.now(); }
        if (u.cardAt) { const el = Date.now() - u.cardAt; if (el < 700) flipMs = el; }
        const txt = c.text[L()] || c.text.en;
        return h('div', { class: 'ob-card ' + (c.k === 't' ? 'truth' : 'dare'), style: flipMs ? `animation:ob-flip .7s ease-out ${-flipMs}ms both` : '' },
            h('div', { class: 'ob-card-kind' }, t(c.k === 't' ? 'ob_truth' : 'ob_dare')),
            h('p', { class: 'ob-card-text', lang: L() }, txt),
            h('div', { class: 'ob-card-cat' }, t('ob_card_cat_' + c.cat)));
    }

    /** On a shared phone, ask for the player behind the "pass the phone" screen once per step. */
    function gate(pid, key, then) {
        const u = ui();
        if (mine().length > 1 && u.seen !== key) {
            return C.passView(pid, t('ob_pass_phone_to'), () => { u.seen = key; C.scheduleRender(); });
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

    function passButton(g) {
        const used = g.pass_used[g.cur];
        return h('button', {
            class: 'btn ghost ob-pass', disabled: used,
            onclick: () => C.askConfirm(t('ob_pass_q'), t('ob_pass_yes'), act('pass', { player_id: g.cur }), true),
        }, t(used ? 'ob_pass_gone' : 'ob_pass'));
    }

    function chooseView() {
        const g = G();
        const spotName = h('p', { class: 'ob-spot' }, h('span', { class: 'ob-spot-lead' }, t('ob_bottle', { p: '' }).trim()), h('b', { class: 'ob-spot-name' }, name(g.cur)));
        if (!isMine(g.cur)) return h('section', { class: 'ob-round' }, h('h2', { class: 'sr-only' }, t('ob_turn_n', { n: g.turn, m: g.turns })), table(), spotName, h('p', { class: 'ob-wait' }, t('ob_picking', { p: name(g.cur) })));
        return gate(g.cur, `c${g.turn}`, () => h('section', { class: 'ob-round' },
            h('h2', { class: 'sr-only' }, t('ob_turn_n', { n: g.turn, m: g.turns })), table(),
            h('p', { class: 'ob-spot' }, h('b', { class: 'ob-spot-name' }, mine().length > 1 ? name(g.cur) : t('ob_you_spot'))),
            h('p', { class: 'ob-ask' }, t('ob_choose')),
            h('div', { class: 'ob-picks', role: 'group', 'aria-label': t('ob_choose') },
                h('button', { class: 'ob-pick truth', onclick: act('choose', { player_id: g.cur, kind: 't' }) }, t('ob_truth')),
                h('button', { class: 'ob-pick dare', onclick: act('choose', { player_id: g.cur, kind: 'd' }) }, t('ob_dare'))),
            passButton(g)));
    }

    function cardView() {
        const g = G();
        const head = [h('h2', { class: 'sr-only' }, t('ob_turn_n', { n: g.turn, m: g.turns })), table(), card()];
        if (!isMine(g.cur)) return h('section', { class: 'ob-round' }, head, h('p', { class: 'ob-wait' }, t('ob_wait_doing', { p: name(g.cur) })));
        return gate(g.cur, `c${g.turn}`, () => h('section', { class: 'ob-round' }, head,
            h('p', { class: 'ob-wait' }, t('ob_read_do')),
            h('button', { class: 'btn primary big ob-done', onclick: act('done', { player_id: g.cur }) }, t('ob_done')),
            h('div', { class: 'ob-row' },
                h('button', { class: 'btn ghost', disabled: g.swapped, onclick: act('swap', { player_id: g.cur }) }, t(g.swapped ? 'ob_swap_gone' : 'ob_swap')),
                passButton(g))));
    }

    function voteView() {
        const g = G(), u = ui();
        const at = endsAt('v', g.left || 0);
        refreshAt(at);
        const todo = g.me.filter((m) => m.can_vote && !m.voted);
        const head = [h('h2', { class: 'sr-only' }, t('ob_turn_n', { n: g.turn, m: g.turns })), countdown(at, 30), card()];
        if (todo.length) {
            const m = todo[0];
            return gate(m.player_id, `v${g.turn}:${m.player_id}`, () => {
                const vote = (v) => async () => {
                    if (u.busy) return;
                    u.busy = true;
                    C.vibrate(25);
                    u.seen = '';
                    try { await C.run('vote', { player_id: m.player_id, v }); } finally { u.busy = false; }
                };
                return h('section', { class: 'ob-round' }, head,
                    h('p', { class: 'ob-ask' }, t('ob_vote_q', { p: name(g.cur) })),
                    mine().length > 1 ? h('p', { class: 'ob-wait' }, t('ob_voting_as', { p: name(m.player_id) })) : null,
                    h('div', { class: 'ob-picks', role: 'group', 'aria-label': t('ob_vote_q', { p: name(g.cur) }) },
                        h('button', { class: 'ob-pick yes', onclick: vote('ok') }, t('ob_vote_ok')),
                        h('button', { class: 'ob-pick no', onclick: vote('no') }, t('ob_vote_no'))));
            });
        }
        const self = g.me.some((m) => m.current);
        return h('section', { class: 'ob-round' }, head,
            h('p', { class: 'ob-wait' }, self ? t('ob_vote_self') : t('ob_vote_wait', { n: g.voted.length, m: g.active.length - 1 })));
    }

    function revealView() {
        const g = G(), r = g.reveal;
        if (!r) return null;
        const at = endsAt('r', g.next_left || 0);
        refreshAt(at);
        const p = name(g.cur);
        const verdict = r.result === 'done' ? t('ob_rv_done', { p }) : r.result === 'none' ? t('ob_rv_none') : t('ob_rv_fail', { p });
        const total = r.ok + r.no;
        const pct = total ? Math.round((r.ok / total) * 100) : 0;
        return h('section', { class: 'ob-round' },
            h('h2', { class: 'ob-title' }, t('ob_reveal_title')),
            g.card ? card() : null,
            h('div', { class: 'ob-tally', 'aria-hidden': 'true' }, h('div', { class: 'ob-tally-ok', style: `width:${pct}%` })),
            h('p', { class: 'ob-votes' }, t('ob_votes_n', { a: r.ok, b: r.no })),
            h('p', { class: 'ob-verdict ' + r.result, role: 'status' }, verdict),
            h('p', { class: 'ob-next muted small' }, t(r.last ? 'ob_results_in' : 'ob_next_in'), ' ', h('b', { class: 'ob-count' }, String(Math.ceil(Math.max(0, (at - Date.now()) / 1000))))),
            isHost() ? h('button', { class: 'btn ghost', onclick: () => C.run('next') }, t(r.last ? 'ob_see_results' : 'ob_next')) : null);
    }

    function feed() {
        const evs = G().events.slice(-8).reverse();
        return h('ol', { class: 'ob-feed' }, evs.map((e) => h('li', { class: LOUD.includes(e.t) ? 'loud ev-' + e.t : 'ev-' + e.t }, evText(e))));
    }

    function hostPanel() {
        if (!isHost()) return null;
        const g = G();
        const canSkip = ['choose', 'card', 'vote'].includes(g.phase);
        return h('details', { class: 'panel ob-host' },
            h('summary', null, t('ob_host_tools')),
            h('p', { class: 'small muted' }, t('ob_host_note')),
            canSkip ? h('button', { class: 'btn ghost', onclick: () => C.askConfirm(t('ob_skip_q', { p: name(g.cur) }), t('ob_skip'), () => C.run('skip'), true) }, t('ob_skip')) : null,
            h('button', { class: 'btn ghost', onclick: () => C.askConfirm(t('ob_end_q'), t('ob_end'), () => C.run('end'), true) }, t('ob_end')));
    }

    function playView() {
        const g = G();
        const flash = announce();
        if (g.phase !== 'vote') clearTimeout(ui().timer);
        const body = g.phase === 'choose' ? chooseView() : g.phase === 'card' ? cardView() : g.phase === 'vote' ? voteView() : revealView();
        return h('div', { class: 'stack ob' },
            !C.netOk ? h('div', { class: 'banner warn' }, t('connection_lost')) : null,
            flash.length ? h('div', { class: 'ob-flash', role: 'status' }, flash.map((e) => h('div', null, evText(e)))) : null,
            h('div', { class: 'ob-top' }, h('span', null, t('ob_turn_n', { n: g.turn, m: g.turns })), h('span', null, t('ob_lap_n', { n: g.lap, m: g.laps }))),
            crowd(), body,
            C.section(t('ob_feed_title'), feed()),
            hostPanel());
    }

    function resultCard() {
        const g = G();
        const res = g.result || { reason: 'host_ended', rows: [], winners: [] };
        const rows = res.rows.filter((r) => C.playerById(r.p));
        const w = res.winners.filter((id) => C.playerById(id)).map(name);
        return h('section', { class: 'panel result ob-result' },
            h('div', { class: 'stamp result-stamp' }, w.length === 1 ? t('ob_winner', { p: w[0] }) : w.length > 1 ? t('ob_tie', { p: w.join(', ') }) : t('ob_standings')),
            h('div', { class: 'muted' }, t('ob_reason_' + res.reason)),
            h('ol', { class: 'ob-standings' }, rows.map((r) => h('li', { class: 'ob-stand' + (res.winners.includes(r.p) ? ' win' : '') },
                h('span', { class: 'ob-stand-main' }, h('b', null, name(r.p)), h('span', { class: 'ob-stand-pts' }, t('ob_pts_n', { n: r.pts }))),
                h('span', { class: 'ob-stand-n' }, t('ob_stand_n', { d: r.done, f: r.fail, s: r.passes }))))));
    }

    function summary() {
        const s = C.state.settings;
        const chips = [t('ob_sum_laps', { n: s.laps }), ...CATS.filter((k) => s[k]).map((k) => t('ob_cat_' + k))];
        return h('div', { class: 'chips' }, chips.map((c) => h('span', { class: 'chip soft' }, c)));
    }

    function settings(s, { set, toggle, host }) {
        return [
            h('div', { class: 'set-row' },
                h('div', { class: 'set-text' }, h('span', { class: 'set-title' }, t('ob_set_laps')), h('span', { class: 'set-desc' }, t('ob_set_laps_d'))),
                h('div', { class: 'ob-choices', role: 'group', 'aria-label': t('ob_set_laps') }, [1, 2, 3].map((v) => h('button', {
                    class: 'btn small' + (s.laps === v ? ' primary' : ' ghost'), disabled: !host, 'aria-pressed': String(s.laps === v), onclick: () => set({ laps: v }),
                }, String(v))))),
            h('h3', { class: 'set-group' }, t('ob_set_cats')),
            toggle('calm', t('ob_cat_calm'), ''),
            toggle('friends', t('ob_cat_friends'), ''),
            toggle('spicy', t('ob_cat_spicy'), t('ob_cat_spicy_d')),
        ];
    }

    return {
        init(core) { C = core; return { playView, resultCard, summary, settings }; },
    };
})();
