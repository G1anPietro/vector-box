// tests/guards.test.js — endpoints reachable from the internet refuse requests from other sites
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client } = require('./helpers');

test.describe('cross-site guards', () => {
    let site;
    test.before(async () => { site = await startSite(); });
    test.after(async () => { await site.stop(); });

    test('the "message to the admin" form needs the CSRF token', async () => {
        const c = new Client(site);
        await c.init();
        const without = await c.post('/api/command.php', { message: 'spam' }, { csrf: false });
        assert.equal(without.status, 403);
        const withToken = await c.post('/api/command.php', { message: 'hello' });
        assert.notEqual(withToken.status, 403); // passes the guard (ntfy isn't configured in tests)
    });

    test('logout started from another website is refused, from the site it works', async () => {
        const c = new Client(site);
        await c.register('guard_user');
        const cross = await c.get('/api/logout.php', { headers: { 'Sec-Fetch-Site': 'cross-site', Accept: 'application/json' } });
        assert.equal(cross.status, 403);
        assert.equal((await c.get('/api/check_session.php')).json.username, 'guard_user');
        const same = await c.get('/api/logout.php', { headers: { 'Sec-Fetch-Site': 'same-origin', Accept: 'application/json' } });
        assert.equal(same.status, 200);
        assert.notEqual((await c.get('/api/check_session.php')).json.username, 'guard_user');
    });

    test('a session id invented by someone else is not accepted', async () => {
        const res = await fetch(`${site.base}/api/check_session.php`, { headers: { Cookie: 'PHPSESSID=attackerchosenid1234567890' } });
        const set = res.headers.get('set-cookie') || '';
        assert.match(set, /PHPSESSID=/);
        assert.doesNotMatch(set, /attackerchosenid1234567890/);
    });
});

test.describe('private CV page', () => {
    let site;
    test.before(async () => { site = await startSite(); });
    test.after(async () => { await site.stop(); });

    test('only the admin and accounts allowed with /grantcv can see it', async () => {
        const { makeAdmin } = require('./helpers');
        const guest = await fetch(`${site.base}/pages/resume.php`);
        assert.equal(guest.status, 403);
        assert.doesNotMatch(await guest.text(), /Khavruniak/);

        const user = new Client(site);
        await user.register('cv_friend');
        assert.equal((await user.get('/pages/resume.php')).status, 403);
        assert.doesNotMatch((await user.get('/index.php')).text, /VIEW DOSSIER/);

        const admin = await makeAdmin(site, 'cv_admin');
        assert.equal((await admin.get('/pages/resume.php')).status, 200);
        const grant = await admin.post('/api/moderate_book_access.php', { action: 'grant', username: 'cv_friend', scope: 'resume' });
        assert.equal(grant.json.success, true);

        const page = await user.get('/pages/resume.php');
        assert.equal(page.status, 200);
        assert.match(page.text, /Khavruniak/);
        assert.match((await user.get('/index.php')).text, /VIEW DOSSIER/);
        // the library permission is separate
        assert.equal((await user.get('/pages/reader.php')).status, 403);

        await admin.post('/api/moderate_book_access.php', { action: 'revoke', username: 'cv_friend', scope: 'resume' });
        assert.equal((await user.get('/pages/resume.php')).status, 403);
    });
});
