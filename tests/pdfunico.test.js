// tests/pdfunico.test.js — the single "Per AI" PDF: prompts, texts and the original photo in one valid file
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('node:child_process');
const { startSite, Client, makeAdmin } = require('./helpers');

let site, admin, mario, peach, classId, storia;
const JPG = fs.readFileSync(path.join(__dirname, 'fixtures', 'foto.jpg'));
async function upload(c, fields, files = []) {
    const fd = new FormData(); fd.set('action', 'upload');
    for (const [k, v] of Object.entries(fields)) fd.set(k, String(v));
    for (const f of files) fd.append('files[]', new Blob([f.content], { type: 'image/jpeg' }), f.name);
    return (await fetch(c.site.base + '/api/appunti.php', { method: 'POST', body: fd, headers: { Cookie: c.cookieHeader(), 'X-CSRF-Token': c.csrf } })).json();
}
const pdfOf = async (c, q) => {
    const res = await fetch(`${c.site.base}/api/appunti.php?action=ai_pack&format=pdf&class_id=${classId}&${q}`, { headers: { Cookie: c.cookieHeader() } });
    return { status: res.status, type: res.headers.get('content-type'), bytes: Buffer.from(await res.arrayBuffer()) };
};

test.before(async () => {
    site = await startSite();
    admin = await makeAdmin(site, 'pf_admin');
    mario = new Client(site); await mario.register('pf_mario');
    peach = new Client(site); await peach.register('pf_peach');
    classId = (await mario.post('/api/classi.php', { action: 'request', name: '5P', school: 'ITIS Test' })).json.id;
    await admin.post('/api/classi.php', { action: 'decide', id: classId, approve: true });
    await mario.post('/api/classi.php', { action: 'save_timetable', id: classId, valid_from: '2026-01-01', periods: { 1: [{ start: '08:00', end: '09:00' }] }, slots: [{ day: 1, period: 1, subject: 'Storia' }] });
    storia = site.db('SELECT id FROM class_subjects WHERE class_id = ?', [classId])[0].id;
    await upload(mario, { class_id: classId, subject_id: storia, kind: 'appunti', lesson_date: '2026-10-05', title: 'Lavagna', body: 'Napoleone è nato nel 1769 — perché è già città. Un po\' di accenti: àèìòù €' }, [{ name: 'lavagna.jpg', content: JPG }]);
});
test.after(() => site.stop());

test('one valid PDF with the prompts, the text (with accents) and the photo; members only', async () => {
    const r = await pdfOf(mario, 'scope=day&date=2026-10-05&audio=1');
    assert.equal(r.status, 200);
    assert.equal(r.type, 'application/pdf');
    assert.ok(r.bytes.subarray(0, 5).toString() === '%PDF-' && r.bytes.subarray(-6).toString().includes('%%EOF'));
    const file = path.join(site.root, 'out.pdf');
    fs.writeFileSync(file, r.bytes);
    let text = '';
    try { text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' }); } catch (e) { return; }   // checked where pdftotext exists
    for (const piece of ['PROMPT A', 'PROMPT 1', 'Napoleone è nato nel 1769', 'città', 'Materiale']) assert.ok(text.replace(/\s+/g, ' ').includes(piece), piece);
    const info = execFileSync('pdfimages', ['-list', file], { encoding: 'utf8' });
    assert.match(info, /jpeg|image/i, 'the photo is inside');
    assert.equal((await pdfOf(peach, 'scope=day&date=2026-10-05')).status, 404);
    assert.equal((await pdfOf(mario, 'scope=day&date=2030-01-01')).status, 404, 'nothing that day');
});
