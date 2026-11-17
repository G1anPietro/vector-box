// tests/dungeon-content.test.js — the data of The Server Dungeon: how much content there is and that it all hangs together
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const dir = path.join(__dirname, '..', 'public', 'js', 'rogue');
const MOBS = require(path.join(dir, 'mobs.js')), ITEMS = require(path.join(dir, 'items.js')), CLS = require(path.join(dir, 'classes.js')),
    SP = require(path.join(dir, 'sprites.js')), G = require(path.join(dir, 'game.js'));
const sectorOfFloor = (f) => Math.floor((f - 1) / MOBS.PER_SECTOR);
const regular = MOBS.LIST.filter((d) => !d.boss && !d.mini);

test('monsters: 90+ regular types with 8-10 per sector, 12 bosses, one mini-boss per sector on floor 3 of it', () => {
    assert.equal(MOBS.SECTORS.length, 10);
    assert.ok(regular.length >= 90, 'regular types ' + regular.length);
    for (let s = 0; s < 10; s++) {
        const n = regular.filter((d) => sectorOfFloor(d.floors[0]) === s && sectorOfFloor(d.floors[1]) === s).length;
        assert.ok(n >= 8 && n <= 10, 'sector ' + (s + 1) + ' has ' + n + ' types');
    }
    const bosses = MOBS.LIST.filter((d) => d.boss);
    assert.equal(bosses.length, 12);
    for (let s = 1; s <= 10; s++) assert.ok(bosses.some((d) => d.boss === s * 5), 'boss of sector ' + s);
    const minis = MOBS.LIST.filter((d) => d.mini);
    assert.equal(minis.length, 10);
    for (let s = 1; s <= 10; s++) {
        const m = minis.filter((d) => d.mini === s * 5 - 2);
        assert.equal(m.length, 1, 'mini-boss of sector ' + s);
        assert.ok(G.ITEM[m[0].drop], 'its drop exists: ' + m[0].drop);
        assert.ok(G.ITEM[m[0].drop].from >= 99, 'and cannot be found on the floor');
        assert.ok(m[0].info.en && m[0].info.it, 'and it has a line of text');
    }
});

test('monsters: every reference exists, sprites resolve to a picture, new types have a sprite key, no two types share a name', () => {
    const names = new Set();
    for (const d of MOBS.LIST) {
        assert.ok(SP[d.shape], 'archetype picture ' + d.id);
        if (d.summon) assert.ok(G.MOB[d.summon.k], d.id + ' summons ' + d.summon.k);
        assert.ok(!names.has(d.name.en), 'unique English name ' + d.name.en); names.add(d.name.en);
        if (d.sprite) assert.match(d.sprite, /^monster_\w+$/);
        if (d.ranged) assert.ok(d.ranged.verb.en && d.ranged.verb.it);
    }
    for (const d of MOBS.LIST.filter((x) => /^(mini\d+|boss5b|boss10b)$/.test(x.id))) assert.ok(d.sprite, d.id);
});

test('monsters: types in one sector differ in behaviour (no two share the same flags, speed, armour and picture)', () => {
    const flags = ['erratic', 'ranged', 'summon', 'steal', 'poison', 'weaken', 'stun', 'confuse', 'leech', 'regen', 'split', 'explode', 'phase', 'invisible', 'ambush', 'still', 'coward', 'blink', 'undead'];
    for (let s = 0; s < 10; s++) {
        const seen = new Map();
        for (const d of regular.filter((x) => sectorOfFloor(x.floors[0]) === s)) {
            const key = flags.filter((f) => d[f]).join('+') + '|' + (d.speed || 1) + '|' + (d.def || 0) + '|' + d.shape;
            assert.ok(!seen.has(key), 'sector ' + (s + 1) + ': ' + d.id + ' looks like ' + seen.get(key));
            seen.set(key, d.id);
        }
    }
});

test('items: 200+, unique ids, sane prices and floors, effects that exist, nothing targeted outside USB sticks', () => {
    assert.ok(ITEMS.LIST.length >= 200, 'items ' + ITEMS.LIST.length);
    const MODS = new Set(['maxHp', 'atk', 'def', 'acc', 'dodge', 'crit', 'regen', 'hunger', 'vamp', 'luck', 'search', 'sight', 'usb', 'drink', 'backstab', 'stealth', 'recharge', 'haggle', 'xp', 'cd', 'fury', 'holy']);
    for (const d of ITEMS.LIST) {
        assert.ok(d.price > 0, d.id);
        if (d.to) assert.ok(d.to >= (d.from || 1), d.id + ' floors');
        if (['drink', 'script', 'usb'].includes(d.cat)) { assert.ok(G.EFFECTS[d.effect], d.id); if (d.cat !== 'usb') assert.ok(!G.TARGETED[d.effect], d.id + ' needs a target'); }
        if (d.cat === 'usb') assert.ok(d.ch > 0, d.id);
        if (d.cat === 'weapon') assert.ok(d.dmg[0] >= 1 && d.dmg[1] >= d.dmg[0], d.id);
        if (d.cat === 'armor') assert.ok(d.def >= 1, d.id);
        if (d.cat === 'plugin') for (const k in d.mod) assert.ok(MODS.has(k), d.id + ' mod ' + k);
        if (d.sprite) assert.equal(d.sprite, 'item_' + d.id);
    }
    const count = (c) => ITEMS.LIST.filter((d) => d.cat === c).length;
    assert.ok(count('weapon') >= 40 && count('armor') >= 25 && count('drink') >= 20 && count('script') >= 25 && count('usb') >= 18 && count('plugin') >= 30 && count('food') >= 12 && count('throw') >= 10);
    assert.ok(ITEMS.LIST.filter((d) => d.cat === 'weapon' && (d.w <= 3 || d.from >= 99)).length >= 20, '20+ named unique weapons');
});

test('loot tables: every sector can drop every kind of item in a healthy mix', () => {
    for (let s = 1; s <= 10; s++) {
        const f = s * 5 - 2, can = ITEMS.LIST.filter((e) => (e.from || 1) <= f && (!e.to || f <= e.to));
        for (const c of Object.keys(ITEMS.CATS)) assert.ok(can.some((e) => e.cat === c), 'sector ' + s + ' has ' + c);
        assert.ok(can.length >= 80, 'sector ' + s + ' table ' + can.length);
        const wsum = (cat) => can.filter((e) => e.cat === cat).reduce((a, e) => a + (e.w || 10), 0), total = can.reduce((a, e) => a + (e.w || 10), 0);
        assert.ok(wsum('drink') / total > 0.1 && wsum('script') / total > 0.1, 'sector ' + s + ' enough consumables');
        assert.ok(wsum('plugin') / total < 0.4, 'sector ' + s + ' not all plugins');
    }
});

test('classes: 8 classes, each with 3+ skills of its own, ids unique, mods known', () => {
    assert.equal(CLS.CLASSES.length, 8);
    assert.equal(new Set(CLS.SKILLS.map((d) => d.id)).size, CLS.SKILLS.length, 'unique skill ids');
    for (const c of CLS.CLASSES) {
        const own = CLS.SKILLS.filter((k) => k.cls && k.cls.includes(c.id));
        assert.ok(own.length >= 3, c.id + ' has ' + own.length + ' class skills');
    }
    for (const k of CLS.SKILLS) { assert.ok(Object.keys(k.mod).length, k.id); for (const m of k.cls || []) assert.ok(G.CLASS[m], k.id + ' class ' + m); }
});
