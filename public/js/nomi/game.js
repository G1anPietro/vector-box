// public/js/nomi/game.js
// "Names, things, cities" screens. Runs inside public/js/spia/app.js (rooms, phones, settings, help, render loop); this file draws the match.
// Every round a letter comes up and everybody fills one box per category (anonymous until the review: the server never sends the other sheets while the
// round is open). The server judges the letter and scores the review; the host can cancel a doubtful word. On a shared phone each local player is asked
// in turn behind a "pass the phone" screen. Countdowns are drawn from the time left that the server reports, so a wrong clock changes nothing.
// All user text goes in with textContent (h()).
window.NomiGame = (() => {
    'use strict';
    let C = null;
    let ticker = null;
    const MAX = 30;
    const ALL = ['name', 'thing', 'city', 'animal', 'job', 'film', 'color', 'food'];

    const G = () => C.state.nomi;
    const t = (k, v) => C.t(k, v);
    const h = (...a) => C.h(...a);
    const name = (id) => C.pname(id) || '?';
    const mine = () => C.myPlayers().map((p) => p.id);
    const isMine = (pid) => mine().includes(pid);
    const isHost = () => !!C.state.is_host;
    const LOUD = ['cut', 'rejected', 'left', 'excluded', 'end'];
    const catName = (c) => t('nm_cat_' + c);

    /** Per match UI state: deadline anchor (a new poll does not restart the countdown), flashes, timers. */
    function ui() {
        const g = G();
        if (!C.ui.nm || C.ui.nm.match !== g.match) C.ui.nm = { match: g.match, lastEvent: 0, flash: [], flashUntil: 0, anchor: null, timer: 0 };
        return C.ui.nm;
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
        const bar = h('div', { class: 'nm-bar', 'aria-hidden': 'true' }, h('div', { class: 'nm-bar-fill', style: `animation-duration:${total}s;animation-delay:-${Math.max(0, total - left).toFixed(2)}s` }));
        const num = h('span', { class: 'nm-count', 'aria-live': 'off' }, String(Math.ceil(left)));
        clearInterval(ticker);
        ticker = setInterval(() => {
            if (!num.isConnected) { clearInterval(ticker); return; }
            num.textContent = String(Math.max(0, Math.ceil((at - Date.now()) / 1000)));
        }, 250);
        return h('div', { class: 'nm-clock' }, bar, num);
    }

    /** Lower case, no accents, letters and digits only, without a leading article: the same rule as the server (nomi_lib.php), for the soft warning. */
    function norm(s) {
        return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/ +/g, ' ').trim();
    }
    function startsOk(text, letter) {
        const n = norm(text);
        if (!n) return true;
        const l = letter.toLowerCase();
        return n[0] === l || n.replace(/^(?:il|lo|la|le|gli|i|un|uno|una|the|an|a|el|los|las|une|les|der|die|das|ein|eine) (?=.)/, '')[0] === l;
    }

    function evText(e) {
        const p = e.p ? name(e.p) : '';
        switch (e.t) {
            case 'start': return t('nm_ev_start');
            case 'round': return t('nm_ev_round', { n: e.n, l: e.l });
            case 'cut': return t('nm_ev_cut', { p });
            case 'rejected': return t('nm_ev_rejected', { p });
            case 'left': return t('nm_ev_left', { p });
            case 'excluded': return t('nm_ev_excluded', { p });
            case 'end': return t('nm_ev_end');
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

    /** The row of players: who has already handed in the sheet (only that, never what). */
    function stage() {
        const g = G();
        return h('ul', { class: 'nm-crowd', 'aria-label': t('nm_players') }, g.order.filter((id) => C.playerById(id)).map((id) => {
            const active = g.active.includes(id);
            const done = g.phase === 'write' && g.sent.includes(id);
            return h('li', { class: 'nm-chip' + (active ? '' : ' gone') + (isMine(id) ? ' me' : '') + (done ? ' done' : '') },
                h('span', { class: 'nm-chip-name' }, name(id)),
                h('span', { class: 'nm-chip-state', 'aria-hidden': 'true' }, g.phase === 'write' && active ? (done ? '✓' : '…') : ''),
                done ? h('span', { class: 'sr-only' }, t('nm_sent_mark')) : null);
        }));
    }

    /** The big letter, like a letter written on squared paper. */
    function card() {
        const g = G();
        return h('div', { class: 'nm-card' },
            h('span', { class: 'nm-lead' }, t('nm_letter_is')),
            h('span', { class: 'nm-letter', 'aria-label': g.letter }, g.letter));
    }

    function writeView() {
        const g = G(), q = g.q;
        const todo = g.me.filter((m) => m.active && !m.sent);
        const at = endsAt('w', q.left);
        refreshAt(at);
        const title = t('nm_round_of', { n: g.round, m: g.rounds });
        const cats = g.rules.cats;
        if (todo.length) {
            const m = todo[0];
            const shared = mine().length > 1;
            if (shared && C.ui.passed !== m.player_id) {
                return C.passView(m.player_id, t('nm_pass_to'), () => { C.ui.passed = m.player_id; C.ui.heldOnce = null; C.scheduleRender(); });
            }
            const idOf = (i) => `nm-in-${m.player_id}-${i}`;
            const send = async () => {
                const answers = cats.map((c, i) => { const el = document.getElementById(idOf(i)); return el ? el.value : ''; });
                C.vibrate(25);
                const r = await C.run('submit', { player_id: m.player_id, answers });
                if (r) { C.ui.passed = null; cats.forEach((c, i) => { const el = document.getElementById(idOf(i)); if (el) el.value = ''; }); }
            };
            const check = (i) => () => {
                const el = document.getElementById(idOf(i)), note = document.getElementById(idOf(i) + '-note');
                if (!el || !note) return;
                const bad = !startsOk(el.value, g.letter);
                el.classList.toggle('bad', bad);
                note.textContent = bad ? t('nm_wrong_letter', { l: g.letter }) : '';
            };
            return C.section(title, countdown(at, q.time), card(),
                q.cut ? h('p', { class: 'nm-cut', role: 'status' }, t('nm_cut_view')) : null,
                shared ? h('p', { class: 'nm-who' }, t('nm_writing', { p: name(m.player_id) })) : null,
                h('div', { class: 'nm-sheet' }, cats.map((c, i) => h('div', { class: 'nm-field' },
                    h('label', { class: 'nm-label', for: idOf(i) }, catName(c)),
                    h('input', { id: idOf(i), class: 'nm-input', type: 'text', maxlength: String(MAX), placeholder: t('nm_with_letter', { l: g.letter }), autocomplete: 'off', autocapitalize: 'sentences', spellcheck: 'false', 'aria-describedby': idOf(i) + '-note', oninput: check(i) }),
                    h('p', { id: idOf(i) + '-note', class: 'nm-note small' }, '')))),
                h('button', { class: 'btn primary big nm-send', onclick: send }, t('nm_send')));
        }
        const out = !g.me.some((m) => m.active);
        return C.section(title, countdown(at, q.time), card(),
            q.cut ? h('p', { class: 'nm-cut', role: 'status' }, t('nm_cut_view')) : null,
            h('p', { class: 'nm-wait' }, out ? t('nm_gone') : t('nm_wait_write', { n: g.sent.length, m: g.active.length })));
    }

    const KIND = { solo: 'nm_k_solo', unique: 'nm_k_unique', shared: 'nm_k_shared', wrong: 'nm_k_wrong', cancelled: 'nm_k_cancelled', none: 'nm_k_none' };

    function reviewView() {
        const g = G(), r = g.review;
        if (!r) return null;
        const at = endsAt('r', r.next_left || 0);
        refreshAt(at);
        const host = isHost();
        const sections = r.cats.map((cat, ci) => h('section', { class: 'nm-cat' },
            h('h3', { class: 'nm-cat-h' }, catName(cat.cat)),
            h('ul', { class: 'nm-answers' }, cat.answers.map((a) => h('li', { class: 'nm-ans ' + (a.kind || 'ok') + (isMine(a.p) ? ' me' : '') },
                h('span', { class: 'nm-ans-by' }, name(a.p)),
                h('span', { class: 'nm-ans-text' }, a.text || '—'),
                h('span', { class: 'nm-ans-pts' }, h('b', null, '+' + a.pts), ' ', h('span', { class: 'small' }, t(KIND[a.kind || (a.pts >= 20 ? 'solo' : a.pts >= 10 ? 'unique' : 'shared')]))),
                host && a.text ? h('button', {
                    class: 'btn small ghost', 'aria-label': t('nm_cancel_aria', { p: name(a.p), c: catName(cat.cat) }),
                    onclick: () => C.run('reject', { player_id: a.p, cat: ci }),
                }, a.kind === 'cancelled' ? t('nm_restore') : t('nm_cancel')) : null)))));
        const ranking = g.active.filter((id) => C.playerById(id)).sort((a, b) => (r.round[b] || 0) - (r.round[a] || 0));
        return C.section(t('nm_review_title'), card(),
            ...sections,
            h('section', { class: 'nm-cat nm-round' },
                h('h3', { class: 'nm-cat-h' }, t('nm_round_pts')),
                h('ol', { class: 'nm-answers' }, ranking.map((id) => h('li', { class: 'nm-ans' + (isMine(id) ? ' me' : '') },
                    h('span', { class: 'nm-ans-by' }, name(id)),
                    h('span', { class: 'nm-ans-text' }, ''),
                    h('span', { class: 'nm-ans-pts' }, h('b', null, '+' + (r.round[id] || 0))))))),
            h('p', { class: 'nm-next muted small' }, t(r.last ? 'nm_results_in' : 'nm_next_in'), ' ', h('b', { class: 'nm-count' }, String(Math.ceil(Math.max(0, (at - Date.now()) / 1000))))),
            host ? h('button', { class: 'btn ghost', onclick: () => C.run('next') }, t(r.last ? 'nm_see_results' : 'nm_next')) : null);
    }

    function feed() {
        const evs = G().events.slice(-8).reverse();
        return h('ol', { class: 'nm-feed' }, evs.map((e) => h('li', { class: LOUD.includes(e.t) ? 'loud ev-' + e.t : 'ev-' + e.t }, evText(e))));
    }

    /** Host: exclude a player, end the match (cancelling words is in the review itself). */
    function hostPanel() {
        if (!isHost()) return null;
        const g = G();
        return h('details', { class: 'panel nm-host' },
            h('summary', null, t('nm_host_tools')),
            h('p', { class: 'small muted' }, t('nm_host_note')),
            h('div', { class: 'nm-exclude' }, g.active.filter((id) => C.playerById(id)).map((id) => h('button', {
                class: 'btn small ghost', onclick: () => C.askConfirm(t('nm_exclude_q', { p: name(id) }), t('nm_exclude', { p: name(id) }), () => C.run('exclude', { player_id: id }), true),
            }, t('nm_exclude', { p: name(id) })))),
            h('button', { class: 'btn ghost', onclick: () => C.askConfirm(t('nm_end_q'), t('nm_end'), () => C.run('end'), true) }, t('nm_end')));
    }

    function playView() {
        const g = G();
        const flash = announce();
        return h('div', { class: 'stack nm' },
            !C.netOk ? h('div', { class: 'banner warn' }, t('connection_lost')) : null,
            flash.length ? h('div', { class: 'nm-flash', role: 'status' }, flash.map((e) => h('div', null, evText(e)))) : null,
            h('div', { class: 'nm-top' }, h('span', null, t('nm_round_of', { n: g.round, m: g.rounds })), h('span', null, t('nm_seconds_n', { n: g.rules.time }))),
            stage(),
            g.phase === 'write' && g.q ? writeView() : reviewView(),
            C.section(t('nm_feed_title'), feed()),
            hostPanel());
    }

    function resultCard() {
        const g = G();
        const res = g.result || { reason: 'host_ended', rows: [] };
        return h('section', { class: 'panel result nm-result' },
            h('div', { class: 'stamp result-stamp' }, t('nm_standings')),
            h('div', { class: 'muted' }, t('nm_reason_' + res.reason)),
            h('ol', { class: 'nm-standings' }, res.rows.filter((r) => C.playerById(r.p)).map((r, i) => h('li', { class: 'nm-stand' + (i === 0 && r.pts > 0 ? ' first' : '') },
                h('span', { class: 'nm-stand-rank', 'aria-hidden': 'true' }, String(i + 1)),
                h('b', { class: 'nm-stand-name' }, name(r.p)),
                h('span', { class: 'nm-stand-n' }, t('nm_pts_total', { n: r.pts, b: r.best }))))));
    }

    function summary() {
        const s = C.state.settings;
        const chips = [t('nm_rounds_n', { n: s.rounds }), t('nm_seconds_n', { n: s.time }), t('nm_sum_cats', { n: s.cats.length }), s.family ? t('nm_sum_family') : null].filter(Boolean);
        return h('div', { class: 'chips' }, chips.map((c) => h('span', { class: 'chip soft' }, c)));
    }

    function settings(s, { set, toggle, host }) {
        const choice = (key, values, label, text) => h('div', { class: 'nm-choices', role: 'group', 'aria-label': label }, values.map((v) => h('button', {
            class: 'btn small' + (s[key] === v ? ' primary' : ' ghost'), disabled: !host, 'aria-pressed': String(s[key] === v), onclick: () => set({ [key]: v }),
        }, text(v))));
        const flip = (c) => {
            const on = s.cats.includes(c);
            if (on && s.cats.length <= 2) return;
            set({ cats: ALL.filter((x) => (x === c ? !on : s.cats.includes(x))) });
        };
        return [
            h('div', { class: 'set-row' },
                h('div', { class: 'set-text' }, h('span', { class: 'set-title' }, t('nm_set_cats')), h('span', { class: 'set-desc' }, t('nm_set_cats_d'))),
                h('div', { class: 'nm-choices', role: 'group', 'aria-label': t('nm_set_cats') }, ALL.map((c) => h('button', {
                    class: 'btn small' + (s.cats.includes(c) ? ' primary' : ' ghost'), disabled: !host, 'aria-pressed': String(s.cats.includes(c)), onclick: () => flip(c),
                }, catName(c))))),
            h('div', { class: 'set-row' },
                h('div', { class: 'set-text' }, h('span', { class: 'set-title' }, t('nm_set_time')), h('span', { class: 'set-desc' }, t('nm_set_time_d'))),
                choice('time', [60, 90, 120], t('nm_set_time'), (v) => t('nm_seconds_n', { n: v }))),
            h('div', { class: 'set-row' },
                h('div', { class: 'set-text' }, h('span', { class: 'set-title' }, t('nm_set_rounds')), h('span', { class: 'set-desc' }, t('nm_set_rounds_d'))),
                choice('rounds', [3, 5, 8], t('nm_set_rounds'), (v) => t('nm_rounds_n', { n: v }))),
            toggle('family', t('nm_set_family'), t('nm_set_family_d')),
        ];
    }

    return {
        init(core) {
            C = core;
            // a new render rebuilds the boxes (the text stays): look again at which ones start with the wrong letter
            window.addEventListener('spia:render', () => document.querySelectorAll('input.nm-input').forEach((el) => el.dispatchEvent(new Event('input'))));
            return { playView, resultCard, summary, settings };
        },
    };
})();
