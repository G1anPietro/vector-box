// tests/dungeon-balance.test.js — a short deterministic batch of bot runs (tools/rogue-bot.js): no crash, no soft-lock, and the numbers stay in generous bounds,
// so a later change of the data (mobs.js, items.js, classes.js, meta.js, hazards.js) cannot silently break the balance. The full measurement
// (100+ runs per class, tables per sector) is `node tools/rogue-balance.js`, see docs/ROGUELIKE.md.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const { runsParallel, summarize } = require('../tools/rogue-balance.js');

const PER_CLASS = 3, MAX_TURNS = 20000;

test('bot batch: no soft-lock, depth in bounds, no class far below the median, no early wall', { timeout: 280000 }, async () => {
    const recs = await runsParallel(PER_CLASS, MAX_TURNS, null, 7, Math.min(4, os.cpus().length));
    const rows = summarize(recs);
    const dump = JSON.stringify(rows.map((r) => [r.cls, +r.avg.toFixed(1)]));
    assert.equal(recs.length, PER_CLASS * 8);
    assert.equal(recs.filter((r) => r.end === 'stuck').length, 0, 'a run got stuck (soft-lock): ' + JSON.stringify(recs.filter((r) => r.end === 'stuck')));
    const all = recs.reduce((a, r) => a + r.depth, 0) / recs.length;
    assert.ok(all >= 8 && all <= 40, 'average depth ' + all.toFixed(1) + ' outside 8..40 ' + dump);
    const avgs = rows.map((r) => r.avg).sort((a, b) => a - b), median = (avgs[3] + avgs[4]) / 2;
    for (const r of rows) assert.ok(r.avg >= 0.6 * median, r.cls + ' avg depth ' + r.avg.toFixed(1) + ' is below 60% of the median ' + median.toFixed(1) + ' ' + dump);
    const early = recs.filter((r) => r.status === 'dead' && r.depth <= 10).length;
    assert.ok(early <= recs.length * 0.2, 'too many deaths in sectors 1-2: ' + early + ' of ' + recs.length);
    assert.ok(recs.filter((r) => r.end === 'hunger').length <= recs.length * 0.15, 'too many starvation deaths');
});

test('bot.js loads in a plain browser-like sandbox (no Node globals) and plays a seeded game with a JSON memo', () => {
    const fs = require('fs'), path = require('path'), vm = require('vm');
    const dir = path.join(__dirname, '..', 'public', 'js', 'rogue');
    const sandbox = {}; sandbox.self = sandbox;                    // a window-like object: no require, module, process, Buffer
    vm.createContext(sandbox);
    for (const f of ['rng', 'map', 'mobs', 'items', 'classes', 'meta', 'text', 'text-systems', 'hazards', 'recipes', 'game', 'bot']) vm.runInContext(fs.readFileSync(path.join(dir, f + '.js'), 'utf8'), sandbox, { filename: f + '.js' });
    const R = sandbox.Rogue;
    assert.equal(typeof R.bot.decide, 'function');
    const meta = R.game.newMeta(); meta.ng = 9;
    const s = R.game.newGame(4242, 'studente', meta, {});
    let memo = { style: 'normal' }, slowest = 0, a;
    for (let i = 0; i < 3000 && s.status === 'play'; i++) {
        memo = JSON.parse(JSON.stringify(memo));                  // the memo survives a page reload
        const t0 = process.hrtime.bigint();
        a = R.bot.decide(s, memo);
        slowest = Math.max(slowest, Number(process.hrtime.bigint() - t0) / 1e6);
        assert.ok(a && typeof a.t === 'string', 'an action object');
        R.game.act(s, a);
    }
    assert.ok(s.turn > 100 || s.status !== 'play', 'the bot made progress (turn ' + s.turn + ')');
    assert.ok(slowest < 50, 'a decision took ' + slowest.toFixed(1) + ' ms');
    if (s.status !== 'play') assert.equal(R.bot.decide(s, memo), null);
});
