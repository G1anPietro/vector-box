// tests/arcade.test.js — Memory, Tris and Snake: the rules (no browser) and the pages
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { startSite } = require('./helpers');
const load = (n) => require(path.join(__dirname, '..', 'public', 'js', n));
const Memory = load('memory.js'), Tris = load('tris.js'), Snake = load('snake.js');

test('memory: a deck has every pair twice; a match stays up, a miss waits to be hidden; finding all wins', () => {
    for (const lv of ['easy', 'medium', 'hard']) {
        const g = Memory.newGame(lv, Memory.makeRng(3));
        const counts = {};
        g.cards.forEach((c) => { counts[c] = (counts[c] || 0) + 1; });
        assert.ok(Object.values(counts).every((n) => n === 2), lv);
        assert.ok(g.cards.length / 2 <= Memory.SYMBOLS.length, 'enough symbols');
    }
    const g = Memory.newGame({ cols: 2, rows: 2 }, Memory.makeRng(1));
    const pairs = {}; g.cards.forEach((c, i) => (pairs[c] = pairs[c] || []).push(i));
    const [p1, p2] = Object.values(pairs);
    assert.equal(Memory.flip(g, p1[0]), 'first');
    assert.equal(Memory.flip(g, p1[0]), 'ignored', 'the same card twice');
    assert.equal(Memory.flip(g, p2[0]), 'miss');
    assert.equal(Memory.flip(g, p1[1]), 'ignored', 'wait: the two cards are still showing');
    Memory.hide(g);
    assert.equal(Memory.flip(g, p1[0]), 'first');
    assert.equal(Memory.flip(g, p1[1]), 'match');
    assert.equal(Memory.flip(g, p1[0]), 'ignored', 'a found card');
    Memory.flip(g, p2[0]);
    assert.equal(Memory.flip(g, p2[1]), 'match');
    assert.deepEqual([g.status, g.moves, g.found], ['won', 3, 2]);
    assert.throws(() => Memory.newGame({ cols: 3, rows: 3 }));
});

test('tris: wins, draws, and the unbeatable computer never loses against any human play', () => {
    assert.equal(Tris.winner(['X', 'X', 'X', null, 'O', 'O', null, null, null]), 'X');
    assert.equal(Tris.winner(['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X']), 'draw');
    assert.equal(Tris.winner(new Array(9).fill(null)), null);
    assert.deepEqual(Tris.line(['O', null, null, 'O', 'X', null, 'O', null, 'X']), [0, 3, 6]);
    // exhaustive: the human tries EVERY move at every turn, the hard computer answers; the human must never win (computer plays O and X)
    let games = 0;
    const walk = (b, turn, cpu) => {
        const w = Tris.winner(b);
        if (w) { games++; assert.notEqual(w, Tris.other(cpu), 'the computer lost: ' + b.join(',')); return; }
        if (turn === cpu) { const m = Tris.bestMove(b, cpu, 'hard', () => 0); b[m] = cpu; walk(b, Tris.other(cpu), cpu); b[m] = null; }
        else for (const m of Tris.moves(b)) { b[m] = turn; walk(b, cpu, cpu); b[m] = null; }
    };
    walk(new Array(9).fill(null), 'X', 'O');       // the computer second
    walk(new Array(9).fill(null), 'X', 'X');       // the computer first
    assert.ok(games > 100);
    // it takes a win when there is one, and blocks otherwise
    assert.equal(Tris.bestMove(['X', 'X', null, 'O', 'O', null, null, null, null], 'X', 'hard', () => 0), 2);
    assert.equal(Tris.bestMove(['O', 'O', null, 'X', null, null, null, null, null], 'X', 'hard', () => 0), 2, 'blocks');
});

test('snake: moves, grows, cannot reverse, dies on a wall or on itself', () => {
    const rng = () => 0;
    const g = Snake.newGame(rng, 8);
    g.food = [7, 7];
    const head = g.body[0].slice();
    Snake.step(g, rng);
    assert.deepEqual(g.body[0], [head[0] + 1, head[1]]);
    assert.equal(g.body.length, 3);
    assert.equal(Snake.turn(g, 'left'), false, 'a reversal into the neck is ignored');
    assert.equal(Snake.turn(g, 'right'), false, 'a repeat is ignored');
    assert.equal(Snake.turn(g, 'down'), true);
    Snake.step(g, rng);
    assert.equal(g.dir, 'down');
    // eating grows it and moves the food
    const e = Snake.newGame(rng, 8);
    e.food = [e.body[0][0] + 1, e.body[0][1]];
    Snake.step(e, rng);
    assert.deepEqual([e.score, e.body.length], [1, 4]);
    assert.notDeepEqual(e.food, e.body[0]);
    // a wall
    const w = Snake.newGame(rng, 5);
    for (let i = 0; i < 6 && w.status === 'play'; i++) Snake.step(w, rng);
    assert.equal(w.status, 'over');
    // itself: a long snake turning back into its body
    const s = Snake.newGame(rng, 10);
    s.body = [[5, 5], [5, 6], [6, 6], [6, 5], [6, 4], [5, 4]];
    s.dir = 'up'; s.food = [0, 0];
    Snake.turn(s, 'right');                // the head goes to (6,5): that is a body cell
    Snake.step(s, rng);
    assert.equal(s.status, 'over');
    // the tail cell is free: following it is not a collision
    const t = Snake.newGame(rng, 10);
    t.body = [[5, 5], [5, 6], [6, 6], [6, 5]]; t.dir = 'up'; t.food = [0, 0];
    Snake.turn(t, 'right');
    Snake.step(t, rng);
    assert.equal(t.status, 'play');
});

test('the three pages are served, have no inline script, and the lists know them', async () => {
    const site = await startSite();
    try {
        const games = await (await fetch(`${site.base}/pages/giochi.php`)).text();
        const map = await (await fetch(`${site.base}/sitemap.php`)).text();
        for (const g of ['memory', 'tris', 'snake']) {
            const html = await (await fetch(`${site.base}/pages/${g}.html`)).text();
            assert.match(html, /<meta name="description" content="[^"]{40,}">/, g);
            assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), g + ': no inline scripts');
            for (const f of [`/js/${g}.js`, `/css/${g}.css`, `/assets/${g}/icon.svg`, '/css/arcade.css']) assert.equal((await fetch(site.base + f)).status, 200, f);
            assert.ok(games.includes(`${g}.html`), g + ' in the game list');
            assert.ok(map.includes(`pages/${g}.html`), g + ' in the sitemap');
        }
    } finally { await site.stop(); }
});
