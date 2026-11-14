// tests/calendario.test.js — topics, homework, days without lessons, oral-exam turns (api/calendario.php)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { startSite, Client, makeAdmin } = require('./helpers');

const run = promisify(execFile);
let site, admin, mario, luigi, peach, classId, storia, mate, ids;
const ca = (c, body) => c.post('/api/calendario.php', body);
const overview = async (c, q = '') => (await c.get(`/api/calendario.php?action=overview&class_id=${classId}${q}`)).json;

test.before(async () => {
    site = await startSite();
    admin = await makeAdmin(site, 'ca_admin');
    mario = new Client(site); await mario.register('ca_mario');
    luigi = new Client(site); await luigi.register('ca_luigi');
    peach = new Client(site); await peach.register('ca_peach');
    classId = (await mario.post('/api/classi.php', { action: 'request', name: '5B-I', school: 'ITIS' })).json.id;
    await admin.post('/api/classi.php', { action: 'decide', id: classId, approve: true });
    const code = (await mario.get(`/api/classi.php?action=class&id=${classId}`)).json.class.invite_code;
    await luigi.post('/api/classi.php', { action: 'join', code });
    // Storia on Monday (1st hour) and Wednesday (1st and 2nd), Matematica on Monday 2nd
    const bells = [{ start: '08:10', end: '09:05' }, { start: '09:05', end: '10:00' }];
    await mario.post('/api/classi.php', { action: 'save_timetable', id: classId, valid_from: '2026-09-01', periods: { 1: bells, 3: bells },
        slots: [{ day: 1, period: 1, subject: 'Storia' }, { day: 1, period: 2, subject: 'Matematica' },
            { day: 3, period: 1, subject: 'Storia' }, { day: 3, period: 2, subject: 'Storia' }] });
    const subs = site.db('SELECT id, name FROM class_subjects WHERE class_id = ?', [classId]);
    storia = subs.find((s) => s.name === 'Storia').id;
    mate = subs.find((s) => s.name === 'Matematica').id;
    ids = Object.fromEntries(site.db("SELECT id, username FROM accounts WHERE username LIKE 'ca_%'").map((a) => [a.username, a.id]));
});
test.after(() => site.stop());

test('migration V17 created the tables; guests, strangers and CSRF', async () => {
    assert.ok(site.db('PRAGMA user_version')[0].user_version >= 17);
    assert.equal(site.db(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('class_topics','class_homework','class_days_off','class_turns','class_board')`)[0].n, 5);
    const guest = await new Client(site).init();
    assert.equal((await guest.get(`/api/calendario.php?action=overview&class_id=${classId}`)).status, 401);
    assert.equal((await peach.get(`/api/calendario.php?action=overview&class_id=${classId}`)).status, 404);
    assert.equal((await mario.post('/api/calendario.php', { action: 'save_homework', class_id: classId }, { csrf: false })).status, 403);
});

test('topics: start and (later) end, by who has the permission', async () => {
    assert.equal((await ca(luigi, { action: 'save_topic', class_id: classId, subject_id: storia, name: 'Napoleone', start: '2026-10-05' })).json.code, 'forbidden');
    assert.equal((await ca(mario, { action: 'save_topic', class_id: classId, subject_id: storia, name: 'X', start: '2026-10-05', end: '2026-10-01' })).json.code, 'bad_dates');
    const t = await ca(mario, { action: 'save_topic', class_id: classId, subject_id: storia, name: 'Napoleone', start: '2026-10-05' });
    assert.equal(t.status, 200, t.text);
    let o = await overview(luigi);
    assert.deepEqual(o.topics.map((x) => [x.name, x.subject, x.start, x.end, x.proposed]), [['Napoleone', 'Storia', '2026-10-05', null, false]]);
    // a proposal of the AI is confirmed (or edited) by who has the permission
    const now = Math.floor(Date.now() / 1000);
    site.db(`INSERT INTO class_topics (class_id, subject_id, name, start_date, status, created_at, updated_at) VALUES (?, ?, 'Restaurazione', '2026-11-02', 'proposed', ?, ?)`, [classId, storia, now, now]);
    o = await overview(mario);
    const prop = o.topics.find((x) => x.proposed);
    assert.equal((await ca(luigi, { action: 'confirm_topic', id: prop.id })).json.code, 'forbidden');
    assert.equal((await ca(mario, { action: 'confirm_topic', id: prop.id })).status, 200);
    assert.equal((await overview(mario)).topics.filter((x) => x.proposed).length, 0);
});

test('a test closes the open topics of its subject; unticked topics are left out of its material', async () => {
    const ap = (c, body) => c.post('/api/appunti.php', body);
    const o = await overview(mario);
    const nap = o.topics.find((x) => x.name === 'Napoleone');
    const rest = o.topics.find((x) => x.name === 'Restaurazione');
    const ev = await ap(luigi, { action: 'add_event', class_id: classId, subject_id: storia, kind: 'verifica', date: '2026-11-18', title: 'Napoleone', topics_off: [rest.id] });
    assert.equal(ev.status, 200, ev.text);
    const after = (await overview(mario)).topics;
    assert.equal(after.find((x) => x.id === nap.id).end, '2026-11-18', 'closed by its test');
    assert.equal(after.find((x) => x.id === rest.id).end, null, 'not in this test: still open');
    const listed = (await luigi.get(`/api/appunti.php?action=events&class_id=${classId}&from=2026-11-01&to=2026-11-30`)).json.events[0];
    assert.deepEqual(listed.topics_off, [rest.id]);
    // Napoleone really ended before Restaurazione began (days in both topics would stay in)
    await ca(mario, { action: 'save_topic', class_id: classId, id: nap.id, subject_id: storia, name: 'Napoleone', start: '2026-10-05', end: '2026-10-30' });
    // the day filter used by the AI: Napoleone's days in, Restaurazione-only days out
    const php = `require '${path.join(site.root, 'public/api/appunti_lib.php')}'; require_once '${path.join(site.root, 'public/api/database.php')}';
        $db = getDbConnection(); $ev = $db->query('SELECT * FROM class_events WHERE id = ${ev.json.id}')->fetch();
        $ok = notesEventDayFilter($db, $ev); echo json_encode([$ok('2026-10-07'), $ok('2026-11-04'), $ok('2026-09-20')]);`;
    const { stdout } = await run('php', ['-r', php]);
    assert.deepEqual(JSON.parse(stdout), [true, false, true], 'Napoleone in, Restaurazione-only out, a day in no topic stays in');
    await ap(luigi, { action: 'delete_event', id: ev.json.id });
});

test('homework: anyone adds, the author or who has the permission changes', async () => {
    assert.equal((await ca(luigi, { action: 'save_homework', class_id: classId, subject_id: mate, due: '2026-11-16', body: '' })).json.code, 'empty');
    const h = await ca(luigi, { action: 'save_homework', class_id: classId, subject_id: mate, due: '2026-11-16', body: 'Es. 12-18 pag. 240' });
    assert.equal(h.status, 200, h.text);
    await luigi.post('/api/classi.php', { action: 'display_name', id: classId, name: 'Luigi Verdi' });
    let o = await overview(mario, '&from=2026-11-01&to=2026-11-30');
    assert.deepEqual(o.homework.map((x) => [x.subject, x.due, x.body, x.author, x.can_edit]), [['Matematica', '2026-11-16', 'Es. 12-18 pag. 240', 'Luigi Verdi', true]]);
    assert.equal((await ca(admin, { action: 'save_homework', class_id: classId, id: h.json.id, subject_id: mate, due: '2026-11-17', body: 'Es. 12-20' })).status, 200);
    assert.equal((await ca(luigi, { action: 'delete_homework', id: h.json.id })).status, 200);
    assert.equal((await overview(mario, '&from=2026-11-01&to=2026-11-30')).homework.length, 0);
});

test('days without lessons: no lessons that day (or that hour), so no next-lesson pushes nor turns', async () => {
    assert.equal((await ca(luigi, { action: 'save_dayoff', class_id: classId, from: '2026-11-16', reason: 'Sciopero' })).json.code, 'forbidden');
    const lessons = async (d) => (await mario.get(`/api/appunti.php?action=lessons&class_id=${classId}&date=${d}`)).json.lessons;
    assert.equal((await lessons('2026-11-16')).length, 2);
    const d = await ca(mario, { action: 'save_dayoff', class_id: classId, from: '2026-11-16', reason: 'Sciopero' });
    assert.equal(d.status, 200, d.text);
    assert.equal((await lessons('2026-11-16')).length, 0);
    // one hour only: the teacher of the 2nd hour is away on Wednesday -> Storia is one hour instead of two
    assert.equal((await ca(mario, { action: 'save_dayoff', class_id: classId, from: '2026-11-18', to: '2026-11-19', period: 2 })).json.code, 'bad_period');
    await ca(mario, { action: 'save_dayoff', class_id: classId, from: '2026-11-18', period: 2, reason: 'Prof assente' });
    const wed = await lessons('2026-11-18');
    assert.deepEqual(wed.map((l) => [l.period, l.period_to]), [[1, 1]]);
    const o = await overview(luigi, '&from=2026-11-01&to=2026-11-30');
    assert.deepEqual(o.days_off.map((x) => [x.from, x.period, x.reason]), [['2026-11-16', null, 'Sciopero'], ['2026-11-18', 2, 'Prof assente']]);
});

test('turns: one class order, put on the next lessons of a subject; days off are skipped; a reminder the day before', async () => {
    assert.equal((await ca(luigi, { action: 'save_turn_order', class_id: classId, order: [ids.ca_luigi] })).json.code, 'forbidden');
    const order = await ca(mario, { action: 'save_turn_order', class_id: classId, order: [ids.ca_luigi, ids.ca_mario, ids.ca_peach, ids.ca_luigi] });
    assert.deepEqual(order.json.order, [ids.ca_luigi, ids.ca_mario], 'members only, once each');
    // from Monday 16 (a strike): one student per lesson -> Wednesday 18, Monday 23
    const made = await ca(mario, { action: 'make_turns', class_id: classId, subject_id: storia, start: '2026-11-16', per_lesson: 1 });
    assert.deepEqual(made.json.dates, ['2026-11-18', '2026-11-23']);
    let o = await overview(luigi, '&from=2026-11-01&to=2026-11-30');
    assert.deepEqual(o.turns.map((t) => [t.date, t.subject, t.user_ids]), [['2026-11-18', 'Storia', [ids.ca_luigi]], ['2026-11-23', 'Storia', [ids.ca_mario]]]);
    assert.deepEqual(o.turn_order, [ids.ca_luigi, ids.ca_mario]);

    // moved by hand
    assert.equal((await ca(mario, { action: 'save_turn', id: o.turns[1].id, date: '2026-11-25', user_ids: [ids.ca_mario, ids.ca_luigi], note: 'Recupero' })).status, 200);
    // the reminder: Tuesday 17 from 16:00 for Wednesday's turn, once
    const rome = (date, hhmm) => Date.parse(`${date}T${hhmm}:00+01:00`) / 1000;
    const worker = (now) => run('php', [path.join(site.root, 'bin/appunti-ai.php'), '--bells-only', `--now=${now}`]);
    await worker(rome('2026-11-17', '15:00'));
    assert.equal(site.db("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'turno'")[0].n, 0);
    await worker(rome('2026-11-17', '16:05'));
    await worker(rome('2026-11-17', '18:00'));
    const n = site.db("SELECT user_id, title FROM notifications WHERE kind = 'turno'");
    assert.deepEqual(n, [{ user_id: ids.ca_luigi, title: 'Domani sei interrogato in Storia' }]);

    assert.equal((await ca(mario, { action: 'clear_turns', class_id: classId, subject_id: storia })).status, 200);
});

test('another class cannot read or change this class\'s topics, homework, days off or turns by their ids', async () => {
    // peach has her own class, where she is the representative (every permission there)
    const other = (await peach.post('/api/classi.php', { action: 'request', name: '4A', school: 'Liceo' })).json.id;
    await admin.post('/api/classi.php', { action: 'decide', id: other, approve: true });
    await peach.post('/api/classi.php', { action: 'save_timetable', id: other, valid_from: '2026-09-01',
        periods: [{ start: '08:00', end: '09:00' }], slots: [{ day: 1, period: 1, subject: 'Arte' }] });
    const arte = site.db('SELECT id FROM class_subjects WHERE class_id = ?', [other])[0].id;

    const topic = site.db('SELECT id, name FROM class_topics WHERE class_id = ? LIMIT 1', [classId])[0];
    const hw = (await ca(luigi, { action: 'save_homework', class_id: classId, subject_id: mate, due: '2026-12-01', body: 'Segreto' })).json.id;
    const off = site.db('SELECT id FROM class_days_off WHERE class_id = ? LIMIT 1', [classId])[0].id;
    const turn = (await ca(mario, { action: 'add_turn', class_id: classId, subject_id: storia, date: '2026-12-02', user_ids: [ids.ca_luigi] })).json.id;

    assert.equal((await peach.get(`/api/calendario.php?action=overview&class_id=${classId}`)).status, 404);
    // by id alone
    for (const body of [{ action: 'delete_topic', id: topic.id }, { action: 'confirm_topic', id: topic.id }, { action: 'delete_homework', id: hw },
        { action: 'delete_dayoff', id: off }, { action: 'delete_turn', id: turn }, { action: 'save_turn', id: turn, date: '2026-12-03', user_ids: [] }]) {
        assert.equal((await ca(peach, body)).status, 404, body.action);
    }
    // through her own class: an id of the other class, a subject of the other class, members of the other class
    assert.equal((await ca(peach, { action: 'save_topic', class_id: other, id: topic.id, subject_id: arte, name: 'Rubato', start: '2026-10-01' })).status, 404);
    assert.equal((await ca(peach, { action: 'save_homework', class_id: other, id: hw, subject_id: arte, due: '2026-12-01', body: 'x' })).status, 404);
    assert.equal((await ca(peach, { action: 'save_topic', class_id: other, subject_id: storia, name: 'X', start: '2026-10-01' })).json.code, 'bad_subject');
    assert.deepEqual((await ca(peach, { action: 'save_turn_order', class_id: other, order: [ids.ca_luigi, ids.ca_mario] })).json.order, [], 'only her own classmates');

    assert.equal(site.db('SELECT name FROM class_topics WHERE id = ?', [topic.id])[0].name, topic.name);
    assert.equal(site.db('SELECT body FROM class_homework WHERE id = ?', [hw])[0].body, 'Segreto');
    assert.equal(site.db('SELECT turn_date FROM class_turns WHERE id = ?', [turn])[0].turn_date, '2026-12-02');
});
