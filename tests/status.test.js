// tests/status.test.js — public status endpoint
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const { startSite, Client, freePort } = require('./helpers');

let site, upServer, upPort, downPort;

test.before(async () => {
    upPort = await freePort();
    upServer = net.createServer((s) => s.end()).listen(upPort, '127.0.0.1');
    downPort = await freePort(); // nothing listens here
    site = await startSite({
        STATUS_CHECKS: `Minecraft=127.0.0.1:${upPort}, Broken=127.0.0.1:${downPort},bad entry,X=host:99999`,
    });
});
test.after(async () => { upServer.close(); await site.stop(); });

test('status: public, reports system numbers and named service checks only', async () => {
    const r = await new Client(site).get('/api/status.php');
    assert.equal(r.status, 200);
    assert.equal(r.json.success, true);
    assert.ok(r.json.uptime_seconds > 0);
    assert.deepEqual(r.json.services.map((s) => [s.name, s.up]), [['Minecraft', true], ['Broken', false]]);
    assert.ok(!r.text.includes('127.0.0.1'), 'hosts/ports are never published');
});

test('status: cached between calls', async () => {
    const a = await new Client(site).get('/api/status.php');
    upServer.close();
    const b = await new Client(site).get('/api/status.php');
    assert.equal(a.json.generated_at, b.json.generated_at);
    assert.equal(b.json.services[0].up, true, 'served from cache, not re-checked');
});
