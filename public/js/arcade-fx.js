// js/arcade-fx.js — shared by the small games: sound + vibration (OFF by default, one switch for all games), the pause helper and a pausable clock.
// UMD: Node tests require() it; in the browser it is a plain script (no inline code) and fills <span id="fx-toggle"></span> if the page has one.
(function (root) {
    'use strict';
    const KEY = 'vb_fx';
    // notes: [frequency Hz, length ms, start offset ms, wave]; vib: vibration pattern (ms) used only when the switch is on
    const EFFECTS = {
        click: { notes: [[660, 40, 0]] },
        good: { notes: [[660, 70, 0], [880, 90, 70]] },
        bad: { notes: [[200, 160, 0, 'sawtooth']], vib: [60] },
        win: { notes: [[523, 100, 0], [659, 100, 100], [784, 100, 200], [1047, 220, 300]], vib: [40, 40, 40, 40, 120] },
        lose: { notes: [[392, 140, 0], [330, 140, 140], [262, 140, 280], [196, 300, 420]], vib: [200] },
        line: { notes: [[784, 60, 0], [988, 60, 60], [1175, 100, 120]], vib: [30] },
        boom: { notes: [[110, 300, 0, 'sawtooth'], [70, 300, 60, 'square']], vib: [250] },
        pad0: { notes: [[329.6, 300, 0]] }, pad1: { notes: [[261.6, 300, 0]] }, pad2: { notes: [[392, 300, 0]] }, pad3: { notes: [[523.3, 300, 0]] },
    };

    const parseState = (raw) => raw === '1';
    let on = null, ctx = null;
    const enabled = () => {
        if (on === null) { try { on = parseState(root.localStorage.getItem(KEY)); } catch (e) { on = false; } }   // private mode: off
        return on;
    };
    function setEnabled(v) { on = !!v; try { root.localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) { /* private mode: lasts until the page closes */ } }

    const reduced = () => { try { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } };
    function vibrate(pattern) {
        if (!enabled() || reduced()) return false;
        try { return !!(root.navigator && root.navigator.vibrate && root.navigator.vibrate(pattern)); } catch (e) { return false; }
    }

    /** Plays a named effect; `ms` (optional) sets the length of every note (Simon). Does nothing when the switch is off. Returns true if it played. */
    function play(name, ms) {
        const fx = EFFECTS[name];
        if (!fx || !enabled()) return false;
        if (fx.vib) vibrate(fx.vib);
        try {
            const AC = root.AudioContext || root.webkitAudioContext;
            if (!AC) return false;
            ctx = ctx || new AC();                              // created lazily, from a user gesture
            if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
            for (const [f, len, at, wave] of fx.notes) {
                const t = ctx.currentTime + at / 1000, d = (typeof ms === 'number' ? ms : len) / 1000;
                const o = ctx.createOscillator(), v = ctx.createGain();
                o.type = wave || 'sine'; o.frequency.value = f;
                v.gain.setValueAtTime(0.12, t); v.gain.exponentialRampToValueAtTime(0.001, t + d);
                o.connect(v); v.connect(ctx.destination); o.start(t); o.stop(t + d);
            }
            return true;
        } catch (e) { return false; }                           // no audio: the screen is enough
    }

    /** A clock that can be paused: no time is lost or gained across pause/resume. `now` is injectable for tests. */
    function clock(now) {
        const nowFn = now || Date.now;
        let acc = 0, t0 = 0, state = 'idle';                    // idle | run | pause | done
        const elapsed = () => acc + (state === 'run' ? nowFn() - t0 : 0);
        return {
            get state() { return state; },
            elapsed,
            start() { if (state !== 'idle') return; t0 = nowFn(); state = 'run'; },
            pause() { if (state !== 'run') return; acc = elapsed(); state = 'pause'; },
            resume() { if (state !== 'pause') return; t0 = nowFn(); state = 'run'; },
            stop() { if (state === 'run' || state === 'pause') { acc = elapsed(); state = 'done'; } },
            reset() { acc = 0; t0 = 0; state = 'idle'; },
        };
    }

    const api = { KEY, EFFECTS, parseState, enabled, setEnabled, play, vibrate, clock };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
    root.VBFx = api;

    const T = (k) => (root.VBLang ? root.VBLang.t(k) : k);
    if (root.VBI18N) {
        root.VBI18N.add('it', { fx_label: 'Suoni e vibrazione', pause: 'Pausa', resume: 'Riprendi', paused: 'IN PAUSA' });
        root.VBI18N.add('en', { fx_label: 'Sound and vibration', pause: 'Pause', resume: 'Resume', paused: 'PAUSED' });
    }

    /** Pause for a game: button + P key + automatic when the tab is hidden. The game gives can() (is something running?), onPause(), onResume().
     *  `cover` (the board) gets .ar-paused (hidden: no planning a move). The game must ignore its own input while .paused is true. */
    api.bindPause = function (o) {
        let paused = false;
        const paint = () => {
            o.button.textContent = T(paused ? 'resume' : 'pause');
            o.button.setAttribute('aria-pressed', String(paused));
            if (o.cover) o.cover.classList.toggle('ar-paused', paused);
        };
        const ctl = {
            get paused() { return paused; },
            pause() { if (paused || !o.can()) return; paused = true; o.onPause(); paint(); },
            resume() { if (!paused) return; paused = false; paint(); o.onResume(); },
            reset() { paused = false; paint(); },       // new game: no onResume
        };
        const toggle = () => (paused ? ctl.resume() : ctl.pause());
        document.addEventListener('keydown', (e) => {
            if ((e.key !== 'p' && e.key !== 'P') || e.ctrlKey || e.metaKey || e.altKey) return;
            if (e.target && e.target.closest && e.target.closest('input, select, textarea')) return;
            e.preventDefault(); if (!e.repeat) toggle();
        });
        o.button.addEventListener('click', (e) => { toggle(); e.currentTarget.blur(); });
        document.addEventListener('visibilitychange', () => { if (document.hidden) ctl.pause(); });
        window.addEventListener('vb-lang', paint);
        paint();
        return ctl;
    };

    document.addEventListener('DOMContentLoaded', () => {
        const host = document.getElementById('fx-toggle');
        if (!host) return;
        const b = document.createElement('button');
        b.type = 'button';
        const paint = () => { b.textContent = enabled() ? '\u{1F50A}' : '\u{1F507}'; b.setAttribute('aria-pressed', String(enabled())); b.setAttribute('aria-label', T('fx_label')); b.title = T('fx_label'); };
        b.addEventListener('click', () => { setEnabled(!enabled()); paint(); play('click'); });
        host.append(b); paint();
        window.addEventListener('vb-lang', paint);
    });
})(typeof window !== 'undefined' ? window : globalThis);
