// tests/pihole.test.js — Pi-hole numbers for the STATUS window (admin only), against a fake Pi-hole
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { startSite, Client, makeAdmin, freePort } = require('./helpers');

function fakePihole() {
    const calls = { auth: 0, summary: 0 };
    const server = http.createServer((req, res) => {
        const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
            if (req.url === '/api/auth' && req.method === 'POST') {
                calls.auth++;
                return JSON.parse(body).password === 'app-pass' ? send(200, { session: { valid: true, sid: 'sid123', validity: 1800 } }) : send(401, {});
            }
            if (req.headers['x-ftl-sid'] !== 'sid123' && req.url.startsWith('/api/')) return send(401, {});
            if (req.url === '/api/stats/summary') { calls.summary++; return send(200, { queries: { total: 12345, blocked: 2345, percent_blocked: 19.0 }, gravity: { domains_being_blocked: 150000 }, clients: { active: 9 } }); }
            if (req.url.startsWith('/api/stats/top_domains')) return send(200, { domains: [{ domain: 'ads.example', count: 400 }, { domain: 'tracker.example', count: 120 }] });
            if (req.url.startsWith('/admin/api.php')) return req.url.includes('auth=v5token')
                ? send(200, { dns_queries_today: 500, ads_blocked_today: 50, ads_percentage_today: 10.04, domains_being_blocked: 90000, unique_clients: 4, top_ads: { 'ad.v5': 30 } })
                : send(200, []);
            send(404, {});
        });
    });
    return { server, calls };
}

test.describe('Pi-hole in the STATUS window', () => {
    let site, fake, port;
    test.before(async () => {
        fake = fakePihole(); port = await freePort();
        await new Promise((r) => fake.server.listen(port, '127.0.0.1', r));
        site = await startSite({ PIHOLE_URL: `http://127.0.0.1:${port}`, PIHOLE_PASSWORD: 'app-pass' });
    });
    test.after(async () => { fake.server.close(); await site.stop(); });

    test('only the admin gets the numbers', async () => {
        assert.equal((await new Client(site).get('/api/pihole.php')).status, 403);
        const user = new Client(site); await user.register('ph_user');
        assert.equal((await user.get('/api/pihole.php')).status, 403);
    });

    test('v6: logs in once, reads summary and top blocked, caches the answer', async () => {
        const admin = await makeAdmin(site, 'ph_admin');
        const r = await admin.get('/api/pihole.php');
        assert.equal(r.status, 200);
        assert.deepEqual([r.json.version, r.json.queries, r.json.blocked, r.json.percent, r.json.domains_blocked, r.json.clients], [6, 12345, 2345, 19, 150000, 9]);
        assert.equal(r.json.top_blocked[0].domain, 'ads.example');
        assert.ok(!JSON.stringify(r.json).includes('sid123'), 'the session id never reaches the browser');
        await admin.get('/api/pihole.php');
        assert.equal(fake.calls.auth, 1);
        assert.equal(fake.calls.summary, 1, 'second answer from the 60 s cache');
    });

    test('v5 with an API token, and 404 when nothing is configured', async () => {
        const v5 = await startSite({ PIHOLE_URL: `http://127.0.0.1:${port}`, PIHOLE_API_TOKEN: 'v5token' });
        const a5 = await makeAdmin(v5, 'ph_admin5');
        const r = await a5.get('/api/pihole.php');
        assert.deepEqual([r.json.version, r.json.queries, r.json.percent, r.json.top_blocked[0].domain], [5, 500, 10, 'ad.v5']);
        await v5.stop();
        const none = await startSite();
        assert.equal((await (await makeAdmin(none, 'ph_admin0')).get('/api/pihole.php')).status, 404);
        await none.stop();
    });
});
