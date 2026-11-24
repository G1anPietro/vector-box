// js/arcade-scores.js — leaderboards of the arcade games (api/game_scores.php). Shared by tetris, 2048, snake, minesweeper and pages/classifiche.php.
//   VBScores.show(game, variant [, el])  draws the Top 10 panel (in el, or in a panel it adds at the end of the page)
//   VBScores.submit(game, variant, score [, durationMs])  sends the result of a finished game (logged-in players only; the server keeps the best), then redraws
//   VBScores.begin() / VBScores.reset()  start / forget the play timer used when durationMs is not given (begin keeps the first start)
// Needs i18n.js (VBI18N, VBLang) and csrf.js (adds the CSRF token to the POST). Texts go in with textContent only.
(function (root) {
    'use strict';
    const API = '/api/game_scores.php';
    const LOWER = { minato: true };   // best = smallest (a time in ms)

    /** How a score is written: points as they are, a time (ms) as seconds. */
    const fmt = (game, n) => (LOWER[game] ? (n / 1000).toFixed(1) + ' s' : String(n));
    const api = { fmt };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
    root.VBScores = api;

    VBI18N.add('it', { vbs_top: 'Classifica Top 10', vbs_empty: 'Nessun risultato ancora: sii il primo!', vbs_login: 'Accedi per entrare in classifica', vbs_me: 'Il tuo record: {s} (posizione {r})', vbs_err: 'Classifica non disponibile.' });
    VBI18N.add('en', { vbs_top: 'Top 10 leaderboard', vbs_empty: 'No results yet: be the first!', vbs_login: 'Log in to enter the leaderboard', vbs_me: 'Your best: {s} (rank {r})', vbs_err: 'Leaderboard not available.' });

    const panels = new Map();   // element -> {game, variant, data}
    let t0 = null;
    api.begin = () => { if (t0 === null) t0 = Date.now(); };
    api.reset = () => { t0 = null; };

    function draw(el, st) {
        const d = st.data, t = (k, v) => VBLang.t(k, v);
        const root = document.createElement('div');
        root.className = 'vbs';
        const h = document.createElement('h2'); h.textContent = t('vbs_top'); root.append(h);
        if (!d) { const p = document.createElement('p'); p.className = 'vbs-note'; p.textContent = t('vbs_err'); root.append(p); }
        else {
            if (!d.top.length) { const p = document.createElement('p'); p.className = 'vbs-note'; p.textContent = t('vbs_empty'); root.append(p); }
            else {
                const ol = document.createElement('ol');
                d.top.forEach((r) => {
                    const li = document.createElement('li');
                    const n = document.createElement('span'); n.className = 'vbs-name'; n.textContent = r.name;
                    const s = document.createElement('b'); s.textContent = fmt(st.game, r.score);
                    const w = document.createElement('time'); w.textContent = new Date(r.at * 1000).toLocaleDateString();
                    li.append(n, s, w); ol.append(li);
                });
                root.append(ol);
            }
            const p = document.createElement('p'); p.className = 'vbs-note';
            if (!d.logged_in) { const a = document.createElement('a'); a.href = '/pages/login.php'; a.textContent = t('vbs_login'); p.append(a); }
            else if (d.me) p.textContent = t('vbs_me', { s: fmt(st.game, d.me.score), r: d.me.rank });
            if (p.firstChild) root.append(p);
        }
        el.replaceChildren(root);
    }

    api.show = async function (game, variant, el) {
        variant = variant || '';
        if (!el) {
            el = document.getElementById('vb-top');
            if (!el) { el = document.createElement('div'); el.id = 'vb-top'; const l = document.getElementById('vb-lang'); const host = document.querySelector('.ar-main') || (l ? l.parentNode : document.body); host.insertBefore(el, l && l.parentNode === host ? l : null); }
        }
        const st = { game, variant, data: null };
        panels.set(el, st);
        try {
            const r = await fetch(API + '?game=' + encodeURIComponent(game) + '&variant=' + encodeURIComponent(variant), { credentials: 'same-origin' });
            const j = await r.json();
            if (j && j.success) st.data = j;
        } catch (e) { /* offline: the panel says so */ }
        if (panels.get(el) === st) draw(el, st);
    };

    api.submit = async function (game, variant, score, durationMs) {
        variant = variant || '';
        const dur = Math.round(durationMs !== undefined ? durationMs : (t0 === null ? 0 : Date.now() - t0));
        t0 = null;
        try {
            await fetch(API, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ game, variant, score: Math.round(score), duration_ms: dur }) });   // 401 for guests, 422 if implausible: nothing to tell
        } catch (e) { /* offline */ }
        panels.forEach((st, el) => { if (st.game === game && st.variant === variant) api.show(game, variant, el); });
    };

    document.addEventListener('DOMContentLoaded', () => document.querySelectorAll('[data-vbs]').forEach((el) => api.show(el.dataset.vbs, el.dataset.variant || '', el)));   // pages/classifiche.php
    window.addEventListener('vb-lang', () => panels.forEach((st, el) => { if (st.data) draw(el, st); }));
})(typeof window !== 'undefined' ? window : globalThis);
