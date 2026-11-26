// tests/book-formati.test.js — MOBI, AZW3, FB2 and LIT uploads are checked by their content and converted to EPUB.
// Calibre is replaced by a tiny script that "converts" by copying a real EPUB (or fails, on request).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { startSite, Client } = require('./helpers');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'formati-'));
const epub = path.join(dir, 'fixture.epub');
execFileSync('python3', ['-c', `
import zipfile, sys
z = zipfile.ZipFile(sys.argv[1], 'w')
z.writestr('mimetype', 'application/epub+zip', zipfile.ZIP_STORED)
z.writestr('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="c.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
z.writestr('c.opf', '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="i"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Libro Convertito</dc:title><dc:creator>Autore Convertito</dc:creator><dc:identifier id="i">x</dc:identifier></metadata><manifest/><spine/></package>')
z.close()`, epub]);
const good = path.join(dir, 'good.sh'), bad = path.join(dir, 'bad.sh');
fs.writeFileSync(good, `#!/bin/sh\nexit_if_wrong_ext() { case "$1" in *.mobi|*.azw3|*.fb2|*.lit) ;; *) exit 9;; esac; }\nexit_if_wrong_ext "$1"\ncp "${epub}" "$2"\n`, { mode: 0o755 });
fs.writeFileSync(bad, '#!/bin/sh\nexit 1\n', { mode: 0o755 });

const mobi = (tag = 'BOOKMOBI') => Buffer.concat([Buffer.alloc(60), Buffer.from(tag), Buffer.from('x'.repeat(50) + Math.random())]);
const SAMPLES = {
    mobi: mobi(), azw3: mobi(), lit: Buffer.from('ITOLITLS' + 'y'.repeat(60) + Math.random()),
    fb2: Buffer.from('<?xml version="1.0" encoding="utf-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><body>' + Math.random() + '</body></FictionBook>'),
};

async function reader(site, name) {
    const r = await new Client(site).init(); await r.register(name);
    site.db('UPDATE accounts SET can_read_books = 1, can_upload_books = 1 WHERE username = ?', [name]);
    return r;
}
const send = async (site, r, name, buf) => {
    const fd = new FormData(); fd.append('book_file', new Blob([buf]), name);
    const res = await fetch(`${site.base}/api/books.php?action=upload`, { method: 'POST', headers: { Cookie: r.cookieHeader(), 'X-CSRF-Token': r.csrf }, body: fd });
    return { status: res.status, json: await res.json().catch(() => null) };
};

test('every extra format is converted to an EPUB book; wrong content, duplicates and failures are refused', async () => {
    const site = await startSite({ EBOOK_CONVERT: good });
    try {
        const r = await reader(site, 'formati_a');
        // the converted books all have the same title: each one is removed before the next (same title + author = a duplicate); MOBI stays for the checks below
        const ids = [];
        for (const ext of ['azw3', 'lit', 'fb2', 'mobi']) {
            const res = await send(site, r, `prova.${ext}`, SAMPLES[ext]);
            assert.equal(res.status, 200, ext + ' ' + JSON.stringify(res.json));
            ids[0] = res.json.book_id;
            if (ext !== 'mobi') site.db('DELETE FROM books WHERE id = ?', [res.json.book_id]);
        }
        const row = site.db('SELECT title, author, format, file_path, file_sha1 FROM books WHERE id = ?', [ids[0]])[0];
        assert.deepEqual([row.title, row.author, row.format], ['Libro Convertito', 'Autore Convertito', 'epub']);
        assert.ok(row.file_path.endsWith('.epub') && fs.existsSync(row.file_path), 'the stored file is the EPUB');
        assert.equal(row.file_sha1.length, 40);
        assert.equal((await send(site, r, 'ancora.mobi', SAMPLES.mobi)).status, 409, 'the same MOBI twice is refused');
        assert.equal((await send(site, r, 'finto.mobi', Buffer.from('not a mobi at all' + Math.random()))).json.error, 'INVALID_FILE_CONTENT');
        assert.equal((await send(site, r, 'finto.fb2', Buffer.from('plain text' + Math.random()))).json.error, 'INVALID_FILE_CONTENT');
        assert.equal((await send(site, r, 'altro.docx', Buffer.from('PK\x03\x04xx'))).json.error, 'INVALID_FORMAT');
        // the library page offers the new formats
        const page = (await r.get('/pages/reader.php')).text;
        assert.match(page, /accept="\.epub,\.pdf,\.mobi,\.azw3,\.fb2,\.lit"/);
        assert.ok(site.db("SELECT COUNT(*) AS n FROM books WHERE format NOT IN ('epub','pdf')")[0].n === 0, 'only EPUB and PDF are stored');
    } finally { await site.stop(); }
});

test('conversion failures: a failing converter gives CONVERSION_FAILED and leaves nothing behind; a missing one gives CONVERTER_MISSING', async () => {
    const site = await startSite({ EBOOK_CONVERT: bad });
    try {
        const r = await reader(site, 'formati_b');
        const res = await send(site, r, 'rotto.mobi', mobi());
        assert.equal(res.status, 422); assert.equal(res.json.error, 'CONVERSION_FAILED');
        assert.equal(site.db('SELECT COUNT(*) AS n FROM books')[0].n, 0);
        const left = fs.existsSync(path.join(site.root, 'data', 'books')) ? fs.readdirSync(path.join(site.root, 'data', 'books')) : [];
        assert.deepEqual(left, [], 'no half-converted file stays');
    } finally { await site.stop(); }
    if (fs.existsSync('/usr/bin/ebook-convert') || fs.existsSync('/usr/local/bin/ebook-convert')) return;   // Calibre really installed here
    const none = await startSite({ EBOOK_CONVERT: path.join(dir, 'nonexistent') });
    try {
        const r = await reader(none, 'formati_c');
        const res = await send(none, r, 'x.fb2', SAMPLES.fb2);
        assert.equal(res.status, 503); assert.equal(res.json.error, 'CONVERTER_MISSING');
    } finally { await none.stop(); }
});
