// js/forza4.js — Forza 4 (Connect Four), against the computer or a friend. The rules (no DOM) are at the top and testable from Node.
(function (root) {
    'use strict';
    const COLS = 7, ROWS = 6;
    const other = (p) => (p === 1 ? 2 : 1);
    const newBoard = () => Array.from({ length: ROWS }, () => new Array(COLS).fill(0));       // board[row][col], row 0 is the TOP

    /** The row a disc dropped in `col` lands on, or -1 if the column is full. */
    function landing(b, col) { for (let r = ROWS - 1; r >= 0; r--) if (!b[r][col]) return r; return -1; }
    function drop(b, col, p) { const r = landing(b, col); if (r >= 0) b[r][col] = p; return r; }
    const undrop = (b, col) => { for (let r = 0; r < ROWS; r++) if (b[r][col]) { b[r][col] = 0; return; } };
    const validCols = (b) => [3, 2, 4, 1, 5, 0, 6].filter((c) => !b[0][c]);                // centre first: better pruning and better play

    /** The four winning cells [[r,c]...] of player p, or null. */
    function fourOf(b, p) {
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
            for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
                const cells = [];
                for (let k = 0; k < 4; k++) { const rr = r + dr * k, cc = c + dc * k; if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || b[rr][cc] !== p) break; cells.push([rr, cc]); }
                if (cells.length === 4) return cells;
            }
        }
        return null;
    }
    const winner = (b) => (fourOf(b, 1) ? 1 : fourOf(b, 2) ? 2 : (validCols(b).length ? 0 : 'draw'));

    function windowScore(w, me) {
        const mine = w.filter((x) => x === me).length, theirs = w.filter((x) => x === other(me)).length, empty = 4 - mine - theirs;
        if (mine && theirs) return 0;
        if (mine === 3 && empty === 1) return 5;
        if (mine === 2 && empty === 2) return 2;
        if (theirs === 3 && empty === 1) return -4;
        return 0;
    }
    function evaluate(b, me) {
        let s = 0;
        for (let r = 0; r < ROWS; r++) if (b[r][3] === me) s += 3;
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
            const w = [];
            for (let k = 0; k < 4; k++) { const rr = r + dr * k, cc = c + dc * k; if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) break; w.push(b[rr][cc]); }
            if (w.length === 4) s += windowScore(w, me);
        }
        return s;
    }

    function search(b, depth, alpha, beta, turn, me) {
        if (fourOf(b, me)) return 100000 + depth;
        if (fourOf(b, other(me))) return -100000 - depth;
        const cols = validCols(b);
        if (!cols.length) return 0;
        if (depth === 0) return evaluate(b, me);
        let best = turn === me ? -Infinity : Infinity;
        for (const c of cols) {
            drop(b, c, turn);
            const v = search(b, depth - 1, alpha, beta, other(turn), me);
            undrop(b, c);
            if (turn === me) { best = Math.max(best, v); alpha = Math.max(alpha, v); } else { best = Math.min(best, v); beta = Math.min(beta, v); }
            if (alpha >= beta) break;
        }
        return best;
    }

    /** The computer's column. 'easy' = wins or blocks when it can, else random; 'medium' looks 3 moves ahead; 'hard' 6. */
    function bestMove(b, me, level, rng) {
        const cols = validCols(b), rand = rng || Math.random;
        if (!cols.length) return -1;
        if (level === 'easy') {
            for (const p of [me, other(me)]) for (const c of cols) { drop(b, c, p); const w = fourOf(b, p); undrop(b, c); if (w) return c; }
            return cols[Math.floor(rand() * cols.length)];
        }
        const depth = level === 'hard' ? 6 : 3;
        let best = -Infinity, pick = [];
        for (const c of cols) {
            drop(b, c, me);
            const v = search(b, depth - 1, -Infinity, Infinity, other(me), me);
            undrop(b, c);
            if (v > best) { best = v; pick = [c]; } else if (v === best) pick.push(c);
        }
        return pick[0];     // columns are tried centre first: a deterministic, sensible tie-break
    }

    const api = { COLS, ROWS, newBoard, landing, drop, validCols, fourOf, winner, bestMove, other };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
    root.Forza4 = api;

    document.addEventListener('DOMContentLoaded', () => {
        const $ = (id) => document.getElementById(id);
        const board = $('f4-board');
        if (!board) return;
        const KEY = 'vb_forza4_score';
        let mode = 'medium', b, turn, over, human = 1, busy = false;
        const score = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } })();
        const save = () => { try { localStorage.setItem(KEY, JSON.stringify(score)); } catch (e) { /* private mode */ } };
        const cells = [];
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { const d = document.createElement('button'); d.type = 'button'; d.dataset.c = String(c); d.className = 'slot'; board.append(d); cells.push(d); }

        function paint() {
            const win = fourOf(b, 1) || fourOf(b, 2);
            const names = { 1: 'rossa', 2: 'gialla' };
            cells.forEach((d, i) => {
                const r = (i / COLS) | 0, c = i % COLS, v = b[r][c];
                d.className = 'slot' + (v ? ' p' + v : '') + (win && win.some(([wr, wc]) => wr === r && wc === c) ? ' win' : '');
                d.setAttribute('aria-label', `colonna ${c + 1}, riga ${r + 1}: ${v ? names[v] : 'vuota'}`);
            });
            const k = mode === 'two' ? 'two' : 'cpu', s = score[k] || { w: 0, d: 0, l: 0 };
            $('f4-score').textContent = mode === 'two' ? `Rosso ${s.w} · pari ${s.d} · Giallo ${s.l}` : `Tu ${s.w} · pari ${s.d} · PC ${s.l}`;
        }
        function say() {
            const w = winner(b);
            if (!w) { $('f4-msg').textContent = mode === 'two' ? (turn === 1 ? 'Tocca al rosso' : 'Tocca al giallo') : (turn === human ? 'Tocca a te' : 'Penso…'); return; }
            over = true;
            const k = mode === 'two' ? 'two' : 'cpu', s = score[k] = score[k] || { w: 0, d: 0, l: 0 };
            if (w === 'draw') { s.d++; $('f4-msg').textContent = 'Pari: il campo è pieno.'; }
            else if (mode === 'two') { (w === 1 ? s.w++ : s.l++); $('f4-msg').textContent = w === 1 ? 'Vince il rosso!' : 'Vince il giallo!'; }
            else if (w === human) { s.w++; $('f4-msg').textContent = 'Hai vinto!'; }
            else { s.l++; $('f4-msg').textContent = 'Ha vinto il computer.'; }
            save(); paint();
        }
        function computerTurn() {
            busy = true;
            setTimeout(() => { busy = false; if (over) return; drop(b, bestMove(b, turn, mode), turn); turn = other(turn); paint(); say(); }, 450);
        }
        function play(c) {
            if (over || busy || b[0][c]) return;
            if (mode !== 'two' && turn !== human) return;
            drop(b, c, turn); turn = other(turn); paint(); say();
            if (!over && mode !== 'two') computerTurn();
        }
        function start(m, next) {
            if (!next) { mode = m; human = 1; } else if (mode !== 'two') human = other(human);
            b = newBoard(); turn = 1; over = false; busy = false;
            document.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.mode === mode)));
            paint(); say();
            if (mode !== 'two' && turn !== human) computerTurn();
        }
        board.addEventListener('click', (e) => { const d = e.target.closest('button'); if (d) play(+d.dataset.c); });
        document.querySelectorAll('[data-mode]').forEach((x) => x.addEventListener('click', () => start(x.dataset.mode, false)));
        $('f4-new').addEventListener('click', () => start(mode, true));
        start('medium', false);
    });
})(typeof window !== 'undefined' ? window : globalThis);
