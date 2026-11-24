// js/records.js — personal records of the solo games on the account (api/records.php).
//   VBRecords.sync(game, bests)   bests = {variant: value} kept in the browser; sends them, resolves with the merged {variant: value}
//                                 from the account, or null (guest, offline): then the browser's own values stay as they are
//   VBRecords.submit(game, variant, value)   a new record was made: send it (silent if not logged in)
// Needs csrf.js (adds the CSRF token to the POST). A guest is noticed once (401) and not asked again in that tab.
(function (root) {
    'use strict';
    const API = '/api/records.php';
    const quiet = () => { try { return sessionStorage.getItem('vb_rec_guest') === '1'; } catch (e) { return false; } };
    async function post(body) {
        if (quiet()) return null;
        try {
            const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            if (r.status === 401) { try { sessionStorage.setItem('vb_rec_guest', '1'); } catch (e) { /* private mode */ } return null; }
            const j = await r.json();
            return j && j.success ? j : null;
        } catch (e) { return null; }
    }
    /** "Better" for a game where the best is the smallest (lower = true) or the biggest. */
    const better = (a, b, lower) => (lower ? a < b : a > b);
    const pending = new Map();
    const api = {
        lowerGames: { memory: true },   // the best is the smallest number
        better,
        async sync(game, bests) { const j = await post({ action: 'sync', game, bests }); return j ? j.bests : null; },
        /** Sends a new record; several in a row (an endless run) are merged into one request a moment later, with the best value. */
        submit(game, variant, value) {
            const k = game + '|' + variant;
            const lower = !!(api.lowerGames && api.lowerGames[game]);
            const cur = pending.get(k);
            if (cur) { if (better(value, cur.value, lower)) cur.value = value; return Promise.resolve(null); }
            const job = { value };
            pending.set(k, job);
            return new Promise((res) => setTimeout(() => { pending.delete(k); res(post({ action: 'submit', game, variant, value: job.value })); }, 1500));
        },
    };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
    root.VBRecords = api;
})(typeof window !== 'undefined' ? window : globalThis);
