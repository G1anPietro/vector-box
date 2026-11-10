// tests/helpers.js
// Test harness: runs the PHP site from a throwaway copy with an EMPTY data/ dir
// (fresh DB created by the migrations), so the real database is never touched.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');

function freePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.unref();
        srv.on('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
    });
}

async function waitForPort(port, timeoutMs = 5000) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
        const ok = await new Promise((resolve) => {
            const s = net.connect(port, '127.0.0.1', () => { s.end(); resolve(true); });
            s.on('error', () => resolve(false));
        });
        if (ok) return;
        await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`port ${port} did not open`);
}

/**
 * Start an isolated site. `env` lines are written to the copy's .env.
 * Returns { base, root, db(sql), stop() }.
 */
async function startSite(env = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-test-'));
    fs.cpSync(path.join(REPO, 'public'), path.join(root, 'public'), { recursive: true });
    fs.mkdirSync(path.join(root, 'data'), { mode: 0o750 });
    fs.writeFileSync(path.join(root, '.env'),
        Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');

    const port = await freePort();
    const proc = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', path.join(root, 'public')], {
        env: { ...process.env, PHP_CLI_SERVER_WORKERS: '6' },
        stdio: 'ignore',
    });
    await waitForPort(port);

    const site = {
        base: `http://127.0.0.1:${port}`,
        root,
        /** Run SQL against the test DB (after the first request created it). */
        db(sql, params = []) {
            const script = '$d = new PDO("sqlite:" . $argv[1]); $s = $d->prepare($argv[2]);'
                + ' $s->execute(json_decode($argv[3], true)); echo json_encode($s->fetchAll(PDO::FETCH_ASSOC));';
            const out = execFileSync('php', ['-r', script, path.join(root, 'data', 'vector_uplink.sqlite'), sql, JSON.stringify(params)]);
            return JSON.parse(out.toString() || '[]');
        },
        async stop() {
            proc.kill();
            fs.rmSync(root, { recursive: true, force: true });
        },
    };
    // First request runs the migrations
    await new Client(site).get('/api/check_session.php');
    return site;
}

/** Minimal browser: keeps cookies, knows its CSRF token. */
class Client {
    constructor(site) {
        this.site = site;
        this.cookies = new Map();
        this.csrf = '';
    }

    cookieHeader() {
        return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    }

    storeCookies(res) {
        for (const c of res.headers.getSetCookie()) {
            const [pair] = c.split(';');
            const i = pair.indexOf('=');
            this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
        }
    }

    async request(method, url, { body, headers = {}, csrf = true } = {}) {
        const h = { ...headers };
        if (this.cookies.size) h.Cookie = this.cookieHeader();
        if (body !== undefined) h['Content-Type'] = 'application/json';
        if (csrf && method !== 'GET' && this.csrf) h['X-CSRF-Token'] = this.csrf;
        const res = await fetch(this.site.base + url, {
            method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual',
        });
        this.storeCookies(res);
        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
        return { status: res.status, json, text, headers: res.headers };
    }

    get(url, opts) { return this.request('GET', url, opts); }
    post(url, body, opts = {}) { return this.request('POST', url, { ...opts, body }); }

    /** Load a session + CSRF token like the page does on startup. */
    async init() {
        const r = await this.get('/api/check_session.php');
        this.csrf = r.json.csrf_token;
        this.session = r.json;
        return this;
    }

    async register(username, password = 'password123') {
        await this.init();
        const r = await this.post('/api/login.php', { action: 'register', username, password });
        if (r.json && r.json.csrf_token) this.csrf = r.json.csrf_token;
        return r;
    }

    async login(username, password = 'password123') {
        await this.init();
        const r = await this.post('/api/login.php', { username, password });
        if (r.json && r.json.csrf_token) this.csrf = r.json.csrf_token;
        return r;
    }

    send(room, message) {
        return this.post('/api/uplink_send.php', { room_id: room, message });
    }

    /** Read an SSE endpoint for `ms` milliseconds and return the parsed events. */
    async stream(url, { ms = 1500, headers = {} } = {}) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), ms);
        const h = { ...headers };
        if (this.cookies.size) h.Cookie = this.cookieHeader();
        let raw = '';
        let status = 0;
        try {
            const res = await fetch(this.site.base + url, { headers: h, signal: ctrl.signal });
            status = res.status;
            const dec = new TextDecoder();
            for await (const chunk of res.body) raw += dec.decode(chunk, { stream: true });
        } catch (e) {
            if (e.name !== 'AbortError') throw e;
        } finally {
            clearTimeout(timer);
        }
        return { status, events: parseSse(raw) };
    }
}

function parseSse(raw) {
    return raw.split(/\n\n/).map((block) => {
        const ev = { event: 'message', id: null, data: null };
        let has = false;
        for (const line of block.split('\n')) {
            const m = /^(id|event|data): ?(.*)$/.exec(line);
            if (!m) continue;
            has = true;
            if (m[1] === 'data') ev.data = (ev.data === null ? '' : ev.data + '\n') + m[2];
            else ev[m[1]] = m[2];
        }
        if (has && ev.data !== null) { try { ev.json = JSON.parse(ev.data); } catch (e) { /* plain */ } }
        return has ? ev : null;
    }).filter(Boolean);
}

/** Create an admin account directly in the test DB and return a logged-in client. */
async function makeAdmin(site, username = 'root_admin') {
    const c = new Client(site);
    await c.register(username);
    site.db('UPDATE accounts SET is_admin = 1 WHERE username = ?', [username]);
    await c.login(username);
    return c;
}

module.exports = { startSite, Client, makeAdmin, parseSse, freePort, waitForPort, REPO };
