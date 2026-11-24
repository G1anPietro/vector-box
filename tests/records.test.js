// tests/records.test.js — personal records of the solo games on the account: rules, merging, privacy, the Account page, export/deletion
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { startSite, Client } = require('./helpers');

let site;
test.before(async () => { site = await startSite(); });
test.after(() => site.stop());

const user = async (name) => {
    try { site.db('DELETE FROM rate_limits'); } catch (e) { /* not created yet */ }
    const c = await new Client(site).init(); await c.register(name); return c;
};

test('migration V47 created personal_records', async () => {
    await fetch(`${site.base}/api/rooms.php`);
    assert.ok(site.db('PRAGMA user_version')[0].user_version >= 47);
    assert.ok(site.db("SELECT name FROM sqlite_master WHERE name = 'personal_records'").length);
});

test('submit keeps the better value (highest, or lowest for Memory) and tells if it improved', async () => {
    const c = await user('rec_a');
    const sub = (game, variant, value) => c.post('/api/records.php', { action: 'submit', game, variant, value });
    assert.deepEqual([(await sub('skillcheck', 'hard', 10)).json.best, (await sub('skillcheck', 'hard', 10)).json.improved], [10, false]);
    let r = (await sub('skillcheck', 'hard', 25)).json; assert.deepEqual([r.best, r.improved], [25, true]);
    r = (await sub('skillcheck', 'hard', 7)).json; assert.deepEqual([r.best, r.improved], [25, false], 'a worse result does not replace the record');
    await sub('skillcheck', 'hard-endless', 40);
    assert.equal((await sub('memory', 'easy', 30)).json.best, 30);
    r = (await sub('memory', 'easy', 18)).json; assert.deepEqual([r.best, r.improved], [18, true], 'fewer moves is better');
    assert.equal((await sub('memory', 'easy', 25)).json.best, 18);
    assert.equal((await sub('simon', '', 12)).json.best, 12);
    assert.equal((await sub('difesa', '', 30)).json.best, 30);
});

test('rules: unknown game or variant, silly or non-integer values, no login, no CSRF', async () => {
    const c = await user('rec_b');
    const sub = (body) => c.post('/api/records.php', { action: 'submit', ...body });
    assert.equal((await sub({ game: 'nope', variant: '', value: 5 })).status, 400);
    assert.equal((await sub({ game: 'skillcheck', variant: 'impossible', value: 5 })).status, 400);
    assert.equal((await sub({ game: 'skillcheck', variant: 'easy', value: -3 })).status, 400);
    assert.equal((await sub({ game: 'skillcheck', variant: 'easy', value: 99999999 })).status, 400);
    assert.equal((await sub({ game: 'skillcheck', variant: 'easy', value: '7' })).status, 400, 'a string is not a value');
    assert.equal((await sub({ game: 'skillcheck', variant: 'easy', value: 1.5 })).status, 400);
    assert.equal((await sub({ game: 'difesa', variant: '', value: 31 })).status, 400, 'more waves than the game has');
    assert.equal((await c.post('/api/records.php', { action: 'nope', game: 'simon' })).status, 400);
    assert.equal((await new Client(site).post('/api/records.php', { action: 'submit', game: 'simon', variant: '', value: 3 })).status, 401, 'a guest');
    const noCsrf = await fetch(`${site.base}/api/records.php`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: c.cookieHeader() }, body: JSON.stringify({ action: 'submit', game: 'simon', variant: '', value: 3 }) });
    assert.notEqual(noCsrf.status, 200, 'no CSRF token, no record');
});

test('sync merges the phone with the account and answers with the merged bests; silly values are ignored', async () => {
    const c = await user('rec_c');
    const sync = (game, bests) => c.post('/api/records.php', { action: 'sync', game, bests });
    let r = (await sync('botola', { easy: 12, rising: 30, hard: -4, nope: 5, normal: 'x' })).json;
    assert.deepEqual(r.bests, { easy: 12, rising: 30 }, 'only the believable ones');
    r = (await sync('botola', { easy: 5, rising: 45, hard: 8 })).json;
    assert.deepEqual(r.bests, { easy: 12, rising: 45, hard: 8 }, 'the better of each');
    r = (await sync('memory', { easy: 20 })).json; assert.deepEqual(r.bests, { easy: 20 });
    r = (await sync('memory', { easy: 35, hard: 60 })).json; assert.deepEqual(r.bests, { easy: 20, hard: 60 }, 'lower wins in Memory');
    assert.equal((await sync('nope', { a: 1 })).status, 400);
    assert.deepEqual((await sync('simon', {})).json.bests, {}, 'nothing to merge, nothing stored');
});

test('GET lists my records, including the leaderboard games; they are private to the account', async () => {
    const a = await user('rec_d'), b = await user('rec_e');
    await a.post('/api/records.php', { action: 'submit', game: 'simon', variant: '', value: 9 });
    site.db("INSERT INTO game_scores (user_id, game, variant, score, created_at) VALUES ((SELECT id FROM accounts WHERE username = 'rec_d'), 'tetris', '', 4200, ?)", [Math.floor(Date.now() / 1000)]);
    const mine = (await a.get('/api/records.php')).json.records;
    assert.equal(mine.simon[''].best, 9); assert.equal(mine.tetris[''].best, 4200);
    assert.deepEqual((await b.get('/api/records.php')).json.records, {}, "someone else's records are not mine");
    assert.equal((await new Client(site).get('/api/records.php')).status, 401);
});

test('Account page: a Records tab and section, names in both languages, the minesweeper time in seconds', async () => {
    const c = await user('rec_f');
    let html = (await c.get('/pages/account.php?lang=en')).text;
    assert.match(html, /<a href="#records">Records<\/a>/); assert.match(html, /No records yet/);
    await c.post('/api/records.php', { action: 'submit', game: 'skillcheck', variant: 'normal-endless', value: 27 });
    await c.post('/api/records.php', { action: 'submit', game: 'memory', variant: 'hard', value: 22 });
    site.db("INSERT INTO game_scores (user_id, game, variant, score, created_at) VALUES ((SELECT id FROM accounts WHERE username = 'rec_f'), 'minato', 'easy', 12500, ?)", [Math.floor(Date.now() / 1000)]);
    html = (await c.get('/pages/account.php?lang=en')).text;
    assert.match(html, /Normal · endless[\s\S]*?<b>27 hits<\/b>/); assert.match(html, /Hard[\s\S]*?<b>22 moves<\/b>/); assert.match(html, /<b>12\.5 s<\/b>/);
    html = (await c.get('/pages/account.php?lang=it')).text;
    assert.match(html, /I tuoi record/); assert.match(html, /Normale · infinita[\s\S]*?<b>27 colpi<\/b>/); assert.match(html, /<b>12,5 s<\/b>/);
    assert.ok(!html.includes('rec_g'), 'only my own');
});

test('account data: records are in the export and removed with the account; privacy names them', async () => {
    const c = await user('rec_g');
    await c.post('/api/records.php', { action: 'submit', game: 'simon', variant: '', value: 14 });
    const uid = site.db("SELECT id FROM accounts WHERE username = 'rec_g'")[0].id;
    const dump = (await c.get('/api/account_data.php?action=export')).text;
    assert.ok(dump.includes('game_records'), 'export has game_records');
    const del = await c.post('/api/account_data.php', { action: 'delete', password: 'password123' });
    assert.ok(del.json && del.json.success);
    assert.equal(site.db('SELECT COUNT(*) AS n FROM personal_records WHERE user_id = ?', [uid])[0].n, 0);
    assert.match(await (await fetch(`${site.base}/pages/privacy.php?lang=it`)).text(), /I tuoi record nei giochi/);
    assert.match(await (await fetch(`${site.base}/pages/privacy.php?lang=en`)).text(), /Your game records/);
});

test('the five game pages load csrf.js and records.js before the game; the client keeps the better value', async () => {
    for (const g of ['skillcheck', 'memory', 'simon', 'difesa', 'botola']) {
        const html = await (await fetch(`${site.base}/pages/${g}.html`)).text();
        const rec = html.indexOf('/js/records.js'), game = html.search(new RegExp(`/js/${g === 'botola' ? 'botola/game' : g}\\.js`));
        assert.ok(html.includes('/js/csrf.js') && rec !== -1 && rec < game, g);
    }
    const R = require(path.join(__dirname, '..', 'public', 'js', 'records.js'));
    assert.equal(R.better(5, 3, false), true); assert.equal(R.better(3, 5, true), true); assert.equal(R.better(5, 3, true), false);
});
