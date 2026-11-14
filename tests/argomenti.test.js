// tests/argomenti.test.js — material by date AND topic: each upload under its topic, documents per topic on mixed days, tests follow topics
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const http = require('http');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { startSite, Client, makeAdmin } = require('./helpers');
const run = promisify(execFile);

const calls = [];
const gemini = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
        const body = raw ? JSON.parse(raw) : {};
        calls.push(body);
        const system = body.systemInstruction ? body.systemInstruction.parts[0].text : '';
        let text = 'Appunti uniti [1]';
        if (system.includes('estrai le DOMANDE')) text = JSON.stringify({ domande: [{ domanda: 'Cosa?', risposta: 'Così', origine: 'ai' }] });
        else if (system.includes('SCHEMA (mappa concettuale)')) text = JSON.stringify({ title: 'T', children: [{ label: 'A' }] });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }));
    });
});

let site, admin, mario, luigi, peach, classId, storia;
const ap = (c, body) => c.post('/api/appunti.php', body);
const cal = (c, body) => c.post('/api/calendario.php', body);
async function upload(c, fields) {
    const fd = new FormData(); fd.set('action', 'upload');
    for (const [k, v] of Object.entries(fields)) fd.set(k, String(v));
    return (await fetch(c.site.base + '/api/appunti.php', { method: 'POST', body: fd, headers: { Cookie: c.cookieHeader(), 'X-CSRF-Token': c.csrf } })).json();
}
const items = async (c, q = '') => (await c.get(`/api/appunti.php?action=items&class_id=${classId}${q}`)).json.items;
const topicOf = (id) => site.db('SELECT topic_id, topic_manual FROM class_items WHERE id = ?', [id])[0];
const ymd = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

test.before(async () => {
    await new Promise((r) => gemini.listen(0, '127.0.0.1', r));
    site = await startSite({ GEMINI_API_KEY: 'AQ.test-key-123', GEMINI_BASE_URL: `http://127.0.0.1:${gemini.address().port}/v1beta`, GEMINI_FAST_RPM: 6000, GEMINI_SMART_RPM: 6000, GEMINI_RETRY_WAITS: '0.05', AI_CLASSIFY: 'false' });
    admin = await makeAdmin(site, 'ar_admin');
    mario = new Client(site); await mario.register('ar_mario');
    luigi = new Client(site); await luigi.register('ar_luigi');
    peach = new Client(site); await peach.register('ar_peach');
    classId = (await mario.post('/api/classi.php', { action: 'request', name: '5R', school: 'ITIS Test' })).json.id;
    await admin.post('/api/classi.php', { action: 'decide', id: classId, approve: true });
    const code = (await mario.get(`/api/classi.php?action=class&id=${classId}`)).json.class.invite_code;
    await luigi.post('/api/classi.php', { action: 'join', code });
    await mario.post('/api/classi.php', { action: 'save_timetable', id: classId, valid_from: '2020-01-01', periods: { 1: [{ start: '08:00', end: '09:00' }] }, slots: [{ day: 1, period: 1, subject: 'Storia' }] });
    await mario.post('/api/classi.php', { action: 'settings', id: classId, summary_time: '23:59' });
    site.db("UPDATE school_classes SET ai_last_auto = '2999-01-01'");
    storia = site.db('SELECT id FROM class_subjects WHERE class_id = ?', [classId])[0].id;
});
test.after(async () => { await site.stop(); gemini.close(); });

test('an upload goes under the one topic that covers its day; two topics at once need a choice; a choice sticks', async () => {
    const A = (await cal(mario, { action: 'save_topic', class_id: classId, subject_id: storia, name: 'Rivoluzione francese', start: ymd(-30), end: ymd(-11) })).json.id;
    const B = (await cal(mario, { action: 'save_topic', class_id: classId, subject_id: storia, name: 'Napoleone', start: ymd(-10) })).json.id;
    const a = (await upload(luigi, { class_id: classId, subject_id: storia, kind: 'appunti', lesson_date: ymd(-20), body: 'La presa della Bastiglia' })).id;
    const b = (await upload(luigi, { class_id: classId, subject_id: storia, kind: 'appunti', lesson_date: ymd(-5), body: 'Napoleone console' })).id;
    assert.deepEqual([topicOf(a).topic_id, topicOf(b).topic_id], [A, B]);
    assert.deepEqual((await items(luigi, `&topic_id=${A}`)).map((i) => i.id), [a]);
    assert.deepEqual((await items(luigi, '&topic_id=0')).length, 0, 'nothing is left without a topic');
    assert.equal((await items(luigi)).find((i) => i.id === b).topic_id, B, 'the list says it');
    // a third topic that overlaps B: the days they share are ambiguous
    const C = (await cal(mario, { action: 'save_topic', class_id: classId, subject_id: storia, name: 'Restaurazione', start: ymd(-6) })).json.id;
    assert.equal(topicOf(b).topic_id, null);
    // a person chooses: it sticks even when the topics change
    assert.equal((await ap(luigi, { action: 'edit_item', id: b, subject_id: storia, kind: 'appunti', lesson_date: ymd(-5), title: '', body: 'Napoleone console', topic_id: C })).status, 200);
    assert.deepEqual([topicOf(b).topic_id, topicOf(b).topic_manual], [C, 1]);
    await cal(mario, { action: 'save_topic', class_id: classId, id: B, subject_id: storia, name: 'Napoleone', start: ymd(-10), end: ymd(-9) });
    assert.equal(topicOf(b).topic_id, C);
    // not a topic of this subject / class
    assert.equal((await ap(luigi, { action: 'edit_item', id: b, subject_id: storia, kind: 'appunti', lesson_date: ymd(-5), body: 'x', topic_id: 9999 })).json.code, 'bad_topic');
    // deleting a topic frees its uploads (and they find another one if there is exactly one)
    await cal(mario, { action: 'delete_topic', id: C });
    assert.equal(topicOf(b).topic_id, null);
    const tree = (await luigi.get(`/api/appunti.php?action=tree&class_id=${classId}`)).json.subjects[0];
    assert.deepEqual(tree.topics.map((t) => [t.name, t.items]), [['Rivoluzione francese', 1], ['Napoleone', 0]]);
    assert.equal((await peach.get(`/api/appunti.php?action=items&class_id=${classId}&topic_id=${A}`)).status, 404);
});

test('a day with uploads of two topics gets one document per topic; a one-topic day keeps one document', async () => {
    site.db('DELETE FROM class_topics'); site.db('DELETE FROM class_items'); site.db('DELETE FROM class_docs');
    const A = (await cal(mario, { action: 'save_topic', class_id: classId, subject_id: storia, name: 'Rivoluzione', start: ymd(-30) })).json.id;
    const day = ymd(-3);
    const x = (await upload(luigi, { class_id: classId, subject_id: storia, kind: 'appunti', lesson_date: day, body: 'Prima parte, sulla rivoluzione' })).id;
    const y = (await upload(luigi, { class_id: classId, subject_id: storia, kind: 'appunti', lesson_date: day, body: 'Seconda parte, un altro tema' })).id;
    // one topic on that day: one document, no suffix
    await ap(mario, { action: 'generate', class_id: classId });
    await run('php', [path.join(site.root, 'bin/appunti-ai.php')]);
    let docs = site.db("SELECT doc_key, kind, topic_id FROM class_docs ORDER BY doc_key");
    assert.deepEqual(docs.filter((d) => d.kind === 'lezione').map((d) => d.doc_key), [`lezione:${storia}:${day}`]);
    assert.equal(docs.find((d) => d.kind === 'lezione').topic_id, A, 'the document knows its topic');
    // the second upload is about another topic (chosen by hand)
    const B = (await cal(mario, { action: 'save_topic', class_id: classId, subject_id: storia, name: 'Congresso di Vienna', start: ymd(-30), end: ymd(-1) })).json.id;
    await ap(luigi, { action: 'edit_item', id: y, subject_id: storia, kind: 'appunti', lesson_date: day, body: 'Seconda parte, un altro tema', topic_id: B });
    await ap(luigi, { action: 'edit_item', id: x, subject_id: storia, kind: 'appunti', lesson_date: day, body: 'Prima parte, sulla rivoluzione', topic_id: A });
    site.db('UPDATE school_classes SET ai_requested_at = ?, ai_last_manual = 0', [Math.floor(Date.now() / 1000)]);   // "Genera ora" again (once an hour for people: the test skips the wait)
    calls.length = 0;
    await run('php', [path.join(site.root, 'bin/appunti-ai.php')]);
    docs = site.db("SELECT doc_key, kind, title, topic_id FROM class_docs ORDER BY doc_key");
    const lessons = docs.filter((d) => d.kind === 'lezione').map((d) => d.doc_key).sort();
    assert.deepEqual(lessons, [`lezione:${storia}:${day}:t${A}`, `lezione:${storia}:${day}:t${B}`].sort(), 'the old single document is gone');
    assert.ok(docs.filter((d) => d.kind === 'lezione').every((d) => / — (Rivoluzione|Congresso di Vienna)$/.test(d.title)));
    assert.deepEqual(docs.filter((d) => d.kind === 'domande').map((d) => d.doc_key).sort(), [`domande:${storia}:${day}:t${A}`, `domande:${storia}:${day}:t${B}`].sort());
    assert.deepEqual(docs.filter((d) => d.kind === 'schema').length, 2);
    assert.ok(docs.every((d) => d.topic_id === (d.doc_key.endsWith(`:t${A}`) ? A : B)), 'each document knows its topic');
    // each lesson prompt only has its own material
    const lessonCalls = calls.filter((c) => /APPUNTI COMPLETI/.test(c.systemInstruction.parts[0].text)).map((c) => c.contents[0].parts[0].text);
    assert.equal(lessonCalls.length, 2);
    assert.ok(lessonCalls.some((t) => t.includes('Prima parte') && !t.includes('Seconda parte') && t.includes('Argomento: Rivoluzione')));
    assert.ok(lessonCalls.some((t) => t.includes('Seconda parte') && !t.includes('Prima parte') && t.includes('Argomento: Congresso di Vienna')));
});

test('a test leaves out the uploads of a topic unticked for it, even on a day shared with another topic', async () => {
    const [A, B] = site.db('SELECT id FROM class_topics ORDER BY id').map((t) => t.id);
    const day = ymd(-3);
    const ev = await ap(mario, { action: 'add_event', class_id: classId, subject_id: storia, kind: 'verifica', date: ymd(4), topics_off: [B] });
    assert.equal(ev.status, 200, ev.text);
    const pack = async () => (await fetch(`${site.base}/api/appunti.php?action=ai_pack&class_id=${classId}&scope=event&event_id=${ev.json.id}`, { headers: { Cookie: mario.cookieHeader() } })).text();
    const t = await pack();
    assert.ok(t.includes('Prima parte') && !t.includes('Seconda parte'), 'only the topic that is in the test');
    // the other way round: tick it again and both are there
    await ap(mario, { action: 'edit_event', id: ev.json.id, subject_id: storia, kind: 'verifica', date: ymd(4), topics_off: [] });
    const all = await pack();
    assert.ok(all.includes('Prima parte') && all.includes('Seconda parte'));
    assert.ok(day);
});
