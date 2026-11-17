// tests/totp.test.js — two-step login for admins: the code maths (RFC 6238), enrolment, both login paths, replay, backup codes, switching off.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');
const { startSite, Client, makeAdmin } = require('./helpers');

const LIB = path.join(__dirname, '..', 'public/api/totp_lib.php');
const php = (code) => execFileSync('php', ['-r', `require "${LIB}"; ${code}`], { encoding: 'utf8' }).trim();
// the code the app would show now, for a secret given in base32
const codeNow = (b32, offset = 0) => php(`echo totpAt(base32Decode("${b32}"), intdiv(time(), 30) + (${offset}));`);

let site, admin, user;
test.before(async () => {
    site = await startSite();
    admin = await makeAdmin(site, 'tf_admin');
    user = new Client(site); await user.register('tf_user');
});
test.after(() => site.stop());

test('the maths: RFC 6238 test vector, no reuse, a step either side only', () => {
    assert.equal(php('echo totpAt("12345678901234567890", intdiv(59, 30));'), '287082');
    assert.equal(php('$s = "k"; $c = totpAt($s, 100); echo json_encode([totpCheck($s, $c, 0, 3000), totpCheck($s, $c, 100, 3000), totpCheck($s, $c, 0, 3100), totpCheck($s, "12345", 0, 3000)]);'), '[100,null,null,null]');
    assert.equal(php('$e = totpEncrypt("secret-bytes"); echo totpDecrypt($e) . "|" . var_export(totpDecrypt("AAAA"), true);'), 'secret-bytes|NULL');
});

test('only admins can use the settings; every POST needs CSRF', async () => {
    assert.equal((await user.get('/api/totp.php')).status, 403);
    assert.equal((await admin.post('/api/totp.php', { action: 'begin' }, { csrf: false })).status, 403);
    assert.equal((await admin.get('/api/totp.php')).json.enabled, false);
});

let secret, backup;
test('enrolment: a wrong first code is refused, the right one switches it on and gives 8 backup codes', async () => {
    const b = (await admin.post('/api/totp.php', { action: 'begin' })).json;
    assert.match(b.uri, /^otpauth:\/\/totp\/vector-box:tf_admin\?secret=[A-Z2-7]+&issuer=vector-box/);
    secret = b.secret;
    assert.equal((await admin.post('/api/totp.php', { action: 'confirm', code: '000000' })).status, 400);
    assert.equal(site.db("SELECT totp_enabled FROM accounts WHERE username = 'tf_admin'")[0].totp_enabled, 0);
    assert.ok(!site.db("SELECT totp_secret FROM accounts WHERE username = 'tf_admin'")[0].totp_secret.includes(secret), 'the secret is stored encrypted');
    const c = (await admin.post('/api/totp.php', { action: 'confirm', code: codeNow(secret) })).json;
    assert.equal(c.success, true);
    assert.equal(c.backup_codes.length, 8);
    backup = c.backup_codes;
    assert.equal((await admin.get('/api/totp.php')).json.backup_left, 8);
});

const form = async (fields, cookie = '') => {
    const res = await fetch(site.base + '/pages/login.php', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: new URLSearchParams(fields) });
    const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    return { status: res.status, location: res.headers.get('location'), text: await res.text(), cookie: cookies || cookie };
};
const sessionOf = async (cookie) => (await (await fetch(site.base + '/api/check_session.php', { headers: { Cookie: cookie } })).json());

test('login page: the password alone gives no session; the code does, once', async () => {
    const s1 = await form({ action: 'login', username: 'tf_admin', password: 'password123' });
    assert.equal(s1.status, 200);                                  // no redirect: the code form is shown
    assert.match(s1.text, /name="code"/);
    assert.ok(!(await sessionOf(s1.cookie)).username || (await sessionOf(s1.cookie)).username.startsWith('guest_'));
    const bad = await form({ action: 'totp', code: '123456' }, s1.cookie);
    assert.match(bad.text, /Wrong code|Codice sbagliato/);
    const code = codeNow(secret, 1);                              // the code used to confirm is already spent for its step: the next one
    const ok = await form({ action: 'totp', code }, s1.cookie);
    assert.equal(ok.status, 302);
    assert.equal((await sessionOf(ok.cookie)).username, 'tf_admin');
    // the same code again, on a new login, is a replay
    const s2 = await form({ action: 'login', username: 'tf_admin', password: 'password123' });
    const again = await form({ action: 'totp', code }, s2.cookie);
    assert.equal(again.status, 200);
    assert.match(again.text, /Wrong code|Codice sbagliato/);
});

test('step two without step one, and the JSON login, never give a session', async () => {
    const lone = await form({ action: 'totp', code: codeNow(secret, 1) });
    assert.equal(lone.status, 200);
    assert.match(lone.text, /expired|scaduto/);
    const j = await new Client(site).init().then((c) => c.post('/api/login.php', { username: 'tf_admin', password: 'password123' }));
    assert.equal(j.status, 403);
    assert.equal(j.json.totp_required, true);
    assert.ok(!j.json.csrf_token);
});

test('a backup code works once; the code attempts are limited', async () => {
    site.db('DELETE FROM rate_limits');                              // the earlier tests used up the login attempts on purpose
    const s = await form({ action: 'login', username: 'tf_admin', password: 'password123' });
    const ok = await form({ action: 'totp', code: backup[0].toUpperCase() }, s.cookie);   // case and the dash do not matter
    assert.equal(ok.status, 302);
    const s2 = await form({ action: 'login', username: 'tf_admin', password: 'password123' });
    assert.match((await form({ action: 'totp', code: backup[0] }, s2.cookie)).text, /Wrong code|Codice sbagliato/);
    assert.equal((await admin.get('/api/totp.php')).json.backup_left, 7);
    let last;
    for (let i = 0; i < 6; i++) last = await form({ action: 'totp', code: '000000' }, s2.cookie);
    assert.match(last.text, /Too many|Troppi/);
});

test('switching off needs the password AND a code; then the password alone logs in again', async () => {
    assert.equal((await admin.post('/api/totp.php', { action: 'disable', password: 'password123', code: '000000' })).status, 403);
    assert.equal((await admin.post('/api/totp.php', { action: 'disable', password: 'wrong-password', code: backup[1] })).status, 403);
    assert.equal((await admin.post('/api/totp.php', { action: 'disable', password: 'password123', code: backup[1] })).json.success, true);
    site.db('DELETE FROM rate_limits');                              // this test file made many login attempts on purpose
    assert.equal((await new Client(site).login('tf_admin')).json.success, true);
});
