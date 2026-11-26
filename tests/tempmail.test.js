// tests/tempmail.test.js — temporary public mailboxes: open to everybody, proof of work + honeypot + rate limits against bots,
// a secret token per box, isolation between boxes, delivery through the inbound endpoint, limits, expiry.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { startSite, Client, makeAdmin } = require('./helpers');

test.describe('tempmail', () => {
    let site;
    const clear = () => { try { site.db('DELETE FROM rate_limits'); } catch (e) { /* none yet */ } };
    const tm = (c, body, opts) => c.post('/api/tempmail.php', body, opts);
    const tmc = (c, body) => { clear(); return tm(c, body); };   // the create limit counts failed tries too: reset it between the checks
    const inbound = (body, secret = 's3cret-s3cret') => fetch(`${site.base}/api/mail_inbound.php`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + secret }, body: JSON.stringify(body) });
    const solve = (challenge) => { for (let i = 0; ; i++) if (crypto.createHash('sha256').update(`${challenge}:${i}`).digest('hex').startsWith('0000')) return String(i); };
    const make = async (c, extra = {}) => {
        const p = (await c.get('/api/tempmail.php?action=pow')).json;
        return tm(c, { action: 'create', challenge: p.challenge, counter: solve(p.challenge), website: '', ...extra });
    };
    const auth = (token) => ({ headers: { 'X-Tempmail-Token': token } });

    test.before(async () => { site = await startSite({ MAIL_DOMAIN: 'talvera.site', MAIL_INBOUND_SECRET: 's3cret-s3cret', SITE_URL: 'https://example.org' }); });
    test.after(async () => { await site.stop(); });

    test('anybody makes a box; bots are stopped (no proof, wrong proof, replay, honeypot, no CSRF, rate limit)', async () => {
        clear(); const c = await new Client(site).init();
        const ok = await make(c);
        assert.equal(ok.json.success, true);
        assert.match(ok.json.address, /^tmp-[a-z2-7]{10}@talvera\.site$/);
        assert.match(ok.json.token, /^[0-9a-f]{48}$/);
        assert.ok(!JSON.stringify(site.db('SELECT token_hash FROM temp_boxes') || '').includes(ok.json.token), 'only the hash is stored');
        clear();
        const p = (await c.get('/api/tempmail.php?action=pow')).json;
        assert.equal((await tmc(c, { action: 'create', challenge: p.challenge, counter: '1', website: '' })).json.code, 'bad_pow', 'a wrong answer');
        assert.equal((await tmc(c, { action: 'create', challenge: 'x.y.z', counter: '1', website: '' })).json.code, 'bad_pow', 'a forged challenge');
        const forged = p.challenge.replace(/.$/, (d) => (d === '0' ? '1' : '0'));
        assert.equal((await tmc(c, { action: 'create', challenge: forged, counter: solve(forged), website: '' })).json.code, 'bad_pow', 'the signature is checked');
        const good = solve(p.challenge);
        assert.equal((await tmc(c, { action: 'create', challenge: p.challenge, counter: good, website: 'http://spam' })).json.code, 'bad_request', 'honeypot');
        assert.equal((await tmc(c, { action: 'create', challenge: p.challenge, counter: good, website: '' })).json.success, true);
        assert.equal((await tmc(c, { action: 'create', challenge: p.challenge, counter: good, website: '' })).json.code, 'bad_pow', 'a solved challenge works once');
        clear();
        assert.equal((await new Client(site).post('/api/tempmail.php', { action: 'create' }, { csrf: false })).status, 403, 'no CSRF token');
        clear();
        assert.equal((await make(c)).json.success, true); assert.equal((await make(c)).json.success, true);
        assert.equal((await make(c)).status, 429, 'two new addresses a minute');
    });

    test('mail arrives, only the owner of the token reads it, text stays text, limits hold', async () => {
        clear(); const a = await new Client(site).init(); const A = (await make(a)).json;
        clear(); const b = await new Client(site).init(); const B = (await make(b)).json;
        assert.equal((await inbound({ to: A.address, from: 'Shop <s@shop.example>', subject: 'Code 4821', text: 'Your code is 4821 <script>alert(1)</script>' })).status, 200);
        const list = (await a.get('/api/tempmail.php?action=list', auth(A.token))).json;
        assert.equal(list.messages.length, 1); assert.equal(list.messages[0].subject, 'Code 4821'); assert.equal(list.messages[0].body, undefined, 'the list has no bodies');
        const msg = (await a.get('/api/tempmail.php?action=get&id=' + list.messages[0].id, auth(A.token))).json.message;
        assert.match(msg.body, /4821 <script>alert\(1\)<\/script>/, 'kept as plain text (the page uses textContent)');
        assert.equal((await b.get('/api/tempmail.php?action=get&id=' + list.messages[0].id, auth(B.token))).status, 404, 'another box cannot read it');
        assert.equal((await b.get('/api/tempmail.php?action=list', auth(A.token.replace(/.$/, '0') ))).status, 404, 'a wrong token');
        assert.equal((await b.get('/api/tempmail.php?action=list')).status, 404, 'no token');
        assert.equal((await inbound({ to: 'tmp-zzzzzzzzzz@talvera.site', from: 'x@y.z', subject: 's', text: 't' })).status, 404, 'no such box');
        assert.equal((await inbound({ to: A.address, from: 'x@y.z', subject: 's', text: 't' }, 'wrong')).status, 401, 'the secret is still needed');
        for (let i = 0; i < 40; i++) await inbound({ to: A.address, from: 'x@y.z', subject: 'n' + i, text: 't' });
        const full = (await a.get('/api/tempmail.php?action=list', auth(A.token))).json.messages;
        assert.equal(full.length, 30, 'at most 30 messages a box');
        assert.equal((await inbound({ to: A.address, from: 'x@y.z', subject: 'late', text: 't' })).status, 200, 'a full box answers 200 so nothing is retried');
    });

    test('extend is capped, delete burns the box, expired boxes are gone, tmp- is reserved', async () => {
        clear(); const c = await new Client(site).init(); const X = (await make(c)).json;
        assert.equal((await tm(c, { action: 'extend' }, auth(X.token))).json.success, true);
        site.db('UPDATE temp_boxes SET born_at = born_at - 21000');
        const capped = (await tm(c, { action: 'extend' }, auth(X.token))).json;
        assert.ok(capped.expires_at <= Math.floor(Date.now() / 1000) + 600 + 5, 'never past six hours from birth');
        await inbound({ to: X.address, from: 'a@b.c', subject: 's', text: 't' });
        assert.equal((await tm(c, { action: 'delete' }, auth(X.token))).json.success, true);
        assert.equal((await c.get('/api/tempmail.php?action=list', auth(X.token))).status, 404);
        assert.equal((await inbound({ to: X.address, from: 'a@b.c', subject: 's', text: 't' })).status, 404);
        clear(); const Y = (await make(c)).json;
        site.db('UPDATE temp_boxes SET expires_at = 1');
        assert.equal((await c.get('/api/tempmail.php?action=list', auth(Y.token))).status, 404, 'expired');
        assert.equal((await inbound({ to: Y.address, from: 'a@b.c', subject: 's', text: 't' })).status, 404);
        const admin = await makeAdmin(site, 'tm_admin');
        assert.equal((await admin.post('/api/webmail.php', { action: 'create_address', local: 'tmp-abc', username: 'tm_admin' })).json.success, false);
    });

    test('the page and the home card are public', async () => {
        const g = new Client(site);
        const page = await g.get('/pages/tempmail.php?lang=en');
        assert.equal(page.status, 200); assert.match(page.text, /Temporary mail/); assert.match(page.text, /Referrer-Policy|no-referrer/);
        assert.match((await g.get('/?lang=en')).text, /pages\/tempmail\.php/);
    });
});
