// tests/cambio-nome.test.js — change username on the Account page: password needed, taken/reserved refused, rows follow, other devices signed out.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client } = require('./helpers');

let site;
test.before(async () => { site = await startSite(); });
test.after(() => site.stop());
const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0';
const clear = () => { try { site.db('DELETE FROM rate_limits'); } catch (e) { /* no table yet */ } };
async function signIn(name) { clear(); const c = new Client(site); assert.equal((await c.login(name)).status, 200); return c; }
const rename = async (c, fields) => {
    const page = await c.get('/pages/account.php');
    const token = page.text.match(/name="csrf_token" value="([0-9a-f]+)"/)[1];
    const body = new URLSearchParams({ csrf_token: token, action: 'change_username', ...fields }).toString();
    const res = await fetch(site.base + '/pages/account.php', { method: 'POST', redirect: 'manual', body,
        headers: { Cookie: c.cookieHeader(), 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA } });
    return res.text();
};

test('rename: wrong password, taken, reserved and same name change nothing', async () => {
    clear(); await new Client(site).register('rn_other');
    clear(); await new Client(site).register('rn_one');
    const a = await signIn('rn_one');
    assert.match(await rename(a, { new_username: 'rn_new', password: 'nope-nope' }), /Incorrect current password|password attuale non/);
    assert.match(await rename(a, { new_username: 'RN_OTHER', password: 'password123' }), /already taken|già in uso/);
    assert.match(await rename(a, { new_username: 'admin', password: 'password123' }), /reserved|riservato/);
    assert.match(await rename(a, { new_username: 'rn_one', password: 'password123' }), /already your username|già il tuo/);
    assert.equal(site.db("SELECT COUNT(*) AS n FROM accounts WHERE username = 'rn_one'")[0].n, 1);
});

test('rename: account, copied names and session follow; other devices are signed out; login works with the new name only', async () => {
    clear(); await new Client(site).register('rn_two');
    const a = await signIn('rn_two'), b = await signIn('rn_two');
    site.db("INSERT INTO guestbook (user_id, username, message, sender_ip, created_at) SELECT id, username, 'hi', '127.0.0.1', 1 FROM accounts WHERE username = 'rn_two'");
    assert.match(await rename(a, { new_username: 'rn_two_b', password: 'password123' }), /Username changed|Nome utente cambiato/);
    assert.equal(site.db("SELECT COUNT(*) AS n FROM accounts WHERE username = 'rn_two_b'")[0].n, 1);
    assert.equal(site.db("SELECT COUNT(*) AS n FROM guestbook WHERE username = 'rn_two_b'")[0].n, 1);
    assert.equal((await b.get('/api/sessions.php')).status, 401);
    assert.equal((await a.get('/api/sessions.php')).status, 200);
    clear();
    assert.equal((await new Client(site).login('rn_two', 'password123')).status, 401);
    assert.equal((await new Client(site).login('rn_two_b', 'password123')).status, 200);
});
