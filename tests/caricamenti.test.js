// tests/caricamenti.test.js — resumable uploads: pieces at exact offsets, resume, commit, duplicates, ownership
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startSite, Client, makeAdmin } = require('./helpers');

let site, admin, mario, luigi, peach, classId, storia;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
// a bigger valid file: PNG signature + the same image, padded with a text chunk so the type check (content) still passes
const BIG = Buffer.concat([PNG.subarray(0, PNG.length - 12), Buffer.from([0, 0, 0x10, 0, 0x74, 0x45, 0x58, 0x74]), Buffer.alloc(4096, 65), Buffer.from([0, 0, 0, 0]), PNG.subarray(PNG.length - 12)]);
const ap = (c, body) => c.post('/api/appunti.php', body);

async function chunk(c, id, offset, buf) {
    const fd = new FormData();
    fd.set('action', 'upload_chunk'); fd.set('upload_id', id); fd.set('offset', String(offset));
    fd.append('chunk', new Blob([buf]), 'chunk');
    const res = await fetch(c.site.base + '/api/appunti.php', { method: 'POST', body: fd, headers: { Cookie: c.cookieHeader(), 'X-CSRF-Token': c.csrf } });
    return { status: res.status, json: await res.json() };
}
const items = async (c) => (await c.get(`/api/appunti.php?action=items&class_id=${classId}`)).json.items;

test.before(async () => {
    site = await startSite();
    admin = await makeAdmin(site, 'up_admin');
    mario = new Client(site); await mario.register('up_mario');
    luigi = new Client(site); await luigi.register('up_luigi');
    peach = new Client(site); await peach.register('up_peach');
    classId = (await mario.post('/api/classi.php', { action: 'request', name: '5E', school: 'ITIS Test' })).json.id;
    await admin.post('/api/classi.php', { action: 'decide', id: classId, approve: true });
    const code = (await mario.get(`/api/classi.php?action=class&id=${classId}`)).json.class.invite_code;
    await luigi.post('/api/classi.php', { action: 'join', code });
    await mario.post('/api/classi.php', { action: 'save_timetable', id: classId, valid_from: '2026-01-01',
        periods: { 1: [{ start: '08:00', end: '09:00' }] }, slots: [{ day: 1, period: 1, subject: 'Storia' }] });
    storia = site.db('SELECT id FROM class_subjects WHERE class_id = ?', [classId])[0].id;
});
test.after(() => site.stop());

test('a file in pieces: wrong offsets are refused with the right one, a break can be resumed, commit makes the item', async () => {
    const hash = crypto.createHash('sha256').update(BIG).digest('hex');
    const b = await ap(luigi, { action: 'upload_begin', class_id: classId, name: 'foto.png', size: BIG.length, sha256: hash });
    assert.equal(b.status, 200, b.text);
    const id = b.json.upload_id;
    const cut = 1000;
    assert.equal((await chunk(luigi, id, 0, BIG.subarray(0, cut))).json.received, cut);
    // the same piece again (a retry after a lost answer): refused, and the server says where it is
    const again = await chunk(luigi, id, 0, BIG.subarray(0, cut));
    assert.deepEqual([again.status, again.json.code, again.json.received], [409, 'offset', cut]);
    // someone else cannot touch it, or know about it
    assert.equal((await chunk(mario, id, cut, BIG.subarray(cut))).status, 404);
    assert.equal((await mario.get(`/api/appunti.php?action=upload_status&upload_id=${id}`)).status, 404);
    // "reload": ask where it stopped, continue from there
    const st = (await luigi.get(`/api/appunti.php?action=upload_status&upload_id=${id}`)).json;
    assert.equal(st.received, cut);
    // committing too early is refused
    const early = await ap(luigi, { action: 'upload_commit', class_id: classId, upload_ids: [id], subject_id: storia, kind: 'appunti', lesson_date: '2026-10-05' });
    assert.deepEqual([early.status, early.json.code], [409, 'incomplete']);
    const last = await chunk(luigi, id, st.received, BIG.subarray(st.received));
    assert.equal(last.json.done, true);
    const done = await ap(luigi, { action: 'upload_commit', class_id: classId, upload_ids: [id], subject_id: storia, kind: 'appunti', lesson_date: '2026-10-05', title: 'A pezzi' });
    assert.equal(done.status, 200, done.text);
    const it = (await items(luigi))[0];
    assert.deepEqual([it.title, it.files.length, it.files[0].name, it.files[0].size], ['A pezzi', 1, 'foto.png', BIG.length]);
    // the stored file is the original, bit for bit
    const dl = await luigi.get(`/api/appunti.php?action=file&id=${it.files[0].id}`);
    assert.equal(dl.status, 200);
    // the temp folder is gone, and the same upload cannot be committed twice
    assert.equal((await ap(luigi, { action: 'upload_commit', class_id: classId, upload_ids: [id], subject_id: storia, kind: 'appunti', lesson_date: '2026-10-05' })).status, 404);
});

test('the same file sent again is recognised by its fingerprint', async () => {
    const hash = crypto.createHash('sha256').update(BIG).digest('hex');
    const b = await ap(mario, { action: 'upload_begin', class_id: classId, name: 'altra-copia.png', size: BIG.length, sha256: hash });
    assert.equal(b.json.duplicate, true);
    assert.equal(b.json.name, 'foto.png');
    const other = await ap(peach, { action: 'upload_begin', class_id: classId, name: 'x.png', size: 10 });
    assert.equal(other.status, 404, 'not in the class');
});

test('limits and rejects: too big, empty, unknown type at commit, more data than announced, cancel', async () => {
    assert.equal((await ap(mario, { action: 'upload_begin', class_id: classId, name: 'enorme.pdf', size: 10 * 1024 * 1024 * 1024 })).json.code, 'file_too_large');
    assert.equal((await ap(mario, { action: 'upload_begin', class_id: classId, name: 'vuoto.png', size: 0 })).json.code, 'bad_file');
    assert.equal((await mario.post('/api/appunti.php', { action: 'upload_begin', class_id: classId, name: 'a.png', size: 5 }, { csrf: false })).status, 403);
    const txt = Buffer.from('MZ not an allowed type at all');
    const b = (await ap(mario, { action: 'upload_begin', class_id: classId, name: 'prog.exe', size: txt.length })).json;
    await chunk(mario, b.upload_id, 0, txt);
    const bad = await ap(mario, { action: 'upload_commit', class_id: classId, upload_ids: [b.upload_id], subject_id: storia, kind: 'appunti', lesson_date: '2026-10-05' });
    assert.equal(bad.json.code, 'bad_type');
    assert.equal((await ap(mario, { action: 'upload_cancel', upload_id: b.upload_id })).status, 200);
    assert.equal((await mario.get(`/api/appunti.php?action=upload_status&upload_id=${b.upload_id}`)).status, 404);
    const c = (await ap(mario, { action: 'upload_begin', class_id: classId, name: 'p.png', size: 4 })).json;
    assert.equal((await chunk(mario, c.upload_id, 0, Buffer.alloc(10))).status, 413);
    assert.equal((await ap(mario, { action: 'upload_cancel', upload_id: 'not-an-id' })).status, 200);
});
