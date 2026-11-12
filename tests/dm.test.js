// tests/dm.test.js — private messages: registered users only, privacy (admin included), blocking
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client, makeAdmin } = require('./helpers');

let site, alice, bob, carol, admin;
const ids = {};
const send = (c, to, body) => c.post('/api/dm.php', { action: 'send', to, body });

test.before(async () => {
    site = await startSite();
    alice = new Client(site); await alice.register('dm_alice');
    bob = new Client(site); await bob.register('dm_bob');
    carol = new Client(site); await carol.register('dm_carol');
    admin = await makeAdmin(site, 'dm_admin');
    for (const r of site.db("SELECT id, username FROM accounts")) ids[r.username] = r.id;
});
test.after(() => site.stop());

test('migration V8 created the tables', () => {
    assert.ok(site.db('PRAGMA user_version')[0].user_version >= 8);
    assert.equal(site.db("SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('dm_messages','dm_blocks')")[0].n, 2);
});

test('guests cannot use private messages; CSRF is required', async () => {
    const guest = await new Client(site).init();
    assert.equal((await guest.get('/api/dm.php?action=conversations')).status, 401);
    assert.equal((await send(guest, ids.dm_alice, 'hi')).status, 401);
    const noCsrf = await alice.post('/api/dm.php', { action: 'send', to: ids.dm_bob, body: 'x' }, { csrf: false });
    assert.equal(noCsrf.status, 403);
});

test('send, conversations, unread count, thread marks as read', async () => {
    assert.equal((await send(alice, ids.dm_bob, 'ciao bob')).status, 200);
    assert.equal((await send(alice, ids.dm_bob, 'ci sei?\nseconda riga')).status, 200);
    let conv = (await bob.get('/api/dm.php?action=conversations')).json;
    assert.equal(conv.conversations.length, 1);
    assert.equal(conv.conversations[0].user.username, 'dm_alice');
    assert.equal(conv.conversations[0].unread, 2);
    assert.equal(conv.conversations[0].last.body, 'ci sei?\nseconda riga', 'line breaks kept');

    const thread = (await bob.get(`/api/dm.php?action=thread&with=${ids.dm_alice}`)).json;
    assert.deepEqual(thread.messages.map((m) => m.body), ['ciao bob', 'ci sei?\nseconda riga']);
    assert.equal(thread.can_send, true);
    conv = (await bob.get('/api/dm.php?action=conversations')).json;
    assert.equal(conv.conversations[0].unread, 0);

    const since = (await alice.get('/api/dm.php?action=since&after=0')).json;
    assert.equal(since.messages.length, 2);
    assert.ok(since.messages.every((m) => m.mine));
});

test('validation: empty, too long, unknown user, yourself', async () => {
    assert.equal((await send(alice, ids.dm_bob, '   ')).json.code, 'empty');
    assert.equal((await send(alice, ids.dm_bob, 'x'.repeat(1001))).json.code, 'too_long');
    assert.equal((await send(alice, 999999, 'hi')).status, 404);
    assert.equal((await send(alice, ids.dm_alice, 'hi')).status, 404);
});

test('nobody else can read a conversation, the admin included', async () => {
    // carol and the admin only ever see their own conversations
    for (const c of [carol, admin]) {
        const conv = (await c.get('/api/dm.php?action=conversations')).json;
        assert.equal(conv.conversations.length, 0);
        const t = (await c.get(`/api/dm.php?action=thread&with=${ids.dm_alice}`)).json;
        assert.equal(t.messages.length, 0, 'thread with alice only shows messages exchanged with ME');
        const since = (await c.get('/api/dm.php?action=since&after=0')).json;
        assert.equal(since.messages.length, 0);
    }
});

test('blocking works both ways and does not tell who blocked whom', async () => {
    await send(carol, ids.dm_bob, 'hey bob');
    assert.equal((await bob.post('/api/dm.php', { action: 'block', user_id: ids.dm_carol })).status, 200);
    const fromCarol = await send(carol, ids.dm_bob, 'are you there');
    assert.equal(fromCarol.status, 403);
    assert.equal(fromCarol.json.code, 'blocked');
    assert.equal((await send(bob, ids.dm_carol, 'nope')).json.code, 'blocked', 'the blocker cannot write either');

    const carolView = (await carol.get(`/api/dm.php?action=thread&with=${ids.dm_bob}`)).json;
    assert.equal(carolView.can_send, false);
    assert.equal(carolView.blocked, false, 'carol did not block anyone');
    const bobView = (await bob.get(`/api/dm.php?action=thread&with=${ids.dm_carol}`)).json;
    assert.equal(bobView.blocked, true);
    assert.deepEqual((await bob.get('/api/dm.php?action=blocks')).json.users.map((u) => u.username), ['dm_carol']);

    await bob.post('/api/dm.php', { action: 'unblock', user_id: ids.dm_carol });
    assert.equal((await send(carol, ids.dm_bob, 'back again')).status, 200);
});

test('user search: prefix only, never yourself', async () => {
    const r = (await alice.get('/api/dm.php?action=users&q=dm_')).json.users.map((u) => u.username);
    assert.ok(r.includes('dm_bob') && r.includes('dm_carol'));
    assert.ok(!r.includes('dm_alice'));
    assert.deepEqual((await alice.get('/api/dm.php?action=users&q=%25')).json.users, [], '% is not a wildcard');
});

test('banned users cannot send', async () => {
    site.db('UPDATE accounts SET is_banned = 1 WHERE username = ?', ['dm_carol']);
    const r = await send(carol, ids.dm_alice, 'hi');
    assert.equal(r.status, 403);
    assert.equal(r.json.code, 'restricted');
    site.db('UPDATE accounts SET is_banned = 0 WHERE username = ?', ['dm_carol']);
});

test('older pages: before + more, no duplicates, oldest first inside a page', async () => {
    // accounts straight into the test DB (registration is limited to 5 per hour per IP)
    const hash = site.db("SELECT password_hash FROM accounts WHERE username = 'dm_alice'")[0].password_hash;
    for (const u of ['dm_page1', 'dm_page2']) site.db('INSERT INTO accounts (username, password_hash) VALUES (?, ?)', [u, hash]);
    const p1 = new Client(site); await p1.login('dm_page1');
    const a = site.db("SELECT id FROM accounts WHERE username = 'dm_page1'")[0].id;
    const b = site.db("SELECT id FROM accounts WHERE username = 'dm_page2'")[0].id;
    // 120 messages straight into the copy of the DB (the send API is rate limited)
    for (let i = 1; i <= 120; i++) {
        site.db('INSERT INTO dm_messages (sender_id, recipient_id, body) VALUES (?, ?, ?)', i % 2 ? [a, b, `m${i}`] : [b, a, `m${i}`]);
    }
    const page = async (before) => (await p1.get(`/api/dm.php?action=thread&with=${b}${before ? `&before=${before}` : ''}`)).json;
    const first = await page();
    assert.equal(first.messages.length, 50);
    assert.equal(first.more, true);
    assert.deepEqual(first.messages.map((m) => m.body).slice(0, 2), ['m71', 'm72']);   // chronological
    const second = await page(first.messages[0].id);
    assert.equal(second.messages.length, 50);
    assert.equal(second.more, true);
    const third = await page(second.messages[0].id);
    assert.equal(third.messages.length, 20);
    assert.equal(third.more, false);
    const all = [...third.messages, ...second.messages, ...first.messages].map((m) => m.body);
    assert.equal(new Set(all).size, 120);
    assert.equal(all[0], 'm1');
    assert.equal(all[119], 'm120');
});
