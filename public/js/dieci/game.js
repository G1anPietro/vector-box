// public/js/dieci/game.js
// "10 out of 10, but…" screens. Runs inside public/js/spia/app.js (rooms, phones, settings, help, render loop); this file draws the match.
// Every round one player is "the 10/10". Everybody finishes "… is a 10/10… but" with a flaw (anonymous, 60 characters), then votes in
// secret for the funniest sentence of ANOTHER player. The server judges and sends the authors only at the reveal. On a shared phone each
// local player is asked in turn behind a "pass the phone" screen (to write and to vote). Countdowns are drawn from the time left that
// the server reports, so a wrong clock changes nothing. All user text goes in with textContent (h()).
window.DieciGame = (() => {
    'use strict';
    let C = null;
    let ticker = null;
    const MAX = 60;

    const G = () => C.state.dieci;
    const t = (k, v) => C.t(k, v);
    const h = (...a) => C.h(...a);
    const name = (id) => C.pname(id) || '?';
    const mine = () => C.myPlayers().map((p) => p.id);
    const isMine = (pid) => mine().includes(pid);
    const isHost = () => !!C.state.is_host;
    const lang = () => (window.SpiaApp && window.SpiaApp.lang) || 'en';
    const LOUD = ['win', 'prize', 'none', 'left', 'excluded', 'end'];

    /** Per match UI state: deadline anchor (a new poll does not restart the countdown), the picks, flashes, timers. */
    function ui() {
        const g = G();
        if (!C.ui.dz || C.ui.dz.match !== g.match) C.ui.dz = { match: g.match, lastEvent: 0, flash: [], flashUntil: 0, anchor: null, timer: null, pick: null, prize: null, pickKey: '' };
        return C.ui.dz;
    }

    function endsAt(kind, left) {
        const u = ui(), g = G();
        const key = `${kind}:${g.round}:${g.phase}`;
        if (!u.anchor || u.anchor.key !== key) u.anchor = { key, at: Date.now() + left * 1000 };
        return u.anchor.at;
    }

    /** One refresh right after the time is up, so the phase moves on without waiting for the next 2 s poll. */
    function refreshAt(at) {
        const u = ui();
        clearTimeout(u.timer);
        u.timer = setTimeout(() => { if (window.SpiaApp) window.SpiaApp.refresh(); }, Math.max(150, at - Date.now() + 250));
    }

    function countdown(at, total) {
        const left = Math.max(0, (at - Date.now()) / 1000);
        const bar = h('div', { class: 'dz-bar', 'aria-hidden': 'true' }, h('div', { class: 'dz-bar-fill', style: `animation-duration:${total}s;animation-delay:-${Math.max(0, total - left).toFixed(2)}s` }));
        const num = h('span', { class: 'dz-count', 'aria-live': 'off' }, String(Math.ceil(left)));
        clearInterval(ticker);
        ticker = setInterval(() => {
            if (!num.isConnected) { clearInterval(ticker); return; }
            num.textContent = String(Math.max(0, Math.ceil((at - Date.now()) / 1000)));
        }, 250);
        return h('div', { class: 'dz-clock' }, bar, num);
    }

    /** Characters left in the box (counted like the server does: letters, not bytes). */
    function syncCount() {
        const box = document.querySelector('textarea.dz-input'), out = document.getElementById('dz-left');
        if (box && out) out.textContent = t('dz_chars_left', { n: Math.max(0, MAX - [...box.value].length) });
    }

    function evText(e) {
        const p = e.p ? name(e.p) : '';
        switch (e.t) {
            case 'start': return t('dz_ev_start');
            case 'round': return t('dz_ev_round', { n: e.n, p });
            case 'win': return t('dz_ev_win', { p });
            case 'prize': return t('dz_ev_prize', { p });
            case 'none': return t('dz_ev_none');
            case 'left': return t('dz_ev_left', { p });
            case 'excluded': return t('dz_ev_excluded', { p });
            case 'removed': return t('dz_ev_removed');
            case 'end': return t('dz_ev_end');
            default: return '';
        }
    }

    function announce() {
        const u = ui();
        const evs = G().events;
        const loud = evs.filter((e) => e.id > u.lastEvent && LOUD.includes(e.t));
        if (u.lastEvent && loud.length) {
            C.vibrate(loud.some((e) => isMine(e.p) && (e.t === 'win' || e.t === 'prize')) ? [200, 60, 200] : [60, 40, 60]);
            u.flash = loud.slice(-2);
            u.flashUntil = Date.now() + 5000;
            setTimeout(() => C.scheduleRender(), 5100);
        }
        if (evs.length) u.lastEvent = evs[evs.length - 1].id;
        return Date.now() < u.flashUntil ? u.flash : [];
    }

    /** The row of players: who is the 10/10 and who already wrote / voted (only that, never what or for whom). */
    function stage() {
        const g = G();
        return h('ul', { class: 'dz-crowd', 'aria-label': t('dz_players') }, g.order.filter((id) => C.playerById(id)).map((id) => {
            const active = g.active.includes(id);
            const done = g.phase === 'write' ? g.wrote.includes(id) : (g.phase === 'vote' ? g.voted.includes(id) : false);
            const open = active && (g.phase === 'write' || g.phase === 'vote');
            return h('li', { class: 'dz-chip' + (active ? '' : ' gone') + (isMine(id) ? ' me' : '') + (done ? ' done' : '') + (g.target === id ? ' star' : '') },
                g.target === id ? h('span', { class: 'dz-chip-ten', 'aria-hidden': 'true' }, '10') : null,
                g.target === id ? h('span', { class: 'sr-only' }, t('dz_ten')) : null,
                h('span', { class: 'dz-chip-name' }, name(id)),
                h('span', { class: 'dz-chip-state', 'aria-hidden': 'true' }, open ? (done ? '✓' : '…') : ''),
                done ? h('span', { class: 'sr-only' }, t(g.phase === 'write' ? 'dz_wrote_mark' : 'dz_voted_mark')) : null);
        }));
    }

    /** The evaluation card: a giant 10 with a small "but…" peeking out, and the sentence start in plain text for reading. */
    function card(target) {
        return h('div', { class: 'dz-card' },
            h('div', { class: 'dz-ten', 'aria-hidden': 'true' }, h('span', { class: 'dz-num' }, '10'), h('span', { class: 'dz-out' }, '/10'), h('span', { class: 'dz-but' }, t('dz_but'))),
            h('p', { class: 'dz-lead' }, t('dz_lead', { p: name(target) })));
    }

    function writeView() {
        const g = G(), q = g.q, u = ui();
        const todo = g.me.filter((m) => m.active && !m.wrote);
        const at = endsAt('w', q.left);
        refreshAt(at);
        const title = t('dz_round_of', { n: g.round, m: g.rounds });
        if (todo.length) {
            const m = todo[0];
            const shared = mine().length > 1;
            if (shared && C.ui.passed !== m.player_id) {
                return C.passView(m.player_id, t('dz_pass_to'), () => { C.ui.passed = m.player_id; C.ui.heldOnce = null; C.scheduleRender(); });
            }
            const id = `dz-text-${m.player_id}`;
            const send = async () => {
                const box = document.getElementById(id);
                const text = box ? box.value : '';
                C.vibrate(25);
                const r = await C.run('write', { player_id: m.player_id, text });
                if (r) { C.ui.passed = null; if (box) box.value = ''; }
            };
            return C.section(title, countdown(at, q.time), card(g.target),
                shared ? h('p', { class: 'dz-who' }, t('dz_writing', { p: name(m.player_id) })) : null,
                h('label', { class: 'dz-label', for: id }, t('dz_write_label')),
                h('textarea', { id, class: 'dz-input', rows: '2', maxlength: String(MAX), placeholder: t('dz_placeholder'), 'aria-describedby': 'dz-left', autocomplete: 'off', oninput: syncCount }),
                h('p', { id: 'dz-left', class: 'dz-left small' }, t('dz_chars_left', { n: MAX })),
                m.hint ? h('p', { class: 'dz-hint', role: 'status' }, h('span', { class: 'small' }, t('dz_hint_label')), ' ', h('b', null, '… ' + (m.hint[lang()] || m.hint.en))) : null,
                h('div', { class: 'dz-actions' },
                    h('button', {
                        class: 'btn ghost', disabled: m.hints_left <= 0,
                        onclick: () => { C.vibrate(15); C.run('hint', { player_id: m.player_id }); },
                    }, m.hints_left > 0 ? t('dz_hint_btn', { n: m.hints_left }) : t('dz_hint_none')),
                    h('button', { class: 'btn primary big dz-send', onclick: send }, t('dz_send'))));
        }
        const out = !g.me.some((m) => m.active);
        return C.section(title, countdown(at, q.time), card(g.target),
            h('p', { class: 'dz-wait' }, out ? t('dz_gone') : t('dz_wait_write', { n: g.wrote.length, m: g.active.length })));
    }

    function pickList(items, key, label, own) {
        const u = ui();
        return h('div', { class: 'dz-items', role: 'group', 'aria-label': label }, items.filter((it) => !own.includes(it.i)).map((it, n) => h('button', {
            class: 'dz-item' + (u[key] === it.i ? ' on' : ''), 'aria-pressed': String(u[key] === it.i),
            onclick: () => { C.vibrate(15); u[key] = it.i; C.scheduleRender(true); },
        }, h('span', { class: 'dz-item-n', 'aria-hidden': 'true' }, String(n + 1)), h('span', { class: 'dz-item-text' }, '… ' + it.text))));
    }

    function voteView() {
        const g = G(), q = g.q, u = ui();
        const todo = g.me.filter((m) => m.active && m.can_vote && !m.voted);
        const at = endsAt('v', q.left);
        refreshAt(at);
        const title = t('dz_vote_title');
        if (todo.length) {
            const m = todo[0];
            const shared = mine().length > 1;
            if (shared && C.ui.passed !== m.player_id) {
                return C.passView(m.player_id, t('dz_pass_to'), () => { C.ui.passed = m.player_id; C.ui.heldOnce = null; u.pick = null; u.prize = null; C.scheduleRender(); });
            }
            const key = `${g.round}:${m.player_id}`;
            if (u.pickKey !== key) { u.pickKey = key; u.pick = null; u.prize = null; }
            const isTarget = m.player_id === g.target;
            const lock = h('button', {
                class: 'btn primary big dz-lock', disabled: u.pick === null || (isTarget && u.prize === null),
                onclick: async () => {
                    if (u.pick === null || (isTarget && u.prize === null)) return;
                    const body = { player_id: m.player_id, idx: u.pick };
                    if (isTarget) body.prize = u.prize;
                    C.vibrate(25);
                    const r = await C.run('vote', body);
                    if (r) { C.ui.passed = null; u.pick = null; u.prize = null; }
                },
            }, t('dz_lock'));
            return C.section(title, countdown(at, q.time), card(g.target),
                shared ? h('p', { class: 'dz-who' }, t('dz_voting', { p: name(m.player_id) })) : null,
                h('p', { class: 'dz-hint-line' }, t('dz_vote_hint')),
                pickList(g.items, 'pick', t('dz_vote_title'), m.own),
                isTarget ? h('h3', { class: 'dz-prize-h' }, t('dz_prize_title')) : null,
                isTarget ? h('p', { class: 'dz-hint-line' }, t('dz_prize_hint')) : null,
                isTarget ? pickList(g.items, 'prize', t('dz_prize_title'), m.own) : null,
                lock);
        }
        const out = !g.me.some((m) => m.active);
        const nothing = g.me.some((m) => m.active && !m.can_vote && !m.voted);
        return C.section(title, countdown(at, q.time), card(g.target),
            h('p', { class: 'dz-wait' }, out ? t('dz_gone') : (nothing ? t('dz_nothing_to_vote') : t('dz_wait_vote', { n: g.voted.length, m: g.active.length }))));
    }

    function votesLabel(n) { return t(n === 0 ? 'dz_votes_zero' : n === 1 ? 'dz_votes_one' : 'dz_votes_n', { n }); }

    function revealView() {
        const g = G(), r = g.reveal;
        if (!r) return null;
        const at = endsAt('r', g.next_left || 0);
        refreshAt(at);
        return C.section(t('dz_reveal_title'), card(r.target),
            r.rows.length ? h('ol', { class: 'dz-rows' }, r.rows.map((row) => h('li', { class: 'dz-row' + (row.win ? ' win' : '') + (row.prize ? ' prize' : '') + (isMine(row.p) ? ' me' : '') },
                h('p', { class: 'dz-row-text' }, '… ' + row.text),
                h('div', { class: 'dz-row-meta' },
                    h('span', { class: 'dz-row-by' }, t('dz_by', { p: name(row.p) })),
                    row.win ? h('span', { class: 'dz-badge' }, t('dz_win_badge')) : null,
                    row.prize ? h('span', { class: 'dz-badge prize' }, t('dz_prize_badge')) : null,
                    h('span', { class: 'dz-row-n' }, votesLabel(row.n)))))) : h('p', { class: 'dz-verdict', role: 'status' }, t('dz_rv_none')),
            r.skipped.length ? h('p', { class: 'dz-skipped muted small' }, t('dz_skipped', { p: r.skipped.map(name).join(', ') })) : null,
            h('p', { class: 'dz-next muted small' }, t(r.last ? 'dz_results_in' : 'dz_next_in'), ' ', h('b', { class: 'dz-count' }, String(Math.ceil(Math.max(0, (at - Date.now()) / 1000))))),
            isHost() ? h('button', { class: 'btn ghost', onclick: () => C.run('next') }, t(r.last ? 'dz_see_results' : 'dz_next')) : null);
    }

    function feed() {
        const evs = G().events.slice(-8).reverse();
        return h('ol', { class: 'dz-feed' }, evs.map((e) => h('li', { class: LOUD.includes(e.t) ? 'loud ev-' + e.t : 'ev-' + e.t }, evText(e))));
    }

    /** Host: remove a sentence during the vote (the host does not see who wrote it), exclude a player, end the match. */
    function hostPanel() {
        if (!isHost()) return null;
        const g = G();
        const removable = g.phase === 'vote' && g.items ? g.items : [];
        return h('details', { class: 'panel dz-host' },
            h('summary', null, t('dz_host_tools')),
            h('p', { class: 'small muted' }, t('dz_host_note')),
            removable.length ? h('ul', { class: 'dz-remove' }, removable.map((it, n) => h('li', null,
                h('span', { class: 'dz-remove-text' }, '… ' + it.text),
                h('button', { class: 'btn small ghost', 'aria-label': t('dz_remove_aria', { n: n + 1 }), onclick: () => C.run('remove', { idx: it.i }) }, t('dz_remove'))))) : null,
            h('div', { class: 'dz-exclude' }, g.active.filter((id) => C.playerById(id)).map((id) => h('button', {
                class: 'btn small ghost', onclick: () => C.askConfirm(t('dz_exclude_q', { p: name(id) }), t('dz_exclude', { p: name(id) }), () => C.run('exclude', { player_id: id }), true),
            }, t('dz_exclude', { p: name(id) })))),
            h('button', { class: 'btn ghost', onclick: () => C.askConfirm(t('dz_end_q'), t('dz_end'), () => C.run('end'), true) }, t('dz_end')));
    }

    function playView() {
        const g = G();
        const flash = announce();
        return h('div', { class: 'stack dz' },
            !C.netOk ? h('div', { class: 'banner warn' }, t('connection_lost')) : null,
            flash.length ? h('div', { class: 'dz-flash', role: 'status' }, flash.map((e) => h('div', null, evText(e)))) : null,
            h('div', { class: 'dz-top' }, h('span', null, t('dz_round_of', { n: g.round, m: g.rounds })), h('span', null, t('dz_seconds_n', { n: g.rules.time }))),
            stage(),
            g.phase === 'write' && g.q ? writeView() : (g.phase === 'vote' && g.q ? voteView() : revealView()),
            C.section(t('dz_feed_title'), feed()),
            hostPanel());
    }

    function resultCard() {
        const g = G();
        const res = g.result || { reason: 'host_ended', rows: [] };
        return h('section', { class: 'panel result dz-result' },
            h('div', { class: 'stamp result-stamp' }, t('dz_standings')),
            h('div', { class: 'muted' }, t('dz_reason_' + res.reason)),
            h('ol', { class: 'dz-standings' }, res.rows.filter((r) => C.playerById(r.p)).map((r, i) => h('li', { class: 'dz-stand' + (i === 0 && r.pts > 0 ? ' first' : '') },
                h('span', { class: 'dz-stand-rank', 'aria-hidden': 'true' }, String(i + 1)),
                h('b', { class: 'dz-stand-name' }, name(r.p)),
                h('span', { class: 'dz-stand-n' }, t('dz_pts_n', { n: r.pts, w: r.wins }))))));
    }

    function summary() {
        const s = C.state.settings;
        const chips = [t(s.turns === 2 ? 'dz_sum_two' : 'dz_sum_one'), t('dz_seconds_n', { n: s.time }), s.family ? t('dz_sum_family') : null].filter(Boolean);
        return h('div', { class: 'chips' }, chips.map((c) => h('span', { class: 'chip soft' }, c)));
    }

    function settings(s, { set, toggle, host }) {
        const choice = (key, values, label, text) => h('div', { class: 'dz-choices', role: 'group', 'aria-label': label }, values.map((v) => h('button', {
            class: 'btn small' + (s[key] === v ? ' primary' : ' ghost'), disabled: !host, 'aria-pressed': String(s[key] === v), onclick: () => set({ [key]: v }),
        }, text(v))));
        return [
            h('div', { class: 'set-row' },
                h('div', { class: 'set-text' }, h('span', { class: 'set-title' }, t('dz_set_turns')), h('span', { class: 'set-desc' }, t('dz_set_turns_d'))),
                choice('turns', [1, 2], t('dz_set_turns'), (v) => t(v === 2 ? 'dz_turns_two' : 'dz_turns_one'))),
            h('div', { class: 'set-row' },
                h('div', { class: 'set-text' }, h('span', { class: 'set-title' }, t('dz_set_time')), h('span', { class: 'set-desc' }, t('dz_set_time_d'))),
                choice('time', [45, 60, 90], t('dz_set_time'), (v) => t('dz_seconds_n', { n: v }))),
            toggle('family', t('dz_set_family'), t('dz_set_family_d')),
        ];
    }

    return {
        init(core) {
            C = core;
            window.addEventListener('spia:render', syncCount);
            return { playView, resultCard, summary, settings };
        },
    };
})();
