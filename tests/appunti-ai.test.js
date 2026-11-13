// tests/appunti-ai.test.js — AI worker for the class notes, against a FAKE Gemini server (no real requests)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { startSite, Client, makeAdmin } = require('./helpers');

const run = promisify(execFile);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

// Fake Gemini: records every call, answers by looking at the system prompt
const calls = [];
let mode = 'ok';
const gemini = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
        const body = raw ? JSON.parse(raw) : {};
        calls.push({ url: req.url, headers: req.headers, body });
        if (mode === 'quota') { res.writeHead(429, { 'Content-Type': 'application/json' }); res.end('{"error":{"message":"quota"}}'); return; }
        if (mode === 'hang_smart' && req.url.includes('gemini-3.8-flash:')) return;   // never answers
        if (mode === 'busy' || (mode === 'busy_smart' && req.url.includes('gemini-3.8-flash:'))) {
            res.writeHead(503, { 'Content-Type': 'application/json' }); res.end('{"error":{"message":"high demand"}}'); return;
        }
        if (mode === 'down') { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"error":{"message":"API key not valid"}}'); return; }
        const system = body.systemInstruction ? body.systemInstruction.parts[0].text : '';
        const user = body.contents ? body.contents[0].parts.filter((p) => p.text).map((p) => p.text).join(' ') : '';
        const quiz = { questions: [0, 1, 2, 3].map((i) => ({ topic: 'Napoleone', question: `Domanda ${i}?`, options: ['a', 'b', 'c', 'd'], answer: i, explanation: 'perché sì' })) };
        let text;
        if (system.includes('estrai le DOMANDE')) {
            text = JSON.stringify({ domande: [{ domanda: 'Dove nasce Napoleone?', risposta: 'Ad Ajaccio', origine: 'prof', fonte: '[1]' },
                { domanda: 'Che cosa fu il Consolato?', risposta: '', origine: 'ai' }] });
        } else if (system.includes('SCHEMA (mappa concettuale)')) {
            text = JSON.stringify({ title: 'Napoleone', children: [{ label: 'Vita', note: 'nasce nel 1769', children: [{ label: 'Corsica' }] }, { label: 'Campagne' }] });
        } else if (system.includes('orario scolastico')) {
            text = mode === 'badjson' ? 'non lo so' : JSON.stringify({
                periods: { 1: [['08.10', '09.00'], ['09.00', '09.45'], ['09.45', '10.35']].map(([start, end]) => ({ start, end })) },
                slots: [
                    { day: 1, period: 1, subject: 'TPSIT', label: 'Lab TPSIT', room: 'C239 INF2' },
                    { day: 1, period: 2, subject: 'TPSIT', label: 'Lab TPSIT', room: 'C239 INF2' },
                    { day: 1, period: 2, subject: 'Doppione', label: '', room: '' },
                    { day: 1, period: 3, subject: 'Storia', label: 'Storia', room: 'D402' },
                    { day: 5, period: 3, subject: 'Matematica', label: '', room: 'D402' },
                    { day: 9, period: 1, subject: 'Inesistente' },
                ],
                notes: 'la quinta ora del venerdì non si legge bene',
            });
        } else if (system.includes('trascrittore')) text = `TRASCRITTO ${user.replace('Trascrivi questo file: ', '')}`;
        else if (system.includes('DISPENSA COMPLETA')) text = '## Argomenti\n- Napoleone\n## Napoleone\nTutto quanto [L1]';
        else if (system.includes('RIASSUNTO')) text = '## Napoleone\n- in breve';
        else if (system.includes('PREPARAZIONE MIRATA')) text = '## Domande probabili\n1. Chi era Napoleone?';
        else if (system.includes('quiz')) text = mode === 'badquiz' ? 'non è json' : '```json\n' + JSON.stringify(quiz) + '\n```';
        else text = `## Lezione unita\nTutto il materiale [1][2]\n## Possibili domande all'interrogazione\n1. Chi era Napoleone?`;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }));
    });
});

let site, admin, mario, luigi, peach, classId, storia, envBase;
const ap = (c, body) => c.post('/api/appunti.php', body);

async function upload(c, fields, files = []) {
    const fd = new FormData();
    fd.set('action', 'upload');
    for (const [k, v] of Object.entries(fields)) fd.set(k, String(v));
    for (const f of files) fd.append('files[]', new Blob([f.content], { type: f.type }), f.name);
    const r = await fetch(c.site.base + '/api/appunti.php', { method: 'POST', body: fd, headers: { Cookie: c.cookieHeader(), 'X-CSRF-Token': c.csrf } });
    return r.json();
}
/** Runs the worker once (async: the fake server lives in this process). */
async function worker(...args) {
    const { stdout } = await run('php', [path.join(site.root, 'bin/appunti-ai.php'), ...args]);
    return stdout;
}
function setEnv(extra = {}) {
    const all = { ...envBase, ...extra };
    fs.writeFileSync(path.join(site.root, '.env'), Object.entries(all).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
}

test.before(async () => {
    await new Promise((r) => gemini.listen(0, '127.0.0.1', r));
    envBase = {
        GEMINI_API_KEY: 'AQ.test-key-123',
        GEMINI_BASE_URL: `http://127.0.0.1:${gemini.address().port}/v1beta`,
        GEMINI_FAST_RPM: 6000, GEMINI_SMART_RPM: 6000, GEMINI_RETRY_WAITS: '0.05,0.05',
    };
    site = await startSite(envBase);
    admin = await makeAdmin(site, 'ai_admin');
    mario = new Client(site); await mario.register('ai_mario');
    luigi = new Client(site); await luigi.register('ai_luigi');
    peach = new Client(site); await peach.register('ai_peach');
    classId = (await mario.post('/api/classi.php', { action: 'request', name: '5B-I', school: 'ITIS' })).json.id;
    await admin.post('/api/classi.php', { action: 'decide', id: classId, approve: true });
    const code = (await mario.get(`/api/classi.php?action=class&id=${classId}`)).json.class.invite_code;
    await luigi.post('/api/classi.php', { action: 'join', code });
    await mario.post('/api/classi.php', { action: 'save_timetable', id: classId, valid_from: '2026-09-01',
        periods: [{ start: '08:10', end: '09:05' }], slots: [{ day: 2, period: 1, subject: 'Storia' }] });
    // the daily run is far away: only "Genera ora" triggers documents in these tests
    await mario.post('/api/classi.php', { action: 'settings', id: classId, summary_time: '23:59' });
    site.db("UPDATE school_classes SET ai_last_auto = '2999-01-01' WHERE id = ?", [classId]);
    storia = site.db('SELECT id FROM class_subjects WHERE class_id = ?', [classId])[0].id;
});
test.after(async () => { await site.stop(); gemini.close(); });

test('photos are transcribed once; the key goes in a header, never in the URL', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await upload(luigi, { class_id: classId, subject_id: storia, kind: 'appunti', lesson_date: today, body: 'Napoleone nasce nel 1769' },
        [{ name: 'lavagna.png', content: PNG, type: 'image/png' }]);
    await upload(mario, { class_id: classId, subject_id: storia, kind: 'slide', lesson_date: today, title: 'Slide' },
        [{ name: 'slide.txt', content: Buffer.from('Campagna d\'Italia'), type: 'text/plain' }]);
    calls.length = 0;
    await worker();
    assert.equal(calls.length, 1, 'only the photo needs the AI (the text file was read on upload)');
    const c = calls[0];
    assert.match(c.url, /^\/v1beta\/models\/gemini-3\.5-flash-lite:generateContent$/);
    assert.equal(c.headers['x-goog-api-key'], 'AQ.test-key-123');
    assert.doesNotMatch(c.url, /key=/);
    assert.equal(c.body.contents[0].parts[0].inlineData.mimeType, 'image/png');
    const f = site.db("SELECT text, text_status FROM class_item_files WHERE original_name = 'lavagna.png'")[0];
    assert.deepEqual(f, { text: 'TRASCRITTO lavagna.png', text_status: 'done' });

    calls.length = 0;
    await worker();
    assert.equal(calls.length, 0, 'not transcribed twice, and no documents before their time');
});

test('"Genera ora": once an hour per class, members only', async () => {
    assert.equal((await ap(peach, { action: 'generate', class_id: classId })).status, 404);
    const r = await ap(luigi, { action: 'generate', class_id: classId });
    assert.equal(r.status, 200);
    const again = await ap(mario, { action: 'generate', class_id: classId });
    assert.equal(again.status, 429);
    assert.equal(again.json.code, 'too_soon');
    const docs = (await luigi.get(`/api/appunti.php?action=docs&class_id=${classId}`)).json;
    assert.equal(docs.ai.requested, true);
    assert.equal(docs.ai.configured, true);
});

test('the worker writes one document per lesson, with numbered sources', async () => {
    calls.length = 0;
    await worker();
    assert.equal(calls.length, 3, 'the questions, the lesson document, then its schema');
    const lessonCall = calls.find((c) => /APPUNTI COMPLETI/.test(c.body.systemInstruction.parts[0].text));
    assert.match(lessonCall.body.systemInstruction.parts[0].text, /NON mettere domande/);
    const prompt = lessonCall.body.contents[0].parts[0].text;
    assert.match(prompt, /<materiale>[\s\S]*\[1\] Appunti di ai_luigi[\s\S]*Napoleone nasce nel 1769[\s\S]*TRASCRITTO lavagna\.png[\s\S]*\[2\] Slide\/materiale del prof di ai_mario[\s\S]*Campagna d'Italia[\s\S]*<\/materiale>/);

    const list = (await luigi.get(`/api/appunti.php?action=docs&class_id=${classId}`)).json;
    assert.equal(list.ai.requested, false, 'the request was served');
    const qDoc = list.docs.find((d) => d.kind === 'domande');
    assert.ok(qDoc, 'the questions have their own document');
    const qs = JSON.parse((await luigi.get(`/api/appunti.php?action=doc&id=${qDoc.id}`)).json.doc.content).domande;
    assert.deepEqual(qs.map((q) => q.origine), ['prof', 'ai'], 'the teacher\'s questions first');
    const t = (await luigi.get(`/api/appunti.php?action=tree&class_id=${classId}`)).json;
    assert.equal(t.subjects[0].cats.domande_ai, 1, 'counted in the archive\'s Domande folder');
    list.docs = list.docs.filter((d) => d.kind === 'lezione');
    assert.equal(list.docs.length, 1);
    assert.equal(list.docs[0].kind, 'lezione');
    assert.match(list.docs[0].title, /^Storia — lezione del /);
    const doc = (await luigi.get(`/api/appunti.php?action=doc&id=${list.docs[0].id}`)).json.doc;
    assert.match(doc.content, /Possibili domande/);
    assert.deepEqual(doc.sources.map((s) => [s.n, s.author, s.kind]), [[1, 'ai_luigi', 'appunti'], [2, 'ai_mario', 'slide']]);
    assert.equal((await peach.get(`/api/appunti.php?action=doc&id=${doc.id}`)).status, 404);
});

test('an old lesson uploaded today is summarised too; the Study tab tells what the last run did', async () => {
    await upload(luigi, { class_id: classId, subject_id: storia, kind: 'appunti', lesson_date: '2026-10-08', body: 'Recuperati gli appunti di ottobre' });
    site.db('UPDATE school_classes SET ai_requested_at = 1 WHERE id = ?', [classId]);
    calls.length = 0;
    await worker();
    assert.equal(calls.filter((c) => /APPUNTI COMPLETI/.test(c.body.systemInstruction.parts[0].text)).length, 1);
    assert.equal(site.db("SELECT COUNT(*) AS n FROM class_docs WHERE doc_key = ?", [`lezione:${storia}:2026-10-08`])[0].n, 1);
    const ai = (await luigi.get(`/api/appunti.php?action=docs&class_id=${classId}`)).json.ai;
    assert.equal(ai.last_run.manual, true);
    assert.equal(ai.last_run.lessons, 3, 'the old lesson, its questions and its schema');
    assert.equal(ai.last_run.stop, '');

    // nothing new: the last run says 0 documents
    site.db('UPDATE school_classes SET ai_requested_at = 1 WHERE id = ?', [classId]);
    await worker();
    const again = (await luigi.get(`/api/appunti.php?action=docs&class_id=${classId}`)).json.ai.last_run;
    assert.equal(again.lessons + again.tests, 0);
});

test('a document is rewritten only when its material changes', async () => {
    site.db('UPDATE school_classes SET ai_requested_at = 1 WHERE id = ?', [classId]);
    calls.length = 0;
    await worker();
    assert.equal(calls.length, 0, 'same material: no request');

    const item = site.db("SELECT * FROM class_items WHERE kind = 'appunti'")[0];
    await ap(luigi, { action: 'edit_item', id: item.id, subject_id: storia, kind: 'appunti', lesson_date: item.lesson_date, title: '', body: 'Napoleone nasce ad Ajaccio nel 1769' });
    site.db('UPDATE school_classes SET ai_requested_at = 1 WHERE id = ?', [classId]);
    await worker();
    assert.equal(calls.length, 2, 'questions and lesson rewritten; the schema only if the lesson text changed (the fake answers the same)');
    assert.match(calls[0].body.contents[0].parts[0].text, /Ajaccio/);
});

test('the daily run happens once, at the class time', async () => {
    const item = site.db("SELECT * FROM class_items WHERE kind = 'appunti'")[0];
    await ap(luigi, { action: 'edit_item', id: item.id, subject_id: storia, kind: 'appunti', lesson_date: item.lesson_date, title: '', body: 'modificato' });
    site.db("UPDATE school_classes SET summary_time = '00:00', ai_last_auto = NULL WHERE id = ?", [classId]);
    calls.length = 0;
    await worker();
    assert.equal(calls.length, 2);
    const last = site.db('SELECT ai_last_auto FROM school_classes WHERE id = ?', [classId])[0].ai_last_auto;
    assert.match(last, /^\d{4}-\d{2}-\d{2}$/);
    await ap(luigi, { action: 'edit_item', id: item.id, subject_id: storia, kind: 'appunti', lesson_date: item.lesson_date, title: '', body: 'ancora' });
    await worker();
    assert.equal(calls.length, 2, 'already done today');
});

test('daily budget and Google quota errors stop the worker without losing work', async () => {
    await upload(luigi, { class_id: classId, subject_id: storia, kind: 'appunti', lesson_date: '2026-11-10' },
        [{ name: 'quaderno.png', content: PNG, type: 'image/png' }]);
    mode = 'quota';
    calls.length = 0;
    await worker();
    assert.equal(calls.length, 1);
    const f = site.db("SELECT text_status, text_attempts FROM class_item_files WHERE original_name = 'quaderno.png'")[0];
    assert.deepEqual(f, { text_status: 'pending', text_attempts: 0 }, 'a quota error is not the file\'s fault');
    mode = 'ok';

    // our own counter: 90% of the 500 a day of the fast model is used up
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
    site.db("INSERT INTO ai_usage (day, model, requests) VALUES (?, 'gemini-3.5-flash-lite', 450) ON CONFLICT(day, model) DO UPDATE SET requests = 450", [day]);
    calls.length = 0;
    await worker();
    assert.equal(calls.length, 0);
    site.db('DELETE FROM ai_usage');
    await worker();
    assert.equal(calls.length, 1, 'goes on when budget is back');
});

test('a real Gemini fault makes the worker exit with 1 (for the ntfy alert); the quota does not', async () => {
    await upload(luigi, { class_id: classId, subject_id: storia, kind: 'appunti', lesson_date: '2026-11-10' },
        [{ name: 'guasto.png', content: PNG, type: 'image/png' }]);
    mode = 'down';
    calls.length = 0;
    await assert.rejects(worker(), (e) => e.code === 1 && /Gemini failed 1 time/.test(e.stderr));
    assert.equal(calls.length, 1, 'stops at the first fault instead of trying every file');
    assert.deepEqual(site.db("SELECT text_status, text_attempts FROM class_item_files WHERE original_name = 'guasto.png'")[0],
        { text_status: 'pending', text_attempts: 0 }, 'not the file\'s fault');
    mode = 'quota';
    await worker();   // resolves: exit code 0
    mode = 'ok';
    await worker();
    assert.equal(site.db("SELECT text_status FROM class_item_files WHERE original_name = 'guasto.png'")[0].text_status, 'done');
});

test('the timetable is read from a photo and returned for review, not saved', async () => {
    const send = async (c, files) => {
        const fd = new FormData();
        fd.set('action', 'read_timetable');
        fd.set('id', String(classId));
        for (const f of files) fd.append('files[]', new Blob([f.content], { type: f.type }), f.name);
        const r = await fetch(site.base + '/api/classi.php', { method: 'POST', body: fd, headers: { Cookie: c.cookieHeader(), 'X-CSRF-Token': c.csrf } });
        return { status: r.status, json: await r.json() };
    };
    const photo = [{ name: 'orario.png', content: PNG, type: 'image/png' }];
    assert.equal((await send(luigi, photo)).json.code, 'not_manager');
    assert.equal((await send(mario, [{ name: 'orario.txt', content: Buffer.from('ciao'), type: 'text/plain' }])).json.code, 'bad_type');
    const versions = site.db('SELECT COUNT(*) AS n FROM class_timetables')[0].n;

    calls.length = 0;
    const r = await send(mario, photo);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.match(calls[0].url, /gemini-3\.8-flash:/, 'the smart model reads timetables');
    assert.match(calls[0].body.contents[0].parts.at(-1).text, /Materie già presenti nella classe: Storia/);
    assert.equal(r.json.bells_read, true);
    assert.deepEqual(r.json.periods['1'], [{ start: '08:10', end: '09:00' }, { start: '09:00', end: '09:45' }, { start: '09:45', end: '10:35' }]);
    assert.deepEqual(r.json.periods['5'], [{ start: '08:10', end: '09:05' }, { start: '09:05', end: '10:05' }, { start: '10:05', end: '11:05' }],
        'Friday keeps the class bell times and gets enough hours for its 3rd one');
    assert.deepEqual(r.json.slots.map((x) => [x.day, x.period, x.subject, x.label]), [
        [1, 1, 'TPSIT', 'Lab TPSIT'], [1, 2, 'TPSIT', 'Lab TPSIT'], [1, 3, 'Storia', ''], [5, 3, 'Matematica', ''],
    ], 'duplicates and impossible days dropped; a label equal to the subject is removed');
    assert.equal(r.json.notes, 'la quinta ora del venerdì non si legge bene');
    assert.equal(r.json.model, 'gemini-3.8-flash', 'the answer says which model read it');
    assert.equal(site.db('SELECT COUNT(*) AS n FROM class_timetables')[0].n, versions, 'nothing saved until the manager saves');

    mode = 'badjson';
    const bad = await send(mario, photo);
    mode = 'ok';
    assert.equal(bad.status, 422);
    assert.equal(bad.json.code, 'ai_unreadable');
});

test('Gemini overloaded: retries, then the fast model; a busy Google is not a fault', async () => {
    const send = async (c) => {
        const fd = new FormData();
        fd.set('action', 'read_timetable');
        fd.set('id', String(classId));
        fd.append('files[]', new Blob([PNG], { type: 'image/png' }), 'orario.png');
        const r = await fetch(site.base + '/api/classi.php', { method: 'POST', body: fd, headers: { Cookie: c.cookieHeader(), 'X-CSRF-Token': c.csrf } });
        return { status: r.status, json: await r.json() };
    };
    mode = 'busy_smart';
    calls.length = 0;
    const ok = await send(mario);
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    const tierOf = (c) => /flash-lite/.test(c.url) ? 'fast' : /3\.7-flash/.test(c.url) ? 'smart2' : 'smart';
    assert.deepEqual(calls.map(tierOf), ['smart', 'smart', 'smart', 'smart2'],
        'two retries on gemini-3.8-flash, then gemini-3.7-flash');

    // a model that hangs must not use up all the time: the next one still answers
    setEnv({ GEMINI_TEST_DEADLINE: 30 });
    mode = 'hang_smart';
    calls.length = 0;
    const started = Date.now();
    const hung = await send(mario);
    assert.equal(hung.status, 200, JSON.stringify(hung.json));
    assert.ok(Date.now() - started < 25000, 'answered well before the deadline');
    assert.equal(tierOf(calls.at(-1)), 'smart2');
    setEnv();

    site.db("DELETE FROM rate_limits WHERE bucket LIKE 'timetable_ai:%'");   // 5 readings an hour per class
    mode = 'busy';
    const busy = await send(mario);
    assert.equal(busy.status, 503);
    assert.equal(busy.json.code, 'ai_busy');

    // the worker: stops quietly and exits 0 (no alert), the file waits for the next run
    await upload(luigi, { class_id: classId, subject_id: storia, kind: 'appunti', lesson_date: '2026-11-10' },
        [{ name: 'occupato.png', content: PNG, type: 'image/png' }]);
    calls.length = 0;
    await worker();
    assert.equal(calls.length, 3);
    assert.equal(site.db("SELECT text_status FROM class_item_files WHERE original_name = 'occupato.png'")[0].text_status, 'pending');
    mode = 'ok';
    await worker();
    assert.equal(site.db("SELECT text_status FROM class_item_files WHERE original_name = 'occupato.png'")[0].text_status, 'done');
});

test('Whisper on the server transcribes recordings of any size, Gemini does not get them', async () => {
    const fake = path.join(site.root, 'fake-whisper.sh');
    fs.writeFileSync(fake, '#!/bin/sh\nif [ -n "$FAIL_WHISPER" ]; then echo "boom" >&2; exit 3; fi\necho "Prof: oggi Napoleone. File $(basename "$1") $WHISPER_MODEL"\n');
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.from([16, 0, 0, 0, 1, 0, 1, 0, 0x40, 0x1f, 0, 0, 0x80, 0x3e, 0, 0, 2, 0, 16, 0]),
        Buffer.from('data'), Buffer.alloc(4), Buffer.alloc(400)]);
    setEnv({ WHISPER_CMD: `sh ${fake}`, WHISPER_MODEL: 'base' });
    await upload(luigi, { class_id: classId, subject_id: storia, kind: 'appunti', lesson_date: '2026-11-10' }, [{ name: 'lezione.wav', content: wav, type: 'audio/wav' }]);
    calls.length = 0;
    await worker();
    assert.equal(calls.filter((c) => /trascrittore/.test(c.body.systemInstruction.parts[0].text)).length, 0, 'not sent to Gemini');
    const whisper = () => run('php', [path.join(site.root, 'bin/appunti-whisper.php')], { env: { ...process.env, FAIL_WHISPER: process.env.FAIL_WHISPER || '' } });
    await whisper();
    const f = site.db("SELECT text, text_status FROM class_item_files WHERE original_name = 'lezione.wav'")[0];
    assert.equal(f.text_status, 'done');
    assert.match(f.text, /^Prof: oggi Napoleone\. File .+\.wav base$/, 'the model chosen in .env reaches the script');

    // a failure is retried (three times at most) and makes the run exit with 1
    await upload(luigi, { class_id: classId, subject_id: storia, kind: 'appunti', lesson_date: '2026-11-10' }, [{ name: 'rotto.wav', content: wav, type: 'audio/wav' }]);
    await assert.rejects(run('php', [path.join(site.root, 'bin/appunti-whisper.php')], { env: { ...process.env, FAIL_WHISPER: '1' } }), (e) => e.code === 1 && /boom/.test(e.stderr));
    assert.deepEqual(site.db("SELECT text_status, text_attempts FROM class_item_files WHERE original_name = 'rotto.wav'")[0], { text_status: 'pending', text_attempts: 1 });
    await whisper();
    assert.equal(site.db("SELECT text_status FROM class_item_files WHERE original_name = 'rotto.wav'")[0].text_status, 'done');
    setEnv();
});

test('the desktop menu links the notes page', async () => {
    const html = await (await fetch(`${site.base}/index.php`)).text();
    assert.match(html, /href="pages\/appunti\.php"[^>]*>\/\/ APPUNTI DI CLASSE</);
});

test('new "AQ." keys can use the Bearer header; --models lists usable models', async () => {
    setEnv({ GEMINI_AUTH: 'bearer' });
    await upload(luigi, { class_id: classId, subject_id: storia, kind: 'appunti', lesson_date: '2026-11-10' },
        [{ name: 'altro.png', content: PNG, type: 'image/png' }]);
    calls.length = 0;
    await worker();
    assert.equal(calls[0].headers.authorization, 'Bearer AQ.test-key-123');
    assert.equal(calls[0].headers['x-goog-api-key'], undefined);
    setEnv();
});

test('without a key the worker does nothing and the button says so', async () => {
    setEnv({ GEMINI_API_KEY: '' });
    calls.length = 0;
    const out = await worker();
    assert.match(out, /not set/);
    assert.equal(calls.length, 0);
    site.db('UPDATE school_classes SET ai_last_manual = NULL WHERE id = ?', [classId]);
    assert.equal((await ap(luigi, { action: 'generate', class_id: classId })).json.code, 'ai_off');
    setEnv();
});

test('tests: complete handout, summary, targeted prep and quiz from the material since the previous test', async () => {
    const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
    // an earlier test closes the previous period
    await ap(luigi, { action: 'add_event', class_id: classId, subject_id: storia, kind: 'verifica', date: day(-20), title: 'Rivoluzione' });
    const id = (await ap(luigi, { action: 'add_event', class_id: classId, subject_id: storia, kind: 'verifica', date: day(5),
        title: 'Napoleone', topics: 'Napoleone e il Congresso di Vienna' })).json.id;
    await upload(mario, { class_id: classId, subject_id: storia, kind: 'domande', lesson_date: day(0), body: 'Il prof chiede sempre le date delle battaglie' });
    site.db('UPDATE school_classes SET ai_requested_at = 1 WHERE id = ?', [classId]);
    calls.length = 0;
    await worker();
    const bySystem = (w) => calls.filter((c) => c.body.systemInstruction.parts[0].text.includes(w));
    const completo = bySystem('DISPENSA COMPLETA');
    assert.equal(completo.length, 1);
    assert.match(completo[0].url, /gemini-3\.8-flash:/, 'the smart model writes the handout');
    const prompt = completo[0].body.contents[0].parts[0].text;
    assert.match(prompt, /Verifica del .*\(Napoleone\)/);
    assert.match(prompt, /Argomenti annunciati dal prof: Napoleone e il Congresso di Vienna/);
    assert.match(prompt, /\[L1\] Lezione del/);
    assert.match(bySystem('PREPARAZIONE MIRATA')[0].body.contents[0].parts[0].text, /date delle battaglie/);
    assert.equal(bySystem('RIASSUNTO').length, 1);
    assert.match(bySystem('quiz')[0].url, /flash-lite/);
    assert.match(bySystem('quiz')[0].body.contents[0].parts[0].text, /DOMANDE DEL PROF:\n- Dove nasce Napoleone\? → Ad Ajaccio/, 'the quiz starts from the teacher\'s questions');

    const docs = (await luigi.get(`/api/appunti.php?action=docs&class_id=${classId}`)).json.docs.filter((d) => d.event_id === id);
    assert.deepEqual(docs.map((d) => d.kind).sort(), ['completo', 'preparazione', 'quiz', 'riassunto', 'schema']);
    const get = async (kind) => (await luigi.get(`/api/appunti.php?action=doc&id=${docs.find((d) => d.kind === kind).id}`)).json.doc;
    const c = await get('completo');
    assert.match(c.content, /^> Materiale dal .* lezioni riordinate/);
    assert.match(c.content, /## Napoleone/);
    assert.match(c.title, /^Storia — Verifica del .* — Completo$/);
    const schema = JSON.parse((await get('schema')).content);
    assert.equal(schema.title, 'Napoleone');
    assert.deepEqual(schema.children[0], { label: 'Vita', note: 'nasce nel 1769', children: [{ label: 'Corsica' }] });
    assert.ok(site.db("SELECT COUNT(*) AS n FROM class_docs WHERE kind = 'schema' AND event_id IS NULL")[0].n >= 1, 'lesson schemas too');
    const quiz = JSON.parse((await get('quiz')).content);
    assert.equal(quiz.questions.length, 4);
    assert.deepEqual(quiz.questions[2].options, ['a', 'b', 'c', 'd']);

    // nothing changed: no new requests
    site.db('UPDATE school_classes SET ai_requested_at = 1 WHERE id = ?', [classId]);
    calls.length = 0;
    await worker();
    assert.equal(calls.length, 0);

    // smart budget used up: the handout falls back to the fast model; a broken quiz is marked as an error
    const pday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
    for (const m of ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash']) {
        site.db("INSERT INTO ai_usage (day, model, requests) VALUES (?, ?, 18) ON CONFLICT(day, model) DO UPDATE SET requests = 18", [pday, m]);
    }
    await ap(luigi, { action: 'edit_event', id, subject_id: storia, kind: 'verifica', date: day(5), title: 'Napoleone', topics: 'anche Waterloo' });
    site.db('UPDATE school_classes SET ai_requested_at = 1 WHERE id = ?', [classId]);
    mode = 'badquiz';
    calls.length = 0;
    await worker();
    mode = 'ok';
    assert.match(bySystem('DISPENSA COMPLETA')[0].url, /flash-lite/);
    const status = Object.fromEntries(site.db('SELECT kind, status FROM class_docs WHERE event_id = ?', [id]).map((r) => [r.kind, r.status]));
    assert.deepEqual(status, { completo: 'ok', riassunto: 'ok', preparazione: 'ok', quiz: 'error', schema: 'ok' });
    site.db('DELETE FROM ai_usage');

    // deleting the test deletes its documents
    await ap(luigi, { action: 'delete_event', id });
    assert.equal(site.db('SELECT COUNT(*) AS n FROM class_docs WHERE event_id = ?', [id])[0].n, 0);
});

test('"Genera ora" on chosen days rewrites the lessons of those days, even old ones', async () => {
    const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
    await upload(mario, { class_id: classId, subject_id: storia, kind: 'appunti', lesson_date: day(-60), body: 'Il Congresso di Vienna, 1815' });
    site.db("UPDATE class_items SET updated_at = 1000 WHERE lesson_date = ?", [day(-60)]);
    const gen = (body) => { site.db('UPDATE school_classes SET ai_last_manual = NULL WHERE id = ?', [classId]); return ap(luigi, { action: 'generate', class_id: classId, ...body }); };
    assert.equal((await gen({ from: day(-1), to: day(1) })).json.code, 'bad_range', 'no future days');
    assert.equal((await gen({ from: day(-5), to: day(-10) })).json.code, 'bad_range');
    assert.equal((await gen({ from: day(-300), to: day(0) })).json.code, 'bad_range', 'at most 120 days');
    const has = () => site.db("SELECT COUNT(*) AS n FROM class_docs WHERE kind = 'lezione' AND lesson_date = ?", [day(-60)])[0].n;
    site.db('UPDATE school_classes SET ai_requested_at = 1, ai_range_from = NULL WHERE id = ?', [classId]);
    await worker();
    assert.equal(has(), 0, 'normally old lessons are left alone');
    assert.equal((await gen({ from: day(-65), to: day(-55) })).status, 200);
    calls.length = 0;
    await worker();
    assert.equal(has(), 1);
    assert.ok(calls.every((c) => !/Lezione del/.test(c.body.contents[0].parts[0].text) || c.body.contents[0].parts[0].text.includes('Vienna')), 'only the chosen days');
    assert.equal(site.db('SELECT ai_range_from FROM school_classes WHERE id = ?', [classId])[0].ai_range_from, null, 'the range is used once');
});

test('a test can say which lessons to study (a topic started before the previous test)', async () => {
    const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
    const add = (extra) => ap(luigi, { action: 'add_event', class_id: classId, subject_id: storia, kind: 'verifica', date: day(10), title: 'Vienna', ...extra });
    assert.equal((await add({ period_from: day(-5), period_to: day(12) })).json.code, 'bad_period', 'not after the test');
    assert.equal((await add({ period_from: day(-5), period_to: day(-9) })).json.code, 'bad_period');
    assert.equal((await add({ period_to: day(-9) })).json.code, 'bad_period');
    const id = (await add({ period_from: day(-62), period_to: day(-50) })).json.id;
    const ev = (await luigi.get(`/api/appunti.php?action=events&class_id=${classId}&from=${day(-1)}&to=${day(30)}`)).json.events.find((e) => e.id === id);
    assert.deepEqual([ev.period_from, ev.period_to, ev.period], [day(-62), day(-50), [day(-62), day(-50)]]);
    site.db('UPDATE school_classes SET ai_requested_at = 1 WHERE id = ?', [classId]);
    calls.length = 0;
    await worker();
    const handout = calls.find((c) => c.body.systemInstruction.parts[0].text.includes('DISPENSA COMPLETA'));
    assert.match(handout.body.contents[0].parts[0].text, /Vienna/, 'the chosen old lesson is used');
    // back to automatic: emptied fields
    await ap(luigi, { action: 'edit_event', id, subject_id: storia, kind: 'verifica', date: day(10), title: 'Vienna', period_from: '', period_to: '' });
    const ev2 = (await luigi.get(`/api/appunti.php?action=events&class_id=${classId}&from=${day(-1)}&to=${day(30)}`)).json.events.find((e) => e.id === id);
    assert.equal(ev2.period_from, null);
    await ap(luigi, { action: 'delete_event', id });
});

test('the worker cannot be run from the web', async () => {
    assert.equal(fs.existsSync(path.join(site.root, 'public/bin')), false, 'bin/ stays outside the web root');
    const direct = await fetch(`${site.base}/api/appunti_ai.php`);
    assert.equal((await direct.text()).trim(), '', 'the library prints nothing');
});
