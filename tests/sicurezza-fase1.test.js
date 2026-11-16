// tests/sicurezza-fase1.test.js — fixes from the security pass (migliora): feed limit, sessions of deleted accounts
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client, makeAdmin } = require('./helpers');

test.describe('security pass 1', () => {
    let site, ada, admin;
    test.before(async () => {
        site = await startSite();
        try { site.db('DELETE FROM rate_limits'); } catch (e) { /* not created yet */ }
        ada = new Client(site); await ada.register('sx_ada');
        try { site.db('DELETE FROM rate_limits'); } catch (e) { /* not created yet */ }
        admin = await makeAdmin(site, 'sx_admin');
    });
    test.after(async () => { await site.stop(); });

    test('feed: a negative limit does not remove the cap', async () => {
        const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
        for (let i = 0; i < 60; i++) site.db("INSERT INTO transmissions (room_id, message, sender_ip, username, created_at) VALUES ('general', ?, '1.1.1.1', 'x', ?)", ['m' + i, ts]);
        const r = await fetch(`${site.base}/api/get_feed.php?room_id=general&limit=-1`);
        const j = await r.json();
        assert.ok(j.messages.length >= 1 && j.messages.length <= 50);
    });

    test('a session whose account no longer exists is logged out; a demoted admin loses admin rights', async () => {
        assert.equal((await ada.get('/api/bookmarks.php')).status !== 401, true, 'logged in works');
        site.db("DELETE FROM accounts WHERE username = 'sx_ada'");
        assert.equal((await ada.get('/api/bookmarks.php')).status, 401);
        assert.notEqual((await admin.get('/api/get_log.php')).status, 403, 'admin works');
        site.db("UPDATE accounts SET is_admin = 0 WHERE username = 'sx_admin'");
        assert.equal((await admin.get('/api/get_log.php')).status, 403);
    });

    test('user names: reserved staff-like names and case-only duplicates are refused', async () => {
        const reg = async (u) => { try { site.db('DELETE FROM rate_limits'); } catch (e) { /* none yet */ }
            return fetch(`${site.base}/api/login.php`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'register', username: u, password: 'password123', accept_terms: true, age_confirm: true }) }); };
        assert.equal((await reg('Admin')).status, 400);
        assert.equal((await reg('system_1')).status, 400);
        assert.equal((await reg('SX_ADMIN')).status, 409, 'same as sx_admin apart from case');
    });
});
