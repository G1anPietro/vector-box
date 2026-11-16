// tests/privacy-diritti.test.js — GDPR rights: download my data, delete my account, retention, age/privacy confirmation at sign-up
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { startSite, Client, makeAdmin } = require('./helpers');

const now = () => Math.floor(Date.now() / 1000);
const T = 'text_status, text_attempts';

test.describe('your data: export, erasure, retention', () => {
    let site, ada, bob, admin, adaId, bobId;
    // registration is rate limited per address: clear the counters before each new account
    const clearLimits = () => { try { site.db('DELETE FROM rate_limits'); } catch (e) { /* table not created yet */ } };
    const reg = async (name) => { clearLimits(); const c = new Client(site); await c.register(name); return c; };
    test.before(async () => {
        site = await startSite();
        ada = await reg('gd_ada');
        bob = await reg('gd_bob');
        clearLimits();
        admin = await makeAdmin(site, 'gd_admin');
        adaId = site.db("SELECT id FROM accounts WHERE username = 'gd_ada'")[0].id;
        bobId = site.db("SELECT id FROM accounts WHERE username = 'gd_bob'")[0].id;
    });
    test.after(async () => { await site.stop(); });

    test('registering needs the privacy / minimum age confirmation', async () => {
        const raw = (extra) => fetch(`${site.base}/api/login.php`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'register', username: 'gd_noterms', password: 'password123', ...extra }) });
        const no = await raw({});
        assert.equal(no.status, 400);
        assert.match((await no.json()).error, /at least 14/);
        assert.equal(site.db("SELECT COUNT(*) AS n FROM accounts WHERE username = 'gd_noterms'")[0].n, 0);
    });

    test('export: login required, only my own data, no password hash', async () => {
        assert.equal((await fetch(`${site.base}/api/account_data.php?action=export`)).status, 401);
        const now_ = new Date().toISOString().slice(0, 19).replace('T', ' ');
        site.db("INSERT INTO transmissions (room_id, message, sender_ip, username, user_id, created_at) VALUES ('general', 'ciao da ada', '9.9.9.9', 'gd_ada', ?, ?)", [adaId, now_]);
        site.db("INSERT INTO transmissions (room_id, message, sender_ip, username, user_id, created_at) VALUES ('general', 'ciao da bob', '8.8.8.8', 'gd_bob', ?, ?)", [bobId, now_]);
        const r = await ada.get('/api/account_data.php?action=export');
        assert.equal(r.status, 200);
        assert.match(r.headers.get('content-disposition'), /attachment; filename="vector-box-gd_ada-/);
        const text = JSON.stringify(r.json);
        assert.ok(text.includes('ciao da ada'));
        assert.ok(text.includes('9.9.9.9'));
        assert.ok(!text.includes('ciao da bob'));
        assert.ok(!text.includes('password_hash'));
        assert.equal(r.json.account.username, 'gd_ada');
    });

    test('delete: needs CSRF, the right password, and is refused to admins and class managers', async () => {
        assert.equal((await ada.post('/api/account_data.php', { action: 'delete', password: 'password123' }, { csrf: false })).status, 403);
        assert.equal((await ada.post('/api/account_data.php', { action: 'delete', password: 'wrong' })).status, 403);
        assert.equal((await admin.post('/api/account_data.php', { action: 'delete', password: 'password123' })).status, 409);
        const mgr = await reg('gd_mgr');
        const mgrId = site.db("SELECT id FROM accounts WHERE username = 'gd_mgr'")[0].id;
        site.db("INSERT INTO school_classes (name, school, status, manager_id, created_at) VALUES ('5Z', 'S', 'active', ?, ?)", [mgrId, now()]);
        const r = await mgr.post('/api/account_data.php', { action: 'delete', password: 'password123' });
        assert.equal(r.status, 409);
        assert.match(r.json.error, /manage a class/);
        assert.equal(site.db("SELECT COUNT(*) AS n FROM accounts WHERE username = 'gd_mgr'")[0].n, 1);
    });

    test('delete: removes the account and its data, keeps what others own, unlinks the donation', async () => {
        const t = now();
        site.db("INSERT INTO dm_messages (sender_id, recipient_id, body) VALUES (?, ?, 'segreto')", [adaId, bobId]);
        site.db("INSERT INTO dm_messages (sender_id, recipient_id, body) VALUES (?, ?, 'risposta')", [bobId, adaId]);
        site.db("INSERT INTO bookmarks (user_id, book_id, location, label, percentage) VALUES (?, 1, 'x', 'l', 5)", [adaId]);
        site.db("INSERT INTO notifications (user_id, kind, title, body, created_at) VALUES (?, 'k', 't', 'b', ?)", [adaId, t]);
        site.db("INSERT INTO donors (account_id, display_name, amount_cents, donated_at, is_public, note, created_at) VALUES (?, 'Ada L.', 500, '2026-11-01', 1, 'n', ?)", [adaId, t]);
        site.db("INSERT INTO school_classes (name, school, status, manager_id, created_at) VALUES ('5Y', 'S', 'active', ?, ?)", [bobId, t]);
        const cid = site.db("SELECT id FROM school_classes WHERE name = '5Y'")[0].id;
        site.db('INSERT INTO class_members (class_id, user_id, joined_at) VALUES (?, ?, ?)', [cid, adaId, t]);
        site.db("INSERT INTO class_subjects (class_id, name) VALUES (?, 'Storia')", [cid]);
        const sid = site.db('SELECT id FROM class_subjects WHERE class_id = ?', [cid])[0].id;
        site.db("INSERT INTO class_items (class_id, subject_id, author_id, kind, lesson_date, title, body, created_at, updated_at) VALUES (?, ?, ?, 'appunti', '2026-11-02', 'mio', 'testo', ?, ?)", [cid, sid, adaId, t, t]);
        // a stored file of that note
        const dir = path.join(site.root, 'data/appunti', String(cid)); fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'f1.txt'), 'x');
        const iid = site.db('SELECT id FROM class_items WHERE author_id = ?', [adaId])[0].id;
        site.db("INSERT INTO class_item_files (item_id, class_id, stored_name, original_name, mime, size, text_status, created_at) VALUES (?, ?, 'f1.txt', 'f1.txt', 'text/plain', 1, 'done', ?)", [iid, cid, t]);

        const r = await ada.post('/api/account_data.php', { action: 'delete', password: 'password123', delete_materials: true });
        assert.equal(r.status, 200, JSON.stringify(r.json));
        const n = (sql, p = []) => site.db(sql, p)[0].n;
        assert.equal(n("SELECT COUNT(*) AS n FROM accounts WHERE username = 'gd_ada'"), 0);
        assert.equal(n("SELECT COUNT(*) AS n FROM transmissions WHERE username = 'gd_ada'"), 0);
        assert.equal(n('SELECT COUNT(*) AS n FROM transmissions WHERE username = ?', ['gd_bob']), 1);   // someone else's message stays
        assert.equal(n('SELECT COUNT(*) AS n FROM dm_messages'), 0);
        assert.equal(n('SELECT COUNT(*) AS n FROM bookmarks WHERE user_id = ?', [adaId]), 0);
        assert.equal(n('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?', [adaId]), 0);
        assert.equal(n('SELECT COUNT(*) AS n FROM class_members WHERE user_id = ?', [adaId]), 0);
        assert.equal(n('SELECT COUNT(*) AS n FROM class_items WHERE author_id = ?', [adaId]), 0);
        assert.equal(n('SELECT COUNT(*) AS n FROM class_item_files WHERE item_id = ?', [iid]), 0);
        assert.ok(!fs.existsSync(path.join(dir, 'f1.txt')), 'the stored file is gone');
        const don = site.db('SELECT * FROM donors')[0];                                                  // kept for accounting, anonymised
        assert.equal(don.amount_cents, 500); assert.equal(don.account_id, null); assert.equal(don.display_name, ''); assert.equal(don.is_public, 0);
        // the session is over and the account cannot log in
        assert.equal((await ada.get('/api/account_data.php?action=export')).status, 401);
        assert.equal((await ada.login('gd_ada')).status === 200 && (await ada.get('/api/check_session.php')).json?.logged_in === true, false);
    });

    test('delete without "delete materials": the note stays in the class, with no author', async () => {
        const eve = await reg('gd_eve');
        const eveId = site.db("SELECT id FROM accounts WHERE username = 'gd_eve'")[0].id;
        const cid = site.db("SELECT id FROM school_classes WHERE name = '5Y'")[0].id;
        const sid = site.db('SELECT id FROM class_subjects WHERE class_id = ?', [cid])[0].id;
        const t = now();
        site.db("INSERT INTO class_items (class_id, subject_id, author_id, kind, lesson_date, title, body, created_at, updated_at) VALUES (?, ?, ?, 'appunti', '2026-11-03', 'resta', 'testo', ?, ?)", [cid, sid, eveId, t, t]);
        const r = await eve.post('/api/account_data.php', { action: 'delete', password: 'password123', delete_materials: false });
        assert.equal(r.status, 200);
        const row = site.db("SELECT author_id FROM class_items WHERE title = 'resta'")[0];
        assert.equal(row.author_id, 0);
    });

    test('retention: old IPs, messages, visits and bot lines go; recent ones stay', async () => {
        const old = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace('T', ' ');
        site.db("INSERT INTO transmissions (room_id, message, sender_ip, username, created_at) VALUES ('general', 'vecchio', '1.1.1.1', 'x', ?)", [old(400)]);
        site.db("INSERT INTO transmissions (room_id, message, sender_ip, username, created_at) VALUES ('general', 'medio', '2.2.2.2', 'x', ?)", [old(120)]);
        site.db("INSERT INTO transmissions (room_id, message, sender_ip, username, created_at) VALUES ('general', 'nuovo', '3.3.3.3', 'x', ?)", [old(1)]);
        site.db("INSERT INTO visitors (vhash, first_seen, last_seen, last_new, visits) VALUES ('old', 1, ?, 1, 1)", [now() - 100 * 86400]);
        site.db("INSERT INTO visitors (vhash, first_seen, last_seen, last_new, visits) VALUES ('new', 1, ?, 1, 1)", [now() - 86400]);
        const day = (d) => old(d).slice(0, 10);
        fs.writeFileSync(path.join(site.root, 'data/visits.log'), `${day(200)} 10:00:00\t1.1.1.1\t-\t/\tFirefox\tfirst\t-\n${day(2)} 10:00:00\t2.2.2.2\t-\t/\tFirefox\tfirst\t-\n`);
        fs.writeFileSync(path.join(site.root, 'data/bots.log'), `${day(60)} 10:00:00\t1.1.1.1\ttool\tcurl\t/\t200\n${day(2)} 10:00:00\t2.2.2.2\ttool\tcurl\t/\t200\n`);
        const out = JSON.parse(execFileSync('php', [path.join(site.root, 'public/api/retention.php')]).toString());
        assert.equal(out.chat, 1);
        const msgs = Object.fromEntries(site.db("SELECT message, sender_ip FROM transmissions WHERE username = 'x'").map((r) => [r.message, r.sender_ip]));
        assert.deepEqual(Object.keys(msgs).sort(), ['medio', 'nuovo']);
        assert.equal(msgs.medio, '');            // older than 90 days: the message stays, the address goes
        assert.equal(msgs.nuovo, '3.3.3.3');
        assert.equal(site.db('SELECT COUNT(*) AS n FROM visitors')[0].n, 1);
        assert.equal(fs.readFileSync(path.join(site.root, 'data/visits.log'), 'utf8').trim().split('\n').length, 1);
        assert.equal(fs.readFileSync(path.join(site.root, 'data/bots.log'), 'utf8').trim().split('\n').length, 1);
    });

    test('the privacy page prints the retention numbers from the code and names the rights', async () => {
        const html = await (await fetch(`${site.base}/pages/privacy.php?lang=it`)).text();
        assert.match(html, /l’indirizzo IP 90 giorni/);
        assert.match(html, /messaggi privati 365 giorni/);
        assert.match(html, /Delete my account/);
        assert.match(html, /14 anni/);
        const en = await (await fetch(`${site.base}/pages/privacy.php?lang=en`)).text();
        assert.match(en, /the IP address 90 days/);
    });

    test('the account page offers download and deletion (not deletion to admins)', async () => {
        const u = await reg('gd_page');
        const html = (await u.get('/pages/account.php')).text;
        assert.match(html, /DOWNLOAD MY DATA/);
        assert.match(html, /id="delete-account-form"/);
        assert.ok(!/id="delete-account-form"/.test((await admin.get('/pages/account.php')).text));
    });
});
