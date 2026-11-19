// tests/account-ui.test.js — the account page: dusk theme, one card per setting, result shown inside the card you used
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client, makeAdmin } = require('./helpers');

let site;
test.before(async () => { site = await startSite(); });
test.after(() => site.stop());
const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0';
const post = async (c, fields, token) => {
    const page = await c.get('/pages/account.php?lang=en');
    const t = token ?? page.text.match(/name="csrf_token" value="([0-9a-f]+)"/)[1];
    const res = await fetch(site.base + '/pages/account.php?lang=en', { method: 'POST', redirect: 'manual', body: new URLSearchParams({ csrf_token: t, ...fields }).toString(),
        headers: { Cookie: c.cookieHeader(), 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA } });
    return res.text();
};

test('account page: the site theme, four section shortcuts that point at real sections, no desktop leftovers', async () => {
    const u = new Client(site); await u.register('ui_user');
    const html = (await u.get('/pages/account.php?lang=en')).text;
    assert.match(html, /css\/giochi\.css/); assert.match(html, /css\/account\.css/);
    assert.ok(!/nav-btn|terminal-input|term-muted|id="canvas"|cyber-panel/.test(html), 'no old desktop styles');
    for (const id of ['profile', 'security', 'preferences', 'data']) {
        assert.ok(html.includes(`<a href="#${id}">`), 'shortcut ' + id);
        assert.ok(html.includes(`<section id="${id}"`), 'section ' + id);
    }
    assert.match(html, /<h1>ui_user<\/h1>/); assert.match(html, /class="avatar"[^>]*>U</);
    // every form keeps its token and its action; the filled button is the main action of its card
    assert.equal((html.match(/name="csrf_token" value="[0-9a-f]+"/g) || []).length, 5);
    for (const a of ['update_profile', 'change_username', 'change_password', 'save_theme', 'save_email']) assert.ok(html.includes(`name="action" value="${a}"`), a);
    assert.ok(/<details class="card danger">\s*<summary>Delete my account<\/summary>\s*<form id="delete-account-form">/.test(html), 'deletion is behind a closed disclosure');
    assert.ok(!html.includes('id="admin"') && !html.includes('id="totp"') && !html.includes('admin_users.php'), 'nothing for the admin');
});

test('account page: the admin gets the administration card and two-step login, and no deletion', async () => {
    const admin = await makeAdmin(site, 'ui_admin');
    const html = (await admin.get('/pages/account.php?lang=en')).text;
    assert.ok(html.includes('<a href="#admin">') && html.includes('<section id="admin"') && html.includes('id="totp"'));
    assert.ok(html.includes('href="admin_users.php"') && html.includes('href="mail.php"'));
    assert.ok(!html.includes('id="delete-account-form"'));
});

test('account page: the result of a save appears inside the card that was used, not at the top', async () => {
    const u = new Client(site); await u.register('ui_notice');
    const bad = await post(u, { action: 'change_password', old_password: 'not-the-password', new_password: 'another-pass-123' });
    const iOld = bad.indexOf('name="old_password"'), iNotice = bad.indexOf('class="notice bad"'), iBtn = bad.indexOf('value="change_password"');
    assert.ok(iOld > 0 && iNotice > iOld && iNotice < iBtn, 'the error sits between the fields and the button of the password card');
    assert.ok(iNotice > bad.indexOf('<nav class="tabs"'), 'and not above the shortcuts');
    assert.equal((bad.match(/class="notice /g) || []).length, 1);

    const ok = await post(u, { action: 'update_profile', bio: 'hello there' });
    assert.ok(ok.indexOf('class="notice ok"') > ok.indexOf('name="bio"') && ok.indexOf('class="notice ok"') < ok.indexOf('value="update_profile"'));
    assert.match(ok, />hello there<\/textarea>/);

    const nope = await post(u, { action: 'update_profile', bio: 'x' }, 'f'.repeat(64));   // a wrong form token is not tied to any card
    assert.ok(nope.indexOf('class="notice bad"') > 0 && nope.indexOf('class="notice bad"') < nope.indexOf('<nav class="tabs"'), 'a bad token is shown at the top');
});

test('account page: texts are translated and the language switch is still there', async () => {
    const u = new Client(site); await u.register('ui_lang');
    const it = (await u.get('/pages/account.php?lang=it')).text;
    for (const word of ['Profilo', 'Sicurezza', 'Preferenze', 'I tuoi dati', 'Cambia nome utente', 'Aggiorna la password', 'Elimina il mio account', 'Esci dalla sessione']) assert.ok(it.includes(word), word);
    assert.match(it, /id="vb-lang"/); assert.match(it, /<html lang="it"/);
});
