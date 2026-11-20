// tests/wikipedia.test.js — the front page of the offline Wikipedia: search box that goes to /wiki/ (nginx sends that path to Kiwix on
// localhost, see docs/DA-FARE.md), the credit the licence asks for, both languages, no cookie, in the sitemap, kept out of crawlers.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client } = require('./helpers');

let site;
test.before(async () => { site = await startSite(); });
test.after(() => site.stop());

test('wikipedia page: search form goes to /wiki/search with the book name, licence credit, no cookie', async () => {
    const plain = await fetch(site.base + '/pages/wikipedia.php');
    assert.equal(plain.status, 200);
    assert.ok(!plain.headers.get('set-cookie'), 'the page itself must not set a cookie (only choosing a language does, the site\'s technical language cookie)');
    const res = await fetch(site.base + '/pages/wikipedia.php?lang=en');
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<form class="wiki-search" action="\/wiki\/search" method="get"/);
    assert.match(html, /<input type="hidden" name="content" value="wikipedia_it_all_maxi_2026-08">/);   // kiwix-serve's book name is the file name without .zim
    assert.match(html, /name="pattern" required/);
    assert.match(html, /href="\/wiki\/"/);
    assert.match(html, /creativecommons\.org\/licenses\/by-sa\/4\.0/);   // CC BY-SA 4.0: the credit is the condition of the licence
    assert.match(html, /href="https:\/\/it\.wikipedia\.org"/);
    assert.match(html, /not affiliated with the Wikimedia Foundation/);
    assert.match(html, /August 2026 edition, in Italian, with images/);
    assert.match(html, /css\/wikipedia\.css\?v=\d+/);
});

test('wikipedia page: Italian text and the language switch', async () => {
    const html = (await new Client(site).get('/pages/wikipedia.php?lang=it')).text;
    assert.match(html, /<h1>Wikipedia offline<\/h1>/);
    assert.match(html, /Cerca un articolo/);
    assert.match(html, /Edizione di agosto 2026/);
    assert.match(html, /hreflang="en">EN</);
    const en = (await new Client(site).get('/pages/wikipedia.php?lang=en')).text;
    assert.match(en, /<h1>Offline Wikipedia<\/h1>/);
    assert.match(en, /hreflang="it">IT</);
});

test('wikipedia page is in the sitemap, and crawlers are kept out of /wiki/', async () => {
    assert.match((await new Client(site).get('/sitemap.php')).text, /\/pages\/wikipedia\.php/);
    assert.match((await new Client(site).get('/robots.txt')).text, /^Disallow: \/wiki\/$/m);
});
