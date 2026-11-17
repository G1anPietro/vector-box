// tests/dungeon-hazards.test.js — Il Dungeon del Server: terrain hazards (one per sector), the tile sets, deterministic and never cutting a floor
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { arena, room, addMob, idx, dir, T } = require('./rogue-helpers');
const MAP = require(path.join(dir, 'map.js')), MOBS = require(path.join(dir, 'mobs.js')), G = require(path.join(dir, 'game.js')),
    HZ = require(path.join(dir, 'hazards.js')), TXS = require(path.join(dir, 'text.js'));
const floorAt = (seed, depth) => { const s = G.newGame(seed, 'studente'); s.depth = depth; G.newFloor(s); return s; };

test('every sector has its hazard (or a mix), every hazard kind is handled and has a picture, texts in both languages', () => {
    const SP = require(path.join(dir, 'sprites-tiles.js')).SPR;
    for (const sec of MOBS.SECTORS) assert.ok(HZ.ofSector(sec.id), 'hazard for ' + sec.id);
    assert.equal(new Set(HZ.LIST.map((h) => h.id)).size, HZ.LIST.length);
    for (const h of HZ.LIST) {
        assert.ok(h.name.en && h.name.it && h.info.en && h.info.it, h.id);
        if (h.mix) { for (const id of h.mix) assert.ok(HZ.BY_ID[id] && !HZ.BY_ID[id].mix, h.id + ' mixes ' + id); continue; }
        assert.ok(G.HAZARD_FX[h.kind], 'kind ' + h.kind); assert.ok(SP[h.shape], 'picture ' + h.shape); assert.match(h.col, /^#[0-9a-f]{6}$/);
        if (['shock', 'collapse', 'fire'].includes(h.kind)) assert.ok(h.dmg && h.dmg[0] >= 1 && h.dmg[1] >= h.dmg[0], h.id + ' damage');
    }
    for (const k of ['haz_title', 'haz_desc', 'card_haz_dmg', 'cause_haz', 'haz_poison', 'haz_slide', 'haz_shock', 'haz_push', 'haz_collapse', 'haz_fire', 'haz_lag', 'haz_heat', 'st_burn'])
        assert.ok(TXS.MSG[k] && TXS.MSG[k].en && TXS.MSG[k].it, k);
});

test('hazards are deterministic per seed, never on the spawn, the stairs or anything else, and every sector gets some', () => {
    const per = {};
    for (let seed = 1; seed <= 40; seed++) for (let depth = 1; depth <= 50; depth += 3) {
        const a = floorAt(seed, depth), b = floorAt(seed, depth);
        assert.deepEqual(a.haz, b.haz, 'same seed, same hazards');
        const used = new Set([idx(a.p.x, a.p.y), idx(a.map.stairs.x, a.map.stairs.y), ...a.items.map((e) => idx(e.x, e.y)), ...a.mobs.map((m) => idx(m.x, m.y)), ...a.traps.map((t) => idx(t.x, t.y))]);
        for (const h of a.haz) { assert.ok(!used.has(idx(h.x, h.y)), 'free cell'); assert.equal(a.map.tiles[idx(h.x, h.y)], T.FLOOR); assert.ok(HZ.BY_ID[h.k]); }
        const sec = G.sectorOf(depth).id; per[sec] = (per[sec] || 0) + a.haz.length;
    }
    for (const sec of MOBS.SECTORS) assert.ok(per[sec.id] > 10, sec.id + ' has hazards: ' + per[sec.id]);
    assert.notDeepEqual(floorAt(1, 12).haz, floorAt(2, 12).haz);
});

test('hazards never cut a floor: on 300 seeds per sector the stairs and every cell stay reachable round them, and auto-walk avoids them', () => {
    for (const sec of MOBS.SECTORS) {
        const first = MOBS.SECTORS.indexOf(sec) * MOBS.PER_SECTOR + 1;
        for (let seed = 1; seed <= 300; seed++) {
            const s = floorAt(seed, first + (seed % MOBS.PER_SECTOR)), hz = new Set(s.haz.filter((h) => HZ.BY_ID[h.k].kind !== 'fog').map((h) => idx(h.x, h.y)));
            const from = [idx(s.p.x, s.p.y)];
            const open = MAP.flood(s.map, from, (i, t) => MAP.walkable(t)), round = MAP.flood(s.map, from, (i, t) => MAP.walkable(t) && !hz.has(i));
            assert.ok(round[idx(s.map.stairs.x, s.map.stairs.y)] >= 0, `${sec.id} seed ${seed}: stairs reachable`);
            for (let i = 0; i < open.length; i++) if (open[i] >= 0 && !hz.has(i)) assert.ok(round[i] >= 0, `${sec.id} seed ${seed}: cell ${i} cut off`);
            if (seed % 10 === 0) {
                s.seen.fill(1);
                const walk = G.travelPath(s, s.map.stairs.x, s.map.stairs.y);
                assert.ok(walk.length > 0 && walk.every(([x, y]) => !hz.has(idx(x, y))), `${sec.id} seed ${seed}: the walk goes round the hazards`);
            }
        }
    }
});

test('hazard damage scales mildly with the floor and the access level', () => {
    const cable = HZ.BY_ID.cable;
    assert.deepEqual(HZ.damageRange(cable, 1, 0), [2, 4]);
    assert.deepEqual(HZ.damageRange(cable, 24, 0), [5, 7]);
    assert.deepEqual(HZ.damageRange(cable, 50, 2), [10, 12]);
});

test('each kind of hazard does what its card says', () => {
    const on = (id, extra) => { const s = arena(room(3, 3, 12, 8), [5, 5]); s.haz = [Object.assign({ x: 6, y: 5, k: id }, extra || {})]; s.p.hp = 20; s.p.maxHp = 20; return s; };
    const step = (s) => G.act(s, { t: 'move', dx: 1, dy: 0 });
    let s = on('cable'); step(s); const [a, b] = HZ.damageRange(HZ.BY_ID.cable, 1, 0);
    assert.ok(20 - s.p.hp >= a && 20 - s.p.hp <= b + 1, 'shock ' + (20 - s.p.hp));
    s = on('shelf'); step(s); assert.ok(s.p.hp < 20); assert.equal(s.haz.length, 0, 'the shelf is rubble now');
    s = on('flame'); step(s); assert.ok(s.p.st.burn > 0); const hp = s.p.hp; G.act(s, { t: 'wait' }); assert.ok(s.p.hp < hp, 'burning hurts every turn');
    s = on('lag'); step(s); const t0 = s.turn; G.act(s, { t: 'move', dx: 1, dy: 0 }); assert.equal(s.p.x, 6, 'the next turn is lost'); assert.equal(s.turn, t0 + 1); G.act(s, { t: 'move', dx: 1, dy: 0 }); assert.equal(s.p.x, 7);
    s = on('heat'); const food = s.p.food; step(s); assert.ok(s.p.food <= food - 60);
    s = on('spill'); step(s); assert.ok(s.p.st.poison > 0 || s.p.hp < 20);
    s = on('stream', { d: [1, 0] }); step(s); assert.equal(s.p.x, 7, 'pushed one tile along the arrow');
    s = on('stream', { d: [-1, 0] }); step(s); assert.equal(s.p.x, 6, 'walking against the stream: no push');
    s = on('frost'); step(s); assert.equal(s.p.x, 7, 'slid one more tile');
    s = on('fog'); const m = addMob(s, 6, 3, false); s.haz.push({ x: 8, y: 7, k: 'fog' }); const far = addMob(s, 8, 7, false); G.updateFov(s);
    assert.equal(G.shown(s, far), false, 'hidden in the fog'); assert.equal(G.shown(s, m), true);
    s.p.x = 7; s.p.y = 6; G.updateFov(s); assert.equal(G.shown(s, far), true, 'visible when you are next to it');
    s = on('cable'); s.p.hp = 1; step(s); assert.equal(s.status, 'dead');
    assert.equal(G.text(s.cause, 'en'), 'Live Cable'); assert.equal(G.text(s.cause, 'it'), 'Cavo scoperto');
    s = on('cable'); s.seen.fill(1);
    const card = G.intentForTap(s, 6, 5, 'long');
    assert.equal(G.text(card.title, 'en'), 'Live Cable'); assert.match(card.lines.map((l) => G.text(l, 'it')).join(' '), /Danno: 2-4/);
});

test('a saved run from before hazards still loads and plays', () => {
    const s = G.newGame(9, 'studente'); delete s.haz;
    const back = G.load(G.save(s)); assert.deepEqual(back.haz, []);
    const v = G.exploreNext(back); assert.equal(typeof G.act(back, { t: 'move', dx: v[0], dy: v[1] }), 'boolean');
});

test('the tile sets: every sector has its own floor, wall and door pictures', () => {
    const TL = require(path.join(dir, 'sprites-tiles.js'));
    const sig = new Set();
    for (const sec of MOBS.SECTORS) {
        const set = TL.SETS[sec.id];
        assert.ok(set && set.floor.length === 2 && set.wall.length === 8 && set.floor.every((f) => f.length === 8 && f.every((r) => r.length === 8)) && set.wall.every((r) => r.length === 8), sec.id);
        assert.ok(/^#[0-9a-f]{6}$/.test(set.a) && /^#[0-9a-f]{6}$/.test(set.b), sec.id + ' accents');
        sig.add(JSON.stringify([set.floor, set.wall]));
    }
    assert.equal(sig.size, MOBS.SECTORS.length, 'no two sectors share a pattern');
});
