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

test('botola: skill zone shrinks and speeds up with the rounds; inZone wraps around 360', () => {
    assert.ok(B.skillFor(5).size < B.skillFor(1).size && B.skillFor(5).speed > B.skillFor(1).speed);
    assert.ok(B.skillFor(99).size >= 24 && B.skillFor(99).speed <= 520);
    assert.equal(B.inZone(100, 90, 30), true); assert.equal(B.inZone(130, 90, 30), false);
    assert.equal(B.inZone(10, 340, 40), true, 'zone crossing 0°'); assert.equal(B.inZone(80, 340, 40), false);
});

test('botola: a fall, the last one standing wins; two players need at least two names', () => {
    assert.equal(B.newGame(['Solo', ' ']), null);
    const g = B.newGame(['A', 'B', 'C'], seq(0.5));
    B.begin(g); assert.equal(B.answer(g, true), 'safe');           // A right
    B.begin(g); assert.equal(B.answer(g, false), 'trap'); assert.equal(B.skill(g, false), 'fell');   // B wrong, falls
    B.begin(g); B.answer(g, true);                                  // C right: round over
    assert.deepEqual(g.players.map((p) => p.out), [false, true, false]); assert.equal(g.round, 2); assert.equal(g.turn, 0);
    B.begin(g); B.answer(g, false); B.skill(g, true);               // A wrong but hangs on
    B.begin(g); B.answer(g, false); B.skill(g, false);              // C wrong, falls
    assert.equal(g.phase, 'over'); assert.equal(g.winner, 0);
});

test('botola: if everybody would fall in a round, nobody does', () => {
    const g = B.newGame(['A', 'B'], seq(0.5));
    B.begin(g); B.answer(g, false); B.skill(g, false);
    B.begin(g); B.answer(g, false); B.skill(g, false);
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
