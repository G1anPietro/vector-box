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
        const system = body.systemInstruction ? body.systemInstruction.parts[0].text : '';
        const user = body.contents ? body.contents[0].parts.filter((p) => p.text).map((p) => p.text).join(' ') : '';
        const text = system.includes('trascrittore')
            ? `TRASCRITTO ${user.replace('Trascrivi questo file: ', '')}`
            : `## Lezione unita\nTutto il materiale [1][2]\n## Possibili domande all'interrogazione\n1. Chi era Napoleone?`;
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
        GEMINI_FAST_RPM: 6000, GEMINI_SMART_RPM: 6000,
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
    assert.equal(calls.length, 1);
    const prompt = calls[0].body.contents[0].parts[0].text;
    assert.match(calls[0].body.systemInstruction.parts[0].text, /APPUNTI COMPLETI/);
    assert.match(prompt, /<materiale>[\s\S]*\[1\] Appunti di ai_luigi[\s\S]*Napoleone nasce nel 1769[\s\S]*TRASCRITTO lavagna\.png[\s\S]*\[2\] Slide\/materiale del prof di ai_mario[\s\S]*Campagna d'Italia[\s\S]*<\/materiale>/);

    const list = (await luigi.get(`/api/appunti.php?action=docs&class_id=${classId}`)).json;
    assert.equal(list.ai.requested, false, 'the request was served');
    assert.equal(list.docs.length, 1);
    assert.equal(list.docs[0].kind, 'lezione');
    assert.match(list.docs[0].title, /^Storia — lezione del /);
    const doc = (await luigi.get(`/api/appunti.php?action=doc&id=${list.docs[0].id}`)).json.doc;
    assert.match(doc.content, /Possibili domande/);
    assert.deepEqual(doc.sources.map((s) => [s.n, s.author, s.kind]), [[1, 'ai_luigi', 'appunti'], [2, 'ai_mario', 'slide']]);
    assert.equal((await peach.get(`/api/appunti.php?action=doc&id=${doc.id}`)).status, 404);
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
    assert.equal(calls.length, 1);
    assert.match(calls[0].body.contents[0].parts[0].text, /Ajaccio/);
});

test('the daily run happens once, at the class time', async () => {
    const item = site.db("SELECT * FROM class_items WHERE kind = 'appunti'")[0];
    await ap(luigi, { action: 'edit_item', id: item.id, subject_id: storia, kind: 'appunti', lesson_date: item.lesson_date, title: '', body: 'modificato' });
    site.db("UPDATE school_classes SET summary_time = '00:00', ai_last_auto = NULL WHERE id = ?", [classId]);
    calls.length = 0;
    await worker();
    assert.equal(calls.length, 1);
    const last = site.db('SELECT ai_last_auto FROM school_classes WHERE id = ?', [classId])[0].ai_last_auto;
    assert.match(last, /^\d{4}-\d{2}-\d{2}$/);
    await ap(luigi, { action: 'edit_item', id: item.id, subject_id: storia, kind: 'appunti', lesson_date: item.lesson_date, title: '', body: 'ancora' });
    await worker();
    assert.equal(calls.length, 1, 'already done today');
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

test('the worker cannot be run from the web', async () => {
    assert.equal(fs.existsSync(path.join(site.root, 'public/bin')), false, 'bin/ stays outside the web root');
    const direct = await fetch(`${site.base}/api/appunti_ai.php`);
    assert.equal((await direct.text()).trim(), '', 'the library prints nothing');
});
