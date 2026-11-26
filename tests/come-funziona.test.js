// tests/come-funziona.test.js — the "How it works" page for first-time visitors
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client } = require('./helpers');

let site;
test.before(async () => { site = await startSite(); });
test.after(() => site.stop());

test('the page is there in both languages: title, description, three steps, a real picture with a text alternative, questions', async () => {
    for (const [lang, h1, steps] of [['it', 'Come funziona vector-box', ['Scegli dove andare', 'Gioca o leggi subito', 'Un account solo se ti serve']],
                                      ['en', 'How vector-box works', ['Pick where to go', 'Play or read right away', 'An account only if you need one']]]) {
        const r = await fetch(`${site.base}/pages/come-funziona.php?lang=${lang}`);
        assert.equal(r.status, 200);
        const html = await r.text();
        assert.match(html, new RegExp(`<html lang="${lang}"`)); assert.match(html, new RegExp(`<h1>${h1}</h1>`));
        assert.match(html, /<meta name="description" content="[^"]{60,}"/);
        for (const s of steps) assert.ok(html.includes(s), s);
        assert.match(html, /<img src="\.\.\/assets\/home-menu\.jpg"[^>]*width="390" height="844"[^>]*alt="[^"]{40,}"/, 'picture with size and a real alt text');
        assert.equal((html.match(/<details>/g) || []).length, 4);
        assert.ok(!/<script/i.test(html), 'no script at all');
    }
    const img = await fetch(`${site.base}/assets/home-menu.jpg`);
    assert.equal(img.status, 200); assert.match(img.headers.get('content-type'), /image\/jpeg/);
    assert.ok((await img.arrayBuffer()).byteLength < 150000, 'a light picture');
});

test('every link on the page works; the page sets no cookie by itself', async () => {
    const plain = await fetch(`${site.base}/pages/come-funziona.php`);
    assert.ok(!plain.headers.get('set-cookie'), 'no cookie without choosing a language');
    const html = await plain.text();
    const hrefs = [...new Set([...html.matchAll(/href="([^"#]+)"/g)].map((m) => m[1]))].filter((h) => !/^https?:|^\?/.test(h) && !h.endsWith('.css'));
    assert.ok(hrefs.length >= 8, 'the links are there');
    for (const h of hrefs) {
        const r = await fetch(new URL(h, `${site.base}/pages/come-funziona.php`), { redirect: 'manual' });
        assert.ok(r.status < 400, `${h} -> ${r.status}`);
    }
});

test('the home menu points to it (under the lead and in the footer), it is in the sitemap and is not one of the cards', async () => {
    const c = new Client(site);
    for (const [lang, link, foot] of [['it', 'Nuovo qui? Scopri come funziona', 'Come funziona'], ['en', 'New here? See how it works', 'How it works']]) {
        const home = (await c.get(`/?lang=${lang}`)).text;
        assert.ok(home.includes('href="pages/come-funziona.php"') && home.includes(link), lang + ' lead link');
        assert.match(home, new RegExp(`<footer[\\s\\S]*come-funziona\\.php[^>]*>${foot}<`), lang + ' footer link');
        assert.equal((home.match(/class="mcard /g) || []).length, 8, 'still eight cards');
    }
    assert.ok((await (await fetch(`${site.base}/sitemap.php`)).text()).includes('/pages/come-funziona.php'));
});

test('the contact page shows the support address, and the home footer links to it', async () => {
    const c = new Client(site);
    const page = await c.get('/pages/contatti.php?lang=en');
    assert.equal(page.status, 200); assert.match(page.text, /mailto:support@/);
    assert.match((await c.get('/?lang=it')).text, /<footer[\s\S]*contatti\.php[^>]*>Contatti</);
    assert.ok((await (await fetch(`${site.base}/sitemap.php`)).text()).includes('/pages/contatti.php'));
});
