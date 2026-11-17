// tests/admin-registro.test.js — the admin action log (successful admin POSTs only) and the votes on ideas.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client, makeAdmin } = require('./helpers');

let site, admin, ann, bob;
test.before(async () => {
    site = await startSite();
    admin = await makeAdmin(site, 'log_admin');
    ann = new Client(site); await ann.register('log_ann');
    bob = new Client(site); await bob.register('log_bob');
});
test.after(() => site.stop());

const annId = () => site.db("SELECT id FROM accounts WHERE username = 'log_ann'")[0].id;

test('a successful admin action is logged with the target, a failed one is not, GETs never', async () => {
    assert.equal((await admin.post('/api/admin_users.php', { action: 'set_flag', user_id: annId(), flag: 'ads_free', value: 1 })).json.success, true);
    await admin.post('/api/admin_users.php', { action: 'set_flag', user_id: annId(), flag: 'nonsense', value: 1 });   // refused
    await admin.get('/api/admin_users.php?action=list');
    const rows = site.db('SELECT * FROM admin_log');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].admin_name, 'log_admin');
    assert.equal(rows[0].target_name, 'log_ann');
    assert.equal(rows[0].action, 'set_flag');
    assert.match(rows[0].detail, /ads_free/);
});

test('the log is read by admins only, newest first; texts of messages are never stored', async () => {
    await admin.post('/api/news_ideas.php', { action: 'set', id: 999, status: 'planned', reply: 'SECRET-REPLY-TEXT' });
    const j = (await admin.get('/api/admin_users.php?action=log')).json;
    assert.equal(j.success, true);
    assert.equal(j.rows[0].script, 'news_ideas');
    assert.ok(!JSON.stringify(j).includes('SECRET-REPLY-TEXT'));
    assert.equal((await ann.get('/api/admin_users.php?action=log')).status, 403);
});

test('deleting the account keeps the log but forgets who it was about; the export lists it', async () => {
    const exp = (await ann.get('/api/account_data.php?action=export')).json;
    assert.ok(JSON.stringify(exp).includes('admin_actions_on_this_account'));
    const id = annId();
    site.db(`SELECT 1`);   // (the erase itself is covered by elimina.test.js)
    assert.ok(site.db(`SELECT COUNT(*) AS n FROM admin_log WHERE target_user_id = ${id}`)[0].n >= 1);
});

test('votes: only on ideas under review, not your own, toggles, and the public list has no names', async () => {
    const add = await ann.post('/api/news_ideas.php', { text: 'A tournament mode for the arcade games' });
    const id = add.json.id;
    assert.equal((await bob.post('/api/news_ideas.php', { action: 'vote', id })).status, 404);          // still "new": not public
    assert.equal((await bob.get('/api/news_ideas.php')).json.public.length, 0);
    await admin.post('/api/news_ideas.php', { action: 'set', id, status: 'considering' });
    const pub = (await bob.get('/api/news_ideas.php')).json.public;
    assert.equal(pub.length, 1);
    assert.equal(pub[0].username, null);
    assert.equal((await ann.post('/api/news_ideas.php', { action: 'vote', id })).status, 404);          // not your own
    let v = (await bob.post('/api/news_ideas.php', { action: 'vote', id })).json;
    assert.deepEqual([v.voted, v.votes], [true, 1]);
    assert.equal((await ann.get('/api/news_ideas.php')).json.ideas[0].votes, 1);
    v = (await bob.post('/api/news_ideas.php', { action: 'vote', id })).json;
    assert.deepEqual([v.voted, v.votes], [false, 0]);
    await bob.post('/api/news_ideas.php', { action: 'vote', id });
    await ann.post('/api/news_ideas.php', { action: 'delete', id });                                    // the author deletes: the votes go too
    assert.equal(site.db('SELECT COUNT(*) AS n FROM news_idea_votes')[0].n, 0);
});

test('a refused action (HTTP 200 with success:false) and a user named by username are handled', async () => {
    const before = site.db('SELECT COUNT(*) AS n FROM admin_log')[0].n;
    await admin.post('/api/moderate_book_access.php', { action: 'grant', username: 'nobody_here', scope: 'books' });   // no such user: not an action
    assert.equal(site.db('SELECT COUNT(*) AS n FROM admin_log')[0].n, before);
    const ok = await admin.post('/api/moderate_book_access.php', { action: 'grant', username: 'log_bob', scope: 'books' });
    assert.equal(ok.json.success, true);
    const row = site.db("SELECT * FROM admin_log WHERE script = 'moderate_book_access' ORDER BY id DESC LIMIT 1")[0];
    assert.equal(row.target_name, 'log_bob');
});
