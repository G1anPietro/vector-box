// tests/password-reset.test.js — "forgot my password": the link goes only to a confirmed e-mail, works once, expires, never for admins.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startSite, Client, makeAdmin, REPO } = require('./helpers');

test.describe('password reset', () => {
    let site, log;
    const clear = () => { try { site.db('DELETE FROM rate_limits'); } catch (e) { /* none yet */ } };
    const form = async (c, url, data) => {   // the page is a plain HTML form
        const res = await fetch(site.base + url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: c.cookieHeader() }, body: new URLSearchParams(data), redirect: 'manual' });
        return { status: res.status, text: await res.text() };
    };
    const csrfOf = async (c, url = '/pages/password_reset.php') => { const r = await c.get(url); return /name="csrf" value="([a-f0-9]+)"/.exec(r.text)[1]; };
    const lastLink = async () => { for (let i = 0; i < 30; i++) { const m = [...(fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '').matchAll(/password_reset\.php\?t=([0-9.a-f]+)/g)]; if (m.length > seen) { seen = m.length; return m[m.length - 1][1]; } await new Promise((r) => setTimeout(r, 100)); } return null; };
    let seen = 0;
    const ask = async (who) => { clear(); const c = new Client(site); await c.init(); const csrf = await csrfOf(c); return form(c, '/pages/password_reset.php', { csrf, who }); };

    test.before(async () => {
        site = await startSite({ MAIL_DRIVER: 'log', SITE_URL: 'https://example.org' });
        log = path.join(site.root, 'data', 'mail.log');
        clear(); await new Client(site).register('pr_ann');
        site.db("UPDATE accounts SET email = 'ann@example.org', email_verified = 1 WHERE username = 'pr_ann'");
        clear(); await new Client(site).register('pr_unverified');
        site.db("UPDATE accounts SET email = 'u@example.org', email_verified = 0 WHERE username = 'pr_unverified'");
        clear(); await makeAdmin(site, 'pr_admin');
        site.db("UPDATE accounts SET email = 'a@example.org', email_verified = 1 WHERE username = 'pr_admin'");
    });
    test.after(async () => { await site.stop(); });

    test('the same answer for everybody; a link only for a confirmed, non-admin address', async () => {
        const a = await ask('pr_ann'); assert.match(a.text, /confirmed e-mail|e-mail confermata/);
        const link = await lastLink(); assert.ok(link, 'ann gets a link');
        assert.match(fs.readFileSync(log, 'utf8'), /to=ann@example\.org/);
        const before = seen;
        for (const who of ['nobody_here', 'pr_unverified', 'pr_admin', 'a@example.org']) { const r = await ask(who); assert.equal(r.status, 200); assert.match(r.text, /confirmed e-mail|e-mail confermata/, who); }
        await new Promise((r) => setTimeout(r, 500));
        assert.equal([...fs.readFileSync(log, 'utf8').matchAll(/password_reset\.php/g)].length, before, 'no link for unknown, unconfirmed or admin');
        const byMail = await ask('ANN@example.org'); assert.equal(byMail.status, 200); assert.ok(await lastLink(), 'a confirmed address works too');
    });

    test('the link sets a new password once; the old one stops working; bad links and CSRF are refused', async () => {
        await ask('pr_ann'); const t = await lastLink();
        const c = new Client(site); await c.init();
        const page = await c.get('/pages/password_reset.php?t=' + t); assert.match(page.text, /name="password2"/);
        const csrf = /name="csrf" value="([a-f0-9]+)"/.exec(page.text)[1];
        const url = '/pages/password_reset.php?t=' + t;
        assert.equal((await form(c, url, { csrf: 'bad', t, password: 'newpassword1', password2: 'newpassword1' })).status, 403);
        assert.match((await form(c, url, { csrf, t, password: 'newpassword1', password2: 'different11' })).text, /different|diverse/);
        assert.match((await form(c, url, { csrf, t, password: 'short', password2: 'short' })).text, /8 char|8 caratteri/);
        assert.match((await form(c, url, { csrf, t, password: 'newpassword1', password2: 'newpassword1' })).text, /changed|cambiata/);
        assert.equal((await new Client(site).login('pr_ann', 'newpassword1')).json.success, true);
        assert.notEqual((await new Client(site).login('pr_ann', 'password123')).json.success, true);
        assert.match((await c.get('/pages/password_reset.php?t=' + t)).text, /not valid|non è valido/, 'the link works once');
        for (const bad of ['1.2.3', t.replace(/.$/, (d) => (d === '0' ? '1' : '0')), '1.9999999999.' + '0'.repeat(40)]) assert.match((await c.get('/pages/password_reset.php?t=' + bad)).text, /not valid|non è valido/);
    });

    test('rate limits and the admin CLI', async () => {
        clear(); const c = new Client(site); await c.init(); const csrf = await csrfOf(c);
        let last; for (let i = 0; i < 6; i++) last = await form(c, '/pages/password_reset.php', { csrf, who: 'x' + i });
        assert.equal(last.status, 429);
        const { spawnSync } = require('child_process');
        const run = (...a) => spawnSync('php', [path.join(site.root, 'tools', 'password-reset.php'), ...a], { encoding: 'utf8' });
        fs.mkdirSync(path.join(site.root, 'tools'), { recursive: true });   // the site copy has no tools/: the script finds the copy's database through its own location
        fs.copyFileSync(path.join(REPO, 'tools', 'password-reset.php'), path.join(site.root, 'tools', 'password-reset.php'));
        {
            assert.match(run('pr_unverified', 'cli-test-pass-1').stdout, /password changed/);
            assert.match(run('nobody_x', 'cli-test-pass-1').stdout, /no such account/);
            assert.equal(run('pr_unverified', 'short').status, 1);
            clear(); assert.equal((await new Client(site).login('pr_unverified', 'cli-test-pass-1')).json.success, true);
        }
    });
});
