// tests/admin-utenti.test.js — the admin panel of people: list and filters, permissions, bans, badge, one direct e-mail
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startSite, Client, makeAdmin } = require('./helpers');

test.describe('admin: users panel', () => {
    let site, admin, ada, bob, adaId, bobId, log;
    const clear = () => { try { site.db('DELETE FROM rate_limits'); } catch (e) { /* none yet */ } };
    const au = (c, body) => c.post('/api/admin_users.php', body);
    test.before(async () => {
        site = await startSite({ MAIL_DRIVER: 'log', SITE_URL: 'https://example.org' });
        log = path.join(site.root, 'data', 'mail.log');
        clear(); ada = new Client(site); await ada.register('au_ada');
        clear(); bob = new Client(site); await bob.register('au_bob');
        clear(); admin = await makeAdmin(site, 'au_admin');
        adaId = site.db("SELECT id FROM accounts WHERE username = 'au_ada'")[0].id;
        bobId = site.db("SELECT id FROM accounts WHERE username = 'au_bob'")[0].id;
        site.db("UPDATE accounts SET email = 'ada@example.com', email_verified = 1, email_optin = 1 WHERE id = ?", [adaId]);
        site.db("UPDATE accounts SET email = 'bob@example.com', email_verified = 0 WHERE id = ?", [bobId]);
    });
    test.after(async () => { await site.stop(); });

    test('admin only; CSRF on every change; the page too', async () => {
        assert.equal((await ada.get('/api/admin_users.php?action=list')).status, 403);
        assert.equal((await au(ada, { action: 'set_flag', user_id: bobId, flag: 'can_read_books', value: true })).status, 403);
        const noCsrf = await fetch(`${site.base}/api/admin_users.php`, { method: 'POST', headers: { Cookie: admin.cookieHeader(), 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'badge', user_id: bobId, value: true }) });
        assert.equal(noCsrf.status, 403);
        assert.equal((await fetch(`${site.base}/pages/admin_users.php`, { headers: { Cookie: ada.cookieHeader() } })).status, 403);
        assert.equal((await fetch(`${site.base}/pages/admin_users.php`, { headers: { Cookie: admin.cookieHeader() } })).status, 200);
    });

    test('list, search and filters; the totals', async () => {
        const all = (await admin.get('/api/admin_users.php?action=list')).json;
        assert.equal(all.totals.all, 3);
        assert.equal(all.totals.news, 1);
        assert.deepEqual((await admin.get('/api/admin_users.php?action=list&q=au_b')).json.users.map((u) => u.username), ['au_bob']);
        assert.deepEqual((await admin.get('/api/admin_users.php?action=list&q=ada%40example')).json.users.map((u) => u.username), ['au_ada'], 'by e-mail');
        assert.deepEqual((await admin.get('/api/admin_users.php?action=list&filter=news')).json.users.map((u) => u.username), ['au_ada']);
        assert.deepEqual((await admin.get('/api/admin_users.php?action=list&filter=admins')).json.users.map((u) => u.username), ['au_admin']);
        assert.equal((await admin.get('/api/admin_users.php?action=list&q=%25')).json.total, 0, 'a % is searched literally');
        const u = (await admin.get(`/api/admin_users.php?action=user&id=${adaId}`)).json;
        assert.equal(u.user.email_optin, 1);
        assert.ok(!('password_hash' in u.user));
    });

    test('permissions, ban, timeout, badge; an admin cannot be banned', async () => {
        assert.equal((await au(admin, { action: 'set_flag', user_id: bobId, flag: 'can_read_books', value: true })).status, 200);
        assert.equal(site.db('SELECT can_read_books FROM accounts WHERE id = ?', [bobId])[0].can_read_books, 1);
        assert.equal((await au(admin, { action: 'set_flag', user_id: bobId, flag: 'is_admin', value: true })).json.code, 'bad_flag', 'no promotion through this door');
        assert.equal((await au(admin, { action: 'ban', user_id: bobId })).status, 200);
        assert.equal(site.db('SELECT is_banned FROM accounts WHERE id = ?', [bobId])[0].is_banned, 1);
        assert.equal((await au(admin, { action: 'unban', user_id: bobId })).status, 200);
        await au(admin, { action: 'timeout', user_id: bobId, minutes: 30 });
        assert.ok(site.db('SELECT banned_until FROM accounts WHERE id = ?', [bobId])[0].banned_until);
        const adminId = site.db("SELECT id FROM accounts WHERE username = 'au_admin'")[0].id;
        assert.equal((await au(admin, { action: 'ban', user_id: adminId })).json.code, 'is_admin');
        await au(admin, { action: 'badge', user_id: bobId, value: true });
        assert.equal((await admin.get(`/api/admin_users.php?action=user&id=${bobId}`)).json.user.supporter, true);
        await au(admin, { action: 'badge', user_id: bobId, value: false });
        assert.equal((await admin.get(`/api/admin_users.php?action=user&id=${bobId}`)).json.user.supporter, false);
        assert.equal((await au(admin, { action: 'ban', user_id: 99999 })).status, 404);
    });

    test('a direct e-mail goes only to a confirmed address, and is checked again when it is sent', async () => {
        assert.equal((await au(admin, { action: 'send_mail', user_id: bobId, subject: 'Ciao', body: 'x' })).json.code, 'no_verified_address', 'bob never confirmed');
        assert.equal((await au(admin, { action: 'send_mail', user_id: adaId, subject: '', body: 'x' })).json.code, 'empty');
        const r = await au(admin, { action: 'send_mail', user_id: adaId, subject: 'Il tuo libro\r\nBcc: x@y.z', body: 'Ti ho dato il permesso di leggere.' });
        assert.equal(r.status, 200, r.text);
        assert.equal(r.json.sent_now, true);
        const text = fs.readFileSync(log, 'utf8');
        assert.match(text, /to=ada@example\.com\tsubject=Il tuo libro Bcc: x@y\.z/, 'no header injection');
        assert.match(text, /Hello au_ada,/);
        // the address changed after queueing: nothing goes to the new one
        site.db("UPDATE accounts SET email_verified = 0 WHERE id = ?", [adaId]);
        const before = text.length;
        const q = await au(admin, { action: 'send_mail', user_id: adaId, subject: 'x', body: 'y' });
        assert.equal(q.json.code, 'no_verified_address');
        assert.equal(fs.readFileSync(log, 'utf8').length, before);
    });
});
