// js/snake.js — Snake. The rules (no DOM) are at the top and can be tested from Node.
(function (root) {
    'use strict';
    const SIZE = 16;
    const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

    function placeFood(g, rng) {
        const taken = new Set(g.body.map(([x, y]) => y * g.size + x));
        const free = [];
        for (let i = 0; i < g.size * g.size; i++) if (!taken.has(i)) free.push(i);
        if (!free.length) return null;
        const i = free[Math.floor((rng || Math.random)() * free.length)];
        return [i % g.size, (i / g.size) | 0];
    }

    /** body[0] is the head. */
    function newGame(rng, size = SIZE) {
        const mid = size >> 1;
        const g = { size, body: [[mid, mid], [mid - 1, mid], [mid - 2, mid]], dir: 'right', queue: [], food: null, score: 0, status: 'play' };
        g.food = placeFood(g, rng);
        return g;
    }

    /** Asks for a turn; it takes effect at the next step. A reversal (into the neck) and a repeat are ignored. Two quick taps are both kept. */
    function turn(g, dir) {
        const last = g.queue.length ? g.queue[g.queue.length - 1] : g.dir;
        if (!(dir in DIRS) || dir === last || dir === OPPOSITE[last] || g.queue.length >= 2) return false;
        g.queue.push(dir);
        return true;
    }

    /** One move. Hitting a wall or yourself ends the game; eating grows the snake. (The tail cell is free: it moves away.) */
    function step(g, rng) {
        if (g.status !== 'play') return g;
        if (g.queue.length) g.dir = g.queue.shift();
        const [dx, dy] = DIRS[g.dir];
        const head = [g.body[0][0] + dx, g.body[0][1] + dy];
        const eats = g.food && head[0] === g.food[0] && head[1] === g.food[1];
        const body = eats ? g.body : g.body.slice(0, -1);
        if (head[0] < 0 || head[1] < 0 || head[0] >= g.size || head[1] >= g.size || body.some(([x, y]) => x === head[0] && y === head[1])) { g.status = 'over'; return g; }
        g.body = [head, ...body];
        if (eats) { g.score++; g.food = placeFood(g, rng); if (!g.food) g.status = 'won'; }
        return g;
    }

    const api = { SIZE, DIRS, newGame, turn, step, placeFood };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
    root.Snake = api;
    VBI18N.add('it', {
        title: 'Snake — vector-box', desc: 'Snake gratis nel browser: mangia, cresci, non toccare i muri né te stesso. Frecce, scorrimento o tasti sullo schermo. Nessun account.',
        back: '← Giochi', new: 'Nuova', score: 'Punti', best: 'Record', field: 'Campo di gioco', arrows: 'Frecce', up: 'Su', left: 'Sinistra', down: 'Giù', right: 'Destra',
        help: 'Frecce, W A S D, scorri sul campo o usa i tasti. Ogni cibo ti fa crescere e andare più veloce. In pausa se cambi scheda.',
        m_won: 'Hai riempito tutto il campo!', m_over: 'Fine. Premi Nuova per riprovare.', m_start: 'Premi una freccia o scorri per cominciare.', m_pause: 'In pausa: premi una freccia per riprendere.',
    });
    VBI18N.add('en', {
        m_won: 'You filled the whole field!', m_over: 'Game over. Press New to try again.', m_start: 'Press an arrow key or swipe to start.', m_pause: 'Paused: press an arrow key to resume.',
    });

    document.addEventListener('DOMContentLoaded', () => {
        const $ = (id) => document.getElementById(id);
        const canvas = $('sn-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const VS = window.VBScores || { show() {}, submit() {}, begin() {}, reset() {} };   // leaderboard (js/arcade-scores.js)
        const KEY = 'vb_snake_best';
        let g, timer = null, best = 0, started = false;
        try { best = +localStorage.getItem(KEY) || 0; } catch (e) { /* private mode */ }
        const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#00ff66';

        let msgKey = null;   // the message is kept as a key so it can be redrawn when the language changes
        const say = (k) => { msgKey = k; $('sn-msg').textContent = k ? VBLang.t(k) : ''; };

        function size() {
            const px = Math.min(window.innerWidth - 24, 420);
            const dpr = window.devicePixelRatio || 1;
            canvas.style.width = px + 'px'; canvas.style.height = px + 'px';
            canvas.width = Math.round(px * dpr); canvas.height = Math.round(px * dpr);
            draw();
        }
        function draw() {
            const c = canvas.width / g.size;
            ctx.fillStyle = '#14121a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#ff5e5e';
            if (g.food) { ctx.beginPath(); ctx.arc((g.food[0] + 0.5) * c, (g.food[1] + 0.5) * c, c * 0.35, 0, Math.PI * 2); ctx.fill(); }
            g.body.forEach(([x, y], i) => { ctx.fillStyle = i === 0 ? '#9dffc4' : css('--accent'); ctx.fillRect(x * c + 1, y * c + 1, c - 2, c - 2); });
            $('sn-score').textContent = String(g.score);
            $('sn-best').textContent = String(best);
        }
        function speed() { return Math.max(60, 150 - g.score * 4); }
        function loop() {
            step(g);
            draw();
            if (g.status !== 'play') {
                clearTimeout(timer); timer = null;
                if (g.score > best) { best = g.score; try { localStorage.setItem(KEY, String(best)); } catch (e) { /* private mode */ } draw(); }
                if (g.score > 0) VS.submit('snake', '', g.score);
                say(g.status === 'won' ? 'm_won' : 'm_over');
                return;
            }
            timer = setTimeout(loop, speed());
        }
        function begin() { if (!started) { started = true; VS.begin(); say(null); timer = setTimeout(loop, speed()); } }
        function restart() { clearTimeout(timer); VS.reset(); g = newGame(); started = false; say('m_start'); draw(); }

        const dirOf = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right' };
        document.addEventListener('keydown', (e) => {
            const d = dirOf[e.key];
            if (!d) return;
            e.preventDefault();
            if (g.status === 'play') { turn(g, d); begin(); }
        });
        let start = null;
        canvas.addEventListener('touchstart', (e) => { const t = e.touches[0]; start = { x: t.clientX, y: t.clientY }; }, { passive: true });
        canvas.addEventListener('touchend', (e) => {
            if (!start) return;
            const t = e.changedTouches[0], dx = t.clientX - start.x, dy = t.clientY - start.y; start = null;
            if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return;
            turn(g, Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up')); begin();
        }, { passive: true });
        document.querySelectorAll('[data-dir]').forEach((b) => b.addEventListener('click', () => { if (g.status === 'play') { turn(g, b.dataset.dir); begin(); } }));
        $('sn-new').addEventListener('click', restart);
        window.addEventListener('resize', size);
        document.addEventListener('visibilitychange', () => { if (document.hidden && timer) { clearTimeout(timer); timer = null; started = false; say('m_pause'); } });
        window.addEventListener('vb-lang', () => say(msgKey));
        g = newGame(); size(); say('m_start'); VS.show('snake', '');
    });
})(typeof window !== 'undefined' ? window : globalThis);
