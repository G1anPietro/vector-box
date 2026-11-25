// public/js/bingo/game.js
// "Lesson bingo" screens. Runs inside public/js/spia/app.js (rooms, phones, settings, help, render loop); this file draws the match.
// Each player has a card (4x4 or 5x5) of phrases written by the group; the SERVER deals it, keeps every mark and checks every "BINGO!".
// Nothing here makes a sound; a light vibration is the only feedback. Every phrase is put in with textContent (plain text only).
// On a shared phone a chooser + "pass the phone" screen shows one card at a time.
window.BingoGame = (() => {
    'use strict';
    let C = null;

    const G = () => C.state.bingo;
    const t = (k, v) => C.t(k, v);
    const h = (...a) => C.h(...a);
    const name = (id) => C.pname(id) || '?';
    const mine = () => C.myPlayers().map((p) => p.id);
    const isMine = (pid) => mine().includes(pid);
    const isHost = () => !!C.state.is_host;
    const lang = () => (window.SpiaApp && window.SpiaApp.lang) || 'en';
    const LISTS = ['lesson', 'meeting', 'dinner', 'football', 'call', 'mix'];
    const LOUD = ['bingo', 'end', 'left'];

    /** Per match UI state: last event seen, the flash, which card a shared phone shows, the host panel open or not. */
    function ui() {
        const g = G();
        if (!C.ui.bg || C.ui.bg.match !== g.match) C.ui.bg = { match: g.match, lastEvent: 0, flash: [], flashUntil: 0, cur: null, hostOpen: false };
        return C.ui.bg;
    }

    function evText(e) {
        const g = G();
        switch (e.t) {
            case 'start': return t('bg_ev_start');
            case 'bingo': return t('bg_ev_bingo', { p: name(e.p), n: e.place });
            case 'said': return t('bg_ev_said', { t: g.pool[e.i] || '' });
            case 'left': return t('bg_ev_left', { p: name(e.p) });
            case 'end': return t('bg_ev_end');
            default: return '';
        }
    }

    function announce() {
        const u = ui();
        const evs = G().events;
        const loud = evs.filter((e) => e.id > u.lastEvent && LOUD.includes(e.t));
        if (u.lastEvent && loud.length) {
            C.vibrate(loud.some((e) => e.t === 'bingo') ? [40, 40, 40] : 30);   // light, optional: no sound anywhere
            u.flash = loud.slice(-2);
            u.flashUntil = Date.now() + 5000;
            setTimeout(() => C.scheduleRender(), 5100);
        }
        if (evs.length) u.lastEvent = evs[evs.length - 1].id;
        return Date.now() < u.flashUntil ? u.flash : [];
    }

    /** The emblem: a notebook square with a marker tick. */
    function art() {
        const NS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 64 64');
        svg.setAttribute('class', 'bg-art');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); svg.appendChild(e); };
        el('rect', { class: 'bg-art-page', x: '6', y: '6', width: '52', height: '52', rx: '4' });
        el('path', { class: 'bg-art-grid', d: 'M19 6v52M32 6v52M45 6v52M6 19h52M6 32h52M6 45h52' });
        el('rect', { class: 'bg-art-hi', x: '19', y: '32', width: '13', height: '13' });
        el('path', { class: 'bg-art-tick', d: 'M10 40l7 8 14-24' });
        return svg;
    }

    /** Everybody: the number of squares marked, the place won. Never which squares. */
    function crowd() {
        const g = G();
        const place = (id) => (g.winners.find((w) => w.p === id) || {}).place || null;
        return h('ul', { class: 'bg-crowd', 'aria-label': t('bg_players') }, g.order.filter((id) => C.playerById(id)).map((id) => {
            const gone = !g.active.includes(id);
            const pl = place(id);
            return h('li', { class: 'bg-chip' + (gone ? ' gone' : '') + (isMine(id) ? ' me' : '') + (pl ? ' won' : '') },
                h('span', { class: 'bg-chip-name' }, name(id)),
                h('span', { class: 'bg-chip-n' }, pl ? t('bg_place', { n: pl }) : t('bg_marked_n', { n: g.counts[id] || 0 })));
        }));
    }

    /** The scoreboard: who got a bingo, in order, with the phrases of the winning line. */
    function board() {
        const g = G();
        return h('section', { class: 'bg-board', 'aria-label': t('bg_board_title') },
            h('h2', { class: 'bg-board-title' }, t('bg_board_title')),
            g.winners.length
                ? h('ol', { class: 'bg-wins' }, g.winners.map((w) => h('li', { class: 'bg-win' },
                    h('span', { class: 'bg-win-head' }, h('b', { class: 'bg-win-place' }, t('bg_place', { n: w.place })), ' ', name(w.p)),
                    h('span', { class: 'bg-win-row' }, w.row.map((x) => h('span', { class: 'bg-win-cell' }, x))))))
                : h('p', { class: 'bg-empty' }, t('bg_board_empty')));
    }

    function heard() {
        const g = G();
        if (!g.rules.judge && !g.said.length) return null;
        return h('section', { class: 'bg-heard', 'aria-label': t('bg_heard_title') },
            h('h2', { class: 'bg-heard-title' }, t('bg_heard_title')),
            g.said.length ? h('ul', { class: 'bg-heard-list' }, g.said.map((i) => h('li', null, g.pool[i]))) : h('p', { class: 'bg-empty' }, t('bg_heard_none')));
    }

    function sizeClass(len, n) {
        const k = len <= 10 ? 'a' : len <= 24 ? 'b' : 'c';
        return `bg-t-${k}${n}`;
    }

    function cardView(m) {
        const g = G();
        const n = g.rules.size;
        const won = m.place !== null;
        const judge = g.rules.judge;
        const mark = async (i) => {
            C.vibrate(15);
            await C.run('mark', { player_id: m.player_id, cell: i });
        };
        const claim = async () => {
            C.vibrate(25);
            await C.run('bingo', { player_id: m.player_id });
        };
        const cells = m.cells.map((c, i) => {
            const wait = judge && !c.said && !c.m;
            const label = c.t + (judge ? ` (${t(c.said ? 'bg_cell_said' : 'bg_cell_wait')})` : '');
            return h('button', {
                id: `bg-c-${m.player_id}-${i}`, type: 'button',
                class: `bg-cell ${sizeClass(c.t.length, n)}` + (c.m ? ' on' : '') + (wait ? ' wait' : '') + (judge && c.said ? ' said' : ''),
                'aria-pressed': String(c.m), 'aria-label': label, disabled: won || wait, onclick: () => mark(i),
            }, h('span', { class: 'bg-cell-t' }, c.t));
        });
        return h('section', { class: 'bg-card-wrap' },
            h('h2', { class: 'bg-card-title' }, mine().length > 1 ? t('bg_card_of', { p: name(m.player_id) }) : t('bg_card')),
            h('p', { class: 'bg-card-n', role: 'status' }, won ? t('bg_place', { n: m.place }) : t('bg_marked_n', { n: m.cells.filter((c) => c.m).length })),
            h('div', { class: 'bg-grid g' + n, role: 'group', 'aria-label': t('bg_card') }, cells),
            won
                ? h('p', { class: 'bg-won', role: 'status' }, t('bg_you_won', { p: t('bg_place', { n: m.place }) }), h('span', { class: 'bg-won-sub' }, t('bg_keep_watching')))
                : [h('p', { class: 'bg-hint' + (m.ready ? ' ready' : '') }, m.ready ? t('bg_bingo_hint') : t(judge ? 'bg_referee_hint' : 'bg_tap_hint')),
                    h('button', { type: 'button', class: 'bg-bingo' + (m.ready ? ' ready' : ''), onclick: claim }, t('bg_bingo'))]);
    }

    /** One phone, one card: a shared phone chooses whose card is on screen, with a "pass the phone" screen before it. */
    function myCard() {
        const g = G(), u = ui();
        const me = g.me.filter((m) => g.active.includes(m.player_id));
        if (!me.length) return null;
        if (me.length === 1) return { card: cardView(me[0]) };
        const cur = me.find((m) => m.player_id === u.cur);
        if (!cur) {
            return { card: h('section', { class: 'bg-pick' }, h('h2', { class: 'bg-card-title' }, t('bg_whose_turn')),
                h('div', { class: 'bg-pick-btns' }, me.map((m) => h('button', {
                    type: 'button', class: 'bg-pick-btn', 'aria-label': t('bg_open_card', { p: name(m.player_id) }),
                    onclick: () => { u.cur = m.player_id; C.ui.passed = null; C.ui.heldOnce = null; C.scheduleRender(true); },
                }, h('span', null, name(m.player_id)), h('small', null, m.place !== null ? t('bg_place', { n: m.place }) : t('bg_marked_n', { n: m.cells.filter((c) => c.m).length })))))) };
        }
        if (C.ui.passed !== cur.player_id) {
            return { solo: C.passView(cur.player_id, t('bg_pass_phone'), () => { C.ui.passed = cur.player_id; C.ui.heldOnce = null; C.scheduleRender(); }) };
        }
        return { card: [cardView(cur), h('button', { type: 'button', class: 'btn ghost bg-pass-back', onclick: () => { u.cur = null; C.ui.passed = null; C.scheduleRender(true); } }, t('bg_pass_back'))] };
    }

    function hostPanel() {
        if (!isHost()) return null;
        const g = G(), u = ui();
        return h('details', { class: 'panel bg-host', open: u.hostOpen, ontoggle: (e) => { u.hostOpen = e.target.open; } },
            h('summary', null, t('bg_host_tools')),
            h('p', { class: 'small muted' }, t('bg_host_say')),
            h('ul', { class: 'bg-say-list' }, g.pool.map((txt, i) => {
                const on = g.said.includes(i);
                return h('li', null, h('button', {
                    type: 'button', class: 'bg-say' + (on ? ' on' : ''), 'aria-pressed': String(on), 'aria-label': t('bg_host_say_item', { t: txt }),
                    onclick: () => C.run('say', { phrase: i }),
                }, txt));
            })),
            h('button', { class: 'btn ghost', onclick: () => C.askConfirm(t('bg_end_q'), t('bg_end'), () => C.run('end'), true) }, t('bg_end')));
    }

    function feed() {
        const evs = G().events.slice(-8).reverse();
        return h('ol', { class: 'bg-feed' }, evs.map((e) => h('li', { class: LOUD.includes(e.t) ? 'loud' : '' }, evText(e))));
    }

    function playView() {
        const g = G();
        const flash = announce();
        const mc = myCard();
        if (mc && mc.solo) return h('div', { class: 'stack bg' }, mc.solo);
        return h('div', { class: 'stack bg' },
            !C.netOk ? h('div', { class: 'banner warn' }, t('connection_lost')) : null,
            flash.length ? h('div', { class: 'bg-flash', role: 'status' }, flash.map((e) => h('div', null, evText(e)))) : null,
            mc ? mc.card : h('div', { class: 'bg-hero' }, art()),
            crowd(), board(), heard(),
            C.section(t('bg_feed_title'), feed()),
            hostPanel());
    }

    function resultCard() {
        const g = G();
        const res = g.result || { reason: 'host_ended', rows: [], winners: [] };
        const w = g.winners.filter((x) => C.playerById(x.p));
        return h('section', { class: 'panel result bg-result' },
            h('div', { class: 'stamp result-stamp' }, w.length ? t('bg_winner', { p: name(w[0].p) }) : t('bg_no_winner')),
            h('div', { class: 'muted' }, t('bg_reason_' + res.reason)),
            w.length ? h('ol', { class: 'bg-wins', 'aria-label': t('bg_podium') }, w.map((x) => h('li', { class: 'bg-win' },
                h('span', { class: 'bg-win-head' }, h('b', { class: 'bg-win-place' }, t('bg_place', { n: x.place })), ' ', name(x.p)),
                h('span', { class: 'bg-win-row' }, x.row.map((r) => h('span', { class: 'bg-win-cell' }, r)))))) : null,
            h('ul', { class: 'bg-standings', 'aria-label': t('bg_standings') }, res.rows.filter((r) => C.playerById(r.p) && !res.winners.includes(r.p)).map((r) => h('li', null,
                h('b', null, name(r.p)), h('span', null, t('bg_marked_n', { n: r.marked }))))));
    }

    /** The phrases of the room (before the match): the list, the form, the starter lists. Everything typed goes in with textContent. */
    function phrasePanel() {
        const s = C.state.settings;
        const host = isHost();
        const need = s.size * s.size;
        const add = async () => {
            const el = document.getElementById('bg-phrase');
            const text = el ? el.value.trim() : '';
            if (!text) return;
            const r = await C.run('phrase_add', { text });
            const e2 = document.getElementById('bg-phrase');
            if (r && e2) { e2.value = ''; e2.focus(); }
        };
        const form = host || s.open
            ? h('form', { class: 'bg-add', onsubmit: (e) => { e.preventDefault(); add(); } },
                h('label', { for: 'bg-phrase', class: 'bg-add-label' }, t('bg_phr_label')),
                h('div', { class: 'bg-add-row' },
                    h('input', { id: 'bg-phrase', type: 'text', maxlength: '60', autocomplete: 'off', enterkeyhint: 'done', spellcheck: 'false' }),
                    h('button', { class: 'btn primary', type: 'submit' }, t('bg_phr_add'))))
            : h('p', { class: 'muted small' }, t('bg_phr_closed'));
        const list = s.phrases.length
            ? h('ul', { class: 'bg-phr-list' }, s.phrases.map((p) => h('li', { class: 'bg-phr' },
                h('span', { class: 'bg-phr-t' }, p.t),
                host || p.mine ? h('button', { type: 'button', class: 'bg-phr-x', 'aria-label': t('bg_phr_del', { t: p.t }), onclick: () => C.run('phrase_del', { id: p.id }) }, '×') : null)))
            : h('p', { class: 'muted small' }, t('bg_phr_empty'));
        const lists = host ? h('div', { class: 'bg-lists' }, h('h3', { class: 'bg-lists-title' }, t('bg_lists_title')),
            h('div', { class: 'bg-lists-btns' }, LISTS.map((id) => h('button', {
                type: 'button', class: 'btn small ghost', onclick: () => C.run('load_list', { list: id, lang: lang() }),
            }, t('bg_list_load', { n: t('bg_list_' + id) }))))) : null;
        return h('div', { class: 'bg-phrases' },
            h('h3', { class: 'bg-phr-title' }, t('bg_phr_title')),
            h('p', { class: 'bg-phr-count', role: 'status' }, t('bg_phr_count', { n: s.phrases.length, m: s.max }), s.phrases.length < need ? ' · ' + t('bg_phr_need', { n: need }) : ''),
            form, list, lists,
            host && s.phrases.length ? h('button', { type: 'button', class: 'btn small ghost', onclick: () => C.askConfirm(t('bg_clear_q'), t('bg_clear'), () => C.run('phrases_clear'), true) }, t('bg_clear')) : null);
    }

    function summary() {
        const s = C.state.settings;
        const chips = [t('bg_size_n', { n: s.size }), t('bg_mode_' + s.mode), t(s.open ? 'bg_sum_open' : 'bg_sum_host')];
        if (s.judge) chips.push(t('bg_sum_judge'));
        return h('div', null, h('div', { class: 'chips' }, chips.map((c) => h('span', { class: 'chip soft' }, c))), phrasePanel());
    }

    function settings(s, { set, toggle, host }) {
        const choice = (key, values, label, text) => h('div', { class: 'bg-choices', role: 'group', 'aria-label': label }, values.map((v) => h('button', {
            class: 'btn small' + (s[key] === v ? ' primary' : ' ghost'), disabled: !host, 'aria-pressed': String(s[key] === v), onclick: () => set({ [key]: v }),
        }, text(v))));
        const row = (title, desc, ctrl) => h('div', { class: 'set-row' }, h('div', { class: 'set-text' }, h('span', { class: 'set-title' }, title), h('span', { class: 'set-desc' }, desc)), ctrl);
        return [
            row(t('bg_set_size'), t('bg_set_size_d'), choice('size', [4, 5], t('bg_set_size'), (v) => t('bg_size_n', { n: v }))),
            row(t('bg_set_mode'), t('bg_set_mode_d'), choice('mode', ['single', 'podium'], t('bg_set_mode'), (v) => t('bg_mode_' + v))),
            toggle('open', t('bg_set_open'), t('bg_set_open_d')),
            toggle('judge', t('bg_set_judge'), t('bg_set_judge_d')),
        ];
    }

    return {
        init(core) { C = core; return { playView, resultCard, summary, settings }; },
    };
})();
