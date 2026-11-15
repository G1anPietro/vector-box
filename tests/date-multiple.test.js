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

test('bulk: move several uploads to another day, then delete a whole folder; others are skipped', async () => {
    await admin.post('/api/classi.php', { action: 'set_limits', file_mb: 40, class_mb: 5120, files: 20 });
    const ids = [];
    for (const n of [1, 2, 3]) {
        const r = await upload(mario, { class_id: classId, subject_id: subj, kind: 'appunti', lesson_date: '2026-11-02', title: 'bulk' + n }, [{ name: `b${n}.txt`, content: Buffer.from('b' + n), type: 'text/plain' }]);
        assert.equal(r.status, 200);
    }
    const lu = await upload(luigi, { class_id: classId, subject_id: subj, kind: 'appunti', lesson_date: '2026-11-02', title: 'bulk-luigi' }, [{ name: 'lu.txt', content: Buffer.from('lu'), type: 'text/plain' }]);
    assert.equal(lu.status, 200);
    const all = (await items(mario)).filter((i) => i.title.startsWith('bulk'));
    all.forEach((i) => ids.push(i.id));
    // a classmate may move only his own
    const m1 = await luigi.post('/api/appunti.php', { action: 'move_items', ids, lesson_date: '2026-11-03' });
    assert.equal(m1.json.done, 1); assert.equal(m1.json.skipped, 3);
    // the representative moves all
    const m2 = await mario.post('/api/appunti.php', { action: 'move_items', ids, lesson_date: '2026-11-04' });
    assert.equal(m2.json.done, 4);
    assert.deepEqual((await items(mario)).filter((i) => i.title.startsWith('bulk')).map((i) => i.lesson_date), ['2026-11-04', '2026-11-04', '2026-11-04', '2026-11-04']);
    assert.equal((await mario.post('/api/appunti.php', { action: 'move_items', ids })).json.code, 'nothing');
    const before = fs.readdirSync(path.join(site.root, 'data/appunti', String(classId))).length;
    assert.equal((await luigi.post('/api/appunti.php', { action: 'delete_items', ids })).json.done, 1);
    assert.equal((await mario.post('/api/appunti.php', { action: 'delete_items', ids })).json.done, 3);
    assert.equal((await items(mario)).filter((i) => i.title.startsWith('bulk')).length, 0);
    assert.equal(fs.readdirSync(path.join(site.root, 'data/appunti', String(classId))).length, before - 4, 'their files are gone too');
    const stranger = new Client(site); await stranger.register('dm_stranger');
    assert.equal((await stranger.post('/api/appunti.php', { action: 'move_items', ids: [all[0].id], lesson_date: '2026-11-05' })).status, 404);
});

test('materials for another AI can be chosen from a first to a last day', async () => {
    for (const [d, t] of [['2026-12-01', 'primo'], ['2026-12-03', 'secondo'], ['2026-12-09', 'terzo']]) {
        assert.equal((await upload(mario, { class_id: classId, subject_id: subj, kind: 'appunti', lesson_date: d, title: t, body: 'testo ' + t }, [])).status, 200);
    }
    const get = async (q) => { const r = await fetch(`${site.base}/api/appunti.php?action=ai_pack&class_id=${classId}&${q}`, { headers: { Cookie: mario.cookieHeader() } }); return { status: r.status, text: await r.text() }; };
    const r = await get(`scope=range&from=2026-12-01&to=2026-12-05&subject_id=${subj}`);
    assert.equal(r.status, 200);
    assert.ok(r.text.includes('testo primo') && r.text.includes('testo secondo') && !r.text.includes('testo terzo'));
    assert.ok(r.text.includes('dal 01/12/2026 al 05/12/2026'));
    assert.equal((await get('scope=range&from=2026-12-05&to=2026-12-01')).status, 400);
    assert.equal((await get('scope=range&from=2027-01-01&to=2027-01-05')).status, 404);
    const handout = await get(`scope=range&from=2026-12-01&to=2026-12-09&dispensa=1`);
    assert.match(handout.text, /PROMPT 1 — dispensa completa/);
    const zip = await fetch(`${site.base}/api/appunti.php?action=zip&class_id=${classId}&scope=range&from=2026-12-01&to=2026-12-09`, { headers: { Cookie: mario.cookieHeader() } });
    assert.equal(zip.status, 200);
});
