// js/memory.js — Memory (find the pairs). The rules (no DOM) are at the top and can be tested from Node.
(function (root) {
    'use strict';
    const LEVELS = { easy: { cols: 4, rows: 3 }, medium: { cols: 4, rows: 4 }, hard: { cols: 6, rows: 5 } };
    const SYMBOLS = ['♠', '♥', '♦', '♣', '★', '☀', '☾', '☂', '⚑', '✿', '♪', '⚡', '☘', '✈', '⚓', '☎', '✂', '♛'];

    function makeRng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

    /** cols*rows must be even. cards[i] = pair number; open[i] = face up for a moment; done[i] = found. */
    function newGame(level, rng) {
        const { cols, rows } = typeof level === 'string' ? LEVELS[level] : level;
        const n = cols * rows;
        if (n % 2) throw new Error('an even number of cards is needed');
        const rand = rng || Math.random;
        const cards = [];
        for (let i = 0; i < n / 2; i++) cards.push(i, i);
        for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]]; }
        return { cols, rows, cards, open: [], done: new Array(n).fill(false), moves: 0, found: 0, status: 'play', pending: null };
    }

    /** Turns a card. Returns 'ignored' | 'first' | 'match' | 'miss'. After a 'miss' the page calls hide() when the player has seen them. */
    function flip(g, i) {
        if (g.status !== 'play' || g.pending || g.done[i] || g.open.includes(i)) return 'ignored';
        g.open.push(i);
        if (g.open.length === 1) return 'first';
        g.moves++;
        const [a, b] = g.open;
        if (g.cards[a] === g.cards[b]) {
            g.done[a] = g.done[b] = true; g.found++; g.open = [];
            if (g.found === g.cards.length / 2) g.status = 'won';
            return 'match';
        }
        g.pending = [a, b];
        return 'miss';
    }

    function hide(g) { g.open = []; g.pending = null; }

    const api = { LEVELS, SYMBOLS, makeRng, newGame, flip, hide };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
    root.Memory = api;

    document.addEventListener('DOMContentLoaded', () => {
        const $ = (id) => document.getElementById(id);
        const board = $('ar-board');
        if (!board) return;
        const KEY = 'vb_memory_best';
        let level = 'easy', g, cells = [], t0 = 0, timer = null, hideTimer = null;
        const best = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } })();
        const secs = () => (t0 ? Math.floor((Date.now() - t0) / 1000) : 0);

        function paint() {
            cells.forEach((b, i) => {
                const up = g.done[i] || g.open.includes(i);
                b.textContent = up ? SYMBOLS[g.cards[i] % SYMBOLS.length] : '';
                b.className = 'card' + (up ? ' up' : '') + (g.done[i] ? ' done' : '');
                b.setAttribute('aria-label', up ? 'carta ' + SYMBOLS[g.cards[i] % SYMBOLS.length] : 'carta coperta');
            });
            $('ar-moves').textContent = String(g.moves);
            $('ar-time').textContent = secs() + ' s';
            $('ar-best').textContent = best[level] ? best[level] + ' mosse' : '—';
        }

        function start(lv) {
            level = lv in LEVELS ? lv : 'easy';
            clearInterval(timer); clearTimeout(hideTimer); timer = null; t0 = 0;
            g = newGame(level);
            board.style.setProperty('--cols', String(g.cols));
            board.replaceChildren();
            cells = g.cards.map((_, i) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.i = String(i); board.append(b); return b; });
            document.querySelectorAll('[data-level]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.level === level)));
            $('ar-msg').textContent = '';
            paint();
        }

        board.addEventListener('click', (e) => {
            const c = e.target.closest('button'); if (!c) return;
            if (!t0) { t0 = Date.now(); timer = setInterval(paint, 1000); }
            const r = flip(g, +c.dataset.i);
            if (r === 'ignored') return;
            paint();
            if (r === 'miss') hideTimer = setTimeout(() => { hide(g); paint(); }, 800);
            if (g.status === 'won') {
                clearInterval(timer);
                if (!best[level] || g.moves < best[level]) { best[level] = g.moves; try { localStorage.setItem(KEY, JSON.stringify(best)); } catch (x) { /* private mode */ } }
                $('ar-msg').textContent = `Trovate tutte le coppie in ${g.moves} mosse e ${secs()} secondi!`;
                paint();
            }
        });
        document.querySelectorAll('[data-level]').forEach((b) => b.addEventListener('click', () => start(b.dataset.level)));
        $('ar-new').addEventListener('click', () => start(level));
        start('easy');
    });
})(typeof window !== 'undefined' ? window : globalThis);
