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
    assert.equal(detail.periods['1'].length, 6, 'default: six lessons Monday-Friday');
    assert.equal(detail.periods['6'].length, 0, 'no lessons on Saturday by default');
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
    assert.equal(detail.periods['5'].length, 3, 'one list = same bell times Monday-Friday');
    assert.equal(detail.periods['6'].length, 0);
});

test('bell times can differ by day (shorter hours on Monday and Thursday)', async () => {
    // The owner's school: Mon/Thu seven ~50-minute lessons, Tue/Wed/Fri six longer ones; dots accepted
    const short = [['08.10', '09.00'], ['09.00', '09.45'], ['09.45', '10.35'], ['10.35', '11.25'],
        ['11.25', '12.15'], ['12.15', '13.00'], ['13.00', '13.50']].map(([start, end]) => ({ start, end }));
    const long = [['08.10', '09.05'], ['09.05', '10.00'], ['10.00', '11.00'], ['11.00', '12.00'],
        ['12.00', '12.55'], ['12.55', '13.50']].map(([start, end]) => ({ start, end }));
    const periods = { 1: short, 2: long, 3: long, 4: short, 5: long };
    const tooLate = await api(mario, {
        action: 'save_timetable', id: classId, periods, valid_from: '2026-09-02',
        slots: [{ day: 2, period: 7, subject: 'Matematica' }],
    });
    assert.equal(tooLate.json.code, 'bad_slots', 'Tuesday has no 7th hour');
    const ok = await api(mario, {
        action: 'save_timetable', id: classId, periods, valid_from: '2026-09-02',
        slots: [{ day: 1, period: 7, subject: 'Matematica', room: 'C208 LIM' }],
    });
    assert.equal(ok.status, 200);
    const p = (await mario.get(`/api/classi.php?action=class&id=${classId}`)).json.class.periods;
    assert.equal(p['1'].length, 7);
    assert.deepEqual(p['1'][6], { start: '13:00', end: '13:50' });
    assert.equal(p['2'].length, 6);
    assert.equal(p['6'].length, 0);

    // a day added by mistake (Saturday) can be removed: saving it empty drops its hours and lessons
    const sat = { ...periods, 6: long.slice(0, 2) };
    await api(mario, { action: 'save_timetable', id: classId, periods: sat, valid_from: '2026-09-02', slots: [{ day: 6, period: 1, subject: 'Matematica' }] });
    assert.equal((await mario.get(`/api/classi.php?action=class&id=${classId}`)).json.class.periods['6'].length, 2);
    await api(mario, { action: 'save_timetable', id: classId, periods: { ...periods, 6: [] }, valid_from: '2026-09-02', slots: [{ day: 1, period: 7, subject: 'Matematica' }] });
    const c = (await mario.get(`/api/classi.php?action=class&id=${classId}`)).json.class;
    assert.equal(c.periods['6'].length, 0);
    assert.ok(!c.timetable.slots.some((x) => x.day === 6), 'no Saturday lessons left');

    // Sunday too, if a class ever needs it
    const sun = await api(mario, { action: 'save_timetable', id: classId, periods: { ...periods, 7: long.slice(0, 1) }, valid_from: '2026-09-02',
        slots: [{ day: 7, period: 1, subject: 'Matematica' }] });
    assert.equal(sun.status, 200, sun.text);
    assert.equal((await mario.get(`/api/classi.php?action=class&id=${classId}`)).json.class.periods['7'].length, 1);
});

test('roles and permissions: made by the representative, given to roles or to single members', async () => {
    const luigiId = site.db("SELECT id FROM accounts WHERE username = 'cl_luigi'")[0].id;
    const peachClient = peach;
    // without permissions luigi cannot touch the timetable nor make roles
    assert.equal((await api(luigi, { action: 'save_role', id: classId, name: 'Staff', perms: ['timetable'] })).json.code, 'not_manager');
    const role = await api(mario, { action: 'save_role', id: classId, name: 'Vice', color: '#ff8800', perms: ['timetable', 'calendar', 'nonsense'] });
    assert.equal(role.status, 200, role.text);
    let d = (await mario.get(`/api/classi.php?action=class&id=${classId}`)).json.class;
    assert.deepEqual(d.roles.map((r) => [r.name, r.color, r.perms]), [['Vice', '#ff8800', ['timetable', 'calendar']]], 'unknown permissions dropped');
    assert.ok(d.perm_labels.timetable);

    // role to luigi + a personal permission
    assert.equal((await api(mario, { action: 'set_member_access', id: classId, user_id: luigiId, role_id: role.json.role_id, perms: ['members'] })).status, 200);
    d = (await luigi.get(`/api/classi.php?action=class&id=${classId}`)).json.class;
    assert.deepEqual(d.perms.sort(), ['calendar', 'members', 'timetable']);
    assert.ok(d.invite_code, 'members permission shows the code');
    assert.equal((await api(luigi, { action: 'settings', id: classId, summary_time: '17:00' })).json.code, 'not_manager', 'no settings permission');
    // nobody but the representative passes the representative role
    assert.equal((await api(luigi, { action: 'set_manager', id: classId, user_id: luigiId })).json.code, 'not_manager');
    // the representative's access cannot be changed
    const marioId = site.db("SELECT id FROM accounts WHERE username = 'cl_mario'")[0].id;
    assert.equal((await api(mario, { action: 'set_member_access', id: classId, user_id: marioId, perms: [] })).json.code, 'is_manager');

    // names in the class, instead of usernames
    assert.equal((await api(luigi, { action: 'display_name', id: classId, name: '  Luigi Verdi  ' })).status, 200);
    assert.equal((await api(luigi, { action: 'display_name', id: classId, user_id: marioId, name: 'Pippo' })).status, 200, 'members permission');
    d = (await mario.get(`/api/classi.php?action=class&id=${classId}`)).json.class;
    assert.deepEqual(d.members.map((m) => [m.username, m.name]), [['cl_luigi', 'Luigi Verdi'], ['cl_mario', 'Pippo']]);
    await api(mario, { action: 'display_name', id: classId, name: '' });

    // deleting a role takes it away from its members
    assert.equal((await api(mario, { action: 'delete_role', id: classId, role_id: role.json.role_id })).status, 200);
    d = (await luigi.get(`/api/classi.php?action=class&id=${classId}`)).json.class;
    assert.deepEqual(d.perms, ['members']);
    await api(mario, { action: 'set_member_access', id: classId, user_id: luigiId, perms: [] });
    assert.equal((await peachClient.get(`/api/classi.php?action=class&id=${classId}`)).status, 404);
});

test('subjects: merge "Lab Informatica" into "Informatica", delete an empty one', async () => {
    const periods = [{ start: '08:00', end: '09:00' }, { start: '09:00', end: '10:00' }, { start: '10:00', end: '11:00' }];
    await api(mario, { action: 'save_timetable', id: classId, valid_from: '2026-09-03', periods,
        slots: [{ day: 1, period: 1, subject: 'Informatica' }, { day: 1, period: 2, subject: 'Lab Informatica' }, { day: 1, period: 3, subject: 'Vuota' }] });
    let d = (await mario.get(`/api/classi.php?action=class&id=${classId}`)).json.class;
    const sid = Object.fromEntries(d.subjects.map((s) => [s.name, s.id]));
    const now = Math.floor(Date.now() / 1000);
    site.db(`INSERT INTO class_items (class_id, subject_id, author_id, kind, lesson_date, title, body, created_at, updated_at)
             VALUES (?, ?, 1, 'appunti', '2026-09-07', 'SQL', 'join', ?, ?)`, [classId, sid['Lab Informatica'], now, now]);
    assert.equal((await api(mario, { action: 'delete_subject', id: classId, subject_id: sid['Lab Informatica'] })).json.code, 'not_empty');
    assert.equal((await api(mario, { action: 'merge_subject', id: classId, subject_id: sid['Lab Informatica'], into: sid['Lab Informatica'] })).json.code, 'bad_target');
    assert.equal((await api(luigi, { action: 'merge_subject', id: classId, subject_id: sid['Lab Informatica'], into: sid.Informatica })).json.code, 'not_manager');
    assert.equal((await api(mario, { action: 'merge_subject', id: classId, subject_id: sid['Lab Informatica'], into: sid.Informatica })).status, 200);
    assert.equal(site.db("SELECT subject_id FROM class_items WHERE title = 'SQL'")[0].subject_id, sid.Informatica);
    assert.equal((await api(mario, { action: 'delete_subject', id: classId, subject_id: sid.Vuota })).status, 200);
    d = (await mario.get(`/api/classi.php?action=class&id=${classId}`)).json.class;
    assert.ok(!d.subjects.some((s) => s.name === 'Lab Informatica' || s.name === 'Vuota'));
    const mon = d.timetable.slots.filter((s) => s.day === 1).map((s) => [s.period, s.subject]);
    assert.deepEqual(mon, [[1, 'Informatica'], [2, 'Informatica']], 'the lab hour is Informatica now, the deleted subject\'s hour is free');
});

test('the site admin sees every class in the selector, even without being a member', async () => {
    const mine = (await admin.get('/api/classi.php?action=mine')).json.classes;
    const c = mine.find((x) => x.id === classId);
    assert.ok(c, 'listed');
    assert.equal(c.is_member, false);
    assert.equal((await luigi.get('/api/classi.php?action=mine')).json.classes.find((x) => x.id === classId).is_member, true);
    assert.equal((await peach.get('/api/classi.php?action=mine')).json.classes.length, 0);
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

test('upload limits: 40 MB / 5 GB by default, the admin changes them site-wide or per class', async () => {
    const cid = site.db("SELECT id FROM school_classes WHERE status = 'active' LIMIT 1")[0].id;
    const limits = async () => (await admin.get(`/api/classi.php?action=class&id=${cid}`)).json.class.limits_mb;
    assert.deepEqual(await limits(), { file: 40, class: 5120 });

    assert.equal((await api(luigi, { action: 'set_limits', file_mb: 10, class_mb: 100 })).status, 403);
    assert.equal((await api(admin, { action: 'set_limits', file_mb: 0, class_mb: 100 })).json.code, 'bad_limit');
    assert.equal((await api(admin, { action: 'set_limits', file_mb: 500, class_mb: 100 })).json.code, 'bad_limit');
    assert.equal((await api(admin, { action: 'set_limits', file_mb: 30 })).json.code, 'bad_limit', 'site-wide needs both');

    assert.equal((await api(admin, { action: 'set_limits', file_mb: 30, class_mb: 2048 })).status, 200);
    assert.deepEqual(await limits(), { file: 30, class: 2048 });
    assert.equal((await api(admin, { action: 'set_limits', id: cid, file_mb: 50, class_mb: '' })).status, 200);
    assert.deepEqual(await limits(), { file: 50, class: 2048 }, 'class override + site default');
    const all = (await admin.get('/api/classi.php?action=all')).json;
    assert.deepEqual(all.default_limits_mb, { file: 30, class: 2048 });
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
