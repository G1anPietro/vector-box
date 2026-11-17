// tests/assets-stamp.test.js — the css/js of the static pages carry a content-hash ?v= (long cache), and it is up to date.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

test('static pages: every local css/js has a current 10-digit ?v= (run: php tools/stamp-assets.php)', () => {
    const r = spawnSync('php', [path.join(__dirname, '..', 'tools', 'stamp-assets.php'), '--check'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
});

test('the dungeon page loads its scripts with the long-cache pattern nginx recognises', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'pages', 'dungeon.html'), 'utf8');
    const versions = [...html.matchAll(/<script src="[^"]+\.js\?v=(\d+)"/g)].map((m) => m[1]);
    assert.ok(versions.length > 15);
    for (const v of versions) assert.match(v, /^[0-9]{9,}$/);
});
