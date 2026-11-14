// tests/mancanti.test.js — "appunti mancanti": lessons held with nothing uploaded, within chosen dates, subjects and single lessons left out
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client, makeAdmin } = require('./helpers');

let site, admin, mario, luigi, peach, classId, storia, mate;
const bb = (c, body) => c.post('/api/bacheca.php', body);
const missing = async (c) => (await c.get(`/api/bacheca.php?action=overview&class_id=${classId}`)).json;
const ymd = (d) => d.toISOString().slice(0, 10);
const ago = (n) => ymd(new Date(Date.now() - n * 86400000));

test.before(async () => {
    site = await startSite();
    admin = await makeAdmin(site, 'ms_admin');
    mario = new Client(site); await mario.register('ms_mario');
    luigi = new Client(site); await luigi.register('ms_luigi');
    peach = new Client(site); await peach.register('ms_peach');
    classId = (await mario.post('/api/classi.php', { action: 'request', name: '5M', school: 'ITIS Test' })).json.id;
    await admin.post('/api/classi.php', { action: 'decide', id: classId, approve: true });
    const code = (await mario.get(`/api/classi.php?action=class&id=${classId}`)).json.class.invite_code;
    await luigi.post('/api/classi.php', { action: 'join', code });
    // every day of the week: Storia and Matematica
    const bells = [{ start: '08:00', end: '09:00' }, { start: '09:00', end: '10:00' }];
    const periods = {}; const slots = [];
    for (let d = 1; d <= 6; d++) { periods[d] = bells; slots.push({ day: d, period: 1, subject: 'Storia' }, { day: d, period: 2, subject: 'Matematica' }); }
    await mario.post('/api/classi.php', { action: 'save_timetable', id: classId, valid_from: '2020-01-01', periods, slots });
    const subs = site.db('SELECT id, name FROM class_subjects WHERE class_id = ?', [classId]);
    storia = subs.find((s) => s.name === 'Storia').id; mate = subs.find((s) => s.name === 'Matematica').id;
});
test.after(() => site.stop());
const settings = (c, extra) => c.post('/api/classi.php', { action: 'settings', id: classId, summary_time: '18:00', ...extra });

test('off by default; on from a date: held lessons with nothing uploaded are listed, newest first, subject by subject', async () => {
    assert.deepEqual((await missing(luigi)).missing, []);
    assert.equal((await settings(luigi, { missing_on: true })).status, 403, 'only who manages settings');
    assert.equal((await settings(mario, { missing_on: true, missing_from: ago(3) })).status, 200);
    const m = (await missing(luigi)).missing;
    // 3 past days (yesterday and the two before), minus Sundays (no lessons); two subjects each
    const days = [...new Set(m.map((x) => x.date))];
    assert.ok(days.length >= 2 && days.length <= 3);
    assert.ok(m.every((x) => x.date < ymd(new Date(Date.now() + 86400000)) && ['Storia', 'Matematica'].includes(x.subject)));
    assert.ok(m[0].date >= m[m.length - 1].date, 'newest first');
});

test('an upload for that subject and day removes it; a subject can be left out; one lesson can be marked not needed', async () => {
    let m = (await missing(luigi)).missing;
    const first = m[0];
    const fd = new FormData(); fd.set('action', 'upload'); fd.set('class_id', classId); fd.set('subject_id', first.subject_id); fd.set('kind', 'appunti'); fd.set('lesson_date', first.date); fd.set('body', 'ecco gli appunti');
    await fetch(site.base + '/api/appunti.php', { method: 'POST', body: fd, headers: { Cookie: luigi.cookieHeader(), 'X-CSRF-Token': luigi.csrf } });
    m = (await missing(luigi)).missing;
    assert.ok(!m.some((x) => x.date === first.date && x.subject_id === first.subject_id));
    await settings(mario, { missing_on: true, missing_subjects_off: [mate] });
    m = (await missing(luigi)).missing;
    assert.ok(m.length && m.every((x) => x.subject_id === storia), JSON.stringify([m, storia, mate]));
    const target = m[0];
    assert.equal((await bb(peach, { action: 'skip_missing', class_id: classId, date: target.date, subject_id: target.subject_id })).status, 404);
    assert.equal((await bb(luigi, { action: 'skip_missing', class_id: classId, date: target.date, subject_id: target.subject_id })).status, 403, 'a plain member cannot');
    assert.equal((await bb(mario, { action: 'skip_missing', class_id: classId, date: target.date, subject_id: target.subject_id })).status, 200);
    assert.ok(!(await missing(luigi)).missing.some((x) => x.date === target.date));
    // "to" cuts the range; a day off removes the lessons
    await settings(mario, { missing_on: true, missing_to: ago(2) });
    assert.ok((await missing(luigi)).missing.every((x) => x.date <= ago(2)));
    await settings(mario, { missing_on: false });
    assert.deepEqual((await missing(luigi)).missing, []);
});
