// js/parola-logic.js — rules of "Parola del giorno" without the DOM (UMD: the page and the Node tests use the same file).
(function (root) {
    'use strict';
    const LEN = 5, TRIES = 6, SEED = 0x5EED1A7, EPOCH = Date.UTC(2026, 0, 1);   // puzzle #1 = 2026-01-01

    function makeRng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

    /** The answers in a fixed shuffled order (seeded), so the daily word does not follow the order of the list. */
    function dailyOrder(answers) {
        const a = answers.slice(), rnd = makeRng(SEED);
        for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
        return a;
    }

    /** Whole days from the epoch to the LOCAL calendar date of `d` (same number for everybody on the same day, DST-proof). */
    function dayNumber(d) { return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH) / 86400000); }
    const puzzleNumber = (d) => dayNumber(d) + 1;
    const dailyWord = (d, answers) => { const o = dailyOrder(answers), n = dayNumber(d); return o[((n % o.length) + o.length) % o.length]; };

    /** 'c' right place, 'p' elsewhere in the word, 'a' absent. A repeated letter is marked 'p' only as many times as it is left in the answer. */
    function score(guess, answer) {
        const n = answer.length, res = new Array(n).fill('a'), left = {};   // 5 or 6 letters
        for (let i = 0; i < n; i++) { if (guess[i] === answer[i]) res[i] = 'c'; else left[answer[i]] = (left[answer[i]] || 0) + 1; }
        for (let i = 0; i < n; i++) if (res[i] === 'a' && left[guess[i]] > 0) { res[i] = 'p'; left[guess[i]]--; }
        return res;
    }

    /** Best state of each letter over the scored guesses: c > p > a. */
    function keyStates(guesses, scores) {
        const rank = { a: 1, p: 2, c: 3 }, out = {};
        guesses.forEach((g, r) => { for (let i = 0; i < g.length; i++) if (!out[g[i]] || rank[scores[r][i]] > rank[out[g[i]]]) out[g[i]] = scores[r][i]; });
        return out;
    }

    const SQ = { c: '\u{1F7E9}', p: '\u{1F7E8}', a: '⬛' };
    /** Text to share: the title and the coloured squares only, never the word. */
    function shareText(title, n, scores, won) {
        const head = title + (n ? ' #' + n : '') + ' ' + (won ? scores.length : 'X') + '/' + TRIES;
        return [head, ''].concat(scores.map((r) => r.map((x) => SQ[x]).join(''))).join('\n');
    }

    const EMPTY = () => ({ played: 0, won: 0, streak: 0, best: 0, last: null, dist: [0, 0, 0, 0, 0, 0] });
    /** New stats after a finished daily game (`day` = dayNumber; tries = 1..6 when won). A day already counted is ignored. */
    function addResult(s, day, won, tries) {
        const o = Object.assign(EMPTY(), s || {}); o.dist = (o.dist || []).slice(0, 6); while (o.dist.length < 6) o.dist.push(0);
        if (o.last === day) return o;
        o.played++;
        if (won) { o.won++; o.dist[tries - 1]++; o.streak = o.last === day - 1 && o.lastWin ? o.streak + 1 : 1; o.best = Math.max(o.best, o.streak); o.lastWin = true; }
        else { o.streak = 0; o.lastWin = false; }
        o.last = day;
        return o;
    }
    /** The streak to show today: it is already lost if yesterday was not played and won. */
    const shownStreak = (s, today) => (s && s.lastWin && (s.last === today || s.last === today - 1) ? s.streak : 0);

    /**
     * Best of two stats objects (local and server; either may be null): the one with more games played is the base, the streak
     * comes from whoever played last (equal: the longer), best is the max. A streak is never lost.
     */
    function mergeStats(a, b) {
        if (!a || !b) return Object.assign(EMPTY(), a || b || {});
        const [x, y] = a.played > b.played || (a.played === b.played && (a.last || 0) >= (b.last || 0)) ? [a, b] : [b, a];   // x = base
        const o = Object.assign(EMPTY(), x);
        const h = (y.last || 0) > (x.last || 0) || ((y.last || 0) === (x.last || 0) && y.streak > x.streak) ? y : x;   // streak holder
        o.streak = h.streak; o.last = h.last; o.lastWin = !!h.lastWin;
        o.best = Math.min(Math.max(x.best, y.best, o.streak), o.played);
        return o;
    }
    /** The saved daily game to keep: the later day wins; the same day, the one with more guesses (a finished one on a tie). */
    function mergeDaily(a, b) {
        if (!a || !b) return a || b || null;
        if (a.day !== b.day) return a.day > b.day ? a : b;
        if (a.guesses.length !== b.guesses.length) return a.guesses.length > b.guesses.length ? a : b;
        return b.over && !a.over ? b : a;
    }

    const api = { mergeStats, mergeDaily, LEN, TRIES, makeRng, dailyOrder, dayNumber, puzzleNumber, dailyWord, score, keyStates, shareText, addResult, shownStreak, EMPTY };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
    root.ParolaLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
