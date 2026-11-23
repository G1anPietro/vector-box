// tests/botola.test.js — Botola: the rules (no browser) and the page
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { startSite } = require('./helpers');
const B = require(path.join(__dirname, '..', 'public', 'js', 'botola.js'));

const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };

test('botola: every question has 4 distinct answers in both languages, the shuffle keeps the right one', () => {
    for (let i = 0; i < B.Q.length; i++) for (const lang of ['it', 'en']) {
        const q = B.ask(i, lang, Math.random);
        assert.equal(new Set(q.options).size, 4, `${i} ${lang}`);
        assert.ok(q.text.length > 8);
        const expected = B.Q[i][2].split('|'); assert.equal(q.options[q.right], lang === 'it' ? expected[0] : (expected[1] || expected[0]));
    }
});

test('botola: a wrong answer drops the player; the last one standing wins; one name is not enough', () => {
    assert.equal(B.newGame(['Solo', ' ']), null);
    const g = B.newGame(['A', 'B', 'C'], seq(0.5));
    B.begin(g); assert.equal(B.answer(g, true), 'safe');           // A right
    B.begin(g); assert.equal(B.answer(g, false), 'fell');          // B wrong, falls
    B.begin(g); B.answer(g, true);                                  // C right: round over
    assert.deepEqual(g.players.map((p) => p.out), [false, true, false]); assert.equal(g.round, 2); assert.equal(g.turn, 0);
    B.begin(g); B.answer(g, true);
    B.begin(g); B.answer(g, false);                                 // C wrong, falls
    assert.equal(g.phase, 'over'); assert.equal(g.winner, 0);
});

test('botola: if everybody would fall in a round, nobody does', () => {
    const g = B.newGame(['A', 'B'], seq(0.5));
    B.begin(g); B.answer(g, false);
    B.begin(g); B.answer(g, false);
    assert.equal(g.nobody, true); assert.deepEqual(g.players.map((p) => p.out), [false, false]);
    assert.equal(g.phase, 'ready'); assert.equal(g.round, 2);
});

test('botola: the page is served, has no inline script, is in the game list and the sitemap', async () => {
    const site = await startSite();
    try {
        const html = await (await fetch(`${site.base}/pages/botola.html`)).text();
        assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'no inline scripts');
        for (const f of ['/js/botola.js', '/css/botola.css', '/assets/botola/icon.svg']) assert.equal((await fetch(site.base + f)).status, 200, f);
        assert.ok((await (await fetch(`${site.base}/pages/giochi.php`)).text()).includes('botola.html'));
        assert.ok((await (await fetch(`${site.base}/sitemap.php`)).text()).includes('pages/botola.html'));
    } finally { await site.stop(); }
});

const S = require(path.join(__dirname, '..', 'public', 'js', 'skillcheck.js'));
test('skillcheck: the zone shrinks and the needle speeds up but stay within limits; wrap-around; a pass is a miss', () => {
    assert.ok(S.levelFor(10).size < S.levelFor(0).size && S.levelFor(10).speed > S.levelFor(0).speed);
    assert.ok(S.levelFor(999).size >= 14 && S.levelFor(999).speed <= 440);
    assert.equal(S.tap(100, 90, 30), 'hit'); assert.equal(S.tap(130, 90, 30), 'miss'); assert.equal(S.tap(10, 340, 40), 'hit');
    assert.equal(S.passed(121, 90, 30), true); assert.equal(S.passed(119, 90, 30), false);
    for (let i = 0; i < 200; i++) { const z = S.zoneStart(S.levelFor(0).size); assert.ok(z >= 80 && z + S.levelFor(0).size <= 340); }
});

test('skillcheck: the page is served, no inline script, in the game list and the sitemap', async () => {
    const site = await startSite();
    try {
        const html = await (await fetch(`${site.base}/pages/skillcheck.html`)).text();
        assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'no inline scripts');
        for (const f of ['/js/skillcheck.js', '/css/skillcheck.css', '/assets/skillcheck/icon.svg']) assert.equal((await fetch(site.base + f)).status, 200, f);
        assert.ok((await (await fetch(`${site.base}/pages/giochi.php`)).text()).includes('skillcheck.html'));
        assert.ok((await (await fetch(`${site.base}/sitemap.php`)).text()).includes('pages/skillcheck.html'));
    } finally { await site.stop(); }
});
