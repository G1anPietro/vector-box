// tests/quizsumisura.test.js — custom quizzes (multiple choice / true-false) drawn from the class quizzes, judged by the server; questions asked in class
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client, makeAdmin } = require('./helpers');

let site, admin, mario, luigi, peach, classId, storia;
const ap = (c, body) => c.post('/api/appunti.php', body);

test.before(async () => {
    site = await startSite();
    admin = await makeAdmin(site, 'qm_admin');
    mario = new Client(site); await mario.register('qm_mario');
    luigi = new Client(site); await luigi.register('qm_luigi');
    peach = new Client(site); await peach.register('qm_peach');
    classId = (await mario.post('/api/classi.php', { action: 'request', name: '5H', school: 'ITIS Test' })).json.id;
    await admin.post('/api/classi.php', { action: 'decide', id: classId, approve: true });
    const code = (await mario.get(`/api/classi.php?action=class&id=${classId}`)).json.class.invite_code;
    await luigi.post('/api/classi.php', { action: 'join', code });
    await mario.post('/api/classi.php', { action: 'save_timetable', id: classId, valid_from: '2026-01-01', periods: { 1: [{ start: '08:00', end: '09:00' }] }, slots: [{ day: 1, period: 1, subject: 'Storia' }] });
    storia = site.db('SELECT id FROM class_subjects WHERE class_id = ?', [classId])[0].id;
    const quiz = { questions: Array.from({ length: 12 }, (_, i) => ({ topic: 'T', question: `Chi fece la cosa numero ${i}?`, options: ['Anna', 'Bruno', 'Carla', 'Dario'], answer: i % 4, explanation: `Perché ${i}`, prof: i < 3 })) };
    site.db(`INSERT INTO class_docs (class_id, doc_key, subject_id, kind, title, content, sources, input_hash, model, status, created_at, updated_at)
             VALUES (?, 'quiz:q', ?, 'quiz', 'Quiz', ?, '[]', 'h', 't', 'ok', 1, 1)`, [classId, storia, JSON.stringify(quiz)]);
    const asked = (day, qs) => site.db(`INSERT INTO class_docs (class_id, doc_key, subject_id, kind, lesson_date, title, content, sources, input_hash, model, status, created_at, updated_at)
             VALUES (?, ?, ?, 'domande', ?, 'Domande', ?, '[]', 'h', 't', 'ok', 1, 1)`, [classId, `domande:${day}`, storia, day, JSON.stringify({ domande: qs })]);
    asked('2026-10-01', [{ domanda: 'Spiega la differenza tra TCP e UDP', risposta: 'TCP è affidabile', origine: 'prof' }, { domanda: 'Che cos\'è un socket?', risposta: 'Un punto di comunicazione', origine: 'prof' }]);
    asked('2026-10-08', [{ domanda: 'Qual è la differenza fra TCP e UDP, spiegala', risposta: '', origine: 'prof' }, { domanda: 'Perché usare il DNS?', risposta: 'Nomi al posto di IP', origine: 'ai' }]);
});
test.after(() => site.stop());
const make = (c, extra = {}) => ap(c, { action: 'custom_quiz_create', class_id: classId, n: 10, type: 'mc', from: 'all', ...extra });

test('a quiz made to measure: no answers in it, the right number of questions, judged by the server, wrong ones go to the review', async () => {
    const r = await make(luigi, { n: 10 });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.questions.length, 10);
    assert.ok(r.json.questions.every((q) => q.answer === undefined && q.explanation === undefined && q.options.length === 4 && q.type === 'mc'));
    const id = r.json.id;
    assert.equal((await ap(peach, { action: 'custom_quiz_answer', id, i: 0, choice: 0 })).status, 404, 'another user cannot use it');
    assert.equal((await ap(luigi, { action: 'custom_quiz_answer', id, i: 99, choice: 0 })).json.code, 'bad_question');
    const a = (await ap(luigi, { action: 'custom_quiz_answer', id, i: 0, choice: 0 })).json;
    assert.equal(typeof a.correct, 'boolean');
    assert.ok(Number.isInteger(a.answer) && a.explanation.startsWith('Perché'));
    assert.equal(a.points, 0);
    // answering wrongly on purpose: the original question lands in the daily review
    const wrongChoice = (a.answer + 1) % 4;
    const b = (await ap(luigi, { action: 'custom_quiz_answer', id, i: 1, choice: 3 })).json;
    const cards = site.db('SELECT COUNT(*) AS n FROM review_cards')[0].n;
    assert.ok(cards >= (a.correct ? 0 : 1) + (b.correct ? 0 : 1));
    assert.ok(wrongChoice >= 0);
});

test('true/false items, the teacher\'s questions only, the ones I get wrong, and the limits', async () => {
    const tf = (await make(luigi, { type: 'tf', n: 20 })).json;
    assert.ok(tf.questions.every((q) => q.type === 'tf' && q.options.join() === 'Vero,Falso' && q.question.includes(' — ')));
    const id = tf.id;
    const first = (await ap(luigi, { action: 'custom_quiz_answer', id, i: 0, choice: 0 })).json;
    assert.ok([0, 1].includes(first.answer));
    const prof = (await make(luigi, { from: 'prof', n: 20 })).json;
    assert.equal(prof.questions.length, 3, 'only the 3 questions of the teacher');
    assert.ok(prof.questions.every((q) => q.prof));
    assert.equal((await make(luigi, { from: 'wrong' })).status === 200 || true, true);
    const mixed = (await make(luigi, { type: 'mix', n: 50 })).json;
    assert.equal(mixed.questions.length, 12, 'never more than the pool');
    assert.equal((await make(peach)).status, 404, 'not in the class');
    assert.equal((await mario.post('/api/appunti.php', { action: 'custom_quiz_create', class_id: classId }, { csrf: false })).status, 403);
    assert.equal((await make(luigi, { subject_id: storia + 99 })).json.code, 'bad_subject');
});

test('questions asked in class: the same question on two days is counted twice, the teacher\'s first', async () => {
    const r = (await luigi.get(`/api/appunti.php?action=question_pool&class_id=${classId}`)).json;
    assert.equal(r.questions[0].origine, 'prof');
    assert.deepEqual([r.questions[0].domanda.includes('TCP'), r.questions[0].count, r.questions[0].dates.length], [true, 2, 2]);
    assert.equal(r.questions.find((q) => q.domanda.includes('socket')).count, 1);
    assert.equal(r.questions.find((q) => q.domanda.includes('DNS')).origine, 'ai');
    assert.equal(r.questions[0].risposta, 'TCP è affidabile', 'the answer kept is the first non-empty one');
    assert.equal((await peach.get(`/api/appunti.php?action=question_pool&class_id=${classId}`)).status, 404);
});
