// tests/node-sorgenti.test.js — the Node panel never serves PHP sources, not even with a %-encoded extension
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { freePort, waitForPort, REPO } = require('./helpers');

const hasDeps = fs.existsSync(path.join(REPO, 'node_modules', 'express'));
let hasSqlite = true;
try { require('node:sqlite'); } catch (e) { hasSqlite = false; }

test('static files: /api/helpers.php and /api/helpers.p%68p are both refused', { skip: (!hasDeps && 'node_modules missing') || (!hasSqlite && 'node:sqlite missing') }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-node-'));
    const port = await freePort();
    const env = { ...process.env, PORT: String(port), NODE_SESSION_DB: path.join(dir, 'sessions.sqlite'), SESSION_SECRET: 'test-secret',
        ADMIN_PASSWORD: 'admin-pass', GUEST_PASSWORD: 'guest-pass', NODE_ENV: 'development', MC_DIR: '/nonexistent', WAKE_SCRIPT: '/nonexistent' };
    const proc = spawn('node', [path.join(REPO, 'server.js')], { cwd: dir, env, stdio: ['pipe', 'ignore', 'ignore'] });
    try {
        await waitForPort(port);
        for (const p of ['/api/helpers.php', '/api/helpers.p%68p', '/api/helpers.PHP', '/%2e%2e/server.js']) {
            const r = await fetch(`http://127.0.0.1:${port}${p}`);
            const body = await r.text();
            assert.ok(!body.includes('<?php'), `${p} leaked a source`);
        }
        assert.equal((await fetch(`http://127.0.0.1:${port}/api/helpers.p%68p`)).status, 404);
    } finally { proc.kill(); }
});
