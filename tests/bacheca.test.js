// tests/bacheca.test.js — the class board: "now" in the class's local time, announcements and who may write them
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client, makeAdmin } = require('./helpers');

let site, admin, mario, luigi, peach, classId, storia, mate;
const bb = (c, body) => c.post('/api/bacheca.php', body);
const overview = async (c) => c.get(`/api/bacheca.php?action=overview&class_id=${classId}`);

test.before(async () => {
    site = await startSite();
    admin = await makeAdmin(site, 'bb_admin');
    mario = new Client(site); await mario.register('bb_mario');
    luigi = new Client(site); await luigi.register('bb_luigi');
    peach = new Client(site); await peach.register('bb_peach');
    classId = (await mario.post('/api/classi.php', { action: 'request', name: '5B-I', school: 'ITIS' })).json.id;
    await admin.post('/api/classi.php', { action: 'decide', id: classId, approve: true });
    const code = (await mario.get(`/api/classi.php?action=class&id=${classId}`)).json.class.invite_code;
    await luigi.post('/api/classi.php', { action: 'join', code });
    // every weekday: Storia 1st hour (C208), Matematica 2nd hour; bells 08:00-09:00 and 09:00-10:00
    const bells = [{ start: '08:00', end: '09:00' }, { start: '09:00', end: '10:00' }];
    const periods = {}; const slots = [];
    for (let d = 1; d <= 7; d++) {
        periods[d] = bells;
        slots.push({ day: d, period: 1, subject: 'Storia', room: 'C208' }, { day: d, period: 2, subject: 'Matematica' });
    }
    await mario.post('/api/classi.php', { action: 'save_timetable', id: classId, valid_from: '2026-01-01', periods, slots });
    const subs = site.db('SELECT id, name FROM class_subjects WHERE class_id = ?', [classId]);
    storia = subs.find((s) => s.name === 'Storia').id;
    mate = subs.find((s) => s.name === 'Matematica').id;
});
test.after(() => site.stop());

test('overview: members only; lessons of today with rooms, the clock of the class, the next day', async () => {
    const guest = await new Client(site).init();
    assert.equal((await overview(guest)).status, 401);
    assert.equal((await overview(peach)).status, 404, 'not a member');
    const r = (await overview(luigi)).json;
    assert.match(r.now, /^\d\d:\d\d:\d\d$/);
    assert.match(r.today, /^\d{4}-\d\d-\d\d$/);
    assert.deepEqual(r.lessons.map((l) => [l.subject, l.room, l.start, l.end]), [['Storia', 'C208', '08:00', '09:00'], ['Matematica', '', '09:00', '10:00']]);
    assert.equal(r.next_day.lesson.subject, 'Storia');
    assert.ok(r.next_day.date > r.today);
    assert.equal(r.can_post, false);
    assert.equal((await overview(admin)).status, 200, 'the site admin sees every class');
});

test('a day off today empties the lessons and says why', async () => {
    const today = (await overview(mario)).json.today;
    await mario.post('/api/calendario.php', { action: 'save_dayoff', class_id: classId, from: today, reason: 'Sciopero' });
    const r = (await overview(luigi)).json;
    assert.deepEqual([r.lessons.length, r.day_off], [0, 'Sciopero']);
    const id = site.db('SELECT id FROM class_days_off WHERE class_id = ?', [classId])[0].id;
    await mario.post('/api/calendario.php', { action: 'delete_dayoff', id });
    assert.equal((await overview(luigi)).json.day_off, null);
});

test('announcements: the representative or who has the board permission writes; the author or a moderator edits and deletes', async () => {
    assert.equal((await bb(luigi, { action: 'save_announcement', class_id: classId, title: 'Ciao' })).json.code, 'forbidden');
    assert.equal((await bb(mario, { action: 'save_announcement', class_id: classId, title: '   ' })).json.code, 'empty');
    assert.equal((await mario.post('/api/bacheca.php', { action: 'save_announcement', class_id: classId, title: 'x' }, { csrf: false })).status, 403);

    const a = await bb(mario, { action: 'save_announcement', class_id: classId, title: 'Domani si esce alle 12', body: 'Assemblea\n<b>non è HTML</b>', pinned: true });
    assert.equal(a.status, 200, a.text);
    const b = await bb(mario, { action: 'save_announcement', class_id: classId, title: 'Portate il libro', body: '' });
    let list = (await overview(luigi)).json.announcements;
    assert.deepEqual(list.map((x) => [x.title, x.pinned, x.can_edit]), [['Domani si esce alle 12', true, false], ['Portate il libro', false, false]], 'pinned first');
    assert.equal(list[0].body, 'Assemblea\n<b>non è HTML</b>', 'stored as typed (the page shows it as text)');
    assert.equal(list[0].author, 'bb_mario');

    // a role with the permission
    const role = (await mario.post('/api/classi.php', { action: 'save_role', id: classId, name: 'Vice', perms: ['board'] })).json.role_id;
    const luigiId = site.db("SELECT id FROM accounts WHERE username = 'bb_luigi'")[0].id;
    await mario.post('/api/classi.php', { action: 'set_member_access', id: classId, user_id: luigiId, role_id: role, perms: [] });
    assert.equal((await overview(luigi)).json.can_post, true);
    const c = await bb(luigi, { action: 'save_announcement', class_id: classId, title: 'Orario cambiato' });
    assert.equal(c.status, 200);
    // an author edits their own even without the permission; a moderator edits and deletes anyone's
    assert.equal((await bb(luigi, { action: 'save_announcement', class_id: classId, id: a.json.id, title: 'Uscita alle 11', pinned: false })).status, 200);
    assert.equal((await bb(luigi, { action: 'delete_announcement', id: b.json.id })).status, 200);
    await mario.post('/api/classi.php', { action: 'delete_role', id: classId, role_id: role });
    assert.equal((await bb(luigi, { action: 'delete_announcement', id: a.json.id })).json.code, 'forbidden', 'the permission is gone');
    assert.equal((await bb(luigi, { action: 'delete_announcement', id: c.json.id })).status, 200, 'but his own is still his');
    list = (await overview(mario)).json.announcements;
    assert.deepEqual(list.map((x) => x.title), ['Uscita alle 11']);
});

test('another class cannot read, edit or delete this class\'s announcements by id; a notification goes to the others', async () => {
    const id = (await bb(mario, { action: 'save_announcement', class_id: classId, title: 'Riservato', notify: true })).json.id;
    const marioId = site.db("SELECT id FROM accounts WHERE username = 'bb_mario'")[0].id;
    const notes = site.db("SELECT user_id, title FROM notifications WHERE kind = 'annuncio'");
    assert.ok(notes.every((n) => n.user_id !== marioId), 'not to the author');
    assert.ok(notes.some((n) => n.title === 'Riservato'), 'to the classmates');
    const other = (await peach.post('/api/classi.php', { action: 'request', name: '4A', school: 'Liceo' })).json.id;
    await admin.post('/api/classi.php', { action: 'decide', id: other, approve: true });
    assert.equal((await bb(peach, { action: 'delete_announcement', id })).status, 404);
    assert.equal((await bb(peach, { action: 'save_announcement', class_id: other, id, title: 'Rubato' })).status, 404);
    assert.equal((await bb(peach, { action: 'save_announcement', class_id: classId, title: 'Intruso' })).status, 404);
    assert.ok((await overview(luigi)).json.announcements.some((x) => x.title === 'Riservato'));
});
