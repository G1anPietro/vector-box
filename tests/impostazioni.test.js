// tests/impostazioni.test.js — personal notification choices: stored per member and class, and honoured when sending
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client, makeAdmin } = require('./helpers');

let site, admin, mario, luigi, peach, classId;
const nt = (c, body) => c.post('/api/notifiche.php', body);

test.before(async () => {
    site = await startSite();
    admin = await makeAdmin(site, 'im_admin');
    mario = new Client(site); await mario.register('im_mario');
    luigi = new Client(site); await luigi.register('im_luigi');
    peach = new Client(site); await peach.register('im_peach');
    classId = (await mario.post('/api/classi.php', { action: 'request', name: '5C', school: 'ITIS' })).json.id;
    await admin.post('/api/classi.php', { action: 'decide', id: classId, approve: true });
    const code = (await mario.get(`/api/classi.php?action=class&id=${classId}`)).json.class.invite_code;
    await luigi.post('/api/classi.php', { action: 'join', code });
});
test.after(() => site.stop());

test('defaults are all on; members only; choices are saved per member', async () => {
    const d = (await luigi.get(`/api/notifiche.php?action=prefs&class_id=${classId}`)).json;
    assert.deepEqual([d.prefs.promemoria, d.prefs.turno, d.prefs.annuncio, d.prefs.slots], [true, true, true, ['d2', 'd1', 'sera']]);
    assert.equal((await peach.get(`/api/notifiche.php?action=prefs&class_id=${classId}`)).status, 404);
    assert.equal((await nt(peach, { action: 'save_prefs', class_id: classId, prefs: {} })).status, 404);
    assert.equal((await luigi.post('/api/notifiche.php', { action: 'save_prefs', class_id: classId, prefs: {} }, { csrf: false })).status, 403);
    const r = await nt(luigi, { action: 'save_prefs', class_id: classId, prefs: { promemoria: true, turno: false, annuncio: false, slots: ['sera', 'bogus'] } });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.prefs.slots, ['sera']);
    const m = (await mario.get(`/api/notifiche.php?action=prefs&class_id=${classId}`)).json;
    assert.equal(m.prefs.annuncio, true, "another member's choices are untouched");
});

test('an announcement is not sent to who switched announcements off; the others still get it', async () => {
    const r = await mario.post('/api/bacheca.php', { action: 'save_announcement', class_id: classId, title: 'Gita', notify: true });
    assert.equal(r.status, 200);
    const luigiId = site.db("SELECT id FROM accounts WHERE username = 'im_luigi'")[0].id;
    assert.equal(site.db("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'annuncio' AND user_id = ?", [luigiId])[0].n, 0);
    await nt(luigi, { action: 'save_prefs', class_id: classId, prefs: { promemoria: true, turno: true, annuncio: true, slots: ['d2'] } });
    await mario.post('/api/bacheca.php', { action: 'save_announcement', class_id: classId, title: 'Gita 2', notify: true });
    assert.equal(site.db("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'annuncio' AND user_id = ?", [luigiId])[0].n, 1);
});

test('the automatic summary can be switched off by who manages settings; the class says so; the worker skips it', async () => {
    const get = async () => (await mario.get(`/api/classi.php?action=class&id=${classId}`)).json.class;
    assert.equal((await get()).summary_on, true);
    assert.equal((await luigi.post('/api/classi.php', { action: 'settings', id: classId, summary_time: '19:00', summary_on: false })).status, 403);
    const r = await mario.post('/api/classi.php', { action: 'settings', id: classId, summary_time: '19:30', summary_on: false });
    assert.equal(r.status, 200, r.text);
    const c = await get();
    assert.deepEqual([c.summary_on, c.summary_time], [false, '19:30']);
    // changing only the time keeps the switch
    await mario.post('/api/classi.php', { action: 'settings', id: classId, summary_time: '20:00' });
    assert.equal((await get()).summary_on, false);
    const row = site.db('SELECT * FROM school_classes WHERE id = ?', [classId])[0];
    const due = require('node:child_process').execFileSync('php', ['-r', "require $argv[1] . '/public/api/appunti_ai.php'; echo json_encode(aiClassDue(json_decode($argv[2], true), time()));", require('node:path').join(__dirname, '..'), JSON.stringify(row)]).toString();
    assert.equal(due, 'false', 'switched off: not due (unless someone pressed Genera ora)');
    await mario.post('/api/classi.php', { action: 'settings', id: classId, summary_time: '20:00', summary_on: true });
    assert.equal((await get()).summary_on, true);
});

test('notifications can be deleted by id, by kind or all, and only my own', async () => {
    const id = (u) => site.db('SELECT id FROM accounts WHERE username = ?', [u])[0].id;
    const add = (u, kind, title) => site.db('INSERT INTO notifications (user_id, class_id, kind, title, body, url, created_at) VALUES (?, NULL, ?, ?, ?, ?, ?)', [id(u), kind, title, '', '/', 1]);
    add('im_luigi', 'annuncio', 'a1'); add('im_luigi', 'annuncio', 'a2'); add('im_luigi', 'turno', 't1'); add('im_mario', 'annuncio', 'm1');
    const mine = async () => (await luigi.get('/api/notifiche.php?action=list')).json.notifications;
    const all = await mine();
    assert.ok(all.length >= 3);
    const a1 = all.find((n) => n.title === 'a1');
    assert.equal((await nt(luigi, { action: 'delete', ids: [a1.id] })).status, 200);
    assert.ok(!(await mine()).some((n) => n.title === 'a1'));
    // someone else's id is ignored
    const m1 = site.db("SELECT id FROM notifications WHERE title = 'm1'")[0].id;
    await nt(luigi, { action: 'delete', ids: [m1] });
    assert.equal(site.db("SELECT COUNT(*) AS n FROM notifications WHERE title = 'm1'")[0].n, 1);
    await nt(luigi, { action: 'delete', kind: 'annuncio' });
    assert.deepEqual((await mine()).map((n) => n.kind).filter((k) => k === 'annuncio'), []);
    assert.equal((await nt(luigi, { action: 'delete' })).json.code, 'nothing');
    await nt(luigi, { action: 'delete', all: true });
    assert.equal((await mine()).length, 0);
    assert.equal(site.db("SELECT COUNT(*) AS n FROM notifications WHERE title = 'm1'")[0].n, 1, 'mario still has his');
});
