// public/js/inventato/game.js
// "Fake or fact" screens. Runs inside public/js/spia/app.js (rooms, phones, settings, help, render loop); this file draws the match.
// Everybody decides in secret whether the claim is TRUE or MADE UP; the server holds the truth, times the answers (the phone never
// sends a time) and sends the truth and its explanation only once the round is over. On a shared phone each local player is asked
// in turn behind a "pass the phone" screen. The countdown is drawn from the time left that the server reports.
// Also alone (no room, 3 lives, best result per level on the account through js/records.js).
window.InventatoGame = (() => {
    'use strict';
    let C = null;
    let ticker = null;

    const G = () => C.state.inventato;
    const t = (k, v) => C.t(k, v);
    const h = (...a) => C.h(...a);
    const name = (id) => C.pname(id) || '?';
    const mine = () => C.myPlayers().map((p) => p.id);
    const isMine = (pid) => mine().includes(pid);
    const isHost = () => !!C.state.is_host;
    const lang = () => { const l = window.SpiaApp && window.SpiaApp.lang; return ['it', 'en', 'es', 'fr', 'de'].includes(l) ? l : 'en'; };
    const LOUD = ['left', 'end'];
    const LEVELS = ['easy', 'hard', 'mix'];

    /** Per match UI state: deadline anchor (a new poll does not restart the countdown), flashes, timers. */
    function ui() {
        const g = G();
        if (!C.ui.vi || C.ui.vi.match !== g.match) C.ui.vi = { match: g.match, lastEvent: 0, flash: [], flashUntil: 0, anchor: null, timer: null };
        return C.ui.vi;
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
        const bar = h('div', { class: 'vi-bar', 'aria-hidden': 'true' }, h('div', { class: 'vi-bar-fill', style: `animation-duration:${total}s;animation-delay:-${Math.max(0, total - left).toFixed(2)}s` }));
        const num = h('span', { class: 'vi-count', 'aria-live': 'off' }, String(Math.ceil(left)));
        clearInterval(ticker);
        ticker = setInterval(() => {
            if (!num.isConnected) { clearInterval(ticker); return; }
            num.textContent = String(Math.max(0, Math.ceil((at - Date.now()) / 1000)));
        }, 250);
        return h('div', { class: 'vi-clock' }, bar, num);
    }

    const claimText = (q) => q.text[lang()] || q.text.en;
    const explainText = (r) => r.explain[lang()] || r.explain.en;
    const verdictWord = (truth) => t(truth ? 'vi_true' : 'vi_fake');

    /** The newspaper clipping: category strip + the claim as a headline. */
    function clipping(q, extra) {
        return h('article', { class: 'vi-card' },
            h('div', { class: 'vi-strip' }, h('span', null, t('vi_cat_' + q.cat)), h('span', null, t('vi_edition'))),
            h('p', { class: 'vi-claim' }, claimText(q)), extra || null);
    }

    function evText(e) {
        const p = e.p ? name(e.p) : '';
        switch (e.t) {
            case 'start': return t('vi_ev_start');
            case 'question': return t('vi_ev_round', { n: e.n });
            case 'left': return t('vi_ev_left', { p });
            case 'end': return t('vi_ev_end');
            default: return '';
        }
    }
    function announce() {
        const u = ui();
        const evs = G().events;
        const loud = evs.filter((e) => e.id > u.lastEvent && LOUD.includes(e.t));
        if (u.lastEvent && loud.length) {
            C.vibrate([60, 40, 60]);
            u.flash = loud.slice(-2);
            u.flashUntil = Date.now() + 5000;
            setTimeout(() => C.scheduleRender(), 5100);
        }
        if (evs.length) u.lastEvent = evs[evs.length - 1].id;
        return Date.now() < u.flashUntil ? u.flash : [];
    }

    /** The row of readers: points, and who already answered (only that, never what). */
    function crowd() {
        const g = G();
        const voting = g.phase === 'question';
        return h('ul', { class: 'vi-crowd', 'aria-label': t('vi_players') }, g.order.filter((id) => C.playerById(id)).map((id) => {
            const active = g.active.includes(id);
            const done = voting && g.answered.includes(id);
            return h('li', { class: 'vi-chip' + (active ? '' : ' gone') + (isMine(id) ? ' me' : '') + (done ? ' done' : '') },
                h('span', { class: 'vi-chip-name' }, name(id)),
                h('span', { class: 'vi-chip-pts' }, String(g.points[id] || 0)),
                h('span', { class: 'vi-chip-state', 'aria-hidden': 'true' }, active && voting ? (done ? '✓' : '…') : ''),
                done ? h('span', { class: 'sr-only' }, t('vi_answered_mark')) : null);
        }));
    }

    function questionView() {
        const g = G(), q = g.q, u = ui();
        const todo = g.me.filter((m) => m.active && !m.answered);
        const at = endsAt('q', q.left);
        refreshAt(at);
        const title = t('vi_round_of', { n: g.round, m: g.total });
        if (todo.length) {
            const m = todo[0];
            const shared = mine().length > 1;
            if (shared && C.ui.passed !== m.player_id) {
                return C.passView(m.player_id, t('vi_pass_to'), () => { C.ui.passed = m.player_id; C.ui.heldOnce = null; C.scheduleRender(); });
            }
            const send = (choice) => { C.vibrate(25); C.ui.passed = null; C.run('answer', { player_id: m.player_id, choice }); };
            return C.section(title, countdown(at, q.time), clipping(q),
                shared ? h('p', { class: 'vi-who' }, t('vi_answering', { p: name(m.player_id) })) : null,
                h('p', { class: 'vi-hint' }, t('vi_decide')),
                h('div', { class: 'vi-verdicts', role: 'group', 'aria-label': t('vi_decide') },
                    h('button', { class: 'vi-btn is-true', onclick: () => send(1) }, h('span', { class: 'vi-btn-mark', 'aria-hidden': 'true' }, '✓'), t('vi_true')),
                    h('button', { class: 'vi-btn is-fake', onclick: () => send(0) }, h('span', { class: 'vi-btn-mark', 'aria-hidden': 'true' }, '✗'), t('vi_fake'))));
        }
        const out = !g.me.some((m) => m.active);
        return C.section(title, countdown(at, q.time), clipping(q),
            h('p', { class: 'vi-wait' }, out ? t('vi_gone') : t('vi_wait', { n: g.answered.length, m: g.active.length })));
    }

    function revealView() {
        const g = G(), q = g.q, r = g.reveal;
        if (!q || !r) return null;
        const at = endsAt('r', g.next_left || 0);
        refreshAt(at);
        const rows = g.active.filter((id) => C.playerById(id));
        return C.section(t('vi_reveal_title'), clipping(q, h('div', { class: 'vi-stamp ' + (r.truth ? 'is-true' : 'is-fake'), role: 'status' }, verdictWord(r.truth))),
            h('p', { class: 'vi-explain' }, explainText(r)),
            h('ul', { class: 'vi-rows' }, rows.map((id) => {
                const pick = r.answers[id], gain = r.gain[id];
                const ok = gain !== undefined;
                return h('li', { class: 'vi-row' + (ok ? ' ok' : ' no') + (isMine(id) ? ' me' : '') },
                    h('span', { class: 'vi-row-name' }, name(id)),
                    h('span', { class: 'vi-row-pick' }, pick === undefined ? t('vi_no_answer') : verdictWord(pick === 1)),
                    h('span', { class: 'vi-row-gain' }, ok ? '✓ ' + t('vi_plus', { n: gain }) : '✗'));
            })),
            h('p', { class: 'vi-next muted small' }, t(r.last ? 'vi_results_in' : 'vi_next_in'), ' ', h('b', { class: 'vi-count' }, String(Math.ceil(Math.max(0, (at - Date.now()) / 1000))))),
            isHost() ? h('button', { class: 'btn ghost', onclick: () => C.run('next') }, t(r.last ? 'vi_see_results' : 'vi_next')) : null);
    }

    function feed() {
        const evs = G().events.slice(-8).reverse();
        return h('ol', { class: 'vi-feed' }, evs.map((e) => h('li', { class: LOUD.includes(e.t) ? 'loud' : '' }, evText(e))));
    }

    function hostPanel() {
        if (!isHost()) return null;
        return h('details', { class: 'panel vi-host' },
            h('summary', null, t('vi_host_tools')),
            h('p', { class: 'small muted' }, t('vi_host_note')),
            h('button', { class: 'btn ghost', onclick: () => C.askConfirm(t('vi_end_q'), t('vi_end'), () => C.run('end'), true) }, t('vi_end')));
    }

    function playView() {
        const g = G();
        const flash = announce();
        return h('div', { class: 'stack vi' },
            !C.netOk ? h('div', { class: 'banner warn' }, t('connection_lost')) : null,
            flash.length ? h('div', { class: 'vi-flash', role: 'status' }, flash.map((e) => h('div', null, evText(e)))) : null,
            h('div', { class: 'vi-top' }, h('span', null, t('vi_round_of', { n: g.round, m: g.total })), h('span', null, t('vi_seconds_n', { n: g.rules.time }))),
            crowd(),
            g.phase === 'question' && g.q ? questionView() : revealView(),
            C.section(t('vi_feed_title'), feed()),
            hostPanel());
    }

    function resultCard() {
        const g = G();
        const res = g.result || { reason: 'host_ended', winners: [], points: {}, right: {} };
        const order = g.order.filter((id) => C.playerById(id)).sort((a, b) => (res.points[b] || 0) - (res.points[a] || 0));
        return h('section', { class: 'panel result vi-result' },
            h('div', { class: 'stamp result-stamp' }, res.winners.length ? t(res.winners.length > 1 ? 'vi_winners' : 'vi_winner', { p: res.winners.filter((id) => C.playerById(id)).map(name).join(', ') }) : t('vi_no_winner')),
            h('div', { class: 'muted' }, t('vi_reason_' + res.reason)),
            h('ol', { class: 'vi-standings' }, order.map((id) => h('li', { class: 'vi-stand' + (res.winners.includes(id) ? ' win' : '') },
                h('span', { class: 'vi-stand-name' }, (res.winners.includes(id) ? '★ ' : '') + name(id)),
                h('span', { class: 'vi-stand-n' }, t('vi_pts', { n: res.points[id] || 0 }) + ' · ' + t('vi_right_n', { n: (res.right || {})[id] || 0 }))))));
    }

    function summary() {
        const s = C.state.settings;
        const chips = [t('vi_level_' + s.level), t('vi_sum_rounds', { n: s.rounds }), t('vi_seconds_n', { n: s.time })];
        if (s.scores) chips.push(t('set_scores'));
        return h('div', { class: 'chips' }, chips.map((c) => h('span', { class: 'chip soft' }, c)));
    }

    function choiceRow(title, desc, cur, values, labelOf, onPick, host) {
        return h('div', { class: 'set-row' },
            h('div', { class: 'set-text' }, h('span', { class: 'set-title' }, title), h('span', { class: 'set-desc' }, desc)),
            h('div', { class: 'vi-choices', role: 'group', 'aria-label': title }, values.map((k) => h('button', {
                class: 'btn small' + (cur === k ? ' primary' : ' ghost'), disabled: !host, 'aria-pressed': String(cur === k), onclick: () => onPick(k),
            }, labelOf(k)))));
    }
    function settings(s, { set, toggle, host }) {
        return [
            choiceRow(t('vi_set_level'), t('vi_set_level_d'), s.level, LEVELS, (k) => t('vi_level_' + k), (k) => set({ level: k }), host),
            choiceRow(t('vi_set_rounds'), t('vi_set_rounds_d'), s.rounds, [10, 15, 20], String, (k) => set({ rounds: k }), host),
            choiceRow(t('vi_set_time'), t('vi_set_time_d'), s.time, [15, 25, 40], (k) => t('vi_seconds_n', { n: k }), (k) => set({ time: k }), host),
            toggle('scores', t('set_scores'), t('vi_set_scores_d')),
        ];
    }

    // ===================== alone (no room, three lives) =====================
    // Claims come from api/inventato_solo.php inside a sealed token (no truth in it); the answer is checked there too.
    const API_SOLO = '../api/inventato_solo.php';
    let solo = null;   // null = the lobby / a room; otherwise { screen, level, ... }
    const store = {
        get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
        set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    };
    const render = () => C.scheduleRender(true);   // forced: the solo state is not part of the room render signature
    const soloStop = () => { if (solo) { clearTimeout(solo.timer); clearInterval(ticker); } };
    const go = (screen, extra = {}) => { soloStop(); Object.assign(solo, extra, { screen }); render(); };
    const bestKey = (l) => 'vb_inventato_best_' + l;

    /** At the start of a solo game: merge this phone's bests with the account's (js/records.js, only when logged in). */
    function syncRecords() {
        if (!window.VBRecords) return;
        const local = {};
        LEVELS.forEach((l) => { const n = store.get(bestKey(l), 0); if (n > 0) local[l] = n; });
        VBRecords.sync('inventato', local).then((m) => {
            if (!m) return;
            let changed = false;
            LEVELS.forEach((l) => { if (m[l] > (local[l] || 0)) { store.set(bestKey(l), m[l]); changed = true; } });
            if (changed && solo) render();
        });
    }
    function startSolo() {
        syncRecords();
        solo = { screen: 'setup', level: store.get('vb_inventato_level', 'mix'), seen: [], round: 1, busy: false, lives: 3, right: 0, points: 0 };
        render();
    }
    function leaveSolo() { soloStop(); solo = null; render(); }

    async function fetchClaim() {
        solo.busy = true; render();
        try {
            const r = await fetch(`${API_SOLO}?action=question&level=${solo.level}&exclude=${solo.seen.slice(-120).join(',')}`, { cache: 'no-store' });
            const j = await r.json();
            if (!j.success) throw new Error(j.error || 'x');
            solo.q = j; solo.seen.push(j.sid);
        } catch (e) { solo.busy = false; C.toast(t('vi_load_error')); go('setup'); return false; }
        solo.busy = false;
        return true;
    }
    async function checkAnswer(choice) {
        try {
            const r = await fetch(API_SOLO, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: solo.q.token, choice }) });
            const j = await r.json();
            return j.success ? j : null;
        } catch (e) { return null; }
    }
    async function nextClaim() {
        if (!(await fetchClaim())) return;
        solo.started = Date.now();
        solo.deadline = solo.started + solo.q.time * 1000;
        solo.locked = false;
        go('question');
        solo.timer = setTimeout(() => answerSolo(null), solo.q.time * 1000 + 50);
    }
    async function answerSolo(choice) {
        if (solo.screen !== 'question' || solo.locked) return;
        solo.locked = true;
        clearTimeout(solo.timer);
        const j = await checkAnswer(choice);
        if (!j) { C.toast(t('vi_load_error')); go('setup'); return; }
        if (j.right) { solo.right++; solo.points += j.points; C.vibrate(25); } else { solo.lives--; C.vibrate([200, 60, 200]); }
        if (solo.right > store.get(bestKey(solo.level), 0)) { store.set(bestKey(solo.level), solo.right); if (window.VBRecords) VBRecords.submit('inventato', solo.level, solo.right); }
        go('reveal', { reveal: j, timeup: choice === null });
    }

    function soloStatus() {
        return h('div', { class: 'vi-top' }, h('span', null, t('vi_level_' + solo.level)),
            h('span', { 'aria-label': t('vi_lives_n', { n: Math.max(0, solo.lives) }) }, t('vi_score_n', { n: solo.right }) + ' · ' + '♥'.repeat(Math.max(0, solo.lives))));
    }
    function soloSetup() {
        const levels = h('div', { class: 'vi-choices', role: 'group', 'aria-label': t('vi_set_level') }, LEVELS.map((k) => h('button', {
            class: 'btn small' + (solo.level === k ? ' primary' : ' ghost'), 'aria-pressed': String(solo.level === k), onclick: () => { solo.level = k; store.set('vb_inventato_level', k); render(); } }, t('vi_level_' + k))));
        return C.section(null, h('h2', null, t('vi_solo')), h('p', { class: 'muted small' }, t('vi_solo_d')), h('h3', { class: 'set-group' }, t('vi_set_level')), levels,
            h('p', { class: 'small muted' }, t('vi_best_n', { n: store.get(bestKey(solo.level), 0) })),
            h('button', { class: 'btn primary big', onclick: () => { Object.assign(solo, { round: 1, seen: [], lives: 3, right: 0, points: 0 }); nextClaim(); } }, t('vi_start_solo')),
            h('button', { class: 'btn ghost', onclick: leaveSolo }, t('vi_back')));
    }
    function soloOver() {
        return h('section', { class: 'panel result vi-result' },
            h('div', { class: 'stamp result-stamp' }, t('vi_game_over')),
            h('p', { class: 'center' }, t('vi_score_n', { n: solo.right }) + ' · ' + t('vi_pts', { n: solo.points }) + ' · ' + t('vi_best_n', { n: store.get(bestKey(solo.level), 0) })),
            h('div', { class: 'row2' }, h('button', { class: 'btn ghost', onclick: leaveSolo }, t('vi_back')),
                h('button', { class: 'btn primary', onclick: () => go('setup') }, t('vi_play_again'))));
    }
    function soloView() {
        if (solo.busy) return h('div', { class: 'center muted' }, t('vi_loading'));
        const s = solo.screen;
        if (s === 'setup') return soloSetup();
        if (s === 'over') return soloOver();
        const q = solo.q;
        if (s === 'question') {
            return h('div', { class: 'stack vi' }, soloStatus(), C.section(t('vi_question_n', { n: solo.round }), countdown(solo.deadline, q.time), clipping(q),
                h('p', { class: 'vi-hint' }, t('vi_decide')),
                h('div', { class: 'vi-verdicts', role: 'group', 'aria-label': t('vi_decide') },
                    h('button', { class: 'vi-btn is-true', onclick: () => answerSolo(1) }, h('span', { class: 'vi-btn-mark', 'aria-hidden': 'true' }, '✓'), t('vi_true')),
                    h('button', { class: 'vi-btn is-fake', onclick: () => answerSolo(0) }, h('span', { class: 'vi-btn-mark', 'aria-hidden': 'true' }, '✗'), t('vi_fake')))));
        }
        const r = solo.reveal;     // screen === 'reveal'
        const done = solo.lives <= 0;
        return h('div', { class: 'stack vi' }, soloStatus(), C.section(t('vi_reveal_title'), clipping(q, h('div', { class: 'vi-stamp ' + (r.truth ? 'is-true' : 'is-fake'), role: 'status' }, verdictWord(r.truth))),
            h('p', { class: 'vi-explain' }, explainText(r)),
            h('p', { class: 'vi-verdict' + (r.right ? '' : ' hit') }, r.right ? t('vi_plus', { n: r.points }) : (solo.timeup ? t('vi_timeup') : t('vi_wrong'))),
            h('button', { class: 'btn primary big', onclick: () => { if (done) go('over'); else { solo.round++; nextClaim(); } } }, done ? t('vi_finish') : t('vi_next'))));
    }

    /** Lobby extras: the mode that needs no room. */
    function lobbyExtra() {
        return [
            h('div', { class: 'divider' }, h('span', null, t('or'))),
            h('button', { class: 'btn big', onclick: startSolo }, t('vi_solo')),
            h('p', { class: 'muted small center' }, t('vi_modes_note')),
        ];
    }

    return {
        init(core) { C = core; return { playView, resultCard, summary, settings, lobbyExtra, soloActive: () => !!solo, soloView }; },
    };
})();
