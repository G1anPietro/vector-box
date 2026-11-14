// tests/registro.test.js — the class change log: who deleted or changed what, for who manages the settings
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client, makeAdmin } = require('./helpers');

let site, admin, mario, luigi, peach, classId, storia;
const log = async (c) => (await c.get(`/api/classi.php?action=log&id=${classId}`));

test.before(async () => {
    site = await startSite();
    admin = await makeAdmin(site, 'lg_admin');
    mario = new Client(site); await mario.register('lg_mario');
    luigi = new Client(site); await luigi.register('lg_luigi');
    peach = new Client(site); await peach.register('lg_peach');
    classId = (await mario.post('/api/classi.php', { action: 'request', name: '5N', school: 'ITIS Test' })).json.id;
    await admin.post('/api/classi.php', { action: 'decide', id: classId, approve: true });
    const code = (await mario.get(`/api/classi.php?action=class&id=${classId}`)).json.class.invite_code;
    await luigi.post('/api/classi.php', { action: 'join', code });
    await mario.post('/api/classi.php', { action: 'save_timetable', id: classId, valid_from: '2026-01-01', periods: { 1: [{ start: '08:00', end: '09:00' }] }, slots: [{ day: 1, period: 1, subject: 'Storia' }] });
    storia = site.db('SELECT id FROM class_subjects WHERE class_id = ?', [classId])[0].id;
});
test.after(() => site.stop());

test('changes are written with who did them; only who manages the settings reads the log', async () => {
    const role = (await mario.post('/api/classi.php', { action: 'save_role', id: classId, name: 'Vice', perms: ['board'] })).json.role_id;
    await mario.post('/api/classi.php', { action: 'regen_code', id: classId });
    await mario.post('/api/classi.php', { action: 'delete_role', id: classId, role_id: role });
    const fd = new FormData(); fd.set('action', 'upload'); fd.set('class_id', classId); fd.set('subject_id', storia); fd.set('kind', 'appunti'); fd.set('lesson_date', '2026-10-05'); fd.set('title', 'Da cancellare'); fd.set('body', 'testo');
    const up = await (await fetch(site.base + '/api/appunti.php', { method: 'POST', body: fd, headers: { Cookie: luigi.cookieHeader(), 'X-CSRF-Token': luigi.csrf } })).json();
    await luigi.post('/api/appunti.php', { action: 'delete_item', id: up.id });
    const r = (await log(mario)).json.log;
    const actions = r.map((x) => x.action);
    for (const a of ['Orario salvato', 'Ruolo salvato', 'Nuovo codice d\'invito', 'Ruolo eliminato', 'Appunti eliminati']) assert.ok(actions.includes(a), a);
    const del = r.find((x) => x.action === 'Appunti eliminati');
    assert.deepEqual([del.who, del.detail.includes('Da cancellare')], ['lg_luigi', true]);
    assert.ok(r[0].at >= r[r.length - 1].at, 'newest first');
    assert.equal((await log(luigi)).status, 403, 'a plain member cannot read it');
    assert.equal((await log(peach)).status, 404);
    assert.equal((await log(admin)).status, 200);
});
