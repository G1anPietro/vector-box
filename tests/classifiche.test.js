// tests/classifiche.test.js — arcade leaderboards: public read, login+CSRF write, plausibility checks, best-only, rank, ban, erase, export
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { startSite, Client, REPO } = require('./helpers');

let site, ann, bob, cy;
const url = (g, v = '') => `/api/game_scores.php?game=${g}&variant=${v}`;
const send = (c, game, variant, score, duration_ms, opts) => c.post('/api/game_scores.php', { game, variant, score, duration_ms }, opts);

test.before(async () => {
    site = await startSite();
    ann = new Client(site); await ann.register('cl_ann');
    bob = new Client(site); await bob.register('cl_bob');
    cy = new Client(site); await cy.register('cl_cy');
});
test.after(() => site.stop());

/** Runs the pure check in PHP: returns null or the reason. */
const check = (game, variant, score, dur) => JSON.parse(execFileSync('php', ['-r',
    'require $argv[1]; echo json_encode(gameScoreCheck($argv[2], $argv[3], json_decode($argv[4]), json_decode($argv[5])));',
    path.join(REPO, 'public/api/game_scores_lib.php'), game, variant, JSON.stringify(score), JSON.stringify(dur)]).toString());

test('validation (pure): impossible results are refused', () => {
    assert.equal(check('tetris', '', 5000, 60000), null);
    assert.ok(check('tetris', '', 5000000, 60000), 'above the cap');
    assert.ok(check('tetris', '', 500000, 60000), 'too many points for one minute');
    assert.ok(check('tetris', '', 100, 500), 'too short a game');
    assert.ok(check('tetris', '', 0, 60000), 'zero is not a score');
    assert.ok(check('tetris', '', 12.5, 60000), 'not an integer');
    assert.ok(check('tetris', '', '999', 60000), 'a string');
    assert.ok(check('nope', '', 10, 60000), 'unknown game');
    assert.ok(check('tetris', 'x', 10, 60000), 'unknown variant');
    assert.equal(check('snake', '', 20, 30000), null);
    assert.ok(check('snake', '', 250, 20000), 'snake faster than it can move');
    assert.ok(check('snake', '', 300, 600000), 'bigger than the field');
    assert.equal(check('minato', 'hard', 60000, 61000), null);
    assert.ok(check('minato', 'hard', 1500, 61000), 'a hard board in 1.5 s');
    assert.ok(check('minato', 'hard', 1500, 1500), 'expert under 2 s');
    assert.ok(check('minato', 'easy', 30000, 5000), 'time longer than the time played');
    assert.ok(check('minato', 'easy', 5000, null), 'no duration');
});

test('guests read (200) but cannot write (401); CSRF is required', async () => {
    const g = new Client(site); await g.init();
    const r = await g.get(url('tetris'));
    assert.equal(r.status, 200);
    assert.deepEqual([r.json.logged_in, r.json.top, r.json.me], [false, [], null]);
    assert.equal((await send(g, 'tetris', '', 5000, 60000)).status, 401);
    assert.equal((await send(ann, 'tetris', '', 5000, 60000, { csrf: false })).status, 403);
    assert.equal((await ann.get(url('nope'))).status, 400);
});

test('the server refuses impossible results and unknown games', async () => {
    assert.equal((await send(ann, 'nope', '', 5, 60000)).status, 400);
    assert.equal((await send(ann, 'tetris', '', 9999999, 60000)).status, 422);
    assert.equal((await send(ann, 'tetris', '', 5000, 100)).status, 422);
    assert.equal((await send(ann, 'minato', 'hard', 1000, 1000)).status, 422);
    assert.equal((await send(ann, 'tetris', '', '5000', 60000)).status, 422);
    assert.deepEqual((await ann.get(url('tetris'))).json.top, []);
});

test('only the best is kept, in both directions, with order and rank', async () => {
    assert.equal((await send(ann, 'tetris', '', 5000, 60000)).json.improved, true);
    let r = (await send(ann, 'tetris', '', 3000, 60000)).json;
    assert.deepEqual([r.improved, r.me.score], [false, 5000], 'a worse score changes nothing');
    r = (await send(ann, 'tetris', '', 7000, 60000)).json;
    assert.deepEqual([r.improved, r.me.score, r.me.rank], [true, 7000, 1]);
    await send(bob, 'tetris', '', 9000, 60000);
    await send(cy, 'tetris', '', 100, 60000);
    const b = (await ann.get(url('tetris'))).json;
    assert.deepEqual(b.top.map((x) => [x.name, x.score]), [['cl_bob', 9000], ['cl_ann', 7000], ['cl_cy', 100]]);
    assert.deepEqual(b.me, { score: 7000, rank: 2 });
    assert.equal(site.db('SELECT COUNT(*) AS n FROM game_scores WHERE user_id = (SELECT id FROM accounts WHERE username = ?)', ['cl_ann'])[0].n, 1);

    // lower is better for minesweeper: per difficulty
    await send(ann, 'minato', 'easy', 20000, 21000);
    await send(bob, 'minato', 'easy', 15000, 16000);
    r = (await send(ann, 'minato', 'easy', 25000, 26000)).json;
    assert.deepEqual([r.improved, r.me.score, r.me.rank], [false, 20000, 2], 'a slower time is ignored');
    r = (await send(ann, 'minato', 'easy', 12000, 13000)).json;
    assert.deepEqual([r.improved, r.me.score, r.me.rank], [true, 12000, 1]);
    const m = (await cy.get(url('minato', 'easy'))).json;
    assert.deepEqual(m.top.map((x) => x.name), ['cl_ann', 'cl_bob']);
    assert.equal(m.me, null);
    assert.deepEqual((await cy.get(url('minato', 'hard'))).json.top, [], 'another difficulty is another board');
});

test('the top list shows only 10 and exposes just name, score and date', async () => {
    for (let i = 0; i < 11; i++) {
        site.db("INSERT INTO accounts (username, password_hash, created_at) VALUES (?, 'x', datetime('now'))", ['fill' + i]);
        site.db("INSERT INTO game_scores (user_id, game, variant, score, created_at) VALUES ((SELECT id FROM accounts WHERE username = ?), 'snake', '', ?, 1)", ['fill' + i, 10 + i]);
    }
    const t = (await cy.get(url('snake'))).json.top;
    assert.equal(t.length, 10);
    assert.deepEqual(Object.keys(t[0]).sort(), ['at', 'name', 'score']);
    assert.equal(t[0].score, 20);
});

test('a banned account cannot submit and leaves the board', async () => {
    site.db('UPDATE accounts SET is_banned = 1 WHERE username = ?', ['cl_bob']);
    assert.equal((await send(bob, 'tetris', '', 9500, 60000)).status, 403);
    assert.ok(!(await ann.get(url('tetris'))).json.top.some((x) => x.name === 'cl_bob'));
    assert.equal((await ann.get(url('tetris'))).json.me.rank, 1);
});

test('30 submissions per hour, then 429', async () => {
    const c = new Client(site); await c.register('cl_busy');
    let last;
    for (let i = 0; i < 31; i++) last = await send(c, 'snake', '', 5, 60000);
    assert.equal(last.status, 429);
});

test('export lists the rows and erasing the account deletes them', async () => {
    const exp = (await cy.get('/api/account_data.php?action=export')).json;
    assert.deepEqual(exp.game_scores.map((x) => [x.game, x.score]), [['tetris', 100]]);
    const del = await cy.post('/api/account_data.php', { action: 'delete', password: 'password123' });
    assert.equal(del.status, 200);
    assert.equal(site.db("SELECT COUNT(*) AS n FROM game_scores WHERE game = 'tetris' AND score = 100")[0].n, 0);
});
