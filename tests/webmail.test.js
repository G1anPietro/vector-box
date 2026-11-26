// tests/webmail.test.js — personal mailboxes: the admin makes @domain addresses, messages between local addresses stay inside,
// others go out through the queue from the person's own address, flags/trash/search work, incoming mail needs the secret.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startSite, Client, makeAdmin } = require('./helpers');

test.describe('webmail', () => {
    let site, admin, ada, bob, log;
    const clear = () => { try { site.db('DELETE FROM rate_limits'); } catch (e) { /* none yet */ } };
    const wm = (c, body) => c.post('/api/webmail.php', body);
    const inbound = (body, secret) => fetch(`${site.base}/api/mail_inbound.php`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: 'Bearer ' + secret } : {}) }, body: JSON.stringify(body) });

    test.before(async () => {
        site = await startSite({ MAIL_DRIVER: 'log', MAIL_DOMAIN: 'talvera.site', MAIL_INBOUND_SECRET: 's3cret-s3cret', SITE_URL: 'https://example.org' });
        log = path.join(site.root, 'data', 'mail.log');
        clear(); ada = new Client(site); await ada.register('wm_ada');
        clear(); bob = new Client(site); await bob.register('wm_bob');
        clear(); admin = await makeAdmin(site, 'wm_admin');
    });
    test.after(async () => { await site.stop(); });

    test('only the admin makes addresses; the owner gets the permission; names are checked', async () => {
        assert.equal((await wm(ada, { action: 'create_address', local: 'ada', username: 'wm_ada' })).status, 403);
        assert.equal((await ada.get('/api/webmail.php?action=boot')).status, 403, 'no permission, no mailbox');
        assert.equal((await wm(admin, { action: 'create_address', local: 'a b', username: 'wm_ada' })).json.error.length > 0, true);
        assert.equal((await wm(admin, { action: 'create_address', local: 'ada', username: 'nobody_here' })).status, 404);
        const ok = await wm(admin, { action: 'create_address', local: 'Ada.Rossi', username: 'wm_ada' });
        assert.equal(ok.json.address, 'ada.rossi@talvera.site');
        assert.equal((await wm(admin, { action: 'create_address', local: 'ada.rossi', username: 'wm_bob' })).status, 409);
        assert.equal((await wm(admin, { action: 'create_address', local: 'bob', username: 'wm_bob' })).json.success, true);
        const boot = (await ada.get('/api/webmail.php?action=boot')).json;
        assert.deepEqual(boot.addresses.map((a) => a.address), ['ada.rossi@talvera.site']);
        assert.equal((await new Client(site).init().then((c) => c.get('/api/webmail.php?action=boot'))).status, 403);
    });

    test('a message to a local address arrives at once; flags, trash, search and privacy', async () => {
        const fromId = (await ada.get('/api/webmail.php?action=boot')).json.addresses[0].id;
        const r = await wm(ada, { action: 'send', from_id: fromId, to: 'bob@talvera.site', subject: 'Ciao Bob', body: 'primo messaggio segreto' });
        assert.deepEqual([r.json.success, r.json.delivered_here, r.json.external], [true, 1, 0]);
        const inbox = (await bob.get('/api/webmail.php?action=list&folder=inbox')).json.rows;
        assert.equal(inbox.length, 1); assert.equal(inbox[0].from_addr, 'ada.rossi@talvera.site'); assert.equal(inbox[0].is_read, 0);
        assert.equal((await ada.get('/api/webmail.php?action=list&folder=sent')).json.rows.length, 1);
        const id = inbox[0].id;
        assert.equal((await ada.get(`/api/webmail.php?action=get&id=${id}`)).status, 404, 'nobody reads another mailbox');
        assert.equal((await bob.get(`/api/webmail.php?action=get&id=${id}`)).json.message.body, 'primo messaggio segreto');
        assert.equal((await bob.get('/api/webmail.php?action=boot')).json.counts.inbox_unread, 0, 'opening marks it read');
        await wm(bob, { action: 'read', ids: [id], value: 0 });
        assert.equal((await bob.get('/api/webmail.php?action=boot')).json.counts.inbox_unread, 1);
        await wm(bob, { action: 'star', ids: [id], value: 1 });
        assert.equal((await bob.get('/api/webmail.php?action=list&folder=starred')).json.rows.length, 1);
        assert.equal((await bob.get('/api/webmail.php?action=list&folder=inbox&q=segreto')).json.rows.length, 1);
        assert.equal((await bob.get('/api/webmail.php?action=list&folder=inbox&q=100%25')).json.rows.length, 0, 'a % is searched literally');
        await wm(ada, { action: 'trash', ids: [id] });   // not hers: nothing changes
        assert.equal((await bob.get('/api/webmail.php?action=list&folder=inbox')).json.rows.length, 1);
        await wm(bob, { action: 'trash', ids: [id] });
        assert.equal((await bob.get('/api/webmail.php?action=list&folder=inbox')).json.rows.length, 0);
        assert.equal((await bob.get('/api/webmail.php?action=list&folder=starred')).json.rows.length, 0, 'trashed is not starred');
        await wm(bob, { action: 'restore', ids: [id] });
        assert.equal((await bob.get('/api/webmail.php?action=list&folder=inbox')).json.rows.length, 1);
        await wm(bob, { action: 'delete', ids: [id] });   // not in the trash: refused silently
        assert.equal((await bob.get('/api/webmail.php?action=list&folder=inbox')).json.rows.length, 1);
        await wm(bob, { action: 'trash', ids: [id] });
        await wm(bob, { action: 'delete', ids: [id] });   // in the trash: gone for good
        assert.equal((await bob.get('/api/webmail.php?action=list&folder=trash')).json.rows.length, 0);
    });

    test('only the admin writes to outside addresses (from the own address, through the queue); bad addresses and missing address are refused', async () => {
        const fromId = (await ada.get('/api/webmail.php?action=boot')).json.addresses[0].id;
        const refused = await wm(ada, { action: 'send', from_id: fromId, to: 'someone@gmail.com', subject: 'x', body: 'y' });
        assert.deepEqual([refused.status, refused.json.error.length > 0], [403, true], 'a normal account cannot write outside');
        assert.equal(site.db("SELECT COUNT(*) AS n FROM mail_queue WHERE kind = 'user'")[0].n, 0);
        await wm(admin, { action: 'create_address', local: 'capo', username: 'wm_admin' });
        const adminFrom = (await admin.get('/api/webmail.php?action=boot')).json.addresses[0].id;
        const r = await wm(admin, { action: 'send', from_id: adminFrom, to: 'someone@gmail.com', subject: 'Hi\r\nBcc: x@y.z', body: 'hello out there' });
        assert.deepEqual([r.json.success, r.json.external, r.json.sent_now], [true, 1, 1]);
        const out = fs.readFileSync(log, 'utf8');
        assert.match(out, /from=capo@talvera\.site\tto=someone@gmail\.com/);
        assert.ok(!/^Bcc:/mi.test(out), 'no header injection through the subject');
        assert.equal((await wm(admin, { action: 'send', from_id: adminFrom, to: 'not an address', subject: 's', body: 'b' })).json.error.includes('address'), true);
        assert.equal((await wm(admin, { action: 'send', from_id: fromId, to: 'x@gmail.com', subject: 's', body: 'b' })).json.success, false, 'cannot write from somebody else\'s address');
        assert.equal((await wm(admin, { action: 'send', from_id: adminFrom, to: 'a@b.it,b@b.it,c@b.it,d@b.it,e@b.it,f@b.it', subject: 's', body: 'b' })).json.error.length > 0, true);
    });

    test('drafts, and incoming mail needs the secret and an existing address', async () => {
        const fromId = (await ada.get('/api/webmail.php?action=boot')).json.addresses[0].id;
        const d = (await wm(ada, { action: 'save_draft', from_id: fromId, to: 'bob@talvera.site', subject: 'bozza', body: 'a metà' })).json.id;
        assert.equal((await wm(ada, { action: 'save_draft', id: d, from_id: fromId, to: 'bob@talvera.site', subject: 'bozza 2', body: 'a metà' })).json.id, d, 'saving again updates it');
        assert.equal((await ada.get('/api/webmail.php?action=list&folder=draft')).json.rows[0].subject, 'bozza 2');
        await wm(ada, { action: 'send', draft_id: d, from_id: fromId, to: 'bob@talvera.site', subject: 'bozza 2', body: 'finita' });
        assert.equal((await ada.get('/api/webmail.php?action=list&folder=draft')).json.rows.length, 0, 'a sent draft is gone');

        assert.equal((await inbound({ to: 'ada.rossi@talvera.site', from: 'Zed <zed@gmail.com>', subject: 'da fuori', text: 'ciao' })).status, 401);
        assert.equal((await inbound({ to: 'ada.rossi@talvera.site', from: 'z@g.com', subject: 's', text: 't' }, 'wrong-secret')).status, 401);
        assert.equal((await inbound({ to: 'nessuno@talvera.site', from: 'z@g.com', subject: 's', text: 't' }, 's3cret-s3cret')).status, 404);
        assert.equal((await inbound({ to: 'ADA.rossi@talvera.site', from: 'Zed <zed@gmail.com>', subject: 'da fuori', text: 'ciao' }, 's3cret-s3cret')).status, 200);
        const rows = (await ada.get('/api/webmail.php?action=list&folder=inbox')).json.rows;
        assert.deepEqual([rows[0].subject, rows[0].from_addr], ['da fuori', 'Zed <zed@gmail.com>']);
        site.db("UPDATE accounts SET can_use_mail = 0 WHERE username = 'wm_ada'");
        assert.equal((await ada.get('/api/webmail.php?action=boot')).status, 403, 'removing the permission closes the mailbox at once');
    });

    test('the admin can switch between own addresses (list filter); a plain account cannot filter', async () => {
        clear();
        await wm(admin, { action: 'create_address', local: 'boss', username: 'wm_admin' });
        await wm(admin, { action: 'create_address', local: 'boss.work', username: 'wm_admin' });
        await inbound({ to: 'boss@talvera.site', from: 'a@x.y', subject: 'to-boss', text: 't' }, 's3cret-s3cret');
        await inbound({ to: 'boss.work@talvera.site', from: 'a@x.y', subject: 'to-work', text: 't' }, 's3cret-s3cret');
        const subj = async (q) => (await admin.get('/api/webmail.php?action=list&folder=inbox' + q)).json.rows.map((r) => r.subject).sort();
        assert.deepEqual(await subj(''), ['to-boss', 'to-work']);
        assert.deepEqual(await subj('&addr=boss.work@talvera.site'), ['to-work']);
        assert.deepEqual(await subj('&addr=boss@talvera.site'), ['to-boss']);
        assert.deepEqual(await subj('&addr=ada.rossi@talvera.site'), ['to-boss', 'to-work'], 'not one of mine: ignored');
        assert.equal((await admin.get('/api/webmail.php?action=boot')).json.username, 'wm_admin');
    });
});
