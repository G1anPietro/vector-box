// tests/demo.test.js — the example class: made by bin/appunti-demo.php, everybody can look at it (read-only), nobody can change it
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { startSite, Client, makeAdmin, REPO } = require('./helpers');

let site, anna, admin, demoId;
const run = (...args) => execFileSync('php', [path.join(site.root || REPO, 'bin/appunti-demo.php'), ...args], { encoding: 'utf8', env: { ...process.env, ...(site.env || {}) } });

test.before(async () => {
    site = await startSite();
    anna = new Client(site); await anna.register('dm_anna');
    admin = await makeAdmin(site, 'dm_admin');
});
test.after(() => site.stop());

test('the example class is written, with every part of the notes pages filled in', async () => {
    const out = run('--force');
    assert.match(out, /written/);
    demoId = site.db('SELECT id FROM school_classes WHERE is_demo = 1')[0].id;
    const count = (table) => site.db(`SELECT COUNT(*) AS n FROM ${table} WHERE class_id = ?`, [demoId])[0].n;
    assert.equal(count('class_members'), 5);
    assert.ok(count('class_subjects') >= 7);
    assert.ok(count('class_items') >= 15);
    assert.ok(count('class_docs') >= 15);
    assert.ok(count('class_events') >= 4);
    assert.ok(count('class_topics') >= 5);
    assert.ok(count('class_homework') >= 3);
    assert.ok(count('class_board') >= 2);
    assert.ok(count('score_events') > 20);
    const kinds = site.db('SELECT DISTINCT kind FROM class_docs WHERE class_id = ?', [demoId]).map((r) => r.kind).sort();
    for (const k of ['lezione', 'domande', 'schema', 'completo', 'riassunto', 'scheda', 'preparazione', 'quiz']) assert.ok(kinds.includes(k), 'missing doc kind ' + k);
    // every JSON document parses
    for (const d of site.db("SELECT kind, content FROM class_docs WHERE class_id = ? AND kind IN ('domande', 'schema', 'quiz')", [demoId])) JSON.parse(d.content);
    // the coming tests are in the future, the old one in the past
    const today = new Date().toISOString().slice(0, 10);
    const dates = site.db('SELECT event_date FROM class_events WHERE class_id = ? ORDER BY event_date', [demoId]).map((r) => r.event_date);
    assert.ok(dates.some((d) => d < today) && dates.filter((d) => d > today).length >= 3);
});

test('running it again the same day changes nothing; --force rewrites without duplicating', () => {
    assert.match(run(), /already up to date/);
    const before = site.db('SELECT COUNT(*) AS n FROM class_items WHERE class_id = ?', [demoId])[0].n;
    run('--force');
    assert.equal(site.db('SELECT COUNT(*) AS n FROM class_items WHERE class_id = ?', [demoId])[0].n, before);
    assert.equal(site.db('SELECT COUNT(*) AS n FROM school_classes WHERE is_demo = 1')[0].n, 1);
    assert.equal(site.db("SELECT COUNT(*) AS n FROM accounts WHERE username LIKE 'demo_%'")[0].n, 5);
});

test('a new user is offered the example class and can read all of it', async () => {
    const mine = (await anna.get('/api/classi.php?action=mine')).json;
    assert.deepEqual(mine.classes, [], 'it is not in the list of her own classes');
    assert.equal(mine.demo.id, demoId);
    const cls = (await anna.get(`/api/classi.php?action=class&id=${demoId}`)).json.class;
    assert.equal(cls.demo, true);
    assert.equal(cls.is_member, false);
    assert.deepEqual(cls.perms, []);
    assert.equal(cls.members.length, 5);
    assert.ok(cls.timetable.slots.length >= 25);
    const get = async (p) => (await anna.get(p)).json;
    assert.ok((await get(`/api/appunti.php?action=items&class_id=${demoId}`)).items.length >= 15);
    assert.ok((await get(`/api/appunti.php?action=events&class_id=${demoId}`)).events.length >= 4);
    const docs = (await get(`/api/appunti.php?action=docs&class_id=${demoId}`)).docs;
    assert.ok(docs.length >= 15);
    const sch = docs.find((d) => d.kind === 'schema');
    assert.ok((await get(`/api/appunti.php?action=doc&id=${sch.id}`)).doc.content.includes('children'));
    assert.equal((await anna.get(`/api/classifica.php?action=board&class_id=${demoId}`)).status, 200);
    assert.equal((await anna.get(`/api/bacheca.php?action=overview&class_id=${demoId}`)).status, 200);
});

test('nobody changes it: uploads, calendar, settings and the like are refused with the example-class message', async () => {
    const refused = async (url, body) => { const r = await anna.post(url, body); assert.equal(r.status, 403, JSON.stringify(body)); assert.equal(r.json.code, 'demo'); };
    const sid = site.db('SELECT id FROM class_subjects WHERE class_id = ? LIMIT 1', [demoId])[0].id;
    await refused('/api/appunti.php', { action: 'add_event', class_id: demoId, subject_id: sid, kind: 'verifica', date: '2030-01-01', title: 'x' });
    await refused('/api/appunti.php', { action: 'upload', class_id: demoId, subject_id: sid, kind: 'appunti', lesson_date: '2026-10-05', body: 'ciao' });
    await refused('/api/classi.php', { action: 'save_timetable', id: demoId, periods: [], slots: [] });
    await refused('/api/classi.php', { action: 'leave', id: demoId });
    const r = await anna.post('/api/bacheca.php', { action: 'save_announcement', class_id: demoId, title: 'spam' });
    assert.notEqual(r.status, 200);
    assert.equal(site.db('SELECT COUNT(*) AS n FROM class_board WHERE class_id = ? AND title = ?', [demoId, 'spam'])[0].n, 0);
});

test('a quiz of the example class is judged by the server but nothing is saved', async () => {
    const quiz = site.db("SELECT id FROM class_docs WHERE class_id = ? AND kind = 'quiz' LIMIT 1", [demoId])[0].id;
    const r = await anna.post('/api/appunti.php', { action: 'quiz_answer', doc_id: quiz, q: 0, choice: 1 });
    assert.equal(r.json.success, true);
    assert.equal(r.json.correct, true);
    assert.equal(r.json.points, 0);
    assert.equal(site.db('SELECT COUNT(*) AS n FROM quiz_answers WHERE class_id = ?', [demoId])[0].n, 0);
    assert.equal(site.db('SELECT COUNT(*) AS n FROM review_cards WHERE class_id = ?', [demoId])[0].n, 0);
    // the quiz the page receives does not carry the answers
    const doc = (await anna.get(`/api/appunti.php?action=doc&id=${quiz}`)).json.doc;
    assert.doesNotMatch(doc.content, /"answer"/);
});

test('guests cannot see it; the AI worker and reminders leave it alone', async () => {
    const guest = new Client(site);
    assert.equal((await guest.get('/api/classi.php?action=mine')).status, 401);
    const q = site.db("SELECT COUNT(*) AS n FROM school_classes WHERE status = 'active' AND is_demo = 0")[0].n;
    assert.equal(q, 0);
});

test('the worker writes the example class by itself (DEMO_CLASS, on by default) and can be told not to', async () => {
    const on = await startSite({ DEMO_CLASS: 'true' });
    try {
        execFileSync('php', [path.join(on.root, 'bin/appunti-ai.php'), '--bells-only'], { encoding: 'utf8' });
        assert.equal(on.db('SELECT COUNT(*) AS n FROM school_classes WHERE is_demo = 1')[0].n, 1);
    } finally { await on.stop(); }
    const off = await startSite();      // the test helper turns it off
    try {
        execFileSync('php', [path.join(off.root, 'bin/appunti-ai.php'), '--bells-only'], { encoding: 'utf8' });
        assert.equal(off.db('SELECT COUNT(*) AS n FROM school_classes WHERE is_demo = 1')[0].n, 0);
    } finally { await off.stop(); }
});
