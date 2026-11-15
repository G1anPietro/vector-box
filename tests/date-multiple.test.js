// tests/date-multiple.test.js — material for several days (representative), moving the day, admin upload limits
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startSite, Client, makeAdmin } = require('./helpers');

let site, admin, mario, luigi, classId, subj;
async function upload(c, fields, files) {
    const fd = new FormData(); fd.set('action', 'upload');
    for (const [k, v] of Object.entries(fields)) fd.set(k, String(v));
    for (const f of files) fd.append('files[]', new Blob([f.content], { type: 'text/plain' }), f.name);
    const res = await fetch(c.site.base + '/api/appunti.php', { method: 'POST', body: fd, headers: { Cookie: c.cookieHeader(), 'X-CSRF-Token': c.csrf } });
    return { status: res.status, json: await res.json() };
}
const items = async (c) => (await c.get(`/api/appunti.php?action=items&class_id=${classId}&subject_id=${subj}`)).json.items;

test.before(async () => {
    site = await startSite();
    admin = await makeAdmin(site, 'dm_admin');
    mario = new Client(site); await mario.register('dm_mario');       // creates the class: representative
    luigi = new Client(site); await luigi.register('dm_luigi');
    classId = (await mario.post('/api/classi.php', { action: 'request', name: '5D', school: 'ITIS Test' })).json.id;
    await admin.post('/api/classi.php', { action: 'decide', id: classId, approve: true });
    await mario.post('/api/classi.php', { action: 'save_timetable', id: classId, valid_from: '2026-01-01', periods: { 1: [{ start: '08:00', end: '09:00' }] }, slots: [{ day: 1, period: 1, subject: 'Storia' }] });
    subj = site.db('SELECT id FROM class_subjects WHERE class_id = ?', [classId])[0].id;
    const code = (await mario.get(`/api/classi.php?action=class&id=${classId}`)).json.class.invite_code;
    await luigi.post('/api/classi.php', { action: 'join', code });
});
test.after(() => site.stop());

test('the representative uploads once for several days; a classmate cannot', async () => {
    const base = { class_id: classId, subject_id: subj, kind: 'slide', lesson_date: '2026-10-05', title: 'Slide', extra_dates: '2026-10-06, 2026-10-07' };
    const r = await upload(mario, base, [{ name: 'slide.txt', content: Buffer.from('Le slide del prof'), type: 'text/plain' }]);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const list = await items(mario);
    assert.deepEqual(list.map((i) => i.lesson_date).sort(), ['2026-10-05', '2026-10-06', '2026-10-07']);
    for (const i of list) { assert.equal(i.files.length, 1); assert.equal(i.files[0].name, 'slide.txt'); }
    const names = new Set(site.db('SELECT stored_name FROM class_item_files WHERE class_id = ?', [classId]).map((x) => x.stored_name));
    assert.equal(names.size, 3, 'each day has its own file');
    // deleting one day keeps the others
    await mario.post('/api/appunti.php', { action: 'delete_item', id: list[0].id });
    const left = await items(mario);
    assert.equal(left.length, 2);
    for (const f of left.flatMap((i) => i.files)) assert.equal((await fetch(`${site.base}/api/appunti.php?action=file&id=${f.id}`, { headers: { Cookie: mario.cookieHeader() } })).status, 200);
    const no = await upload(luigi, { ...base, title: 'x' }, [{ name: 'a.txt', content: Buffer.from('x'), type: 'text/plain' }]);
    assert.equal(no.status, 403);
});

test('the representative can move any material to another day', async () => {
    const lu = await upload(luigi, { class_id: classId, subject_id: subj, kind: 'appunti', lesson_date: '2026-10-12', title: 'Di Luigi' }, [{ name: 'l.txt', content: Buffer.from('luigi'), type: 'text/plain' }]);
    assert.equal(lu.status, 200);
    const it = (await items(mario)).find((i) => i.title === 'Di Luigi');
    const r = await mario.post('/api/appunti.php', { action: 'edit_item', id: it.id, subject_id: subj, kind: it.kind, lesson_date: '2026-10-13', period: '', title: it.title, body: it.body });
    assert.equal(r.json.success, true);
    assert.equal((await items(mario)).find((i) => i.title === 'Di Luigi').lesson_date, '2026-10-13');
});

test('the admin sets the number of files per upload', async () => {
    assert.equal((await admin.post('/api/classi.php', { action: 'set_limits', file_mb: 40, class_mb: 5120, files: 2, per_hour: 300, open: 40 })).json.upload.files, 2);
    const three = await upload(mario, { class_id: classId, subject_id: subj, kind: 'appunti', lesson_date: '2026-10-14' }, [1, 2, 3].map((n) => ({ name: `f${n}.txt`, content: Buffer.from('n' + n), type: 'text/plain' })));
    assert.equal(three.json.code, 'too_many_files');
    assert.equal((await mario.get(`/api/appunti.php?action=usage&class_id=${classId}`)).json.upload.files, 2);
    assert.equal((await admin.post('/api/classi.php', { action: 'set_limits', file_mb: 40, class_mb: 5120, files: 500 })).json.code, 'bad_limit');
    assert.equal((await mario.post('/api/classi.php', { action: 'set_limits', file_mb: 40, class_mb: 5120, files: 5 })).status, 403);
});
