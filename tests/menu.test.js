// tests/menu.test.js — the home page is a menu (games, notes, account, project, desktop); the desktop lives at /desktop.php
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client, makeAdmin } = require('./helpers');

let site;
test.before(async () => { site = await startSite(); });
test.after(() => site.stop());

test('the home page is the menu: five cards, the OS card goes to desktop.php, no desktop windows on it', async () => {
    for (const p of ['/', '/index.php']) {
        const r = await new Client(site).get(p + '?lang=en');
        assert.equal(r.status, 200, p);
        assert.match(r.text, /<html lang="en"/);
        for (const href of ['pages/giochi.php', 'pages/appunti.php', 'pages/login.php', 'pages/progetto.php', 'desktop.php']) {
            assert.ok(r.text.includes(`href="${href}"`), p + ' links to ' + href);
        }
        assert.equal((r.text.match(/class="mcard /g) || []).length, 5);
        assert.ok(!r.text.includes('win-terminal') && !r.text.includes('id="canvas"'), 'the desktop is not on the menu');
        assert.match(r.text, /Operating system/);
    }
    const it = await new Client(site).get('/?lang=it');
    assert.match(it.text, /<html lang="it"/); assert.match(it.text, /Sistema operativo/); assert.match(it.text, /Appunti di classe/);
});

test('the Account card follows the login: login page for a guest, account page and the name for a user', async () => {
    const guest = (await new Client(site).get('/?lang=en')).text;
    assert.ok(guest.includes('href="pages/login.php"') && !guest.includes('href="pages/account.php"'));
    const user = new Client(site); await user.register('menu_user');
    const page = (await user.get('/?lang=en')).text;
    assert.ok(page.includes('href="pages/account.php"') && !page.includes('href="pages/login.php"'));
    assert.match(page, /Signed in as menu_user/);
});

test('nothing for the admin only is on the menu, even for an admin', async () => {
    const admin = await makeAdmin(site, 'menu_admin');
    const html = (await admin.get('/?lang=en')).text;
    for (const word of ['STATISTICS', 'VIEW DOSSIER', 'BOOK READER', 'stats.php', 'resume.php', 'reader.php', 'mail.php']) assert.ok(!html.includes(word), word);
});

test('the desktop moved to /desktop.php with its windows and a HOME link back to the menu; unknown paths are still 404', async () => {
    const d = await new Client(site).get('/desktop.php?lang=en');
    assert.equal(d.status, 200);
    assert.ok(d.text.includes('id="win-terminal"') && d.text.includes('id="win-chatfeed"') && d.text.includes('id="win-poker"'));
    assert.match(d.text, /<a href="index\.php" class="menu-item">\/\/ HOME<\/a>/);
    assert.match(d.text, /og:url" content="[^"]*\/desktop\.php"/);
    const nope = await fetch(site.base + '/nonexistent');
    assert.equal(nope.status, 404);
    assert.match(await nope.text(), /SIGNAL_LOST/);
});

test('pages that need the desktop link to it, the others link to the menu', async () => {
    const g = (await new Client(site).get('/pages/giochi.php?lang=en')).text;
    assert.ok(g.includes("href=\"../desktop.php\""), 'the poker card opens the desktop');
    for (const p of ['/pages/vault.php', '/pages/hack.php']) assert.ok((await new Client(site).get(p)).text.includes('href="../desktop.php"'), p);
    assert.ok((await new Client(site).get('/pages/sicurezza.php?lang=en')).text.includes('href="../desktop.php">operating system page'));
    const login = (await new Client(site).get('/pages/login.php?lang=en')).text;
    assert.ok(login.includes('href="../index.php" class="nav-btn"') && login.includes('BACK_TO_HOME'));
});
