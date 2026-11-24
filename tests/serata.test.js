'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../public/js/serata.js');

test('serata: decks are [it, en] and "rather" cards come in pairs', () => {
    for (const d of [S.LIKELY, S.RATHER, S.BOMB]) for (const c of d) assert.equal(c.length, 2) && assert.ok(c[0] && c[1]);
    assert.equal(S.RATHER.length % 2, 0);
});
test('serata: draw never repeats until the whole deck was seen, nor the last card', () => {
    const st = {}, seen = [];
    for (let i = 0; i < 10; i++) seen.push(S.draw(st, 10));
    assert.equal(new Set(seen).size, 10);
    for (let i = 0; i < 200; i++) { const last = st.last; assert.notEqual(S.draw(st, 10), last); }
});
test('serata: the bomb fuse is between 12 and 40 seconds', () => {
    assert.equal(S.fuse(() => 0), 12000);
    assert.ok(S.fuse(() => 0.999999) < 40000);
});
