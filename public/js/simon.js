// js/simon.js — Simon (repeat the sequence). The rules (no DOM) are at the top and testable from Node.
(function (root) {
    'use strict';
    const PADS = 4;

    function newGame(rng) { const g = { seq: [], pos: 0, score: 0, status: 'idle', rng: rng || Math.random }; return g; }

    /** Adds one pad to the sequence; the player must now repeat it from the start. */
    function nextRound(g) {
        g.seq.push(Math.floor(g.rng() * PADS));
        g.pos = 0; g.status = 'input';
        return g.seq;
    }

    /** The player taps a pad. 'ok' (right, more to go) | 'round' (the whole sequence repeated) | 'lost' | 'ignored'. */
    function press(g, pad) {
        if (g.status !== 'input' || !(pad >= 0 && pad < PADS)) return 'ignored';
        if (g.seq[g.pos] !== pad) { g.status = 'lost'; return 'lost'; }
        g.pos++;
        if (g.pos === g.seq.length) { g.score = g.seq.length; g.status = 'idle'; return 'round'; }
        return 'ok';
    }

    /** Milliseconds between the pads of the showing: faster as the sequence grows. */
    const pace = (len) => Math.max(260, 650 - len * 25);

    const api = { PADS, newGame, nextRound, press, pace };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
    root.Simon = api;

    document.addEventListener('DOMContentLoaded', () => {
        const $ = (id) => document.getElementById(id);
        const pads = [...document.querySelectorAll('.pad')];
        if (!pads.length) return;
        const KEY = 'vb_simon_best';
        let g = newGame(), best = 0, sound = true, busy = false, timers = [], ctx = null;
        try { best = +localStorage.getItem(KEY) || 0; } catch (e) { /* private mode */ }
        const FREQ = [329.6, 261.6, 392, 523.3];

        function beep(i, ms) {
            if (!sound) return;
            try {
                ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
                const o = ctx.createOscillator(), v = ctx.createGain();
                o.frequency.value = FREQ[i]; o.type = 'sine'; v.gain.value = 0.15;
                o.connect(v); v.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + ms / 1000);
            } catch (e) { /* no audio: the lights are enough */ }
        }
        function light(i, ms) {
            pads[i].classList.add('on'); beep(i, ms);
            timers.push(setTimeout(() => pads[i].classList.remove('on'), ms));
        }
        function paint() { $('sm-score').textContent = String(g.score); $('sm-best').textContent = String(best); }
        function show() {
            busy = true; $('sm-msg').textContent = 'Guarda…';
            const gap = pace(g.seq.length);
            g.seq.forEach((p, k) => timers.push(setTimeout(() => light(p, gap * 0.6), 500 + k * gap)));
            timers.push(setTimeout(() => { busy = false; $('sm-msg').textContent = 'Tocca a te'; }, 500 + g.seq.length * gap));
        }
        function round() { nextRound(g); paint(); show(); }
        function start() { timers.forEach(clearTimeout); timers = []; pads.forEach((p) => p.classList.remove('on')); g = newGame(); paint(); round(); }
        pads.forEach((p, i) => p.addEventListener('click', () => {
            if (busy || g.status !== 'input') return;
            light(i, 180);
            const r = press(g, i);
            if (r === 'lost') {
                if (g.seq.length - 1 > best) { best = g.seq.length - 1; try { localStorage.setItem(KEY, String(best)); } catch (e) { /* private mode */ } }
                g.score = g.seq.length - 1; paint();
                $('sm-msg').textContent = `Sbagliato! Sequenza di ${g.seq.length - 1}. Premi Via per riprovare.`;
            } else if (r === 'round') { paint(); busy = true; $('sm-msg').textContent = 'Bene!'; timers.push(setTimeout(round, 700)); }
        }));
        document.addEventListener('keydown', (e) => { const i = { '1': 0, '2': 1, '3': 2, '4': 3 }[e.key]; if (i !== undefined) pads[i].click(); });
        $('sm-start').addEventListener('click', start);
        $('sm-sound').addEventListener('click', (e) => { sound = !sound; e.currentTarget.setAttribute('aria-pressed', String(sound)); });
        document.addEventListener('visibilitychange', () => { if (document.hidden) { timers.forEach(clearTimeout); timers = []; busy = false; if (g.status === 'input') $('sm-msg').textContent = 'In pausa. Premi Via per ricominciare.'; g.status = 'idle'; } });
        paint();
    });
})(typeof window !== 'undefined' ? window : globalThis);
