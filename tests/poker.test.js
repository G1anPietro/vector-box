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
    assert.ok(site.db('PRAGMA user_version')[0].user_version >= 5);
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

test('rooms: the code is found in any case, creation is rate limited and the names are capped', async () => {
    const form = (c, q, fields) => fetch(`${site.base}/api/poker.php?${q}`, { method: 'POST', body: new URLSearchParams(fields),
        headers: { Cookie: c.cookieHeader(), 'X-CSRF-Token': c.csrf } }).then(async (r) => ({ status: r.status, json: await r.json() }));
    try { site.db('DELETE FROM rate_limits'); } catch (e) { /* none yet */ }
    const made = await form(alice, 'action=create_room', { room_name: 'x'.repeat(60), room_code: 'abc-12', bot_count: '1' });
    assert.equal(made.json.success, true, JSON.stringify(made.json));
    assert.equal(made.json.room_id.length, 24, 'the name is cut');
    assert.equal(made.json.room_code, 'ABC-12');
    const viaCode = (await alice.get('/api/poker.php?action=state&table_id=abc-12')).json;
    assert.equal(viaCode.table.id, made.json.room_id, 'joining by code, typed in lower case, finds the room');
    for (let i = 0; i < 6; i++) await form(alice, 'action=create_room', { room_name: 'room' + i, room_code: 'C' + i });
    const over = await form(alice, 'action=create_room', { room_name: 'one-too-many', room_code: 'ZZZ' });
    assert.equal(over.json.success, false, 'at most 6 rooms an hour from one address');
});

test('a hand: leaving on your turn passes it on, leaving when one player is left pays the pot, and nobody can act outside a live hand', async () => {
    const form = (c, q, fields) => fetch(`${site.base}/api/poker.php?${q}`, { method: 'POST', body: new URLSearchParams(fields),
        headers: { Cookie: c.cookieHeader(), 'X-CSRF-Token': c.csrf } }).then(async (r) => ({ status: r.status, json: await r.json() }));
    const ids = Object.fromEntries(site.db('SELECT id, username FROM accounts').map((r) => [r.username, r.id]));
    const seat = (n, user, chips = 1000, folded = 0) => site.db(
        "INSERT INTO poker_players (table_id, user_id, username, seat, chips, current_bet, hole_cards, is_folded, is_bot) VALUES ('t-leave', ?, ?, ?, ?, 0, '[\"AH\",\"KD\"]', ?, 0)", [ids[user] || null, user, n, chips, folded]);
    site.db("INSERT INTO poker_tables (id, room_code, creator_username, bot_count, max_players, pot, current_bet, community_cards, game_stage, current_turn_seat) VALUES ('t-leave', 'TLEAVE', 'x', 0, 4, 100, 0, '[\"2C\",\"7D\",\"9S\"]', 'flop', 1)");
    seat(1, 'pk_alice'); seat(2, 'pk_bob'); seat(3, 'guest_zzzzzzzz');
    // alice leaves on her turn (seat 1): the turn goes to the next live seat
    await form(alice, 'action=leave&table_id=t-leave', {});
    assert.equal(site.db("SELECT current_turn_seat FROM poker_tables WHERE id = 't-leave'")[0].current_turn_seat, 2);
    // bob folds out by leaving too, with seat 3 the only one left: the hand ends and seat 3 gets the pot
    await form(bob, 'action=leave&table_id=t-leave', {});
    const t = site.db("SELECT game_stage, pot FROM poker_tables WHERE id = 't-leave'")[0];
    assert.equal(t.game_stage, 'showdown');
    assert.equal(site.db("SELECT chips FROM poker_players WHERE table_id = 't-leave' AND seat = 3")[0].chips, 1100, 'the pot went to the last player');
    // not a live hand any more: a play does nothing (no chips destroyed)
    seat(1, 'pk_alice', 1000);
    site.db("UPDATE poker_tables SET current_turn_seat = 1 WHERE id = 't-leave'");
    await form(alice, 'action=play&table_id=t-leave', { user_action: 'raise', raise_amount: '40' });
    assert.equal(site.db("SELECT chips FROM poker_players WHERE table_id = 't-leave' AND seat = 1")[0].chips, 1000, 'no chips taken after the showdown');
});
