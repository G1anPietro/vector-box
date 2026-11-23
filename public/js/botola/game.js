// public/js/botola/game.js
// Botola screens. Runs inside public/js/spia/app.js (rooms, phones, settings, help, render loop); this file draws the match.
// Every player answers the same question on their own phone; the server judges and never sends the right answer before the
// round is over. The countdown is drawn from the time left that the server reports, so a wrong clock changes nothing.
window.BotolaGame = (() => {
    'use strict';
    let C = null;

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
        const u = ui();
        clearInterval(u.ticker);
        u.ticker = setInterval(() => {
            if (!num.isConnected) { clearInterval(u.ticker); return; }
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

    return {
        init(core) { C = core; return { playView, resultCard, summary, settings }; },
    };
})();
