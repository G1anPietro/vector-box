// tests/errori-404.test.js — unknown paths get the 404 page; the home page and static error pages are untouched
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite } = require('./helpers');

test.describe('404 for unknown paths', () => {
    let site;
    test.before(async () => { site = await startSite(); });
    test.after(async () => { await site.stop(); });

    test('home page still answers 200 (with or without a query string)', async () => {
        for (const p of ['/', '/?x=1', '/index.php']) {
            const r = await fetch(site.base + p);
            assert.equal(r.status, 200, p);
            assert.ok(!(await r.text()).includes('SIGNAL_LOST'), p);
        }
    });

    test('an unknown path answers 404 with the error page', async () => {
        for (const p of ['/nonexistent', '/foo/bar', '/index.php/extra']) {
            const r = await fetch(site.base + p);
            assert.equal(r.status, 404, p);
            assert.match(await r.text(), /SIGNAL_LOST/, p);
        }
    });

    test('the error page assets are served', async () => {
        assert.equal((await fetch(`${site.base}/errors/errors.css`)).status, 200);
        assert.equal((await fetch(`${site.base}/errors/errors.js`)).status, 200);
    });
});

test.describe('bots', () => {
    const { Client, makeAdmin } = require('./helpers');
    let site;
    test.before(async () => { site = await startSite({ TRUSTED_PROXIES: '127.0.0.1' }); });   // X-Forwarded-For stands in for a real visitor
    test.after(async () => { await site.stop(); });
    const get = (p, ua) => fetch(site.base + p, { headers: { 'User-Agent': ua, 'X-Forwarded-For': '203.0.113.7' }, redirect: 'manual' });

    test('abusive scrapers get 403 on pages and unknown paths; a normal browser and a search engine do not', async () => {
        assert.equal((await get('/', 'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)')).status, 403);
        assert.equal((await get('/pages/giochi.php', 'Mozilla/5.0 (compatible; SemrushBot/7~bl)')).status, 403);
        assert.equal((await get('/nope', 'Bytespider')).status, 403);
        assert.equal((await get('/', 'Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36')).status, 200);
        assert.equal((await get('/', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).status, 200);
        // AI crawlers are only asked to stay away (robots.txt) unless BOT_BLOCK_AI=true
        assert.equal((await get('/', 'Mozilla/5.0 (compatible; GPTBot/1.1)')).status, 200);
    });

    test('a scanner hitting probe paths is told to stop after 8 tries (429, no page); ordinary typos never are', async () => {
        const ua = 'Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36';
        for (let i = 0; i < 8; i++) assert.equal((await get(`/wp-login.php?x=${i}`, ua)).status, 404);
        const r = await get('/.env', ua);
        assert.equal(r.status, 429);
        assert.equal(r.headers.get('retry-after'), '3600');
        for (let i = 0; i < 12; i++) assert.equal((await get(`/tipo${i}`, ua)).status, 404);
    });

    test('the statistics page counts bots by kind', async () => {
        const admin = await makeAdmin(site, 'bot_admin');
        const html = (await admin.get('/pages/stats.php?days=7')).text;
        assert.match(html, /Bot e richieste automatiche/);
        assert.match(html, /Scraper bloccati/);
        assert.match(html, /Scanner di vulnerabilità/);
        assert.match(html, /AhrefsBot/);
        assert.match(html, /wordpress/);
        assert.match(html, /Googlebot/);
        assert.match(html, /<span class="big">[1-9]\d*<\/span><span>respinte/);
    });
});
