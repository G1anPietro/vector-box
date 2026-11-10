// tests/node-session.test.js — Node panel sessions survive a restart
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

test('node panel login survives a restart', { skip: (!hasDeps && 'node_modules missing') || (!hasSqlite && 'node:sqlite missing') }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-node-'));
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const env = {
        ...process.env, PORT: String(port), NODE_SESSION_DB: path.join(dir, 'sessions.sqlite'),
        SESSION_SECRET: 'test-secret', ADMIN_PASSWORD: 'admin-pass', GUEST_PASSWORD: 'guest-pass',
        NODE_ENV: 'development', MC_DIR: '/nonexistent', WAKE_SCRIPT: '/nonexistent',
    };
    const start = async () => {
        const p = spawn('node', [path.join(REPO, 'server.js')], { cwd: dir, env, stdio: ['pipe', 'ignore', 'ignore'] });
        await waitForPort(port);
        return p;
    };

    let proc = await start();
    try {
        const login = await fetch(`${base}/api/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin-pass' }),
        });
        assert.equal(login.status, 200);
        const cookie = login.headers.getSetCookie()[0].split(';')[0];

        proc.kill();
        await new Promise((r) => proc.on('exit', r));
        proc = await start();

        const who = await (await fetch(`${base}/api/session`, { headers: { Cookie: cookie } })).json();
        assert.equal(who && who.role, 'admin');

        // logout destroys it in the store
        await fetch(`${base}/api/logout`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' });
        const after = await (await fetch(`${base}/api/session`, { headers: { Cookie: cookie } })).json();
        assert.equal(after, null);
    } finally {
        proc.kill();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
