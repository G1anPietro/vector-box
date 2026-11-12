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
