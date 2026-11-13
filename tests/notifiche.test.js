// tests/notifiche.test.js — test reminders, the bell API and Web Push (encryption and VAPID checked by decrypting)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { startSite, Client, makeAdmin } = require('./helpers');

const run = promisify(execFile);
const b64u = (buf) => Buffer.from(buf).toString('base64url');

// Fake push service: /ok/* accepts, /gone/* says the subscription is gone
const pushed = [];
const pushServer = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
        pushed.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
        res.writeHead(req.url.startsWith('/gone') ? 410 : 201);
        res.end();
    });
});

/** A browser-like subscription: its own P-256 key pair and auth secret. */
function newDevice(pathName) {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
    const auth = crypto.randomBytes(16);
    return {
        ecdh, auth,
        sub: { endpoint: `http://127.0.0.1:${pushServer.address().port}${pathName}`, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) } },
    };
}

/** Decrypts an aes128gcm push body like the browser does (RFC 8291). */
function decrypt(device, body) {
    const salt = body.subarray(0, 16);
    const idlen = body[20];
    const asPublic = body.subarray(21, 21 + idlen);
    const data = body.subarray(21 + idlen);
    const shared = device.ecdh.computeSecret(asPublic);
    const info = Buffer.concat([Buffer.from('WebPush: info\0'), device.ecdh.getPublicKey(), asPublic]);
    const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, device.auth, info, 32));
    const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
    const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
    const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
    d.setAuthTag(data.subarray(data.length - 16));
    const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
    assert.equal(plain[plain.length - 1], 2, 'padding delimiter of the last record');
    return JSON.parse(plain.subarray(0, plain.length - 1).toString('utf8'));
}

/** Checks the VAPID JWT (ES256) against the public key the site hands out. */
function checkVapid(headers, publicKey, audience) {
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(headers.authorization);
    assert.ok(m, 'VAPID authorization header');
    assert.equal(m[2], publicKey);
    const [h, p, sig] = m[1].split('.');
    const raw = Buffer.from(publicKey, 'base64url');
    const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(raw.subarray(1, 33)), y: b64u(raw.subarray(33)) }, format: 'jwk' });
    assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')), 'valid signature');
    const claims = JSON.parse(Buffer.from(p, 'base64url'));
    assert.equal(claims.aud, audience);
    assert.ok(claims.exp > Date.now() / 1000);
    assert.equal(headers['content-encoding'], 'aes128gcm');
    assert.ok(Number(headers.ttl) > 0);
}

let site, admin, mario, luigi, peach, classId, storia;
const nt = (c, body) => c.post('/api/notifiche.php', body);
const worker = (now) => run('php', [path.join(site.root, 'bin/appunti-ai.php'), `--now=${now}`]);
// Rome is UTC+1 in March 2030 (before the switch to summer time)
const rome = (date, hhmm) => Date.parse(`${date}T${hhmm}:00+01:00`) / 1000;

test.before(async () => {
    await new Promise((r) => pushServer.listen(0, '127.0.0.1', r));
    site = await startSite({ WEBPUSH_EXTRA_HOSTS: `127.0.0.1:${pushServer.address().port}`, SITE_URL: 'https://example.test' });
    admin = await makeAdmin(site, 'nt_admin');
    mario = new Client(site); await mario.register('nt_mario');
    luigi = new Client(site); await luigi.register('nt_luigi');
    peach = new Client(site); await peach.register('nt_peach');
    classId = (await mario.post('/api/classi.php', { action: 'request', name: '5B-I', school: 'ITIS' })).json.id;
    await admin.post('/api/classi.php', { action: 'decide', id: classId, approve: true });
    const code = (await mario.get(`/api/classi.php?action=class&id=${classId}`)).json.class.invite_code;
    await luigi.post('/api/classi.php', { action: 'join', code });
    await mario.post('/api/classi.php', { action: 'save_timetable', id: classId, valid_from: '2026-09-01',
        periods: [{ start: '08:10', end: '09:05' }], slots: [{ day: 3, period: 1, subject: 'Storia' }] });
    storia = site.db('SELECT id FROM class_subjects WHERE class_id = ?', [classId])[0].id;
});
test.after(async () => { await site.stop(); pushServer.close(); });

test('migration V13 created the tables', () => {
    assert.ok(site.db('PRAGMA user_version')[0].user_version >= 13);
    assert.equal(site.db(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('notifications','push_subscriptions','class_event_reminders')`)[0].n, 3);
});

test('subscriptions: only push services, valid keys, login and CSRF', async () => {
    const dev = newDevice('/ok/x');
    const guest = await new Client(site).init();
    assert.equal((await nt(guest, { action: 'subscribe', ...dev.sub })).status, 401);
    assert.equal((await luigi.post('/api/notifiche.php', { action: 'subscribe', ...dev.sub }, { csrf: false })).status, 403);
    for (const endpoint of ['https://evil.example/push', 'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://127.0.0.1/x']) {
        assert.equal((await nt(luigi, { action: 'subscribe', endpoint, keys: dev.sub.keys })).json.code, 'bad_endpoint', endpoint);
    }
    assert.equal((await nt(luigi, { action: 'subscribe', endpoint: dev.sub.endpoint, keys: { p256dh: 'abc', auth: 'x' } })).json.code, 'bad_keys');
    assert.equal((await nt(luigi, { action: 'subscribe', ...dev.sub })).status, 200);
    assert.equal((await luigi.get('/api/notifiche.php?action=list')).json.devices, 1);
});

test('test push: encrypted for the device and signed with VAPID', async () => {
    const dev = newDevice('/ok/mario');
    await nt(mario, { action: 'subscribe', ...dev.sub });
    pushed.length = 0;
    const r = await nt(mario, { action: 'test' });
    assert.equal(r.json.delivered, 1);
    assert.equal(pushed.length, 1);
    const { public_key: pub } = (await mario.get('/api/notifiche.php?action=vapid')).json;
    assert.equal(Buffer.from(pub, 'base64url').length, 65);
    checkVapid(pushed[0].headers, pub, `http://127.0.0.1:${pushServer.address().port}`);
    const msg = decrypt(dev, pushed[0].body);
    assert.equal(msg.title, 'Notifiche attive ✓');
    assert.equal(msg.url, '/pages/appunti.php');
    mario.dev = dev;
});

test('reminders: 2 days before, the day before, once each; late runs send only the latest', async () => {
    // Wednesday 20 March 2030
    const ev = (await luigi.post('/api/appunti.php', { action: 'add_event', class_id: classId, subject_id: storia, kind: 'verifica',
        date: '2030-03-20', title: 'Napoleone', topics: 'Dalla Rivoluzione a Waterloo' })).json.id;
    const count = () => site.db("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'promemoria'")[0].n;

    await worker(rome('2030-03-18', '15:59'));
    assert.equal(count(), 0, 'not before 16:00');
    pushed.length = 0;
    await worker(rome('2030-03-18', '16:05'));
    assert.equal(count(), 2, 'one for each member');
    const notes = (await mario.get('/api/notifiche.php?action=list')).json;
    assert.equal(notes.unread, 2, 'the test push of before + this reminder');
    assert.equal(notes.notifications[0].title, 'Verifica di Storia tra 2 giorni');
    assert.match(notes.notifications[0].body, /^20\/03 · Napoleone\. Argomenti: Dalla Rivoluzione a Waterloo\.$/);
    assert.equal(notes.notifications[0].url, `/pages/appunti.php?class=${classId}&tab=study`);
    const toMario = pushed.find((p) => p.url === '/ok/mario');
    assert.equal(decrypt(mario.dev, toMario.body).title, 'Verifica di Storia tra 2 giorni');

    await worker(rome('2030-03-18', '18:00'));
    assert.equal(count(), 2, 'not twice');

    // the server was off all afternoon of the 19th: at 22:00 both "tomorrow" slots are due, only the evening one goes out
    await worker(rome('2030-03-19', '22:00'));
    assert.equal(count(), 4);
    const last = (await luigi.get('/api/notifiche.php?action=list')).json.notifications[0];
    assert.equal(last.title, 'Verifica di Storia domani: ultimo ripasso');
    assert.deepEqual(site.db('SELECT slot FROM class_event_reminders WHERE event_id = ? ORDER BY slot', [ev]).map((r) => r.slot), ['d1', 'd2', 'sera']);
    await worker(rome('2030-03-19', '23:00'));
    assert.equal(count(), 4);

    // not members, not reminded
    assert.equal((await peach.get('/api/notifiche.php?action=list')).json.notifications.length, 0);
});

test('a subscription the push service says is gone is removed', async () => {
    const dev = newDevice('/gone/old-phone');
    await nt(peach, { action: 'subscribe', ...dev.sub });
    assert.equal((await nt(peach, { action: 'test' })).json.delivered, 0);
    assert.equal(site.db("SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint LIKE '%/gone/%'")[0].n, 0);
});

test('bell: mark read, only my own notifications', async () => {
    const mine = (await luigi.get('/api/notifiche.php?action=list')).json;
    assert.ok(mine.unread > 0);
    const marioIds = (await mario.get('/api/notifiche.php?action=list')).json.notifications.map((n) => n.id);
    await nt(luigi, { action: 'read', ids: marioIds });
    assert.ok((await mario.get('/api/notifiche.php?action=list')).json.unread > 0, 'cannot mark other people\'s notifications');
    await nt(luigi, { action: 'read_all' });
    assert.equal((await luigi.get('/api/notifiche.php?action=list')).json.unread, 0);
});

test('unsubscribe removes only my device', async () => {
    await nt(peach, { action: 'unsubscribe', endpoint: mario.dev.sub.endpoint });
    assert.equal((await mario.get('/api/notifiche.php?action=list')).json.devices, 1);
    await nt(mario, { action: 'unsubscribe', endpoint: mario.dev.sub.endpoint });
    assert.equal((await mario.get('/api/notifiche.php?action=list')).json.devices, 0);
});
