// tests/hub.test.js — Node chat hub: token auth, push, hidden rooms, deletes, publish auth
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { startSite, Client, makeAdmin, freePort, waitForPort, parseSse, REPO } = require('./helpers');

const hasDeps = fs.existsSync(path.join(REPO, 'node_modules', 'express'));
const SECRET = 'hub-test-secret-0123456789';

let site, node, nodeBase, admin, user;

/** Open the hub stream, run `during()` while it is connected, return parsed events. */
async function hubStream(client, during, { ms = 1500, query = '' } = {}) {
    const cfg = (await client.get('/api/check_session.php')).json.chat_stream;
    const ctrl = new AbortController();
    const res = await fetch(`${nodeBase}/api/chat/stream?token=${encodeURIComponent(cfg.token)}${query}`, { signal: ctrl.signal });
    let raw = '';
    const reading = (async () => {
        const dec = new TextDecoder();
        try { for await (const c of res.body) raw += dec.decode(c, { stream: true }); } catch (e) { /* aborted */ }
    })();
    await new Promise((r) => setTimeout(r, 200));
    if (during) await during();
    await new Promise((r) => setTimeout(r, ms));
    ctrl.abort();
    await reading;
    return { status: res.status, events: parseSse(raw) };
}

test.describe('chat hub', { skip: !hasDeps && 'node_modules missing (run npm install)' }, () => {
    test.before(async () => {
        const nodePort = await freePort();
        nodeBase = `http://127.0.0.1:${nodePort}`;
        site = await startSite({
            CHAT_HUB_SECRET: SECRET,
            CHAT_STREAM_URL: `${nodeBase}/api/chat/stream`,
            PORT: nodePort,
        });
        node = spawn('node', [path.join(REPO, 'server.js')], {
            cwd: site.root, // dotenv reads the test .env
            env: {
                ...process.env, PORT: String(nodePort), CHAT_HUB_SECRET: SECRET,
                SESSION_SECRET: 'test', ADMIN_PASSWORD: 'test-admin', GUEST_PASSWORD: 'test-guest',
                NODE_ENV: 'development', MC_DIR: '/nonexistent', WAKE_SCRIPT: '/nonexistent',
                NODE_SESSION_DB: path.join(site.root, 'data', 'node_sessions.sqlite'),
            },
            stdio: ['pipe', 'ignore', 'inherit'],
        });
        await waitForPort(nodePort);
        admin = await makeAdmin(site, 'hub_admin');
        user = new Client(site);
        await user.register('hub_user');
    });
    test.after(async () => { node.kill(); await site.stop(); });

    test('check_session hands out a stream token', async () => {
        const cfg = (await user.get('/api/check_session.php')).json.chat_stream;
        assert.ok(cfg && cfg.token && cfg.url.endsWith('/api/chat/stream'));
    });

    test('invalid or missing tokens are refused', async () => {
        assert.equal((await fetch(`${nodeBase}/api/chat/stream`)).status, 401);
        assert.equal((await fetch(`${nodeBase}/api/chat/stream?token=abc.def`)).status, 401);
    });

    test('messages are pushed; hidden rooms only reach admins; deletes propagate', async () => {
        let deletedId;
        const run = async () => {
            await user.send('general', 'hub-public');
            await admin.send('admin', 'hub-hidden');
            deletedId = (await user.get('/api/get_feed.php?room_id=general&limit=1')).json.messages[0].id;
            await admin.post('/api/delete_message.php', { id: deletedId });
        };
        const [forUser, forAdmin] = await Promise.all([hubStream(user, run), hubStream(admin, null, { ms: 1700 })]);

        const texts = (s) => s.events.filter((e) => e.event === 'message').map((e) => e.json.message);
        assert.ok(texts(forUser).includes('hub-public'));
        assert.ok(!texts(forUser).includes('hub-hidden'));
        assert.ok(texts(forAdmin).includes('hub-hidden'));
        assert.ok(forUser.events.some((e) => e.event === 'delete' && e.json.id === deletedId));
        assert.equal(forUser.events[0].event, 'ready', 'fresh connection starts with ready');
    });

    test('reconnect replays missed events from the buffer', async () => {
        const first = await hubStream(user, null, { ms: 100 });
        const lastId = first.events.at(-1).id;
        await user.send('general', 'while-away');
        const again = await hubStream(user, null, { ms: 300, query: `&last_id=${encodeURIComponent(lastId)}` });
        assert.ok(again.events.some((e) => e.json && e.json.message === 'while-away'));
        assert.ok(!again.events.some((e) => e.event === 'ready'), 'no resync needed');
    });

    test('publish endpoint requires the shared secret', async () => {
        const r = await fetch(`${nodeBase}/internal/chat/publish`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'delete', id: 1, room_id: 'general' }),
        });
        assert.equal(r.status, 403);
    });
});
