// tests/parola.test.js — "Parola del giorno": word lists, daily word, scoring, stats, share text, and the page
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { startSite } = require('./helpers');
const load = (n) => require(path.join(__dirname, '..', 'public', 'js', n));
const { ANSWERS, EXTRA } = load('parola-words.js');
const L = load('parola-logic.js');

test('word lists: 5 letters a-z, lowercase, unique, answers accepted as guesses', () => {
    for (const w of [...ANSWERS, ...EXTRA]) assert.match(w, /^[a-z]{5}$/, w);
    assert.equal(new Set(ANSWERS).size, ANSWERS.length, 'answers unique');
    assert.equal(new Set(EXTRA).size, EXTRA.length, 'extra unique');
    const acc = new Set([...ANSWERS, ...EXTRA]);
    assert.equal(acc.size, ANSWERS.length + EXTRA.length, 'lists do not overlap');
    assert.ok(ANSWERS.every((w) => acc.has(w)));
    assert.ok(ANSWERS.length >= 600 && ANSWERS.length <= 900, 'answers: ' + ANSWERS.length);
    assert.ok(EXTRA.length >= 900 && EXTRA.length <= 2500, 'extra: ' + EXTRA.length);
    for (const bad of ['vulva', 'cacca', 'fotti']) assert.ok(!acc.has(bad), bad);
});

test('daily word: same for the same day, a valid answer, changes with the date, not in list order', () => {
    const d = new Date(2026, 5, 15, 8, 0), same = new Date(2026, 5, 15, 23, 59);
    assert.equal(L.dailyWord(d, ANSWERS), L.dailyWord(same, ANSWERS));
    assert.ok(ANSWERS.includes(L.dailyWord(d, ANSWERS)));
    const seen = new Set();
    for (let i = 0; i < 60; i++) seen.add(L.dailyWord(new Date(2026, 0, 1 + i), ANSWERS));
    assert.ok(seen.size >= 58, 'consecutive days give different words');
    assert.notEqual(L.dailyWord(new Date(2026, 5, 16), ANSWERS), L.dailyWord(d, ANSWERS));
    // the shuffle is not the list order
    const first = ANSWERS.slice(0, 20), order = L.dailyOrder(ANSWERS).slice(0, 20);
    assert.notDeepEqual(first, order);
    assert.deepEqual(L.dailyOrder(ANSWERS), L.dailyOrder(ANSWERS), 'fixed seed');
    assert.equal(L.puzzleNumber(new Date(2026, 0, 1)), 1);
    assert.equal(L.puzzleNumber(new Date(2026, 0, 11)), 11);
});

test('score: right place, elsewhere, absent, and repeated letters', () => {
    const s = (g, a) => L.score(g, a).join('');
    assert.equal(s('cielo', 'cielo'), 'ccccc');
    assert.equal(s('vuoto', 'cielo'), 'aaaac', 'the last o is in the right place; the other o has nothing left');
    assert.equal(s('aaaaa', 'abcde'), 'caaaa', 'one a in the answer: only the right place counts');
    assert.equal(s('eeeee', 'abcde'), 'aaaac');
    assert.equal(s('lalla', 'palla'), 'acccc');
    // two l in the guess, one in the answer, none in the right place: only the first is marked elsewhere
    assert.equal(s('ellel', 'cielo'), 'ppaaa');
    // a green takes its letter before an earlier yellow can
    assert.equal(s('aaxxx', 'abate'), 'cpaaa');
    assert.equal(s('lllll', 'cielo'), 'aaaca');
    assert.equal(s('sassi', 'basso'), 'accca');
    // the green one comes later, the earlier same letter must NOT be yellow when the answer has only one
    assert.equal(s('ossoo', 'basso'), 'apcac');
});

test('keyStates: green beats yellow beats grey', () => {
    const ks = L.keyStates(['aaxxx', 'bxxxa'], [['c', 'p', 'a', 'a', 'a'], ['a', 'a', 'a', 'a', 'p']]);
    assert.equal(ks.a, 'c', 'a was green once');
    assert.equal(ks.x, 'a');
    assert.equal(ks.b, 'a');
});

test('share text never contains the answer and has the squares and the title', () => {
    const answer = 'cielo';
    const guesses = ['vuoto', 'ellel', answer];
    const sc = guesses.map((g) => L.score(g, answer));
    const t = L.shareText('Parola del giorno', 42, sc, true);
    assert.ok(!t.includes(answer) && !t.toUpperCase().includes(answer.toUpperCase()));
    for (const g of guesses) assert.ok(!t.includes(g));
    assert.match(t, /^Parola del giorno #42 3\/6\n/);
    assert.equal(t.split('\n').length, 2 + 3);
    assert.ok(t.includes('\u{1F7E9}\u{1F7E9}\u{1F7E9}\u{1F7E9}\u{1F7E9}'));
    const lost = L.shareText('Parola del giorno', 42, sc, false);
    assert.match(lost, /#42 X\/6/);
    assert.ok(!/[a-z]{5}/.test(lost.split('\n').slice(2).join('')));
});

test('stats: streak counts consecutive daily wins, a loss or a skipped day breaks it', () => {
    let s = L.addResult(null, 10, true, 3);
    assert.deepEqual([s.played, s.won, s.streak, s.best, s.dist[2]], [1, 1, 1, 1, 1]);
    s = L.addResult(s, 11, true, 4);
    assert.equal(s.streak, 2);
    assert.equal(L.addResult(s, 11, false, 6).played, 2, 'the same day is not counted twice');
    assert.equal(L.shownStreak(s, 11), 2);
    assert.equal(L.shownStreak(s, 12), 2, 'yesterday won: still alive');
    assert.equal(L.shownStreak(s, 13), 0, 'a day skipped');
    const skip = L.addResult(s, 13, true, 2);
    assert.equal(skip.streak, 1);
    assert.equal(skip.best, 2);
    const lost = L.addResult(s, 12, false, 6);
    assert.equal(lost.streak, 0);
    assert.equal(L.addResult(lost, 13, true, 1).streak, 1);
});

test('the page is served, loads its scripts in order, has no inline script, and is in the game list and sitemap', async () => {
    const site = await startSite();
    try {
        const html = await (await fetch(`${site.base}/pages/parola.html`)).text();
        assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'no inline scripts');
        assert.ok(!/\son\w+="/i.test(html), 'no inline handlers');
        const srcs = [...html.matchAll(/<script src="\.\.\/js\/([a-z0-9-]+\.js)/g)].map((m) => m[1]);
        assert.deepEqual(srcs, ['i18n.js', 'parola-words.js', 'parola-logic.js', 'parola.js']);
        for (const f of ['/js/parola.js', '/js/parola-logic.js', '/js/parola-words.js', '/css/parola.css', '/assets/parola/icon.svg', '/css/arcade.css']) assert.equal((await fetch(site.base + f)).status, 200, f);
        assert.match(await (await fetch(`${site.base}/pages/giochi.php`)).text(), /parola\.html/);
        assert.match(await (await fetch(`${site.base}/sitemap.php`)).text(), /pages\/parola\.html/);
    } finally { await site.stop(); }
});
