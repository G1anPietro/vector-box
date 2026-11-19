// js/vita.js — Conway's Game of Life. The rules (no DOM) are at the top and can be tested from Node.
(function (root) {
    'use strict';
    const N = 40;   // shortcut: a fixed 40x40 board whose edges wrap around (a torus), upgrade to a bigger or resizable board if people ask

    // Patterns as pictures: O = alive cell.
    const PATTERNS = {
        glider: ['.O.', '..O', 'OOO'],
        blinker: ['OOO'],
        pulsar: ['..OOO...OOO..', '.............', 'O....O.O....O', 'O....O.O....O', 'O....O.O....O', '..OOO...OOO..', '.............',
                 '..OOO...OOO..', 'O....O.O....O', 'O....O.O....O', 'O....O.O....O', '.............', '..OOO...OOO..'],
        gun: ['........................O...........', '......................O.O...........', '............OO......OO............OO',
              '...........O...O....OO............OO', 'OO........O.....O...OO..............', 'OO........O...O.OO....O.O...........',
              '..........O.....O.......O...........', '...........O...O....................', '............OO......................'],
    };

    const empty = (n = N) => new Uint8Array(n * n);

    /** The next generation: a live cell with 2 or 3 live neighbours stays, a dead cell with exactly 3 is born. */
    function step(cells, n = N) {
        const next = new Uint8Array(n * n);
        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                let k = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx || dy) k += cells[((y + dy + n) % n) * n + ((x + dx + n) % n)];
                    }
                }
                next[y * n + x] = (k === 3 || (k === 2 && cells[y * n + x])) ? 1 : 0;
            }
        }
        return next;
    }

    const population = (cells) => cells.reduce((a, c) => a + c, 0);

    /** A board with the named pattern in the middle. */
    function withPattern(name, n = N) {
        const cells = empty(n), rows = PATTERNS[name] || [];
        const ox = (n - (rows[0] ? rows[0].length : 0)) >> 1, oy = (n - rows.length) >> 1;
        rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === 'O') cells[(oy + y) * n + ox + x] = 1; }));
        return cells;
    }

    function randomBoard(rng, n = N) {
        const cells = empty(n);
        for (let i = 0; i < cells.length; i++) cells[i] = (rng || Math.random)() < 0.28 ? 1 : 0;
        return cells;
    }

    const api = { N, PATTERNS, empty, step, population, withPattern, randomBoard };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
    root.Life = api;
    VBI18N.add('it', {
        title: 'Gioco della vita — vector-box', title_h: 'Gioco della vita', desc: 'Il Gioco della vita di Conway gratis nel browser: disegna le cellule, guardale nascere e morire. Nessun account.',
        back: '← Giochi', run: 'Avvia', stop: 'Ferma', step: 'Passo', random: 'Casuale', clear: 'Svuota', speed: 'Velocità', gen: 'Generazione', pop: 'Vive',
        pattern: 'Schema', p_draw: 'Disegna tu', p_glider: 'Aliante', p_blinker: 'Lampeggiante', p_pulsar: 'Pulsar', p_gun: 'Cannone di Gosper', field: 'Campo di gioco',
        help: 'Tocca o trascina sul campo per disegnare o cancellare le cellule. Una cellula viva con 2 o 3 vicine sopravvive, una morta con esattamente 3 vicine nasce. I bordi si collegano tra loro. Spazio avvia e ferma, S fa un passo.',
    });
    VBI18N.add('en', { run: 'Start', stop: 'Stop' });

    document.addEventListener('DOMContentLoaded', () => {
        const $ = (id) => document.getElementById(id);
        const canvas = $('vi-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const DELAYS = [800, 500, 300, 200, 120, 80, 50, 30];
        let cells = empty(), gen = 0, timer = null, paint = null;

        const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#00ff66';
        function size() {
            const px = Math.min(window.innerWidth - 24, 480);
            const dpr = window.devicePixelRatio || 1;
            canvas.style.width = px + 'px'; canvas.style.height = px + 'px';
            canvas.width = Math.round(px * dpr); canvas.height = Math.round(px * dpr);
            draw();
        }
        function draw() {
            const c = canvas.width / N;
            ctx.fillStyle = '#14121a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = css('--accent');
            for (let i = 0; i < cells.length; i++) if (cells[i]) ctx.fillRect((i % N) * c + 0.5, ((i / N) | 0) * c + 0.5, c - 1, c - 1);
            $('vi-gen').textContent = String(gen);
            $('vi-pop').textContent = String(population(cells));
        }
        function tick() { cells = step(cells); gen++; draw(); }
        function setRunning(on) {
            clearInterval(timer); timer = null;
            if (on) timer = setInterval(tick, DELAYS[+$('vi-speed').value - 1]);
            $('vi-run').textContent = VBLang.t(on ? 'stop' : 'run');
            $('vi-run').setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        const load = (c) => { setRunning(false); cells = c; gen = 0; draw(); };

        const cellAt = (e) => {
            const r = canvas.getBoundingClientRect();
            const x = Math.floor((e.clientX - r.left) / r.width * N), y = Math.floor((e.clientY - r.top) / r.height * N);
            return x >= 0 && y >= 0 && x < N && y < N ? y * N + x : -1;
        };
        canvas.addEventListener('pointerdown', (e) => {
            const i = cellAt(e);
            if (i < 0) return;
            paint = cells[i] ? 0 : 1; cells[i] = paint; $('vi-pat').value = ''; draw();
            canvas.setPointerCapture(e.pointerId);
        });
        canvas.addEventListener('pointermove', (e) => { if (paint === null) return; const i = cellAt(e); if (i >= 0 && cells[i] !== paint) { cells[i] = paint; draw(); } });
        const endPaint = () => { paint = null; };
        canvas.addEventListener('pointerup', endPaint); canvas.addEventListener('pointercancel', endPaint);

        $('vi-run').addEventListener('click', () => setRunning(!timer));
        $('vi-step').addEventListener('click', () => { setRunning(false); tick(); });
        $('vi-random').addEventListener('click', () => { $('vi-pat').value = ''; load(randomBoard()); });
        $('vi-clear').addEventListener('click', () => { $('vi-pat').value = ''; load(empty()); });
        $('vi-pat').addEventListener('change', (e) => load(e.target.value ? withPattern(e.target.value) : empty()));
        $('vi-speed').addEventListener('input', () => { if (timer) setRunning(true); });
        document.addEventListener('keydown', (e) => {
            if (e.target && /^(INPUT|SELECT|BUTTON|TEXTAREA)$/.test(e.target.tagName)) return;
            if (e.key === ' ') { e.preventDefault(); setRunning(!timer); }
            else if (e.key === 's' || e.key === 'S') { setRunning(false); tick(); }
        });
        document.addEventListener('visibilitychange', () => { if (document.hidden && timer) setRunning(false); });   // do not run in a hidden tab
        window.addEventListener('resize', size);
        window.addEventListener('vb-lang', () => setRunning(!!timer));
        $('vi-pat').value = 'glider'; cells = withPattern('glider'); size(); setRunning(false);
    });
})(typeof window !== 'undefined' ? window : globalThis);
