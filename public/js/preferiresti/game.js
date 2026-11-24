// public/js/preferiresti/game.js
// "Would you rather" screens. Runs inside public/js/spia/app.js (rooms, phones, settings, help, render loop); this file draws the match.
// Two choices, A and B, on a screen split in two halves. Everybody picks in secret; the server sends the split (and only then who
// chose what) after the round, never before. The minority scores. On a shared phone each local player is asked in turn behind a
// "pass the phone" screen. The countdown is drawn from the time left that the server reports, so a wrong clock changes nothing.
window.PreferirestiGame = (() => {
    'use strict';
    let C = null;
    let ticker = null;

    const G = () => C.state.preferiresti;
    const t = (k, v) => C.t(k, v);
    const h = (...a) => C.h(...a);
    const name = (id) => C.pname(id) || '?';
    const mine = () => C.myPlayers().map((p) => p.id);
    const isMine = (pid) => mine().includes(pid);
    const isHost = () => !!C.state.is_host;
    const lang = () => (window.SpiaApp && window.SpiaApp.lang) || 'en';
    const LOUD = ['fly', 'tie', 'same', 'none', 'left', 'end'];

    /** Per match UI state: deadline anchor (a new poll does not restart the countdown), the picked side, flashes, timers. */
    function ui() {
        const g = G();
        if (!C.ui.pf || C.ui.pf.match !== g.match) C.ui.pf = { match: g.match, lastEvent: 0, flash: [], flashUntil: 0, anchor: null, timer: null, pick: null, pickKey: '' };
        return C.ui.pf;
    }

    function endsAt(kind, left) {
        const u = ui(), g = G();
        const key = `${kind}:${g.round}:${g.phase}`;
        if (!u.anchor || u.anchor.key !== key) u.anchor = { key, at: Date.now() + left * 1000 };
        return u.anchor.at;
    }

    /** One refresh right after the time is up, so the round is resolved without waiting for the next 2 s poll. */
    function refreshAt(at) {
        const u = ui();
        clearTimeout(u.timer);
        u.timer = setTimeout(() => { if (window.SpiaApp) window.SpiaApp.refresh(); }, Math.max(150, at - Date.now() + 250));
    }

    function countdown(at, total) {
        const left = Math.max(0, (at - Date.now()) / 1000);
        const bar = h('div', { class: 'pf-bar', 'aria-hidden': 'true' }, h('div', { class: 'pf-bar-fill', style: `animation-duration:${total}s;animation-delay:-${Math.max(0, total - left).toFixed(2)}s` }));
        const num = h('span', { class: 'pf-count', 'aria-live': 'off' }, String(Math.ceil(left)));
        clearInterval(ticker);
        ticker = setInterval(() => {
            if (!num.isConnected) { clearInterval(ticker); return; }
            num.textContent = String(Math.max(0, Math.ceil((at - Date.now()) / 1000)));
        }, 250);
        return h('div', { class: 'pf-clock' }, bar, num);
    }

    const L = () => (['it', 'en', 'es', 'fr', 'de'].includes(lang()) ? lang() : 'en');
    const optionText = (q, side) => q[side][L()] || q[side].en;

    function evText(e) {
        const p = e.p ? name(e.p) : '';
        switch (e.t) {
            case 'start': return t('pf_ev_start');
            case 'round': return t('pf_ev_round', { n: e.n });
            case 'fly': return t('pf_ev_fly', { p });
            case 'tie': return t('pf_ev_tie');
            case 'same': return t('pf_ev_same');
            case 'none': return t('pf_ev_none');
            case 'left': return t('pf_ev_left', { p });
            case 'end': return t('pf_ev_end');
            default: return '';
        }
    }

    function announce() {
        const u = ui();
        const evs = G().events;
        const loud = evs.filter((e) => e.id > u.lastEvent && LOUD.includes(e.t));
        if (u.lastEvent && loud.length) {
            C.vibrate(loud.some((e) => isMine(e.p) && e.t === 'fly') ? [200, 60, 200] : [60, 40, 60]);
            u.flash = loud.slice(-2);
            u.flashUntil = Date.now() + 5000;
            setTimeout(() => C.scheduleRender(), 5100);
        }
        if (evs.length) u.lastEvent = evs[evs.length - 1].id;
        return Date.now() < u.flashUntil ? u.flash : [];
    }

    /** The row of players: who already chose (only that, never what). */
    function stage() {
        const g = G();
        const voting = g.phase === 'vote';
        return h('ul', { class: 'pf-crowd', 'aria-label': t('pf_players') }, g.order.filter((id) => C.playerById(id)).map((id) => {
            const active = g.active.includes(id);
            const done = voting && g.voted.includes(id);
            return h('li', { class: 'pf-chip' + (active ? '' : ' gone') + (isMine(id) ? ' me' : '') + (done ? ' done' : '') },
                h('span', { class: 'pf-chip-name' }, name(id)),
                h('span', { class: 'pf-chip-state', 'aria-hidden': 'true' }, active && voting ? (done ? '✓' : '…') : ''),
                done ? h('span', { class: 'sr-only' }, t('pf_voted_mark')) : null);
        }));
    }

    function voteView() {
        const g = G(), q = g.q, u = ui();
        const todo = g.me.filter((m) => m.active && !m.voted);
        const at = endsAt('v', q.left);
        refreshAt(at);
        const title = t('pf_round_of', { n: g.round, m: g.rules.rounds });
        const lead = h('p', { class: 'pf-lead' }, t('pf_lead'));
        if (todo.length) {
            const m = todo[0];
            const shared = mine().length > 1;
            if (shared && C.ui.passed !== m.player_id) {
                return C.passView(m.player_id, t('pf_pass_to'), () => { C.ui.passed = m.player_id; C.ui.heldOnce = null; u.pick = null; C.scheduleRender(); });
            }
            const key = `${g.round}:${m.player_id}`;
            if (u.pickKey !== key) { u.pickKey = key; u.pick = null; }
            const half = (side) => h('button', {
                class: `pf-half ${side}` + (u.pick === side ? ' on' : '') + (u.pick && u.pick !== side ? ' off' : ''), 'aria-pressed': String(u.pick === side),
                onclick: () => { C.vibrate(15); u.pick = side; C.scheduleRender(true); },
            }, h('span', { class: 'pf-letter', 'aria-hidden': 'true' }, side.toUpperCase()), h('span', { class: 'pf-opt' }, h('span', { class: 'sr-only' }, t('pf_option_' + side) + ': '), optionText(q, side)));
            return h('section', { class: 'pf-round' },
                h('h2', { class: 'sr-only' }, title), countdown(at, q.time), lead,
                shared ? h('p', { class: 'pf-who' }, t('pf_voting', { p: name(m.player_id) })) : null,
                h('div', { class: 'pf-split vote', role: 'group', 'aria-label': t('pf_choose') }, half('a'), h('div', { class: 'pf-line', 'aria-hidden': 'true' }, h('span', null, t('pf_or'))), half('b')),
                h('button', {
                    class: 'btn primary big pf-lock', disabled: u.pick === null,
                    onclick: async () => {
                        const side = u.pick;
                        if (side === null) return;
                        C.vibrate(25);
                        C.ui.passed = null;
                        u.pick = null;
                        await C.run('vote', { player_id: m.player_id, side });
                    },
                }, t('pf_lock')));
        }
        const out = !g.me.some((m) => m.active);
        return h('section', { class: 'pf-round' },
            h('h2', { class: 'sr-only' }, title), countdown(at, q.time), lead,
            h('div', { class: 'pf-split vote waiting' }, h('p', { class: 'pf-opt-wait a' }, optionText(q, 'a')), h('div', { class: 'pf-line', 'aria-hidden': 'true' }, h('span', null, t('pf_or'))), h('p', { class: 'pf-opt-wait b' }, optionText(q, 'b'))),
            h('p', { class: 'pf-wait' }, out ? t('pf_gone') : t('pf_wait', { n: g.voted.length, m: g.active.length })));
    }

    function revealView() {
        const g = G(), q = g.q, r = g.reveal;
        if (!q || !r) return null;
        const at = endsAt('r', g.next_left || 0);
        refreshAt(at);
        const total = r.a + r.b;
        const pa = total ? Math.round((r.a / total) * 100) : 50, pb = total ? 100 - pa : 50;
        const side = (s, pct, n) => {
            const who = Object.keys(r.choices).map(Number).filter((id) => r.choices[id] === s && C.playerById(id));
            return h('div', { class: `pf-half rv ${s}` + (r.minority === s ? ' min' : ''), style: `--w:${Math.max(pct, 22)}` },
                h('span', { class: 'pf-letter', 'aria-hidden': 'true' }, s.toUpperCase()),
                h('span', { class: 'pf-opt' }, h('span', { class: 'sr-only' }, t('pf_option_' + s) + ': '), optionText(q, s)),
                h('span', { class: 'pf-pct' }, `${pct}%`, h('span', { class: 'pf-n' }, t(n === 1 ? 'pf_picks_one' : 'pf_picks_n', { n }))),
                who.length ? h('ul', { class: 'pf-who-list', 'aria-label': t('pf_chose_' + s) }, who.map((id) => h('li', { class: 'pf-pill' + (r.scorers.includes(id) ? ' fly' : '') + (isMine(id) ? ' me' : '') },
                    name(id), r.scorers.includes(id) ? h('span', { class: 'sr-only' }, ' ' + t('pf_point_mark')) : null))) : null);
        };
        let headline;
        if (!total) headline = t('pf_rv_none');
        else if (r.minority) headline = t('pf_rv_fly', { p: r.scorers.map(name).join(', ') });
        else headline = t(r.a === r.b ? 'pf_rv_tie' : 'pf_rv_same');
        const meFly = r.scorers.some(isMine);
        return h('section', { class: 'pf-round' },
            h('h2', { class: 'pf-title' }, t('pf_reveal_title')),
            h('div', { class: 'pf-split rv', style: `--pa:${pa}` }, side('a', pa, r.a), h('div', { class: 'pf-line', 'aria-hidden': 'true' }, h('span', null, t('pf_or'))), side('b', pb, r.b)),
            h('p', { class: 'pf-verdict' + (meFly ? ' hit' : ''), role: 'status' }, headline),
            r.minority ? h('p', { class: 'pf-explain' }, t('pf_explain')) : null,
            h('p', { class: 'pf-next muted small' }, t(r.last ? 'pf_results_in' : 'pf_next_in'), ' ', h('b', { class: 'pf-count' }, String(Math.ceil(Math.max(0, (at - Date.now()) / 1000))))),
            isHost() ? h('button', { class: 'btn ghost', onclick: () => C.run('next') }, t(r.last ? 'pf_see_results' : 'pf_next')) : null);
    }

    function feed() {
        const evs = G().events.slice(-8).reverse();
        return h('ol', { class: 'pf-feed' }, evs.map((e) => h('li', { class: LOUD.includes(e.t) ? 'loud ev-' + e.t : 'ev-' + e.t }, evText(e))));
    }

    function hostPanel() {
        if (!isHost()) return null;
        return h('details', { class: 'panel pf-host' },
            h('summary', null, t('pf_host_tools')),
            h('p', { class: 'small muted' }, t('pf_host_note')),
            h('button', { class: 'btn ghost', onclick: () => C.askConfirm(t('pf_end_q'), t('pf_end'), () => C.run('end'), true) }, t('pf_end')));
    }

    function playView() {
        const g = G();
        const flash = announce();
        return h('div', { class: 'stack pf' },
            !C.netOk ? h('div', { class: 'banner warn' }, t('connection_lost')) : null,
            flash.length ? h('div', { class: 'pf-flash', role: 'status' }, flash.map((e) => h('div', null, evText(e)))) : null,
            h('div', { class: 'pf-top' }, h('span', null, t('pf_round_of', { n: g.round, m: g.rules.rounds })), h('span', null, t('pf_seconds_n', { n: g.rules.time }))),
            stage(),
            g.phase === 'vote' && g.q ? voteView() : revealView(),
            C.section(t('pf_feed_title'), feed()),
            hostPanel());
    }

    function resultCard() {
        const g = G();
        const res = g.result || { reason: 'host_ended', rows: [], titles: {} };
        return h('section', { class: 'panel result pf-result' },
            h('div', { class: 'stamp result-stamp' }, t('pf_standings')),
            h('div', { class: 'muted' }, t('pf_reason_' + res.reason)),
            h('ol', { class: 'pf-standings' }, res.rows.filter((r) => C.playerById(r.p)).map((r) => {
                const title = res.titles[r.p];
                return h('li', { class: 'pf-stand' + (title ? ' titled' : '') },
                    h('span', { class: 'pf-stand-main' }, h('b', null, name(r.p)), title ? h('span', { class: 'pf-badge' }, t('pf_title_' + title)) : null,
                        title ? h('span', { class: 'pf-title-d muted small' }, t('pf_title_' + title + '_d')) : null),
                    h('span', { class: 'pf-stand-n' }, t('pf_points_n', { n: r.pts, m: r.maj })));
            })));
    }

    function summary() {
        const s = C.state.settings;
        const cats = ['calm', 'absurd', 'spicy'].filter((k) => s[k]).map((k) => t('pf_cat_' + k));
        const chips = [t('pf_sum_rounds', { n: s.rounds }), t('pf_seconds_n', { n: s.time }), ...cats];
        return h('div', { class: 'chips' }, chips.map((c) => h('span', { class: 'chip soft' }, c)));
    }

    function settings(s, { set, toggle, host }) {
        const choice = (key, values, label) => h('div', { class: 'pf-choices', role: 'group', 'aria-label': label }, values.map((v) => h('button', {
            class: 'btn small' + (s[key] === v ? ' primary' : ' ghost'), disabled: !host, 'aria-pressed': String(s[key] === v), onclick: () => set({ [key]: v }),
        }, key === 'time' ? t('pf_seconds_n', { n: v }) : String(v))));
        return [
            h('div', { class: 'set-row' },
                h('div', { class: 'set-text' }, h('span', { class: 'set-title' }, t('pf_set_rounds')), h('span', { class: 'set-desc' }, t('pf_set_rounds_d'))),
                choice('rounds', [5, 10, 15], t('pf_set_rounds'))),
            h('div', { class: 'set-row' },
                h('div', { class: 'set-text' }, h('span', { class: 'set-title' }, t('pf_set_time')), h('span', { class: 'set-desc' }, t('pf_set_time_d'))),
                choice('time', [20, 30, 45], t('pf_set_time'))),
            h('h3', { class: 'set-group' }, t('pf_set_cats')),
            toggle('calm', t('pf_cat_calm'), ''),
            toggle('absurd', t('pf_cat_absurd'), ''),
            toggle('spicy', t('pf_cat_spicy'), t('pf_cat_spicy_d')),
        ];
    }

    return {
        init(core) { C = core; return { playView, resultCard, summary, settings }; },
    };
})();
