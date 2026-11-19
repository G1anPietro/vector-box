// tests/vita.test.js — Game of Life: the rules (no browser) and the page
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../public/js/vita.js');

const alive = (cells) => { const out = []; cells.forEach((c, i) => { if (c) out.push([i % L.N, (i / L.N) | 0]); }); return out; };
const run = (cells, gens) => { for (let i = 0; i < gens; i++) cells = L.step(cells); return cells; };
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

test('life: a block does not change, a blinker has period 2, an empty board stays empty', () => {
    const block = L.empty(); [[5, 5], [6, 5], [5, 6], [6, 6]].forEach(([x, y]) => { block[y * L.N + x] = 1; });
    assert.ok(same(L.step(block), block));
    const blinker = L.withPattern('blinker');
    assert.ok(!same(L.step(blinker), blinker) && same(run(blinker, 2), blinker));
    assert.equal(L.population(L.step(L.empty())), 0);
});

test('life: a pulsar has period 3 and a glider moves one cell diagonally every 4 steps', () => {
    const pulsar = L.withPattern('pulsar');
    assert.ok(same(run(pulsar, 3), pulsar) && !same(run(pulsar, 1), pulsar));
    const g0 = alive(L.withPattern('glider')), g4 = alive(run(L.withPattern('glider'), 4));
    assert.deepEqual(g4.map(([x, y]) => [x - 1, y - 1]).sort(), g0.sort(), 'same shape, one cell right and down');
});

test('life: the edges wrap around (a glider keeps flying) and the gun makes a new glider every 30 steps', () => {
    assert.equal(L.population(run(L.withPattern('glider'), 400)), 5, 'still 5 cells after crossing the board many times');
    const gun = L.withPattern('gun');
    assert.equal(L.population(gun), 36);
    assert.equal(L.population(run(gun, 30)), 41, 'gun + one glider');
});

test('life: random board is reproducible with a fixed random source', () => {
    let a = 0.1, b = 0.1; const r1 = () => (a = (a * 9301 + 0.49297) % 1), r2 = () => (b = (b * 9301 + 0.49297) % 1);
    assert.ok(same(L.randomBoard(r1), L.randomBoard(r2)));
});

test('life: the page is registered in the games list and the sitemap, with its assets', () => {
    const pub = path.join(__dirname, '..', 'public'), read = (p) => fs.readFileSync(path.join(pub, p), 'utf8');
    assert.match(read('pages/giochi.php'), /'href' => 'vita\.html'/);
    assert.match(read('sitemap.php'), /\/pages\/vita\.html/);
    for (const f of ['pages/vita.html', 'js/vita.js', 'css/vita.css', 'assets/vita/icon.svg']) assert.ok(fs.existsSync(path.join(pub, f)), f);
});
