// tests/dueamila.test.js — 2048: the rules (no browser) and the page
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { startSite } = require('./helpers');
const G = require(path.join(__dirname, '..', 'public', 'js', 'dueamila.js'));

test('a row slides left and each tile merges once per move', () => {
    assert.deepEqual(G.slideRow([2, 2, 2, 2]), [[4, 4, 0, 0], 8]);
    assert.deepEqual(G.slideRow([2, 2, 4, 0]), [[4, 4, 0, 0], 4]);
    assert.deepEqual(G.slideRow([4, 2, 2, 8]), [[4, 4, 8, 0], 4]);
    assert.deepEqual(G.slideRow([0, 0, 0, 2]), [[2, 0, 0, 0], 0]);
    assert.deepEqual(G.slideRow([2, 4, 2, 4]), [[2, 4, 2, 4], 0]);
});

test('moves in the four directions; a move that changes nothing is not a move', () => {
    const b = [2, 0, 0, 2,  0, 0, 0, 0,  0, 4, 0, 0,  0, 4, 0, 0];
    assert.deepEqual(G.move(b, 'left').board, [4, 0, 0, 0,  0, 0, 0, 0,  4, 0, 0, 0,  4, 0, 0, 0]);
    assert.deepEqual(G.move(b, 'right').board, [0, 0, 0, 4,  0, 0, 0, 0,  0, 0, 0, 4,  0, 0, 0, 4]);
    assert.deepEqual(G.move(b, 'down').board, [0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  2, 8, 0, 2]);
    const up = G.move(b, 'up');
    assert.deepEqual(up.board.slice(0, 4), [2, 8, 0, 2]);
    assert.equal(up.gained, 8);
    assert.equal(G.move(up.board, 'up').moved, false);
});

test('a new tile goes on a free cell only; no moves left on a full board without pairs', () => {
    const rng = () => 0;
    const b = G.addTile([2, 4, 2, 4,  4, 2, 4, 2,  2, 4, 2, 4,  4, 2, 4, 0], rng);
    assert.equal(b[15], 2);
    assert.equal(G.canMove(b), false, 'a full checkerboard is stuck');
    assert.equal(G.canMove([2, 2, 4, 8,  16, 32, 64, 128,  2, 4, 8, 16,  32, 64, 128, 256]), true, 'one pair left');
    assert.deepEqual(G.addTile(b, rng), b, 'nothing to add on a full board');
});

test('the page is served, has no inline script, and the lists know it', async () => {
    const site = await startSite();
    try {
        const html = await (await fetch(`${site.base}/pages/dueamila.html`)).text();
        assert.match(html, /<meta name="description" content="[^"]{40,}"[^>]*>/);
        assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html));
        for (const f of ['/js/dueamila.js', '/css/dueamila.css', '/assets/dueamila/icon.svg']) assert.equal((await fetch(site.base + f)).status, 200, f);
        assert.match(await (await fetch(`${site.base}/pages/giochi.php`)).text(), /dueamila\.html/);
        assert.match(await (await fetch(`${site.base}/sitemap.php`)).text(), /pages\/dueamila\.html/);
    } finally { await site.stop(); }
});
