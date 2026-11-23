// tests/botola.test.js — Botola: the rules (no browser) and the page
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { startSite } = require('./helpers');
const B = require(path.join(__dirname, '..', 'public', 'js', 'botola.js'));

const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };

const vm = require('node:vm');
function loadQ(lang) { const sandbox = {}; vm.runInNewContext(require('node:fs').readFileSync(path.join(__dirname, '..', 'public', 'js', `botola-q-${lang}.js`), 'utf8'), { window: sandbox }); return sandbox['BotolaQ_' + lang]; }
const DATA = { en: loadQ('en'), it: loadQ('it') };

test('botola: the question files match (same count and difficulty), 4 distinct answers, plenty of each difficulty', () => {
    assert.equal(DATA.en.length, DATA.it.length);
    assert.ok(DATA.en.length >= 1000, 'a big pool');
    for (const d of [0, 1, 2]) assert.ok(DATA.en.filter((q) => q[0] === d).length >= 150, 'difficulty ' + d);
    DATA.en.forEach((q, i) => {
        assert.equal(q[0], DATA.it[i][0], 'row ' + i);
        for (const row of [q, DATA.it[i]]) { assert.equal(row.length, 6); assert.equal(new Set(row.slice(2)).size, 4, 'row ' + i); assert.ok(row.slice(1).every((x) => typeof x === 'string' && x.trim())); }
    });
});

test('botola: ask() shuffles the answers and keeps the right one; levels pick the difficulty', () => {
    for (let i = 0; i < DATA.en.length; i += 7) for (const lang of ['it', 'en']) {
        const q = B.ask(DATA, i, lang);
        assert.equal(q.options[q.right], DATA[lang][i][2]); assert.equal(q.options.length, 4);
    }
    assert.deepEqual([1, 2, 3, 4, 5, 6, 9].map((r) => B.difficultyFor('rising', r)), [0, 0, 1, 1, 2, 2, 2]);
    assert.equal(B.difficultyFor('easy', 9), 0); assert.equal(B.difficultyFor('hard', 1), 2); assert.equal(B.difficultyFor('normal', 5), 1);
    assert.ok(B.LEVELS.easy.time > B.LEVELS.normal.time && B.LEVELS.normal.time > B.LEVELS.hard.time);
});

test('botola: a level only draws questions of its difficulty and never repeats one', () => {
    const g = B.newGame(['A', 'B'], 'hard', DATA);
    const seen = new Set();
    for (let i = 0; i < 100; i++) { const q = B.begin(g); assert.equal(DATA.en[q][0], 2); assert.ok(!seen.has(q)); seen.add(q); g.phase = 'ready'; }
});

test('botola: a wrong answer drops the player; the last one standing wins; one name is not enough', () => {
    assert.equal(B.newGame(['Solo', ' '], 'easy', DATA), null);
    const g = B.newGame(['A', 'B', 'C'], 'normal', DATA, seq(0.5));
    B.begin(g); assert.equal(B.answer(g, true), 'safe');           // A right
    B.begin(g); assert.equal(B.answer(g, false), 'fell');          // B wrong, falls
    B.begin(g); B.answer(g, true);                                  // C right: round over
    assert.deepEqual(g.players.map((p) => p.out), [false, true, false]); assert.equal(g.round, 2); assert.equal(g.turn, 0);
    B.begin(g); B.answer(g, true);
    B.begin(g); B.answer(g, false);                                 // C wrong, falls
    assert.equal(g.phase, 'over'); assert.equal(g.winner, 0);
});

test('botola: if everybody would fall in a round, nobody does', () => {
    const g = B.newGame(['A', 'B'], 'normal', DATA, seq(0.5));
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
        for (const f of ['/js/botola.js', '/js/botola-q-it.js', '/js/botola-q-en.js', '/css/botola.css', '/assets/botola/icon.svg']) assert.equal((await fetch(site.base + f)).status, 200, f);
        assert.ok((await (await fetch(`${site.base}/pages/giochi.php`)).text()).includes('botola.html'));
        assert.ok((await (await fetch(`${site.base}/sitemap.php`)).text()).includes('pages/botola.html'));
    } finally { await site.stop(); }
});

const S = require(path.join(__dirname, '..', 'public', 'js', 'skillcheck.js'));
test('skillcheck: the zone shrinks and the needle speeds up but stay within limits; wrap-around; a pass is a miss', () => {
    assert.ok(S.levelFor(10).size < S.levelFor(0).size && S.levelFor(10).speed > S.levelFor(0).speed);
    assert.ok(S.levelFor(999, 'hard').size >= 10 && S.levelFor(999, 'hard').speed <= 520);
    assert.ok(S.levelFor(0, 'easy').size > S.levelFor(0).size && S.levelFor(0, 'easy').speed < S.levelFor(0).speed);
    assert.ok(S.levelFor(0, 'hard').size < S.levelFor(0).size && S.levelFor(0, 'hard').speed > S.levelFor(0).speed);
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
