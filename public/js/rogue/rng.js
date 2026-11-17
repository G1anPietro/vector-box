// js/rogue/rng.js — seeded random numbers (mulberry32). The whole state is one integer inside a plain
// object ({ s }), so it is saved with the run and the same seed always gives the same game.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else (root.Rogue = root.Rogue || {}).rng = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    const make = (seed) => ({ s: seed >>> 0 });
    /** A float in [0, 1). */
    function next(r) {
        r.s = (r.s + 0x6D2B79F5) >>> 0;
        let t = r.s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    const int = (r, n) => Math.floor(next(r) * n);                 // 0 .. n-1
    const range = (r, a, b) => a + int(r, b - a + 1);              // a .. b
    const chance = (r, p) => next(r) < p;
    const pick = (r, list) => list[int(r, list.length)];
    function shuffle(r, list) {
        for (let i = list.length - 1; i > 0; i--) { const j = int(r, i + 1); [list[i], list[j]] = [list[j], list[i]]; }
        return list;
    }
    /** Picks one entry by its weight `w` (default 10). */
    function weighted(r, list) {
        let total = 0;
        for (const e of list) total += e.w || 10;
        let n = next(r) * total;
        for (const e of list) { n -= e.w || 10; if (n < 0) return e; }
        return list[list.length - 1];
    }
    /** A new seed from a seed and a number (floor, attempt…). */
    function mix(seed, n) {
        let h = (seed ^ Math.imul(n + 1, 0x9E3779B1)) >>> 0;
        h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B) >>> 0;
        h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35) >>> 0;
        return (h ^ (h >>> 16)) >>> 0;
    }
    /** Text (what the player types as a seed) to a number. */
    function hash(text) {
        let h = 2166136261;
        for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
        return h >>> 0;
    }
    return { make, next, int, range, chance, pick, shuffle, weighted, mix, hash };
});
