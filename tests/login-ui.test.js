// tests/login-ui.test.js — the sign-in / registration page: dusk theme, two clear forms, errors inside the card, the name is kept
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client } = require('./helpers');

let site;
test.before(async () => { site = await startSite(); });
test.after(() => site.stop());
const send = async (fields, qs = '?lang=en') => {
    const res = await fetch(site.base + '/pages/login.php' + qs, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });
    return { status: res.status, location: res.headers.get('location'), text: await res.text() };
};

test('sign-in page: site theme, two forms (sign in / register) chosen by tabs, no desktop leftovers', async () => {
    const login = (await new Client(site).get('/pages/login.php?lang=en')).text;
    assert.match(login, /css\/giochi\.css/); assert.ok(!/nav-btn|terminal-input|id="canvas"|cyber-panel|hack-container/.test(login));
    assert.match(login, /<nav class="seg"/); assert.match(login, /<a href="login\.php" aria-current="page">Sign in<\/a>/);
    assert.match(login, /<input type="hidden" name="action" value="login">/);
    assert.ok(!login.includes('name="accept_terms"'), 'no consent box on the sign-in form');
    const reg = (await new Client(site).get('/pages/login.php?mode=register&lang=en')).text;
    assert.match(reg, /<a href="login\.php\?mode=register" aria-current="page">Register<\/a>/);
    assert.match(reg, /<input type="hidden" name="action" value="register">/);
    assert.match(reg, /name="accept_terms" value="1" required/); assert.match(reg, /autocomplete="new-password"/);
    assert.match(reg, /3–32 characters/); assert.match(reg, /At least 8 characters/);
});

test('sign-in page: a wrong password shows the error in the card and keeps the name, never the password', async () => {
    const c = new Client(site); await c.register('lg_user');
    const r = await send({ action: 'login', username: 'lg_user', password: 'totally-wrong' });
    assert.equal(r.status, 200);
    assert.match(r.text, /<div class="notice bad" role="alert">Invalid username or password\.<\/div>/);
    assert.match(r.text, /name="username" class="input" value="lg_user"/);
    assert.ok(!r.text.includes('totally-wrong'));
    const ok = await send({ action: 'login', username: 'lg_user', password: 'password123' });
    assert.equal(ok.status, 302); assert.match(ok.location, /index\.php$/, 'signing in lands on the menu');
});

test('registration: errors stay on the registration form and are translated; success signs you in', async () => {
    const taken = await send({ action: 'register', username: 'lg_user', password: 'password123', accept_terms: '1' }, '?mode=register&lang=it');
    assert.equal(taken.status, 200);
    assert.match(taken.text, /aria-current="page">Registrati<\/a>/); assert.match(taken.text, /Nome utente già in uso/);
    const noTerms = await send({ action: 'register', username: 'lg_new', password: 'password123' }, '?mode=register&lang=en');
    assert.match(noTerms.text, /<input type="hidden" name="action" value="register">/); assert.match(noTerms.text, /confirm you have read the privacy page/);
    assert.equal(site.db("SELECT COUNT(*) AS n FROM accounts WHERE username = 'lg_new'")[0].n, 0);
    const weak = await send({ action: 'register', username: 'lg_new', password: 'short', accept_terms: '1' }, '?mode=register&lang=en');
    assert.match(weak.text, /at least 8 characters/i); assert.match(weak.text, /value="lg_new"/);
    const ok = await send({ action: 'register', username: 'lg_new', password: 'password123', accept_terms: '1' }, '?mode=register');
    assert.equal(ok.status, 302); assert.equal(site.db("SELECT COUNT(*) AS n FROM accounts WHERE username = 'lg_new'")[0].n, 1);
});

test('sign-in page: "next" survives the tabs and the form, and only known pages are accepted', async () => {
    const p = (await new Client(site).get('/pages/login.php?next=appunti.php&lang=en')).text;
    assert.ok(p.includes('login.php?mode=register&next=appunti.php'));
    assert.match(p, /<input type="hidden" name="next" value="appunti\.php">/);
    const bad = (await new Client(site).get('/pages/login.php?next=https://evil.example&lang=en')).text;
    assert.ok(!bad.includes('evil.example'));
});
