// tests/arcade-fx.test.js — sound/vibration switch (off by default), pausable clock, and the pause + sound wiring of the static games
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'public');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const fxPath = path.join(root, 'js', 'arcade-fx.js');
const fresh = () => { delete require.cache[fxPath]; return require(fxPath); };

function fakeEnv({ stored = null, vibrate = true, reduced = false } = {}) {
    const made = [], vib = [];
    const store = { v: stored };
    globalThis.localStorage = { getItem: () => store.v, setItem: (k, v) => { store.v = v; } };
    globalThis.AudioContext = class {
        constructor() { made.push(this); this.currentTime = 0; this.destination = {}; this.oscs = []; }
        createOscillator() { const o = { frequency: {}, connect() {}, start() {}, stop() {} }; this.oscs.push(o); return o; }
        createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    };
    Object.defineProperty(globalThis, 'navigator', { value: vibrate ? { vibrate: (p) => { vib.push(p); return true; } } : {}, configurable: true });
    globalThis.matchMedia = () => ({ matches: reduced });
    return { made, vib, store };
}
const cleanup = () => { delete globalThis.localStorage; delete globalThis.AudioContext; delete globalThis.matchMedia; };

test('effect table: the named effects exist and every note is sane', () => {
    const { EFFECTS } = fresh();
    for (const n of ['click', 'good', 'bad', 'win', 'lose', 'line', 'boom', 'pad0', 'pad1', 'pad2', 'pad3']) assert.ok(EFFECTS[n], n);
    for (const [n, fx] of Object.entries(EFFECTS)) {
        assert.ok(fx.notes.length > 0, n);
        for (const [f, ms, at] of fx.notes) { assert.ok(f >= 50 && f <= 2000, n + ' freq'); assert.ok(ms > 0 && ms <= 600, n + ' length'); assert.ok(at >= 0 && at < 1000, n + ' offset'); }
        if (fx.vib) assert.ok(fx.vib.every((x) => x > 0 && x <= 300), n + ' vib');
    }
    const pads = [0, 1, 2, 3].map((i) => EFFECTS['pad' + i].notes[0][0]);
    assert.equal(new Set(pads).size, 4, 'the four Simon tones are distinct');
});

test('switch state: only "1" means on; missing/garbage/broken storage means off', () => {
    const { parseState } = fresh();
    assert.equal(parseState('1'), true);
    for (const x of [null, undefined, '', '0', 'true', 'on', '2']) assert.equal(parseState(x), false);
    globalThis.localStorage = { getItem() { throw new Error('private mode'); }, setItem() { throw new Error('private mode'); } };
    const fx = fresh();
    assert.equal(fx.enabled(), false);
    assert.doesNotThrow(() => fx.setEnabled(true));
    assert.equal(fx.enabled(), true, 'still works for this page when storage fails');
    cleanup();
});

test('nothing plays or vibrates when the switch is off (the default)', () => {
    const env = fakeEnv();
    const fx = fresh();
    assert.equal(fx.enabled(), false);
    assert.equal(fx.play('win'), false);
    assert.equal(fx.vibrate([50]), false);
    assert.equal(env.made.length, 0, 'no AudioContext is even created');
    assert.equal(env.vib.length, 0);
    cleanup();
});

test('when on: plays notes (lazily creating one context), vibrates, unknown names are ignored', () => {
    const env = fakeEnv({ stored: '1' });
    const fx = fresh();
    assert.equal(env.made.length, 0);
    assert.equal(fx.play('nope'), false);
    assert.equal(fx.play('win'), true);
    assert.equal(fx.play('pad2', 180), true);
    assert.equal(env.made.length, 1, 'one shared context');
    assert.equal(env.made[0].oscs.length, 4 + 1);
    assert.ok(env.made[0].oscs.some((o) => o.frequency.value === 392));
    assert.deepEqual(env.vib[0], fx.EFFECTS.win.vib);
    fx.setEnabled(false);
    assert.equal(env.store.v, '0');
    assert.equal(fx.play('win'), false);
    cleanup();
});

test('vibration: needs navigator.vibrate and is skipped with prefers-reduced-motion', () => {
    fakeEnv({ stored: '1', vibrate: false });
    assert.equal(fresh().vibrate([30]), false);
    const env = fakeEnv({ stored: '1', reduced: true });
    const fx = fresh();
    assert.equal(fx.vibrate([30]), false);
    assert.equal(fx.play('bad'), true, 'the sound still plays');
    assert.equal(env.vib.length, 0);
    cleanup();
});

test('pausable clock: no time lost or gained across pause/resume; idle and done are stable', () => {
    const { clock } = fresh();
    let t = 1000;
    const c = clock(() => t);
    assert.equal(c.state, 'idle'); assert.equal(c.elapsed(), 0);
    c.pause(); c.resume(); assert.equal(c.state, 'idle', 'nothing to pause before the start');
    c.start(); t += 2500; assert.equal(c.elapsed(), 2500);
    c.pause(); t += 60000; assert.equal(c.elapsed(), 2500, 'frozen while paused');
    c.start(); assert.equal(c.state, 'pause', 'start does not restart a paused clock');
    c.resume(); t += 500; assert.equal(c.elapsed(), 3000);
    c.pause(); c.pause(); c.resume(); c.resume(); t += 1000; assert.equal(c.elapsed(), 4000, 'double calls change nothing');
    c.stop(); t += 9999; assert.equal(c.elapsed(), 4000); assert.equal(c.state, 'done');
    c.resume(); assert.equal(c.state, 'done');
    c.reset(); assert.deepEqual([c.state, c.elapsed()], ['idle', 0]);
});

const PAUSE = { snake: 'sn-pause', memory: 'ar-pause', simon: 'sm-pause', minato: 'mn-pause' };
const SOUND = ['snake', 'memory', 'simon', 'minato', 'dueamila', 'tris', 'forza4', 'impiccato', 'parola', 'tetris'];

test('pause: each timed game has the button, uses bindPause (P key, hidden tab) and mentions P in both help texts', () => {
    const fx = read('js/arcade-fx.js');
    assert.match(fx, /e\.key !== 'p' && e\.key !== 'P'/);
    assert.match(fx, /visibilitychange/);
    assert.match(fx, /aria-pressed/);
    assert.match(fx, /VBI18N\.add\('it'.*fx_label: 'Suoni e vibrazione', pause: 'Pausa', resume: 'Riprendi'/);
    assert.match(fx, /VBI18N\.add\('en'.*fx_label: 'Sound and vibration', pause: 'Pause', resume: 'Resume'/);
    for (const [g, id] of Object.entries(PAUSE)) {
        const html = read('pages/' + g + '.html'), js = read('js/' + g + '.js');
        assert.ok(html.includes('id="' + id + '"') && html.includes('data-i18n="pause"'), g + ': button');
        assert.match(js, new RegExp("VBFx\\.bindPause\\(\\{ button: \\$\\('" + id + "'\\)"), g + ': bindPause');
        assert.match(js, /pz\.paused/, g + ': input ignored while paused');
        assert.match(html, /\bP\b[^<]*paus/i, g + ': help (en) mentions P');
        assert.match(js, /\bP per la pausa/, g + ': help (it) mentions P');
    }
    // the clocks of memory and minato are the pausable clock, not Date.now
    for (const g of ['memory', 'minato']) assert.ok(!/Date\.now/.test(read('js/' + g + '.js')), g + ': no raw Date.now');
    assert.match(read('css/arcade.css'), /\.ar-paused \{ visibility: hidden/);
    assert.match(read('css/minato.css'), /\.ar-paused \{ visibility: hidden/);
});

test('sound: every wired page loads arcade-fx.js with a stamp, has the toggle span and no inline script', () => {
    for (const g of SOUND) {
        const html = read('pages/' + g + '.html'), js = read('js/' + g + '.js');
        assert.match(html, /<script src="\.\.\/js\/arcade-fx\.js\?v=1\d{9}" defer><\/script>/, g);
        assert.ok(html.indexOf('arcade-fx.js') < html.indexOf('js/' + g + '.js'), g + ': loaded before the game');
        assert.ok(html.includes('<span id="fx-toggle"></span>'), g + ': toggle');
        assert.match(js, /VBFx\.play\(/, g + ': plays');
        assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), g + ': no inline scripts');
    }
    // parola: the smallest wiring, every call guarded
    const pa = read('js/parola.js');
    for (const line of pa.split('\n').filter((l) => /VBFx/.test(l))) assert.match(line, /window\.VBFx && VBFx\.play/);
    // simon: four different tones
    assert.match(read('js/simon.js'), /VBFx\.play\('pad' \+ i/);
});
