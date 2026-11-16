// tests/ai-maggiorenni.test.js — the AI (Google Gemini) only reads a class declared to have adult students only
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const http = require('http');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { startSite, Client, makeAdmin } = require('./helpers');

const run = promisify(execFile);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
let calls = 0;
const gemini = http.createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
        calls++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'TESTO' }] }, finishReason: 'STOP' }] }));
    });
});

test.describe('AI only for classes of adults', () => {
    let site, admin, mario, luigi, adultsId, minorsId, storia;
    const api = (c, body) => c.post('/api/classi.php', body);
    const worker = async () => (await run('php', [path.join(site.root, 'bin/appunti-ai.php')])).stdout;
    const clear = () => { try { site.db('DELETE FROM rate_limits'); } catch (e) { /* table not there yet */ } };

    test.before(async () => {
        await new Promise((r) => gemini.listen(0, '127.0.0.1', r));
        site = await startSite({ GEMINI_API_KEY: 'AQ.test-key-123', GEMINI_BASE_URL: `http://127.0.0.1:${gemini.address().port}/v1beta`,
            GEMINI_FAST_RPM: 6000, GEMINI_SMART_RPM: 6000, AI_CLASSIFY: 'false' });
        admin = await makeAdmin(site, 'am_admin');
        clear(); mario = new Client(site); await mario.register('am_mario');
        clear(); luigi = new Client(site); await luigi.register('am_luigi');
        adultsId = (await api(mario, { action: 'request', name: '5A', school: 'ITIS', adults: true })).json.id;
        minorsId = (await api(luigi, { action: 'request', name: '3B', school: 'ITIS' })).json.id;      // box not ticked
        for (const id of [adultsId, minorsId]) await api(admin, { action: 'decide', id, approve: true });
        for (const [c, id] of [[mario, adultsId], [luigi, minorsId]]) {
            await api(c, { action: 'save_timetable', id, valid_from: '2026-09-01', periods: [{ start: '08:10', end: '09:05' }], slots: [{ day: 2, period: 1, subject: 'Storia' }] });
        }
    });
    test.after(async () => { await site.stop(); gemini.close(); });

    test('the request box decides: ticked = AI on (with who and when), unticked = AI off', async () => {
        const a = site.db('SELECT ai_allowed, ai_adults_at, ai_adults_by FROM school_classes WHERE id = ?', [adultsId])[0];
        assert.equal(a.ai_allowed, 1); assert.ok(a.ai_adults_at > 0); assert.ok(a.ai_adults_by > 0);
        const m = site.db('SELECT ai_allowed, ai_adults_at FROM school_classes WHERE id = ?', [minorsId])[0];
        assert.equal(m.ai_allowed, 0); assert.equal(m.ai_adults_at, null);
        assert.equal((await luigi.get(`/api/classi.php?action=class&id=${minorsId}`)).json.class.ai_allowed, false);
        const list = (await admin.get('/api/classi.php?action=all')).json.classes;
        assert.ok(list.find((c) => c.id === adultsId).all_adults);
        assert.ok(!list.find((c) => c.id === minorsId).all_adults);
    });

    test('a class that is not adults-only cannot ask for documents, and its Study tab says so', async () => {
        storia = site.db('SELECT id FROM class_subjects WHERE class_id = ?', [minorsId])[0].id;
        const r = await luigi.post('/api/appunti.php', { action: 'generate', class_id: minorsId });
        assert.equal(r.status, 403);
        assert.equal(r.json.code, 'ai_not_allowed');
        const docs = (await luigi.get(`/api/appunti.php?action=docs&class_id=${minorsId}`)).json;
        assert.equal(docs.ai.allowed, false);
        const ok = await mario.post('/api/appunti.php', { action: 'generate', class_id: adultsId });
        assert.equal(ok.status, 200);
    });

    test('the worker never sends the material of a class that is not adults-only to the AI', async () => {
        const today = new Date().toISOString().slice(0, 10);
        const fd = new FormData();
        fd.set('action', 'upload'); fd.set('class_id', String(minorsId)); fd.set('subject_id', String(storia)); fd.set('kind', 'appunti'); fd.set('lesson_date', today); fd.set('body', 'Napoleone');
        fd.append('files[]', new Blob([PNG], { type: 'image/png' }), 'foto.png');
        const up = await fetch(site.base + '/api/appunti.php', { method: 'POST', body: fd, headers: { Cookie: luigi.cookieHeader(), 'X-CSRF-Token': luigi.csrf } });
        assert.equal(up.status, 200);                      // uploading and reading always work
        site.db('UPDATE school_classes SET ai_requested_at = 1 WHERE id = ?', [minorsId]);   // even a request made before it was switched off
        calls = 0;
        await worker();
        assert.equal(calls, 0, 'no call to Gemini for the photo or the lesson');
        assert.equal(site.db("SELECT text_status FROM class_item_files WHERE original_name = 'foto.png'")[0].text_status, 'pending');
        assert.equal(site.db('SELECT ai_requested_at FROM school_classes WHERE id = ?', [minorsId])[0].ai_requested_at, null);
    });

    test('the representative switches it on (declaring again that everybody is an adult) or off; others cannot', async () => {
        assert.equal((await api(luigi, { action: 'ai_switch', id: minorsId, on: true })).json.code, 'adults_needed');
        assert.equal((await api(mario, { action: 'ai_switch', id: minorsId, on: true, adults_confirm: true })).status, 404);   // not a member of that class: it does not exist for him
        assert.equal((await api(admin, { action: 'ai_switch', id: minorsId, on: true, adults_confirm: true })).status, 200);
        const row = site.db('SELECT ai_allowed, ai_adults_at FROM school_classes WHERE id = ?', [minorsId])[0];
        assert.equal(row.ai_allowed, 1); assert.ok(row.ai_adults_at > 0);
        calls = 0;
        await worker();
        assert.ok(calls >= 1, 'now the photo is transcribed');
        assert.equal((await api(luigi, { action: 'ai_switch', id: minorsId, on: false })).status, 200);
        assert.equal(site.db('SELECT ai_allowed FROM school_classes WHERE id = ?', [minorsId])[0].ai_allowed, 0);
        assert.equal((await luigi.post('/api/appunti.php', { action: 'generate', class_id: minorsId })).status, 403);
    });

    test('reading a timetable photo (Gemini) is refused too when the class is not adults-only', async () => {
        const fd = new FormData();
        fd.set('action', 'read_timetable');
        fd.set('id', String(minorsId));
        fd.append('files[]', new Blob([PNG], { type: 'image/png' }), 'orario.png');
        const before = calls;
        // luigi is the representative of the minors class
        const r = await fetch(site.base + '/api/classi.php', { method: 'POST', body: fd, headers: { Cookie: luigi.cookieHeader(), 'X-CSRF-Token': luigi.csrf } });
        assert.equal(r.status, 403);
        assert.equal((await r.json()).code, 'ai_not_allowed');
        assert.equal(calls, before, 'nothing was sent to Google');
    });
});
