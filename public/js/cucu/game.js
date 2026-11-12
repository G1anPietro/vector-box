// public/js/cucu/game.js
// Cucù screens. Runs inside public/js/spia/app.js (rooms, phones, settings, help, render loop); this file draws
// the match. Lives are never shown to the players: only events ("Marco perde una vita") reach every phone, and the
// host (capotavola) sees the lives only while judging the new dealer's recital.
window.CucuGame = (() => {
    'use strict';
    let C = null;

    const G = () => C.state.cucu;
    const t = (k, v) => C.t(k, v);
    const h = (...a) => C.h(...a);
    const name = (id) => C.pname(id) || '?';
    const mine = () => C.myPlayers().map((p) => p.id);
    const isMine = (pid) => mine().includes(pid);
    const isAlive = (pid) => G().alive.includes(pid);
    const isHost = () => !!C.state.is_host;

    const SUIT = { d: 'denari', c: 'coppe', s: 'spade', b: 'bastoni' };
    const rankName = (r) => ({ 1: t('cu_ace'), 8: t('cu_fante'), 9: t('cu_cavallo'), 10: t('cu_re') }[r] || String(r));
    const cardText = (c) => t('cu_card', { rank: rankName(c[1]), suit: t('cu_suit_' + c[0]) });

    function nextAlive(pid) {
        const g = G();
        const i = g.order.indexOf(pid);
        for (let k = 1; k <= g.order.length; k++) {
            const p = g.order[(i + k) % g.order.length];
            if (g.alive.includes(p)) return p;
        }
        return pid;
    }

    function ui() {
        const g = G();
        if (!C.ui.cu || C.ui.cu.match !== g.match) C.ui.cu = { match: g.match, lastEvent: 0, loser: null, living: null, dead: null, target: null, flash: [], flashUntil: 0 };
        return C.ui.cu;
    }

    /** The big card: rank on top, suit below, suit colour from the Italian deck. */
    function card(c, small = false) {
        if (!c) return h('div', { class: 'cu-card back' + (small ? ' small' : '') }, h('span', null, '?'));
        return h('div', { class: `cu-card suit-${c[0]}${c[1] === 10 ? ' king' : ''}${small ? ' small' : ''}`, 'aria-label': cardText(c) },
            h('span', { class: 'rank' }, c[1] > 7 || c[1] === 1 ? (small ? rankName(c[1]).charAt(0) : rankName(c[1])) : String(c[1])),
            h('span', { class: 'suit' }, SUIT[c[0]]));
    }

    function evText(e) {
        const p = e.p ? name(e.p) : '';
        const q = e.q ? name(e.q) : '';
        switch (e.t) {
            case 'start': return t('cu_ev_start');
            case 'dealer': return t('cu_ev_dealer', { p });
            case 'recite_ok': return t('cu_ev_recite_ok', { p });
            case 'recite_wrong': return t('cu_ev_recite_wrong', { p });
            case 'deal': return t('cu_ev_deal', { p });
            case 'knock': return t('cu_ev_knock', { n: e.n });
            case 'keep': return t('cu_ev_keep', { p });
            case 'swap': return t('cu_ev_swap', { p, q });
            case 'cucu': return t('cu_ev_cucu', { p, q });
            case 'horse': return t('cu_ev_horse', { p });
            case 'deck': return t('cu_ev_deck', { p });
            case 'deck_king': return t('cu_ev_deck_king', { p });
            case 'reveal': return e.redraws ? t('cu_ev_reveal_tie', { p, n: e.redraws }) : t('cu_ev_reveal', { p });
            case 'life': return t(e.d < 0 ? 'cu_ev_life_minus' : 'cu_ev_life_plus', { p, why: t('cu_why_' + e.why) });
            case 'dead': return t('cu_ev_dead', { p });
            case 'back': return t('cu_ev_back', { p });
            case 'talk': return t('cu_ev_talk', { p, q });
            case 'admin_power': return t('cu_ev_admin_power', { p });
            case 'left': return t('cu_ev_left', { p });
            case 'end': return e.p ? t('cu_ev_end', { p }) : t('cu_ev_end_none');
            default: return '';
        }
    }
    const LOUD = ['life', 'dead', 'back', 'talk', 'recite_wrong', 'admin_power', 'cucu', 'end'];

    /** New events: buzz and flash on every phone, so nobody can change a life in silence. */
    function announce() {
        const u = ui();
        const evs = G().events;
        const loud = evs.filter((e) => e.id > u.lastEvent && LOUD.includes(e.t));
        if (u.lastEvent && loud.length) {
            C.vibrate([60, 40, 60]);
            u.flash = loud.slice(-2);
            u.flashUntil = Date.now() + 6000;               // stays up across the next polls
            setTimeout(() => C.scheduleRender(), 6100);
        }
        if (evs.length) u.lastEvent = evs[evs.length - 1].id;
        return Date.now() < u.flashUntil ? u.flash : [];
    }

    function feed() {
        const evs = G().events.slice(-8).reverse();
        return h('ol', { class: 'cu-feed' }, evs.map((e) => h('li', { class: LOUD.includes(e.t) ? 'loud ev-' + e.t : 'ev-' + e.t }, evText(e))));
    }

    function phaseView() {
        const g = G();
        const dealer = g.dealer;
        if (g.phase === 'recite') {
            if (isHost()) {
                return C.section(t('cu_recite_title', { p: name(dealer) }),
                    h('p', { class: 'muted small' }, t('cu_recite_host')),
                    h('ul', { class: 'cu-lives' }, g.order.map((id) => h('li', { class: g.lives && g.lives[id] > 0 ? '' : 'dead' },
                        h('span', null, name(id)), h('b', null, g.lives ? String(g.lives[id]) : '?')))),
                    h('div', { class: 'row2' },
                        h('button', { class: 'btn ghost', onclick: () => C.askConfirm(t('cu_recite_wrong_q', { p: name(dealer) }), t('cu_wrong'), () => C.run('recite', { ok: false }), true) }, t('cu_wrong')),
                        h('button', { class: 'btn primary', onclick: () => C.run('recite', { ok: true }) }, t('cu_right'))));
            }
            return C.section(t('cu_recite_title', { p: name(dealer) }), h('p', null, isMine(dealer) ? t('cu_recite_you') : t('cu_recite_wait', { p: name(dealer) })));
        }
        if (g.phase === 'knock') {
            if (isMine(dealer)) {
                return C.section(t('cu_knock_title'),
                    h('p', null, t('cu_knock_you')),
                    h('button', { class: 'btn primary big cu-knock', onclick: () => { C.vibrate(30); C.run('knock'); } }, t('cu_knock_btn', { n: g.knocks })));
            }
            return C.section(t('cu_knock_title'), h('div', { class: 'cu-hand' }, card(null)), h('p', null, t('cu_knock_wait', { p: name(dealer), n: g.knocks })));
        }
        if (g.phase === 'swap') {
            const turn = g.turn;
            const me = g.me.filter((m) => m.alive);
            const parts = [h('div', { class: 'cu-hand' }, me.map((m) => h('div', { class: 'cu-mine' },
                mine().length > 1 ? h('div', { class: 'small muted' }, name(m.player_id)) : null, card(m.card))))];
            if (turn && isMine(turn)) {
                const isDealer = turn === dealer;
                parts.push(h('p', { class: 'cu-turn' }, mine().length > 1 ? t('cu_your_turn_named', { p: name(turn) }) : t('cu_your_turn')));
                parts.push(h('div', { class: 'row2' },
                    h('button', { class: 'btn ghost big', onclick: () => C.run('keep') }, t('cu_keep')),
                    isDealer
                        ? h('button', { class: 'btn primary big', onclick: () => C.run('deck') }, t('cu_deck'))
                        : h('button', { class: 'btn primary big', onclick: () => C.run('swap') }, t('cu_swap_with', { p: name(nextAlive(turn)) }))));
            } else if (turn) {
                parts.push(h('p', { class: 'muted' }, turn === dealer ? t('cu_turn_dealer', { p: name(turn) }) : t('cu_turn_other', { p: name(turn), q: name(nextAlive(turn)) })));
            }
            const power = me.find((m) => m.can_admin_power);
            if (power) {
                parts.push(h('button', { class: 'btn ghost', onclick: () => C.askConfirm(t('cu_admin_power_q'), t('cu_admin_power'), () => C.run('admin_power', { player_id: power.player_id })) }, t('cu_admin_power')));
            }
            if (!me.length) parts.push(h('p', { class: 'muted' }, t('cu_you_are_out')));
            return C.section(t('cu_hand_n', { n: g.hand }), parts);
        }
        if (g.phase === 'confirm' && g.reveal) {
            const rev = g.reveal;
            const ids = Object.keys(rev.cards).map(Number).sort((a, b) => rev.cards[a][1] - rev.cards[b][1]);
            const u = ui();
            const loser = u.loser || rev.loser;
            return C.section(t('cu_reveal_title'),
                h('ul', { class: 'cu-reveal' }, ids.map((id) => h('li', { class: id === rev.loser ? 'loser' : '' },
                    card(rev.cards[id], true), h('span', null, name(id)), id === rev.loser ? h('b', null, t('cu_lowest')) : null))),
                rev.redraws && rev.redraws.length ? h('p', { class: 'small muted' }, t('cu_redraws', { n: rev.redraws.length }) + ' ' +
                    rev.redraws.map((r) => Object.entries(r).map(([p, c]) => `${name(+p)}: ${cardText(c)}`).join(', ')).join(' / ')) : null,
                isHost()
                    ? [h('label', { class: 'cu-pick' }, t('cu_who_loses'),
                        h('select', { onchange: (e) => { u.loser = +e.target.value; C.scheduleRender(); } },
                            g.alive.map((id) => h('option', { value: id, selected: id === loser }, name(id))))),
                    h('button', { class: 'btn primary big', onclick: () => { C.run('confirm', { player_id: loser }); u.loser = null; } }, t('cu_confirm', { p: name(loser) }))]
                    : h('p', { class: 'muted' }, t('cu_wait_host')));
        }
        return null;
    }

    /** Capotavola tools: always there for the host, everything they do is announced on every phone. */
    function hostPanel() {
        if (!isHost()) return null;
        const g = G();
        const u = ui();
        const living = g.alive.filter((id) => id !== g.dealer);
        const dead = g.order.filter((id) => !g.alive.includes(id) && C.playerById(id));
        const pick = (key, list) => h('select', { onchange: (e) => { u[key] = +e.target.value; } },
            h('option', { value: '' }, '—'), list.map((id) => h('option', { value: id, selected: u[key] === id }, name(id))));
        return h('details', { class: 'panel cu-host' },
            h('summary', null, t('cu_host_tools')),
            h('div', { class: 'cu-host-row' },
                h('span', null, t('cu_talk_label')), pick('living', living), h('span', null, '→'), pick('dead', dead),
                h('button', { class: 'btn small', disabled: !dead.length, onclick: () => {
                    if (!u.living || !u.dead) { C.toast(t('cu_pick_both')); return; }
                    C.run('talk', { player_id: u.living, dead_id: u.dead });
                } }, t('cu_talk_btn'))),
            h('div', { class: 'cu-host-row' },
                h('span', null, t('cu_life_label')), pick('target', g.order.filter((id) => C.playerById(id))),
                h('button', { class: 'btn small', onclick: () => u.target && C.run('life', { player_id: u.target, delta: -1 }) }, '−1'),
                h('button', { class: 'btn small', onclick: () => u.target && C.run('life', { player_id: u.target, delta: 1 }) }, '+1')),
            h('p', { class: 'small muted' }, t('cu_host_note')),
            h('button', { class: 'btn ghost', onclick: () => C.askConfirm(t('cu_end_q'), t('cu_end'), () => C.run('end'), true) }, t('cu_end')));
    }

    function playView() {
        const g = G();
        const flash = announce();
        return h('div', { class: 'stack cu' },
            !C.netOk ? h('div', { class: 'banner warn' }, t('connection_lost')) : null,
            flash.length ? h('div', { class: 'cu-flash', role: 'status' }, flash.map((e) => h('div', null, evText(e)))) : null,
            h('div', { class: 'cu-top' }, h('span', null, t('cu_hand_n', { n: g.hand })), h('span', null, t('cu_dealer_is', { p: name(g.dealer) }))),
            phaseView(),
            g.rules.admin_power ? h('p', { class: 'small muted center' }, t('cu_admin_power_declared')) : null,
            C.section(t('cu_feed_title'), feed()),
            hostPanel());
    }

    function resultCard() {
        const g = G();
        const res = g.result || { winner: null, reason: 'host_ended', lives: {} };
        return h('section', { class: 'panel result cu-result' },
            h('div', { class: 'stamp result-stamp' }, res.winner ? t('cu_winner', { p: name(res.winner) }) : t('cu_no_winner')),
            h('div', { class: 'muted' }, t('cu_reason_' + res.reason)),
            h('ul', { class: 'result-list' }, g.order.filter((id) => C.playerById(id)).map((id) => h('li', null,
                h('span', null, name(id)), h('span', { class: 'role' }, t('cu_lives_n', { n: (res.lives || {})[id] ?? 0 }))))));
    }

    function summary() {
        const s = C.state.settings;
        const chips = [t('cu_sum_lives', { n: s.lives })];
        if (s.cavallo_salta) chips.push(t('cu_set_horse'));
        if (s.re_mazzo_perde) chips.push(t('cu_set_kingdeck'));
        if (s.admin_power) chips.push(t('cu_set_admin'));
        if (s.scores) chips.push(t('set_scores'));
        return h('div', { class: 'chips' }, chips.map((c) => h('span', { class: 'chip soft' }, c)));
    }

    function settings(s, { toggle, stepper }) {
        return [
            h('div', { class: 'set-row' },
                h('div', { class: 'set-text' }, h('span', { class: 'set-title' }, t('cu_set_lives')), h('span', { class: 'set-desc' }, t('cu_set_lives_d'))),
                stepper('lives', t('cu_lives_word'), 1, 9)),
            h('h3', { class: 'set-group' }, t('cu_set_powers')),
            toggle('cavallo_salta', t('cu_set_horse'), t('cu_set_horse_d')),
            toggle('re_mazzo_perde', t('cu_set_kingdeck'), t('cu_set_kingdeck_d')),
            toggle('admin_power', t('cu_set_admin'), t('cu_set_admin_d')),
            toggle('scores', t('set_scores'), t('cu_set_scores_d')),
        ];
    }

    return {
        init(core) { C = core; return { playView, resultCard, summary, settings }; },
    };
})();
