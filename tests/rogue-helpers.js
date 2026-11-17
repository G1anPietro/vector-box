// tests/rogue-helpers.js — small arenas for the Dungeon tests (not a test file: node --test only runs *.test.js here)
'use strict';
const path = require('path');
const dir = path.join(__dirname, '..', 'public', 'js', 'rogue');
const MAP = require(path.join(dir, 'map.js')), MOBS = require(path.join(dir, 'mobs.js')), G = require(path.join(dir, 'game.js'));
const W = MAP.W, T = MAP.T;
const idx = (x, y) => y * W + x;

/** A state on an empty arena: everything is wall except the cells in `open` ([x, y] pairs); no monsters, items, traps or hazards. */
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
const addMob = (s, x, y, hunt, k) => { k = k || plainMob().id; const hp = G.MOB[k].hp; const m = { id: s.nid++, k, x, y, hp, max: hp, asleep: 0, hunt: hunt ? 1 : 0 }; s.mobs.push(m); return m; };
module.exports = { arena, room, plainMob, addMob, idx, W, T, dir };
