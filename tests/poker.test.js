// tests/poker.test.js — hand stats recording and the public leaderboard
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');
const { startSite, Client } = require('./helpers');

let site, alice, bob;

/** Run recordHandResult() against the test DB, exactly as poker.php does. */
function recordHand(players, winnerIdx, pot) {
    const script = 'require $argv[1]; $db = new PDO("sqlite:" . $argv[2]);'
        + ' $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);'
        + ' $p = json_decode($argv[3], true); $w = (int)$argv[4];'
        + ' recordHandResult($db, $p, $w >= 0 ? $p[$w] : null, (int)$argv[5]);';
    execFileSync('php', ['-r', script,
        path.join(site.root, 'public', 'api', 'poker_stats.php'),
        path.join(site.root, 'data', 'vector_uplink.sqlite'),
        JSON.stringify(players), String(winnerIdx), String(pot)]);
}

test.before(async () => {
    site = await startSite();
    alice = new Client(site); await alice.register('pk_alice');
    bob = new Client(site); await bob.register('pk_bob');
});
test.after(() => site.stop());

test('migration V5 created poker_stats', () => {
    assert.equal(site.db('PRAGMA user_version')[0].user_version, 5);
});

test('hands are recorded for humans only; leaderboard ranks by hands won', async () => {
    const ids = Object.fromEntries(site.db('SELECT id, username FROM accounts').map((r) => [r.username, r.id]));
    const seat = (id, user_id, username, is_bot = 0) => ({ id, user_id, username, is_bot });
    const table = [seat(1, ids.pk_alice, 'pk_alice'), seat(2, ids.pk_bob, 'pk_bob'), seat(3, null, 'CYBER_BOT_1', 1), seat(4, null, 'guest_abcd1234')];

    recordHand(table, 1, 300); // bob wins 300
    recordHand(table, 1, 120); // bob wins 120
    recordHand(table, 0, 500); // alice wins 500
    recordHand(table, 2, 80);  // bot wins: nobody human gets a win

    const stats = site.db('SELECT username, hands_played, hands_won, chips_won, biggest_pot FROM poker_stats ORDER BY username');
    assert.deepEqual(stats.map((s) => s.username), ['pk_alice', 'pk_bob'], 'bots and guests not tracked');
    const bobRow = stats.find((s) => s.username === 'pk_bob');
    assert.deepEqual([bobRow.hands_played, bobRow.hands_won, bobRow.chips_won, bobRow.biggest_pot], [4, 2, 420, 300]);

    const lb = (await alice.get('/api/poker_leaderboard.php')).json;
    assert.deepEqual(lb.top.map((r) => r.username), ['pk_bob', 'pk_alice']);
    assert.equal(lb.top[0].win_rate, 50);
    assert.equal(lb.me.username, 'pk_alice');
    assert.equal(lb.me.rank, 2);

    const anon = (await (await new Client(site).init()).get('/api/poker_leaderboard.php')).json;
    assert.equal(anon.me, null);
});
