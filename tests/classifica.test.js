// tests/classifica.test.js — scoreboard: the server judges answers, first try only, speed check, privacy and controls
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client, makeAdmin } = require('./helpers');

let site, admin, mario, luigi, toad, peach, classId, storia, docId;
const ap = (c, body) => c.post('/api/appunti.php', body);
const sc = (c, body) => c.post('/api/classifica.php', body);
const board = async (c) => (await c.get(`/api/classifica.php?action=board&class_id=${classId}`)).json;
const ago = (sec) => site.db('UPDATE quiz_answers SET answered_at = answered_at - ?', [sec]) && site.db('UPDATE quiz_seen SET seen_at = seen_at - ?', [sec]);

test.before(async () => {
    site = await startSite();
    admin = await makeAdmin(site, 'sc_admin');
    mario = new Client(site); await mario.register('sc_mario');
    luigi = new Client(site); await luigi.register('sc_luigi');
    toad = new Client(site); await toad.register('sc_toad');
    peach = new Client(site); await peach.register('sc_peach');
    classId = (await mario.post('/api/classi.php', { action: 'request', name: '5F', school: 'ITIS Test' })).json.id;
    await admin.post('/api/classi.php', { action: 'decide', id: classId, approve: true });
    const code = (await mario.get(`/api/classi.php?action=class&id=${classId}`)).json.class.invite_code;
    await luigi.post('/api/classi.php', { action: 'join', code });
    await toad.post('/api/classi.php', { action: 'join', code });
    await mario.post('/api/classi.php', { action: 'save_timetable', id: classId, valid_from: '2026-01-01',
        periods: { 1: [{ start: '08:00', end: '09:00' }] }, slots: [{ day: 1, period: 1, subject: 'Storia' }] });
    storia = site.db('SELECT id FROM class_subjects WHERE class_id = ?', [classId])[0].id;
    const quiz = { questions: [0, 1, 2, 3].map((i) => ({ topic: 'T', question: `Domanda ${i}?`, options: ['a', 'b', 'c', 'd'], answer: 1, explanation: `Perché ${i}` })) };
    const now = Math.floor(Date.now() / 1000);
    site.db(`INSERT INTO class_docs (class_id, doc_key, subject_id, kind, title, content, sources, input_hash, model, status, created_at, updated_at)
             VALUES (?, 'quiz:s', ?, 'quiz', 'Quiz', ?, '[]', 'h', 'test', 'ok', ?, ?)`, [classId, storia, JSON.stringify(quiz), now, now]);
    docId = site.db("SELECT id FROM class_docs WHERE doc_key = 'quiz:s'")[0].id;
});
test.after(() => site.stop());
const answer = (c, q, choice) => ap(c, { action: 'quiz_answer', doc_id: docId, q, choice });
const quizOf = async (c) => JSON.parse((await c.get(`/api/appunti.php?action=doc&id=${docId}`)).json.doc.content);

test('the quiz sent to the page has no answers until a question is answered', async () => {
    const q = await quizOf(luigi);
    assert.ok(q.questions.every((x) => x.answer === undefined && x.explanation === undefined), 'no answer, no explanation');
    ago(60);   // opened a while ago: a real student takes some seconds to read the question
    const r = (await answer(luigi, 0, 1)).json;
    assert.deepEqual([r.correct, r.answer, r.explanation, r.first, r.points], [true, 1, 'Perché 0', true, 10]);
    const after = await quizOf(luigi);
    assert.deepEqual([after.questions[0].answer, after.questions[0].my_choice, after.questions[1].answer], [1, 1, undefined]);
    assert.equal((await quizOf(toad)).questions[0].answer, undefined, 'another student still sees nothing');
});

test('points: first try only, once per question, and not when answering too fast', async () => {
    // q0 was answered a moment ago: an immediate second answer is "too fast" (recorded, no points)
    const fast = (await answer(luigi, 1, 1)).json;
    assert.deepEqual([fast.correct, fast.points, fast.too_fast], [true, 0, true]);
    ago(60);
    const ok = (await answer(luigi, 2, 1)).json;
    assert.deepEqual([ok.points, ok.too_fast], [10, false]);
    // answering the same question again (practice): no new points, still judged
    ago(60);
    const again = (await answer(luigi, 2, 1)).json;
    assert.deepEqual([again.first, again.points], [false, 0]);
    const b = await board(luigi);
    assert.equal(b.mine.total, 20, 'q0 (10) + q2 (10); q1 was too fast');
    // a wrong first answer: no points, it goes to the review
    ago(60);
    const wrong = (await answer(luigi, 3, 0)).json;
    assert.deepEqual([wrong.correct, wrong.points, wrong.state], [false, 0, 'review']);
});

test('review points only for a card that was due, judged from the server copy', async () => {
    const before = (await board(luigi)).mine.total;
    const r0 = (await ap(luigi, { action: 'review_answer', doc_id: docId, q: 3, choice: 1 })).json;
    assert.equal(r0.correct, true);
    assert.equal(r0.points, 0, 'the card was not due yet (it was set for tomorrow)');
    site.db("UPDATE review_cards SET due_date = '2000-01-01'");
    const r1 = (await ap(luigi, { action: 'review_answer', doc_id: docId, q: 3, choice: 1 })).json;
    assert.deepEqual([r1.correct, r1.points], [true, 5]);
    assert.equal((await board(luigi)).mine.total, before + 5);
    assert.equal((await ap(toad, { action: 'review_answer', doc_id: docId, q: 3, choice: 1 })).status, 404, 'not in toad\'s review');
    const rv = (await luigi.get(`/api/appunti.php?action=review&class_id=${classId}`)).json;
    site.db("UPDATE review_cards SET due_date = '2000-01-01'");
    const due = (await luigi.get(`/api/appunti.php?action=review&class_id=${classId}`)).json.due;
    assert.ok(due.length === 0 || due.every((x) => x.answer === undefined && x.explanation === undefined), 'review questions carry no answer');
    assert.ok(rv);
});

test('the table: members only, names, weekly and total; the representative sees the same', async () => {
    assert.equal((await board(peach)).success, false);
    const b = await board(mario);
    assert.equal(b.on, true);
    assert.deepEqual(b.total.map((r) => [r.name, r.points]).slice(0, 1), [['sc_luigi', 25]]);
    assert.equal(b.total.length, 3, 'everybody who takes part, even with zero points');
    assert.equal(b.mine.rank_total, 2);
    assert.equal(b.week[0].name, 'sc_luigi');
});

test('leaving the scoreboard deletes the points and keeps new ones out; the class can restrict who sees the table', async () => {
    assert.equal((await luigi.post('/api/classifica.php', { action: 'set_in', class_id: classId, in: false }, { csrf: false })).status, 403);
    assert.equal((await sc(luigi, { action: 'set_in', class_id: classId, in: false })).json.in, false);
    assert.equal(site.db("SELECT COUNT(*) AS n FROM score_events WHERE user_id = (SELECT id FROM accounts WHERE username = 'sc_luigi')")[0].n, 0);
    const b = await board(toad);
    assert.ok(!b.total.some((r) => r.name === 'sc_luigi'), 'gone from the table');
    // no new points while out
    site.db('UPDATE review_cards SET due_date = ?, box = 0', ['2000-01-01']);
    const r = (await ap(luigi, { action: 'review_answer', doc_id: docId, q: 3, choice: 1 })).json;
    assert.equal(r.points, 0);
    // coming back starts from zero
    await sc(luigi, { action: 'set_in', class_id: classId, in: true });
    assert.equal((await board(luigi)).mine.total, 0);

    // who may change the class settings
    assert.equal((await sc(luigi, { action: 'settings', class_id: classId, on: true, who: 'perm' })).status, 403);
    assert.equal((await sc(mario, { action: 'settings', class_id: classId, on: true, who: 'perm' })).status, 200);
    const t = await board(toad);
    assert.deepEqual([t.can_see, t.total, typeof t.mine.total], [false, [], 'number'], 'a student sees only their own points when the table is reserved');
    const m = await board(mario);
    assert.equal(m.can_see, true);
    // switched off: nothing shown, nothing given
    await sc(mario, { action: 'settings', class_id: classId, on: false, who: 'all' });
    assert.equal((await board(toad)).on, false);
    ago(60);
    const q2 = (await ap(toad, { action: 'quiz_answer', doc_id: docId, q: 0, choice: 1 })).json;
    assert.equal(q2.points, 0);
    assert.equal(site.db('SELECT COUNT(*) AS n FROM score_events WHERE user_id = (SELECT id FROM accounts WHERE username = ?)', ['sc_toad'])[0].n, 0);
});
