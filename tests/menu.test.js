// tests/menu.test.js — the home page is a menu (games, notes, account, project, desktop); the desktop lives at /desktop.php
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client, makeAdmin } = require('./helpers');

let site;
test.before(async () => { site = await startSite(); });
test.after(() => site.stop());

test('the home page is the menu: six cards for everyone, the OS card goes to desktop.php, no desktop windows on it', async () => {
    for (const p of ['/', '/index.php']) {
        const r = await new Client(site).get(p + '?lang=en');
        assert.equal(r.status, 200, p);
        assert.match(r.text, /<html lang="en"/);
        for (const href of ['pages/giochi.php', 'pages/appunti.php', 'pages/login.php', 'pages/novita.php', 'pages/progetto.php', 'desktop.php']) {
            assert.ok(r.text.includes(`href="${href}"`), p + ' links to ' + href);
        }
        assert.equal((r.text.match(/class="mcard /g) || []).length, 6);
        assert.ok(!r.text.includes('win-terminal') && !r.text.includes('id="canvas"'), 'the desktop is not on the menu');
        assert.match(r.text, /Operating system/);
    }
    const it = await new Client(site).get('/?lang=it');
    assert.match(it.text, /<html lang="it"/); assert.match(it.text, /Sistema operativo/); assert.match(it.text, /Appunti di classe/);
});

test('the cards come in this order: games, book reader*, class notes, desktop, account, news, project, statistics*  (* only for who may see them)', async () => {
    const order = (html) => [...html.matchAll(/class="mcard [a-z]+" href="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(order((await new Client(site).get('/?lang=en')).text),
        ['pages/giochi.php', 'pages/appunti.php', 'desktop.php', 'pages/login.php', 'pages/novita.php', 'pages/progetto.php']);
    const admin = await makeAdmin(site, 'order_admin');
    assert.deepEqual(order((await admin.get('/?lang=en')).text),
        ['pages/giochi.php', 'pages/reader.php', 'pages/appunti.php', 'desktop.php', 'pages/account.php', 'pages/novita.php', 'pages/progetto.php', 'pages/stats.php']);
});

test('"Support vector-box" is a banner under the cards, not a footer link, in both languages', async () => {
    for (const [lang, text] of [['en', 'Support vector-box'], ['it', 'Supporta vector-box']]) {
        const html = (await new Client(site).get('/?lang=' + lang)).text;
        assert.match(html, new RegExp(`<a class="support" href="pages/ads\\.php">[\\s\\S]*?${text}`));
        assert.equal((html.match(/pages\/ads\.php/g) || []).length, 1, 'one entry only');
        assert.ok(html.indexOf('class="support"') > html.indexOf('</nav>') && html.indexOf('class="support"') < html.indexOf('<footer'));
    }
});

test('the Account card follows the login: login page for a guest, account page and the name for a user', async () => {
    const guest = (await new Client(site).get('/?lang=en')).text;
    assert.ok(guest.includes('href="pages/login.php"') && !guest.includes('href="pages/account.php"'));
    const user = new Client(site); await user.register('menu_user');
    const page = (await user.get('/?lang=en')).text;
    assert.ok(page.includes('href="pages/account.php"') && !page.includes('href="pages/login.php"'));
    assert.match(page, /Signed in as menu_user/);
});

test('private cards: the book reader only for who may read books, statistics only for the admin; the pages still refuse the rest', async () => {
    const has = (html, page) => html.includes(`href="pages/${page}.php"`);
    const guest = (await new Client(site).get('/?lang=en')).text;
    assert.ok(!has(guest, 'reader') && !has(guest, 'stats') && !has(guest, 'resume'), 'a guest sees neither');

    const user = new Client(site); await user.register('menu_reader');
    let page = (await user.get('/?lang=en')).text;
    assert.ok(!has(page, 'reader') && !has(page, 'stats'), 'a plain account sees neither');
    assert.equal((await user.get('/pages/stats.php')).status, 403);

    const admin = await makeAdmin(site, 'menu_admin');
    const home = (await admin.get('/?lang=en')).text;
    assert.ok(has(home, 'reader') && has(home, 'stats'), 'the admin sees both');
    assert.match(home, /Book reader/); assert.match(home, /Statistics/); assert.match(home, /Private/);
    assert.ok(!has(home, 'mail') && !home.includes('STATISTICS'), 'nothing else for the admin is on the menu');

    assert.equal((await admin.post('/api/moderate_book_access.php', { action: 'grant', username: 'menu_reader' })).json.success, true);
    page = (await user.get('/?lang=en')).text;
    assert.ok(has(page, 'reader'), 'allowed to read books: the reader card appears');
    assert.ok(!has(page, 'stats'), 'but never the statistics');
    assert.notEqual((await user.get('/pages/reader.php')).status, 403);
    assert.equal((await user.get('/pages/stats.php')).status, 403);

    await admin.post('/api/moderate_book_access.php', { action: 'revoke', username: 'menu_reader' });
    assert.ok(!has((await user.get('/?lang=en')).text, 'reader'), 'revoked: the card is gone again');
    assert.equal((await user.get('/pages/reader.php')).status, 403);
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
    assert.ok(login.includes('class="back" href="../index.php"'), 'the sign-in page has a way back to the menu');
});
