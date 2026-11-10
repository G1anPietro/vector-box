require('dotenv').config();
const os = require('os');
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const session = require('express-session');
const { execFile, spawn } = require('child_process');

// ==========================================
// CONFIGURATION (fail fast on missing secrets)
// ==========================================
const REQUIRED_ENV = ['SESSION_SECRET', 'ADMIN_PASSWORD', 'GUEST_PASSWORD'];
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingEnv.length) {
    console.error(`>>> FATAL: missing required environment variables: ${missingEnv.join(', ')} (see .env.example)`);
    process.exit(1);
}

const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const MC_DIR = process.env.MC_DIR || '/home/user/minecraft/minecraft_server';
const WAKE_SCRIPT = process.env.WAKE_SCRIPT || '/home/user/bin/wakemainpc.sh';
const NTFY_TOPIC_URL = process.env.NTFY_TOPIC_URL || '';
const MAX_MESSAGE_LENGTH = 500;

const app = express();
// Trust only the configured proxy hops so X-Forwarded-For can't be spoofed by clients.
// e.g. TRUST_PROXY=loopback (default), TRUST_PROXY=1, TRUST_PROXY=10.0.0.0/8
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');
app.disable('x-powered-by');

// Global process and client tracking
let mcProcess = null;
const activeWebClients = new Set();
let activePlayers = [];

const ipTracker = new Map();

function getClientIp(req) {
    return req.ip || req.socket.remoteAddress || 'unknown';
}

// ==========================================
// MIDDLEWARE
// ==========================================
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

app.use(express.json({ limit: '10kb' }));
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    name: 'vb.sid',
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : IS_PROD,
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// Never serve server-side sources / config straight from the static folder
app.use((req, res, next) => {
    if (/\.(php|ini|inc|sqlite|log)$/i.test(req.path)) return res.status(404).end();
    next();
});
app.use(express.static(path.join(__dirname, 'public'), { index: false, dotfiles: 'ignore' }));

const requireAuth = (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ success: false, error: 'Authentication required.' });
    next();
};
const requireAdmin = (req, res, next) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'ACCESS DENIED: Admin authorization required.' });
    }
    next();
};

// CSRF: state-changing requests must be JSON (blocks cross-site form posts) and same-origin
const requireSameOrigin = (req, res, next) => {
    const origin = req.get('origin');
    if (origin) {
        let originHost;
        try { originHost = new URL(origin).host; } catch (e) { originHost = null; }
        if (originHost !== req.get('host')) {
            return res.status(403).json({ success: false, error: 'Cross-origin request blocked.' });
        }
    }
    if (!req.is('application/json')) {
        return res.status(415).json({ success: false, error: 'Content-Type must be application/json.' });
    }
    next();
};

function safeEqual(a, b) {
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
}

// Simple fixed-window limiter (per key)
function makeLimiter(max, windowMs) {
    const hits = new Map();
    setInterval(() => {
        const now = Date.now();
        for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
    }, windowMs).unref();

    return (key) => {
        const now = Date.now();
        const entry = hits.get(key);
        if (!entry || now - entry.start > windowMs) {
            hits.set(key, { start: now, count: 1 });
            return true;
        }
        entry.count++;
        return entry.count <= max;
    };
}
const loginLimiter = makeLimiter(8, 5 * 60 * 1000);

// ==========================================
// NATIVE OS TELEMETRY CALCULATOR
// ==========================================
let lastCpuMeasure = os.cpus();

function getNativeCpuUsage() {
    const current = os.cpus();
    let idleDiff = 0;
    let totalDiff = 0;

    const cores = Math.min(current.length, lastCpuMeasure.length);
    for (let i = 0; i < cores; i++) {
        const prev = lastCpuMeasure[i].times;
        const curr = current[i].times;
        const prevTotal = prev.user + prev.nice + prev.sys + prev.idle + prev.irq;
        const currTotal = curr.user + curr.nice + curr.sys + curr.idle + curr.irq;
        totalDiff += currTotal - prevTotal;
        idleDiff += curr.idle - prev.idle;
    }

    lastCpuMeasure = current;
    return totalDiff === 0 ? 0 : Math.round(((totalDiff - idleDiff) / totalDiff) * 100);
}

// ==========================================
// SSE HELPERS
// ==========================================
function sseSend(client, event, data) {
    // SSE payloads can't contain raw newlines: one "data:" field per line
    const lines = String(data).split(/\r?\n/);
    client.write(`event: ${event}\n${lines.map((l) => `data: ${l}`).join('\n')}\n\n`);
}

function broadcast(event, data, adminOnly = false) {
    for (const client of activeWebClients) {
        if (adminOnly && !client.isAdminStream) continue;
        sseSend(client, event, data);
    }
}

function broadcastPlayers() {
    broadcast('players', JSON.stringify(activePlayers));
}

setInterval(() => {
    if (activeWebClients.size === 0) return;
    const totalMem = os.totalmem();
    const usedMem = totalMem - os.freemem();
    broadcast('telemetry', JSON.stringify({
        cpu: getNativeCpuUsage(),
        ram: Math.round((usedMem / totalMem) * 100)
    }));
}, 2000);

// Keep-alive so proxies don't drop idle SSE connections
setInterval(() => {
    for (const client of activeWebClients) client.write(': heartbeat\n\n');
    for (const client of chatClients) client.res.write(': heartbeat\n\n');
}, 25000);

// ==========================================
// AUTHENTICATION ROUTES
// ==========================================
app.post('/api/login', requireSameOrigin, (req, res) => {
    if (!loginLimiter(getClientIp(req))) {
        return res.status(429).json({ success: false, error: 'Too many attempts. Try again later.' });
    }

    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ success: false, error: 'Invalid payload.' });
    }

    let user = null;
    if (username === 'admin' && safeEqual(password, process.env.ADMIN_PASSWORD)) {
        user = { name: 'Admin', role: 'admin' };
    } else if (username === 'guest' && safeEqual(password, process.env.GUEST_PASSWORD)) {
        user = { name: 'Guest', role: 'guest' };
    }

    if (!user) return res.status(401).json({ success: false, error: 'Invalid credentials.' });

    // Prevent session fixation
    req.session.regenerate((err) => {
        if (err) return res.status(500).json({ success: false, error: 'Session error.' });
        req.session.user = user;
        res.json({ success: true });
    });
});

app.get('/api/session', (req, res) => {
    res.json(req.session.user || null);
});

app.post('/api/logout', requireSameOrigin, (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('vb.sid');
        res.json({ success: true });
    });
});

// ==========================================
// HARDWARE POWER ACTIONS (WAKE-ON-LAN)
// ==========================================
app.post('/api/action/wakemainpc', requireSameOrigin, requireAdmin, (req, res) => {
    execFile(WAKE_SCRIPT, { timeout: 15000 }, (error, stdout, stderr) => {
        if (error) {
            console.error('wakemainpc failed:', stderr || error.message);
            return res.status(500).json({ success: false, error: 'Wake-on-LAN failed.' });
        }
        res.json({ success: true });
    });
});

// ==========================================
// MINECRAFT PROCESS MANAGEMENT (admin only)
// ==========================================
function attachLineReader(stream, onLine) {
    let buffer = '';
    stream.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop(); // keep incomplete trailing line for the next chunk
        lines.forEach(onLine);
    });
}

function handleMinecraftLine(line) {
    if (!line) return;
    broadcast('log', line, true); // console output: admins only

    const joinMatch = line.match(/:\s([a-zA-Z0-9_]{2,16})\sjoined the game/);
    const leaveMatch = line.match(/:\s([a-zA-Z0-9_]{2,16})\sleft the game/);

    if (joinMatch && !activePlayers.includes(joinMatch[1])) {
        activePlayers.push(joinMatch[1]);
        broadcastPlayers();
    }
    if (leaveMatch) {
        activePlayers = activePlayers.filter((p) => p !== leaveMatch[1]);
        broadcastPlayers();
    }
}

function startMinecraft() {
    mcProcess = spawn('bash', ['start.sh'], { cwd: MC_DIR });
    attachLineReader(mcProcess.stdout, handleMinecraftLine);
    attachLineReader(mcProcess.stderr, handleMinecraftLine);
    mcProcess.on('error', (err) => {
        console.error('Minecraft spawn error:', err.message);
        mcProcess = null;
    });
    mcProcess.on('close', () => {
        mcProcess = null;
        activePlayers = [];
        broadcastPlayers();
    });
}

app.post('/api/action/minecraft', requireSameOrigin, requireAdmin, (req, res) => {
    const { action } = req.body || {};

    if (action === 'start') {
        if (mcProcess) return res.json({ success: false, error: 'Server instance already active.' });
        startMinecraft();
        return res.json({ success: true, status: 'initializing' });
    }

    if (action === 'stop') {
        if (!mcProcess) return res.json({ success: false, error: 'Server instance is not running.' });

        if (mcProcess.stdin && mcProcess.stdin.writable) {
            mcProcess.stdin.write('stop\n');
            // Escalate if the server doesn't stop on its own (kills only OUR child, never other processes)
            const proc = mcProcess;
            setTimeout(() => { if (mcProcess === proc) proc.kill('SIGKILL'); }, 60000).unref();
            return res.json({ success: true, status: 'terminating' });
        }
        mcProcess.kill('SIGKILL');
        return res.json({ success: true, status: 'force_terminated' });
    }

    return res.status(400).json({ success: false, error: 'Unknown action.' });
});

app.post('/api/command', requireSameOrigin, requireAdmin, (req, res) => {
    const { command } = req.body || {};
    if (typeof command !== 'string' || !command.trim() || command.length > 256) {
        return res.status(400).json({ success: false, error: 'Invalid command.' });
    }
    if (!mcProcess || !mcProcess.stdin || !mcProcess.stdin.writable) {
        return res.status(400).json({ success: false, error: 'Process stream offline.' });
    }
    // One command per request: strip line breaks so nothing extra can be injected
    mcProcess.stdin.write(command.replace(/[\r\n]+/g, ' ').trim() + '\n');
    res.json({ success: true });
});

// ==========================================
// PUBLIC TRANSMISSION & RATE-LIMITING DAEMON
// ==========================================
app.post('/api/message', requireSameOrigin, async (req, res) => {
    const clientIp = getClientIp(req);
    const now = Date.now();
    const timeWindow = 60 * 1000;
    const maxMessages = 3;

    if (!ipTracker.has(clientIp)) {
        ipTracker.set(clientIp, { count: 0, windowStart: now, strikes: 0, bannedUntil: 0, permabanned: false });
    }
    const tracker = ipTracker.get(clientIp);

    if (tracker.permabanned) {
        return res.status(403).json({ success: false, error: 'TERMINAL LOCKOUT: IP permanently blacklisted.' });
    }
    if (tracker.bannedUntil > now) {
        const remainingMins = Math.ceil((tracker.bannedUntil - now) / 60000);
        return res.status(403).json({ success: false, error: `CONNECTION REFUSED: Temporary lockout active for ${remainingMins} minutes.` });
    }

    if (now - tracker.windowStart > timeWindow) {
        tracker.count = 0;
        tracker.windowStart = now;
    }

    tracker.count++;
    if (tracker.count > maxMessages) {
        tracker.strikes++;
        tracker.count = 0;

        if (tracker.strikes === 1) {
            tracker.bannedUntil = now + 10 * 60 * 1000;
            return res.status(429).json({ success: false, error: 'STRIKE 1: Spam detected. Uplink severed for 10 minutes.' });
        } else if (tracker.strikes === 2) {
            tracker.bannedUntil = now + 60 * 60 * 1000;
            return res.status(429).json({ success: false, error: 'STRIKE 2: Malicious spam detected. Uplink severed for 1 hour.' });
        }
        tracker.permabanned = true;
        return res.status(429).json({ success: false, error: 'STRIKE 3: MAXIMUM INFRACTIONS. IP PERMANENTLY BANNED.' });
    }

    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) return res.status(400).json({ success: false, error: 'Empty payload detected.' });
    if (message.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json({ success: false, error: `MESSAGE_TOO_LONG: Maximum length is ${MAX_MESSAGE_LENGTH} characters` });
    }
    if (!NTFY_TOPIC_URL) {
        console.error('NTFY_TOPIC_URL is not configured');
        return res.status(503).json({ success: false, error: 'Transmission channel is not configured.' });
    }

    try {
        const resp = await fetch(NTFY_TOPIC_URL, {
            method: 'POST',
            body: `IP Address: ${clientIp}\nMessage: ${message}`,
            headers: { 'Title': 'New Public Terminal Transmission', 'Tags': 'incoming_envelope,warning' },
            signal: AbortSignal.timeout(5000)
        });
        if (!resp.ok) throw new Error(`ntfy responded ${resp.status}`);
    } catch (err) {
        console.error('Failed to route transmission out to ntfy:', err.message);
        return res.status(502).json({ success: false, error: 'Failed to route transmission.' });
    }

    return res.json({ success: true });
});

// Drop idle, non-banned tracker entries so the map doesn't grow forever
setInterval(() => {
    const now = Date.now();
    for (const [ip, t] of ipTracker) {
        if (!t.permabanned && t.bannedUntil < now && now - t.windowStart > 60 * 60 * 1000 && t.strikes === 0) {
            ipTracker.delete(ip);
        }
    }
}, 10 * 60 * 1000).unref();

// ==========================================
// REAL-TIME STREAMING ENDPOINT (SSE)
// ==========================================
app.get('/api/stream', (req, res) => {
    if (!req.session || !req.session.user) {
        return res.status(401).end();
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Only admins receive the Minecraft console; everyone logged in gets telemetry/players
    res.isAdminStream = req.session.user.role === 'admin';
    activeWebClients.add(res);
    sseSend(res, 'players', JSON.stringify(activePlayers));

    req.on('close', () => activeWebClients.delete(res));
});

// ==========================================
// CHAT HUB (optional; enabled by CHAT_HUB_SECRET)
// PHP stores every message, then POSTs it to /internal/chat/publish.
// Browsers hold ONE SSE connection here instead of polling PHP.
// ==========================================
const CHAT_HUB_SECRET = process.env.CHAT_HUB_SECRET || '';
const CHAT_CORS_ORIGINS = (process.env.CHAT_STREAM_CORS_ORIGIN || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
const CHAT_MAX_CLIENTS = 500;
const CHAT_BUFFER_MAX = 500;
// Event ids are "<bootId>-<seq>": after a restart old ids never match and the
// client is told to resync instead of silently missing events.
const CHAT_BOOT_ID = crypto.randomBytes(4).toString('hex');
let chatSeq = 0;
const chatBuffer = [];        // [{ seq, hidden, frame }]
const chatClients = new Set(); // { res, isAdmin }

function isLoopback(addr) {
    return addr === '127.0.0.1' || addr === '::1' || (typeof addr === 'string' && addr.startsWith('::ffff:127.'));
}

function verifyChatToken(token) {
    if (!CHAT_HUB_SECRET || typeof token !== 'string') return null;
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expected = crypto.createHmac('sha256', CHAT_HUB_SECRET).update(body).digest('base64url');
    if (!safeEqual(sig, expected)) return null;
    let payload;
    try {
        payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch (e) {
        return null;
    }
    if (!payload || payload.p !== 'chat' || typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) {
        return null;
    }
    return { isAdmin: payload.adm === 1 };
}

const chatEventId = (seq) => `${CHAT_BOOT_ID}-${seq}`;

function chatPublish(hidden, eventName, data) {
    const seq = ++chatSeq;
    const frame = `id: ${chatEventId(seq)}\n${eventName ? `event: ${eventName}\n` : ''}data: ${JSON.stringify(data)}\n\n`;
    chatBuffer.push({ seq, hidden, frame });
    if (chatBuffer.length > CHAT_BUFFER_MAX) chatBuffer.shift();

    for (const client of chatClients) {
        if (hidden && !client.isAdmin) continue;
        client.res.write(frame);
    }
}

const isStr = (v, max) => typeof v === 'string' && v.length <= max;
const isRoomId = (v) => typeof v === 'string' && /^[a-z0-9_-]{1,50}$/.test(v);
const isPosInt = (v) => Number.isInteger(v) && v > 0;

app.post('/internal/chat/publish', (req, res) => {
    // Only PHP on this machine may publish: loopback, not via the proxy, with the shared secret
    if (!CHAT_HUB_SECRET || !isLoopback(req.socket.remoteAddress) || req.get('x-forwarded-for')) {
        return res.status(404).end();
    }
    if (!safeEqual(req.get('x-chat-hub-secret') || '', CHAT_HUB_SECRET)) {
        return res.status(403).end();
    }

    const ev = req.body || {};
    const hidden = ev.hidden === true;

    if (ev.type === 'message') {
        const m = ev.message || {};
        if (!isPosInt(m.id) || !isRoomId(m.room_id) || !isStr(m.username, 100) || !isStr(m.message, 4000)
            || !isStr(m.date, 10) || !isStr(m.created_at, 8)) {
            return res.status(400).json({ success: false });
        }
        chatPublish(hidden, null, {
            id: m.id, room_id: m.room_id, username: m.username,
            message: m.message, date: m.date, created_at: m.created_at
        });
    } else if (ev.type === 'delete') {
        if (!isPosInt(ev.id) || !isRoomId(ev.room_id)) return res.status(400).json({ success: false });
        chatPublish(hidden, 'delete', { id: ev.id, room_id: ev.room_id });
    } else {
        return res.status(400).json({ success: false });
    }
    return res.json({ success: true });
});

app.get('/api/chat/stream', (req, res) => {
    if (!CHAT_HUB_SECRET) return res.status(404).end();

    const origin = req.get('origin');
    if (origin && CHAT_CORS_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }

    const auth = verifyChatToken(req.query.token);
    if (!auth) return res.status(401).end();
    if (chatClients.size >= CHAT_MAX_CLIENTS) return res.status(503).end();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write('retry: 2000\n\n');

    // Resume: replay what the client missed if we still have it, else ask it to resync
    const lastId = String(req.get('last-event-id') || req.query.last_id || '');
    const m = /^([0-9a-f]{8})-(\d+)$/.exec(lastId);
    const lastSeq = m && m[1] === CHAT_BOOT_ID ? Number(m[2]) : -1;
    const oldestSeq = chatBuffer.length ? chatBuffer[0].seq : chatSeq + 1;

    if (lastSeq >= oldestSeq - 1 && lastSeq <= chatSeq) {
        for (const e of chatBuffer) {
            if (e.seq > lastSeq && (!e.hidden || auth.isAdmin)) res.write(e.frame);
        }
    } else {
        // Fresh connection or gap we can't fill: client reloads from PHP
        res.write(`id: ${chatEventId(chatSeq)}\nevent: ready\ndata: {}\n\n`);
    }

    const client = { res, isAdmin: auth.isAdmin };
    chatClients.add(client);
    req.on('close', () => chatClients.delete(client));
});

// Static HTML specific endpoint
app.get('/ads.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'ads.html'), (err) => {
        if (err) res.status(404).end();
    });
});

// Fallback: this server doesn't execute PHP, so never send .php sources to the browser
app.use((req, res) => {
    res.status(404).type('text/plain').send('Not found');
});

const server = app.listen(PORT, () => {
    console.log(`>>> System Hypervisor fully operational on interface port: ${PORT}`);
});

// ==========================================
// GRACEFUL SHUTDOWN
// ==========================================
function shutdown(signal) {
    console.log(`>>> ${signal} received, shutting down...`);
    if (mcProcess && mcProcess.stdin && mcProcess.stdin.writable) mcProcess.stdin.write('stop\n');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ==========================================
// CLI MANAGEMENT COMMAND LISTENERS
// ==========================================
process.stdin.setEncoding('utf8');
process.stdin.on('data', (data) => {
    const input = data.trim();

    if (input.startsWith('sys_unban ')) {
        const targetIp = input.split(' ')[1];
        if (ipTracker.has(targetIp)) {
            ipTracker.delete(targetIp);
            console.log(`\x1b[32m>> SUCCESS: IP ${targetIp} has been purged from the blacklist system.\x1b[0m`);
        } else {
            console.log(`\x1b[33m>> WARN: IP ${targetIp} was not found in the blacklist database.\x1b[0m`);
        }
    } else if (input === 'sys_list_bans') {
        console.log('\n=== ACTIVE SYSTEM BLACKLIST ===');
        let activeBansFound = 0;

        ipTracker.forEach((tracker, ip) => {
            if (tracker.permabanned || tracker.bannedUntil > Date.now()) {
                const status = tracker.permabanned ? 'PERMANENT' : `TEMPORARY (Expires in: ${Math.ceil((tracker.bannedUntil - Date.now()) / 60000)}m)`;
                console.log(` - IP: ${ip} | Strikes: ${tracker.strikes}/3 | Status: ${status}`);
                activeBansFound++;
            }
        });

        if (activeBansFound === 0) console.log('Database clean. Zero active network lockouts.');
        console.log('===============================\n');
    }
});
