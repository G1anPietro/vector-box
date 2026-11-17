// tests/minato.test.js — Campo minato: the rules (seeded, no browser) and the page
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { startSite } = require('./helpers');
const M = require(path.join(__dirname, '..', 'public', 'js', 'minato.js'));

test('the first click is never a mine and (with room) opens a free area, for many seeds', () => {
    for (let seed = 1; seed <= 200; seed++) {
        const g = M.newGame('medium', M.makeRng(seed));
        const first = (seed * 37) % (g.w * g.h);
        const done = M.reveal(g, first);
        assert.equal(g.status === 'lost', false, `seed ${seed}`);
        assert.ok(done.length >= 1 && !g.bomb[first]);
        assert.equal(g.bomb.reduce((a, b) => a + b, 0), g.mines, 'the right number of mines');
        assert.equal(g.count[first], 0, 'a free area starts here');
    }
});

test('numbers count the neighbouring mines; flags block opening; opening a mine loses', () => {
    const g = M.newGame({ w: 3, h: 3, mines: 1 }, M.makeRng(5));
    M.reveal(g, 4);                                   // too small for a free area: only the cell itself is kept clear
    const bomb = g.bomb.indexOf(1);
    assert.ok(bomb >= 0 && bomb !== 4);
    for (let i = 0; i < 9; i++) assert.equal(g.count[i], M.neighbors(3, 3, i).filter((n) => n === bomb).length);
    const g2 = M.newGame({ w: 4, h: 4, mines: 3 }, M.makeRng(9));
    M.reveal(g2, 0);
    const m = g2.bomb.indexOf(1);
    assert.ok(M.toggleFlag(g2, m)); assert.deepEqual(M.reveal(g2, m), [], 'a flagged mine cannot be opened');
    M.toggleFlag(g2, m);
    assert.deepEqual(M.reveal(g2, m), [m]);
    assert.equal(g2.status, 'lost');
    assert.deepEqual(M.reveal(g2, 0), [], 'nothing after the end');
});

test('opening every safe cell wins; chording opens the neighbours of a satisfied number', () => {
    const g = M.newGame('easy', M.makeRng(42));
    M.reveal(g, 40);
    for (let i = 0; i < g.w * g.h; i++) if (!g.bomb[i]) M.reveal(g, i);
    assert.equal(g.status, 'won');
    assert.equal(M.win(g), true);

    const c = M.newGame({ w: 5, h: 1, mines: 1 }, M.makeRng(1));
    c.rng = () => 0;                                  // deterministic: the shuffle puts the mine at the far end
    M.reveal(c, 0);
    const mine = c.bomb.indexOf(1);
    const num = mine - 1;
    M.reveal(c, num);
    assert.ok(c.open[num] && c.count[num] === 1);
    assert.deepEqual(M.chord(c, num), [], 'no flag yet: nothing opens');
    M.toggleFlag(c, mine);
    M.chord(c, num);
    assert.notEqual(c.status, 'lost', 'a right flag: the chord is safe');
});

test('the page is served, has no inline script, and the game list and sitemap know it', async () => {
    const site = await startSite();
    try {
        const html = await (await fetch(`${site.base}/pages/minato.html`)).text();
        assert.match(html, /<meta name="description" content="[^"]{40,}"[^>]*>/);
        assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'no inline scripts (the CSP allows files only)');
        for (const f of ['/js/minato.js', '/css/minato.css', '/assets/minato/icon.svg']) assert.equal((await fetch(site.base + f)).status, 200, f);
        assert.match(await (await fetch(`${site.base}/pages/giochi.php`)).text(), /minato\.html/);
        assert.match(await (await fetch(`${site.base}/sitemap.php`)).text(), /pages\/minato\.html/);
    } finally { await site.stop(); }
});
