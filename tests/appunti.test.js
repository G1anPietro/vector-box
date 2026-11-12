// tests/appunti.test.js — class study material and calendar: lessons from the timetable, uploads, limits, permissions
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { startSite, Client, makeAdmin } = require('./helpers');

let site, admin, mario, luigi, toad, peach;
let classId;
const subj = {};
const cl = (c, body) => c.post('/api/classi.php', body);
const ap = (c, body) => c.post('/api/appunti.php', body);

/** Multipart upload like the page does (FormData + CSRF header). */
async function upload(c, fields, files = []) {
    const fd = new FormData();
    fd.set('action', 'upload');
    for (const [k, v] of Object.entries(fields)) fd.set(k, String(v));
    for (const f of files) fd.append('files[]', new Blob([f.content], { type: f.type || 'application/octet-stream' }), f.name);
    const res = await fetch(c.site.base + '/api/appunti.php', {
        method: 'POST', body: fd, headers: { Cookie: c.cookieHeader(), 'X-CSRF-Token': c.csrf },
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
    return { status: res.status, json, text };
}

/** Builds a tiny Office file (zip) with PHP, since Node has no zip writer. */
function officeFile(kind) {
    const out = path.join(site.root, `sample.${kind}`);
    const parts = kind === 'docx'
        ? { '[Content_Types].xml': '<Types/>', 'word/document.xml':
            '<w:document><w:body><w:p><w:r><w:t>La rivoluzione francese</w:t></w:r></w:p><w:p><w:r><w:t>inizia nel 1789 &amp; finisce</w:t></w:r></w:p></w:body></w:document>' }
        : { '[Content_Types].xml': '<Types/>', 'ppt/presentation.xml': '<p:presentation/>',
            'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>Socket UDP</a:t></a:r></a:p></p:sld>',
            'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>Socket TCP</a:t></a:r></a:p></p:sld>',
            'ppt/slides/slide10.xml': '<p:sld><a:p><a:r><a:t>Domande</a:t></a:r></a:p></p:sld>',
            'ppt/notesSlides/notesSlide1.xml': '<p:notes><a:p><a:r><a:t>chiede sempre il three-way handshake</a:t></a:r></a:p></p:notes>' };
    const script = '$z = new ZipArchive(); $z->open($argv[1], ZipArchive::CREATE | ZipArchive::OVERWRITE);'
        + ' foreach (json_decode($argv[2], true) as $n => $c) $z->addFromString($n, $c); $z->close();';
    execFileSync('php', ['-r', script, out, JSON.stringify(parts)]);
    return fs.readFileSync(out);
}

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test.before(async () => {
    site = await startSite();
    admin = await makeAdmin(site, 'ap_admin');
    mario = new Client(site); await mario.register('ap_mario');
    luigi = new Client(site); await luigi.register('ap_luigi');
    toad = new Client(site); await toad.register('ap_toad');
    peach = new Client(site); await peach.register('ap_peach');

    classId = (await cl(mario, { action: 'request', name: '5B-I', school: 'ITIS' })).json.id;
    await cl(admin, { action: 'decide', id: classId, approve: true });
    const code = (await mario.get(`/api/classi.php?action=class&id=${classId}`)).json.class.invite_code;
    await cl(luigi, { action: 'join', code });
    await cl(toad, { action: 'join', code });

    // The owner's school: Monday has seven short hours
    const short = [['08:10', '09:00'], ['09:00', '09:45'], ['09:45', '10:35'], ['10:35', '11:25'],
        ['11:25', '12:15'], ['12:15', '13:00'], ['13:00', '13:50']].map(([start, end]) => ({ start, end }));
    const r = await cl(mario, {
        action: 'save_timetable', id: classId, valid_from: '2026-09-01', periods: { 1: short, 2: short.slice(0, 6) },
        slots: [
            { day: 1, period: 1, subject: 'TPSIT', label: 'Lab TPSIT' }, { day: 1, period: 2, subject: 'TPSIT', label: 'Lab TPSIT' },
            { day: 1, period: 3, subject: 'SISI', label: 'Lab SISI' }, { day: 1, period: 4, subject: 'SISI', label: 'Lab SISI' },
            { day: 1, period: 5, subject: 'Italiano' }, { day: 1, period: 6, subject: 'Scienze motorie' },
            { day: 1, period: 7, subject: 'Matematica' }, { day: 2, period: 1, subject: 'Storia' },
        ],
    });
    assert.equal(r.status, 200);
    for (const s of (await mario.get(`/api/classi.php?action=class&id=${classId}`)).json.class.subjects) subj[s.name] = s.id;
});
test.after(() => site.stop());

test('lessons of a day: consecutive hours of the same subject are one lesson', async () => {
    const r = (await luigi.get(`/api/appunti.php?action=lessons&class_id=${classId}&date=2026-11-09`)).json; // a Monday
    assert.deepEqual(r.lessons.map((l) => [l.subject_id, l.period, l.period_to, l.start, l.end]), [
        [subj.TPSIT, 1, 2, '08:10', '09:45'], [subj.SISI, 3, 4, '09:45', '11:25'], [subj.Italiano, 5, 5, '11:25', '12:15'],
        [subj['Scienze motorie'], 6, 6, '12:15', '13:00'], [subj.Matematica, 7, 7, '13:00', '13:50'],
    ]);
    const before = (await luigi.get(`/api/appunti.php?action=lessons&class_id=${classId}&date=2026-08-31`)).json;
    assert.equal(before.lessons.length, 0, 'no timetable before it starts');
    const sunday = (await luigi.get(`/api/appunti.php?action=lessons&class_id=${classId}&date=2026-11-15`)).json;
    assert.equal(sunday.lessons.length, 0);
});

test('suggest: the lesson in progress, else the last one of the day', async () => {
    // Rome is UTC+1 in November
    const at = (hhmm) => Date.UTC(2026, 10, 9, Number(hhmm.slice(0, 2)) - 1, Number(hhmm.slice(3))) / 1000;
    const pick = async (hhmm) => (await luigi.get(`/api/appunti.php?action=suggest&class_id=${classId}&ts=${at(hhmm)}`)).json;
    assert.equal((await pick('10:00')).lesson.subject_id, subj.SISI);
    assert.equal((await pick('11:30')).lesson.subject_id, subj.Italiano);
    assert.equal((await pick('16:00')).lesson.subject_id, subj.Matematica, 'after school: the last lesson');
    const early = await pick('07:30');
    assert.equal(early.lesson, null);
    assert.equal(early.date, '2026-11-09');
});

test('members only; CSRF required', async () => {
    assert.equal((await peach.get(`/api/appunti.php?action=items&class_id=${classId}`)).status, 404);
    const r = await upload(peach, { class_id: classId, subject_id: subj.Storia, kind: 'appunti', lesson_date: '2026-11-10', body: 'x' });
    assert.equal(r.status, 404);
    const noCsrf = await fetch(site.base + '/api/appunti.php', {
        method: 'POST', headers: { Cookie: luigi.cookieHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add_event', class_id: classId }),
    });
    assert.equal(noCsrf.status, 403);
});

test('upload: text only, validation', async () => {
    const base = { class_id: classId, subject_id: subj.Storia, kind: 'appunti', lesson_date: '2026-11-10' };
    assert.equal((await upload(luigi, base)).json.code, 'empty');
    assert.equal((await upload(luigi, { ...base, subject_id: 999999, body: 'x' })).json.code, 'bad_subject');
    assert.equal((await upload(luigi, { ...base, kind: 'boh', body: 'x' })).json.code, 'bad_kind');
    assert.equal((await upload(luigi, { ...base, lesson_date: '2026-02-30', body: 'x' })).json.code, 'bad_date');
    const ok = await upload(luigi, { ...base, title: 'Napoleone', body: 'Napoleone nasce in Corsica\nnel 1769' });
    assert.equal(ok.status, 200);
    const items = (await mario.get(`/api/appunti.php?action=items&class_id=${classId}`)).json.items;
    assert.equal(items.length, 1);
    assert.equal(items[0].author, 'ap_luigi');
    assert.equal(items[0].subject, 'Storia');
    assert.equal(items[0].body, 'Napoleone nasce in Corsica\nnel 1769', 'line breaks kept');
    assert.equal(items[0].mine, false);
    assert.equal(items[0].can_edit, true, 'the manager can edit');
});

test('upload: files are checked and text is extracted from text and Office files', async () => {
    const r = await upload(mario, { class_id: classId, subject_id: subj.TPSIT, kind: 'slide', lesson_date: '2026-11-09', period: 1 }, [
        { name: 'appunti.txt', content: Buffer.from('TCP è affidabile'), type: 'text/plain' },
        { name: 'storia.docx', content: officeFile('docx') },
        { name: 'socket.pptx', content: officeFile('pptx') },
        { name: 'lavagna.png', content: PNG, type: 'image/png' },
    ]);
    assert.equal(r.status, 200, r.text);
    const files = site.db('SELECT original_name, mime, text, text_status FROM class_item_files WHERE item_id = ? ORDER BY id', [r.json.id]);
    assert.equal(files[0].text, 'TCP è affidabile');
    assert.equal(files[1].text, 'La rivoluzione francese\ninizia nel 1789 & finisce');
    assert.equal(files[2].text, '--- Slide 1 ---\nSocket TCP\n[Note: chiede sempre il three-way handshake]\n\n'
        + '--- Slide 2 ---\nSocket UDP\n\n--- Slide 10 ---\nDomande', 'slides in numeric order, speaker notes kept');
    assert.deepEqual(files.map((f) => f.text_status), ['done', 'done', 'done', 'pending'], 'photos wait for the AI');

    const item = (await luigi.get(`/api/appunti.php?action=items&class_id=${classId}&kind=slide`)).json.items[0];
    assert.equal(item.period, 1);
    const png = item.files.find((f) => f.name === 'lavagna.png');
    const dl = await fetch(`${site.base}/api/appunti.php?action=file&id=${png.id}`, { headers: { Cookie: luigi.cookieHeader() } });
    assert.equal(dl.status, 200);
    assert.equal(dl.headers.get('content-type'), 'image/png');
    assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await dl.arrayBuffer()), PNG);
    const stranger = await fetch(`${site.base}/api/appunti.php?action=file&id=${png.id}`, { headers: { Cookie: peach.cookieHeader() } });
    assert.equal(stranger.status, 404);
});

test('upload: a disguised file is refused and nothing is kept', async () => {
    const before = fs.readdirSync(path.join(site.root, 'data/appunti', String(classId))).length;
    const r = await upload(luigi, { class_id: classId, subject_id: subj.Storia, kind: 'appunti', lesson_date: '2026-11-10' }, [
        { name: 'ok.png', content: PNG, type: 'image/png' },
        { name: 'virus.png', content: Buffer.from('MZ\x90\x00 not really a picture'), type: 'image/png' },
    ]);
    assert.equal(r.status, 415);
    assert.equal(r.json.code, 'bad_type');
    assert.equal(fs.readdirSync(path.join(site.root, 'data/appunti', String(classId))).length, before);
    const fake = await upload(luigi, { class_id: classId, subject_id: subj.Storia, kind: 'appunti', lesson_date: '2026-11-10' }, [
        { name: 'script.php', content: Buffer.from('<?php echo 1;'), type: 'text/plain' },
    ]);
    assert.equal(fake.json.code, 'bad_type');
});

test('upload limits per file and per class', async () => {
    const base = { class_id: classId, subject_id: subj.Storia, kind: 'appunti', lesson_date: '2026-11-10' };
    const big = (kb) => ({ name: 'big.txt', content: Buffer.alloc(kb * 1024, 'a'), type: 'text/plain' });
    await cl(admin, { action: 'set_limits', id: classId, file_mb: 1, class_mb: 2 });
    assert.equal((await upload(luigi, base, [big(1100)])).json.code, 'file_too_large');
    assert.equal((await upload(luigi, base, [big(900)])).status, 200);
    assert.equal((await upload(luigi, base, [big(900)])).status, 200);
    const full = await upload(luigi, base, [big(900)]);
    assert.equal(full.status, 413);
    assert.equal(full.json.code, 'class_full');
    const usage = (await luigi.get(`/api/appunti.php?action=usage&class_id=${classId}`)).json;
    assert.ok(usage.used_bytes > 1800 * 1024);
    assert.deepEqual(usage.limits_mb, { file: 1, class: 2 });
    await cl(admin, { action: 'set_limits', id: classId, file_mb: '', class_mb: '' });
});

test('only the author or the manager edit and delete; files leave the disk', async () => {
    const r = await upload(toad, { class_id: classId, subject_id: subj.Storia, kind: 'domande', lesson_date: '2026-11-10', body: 'Cause della rivoluzione?' },
        [{ name: 'foto.png', content: PNG, type: 'image/png' }]);
    const id = r.json.id;
    const stored = site.db('SELECT stored_name FROM class_item_files WHERE item_id = ?', [id])[0].stored_name;
    const file = path.join(site.root, 'data/appunti', String(classId), stored);
    assert.ok(fs.existsSync(file));

    const edit = { action: 'edit_item', id, subject_id: subj.Storia, kind: 'domande', lesson_date: '2026-11-10', title: 'Interrogazione', body: 'Cause?' };
    assert.equal((await ap(luigi, edit)).status, 403);
    assert.equal((await ap(toad, edit)).status, 200);
    assert.equal(site.db('SELECT title FROM class_items WHERE id = ?', [id])[0].title, 'Interrogazione');
    assert.equal((await ap(luigi, { action: 'delete_item', id })).status, 403);
    assert.equal((await ap(mario, { action: 'delete_item', id })).status, 200, 'the manager can delete');
    assert.equal(fs.existsSync(file), false);
    assert.equal(site.db('SELECT COUNT(*) AS n FROM class_item_files WHERE item_id = ?', [id])[0].n, 0);
});

test('calendar: everyone adds, author or manager change', async () => {
    const ev = { action: 'add_event', class_id: classId, subject_id: subj.Storia, kind: 'verifica', date: '2026-11-20', title: 'Verifica', topics: 'Napoleone' };
    assert.equal((await ap(peach, ev)).status, 404);
    assert.equal((await ap(luigi, { ...ev, kind: 'festa' })).json.code, 'bad_kind');
    const id = (await ap(luigi, ev)).json.id;
    await ap(toad, { ...ev, kind: 'interrogazione', date: '2026-12-01', subject_id: subj.Italiano, title: 'Interrogazione' });

    const list = (await mario.get(`/api/appunti.php?action=events&class_id=${classId}&from=2026-11-01&to=2026-12-31`)).json.events;
    assert.deepEqual(list.map((e) => [e.date, e.kind, e.subject, e.author]), [
        ['2026-11-20', 'verifica', 'Storia', 'ap_luigi'], ['2026-12-01', 'interrogazione', 'Italiano', 'ap_toad'],
    ]);
    const upd = { action: 'edit_event', id, subject_id: subj.Storia, kind: 'verifica', date: '2026-11-21', title: 'Verifica spostata', topics: '' };
    assert.equal((await ap(toad, upd)).status, 403);
    assert.equal((await ap(luigi, upd)).status, 200);
    assert.equal((await ap(toad, { action: 'delete_event', id })).status, 403);
    assert.equal((await ap(mario, { action: 'delete_event', id })).status, 200);
});

test('deleting the class removes its material from disk', async () => {
    const dir = path.join(site.root, 'data/appunti', String(classId));
    assert.ok(fs.existsSync(dir));
    assert.equal((await cl(admin, { action: 'delete_class', id: classId })).status, 200);
    assert.equal(fs.existsSync(dir), false);
    for (const t of ['class_items', 'class_item_files', 'class_events']) {
        assert.equal(site.db(`SELECT COUNT(*) AS n FROM ${t}`)[0].n, 0, t);
    }
});
