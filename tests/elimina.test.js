// tests/elimina.test.js — deleting single files and AI documents: only who has the permission (or the author), by id, within the class
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client, makeAdmin } = require('./helpers');

let site, admin, mario, luigi, peach, classId, storia;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const ap = (c, body) => c.post('/api/appunti.php', body);

async function upload(c, fields, files) {
    const fd = new FormData(); fd.set('action', 'upload');
    for (const [k, v] of Object.entries(fields)) fd.set(k, String(v));
    for (const f of files) fd.append('files[]', new Blob([f.content], { type: 'image/png' }), f.name);
    const res = await fetch(c.site.base + '/api/appunti.php', { method: 'POST', body: fd, headers: { Cookie: c.cookieHeader(), 'X-CSRF-Token': c.csrf } });
    return { status: res.status, json: await res.json() };
}
const items = async (c) => (await c.get(`/api/appunti.php?action=items&class_id=${classId}`)).json.items;

test.before(async () => {
    site = await startSite();
    admin = await makeAdmin(site, 'el_admin');
    mario = new Client(site); await mario.register('el_mario');
    luigi = new Client(site); await luigi.register('el_luigi');
    peach = new Client(site); await peach.register('el_peach');
    classId = (await mario.post('/api/classi.php', { action: 'request', name: '5D', school: 'ITIS' })).json.id;
    await admin.post('/api/classi.php', { action: 'decide', id: classId, approve: true });
    const code = (await mario.get(`/api/classi.php?action=class&id=${classId}`)).json.class.invite_code;
    await luigi.post('/api/classi.php', { action: 'join', code });
    await mario.post('/api/classi.php', { action: 'save_timetable', id: classId, valid_from: '2026-01-01',
        periods: { 1: [{ start: '08:00', end: '09:00' }] }, slots: [{ day: 1, period: 1, subject: 'Storia' }] });
    storia = site.db('SELECT id FROM class_subjects WHERE class_id = ?', [classId])[0].id;
});
test.after(() => site.stop());

test('one file of an item: the author or who has the material permission; the empty item goes away', async () => {
    const up = await upload(mario, { class_id: classId, subject_id: storia, kind: 'appunti', lesson_date: '2026-10-05' },
        [{ name: 'a.png', content: PNG }, { name: 'b.png', content: PNG }]);
    assert.equal(up.status, 200);
    let it = (await items(luigi))[0];
    assert.deepEqual(it.files.map((f) => f.can_delete), [false, false], 'a classmate cannot');
    assert.equal((await ap(luigi, { action: 'delete_file', id: it.files[0].id })).status, 403);
    assert.equal((await ap(peach, { action: 'delete_file', id: it.files[0].id })).status, 404, 'another class sees nothing');
    assert.equal((await mario.post('/api/appunti.php', { action: 'delete_file', id: it.files[0].id }, { csrf: false })).status, 403);
    it = (await items(mario))[0];
    assert.equal(it.files[0].can_delete, true);
    assert.equal((await ap(mario, { action: 'delete_file', id: it.files[0].id })).status, 200);
    it = (await items(mario))[0];
    assert.equal(it.files.length, 1);
    assert.equal((await ap(mario, { action: 'delete_file', id: it.files[0].id })).status, 200);
    assert.equal((await items(mario)).length, 0, 'no file and no text: the item is gone');
});

test('AI documents: only who has the docs permission, and their review cards go with them', async () => {
    const now = 1;
    site.db(`INSERT INTO class_docs (class_id, doc_key, subject_id, kind, title, content, sources, input_hash, model, status, created_at, updated_at)
             VALUES (?, 'schema:x', ?, 'schema', 'Schema di prova', '{}', '[]', 'h', 'test', 'ok', ?, ?)`, [classId, storia, now, now]);
    const id = site.db("SELECT id FROM class_docs WHERE doc_key = 'schema:x'")[0].id;
    const docs = async (c) => (await c.get(`/api/appunti.php?action=docs&class_id=${classId}`)).json.docs;
    assert.equal((await docs(luigi))[0].can_delete, false);
    assert.equal((await docs(mario))[0].can_delete, true);
    assert.equal((await ap(luigi, { action: 'delete_doc', id })).status, 403);
    assert.equal((await ap(peach, { action: 'delete_doc', id })).status, 404);
    const role = (await mario.post('/api/classi.php', { action: 'save_role', id: classId, name: 'Archivista', perms: ['docs'] })).json.role_id;
    const luigiId = site.db("SELECT id FROM accounts WHERE username = 'el_luigi'")[0].id;
    await mario.post('/api/classi.php', { action: 'set_member_access', id: classId, user_id: luigiId, role_id: role, perms: [] });
    assert.equal((await ap(luigi, { action: 'delete_doc', id })).status, 200);
    assert.equal((await docs(mario)).length, 0);
});

test('the "Per AI" file can include the optional audio prompt', async () => {
    const r = await upload(mario, { class_id: classId, subject_id: storia, kind: 'appunti', lesson_date: '2026-10-06', body: 'Napoleone nasce nel 1769' }, []);
    assert.equal(r.status, 200);
    const q = (extra) => `/api/appunti.php?action=ai_pack&class_id=${classId}&scope=day&date=2026-10-06${extra}`;
    const plain = await mario.get(q(''));
    assert.ok(plain.text.includes('PROMPT 1') && !plain.text.includes('PROMPT A'));
    const withAudio = await mario.get(q('&audio=1'));
    assert.ok(withAudio.text.includes('PROMPT A') && withAudio.text.includes('registrazione di una lezione'));
    assert.ok(withAudio.text.indexOf('## PROMPT A') < withAudio.text.indexOf('## PROMPT 1'), 'the audio prompt comes first');
});

test('the text to give another AI for each document, as shown in the upload page; members only', async () => {
    const get = (c, kind) => c.get(`/api/appunti.php?action=ai_prompt&kind=${kind}`);
    for (const kind of ['completo', 'riassunto', 'preparazione', 'quiz', 'schema', 'lezione', 'audio']) {
        const r = (await get(mario, kind)).json;
        assert.equal(r.success, true, kind);
        assert.ok(r.prompt.length > 80, kind);
    }
    assert.match((await get(mario, 'completo')).json.prompt, /nella sezione "Materiale" di questo file/);
    assert.match((await get(mario, 'quiz')).json.note, /JSON/);
    assert.equal((await get(mario, 'riassunto')).json.prompt.startsWith('Dalla dispensa che hai appena scritto'), true);
    assert.equal((await get(mario, 'boh')).json.code, 'bad_kind');
    assert.equal((await new Client(site).get('/api/appunti.php?action=ai_prompt&kind=quiz')).status, 401);
});
