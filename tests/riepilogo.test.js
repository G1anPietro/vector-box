// tests/riepilogo.test.js — the weekly digest: day and hour of the class, once a week, personal turns, per-member switch
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { startSite, Client, makeAdmin } = require('./helpers');
const run = promisify(execFile);

let site, admin, mario, luigi, classId, storia;
const worker = (now) => run('php', [path.join(site.root, 'bin/appunti-ai.php'), '--bells-only', `--now=${now}`]);
const digests = (user) => site.db("SELECT title, body, url FROM notifications WHERE kind = 'riepilogo' AND user_id = (SELECT id FROM accounts WHERE username = ?)", [user]);
// a Sunday at the given Rome hour (winter: UTC+1)
const sunday = (h) => Math.floor(Date.parse(`2030-01-13T${String(h - 1).padStart(2, '0')}:05:00Z`) / 1000);

test.before(async () => {
    site = await startSite();
    admin = await makeAdmin(site, 'rs_admin');
    mario = new Client(site); await mario.register('rs_mario');
    luigi = new Client(site); await luigi.register('rs_luigi');
    classId = (await mario.post('/api/classi.php', { action: 'request', name: '5L', school: 'ITIS Test' })).json.id;
    await admin.post('/api/classi.php', { action: 'decide', id: classId, approve: true });
    const code = (await mario.get(`/api/classi.php?action=class&id=${classId}`)).json.class.invite_code;
    await luigi.post('/api/classi.php', { action: 'join', code });
    await mario.post('/api/classi.php', { action: 'save_timetable', id: classId, valid_from: '2029-01-01', periods: { 1: [{ start: '08:00', end: '09:00' }] }, slots: [{ day: 1, period: 1, subject: 'Storia' }] });
    storia = site.db('SELECT id FROM class_subjects WHERE class_id = ?', [classId])[0].id;
    await mario.post('/api/appunti.php', { action: 'add_event', class_id: classId, subject_id: storia, kind: 'verifica', date: '2030-01-16' });
    await mario.post('/api/calendario.php', { action: 'save_homework', class_id: classId, subject_id: storia, due: '2030-01-17', body: 'Esercizi' });
});
test.after(() => site.stop());

test('default Sunday 19:00: nothing before the hour, one digest at the hour, never twice the same week', async () => {
    assert.deepEqual((await mario.get(`/api/classi.php?action=class&id=${classId}`)).json.class.digest, { on: true, day: 0, hour: 19 });
    await worker(sunday(18));
    assert.equal(digests('rs_luigi').length, 0, 'too early');
    await worker(sunday(19));
    const d = digests('rs_luigi');
    assert.equal(d.length, 1);
    assert.match(d[0].title, /1 verifica, 1 compito/);
    assert.match(d[0].body, /Verifica Storia il 16\/01/);
    await worker(sunday(21));
    assert.equal(digests('rs_luigi').length, 1, 'once a week');
});

test('the class chooses day and hour; a member can switch it off; who is on a turn gets it in the text; nothing coming = no digest', async () => {
    const luigiId = site.db("SELECT id FROM accounts WHERE username = 'rs_luigi'")[0].id;
    await mario.post('/api/calendario.php', { action: 'save_turn_order', class_id: classId, order: [luigiId] });
    site.db("INSERT INTO class_turns (class_id, subject_id, turn_date, user_ids, author_id, created_at) VALUES (?, ?, '2030-01-23', ?, 1, 1)", [classId, storia, JSON.stringify([luigiId])]);
    assert.equal((await luigi.post('/api/classi.php', { action: 'settings', id: classId, summary_time: '18:00', digest_day: 3 })).status, 403);
    assert.equal((await mario.post('/api/classi.php', { action: 'settings', id: classId, summary_time: '18:00', digest_on: true, digest_day: 3, digest_hour: 20 })).status, 200);
    site.db("DELETE FROM notifications");
    site.db("UPDATE school_classes SET settings = '{}'");
    // switched back: Wednesday 2030-01-16 20:10 Rome
    const wed = Math.floor(Date.parse('2030-01-16T19:10:00Z') / 1000);
    await mario.post('/api/notifiche.php', { action: 'save_prefs', class_id: classId, prefs: { promemoria: true, turno: true, annuncio: true, riepilogo: false, slots: ['d2'] } });
    await mario.post('/api/classi.php', { action: 'settings', id: classId, summary_time: '18:00', digest_on: true, digest_day: 3, digest_hour: 20 });
    site.db("UPDATE school_classes SET settings = json_remove(settings, '$.digest_last')");
    // the week after 2030-01-16 holds the homework (17th) and the turn (23rd)
    await worker(wed);
    assert.equal(digests('rs_mario').length, 0, 'mario switched it off');
    const l = digests('rs_luigi');
    assert.equal(l.length, 1);
    assert.match(l[0].body, /Sei interrogato in Storia il 23\/01/);
    // off for the class
    await mario.post('/api/classi.php', { action: 'settings', id: classId, summary_time: '18:00', digest_on: false });
    site.db("DELETE FROM notifications"); site.db("UPDATE school_classes SET settings = json_remove(settings, '$.digest_last')");
    await worker(wed);
    assert.equal(site.db("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'riepilogo'")[0].n, 0);
});
