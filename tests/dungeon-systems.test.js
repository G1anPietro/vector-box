// tests/dungeon-systems.test.js — Il Dungeon del Server, systems layer: diagonal moves, sleep, terrain hazards, crafting, elites
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const dir = path.join(__dirname, '..', 'public', 'js', 'rogue');
const MAP = require(path.join(dir, 'map.js')), MOBS = require(path.join(dir, 'mobs.js')), G = require(path.join(dir, 'game.js'));
const W = MAP.W, T = MAP.T;
const idx = (x, y) => y * W + x;

/** A state on an empty arena: everything is wall except the cells in `open` ([x, y] pairs); no monsters, items or traps. */
function arena(open, hero, seed) {
    const s = G.newGame(seed || 5, 'studente');
    s.map.tiles.fill(T.WALL);
    for (const [x, y] of open) s.map.tiles[idx(x, y)] = T.FLOOR;
    s.mobs = []; s.items = []; s.traps = []; s.haz = []; s.shop = null; s.bench = null; s.altar = null; s.sealed = 0;
    s.map.stairs = { x: 1, y: 1 };
    s.p.x = hero[0]; s.p.y = hero[1]; s.p.food = 900;
    s.seen.fill(1);
    G.updateFov(s);
    return s;
}
const room = (x0, y0, x1, y1) => { const o = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) o.push([x, y]); return o; };
const plainMob = () => MOBS.LIST.find((d) => !d.boss && !d.ranged && !d.still && !d.phase && !d.erratic && !d.summon && !d.ambush && !d.invisible && !d.steal && !d.split && !d.blink && !d.coward && !d.explode);
const addMob = (s, x, y, hunt) => { const k = plainMob().id, hp = G.MOB[k].hp; const m = { id: s.nid++, k, x, y, hp, max: hp, asleep: 0, hunt: hunt ? 1 : 0 }; s.mobs.push(m); return m; };

// ── diagonal movement ───────────────────────────────────────────────────────
test('diagonal steps work in the open and are refused around a corner or through a door', () => {
    const s = arena(room(5, 5, 8, 8), [5, 5]);
    assert.equal(G.act(s, { t: 'move', dx: 1, dy: 1 }), true);
    assert.deepEqual([s.p.x, s.p.y], [6, 6]);
    // a wall on one side: the diagonal is refused and costs no turn
    const c = arena([[5, 5], [5, 6], [6, 6]], [5, 5]);
    const turn = c.turn;
    assert.equal(G.act(c, { t: 'move', dx: 1, dy: 1 }), false);
    assert.deepEqual([c.p.x, c.p.y], [5, 5]); assert.equal(c.turn, turn);
    assert.equal(c.log[c.log.length - 1].m.k, 'diag_blocked');
    // doors only straight
    const d = arena(room(5, 5, 7, 7), [5, 5]);
    d.map.tiles[idx(6, 6)] = T.DOOR;
    assert.equal(G.act(d, { t: 'move', dx: 1, dy: 1 }), false, 'into a door');
    d.p.x = 6; d.p.y = 6;
    assert.equal(G.act(d, { t: 'move', dx: 1, dy: 1 }), false, 'out of a door');
    assert.equal(G.act(d, { t: 'move', dx: 1, dy: 0 }), true, 'straight is fine');
});

test('you cannot hit a monster around a corner, and monsters obey the same rule', () => {
    const open = [[5, 5], [5, 6], [6, 6]];
    const s = arena(open, [5, 5]);
    const m = addMob(s, 6, 6, true);
    assert.equal(G.touching(s, m), false);
    assert.equal(G.act(s, { t: 'move', dx: 1, dy: 1 }), false, 'no attack around the corner');
    assert.equal(m.hp, m.max);
    const hp = s.p.hp;
    G.act(s, { t: 'wait' });
    assert.equal(s.p.hp, hp, 'the monster could not hit diagonally either');
    assert.deepEqual([m.x, m.y], [5, 6], 'it walked round to a side');
    const o = arena(room(5, 5, 7, 7), [5, 5]);
    const n = addMob(o, 6, 6, true);
    assert.equal(G.touching(o, n), true);
    assert.equal(G.act(o, { t: 'move', dx: 1, dy: 1 }), true, 'attacks diagonally in the open');
    assert.ok(n.hp < n.max || o.log.some((l) => l.m && l.m.k === 'you_miss'));
});

test('the pathfinder uses diagonals (with the corner rule) and prefers straight steps on ties', () => {
    const s = arena(room(5, 5, 10, 10), [5, 5]);
    assert.equal(G.travelPath(s, 10, 10).length, 5, 'five diagonal steps, not ten straight ones');
    assert.deepEqual(G.travelNext(s, 5, 9), [0, 1], 'straight down');
    // an L-shaped corridor has no diagonal shortcut
    const c = arena([[5, 5], [6, 5], [7, 5], [7, 6], [7, 7]], [5, 5]);
    assert.equal(G.travelPath(c, 7, 7).length, 4);
    for (const [x, y] of room(0, 0, 0, 0)) assert.ok(x === 0 && y === 0);
});

test('the map flood with diag reaches further than without', () => {
    const m = { w: 6, h: 6, tiles: new Array(36).fill(T.FLOOR) };
    const a = MAP.flood(m, [0], (i, t) => MAP.walkable(t)), b = MAP.flood(m, [0], (i, t) => MAP.walkable(t), true);
    assert.equal(a[35], 10); assert.equal(b[35], 5);
});

// ── sleep ───────────────────────────────────────────────────────────────────
test('sleep heals about twice as fast as waiting, uses food at the normal rate and is saved every turn like any action', () => {
    const mk = () => { const s = arena(room(3, 3, 12, 8), [4, 4]); s.p.hp = 5; s.p.maxHp = 200; s.p.lvl = 1; return s; };
    const a = mk(), b = mk();
    for (let i = 0; i < 24; i++) { G.act(a, { t: 'wait' }); G.act(b, { t: 'sleep' }); }
    const gainWait = a.p.hp - 5, gainSleep = b.p.hp - 5;
    assert.ok(gainSleep >= gainWait * 1.8, `sleep ${gainSleep} vs wait ${gainWait}`);
    assert.equal(a.p.food, b.p.food, 'same hunger');
    assert.equal(b.sleeping, 24);
    G.act(b, { t: 'wait' });
    assert.equal(b.sleeping, 0, 'any other action wakes you');
});

test('sleep is refused with an enemy in view, when starving or hungry, and when already healthy', () => {
    const s = arena(room(3, 3, 12, 8), [4, 4]); s.p.hp = 3;
    addMob(s, 9, 5, false); G.updateFov(s);
    assert.equal(G.act(s, { t: 'sleep' }), false);
    assert.equal(s.log[s.log.length - 1].m.k, 'sleep_enemy');
    const h = arena(room(3, 3, 12, 8), [4, 4]); h.p.hp = 3; h.p.food = 100;
    assert.equal(G.act(h, { t: 'sleep' }), false); assert.equal(h.log[h.log.length - 1].m.k, 'sleep_hungry');
    h.p.food = 0; G.act(h, { t: 'sleep' }); assert.equal(h.log[h.log.length - 1].m.k, 'sleep_starving');
    const f = arena(room(3, 3, 12, 8), [4, 4]);
    assert.equal(G.act(f, { t: 'sleep' }), false); assert.equal(f.log[f.log.length - 1].m.k, 'sleep_full');
});

test('sleep ends when a monster comes into view, when you are hurt, when hunger comes, when healthy and at the cap of 100 turns', () => {
    const last = (s) => s.log[s.log.length - 1].m;
    const corridor = [].concat(room(2, 5, 30, 5));
    const a = arena(corridor, [2, 5]); a.p.hp = 3; a.p.maxHp = 10000;
    const mob = addMob(a, 30, 5, true);
    const n = G.sleepRun(a);
    assert.equal(a.sleeping, 0); assert.equal(last(a).k, 'sleep_wake_mob'); assert.equal(last(a).p.mob, mob.k);
    assert.ok(n > 3 && n < 100, 'woke up when it showed up, after ' + n);
    assert.ok(G.threats(a).length > 0);
    const h = arena(room(3, 3, 12, 8), [4, 4]); h.p.hp = 3; h.p.maxHp = 100; h.p.st.poison = 5;
    G.sleepRun(h); assert.equal(last(h).k, 'sleep_wake_hurt');
    const g = arena(room(3, 3, 12, 8), [4, 4]); g.p.hp = 3; g.p.maxHp = 10000; g.p.food = 153;
    G.sleepRun(g); assert.equal(last(g).k, 'sleep_wake_hungry'); assert.ok(g.p.food < 150);
    const f = arena(room(3, 3, 12, 8), [4, 4]); f.p.hp = 8; f.p.maxHp = 10;
    G.sleepRun(f); assert.equal(last(f).k, 'sleep_wake_full'); assert.equal(f.p.hp, 10);
    const c = arena(room(3, 3, 12, 8), [4, 4]); c.p.hp = 1; c.p.maxHp = 100000; c.p.food = 1e9;
    const t0 = c.turn; G.sleepRun(c);
    assert.equal(c.turn - t0, G.SLEEP_CAP); assert.equal(last(c).k, 'sleep_wake_cap');
});

test('a sleeping hero is noticed from 2 tiles further, and sleeping is deterministic', () => {
    const mk = () => { const s = arena(room(2, 5, 30, 5), [2, 5]); s.p.hp = 3; s.p.maxHp = 10000; const m = addMob(s, 12, 5, false); m.asleep = 1; return s; };
    // distance 10 = sight 8 + 2: out of sight for a waiting hero, noticed by a sleeping one (it is not in view: see below)
    const w = mk(); assert.equal(w.vis[idx(12, 5)], 0);
    const woke = (sleep) => { let n = 0; for (let i = 0; i < 60; i++) { const s = mk(); s.rng = require(path.join(dir, 'rng.js')).make(i); G.act(s, { t: sleep ? 'sleep' : 'wait' }); for (let k = 0; k < 6; k++) G.act(s, { t: sleep ? 'sleep' : 'wait' }); if (!s.mobs[0].asleep) n++; } return n; };
    assert.equal(woke(false), 0); assert.ok(woke(true) > 0);
    const run = () => { const s = mk(); s.mobs = []; G.sleepRun(s); return G.save(s); };
    assert.equal(run(), run());
});
