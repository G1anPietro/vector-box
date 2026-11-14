// tests/ricerca.test.js — full-text search (FTS5): typed notes, file text, study documents; kept in sync by triggers; class-private
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client, makeAdmin } = require('./helpers');

let site, admin, mario, peach, classId, other, storia;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const ap = (c, body) => c.post('/api/appunti.php', body);
const find = async (c, q, cls = classId, extra = '') => (await c.get(`/api/appunti.php?action=search&class_id=${cls}&q=${encodeURIComponent(q)}${extra}`)).json;
async function upload(c, fields, files = []) {
    const fd = new FormData(); fd.set('action', 'upload');
    for (const [k, v] of Object.entries(fields)) fd.set(k, String(v));
    for (const f of files) fd.append('files[]', new Blob([f.content], { type: 'image/png' }), f.name);
    const res = await fetch(c.site.base + '/api/appunti.php', { method: 'POST', body: fd, headers: { Cookie: c.cookieHeader(), 'X-CSRF-Token': c.csrf } });
    return res.json();
}

test.before(async () => {
    site = await startSite();
    admin = await makeAdmin(site, 'rc_admin');
    mario = new Client(site); await mario.register('rc_mario');
    peach = new Client(site); await peach.register('rc_peach');
    classId = (await mario.post('/api/classi.php', { action: 'request', name: '5G', school: 'ITIS Test' })).json.id;
    other = (await peach.post('/api/classi.php', { action: 'request', name: '4G', school: 'Liceo Test' })).json.id;
    for (const id of [classId, other]) await admin.post('/api/classi.php', { action: 'decide', id, approve: true });
    for (const [c, id] of [[mario, classId], [peach, other]]) {
        await c.post('/api/classi.php', { action: 'save_timetable', id, valid_from: '2026-01-01', periods: { 1: [{ start: '08:00', end: '09:00' }] }, slots: [{ day: 1, period: 1, subject: 'Storia' }] });
    }
    storia = site.db('SELECT id FROM class_subjects WHERE class_id = ?', [classId])[0].id;
});
test.after(() => site.stop());

test('typed notes are found (accents and word starts), with a snippet, and stay in step with edits and deletes', async () => {
    const up = await upload(mario, { class_id: classId, subject_id: storia, kind: 'appunti', lesson_date: '2026-10-05', title: 'Rivoluzione', body: 'La città di Parigi insorge nel 1789 e comincia la rivoluzione francese' });
    assert.equal(up.success, true);
    let r = await find(mario, 'citta parigi');
    assert.equal(r.results.length, 1);
    assert.match(r.results[0].snippet, /\[\[/);
    assert.deepEqual([r.results[0].kind, r.results[0].subject, r.results[0].lesson_date], ['item', 'Storia', '2026-10-05']);
    assert.equal((await find(mario, 'rivoluz')).results.length, 1, 'beginning of a word');
    assert.equal((await find(mario, 'napoleone')).results.length, 0);
    await ap(mario, { action: 'edit_item', id: up.id, subject_id: storia, kind: 'appunti', lesson_date: '2026-10-05', title: 'Rivoluzione', body: 'Napoleone prende il potere nel 1799' });
    assert.equal((await find(mario, 'napoleone')).results.length, 1);
    assert.equal((await find(mario, 'parigi')).results.length, 0, 'the old text is gone');
    await ap(mario, { action: 'delete_item', id: up.id });
    assert.equal((await find(mario, 'napoleone')).results.length, 0);
});

test('file text and study documents are searched too; the subject filter works', async () => {
    const up = await upload(mario, { class_id: classId, subject_id: storia, kind: 'appunti', lesson_date: '2026-10-06' }, [{ name: 'quaderno.png', content: PNG }]);
    const fid = site.db('SELECT id FROM class_item_files')[0].id;
    site.db("UPDATE class_item_files SET text = 'trascrizione: il Congresso di Vienna del 1815', text_status = 'done' WHERE id = ?", [fid]);
    let r = await find(mario, 'congresso vienna');
    assert.equal(r.results[0].kind, 'file');
    assert.equal(r.results[0].file.name, 'quaderno.png');
    const now = 1;
    site.db(`INSERT INTO class_docs (class_id, doc_key, subject_id, kind, lesson_date, title, content, sources, input_hash, model, status, created_at, updated_at)
             VALUES (?, 'lezione:x', ?, 'lezione', '2026-10-06', 'Storia — lezione', 'Il Risorgimento italiano e i moti del 1848', '[]', 'h', 't', 'ok', ?, ?)`, [classId, storia, now, now]);
    r = await find(mario, 'risorgimento');
    assert.deepEqual([r.results[0].kind, r.results[0].doc_kind], ['doc', 'lezione']);
    assert.equal((await find(mario, 'risorgimento', classId, `&subject_id=${storia + 99}`)).results.length, 0);
    assert.equal((await find(mario, 'risorgimento', classId, `&subject_id=${storia}`)).results.length, 1);
    // a quiz (JSON) is not in the index
    site.db(`INSERT INTO class_docs (class_id, doc_key, subject_id, kind, title, content, sources, input_hash, model, status, created_at, updated_at)
             VALUES (?, 'quiz:x', ?, 'quiz', 'Quiz', '{"questions":[{"question":"zebrazebra"}]}', '[]', 'h', 't', 'ok', ?, ?)`, [classId, storia, now, now]);
    assert.equal((await find(mario, 'zebrazebra')).results.length, 0);
});

test('another class cannot search this one; empty or odd queries are harmless', async () => {
    assert.equal((await find(peach, 'risorgimento', classId)).success, false);
    assert.equal((await find(peach, 'risorgimento', other)).results.length, 0);
    for (const q of ['', 'a', '"*()', 'AND OR NOT', "'; DROP TABLE x; --", 'è']) {
        const r = await find(mario, q);
        assert.equal(r.success, true, q);
    }
    assert.equal((await mario.get(`/api/appunti.php?action=search&class_id=${classId}&q=x`, {})).status !== 500, true);
});
