// tests/dungeon-crafting.test.js — Il Dungeon del Server: crafting recipes at the bench, elites (mini-bosses), behaviour hooks
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { arena, room, addMob, idx, dir, T } = require('./rogue-helpers');
const MAP = require(path.join(dir, 'map.js')), MOBS = require(path.join(dir, 'mobs.js')), ITEMS = require(path.join(dir, 'items.js')), G = require(path.join(dir, 'game.js')),
    RC = require(path.join(dir, 'recipes.js')), TXS = require(path.join(dir, 'text.js'));
const ph = (t) => (String(t).match(/\{\w+\}/g) || []).sort().join(',');

function hub(inv) {
    const s = G.newGame(3, 'studente'); s.depth = 5; s.sealed = 0; G.enterHub(s);
    s.p.inv = inv; s.bench.open = 1;
    return s;
}
const count = (s, k) => s.p.inv.filter((it) => it.k === k).reduce((a, it) => a + (it.n || 1), 0);

test('recipes are valid: unique ids, 2-3 inputs that exist, outputs that exist, no duplicate inputs, both languages', () => {
    const seen = new Set();
    assert.ok(RC.RECIPES.length >= 6);
    for (const r of RC.RECIPES) {
        assert.ok(!seen.has(r.id), 'unique ' + r.id); seen.add(r.id);
        assert.ok(r.name.en && r.name.it, r.id + ' name');
        assert.ok(r.in.length >= 2 && r.in.length <= 3, r.id + ' has 2 or 3 inputs');
        for (const m of r.in) assert.ok(m.startsWith('cat:') ? ITEMS.CATS[m.slice(4)] : G.ITEM[m], r.id + ' input ' + m);
        if (r.out.fn) assert.equal(typeof r.out.fn, 'string'); else for (const g of r.out.give) assert.ok(G.ITEM[g.k || g], r.id + ' output');
        // a recipe's own inputs find that recipe (and no other)
        const ks = r.in.map((m) => (m.startsWith('cat:') ? ITEMS.LIST.find((d) => d.cat === m.slice(4)).id : m));
        assert.equal(G.recipeFor(ks).id, r.id, r.id + ' is found by its inputs');
        assert.equal(G.recipeFor(ks.slice().reverse()).id, r.id, r.id + ' in any order');
    }
    const key = (r) => r.in.slice().sort().join('+');
    assert.equal(new Set(RC.RECIPES.map(key)).size, RC.RECIPES.length, 'no two recipes with the same inputs');
    for (const it of RC.ITEMS) { assert.ok(G.ITEM[it.id], it.id); assert.ok(it.name.en && it.name.it && it.info.en && it.info.it, it.id + ' texts'); }
    for (const k of ['bench_craft', 'craft_title', 'craft_hint', 'craft_bag', 'craft_add', 'craft_do', 'craft_clear', 'craft_back', 'craft_none', 'craft_ok', 'craft_new', 'craft_item_hint', 'craft_book',
        'craft_book_empty', 'craft_use', 'craft_fn_recharge', 'book_read', 'floor_elite', 'elite_slain', 'card_mob_elite', 'craft_empty_slot']) {
        assert.ok(TXS.MSG[k] && TXS.MSG[k].en && TXS.MSG[k].it, k); assert.equal(ph(TXS.MSG[k].en), ph(TXS.MSG[k].it), k + ' placeholders');
    }
    for (const r of RC.RECIPES) if (r.out.fn) assert.ok(TXS.MSG['craft_fn_' + r.out.fn], 'text for ' + r.out.fn);
});

test('crafting at the bench: two scripts become a stronger one, a wrong mix loses nothing, stacks count one per unit', () => {
    const s = hub([{ k: 's_rm', n: 2 }, { k: 'd_cura', n: 1 }]);
    const turn = s.turn;
    assert.equal(G.act(s, { t: 'craft', i: [0, 1] }), false);
    assert.equal(count(s, 's_rm'), 2); assert.equal(count(s, 'd_cura'), 1, 'a wrong mix loses nothing');
    assert.equal(s.log[s.log.length - 1].m.k, 'craft_none');
    G.act(s, { t: 'craft', i: [0] }); assert.equal(count(s, 's_rm'), 2, 'one input is not enough');
    G.act(s, { t: 'craft', i: [0, 0] });
    assert.equal(count(s, 's_rm'), 0); assert.equal(count(s, 'c_rm'), 1); assert.ok(s.recipes.r_rm, 'discovered');
    assert.equal(s.turn, turn, 'crafting takes no turn');
    assert.ok(s.log.some((l) => l.m && l.m.k === 'craft_new'));
    assert.match(G.logText(s.log.find((l) => l.m.k === 'craft_ok'), 'en'), /rm -rf \//);
    // the crafted script works: it burns every enemy in view
    s.bench.open = 0; const a = arena(room(3, 3, 12, 8), [4, 4]); a.p.inv = [{ k: 'c_rm', n: 1 }]; const m = addMob(a, 8, 5, false); G.updateFov(a); const hp = m.hp;
    G.act(a, { t: 'use', i: 0 }); assert.ok(m.hp < hp || !a.mobs.includes(m)); assert.equal(count(a, 'c_rm'), 0);
});

test('recipes: any order, three inputs, a USB recharged by a battery, a weapon upgraded, a Recipe Book reveals them all, and only at an open bench', () => {
    let s = hub([{ k: 'taglierino_x' }]); s.p.inv = [{ k: 'cd', n: 2 }, { k: 'dardi', n: 3 }];
    G.act(s, { t: 'craft', i: [1, 0, 0] });
    assert.equal(count(s, 'taglierino'), 2); assert.equal(count(s, 'cd'), 0); assert.equal(count(s, 'dardi'), 2);
    s = hub([{ k: 'u_exploit', ch: 1 }, { k: 'c_batteria', n: 1 }]);
    G.act(s, { t: 'craft', i: [1, 0] });
    assert.equal(count(s, 'c_batteria'), 0); assert.equal(s.p.inv.length, 1); assert.ok(s.p.inv[0].ch >= G.ITEM.u_exploit.ch + 2, 'recharged to more than full');
    s = hub([{ k: 'tastiera' }, { k: 'cavo' }]);
    G.act(s, { t: 'craft', i: [0, 1] });
    assert.deepEqual(s.p.inv.map((it) => it.k), ['c_tastiera']); assert.deepEqual(s.p.inv[0].e, 0);
    s = hub([{ k: 'c_ricettario', n: 1 }]);
    G.act(s, { t: 'leave' }); s.bench.open = 0;
    G.act(s, { t: 'use', i: 0 });
    assert.equal(Object.keys(s.recipes).length, RC.RECIPES.length);
    const c = hub([{ k: 's_sleep', n: 2 }]); c.bench.open = 0;
    G.act(c, { t: 'craft', i: [0, 0] }); assert.equal(count(c, 's_sleep'), 2, 'the bench is closed');
    const d = hub([{ k: 'd_cura', n: 1 }, { k: 'd_cura', n: 1 }]); G.act(d, { t: 'craft', i: [0, 1] });
    assert.ok(count(d, 'd_cura2') === 1 && d.known.d_cura2, 'a crafted unknown-kind item is known');
});

test('discovered recipes are kept between runs', () => {
    const meta = G.newMeta();
    const s = hub([{ k: 's_rm', n: 2 }]); G.act(s, { t: 'craft', i: [0, 0] });
    s.status = 'dead'; G.recordRun(meta, s, '2026-01-01');
    assert.ok(meta.recipes.r_rm);
    assert.ok(G.newGame(1, 'studente', meta).recipes.r_rm);
    assert.deepEqual(G.fixMeta({ runs: 3 }).recipes, {});
});

// ── elites ──────────────────────────────────────────────────────────────────
function withElite(def, fn) {
    const d = Object.assign({ id: 't_elite', name: { en: 'Test Elite', it: 'Élite di prova' }, shape: 'robot', col: '#ffffff', hp: 12, atk: [1, 2], xp: 20, floors: [1, 5], elite: true, info: { en: 'x', it: 'y' } }, def);
    // the real mini-bosses of mobs.js are set aside while the injected test elite is examined
    const real = MOBS.LIST.filter((e) => e.mini || e.elite); real.forEach((e) => MOBS.LIST.splice(MOBS.LIST.indexOf(e), 1));
    MOBS.LIST.push(d); G.MOB[d.id] = d;
    try { fn(d); } finally { MOBS.LIST.splice(MOBS.LIST.indexOf(d), 1); delete G.MOB[d.id]; real.forEach((e) => MOBS.LIST.push(e)); }
}
const floorAt = (seed, depth) => { const s = G.newGame(seed, 'studente'); s.depth = depth; G.newFloor(s); return s; };

test('an elite is placed once, on the middle floor of its sector, in its own room, and the layout of the floor does not change', () => {
    assert.deepEqual(MAP.generate(7, 3).tiles, MAP.generate(7, 3, { elite: true }).tiles);
    withElite({}, (d) => {
        assert.equal(G.eliteOf(3), d); assert.equal(G.eliteOf(2), undefined); assert.equal(G.eliteDepth({ elite: 7 }), 7);
        for (let seed = 1; seed <= 60; seed++) {
            for (const depth of [1, 2, 3, 4, 5]) {
                const s = floorAt(seed, depth), e = s.mobs.filter((m) => m.elite);
                if (depth !== 3) { assert.equal(e.length, 0, 'only on floor 3'); assert.ok(!s.mobs.some((m) => m.k === d.id)); continue; }
                assert.equal(e.length, 1, 'one elite, seed ' + seed); assert.equal(e[0].k, d.id); assert.equal(s.map.tiles[idx(e[0].x, e[0].y)], T.FLOOR);
                assert.ok(!s.shop || (e[0].x !== s.shop.x || e[0].y !== s.shop.y));
                assert.ok(s.log.some((l) => l.m && l.m.k === 'floor_elite'));
                assert.notEqual(idx(e[0].x, e[0].y), idx(s.map.stairs.x, s.map.stairs.y));
            }
        }
        const other = floorAt(5, 8); assert.ok(!other.mobs.some((m) => m.elite), 'the next sector has none');
    });
    assert.equal(G.eliteOf(3).id, 'mini1', 'the real mini-boss of sector 1 is the elite of floor 3');
    for (let sector = 1; sector <= 10; sector++) assert.equal(G.eliteOf(sector * 5 - 2).id, 'mini' + sector, 'sector ' + sector);
    assert.equal(G.eliteOf(2), undefined);
});

test('killing an elite gives a victory message and a guaranteed item (its own `drop` when it names one)', () => {
    withElite({}, () => {
        for (let seed = 1; seed <= 20; seed++) {
            const s = floorAt(seed, 3), e = s.mobs.find((m) => m.elite);
            s.p.x = e.x - 1; s.p.y = e.y; s.map.tiles[idx(s.p.x, s.p.y)] = T.FLOOR; s.p.mods.atk = 99; s.p.mods.acc = 50; e.hp = 1; e.asleep = 0;
            const n = s.items.length; for (let k = 0; k < 6 && s.mobs.includes(e); k++) G.act(s, { t: 'move', dx: 1, dy: 0 });
            assert.ok(!s.mobs.includes(e)); assert.ok(s.items.some((i) => i.x === e.x && i.y === e.y && i.it.k !== '$'), 'a real item dropped, seed ' + seed); assert.ok(s.items.length > n);
            assert.ok(s.log.some((l) => l.m && l.m.k === 'elite_slain')); assert.equal(s.elites, 1);
            assert.match(G.logText(s.log.find((l) => l.m.k === 'elite_slain'), 'it'), /Élite di prova è a terra/);
        }
    });
    withElite({ drop: 'u_volt' }, () => {
        const s = floorAt(2, 3), e = s.mobs.find((m) => m.elite);
        s.p.x = e.x - 1; s.p.y = e.y; s.map.tiles[idx(s.p.x, s.p.y)] = T.FLOOR; s.p.mods.atk = 99; s.p.mods.acc = 50; e.hp = 1; for (let k = 0; k < 6 && s.mobs.includes(e); k++) G.act(s, { t: 'move', dx: 1, dy: 0 });
        assert.ok(s.items.some((i) => i.it.k === 'u_volt'));
    });
});

test('behaviour hooks: a new flag on a monster becomes behaviour by registering a function, for its turn, its hit and its death', () => {
    const calls = { turn: 0, hit: 0, death: 0 };
    G.MOB_HOOKS.turn.freezer = (s, m, d, ctx) => { calls.turn++; return true; };
    G.MOB_HOOKS.hit.vamp2 = () => { calls.hit++; };
    G.MOB_HOOKS.death.pop = (s) => { calls.death++; };
    try {
        withElite({ elite: false, freezer: true, pop: true, vamp2: true, floors: [1, 5] }, (d) => {
            const s = arena(room(3, 3, 12, 8), [4, 4]);
            const m = addMob(s, 5, 4, true, d.id); const hp = s.p.hp;
            G.act(s, { t: 'wait' });
            assert.ok(calls.turn >= 1, 'the turn hook ran'); assert.equal(s.p.hp, hp, 'and it used up the turn: no attack');
            delete d.freezer;
            for (let i = 0; i < 40 && calls.hit === 0 && s.status === 'play'; i++) G.act(s, { t: 'wait' });
            assert.ok(calls.hit >= 1, 'the hit hook ran');
            s.p.mods.atk = 99; s.p.mods.acc = 50; m.hp = 1; m.x = 5; m.y = 4; s.p.x = 4; s.p.y = 4; G.act(s, { t: 'move', dx: 1, dy: 0 });
            assert.equal(calls.death, 1, 'the death hook ran');
        });
    } finally { delete G.MOB_HOOKS.turn.freezer; delete G.MOB_HOOKS.hit.vamp2; delete G.MOB_HOOKS.death.pop; }
});
