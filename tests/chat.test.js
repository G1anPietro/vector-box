// tests/chat.test.js — auth, CSRF, room permissions, streams
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client, makeAdmin } = require('./helpers');

let site, admin, user, guest;

test.before(async () => {
    site = await startSite();
    admin = await makeAdmin(site);
    user = new Client(site);
    await user.register('alice');
    guest = await new Client(site).init();
});
test.after(() => site.stop());

test('auth: wrong password is rejected, right one works', async () => {
    const c = new Client(site);
    assert.equal((await c.login('alice', 'wrongpassword')).status, 401);
    const ok = await c.login('alice');
    assert.equal(ok.status, 200);
    assert.equal(ok.json.username, 'alice');
});

test('auth: registration validates username and password', async () => {
    const c = new Client(site);
    assert.equal((await c.register('guest_abc')).status, 400, 'guest_ prefix is reserved');
    assert.equal((await c.register('bob', 'short')).status, 400, 'password too short');
    assert.equal((await c.register('alice')).status, 409, 'duplicate username');
});

test('guests get a guest_ handle and a CSRF token', async () => {
    assert.match(guest.session.username, /^guest_[0-9a-f]{8}$/);
    assert.ok(guest.csrf.length >= 32);
});

test('CSRF: sends without a valid token are refused (guest and user)', async () => {
    for (const c of [guest, user]) {
        const r = await c.post('/api/uplink_send.php', { room_id: 'general', message: 'x' }, { csrf: false });
        assert.equal(r.status, 403);
        const bad = await c.post('/api/uplink_send.php', { room_id: 'general', message: 'x' },
            { csrf: false, headers: { 'X-CSRF-Token': 'nope' } });
        assert.equal(bad.status, 403);
    }
});

test('rooms: guests and users can post in general', async () => {
    assert.equal((await guest.send('general', 'hi from guest')).json.success, true);
    assert.equal((await user.send('general', 'hi from alice')).json.success, true);
});

test('rooms: private (announcement) rooms are admin-post only', async () => {
    assert.equal((await user.send('announcements', 'nope')).status, 403);
    assert.equal((await admin.send('announcements', 'news!')).json.success, true);
});

test('rooms: hidden rooms are admin-read and admin-post only', async () => {
    assert.equal((await user.send('admin', 'nope')).status, 403);
    assert.equal((await admin.send('admin', 'secret')).json.success, true);

    assert.equal((await user.get('/api/get_feed.php?room_id=admin')).status, 403);
    assert.equal((await guest.get('/api/get_feed.php?room_id=admin')).status, 403);
    const feed = await admin.get('/api/get_feed.php?room_id=admin');
    assert.ok(feed.json.messages.some((m) => m.message === 'secret'));
});

test('stream: resumes from Last-Event-ID and hides hidden rooms from non-admins', async () => {
    const before = (await user.get('/api/get_feed.php?room_id=general&limit=1')).json.latest_id;
    await admin.send('admin', 'hidden-after');
    await user.send('general', 'public-after');

    const forUser = await user.stream('/api/uplink_stream.php', { headers: { 'Last-Event-ID': String(before) } });
    const userMsgs = forUser.events.filter((e) => e.event === 'message').map((e) => e.json.message);
    assert.ok(userMsgs.includes('public-after'));
    assert.ok(!userMsgs.includes('hidden-after'));
    // every message event carries its id so reconnects can resume
    assert.ok(forUser.events.filter((e) => e.event === 'message').every((e) => Number(e.id) === e.json.id));

    const forAdmin = await admin.stream(`/api/uplink_stream.php?last_id=${before}`);
    const adminMsgs = forAdmin.events.filter((e) => e.event === 'message').map((e) => e.json.message);
    assert.ok(adminMsgs.includes('hidden-after') && adminMsgs.includes('public-after'));
});

test('delete: admin only, with CSRF', async () => {
    const id = (await user.get('/api/get_feed.php?room_id=general&limit=1')).json.messages[0].id;
    assert.equal((await user.post('/api/delete_message.php', { id })).status, 403);
    assert.equal((await admin.post('/api/delete_message.php', { id }, { csrf: false })).status, 403);
    assert.equal((await admin.post('/api/delete_message.php', { id })).json.success, true);
    const feed = await user.get('/api/get_feed.php?room_id=general&limit=50');
    assert.ok(!feed.json.messages.some((m) => m.id === id));
});

test('moderation commands: admin gets a success notice, users are refused', async () => {
    const ok = await admin.send('general', '/grantbook alice');
    assert.equal(ok.json.success, true);
    assert.match(ok.json.notice, /COMMAND SUCCESS/);
    assert.equal((await user.send('general', '/ban root_admin')).status, 403);
});
