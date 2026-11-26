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
    const press = (url) => fetch(url, { method: 'POST' });          // the links only SHOW a button on GET; the press is a POST

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
        assert.equal((await fetch(`${site.base}/api/mail_link.php?a=verify&t=${token}`)).status, 200, 'opening the link shows a page');
        assert.equal(site.db("SELECT email_verified FROM accounts WHERE username = 'em_ada'")[0].email_verified, 0, 'a scanner that only opens the link confirms nothing');
        assert.equal((await press(`${site.base}/api/mail_link.php?a=verify&t=${token}`)).status, 200);
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
        assert.equal((await fetch(`${site.base}/pages/newsletter.php`, { headers: { Cookie: ada.cookieHeader() } })).status, 403);
        assert.equal((await fetch(`${site.base}/pages/newsletter.php`, { headers: { Cookie: admin.cookieHeader() } })).status, 200);
        // the news box stays admin only, even for an account the admin allowed into the personal mail
        site.db("UPDATE accounts SET can_use_mail = 1 WHERE username = 'em_ada'");
        assert.equal((await ada.get('/api/mail.php?action=status')).status, 403);
        assert.equal((await fetch(`${site.base}/pages/newsletter.php`, { headers: { Cookie: ada.cookieHeader() } })).status, 403);
        assert.equal((await fetch(`${site.base}/pages/mail.php`, { headers: { Cookie: ada.cookieHeader() } })).status, 200);
        assert.equal((await ada.get('/')).text.includes('pages/mail.php'), true, 'the home shows the Mail card to an allowed account');
        assert.equal((await bob.get('/')).text.includes('pages/mail.php'), false);
        site.db("UPDATE accounts SET can_use_mail = 0 WHERE username = 'em_ada'");
        assert.equal((await fetch(`${site.base}/pages/mail.php`, { headers: { Cookie: ada.cookieHeader() } })).status, 403);
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
        const d3 = (await mail(admin, { action: 'save_draft', subject: 'Doppio', body: 'x', audience: 'optin' })).json.id;
        site.db("UPDATE accounts SET email_optin = 1 WHERE username = 'em_ada'");
        const both = await Promise.all([mail(admin, { action: 'send', id: d3 }), mail(admin, { action: 'send', id: d3 })]);
        assert.deepEqual(both.map((r) => r.status).sort(), [200, 409], 'two parallel sends: one wins');
        assert.equal(site.db("SELECT COUNT(*) AS n FROM mail_queue WHERE subject = 'Doppio'")[0].n, 1, 'queued once');
        site.db("DELETE FROM mail_queue WHERE subject = 'Doppio'");
        const proc = await mail(admin, { action: 'process' });
        assert.equal(proc.json.sent, 1);
        const text = mailLog();
        assert.match(text, /to=ada@example\.com\tsubject=Novità Bcc: spam@x\.y/);
        assert.ok(!text.includes('bob@example.com\tsubject=Novità'), 'bob never agreed to news');
        const unsub = /mail_link\.php\?a=unsub&t=([0-9a-f.]+)/.exec(text.split('Novità')[1])[1];
        assert.equal((await fetch(`${site.base}/api/mail_link.php?a=unsub&t=${unsub}`)).status, 200);
        assert.equal(site.db("SELECT email_optin FROM accounts WHERE username = 'em_ada'")[0].email_optin, 1, 'opening the unsubscribe link does not unsubscribe');
        assert.equal((await press(`${site.base}/api/mail_link.php?a=unsub&t=${unsub}`)).status, 200);
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

    test('a confirmation link works only for the address it was sent for', async () => {
        clear(); const cat = new Client(site); await cat.register('em_cat');
        await form(cat, { action: 'save_email', email: 'cat@example.com', email_optin: '1' });
        const oldToken = [...mailLog().matchAll(/mail_link\.php\?a=verify&t=([0-9a-f.]+)/g)].pop()[1];
        await form(cat, { action: 'save_email', email: 'someone-else@example.com', email_optin: '1' });
        assert.equal((await press(`${site.base}/api/mail_link.php?a=verify&t=${oldToken}`)).status, 400, 'the link of the old address');
        assert.equal(site.db("SELECT email_verified FROM accounts WHERE username = 'em_cat'")[0].email_verified, 0);
        const newToken = [...mailLog().matchAll(/mail_link\.php\?a=verify&t=([0-9a-f.]+)/g)].pop()[1];
        assert.equal((await press(`${site.base}/api/mail_link.php?a=verify&t=${newToken}`)).status, 200);
        assert.equal(site.db("SELECT email_verified FROM accounts WHERE username = 'em_cat'")[0].email_verified, 1);
    });

    test('news already queued are not sent to someone who unsubscribed or changed address since; a row is sent once', async () => {
        const id = (await mail(admin, { action: 'save_draft', subject: 'Seconda', body: 'testo', audience: 'optin' })).json.id;
        assert.equal((await mail(admin, { action: 'send', id })).json.queued, 1, 'cat only');
        site.db("UPDATE accounts SET email_optin = 0 WHERE username = 'em_cat'");   // she unsubscribes before the worker runs
        const before = mailLog().length;
        const r = await mail(admin, { action: 'process' });
        assert.equal(r.json.sent, 0);
        assert.equal(mailLog().length, before, 'nothing was written');
        const row = site.db("SELECT status, last_error FROM mail_queue WHERE subject = 'Seconda'")[0];
        assert.deepEqual([row.status, row.last_error], ['failed', 'no longer subscribed']);
        // one row, two parallel runs: sent once
        site.db("UPDATE accounts SET email_optin = 1 WHERE username = 'em_cat'");
        const id2 = (await mail(admin, { action: 'save_draft', subject: 'Terza', body: 'testo', audience: 'optin' })).json.id;
        await mail(admin, { action: 'send', id: id2 });
        await Promise.all([mail(admin, { action: 'process' }), mail(admin, { action: 'process' }), mail(admin, { action: 'process' })]);
        assert.equal((mailLog().match(/subject=Terza/g) || []).length, 1);
    });
});
