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
    VBI18N.add('it', {
        title: 'Memory — vector-box', desc: 'Memory gratis nel browser: trova tutte le coppie con meno mosse possibile, tre livelli e record personali. Nessun account.',
        back: '← Giochi', new: 'Nuova', level: 'Livello', easy: 'Facile', medium: 'Medio', hard: 'Difficile', moves: 'Mosse', time: 'Tempo', best: 'Record', cards: 'Carte',
        help: 'Gira due carte alla volta: se sono uguali restano scoperte. Vince chi trova tutte le coppie con meno mosse. P per la pausa.',
        card: 'carta {s}', card_down: 'carta coperta', best_moves: '{n} mosse', won: 'Trovate tutte le coppie in {m} mosse e {s} secondi!',
    });
    VBI18N.add('en', { card: 'card {s}', card_down: 'face-down card', best_moves: '{n} moves', won: 'Found all the pairs in {m} moves and {s} seconds!' });

    document.addEventListener('DOMContentLoaded', () => {
        const $ = (id) => document.getElementById(id);
        const board = $('ar-board');
        if (!board) return;
        const KEY = 'vb_memory_best';
        let level = 'easy', g, cells = [], timer = null, hideTimer = null, pz;
        const clock = VBFx.clock();
        if (window.VBRecords) VBRecords.sync('memory', Object.fromEntries(Object.entries((() => { try { return JSON.parse(localStorage.getItem('vb_memory_best')) || {}; } catch (e) { return {}; } })()).filter(([, n]) => n > 0))).then((m) => {
            if (!m) return;
            for (const [l, n] of Object.entries(m)) if (!best[l] || n < best[l]) best[l] = n;   // fewest moves wins
            try { localStorage.setItem('vb_memory_best', JSON.stringify(best)); } catch (e) { /* private mode */ }
            if (typeof paint === 'function') paint();
        });
        const best = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } })();
        const secs = () => Math.floor(clock.elapsed() / 1000);

        let wonSecs = null;   // set when the game is won: the message is rebuilt in paint() so it follows the language
        function paint() {
            cells.forEach((b, i) => {
                const up = g.done[i] || g.open.includes(i);
                b.textContent = up ? SYMBOLS[g.cards[i] % SYMBOLS.length] : '';
                b.className = 'card' + (up ? ' up' : '') + (g.done[i] ? ' done' : '');
                b.setAttribute('aria-label', up ? VBLang.t('card', { s: SYMBOLS[g.cards[i] % SYMBOLS.length] }) : VBLang.t('card_down'));
            });
            $('ar-moves').textContent = String(g.moves);
            $('ar-time').textContent = secs() + ' s';
            $('ar-best').textContent = best[level] ? VBLang.t('best_moves', { n: best[level] }) : '—';
            $('ar-msg').textContent = wonSecs === null ? '' : VBLang.t('won', { m: g.moves, s: wonSecs });
        }

        function start(lv) {
            level = lv in LEVELS ? lv : 'easy';
            clearInterval(timer); clearTimeout(hideTimer); timer = null; clock.reset(); if (pz) pz.reset();
            g = newGame(level);
            board.style.setProperty('--cols', String(g.cols));
            board.replaceChildren();
            cells = g.cards.map((_, i) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.i = String(i); board.append(b); return b; });
            document.querySelectorAll('[data-level]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.level === level)));
            wonSecs = null;
            paint();
        }

        board.addEventListener('click', (e) => {
            const c = e.target.closest('button'); if (!c) return;
            if (pz.paused) return;
            if (clock.state === 'idle') { clock.start(); timer = setInterval(paint, 1000); }
            const r = flip(g, +c.dataset.i);
            if (r === 'ignored') return;
            VBFx.play(r === 'match' ? 'good' : 'click'); paint();
            if (r === 'miss') hideTimer = setTimeout(() => { hide(g); paint(); }, 800);
            if (g.status === 'won') {
                clearInterval(timer); clock.stop(); VBFx.play('win');
                if (!best[level] || g.moves < best[level]) { best[level] = g.moves; try { localStorage.setItem(KEY, JSON.stringify(best)); } catch (x) { /* private mode */ } if (window.VBRecords) VBRecords.submit('memory', level, g.moves); }
                wonSecs = secs(); paint();
            }
        });
        document.querySelectorAll('[data-level]').forEach((b) => b.addEventListener('click', () => start(b.dataset.level)));
        $('ar-new').addEventListener('click', () => start(level));
        window.addEventListener('vb-lang', paint);
        pz = VBFx.bindPause({ button: $('ar-pause'), cover: board, can: () => clock.state === 'run',
            onPause: () => { clock.pause(); clearInterval(timer); clearTimeout(hideTimer); if (g.pending) hide(g); paint(); },
            onResume: () => { clock.resume(); timer = setInterval(paint, 1000); paint(); } });
        start('easy');
    });
})(typeof window !== 'undefined' ? window : globalThis);
