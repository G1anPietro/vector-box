// tests/condivisi.test.js — temporary links to class material: members make them, anyone with the link opens ONE piece of material
// (no login), they expire, can be revoked, and nothing else is reachable through them
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client, makeAdmin } = require('./helpers');

let site, admin, mario, luigi, peach, classId, storia, fileId, docId, quizId, itemId;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const ap = (c, body) => c.post('/api/appunti.php', body);
const tokenOf = (path) => new URL(path, 'http://x').searchParams.get('t');
const pub = (t, extra = '') => fetch(`${site.base}/api/condividi.php?t=${t}${extra}`);   // no cookies at all

test.before(async () => {
    site = await startSite();
    admin = await makeAdmin(site, 'sh_admin');
    mario = new Client(site); await mario.register('sh_mario');
    luigi = new Client(site); await luigi.register('sh_luigi');
    peach = new Client(site); await peach.register('sh_peach');
    classId = (await mario.post('/api/classi.php', { action: 'request', name: '5S', school: 'ITIS' })).json.id;
    await admin.post('/api/classi.php', { action: 'decide', id: classId, approve: true });
    const code = (await mario.get(`/api/classi.php?action=class&id=${classId}`)).json.class.invite_code;
    await luigi.post('/api/classi.php', { action: 'join', code });
    await mario.post('/api/classi.php', { action: 'save_timetable', id: classId, valid_from: '2026-01-01', periods: { 1: [{ start: '08:00', end: '09:00' }] }, slots: [{ day: 1, period: 1, subject: 'Storia' }] });
    storia = site.db('SELECT id FROM class_subjects WHERE class_id = ?', [classId])[0].id;
    const fd = new FormData();
    for (const [k, v] of Object.entries({ action: 'upload', class_id: classId, subject_id: storia, kind: 'appunti', lesson_date: '2026-10-05', body: 'Appunti scritti a mano su Napoleone e il Congresso di Vienna' })) fd.set(k, String(v));
    fd.append('files[]', new Blob([PNG], { type: 'image/png' }), 'foto.png');
    await fetch(mario.site.base + '/api/appunti.php', { method: 'POST', body: fd, headers: { Cookie: mario.cookieHeader(), 'X-CSRF-Token': mario.csrf } });
    const it = (await mario.get(`/api/appunti.php?action=items&class_id=${classId}`)).json.items[0];
    itemId = it.id; fileId = it.files[0].id;
    const now = 1;
    const mk = (key, kind, content) => { site.db(`INSERT INTO class_docs (class_id, doc_key, subject_id, kind, title, content, sources, input_hash, model, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, '[]', 'h', 't', 'ok', ?, ?)`, [classId, key, storia, kind, 'Doc ' + kind, content, now, now]); return site.db('SELECT id FROM class_docs WHERE doc_key = ?', [key])[0].id; };
    docId = mk('schema:s', 'schema', JSON.stringify({ title: 'Napoleone', children: [{ label: 'Ascesa' }] }));
    quizId = mk('quiz:q', 'quiz', '{"questions":[]}');
});
test.after(() => site.stop());

test('a member makes a link; anyone opens that file (and only it) without logging in', async () => {
    const r = await ap(luigi, { action: 'share_create', kind: 'file', id: fileId, days: 7 });
    assert.equal(r.status, 200);
    const t = tokenOf(r.json.path);
    assert.match(t, /^[0-9a-f]{32}$/);
    assert.notEqual(site.db('SELECT token_hash FROM share_links')[0].token_hash, t, 'only a hash is stored');
    const info = await (await pub(t)).json();
    assert.equal(info.kind, 'file'); assert.equal(info.name, 'foto.png'); assert.equal(info.mime, 'image/png');
    const f = await pub(t, '&action=file');
    assert.equal(f.status, 200);
    assert.equal(f.headers.get('content-type'), 'image/png');
    assert.match(f.headers.get('content-disposition'), /^inline/);
    assert.match((await pub(t, '&action=file&dl=1')).headers.get('content-disposition'), /^attachment/);
    assert.equal(f.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal(site.db('SELECT views FROM share_links')[0].views, 1, 'one opening counted (the file bytes do not count)');
});

test('documents and notes: the schema and the text open; quizzes and questions cannot be shared; strangers cannot make links', async () => {
    const d = await ap(mario, { action: 'share_create', kind: 'doc', id: docId, days: 1 });
    const info = await (await pub(tokenOf(d.json.path))).json();
    assert.equal(info.doc_kind, 'schema');
    assert.match(info.content, /Napoleone/);
    assert.equal((await ap(mario, { action: 'share_create', kind: 'doc', id: quizId })).status, 404, 'quizzes keep their answers on the server');
    const i = await ap(mario, { action: 'share_create', kind: 'item', id: itemId });
    assert.match((await (await pub(tokenOf(i.json.path))).json()).body, /Congresso di Vienna/);
    assert.ok(Math.abs(i.json.expires_at - Date.now() / 1000 - 7 * 86400) < 60, 'without a choice it lasts 7 days');
    assert.equal((await ap(peach, { action: 'share_create', kind: 'file', id: fileId })).status, 404, 'not in the class');
    assert.equal((await ap(mario, { action: 'share_create', kind: 'file', id: 99999 })).status, 404);
    assert.equal((await ap(mario, { action: 'share_create', kind: 'banana', id: 1 })).status, 400);
    assert.equal((await mario.post('/api/appunti.php', { action: 'share_create', kind: 'file', id: fileId }, { csrf: false })).status, 403);
});

test('expired, revoked, wrong and malformed tokens all look the same; the owner lists and revokes', async () => {
    const r = await ap(mario, { action: 'share_create', kind: 'file', id: fileId, days: 30 });
    const t = tokenOf(r.json.path);
    assert.equal((await pub(t)).status, 200);
    site.db('UPDATE share_links SET expires_at = 1 WHERE token_hash = ?', [require('crypto').createHash('sha256').update(t).digest('hex')]);
    assert.equal((await pub(t)).status, 404, 'expired');
    for (const bad of ['', 'abc', '0'.repeat(32), '../../etc/passwd']) assert.equal((await pub(bad)).status, 404);
    const r2 = await ap(mario, { action: 'share_create', kind: 'file', id: fileId });
    const list = (await mario.get('/api/appunti.php?action=share_list')).json.links;
    assert.ok(list.length >= 1 && list.every((l) => l.title));
    assert.equal((await luigi.get('/api/appunti.php?action=share_list')).json.links.some((l) => l.id === list[0].id), false, 'each one sees only their own');
    assert.equal((await ap(luigi, { action: 'share_revoke', id: list[0].id })).status, 404, 'not yours');
    assert.equal((await ap(mario, { action: 'share_revoke', id: list[0].id })).status, 200);
    const t2 = tokenOf(r2.json.path);
    const mine = (await mario.get('/api/appunti.php?action=share_list')).json.links;
    for (const l of mine) await ap(mario, { action: 'share_revoke', id: l.id });
    assert.equal((await pub(t2)).status, 404, 'revoked');
});

test('a link dies with its class and does not open other material; the public page and the cached assets exist', async () => {
    const r = await ap(mario, { action: 'share_create', kind: 'file', id: fileId });
    const t = tokenOf(r.json.path);
    site.db("UPDATE school_classes SET status = 'closed' WHERE id = ?", [classId]);
    assert.equal((await pub(t)).status, 404);
    site.db("UPDATE school_classes SET status = 'active' WHERE id = ?", [classId]);
    assert.equal((await pub(t)).status, 200);
    const page = await fetch(`${site.base}/pages/condiviso.php?t=${t}`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /condiviso\.js\?v=/);
    assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow');
});
