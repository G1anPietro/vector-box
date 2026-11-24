// public/js/indovina/game.js
// "Guess what" screens. Runs inside public/js/spia/app.js (rooms, phones, settings, help, render loop); this file draws the match.
// One player (the keeper) holds a secret word that the server sends to THEIR phone only; the others ask yes/no questions out
// loud and the keeper answers with three buttons. The server counts the questions, keeps the chalkboard, runs the round timer and
// judges every guess. The clock is drawn from the time left that the server reports (a wrong phone clock changes nothing).
// On a shared phone a "pass the phone" screen protects the word and the typed guess.
window.IndovinaGame = (() => {
    'use strict';
    let C = null;
    let ticker = null;

    const G = () => C.state.indovina;
    const t = (k, v) => C.t(k, v);
    const h = (...a) => C.h(...a);
    const name = (id) => C.pname(id) || '?';
    const mine = () => C.myPlayers().map((p) => p.id);
    const isMine = (pid) => mine().includes(pid);
    const isHost = () => !!C.state.is_host;
    const lang = () => (window.SpiaApp && window.SpiaApp.lang) || 'en';
    const L = () => (['it', 'en', 'es', 'fr', 'de'].includes(lang()) ? lang() : 'en');
    const wordText = (w) => (w && (w[L()] || w.en)) || '';
    const LOUD = ['found', 'nobody', 'void', 'wrong', 'limit', 'left', 'end'];
    const MARK = { y: '✓', n: '✗', m: '~' };
    const NS = 'http://www.w3.org/2000/svg';

    /** Per match UI state: last event seen, flash, deadline anchor, guess in progress, peek at the word. */
    function ui() {
        const g = G();
        if (!C.ui.iv || C.ui.iv.match !== g.match) C.ui.iv = { match: g.match, lastEvent: 0, flash: [], flashUntil: 0, anchor: null, timer: null, guessing: null, text: '', read: '', peek: false, peekTimer: null, busy: false };
        return C.ui.iv;
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

    const fmt = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

    /** The clock: a number and a bar, both drawn from the server's end instant. */
    function clock(at, total) {
        const secs = () => Math.max(0, Math.ceil((at - Date.now()) / 1000));
        const num = h('time', { class: 'iv-count' }, fmt(secs()));
        const fill = h('div', { class: 'iv-bar-fill' });
        const paint = () => {
            num.textContent = fmt(secs());
            fill.style.width = Math.max(0, Math.min(100, ((at - Date.now()) / 1000 / total) * 100)).toFixed(1) + '%';
            num.classList.toggle('low', secs() <= 30);
        };
        paint();
        clearInterval(ticker);
        ticker = setInterval(() => { if (!num.isConnected) { clearInterval(ticker); return; } paint(); }, 500);
        return h('div', { class: 'iv-clock', role: 'timer', 'aria-label': t('iv_time_left') },
            h('span', { class: 'iv-clock-lead' }, t('iv_time_left')), num, h('div', { class: 'iv-bar', 'aria-hidden': 'true' }, fill));
    }

    function evText(e) {
        const p = e.p ? name(e.p) : '';
        switch (e.t) {
            case 'start': return t('iv_ev_start');
            case 'round': return t('iv_ev_round', { n: e.n, p });
            case 'found': return t('iv_ev_found', { p });
            case 'nobody': return t('iv_ev_nobody');
            case 'void': return t('iv_ev_void');
            case 'wrong': return t('iv_ev_wrong', { p });
            case 'limit': return t('iv_ev_limit');
            case 'left': return t('iv_ev_left', { p });
            case 'end': return t('iv_ev_end');
            default: return '';
        }
    }

    function announce() {
        const u = ui();
        const evs = G().events;
        const loud = evs.filter((e) => e.id > u.lastEvent && LOUD.includes(e.t));
        if (u.lastEvent && loud.length) {
            C.vibrate(loud.some((e) => e.t === 'found') ? [120, 50, 120, 50, 240] : [60, 40, 60]);
            u.flash = loud.slice(-2);
            u.flashUntil = Date.now() + 5000;
            setTimeout(() => C.scheduleRender(), 5100);
        }
        if (evs.length) u.lastEvent = evs[evs.length - 1].id;
        return Date.now() < u.flashUntil ? u.flash : [];
    }

    /** The magnifying glass with a giant question mark: the emblem of the game. */
    function art() {
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 200 200');
        svg.setAttribute('class', 'iv-art');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        const el = (tag, attrs, txt) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (txt) e.textContent = txt; svg.appendChild(e); return e; };
        el('line', { class: 'iv-handle', x1: '128', y1: '128', x2: '184', y2: '184' });
        el('circle', { class: 'iv-lens', cx: '88', cy: '88', r: '64' });
        el('circle', { class: 'iv-lens-in', cx: '88', cy: '88', r: '52' });
        el('text', { class: 'iv-q', x: '88', y: '116', 'text-anchor': 'middle' }, '?');
        el('path', { class: 'iv-glint', d: 'M50 70 A44 44 0 0 1 76 48', fill: 'none' });
        return svg;
    }

    /** Players: points, keeper, who is out of the round. */
    function crowd() {
        const g = G();
        const asking = g.phase === 'ask';
        return h('ul', { class: 'iv-crowd', 'aria-label': t('iv_players') }, g.order.filter((id) => C.playerById(id)).map((id) => {
            const gone = !g.active.includes(id);
            const keeper = asking && g.keeper === id;
            const out = asking && g.tried.includes(id);
            return h('li', { class: 'iv-chip' + (gone ? ' gone' : '') + (isMine(id) ? ' me' : '') + (keeper ? ' keeper' : '') + (out ? ' out' : '') },
                h('span', { class: 'iv-chip-name' }, name(id)),
                h('span', { class: 'iv-chip-pts' }, t('iv_pts_n', { n: g.scores[id] || 0 })),
                keeper ? h('span', { class: 'iv-chip-tag' }, t('iv_keeper_mark')) : null,
                out ? h('span', { class: 'iv-chip-tag' }, t('iv_out_mark')) : null);
        }));
    }

    /** The chalkboard: "Q1: Yes", one line per question the server counted. */
    function board() {
        const g = G();
        return h('section', { class: 'iv-board', 'aria-label': t('iv_board_title') },
            h('h2', { class: 'iv-board-title' }, t('iv_board_title')),
            h('p', { class: 'iv-board-n' }, t('iv_questions_n', { n: g.answers.length, m: g.limit })),
            g.answers.length
                ? h('ol', { class: 'iv-lines' }, g.answers.map((a, i) => h('li', { class: 'iv-line a-' + a },
                    h('span', { class: 'iv-mark', 'aria-hidden': 'true' }, MARK[a]), t('iv_q_line', { n: i + 1, a: t('iv_a_' + a) }))))
                : h('p', { class: 'iv-empty' }, t('iv_board_empty')));
    }

    function keeperPanel(m) {
        const g = G(), u = ui();
        const shared = mine().length > 1;
        const key = `${g.match}:${g.round}`;
        const word = wordText(g.secret && g.secret.word);
        if (shared && u.read !== key) {
            if (C.ui.passed !== m.player_id) {
                return { solo: C.passView(m.player_id, t('iv_pass_keeper'), () => { C.ui.passed = m.player_id; C.ui.heldOnce = null; C.scheduleRender(); }) };
            }
            return { solo: h('section', { class: 'iv-read' }, art(),
                h('p', { class: 'iv-read-lead' }, t('iv_secret_word')),
                h('p', { class: 'iv-word', lang: L() }, word),
                h('p', { class: 'iv-keeper-hint' }, t('iv_keeper_hint')),
                h('button', { class: 'btn primary big', onclick: () => { u.read = key; C.ui.passed = null; u.peek = false; C.scheduleRender(true); } }, t('iv_word_read'))) };
        }
        const full = g.answers.length >= g.limit;
        const show = !shared || u.peek;
        const peek = shared ? h('button', {
            class: 'btn small ghost', 'aria-pressed': String(u.peek),
            onclick: () => {
                u.peek = !u.peek;
                clearTimeout(u.peekTimer);
                if (u.peek) u.peekTimer = setTimeout(() => { u.peek = false; C.scheduleRender(true); }, 6000);
                C.scheduleRender(true);
            },
        }, t(u.peek ? 'iv_hide_word' : 'iv_show_word')) : null;
        const answer = async (a) => {
            if (u.busy) return;
            u.busy = true;
            C.vibrate(20);
            try { await C.run('answer', { player_id: m.player_id, a }); } finally { u.busy = false; }
        };
        return h('section', { class: 'iv-keeper' },
            h('h2', { class: 'iv-keeper-title' }, t('iv_you_keep')),
            h('div', { class: 'iv-secret' }, h('span', { class: 'iv-secret-lead' }, t('iv_secret_word')),
                show ? h('span', { class: 'iv-word', lang: L() }, word) : h('span', { class: 'iv-word hidden' }, t('iv_word_hidden')), peek),
            h('p', { class: 'iv-keeper-hint' }, t('iv_keeper_hint')),
            h('div', { class: 'iv-answers', role: 'group', 'aria-label': t('iv_answer_group') }, ['y', 'n', 'm'].map((a) => h('button', {
                class: 'iv-ans a-' + a, disabled: full || u.busy, onclick: () => answer(a),
            }, h('span', { class: 'iv-ans-mark', 'aria-hidden': 'true' }, MARK[a]), t('iv_a_' + a)))),
            full ? h('p', { class: 'iv-limit' }, t('iv_limit_note')) : null,
            g.answers.length ? h('button', { class: 'btn small ghost iv-undo', onclick: () => C.run('undo', { player_id: m.player_id }) }, t('iv_undo')) : null);
    }

    function guessPanel() {
        const g = G(), u = ui();
        const shared = mine().length > 1;
        const can = g.me.filter((m) => m.can_try);
        const tried = g.me.filter((m) => m.tried);
        if (u.guessing !== null && !can.some((m) => m.player_id === u.guessing)) u.guessing = null;
        if (u.guessing !== null) {
            const pid = u.guessing;
            if (shared && C.ui.passed !== pid) {
                return { solo: C.passView(pid, t('iv_pass_try'), () => { C.ui.passed = pid; C.ui.heldOnce = null; C.scheduleRender(); }) };
            }
            const send = async () => {
                const text = u.text.trim();
                if (!text || u.busy) return;
                u.busy = true;
                C.vibrate(25);
                try {
                    const r = await C.run('guess', { player_id: pid, text });
                    if (r) { u.guessing = null; u.text = ''; C.ui.passed = null; C.scheduleRender(true); }
                } finally { u.busy = false; }
            };
            const input = h('input', {
                id: 'iv-guess', type: 'text', maxlength: '60', autocomplete: 'off', autocapitalize: 'sentences', enterkeyhint: 'done', spellcheck: 'false', value: u.text,
                'aria-label': t('iv_guess_label'), oninput: (e) => { u.text = e.target.value; },
            });
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
            setTimeout(() => { const el = document.getElementById('iv-guess'); if (el && document.activeElement !== el) el.focus(); }, 60);
            return { solo: h('section', { class: 'iv-guess' },
                shared ? h('p', { class: 'iv-guess-who' }, t('iv_try_for', { p: name(pid) })) : null,
                h('label', { class: 'iv-guess-label', for: 'iv-guess' }, t('iv_guess_label')), input,
                h('p', { class: 'iv-try-once' }, t('iv_try_once')),
                h('div', { class: 'row2' },
                    h('button', { class: 'btn ghost', onclick: () => { u.guessing = null; u.text = ''; C.ui.passed = null; C.scheduleRender(true); } }, t('iv_guess_cancel')),
                    h('button', { class: 'btn primary', disabled: u.busy, onclick: send }, t('iv_guess_send')))) };
        }
        return h('section', { class: 'iv-try' },
            can.length ? h('div', { class: 'iv-try-btns', role: 'group', 'aria-label': t('iv_try_group') }, can.map((m) => h('button', {
                class: 'iv-try-btn', onclick: () => { C.vibrate(15); u.guessing = m.player_id; u.text = ''; C.ui.passed = null; C.scheduleRender(true); },
            }, shared ? t('iv_try_for', { p: name(m.player_id) }) : t('iv_try')))) : null,
            tried.length && !can.length && !g.me.some((m) => m.keeper) ? h('p', { class: 'iv-out', role: 'status' }, t('iv_you_out')) : null,
            can.length ? h('p', { class: 'iv-try-once' }, t('iv_try_once')) : null);
    }

    function askView() {
        const g = G();
        const at = endsAt('a', g.left || 0);
        refreshAt(at);
        const keeperMe = g.me.find((m) => m.keeper);
        // a shared phone shows the private screens (pass the phone, read the word) alone
        const kp = keeperMe ? keeperPanel(keeperMe) : null;
        if (kp && kp.solo) return kp;
        const gp = !keeperMe || g.me.some((m) => m.can_try) ? guessPanel() : null;
        if (gp && gp.solo) return gp;
        const parts = [h('h2', { class: 'sr-only' }, t('iv_round_of', { n: g.round, m: g.total })), clock(at, g.rules.time)];
        if (kp) parts.push(kp);
        else parts.push(h('div', { class: 'iv-hint' }, art(), h('div', null, h('span', { class: 'iv-hint-lead' }, t('iv_hint_lead')), h('span', { class: 'iv-hint-cat' }, t('iv_hint_' + g.cat)))),
            h('p', { class: 'iv-wait' }, t('iv_wait_keeper', { p: name(g.keeper) })));
        if (gp) parts.push(gp);
        parts.push(board());
        return h('section', { class: 'iv-round' }, parts);
    }

    function revealView() {
        const g = G(), r = g.reveal;
        if (!r) return null;
        const at = endsAt('r', g.next_left || 0);
        refreshAt(at);
        let headline;
        if (r.kind === 'found') headline = t('iv_rv_found', { p: name(r.p) });
        else if (r.kind === 'nobody') headline = t('iv_rv_nobody', { p: name(r.keeper), n: r.pts[r.keeper] || 0 });
        else headline = t('iv_rv_void');
        const secs = Math.ceil(Math.max(0, (at - Date.now()) / 1000));
        return h('section', { class: 'iv-round reveal' },
            art(),
            r.word ? h('div', { class: 'iv-reveal-word' }, h('span', { class: 'iv-hint-lead' }, t('iv_reveal_title')), h('span', { class: 'iv-word', lang: L() }, wordText(r.word))) : null,
            h('p', { class: 'iv-verdict' + (r.kind === 'found' && isMine(r.p) ? ' hit' : ''), role: 'status' }, headline),
            h('p', { class: 'iv-asked muted small' }, t('iv_rv_asked', { n: r.asked })),
            r.tries.length ? h('div', { class: 'iv-tries' }, h('h3', null, t('iv_rv_tries')),
                h('ul', null, r.tries.filter((x) => C.playerById(x.p)).map((x) => h('li', null, h('b', null, name(x.p)), ': ', h('span', { class: 'iv-try-text' }, x.text))))) : null,
            h('p', { class: 'iv-next muted small' }, t(g.last ? 'iv_results_in' : 'iv_next_in'), ' ', h('b', null, String(secs))),
            isHost() ? h('button', { class: 'btn ghost', onclick: () => C.run('next') }, t(g.last ? 'iv_see_results' : 'iv_next')) : null);
    }

    function feed() {
        const evs = G().events.slice(-8).reverse();
        return h('ol', { class: 'iv-feed' }, evs.map((e) => h('li', { class: LOUD.includes(e.t) ? 'loud ev-' + e.t : 'ev-' + e.t }, evText(e))));
    }

    function hostPanel() {
        if (!isHost()) return null;
        return h('details', { class: 'panel iv-host' },
            h('summary', null, t('iv_host_tools')),
            h('p', { class: 'small muted' }, t('iv_host_note')),
            h('button', { class: 'btn ghost', onclick: () => C.askConfirm(t('iv_end_q'), t('iv_end'), () => C.run('end'), true) }, t('iv_end')));
    }

    function playView() {
        const g = G();
        const flash = announce();
        const shell = g.phase === 'ask' ? askView() : revealView();
        if (g.phase !== 'ask') clearInterval(ticker);
        // the private screens (pass the phone, read the word, type a guess) stand alone
        if (shell && shell.solo) return h('div', { class: 'stack iv' }, shell.solo);
        return h('div', { class: 'stack iv' },
            !C.netOk ? h('div', { class: 'banner warn' }, t('connection_lost')) : null,
            flash.length ? h('div', { class: 'iv-flash', role: 'status' }, flash.map((e) => h('div', null, evText(e)))) : null,
            h('div', { class: 'iv-top' }, h('span', null, t('iv_round_of', { n: g.round, m: g.total })), h('span', null, t('iv_minutes_n', { n: g.rules.time / 60 }))),
            crowd(), shell,
            C.section(t('iv_feed_title'), feed()),
            hostPanel());
    }

    function resultCard() {
        const g = G();
        clearInterval(ticker);
        const res = g.result || { reason: 'host_ended', rows: [], winners: [] };
        const w = res.winners.filter((p) => C.playerById(p));
        const stamp = w.length === 1 ? t('iv_winner', { p: name(w[0]) }) : w.length > 1 ? t('iv_winners', { p: w.map(name).join(', ') }) : t('iv_standings');
        return h('section', { class: 'panel result iv-result' },
            h('div', { class: 'stamp result-stamp' }, stamp),
            h('div', { class: 'muted' }, t('iv_reason_' + res.reason)),
            h('ol', { class: 'iv-standings' }, res.rows.filter((r) => C.playerById(r.p)).map((r) => h('li', { class: 'iv-stand' + (res.winners.includes(r.p) ? ' win' : '') },
                h('span', { class: 'iv-stand-main' }, h('b', null, name(r.p)), h('span', { class: 'iv-stand-n' }, t('iv_stand_n', { a: r.hits, b: r.kept }))),
                h('span', { class: 'iv-stand-pts' }, t('iv_pts_n', { n: r.pts }))))));
    }

    function summary() {
        const s = C.state.settings;
        const chips = [t(s.rounds === 1 ? 'iv_sum_rounds' : 'iv_sum_rounds_n', { n: s.rounds }), t('iv_cat_' + s.cat), t('iv_diff_' + s.diff), t('iv_minutes_n', { n: s.time / 60 })];
        return h('div', { class: 'chips' }, chips.map((c) => h('span', { class: 'chip soft' }, c)));
    }

    function settings(s, { set, host }) {
        const choice = (key, values, label, text) => h('div', { class: 'iv-choices', role: 'group', 'aria-label': label }, values.map((v) => h('button', {
            class: 'btn small' + (s[key] === v ? ' primary' : ' ghost'), disabled: !host, 'aria-pressed': String(s[key] === v), onclick: () => set({ [key]: v }),
        }, text(v))));
        const row = (title, desc, ctrl) => h('div', { class: 'set-row' }, h('div', { class: 'set-text' }, h('span', { class: 'set-title' }, title), h('span', { class: 'set-desc' }, desc)), ctrl);
        return [
            row(t('iv_set_rounds'), t('iv_set_rounds_d'), choice('rounds', [1, 2], t('iv_set_rounds'), String)),
            row(t('iv_set_cat'), t('iv_set_cat_d'), choice('cat', ['mix', 'people', 'objects', 'places', 'animals'], t('iv_set_cat'), (v) => t('iv_cat_' + v))),
            row(t('iv_set_diff'), t('iv_set_diff_d'), choice('diff', ['easy', 'mix', 'hard'], t('iv_set_diff'), (v) => t('iv_diff_' + v))),
            row(t('iv_set_time'), t('iv_set_time_d'), choice('time', [180, 300], t('iv_set_time'), (v) => t('iv_minutes_n', { n: v / 60 }))),
        ];
    }

    return {
        init(core) { C = core; return { playView, resultCard, summary, settings }; },
    };
})();
