// tests/sessions.test.js — "where you are signed in": list, revoke, revoke others, lazy rows, last_seen throttle, privacy.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { startSite, Client } = require('./helpers');

let site;
test.before(async () => { site = await startSite(); });
test.after(() => site.stop());

const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0';
const UA_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
async function signIn(name, ua = UA) {
    clear();   // the login/register brakes are per address and every test client shares one
    const c = new Client(site);
    const orig = c.request.bind(c);
    c.request = (m, u, o = {}) => orig(m, u, { ...o, headers: { 'User-Agent': ua, ...(o.headers || {}) } });
    const r = await c.login(name);
    assert.equal(r.status, 200);
    return c;
}
const clear = () => { try { site.db('DELETE FROM rate_limits'); } catch (e) { /* no table yet */ } };
const reg = (n) => { clear(); return new Client(site).register(n); };
const rows = (name) => site.db('SELECT s.* FROM account_sessions s JOIN accounts a ON a.id = s.user_id WHERE a.username = ?', [name]);
const wipe = (name) => site.db('DELETE FROM account_sessions WHERE user_id = (SELECT id FROM accounts WHERE username = ?)', [name]);

test('two devices are listed, the current one is marked, labels come from the UA', async () => {
    await reg('ses_ann');
    const a = await signIn('ses_ann');
    const b = await signIn('ses_ann', UA_IOS);
    const la = (await a.get('/api/sessions.php')).json.sessions;
    assert.ok(la.length >= 2);
    assert.equal(la.filter((s) => s.current).length, 1);
    assert.ok(la.some((s) => s.label === 'Firefox on Linux'));
    assert.ok(la.some((s) => s.label === 'Safari on iOS'));
    const lb = (await b.get('/api/sessions.php')).json.sessions;
    assert.notEqual(la.find((s) => s.current).id, lb.find((s) => s.current).id);
});

test('revoking another device logs it out on its next request; the caller stays in', async () => {
    await reg('ses_bob');
    const a = await signIn('ses_bob'), b = await signIn('ses_bob');
    // b's own row (the registration session is a third device: "the first one that is not current" would pick either)
    const hashB = require('crypto').createHash('sha256').update(b.cookies.get('PHPSESSID')).digest('hex');
    const idB = site.db('SELECT id FROM account_sessions WHERE sid_hash = ?', [hashB])[0].id;
    assert.equal((await a.post('/api/sessions.php', { action: 'revoke', id: idB })).json.success, true);
    assert.equal((await b.get('/api/sessions.php')).status, 401);
    assert.equal((await a.get('/api/sessions.php')).status, 200);
});

test('revoke_others keeps only this device; revoking the current id is refused', async () => {
    await reg('ses_cy');
    const a = await signIn('ses_cy'), b = await signIn('ses_cy'), c = await signIn('ses_cy');
    const mine = (await a.get('/api/sessions.php')).json.sessions.find((s) => s.current);
    assert.equal((await a.post('/api/sessions.php', { action: 'revoke', id: mine.id })).status, 404);
    assert.equal((await a.post('/api/sessions.php', { action: 'revoke_others' })).json.success, true);
    assert.equal((await b.get('/api/sessions.php')).status, 401);
    assert.equal((await c.get('/api/sessions.php')).status, 401);
    assert.equal((await a.get('/api/sessions.php')).json.sessions.length, 1);
});

test('cannot revoke someone else\'s device; POST needs CSRF and a login', async () => {
    await reg('ses_dan'); await reg('ses_eve');
    const d = await signIn('ses_dan'), e = await signIn('ses_eve');
    const dId = (await d.get('/api/sessions.php')).json.sessions[0].id;
    assert.equal((await e.post('/api/sessions.php', { action: 'revoke', id: dId })).status, 404);
    assert.equal((await d.get('/api/sessions.php')).status, 200);
    assert.equal((await e.post('/api/sessions.php', { action: 'revoke_others' }, { csrf: false })).status, 403);
    assert.equal((await new Client(site).get('/api/sessions.php')).status, 401);
});

test('a session from before the feature is created lazily and not logged out; a revoked tracked one is', async () => {
    await reg('ses_fay');
    const a = await signIn('ses_fay');
    // simulate the pre-feature session: no row and no "tracked" marker in the session file
    wipe('ses_fay');
    const f = path.join(site.root, 'data', 'sessions', 'sess_' + a.cookies.get('PHPSESSID'));
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/tracked\|i:1;/, ''));
    assert.equal((await a.get('/api/sessions.php')).status, 200);
    assert.equal(rows('ses_fay').length, 1);
    // now it is tracked: a missing row means "revoked"
    wipe('ses_fay');
    assert.equal((await a.get('/api/sessions.php')).status, 401);
    assert.equal(rows('ses_fay').length, 0);
});

test('last_seen is not written on every request; it is refreshed after 10 minutes', async () => {
    await reg('ses_gus');
    const a = await signIn('ses_gus');
    const hash = require('crypto').createHash('sha256').update(a.cookies.get('PHPSESSID')).digest('hex');
    const mine = () => site.db('SELECT last_seen FROM account_sessions WHERE sid_hash = ?', [hash])[0].last_seen;
    const now = Math.floor(Date.now() / 1000);
    site.db('UPDATE account_sessions SET last_seen = ? WHERE sid_hash = ?', [now - 5, hash]);
    await a.get('/api/sessions.php'); await a.get('/api/sessions.php');
    assert.equal(mine(), now - 5);
    site.db('UPDATE account_sessions SET last_seen = ? WHERE sid_hash = ?', [now - 700, hash]);
    await a.get('/api/sessions.php');
    assert.ok(mine() >= now - 2);
});

test('no raw session id or IP in the table; export lists devices; erase deletes them', async () => {
    await reg('ses_hal');
    const a = await signIn('ses_hal'), b = await signIn('ses_hal');
    const dump = JSON.stringify(site.db('SELECT * FROM account_sessions'));
    for (const c of [a, b]) assert.ok(!dump.includes(c.cookies.get('PHPSESSID')));
    assert.ok(!dump.includes('127.0.0.1'));
    const exp = (await a.get('/api/account_data.php?action=export')).json;
    assert.ok(exp.signed_in_devices.length >= 2);
    assert.deepEqual(Object.keys(exp.signed_in_devices[0]).sort(), ['country', 'created_at', 'label', 'last_seen']);
    const del = await a.post('/api/account_data.php', { action: 'delete', password: 'password123', delete_materials: true });
    assert.equal(del.status, 200);
    assert.equal(rows('ses_hal').length, 0);
});

test('retention removes rows idle for 90 days', async () => {
    await reg('ses_ivy');
    await signIn('ses_ivy');
    site.db('UPDATE account_sessions SET last_seen = 1000 WHERE user_id = (SELECT id FROM accounts WHERE username = ?)', ['ses_ivy']);
    execFileSync('php', [path.join(site.root, 'public/api/retention.php')], { cwd: site.root });
    assert.equal(rows('ses_ivy').length, 0);
});

test('a pre-feature session that first shows up on a READ-ONLY request still becomes revocable', async () => {
    await reg('ses_hal');
    const a = await signIn('ses_hal');
    wipe('ses_hal');
    const f = path.join(site.root, 'data', 'sessions', 'sess_' + a.cookies.get('PHPSESSID'));
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/tracked\|i:1;/, ''));
    await a.get('/api/get_feed.php');                                                  // a READ-ONLY endpoint (initSession() closes the session at once)
    assert.equal(rows('ses_hal').length, 1);
    wipe('ses_hal');                                                                   // signed out from the Account page
    await a.get('/api/get_feed.php');                                                  // must NOT make the row again
    assert.equal(rows('ses_hal').length, 0);
    assert.notEqual((await a.get('/api/check_session.php')).json.username, 'ses_hal');
});

test('logging out removes the device from the list at once', async () => {
    await reg('ses_ida');
    const a = await signIn('ses_ida');
    const before = rows('ses_ida').length;                    // (the registration session is also there)
    const r = await a.get('/api/logout.php', { headers: { Accept: 'application/json' } });
    assert.equal(r.status, 200);
    assert.equal(rows('ses_ida').length, before - 1);
});
