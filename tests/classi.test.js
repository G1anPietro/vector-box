// tests/classi.test.js — school classes for the shared notes: requests, approval, invite codes, timetable
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client, makeAdmin } = require('./helpers');

let site, admin, mario, luigi, peach;
const api = (c, body) => c.post('/api/classi.php', body);
let classId, code;

test.before(async () => {
    site = await startSite();
    admin = await makeAdmin(site, 'cl_admin');
    mario = new Client(site); await mario.register('cl_mario');
    luigi = new Client(site); await luigi.register('cl_luigi');
    peach = new Client(site); await peach.register('cl_peach');
});
test.after(() => site.stop());

test('migration V12 created the tables', () => {
    assert.ok(site.db('PRAGMA user_version')[0].user_version >= 12);
    const n = site.db(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN
        ('app_settings','school_classes','class_members','class_subjects','class_timetables')`)[0].n;
    assert.equal(n, 5);
});

test('guests are refused; CSRF is required', async () => {
    const guest = await new Client(site).init();
    assert.equal((await guest.get('/api/classi.php?action=mine')).status, 401);
    const r = await mario.post('/api/classi.php', { action: 'request', name: '5B', school: 'ITIS' }, { csrf: false });
    assert.equal(r.status, 403);
});

test('a request waits for the admin; others cannot decide it', async () => {
    assert.equal((await api(mario, { action: 'request', name: '', school: 'ITIS' })).json.code, 'bad_name');
    const r = await api(mario, { action: 'request', name: '5B-I', school: 'ITIS Test', note: 'la mia classe' });
    assert.equal(r.status, 200);
    classId = r.json.id;
    const mine = (await mario.get('/api/classi.php?action=mine')).json;
    assert.equal(mine.classes.length, 0);
    assert.deepEqual(mine.requests.map((x) => x.status), ['pending']);

    assert.equal((await api(mario, { action: 'decide', id: classId, approve: true })).status, 403);
    assert.equal((await mario.get('/api/classi.php?action=requests')).status, 403);
    // a pending class cannot be opened or joined yet
    assert.equal((await mario.get(`/api/classi.php?action=class&id=${classId}`)).status, 404);
});

test('the admin approves: the requester becomes manager and gets an invite code', async () => {
    const list = (await admin.get('/api/classi.php?action=requests')).json;
    assert.equal(list.classes.length, 1);
    assert.equal(list.classes[0].manager, 'cl_mario');
    assert.equal(list.classes[0].note, 'la mia classe');

    assert.equal((await api(admin, { action: 'decide', id: classId, approve: true })).json.status, 'active');
    assert.equal((await api(admin, { action: 'decide', id: classId, approve: false })).status, 409);

    const detail = (await mario.get(`/api/classi.php?action=class&id=${classId}`)).json.class;
    assert.equal(detail.is_manager, true);
    assert.match(detail.invite_code, /^[A-HJ-NP-Z2-9]{8}$/);
    assert.equal(detail.summary_time, '18:00');
    assert.equal(detail.periods.length, 6);
    code = detail.invite_code;
});

test('the admin can reject a request', async () => {
    const r = await api(peach, { action: 'request', name: '3A', school: 'Liceo' });
    assert.equal((await api(admin, { action: 'decide', id: r.json.id, approve: false })).json.status, 'rejected');
    const mine = (await peach.get('/api/classi.php?action=mine')).json;
    assert.deepEqual(mine.requests.map((x) => x.status), ['rejected']);
    assert.equal(mine.classes.length, 0);
});

test('the admin can close and reopen new requests', async () => {
    assert.equal((await api(peach, { action: 'set_requests_open', open: false })).status, 403);
    assert.equal((await api(admin, { action: 'set_requests_open', open: false })).json.requests_open, false);
    assert.equal((await peach.get('/api/classi.php?action=mine')).json.requests_open, false);
    assert.equal((await api(peach, { action: 'request', name: '4C', school: 'Liceo' })).json.code, 'requests_closed');
    await api(admin, { action: 'set_requests_open', open: true });
    assert.equal((await api(peach, { action: 'request', name: '4C', school: 'Liceo' })).status, 200);
});

test('classmates join with the code; non-members see nothing', async () => {
    assert.equal((await api(luigi, { action: 'join', code: 'WRONG123' })).json.code, 'bad_code');
    const j = await api(luigi, { action: 'join', code: code.toLowerCase().replace(/(....)/, '$1-') });
    assert.equal(j.status, 200, 'code is case-insensitive and ignores dashes');
    assert.equal(j.json.id, classId);

    const detail = (await luigi.get(`/api/classi.php?action=class&id=${classId}`)).json.class;
    assert.equal(detail.is_manager, false);
    assert.equal(detail.invite_code, null, 'only the manager sees the code');
    assert.deepEqual(detail.members.map((m) => m.username), ['cl_luigi', 'cl_mario']);

    assert.equal((await peach.get(`/api/classi.php?action=class&id=${classId}`)).status, 404);
    assert.equal((await admin.get(`/api/classi.php?action=class&id=${classId}`)).status, 200, 'admin sees every class');
});

test('only the manager edits the class; settings are validated', async () => {
    assert.equal((await api(luigi, { action: 'settings', id: classId, summary_time: '17:00' })).json.code, 'not_manager');
    assert.equal((await api(mario, { action: 'settings', id: classId, summary_time: '25:00' })).json.code, 'bad_time');
    assert.equal((await api(mario, { action: 'settings', id: classId, summary_time: '17:30', timezone: 'Mars/Base' })).json.code, 'bad_timezone');
    assert.equal((await api(mario, { action: 'settings', id: classId, summary_time: '17:30' })).status, 200);
    assert.equal((await mario.get(`/api/classi.php?action=class&id=${classId}`)).json.class.summary_time, '17:30');
});

test('timetable: bell times, subjects and versions by date', async () => {
    const periods = [
        { start: '08:00', end: '09:00' }, { start: '09:00', end: '10:00' }, { start: '10:00', end: '11:00' },
    ];
    const bad = await api(mario, { action: 'save_timetable', id: classId, periods: [{ start: '09:00', end: '08:00' }], slots: [] });
    assert.equal(bad.json.code, 'bad_periods');
    const clash = await api(mario, {
        action: 'save_timetable', id: classId, periods,
        slots: [{ day: 1, period: 1, subject: 'TPSIT' }, { day: 1, period: 1, subject: 'Storia' }],
    });
    assert.equal(clash.json.code, 'bad_slots');
    const outOfRange = await api(mario, { action: 'save_timetable', id: classId, periods, slots: [{ day: 1, period: 4, subject: 'TPSIT' }] });
    assert.equal(outOfRange.json.code, 'bad_slots');

    const ok = await api(mario, {
        action: 'save_timetable', id: classId, periods, valid_from: '2026-09-01',
        slots: [
            { day: 1, period: 1, subject: 'TPSIT', label: 'Lab TPSIT', room: 'C239 INF2' },
            { day: 1, period: 2, subject: 'TPSIT', label: 'Lab TPSIT', room: 'C239 INF2' },
            { day: 2, period: 1, subject: 'Storia', room: 'D402' },
        ],
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.valid_from, '2026-09-01');
    // a later version (orario definitivo) in the future does not replace today's one yet
    await api(mario, { action: 'save_timetable', id: classId, periods, valid_from: '2999-01-01', slots: [{ day: 3, period: 1, subject: 'Inglese' }] });

    const detail = (await luigi.get(`/api/classi.php?action=class&id=${classId}`)).json.class;
    assert.deepEqual(detail.subjects.map((s) => s.name), ['Inglese', 'Storia', 'TPSIT']);
    assert.equal(detail.timetable.valid_from, '2026-09-01');
    assert.deepEqual(detail.timetable.slots.map((s) => s.subject), ['TPSIT', 'TPSIT', 'Storia']);
    assert.equal(detail.timetable.slots[0].label, 'Lab TPSIT');
    assert.deepEqual(detail.timetable_versions, ['2999-01-01', '2026-09-01']);
    assert.equal(detail.periods.length, 3);
});

test('manager: new code, transfer, remove; members can leave', async () => {
    const regen = await api(mario, { action: 'regen_code', id: classId });
    assert.notEqual(regen.json.invite_code, code);
    assert.equal((await api(peach, { action: 'join', code })).json.code, 'bad_code', 'the old code stops working');

    assert.equal((await api(mario, { action: 'leave', id: classId })).json.code, 'manager_cannot_leave');
    assert.equal((await api(mario, { action: 'set_manager', id: classId, user_id: 999 })).json.code, 'not_member');
    const luigiId = site.db("SELECT id FROM accounts WHERE username = 'cl_luigi'")[0].id;
    const marioId = site.db("SELECT id FROM accounts WHERE username = 'cl_mario'")[0].id;
    assert.equal((await api(mario, { action: 'set_manager', id: classId, user_id: luigiId })).status, 200);
    assert.equal((await api(mario, { action: 'regen_code', id: classId })).json.code, 'not_manager');
    assert.equal((await api(luigi, { action: 'remove_member', id: classId, user_id: luigiId })).json.code, 'is_manager');
    assert.equal((await api(luigi, { action: 'remove_member', id: classId, user_id: marioId })).status, 200);
    assert.equal((await mario.get(`/api/classi.php?action=class&id=${classId}`)).status, 404);
});

test('joining is rate limited against code guessing', async () => {
    const c = new Client(site); await c.register('cl_guesser');
    let last;
    for (let i = 0; i < 11; i++) last = await api(c, { action: 'join', code: `NOPE${i}XYZ` });
    assert.equal(last.status, 429);
});

test('the admin deletes a class with everything in it', async () => {
    assert.equal((await api(luigi, { action: 'delete_class', id: classId })).status, 403);
    assert.equal((await api(admin, { action: 'delete_class', id: classId })).status, 200);
    for (const t of ['school_classes', 'class_members', 'class_subjects', 'class_timetables']) {
        const col = t === 'school_classes' ? 'id' : 'class_id';
        assert.equal(site.db(`SELECT COUNT(*) AS n FROM ${t} WHERE ${col} = ?`, [classId])[0].n, 0, t);
    }
});
