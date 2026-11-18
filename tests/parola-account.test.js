// tests/parola-account.test.js — "Parola del giorno" stats on the account: api/parola.php, export and erase.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client } = require('./helpers');

let site;
test.before(async () => { site = await startSite(); });
test.after(() => site.stop());

const clear = () => { try { site.db('DELETE FROM rate_limits'); } catch (e) { /* no table yet */ } };
async function user(name) { clear(); const c = new Client(site); const r = await c.register(name); assert.equal(r.status, 200); return c; }
const day = Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / 86400000);
const good = () => ({
    stats: { played: 3, won: 2, streak: 1, best: 2, last: day, lastWin: true, dist: [0, 1, 1, 0, 0, 0] },
    daily: { day, guesses: ['abete', 'cielo'], over: false },
});

test('guests get 401 on GET and POST', async () => {
    const g = new Client(site); await g.init();
    assert.equal((await g.get('/api/parola.php')).status, 401);
    assert.equal((await g.post('/api/parola.php', good())).status, 401);
});

test('POST needs the CSRF token', async () => {
    const c = await user('pa_csrf');
    assert.equal((await c.request('POST', '/api/parola.php', { body: good(), csrf: false })).status, 403);
});

test('GET is null before the first save; the round trip returns what was saved (with the 6-letter data)', async () => {
    const c = await user('pa_round');
    assert.equal((await c.get('/api/parola.php')).json.data, null);
    const body = { ...good(), stats6: good().stats, daily6: { day, guesses: ['giorno'], over: false } };
    assert.equal((await c.post('/api/parola.php', body)).json.success, true);
    const d = (await c.get('/api/parola.php')).json.data;
    assert.deepEqual(d.stats.dist, [0, 1, 1, 0, 0, 0]);
    assert.deepEqual(d.daily.guesses, ['abete', 'cielo']);
    assert.deepEqual(d.daily.d6.guesses, ['giorno']);
    assert.equal(d.stats.s6.played, 3);
    // a second save replaces the row
    const b2 = good(); b2.stats.played = 4; b2.stats.won = 3;
    assert.equal((await c.post('/api/parola.php', b2)).status, 200);
    assert.equal((await c.get('/api/parola.php')).json.data.stats.played, 4);
});

test('validation rejects bad input', async () => {
    const c = await user('pa_bad');
    const bad = (mut) => { const b = good(); mut(b); return c.post('/api/parola.php', b); };
    const cases = [
        (b) => { b.stats.played = -1; },
        (b) => { b.stats.played = 1e9; },
        (b) => { b.stats.won = 'x'; },
        (b) => { b.stats.won = 9; },                       // more won than played
        (b) => { b.stats.streak = 3; },                    // streak above best
        (b) => { b.stats.dist = [0, 0, 0]; },
        (b) => { b.stats.dist = [0, 0, 0, 0, 0, -1]; },
        (b) => { b.stats.last = '2026-01-01'; },
        (b) => { b.daily.guesses = ['abete', 'cielo', 'abete', 'cielo', 'abete', 'cielo', 'abete']; },
        (b) => { b.daily.guesses = ['abet']; },
        (b) => { b.daily.guesses = ['ABETE']; },
        (b) => { b.daily.guesses = ['abet3']; },
        (b) => { b.daily.guesses = [['abete']]; },
        (b) => { b.daily.day = day + 5; },                 // the future
        (b) => { b.daily = 'x'; },
        (b) => { delete b.stats; },
        (b) => { b.daily6 = { day, guesses: ['abete'], over: false }; b.stats6 = b.stats; },   // 5 letters in the 6-letter mode
    ];
    for (const m of cases) assert.equal((await bad(m)).status, 400, m.toString());
    const big = good(); big.pad = 'x'.repeat(5000);
    assert.equal((await c.post('/api/parola.php', big)).status, 413);
    assert.equal((await c.get('/api/parola.php')).json.data, null, 'nothing was saved');
});

test('one user cannot read or overwrite another user row', async () => {
    const a = await user('pa_a'), b = await user('pa_b');
    await a.post('/api/parola.php', good());
    assert.equal((await b.get('/api/parola.php')).json.data, null);
    const mine = good(); mine.stats.played = 9; mine.stats.won = 1; mine.stats.best = 1;
    await b.post('/api/parola.php', mine);
    assert.equal((await a.get('/api/parola.php')).json.data.stats.played, 3);
});

test('rate limit: 60 saves an hour', async () => {
    const c = await user('pa_rate');
    clear();
    let last = 200;
    for (let i = 0; i < 61; i++) last = (await c.post('/api/parola.php', good())).status;
    assert.equal(last, 429);
});

test('the export lists the row and erasing the account deletes it', async () => {
    const c = await user('pa_gone');
    await c.post('/api/parola.php', good());
    const exp = (await c.get('/api/account_data.php?action=export')).json;
    assert.equal(exp.parola_stats.length, 1);
    assert.equal(JSON.parse(exp.parola_stats[0].stats).played, 3);
    const id = site.db("SELECT id FROM accounts WHERE username = 'pa_gone'")[0].id;
    clear();
    const del = await c.post('/api/account_data.php', { action: 'delete', password: 'password123', delete_materials: true });
    assert.equal(del.json.success, true);
    assert.equal(site.db('SELECT COUNT(*) n FROM parola_stats WHERE user_id = ?', [id])[0].n, 0);
});
