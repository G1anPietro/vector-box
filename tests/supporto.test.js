// tests/supporto.test.js — donors, supporter badge, ad-free accounts, "where the money goes" page
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startSite, Client, makeAdmin } = require('./helpers');

test.describe('donors, badge, ad-free accounts and the money page', () => {
    let site, admin, mario;
    test.before(async () => {
        site = await startSite({ ADSENSE_CLIENT: 'ca-pub-1234567890123456', ADSENSE_SLOT_SUPPORT: '1234567890' });
        admin = await makeAdmin(site, 'don_admin');
        mario = new Client(site); await mario.register('mario_don');
    });
    test.after(async () => { await site.stop(); });

    const post = (c, body) => c.post('/api/donors.php', body);

    test('only the admin can read or change the donors', async () => {
        assert.equal((await fetch(`${site.base}/api/donors.php`)).status, 403);
        assert.equal((await mario.get('/api/donors.php')).status, 403);
        assert.equal((await post(mario, { action: 'add', amount: 5 })).status, 403);
    });

    test('add validates amount, date and user; the admin sees the list', async () => {
        assert.equal((await post(admin, { action: 'add', amount: -1 })).status, 400);
        assert.equal((await post(admin, { action: 'add', amount: 5, date: '2026-13-40' })).status, 400);
        assert.equal((await post(admin, { action: 'add', amount: 5, username: 'nobody_here' })).status, 404);
        const ok = await post(admin, { action: 'add', amount: '5,50', username: 'mario_don', name: 'Mario R.', public: true, note: 'grazie' });
        assert.equal(ok.status, 200);
        await post(admin, { action: 'add', amount: 10, name: 'Anonimo segreto' });   // private: never listed
        const list = (await admin.get('/api/donors.php')).json;
        assert.equal(list.donors.length, 2);
        assert.equal(list.donors.find((d) => d.username === 'mario_don').amount_cents, 550);
    });

    test('the money page lists only public donors, never amounts per person; the badge shows on the account page', async () => {
        const html = await (await fetch(`${site.base}/pages/soldi.php?lang=it`)).text();
        assert.match(html, /Dove vanno i soldi/);
        assert.match(html, /Mario R\./);
        assert.ok(!html.includes('Anonimo segreto'));
        assert.match(html, /<strong>15,50 €<\/strong> da <strong>2<\/strong> donazioni/);
        assert.match((await mario.get('/pages/account.php')).text, /SUPPORTER/);
        assert.ok(!/SUPPORTER/.test((await admin.get('/pages/account.php')).text));
    });

    test('costs come from data/soldi.json when present', async () => {
        fs.writeFileSync(path.join(site.root, 'data/soldi.json'), JSON.stringify({ updated: '2026-11-16', costs: [{ label: 'Corrente <b>', eur_month: 4 }, { label: 'Dominio', eur_month: 1 }] }));
        const html = await (await fetch(`${site.base}/pages/soldi.php?lang=it`)).text();
        assert.match(html, /Corrente &lt;b&gt;/);      // escaped
        assert.match(html, /Totale: 5 € al mese/);
    });

    test('ads: shown to everybody except the admin and the ad-free accounts', async () => {
        const hasAd = (html) => html.includes('adsbygoogle');
        assert.ok(hasAd(await (await fetch(`${site.base}/pages/ads.php`)).text()), 'anonymous sees ads');
        assert.ok(hasAd((await mario.get('/pages/ads.php')).text), 'normal account sees ads');
        assert.ok(!hasAd((await admin.get('/pages/ads.php')).text), 'admin never sees ads');
        assert.equal((await post(admin, { action: 'ads_free', username: 'mario_don', value: true })).status, 200);
        assert.ok(!hasAd((await mario.get('/pages/ads.php')).text), 'ad-free account sees none');
        assert.equal((await post(admin, { action: 'ads_free', username: 'mario_don', value: false })).status, 200);
        assert.ok(hasAd((await mario.get('/pages/ads.php')).text), 'and sees them again');
    });

    test('remove deletes a donation', async () => {
        const id = (await admin.get('/api/donors.php')).json.donors[0].id;
        assert.equal((await post(admin, { action: 'remove', id })).status, 200);
        assert.equal((await post(admin, { action: 'remove', id })).status, 404);
    });
});
