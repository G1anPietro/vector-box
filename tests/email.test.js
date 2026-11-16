// tests/email.test.js — the e-mail box: optional address with confirmation, consent to news, admin drafts and sending, unsubscribe
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startSite, Client, makeAdmin } = require('./helpers');

test.describe('e-mail box', () => {
    let site, ada, bob, admin, log;
    const clear = () => { try { site.db('DELETE FROM rate_limits'); } catch (e) { /* none yet */ } };
    const form = (c, fields) => fetch(`${site.base}/pages/account.php`, { method: 'POST', redirect: 'manual',
        headers: { Cookie: c.cookieHeader(), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf_token: c.csrf, ...fields }) });
    const mailLog = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '');
    const mail = (c, body) => c.post('/api/mail.php', body);

    test.before(async () => {
        site = await startSite({ MAIL_DRIVER: 'log', SITE_URL: 'https://example.org', MAIL_FROM: 'vector-box <no-reply@example.org>' });
        log = path.join(site.root, 'data', 'mail.log');
        clear(); ada = new Client(site); await ada.register('em_ada');
        clear(); bob = new Client(site); await bob.register('em_bob');
        clear(); admin = await makeAdmin(site, 'em_admin');
    });
    test.after(async () => { await site.stop(); });

    test('an address needs a confirmation link; only then it can get news, and only if the person said yes', async () => {
        await form(ada, { action: 'save_email', email: 'ada@example.com', email_optin: '1' });
        let a = site.db("SELECT email, email_verified, email_optin, email_optin_at FROM accounts WHERE username = 'em_ada'")[0];
        assert.deepEqual([a.email, a.email_verified, a.email_optin], ['ada@example.com', 0, 1]);
        assert.ok(a.email_optin_at > 0, 'the date of the consent is kept');
        const sent = mailLog();
        assert.match(sent, /to=ada@example\.com\tsubject=Confirm your e-mail address/);
        const token = /mail_link\.php\?a=verify&t=([0-9a-f.]+)/.exec(sent)[1];
        assert.equal((await fetch(`${site.base}/api/mail_link.php?a=verify&t=${token}x`)).status, 400, 'a forged token');
        assert.equal((await fetch(`${site.base}/api/mail_link.php?a=unsub&t=${token}`)).status, 400, 'a verify token is not an unsubscribe token');
        assert.equal((await fetch(`${site.base}/api/mail_link.php?a=verify&t=${token}`)).status, 200);
        assert.equal(site.db("SELECT email_verified FROM accounts WHERE username = 'em_ada'")[0].email_verified, 1);
        // bob confirms nothing and says no to news
        await form(bob, { action: 'save_email', email: 'bob@example.com' });
        assert.equal(site.db("SELECT email_optin FROM accounts WHERE username = 'em_bob'")[0].email_optin, 0);
        // bad addresses are refused
        await form(bob, { action: 'save_email', email: 'not an address\r\nBcc: x@y.z' });
        assert.equal(site.db("SELECT email FROM accounts WHERE username = 'em_bob'")[0].email, 'bob@example.com');
    });

    test('the box is admin only and needs the CSRF token', async () => {
        assert.equal((await ada.get('/api/mail.php?action=status')).status, 403);
        assert.equal((await mail(ada, { action: 'process' })).status, 403);
        assert.equal((await fetch(`${site.base}/pages/mail.php`, { headers: { Cookie: ada.cookieHeader() } })).status, 403);
        assert.equal((await fetch(`${site.base}/pages/mail.php`, { headers: { Cookie: admin.cookieHeader() } })).status, 200);
        const noCsrf = await fetch(`${site.base}/api/mail.php`, { method: 'POST', headers: { Cookie: admin.cookieHeader(), 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'process' }) });
        assert.equal(noCsrf.status, 403);
    });

    test('draft, send to the people who agreed, one message each with their own unsubscribe link, then unsubscribe', async () => {
        const st = (await admin.get('/api/mail.php?action=status')).json;
        assert.deepEqual([st.driver, st.audience.optin], ['log', 1], 'only ada: bob did not confirm nor agree');
        const d = await mail(admin, { action: 'save_draft', subject: 'Novità\r\nBcc: spam@x.y', body: 'Ciao! Nuovo gioco.', audience: 'optin' });
        assert.equal(d.status, 200);
        const id = d.json.id;
        assert.ok(!/[\r\n]/.test((await admin.get(`/api/mail.php?action=get&id=${id}`)).json.message.subject), 'no header injection through the subject');
        assert.equal((await mail(admin, { action: 'send_test', id })).json.code, 'no_address', 'the admin has no address yet');
        const sent = await mail(admin, { action: 'send', id });
        assert.equal(sent.json.queued, 1);
        assert.equal((await mail(admin, { action: 'send', id })).json.code, 'not_draft', 'cannot be sent twice');
        const proc = await mail(admin, { action: 'process' });
        assert.equal(proc.json.sent, 1);
        const text = mailLog();
        assert.match(text, /to=ada@example\.com\tsubject=Novità Bcc: spam@x\.y/);
        assert.ok(!text.includes('bob@example.com\tsubject=Novità'), 'bob never agreed to news');
        const unsub = /mail_link\.php\?a=unsub&t=([0-9a-f.]+)/.exec(text.split('Novità')[1])[1];
        assert.equal((await fetch(`${site.base}/api/mail_link.php?a=unsub&t=${unsub}`)).status, 200);
        assert.equal(site.db("SELECT email_optin FROM accounts WHERE username = 'em_ada'")[0].email_optin, 0);
        const d2 = (await mail(admin, { action: 'save_draft', subject: 'Ancora', body: 'x', audience: 'optin' })).json.id;
        assert.equal((await mail(admin, { action: 'send', id: d2 })).json.code, 'nobody');
    });

    test('an account export has the address; deleting the account removes the queued messages', async () => {
        const exp = (await ada.get('/api/account_data.php?action=export')).json;
        assert.equal(exp.account.email, 'ada@example.com');
        assert.ok(site.db("SELECT COUNT(*) AS n FROM mail_queue WHERE to_email = 'ada@example.com'")[0].n > 0);
        clear();
        const del = await ada.post('/api/account_data.php', { action: 'delete', password: 'password123', delete_materials: true });
        assert.equal(del.status, 200, del.text);
        assert.equal(site.db("SELECT COUNT(*) AS n FROM mail_queue WHERE to_email = 'ada@example.com'")[0].n, 0);
    });
});
