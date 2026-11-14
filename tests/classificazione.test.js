// tests/classificazione.test.js — the AI reads new uploads: reports (never changes by itself), "let the AI decide", topic and test proposals
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
let answer = {};
const gemini = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
        const body = raw ? JSON.parse(raw) : {};
        calls.push(body);
        const user = body.contents[0].parts.map((p) => p.text || '').join(' ');
        const key = Object.keys(answer).find((k) => user.includes(k));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(key ? answer[key] : { tipo: 'appunti', materia: '', data: '', argomento: '', sicuro: false, verifica: null }) }] }, finishReason: 'STOP' }] }));
    });
});

let site, admin, mario, luigi, peach, classId, storia, mate;
const ap = (c, body) => c.post('/api/appunti.php', body);
const board = async (c) => (await c.get(`/api/bacheca.php?action=overview&class_id=${classId}`)).json;
async function upload(c, fields) {
    const fd = new FormData(); fd.set('action', 'upload');
    for (const [k, v] of Object.entries(fields)) fd.set(k, String(v));
    return (await fetch(c.site.base + '/api/appunti.php', { method: 'POST', body: fd, headers: { Cookie: c.cookieHeader(), 'X-CSRF-Token': c.csrf } })).json();
}
const worker = () => run('php', [path.join(site.root, 'bin/appunti-ai.php')]);
const ymd = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

test.before(async () => {
    await new Promise((r) => gemini.listen(0, '127.0.0.1', r));
    site = await startSite({ GEMINI_API_KEY: 'AQ.test-key-123', GEMINI_BASE_URL: `http://127.0.0.1:${gemini.address().port}/v1beta`, GEMINI_FAST_RPM: 6000, GEMINI_SMART_RPM: 6000, GEMINI_RETRY_WAITS: '0.05' });
    admin = await makeAdmin(site, 'cl_admin');
    mario = new Client(site); await mario.register('cl_mario');
    luigi = new Client(site); await luigi.register('cl_luigi');
    peach = new Client(site); await peach.register('cl_peach');
    classId = (await mario.post('/api/classi.php', { action: 'request', name: '5Q', school: 'ITIS Test' })).json.id;
    await admin.post('/api/classi.php', { action: 'decide', id: classId, approve: true });
    const code = (await mario.get(`/api/classi.php?action=class&id=${classId}`)).json.class.invite_code;
    await luigi.post('/api/classi.php', { action: 'join', code });
    await mario.post('/api/classi.php', { action: 'save_timetable', id: classId, valid_from: '2020-01-01', periods: { 1: [{ start: '08:00', end: '09:00' }, { start: '09:00', end: '10:00' }], 2: [{ start: '08:00', end: '09:00' }, { start: '09:00', end: '10:00' }] },
        slots: [{ day: 1, period: 1, subject: 'Storia' }, { day: 1, period: 2, subject: 'Matematica' }, { day: 2, period: 1, subject: 'Storia' }, { day: 2, period: 2, subject: 'Matematica' }] });
    await mario.post('/api/classi.php', { action: 'settings', id: classId, summary_time: '23:59' });
    site.db("UPDATE school_classes SET ai_last_auto = '2999-01-01'");
    const subs = site.db('SELECT id, name FROM class_subjects WHERE class_id = ?', [classId]);
    storia = subs.find((s) => s.name === 'Storia').id; mate = subs.find((s) => s.name === 'Matematica').id;
});
test.after(async () => { await site.stop(); gemini.close(); });

test('a doubtful upload becomes a report for the uploader and the representative: nothing changes by itself; accepting applies it', async () => {
    answer = { 'Il Congresso di Vienna': { tipo: 'slide', materia: 'Matematica', data: '', argomento: 'Restaurazione', sicuro: true, verifica: null } };
    const up = await upload(luigi, { class_id: classId, subject_id: storia, kind: 'appunti', lesson_date: ymd(-2), body: 'Il Congresso di Vienna del 1815 ridisegnò i confini dell\'Europa dopo Napoleone' });
    assert.equal(up.success, true);
    calls.length = 0;
    await worker();
    assert.ok(calls.length >= 1, 'the AI read it');
    const item = () => site.db('SELECT kind, subject_id, ai_state FROM class_items WHERE id = ?', [up.id])[0];
    assert.deepEqual(item(), { kind: 'appunti', subject_id: storia, ai_state: 'done' }, 'nothing was changed by the AI');
    const forMario = (await board(mario)).reports;
    const forLuigi = (await board(luigi)).reports;
    assert.deepEqual(forMario.map((r) => r.data.field).sort(), ['kind', 'subject']);
    assert.equal(forLuigi.length, 2, 'the uploader sees them too');
    assert.equal((await board(peach)).success, false);
    assert.ok(site.db("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'segnalazione'")[0].n >= 2);
    // checked once: a second run does not ask again
    calls.length = 0;
    await worker();
    assert.equal(calls.length, 0);
    // accept the subject suggestion; dismiss the other
    const rs = forMario.find((r) => r.data.field === 'subject'), rk = forMario.find((r) => r.data.field === 'kind');
    const stranger = new Client(site); // not logged in
    assert.equal((await stranger.post('/api/bacheca.php', { action: 'resolve_report', id: rs.id, accept: true })).status, 401);
    assert.equal((await mario.post('/api/bacheca.php', { action: 'resolve_report', id: rs.id, accept: true })).status, 200);
    assert.equal((await luigi.post('/api/bacheca.php', { action: 'resolve_report', id: rk.id, accept: false })).status, 200);
    assert.deepEqual(item(), { kind: 'appunti', subject_id: mate, ai_state: 'done' });
    assert.equal((await board(mario)).reports.length, 0);
    assert.equal((await mario.post('/api/bacheca.php', { action: 'resolve_report', id: rs.id, accept: true })).status, 404, 'already settled');
});

test('"let the AI decide": the type is filled in; a topic is proposed; an announced test becomes a proposal for the calendar', async () => {
    const day = ymd(14);
    answer = { 'verifica di storia': { tipo: 'prova', materia: 'Storia', data: '', argomento: 'Il Risorgimento', sicuro: true, verifica: { tipo: 'verifica', materia: 'Storia', data: day } } };
    const up = await upload(luigi, { class_id: classId, subject_id: storia, kind: 'auto', lesson_date: ymd(-1), body: `Il prof ha detto: ci sarà la verifica di storia il giorno ${day}, sul Risorgimento` });
    await worker();
    assert.equal(site.db('SELECT kind FROM class_items WHERE id = ?', [up.id])[0].kind, 'prova');
    const topics = site.db("SELECT name, status FROM class_topics WHERE class_id = ?", [classId]);
    assert.ok(topics.some((t) => t.name === 'Restaurazione' && t.status === 'proposed'), 'the first upload proposed a topic');
    assert.ok(!topics.some((t) => t.name === 'Il Risorgimento'), 'a topic already covers that day: no second proposal');
    const reports = (await board(mario)).reports;
    const prop = reports.find((r) => r.kind === 'proposta_verifica');
    assert.ok(prop && prop.data.date === day);
    assert.equal((await board(luigi)).reports.some((r) => r.kind === 'proposta_verifica'), false, 'the uploader does not see calendar proposals');
    assert.equal((await luigi.post('/api/bacheca.php', { action: 'resolve_report', id: prop.id, accept: true })).status, 403);
    assert.equal((await mario.post('/api/bacheca.php', { action: 'resolve_report', id: prop.id, accept: true })).status, 200);
    assert.equal(site.db('SELECT COUNT(*) AS n FROM class_events WHERE event_date = ?', [day])[0].n, 1);
});

test('when the choice matches, or the AI is not sure, there is no report; short texts are not sent', async () => {
    answer = { 'Equazioni di secondo grado': { tipo: 'appunti', materia: 'Matematica', data: '', argomento: '', sicuro: true, verifica: null },
        'Qualcosa di vago': { tipo: 'libro', materia: 'Storia', data: '', argomento: '', sicuro: false, verifica: null } };
    await upload(luigi, { class_id: classId, subject_id: mate, kind: 'appunti', lesson_date: ymd(-1), body: 'Equazioni di secondo grado: la formula risolutiva con il discriminante, esempi svolti' });
    await upload(luigi, { class_id: classId, subject_id: mate, kind: 'appunti', lesson_date: ymd(-1), body: 'Qualcosa di vago scritto in fretta durante la lezione, senza titolo né argomento chiaro' });
    await upload(luigi, { class_id: classId, subject_id: mate, kind: 'appunti', lesson_date: ymd(-1), body: 'ok' });
    const before = (await board(mario)).reports.length;
    calls.length = 0;
    await worker();
    assert.equal(calls.length, 2, 'the three-letter note was not sent');
    assert.equal((await board(mario)).reports.length, before);
});

test('the AI sees the topics the class already wrote down, and an upload goes under the one it names (no duplicate proposal)', async () => {
    const t = Math.floor(Date.now() / 1000);
    const old = site.db("INSERT INTO class_topics (class_id, subject_id, name, start_date, end_date, status, created_at, updated_at) VALUES (?, ?, 'Unità d''Italia', '2020-01-01', '2020-02-01', 'ok', ?, ?) RETURNING id", [classId, storia, t, t])[0].id;
    answer = { 'moti del Quarantotto': { tipo: 'appunti', materia: 'Storia', data: '', argomento: 'Unità d\'Italia', sicuro: false, verifica: null } };
    calls.length = 0;
    const up = await upload(luigi, { class_id: classId, subject_id: storia, kind: 'appunti', lesson_date: ymd(-2), body: 'Appunti sui moti del Quarantotto, le cinque giornate di Milano e la prima guerra d\'indipendenza' });
    await worker();
    const sent = calls.map((c) => c.systemInstruction && c.systemInstruction.parts[0].text).filter((x) => x && x.includes('ARGOMENTI GIÀ SVOLTI'));
    assert.ok(sent.some((x) => x.includes('Unità d\'Italia')), 'the prompt lists the topics already done');
    const it = site.db('SELECT topic_id, topic_manual FROM class_items WHERE id = ?', [up.id])[0];
    assert.equal(it.topic_id, old);
    assert.equal(it.topic_manual, 1);
    assert.equal(site.db("SELECT COUNT(*) AS n FROM class_topics WHERE class_id = ? AND name = 'Unità d''Italia'", [classId])[0].n, 1, 'no new proposal with the same name');
});
