// tests/guestbook.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client, makeAdmin } = require('./helpers');

let site, admin, user, guest;
test.before(async () => {
    site = await startSite();
    admin = await makeAdmin(site, 'gb_admin');
    user = new Client(site);
    await user.register('gb_user');
    guest = await new Client(site).init();
});
test.after(() => site.stop());

test('migration V3 created the guestbook table', () => {
    assert.equal(site.db('PRAGMA user_version')[0].user_version, 3);
    assert.ok(site.db("SELECT name FROM sqlite_master WHERE name = 'guestbook'").length === 1);
});

test('anyone can read; signing needs CSRF; text is flattened and length-checked', async () => {
    assert.equal((await guest.get('/api/guestbook.php')).json.success, true);
    assert.equal((await guest.post('/api/guestbook.php', { message: 'x' }, { csrf: false })).status, 403);
    assert.equal((await guest.post('/api/guestbook.php', { message: 'a'.repeat(201) })).status, 400);
    assert.equal((await guest.post('/api/guestbook.php', { message: '   ' })).status, 400);
    const ok = await guest.post('/api/guestbook.php', { message: 'hello\n\nwall  <b>' });
    assert.equal(ok.json.success, true);
    const list = (await user.get('/api/guestbook.php')).json.entries;
    assert.equal(list[0].message, 'hello wall <b>');
    assert.match(list[0].username, /^guest_/);
});

test('rate limit: one entry per minute per sender (admins exempt)', async () => {
    assert.equal((await user.post('/api/guestbook.php', { message: 'first' })).json.success, true);
    assert.equal((await user.post('/api/guestbook.php', { message: 'second' })).status, 429);
    assert.equal((await admin.post('/api/guestbook.php', { message: 'a1' })).json.success, true);
    assert.equal((await admin.post('/api/guestbook.php', { message: 'a2' })).json.success, true);
});

test('banned accounts cannot sign', async () => {
    const c = new Client(site);
    await c.register('gb_banned');
    site.db('UPDATE accounts SET is_banned = 1 WHERE username = ?', ['gb_banned']);
    assert.equal((await c.post('/api/guestbook.php', { message: 'let me in' })).status, 403);
});

test('only admins can delete', async () => {
    const id = (await guest.get('/api/guestbook.php')).json.entries[0].id;
    assert.equal((await user.post('/api/guestbook.php', { action: 'delete', id })).status, 403);
    assert.equal((await admin.post('/api/guestbook.php', { action: 'delete', id })).json.success, true);
    assert.ok(!(await guest.get('/api/guestbook.php')).json.entries.some((e) => e.id === id));
});
