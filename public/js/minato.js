// js/minato.js — Campo minato. The rules (no DOM) are at the top and can be tested from Node; the page is below.
(function (root) {
    'use strict';

    const LEVELS = { easy: { w: 9, h: 9, mines: 10 }, medium: { w: 16, h: 16, mines: 40 }, hard: { w: 24, h: 16, mines: 70 } };

    function makeRng(seed) {                       // small, seedable: a game can be replayed in a test
        let a = seed >>> 0;
        return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    }

    function neighbors(w, h, i) {
        const x = i % w, y = (i / w) | 0, out = [];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < w && ny < h) out.push(ny * w + nx);
        }
        return out;
    }

    /** The first click never hits a mine, and (when there is room) opens a free area: its cell and neighbours stay clear. */
    function newGame(level, rng) {
        const { w, h, mines } = typeof level === 'string' ? LEVELS[level] : level;
        return { w, h, mines, rng: rng || Math.random, placed: false, bomb: new Uint8Array(w * h), count: new Uint8Array(w * h),
                 open: new Uint8Array(w * h), flag: new Uint8Array(w * h), status: 'ready', opened: 0, flags: 0 };
    }

    function place(g, safe) {
        const total = g.w * g.h;
        const clear = new Set([safe]);
        if (total - 9 >= g.mines) neighbors(g.w, g.h, safe).forEach((n) => clear.add(n));
        const cells = [];
        for (let i = 0; i < total; i++) if (!clear.has(i)) cells.push(i);
        for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(g.rng() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }
        cells.slice(0, g.mines).forEach((c) => { g.bomb[c] = 1; });
        for (let i = 0; i < total; i++) g.count[i] = neighbors(g.w, g.h, i).reduce((n, k) => n + g.bomb[k], 0);
        g.placed = true;
    }

    function win(g) { return g.opened === g.w * g.h - g.mines; }

    /** Opens a cell (and the empty area around a 0). Returns the list of cells opened, [] if nothing happened. */
    function reveal(g, i) {
        if (g.status === 'won' || g.status === 'lost' || g.open[i] || g.flag[i]) return [];
        if (!g.placed) { place(g, i); g.status = 'play'; }
        if (g.bomb[i]) { g.status = 'lost'; g.open[i] = 1; g.boom = i; return [i]; }
        const done = [], stack = [i];
        while (stack.length) {
            const c = stack.pop();
            if (g.open[c] || g.flag[c] || g.bomb[c]) continue;
            g.open[c] = 1; g.opened++; done.push(c);
            if (!g.count[c]) neighbors(g.w, g.h, c).forEach((n) => { if (!g.open[n]) stack.push(n); });
        }
        if (win(g)) g.status = 'won';
        return done;
    }

    function toggleFlag(g, i) {
        if (g.status === 'won' || g.status === 'lost' || g.open[i]) return false;
        g.flag[i] = g.flag[i] ? 0 : 1;
        g.flags += g.flag[i] ? 1 : -1;
        return true;
    }

    /** On an open number whose flags match it: opens all the other neighbours (a wrong flag costs the game, as it should). */
    function chord(g, i) {
        if (!g.open[i] || !g.count[i] || g.status !== 'play') return [];
        const near = neighbors(g.w, g.h, i);
        if (near.filter((n) => g.flag[n]).length !== g.count[i]) return [];
        let all = [];
        near.forEach((n) => { if (!g.flag[n] && !g.open[n]) all = all.concat(reveal(g, n)); });
        return all;
    }

    const api = { LEVELS, makeRng, neighbors, newGame, reveal, toggleFlag, chord, win };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
    root.Minato = api;

    // ------------------------------ the page ------------------------------
    document.addEventListener('DOMContentLoaded', () => {
        const $ = (id) => document.getElementById(id);
        const board = $('mn-board');
        if (!board) return;
        const KEY = 'vb_minato_best';
        let level = 'easy', g = null, cells = [], flagMode = false, t0 = 0, timer = null, cursor = 0;
        const best = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } })();
        const saveBest = () => { try { localStorage.setItem(KEY, JSON.stringify(best)); } catch (e) { /* private mode */ } };
        const secs = () => (t0 ? Math.min(999, Math.floor((Date.now() - t0) / 1000)) : 0);

        function paintHead() {
            $('mn-mines').textContent = String(Math.max(-99, g.mines - g.flags)).padStart(3, '0');
            $('mn-time').textContent = String(secs()).padStart(3, '0');
            $('mn-best').textContent = best[level] ? best[level] + ' s' : '—';
            $('mn-face').textContent = g.status === 'won' ? '😎' : g.status === 'lost' ? '💥' : '🙂';
            $('mn-flag').setAttribute('aria-pressed', String(flagMode));
        }

        function paintCell(i) {
            const el = cells[i];
            let txt = '', cls = 'cell';
            if (g.open[i]) {
                cls += ' open';
                if (g.bomb[i]) { txt = '💣'; if (i === g.boom) cls += ' boom'; }
                else if (g.count[i]) { txt = String(g.count[i]); cls += ' n' + g.count[i]; }
            } else if (g.flag[i]) { txt = '🚩'; cls += ' flag'; if (g.status === 'lost' && !g.bomb[i]) { txt = '❌'; } }
            else if (g.status === 'lost' && g.bomb[i]) { txt = '💣'; cls += ' open'; }
            el.className = cls + (i === cursor ? ' cur' : '');
            el.textContent = txt;
            el.setAttribute('aria-label', g.open[i] ? (g.bomb[i] ? 'mina' : g.count[i] ? g.count[i] + ' mine vicine' : 'vuota') : g.flag[i] ? 'bandiera' : 'coperta');
        }

        function paintAll() { for (let i = 0; i < cells.length; i++) paintCell(i); paintHead(); }

        function finish() {
            clearInterval(timer); timer = null;
            if (g.status === 'won') {
                const s = secs();
                if (!best[level] || s < best[level]) { best[level] = s; saveBest(); }
                $('mn-msg').textContent = `Hai vinto in ${s} secondi!`;
            } else if (g.status === 'lost') {
                $('mn-msg').textContent = 'Boom. Riprova con la faccina.';
            }
        }

        function after() {
            if (g.status === 'play' && !timer) { t0 = Date.now(); timer = setInterval(paintHead, 500); }
            paintAll();
            if (g.status === 'won' || g.status === 'lost') finish();
        }

        function act(i, secondary) {
            if (g.status === 'won' || g.status === 'lost') return;
            if (secondary || flagMode) toggleFlag(g, i);
            else if (g.open[i]) chord(g, i);
            else reveal(g, i);
            after();
        }

        function start(lv) {
            level = lv in LEVELS ? lv : 'easy';
            clearInterval(timer); timer = null; t0 = 0; cursor = 0;
            g = newGame(level);
            board.style.setProperty('--cols', String(g.w));
            board.replaceChildren();
            cells = [];
            for (let i = 0; i < g.w * g.h; i++) {
                const b = document.createElement('button');
                b.type = 'button'; b.tabIndex = -1; b.dataset.i = String(i);
                board.append(b); cells.push(b);
            }
            document.querySelectorAll('[data-level]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.level === level)));
            $('mn-msg').textContent = '';
            paintAll();
        }

        // click, right click, long press (a phone has no right button) and the flag switch
        let press = null;
        board.addEventListener('contextmenu', (e) => { e.preventDefault(); const c = e.target.closest('button'); if (c) act(+c.dataset.i, true); });
        board.addEventListener('pointerdown', (e) => {
            const c = e.target.closest('button'); if (!c || e.pointerType === 'mouse') return;
            press = { c, long: false, timer: setTimeout(() => { press.long = true; act(+c.dataset.i, true); if (navigator.vibrate) navigator.vibrate(20); }, 420) };
        });
        const endPress = () => { if (press) clearTimeout(press.timer); };
        board.addEventListener('pointerup', endPress); board.addEventListener('pointercancel', endPress); board.addEventListener('pointerleave', endPress);
        board.addEventListener('click', (e) => {
            const c = e.target.closest('button'); if (!c) return;
            if (press && press.long) { press = null; return; }
            press = null; cursor = +c.dataset.i; act(cursor, false);
        });
        // the keyboard: arrows move, Space/Enter open, F flags
        board.tabIndex = 0;
        board.addEventListener('keydown', (e) => {
            const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -g.w, ArrowDown: g.w }[e.key];
            if (d) {
                e.preventDefault();
                const nx = cursor % g.w + (e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0);
                const ny = ((cursor / g.w) | 0) + (e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0);
                if (nx >= 0 && ny >= 0 && nx < g.w && ny < g.h) { const old = cursor; cursor = ny * g.w + nx; paintCell(old); paintCell(cursor); }
            } else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); act(cursor, false); }
            else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); act(cursor, true); }
        });
        $('mn-face').addEventListener('click', () => start(level));
        $('mn-flag').addEventListener('click', () => { flagMode = !flagMode; paintHead(); });
        document.querySelectorAll('[data-level]').forEach((b) => b.addEventListener('click', () => start(b.dataset.level)));
        start('easy');
    });
})(typeof window !== 'undefined' ? window : globalThis);
