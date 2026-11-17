// tests/salute.test.js — health endpoint, speed panel, daily digest, public weekly counter.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { startSite, Client, makeAdmin } = require('./helpers');

const NOW = Math.floor(Date.now() / 1000);
const nginx = (t, ip, p) => `${ip} - - [${new Date(t * 1000).toUTCString().slice(5, 16).replace(/ /g, '/')}:${new Date(t * 1000).toISOString().slice(11, 19)} +0000] "GET ${p} HTTP/1.1" 200 12 "-" "x"`;
const timed = (t, p, secs, ip = '9.9.9.9') => nginx(t, ip, p) + ` ${secs}`;
const php = (code) => JSON.parse(execFileSync('php', ['-r', `require "${path.join(__dirname, '..', 'public/api/attacks.php')}"; ${code}`], { encoding: 'utf8' }));

test('health: public JSON, nothing leaked; verdict function', async () => {
    const site = await startSite();
    try {
        const r = await new Client(site).init().then(c => c.get('/api/health.php'));
        assert.equal(r.status, 200);
        const j = JSON.parse(r.text);
        assert.deepEqual(Object.keys(j).sort(), ['db', 'disk_free_pct', 'ok', 'time']);
        assert.equal(j.ok, true);
        assert.equal(j.db, true);
    } finally { site.stop(); }
    assert.deepEqual(php('echo json_encode([attacksHealthOk(true, 50), attacksHealthOk(false, 50), attacksHealthOk(true, 4)]);'), [true, false, false]);
});

test('speed: last 24 h, per endpoint, static grouped, streams and untimed lines out', () => {
    const lines = [];
    for (let i = 1; i <= 10; i++) lines.push(timed(NOW - 60, '/api/get_feed.php?x=secret', (i / 100).toFixed(3)));
    lines.push(timed(NOW - 60, '/js/app.js', '0.001'), timed(NOW - 60, '/img/a.png', '0.002'));
    lines.push(timed(NOW - 60, '/api/uplink_stream.php', '30.000'), nginx(NOW - 60, '9.9.9.9', '/untimed'));
    lines.push(timed(NOW - 3 * 86400, '/old', '1.000'));
    const s = php(`echo json_encode(attacksSpeed(json_decode('${JSON.stringify(lines)}'), ${NOW}));`);
    assert.equal(s.n, 12);
    assert.equal(s.endpoints['/api/get_feed.php'].n, 10);
    assert.equal(s.endpoints['/api/get_feed.php'].p95, 100);
    assert.equal(s.endpoints.static.n, 2);
    const j = JSON.stringify(s);
    assert.ok(!j.includes('secret') && !j.includes('stream') && !j.includes('9.9.9.9'));
});

test('digest: once per day after 08:00, no error text, error counting', () => {
    const at = (h) => Math.floor(new Date(2026, 10, 18, h, 0, 0).getTime() / 1000);
    const q = (st, t) => php(`echo json_encode(attacksShouldDigest(${st}, ${t}));`);
    assert.equal(q('null', at(7)), false);
    assert.equal(q('null', at(9)), true);
    assert.equal(q("['digest_date' => '2026-11-18']", at(9)), false);
    assert.equal(q("['digest_date' => '2026-11-17']", at(9)), true);
    const sum = { ssh: { per_day: { '2026-11-17': 5 } }, web: { per_day: { '2026-11-17': 7 } }, bans: { per_day: { '2026-11-17': 1 } } };
    const d = php(`echo json_encode(attacksDigest(json_decode('${JSON.stringify(sum)}', true), 3, 42, ${Date.UTC(2026, 10, 18, 9) / 1000}));`);
    assert.match(d[1], /5 SSH.*7 web.*1 new bans.*errors in the log: 3.*42%/);
    assert.equal(php('echo json_encode(attacksDigest([], 0, 1));'), null);
    const f = path.join(os.tmpdir(), 'vb-err-' + process.pid + '.log');
    fs.writeFileSync(f, 'a\nb\n');
    const [c1, o1] = php(`echo json_encode(attacksNewErrors('${f}', 0));`);
    assert.equal(c1, 2);
    fs.appendFileSync(f, 'c\n');
    assert.deepEqual(php(`echo json_encode(attacksNewErrors('${f}', ${o1}));`), [1, 6]);
    assert.deepEqual(php(`echo json_encode(attacksNewErrors('${f}', 999));`), [3, 6]);   // rotated
    fs.unlinkSync(f);
});

test('sicurezza: weekly totals only when the file is fresh; stats speed section for admin', async () => {
    const site = await startSite();
    try {
        const f = path.join(site.root, 'data', 'attacks.json');
        const pubText = async () => (await new Client(site).init().then(c => c.get('/pages/sicurezza.php?lang=en'))).text;
        assert.ok(!/Last 7 days/.test(await pubText()));
        const base = php(`echo json_encode(attacksBuild([], [], [], ${NOW}));`);
        base.web.total = 11; base.ssh.total = 22;
        base.speed = { n: 9, p50: 12, p95: 80, p99: 90, endpoints: { '/api/slowone.php': { n: 9, p50: 12, p95: 80, max: 95 } } };
        fs.writeFileSync(f, JSON.stringify(base));
        assert.match(await pubText(), /Last 7 days: 11 web probes and 22 SSH attempts turned away/);
        const admin = await makeAdmin(site, 'spd_admin');
        const st = (await admin.get('/pages/stats.php?lang=en')).text;
        assert.match(st, /slowone/);
        base.generated_at = NOW - 3 * 86400;
        fs.writeFileSync(f, JSON.stringify(base));
        assert.ok(!/Last 7 days/.test(await pubText()));
        delete base.speed; base.generated_at = NOW;      // an old file without "speed" still works
        fs.writeFileSync(f, JSON.stringify(base));
        assert.equal((await admin.get('/pages/stats.php?lang=en')).status, 200);
    } finally { site.stop(); }
});
