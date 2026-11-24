// public/js/probabile/game.js
// "Most likely to" screens. Runs inside public/js/spia/app.js (rooms, phones, settings, help, render loop); this file draws the match.
// Everybody votes in secret for another player; the server counts and only sends the counts after the round (never who voted
// for whom). On a shared phone each local player is asked in turn behind a "pass the phone" screen. The countdown is drawn from
// the time left that the server reports, so a wrong clock changes nothing.
window.ProbabileGame = (() => {
    'use strict';
    let C = null;
    let ticker = null;

    const G = () => C.state.probabile;
    const t = (k, v) => C.t(k, v);
    const h = (...a) => C.h(...a);
    const name = (id) => C.pname(id) || '?';
    const mine = () => C.myPlayers().map((p) => p.id);
    const isMine = (pid) => mine().includes(pid);
    const isHost = () => !!C.state.is_host;
    const lang = () => (window.SpiaApp && window.SpiaApp.lang) || 'en';
    const LOUD = ['marked', 'tie', 'none', 'left', 'end'];

    /** Per match UI state: deadline anchor (a new poll does not restart the countdown), the picked target, flashes, timers. */
    function ui() {
        const g = G();
        if (!C.ui.pr || C.ui.pr.match !== g.match) C.ui.pr = { match: g.match, lastEvent: 0, flash: [], flashUntil: 0, anchor: null, timer: null, pick: null, pickKey: '' };
        return C.ui.pr;
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
        const bar = h('div', { class: 'pr-bar', 'aria-hidden': 'true' }, h('div', { class: 'pr-bar-fill', style: `animation-duration:${total}s;animation-delay:-${Math.max(0, total - left).toFixed(2)}s` }));
        const num = h('span', { class: 'pr-count', 'aria-live': 'off' }, String(Math.ceil(left)));
        clearInterval(ticker);
        ticker = setInterval(() => {
            if (!num.isConnected) { clearInterval(ticker); return; }
            num.textContent = String(Math.max(0, Math.ceil((at - Date.now()) / 1000)));
        }, 250);
        return h('div', { class: 'pr-clock' }, bar, num);
    }

    /** The full sentence in the player's language: the lead of the language + the text, then a question mark. */
    function sentence(q) {
        const l = ['it', 'en', 'es', 'fr', 'de'].includes(lang()) ? lang() : 'en';
        return `${t('pr_lead')} ${q.text[l] || q.text.en}?`;
    }

    function evText(e) {
        const p = e.p ? name(e.p) : '';
        switch (e.t) {
            case 'start': return t('pr_ev_start');
            case 'round': return t('pr_ev_round', { n: e.n });
            case 'marked': return t('pr_ev_marked', { p });
            case 'tie': return t('pr_ev_tie', { p });
            case 'none': return t('pr_ev_none');
            case 'left': return t('pr_ev_left', { p });
            case 'end': return t('pr_ev_end');
            default: return '';
        }
    }

    function announce() {
        const u = ui();
        const evs = G().events;
        const loud = evs.filter((e) => e.id > u.lastEvent && LOUD.includes(e.t));
        if (u.lastEvent && loud.length) {
            C.vibrate(loud.some((e) => isMine(e.p) && (e.t === 'marked' || e.t === 'tie')) ? [200, 60, 200] : [60, 40, 60]);
            u.flash = loud.slice(-2);
            u.flashUntil = Date.now() + 5000;
            setTimeout(() => C.scheduleRender(), 5100);
        }
        if (evs.length) u.lastEvent = evs[evs.length - 1].id;
        return Date.now() < u.flashUntil ? u.flash : [];
    }

    /** The row of players: who already voted (only that, never for whom). */
    function stage() {
        const g = G();
        const voting = g.phase === 'vote';
        return h('ul', { class: 'pr-crowd', 'aria-label': t('pr_players') }, g.order.filter((id) => C.playerById(id)).map((id) => {
            const active = g.active.includes(id);
            const done = voting && g.voted.includes(id);
            return h('li', { class: 'pr-chip' + (active ? '' : ' gone') + (isMine(id) ? ' me' : '') + (done ? ' done' : '') },
                h('span', { class: 'pr-chip-name' }, name(id)),
                h('span', { class: 'pr-chip-state', 'aria-hidden': 'true' }, active && voting ? (done ? '✓' : '…') : ''),
                done ? h('span', { class: 'sr-only' }, t('pr_voted_mark')) : null);
        }));
    }

    function card(q) {
        return h('p', { class: 'pr-card' }, h('span', { class: 'pr-finger', 'aria-hidden': 'true' }, '☞'), h('span', { class: 'pr-card-text' }, sentence(q)));
    }

    function voteView() {
        const g = G(), q = g.q, u = ui();
        const todo = g.me.filter((m) => m.active && !m.voted);
        const at = endsAt('v', q.left);
        refreshAt(at);
        const title = t('pr_round_of', { n: g.round, m: g.rules.rounds });
        if (todo.length) {
            const m = todo[0];
            const shared = mine().length > 1;
            if (shared && C.ui.passed !== m.player_id) {
                return C.passView(m.player_id, t('pr_pass_to'), () => { C.ui.passed = m.player_id; C.ui.heldOnce = null; u.pick = null; C.scheduleRender(); });
            }
            const key = `${g.round}:${m.player_id}`;
            if (u.pickKey !== key) { u.pickKey = key; u.pick = null; }
            const targets = g.active.filter((id) => id !== m.player_id && C.playerById(id));
            return C.section(title, countdown(at, q.time), card(q),
                shared ? h('p', { class: 'pr-who' }, t('pr_voting', { p: name(m.player_id) })) : null,
                h('p', { class: 'pr-hint' }, t('pr_vote_for')),
                h('div', { class: 'pr-targets', role: 'group', 'aria-label': t('pr_vote_for') }, targets.map((id) => h('button', {
                    class: 'pr-target' + (u.pick === id ? ' on' : ''), 'aria-pressed': String(u.pick === id),
                    onclick: () => { C.vibrate(15); u.pick = id; C.scheduleRender(true); },
                }, h('span', { class: 'pr-target-name' }, name(id))))),
                h('button', {
                    class: 'btn primary big pr-lock', disabled: u.pick === null,
                    onclick: async () => {
                        const target = u.pick;
                        if (target === null) return;
                        C.vibrate(25);
                        C.ui.passed = null;
                        u.pick = null;
                        await C.run('vote', { player_id: m.player_id, target });
                    },
                }, t('pr_lock')));
        }
        const out = !g.me.some((m) => m.active);
        return C.section(title, countdown(at, q.time), card(q),
            h('p', { class: 'pr-wait' }, out ? t('pr_gone') : t('pr_wait', { n: g.voted.length, m: g.active.length })));
    }

    function votesLabel(n) { return t(n === 0 ? 'pr_votes_zero' : n === 1 ? 'pr_votes_one' : 'pr_votes_n', { n }); }

    function revealView() {
        const g = G(), q = g.q, r = g.reveal;
        if (!q || !r) return null;
        const at = endsAt('r', g.next_left || 0);
        refreshAt(at);
        const rows = g.active.filter((id) => C.playerById(id)).sort((a, b) => (r.counts[b] || 0) - (r.counts[a] || 0));
        const max = Math.max(1, r.max);
        let headline;
        if (!r.marked.length) headline = t('pr_rv_none');
        else if (r.marked.length === 1) headline = t('pr_rv_one', { p: name(r.marked[0]) });
        else headline = t('pr_rv_tie', { p: r.marked.map(name).join(', ') });
        const meMarked = r.marked.some(isMine);
        return C.section(t('pr_reveal_title'), card(q),
            h('ol', { class: 'pr-bars' }, rows.map((id, i) => {
                const n = r.counts[id] || 0, marked = r.marked.includes(id);
                return h('li', { class: 'pr-row' + (marked ? ' mark' : '') + (isMine(id) ? ' me' : '') },
                    h('div', { class: 'pr-row-head' }, h('span', { class: 'pr-row-name' }, name(id)),
                        marked ? h('span', { class: 'pr-badge' }, t('pr_the_mark')) : null,
                        h('span', { class: 'pr-row-n' }, votesLabel(n))),
                    h('div', { class: 'pr-track', 'aria-hidden': 'true' }, h('div', { class: 'pr-fill', style: `--w:${(n / max).toFixed(3)};--d:${(i * 90)}ms` })));
            })),
            h('p', { class: 'pr-verdict' + (meMarked ? ' hit' : ''), role: 'status' }, headline),
            h('p', { class: 'pr-next muted small' }, t(r.last ? 'pr_results_in' : 'pr_next_in'), ' ', h('b', { class: 'pr-count' }, String(Math.ceil(Math.max(0, (at - Date.now()) / 1000))))),
            isHost() ? h('button', { class: 'btn ghost', onclick: () => C.run('next') }, t(r.last ? 'pr_see_results' : 'pr_next')) : null);
    }

    function feed() {
        const evs = G().events.slice(-8).reverse();
        return h('ol', { class: 'pr-feed' }, evs.map((e) => h('li', { class: LOUD.includes(e.t) ? 'loud ev-' + e.t : 'ev-' + e.t }, evText(e))));
    }

    function hostPanel() {
        if (!isHost()) return null;
        return h('details', { class: 'panel pr-host' },
            h('summary', null, t('pr_host_tools')),
            h('p', { class: 'small muted' }, t('pr_host_note')),
            h('button', { class: 'btn ghost', onclick: () => C.askConfirm(t('pr_end_q'), t('pr_end'), () => C.run('end'), true) }, t('pr_end')));
    }

    function playView() {
        const g = G();
        const flash = announce();
        return h('div', { class: 'stack pr' },
            !C.netOk ? h('div', { class: 'banner warn' }, t('connection_lost')) : null,
            flash.length ? h('div', { class: 'pr-flash', role: 'status' }, flash.map((e) => h('div', null, evText(e)))) : null,
            h('div', { class: 'pr-top' }, h('span', null, t('pr_round_of', { n: g.round, m: g.rules.rounds })), h('span', null, t('pr_seconds_n', { n: g.rules.time }))),
            stage(),
            g.phase === 'vote' && g.q ? voteView() : revealView(),
            C.section(t('pr_feed_title'), feed()),
            hostPanel());
    }

    function resultCard() {
        const g = G();
        const res = g.result || { reason: 'host_ended', rows: [], titles: {} };
        return h('section', { class: 'panel result pr-result' },
            h('div', { class: 'stamp result-stamp' }, t('pr_standings')),
            h('div', { class: 'muted' }, t('pr_reason_' + res.reason)),
            h('ol', { class: 'pr-standings' }, res.rows.filter((r) => C.playerById(r.p)).map((r) => {
                const title = res.titles[r.p];
                return h('li', { class: 'pr-stand' + (title ? ' titled' : '') },
                    h('span', { class: 'pr-stand-main' }, h('b', null, name(r.p)), title ? h('span', { class: 'pr-title' }, t('pr_title_' + title)) : null,
                        title ? h('span', { class: 'pr-title-d muted small' }, t('pr_title_' + title + '_d')) : null),
                    h('span', { class: 'pr-stand-n' }, t('pr_marks_n', { n: r.marks, v: r.got })));
            })));
    }

    function summary() {
        const s = C.state.settings;
        const cats = ['calm', 'friends', 'spicy'].filter((k) => s[k]).map((k) => t('pr_cat_' + k));
        const chips = [t('pr_sum_rounds', { n: s.rounds }), t('pr_seconds_n', { n: s.time }), ...cats];
        return h('div', { class: 'chips' }, chips.map((c) => h('span', { class: 'chip soft' }, c)));
    }

    function settings(s, { set, toggle, host }) {
        const choice = (key, values, label) => h('div', { class: 'pr-choices', role: 'group', 'aria-label': label }, values.map((v) => h('button', {
            class: 'btn small' + (s[key] === v ? ' primary' : ' ghost'), disabled: !host, 'aria-pressed': String(s[key] === v), onclick: () => set({ [key]: v }),
        }, key === 'time' ? t('pr_seconds_n', { n: v }) : String(v))));
        return [
            h('div', { class: 'set-row' },
                h('div', { class: 'set-text' }, h('span', { class: 'set-title' }, t('pr_set_rounds')), h('span', { class: 'set-desc' }, t('pr_set_rounds_d'))),
                choice('rounds', [5, 10, 15], t('pr_set_rounds'))),
            h('div', { class: 'set-row' },
                h('div', { class: 'set-text' }, h('span', { class: 'set-title' }, t('pr_set_time')), h('span', { class: 'set-desc' }, t('pr_set_time_d'))),
                choice('time', [20, 30, 45], t('pr_set_time'))),
            h('h3', { class: 'set-group' }, t('pr_set_cats')),
            toggle('calm', t('pr_cat_calm'), ''),
            toggle('friends', t('pr_cat_friends'), ''),
            toggle('spicy', t('pr_cat_spicy'), t('pr_cat_spicy_d')),
        ];
    }

    return {
        init(core) { C = core; return { playView, resultCard, summary, settings }; },
    };
})();
