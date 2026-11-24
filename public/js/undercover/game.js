// public/js/undercover/game.js
// "Undercover" screens. Runs inside public/js/spia/app.js (rooms, phones, settings, help, render loop); this file draws the match.
// Everybody reads a secret word (hold the folder), says ONE clue out loud in the order the server drew, then everybody votes in secret.
// The server never sends a player's role to its owner (only the word, or nothing for Mr. White) and never another player's word; the
// roles of the eliminated come with the reveal. On a shared phone each local player gets a "pass the phone" screen first.
window.UndercoverGame = (() => {
    'use strict';
    let C = null;

    const G = () => C.state.undercover;
    const t = (k, v) => C.t(k, v);
    const h = (...a) => C.h(...a);
    const name = (id) => C.pname(id) || '?';
    const mine = () => C.myPlayers().map((p) => p.id);
    const isMine = (pid) => mine().includes(pid);
    const isHost = () => !!C.state.is_host;
    const shared = () => mine().length > 1;
    const lang = () => (window.SpiaApp && window.SpiaApp.lang) || 'en';
    const L = () => (['it', 'en', 'es', 'fr', 'de'].includes(lang()) ? lang() : 'en');
    const LANGS = ['it', 'en', 'es', 'fr', 'de'];
    const word = (w) => (Array.isArray(w) ? w[LANGS.indexOf(L())] : '') || '';
    const LOUD = ['out', 'tie', 'left', 'guess_yes', 'guess_no', 'end'];
    const role = (r) => t('uc_role_' + r);
    const meOf = (pid) => G().me.find((m) => m.player_id === pid) || null;

    /** Per match UI state: last event seen, flash, picked target, typed guess, "show my word" screen. */
    function ui() {
        const g = G();
        if (!C.ui.uc || C.ui.uc.match !== g.match) C.ui.uc = { match: g.match, lastEvent: 0, flash: [], flashUntil: 0, pick: null, pickKey: '', review: null, busy: false };
        return C.ui.uc;
    }

    function evText(e) {
        const p = e.p ? name(e.p) : '';
        switch (e.t) {
            case 'start': return t('uc_ev_start');
            case 'round': return t('uc_ev_round', { n: e.n });
            case 'out': return t('uc_ev_out', { p, r: role(e.r) });
            case 'tie': return t('uc_ev_tie', { names: (e.ps || []).map(name).join(', ') });
            case 'left': return t('uc_ev_left', { p });
            case 'guess_yes': return t('uc_ev_guess_yes', { p });
            case 'guess_no': return t('uc_ev_guess_no', { p });
            case 'end': return t('uc_ev_end');
            default: return '';
        }
    }

    function announce() {
        const u = ui();
        const evs = G().events;
        const loud = evs.filter((e) => e.id > u.lastEvent && LOUD.includes(e.t));
        if (u.lastEvent && loud.length) {
            C.vibrate(loud.some((e) => e.t === 'out') ? [200, 60, 200] : [60, 40, 60]);
            u.flash = loud.slice(-2);
            u.flashUntil = Date.now() + 5000;
            setTimeout(() => C.scheduleRender(), 5100);
        }
        if (evs.length) u.lastEvent = evs[evs.length - 1].id;
        return Date.now() < u.flashUntil ? u.flash : [];
    }

    /** The row of players: who is out (with the role the reveal gave), who speaks, who voted (only that, never for whom). */
    function crowd() {
        const g = G();
        const voting = g.phase === 'vote';
        return h('ul', { class: 'uc-crowd', 'aria-label': t('uc_players') }, g.order.filter((id) => C.playerById(id)).map((id) => {
            const o = g.out.find((x) => x.p === id);
            const speaking = g.phase === 'clue' && g.speaker === id;
            const done = voting && g.voted.includes(id);
            return h('li', { class: 'uc-chip' + (o ? ' gone' : '') + (isMine(id) ? ' me' : '') + (speaking ? ' speaking' : '') + (done ? ' done' : '') },
                h('span', { class: 'uc-chip-name' }, name(id)),
                o ? h('span', { class: 'uc-chip-role ' + o.role }, o.left ? t('uc_left') : role(o.role)) : null,
                !o && done ? h('span', { class: 'uc-chip-state', 'aria-hidden': 'true' }, '✓') : null,
                !o && done ? h('span', { class: 'sr-only' }, t('uc_voted_mark')) : null,
                speaking ? h('span', { class: 'sr-only' }, t('uc_speaking_mark')) : null);
        }));
    }

    /** The word folder: what is written on the back of the card the player holds. */
    function dossierBack(m) {
        const w = word(m.word);
        return h('div', { class: 'card-face card-back uc-dossier', dataset: { player: m.player_id } },
            h('div', { class: 'uc-conf', 'aria-hidden': 'true' }, t('uc_confidential')),
            h('div', { class: 'card-label' }, name(m.player_id)),
            h('div', { class: 'card-sub' }, t('uc_your_word')),
            h('div', { class: 'uc-word' + (w ? '' : ' blank'), lang: w ? L() : null }, w || '?'),
            h('p', { class: 'card-text' }, t('uc_card_note')));
    }

    /** On a shared phone, first hand it to the right person. */
    function withPass(pid, title, draw) {
        if (shared() && C.ui.passed !== pid) {
            return C.passView(pid, title, () => { C.ui.passed = pid; C.ui.heldOnce = null; ui().pick = null; C.scheduleRender(); });
        }
        return draw();
    }

    function readView() {
        const g = G();
        const todo = g.me.filter((m) => m.alive && !m.seen);
        if (todo.length) {
            const m = todo[0], pid = m.player_id;
            return withPass(pid, t('pass_phone_to'), () => {
                const btn = h('button', { class: 'btn primary big', disabled: C.ui.heldOnce !== pid, onclick: async () => {
                    const r = await C.run('seen', { player_id: pid });
                    if (r) { C.ui.passed = null; C.ui.heldOnce = null; C.scheduleRender(true); }
                } }, t('got_it'));
                return h('div', { class: 'reveal' },
                    h('div', { class: 'muted center' }, t('uc_round_n', { n: g.round })),
                    C.holdCard({ player_id: pid }, () => { C.ui.heldOnce = pid; btn.disabled = false; }, dossierBack(m)),
                    h('p', { class: 'muted small center' }, t('hold_note')),
                    h('div', { class: 'bottom-bar' }, btn));
            });
        }
        return C.section(t('uc_read_title'), h('p', { class: 'uc-wait' }, t('uc_read_wait', { n: g.seen.length, m: g.alive.length })), mixLine(), reviewButton(),
            isHost() ? h('button', { class: 'btn ghost', onclick: () => C.run('next') }, t('uc_start_clues')) : null);
    }

    function mixLine() {
        const g = G();
        return h('p', { class: 'uc-mix muted small' }, t('uc_mix', { k: g.rules.k }) + (g.rules.w ? ' ' + t('uc_mix_white') : ''));
    }

    /** "Show my word": again behind the same hold-to-read card (picks the player first on a shared phone). */
    function reviewButton() {
        const alive = G().me.filter((m) => m.alive && m.word !== undefined);
        if (!alive.length) return null;
        return h('button', { class: 'btn ghost', onclick: () => { const u = ui(); u.review = alive.length === 1 ? alive[0].player_id : 'pick'; C.ui.passed = null; C.scheduleRender(true); } }, t('uc_show_word'));
    }

    function reviewView() {
        const u = ui();
        const close = () => { u.review = null; C.ui.passed = null; C.ui.heldOnce = null; C.scheduleRender(true); };
        if (u.review === 'pick') {
            return h('div', { class: 'stack' },
                h('h2', { class: 'center' }, t('uc_who_are_you')),
                h('div', { class: 'uc-targets' }, G().me.filter((m) => m.alive).map((m) => h('button', { class: 'uc-target', onclick: () => { u.review = m.player_id; C.scheduleRender(true); } }, h('span', null, name(m.player_id))))),
                h('div', { class: 'bottom-bar' }, h('button', { class: 'btn ghost big', onclick: close }, t('close'))));
        }
        const m = meOf(u.review);
        if (!m) { u.review = null; return null; }
        return withPass(m.player_id, t('pass_phone_to'), () => h('div', { class: 'reveal' },
            C.holdCard({ player_id: m.player_id }, null, dossierBack(m)),
            h('p', { class: 'muted small center' }, t('hold_note')),
            h('div', { class: 'bottom-bar' }, h('button', { class: 'btn big', onclick: close }, t('close')))));
    }

    function clueView() {
        const g = G();
        const cur = g.speaker;
        const can = cur !== null && (isMine(cur) || isHost());
        return C.section(t('uc_clue_title', { n: g.round }),
            h('div', { class: 'uc-turn', role: 'status' },
                h('span', { class: 'uc-turn-lead' }, t('uc_clue_turn')),
                h('span', { class: 'uc-turn-name' }, cur !== null ? name(cur) : '')),
            h('p', { class: 'uc-hint' }, t('uc_clue_rule')),
            h('ol', { class: 'uc-order', 'aria-label': t('uc_order') }, g.speakers.filter((id) => C.playerById(id)).map((id, i) => h('li', { class: i < g.turn ? 'spoken' : (id === cur ? 'now' : '') },
                h('span', null, name(id)), i < g.turn ? h('span', { class: 'sr-only' }, ' ' + t('uc_spoken')) : null))),
            can ? h('button', { class: 'btn primary big', disabled: ui().busy, onclick: async () => { ui().busy = true; C.vibrate(20); try { await C.run('clue_done'); } finally { ui().busy = false; } } },
                t(isMine(cur) ? 'uc_clue_done' : 'uc_clue_skip')) : h('p', { class: 'uc-wait' }, t('uc_clue_wait', { p: cur !== null ? name(cur) : '' })),
            reviewButton());
    }

    function voteView() {
        const g = G(), u = ui();
        const todo = g.me.filter((m) => m.alive && !m.voted);
        const pool = g.cands || g.alive;
        const tie = g.cands ? h('div', { class: 'banner warn uc-tie', role: 'status' }, t('uc_tie', { names: g.cands.map(name).join(', ') })) : null;
        if (todo.length) {
            const pid = todo[0].player_id;
            return withPass(pid, t('uc_pass_vote'), () => {
                const key = `${g.round}:${g.cands ? g.cands.join('-') : ''}:${pid}`;
                if (u.pickKey !== key) { u.pickKey = key; u.pick = null; }
                const targets = pool.filter((id) => id !== pid && C.playerById(id));
                return C.section(t('uc_vote_title', { n: g.round }), tie,
                    shared() ? h('p', { class: 'uc-who' }, t('uc_voting', { p: name(pid) })) : null,
                    h('p', { class: 'uc-hint' }, t('uc_vote_hint')),
                    h('div', { class: 'uc-targets', role: 'group', 'aria-label': t('uc_vote_hint') }, targets.map((id) => h('button', {
                        class: 'uc-target' + (u.pick === id ? ' on' : ''), 'aria-pressed': String(u.pick === id),
                        onclick: () => { C.vibrate(15); u.pick = id; C.scheduleRender(true); },
                    }, h('span', null, name(id))))),
                    h('button', {
                        class: 'btn primary big', disabled: u.pick === null || u.busy,
                        onclick: async () => {
                            const target = u.pick;
                            if (target === null || u.busy) return;
                            u.busy = true; C.vibrate(25); C.ui.passed = null; u.pick = null;
                            try { await C.run('vote', { player_id: pid, target }); } finally { u.busy = false; }
                        },
                    }, t('uc_lock')));
            });
        }
        const out = !g.me.some((m) => m.alive);
        return C.section(t('uc_vote_title', { n: g.round }), tie,
            h('p', { class: 'uc-wait' }, out ? t('uc_gone') : t('uc_vote_wait', { n: g.voted.length, m: g.alive.length })),
            reviewButton(),
            isHost() && g.voted.length ? h('button', { class: 'btn ghost', onclick: () => C.run('next') }, t('uc_count_now')) : null);
    }

    function guessView() {
        const g = G(), u = ui();
        const p = g.guess.p;
        const m = g.me.find((x) => x.guesser);
        const skip = isHost() ? h('button', { class: 'btn ghost', onclick: () => C.run('next') }, t('uc_guess_skip')) : null;
        if (!m) return C.section(t('uc_guess_title'), h('div', { class: 'uc-stamp red', 'aria-hidden': 'true' }, role('white')), h('p', { class: 'uc-wait' }, t('uc_guess_wait', { p: name(p) })), skip);
        return withPass(p, t('pass_phone_to'), () => {
            const input = h('input', { id: 'uc-guess', class: 'uc-guess', type: 'text', maxlength: '40', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', 'aria-label': t('uc_guess_label') });
            const send = async () => {
                const text = input.value.trim();
                if (!text || u.busy) return;
                u.busy = true;
                try { const r = await C.run('guess', { player_id: p, text }); if (r) C.ui.passed = null; } finally { u.busy = false; }
            };
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
            return C.section(t('uc_guess_title'), h('div', { class: 'uc-stamp red', 'aria-hidden': 'true' }, role('white')),
                h('p', { class: 'uc-hint' }, t('uc_guess_p', { p: name(p) })), input,
                h('button', { class: 'btn primary big', onclick: send }, t('uc_guess_send')), skip);
        });
    }

    function revealView() {
        const g = G(), l = g.last;
        if (!l) return null;
        const left = Math.ceil(g.next_left || 0);
        const votes = Object.entries(l.choices || {}).filter(([v]) => C.playerById(Number(v)));
        return C.section(t('uc_out_title'),
            h('div', { class: 'uc-dossier-out' },
                h('div', { class: 'uc-out-name' }, name(l.p)),
                h('div', { class: 'uc-stamp ' + (l.role === 'civ' ? 'green' : 'red'), role: 'status' }, role(l.role)),
                g.guess && g.guess.ok === false ? h('p', { class: 'uc-hint' }, t('uc_guess_no_line', { p: name(g.guess.p), w: g.guess.text || '—' })) : null),
            votes.length ? h('details', { class: 'uc-votes', open: true }, h('summary', null, t('uc_votes_title')),
                h('ul', null, votes.map(([v, to]) => h('li', null, t('uc_vote_row', { a: name(Number(v)), b: name(to) }))))) : null,
            h('p', { class: 'uc-next muted small' }, t('uc_next_in', { n: left })),
            isHost() ? h('button', { class: 'btn ghost', onclick: () => C.run('next') }, t('uc_next')) : null);
    }

    function feed() {
        const evs = G().events.slice(-8).reverse();
        return h('ol', { class: 'uc-feed' }, evs.map((e) => h('li', { class: LOUD.includes(e.t) ? 'loud' : '' }, evText(e))));
    }

    function hostPanel() {
        if (!isHost()) return null;
        return h('details', { class: 'panel uc-host' },
            h('summary', null, t('uc_host_tools')),
            h('p', { class: 'small muted' }, t('uc_host_note')),
            h('button', { class: 'btn ghost', onclick: () => C.askConfirm(t('uc_end_q'), t('uc_end'), () => C.run('end'), true) }, t('uc_end')));
    }

    function playView() {
        const g = G(), u = ui();
        const flash = announce();
        if (u.review) { const v = reviewView(); if (v) return v; }
        const main = { read: readView, clue: clueView, vote: voteView, guess: guessView, reveal: revealView }[g.phase];
        return h('div', { class: 'stack uc' },
            !C.netOk ? h('div', { class: 'banner warn' }, t('connection_lost')) : null,
            flash.length ? h('div', { class: 'uc-flash', role: 'status' }, flash.map((e) => h('div', null, evText(e)))) : null,
            h('div', { class: 'uc-top' }, h('span', null, t('uc_round_n', { n: g.round })), h('span', null, t('uc_alive_n', { n: g.alive.length }))),
            crowd(), main ? main() : null,
            C.section(t('uc_feed_title'), feed()),
            hostPanel());
    }

    function resultCard() {
        const g = G();
        const res = g.result || { reason: 'host_ended', rows: [], winner: null, civ: [], und: [] };
        const rows = res.rows.filter((r) => C.playerById(r.p));
        return h('section', { class: 'panel result uc-result' },
            h('div', { class: 'stamp result-stamp uc-win ' + (res.winner || 'none') }, t('uc_winner_' + (res.winner || 'none'))),
            h('div', { class: 'muted' }, t('uc_reason_' + res.reason)),
            res.civ.length ? h('div', { class: 'uc-words' },
                h('div', null, h('span', { class: 'muted small' }, t('uc_civ_word')), h('strong', { lang: L() }, word(res.civ))),
                h('div', null, h('span', { class: 'muted small' }, t('uc_und_word')), h('strong', { lang: L() }, word(res.und)))) : null,
            res.guess && res.guess.text ? h('p', { class: 'uc-hint' }, t(res.guess.ok ? 'uc_guess_yes_line' : 'uc_guess_no_line', { p: name(res.guess.p), w: res.guess.text })) : null,
            h('ul', { class: 'uc-standings' }, rows.map((r) => h('li', { class: 'uc-stand ' + r.role },
                h('span', { class: 'uc-stand-main' }, h('b', null, name(r.p)), h('span', { class: 'uc-chip-role ' + r.role }, role(r.role))),
                h('span', { class: 'uc-stand-n' }, r.left ? t('uc_left') : (r.out ? t('uc_row_out', { n: r.out }) : t('uc_row_in')))))));
    }

    function summary() {
        const s = C.state.settings;
        const chips = [t('uc_sum_infil', { n: s.infil }), t(s.white ? 'uc_sum_white' : 'uc_sum_nowhite')];
        return h('div', { class: 'chips' }, chips.map((c) => h('span', { class: 'chip soft' }, c)));
    }

    function settings(s, { set, host }) {
        const btn = (on, label, fn, extra = {}) => h('button', { class: 'btn small' + (on ? ' primary' : ' ghost'), disabled: !host, 'aria-pressed': String(on), onclick: fn, ...extra }, label);
        const row = (title, desc, ctrl) => h('div', { class: 'set-row' }, h('div', { class: 'set-text' }, h('span', { class: 'set-title' }, title), h('span', { class: 'set-desc' }, desc)), ctrl);
        const n = (C.state.players || []).length;
        const max = Math.max(1, Math.floor((n - 1) / 2));
        return [
            row(t('uc_set_infil'), t('uc_set_infil_d', { n, k: max }), h('div', { class: 'uc-choices', role: 'group', 'aria-label': t('uc_set_infil') },
                [1, 2, 3].map((v) => btn(s.infil === v, String(v), () => set({ infil: v }))))),
            row(t('uc_set_white'), t('uc_set_white_d'), h('div', { class: 'uc-choices', role: 'group', 'aria-label': t('uc_set_white') },
                [true, false].map((v) => btn(s.white === v, t(v ? 'uc_on' : 'uc_off'), () => set({ white: v }))))),
            row(t('uc_set_cats'), t('uc_set_cats_d'), h('div', { class: 'uc-choices', role: 'group', 'aria-label': t('uc_set_cats') },
                [0, 1, 2, 3, 4].map((c) => btn(s.cats.includes(c), t('uc_cat_' + c), () => {
                    const next = s.cats.includes(c) ? s.cats.filter((x) => x !== c) : [...s.cats, c].sort();
                    if (next.length) set({ cats: next });
                })))),
        ];
    }

    return {
        init(core) { C = core; return { playView, resultCard, summary, settings }; },
    };
})();
