// tests/seo.test.js — sitemap and link previews (Open Graph) on the public pages
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite } = require('./helpers');

test.describe('search engines and link previews', () => {
    let site;
    test.before(async () => { site = await startSite({ SITE_URL: 'https://example.test' }); });
    test.after(async () => { await site.stop(); });

    test('the sitemap lists the public pages and none of the private ones', async () => {
        const r = await fetch(`${site.base}/sitemap.php`);
        assert.equal(r.status, 200);
        assert.match(r.headers.get('content-type'), /xml/);
        const xml = await r.text();
        for (const p of ['/pages/giochi.php', '/pages/spia.html', '/pages/solitario.html']) assert.ok(xml.includes(`https://example.test${p}`), p);
        for (const p of ['reader.php', 'resume.php', 'account.php']) assert.ok(!xml.includes(p), p);
    });

    test('PHP pages build their previews from SITE_URL', async () => {
        const html = await (await fetch(`${site.base}/pages/giochi.php?lang=it`)).text();
        assert.match(html, /<meta property="og:title" content="Giochi — vector-box">/);
        assert.match(html, /<meta property="og:image" content="https:\/\/example\.test\/assets\/og\/giochi\.jpg">/);
        assert.match(html, /<meta name="description" content="Giochi da festa/);
    });

    test('static game pages have a description and a preview image that exists', async () => {
        for (const g of ['spia', 'lupus', 'nonhomai', 'solitario']) {
            const html = await (await fetch(`${site.base}/pages/${g}.html`)).text();
            assert.match(html, /<meta name="description" content="[^"]{40,}">/, g);
            const img = html.match(/og:image" content="https:\/\/[^/]+(\/[^"]+)"/)[1];
            assert.equal((await fetch(site.base + img)).status, 200, img);
        }
    });
});

test.describe('donation page', () => {
    test('not configured: a notice and no buttons anywhere', async () => {
        const site = await startSite();
        try {
            assert.doesNotMatch(await (await fetch(`${site.base}/pages/ads.php?lang=it`)).text(), /Offrimi un caffè/);
            const page = await (await fetch(`${site.base}/pages/dona.php?lang=it`)).text();
            assert.match(page, /Le donazioni non sono ancora attive/);
            assert.doesNotMatch(page, /class="cta coffee"/);
        } finally { await site.stop(); }
    });

    test('Ko-fi + PayPal + goal: buttons on the page, Support and Games point to it', async () => {
        const site = await startSite({ DONATE_URL: 'https://ko-fi.com/esempio', DONATE_PAYPAL_URL: 'https://paypal.me/esempio',
            DONATE_GOAL_TEXT: 'Disco NVMe nuovo', DONATE_GOAL_EUR: '40', DONATE_RAISED_EUR: '18' });
        try {
            const page = await (await fetch(`${site.base}/pages/dona.php?lang=it`)).text();
            assert.match(page, /href="https:\/\/ko-fi\.com\/esempio"[^>]*>☕ Dona con Ko-fi/);
            assert.match(page, /href="https:\/\/paypal\.me\/esempio"/);
            assert.match(page, /Disco NVMe nuovo<\/strong><span>18 € su 40 €/);
            assert.match(page, /aria-valuenow="45"/);
            assert.match(await (await fetch(`${site.base}/pages/ads.php?lang=it`)).text(), /href="dona\.php">☕ Offrimi un caffè/);
            assert.match(await (await fetch(`${site.base}/pages/giochi.php?lang=en`)).text(), /href="dona\.php">☕ Buy me a coffee/);
        } finally { await site.stop(); }
    });

    test('links that are not plain https (or not paypal.me for PayPal) are ignored', async () => {
        const site = await startSite({ DONATE_URL: 'javascript:alert(1)', DONATE_PAYPAL_URL: 'https://evil.example/paypal.me/x' });
        try {
            const page = await (await fetch(`${site.base}/pages/dona.php?lang=it`)).text();
            assert.match(page, /Le donazioni non sono ancora attive/);
            assert.doesNotMatch(page, /evil\.example|javascript:/);
        } finally { await site.stop(); }
    });
});
