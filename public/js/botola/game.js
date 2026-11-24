// public/js/botola/game.js
// Botola screens. Runs inside public/js/spia/app.js (rooms, phones, settings, help, render loop); this file draws the match.
// Every player answers the same question on their own phone; the server judges and never sends the right answer before the
// round is over. The countdown is drawn from the time left that the server reports, so a wrong clock changes nothing.
window.BotolaGame = (() => {
    'use strict';
    let C = null;
    let ticker = null;

    const G = () => C.state.botola;
    const t = (k, v) => C.t(k, v);
    const h = (...a) => C.h(...a);
    const name = (id) => C.pname(id) || '?';
    const mine = () => C.myPlayers().map((p) => p.id);
    const isMine = (pid) => mine().includes(pid);
    const isHost = () => !!C.state.is_host;
    const lang = () => (window.SpiaApp && window.SpiaApp.lang) || 'en';
    const SHAPES = ['▲', '●', '■', '◆'];
    const LOUD = ['fell', 'life', 'slowest', 'nobody', 'left', 'end'];

    /** Per match UI state: the deadline anchor (so a new poll does not restart the countdown), flashes, timers. */
    function ui() {
        const g = G();
        if (!C.ui.bo || C.ui.bo.match !== g.match) C.ui.bo = { match: g.match, lastEvent: 0, flash: [], flashUntil: 0, anchor: null, timer: null, ticker: null };
        return C.ui.bo;
    }

    /** Seconds left of the question / reveal, anchored once per round so re-renders keep the same end time. */
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
        const bar = h('div', { class: 'bo-bar', 'aria-hidden': 'true' }, h('div', { class: 'bo-bar-fill', style: `animation-duration:${total}s;animation-delay:-${Math.max(0, total - left).toFixed(2)}s` }));
        const num = h('span', { class: 'bo-count', 'aria-live': 'off' }, String(Math.ceil(left)));
        clearInterval(ticker);
        ticker = setInterval(() => {
            if (!num.isConnected) { clearInterval(ticker); return; }
            num.textContent = String(Math.max(0, Math.ceil((at - Date.now()) / 1000)));
        }, 250);
        return h('div', { class: 'bo-clock' }, bar, num);
    }

    function evText(e) {
        const p = e.p ? name(e.p) : '';
        switch (e.t) {
            case 'start': return t('bo_ev_start');
            case 'question': return t('bo_ev_question', { n: e.n });
            case 'fell': return t('bo_ev_fell', { p });
            case 'life': return t('bo_ev_life', { p });
            case 'slowest': return t('bo_ev_slowest', { p });
            case 'nobody': return t('bo_ev_nobody');
            case 'left': return t('bo_ev_left', { p });
            case 'end': return e.p ? t('bo_ev_end', { p }) : t('bo_ev_end_none');
            default: return '';
        }
    }

    function announce() {
        const u = ui();
        const evs = G().events;
        const loud = evs.filter((e) => e.id > u.lastEvent && LOUD.includes(e.t));
        if (u.lastEvent && loud.length) {
            C.vibrate(loud.some((e) => isMine(e.p) && (e.t === 'fell' || e.t === 'slowest')) ? [200, 60, 200] : [60, 40, 60]);
            u.flash = loud.slice(-2);
            u.flashUntil = Date.now() + 5000;
            setTimeout(() => C.scheduleRender(), 5100);
        }
        if (evs.length) u.lastEvent = evs[evs.length - 1].id;
        return Date.now() < u.flashUntil ? u.flash : [];
    }

    /** The row of podiums: who is still standing, lives, who already answered; fallen players over an open trapdoor. */
    function stage() {
        const g = G();
        const answering = g.phase === 'question';
        return h('ul', { class: 'bo-stage', 'aria-label': t('bo_players') }, g.order.filter((id) => C.playerById(id)).map((id) => {
            const alive = g.alive.includes(id);
            const lives = g.lives[id] || 0;
            return h('li', { class: 'bo-pod' + (alive ? '' : ' fell') + (isMine(id) ? ' me' : '') + (alive && answering && g.answered.includes(id) ? ' done' : '') },
                h('span', { class: 'bo-pod-name' }, name(id)),
                h('span', { class: 'bo-pod-state' }, alive ? (g.rules.lives > 1 ? '♥'.repeat(lives) : (answering ? (g.answered.includes(id) ? '✓' : '…') : '')) : t('bo_fell_short')));
        }));
    }

    function qText(q) { return q.text[lang()] || q.text.en; }
    function qOptions(q) { return q.options[lang()] || q.options.en; }

    function questionView() {
        const g = G(), q = g.q, u = ui();
        const todo = g.me.filter((m) => m.alive && !m.answered);
        const at = endsAt('q', q.left);
        refreshAt(at);
        const head = [countdown(at, q.time), h('p', { class: 'bo-q' }, qText(q))];
        if (!['it', 'en'].includes(lang())) head.push(h('p', { class: 'bo-langnote' }, t('bo_lang_note')));
        if (todo.length) {
            const m = todo[0];
            const opts = qOptions(q);
            return C.section(t('bo_round_n', { n: g.round }), head,
                mine().length > 1 ? h('p', { class: 'bo-who' }, t('bo_answering', { p: name(m.player_id) })) : null,
                h('div', { class: 'bo-opts' }, opts.map((o, i) => h('button', { class: `bo-opt o${i}`, onclick: () => { C.vibrate(25); C.run('answer', { player_id: m.player_id, choice: i }); } },
                    h('span', { class: 'bo-shape', 'aria-hidden': 'true' }, SHAPES[i]), h('span', { class: 'bo-opt-text' }, o)))));
        }
        const out = !g.me.some((m) => m.alive);
        return C.section(t('bo_round_n', { n: g.round }), head,
            h('p', { class: 'bo-wait' }, out ? t('bo_you_are_out') : t('bo_sent', { n: g.answered.length, m: g.alive.length })));
    }

    function revealView() {
        const g = G(), q = g.q, r = g.reveal;
        if (!q || !r) return null;
        const opts = qOptions(q);
        const at = endsAt('r', g.next_left || 0);
        refreshAt(at);
        const mineAns = g.me.filter((m) => m.alive || (r.answers[m.player_id] !== undefined));
        let headline;
        if (r.nobody) headline = t('bo_rv_nobody');
        else if (r.slowest) headline = t('bo_rv_slowest', { p: name(r.slowest) });
        else if (r.fell.length) headline = t('bo_rv_fell', { p: r.fell.map(name).join(', ') });
        else headline = t('bo_rv_life', { p: r.hit.map(name).join(', ') });
        const meHit = r.hit.some(isMine);
        return C.section(t('bo_answer_was'),
            h('p', { class: 'bo-q small' }, qText(q)),
            h('div', { class: 'bo-opts reveal' }, opts.map((o, i) => {
                const picked = mineAns.some((m) => r.answers[m.player_id] === i);
                return h('div', { class: `bo-opt o${i}` + (i === r.right ? ' good' : picked ? ' bad' : ' dim') },
                    h('span', { class: 'bo-shape', 'aria-hidden': 'true' }, i === r.right ? '✓' : picked ? '✗' : SHAPES[i]), h('span', { class: 'bo-opt-text' }, o));
            })),
            h('p', { class: 'bo-verdict' + (meHit ? ' hit' : '') }, headline),
            g.alive.length > 1 ? h('p', { class: 'bo-next muted small' }, t('bo_next_in'), ' ', h('b', { class: 'bo-count' }, String(Math.ceil(Math.max(0, (at - Date.now()) / 1000))))) : null,
            isHost() ? h('button', { class: 'btn ghost', onclick: () => C.run('next') }, t('bo_next')) : null);
    }

    function feed() {
        const evs = G().events.slice(-8).reverse();
        return h('ol', { class: 'bo-feed' }, evs.map((e) => h('li', { class: LOUD.includes(e.t) ? 'loud ev-' + e.t : 'ev-' + e.t }, evText(e))));
    }

    function hostPanel() {
        if (!isHost()) return null;
        return h('details', { class: 'panel bo-host' },
            h('summary', null, t('bo_host_tools')),
            h('p', { class: 'small muted' }, t('bo_host_note')),
            h('button', { class: 'btn ghost', onclick: () => C.askConfirm(t('bo_end_q'), t('bo_end'), () => C.run('end'), true) }, t('bo_end')));
    }

    function playView() {
        const g = G();
        const flash = announce();
        return h('div', { class: 'stack bo' },
            !C.netOk ? h('div', { class: 'banner warn' }, t('connection_lost')) : null,
            flash.length ? h('div', { class: 'bo-flash', role: 'status' }, flash.map((e) => h('div', null, evText(e)))) : null,
            h('div', { class: 'bo-top' }, h('span', null, t('bo_level_' + g.rules.level)), h('span', null, t('bo_standing', { n: g.alive.length }))),
            stage(),
            g.phase === 'question' && g.q ? questionView() : revealView(),
            C.section(t('bo_feed_title'), feed()),
            hostPanel());
    }

    function resultCard() {
        const g = G();
        const res = g.result || { winner: null, reason: 'host_ended', lives: {} };
        const order = g.order.filter((id) => C.playerById(id)).sort((a, b) => ((res.lives || {})[b] || 0) - ((res.lives || {})[a] || 0));
        return h('section', { class: 'panel result bo-result' },
            h('div', { class: 'stamp result-stamp' }, res.winner ? t('bo_winner', { p: name(res.winner) }) : t('bo_no_winner')),
            h('div', { class: 'muted' }, t('bo_reason_' + res.reason)),
            h('ul', { class: 'result-list' }, order.map((id) => h('li', { class: id === res.winner ? 'win' : '' },
                h('span', null, name(id)), h('span', { class: 'role' }, id === res.winner ? '★' : t('bo_fell_short'))))));
    }

    function summary() {
        const s = C.state.settings;
        const chips = [t('bo_level_' + s.level), t('bo_sum_lives', { n: s.lives })];
        if (s.scores) chips.push(t('set_scores'));
        return h('div', { class: 'chips' }, chips.map((c) => h('span', { class: 'chip soft' }, c)));
    }

    function settings(s, { set, toggle, stepper, host }) {
        return [
            h('div', { class: 'set-row' },
                h('div', { class: 'set-text' }, h('span', { class: 'set-title' }, t('bo_set_level')), h('span', { class: 'set-desc' }, t('bo_set_level_d'))),
                h('div', { class: 'bo-levels', role: 'group' }, ['easy', 'normal', 'hard', 'rising'].map((k) => h('button', {
                    class: 'btn small' + (s.level === k ? ' primary' : ' ghost'), disabled: !host, 'aria-pressed': String(s.level === k), onclick: () => set({ level: k }),
                }, t('bo_level_' + k))))),
            h('div', { class: 'set-row' },
                h('div', { class: 'set-text' }, h('span', { class: 'set-title' }, t('bo_set_lives')), h('span', { class: 'set-desc' }, t('bo_set_lives_d'))),
                stepper('lives', t('bo_lives_word'), 1, 5)),
            toggle('scores', t('set_scores'), t('bo_set_scores_d')),
        ];
    }


    // ===================== alone / one phone passed around (no room, nothing stored on the server) =====================
    // Questions come from api/botola_solo.php (no right answer in them); the answer is checked there too. Best score: this phone only.
    const API_SOLO = '../api/botola_solo.php';
    let solo = null;   // null = the lobby / a room; otherwise { kind: 'single' | 'pass', screen, ... }
    const store = {
        get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
        set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    };
    const render = () => C.scheduleRender(true);   // forced: the solo state is not part of the room render signature
    const soloStop = () => { if (solo) { clearTimeout(solo.timer); clearInterval(ticker); } };
    const go = (screen, extra = {}) => { soloStop(); Object.assign(solo, extra, { screen }); render(); };
    const TIMES = { easy: 20, normal: 15, hard: 10, rising: 15 };

    /** At the start of a solo game: merge this phone's bests with the account's (js/records.js, only when logged in). */
    function syncBotolaRecords() {
        if (!window.VBRecords) return;
        const levels = ['easy', 'normal', 'hard', 'rising'], local = {};
        levels.forEach((l) => { const n = store.get('vb_botola_best_' + l, 0); if (n > 0) local[l] = n; });
        VBRecords.sync('botola', local).then((m) => {
            if (!m) return;
            let changed = false;
            levels.forEach((l) => { if (m[l] > (local[l] || 0)) { store.set('vb_botola_best_' + l, m[l]); changed = true; } });
            if (changed && solo) render();
        });
    }

    function startSolo(kind) {
        syncBotolaRecords();
        solo = { kind, screen: 'setup', level: store.get('vb_botola_level', 'rising'), lives: kind === 'single' ? 3 : 1, names: store.get('vb_botola_pass_names', ['', '']), seen: [], round: 1, busy: false };
        render();
    }
    function leaveSolo() { soloStop(); solo = null; render(); }

    async function fetchQuestion() {
        solo.busy = true; render();
        try {
            const r = await fetch(`${API_SOLO}?action=question&level=${solo.level}&round=${solo.round}&exclude=${solo.seen.slice(-300).join(',')}`, { cache: 'no-store' });
            const j = await r.json();
            if (!j.success) throw new Error(j.error || 'x');
            solo.q = j; solo.seen.push(j.id);
        } catch (e) { solo.busy = false; C.toast(t('bo_load_error')); go('setup'); return false; }
        solo.busy = false;
        return true;
    }
    async function checkAnswer(text) {
        try {
            const r = await fetch(API_SOLO, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: solo.q.id, lang: lang() === 'it' ? 'it' : 'en', text }) });
            const j = await r.json();
            return j.success ? j : null;
        } catch (e) { return null; }
    }

    function soloSetup() {
        const pass = solo.kind === 'pass';
        const levels = h('div', { class: 'bo-levels', role: 'group', 'aria-label': t('bo_set_level') }, ['easy', 'normal', 'hard', 'rising'].map((k) => h('button', {
            class: 'btn small' + (solo.level === k ? ' primary' : ' ghost'), 'aria-pressed': String(solo.level === k), onclick: () => { solo.level = k; store.set('vb_botola_level', k); render(); } }, t('bo_level_' + k))));
        const kids = [h('h2', null, t(pass ? 'bo_pass' : 'bo_solo')), h('p', { class: 'muted small' }, t(pass ? 'bo_pass_d' : 'bo_solo_d')), h('h3', { class: 'set-group' }, t('bo_set_level')), levels];
        if (pass) {
            kids.push(h('h3', { class: 'set-group' }, t('bo_players')));
            solo.names.forEach((n, i) => kids.push(h('div', { class: 'bo-row' },
                h('input', { value: n, maxlength: '20', placeholder: t('bo_name_n', { n: i + 1 }), 'aria-label': t('bo_name_n', { n: i + 1 }), oninput: (e) => { solo.names[i] = e.target.value; store.set('vb_botola_pass_names', solo.names); } }),
                solo.names.length > 2 ? h('button', { class: 'btn small ghost', 'aria-label': t('bo_remove'), onclick: () => { solo.names.splice(i, 1); store.set('vb_botola_pass_names', solo.names); render(); } }, '×') : null)));
            if (solo.names.length < 8) kids.push(h('button', { class: 'btn ghost', onclick: () => { solo.names.push(''); render(); } }, '+ ' + t('bo_add_player')));
            kids.push(h('div', { class: 'set-row' }, h('div', { class: 'set-text' }, h('span', { class: 'set-title' }, t('bo_set_lives')), h('span', { class: 'set-desc' }, t('bo_set_lives_d'))),
                h('div', { class: 'stepper' }, h('span', { class: 'step-label' }, t('bo_lives_word')),
                    h('button', { class: 'step', disabled: solo.lives <= 1, onclick: () => { solo.lives--; render(); }, 'aria-label': '−' }, '−'),
                    h('span', { class: 'step-val' }, String(solo.lives)),
                    h('button', { class: 'step', disabled: solo.lives >= 3, onclick: () => { solo.lives++; render(); }, 'aria-label': '+' }, '+'))));
        } else {
            kids.push(h('p', { class: 'small muted' }, t('bo_best_n', { n: store.get('vb_botola_best_' + solo.level, 0) })));
        }
        kids.push(h('button', { class: 'btn primary big', onclick: beginSolo }, t('bo_start')), h('button', { class: 'btn ghost', onclick: leaveSolo }, t('bo_back')));
        return C.section(null, kids);
    }

    async function beginSolo() {
        if (solo.kind === 'pass') {
            const names = solo.names.map((n) => n.trim()).filter(Boolean);
            if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) { C.toast(t('err_name_taken')); return; }
            if (names.length < 2) { C.toast(t('bo_need_two')); return; }
            solo.players = names.map((name) => ({ name, lives: solo.lives }));
        } else solo.players = [{ name: '', lives: 3 }];
        Object.assign(solo, { round: 1, score: 0, seen: [] });
        await nextRound();
    }

    async function nextRound() {
        if (!(await fetchQuestion())) return;
        solo.answers = [];
        solo.who = solo.players.findIndex((p) => p.lives > 0);
        if (solo.kind === 'pass') go('turn'); else beginQuestion();
    }

    function beginQuestion() {
        const q = solo.q;
        solo.started = Date.now();
        solo.deadline = solo.started + q.time * 1000;
        go('question');
        solo.timer = setTimeout(() => answerSolo(null), q.time * 1000 + 50);
    }

    async function answerSolo(i) {
        if (solo.screen !== 'question' || solo.locked) return;
        solo.locked = true;
        clearTimeout(solo.timer);
        const ms = Date.now() - solo.started;
        const text = i === null ? '' : qOptions(solo.q)[i];
        if (solo.kind === 'single') {
            const j = await checkAnswer(text);
            solo.locked = false;
            if (!j) { C.toast(t('bo_load_error')); go('setup'); return; }
            if (j.right) { solo.score++; C.vibrate(25); } else { solo.players[0].lives--; C.vibrate([200, 60, 200]); }
            const best = store.get('vb_botola_best_' + solo.level, 0);
            if (solo.score > best) { store.set('vb_botola_best_' + solo.level, solo.score); if (window.VBRecords) VBRecords.submit('botola', solo.level, solo.score); }
            return go('reveal', { reveal: { answer: j.answer, picked: text, right: j.right, timeup: i === null } });
        }
        solo.locked = false;
        solo.answers[solo.who] = { text, ms };
        const next = solo.players.findIndex((p, k) => k > solo.who && p.lives > 0);
        if (next >= 0) { solo.who = next; return go('turn'); }
        const j = await checkAnswer('');   // the round is over: now the right answer may be shown
        if (!j) { C.toast(t('bo_load_error')); go('setup'); return; }
        // same rules as the rooms: wrong -> loses a life; all right -> the slowest does; all wrong -> nobody
        const alive = solo.players.map((p, k) => k).filter((k) => solo.players[k].lives > 0);
        const ok = alive.filter((k) => solo.answers[k] && solo.answers[k].text === j.answer);
        let hit = alive.filter((k) => !ok.includes(k)), slowest = null, nobody = false;
        if (!hit.length && alive.length > 1) { slowest = ok.reduce((a, k) => (solo.answers[k].ms > solo.answers[a].ms ? k : a), ok[0]); hit = [slowest]; }
        else if (hit.length === alive.length) { nobody = true; hit = []; }
        const fell = [];
        hit.forEach((k) => { if (--solo.players[k].lives === 0) fell.push(k); });
        if (hit.length) C.vibrate([120, 50, 120]);
        go('reveal', { reveal: { answer: j.answer, hit, fell, slowest, nobody } });
    }

    function soloOptions(reveal) {
        const q = solo.q, opts = qOptions(q);
        if (!reveal) return h('div', { class: 'bo-opts' }, opts.map((o, i) => h('button', { class: `bo-opt o${i}`, onclick: () => answerSolo(i) },
            h('span', { class: 'bo-shape', 'aria-hidden': 'true' }, SHAPES[i]), h('span', { class: 'bo-opt-text' }, o))));
        return h('div', { class: 'bo-opts reveal' }, opts.map((o, i) => {
            const good = o === reveal.answer, picked = reveal.picked === o;
            return h('div', { class: `bo-opt o${i}` + (good ? ' good' : picked ? ' bad' : ' dim') },
                h('span', { class: 'bo-shape', 'aria-hidden': 'true' }, good ? '✓' : picked ? '✗' : SHAPES[i]), h('span', { class: 'bo-opt-text' }, o));
        }));
    }

    function soloStatus() {
        const alive = solo.players.filter((p) => p.lives > 0);
        return h('div', { class: 'bo-top' }, h('span', null, t('bo_level_' + solo.level)),
            solo.kind === 'single' ? h('span', null, t('bo_score_n', { n: solo.score }) + ' · ' + '♥'.repeat(Math.max(0, solo.players[0].lives))) : h('span', null, t('bo_standing', { n: alive.length })));
    }

    function soloStage() {
        if (solo.kind !== 'pass') return null;
        return h('ul', { class: 'bo-stage' }, solo.players.map((p) => h('li', { class: 'bo-pod' + (p.lives > 0 ? '' : ' fell') },
            h('span', { class: 'bo-pod-name' }, p.name),
            h('span', { class: 'bo-pod-state' }, p.lives > 0 ? (solo.lives > 1 ? '♥'.repeat(p.lives) : '') : t('bo_fell_short')))));
    }

    function soloOver() {
        const single = solo.kind === 'single';
        const alive = solo.players.filter((p) => p.lives > 0);
        const best = store.get('vb_botola_best_' + solo.level, 0);
        return h('section', { class: 'panel result bo-result' },
            h('div', { class: 'stamp result-stamp' }, single ? t('bo_game_over') : (alive.length ? t('bo_winner', { p: alive[0].name }) : t('bo_no_winner'))),
            single ? h('p', { class: 'center' }, t('bo_score_n', { n: solo.score }) + ' · ' + t('bo_best_n', { n: best })) : soloStage(),
            h('div', { class: 'row2' }, h('button', { class: 'btn ghost', onclick: leaveSolo }, t('bo_back')),
                h('button', { class: 'btn primary', onclick: () => go('setup') }, t('bo_play_again'))));
    }

    function soloView() {
        if (solo.busy) return h('div', { class: 'center muted' }, t('bo_loading'));
        const s = solo.screen;
        if (s === 'setup') return soloSetup();
        if (s === 'over') return soloOver();
        const q = solo.q;
        const head = [soloStatus(), soloStage()];
        if (s === 'turn') {
            return h('div', { class: 'stack bo' }, ...head, C.section(t('bo_round_n', { n: solo.round }),
                h('p', { class: 'bo-pass' }, t('bo_pass_to')), h('p', { class: 'bo-pass-name' }, solo.players[solo.who].name),
                h('button', { class: 'btn primary big', onclick: beginQuestion }, t('bo_ready'))));
        }
        if (s === 'question') {
            const kids = [countdown(solo.deadline, q.time), h('p', { class: 'bo-q' }, qText(q))];
            if (solo.kind === 'pass') kids.push(h('p', { class: 'bo-who' }, t('bo_answering', { p: solo.players[solo.who].name })));
            if (!['it', 'en'].includes(lang())) kids.push(h('p', { class: 'bo-langnote' }, t('bo_lang_note')));
            return h('div', { class: 'stack bo' }, ...head, C.section(t('bo_round_n', { n: solo.round }), kids, soloOptions(null)));
        }
        const r = solo.reveal;     // screen === 'reveal'
        let verdict;
        if (solo.kind === 'single') verdict = r.right ? t('bo_right') : (r.timeup ? t('bo_timeup') : t('bo_wrong'));
        else if (r.nobody) verdict = t('bo_rv_nobody');
        else if (r.slowest !== null) verdict = t('bo_rv_slowest', { p: solo.players[r.slowest].name });
        else if (r.fell.length) verdict = t('bo_rv_fell', { p: r.fell.map((k) => solo.players[k].name).join(', ') });
        else verdict = r.hit.length ? t('bo_rv_life', { p: r.hit.map((k) => solo.players[k].name).join(', ') }) : t('bo_right');
        const done = solo.players.filter((p) => p.lives > 0).length < (solo.kind === 'single' ? 1 : 2);
        return h('div', { class: 'stack bo' }, ...head, C.section(t('bo_answer_was'), h('p', { class: 'bo-q small' }, qText(q)), soloOptions(r),
            h('p', { class: 'bo-verdict' + ((solo.kind === 'single' ? !r.right : false) ? ' hit' : '') }, verdict),
            h('button', { class: 'btn primary big', onclick: () => { if (done) go('over'); else { solo.round++; nextRound(); } } }, done ? t('bo_finish') : t('bo_next'))));
    }

    /** Lobby extras: the two modes that need no room. */
    function lobbyExtra() {
        return [
            h('div', { class: 'divider' }, h('span', null, t('or'))),
            h('button', { class: 'btn big', onclick: () => startSolo('single') }, t('bo_solo')),
            h('button', { class: 'btn big', onclick: () => startSolo('pass') }, t('bo_pass')),
            h('p', { class: 'muted small center' }, t('bo_modes_note')),
        ];
    }

    return {
        init(core) { C = core; return { playView, resultCard, summary, settings, lobbyExtra, soloActive: () => !!solo, soloView }; },
    };
})();
