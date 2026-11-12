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
    assert.ok(site.db('PRAGMA user_version')[0].user_version >= 4);
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

test('books: list hides server paths; covers served via action=cover (images only, readers only)', async () => {
    const fs = require('fs');
    const path = require('path');
    fs.mkdirSync(path.join(site.root, 'data', 'covers'), { recursive: true });
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    fs.writeFileSync(path.join(site.root, 'data', 'covers', 'c1.png'), png);
    fs.writeFileSync(path.join(site.root, 'data', 'covers', 'evil.svg'), '<svg onload="alert(1)"/>');
    site.db("INSERT INTO books (title, format, file_path, cover_path, meta_checked) VALUES ('Cov', 'pdf', '/x.pdf', '../data/covers/c1.png', 1)");
    site.db("INSERT INTO books (title, format, file_path, cover_path, meta_checked) VALUES ('Svg', 'pdf', '/y.pdf', '../data/covers/evil.svg', 1)");

    const list = (await reader.get('/api/books.php?action=list')).json.books;
    assert.ok(list.every((b) => !('file_path' in b)));
    const cov = list.find((b) => b.title === 'Cov');
    assert.match(cov.cover_path, /^\.\.\/api\/books\.php\?action=cover&id=\d+$/);

    const img = await reader.get(`/api/books.php?action=cover&id=${cov.id}`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.equal((await noAccess.get(`/api/books.php?action=cover&id=${cov.id}`)).status, 403);
    const svg = list.find((b) => b.title === 'Svg');
    assert.equal((await reader.get(`/api/books.php?action=cover&id=${svg.id}`)).status, 404);
});

test('PDF covers made in the browser: uploaders only, PDFs only, real images only, never replacing one', async () => {
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    site.db("INSERT INTO books (title, format, file_path) VALUES ('Senza copertina', 'pdf', '/nonexistent2.pdf')");
    const pdfId = site.db("SELECT id FROM books WHERE title = 'Senza copertina'")[0].id;
    site.db("INSERT INTO books (title, format, file_path) VALUES ('Un epub', 'epub', '/nonexistent.epub')");
    const epubId = site.db("SELECT id FROM books WHERE title = 'Un epub'")[0].id;
    site.db("UPDATE accounts SET can_upload_books = 1 WHERE username = 'rd_reader'");

    const send = async (c, id, content, type = 'image/png') => {
        const fd = new FormData();
        fd.set('book_id', String(id));
        fd.append('cover', new Blob([content], { type }), 'cover.png');
        const r = await fetch(`${site.base}/api/books.php?action=set_cover`, { method: 'POST', body: fd, headers: { Cookie: c.cookieHeader(), 'X-CSRF-Token': c.csrf } });
        return { status: r.status, json: await r.json() };
    };
    assert.equal((await send(other, pdfId, PNG)).status, 403, 'readers who cannot upload');
    assert.equal((await send(reader, epubId, PNG)).status, 404, 'EPUBs have their own covers');
    assert.equal((await send(reader, pdfId, Buffer.from('<svg onload="alert(1)"/>'), 'image/svg+xml')).json.error, 'BAD_IMAGE');
    assert.equal((await send(reader, pdfId, PNG)).json.success, true);

    const list = (await reader.get('/api/books.php?action=list')).json;
    assert.equal(list.can_upload, true);
    const book = list.books.find((b) => b.id === pdfId);
    assert.equal(book.cover_path, `../api/books.php?action=cover&id=${pdfId}`);
    const img = await fetch(`${site.base}/api/books.php?action=cover&id=${pdfId}`, { headers: { Cookie: reader.cookieHeader() } });
    assert.equal(img.headers.get('content-type'), 'image/png');

    const before = site.db('SELECT cover_path FROM books WHERE id = ?', [pdfId])[0].cover_path;
    assert.equal((await send(reader, pdfId, PNG)).json.already, true);
    assert.equal(site.db('SELECT cover_path FROM books WHERE id = ?', [pdfId])[0].cover_path, before, 'an existing cover is never replaced');
});
