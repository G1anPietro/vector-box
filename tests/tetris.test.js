// tests/tetris.test.js — Tetris: the rules (seeded, no browser) and the page
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { startSite } = require('./helpers');
const T = require(path.join(__dirname, '..', 'public', 'js', 'tetris.js'));

test('every piece is 4 cells, turning it four times is the same shape, and the 7-bag gives all seven before repeating', () => {
    for (const [name, p] of Object.entries(T.PIECES)) {
        assert.equal(p.cells.length, 4, name);
        assert.deepEqual(T.rotCells(p.cells, p.size, 4), p.cells, name + ' four turns');
        assert.ok(p.cells.every(([x, y]) => x >= 0 && y >= 0 && x < p.size && y < p.size), name + ' inside its box');
        for (let r = 1; r < 4; r++) assert.ok(T.rotCells(p.cells, p.size, r).every(([x, y]) => x >= 0 && y >= 0 && x < p.size && y < p.size), name + ' turn ' + r);
    }
    const g = T.newGame(T.makeRng(7));
    const seen = [g.cur.type];
    for (let i = 0; i < 6; i++) { T.hardDrop(g); if (g.status !== 'play') break; seen.push(g.cur.type); }
    const g2 = T.newGame(T.makeRng(11));
    const bag = [g2.cur.type, g2.next];
    for (let i = 0; i < 5; i++) { g2.bag.length || null; bag.push(g2.bag.pop()); }
    assert.equal(new Set(bag).size, 7, 'the first seven pieces are all different');
});

test('moves stop at the walls, a piece falls to the floor, hard drop scores 2 per row and locks', () => {
    const g = T.newGame(T.makeRng(3));
    for (let i = 0; i < 20; i++) T.move(g, -1);
    assert.ok(T.cellsOf(g.cur).every(([x]) => x >= 0));
    assert.equal(T.move(g, -1), false, 'at the left wall');
    for (let i = 0; i < 20; i++) T.move(g, 1);
    assert.ok(T.cellsOf(g.cur).every(([x]) => x < T.W));
    const rows = T.hardDrop(g);
    assert.ok(rows > 10, 'fell far');
    assert.ok(g.score >= rows * 2);
    assert.equal(g.board[T.H - 1].some(Boolean), true, 'it is on the floor');
});

test('lines clear, score by lines x level, the level rises every 10 lines, and rotating next to a wall kicks', () => {
    const g = T.newGame(T.makeRng(5));
    g.board = Array.from({ length: T.H }, () => new Array(T.W).fill(0));
    for (const y of [16, 17, 18, 19]) for (let x = 0; x < T.W; x++) if (x < 3 || x > 6) g.board[y][x] = 3;   // four rows, each with a hole 4 wide (columns 3-6)
    for (const y of [17, 18, 19]) for (let x = 3; x <= 6; x++) g.board[y][x] = 3;                            // three of them filled in by hand
    g.cur = { type: 'I', rot: 0, x: 3, y: 15 };                                                               // a flat I: its cells are on row 16
    const n = T.lock(g);
    assert.equal(n, 4, 'four lines at once');
    assert.equal(g.score, 800 * 1);
    assert.equal(g.board.every((r) => r.every((c) => !c)), true, 'the board is empty again');
    g.lines = 9; g.level = 1;
    g.board[T.H - 1] = new Array(T.W).fill(3); g.board[T.H - 1][0] = 0;
    g.cur = { type: 'I', rot: 1, x: -2, y: 16 };               // vertical I whose column is x=0 (box x -2 + 2)
    T.lock(g);
    assert.equal(g.lines, 10);
    assert.equal(g.level, 2);
    // a vertical I against the right wall turns flat by kicking sideways
    const k = T.newGame(T.makeRng(1));
    k.cur = { type: 'I', rot: 1, x: 7, y: 5 };                // its column is x + 2 = 9, the last one
    assert.equal(T.rotate(k, 1), true);
    assert.ok(T.cellsOf(k.cur).every(([x]) => x >= 0 && x < T.W));
});

test('game over when a new piece has no room', () => {
    const g = T.newGame(T.makeRng(2));
    for (let i = 0; i < 40 && g.status === 'play'; i++) T.hardDrop(g);
    assert.equal(g.status, 'over');
    assert.equal(T.hardDrop(g), 0, 'nothing after the end');
    assert.ok(T.speed(1) > T.speed(10) && T.speed(50) >= 90);
});

test('the page is served, has no inline script, and the lists know it', async () => {
    const site = await startSite();
    try {
        const html = await (await fetch(`${site.base}/pages/tetris.html`)).text();
        assert.match(html, /<meta name="description" content="[^"]{40,}">/);
        assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html));
        for (const f of ['/js/tetris.js', '/css/tetris.css', '/assets/tetris/icon.svg']) assert.equal((await fetch(site.base + f)).status, 200, f);
        assert.match(await (await fetch(`${site.base}/pages/giochi.php`)).text(), /tetris\.html/);
        assert.match(await (await fetch(`${site.base}/sitemap.php`)).text(), /pages\/tetris\.html/);
    } finally { await site.stop(); }
});
