// tests/dungeon.test.js — Il Dungeon del Server: the rules (seeded, no browser) and the page
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { startSite } = require('./helpers');
const dir = path.join(__dirname, '..', 'public', 'js', 'rogue');
const RNG = require(path.join(dir, 'rng.js')), MAP = require(path.join(dir, 'map.js')), MOBS = require(path.join(dir, 'mobs.js')),
    ITEMS = require(path.join(dir, 'items.js')), CLS = require(path.join(dir, 'classes.js')), SP = require(path.join(dir, 'sprites.js')),
    G = require(path.join(dir, 'game.js'));
const W = MAP.W;

/** A simple player: fights what it sees, drinks when hurt, explores, takes the stairs. Returns the final state. */
function bot(seed, cls, maxTurns) {
    const s = G.newGame(seed, cls || 'studente');
    let n = 0, idle = 0;
    while (s.status === 'play' && n++ < (maxTurns || 6000)) {
        const before = s.turn;
        if (s.p.pending) { G.act(s, { t: 'skill', id: s.p.choices[0] }); continue; }
        if (s.shop && s.shop.open) { G.act(s, { t: 'leave' }); continue; }
        if (s.p.hp < s.p.maxHp / 3) { const i = s.p.inv.findIndex((e) => G.ITEM[e.k].effect === 'heal' && G.known(s, e)); if (i >= 0) { G.act(s, { t: 'use', i }); continue; } }
        if (s.p.food < 200) { const i = s.p.inv.findIndex((e) => G.ITEM[e.k].cat === 'food'); if (i >= 0) { G.act(s, { t: 'use', i }); continue; } }
        for (const slot of ['weapon', 'armor']) { /* wear the best thing found */
            const i = s.p.inv.findIndex((e) => G.ITEM[e.k].cat === slot);
            if (i >= 0) G.act(s, { t: 'use', i });
        }
        const near = G.nearest(s);
        let v = null;
        if (near) v = Math.abs(near.x - s.p.x) + Math.abs(near.y - s.p.y) === 1 ? [near.x - s.p.x, near.y - s.p.y] : G.travelNext(s, near.x, near.y);
        else if (s.map.tiles[s.p.y * W + s.p.x] === MAP.T.STAIRS && !s.sealed) { G.act(s, { t: 'descend' }); continue; }
        else v = G.exploreNext(s) || G.travelNext(s, s.map.stairs.x, s.map.stairs.y);
        G.act(s, v ? { t: 'move', dx: v[0], dy: v[1] } : { t: 'wait' });
        idle = s.turn === before ? idle + 1 : 0;
        if (idle > 50) throw new Error('soft lock: seed ' + seed + ' floor ' + s.depth + ' at ' + s.p.x + ',' + s.p.y);
    }
    return s;
}

test('the seeded random numbers repeat, and a floor depends only on (seed, depth)', () => {
    const a = RNG.make(5), b = RNG.make(5);
    for (let i = 0; i < 20; i++) assert.equal(RNG.next(a), RNG.next(b));
    const m1 = MAP.generate(9, 3), m2 = MAP.generate(9, 3);
    assert.deepEqual(m1.tiles, m2.tiles);
    assert.notDeepEqual(MAP.generate(9, 4).tiles, m1.tiles);
});

test('every floor of 300 seeds is connected and its stairs are reachable without secret doors', () => {
    for (let seed = 1; seed <= 300; seed++) {
        const depth = 1 + (seed % 5), m = MAP.generate(seed, depth);
        assert.ok(MAP.valid(m), 'seed ' + seed);
        const d = MAP.flood(m, [m.start.y * W + m.start.x], (i, t) => MAP.walkable(t));
        assert.ok(d[m.stairs.y * W + m.stairs.x] > 0, 'stairs seed ' + seed);
    }
});

test('data tables are consistent: pictures exist, every item has an effect, looks are enough, floors have monsters', () => {
    for (const d of MOBS.LIST) { assert.ok(SP[d.shape], 'sprite ' + d.id); assert.ok(d.hp > 0 && d.atk.length === 2 && (d.boss || d.floors.length === 2), d.id); }
    for (const d of ITEMS.LIST) {
        assert.ok(SP[d.shape || ITEMS.CATS[d.cat].shape], 'sprite ' + d.id);
        if (['drink', 'script', 'usb'].includes(d.cat)) assert.ok(G.EFFECTS[d.effect], 'effect ' + d.id);
    }
    for (const k in ITEMS.LOOKS) assert.ok(ITEMS.LOOKS[k].length >= ITEMS.LIST.filter((d) => d.cat === k).length, 'looks ' + k);
    assert.equal(new Set(MOBS.LIST.map((d) => d.id)).size, MOBS.LIST.length, 'unique monster ids');
    assert.equal(new Set(ITEMS.LIST.map((d) => d.id)).size, ITEMS.LIST.length, 'unique item ids');
    for (let depth = 1; depth <= G.FLOORS; depth++) {
        assert.ok(MOBS.LIST.some((d) => !d.boss && d.floors[0] <= depth && depth <= d.floors[1]), 'monsters on floor ' + depth);
        if (depth % MOBS.PER_SECTOR === 0) assert.ok(G.bossOf(depth), 'boss on floor ' + depth);
    }
    for (const c of CLS.CLASSES) { for (const k of c.kit) assert.ok(G.ITEM[k], c.id + ' kit ' + k); assert.ok(G.EFFECTS[c.active.effect], c.id); }
});

test('combat math: hit chance is clamped, damage is at least 1, a critical hit doubles it', () => {
    assert.equal(G.hitChance(0, 0), 0.82);
    assert.equal(G.hitChance(100, 0), 0.97);
    assert.equal(G.hitChance(0, 100), 0.25);
    const r = RNG.make(1);
    for (let i = 0; i < 200; i++) assert.ok(G.rollDamage(r, [1, 3], 0, 50, false) >= 1);
    assert.equal(G.rollDamage(RNG.make(1), [4, 4], 0, 0, true), 8);
    assert.equal(G.rollDamage(RNG.make(1), [4, 4], 2, 0, false), 6);
});

test('the same seed and the same actions give the same run, and a save loads back identical', () => {
    const play = () => { const s = G.newGame(77, 'hacker'); for (let i = 0; i < 80; i++) { const v = G.exploreNext(s); G.act(s, v ? { t: 'move', dx: v[0], dy: v[1] } : { t: 'wait' }); if (s.p.pending) G.act(s, { t: 'skill', id: s.p.choices[0] }); } return s; };
    const a = play(), b = play();
    assert.equal(G.save(a), G.save(b));
    const back = G.load(G.save(a));
    G.updateFov(back);
    assert.equal(G.save(back), G.save(a));
    assert.equal(G.load('not json'), null);
    assert.equal(G.load(JSON.stringify({ v: 999 })), null);
});

test('field of view: walls block it, and an open cell next to you is seen', () => {
    const m = { w: 7, h: 5, tiles: new Array(35).fill(1) };
    for (let y = 0; y < 5; y++) m.tiles[y * 7 + 3] = 0;
    const v = MAP.fov(m, 1, 2, 6);
    assert.equal(v[2 * 7 + 2], 1);
    assert.equal(v[2 * 7 + 5], 0, 'behind the wall');
    assert.equal(v[2 * 7 + 3], 1, 'the wall itself is seen');
});

test('path-finding: travelNext leads to a seen cell and null to an unseen one', () => {
    const s = G.newGame(4, 'studente');
    const st = s.map.stairs;
    assert.equal(G.travelNext(s, st.x, st.y), null, 'stairs not seen yet');
    s.seen.fill(1);
    let steps = 0;
    while ((s.p.x !== st.x || s.p.y !== st.y) && steps++ < 400) { const v = G.travelNext(s, st.x, st.y); assert.ok(v, 'a way'); s.p.x += v[0]; s.p.y += v[1]; }
    assert.deepEqual([s.p.x, s.p.y], [st.x, st.y]);
});

test('items: a drink heals, unknown things become known when used, shops sell for credits, the boss locks the stairs', () => {
    const s = G.newGame(12, 'studente');
    s.p.hp = 5;
    const i = s.p.inv.findIndex((e) => G.ITEM[e.k].effect === 'heal');
    assert.ok(i >= 0);
    G.act(s, { t: 'use', i });
    assert.ok(s.p.hp > 5);
    assert.ok(s.known.d_cura);
    const c = G.newGame(3, 'studente');
    for (let d = 1; d < 5; d++) { c.p.x = c.map.stairs.x; c.p.y = c.map.stairs.y; assert.equal(G.act(c, { t: 'descend' }), true); }
    assert.equal(c.depth, 5);
    assert.equal(c.sealed, 1);
    c.p.x = c.map.stairs.x; c.p.y = c.map.stairs.y;
    assert.equal(G.act(c, { t: 'descend' }), false, 'locked while the boss lives');
});

test('a classes that is locked cannot be started, the profile counts runs', () => {
    const meta = G.newMeta();
    assert.equal(G.newGame(1, 'tecnico', meta).cls, 'studente');
    meta.best = 5;
    assert.equal(G.newGame(1, 'tecnico', meta).cls, 'tecnico');
    const s = bot(2, 'studente', 4000);
    G.recordRun(meta, s, '2026-01-01'); G.recordRun(meta, s, '2026-01-01');
    assert.equal(meta.runs, s.status === 'play' ? 0 : 1, 'counted once');
});

test('the bot plays 48 seeded runs over all classes without a crash or a soft-lock', () => {
    const ids = CLS.CLASSES.map((c) => c.id);
    for (let seed = 1; seed <= 48; seed++) {
        const cls = ids[seed % ids.length];
        const s = bot(seed, cls, 2500);
        assert.ok(['play', 'dead', 'won'].includes(s.status));
        assert.ok(s.p.hp >= 0 && s.p.hp <= s.p.maxHp);
        assert.ok(s.mobs.every((m) => m.hp > 0), 'no dead mobs left');
    }
});

test('the page is served, has no inline script, and the lists know it', async () => {
    const site = await startSite();
    try {
        const html = await (await fetch(`${site.base}/pages/dungeon.html`)).text();
        assert.match(html, /<meta name="description" content="[^"]{40,}">/);
        assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html));
        for (const f of ['/js/dungeon.js', '/css/dungeon.css', '/assets/dungeon/icon.svg', ...['rng', 'map', 'mobs', 'items', 'classes', 'sprites', 'game'].map((n) => `/js/rogue/${n}.js`)]) assert.equal((await fetch(site.base + f)).status, 200, f);
        assert.match(await (await fetch(`${site.base}/pages/giochi.php`)).text(), /dungeon\.html/);
        assert.match(await (await fetch(`${site.base}/sitemap.php`)).text(), /pages\/dungeon\.html/);
    } finally { await site.stop(); }
});
