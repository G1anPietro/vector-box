// public/js/bandiere/game.js
// Bandiere screens (flags and capitals quiz). Runs inside public/js/spia/app.js (rooms, phones, settings, help, render loop);
// this file draws the match. Every player gets the same question; the server judges and times it, and never sends which option
// is right before the round is over. Flags are the flag EMOJI built from the ISO code (no image files): when the device has no
// flag glyphs (Windows desktop) the big ISO code is shown instead.
window.BandiereGame = (() => {
    'use strict';
    let C = null;
    let ticker = null;

    const G = () => C.state.bandiere;
    const t = (k, v) => C.t(k, v);
    const h = (...a) => C.h(...a);
    const name = (id) => C.pname(id) || '?';
    const mine = () => C.myPlayers().map((p) => p.id);
    const isMine = (pid) => mine().includes(pid);
    const isHost = () => !!C.state.is_host;
    const lang = () => (window.SpiaApp && window.SpiaApp.lang) || 'en';
    const pick = (o) => (o ? (o[lang()] || o.en || '') : '');
    const BEARING = ['N', 'E', 'S', 'W'];
    const LEVELS = ['easy', 'normal', 'hard', 'mix'];
    const MODES = ['flag', 'name', 'capital', 'mix'];

    // ---------- flags ----------
    const emoji = (iso) => String.fromCodePoint(...[...iso].map((c) => 0x1F1E6 + c.charCodeAt(0) - 65));
    let flagsOk = null;
    /** Draws the Italian flag on a canvas: if there is no green and no red in it, this device shows letters instead of flags. */
    function canShowFlags() {
        if (flagsOk !== null) return flagsOk;
        flagsOk = true;
        try {
            const cv = document.createElement('canvas');
            cv.width = cv.height = 48;
            const x = cv.getContext('2d', { willReadFrequently: true });
            x.textBaseline = 'top';
            x.font = '32px sans-serif';
            x.fillText(emoji('IT'), 0, 0);
            const d = x.getImageData(0, 0, 48, 48).data;
            let green = 0, red = 0;
            for (let i = 0; i < d.length; i += 4) {
                if (d[i + 3] < 200) continue;
                if (d[i + 1] > d[i] + 50 && d[i + 1] > d[i + 2] + 40) green++;
                else if (d[i] > d[i + 1] + 80 && d[i] > d[i + 2] + 60) red++;
            }
            flagsOk = green > 6 && red > 6;
        } catch (e) { flagsOk = true; }
        return flagsOk;
    }
    /** A flag. The label is what a screen reader says: it must never name the country when the question asks for it. */
    function flag(iso, label, cls) {
        const ok = canShowFlags();
        return h('span', { class: 'bd-flag ' + (cls || '') + (ok ? '' : ' code'), role: 'img', 'aria-label': label }, ok ? emoji(iso) : iso);
    }

    // ---------- the clock ----------
    function ui() {
        const g = G();
        if (!C.ui.bd || C.ui.bd.match !== g.match) C.ui.bd = { match: g.match, anchor: null, timer: null };
        return C.ui.bd;
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
        const bar = h('div', { class: 'bd-bar', 'aria-hidden': 'true' }, h('div', { class: 'bd-bar-fill', style: `animation-duration:${total}s;animation-delay:-${Math.max(0, total - left).toFixed(2)}s` }));
        const num = h('span', { class: 'bd-count', 'aria-live': 'off' }, String(Math.ceil(left)));
        clearInterval(ticker);
        ticker = setInterval(() => {
            if (!num.isConnected) { clearInterval(ticker); return; }
            num.textContent = String(Math.max(0, Math.ceil((at - Date.now()) / 1000)));
        }, 250);
        return h('div', { class: 'bd-clock' }, bar, num);
    }

    // ---------- one question (room, alone and one phone use the same drawing) ----------
    /** The part above the options: the flag, or the name, and what is asked. */
    function qHead(q) {
        const kids = [];
        if (q.kind === 'n2f') kids.push(h('p', { class: 'bd-ask' }, t('bd_ask_n2f')), h('p', { class: 'bd-country' }, pick(q.prompt)));
        else {
            kids.push(h('div', { class: 'bd-pole' }, flag(q.flag, t('bd_flag_alt'), 'big')));
            if (q.kind === 'cap') kids.push(h('p', { class: 'bd-country' }, pick(q.prompt)), h('p', { class: 'bd-ask' }, t('bd_ask_cap')));
            else kids.push(h('p', { class: 'bd-ask' }, t('bd_ask_f2n')));
        }
        if (!canShowFlags()) kids.push(h('p', { class: 'bd-noflags' }, t('bd_noflags')));
        return h('div', { class: 'bd-qhead' }, kids);
    }
    const optTexts = (q) => (q.options[lang()] || q.options.en);

    /** The four options as buttons. onPick(i) is called with the position the player tapped. */
    function optionButtons(q, onPick) {
        if (q.kind === 'n2f') {
            return h('div', { class: 'bd-opts flags' }, q.options.map((iso, i) => h('button', { class: 'bd-opt flagopt', 'aria-label': t('bd_flag_n', { n: i + 1 }), onclick: () => onPick(i) },
                h('span', { class: 'bd-bearing', 'aria-hidden': 'true' }, BEARING[i]), flag(iso, '', 'opt'))));
        }
        return h('div', { class: 'bd-opts' }, optTexts(q).map((o, i) => h('button', { class: 'bd-opt', onclick: () => onPick(i) },
            h('span', { class: 'bd-bearing', 'aria-hidden': 'true' }, BEARING[i]), h('span', { class: 'bd-opt-text' }, o))));
    }

    /** The options after the round: the right one marked, what each of "mine" chose, the name of every option. */
    function revealOptions(q, info, right, picks) {
        const names = info.labels[lang()] || info.labels.en;
        return h('div', { class: 'bd-opts reveal' + (q.kind === 'n2f' ? ' flags' : '') }, names.map((txt, i) => {
            const state = i === right ? ' good' : picks.includes(i) ? ' bad' : ' dim';
            const mark = i === right ? '✓' : picks.includes(i) ? '✗' : BEARING[i];
            const label = (i === right ? t('bd_right_option') + ': ' : picks.includes(i) ? t('bd_your_pick') + ': ' : '') + txt;
            return h('div', { class: 'bd-opt' + (q.kind === 'n2f' ? ' flagopt' : '') + state, role: 'group', 'aria-label': label },
                h('span', { class: 'bd-bearing', 'aria-hidden': 'true' }, mark),
                q.kind === 'n2f' ? flag(q.options[i], txt, 'opt') : null,
                h('span', { class: 'bd-opt-text' }, txt));
        }));
    }
    /** "Italy · capital Rome" with the flag, shown on every reveal: this is how people learn. */
    function infoLine(info) {
        return h('p', { class: 'bd-info' }, flag(info.iso, pick(info.name), 'inline'), ' ', h('b', null, pick(info.name)), ' · ', t('bd_capital_is', { c: pick(info.capital) }));
    }

    // ---------- room: the match ----------
    function scoreboard() {
        const g = G();
        const answering = g.phase === 'question';
        const order = g.order.filter((id) => C.playerById(id)).slice().sort((a, b) => (g.points[b] || 0) - (g.points[a] || 0));
        return h('ol', { class: 'bd-board', 'aria-label': t('bd_scores') }, order.map((id) => {
            const alive = g.alive.includes(id);
            const state = !alive ? t('bd_out') : (answering ? (g.answered.includes(id) ? '✓' : '…') : (g.rules.lives > 0 ? '♥'.repeat(g.lives[id] || 0) : ''));
            return h('li', { class: 'bd-pod' + (alive ? '' : ' out') + (isMine(id) ? ' me' : '') + (alive && answering && g.answered.includes(id) ? ' done' : '') },
                h('span', { class: 'bd-pod-name' }, name(id)),
                h('span', { class: 'bd-pod-pts' }, String(g.points[id] || 0)),
                h('span', { class: 'bd-pod-state' }, state));
        }));
    }

    function questionView() {
        const g = G(), q = g.q;
        const todo = g.me.filter((m) => m.alive && !m.answered);
        const at = endsAt('q', q.left);
        refreshAt(at);
        const head = [countdown(at, q.time), qHead(q)];
        if (todo.length) {
            const m = todo[0];
            return C.section(t('bd_round_n', { n: g.round, m: g.total }), head,
                mine().length > 1 ? h('p', { class: 'bd-who' }, t('bd_answering', { p: name(m.player_id) })) : null,
                optionButtons(q, (i) => { C.vibrate(25); C.run('answer', { player_id: m.player_id, choice: i }); }));
        }
        const out = !g.me.some((m) => m.alive);
        return C.section(t('bd_round_n', { n: g.round, m: g.total }), head,
            h('p', { class: 'bd-wait' }, out ? t('bd_you_are_out') : t('bd_sent', { n: g.answered.length, m: g.alive.length })));
    }

    function revealView() {
        const g = G(), q = g.q, r = g.reveal;
        if (!q || !r) return null;
        const at = endsAt('r', g.next_left || 0);
        refreshAt(at);
        const picks = g.me.map((m) => r.answers[m.player_id]).filter((x) => x !== undefined);
        const gains = g.me.map((m) => r.gain[m.player_id]).filter((x) => x !== undefined);
        const meOk = gains.length > 0;
        const last = g.round >= g.total;
        return C.section(t('bd_round_n', { n: g.round, m: g.total }),
            qHead(q),
            revealOptions(q, r.info, r.right, picks),
            infoLine(r.info),
            g.me.length ? h('p', { class: 'bd-verdict' + (meOk ? '' : ' hit') }, meOk ? t('bd_plus', { n: gains.reduce((a, b) => a + b, 0) }) : (picks.length ? t('bd_wrong') : t('bd_timeup'))) : null,
            r.fell.length ? h('p', { class: 'bd-fell' }, t('bd_fell', { p: r.fell.map(name).join(', ') })) : null,
            h('p', { class: 'bd-next muted small' }, last ? t('bd_last_round') : t('bd_next_in'), ' ', h('b', { class: 'bd-count sm' }, String(Math.ceil(Math.max(0, (at - Date.now()) / 1000))))),
            isHost() ? h('button', { class: 'btn ghost', onclick: () => C.run('next') }, last ? t('bd_see_result') : t('bd_next')) : null);
    }

    function hostPanel() {
        if (!isHost()) return null;
        return h('details', { class: 'panel bd-host' },
            h('summary', null, t('bd_host_tools')),
            h('p', { class: 'small muted' }, t('bd_host_note')),
            h('button', { class: 'btn ghost', onclick: () => C.askConfirm(t('bd_end_q'), t('bd_end'), () => C.run('end'), true) }, t('bd_end')));
    }

    function playView() {
        const g = G();
        return h('div', { class: 'stack bd' },
            !C.netOk ? h('div', { class: 'banner warn' }, t('connection_lost')) : null,
            h('div', { class: 'bd-top' }, h('span', null, t('bd_level_' + g.rules.level)), h('span', null, t('bd_mode_' + g.rules.mode))),
            scoreboard(),
            g.phase === 'question' && g.q ? questionView() : revealView(),
            hostPanel());
    }

    function resultList(ids, points, winners) {
        const order = ids.slice().sort((a, b) => (points[b] || 0) - (points[a] || 0));
        return h('ol', { class: 'result-list bd-ranking' }, order.map((id) => h('li', { class: winners.includes(id) ? 'win' : '' },
            h('span', null, name(id)), h('span', { class: 'role' }, (winners.includes(id) ? '★ ' : '') + t('bd_pts', { n: points[id] || 0 })))));
    }
    function resultCard() {
        const g = G();
        const res = g.result || { winners: [], reason: 'host_ended', points: {} };
        const ids = g.order.filter((id) => C.playerById(id));
        return h('section', { class: 'panel result bd-result' },
            h('div', { class: 'stamp result-stamp' }, res.winners.length ? t(res.winners.length > 1 ? 'bd_winners' : 'bd_winner', { p: res.winners.map(name).join(', ') }) : t('bd_no_winner')),
            h('div', { class: 'muted' }, t('bd_reason_' + res.reason)),
            resultList(ids, res.points || g.points, res.winners));
    }

    function summary() {
        const s = C.state.settings;
        const chips = [t('bd_level_' + s.level), t('bd_mode_' + s.mode), t('bd_rounds_n', { n: s.rounds }), s.lives ? t('bd_sum_lives', { n: s.lives }) : t('bd_no_lives')];
        if (s.scores) chips.push(t('set_scores'));
        return h('div', { class: 'chips' }, chips.map((c) => h('span', { class: 'chip soft' }, c)));
    }

    function choiceRow(title, desc, current, values, labelOf, set, host) {
        return h('div', { class: 'set-row' },
            h('div', { class: 'set-text' }, h('span', { class: 'set-title' }, title), h('span', { class: 'set-desc' }, desc)),
            h('div', { class: 'bd-levels', role: 'group', 'aria-label': title }, values.map((k) => h('button', {
                class: 'btn small' + (current === k ? ' primary' : ' ghost'), disabled: !host, 'aria-pressed': String(current === k), onclick: () => set(k),
            }, labelOf(k)))));
    }
    function settings(s, { set, toggle, stepper, host }) {
        return [
            choiceRow(t('bd_set_level'), t('bd_set_level_d'), s.level, LEVELS, (k) => t('bd_level_' + k), (k) => set({ level: k }), host),
            choiceRow(t('bd_set_mode'), t('bd_set_mode_d'), s.mode, MODES, (k) => t('bd_mode_' + k), (k) => set({ mode: k }), host),
            choiceRow(t('bd_set_rounds'), t('bd_set_rounds_d'), s.rounds, [10, 20, 30], (k) => String(k), (k) => set({ rounds: k }), host),
            h('div', { class: 'set-row' },
                h('div', { class: 'set-text' }, h('span', { class: 'set-title' }, t('bd_set_lives')), h('span', { class: 'set-desc' }, t('bd_set_lives_d'))),
                stepper('lives', t('bd_lives_word'), 0, 5)),
            toggle('scores', t('set_scores'), t('bd_set_scores_d')),
        ];
    }

    // ===================== alone / one phone passed around (no room) =====================
    // Questions come from api/bandiere_solo.php inside a sealed token (no right answer in it); the answer is checked there too.
    const API_SOLO = '../api/bandiere_solo.php';
    let solo = null;   // null = the lobby / a room; otherwise { kind: 'single' | 'pass', screen, ... }
    const store = {
        get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
        set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    };
    const render = () => C.scheduleRender(true);   // forced: the solo state is not part of the room render signature
    const soloStop = () => { if (solo) { clearTimeout(solo.timer); clearInterval(ticker); } };
    const go = (screen, extra = {}) => { soloStop(); Object.assign(solo, extra, { screen }); render(); };

    /** At the start of a solo game: merge this phone's bests with the account's (js/records.js, only when logged in). */
    function syncRecords() {
        if (!window.VBRecords) return;
        const local = {};
        LEVELS.forEach((l) => { const n = store.get('vb_bandiere_best_' + l, 0); if (n > 0) local[l] = n; });
        VBRecords.sync('bandiere', local).then((m) => {
            if (!m) return;
            let changed = false;
            LEVELS.forEach((l) => { if (m[l] > (local[l] || 0)) { store.set('vb_bandiere_best_' + l, m[l]); changed = true; } });
            if (changed && solo) render();
        });
    }

    function startSolo(kind) {
        syncRecords();
        solo = { kind, screen: 'setup', level: store.get('vb_bandiere_level', 'mix'), mode: store.get('vb_bandiere_mode', 'mix'), rounds: 10,
            names: store.get('vb_bandiere_pass_names', ['', '']), seen: [], round: 1, busy: false };
        render();
    }
    function leaveSolo() { soloStop(); solo = null; render(); }

    async function fetchQuestion() {
        solo.busy = true; render();
        try {
            const r = await fetch(`${API_SOLO}?action=question&level=${solo.level}&mode=${solo.mode}&exclude=${solo.seen.slice(-120).join(',')}`, { cache: 'no-store' });
            const j = await r.json();
            if (!j.success) throw new Error(j.error || 'x');
            solo.q = j; solo.seen.push(j.sid);
        } catch (e) { solo.busy = false; C.toast(t('bd_load_error')); go('setup'); return false; }
        solo.busy = false;
        return true;
    }
    async function checkAnswers(choices) {
        try {
            const r = await fetch(API_SOLO, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: solo.q.token, choices, pass: solo.kind === 'pass' }) });
            const j = await r.json();
            return j.success ? j : null;
        } catch (e) { return null; }
    }

    function levelModeButtons() {
        const row = (title, values, cur, labelOf, set) => [h('h3', { class: 'set-group' }, title),
            h('div', { class: 'bd-levels', role: 'group', 'aria-label': title }, values.map((k) => h('button', {
                class: 'btn small' + (cur === k ? ' primary' : ' ghost'), 'aria-pressed': String(cur === k), onclick: () => { set(k); render(); } }, labelOf(k))))];
        return [
            ...row(t('bd_set_level'), LEVELS, solo.level, (k) => t('bd_level_' + k), (k) => { solo.level = k; store.set('vb_bandiere_level', k); }),
            ...row(t('bd_set_mode'), MODES, solo.mode, (k) => t('bd_mode_' + k), (k) => { solo.mode = k; store.set('vb_bandiere_mode', k); }),
        ];
    }

    function soloSetup() {
        const pass = solo.kind === 'pass';
        const kids = [h('h2', null, t(pass ? 'bd_pass' : 'bd_solo')), h('p', { class: 'muted small' }, t(pass ? 'bd_pass_d' : 'bd_solo_d')), ...levelModeButtons()];
        if (pass) {
            kids.push(h('h3', { class: 'set-group' }, t('bd_set_rounds')),
                h('div', { class: 'bd-levels', role: 'group', 'aria-label': t('bd_set_rounds') }, [10, 20, 30].map((n) => h('button', {
                    class: 'btn small' + (solo.rounds === n ? ' primary' : ' ghost'), 'aria-pressed': String(solo.rounds === n), onclick: () => { solo.rounds = n; render(); } }, String(n)))));
            kids.push(h('h3', { class: 'set-group' }, t('bd_players')));
            solo.names.forEach((n, i) => kids.push(h('div', { class: 'bd-row' },
                h('input', { value: n, maxlength: '20', placeholder: t('bd_name_n', { n: i + 1 }), 'aria-label': t('bd_name_n', { n: i + 1 }), oninput: (e) => { solo.names[i] = e.target.value; store.set('vb_bandiere_pass_names', solo.names); } }),
                solo.names.length > 2 ? h('button', { class: 'btn small ghost', 'aria-label': t('bd_remove'), onclick: () => { solo.names.splice(i, 1); store.set('vb_bandiere_pass_names', solo.names); render(); } }, '×') : null)));
            if (solo.names.length < 8) kids.push(h('button', { class: 'btn ghost', onclick: () => { solo.names.push(''); render(); } }, '+ ' + t('bd_add_player')));
        } else {
            kids.push(h('p', { class: 'small muted' }, t('bd_best_n', { n: store.get('vb_bandiere_best_' + solo.level, 0) })));
        }
        kids.push(h('button', { class: 'btn primary big', onclick: beginSolo }, t('bd_start')), h('button', { class: 'btn ghost', onclick: leaveSolo }, t('bd_back')));
        return C.section(null, kids);
    }

    async function beginSolo() {
        if (solo.kind === 'pass') {
            const names = solo.names.map((n) => n.trim()).filter(Boolean);
            if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) { C.toast(t('err_name_taken')); return; }
            if (names.length < 2) { C.toast(t('bd_need_two')); return; }
            solo.players = names.map((n) => ({ name: n, points: 0 }));
        } else solo.players = [{ name: '', points: 0, lives: 3 }];
        Object.assign(solo, { round: 1, seen: [] });
        await nextRound();
    }

    async function nextRound() {
        if (!(await fetchQuestion())) return;
        solo.answers = [];
        solo.who = 0;
        if (solo.kind === 'pass') go('turn'); else beginQuestion();
    }

    function beginQuestion() {
        const q = solo.q;
        solo.started = Date.now();
        solo.deadline = solo.started + q.time * 1000;
        solo.locked = false;
        go('question');
        solo.timer = setTimeout(() => answerSolo(null), q.time * 1000 + 50);
    }

    async function answerSolo(i) {
        if (solo.screen !== 'question' || solo.locked) return;
        solo.locked = true;
        clearTimeout(solo.timer);
        if (solo.kind === 'single') {
            const j = await checkAnswers([i]);
            if (!j) { C.toast(t('bd_load_error')); go('setup'); return; }
            const ok = j.results[0];
            const p = solo.players[0];
            if (ok) { p.points += j.points[0]; C.vibrate(25); } else { p.lives--; C.vibrate([200, 60, 200]); }
            const best = store.get('vb_bandiere_best_' + solo.level, 0);
            if (p.points > best) { store.set('vb_bandiere_best_' + solo.level, p.points); if (window.VBRecords) VBRecords.submit('bandiere', solo.level, p.points); }
            return go('reveal', { reveal: j, picks: i === null ? [] : [i], timeup: i === null });
        }
        solo.answers[solo.who] = i;
        if (solo.who + 1 < solo.players.length) { solo.who++; return go('turn'); }
        const j = await checkAnswers(solo.answers);   // the round is over: now the right answer may be shown
        if (!j) { C.toast(t('bd_load_error')); go('setup'); return; }
        j.results.forEach((ok, k) => { if (ok) solo.players[k].points += j.points[k]; });
        go('reveal', { reveal: j, picks: solo.answers.filter((x) => x !== null) });
    }

    function soloStatus() {
        const p = solo.players;
        return h('div', { class: 'bd-top' }, h('span', null, t('bd_level_' + solo.level)),
            solo.kind === 'single' ? h('span', null, t('bd_pts', { n: p[0].points }) + ' · ' + '♥'.repeat(Math.max(0, p[0].lives)))
                : h('span', null, t('bd_round_n', { n: solo.round, m: solo.rounds })));
    }
    function soloBoard() {
        if (solo.kind !== 'pass') return null;
        return h('ol', { class: 'bd-board', 'aria-label': t('bd_scores') }, solo.players.map((p) => h('li', { class: 'bd-pod' },
            h('span', { class: 'bd-pod-name' }, p.name), h('span', { class: 'bd-pod-pts' }, String(p.points)), h('span', { class: 'bd-pod-state' }))));
    }

    function soloOver() {
        const single = solo.kind === 'single';
        const best = store.get('vb_bandiere_best_' + solo.level, 0);
        const top = Math.max(...solo.players.map((p) => p.points));
        const winners = solo.players.filter((p) => p.points === top && top > 0);
        return h('section', { class: 'panel result bd-result' },
            h('div', { class: 'stamp result-stamp' }, single ? t('bd_game_over') : (winners.length ? t(winners.length > 1 ? 'bd_winners' : 'bd_winner', { p: winners.map((p) => p.name).join(', ') }) : t('bd_no_winner'))),
            single ? h('p', { class: 'center' }, t('bd_pts', { n: solo.players[0].points }) + ' · ' + t('bd_best_n', { n: best }))
                : h('ol', { class: 'result-list bd-ranking' }, solo.players.slice().sort((a, b) => b.points - a.points).map((p) => h('li', { class: winners.includes(p) ? 'win' : '' },
                    h('span', null, p.name), h('span', { class: 'role' }, (winners.includes(p) ? '★ ' : '') + t('bd_pts', { n: p.points }))))),
            h('div', { class: 'row2' }, h('button', { class: 'btn ghost', onclick: leaveSolo }, t('bd_back')),
                h('button', { class: 'btn primary', onclick: () => go('setup') }, t('bd_play_again'))));
    }

    function soloView() {
        if (solo.busy) return h('div', { class: 'center muted' }, t('bd_loading'));
        const s = solo.screen;
        if (s === 'setup') return soloSetup();
        if (s === 'over') return soloOver();
        const q = solo.q;
        const head = [soloStatus(), soloBoard()];
        if (s === 'turn') {
            return h('div', { class: 'stack bd' }, ...head, C.section(t('bd_round_n', { n: solo.round, m: solo.rounds }),
                h('p', { class: 'bd-pass' }, t('bd_pass_to')), h('p', { class: 'bd-pass-name' }, solo.players[solo.who].name),
                h('button', { class: 'btn primary big', onclick: beginQuestion }, t('bd_ready'))));
        }
        if (s === 'question') {
            const kids = [countdown(solo.deadline, q.time), qHead(q)];
            if (solo.kind === 'pass') kids.push(h('p', { class: 'bd-who' }, t('bd_answering', { p: solo.players[solo.who].name })));
            return h('div', { class: 'stack bd' }, ...head, C.section(solo.kind === 'pass' ? t('bd_round_n', { n: solo.round, m: solo.rounds }) : t('bd_question_n', { n: solo.round }), kids, optionButtons(q, (i) => answerSolo(i))));
        }
        const r = solo.reveal;     // screen === 'reveal'
        let verdict, hit = false;
        if (solo.kind === 'single') {
            hit = !r.results[0];
            verdict = r.results[0] ? t('bd_plus', { n: r.points[0] }) : (solo.timeup ? t('bd_timeup') : t('bd_wrong'));
        } else verdict = solo.players.map((p, k) => `${p.name}: ${r.results[k] ? '✓ +' + r.points[k] : '✗'}`).join('  ·  ');
        const done = solo.kind === 'single' ? solo.players[0].lives <= 0 : solo.round >= solo.rounds;
        return h('div', { class: 'stack bd' }, ...head, C.section(t('bd_answer_was'), qHead(q), revealOptions(q, r, r.right, solo.picks),
            infoLine(r), h('p', { class: 'bd-verdict' + (hit ? ' hit' : '') }, verdict),
            h('button', { class: 'btn primary big', onclick: () => { if (done) go('over'); else { solo.round++; nextRound(); } } }, done ? t('bd_finish') : t('bd_next'))));
    }

    /** Lobby extras: the two modes that need no room. */
    function lobbyExtra() {
        return [
            h('div', { class: 'divider' }, h('span', null, t('or'))),
            h('button', { class: 'btn big', onclick: () => startSolo('single') }, t('bd_solo')),
            h('button', { class: 'btn big', onclick: () => startSolo('pass') }, t('bd_pass')),
            h('p', { class: 'muted small center' }, t('bd_modes_note')),
        ];
    }

    return {
        init(core) { C = core; return { playView, resultCard, summary, settings, lobbyExtra, soloActive: () => !!solo, soloView }; },
    };
})();
