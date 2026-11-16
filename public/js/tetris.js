// js/tetris.js — Tetris. The rules (no DOM) are at the top and can be tested from Node; the page is below.
(function (root) {
    'use strict';
    const W = 10, H = 20;
    // each piece: the cells of its box in the spawn orientation, and the box size (rotation turns the cells inside the box)
    const PIECES = {
        I: { size: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]], color: 1 },
        O: { size: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]], color: 2 },
        T: { size: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]], color: 3 },
        S: { size: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]], color: 4 },
        Z: { size: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]], color: 5 },
        J: { size: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]], color: 6 },
        L: { size: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]], color: 7 },
    };
    const TYPES = Object.keys(PIECES);
    const LINE_POINTS = [0, 100, 300, 500, 800];

    function makeRng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

    /** 7-bag: every piece once, in random order, before any repeats. */
    function draw(g) {
        if (!g.bag.length) {
            g.bag = TYPES.slice();
            for (let i = g.bag.length - 1; i > 0; i--) { const j = Math.floor(g.rng() * (i + 1)); [g.bag[i], g.bag[j]] = [g.bag[j], g.bag[i]]; }
        }
        return g.bag.pop();
    }

    const rotCells = (cells, size, turns) => {
        let c = cells;
        for (let t = ((turns % 4) + 4) % 4; t > 0; t--) c = c.map(([x, y]) => [size - 1 - y, x]);
        return c;
    };
    /** Absolute board cells [[x, y], ...] of a piece {type, rot, x, y}. */
    const cellsOf = (p) => rotCells(PIECES[p.type].cells, PIECES[p.type].size, p.rot).map(([x, y]) => [p.x + x, p.y + y]);
    const fits = (board, p) => cellsOf(p).every(([x, y]) => x >= 0 && x < W && y < H && (y < 0 || !board[y][x]));

    function spawn(g) {
        const type = g.next || draw(g);
        g.next = draw(g);
        g.cur = { type, rot: 0, x: Math.floor((W - PIECES[type].size) / 2), y: type === 'I' ? -1 : 0 };
        if (!fits(g.board, g.cur)) { g.status = 'over'; }
    }

    function newGame(rng) {
        const g = { board: Array.from({ length: H }, () => new Array(W).fill(0)), rng: rng || Math.random, bag: [], next: null, cur: null, score: 0, lines: 0, level: 1, status: 'play' };
        spawn(g);
        return g;
    }

    function move(g, dx) {
        if (g.status !== 'play') return false;
        const p = { ...g.cur, x: g.cur.x + dx };
        if (!fits(g.board, p)) return false;
        g.cur = p; return true;
    }

    /** Rotates (dir +1 clockwise, -1 the other way) trying small sideways kicks so a piece can turn next to a wall. */
    function rotate(g, dir) {
        if (g.status !== 'play') return false;
        if (g.cur.type === 'O') return true;
        const rot = g.cur.rot + dir;
        for (const kick of [0, -1, 1, -2, 2]) {
            const p = { ...g.cur, rot, x: g.cur.x + kick };
            if (fits(g.board, p)) { g.cur = p; return true; }
        }
        return false;
    }

    function clearLines(g) {
        const keep = g.board.filter((row) => row.some((c) => !c));
        const n = H - keep.length;
        if (n) g.board = [...Array.from({ length: n }, () => new Array(W).fill(0)), ...keep];
        return n;
    }

    /** Fixes the piece on the board, clears lines, scores, brings the next piece. Returns the number of lines cleared. */
    function lock(g) {
        for (const [x, y] of cellsOf(g.cur)) { if (y < 0) { g.status = 'over'; return 0; } g.board[y][x] = PIECES[g.cur.type].color; }
        const n = clearLines(g);
        g.lines += n;
        g.score += LINE_POINTS[n] * g.level;
        g.level = 1 + Math.floor(g.lines / 10);
        spawn(g);
        return n;
    }

    /** One step down (gravity or soft drop). Returns 'moved' | 'locked'. A soft drop is worth a point per row. */
    function down(g, soft) {
        if (g.status !== 'play') return 'locked';
        const p = { ...g.cur, y: g.cur.y + 1 };
        if (fits(g.board, p)) { g.cur = p; if (soft) g.score += 1; return 'moved'; }
        lock(g);
        return 'locked';
    }

    const ghostY = (g) => { let p = { ...g.cur }; while (fits(g.board, { ...p, y: p.y + 1 })) p.y++; return p.y; };

    function hardDrop(g) {
        if (g.status !== 'play') return 0;
        const y = ghostY(g), rows = y - g.cur.y;
        g.cur = { ...g.cur, y };
        g.score += rows * 2;
        lock(g);
        return rows;
    }

    /** Milliseconds per gravity step at a level. */
    const speed = (level) => Math.max(90, 800 - (level - 1) * 70);

    const api = { W, H, PIECES, TYPES, makeRng, newGame, cellsOf, fits, move, rotate, down, hardDrop, ghostY, lock, speed, rotCells };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
    root.Tetris = api;

    // ------------------------------ the page ------------------------------
    document.addEventListener('DOMContentLoaded', () => {
        const $ = (id) => document.getElementById(id);
        const canvas = $('tt-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d'), nctx = $('tt-next').getContext('2d');
        const COLORS = ['#14121a', '#4dd0e1', '#f2c66d', '#b388ff', '#9be564', '#ff5e5e', '#4da3ff', '#ffb74d'];
        const KEY = 'vb_tetris_best';
        let g, timer = null, best = 0, running = false, cell = 24;
        try { best = +localStorage.getItem(KEY) || 0; } catch (e) { /* private mode */ }

        function layout() {
            const dpr = window.devicePixelRatio || 1;
            cell = Math.max(14, Math.min(28, Math.floor((window.innerHeight - 330) / H), Math.floor((window.innerWidth - 130) / W)));
            canvas.style.width = cell * W + 'px'; canvas.style.height = cell * H + 'px';
            canvas.width = cell * W * dpr; canvas.height = cell * H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            draw();
        }
        const square = (c, x, y, color, alpha) => { c.globalAlpha = alpha || 1; c.fillStyle = color; c.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2); c.globalAlpha = 1; };
        function draw() {
            ctx.fillStyle = COLORS[0]; ctx.fillRect(0, 0, cell * W, cell * H);
            for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g.board[y][x]) square(ctx, x, y, COLORS[g.board[y][x]]);
            if (g.cur && g.status === 'play') {
                const gy = ghostY(g), col = COLORS[PIECES[g.cur.type].color];
                for (const [x, y] of cellsOf({ ...g.cur, y: gy })) if (y >= 0) square(ctx, x, y, col, 0.25);
                for (const [x, y] of cellsOf(g.cur)) if (y >= 0) square(ctx, x, y, col);
            }
            nctx.fillStyle = COLORS[0]; nctx.fillRect(0, 0, 80, 60);
            if (g.next) {
                const pc = PIECES[g.next];
                for (const [x, y] of pc.cells) { nctx.fillStyle = COLORS[pc.color]; nctx.fillRect(10 + x * 14, 8 + y * 14, 12, 12); }
            }
            $('tt-score').textContent = String(g.score); $('tt-lines').textContent = String(g.lines); $('tt-level').textContent = String(g.level); $('tt-best').textContent = String(best);
        }
        function tick() {
            down(g, false); draw();
            if (g.status === 'over') return over();
            timer = setTimeout(tick, speed(g.level));
        }
        function over() {
            running = false; clearTimeout(timer);
            if (g.score > best) { best = g.score; try { localStorage.setItem(KEY, String(best)); } catch (e) { /* private mode */ } }
            draw(); $('tt-msg').textContent = 'Fine partita. Premi Nuova per riprovare.';
        }
        function begin() { if (!running && g.status === 'play') { running = true; $('tt-msg').textContent = ''; timer = setTimeout(tick, speed(g.level)); } }
        function restart() { clearTimeout(timer); running = false; g = newGame(); $('tt-msg').textContent = 'Premi una freccia o un tasto per cominciare.'; draw(); }
        function act(fn) { if (g.status !== 'play') return; begin(); fn(); draw(); if (g.status === 'over') over(); }

        const keys = { ArrowLeft: () => move(g, -1), ArrowRight: () => move(g, 1), ArrowUp: () => rotate(g, 1), ArrowDown: () => down(g, true), ' ': () => hardDrop(g),
                       a: () => move(g, -1), d: () => move(g, 1), w: () => rotate(g, 1), s: () => down(g, true), z: () => rotate(g, -1), x: () => rotate(g, 1) };
        document.addEventListener('keydown', (e) => { const f = keys[e.key]; if (!f || e.ctrlKey || e.metaKey) return; e.preventDefault(); act(f); });
        document.querySelectorAll('[data-act]').forEach((b) => {
            const f = { left: () => move(g, -1), right: () => move(g, 1), rotate: () => rotate(g, 1), down: () => down(g, true), drop: () => hardDrop(g) }[b.dataset.act];
            let rep = null;
            const stop = () => { clearInterval(rep); rep = null; };
            b.addEventListener('pointerdown', (e) => { e.preventDefault(); act(f); if (['left', 'right', 'down'].includes(b.dataset.act)) rep = setInterval(() => act(f), 110); });
            ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, stop));
        });
        $('tt-new').addEventListener('click', restart);
        window.addEventListener('resize', layout);
        document.addEventListener('visibilitychange', () => { if (document.hidden && running) { clearTimeout(timer); running = false; $('tt-msg').textContent = 'In pausa: premi un tasto per riprendere.'; } });
        g = newGame(); layout(); $('tt-msg').textContent = 'Premi una freccia o un tasto per cominciare.';
    });
})(typeof window !== 'undefined' ? window : globalThis);
