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
    VBI18N.add('it', {
        title: 'Forza 4 — vector-box', desc: 'Forza 4 gratis nel browser: contro il computer (facile, medio o difficile) oppure in due sullo stesso schermo. Nessun account.',
        back: '← Giochi', h1: 'Forza 4', new: 'Nuova', opponent: 'Avversario', easy: 'PC facile', medium: 'PC medio', hard: 'PC difficile', two: 'Due giocatori', score: 'Punteggio',
        board: 'Campo di Forza 4', help: 'Tocca una colonna: il disco cade in fondo. Quattro dischi in fila (in orizzontale, verticale o in diagonale) vincono. Contro il computer, dopo ogni partita ci si scambia chi comincia.',
        red: 'rossa', yellow: 'gialla', empty: 'vuota', slot: 'colonna {c}, riga {r}: {v}', score_two: 'Rosso {w} · pari {d} · Giallo {l}', score_cpu: 'Tu {w} · pari {d} · PC {l}',
        m_red: 'Tocca al rosso', m_yellow: 'Tocca al giallo', m_you: 'Tocca a te', m_think: 'Penso…', m_draw: 'Pari: il campo è pieno.', m_wred: 'Vince il rosso!', m_wyellow: 'Vince il giallo!', m_won: 'Hai vinto!', m_lost: 'Ha vinto il computer.',
    });
    VBI18N.add('en', {
        red: 'red', yellow: 'yellow', empty: 'empty', slot: 'column {c}, row {r}: {v}', score_two: 'Red {w} · draws {d} · Yellow {l}', score_cpu: 'You {w} · draws {d} · CPU {l}',
        m_red: 'Red to move', m_yellow: 'Yellow to move', m_you: 'Your turn', m_think: 'Thinking…', m_draw: 'Draw: the board is full.', m_wred: 'Red wins!', m_wyellow: 'Yellow wins!', m_won: 'You won!', m_lost: 'The computer won.',
    });

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
            const names = { 1: VBLang.t('red'), 2: VBLang.t('yellow') };
            cells.forEach((d, i) => {
                const r = (i / COLS) | 0, c = i % COLS, v = b[r][c];
                d.className = 'slot' + (v ? ' p' + v : '') + (win && win.some(([wr, wc]) => wr === r && wc === c) ? ' win' : '');
                d.setAttribute('aria-label', VBLang.t('slot', { c: c + 1, r: r + 1, v: v ? names[v] : VBLang.t('empty') }));
            });
            const k = mode === 'two' ? 'two' : 'cpu', s = score[k] || { w: 0, d: 0, l: 0 };
            $('f4-score').textContent = VBLang.t(mode === 'two' ? 'score_two' : 'score_cpu', s);
        }
        let last = null;   // the last message key, redrawn when the language changes
        const msg = (k) => { last = k; $('f4-msg').textContent = VBLang.t(k); };
        function say() {
            const w = winner(b);
            if (!w) { msg(mode === 'two' ? (turn === 1 ? 'm_red' : 'm_yellow') : (turn === human ? 'm_you' : 'm_think')); return; }
            over = true;
            const k = mode === 'two' ? 'two' : 'cpu', s = score[k] = score[k] || { w: 0, d: 0, l: 0 };
            if (w === 'draw') { s.d++; msg('m_draw'); VBFx.play('bad'); }
            else if (mode === 'two') { (w === 1 ? s.w++ : s.l++); msg(w === 1 ? 'm_wred' : 'm_wyellow'); VBFx.play('win'); }
            else if (w === human) { s.w++; msg('m_won'); VBFx.play('win'); }
            else { s.l++; msg('m_lost'); VBFx.play('lose'); }
            save(); paint();
        }
        function computerTurn() {
            busy = true;
            setTimeout(() => { busy = false; if (over) return; drop(b, bestMove(b, turn, mode), turn); turn = other(turn); VBFx.play('click'); paint(); say(); }, 450);
        }
        function play(c) {
            if (over || busy || b[0][c]) return;
            if (mode !== 'two' && turn !== human) return;
            drop(b, c, turn); turn = other(turn); VBFx.play('click'); paint(); say();
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
        window.addEventListener('vb-lang', () => { paint(); if (last) msg(last); });
        start('medium', false);
    });
})(typeof window !== 'undefined' ? window : globalThis);
