// public/js/bomba/game.js
// "The bomb" screens. Runs inside public/js/spia/app.js (rooms, phones, settings, help, render loop); this file draws the match.
// A bomb with a hidden fuse goes round: the holder reads the prompt, says an answer out loud and presses "Pass", choosing who gets it.
// The fuse is decided and counted by the SERVER only: the page never knows the time left (no countdown, only an animation of
// constant speed), it just asks the server for news about once a second while a bomb is armed. One shared phone: the screen
// always shows who holds the bomb and the pass button for them, so the phone travels with the bomb.
window.BombaGame = (() => {
    'use strict';
    let C = null;

    const G = () => C.state.bomba;
    const t = (k, v) => C.t(k, v);
    const h = (...a) => C.h(...a);
    const name = (id) => C.pname(id) || '?';
    const mine = () => C.myPlayers().map((p) => p.id);
    const isMine = (pid) => mine().includes(pid);
    const isHost = () => !!C.state.is_host;
    const lang = () => (window.SpiaApp && window.SpiaApp.lang) || 'en';
    const L = () => (['it', 'en', 'es', 'fr', 'de'].includes(lang()) ? lang() : 'en');
    const LOUD = ['boom', 'out', 'pass', 'left', 'end'];
    const NS = 'http://www.w3.org/2000/svg';

    /** Per match UI state: last event seen, flash, the chosen target, the fast refresh timer. */
    function ui() {
        const g = G();
        if (!C.ui.bm || C.ui.bm.match !== g.match) C.ui.bm = { match: g.match, lastEvent: 0, flash: [], flashUntil: 0, target: null, targetKey: '', timer: null, busy: false };
        return C.ui.bm;
    }

    /** While a bomb is armed ask the server for news every second (the server decides when it blows, the page only learns it). */
    function keepPolling(on) {
        const u = ui();
        if (!on) { clearInterval(u.timer); u.timer = null; return; }
        if (u.timer) return;
        u.timer = setInterval(() => {
            const b = window.SpiaApp && window.SpiaApp.state && window.SpiaApp.state.bomba;
            if (!b || b.phase !== 'armed') { keepPolling(false); return; }
            if (!document.hidden) window.SpiaApp.refresh();
        }, 1000);
    }

    function evText(e) {
        const p = e.p ? name(e.p) : '';
        switch (e.t) {
            case 'start': return t('bm_ev_start');
            case 'round': return t('bm_ev_round', { n: e.n, p });
            case 'pass': return t('bm_ev_pass', { p, q: name(e.to) });
            case 'boom': return t('bm_ev_boom', { p });
            case 'out': return t('bm_ev_out', { p });
            case 'left': return t('bm_ev_left', { p });
            case 'end': return t('bm_ev_end');
            default: return '';
        }
    }

    function announce() {
        const u = ui();
        const evs = G().events;
        const loud = evs.filter((e) => e.id > u.lastEvent && LOUD.includes(e.t));
        if (u.lastEvent && loud.length) {
            if (loud.some((e) => e.t === 'boom' || e.t === 'out')) C.vibrate([300, 80, 300, 80, 600]);
            else if (loud.some((e) => e.t === 'pass' && isMine(e.to))) C.vibrate([80, 40, 80]);
            u.flash = loud.slice(-2);
            u.flashUntil = Date.now() + 4000;
            setTimeout(() => C.scheduleRender(), 4100);
        }
        if (evs.length) u.lastEvent = evs[evs.length - 1].id;
        return Date.now() < u.flashUntil ? u.flash : [];
    }

    const hearts = (n, max) => h('span', { class: 'bm-hearts', 'aria-hidden': 'true' }, '♥'.repeat(Math.max(0, n)) + (max > 1 ? '♡'.repeat(Math.max(0, max - n)) : ''));

    /** The row of players: lives, who holds the bomb. */
    function crowd() {
        const g = G();
        return h('ul', { class: 'bm-crowd', 'aria-label': t('bm_players') }, g.order.filter((id) => C.playerById(id)).map((id) => {
            const alive = g.alive.includes(id);
            const holder = g.holder === id;
            return h('li', { class: 'bm-chip' + (alive ? '' : ' gone') + (isMine(id) ? ' me' : '') + (holder ? ' holder' : '') },
                h('span', { class: 'bm-chip-name' }, name(id)),
                alive ? [hearts(g.lives[id], g.max_lives), h('span', { class: 'sr-only' }, t('bm_lives_n', { n: g.lives[id] }))] : h('span', { class: 'bm-chip-state' }, t('bm_out')),
                holder ? h('span', { class: 'sr-only' }, ' ' + t('bm_holds_mark')) : null);
        }));
    }

    /** The bomb drawn as SVG: round body, a fuse and a spark. Only a CSS animation of constant speed moves it (it does not show the time). */
    function bombArt(exploded) {
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 200 200');
        svg.setAttribute('class', 'bm-art' + (exploded ? ' boom' : ''));
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); svg.appendChild(e); return e; };
        if (exploded) {
            el('polygon', { class: 'bm-blast', points: '100,8 118,60 172,32 144,86 194,100 144,114 172,168 118,140 100,192 82,140 28,168 56,114 6,100 56,86 28,32 82,60' });
            el('polygon', { class: 'bm-blast-in', points: '100,48 112,80 146,66 126,96 150,106 122,116 138,146 108,130 100,158 92,130 62,146 78,116 50,106 74,96 54,66 88,80' });
            return svg;
        }
        const g = el('g', { class: 'bm-body' });
        const add = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); g.appendChild(e); };
        add('path', { class: 'bm-wick', d: 'M112 54 C124 34 140 36 148 20', fill: 'none' });
        add('circle', { class: 'bm-ball', cx: '100', cy: '116', r: '62' });
        add('rect', { class: 'bm-cap', x: '84', y: '44', width: '36', height: '22', rx: '4' });
        add('path', { class: 'bm-shine', d: 'M64 104 A40 40 0 0 1 90 78', fill: 'none' });
        add('path', { class: 'bm-band', d: 'M44 124 H156', fill: 'none' });
        const sp = document.createElementNS(NS, 'g');
        sp.setAttribute('class', 'bm-spark');
        for (const [x1, y1, x2, y2] of [[148, 20, 148, 4], [148, 20, 164, 12], [148, 20, 134, 6], [148, 20, 166, 26]]) {
            const l = document.createElementNS(NS, 'line');
            for (const [k, v] of Object.entries({ x1, y1, x2, y2 })) l.setAttribute(k, String(v));
            sp.appendChild(l);
        }
        g.appendChild(sp);
        svg.appendChild(g);
        return svg;
    }

    function promptCard(q) {
        if (!q) return null;
        const txt = q.text[L()] || q.text.en;
        if (q.k === 'syl') {
            return h('div', { class: 'bm-prompt syl' }, h('span', { class: 'bm-prompt-lead' }, t('bm_syl_lead')), h('span', { class: 'bm-syl', lang: L() }, txt));
        }
        return h('div', { class: 'bm-prompt' }, h('span', { class: 'bm-prompt-lead' }, t('bm_cat_lead')), h('span', { class: 'bm-cat' }, txt));
    }

    function armedView() {
        const g = G(), u = ui();
        keepPolling(true);
        const holder = g.holder;
        const mineNow = holder !== null && isMine(holder);
        const head = h('div', { class: 'bm-holder', role: 'status' },
            h('span', { class: 'bm-holder-lead' }, t(mineNow && mine().length === 1 ? 'bm_you_hold' : 'bm_holds')),
            mineNow && mine().length === 1 ? null : h('span', { class: 'bm-holder-name' }, name(holder)));
        const parts = [h('h2', { class: 'sr-only' }, t('bm_round_n', { n: g.round })), bombArt(false), head, promptCard(g.q)];
        if (mineNow) {
            const targets = g.alive.filter((id) => id !== holder && C.playerById(id));
            const key = `${g.round}:${holder}:${g.passes}`;
            if (u.targetKey !== key) {
                u.targetKey = key;
                const pos = g.order.indexOf(holder);
                u.target = null;
                for (let i = 1; i <= g.order.length && u.target === null; i++) { const c = g.order[(pos + i) % g.order.length]; if (targets.includes(c)) u.target = c; }
            }
            parts.push(
                h('p', { class: 'bm-say' }, t(mine().length > 1 ? 'bm_say_shared' : 'bm_say', { p: name(holder) })),
                h('div', { class: 'bm-targets', role: 'group', 'aria-label': t('bm_pick_target') }, targets.map((id) => h('button', {
                    class: 'bm-target' + (u.target === id ? ' on' : ''), 'aria-pressed': String(u.target === id),
                    onclick: () => { C.vibrate(12); u.target = id; C.scheduleRender(true); },
                }, h('span', null, name(id)), hearts(g.lives[id], g.max_lives)))),
                h('button', {
                    class: 'bm-pass', disabled: u.target === null || u.busy,
                    onclick: async () => {
                        const to = u.target;
                        if (to === null || u.busy) return;
                        u.busy = true;
                        C.vibrate(30);
                        try { await C.run('pass', { player_id: holder, to }); } finally { u.busy = false; }
                    },
                }, h('span', { class: 'bm-pass-big' }, t('bm_pass')), u.target !== null ? h('span', { class: 'bm-pass-to' }, t('bm_pass_to', { p: name(u.target) })) : null));
        } else {
            parts.push(h('p', { class: 'bm-wait' }, t('bm_wait', { p: name(holder) })));
        }
        return h('section', { class: 'bm-round' }, parts);
    }

    function boomView() {
        const g = G(), b = g.boom;
        keepPolling(false);
        if (!b) return null;
        const left = Math.ceil(g.next_left || 0);
        return h('section', { class: 'bm-round boom' },
            h('h2', { class: 'sr-only' }, t('bm_round_n', { n: g.round })),
            bombArt(true),
            h('p', { class: 'bm-boom-title', role: 'status' }, t('bm_boom')),
            h('p', { class: 'bm-verdict' }, t(b.out ? 'bm_boom_out' : 'bm_boom_life', { p: name(b.p) })),
            b.out ? null : h('p', { class: 'bm-left-hearts' }, hearts(b.lives, g.max_lives), h('span', { class: 'sr-only' }, t('bm_lives_n', { n: b.lives }))),
            h('p', { class: 'bm-next muted small' }, t('bm_next_in', { n: left })),
            isHost() ? h('button', { class: 'btn ghost', onclick: () => C.run('next') }, t('bm_next')) : null);
    }

    function feed() {
        const evs = G().events.slice(-8).reverse();
        return h('ol', { class: 'bm-feed' }, evs.map((e) => h('li', { class: LOUD.includes(e.t) ? 'loud ev-' + e.t : 'ev-' + e.t }, evText(e))));
    }

    function hostPanel() {
        if (!isHost()) return null;
        return h('details', { class: 'panel bm-host' },
            h('summary', null, t('bm_host_tools')),
            h('p', { class: 'small muted' }, t('bm_host_note')),
            h('button', { class: 'btn ghost', onclick: () => C.askConfirm(t('bm_end_q'), t('bm_end'), () => C.run('end'), true) }, t('bm_end')));
    }

    function playView() {
        const g = G();
        const flash = announce();
        const shell = g.phase === 'armed' ? armedView() : boomView();
        if (g.phase !== 'armed') keepPolling(false);
        return h('div', { class: 'stack bm' + (g.phase === 'armed' ? ' armed' : '') },
            !C.netOk ? h('div', { class: 'banner warn' }, t('connection_lost')) : null,
            flash.length ? h('div', { class: 'bm-flash', role: 'status' }, flash.map((e) => h('div', null, evText(e)))) : null,
            h('div', { class: 'bm-top' }, h('span', null, t('bm_round_n', { n: g.round })), h('span', null, t('bm_alive_n', { n: g.alive.length }))),
            crowd(), shell,
            C.section(t('bm_feed_title'), feed()),
            hostPanel());
    }

    function resultCard() {
        const g = G();
        keepPolling(false);
        const res = g.result || { reason: 'host_ended', rows: [], winner: null };
        return h('section', { class: 'panel result bm-result' },
            h('div', { class: 'stamp result-stamp' }, res.winner ? t('bm_winner', { p: name(res.winner) }) : t('bm_standings')),
            h('div', { class: 'muted' }, t('bm_reason_' + res.reason)),
            h('ol', { class: 'bm-standings' }, res.rows.filter((r) => C.playerById(r.p)).map((r) => h('li', { class: 'bm-stand' + (res.winner === r.p ? ' win' : '') },
                h('span', { class: 'bm-stand-main' }, h('b', null, name(r.p)), r.lives > 0 ? hearts(r.lives, g.max_lives) : null, r.lives > 0 ? h('span', { class: 'sr-only' }, t('bm_lives_n', { n: r.lives })) : null),
                h('span', { class: 'bm-stand-n' }, t('bm_stand_n', { b: r.booms, s: r.passes }))))));
    }

    function summary() {
        const s = C.state.settings;
        const chips = [t('bm_sum_lives', { n: s.lives }), t('bm_kind_' + s.kind), t('bm_sum_fuse', { n: s.fuse })];
        return h('div', { class: 'chips' }, chips.map((c) => h('span', { class: 'chip soft' }, c)));
    }

    function settings(s, { set, host }) {
        const choice = (key, values, label, text) => h('div', { class: 'bm-choices', role: 'group', 'aria-label': label }, values.map((v) => h('button', {
            class: 'btn small' + (s[key] === v ? ' primary' : ' ghost'), disabled: !host, 'aria-pressed': String(s[key] === v), onclick: () => set({ [key]: v }),
        }, text(v))));
        const row = (title, desc, ctrl) => h('div', { class: 'set-row' }, h('div', { class: 'set-text' }, h('span', { class: 'set-title' }, title), h('span', { class: 'set-desc' }, desc)), ctrl);
        return [
            row(t('bm_set_lives'), t('bm_set_lives_d'), choice('lives', [1, 3, 5], t('bm_set_lives'), String)),
            row(t('bm_set_kind'), t('bm_set_kind_d'), choice('kind', ['cat', 'syl', 'mix'], t('bm_set_kind'), (v) => t('bm_kind_' + v))),
            row(t('bm_set_fuse'), t('bm_set_fuse_d'), choice('fuse', [25, 35, 45], t('bm_set_fuse'), (v) => t('bm_seconds_n', { n: v }))),
        ];
    }

    return {
        init(core) { C = core; return { playView, resultCard, summary, settings }; },
    };
})();
