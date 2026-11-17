// tests/copertine.test.js — the book list asks for small cover copies (w=thumb): made with ffmpeg, cached, original untouched; small or odd files fall back.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { startSite, makeAdmin } = require('./helpers');

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

test('cover thumbnails', { skip: !hasFfmpeg && 'ffmpeg is not installed here' }, async () => {
    const site = await startSite();
    try {
        const admin = await makeAdmin(site, 'cv_admin');
        const dir = path.join(site.root, 'data', 'covers');
        fs.mkdirSync(dir, { recursive: true });
        // a noisy 1200x1800 JPEG (big on purpose) and a tiny one
        const big = path.join(dir, 'big_cover.jpg');
        spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1200x1800:rate=1', '-frames:v', '1', '-q:v', '1', big]);
        const tiny = path.join(dir, 'tiny_cover.jpg');
        spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:size=20x30:rate=1', '-frames:v', '1', tiny]);
        assert.ok(fs.statSync(big).size > 60000, 'the test cover must be bigger than the threshold');
        for (const [i, f] of [[1, 'big_cover.jpg'], [2, 'tiny_cover.jpg']]) {
            site.db("INSERT INTO books (id, title, author, file_path, cover_path, format, uploaded_by) VALUES (?, 't', 'a', '/x', ?, 'epub', 'cv_admin')", [i, f]);
        }
        const get = async (url) => { const res = await fetch(site.base + url, { headers: { Cookie: admin.cookieHeader() } }); return { status: res.status, type: res.headers.get('content-type'), body: Buffer.from(await res.arrayBuffer()) }; };

        const list = (await admin.get('/api/books.php')).json.books;
        assert.match(list.find((b) => b.id === 1).cover_path, /&w=thumb&v=\d+$/);

        const thumb = await get('/api/books.php?action=cover&id=1&w=thumb');
        assert.equal(thumb.status, 200);
        assert.equal(thumb.type, 'image/jpeg');
        assert.ok(thumb.body.length < fs.statSync(big).size / 4, 'the copy is much smaller');
        assert.ok(fs.existsSync(path.join(dir, 'thumb', 'big_cover.jpg.jpg')), 'and it is cached on disk');
        const full = await get('/api/books.php?action=cover&id=1');
        assert.equal(full.body.length, fs.statSync(big).size, 'without w=thumb the original is served');
        const small = await get('/api/books.php?action=cover&id=2&w=thumb');
        assert.equal(small.body.length, fs.statSync(tiny).size, 'a small cover is served as it is');
        assert.equal((await get('/api/books.php?action=cover&id=99&w=thumb')).status, 404);
    } finally { site.stop(); }
});
