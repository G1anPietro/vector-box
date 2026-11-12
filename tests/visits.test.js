// tests/visits.test.js — visit log (data/visits.log) and the ntfy notification for new visits
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { startSite, Client, makeAdmin, freePort } = require('./helpers');

const FIREFOX = 'Mozilla/5.0 (Android 14; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test.describe('visits', () => {
    let site, ntfy, ntfyPort;
    const pushes = [];

    test.before(async () => {
        ntfyPort = await freePort();
        ntfy = http.createServer((req, res) => {
            let body = '';
            req.on('data', (c) => { body += c; });
            req.on('end', () => { pushes.push({ title: req.headers.title, body }); res.end('{}'); });
        }).listen(ntfyPort, '127.0.0.1');
        site = await startSite({
            TRUSTED_PROXIES: '127.0.0.1',            // so X-Forwarded-For stands in for real visitors
            VISIT_NTFY_URL: `http://127.0.0.1:${ntfyPort}/visits`,
        });
    });
    test.after(async () => { ntfy.close(); await site.stop(); });

    const visit = (ip, url = '/pages/giochi.php', ua = FIREFOX, client = null) =>
        (client || new Client(site)).get(url, { headers: { 'User-Agent': ua, 'X-Forwarded-For': ip } });
    const logLines = () => {
        const f = path.join(site.root, 'data', 'visits.log');
        return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean) : [];
    };

    test('a new visitor is logged once and notified once', async () => {
        assert.equal((await visit('203.0.113.5')).status, 200);
        await visit('203.0.113.5', '/pages/resume.php');   // same visit: a page view, not a new visit
        await sleep(300);
        const lines = logLines();
        assert.equal(lines.length, 1);
        const cols = lines[0].split('\t');
        assert.equal(cols[1], '203.0.113.5');
        assert.equal(cols[3], '/pages/giochi.php');
        assert.equal(cols[4], 'Firefox, Android');
        assert.equal(cols[5], 'first');
        assert.equal(pushes.length, 1);
        assert.match(pushes[0].body, /Nuovo visitatore su \/pages\/giochi\.php/);
        assert.match(pushes[0].body, /IP 203\.0\.113\.5/);
    });

    test('bots and the server itself are ignored', async () => {
        const before = logLines().length;
        await visit('203.0.113.9', '/pages/giochi.php', 'Mozilla/5.0 (compatible; Googlebot/2.1)');
        await visit('203.0.113.9', '/pages/giochi.php', 'curl/8.5.0');
        await new Client(site).get('/pages/giochi.php', { headers: { 'User-Agent': FIREFOX } }); // 127.0.0.1
        await sleep(200);
        assert.equal(logLines().length, before);
    });

    test('static game pages report through the beacon', async () => {
        const r = await visit('198.51.100.7', '/api/visit.php?p=%2Fpages%2Fspia.html');
        assert.equal(r.status, 204);
        await sleep(300);
        const last = logLines().at(-1).split('\t');
        assert.equal(last[1], '198.51.100.7');
        assert.equal(last[3], '/pages/spia.html');
        assert.match(pushes.at(-1).body, /\/pages\/spia\.html/);
    });

    test('a logged-in user is named; an admin is logged but not notified', async () => {
        const user = new Client(site);
        await user.register('visit_user');
        await visit('198.51.100.20', '/index.php', FIREFOX, user);
        await sleep(300);
        assert.equal(logLines().at(-1).split('\t')[2], 'visit_user');
        assert.match(pushes.at(-1).body, /^visit_user su \/index\.php/);

        const pushesBefore = pushes.length;
        const admin = await makeAdmin(site, 'visit_admin');
        await visit('198.51.100.21', '/index.php', FIREFOX, admin);
        await sleep(300);
        assert.equal(logLines().at(-1).split('\t')[2], 'visit_admin');
        assert.equal(pushes.length, pushesBefore);
    });

    test('the beacon only accepts site paths', async () => {
        await visit('198.51.100.30', '/api/visit.php?p=https%3A%2F%2Fevil.example%2F');
        await sleep(200);
        assert.equal(logLines().at(-1).split('\t')[3], '/?');
    });
});

test.describe('visit statistics page', () => {
    test('admin only; counts come from visits.log', async () => {
        const fs = require('fs'), path = require('path');
        const site = await startSite();
        try {
            await fetch(`${site.base}/index.php`);
            const day = new Date().toISOString().slice(0, 10);
            const line = (ip, user, page, back) => [`${day} 10:00:00`, ip, user, page, 'Firefox, Android', back ? 'returning' : 'first', '-'].join('\t');
            fs.writeFileSync(path.join(site.root, 'data/visits.log'), [line('1.1.1.1', '-', '/pages/giochi.php', false),
                line('1.1.1.2', 'mario', '/pages/spia.html', true), line('1.1.1.3', '-', '/pages/giochi.php', false)].join('\n') + '\n');
            assert.equal((await fetch(`${site.base}/pages/stats.php`)).status, 403);
            const user = new Client(site); await user.register('st_user');
            assert.equal((await user.get('/pages/stats.php')).status, 403);
            const admin = await makeAdmin(site, 'st_admin');
            const html = (await admin.get('/pages/stats.php?days=7')).text;
            assert.match(html, /<span class="big">3<\/span><span>visite oggi<\/span>/);
            assert.match(html, /\/pages\/giochi\.php<\/span>.*?<span class="value">2 /s);
            assert.match(html, />mario</);
            assert.match((await admin.get('/index.php')).text, /\/\/ STATISTICHE/);
        } finally { await site.stop(); }
    });
});
