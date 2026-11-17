// js/tris.js — Tris (tic-tac-toe) against the computer or a friend. The rules (no DOM) are at the top and can be tested from Node.
(function (root) {
    'use strict';
    const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

    /** 'X' | 'O' | 'draw' | null (still playing) */
    function winner(b) {
        for (const [a, c, d] of LINES) if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
        return b.every(Boolean) ? 'draw' : null;
    }
    const line = (b) => LINES.find(([a, c, d]) => b[a] && b[a] === b[c] && b[a] === b[d]) || null;
    const moves = (b) => b.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
    const other = (p) => (p === 'X' ? 'O' : 'X');

    /** Minimax: +1 if `me` wins with best play, -1 if loses, 0 draw; the shorter the win the better. */
    function score(b, turn, me, depth) {
        const w = winner(b);
        if (w === me) return 10 - depth;
        if (w === other(me)) return depth - 10;
        if (w === 'draw') return 0;
        let best = turn === me ? -Infinity : Infinity;
        for (const m of moves(b)) {
            b[m] = turn;
            const s = score(b, other(turn), me, depth + 1);
            b[m] = null;
            best = turn === me ? Math.max(best, s) : Math.min(best, s);
        }
        return best;
    }

    /** The computer's move. level 'easy' = random, 'medium' = best move 6 times out of 10, 'hard' = never loses. */
    function bestMove(b, me, level, rng) {
        const free = moves(b);
        if (!free.length) return -1;
        const rand = rng || Math.random;
        if (level === 'easy' || (level === 'medium' && rand() < 0.4)) return free[Math.floor(rand() * free.length)];
        let best = -Infinity, pick = [];
        for (const m of free) {
            b[m] = me;
            const s = score(b, other(me), me, 1);
            b[m] = null;
            if (s > best) { best = s; pick = [m]; } else if (s === best) pick.push(m);
        }
        return pick[Math.floor(rand() * pick.length)];
    }

    const api = { LINES, winner, line, moves, bestMove, other };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
    root.Tris = api;
    VBI18N.add('it', {
        title: 'Tris — vector-box', desc: 'Tris gratis nel browser: contro il computer (facile, medio o imbattibile) oppure in due sullo stesso schermo. Nessun account.',
        back: '← Giochi', h1: 'Tris', new: 'Nuova', opponent: 'Avversario', easy: 'PC facile', medium: 'PC medio', hard: 'PC imbattibile', two: 'Due giocatori', score: 'Punteggio',
        grid: 'Griglia del tris', help: 'Tre in fila (orizzontale, verticale o diagonale) vincono. Contro il computer, dopo ogni partita ci si scambia chi comincia. Il livello imbattibile al massimo pareggia.',
        cell: 'casella {n}: {v}', cell_empty: 'casella {n}: vuota', score_two: 'X {w} · pari {d} · O {l}', score_cpu: 'Tu {w} · pari {d} · PC {l}',
        m_turn: 'Tocca a {p}', m_you: 'Tocca a te', m_think: 'Penso…', m_draw: 'Pari.', m_win: 'Vince {p}!', m_won: 'Hai vinto!', m_lost: 'Ha vinto il computer.',
    });
    VBI18N.add('en', {
        cell: 'cell {n}: {v}', cell_empty: 'cell {n}: empty', score_two: 'X {w} · draws {d} · O {l}', score_cpu: 'You {w} · draws {d} · CPU {l}',
        m_turn: '{p} to move', m_you: 'Your turn', m_think: 'Thinking…', m_draw: 'Draw.', m_win: '{p} wins!', m_won: 'You won!', m_lost: 'The computer won.',
    });

    document.addEventListener('DOMContentLoaded', () => {
        const $ = (id) => document.getElementById(id);
        const board = $('tr-board');
        if (!board) return;
        const KEY = 'vb_tris_score';
        let mode = 'easy', b, turn, over, human = 'X';
        const score = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } })();
        const save = () => { try { localStorage.setItem(KEY, JSON.stringify(score)); } catch (e) { /* private mode */ } };
        const cells = [];
        for (let i = 0; i < 9; i++) { const c = document.createElement('button'); c.type = 'button'; c.className = 'cell'; c.dataset.i = String(i); board.append(c); cells.push(c); }

        function paint() {
            const win = line(b);
            cells.forEach((c, i) => { c.textContent = b[i] || ''; c.className = 'cell' + (b[i] ? ' ' + b[i].toLowerCase() : '') + (win && win.includes(i) ? ' win' : ''); c.setAttribute('aria-label', VBLang.t(b[i] ? 'cell' : 'cell_empty', { n: i + 1, v: b[i] })); });
            const k = mode === 'two' ? 'two' : 'cpu';
            const s = score[k] || { w: 0, d: 0, l: 0 };
            $('tr-score').textContent = VBLang.t(mode === 'two' ? 'score_two' : 'score_cpu', s);
        }
        let last = null;   // the last message (key + values), redrawn when the language changes
        const msg = (k, v) => { last = [k, v]; $('tr-msg').textContent = VBLang.t(k, v); };
        function say() {
            const w = winner(b);
            if (!w) { msg(mode === 'two' ? 'm_turn' : (turn === human ? 'm_you' : 'm_think'), { p: turn }); return; }
            over = true;
            const k = mode === 'two' ? 'two' : 'cpu';
            const s = score[k] = score[k] || { w: 0, d: 0, l: 0 };
            if (w === 'draw') { s.d++; msg('m_draw'); }
            else if (mode === 'two') { (w === 'X' ? s.w++ : s.l++); msg('m_win', { p: w }); }
            else if (w === human) { s.w++; msg('m_won'); }
            else { s.l++; msg('m_lost'); }
            save(); paint();
        }
        function play(i) {
            if (over || b[i]) return;
            b[i] = turn; turn = other(turn); paint(); say();
            if (!over && mode !== 'two' && turn !== human) setTimeout(() => { if (over) return; const m = bestMove(b, turn, mode); b[m] = turn; turn = other(turn); paint(); say(); }, 350);
        }
        function start(m, keepMode) {
            if (!keepMode) mode = m;
            b = new Array(9).fill(null); turn = 'X'; over = false;
            // against the computer the human starts as X; after each game the sides swap so the computer also starts
            if (mode !== 'two') { human = (human === 'X' && keepMode) ? 'O' : 'X'; }
            document.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.mode === mode)));
            paint(); say();
            if (mode !== 'two' && turn !== human) setTimeout(() => { const mv = bestMove(b, turn, mode); b[mv] = turn; turn = other(turn); paint(); say(); }, 350);
        }
        board.addEventListener('click', (e) => { const c = e.target.closest('button'); if (c) play(+c.dataset.i); });
        document.querySelectorAll('[data-mode]').forEach((x) => x.addEventListener('click', () => { human = 'O'; start(x.dataset.mode); }));
        $('tr-new').addEventListener('click', () => start(mode, true));
        window.addEventListener('vb-lang', () => { paint(); if (last) msg(last[0], last[1]); });
        human = 'O'; start('easy');
    });
})(typeof window !== 'undefined' ? window : globalThis);
