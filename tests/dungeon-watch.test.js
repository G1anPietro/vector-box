// tests/dungeon-watch.test.js — "Watch the bot play": the bot's reasons (memo.why) change nothing, the spectator loop (js/rogue/watch.js) plays, saves, restores,
// stops when stuck, and its texts exist in both languages; the page loads the scripts with ?v= and has no inline script.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'public', 'js', 'rogue');
const MAP = require(path.join(dir, 'map.js')), G = require(path.join(dir, 'game.js')), BOTM = require(path.join(dir, 'bot.js'));
const TX = require(path.join(dir, 'text.js'));
require(path.join(dir, 'text-systems.js'));
const TB = require(path.join(dir, 'text-bot.js')), WATCH = require(path.join(dir, 'watch.js'));
const BOT = BOTM.create(G, MAP);

const newState = (seed, cls) => { const meta = G.newMeta(); Object.assign(meta, { ng: 9, best: 99, bosses: 99, wins: 99, runs: 99 }); return G.newGame(seed, cls, meta, {}); };
/** The first n actions of the bot; readWhy = also read (and clone) memo.why after every decision, as the page does. */
function actions(seed, cls, style, n, readWhy) {
    const s = newState(seed, cls), memo = { style }, out = [];
    while (s.status === 'play' && out.length < n) {
        const a = BOT.decide(s, memo);
        if (!a) break;
        if (readWhy) { const w = JSON.stringify(memo.why); assert.ok(w && JSON.parse(w).key, 'every decision leaves a reason'); }
        out.push(a); G.act(s, a);
    }
    return out;
}
const hash = (acts) => crypto.createHash('sha256').update(JSON.stringify(acts)).digest('hex');

// recorded with the bot as it was BEFORE memo.why existed: if one of these changes, a decision changed
const GOLDEN = {
    'seed 7 studente normal, 300 actions': ['studente', 'normal', 300, '473e5c47a1d83b0b58bd24865316dad2f397a72a46a278b91635a5cd3251360c'],
};
for (const [name, [cls, style, n, h]] of Object.entries(GOLDEN)) {
    test('bot decisions are identical to before memo.why: ' + name, () => {
        assert.equal(hash(actions(7, cls, style, n, false)), h);
        assert.equal(hash(actions(7, cls, style, n, true)), h, 'reading memo.why changes nothing');
    });
}
test('careful style: same actions with and without reading memo.why, and memo stays plain JSON', () => {
    const a = actions(2, 'bidello', 'careful', 1500, false), b = actions(2, 'bidello', 'careful', 1500, true);
    assert.equal(hash(a), hash(b));
    const s = newState(2, 'bidello'), memo = { style: 'careful' };
    for (let i = 0; i < 400 && s.status === 'play'; i++) G.act(s, BOT.decide(s, memo));
    assert.deepEqual(JSON.parse(JSON.stringify(memo)), memo);
});
test('every reason key that bot.js uses has a sentence in both languages, with the same placeholders', () => {
    const src = fs.readFileSync(path.join(dir, 'bot.js'), 'utf8'), keys = new Set(src.match(/'bot_[a-z_]+'/g).map((k) => k.slice(1, -1)));
    assert.ok(keys.size >= 20);
    for (const k of keys) assert.ok(TX.MSG[k], 'missing text for ' + k);
    const ph = (t) => (String(t).match(/\{\w+\}/g) || []).sort().join(',');
    for (const k in TB.MSG) {
        const m = TB.MSG[k];
        assert.ok(m.en && m.it, k + ' needs both languages');
        assert.equal(ph(m.en), ph(m.it), k + ': placeholders differ');
        if (k !== 'watch_max' && k !== 'watch_stop') assert.notEqual(m.en, m.it, k + ' looks untranslated');
    }
    assert.equal(TB.explain({ key: 'bot_drink_heal', params: { item: 'pot_heal' } }, 'en', { item: () => 'Cold Brew' }), 'Low on health with an enemy close: it drinks Cold Brew.');
    assert.match(TB.explain({ key: 'bot_flee', params: { how: 'stairs' } }, 'it'), /scale/);
});
test('the reasons of a whole run all explain to a sentence in both languages', () => {
    const w = WATCH.create(G, BOT, { seed: 5, cls: 'hacker' }), seen = new Set();
    while (w.status === 'play' && w.count < 4000) { w.step(); const y = w.whys[w.whys.length - 1]; seen.add(y.why.key); for (const l of ['en', 'it']) assert.ok(TB.explain(y.why, l, { item: (k) => k, mob: (k) => k, skill: (k) => k }).length > 5, y.why.key); }
    assert.ok(seen.size >= 8, 'a real run shows many different reasons: ' + [...seen]);
});

// ── the spectator loop
const quick = (o) => WATCH.create(G, BOT, Object.assign({ seed: 7, cls: 'studente', speed: 'max' }, o));
test('watch: plays a seeded run to the end, same result twice, whys kept short', () => {
    const run = () => { const w = quick({}); while (w.status === 'play') w.run(50); return w; };
    const a = run(), b = run();
    assert.ok(['dead', 'won'].includes(a.status), a.status);
    assert.equal(a.count, b.count); assert.equal(a.s.turn, b.s.turn);
    assert.ok(a.whys.length <= 12 && a.whys.length > 0);
});
test('watch: serialise in the middle of a run, restore, the continuation is identical', () => {
    const a = quick({}), seq = [];
    for (let i = 0; i < 700; i++) a.step();
    const saved = a.serialise();
    for (let i = 0; i < 1500 && a.status === 'play'; i++) seq.push(JSON.stringify(a.step()));
    const b = WATCH.create(G, BOT, { saved }), seq2 = [];
    assert.equal(b.count, 700);
    for (let i = 0; i < 1500 && b.status === 'play'; i++) seq2.push(JSON.stringify(b.step()));
    assert.deepEqual(seq2, seq);
    assert.equal(b.s.turn, a.s.turn);
    assert.equal(WATCH.create(G, BOT, { saved: 'not json' }), null);
    assert.equal(WATCH.create(G, BOT, { saved: JSON.stringify({ f: 1 }) }), null);
});
test('watch: stops by itself when nothing changes for ~200 actions', () => {
    const lazy = { decide: () => ({ t: 'wait' }) }, w = WATCH.create(G, lazy, { seed: 3, cls: 'studente' });
    while (w.status === 'play') w.step();
    assert.equal(w.status, 'stalled');
    assert.ok(w.count >= 200 && w.count < 260, 'stopped after ' + w.count);
});
test('watch: the action cap stops a run, and a stopped run plays nothing more', () => {
    const w = quick({ maxActions: 120 });
    while (w.status === 'play') w.step();
    assert.equal(w.status, 'cap'); assert.equal(w.count, 120);
    assert.equal(w.step(), null);
    assert.equal(WATCH.MAX_ACTIONS, 60000);
});
test('watch: speed, pause and the frame budget', () => {
    const w = quick({ speed: '1x' });
    assert.equal(w.tick(100), 0, 'a slow speed waits for its time');
    assert.equal(w.tick(500), 1);
    w.setSpeed('20x'); assert.equal(w.tick(60), 2, '30 ms per action');
    w.paused = true; assert.equal(w.tick(5000), 0);
    w.paused = false; w.setSpeed('max');
    let t = 0; const clock = () => (t += 5);                  // a fake clock: every look costs 5 ms
    const n = w.tick(16, 12, clock);
    assert.ok(n >= 2 && n <= 4, 'max speed stops at the budget: ' + n);
    w.setSpeed('1x'); w.acc = 0;
    assert.ok(w.tick(60000) <= 2, 'a long pause fires no burst');
    assert.equal(WATCH.parseSeed(' 1a2B '), 0x1a2b); assert.equal(WATCH.parseSeed('xyz'), null); assert.equal(WATCH.parseSeed('123456789'), null);
    assert.equal(WATCH.seedText(255), 'FF');
});
test('watch: the spectator never touches a profile (the state comes from a throw-away one)', () => {
    const meta = G.newMeta(), before = JSON.stringify(meta);
    const w = quick({}); while (w.status === 'play') w.run(50);
    assert.equal(JSON.stringify(meta), before);
    assert.ok(!/recordRun|localStorage/.test(fs.readFileSync(path.join(dir, 'watch.js'), 'utf8').replace(/\/\/.*$/gm, '')), 'watch.js has no storage and no recording');
});

// ── the page
const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'pages', 'dungeon.html'), 'utf8');
test('dungeon.html: the new scripts load with ?v= in the right order, no inline script, a Watch button', () => {
    const order = [...page.matchAll(/<script src="\.\.\/js\/([^"?]+)\?v=\d+"/g)].map((m) => m[1]);
    for (const f of ['rogue/text-bot.js', 'rogue/watch.js']) assert.ok(order.includes(f), f + ' is loaded with ?v=');
    assert.ok(order.indexOf('rogue/text-bot.js') > order.indexOf('rogue/text.js'));
    assert.ok(order.indexOf('rogue/watch.js') < order.indexOf('dungeon.js') && order.indexOf('rogue/bot.js') < order.indexOf('dungeon.js'));
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(page), 'no inline script');
    assert.match(page, /id="dg-watch"/); assert.match(page, /id="dg-spec"/);
    assert.match(fs.readFileSync(path.join(dir, '..', 'dungeon.js'), 'utf8'), /vb_rogue_watch/);
});
