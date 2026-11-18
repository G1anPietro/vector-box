// js/dueamila.js — 2048. The rules (no DOM) are at the top and can be tested from Node; the page is below.
(function (root) {
    'use strict';

    const N = 4;

    /** One row slid to the left: [row', gained]. Each tile merges at most once per move. */
    function slideRow(row) {
        const tiles = row.filter(Boolean), out = [];
        let gained = 0;
        for (let i = 0; i < tiles.length; i++) {
            if (tiles[i] === tiles[i + 1]) { out.push(tiles[i] * 2); gained += tiles[i] * 2; i++; }
            else out.push(tiles[i]);
        }
        while (out.length < N) out.push(0);
        return [out, gained];
    }

    /** dir: 'left' | 'right' | 'up' | 'down'. Returns {board, gained, moved} (board is a new array of 16). */
    function move(board, dir) {
        const get = (r, c) => board[r * N + c];
        const next = new Array(N * N).fill(0);
        let gained = 0;
        for (let k = 0; k < N; k++) {
            const idx = [];
            for (let j = 0; j < N; j++) idx.push(dir === 'left' ? [k, j] : dir === 'right' ? [k, N - 1 - j] : dir === 'up' ? [j, k] : [N - 1 - j, k]);
            const [row, g] = slideRow(idx.map(([r, c]) => get(r, c)));
            gained += g;
            idx.forEach(([r, c], j) => { next[r * N + c] = row[j]; });
        }
        return { board: next, gained, moved: next.some((v, i) => v !== board[i]) };
    }

    function addTile(board, rng) {
        const free = board.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
        if (!free.length) return board;
        const out = board.slice();
        out[free[Math.floor(rng() * free.length)]] = rng() < 0.9 ? 2 : 4;
        return out;
    }

    const canMove = (board) => ['left', 'right', 'up', 'down'].some((d) => move(board, d).moved);

    const api = { N, slideRow, move, addTile, canMove };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
    root.DueAmila = api;
    VBI18N.add('it', {
        title: '2048 — vector-box', desc: '2048 gratis nel browser: scorri o usa le frecce per unire i numeri uguali. Record personale, nessun account.',
        back: '← Giochi', new: 'Nuova', score: 'Punti', best: 'Record', grid: 'Griglia 4 per 4', arrows: 'Frecce', up: 'Su', left: 'Sinistra', down: 'Giù', right: 'Destra',
        help: 'Scorri sulla griglia o usa le frecce (o W A S D). Due numeri uguali che si toccano diventano la loro somma: arriva a 2048.',
        empty: 'vuota', over: 'Nessuna mossa possibile. Nuova partita?', won: 'Hai fatto 2048! Puoi continuare.',
    });
    VBI18N.add('en', { empty: 'empty', over: 'No moves left. New game?', won: 'You made 2048! You can keep going.' });

    // ------------------------------ the page ------------------------------
    document.addEventListener('DOMContentLoaded', () => {
        const $ = (id) => document.getElementById(id);
        const grid = $('db-grid');
        if (!grid) return;
        const VS = window.VBScores || { show() {}, submit() {}, begin() {}, reset() {} };   // leaderboard (js/arcade-scores.js)
        const KEY = 'vb_2048_best';
        let board, score, best = 0, won = false, over = false;
        try { best = +localStorage.getItem(KEY) || 0; } catch (e) { /* private mode */ }

        const cells = [];
        for (let i = 0; i < N * N; i++) { const d = document.createElement('div'); d.className = 't'; grid.append(d); cells.push(d); }

        function paint() {
            board.forEach((v, i) => { cells[i].textContent = v ? String(v) : ''; cells[i].className = 't' + (v ? ' v' + Math.min(v, 4096) : ''); cells[i].setAttribute('aria-label', v ? String(v) : VBLang.t('empty')); });
            $('db-score').textContent = String(score);
            $('db-best').textContent = String(best);
            $('db-msg').textContent = over ? VBLang.t('over') : won ? VBLang.t('won') : '';
        }

        function restart() { VS.reset(); board = addTile(addTile(new Array(N * N).fill(0), Math.random), Math.random); score = 0; won = false; over = false; paint(); }

        function play(dir) {
            if (over) return;
            const r = move(board, dir);
            if (!r.moved) return;
            VS.begin();
            board = addTile(r.board, Math.random);
            score += r.gained;
            if (score > best) { best = score; try { localStorage.setItem(KEY, String(best)); } catch (e) { /* private mode */ } }
            if (board.includes(2048)) won = true;
            if (!canMove(board)) { over = true; VS.submit('dueamila', '', score); }
            paint();
        }

        document.addEventListener('keydown', (e) => {
            const d = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down' }[e.key];
            if (d) { e.preventDefault(); play(d); }
        });
        let start = null;                                   // a swipe on the grid (touch)
        grid.addEventListener('touchstart', (e) => { const t = e.touches[0]; start = { x: t.clientX, y: t.clientY }; }, { passive: true });
        grid.addEventListener('touchend', (e) => {
            if (!start) return;
            const t = e.changedTouches[0], dx = t.clientX - start.x, dy = t.clientY - start.y;
            start = null;
            if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
            play(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
        }, { passive: true });
        document.querySelectorAll('[data-dir]').forEach((b) => b.addEventListener('click', () => play(b.dataset.dir)));
        $('db-new').addEventListener('click', restart);
        window.addEventListener('vb-lang', paint);
        restart(); VS.show('dueamila', '');
    });
})(typeof window !== 'undefined' ? window : globalThis);
