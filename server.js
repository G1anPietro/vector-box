require('dotenv').config();
const os = require('os');
const express = require('express');
const session = require('express-session');
const { exec, spawn } = require('child_process');
const path = require('path');

const app = express();
app.set('trust proxy', true);
const PORT = process.env.PORT || 3000;

// Global process and client tracking
let mcProcess = null;
let activeWebClients = [];
let activePlayers = [];

// Security monitoring and IP tracking database
const ipTracker = new Map();

function getClientIp(req) {
    return req.headers['x-forwarded-for'] || req.socket.remoteAddress;
}

app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback_secret_matrix_key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, 
        maxAge: 24 * 60 * 60 * 1000 
    }
}));

app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// NATIVE OS TELEMETRY CALCULATOR (No os-utils)
// ==========================================
let lastCpuMeasure = os.cpus();

function getNativeCpuUsage() {
    const currentCpuMeasure = os.cpus();
    let idleDiff = 0;
    let totalDiff = 0;

    for (let i = 0; i < currentCpuMeasure.length; i++) {
        const prev = lastCpuMeasure[i].times;
        const curr = currentCpuMeasure[i].times;

        const prevTotal = prev.user + prev.nice + prev.sys + prev.idle + prev.irq;
        const currTotal = curr.user + curr.nice + curr.sys + curr.idle + curr.irq;

        totalDiff += (currTotal - prevTotal);
        idleDiff += (curr.idle - prev.idle);
    }

    lastCpuMeasure = currentCpuMeasure;
    return totalDiff === 0 ? 0 : Math.round(((totalDiff - idleDiff) / totalDiff) * 100);
}

// Global Telemetry Loop
setInterval(() => {
    if (activeWebClients.length === 0) return; 

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    
    const telemetryPayload = {
        cpu: getNativeCpuUsage(),
        ram: Math.round((usedMem / totalMem) * 100)
    };

    activeWebClients.forEach(client => {
        client.write(`event: telemetry\ndata: ${JSON.stringify(telemetryPayload)}\n\n`);
    });
}, 2000);

// ==========================================
// SECURITY & AUTHENTICATION ROUTES
// ==========================================
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === process.env.ADMIN_PASSWORD) {
        req.session.user = { name: 'Admin', role: 'admin' };
        return res.json({ success: true });
    } 
    if (username === 'guest' && password === process.env.GUEST_PASSWORD) {
        req.session.user = { name: 'Guest', role: 'guest' };
        return res.json({ success: true });
    }
    return res.status(401).json({ success: false, error: "Invalid credentials." });
});

app.get('/api/session', (req, res) => {
    res.json(req.session.user || null);
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// ==========================================
// HARDWARE POWER ACTIONS (WAKE-ON-LAN)
// ==========================================
app.post('/api/action/wakemainpc', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ success: false, error: "ACCESS DENIED: Admin authorization required." });
    }

    exec('/home/user/bin/wakemainpc.sh', (error, stdout, stderr) => {
        if (error) return res.status(500).json({ success: false, error: stderr || error.message });
        return res.json({ success: true });
    });
});

// ==========================================
// MINECRAFT PROCESS MANAGEMENT ENGINE
// ==========================================
app.post('/api/action/minecraft', (req, res) => {   
    if (!req.session.user) return res.status(401).json({ success: false, error: "Authentication required." });
    const { action } = req.body;

    if (action === 'start') {
        if (mcProcess) return res.json({ success: false, error: "Server instance already active." });

        mcProcess = spawn('bash', ['start.sh'], { 
            cwd: '/home/user/minecraft/minecraft_server' 
        });
        
        mcProcess.stdout.on('data', (data) => {
            const output = data.toString();
            activeWebClients.forEach(client => client.write(`event: log\ndata: ${output}\n\n`));

            const joinMatch = output.match(/:\s([a-zA-Z0-9_]{2,16})\sjoined the game/);
            const leaveMatch = output.match(/:\s([a-zA-Z0-9_]{2,16})\sleft the game/);

            if (joinMatch) {
                if (!activePlayers.includes(joinMatch[1])) activePlayers.push(joinMatch[1]);
                broadcastPlayers();
            }
            if (leaveMatch) {
                activePlayers = activePlayers.filter(p => p !== leaveMatch[1]);
                broadcastPlayers();
            }
        });

        function broadcastPlayers() {
            activeWebClients.forEach(client => {
                client.write(`event: players\ndata: ${JSON.stringify(activePlayers)}\n\n`);
            });
        }

        mcProcess.stderr.on('data', (data) => {
            activeWebClients.forEach(client => client.write(`event: log\ndata: ${data.toString()}\n\n`));
        });
        
        mcProcess.on('close', () => { mcProcess = null; });

        return res.json({ success: true, status: "initializing" });

    } else if (action === 'stop') {
        if (mcProcess && mcProcess.stdin) {
            mcProcess.stdin.write('stop\n');
            return res.json({ success: true, status: "terminating" });
        } else {
            exec('pkill -f server.jar');
            return res.json({ success: true, status: "force_terminated" });
        }
    }
});

app.post('/api/command', (req, res) => {
    if (!req.session.user) return res.status(401).json({ success: false });
    const { command } = req.body;

    if (mcProcess && mcProcess.stdin) {
        mcProcess.stdin.write(command + '\n');
        return res.json({ success: true });
    }
    return res.status(400).json({ success: false, error: "Process stream offline." });
});

// ==========================================
// PUBLIC TRANSMISSION & RATE-LIMITING DAEMON
// ==========================================
app.post('/api/message', async (req, res) => {
    const clientIp = getClientIp(req);
    const now = Date.now();
    const timeWindow = 60 * 1000;
    const maxMessages = 3;

    if (!ipTracker.has(clientIp)) {
        ipTracker.set(clientIp, { count: 0, windowStart: now, strikes: 0, bannedUntil: 0, permabanned: false });
    }
    
    const tracker = ipTracker.get(clientIp);

    if (tracker.permabanned) {
        return res.status(403).json({ success: false, error: "TERMINAL LOCKOUT: IP permanently blacklisted." });
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
            tracker.bannedUntil = now + (10 * 60 * 1000);
            return res.status(429).json({ success: false, error: "STRIKE 1: Spam detected. Uplink severed for 10 minutes." });
        } else if (tracker.strikes === 2) {
            tracker.bannedUntil = now + (60 * 60 * 1000);
            return res.status(429).json({ success: false, error: "STRIKE 2: Malicious spam detected. Uplink severed for 1 hour." });
        } else {
            tracker.permabanned = true;
            return res.status(429).json({ success: false, error: "STRIKE 3: MAXIMUM INFRACTIONS. IP PERMANENTLY BANNED." });
        }
    }

    const { message } = req.body;
    if (!message || message.trim() === "") {
        return res.status(400).json({ success: false, error: "Empty payload detected." });
    }

    try {
        await fetch('https://ntfy.sh/Messageg0kZ2n5yCH4Q', {
            method: 'POST',
            body: `IP Address: ${clientIp}\nMessage: ${message}`,
            headers: { 
                'Title': 'New Public Terminal Transmission', 
                'Tags': 'incoming_envelope,warning' 
            }
        });
    } catch (err) {
        console.error("Failed to route transmission out to ntfy.sh:", err);
    }

    return res.json({ success: true });
});

// ==========================================
// REAL-TIME STREAMING ENDPOINT (SSE)
// ==========================================
app.get('/api/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    if (!req.session || !req.session.user) {
        res.write("event: unauthorized\n");
        res.write("data: Session expired or invalid\n\n");
        return res.end();
    }
    
    activeWebClients.push(res);

    res.on('close', () => {
        activeWebClients = activeWebClients.filter(client => client !== res);
    });
});

// Static HTML Specific Endpoints
app.get('/ads.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'ads.html'));
});

// Wildcard Route Fallback (Must remain last)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.php'));
});

app.listen(PORT, () => {
    console.log(`>>> System Hypervisor fully operational on interface port: ${PORT}`);
});

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
        console.log("\n=== ACTIVE SYSTEM BLACKLIST ===");
        let activeBansFound = 0;
        
        ipTracker.forEach((tracker, ip) => {
            if (tracker.permabanned || tracker.bannedUntil > Date.now()) {
                const status = tracker.permabanned ? "PERMANENT" : `TEMPORARY (Expires in: ${Math.ceil((tracker.bannedUntil - Date.now()) / 60000)}m)`;
                console.log(` - IP: ${ip} | Strikes: ${tracker.strikes}/3 | Status: ${status}`);
                activeBansFound++;
            }
        });
        
        if (activeBansFound === 0) {
            console.log("Database clean. Zero active network lockouts.");
        }
        console.log("===============================\n");
    }
});