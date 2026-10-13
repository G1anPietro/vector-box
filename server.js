require('dotenv').config();
const osUtils = require('os-utils');
const os = require('os');
const express = require('express');
const session = require('express-session');
const { exec, spawn } = require('child_process'); // Single clean declaration
const path = require('path');

const app = express();
app.set('trust proxy', true);
const PORT = process.env.PORT || 3000;

// Global memory slot to keep the active Minecraft stream open
let mcProcess = null;
let activeWebClients = [];
let activePlayers = []; // Track players in memory

// ==========================================
// SECURITY MONITORING: PUBLIC BAN DATABASE
// ==========================================
const ipTracker = new Map();
// Structure: { count: number, windowStart: timestamp, strikes: number, bannedUntil: timestamp, permabanned: boolean }

function getClientIp(req) {
    // Correctly resolve client IP whether behind an Nginx proxy or connecting directly
    return req.headers['x-forwarded-for'] || req.socket.remoteAddress;
}

app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback_secret_matrix_key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // Set to true if forcing HTTPS via Nginx proxy
        maxAge: 24 * 60 * 60 * 1000 
    }
}));

app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// SECURITY & IDENTITY LOGIC
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
// WAKE ON LAN (ADMIN LAYER ONLY)
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
// INTERACTIVE MINECRAFT CONSOLE ENGINE
// ==========================================
app.post('/api/action/minecraft', (req, res) => {   
    if (!req.session.user) return res.status(401).json({ success: false, error: "Authentication required." });
    const { action } = req.body;

    if (action === 'start') {
        if (mcProcess) return res.json({ success: false, error: "Server instance already active." });

        // Explicitly spawn bash and point to your exact directory path
        mcProcess = spawn('bash', ['start.sh'], { 
            cwd: '/home/user/minecraft/minecraft_server' 
        });
        
        // Push process logs out to PM2 AND to the web dashboard
        mcProcess.stdout.on('data', (data) => {
            const output = data.toString();
            console.log(`[MC]: ${output}`);
            
            // Broadcast raw log
            activeWebClients.forEach(client => client.write(`event: log\ndata: ${output}\n\n`));

            // Regex Player Tracking
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

        // Helper function to broadcast updated array
        function broadcastPlayers() {
            activeWebClients.forEach(client => {
                client.write(`event: players\ndata: ${JSON.stringify(activePlayers)}\n\n`);
            });
        }
        mcProcess.stderr.on('data', (data) => {
            console.error(`[MC ERR]: ${data}`);
            activeWebClients.forEach(client => client.write(`event: log\ndata: ${data.toString()}\n\n`));
        });

        // ==========================================
        // REAL-TIME SYSTEM TELEMETRY BROADCAST LOOP
        // ==========================================
        setInterval(() => {
            if (activeWebClients.length === 0) return; 

            osUtils.cpuUsage((cpuPercent) => {
                const totalMem = os.totalmem();
                const freeMem = os.freemem();
                const usedMem = totalMem - freeMem;
                
                const telemetryPayload = {
                    cpu: Math.round(cpuPercent * 100),
                    ram: Math.round((usedMem / totalMem) * 100)
                };

                // TEMPORARY DEBUG: Check pm2 logs to see if this prints valid numbers!
                console.log(`[TELEMETRY] CPU: ${telemetryPayload.cpu}% | RAM: ${telemetryPayload.ram}%`);

                activeWebClients.forEach(client => {
                    client.write(`event: telemetry\ndata: ${JSON.stringify(telemetryPayload)}\n\n`);
                });
            });
        }, 2000);// Polls and broadcasts every 2 seconds
        
        mcProcess.on('close', () => { mcProcess = null; });

        return res.json({ success: true, status: "initializing" });

    } else if (action === 'stop') {
        if (mcProcess && mcProcess.stdin) {
            mcProcess.stdin.write('stop\n'); // Graceful native game save and shutdown
            return res.json({ success: true, status: "terminating" });
        } else {
            exec('pkill -f server.jar'); // Hard fallback cutoff if stream broke
            return res.json({ success: true, status: "force_terminated" });
        }
    }
});

// PASS RAW CONSOLE INPUT DIRECTLY TO JAVA ENGINE
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
// PUBLIC MESSAGE & BLACKLIST RATE LIMITER
// ==========================================
app.post('/api/message', async (req, res) => {
    const clientIp = getClientIp(req);
    const now = Date.now();
    const timeWindow = 60 * 1000; // 60 seconds tracking interval
    const maxMessages = 3;        // Max messages allowed per minute before a strike is issued

    // Initialize track profile for new IPs
    if (!ipTracker.has(clientIp)) {
        ipTracker.set(clientIp, { count: 0, windowStart: now, strikes: 0, bannedUntil: 0, permabanned: false });
    }
    
    const tracker = ipTracker.get(clientIp);

    // 1. Check Permanent Blacklist
    if (tracker.permabanned) {
        return res.status(403).json({ success: false, error: "TERMINAL LOCKOUT: IP permanently blacklisted." });
    }

    // 2. Check Temporary Penalty Blacklist
    if (tracker.bannedUntil > now) {
        const remainingMins = Math.ceil((tracker.bannedUntil - now) / 60000);
        return res.status(403).json({ success: false, error: `CONNECTION REFUSED: Temporary lockout active for ${remainingMins} minutes.` });
    }

    // 3. Reset rate-limit timer window if 60s has passed
    if (now - tracker.windowStart > timeWindow) {
        tracker.count = 0;
        tracker.windowStart = now;
    }

    // 4. Increment message usage and process infraction checks
    tracker.count++;
    if (tracker.count > maxMessages) {
        tracker.strikes++;
        tracker.count = 0; // Reset rate counts for the next window

        if (tracker.strikes === 1) {
            tracker.bannedUntil = now + (10 * 60 * 1000); // 10 Minute Ban
            return res.status(429).json({ success: false, error: "STRIKE 1: Spam detected. Uplink severed for 10 minutes." });
        } else if (tracker.strikes === 2) {
            tracker.bannedUntil = now + (60 * 60 * 1000); // 1 Hour Ban
            return res.status(429).json({ success: false, error: "STRIKE 2: Malicious spam detected. Uplink severed for 1 hour." });
        } else {
            tracker.permabanned = true; // Permanent Blacklist
            return res.status(429).json({ success: false, error: "STRIKE 3: MAXIMUM INFRACTIONS. IP PERMANENTLY BANNED." });
        }
    }

    // 5. Parse and Validate the Input Payload
    const { message } = req.body;
    if (!message || message.trim() === "") {
        return res.status(400).json({ success: false, error: "Empty payload detected." });
    }

    // Save locally to PM2 log console
    console.log(`[PUBLIC MESSAGE] From IP ${clientIp}: ${message}`);

// Transmit push notification securely to your phone via public ntfy.sh
    try {
        await fetch('https://ntfy.sh/Messageg0kZ2n5yCH4Q', {  // Back to the public URL!
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

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});



app.listen(PORT, () => {
    console.log(`>>> System Hypervisor fully operational on interface port: ${PORT}`);
});

// ==========================================
// SYSTEM CONSOLE TERMINAL INPUT LISTENERS
// ==========================================
process.stdin.setEncoding('utf8');
process.stdin.on('data', (data) => {
    const input = data.trim();

    if (input.startsWith('sys_unban ')) {
        const targetIp = input.split(' ')[1];
        if (ipTracker.has(targetIp)) {
            ipTracker.delete(targetIp); // Completely wipes tracking history & bans
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

// LIVE LOG STREAM TUNNEL
app.get('/api/stream', (req, res) => {
    // 1. ALWAYS set these headers FIRST. This prevents the browser from throwing the MIME-type error!
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // Forces Nginx to flush these headers to the browser immediately

    // 2. Reject unauthorized users gracefully over the stream instead of a raw HTTP 401
    if (!req.session || !req.session.user) {
        res.write("event: unauthorized\n");
        res.write("data: Session expired or invalid\n\n");
        return res.end(); // Safely shut down this stream
    }
    
    activeWebClients.push(res);

    // 3. res.on('close') is much more reliable for tracking SSE disconnects behind Nginx
    res.on('close', () => {
        activeWebClients = activeWebClients.filter(client => client !== res);
    });

    app.get('/ads.html', (req, res) => {
        res.sendFile(path.join(__dirname, 'ads.html'));
    });
});