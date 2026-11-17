// tests/backup.test.js — tools/backup.sh: checks, exclusions, manifest, retention, --check
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { startSite, REPO } = require('./helpers');

let site, dest;
const run = (args = [], env = {}) => spawnSync('bash', [path.join(REPO, 'tools/backup.sh'), ...args], {
    encoding: 'utf8', env: { ...process.env, PROJECT_DIR: site.root, BACKUP_MOUNT: dest, BACKUP_DIR: path.join(dest, 'b'), BACKUP_REQUIRE_MOUNT: '0', BACKUP_NOTIFY: '0', TMPDIR: dest, ...env },
});

test.before(async () => {
    site = await startSite();
    await fetch(site.base + '/api/get_feed.php');      // the first request that needs it creates the database
    dest = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-backup-'));
    const d = path.join(site.root, 'data');
    fs.mkdirSync(path.join(d, 'appunti-tmp', '1'), { recursive: true });
    fs.writeFileSync(path.join(d, 'appunti-tmp', '1', 'data.part'), 'half an upload');
    fs.writeFileSync(path.join(d, 'mail.log'), 'to=someone@example.com');
    fs.mkdirSync(path.join(d, 'books'), { recursive: true });
    fs.writeFileSync(path.join(d, 'books', 'libro.epub'), 'a book');
    fs.writeFileSync(path.join(d, 'appunti-ai.lock'), '');
});
test.after(async () => { await site.stop(); });

test('a backup: checked database copy, manifest, only the files worth keeping', () => {
    const r = run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const b = path.join(dest, 'b');
    const gz = fs.readdirSync(path.join(b, 'db')).filter((f) => f.endsWith('.sqlite.gz'));
    assert.equal(gz.length, 1);
    assert.match(r.stdout, /tables=\d+ schema=\d+/);
    const manifest = fs.readdirSync(b).find((f) => f.startsWith('manifest-'));
    const m = fs.readFileSync(path.join(b, manifest), 'utf8');
    assert.match(m, /sha256 [0-9a-f]{64}/);
    assert.match(m, /integrity ok, gzip ok/);
    assert.ok(!/password|SECRET/i.test(m), 'no secrets in the manifest');
    assert.ok(fs.existsSync(path.join(b, 'files', 'books', 'libro.epub')), 'books are saved');
    assert.ok(!fs.existsSync(path.join(b, 'files', 'appunti-tmp')), 'half-finished uploads are not');
    assert.ok(!fs.existsSync(path.join(b, 'files', 'mail.log')), 'the e-mail test log (addresses) is not');
    assert.ok(!fs.existsSync(path.join(b, 'files', 'appunti-ai.lock')), 'lock files are not');
});

test('--check: fresh and restorable is fine; stale, damaged or missing is a failure', () => {
    assert.equal(run(['--check']).status, 0);
    const b = path.join(dest, 'b', 'db');
    const gz = path.join(b, fs.readdirSync(b).find((f) => f.endsWith('.sqlite.gz')));
    const old = new Date(Date.now() - 40 * 3600 * 1000);
    fs.utimesSync(gz, old, old);
    const stale = run(['--check']);
    assert.equal(stale.status, 1);
    assert.match(stale.stdout, /hours old/);
    fs.utimesSync(gz, new Date(), new Date());
    const good = fs.readFileSync(gz);
    fs.writeFileSync(gz, good.subarray(0, 40));                       // cut the file short
    assert.equal(run(['--check']).status, 1, 'a damaged copy is reported');
    fs.writeFileSync(gz, good);
    assert.equal(run(['--check']).status, 0);
    assert.equal(spawnSync('bash', [path.join(REPO, 'tools/backup.sh'), '--check'], { env: { ...process.env, PROJECT_DIR: site.root, BACKUP_DIR: path.join(dest, 'nothing'), BACKUP_MOUNT: dest, BACKUP_REQUIRE_MOUNT: '0', BACKUP_NOTIFY: '0' } }).status, 1, 'no backup at all');
});

test('it refuses without the stick, without the database, and with too little room; old daily copies are removed', () => {
    const noStick = spawnSync('bash', [path.join(REPO, 'tools/backup.sh')], { encoding: 'utf8', env: { ...process.env, PROJECT_DIR: site.root, BACKUP_MOUNT: dest, BACKUP_DIR: path.join(dest, 'c'), BACKUP_NOTIFY: '0', TMPDIR: dest } });
    assert.equal(noStick.status, 1);
    assert.match(noStick.stdout, /not mounted/);
    assert.ok(!fs.existsSync(path.join(dest, 'c')), 'nothing written');
    assert.equal(run([], { PROJECT_DIR: path.join(dest, 'empty') }).status, 1);
    const b = path.join(dest, 'b', 'db');
    const oldFile = path.join(b, 'vector_uplink-2020-01-01_0000.sqlite.gz');
    fs.writeFileSync(oldFile, 'x');
    const t = new Date(Date.now() - 45 * 86400000);
    fs.utimesSync(oldFile, t, t);
    assert.equal(run().status, 0);
    assert.ok(!fs.existsSync(oldFile), 'a daily copy older than 30 days is deleted');
    assert.equal(run(['--bogus']).status, 2, 'unknown option');
});

test('--restore-test: restores into a temp folder, runs the migrations, checks the books; a book missing from the mirror fails', () => {
    // the site database has no admin yet in this test: make one, then back up again
    site.db("INSERT INTO accounts (username, password_hash, is_admin) VALUES ('restore_admin', 'x', 1)");
    site.db("INSERT INTO books (title, author, file_path, cover_path, format, uploaded_by) VALUES ('t', 'a', ?, '', 'epub', 'restore_admin')", [path.join(site.root, 'data', 'books', 'libro.epub')]);
    assert.equal(run().status, 0);
    const ok = run(['--restore-test']);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /restore OK: vector_uplink-.*accounts=\d+ admins=1 books=1/);
    // a book named in the database but gone from the mirror: the restore would lose it
    fs.rmSync(path.join(dest, 'b', 'files', 'books', 'libro.epub'));
    const lost = run(['--restore-test']);
    assert.equal(lost.status, 1);
    assert.match(lost.stdout + lost.stderr, /not in the files mirror/);
    fs.writeFileSync(path.join(dest, 'b', 'files', 'books', 'libro.epub'), 'a book');
    // nothing was written on the stick or in the live site
    assert.ok(!fs.readdirSync(path.join(dest, 'b')).some((f) => /restore/i.test(f)));
});

test('--restore-test: a folder the user cannot read is said plainly (and is not reported as a missing backup)', { skip: process.getuid && process.getuid() === 0 && 'root can read everything' }, () => {
    fs.chmodSync(path.join(dest, 'b', 'db'), 0o000);
    try {
        const r = run(['--restore-test']);
        assert.equal(r.status, 1);
        assert.match(r.stdout + r.stderr, /cannot read .*run this as root/);
    } finally { fs.chmodSync(path.join(dest, 'b', 'db'), 0o755); }
});
