// tests/arcade2.test.js — Forza 4, Impiccato and Simon: the rules (no browser) and the pages
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { startSite } = require('./helpers');
const load = (n) => require(path.join(__dirname, '..', 'public', 'js', n));
const F4 = load('forza4.js'), Im = load('impiccato.js'), Sm = load('simon.js');

test('forza 4: discs fall, four in a row win in every direction, a full column is refused', () => {
    const b = F4.newBoard();
    assert.equal(F4.drop(b, 3, 1), 5, 'lands on the bottom');
    assert.equal(F4.drop(b, 3, 2), 4, 'and the next one on top');
    for (let i = 0; i < 4; i++) F4.drop(b, 3, 1);
    assert.equal(F4.drop(b, 3, 1), -1, 'column full');
    for (const [name, cells] of Object.entries({
        horizontal: [[5, 0], [5, 1], [5, 2], [5, 3]], vertical: [[2, 6], [3, 6], [4, 6], [5, 6]],
        diagonal: [[5, 0], [4, 1], [3, 2], [2, 3]], antidiagonal: [[2, 0], [3, 1], [4, 2], [5, 3]] })) {
        const g = F4.newBoard();
        cells.forEach(([r, c]) => { g[r][c] = 2; });
        assert.equal(F4.winner(g), 2, name);
        assert.equal(F4.fourOf(g, 2).length, 4);
    }
    assert.equal(F4.winner(F4.newBoard()), 0);
    const full = F4.newBoard();
    for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) full[r][c] = (c + Math.floor(r / 2)) % 2 ? 1 : 2;   // columns alternate in pairs: no four in a row
    assert.equal(F4.winner(full), 'draw');
});

test('forza 4 computer: takes a win, blocks a win, never plays a full column, and the hard one beats a naive player', () => {
    const rng = () => 0;
    for (const level of ['easy', 'medium', 'hard']) {
        const win = F4.newBoard();                          // yellow (2) has three in the bottom row: columns 0-2, column 3 wins
        [0, 1, 2].forEach((c) => F4.drop(win, c, 2));
        assert.equal(F4.bestMove(win, 2, level, rng), 3, level + ' takes the win');
        const block = F4.newBoard();                        // red has three: yellow must play column 3
        [0, 1, 2].forEach((c) => F4.drop(block, c, 1));
        assert.equal(F4.bestMove(block, 2, level, rng), 3, level + ' blocks');
    }
    const g = F4.newBoard();
    for (let i = 0; i < 6; i++) F4.drop(g, 3, i % 2 ? 1 : 2);
    for (const level of ['easy', 'medium', 'hard']) assert.notEqual(F4.bestMove(g, 1, level, rng), 3, 'column 3 is full');
    // a naive player (always the leftmost free column) loses to the hard computer
    let board = F4.newBoard(), turn = 1, guard = 0;
    while (!F4.winner(board) && guard++ < 50) {
        const col = turn === 1 ? F4.validCols(board).sort((a, c) => a - c)[0] : F4.bestMove(board, 2, 'hard', rng);
        F4.drop(board, col, turn); turn = F4.other(turn);
    }
    assert.equal(F4.winner(board), 2);
});

test('impiccato: accents count as the plain letter, repeats cost nothing, lives run out, the word fills in', () => {
    assert.equal(Im.norm('perché'), 'PERCHE');
    const g = Im.newGame('Città');
    assert.equal(g.word, 'CITTA');
    assert.equal(Im.shown(g), '_ _ _ _ _');
    assert.equal(Im.guess(g, 't'), 'hit');
    assert.equal(Im.guess(g, 'T'), 'again');
    assert.equal(Im.guess(g, '7'), 'ignored');
    assert.equal(Im.guess(g, 'z'), 'miss');
    assert.equal(Im.guess(g, 'z'), 'again');
    assert.equal(g.lives, 6);
    assert.equal(Im.shown(g), '_ _ T T _');
    'cia'.split('').forEach((l) => Im.guess(g, l));
    assert.equal(g.status, 'won');
    assert.equal(Im.guess(g, 'x'), 'ignored', 'nothing after the end');
    const l = Im.newGame('sole');
    'bcdfghjkmn'.split('').forEach((x) => Im.guess(l, x));
    assert.deepEqual([l.status, l.lives], ['lost', 0]);
    assert.equal(Im.shown(l), 'S O L E', 'the word is shown at the end');
    for (const [cat, list] of Object.entries(Im.WORDS)) for (const w of list) assert.match(w, /^[A-Z]+$/, cat + ': ' + w);
    const p = Im.pick('animali', () => 0, 'ELEFANTE');
    assert.notEqual(p.word, 'ELEFANTE', 'not the same word twice');
});

test('simon: the sequence grows by one, a right repeat wins the round, a wrong pad loses', () => {
    let n = 0;
    const g = Sm.newGame(() => [0, 0.3, 0.6, 0.9][n++ % 4]);      // pads 0, 1, 2, 3
    assert.equal(Sm.press(g, 0), 'ignored', 'not your turn yet');
    assert.deepEqual(Sm.nextRound(g), [0]);
    assert.equal(Sm.press(g, 0), 'round');
    assert.deepEqual(Sm.nextRound(g), [0, 1]);
    assert.equal(Sm.press(g, 0), 'ok');
    assert.equal(Sm.press(g, 1), 'round');
    assert.equal(g.score, 2);
    Sm.nextRound(g);
    assert.equal(Sm.press(g, 3), 'lost');
    assert.equal(Sm.press(g, 0), 'ignored');
    assert.ok(Sm.pace(1) > Sm.pace(20) && Sm.pace(50) >= 260);
});

test('the three pages are served, have no inline script, and the lists know them', async () => {
    const site = await startSite();
    try {
        const games = await (await fetch(`${site.base}/pages/giochi.php`)).text();
        const map = await (await fetch(`${site.base}/sitemap.php`)).text();
        for (const g of ['forza4', 'impiccato', 'simon']) {
            const html = await (await fetch(`${site.base}/pages/${g}.html`)).text();
            assert.match(html, /<meta name="description" content="[^"]{40,}"[^>]*>/, g);
            assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), g + ': no inline scripts');
            for (const f of [`/js/${g}.js`, `/css/${g}.css`, `/assets/${g}/icon.svg`, '/css/arcade.css']) assert.equal((await fetch(site.base + f)).status, 200, f);
            assert.ok(games.includes(`${g}.html`), g + ' in the game list');
            assert.ok(map.includes(`pages/${g}.html`), g + ' in the sitemap');
        }
    } finally { await site.stop(); }
});
