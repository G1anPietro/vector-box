// Sprites of the Server Dungeon: every drawing is 16x16 with only defined characters, every key the data uses resolves, heroes and monsters have two idle frames,
// the cache is bounded. Run: node --test tests/sprites.test.js
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const dir = path.join(__dirname, '..', 'public', 'js', 'rogue');
const A = require(path.join(dir, 'sprites-art.js'));
for (const f of ['heroes', 'mobs', 'bosses', 'mobs2', 'items', 'items2', 'items3']) require(path.join(dir, `sprites-art-${f}.js`));
const MOBS = require(path.join(dir, 'mobs.js')), ITEMS = require(path.join(dir, 'items.js')), CLS = require(path.join(dir, 'classes.js')), SP = require(path.join(dir, 'sprites.js'));
const ROLES = new Set('osblaewnNhHkgGyrtpc'.split(''));

test('every drawing is 16 rows of 16 characters, all of them defined', () => {
    assert.ok(A.keys().length > 40);
    for (const k of A.keys()) {
        const d = A.def(k), own = Object.keys(d.p || {});
        assert.equal(d.r.length, 16, k + ' rows');
        d.r.forEach((row, y) => {
            assert.equal(row.length, 16, `${k} row ${y} is ${row.length} wide`);
            for (const ch of row) assert.ok(ch === '.' || ROLES.has(ch) || own.includes(ch), `${k} row ${y}: undefined character '${ch}'`);
        });
        for (const [y, x, c] of d.f2 || []) assert.ok(y >= 0 && y < 16 && x >= 0 && x < 16 && (c === '.' || ROLES.has(c) || own.includes(c)), k + ' f2');
        for (const v of Object.values(d.p || {})) assert.ok(/^#[0-9a-f]{6}$/i.test(v) || 'osblaew'.includes(v), k + ' palette ' + v);
        assert.ok(d.r.some((r) => /[^.]/.test(r)), k + ' is empty');
    }
});

test('ramps: four distinct tones from any tint', () => {
    for (const col of ['#00ff66', '#ffb000', '#6a6a7a', '#ffffff', '#2a3a30']) {
        const r = A.ramp(col);
        assert.equal(new Set([r.o, r.s, r.b, r.l]).size, 4, col);
    }
});

test('every key of mobs.js, items.js and classes.js resolves to something drawable', () => {
    const miss = [];
    const check = (label, name) => { const r = A.resolve(name); if (r.kind === 'missing' || !A.pixels(name, '#8fa3b8', 0).some(Boolean)) miss.push(label); };
    for (const d of MOBS.LIST) check(d.id, A.chain(d, 'm'));
    for (const d of ITEMS.LIST) check(d.id, A.chain(Object.assign({}, d, { shape: d.shape || ITEMS.CATS[d.cat].shape }), 'i'));
    for (const k of Object.keys(ITEMS.CATS)) check('cat ' + k, ITEMS.CATS[k].shape);
    for (const c of CLS.CLASSES) check('class ' + c.id, A.chain(c, 'h'));
    for (const k of Object.keys(SP)) check('legacy ' + k, k);
    assert.deepEqual(miss, []);
});

test('fallback chain: exact key, then archetype, then the generic drawing', () => {
    assert.equal(A.resolve('m:nonesiste>bug>m:generic').key, 'bug');
    assert.equal(A.resolve('nope>nada>m:generic').key, 'm:generic');
    assert.equal(A.resolve('i:nonesiste>nulla>i:generic').key, 'i:generic');
    assert.equal(A.resolve('assolutamente niente').kind, 'missing');
    assert.ok(A.pixels('assolutamente niente', '#fff', 0).some(Boolean), 'even a missing key draws a marker');
    assert.equal(A.chain({ id: 'x', sprite: 'drago', archetype: 'bat', shape: 'bug' }, 'm'), 'drago>m:x>bat>bug>m:generic');
});

test('every hero and every monster has two different idle frames', () => {
    const same = [];
    const names = [...CLS.CLASSES.map((c) => A.chain(c, 'h')), ...MOBS.LIST.map((d) => A.chain(d, 'm'))];
    for (const n of names) { const a = A.pixels(n, '#8fa3b8', 0), b = A.pixels(n, '#8fa3b8', 1); if (a.join() === b.join()) same.push(n); }
    assert.deepEqual(same, []);
});

test('the old 8x8 pictures still draw, at 16x16', () => {
    for (const k of Object.keys(SP)) assert.equal(A.pixels(k, '#8fa3b8', 0).length, 256, k);
});

test('the sprite cache is bounded (needs a DOM-less fake canvas)', () => {
    const made = [];
    global.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillRect() {} }), made: made.push(1) }) };
    try {
        for (let i = 0; i < A.CACHE_MAX * 3; i++) A.sprite('bug', '#' + (0x100000 + i * 7).toString(16).padStart(6, '0'), 0);
        assert.ok(A.cacheSize() <= A.CACHE_MAX, 'cache size ' + A.cacheSize());
        A.sprite('bug', '#123456', 0); const n = made.length; A.sprite('bug', '#123456', 0);
        assert.equal(made.length, n, 'a repeated sprite is not painted again');
    } finally { delete global.document; }
});

// ── own drawings: every `sprite` key declared in the data has its own picture (no archetype / generic fallback) ──
const hash = (n) => A.pixels(n, '#8fa3b8', 0).join('|');
test('every monster with a `sprite` key has its own drawing, distinct from all others, with a different second frame', () => {
    const own = MOBS.LIST.filter((d) => d.sprite), noArt = [], seen = new Map(), twins = [], still = [];
    assert.ok(own.length >= 39, 'new monsters: ' + own.length);
    for (const d of own) {
        if (!A.def(d.sprite)) { noArt.push(d.id + ' -> ' + A.resolve(A.chain(d, 'm')).key); continue; }
        const h = hash(d.sprite);
        if (seen.has(h)) twins.push(d.id + ' = ' + seen.get(h)); else seen.set(h, d.id);
        if (A.pixels(d.sprite, '#8fa3b8', 0).join() === A.pixels(d.sprite, '#8fa3b8', 1).join()) still.push(d.id);
    }
    assert.deepEqual(noArt, []); assert.deepEqual(twins, []); assert.deepEqual(still, []);
    // the 10 mini-bosses and the 2 alternative bosses fill more of the box than the regular newcomers
    const fill = (n) => A.pixels(n, '#8fa3b8', 0).filter(Boolean).length;
    const avg = (l) => l.reduce((a, d) => a + fill(d.sprite), 0) / l.length;
    const big = own.filter((d) => d.boss || /^mini\d+$/.test(d.id));
    assert.equal(big.length, 12);
    assert.ok(avg(big) > avg(own.filter((d) => !big.includes(d))), 'mini-bosses and alternative bosses are bigger');
});

// every item (by category) whose `sprite` key is declared has its own drawing, and no two in the same family are identical.
// Only the categories listed here are finished; an unfinished one keeps its category icon (the fallback chain), see docs/ROGUELIKE.md.
const DRAWN = ['weapon', 'throw', 'armor', 'food'];
test('items of the drawn categories have their own, mutually different drawings', () => {
    const noArt = [], twins = [], seen = new Map();
    for (const d of ITEMS.LIST) {
        if (!d.sprite || !DRAWN.includes(d.cat)) continue;
        if (!A.def(d.sprite)) { noArt.push(d.id); continue; }
        const key = d.cat + hash(d.sprite);
        if (seen.has(key)) twins.push(d.id + ' = ' + seen.get(key)); else seen.set(key, d.id);
    }
    assert.deepEqual(noArt, []); assert.deepEqual(twins, []);
    assert.ok(seen.size >= 60, 'drawn items: ' + seen.size);
});
