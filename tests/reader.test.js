// tests/reader.test.js — bookmarks API, progress list, migration V4
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client, makeAdmin } = require('./helpers');

let site, reader, other, noAccess, bookId;
test.before(async () => {
    site = await startSite();
    await makeAdmin(site, 'rd_admin');
    reader = new Client(site); await reader.register('rd_reader');
    other = new Client(site); await other.register('rd_other');
    noAccess = new Client(site); await noAccess.register('rd_noaccess');
    site.db('UPDATE accounts SET can_read_books = 1 WHERE username IN (?, ?)', ['rd_reader', 'rd_other']);
    site.db("INSERT INTO books (title, format, file_path) VALUES ('Test Book', 'pdf', '/nonexistent.pdf')");
    bookId = site.db('SELECT id FROM books ORDER BY id DESC LIMIT 1')[0].id;
});
test.after(() => site.stop());

test('migration V4 created the bookmarks table', () => {
    assert.equal(site.db('PRAGMA user_version')[0].user_version, 4);
    assert.equal(site.db("SELECT name FROM sqlite_master WHERE name = 'bookmarks'").length, 1);
});

test('bookmarks: login + reader permission + CSRF required', async () => {
    const guest = await new Client(site).init();
    assert.equal((await guest.get(`/api/bookmarks.php?book_id=${bookId}`)).status, 401);
    assert.equal((await noAccess.get(`/api/bookmarks.php?book_id=${bookId}`)).status, 403);
    const add = { action: 'add', book_id: bookId, location: '12', label: 'Pagina 12', percentage: 40 };
    assert.equal((await reader.post('/api/bookmarks.php', add, { csrf: false })).status, 403);
    assert.equal((await reader.post('/api/bookmarks.php', { ...add, book_id: 99999 })).status, 404);
    assert.equal((await reader.post('/api/bookmarks.php', { ...add, location: '' })).status, 400);
});

test('bookmarks: add, list (own only, sorted), delete own only', async () => {
    const add = (loc, pct) => reader.post('/api/bookmarks.php', { action: 'add', book_id: bookId, location: loc, label: `p${loc}`, percentage: pct });
    assert.equal((await add('50', 80)).json.success, true);
    assert.equal((await add('10', 15)).json.success, true);

    const mine = (await reader.get(`/api/bookmarks.php?book_id=${bookId}`)).json.bookmarks;
    assert.deepEqual(mine.map((b) => b.location), ['10', '50']);
    assert.deepEqual((await other.get(`/api/bookmarks.php?book_id=${bookId}`)).json.bookmarks, []);

    assert.equal((await other.post('/api/bookmarks.php', { action: 'delete', id: mine[0].id })).status, 404);
    assert.equal((await reader.post('/api/bookmarks.php', { action: 'delete', id: mine[0].id })).json.success, true);
    assert.equal((await reader.get(`/api/bookmarks.php?book_id=${bookId}`)).json.bookmarks.length, 1);
});

test('progress: ?all=1 lists this user\'s progress for the continue shelf', async () => {
    assert.equal((await reader.post('/api/progress.php', { book_id: bookId, cfi_or_page: '7', percentage: 33 })).json.success, true);
    const all = (await reader.get('/api/progress.php?all=1')).json.progress;
    assert.deepEqual(all.map((p) => [p.book_id, p.percentage]), [[bookId, 33]]);
    assert.deepEqual((await other.get('/api/progress.php?all=1')).json.progress, []);
});
