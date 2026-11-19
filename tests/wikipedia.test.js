// tests/wikipedia.test.js — the offline Wikipedia: its front page (search box that goes to /wiki/, the credit the licence asks for, both
// languages, no cookie) and the relay of /wiki/... to Kiwix on localhost (a fake Kiwix here): what is passed on, what is not,
// bad paths, and a clear 503 when Kiwix is not running.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startSite, Client } = require('./helpers');

let site, down, kiwix, kiwixBase;
test.before(async () => {
    kiwix = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://x');
        if (u.pathname === '/wiki/content/x/Banana') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ETag: '"e1"', 'Cache-Control': 'max-age=5', 'Set-Cookie': 'evil=1', 'X-Secret': 's' });
            return res.end('<p>Banana</p>');
        }
        if (u.pathname === '/wiki/search') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ url: req.url, cookie: req.headers.cookie || null, auth: req.headers.authorization || null }));
        }
        if (u.pathname === '/wiki/big') {
            if (req.headers.range) { res.writeHead(206, { 'Content-Type': 'application/octet-stream', 'Content-Range': 'bytes 0-3/10' }); return res.end('0123'); }
            res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); return res.end('0123456789');
        }
        if (u.pathname === '/wiki/go') { res.writeHead(302, { Location: '/wiki/content/x/Banana' }); return res.end(); }
        res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('nope');
    });
    await new Promise(r => kiwix.listen(0, '127.0.0.1', r));
    kiwixBase = 'http://127.0.0.1:' + kiwix.address().port;
    site = await startSite({ WIKI_UPSTREAM: kiwixBase });
    down = await startSite({ WIKI_UPSTREAM: 'http://127.0.0.1:1' });   // nothing listens there
});
test.after(async () => { await site.stop(); await down.stop(); kiwix.close(); });

test('wikipedia page: search form goes to /wiki/search with the book name, licence credit, no cookie', async () => {
    const plain = await fetch(site.base + '/pages/wikipedia.php');
    assert.equal(plain.status, 200);
    assert.ok(!plain.headers.get('set-cookie'), 'the page itself must not set a cookie (only choosing a language does, the site\'s technical language cookie)');
    const res = await fetch(site.base + '/pages/wikipedia.php?lang=en');
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<form class="wiki-search" action="\/wiki\/search" method="get"/);
    assert.match(html, /<input type="hidden" name="content" value="wikipedia_it_top_mini_2026-10">/);   // kiwix-serve's book name is the file name without .zim
    assert.match(html, /name="pattern" required/);
    assert.match(html, /href="\/wiki\/"/);
    assert.match(html, /creativecommons\.org\/licenses\/by-sa\/4\.0/);   // CC BY-SA 4.0: the credit is the condition of the licence
    assert.match(html, /href="https:\/\/it\.wikipedia\.org"/);
    assert.match(html, /not affiliated with the Wikimedia Foundation/);
    assert.match(html, /Provisional October 2026 version/);
    assert.match(html, /css\/wikipedia\.css\?v=\d+/);
});

test('wikipedia page: Italian text and the language switch', async () => {
    const html = (await new Client(site).get('/pages/wikipedia.php?lang=it')).text;
    assert.match(html, /<h1>Wikipedia offline<\/h1>/);
    assert.match(html, /Cerca un articolo/);
    assert.match(html, /Versione provvisoria/);
    assert.match(html, /hreflang="en">EN</);
    const en = (await new Client(site).get('/pages/wikipedia.php?lang=en')).text;
    assert.match(en, /<h1>Offline Wikipedia<\/h1>/);
    assert.match(en, /hreflang="it">IT</);
});

test('wikipedia page is in the sitemap, and crawlers are kept out of /wiki/', async () => {
    assert.match((await new Client(site).get('/sitemap.php')).text, /\/pages\/wikipedia\.php/);
    assert.match((await new Client(site).get('/robots.txt')).text, /^Disallow: \/wiki\/$/m);
});

test('relay: body, type and cache headers pass; cookies and unknown headers do not; search engines are told not to index', async () => {
    const r = await fetch(site.base + '/wiki/content/x/Banana');
    assert.equal(r.status, 200);
    assert.equal(await r.text(), '<p>Banana</p>');
    assert.match(r.headers.get('content-type'), /^text\/html/);
    assert.equal(r.headers.get('etag'), '"e1"');
    assert.match(r.headers.get('cache-control'), /max-age=5/);
    assert.ok(!r.headers.get('set-cookie'), 'the upstream cookie must be dropped');
    assert.ok(!r.headers.get('x-secret'), 'headers outside the list are dropped');
    assert.match(r.headers.get('x-robots-tag'), /noindex/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('relay: the query string passes, the visitor\'s cookies and credentials never reach Kiwix', async () => {
    const r = await fetch(site.base + '/wiki/search?content=b&pattern=ban%20ana', { headers: { Cookie: 'PHPSESSID=abc', Authorization: 'Bearer secret' } });
    const j = await r.json();
    assert.equal(j.url, '/wiki/search?content=b&pattern=ban%20ana');
    assert.equal(j.cookie, null); assert.equal(j.auth, null);
});

test('relay: ranges are forwarded and redirects are passed on, not followed', async () => {
    const part = await fetch(site.base + '/wiki/big', { headers: { Range: 'bytes=0-3' } });
    assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), 'bytes 0-3/10'); assert.equal(await part.text(), '0123');
    const go = await fetch(site.base + '/wiki/go', { redirect: 'manual' });
    assert.equal(go.status, 302); assert.equal(go.headers.get('location'), '/wiki/content/x/Banana');
    const root = await fetch(site.base + '/wiki', { redirect: 'manual' });
    assert.equal(root.status, 301); assert.equal(root.headers.get('location'), '/wiki/');
});

test('relay: only GET and HEAD, bad paths are refused, other unknown paths are still plain 404s', async () => {
    const post = await fetch(site.base + '/wiki/content/x/Banana', { method: 'POST', body: 'a=1' });
    assert.equal(post.status, 405); assert.equal(post.headers.get('allow'), 'GET, HEAD');
    const head = await fetch(site.base + '/wiki/content/x/Banana', { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
    assert.equal((await fetch(site.base + '/wiki/a%00b')).status, 400);
    assert.equal((await fetch(site.base + '/wiki/a%5C..%5Cb')).status, 400);
    assert.equal((await fetch(site.base + '/wikipedia-nope')).status, 404);
    assert.equal((await fetch(site.base + '/wiki/missing')).status, 404);   // Kiwix's own 404 is passed on
});

test('relay: Kiwix not running gives a clear 503 with Retry-After, in both languages', async () => {
    const r = await fetch(down.base + '/wiki/content/x/Banana');
    assert.equal(r.status, 503); assert.ok(Number(r.headers.get('retry-after')) > 0);
    const t = await r.text();
    assert.match(t, /not available right now/); assert.match(t, /non è disponibile/);
});
