// tests/dungeon-touch.test.js — Il Dungeon del Server, touch controls: what a tap means (intentForTap), searching, throwing
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { startSite } = require('./helpers');
const dir = path.join(__dirname, '..', 'public', 'js', 'rogue');
const MAP = require(path.join(dir, 'map.js')), MOBS = require(path.join(dir, 'mobs.js')), G = require(path.join(dir, 'game.js'));
const W = MAP.W;

/** A run with an open 17x13 room around the hero (10,10), everything seen, no monsters, items or traps. */
function arena() {
    const s = G.newGame(5, 'studente');
    s.mobs = []; s.items = []; s.traps = []; s.shop = null; s.altar = null; s.sealed = 0;
    for (let y = 4; y <= 16; y++) for (let x = 4; x <= 20; x++) s.map.tiles[y * W + x] = MAP.T.FLOOR;
    s.p.x = 10; s.p.y = 10; s.p.inv = s.p.inv.filter((it) => G.ITEM[it.k].cat !== 'throw'); s.p.inv.push({ k: 'dardi', n: 3 });
    for (let y = 3; y <= 17; y++) for (let x = 3; x <= 21; x++) s.seen[y * W + x] = 1;
    G.updateFov(s);
    return s;
}
const bug = (s, x, y, extra) => { const m = Object.assign({ id: 90 + s.mobs.length, k: 'bug', x, y, hp: 40, max: 40, asleep: 0 }, extra); s.mobs.push(m); G.updateFov(s); return m; };

test('intentForTap: floor, enemy, item, stairs, hero, blocked, unseen, furniture', () => {
    const s = arena(), I = (x, y, k, a) => G.intentForTap(s, x, y, k || 'tap', a);
    assert.deepEqual(I(14, 10), { type: 'walk', x: 14, y: 10 });
    assert.equal(I(10, 10).type, 'rest');
    assert.equal(I(10, 10, 'double').type, 'search');
    assert.equal(I(10, 10, 'long').type, 'search');
    assert.equal(I(2, 2).type, 'none', 'a wall or unseen cell does nothing');
    assert.equal(I(-1, 3).type, 'none');
    s.map.tiles[10 * W + 12] = MAP.T.WALL; assert.equal(I(12, 10).reason, 'blocked');
    s.seen[10 * W + 18] = 0; assert.equal(I(18, 10).reason, 'unseen');
    s.items.push({ x: 7, y: 10, it: { k: '$', n: 5 } });
    assert.equal(I(7, 10).type, 'pickup');
    const m = bug(s, 10, 13);
    assert.deepEqual(I(10, 13), { type: 'attack', id: m.id, x: 10, y: 13, adjacent: false });
    bug(s, 11, 10); assert.equal(I(11, 10).adjacent, true);
    s.map.tiles[8 * W + 8] = MAP.T.STAIRS;
    assert.equal(I(8, 8).type, 'use'); assert.equal(I(8, 8).what, 'stairs');
    s.map.tiles[12 * W + 6] = MAP.T.SHOP; s.shop = { x: 6, y: 12, open: 0, stock: [] };
    const u = I(6, 12); assert.equal(u.what, 'shop'); assert.equal(Math.abs(u.via[0] - 6) + Math.abs(u.via[1] - 12), 1);
    const before = JSON.stringify(s); I(14, 10); I(11, 10, 'long'); assert.equal(JSON.stringify(s), before, 'asking never changes the game');
    s.p.x = 8; s.p.y = 8; G.updateFov(s);
    assert.equal(I(8, 8).type, 'use', 'tapping yourself on the stairs takes them');
});

test('intentForTap: a long press gives an info card and never acts; aiming throws or cancels', () => {
    const s = arena(); bug(s, 13, 10, { hp: 5 });
    const turn = s.turn, card = G.intentForTap(s, 13, 10, 'long');
    assert.equal(card.type, 'info'); assert.equal(card.title, G.MOB.bug.name); assert.ok(card.lines.some((l) => /PS 5\/40/.test(l)));
    s.items.push({ x: 8, y: 10, it: { k: 'merendina', n: 1 } });
    assert.match(G.intentForTap(s, 8, 10, 'long').title, /Merendina/);
    assert.equal(G.intentForTap(s, 11, 11, 'long').title, 'Pavimento');
    assert.equal(G.intentForTap(s, 2, 2, 'long').title, 'Non esplorato');
    assert.equal(s.turn, turn);
    const i = s.p.inv.findIndex((it) => it.k === 'dardi');
    assert.deepEqual(G.intentForTap(s, 13, 10, 'tap', i), { type: 'throw', i, x: 13, y: 10 });
    assert.equal(G.intentForTap(s, 19, 10, 'tap', i).type, 'cancel', 'farther than the range');
    assert.equal(G.intentForTap(s, 10, 10, 'tap', i).type, 'cancel', 'not on yourself');
    assert.equal(G.intentForTap(s, 13, 10, 'tap', -1).type, 'cancel');
    assert.equal(G.slotIntent(s, 'dardi').type, 'aim');
    assert.equal(G.slotIntent(s, 'merendina').type, 'use');
    assert.equal(G.slotIntent(s, 'u_volt').type, 'none');
});

test('throwing: hits the first monster on the line, costs a turn and an item, respects the range', () => {
    const s = arena(), near = bug(s, 12, 10), far = bug(s, 15, 10);
    s.p.mods.acc = 50;                                        // never miss in this test
    const i = s.p.inv.findIndex((it) => it.k === 'dardi'), had = s.p.inv[i].n, turn = s.turn;
    assert.equal(G.act(s, { t: 'throw', i, x: 15, y: 10 }), true);
    assert.equal(s.turn, turn + 1);
    assert.equal(s.p.inv.find((it) => it.k === 'dardi').n, had - 1);
    assert.ok(near.hp < 40, 'the near one was hit'); assert.equal(far.hp, 40);
    const t2 = s.turn;
    assert.equal(G.act(s, { t: 'throw', i, x: 18, y: 10 }), false, 'range is ' + G.THROW_RANGE);
    assert.equal(s.turn, t2);
    assert.equal(G.act(s, { t: 'throw', i: 0, x: 10, y: 14 }), false, 'only throwables can be thrown');
    s.map.tiles[10 * W + 11] = MAP.T.WALL;                    // a wall stops it: nobody behind is hit
    G.act(s, { t: 'throw', i, x: 14, y: 10 }); assert.equal(far.hp, 40);
    const t3 = s.turn; G.act(s, { t: 'use', i }); assert.equal(s.turn, t3, 'using a throwable from the bag takes no turn');
});

test('search: finds secret doors and traps within 3 cells (a turn), not farther away', () => {
    const s = arena();
    s.map.tiles[10 * W + 12] = MAP.T.SECRET; s.map.tiles[10 * W + 18] = MAP.T.SECRET;
    s.traps.push({ x: 10, y: 11, k: MOBS.TRAPS[0].id, found: 0 });
    let found = false;
    for (let n = 0; n < 12 && !found; n++) { const t = s.turn; assert.equal(G.act(s, { t: 'search' }), true); assert.equal(s.turn, t + 1); found = s.map.tiles[10 * W + 12] === MAP.T.DOOR; }
    assert.ok(found, 'the near secret door shows up');
    assert.equal(s.map.tiles[10 * W + 18], MAP.T.SECRET, 'eight cells away stays hidden');
    assert.equal(s.traps[0].found, 1);
});

test('the page has the toolbar, the quickslots, the zoom buttons and the touch rules in the CSS', async () => {
    const site = await startSite();
    try {
        const html = await (await fetch(`${site.base}/pages/dungeon.html`)).text();
        for (const id of ['dg-toolbar', 'dg-zin', 'dg-zout', 'dg-card']) assert.ok(html.includes('id="' + id + '"'), id);
        assert.equal((html.match(/class="dg-slot"/g) || []).length, 4);
        const css = await (await fetch(`${site.base}/css/dungeon.css`)).text();
        assert.match(css, /touch-action: none/); assert.match(css, /-webkit-touch-callout: none/);
    } finally { await site.stop(); }
});
