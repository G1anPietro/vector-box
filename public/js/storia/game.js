// public/js/storia/game.js
// "Chain story" screens. Runs inside public/js/spia/app.js (rooms, phones, settings, help, render loop); this file draws the match.
// Every player writes one sentence per turn and sees ONLY the sentence written just before theirs: the server sends it to the
// writer's phone alone, with no author. After the last turn the story is read to everybody sentence by sentence (a server clock),
// then everybody votes for a favourite sentence (not their own) and the authors are shown. All player text goes in with
// textContent (h() sets text nodes only); the length limit (200) and the clean-up are also done by the server.
// On a shared phone a "pass the phone" screen protects the sentence between turns.
window.StoriaGame = (() => {
    'use strict';
    let C = null;
    let ticker = null;

    const MAX = 200;
    const G = () => C.state.storia;
    const t = (k, v) => C.t(k, v);
    const h = (...a) => C.h(...a);
    const name = (id) => C.pname(id) || '?';
    const mine = () => C.myPlayers().map((p) => p.id);
    const isHost = () => !!C.state.is_host;
    const LANGS = ['it', 'en', 'es', 'fr', 'de'];
    const lang = () => (window.SpiaApp && window.SpiaApp.lang) || 'en';
    const L = () => (LANGS.includes(lang()) ? lang() : 'en');
    /** The opening lines come in five languages ("tr"); anything a player wrote is shown as it is. */
    const say = (x, fallback) => (x && x.tr ? x.tr[LANGS.indexOf(L())] : fallback);
    const NS = 'http://www.w3.org/2000/svg';

    /** Per match UI state: the sentence being typed, timers, the vote picked on this phone. */
    function ui() {
        const g = G();
        if (!C.ui.st || C.ui.st.match !== g.match) C.ui.st = { match: g.match, text: '', busy: false, anchor: null, timer: null, pick: {}, voting: null, lastRead: 0 };
        return C.ui.st;
    }

    function endsAt(kind, left) {
        const u = ui(), g = G();
        const key = `${kind}:${g.phase}:${g.turn}:${g.story.length}`;
        if (!u.anchor || u.anchor.key !== key) u.anchor = { key, at: Date.now() + left * 1000 };
        return u.anchor.at;
    }

    /** One refresh right after the server's instant, so the next turn / sentence shows without waiting for the 2 s poll. */
    function refreshAt(at) {
        const u = ui();
        clearTimeout(u.timer);
        u.timer = setTimeout(() => { if (window.SpiaApp) window.SpiaApp.refresh(); }, Math.max(150, at - Date.now() + 250));
    }

    function clock(at, total) {
        const secs = () => Math.max(0, Math.ceil((at - Date.now()) / 1000));
        const num = h('time', { class: 'st-count' }, `${secs()} s`);
        const fill = h('div', { class: 'st-bar-fill' });
        const paint = () => {
            num.textContent = `${secs()} s`;
            fill.style.width = Math.max(0, Math.min(100, ((at - Date.now()) / 1000 / total) * 100)).toFixed(1) + '%';
            num.classList.toggle('low', secs() <= 10);
        };
        paint();
        clearInterval(ticker);
        ticker = setInterval(() => { if (!num.isConnected) { clearInterval(ticker); return; } paint(); }, 500);
        return h('div', { class: 'st-clock', role: 'timer', 'aria-label': t('st_time_left') },
            h('span', { class: 'st-clock-lead' }, t('st_time_left')), num, h('div', { class: 'st-bar', 'aria-hidden': 'true' }, fill));
    }

    function evText(e) {
        const p = e.p ? name(e.p) : '';
        switch (e.t) {
            case 'start': return t('st_ev_start');
            case 'timeout': return t('st_ev_timeout', { p });
            case 'left': return t('st_ev_left', { p });
            case 'excluded': return t('st_ev_excluded', { p });
            case 'removed': return t('st_ev_removed');
            case 'read': return t('st_ev_read');
            case 'vote': return t('st_ev_vote');
            case 'voted': return t('st_ev_voted', { p });
            case 'end': return t('st_ev_end');
            default: return '';
        }
    }

    /** The emblem: a sheet of ruled paper with a pen. */
    function art() {
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 200 200');
        svg.setAttribute('class', 'st-art');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); svg.appendChild(e); return e; };
        el('rect', { class: 'st-art-page', x: '30', y: '24', width: '120', height: '152', rx: '6' });
        el('line', { class: 'st-art-margin', x1: '52', y1: '24', x2: '52', y2: '176' });
        [60, 84, 108, 132].forEach((y) => el('line', { class: 'st-art-rule', x1: '30', y1: String(y), x2: '150', y2: String(y) }));
        el('path', { class: 'st-art-scribble', d: 'M62 52 q8 -10 16 0 t16 0 t16 0 M62 78 q8 -10 16 0 t16 0' });
        el('path', { class: 'st-art-pen', d: 'M118 150 L172 96 L184 108 L130 162 L112 168 Z' });
        el('path', { class: 'st-art-nib', d: 'M112 168 L118 150 L130 162 Z' });
        return svg;
    }

    /** The chain: one little paper strip per sentence written so far (no text: only the shape of the story growing). */
    function chain() {
        const g = G();
        const n = g.written + 1;       // + the opening line
        const strips = [];
        for (let i = 0; i < Math.min(n, 40); i++) strips.push(h('li', { class: 'st-strip' }));
        if (g.phase === 'write') strips.push(h('li', { class: 'st-strip now' }));
        return h('div', { class: 'st-chain' },
            h('ol', { class: 'st-strips', 'aria-hidden': 'true' }, strips),
            h('p', { class: 'st-chain-n' }, t('st_chain_n', { n: g.written, m: g.turns_total })));
    }

    function crowd() {
        const g = G();
        return h('ul', { class: 'st-crowd', 'aria-label': t('st_players') }, g.order.filter((id) => C.playerById(id)).map((id) => {
            const gone = !g.active.includes(id);
            const cur = g.phase === 'write' && g.writer === id;
            const voted = g.phase === 'vote' && g.voted.includes(id);
            return h('li', { class: 'st-chip' + (gone ? ' gone' : '') + (cur ? ' cur' : '') + (mine().includes(id) ? ' me' : '') },
                h('span', { class: 'st-chip-name' }, name(id)),
                cur ? h('span', { class: 'st-chip-tag' }, t('st_writing_mark')) : null,
                voted ? h('span', { class: 'st-chip-tag' }, t('st_voted_mark')) : null,
                gone ? h('span', { class: 'st-chip-tag' }, t('st_out_mark')) : null);
        }));
    }

    function writeScreen(m) {
        const g = G(), u = ui();
        const p = g.prev;
        const shared = mine().length > 1;
        if (shared && C.ui.passed !== m.player_id) {
            return { solo: C.passView(m.player_id, t('st_pass_write'), () => { C.ui.passed = m.player_id; C.ui.heldOnce = null; C.scheduleRender(); }) };
        }
        const send = async () => {
            const text = u.text.trim();
            if (!text || u.busy) return;
            u.busy = true;
            C.vibrate(20);
            try {
                const r = await C.run('write', { player_id: m.player_id, text });
                if (r) { u.text = ''; C.ui.passed = null; C.scheduleRender(true); }
            } finally { u.busy = false; }
        };
        const count = h('span', { class: 'st-counter', 'aria-live': 'off' }, `${u.text.length}/${MAX}`);
        const input = h('textarea', {
            id: 'st-text', class: 'st-input', maxlength: String(MAX), rows: '4', autocomplete: 'off', spellcheck: 'true', enterkeyhint: 'send',
            'aria-label': t('st_write_label'), oninput: (e) => { u.text = e.target.value; count.textContent = `${u.text.length}/${MAX}`; },
        });
        input.value = u.text;
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
        setTimeout(() => { const el = document.getElementById('st-text'); if (el && document.activeElement !== el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 60);
        return { solo: h('section', { class: 'st-write' },
            shared ? h('p', { class: 'st-who' }, t('st_turn_of', { p: name(m.player_id) })) : null,
            g.left !== null ? clock(endsAt('w', g.left), g.rules.timer) : null,
            h('figure', { class: 'st-prev' },
                h('figcaption', { class: 'st-cap' }, t(p.incipit ? 'st_prev_inc' : 'st_prev')),
                h('blockquote', { class: 'st-line big', lang: L() }, p.incipit ? say(p, p.text) : p.text)),
            h('p', { class: 'st-only' }, t('st_only_last')),
            h('label', { class: 'st-label', for: 'st-text' }, t('st_write_label')), input,
            h('div', { class: 'st-meta' }, count, h('span', { class: 'st-rule-note' }, t('st_rule_note'))),
            h('button', { class: 'btn primary big', disabled: u.busy, onclick: send }, t('st_send'))) };
    }

    function waitScreen() {
        const g = G();
        if (g.left !== null) { refreshAt(endsAt('w', g.left)); }
        const excluded = g.me.length && g.me.every((m) => m.excluded);
        return h('section', { class: 'st-wait' }, art(),
            h('p', { class: 'st-wait-line', role: 'status' }, excluded ? t('st_you_excluded') : t('st_wait_for', { p: name(g.writer) })),
            g.left !== null ? clock(endsAt('w', g.left), g.rules.timer) : null,
            chain(),
            h('p', { class: 'st-only' }, t('st_hidden_note')));
    }

    /** The lines on the page. Authors are NOT known to the client until the end. */
    function lines(list, opts = {}) {
        return h('ol', { class: 'st-page' }, list.map((l, k) => h('li', { class: 'st-sheet-line ' + l.k + (opts.last && k === list.length - 1 ? ' new' : '') },
            h('span', { class: 'st-no', 'aria-hidden': 'true' }, String(k + 1)),
            h('span', { class: 'st-text', lang: L() }, say(l, l.t)),
            opts.extra ? opts.extra(l, k) : null)));
    }

    function removeBtn(l, k) {
        if (!isHost() || l.k === 'inc') return null;
        return h('button', {
            class: 'btn small ghost st-remove', 'aria-label': t('st_remove_aria', { n: k + 1 }),
            onclick: () => C.askConfirm(t('st_remove_q'), t('st_remove'), () => C.run('remove_line', { line: l.i }), true),
        }, t('st_remove'));
    }

    function readScreen() {
        const g = G();
        const at = Date.now() + (g.read_left || 0) * 1000;
        refreshAt(at);
        return h('section', { class: 'st-read' },
            h('h2', { class: 'st-title' }, t('st_read_title')),
            h('p', { class: 'st-sub' }, t('st_read_note')),
            lines(g.story, { last: true, extra: removeBtn }),
            h('p', { class: 'st-sub', role: 'status' }, t('st_read_progress', { n: g.story.length, m: g.total_lines })),
            isHost() ? h('button', { class: 'btn ghost', onclick: () => C.run('next') }, t('st_read_next')) : null);
    }

    function voteScreen() {
        const g = G(), u = ui();
        const shared = mine().length > 1;
        const can = g.me.filter((m) => m.can_vote);
        if (u.voting !== null && !can.some((m) => m.player_id === u.voting)) u.voting = null;
        if (u.voting !== null) {
            const pid = u.voting;
            if (shared && C.ui.passed !== pid) {
                return { solo: C.passView(pid, t('st_pass_vote'), () => { C.ui.passed = pid; C.ui.heldOnce = null; C.scheduleRender(); }) };
            }
            const own = new Set((g.my_lines && g.my_lines[pid]) || []);
            const send = async () => {
                if (u.pick[pid] === undefined || u.busy) return;
                u.busy = true;
                C.vibrate(25);
                try {
                    const r = await C.run('vote', { player_id: pid, line: u.pick[pid] });
                    if (r) { u.voting = null; C.ui.passed = null; C.scheduleRender(true); }
                } finally { u.busy = false; }
            };
            const real = g.story.filter((l) => l.k === 'line');
            return { solo: h('section', { class: 'st-vote' },
                shared ? h('p', { class: 'st-who' }, t('st_vote_for', { p: name(pid) })) : null,
                h('h2', { class: 'st-title' }, t('st_vote_title')),
                h('p', { class: 'st-sub' }, t('st_vote_note')),
                h('ol', { class: 'st-choices', role: 'group', 'aria-label': t('st_vote_title') }, real.map((l, k) => {
                    const mineLine = own.has(l.i);
                    return h('li', null, h('button', {
                        class: 'st-choice' + (u.pick[pid] === l.i ? ' on' : ''), disabled: mineLine, 'aria-pressed': String(u.pick[pid] === l.i),
                        onclick: () => { u.pick[pid] = l.i; C.scheduleRender(true); },
                    }, h('span', { class: 'st-no', 'aria-hidden': 'true' }, String(k + 1)), h('span', { class: 'st-text', lang: L() }, l.t), mineLine ? h('span', { class: 'st-mine-tag' }, t('st_yours')) : null));
                })),
                h('div', { class: 'row2' },
                    h('button', { class: 'btn ghost', onclick: () => { u.voting = null; C.ui.passed = null; C.scheduleRender(true); } }, t('st_cancel')),
                    h('button', { class: 'btn primary', disabled: u.busy || u.pick[pid] === undefined, onclick: send }, t('st_vote_send')))) };
        }
        return h('section', { class: 'st-vote' },
            h('h2', { class: 'st-title' }, t('st_vote_title')),
            h('p', { class: 'st-sub' }, t('st_vote_wait', { n: g.voted.length, m: g.active.length })),
            lines(g.story, { extra: removeBtn }),
            can.length ? h('div', { class: 'st-vote-btns', role: 'group', 'aria-label': t('st_vote_title') }, can.map((m) => h('button', {
                class: 'btn primary big', onclick: () => { C.vibrate(15); u.voting = m.player_id; C.ui.passed = null; C.scheduleRender(true); },
            }, shared ? t('st_vote_for', { p: name(m.player_id) }) : t('st_vote_btn')))) : null,
            !can.length && g.me.some((m) => m.voted) ? h('p', { class: 'st-sub', role: 'status' }, t('st_vote_done')) : null,
            isHost() ? h('button', { class: 'btn ghost', onclick: () => C.run('next') }, t('st_vote_close')) : null);
    }

    function hostPanel() {
        const g = G();
        if (!isHost()) return null;
        return h('details', { class: 'panel st-host' },
            h('summary', null, t('st_host_tools')),
            h('p', { class: 'small muted' }, t('st_host_note')),
            g.phase === 'write' ? h('button', { class: 'btn ghost', onclick: () => C.askConfirm(t('st_skip_q'), t('st_skip'), () => C.run('skip'), false) }, t('st_skip')) : null,
            h('h3', { class: 'st-host-h' }, t('st_exclude_title')),
            h('ul', { class: 'st-excl' }, g.order.filter((id) => C.playerById(id) && g.active.includes(id)).map((id) => h('li', null,
                h('span', null, name(id)),
                h('button', {
                    class: 'btn small ghost', 'aria-label': t('st_exclude_aria', { p: name(id) }),
                    onclick: () => C.askConfirm(t('st_exclude_q', { p: name(id) }), t('st_exclude'), () => C.run('exclude', { target: id }), true),
                }, t('st_exclude'))))),
            h('button', { class: 'btn ghost', onclick: () => C.askConfirm(t('st_end_q'), t('st_end'), () => C.run('end'), true) }, t('st_end')));
    }

    function feed() {
        const evs = G().events.filter((e) => evText(e)).slice(-6).reverse();
        return h('ol', { class: 'st-feed', 'aria-live': 'polite' }, evs.map((e) => h('li', null, evText(e))));
    }

    function playView() {
        const g = G();
        let shell;
        if (g.phase === 'write') {
            const m = g.me.find((x) => x.writing);
            shell = m ? writeScreen(m) : waitScreen();
        } else {
            clearInterval(ticker);
            shell = g.phase === 'read' ? readScreen() : voteScreen();
        }
        // the private screens (pass the phone, write, vote) stand alone
        if (shell && shell.solo) return h('div', { class: 'stack st' }, shell.solo);
        return h('div', { class: 'stack st' },
            !C.netOk ? h('div', { class: 'banner warn' }, t('connection_lost')) : null,
            g.phase === 'write' ? h('div', { class: 'st-top' }, h('span', null, t('st_turn_n', { n: Math.min(g.turn + 1, g.turns_total), m: g.turns_total })), h('span', null, t('st_lines_n', { n: g.rules.rounds }))) : null,
            crowd(), shell,
            C.section(t('st_feed_title'), feed()),
            hostPanel());
    }

    function resultCard() {
        const g = G();
        clearInterval(ticker);
        const res = g.result || { reason: 'host_ended', story: [], winners: [], best: [], top: 0 };
        const w = res.winners.filter((p) => C.playerById(p));
        const stamp = w.length === 1 ? t('st_winner', { p: name(w[0]) }) : w.length > 1 ? t('st_winners', { p: w.map(name).join(', ') }) : t('st_the_end');
        return h('section', { class: 'panel result st-result' },
            art(),
            h('div', { class: 'stamp result-stamp' }, stamp),
            h('div', { class: 'muted' }, t('st_reason_' + res.reason)),
            res.top > 0 ? h('p', { class: 'st-sub' }, t('st_best_votes', { n: res.top })) : null,
            h('h2', { class: 'st-title' }, t('st_whole_story')),
            h('ol', { class: 'st-page final' }, res.story.map((l, k) => h('li', { class: 'st-sheet-line ' + l.k + (res.best.includes(l.i) ? ' best' : '') },
                h('span', { class: 'st-no', 'aria-hidden': 'true' }, String(k + 1)),
                h('span', { class: 'st-text', lang: L() }, say(l, l.text)),
                h('span', { class: 'st-by' }, l.k === 'inc' ? t('st_by_book') : (C.playerById(l.p) ? name(l.p) : '?'),
                    l.votes ? h('span', { class: 'st-votes' }, ' · ' + t('st_votes_n', { n: l.votes })) : null)))));
    }

    function summary() {
        const s = C.state.settings;
        const chips = [t('st_sum_lines', { n: s.rounds }), s.timer ? t('st_sum_timer', { n: s.timer }) : t('st_sum_notimer'), t('st_genre_' + s.genre)];
        if (s.own_on) chips.push(t('st_sum_own'));
        return h('div', { class: 'chips' }, chips.map((c) => h('span', { class: 'chip soft' }, c)));
    }

    function settings(s, { set, host }) {
        const choice = (key, values, label, text) => h('div', { class: 'st-choices-row', role: 'group', 'aria-label': label }, values.map((v) => h('button', {
            class: 'btn small' + (s[key] === v ? ' primary' : ' ghost'), disabled: !host, 'aria-pressed': String(s[key] === v), onclick: () => set({ [key]: v }),
        }, text(v))));
        const row = (title, desc, ctrl) => h('div', { class: 'set-row' }, h('div', { class: 'set-text' }, h('span', { class: 'set-title' }, title), h('span', { class: 'set-desc' }, desc)), ctrl);
        const own = h('input', {
            type: 'text', class: 'st-own', maxlength: String(MAX), disabled: !host, value: s.own || '', 'aria-label': t('st_set_own'), placeholder: t('st_set_own_ph'),
            onchange: (e) => set({ own: e.target.value }),
        });
        return [
            row(t('st_set_rounds'), t('st_set_rounds_d'), choice('rounds', [1, 2, 3], t('st_set_rounds'), String)),
            row(t('st_set_timer'), t('st_set_timer_d'), choice('timer', [0, 30, 60, 90], t('st_set_timer'), (v) => (v ? t('st_sec_n', { n: v }) : t('st_none')))),
            row(t('st_set_genre'), t('st_set_genre_d'), choice('genre', ['mix', 'mystery', 'fantasy', 'daily', 'scifi', 'absurd'], t('st_set_genre'), (v) => t('st_genre_' + v))),
            row(t('st_set_own'), t('st_set_own_d'), own),
        ];
    }

    return {
        init(core) { C = core; return { playView, resultCard, summary, settings }; },
    };
})();
