// tests/biblioteca2.test.js — library extras: highlights and notes, labels, reading log, tidy titles, duplicates, account data
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startSite, Client, makeAdmin } = require('./helpers');

let site;
test.before(async () => { site = await startSite(); });
test.after(() => site.stop());

/** A reader (allowed to read and upload), a plain account, and one book. */
async function setup(name) {
    try { site.db('DELETE FROM rate_limits'); } catch (e) { /* not created yet */ }
    const reader = await new Client(site).init(); await reader.register(name);
    site.db('UPDATE accounts SET can_read_books = 1, can_upload_books = 1 WHERE username = ?', [name]);
    site.db("INSERT INTO books (title, author, format, file_path, file_size, meta_checked) VALUES ('Libro ' || ?, 'Autore', 'epub', '/nonexistent.epub', 10, 1)", [name]);
    const id = site.db("SELECT id FROM books WHERE title = 'Libro ' || ?", [name])[0].id;
    const plain = await new Client(site).init(); await plain.register(name + '_plain');
    return { reader, plain, id };
}

test('the library page: one clear Menu button in the book, tabs for index/search/notes/text, shelves, statistics; the scripts are served; privacy names the new data', async () => {
    const { reader } = await setup('page_a');
    const html = (await reader.get('/pages/reader.php')).text;
    assert.match(html, /id="settings-btn"[^>]*>[\s\S]*?<span>Menu<\/span>/, 'a button that says Menu');
    assert.ok(!html.includes('Segnalibri</button>') && !html.includes('class="btn icon-btn aa-btn"'), 'the old Aa and Segnalibri buttons are gone');
    for (const id of ['tab-toc', 'tab-search', 'tab-notes', 'tab-text', 'toc-list', 'inbook-search-form', 'highlights-list', 'add-note-btn', 'export-notes-btn', 'sel-bar', 'shelf-filters', 'more-filters', 'f-format', 'f-author', 'f-tag', 'f-flags', 'shelf-count', 'filters-reset', 'shelf-sort', 'stats-section', 'tag-dialog', 'tidy-titles-btn']) assert.ok(html.includes(`id="${id}"`), id);
    for (const a of ['data-font="easy"', 'data-margin="xwide"', 'data-justify="justify"', 'id="lh-up-btn"']) assert.ok(html.includes(a), a);
    assert.ok(html.indexOf('reader-tools.js') !== -1 && html.indexOf('reader-tools.js') < html.indexOf('reader.js?'), 'tools load before reader.js');
    for (const f of ['/js/reader-tools.js', '/js/reader.js', '/css/reader.css']) assert.equal((await fetch(site.base + f)).status, 200, f);
    const plain = await new Client(site).init(); await plain.register('page_a_plain');
    assert.equal((await plain.get('/pages/reader.php')).status, 403, 'the page stays private');
    const privacy = (await fetch(`${site.base}/pages/privacy.php?lang=it`)).text();
    assert.match(await privacy, /evidenziazioni e note[\s\S]*etichette[\s\S]*quanto tempo e quante pagine/);
    assert.match(await (await fetch(`${site.base}/pages/privacy.php?lang=en`)).text(), /highlights and notes you write, labels[\s\S]*how much time and how many pages/);
});

test('account data: the new library data is exported and deleted with the account', async () => {
    const { reader, id } = await setup('gdpr_a');
    await reader.post('/api/highlights.php', { action: 'add', book_id: id, kind: 'note', location: '3', note: 'segreta' });
    await reader.post('/api/book_tags.php', { book_id: id, tags: ['mia'] });
    await reader.post('/api/reading_stats.php', { seconds: 90, pages: 2, day: new Date().toISOString().slice(0, 10) });
    const uid = site.db("SELECT id FROM accounts WHERE username = 'gdpr_a'")[0].id;
    const dump = (await reader.get('/api/account_data.php?action=export')).text;
    for (const needle of ['segreta', '"mia"', 'reading_log']) assert.ok(dump.includes(needle), 'the export has ' + needle);
    const del = await reader.post('/api/account_data.php', { action: 'delete', password: 'password123' });
    assert.ok(del.json && del.json.success, JSON.stringify(del.json || del.text).slice(0, 200));
    for (const t of ['book_highlights', 'book_tags', 'reading_log']) assert.equal(site.db(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`, [uid])[0].n, 0, t + ' emptied');
});

test('migration V46 created the library tables and the hash column', async () => {
    await fetch(`${site.base}/api/rooms.php`);
    assert.ok(site.db('PRAGMA user_version')[0].user_version >= 46);
    for (const t of ['book_highlights', 'book_tags', 'reading_log']) assert.ok(site.db(`SELECT name FROM sqlite_master WHERE name = '${t}'`).length, t);
    assert.ok(site.db('PRAGMA table_info(books)').some((c) => c.name === 'file_sha1'));
});

test('highlights and notes: add, list, update, delete, export; private to the account; limits', async () => {
    const { reader, plain, id } = await setup('hl_a');
    const add = (body) => reader.post('/api/highlights.php', { action: 'add', book_id: id, ...body });
    assert.equal((await plain.post('/api/highlights.php', { action: 'add', book_id: id, location: 'x', text: 'y' })).status, 403, 'no reader access');
    assert.equal((await add({ location: 'epubcfi(/6/4)', text: '' })).status, 400, 'a highlight needs text');
    assert.equal((await add({ kind: 'note', location: '5', note: '' })).status, 400, 'a note needs text');
    assert.equal((await reader.post('/api/highlights.php', { action: 'add', book_id: 99999, location: 'x', text: 'y' })).status, 404);
    const h = (await add({ location: 'epubcfi(/6/4!/4/2,/1:0,/1:9)', text: 'Nel mezzo del cammin', color: 'green', percentage: 12.5 })).json;
    assert.equal(h.success, true);
    const n = (await add({ kind: 'note', location: '7', note: 'Da rileggere', percentage: 40 })).json;
    const list = (await reader.get(`/api/highlights.php?book_id=${id}`)).json.items;
    assert.deepEqual(list.map((x) => [x.kind, x.color]), [['hl', 'green'], ['note', 'yellow']], 'sorted by position in the book');
    assert.equal((await reader.post('/api/highlights.php', { action: 'update', id: h.id, note: 'bello', color: 'pink' })).json.success, true);
    assert.equal((await reader.post('/api/highlights.php', { action: 'update', id: h.id, color: 'purple' })).json.success, true, 'a bad colour keeps the old one');
    const after = (await reader.get(`/api/highlights.php?book_id=${id}`)).json.items[0];
    assert.deepEqual([after.note, after.color], ['bello', 'pink']);
    // another account cannot read, change or delete mine
    const other = await new Client(site).init(); await other.register('hl_b');
    site.db('UPDATE accounts SET can_read_books = 1 WHERE username = ?', ['hl_b']);
    assert.deepEqual((await other.get(`/api/highlights.php?book_id=${id}`)).json.items, []);
    assert.equal((await other.post('/api/highlights.php', { action: 'delete', id: h.id })).status, 404);
    assert.equal((await other.post('/api/highlights.php', { action: 'update', id: h.id, note: 'hack' })).status, 404);
    const md = await reader.get(`/api/highlights.php?book_id=${id}&export=1`);
    assert.match(md.text, /^# Libro hl_a/); assert.match(md.text, /> Nel mezzo del cammin/); assert.match(md.text, /\*\*Nota \(40%\):\*\* Da rileggere/);
    assert.match(md.headers.get('content-disposition'), /attachment/);
    assert.equal((await reader.post('/api/highlights.php', { action: 'delete', id: n.id })).json.success, true);
    assert.equal((await reader.get(`/api/highlights.php?book_id=${id}`)).json.items.length, 1);
    // text is cut, controls removed
    const long = (await add({ location: 'z', text: 'a'.repeat(900) + '\u0007' })).json;
    const got = (await reader.get(`/api/highlights.php?book_id=${id}`)).json.items.find((x) => x.id === long.id);
    assert.ok(got.text.length <= 600 && !got.text.includes('\u0007'));
    assert.equal((await new Client(site).post('/api/highlights.php', { action: 'add' })).status !== 200, true, 'no login, no highlights');
});

test('library filters: per-book counts of highlights, notes and bookmarks, only for the account itself', async () => {
    const { reader, plain, id } = await setup('sum_a');
    assert.equal((await plain.get('/api/highlights.php?summary=1')).status, 403);
    assert.deepEqual((await reader.get('/api/highlights.php?summary=1')).json.counts, {}, 'nothing yet');
    await reader.post('/api/highlights.php', { action: 'add', book_id: id, kind: 'hl', location: 'a', text: 'uno' });
    await reader.post('/api/highlights.php', { action: 'add', book_id: id, kind: 'hl', location: 'b', text: 'due' });
    await reader.post('/api/highlights.php', { action: 'add', book_id: id, kind: 'note', location: '3', note: 'n' });
    await reader.post('/api/bookmarks.php', { action: 'add', book_id: id, location: '5', label: 'x', percentage: 3 });
    const c = (await reader.get('/api/highlights.php?summary=1')).json.counts;
    assert.deepEqual(c[id], { hl: 2, notes: 1, bookmarks: 1 });
    const other = await new Client(site).init(); await other.register('sum_b'); site.db('UPDATE accounts SET can_read_books = 1 WHERE username = ?', ['sum_b']);
    assert.deepEqual((await other.get('/api/highlights.php?summary=1')).json.counts, {}, "someone else's counts are not mine");
    site.db("INSERT INTO bookmarks (user_id, book_id, location, label) VALUES ((SELECT id FROM accounts WHERE username = 'sum_a'), 999, '1', 'solo segnalibro')");
    assert.deepEqual((await reader.get('/api/highlights.php?summary=1')).json.counts[999], { hl: 0, notes: 0, bookmarks: 1 }, 'a book with only bookmarks');
});

test('labels ("shelves"): set, replace, clean up, list; per account', async () => {
    const { reader, plain, id } = await setup('tag_a');
    assert.equal((await plain.get('/api/book_tags.php')).status, 403);
    let r = await reader.post('/api/book_tags.php', { book_id: id, tags: ['  Maturità ', 'maturità', 'da rileggere', '', 'x'.repeat(50)] });
    assert.deepEqual(r.json.tags, ['Maturità', 'da rileggere', 'x'.repeat(30)], 'trimmed, deduplicated ignoring case, cut at 30');
    r = await reader.post('/api/book_tags.php', { book_id: id, tags: 'uno, due,tre' }); assert.deepEqual(r.json.tags, ['uno', 'due', 'tre'], 'a comma list works too');
    r = await reader.post('/api/book_tags.php', { book_id: id, tags: Array.from({ length: 20 }, (_, i) => 't' + i) }); assert.equal(r.json.tags.length, 8);
    await reader.post('/api/book_tags.php', { book_id: id, tags: ['solo'] });
    const g = (await reader.get('/api/book_tags.php')).json;
    assert.deepEqual(g.tags[id], ['solo']); assert.deepEqual(g.all, ['solo']);
    assert.equal((await reader.post('/api/book_tags.php', { book_id: 99999, tags: ['a'] })).status, 404);
    const other = await new Client(site).init(); await other.register('tag_b'); site.db('UPDATE accounts SET can_read_books = 1 WHERE username = ?', ['tag_b']);
    assert.deepEqual((await other.get('/api/book_tags.php')).json.all, []);
});

test('reading log: adds to the day, caps, validates the date, week/month/streak', async () => {
    const { reader, plain } = await setup('log_a');
    assert.equal((await plain.post('/api/reading_stats.php', { seconds: 60 })).status, 403);
    const day = new Date().toISOString().slice(0, 10);
    assert.equal((await reader.post('/api/reading_stats.php', { seconds: 120, pages: 5, day })).json.success, true);
    await reader.post('/api/reading_stats.php', { seconds: 99999, pages: 9999, day });       // capped per call
    await reader.post('/api/reading_stats.php', { seconds: 30, pages: 1, day: '1999-01-01' }); // a silly date: today's day is used
    const s = (await reader.get(`/api/reading_stats.php?today=${day}`)).json;
    assert.equal(s.success, true);
    const today = s.days.find((d) => d.day === day);
    assert.equal(today.seconds, 120 + 3600 + 30); assert.equal(today.pages, 5 + 200 + 1);
    assert.deepEqual([s.week.seconds, s.month.seconds, s.total_seconds], [3750, 3750, 3750]);
    assert.equal(s.streak, 1);
    site.db("INSERT INTO reading_log (user_id, day, seconds, pages) VALUES ((SELECT id FROM accounts WHERE username = 'log_a'), date('now', '-1 day'), 600, 2)");
    assert.equal((await reader.get(`/api/reading_stats.php?today=${day}`)).json.streak, 2);
    assert.equal((await new Client(site).get('/api/reading_stats.php')).status !== 200, true);
});

test('tidy titles: pure rules and the uploaders-only action (dry run, then apply)', async () => {
    const { reader, plain, id } = await setup('clean_a');
    const rows = [
        ['1794062593_Orwell__George_-_1984__Penguin___George_Orwell__Orwell__George____z-library_sk__1lib_sk__z-lib_sk_', 'Unknown'],
        ['La Lupa (Giovanni Verga David Lan [Verga etc.) (z-library.sk, 1lib.sk, z-lib.sk)', 'Giovanni Verga'],
        ['Il fu Mattia Pascal (Luigi Pirandello)', 'Luigi Pirandello'],
        ['Cecità - José Saramago', 'José Saramago'],
        ['Dune', 'Frank Herbert'],
    ];
    for (const [t, a] of rows) site.db("INSERT INTO books (title, author, format, file_path, meta_checked) VALUES (?, ?, 'epub', '/x.epub', 1)", [t, a]);
    site.db("INSERT INTO books (title, author, format, file_path, meta_checked) VALUES ('Mastro-don Gesualdo', 'Giovanni Verga (z-library.sk)', 'epub', '/x.epub', 1)");
    assert.equal((await plain.post('/api/books.php?action=clean_titles', {})).status, 403);
    const dry = (await reader.post('/api/books.php?action=clean_titles', {})).json;
    assert.equal(dry.applied, false);
    const by = Object.fromEntries(dry.changes.map((c) => [c.title.slice(0, 12), c]));
    assert.equal(dry.changes.find((c) => c.title.startsWith('La Lupa')).new_title, 'La Lupa');
    assert.equal(dry.changes.find((c) => c.title.startsWith('Il fu')).new_title, 'Il fu Mattia Pascal');
    assert.equal(dry.changes.find((c) => c.title.startsWith('Cecità')).new_title, 'Cecità');
    assert.equal(dry.changes.find((c) => c.title.startsWith('1794')).new_title.includes('z-lib'), false);
    assert.equal(dry.changes.find((c) => c.title.startsWith('Mastro')).new_author, 'Giovanni Verga');
    assert.ok(!dry.changes.some((c) => c.title === 'Dune' || c.id === id), 'clean ones are left alone');
    assert.equal(site.db("SELECT title FROM books WHERE title LIKE 'La Lupa%'")[0].title.startsWith('La Lupa ('), true, 'a dry run changes nothing');
    const done = (await reader.post('/api/books.php?action=clean_titles', { apply: true })).json;
    assert.equal(done.applied, true);
    assert.equal(site.db("SELECT title FROM books WHERE title = 'La Lupa'").length, 1);
    assert.equal((await reader.post('/api/books.php?action=clean_titles', {})).json.changes.length, 0, 'nothing left to tidy');
    void by;
});

/** A tiny real EPUB (made with Python's zipfile): title, author and an optional extra file to change the bytes. */
function makeEpub(file, title, author, extra = '') {
    const py = `
import zipfile, sys
t, a, f, extra = sys.argv[1:5]
z = zipfile.ZipFile(f, 'w')
z.writestr('mimetype', 'application/epub+zip', zipfile.ZIP_STORED)
z.writestr('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="c.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
z.writestr('c.opf', '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="i"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>%s</dc:title><dc:creator>%s</dc:creator><dc:identifier id="i">x</dc:identifier></metadata><manifest/><spine/></package>' % (t, a))
if extra: z.writestr('extra.txt', extra)
z.close()`;
    require('node:child_process').execFileSync('python3', ['-c', py, title, author, file, extra]);
    return fs.readFileSync(file);
}

test('upload: the same file twice and the same book in another file are refused; titles are stored tidy', async () => {
    const { reader } = await setup('dup_a');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epub-'));
    const send = async (name, buf) => {
        const fd = new FormData(); fd.append('book_file', new Blob([buf]), name);
        const r = await fetch(`${site.base}/api/books.php?action=upload`, { method: 'POST', headers: { Cookie: reader.cookieHeader(), 'X-CSRF-Token': reader.csrf }, body: fd });
        return { status: r.status, json: await r.json().catch(() => null) };
    };
    const a = makeEpub(path.join(dir, 'a.epub'), 'Il Libro Prova (z-library.sk, 1lib.sk)', 'Autore Prova');
    const first = await send('a.epub', a);
    assert.equal(first.status, 200, JSON.stringify(first.json));
    const row = site.db('SELECT title, author, file_sha1 FROM books WHERE id = ?', [first.json.book_id])[0];
    assert.deepEqual([row.title, row.author, row.file_sha1.length], ['Il Libro Prova', 'Autore Prova', 40], 'tidy title, hash stored');
    const again = await send('copia.epub', a);
    assert.equal(again.status, 409); assert.equal(again.json.error, 'DUPLICATE'); assert.equal(again.json.title, 'Il Libro Prova'); assert.equal(again.json.book_id, Number(first.json.book_id));
    const other = makeEpub(path.join(dir, 'b.epub'), 'Il Libro Prova', 'Autore Prova', 'other bytes');
    assert.equal((await send('b.epub', other)).status, 409, 'same title, author and format = the same book');
    assert.equal(site.db("SELECT COUNT(*) AS n FROM books WHERE title = 'Il Libro Prova'")[0].n, 1);
    const c = makeEpub(path.join(dir, 'c.epub'), 'Un Altro Libro', 'Autore Prova');
    assert.equal((await send('c.epub', c)).status, 200, 'a different book goes in');
    // an old book without a hash is recognised by comparing the file (same size, same content)
    const old = path.join(dir, 'old.epub'); const oldBytes = makeEpub(old, 'Vecchio Libro', 'Autore Vecchio');
    site.db("INSERT INTO books (title, author, format, file_path, file_size, meta_checked) VALUES ('Titolo diverso', 'Altro', 'epub', ?, ?, 1)", [old, oldBytes.length]);
    const dup = await send('nuovo-nome.epub', oldBytes);
    assert.equal(dup.status, 409); assert.equal(dup.json.title, 'Titolo diverso');
    assert.equal(site.db("SELECT file_sha1 FROM books WHERE title = 'Titolo diverso'")[0].file_sha1.length, 40, 'the old book got its hash');
});
