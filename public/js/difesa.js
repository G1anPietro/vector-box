// js/difesa.js — "Difendi il server", a tower defense. The rules (no DOM, no randomness) are at the top and can be tested from Node.
(function (root) {
    'use strict';
    const W = 12, H = 8, MAX_WAVE = 30, START_MONEY = 150, START_LIVES = 20, DT = 1 / 30;
    // Virus walk this path from the entrance (left) to the core (right-bottom). Cells on it cannot hold towers.
    const WAYPOINTS = [[0, 1], [10, 1], [10, 3], [1, 3], [1, 5], [11, 5]];

    const TOWERS = {
        firewall:  { cost: 40, range: 2.0, dmg: 3,  cd: 0.9, slow: 0.5, slowTime: 1.5 },   // slows what it hits
        antivirus: { cost: 50, range: 2.6, dmg: 14, cd: 0.7 },                              // one target, quick
        ids:       { cost: 90, range: 2.2, dmg: 10, cd: 1.3, splash: 1.1 },                 // hits everything near the target
    };
    const ENEMIES = {
        packet: { hp: 18,  speed: 1.7,  reward: 4,   dmg: 1 },
        worm:   { hp: 42,  speed: 1.2,  reward: 6,   dmg: 1 },
        trojan: { hp: 110, speed: 0.8,  reward: 10,  dmg: 2 },
        boss:   { hp: 900, speed: 0.55, reward: 120, dmg: 5 },
    };

    function buildPath() {
        const segs = []; let len = 0; const cells = new Set();
        for (let i = 0; i + 1 < WAYPOINTS.length; i++) {
            const [ax, ay] = WAYPOINTS[i], [bx, by] = WAYPOINTS[i + 1];
            const l = Math.abs(bx - ax) + Math.abs(by - ay);
            segs.push({ ax, ay, dx: Math.sign(bx - ax), dy: Math.sign(by - ay), from: len, l });
            for (let k = 0; k <= l; k++) cells.add((ay + Math.sign(by - ay) * k) * W + ax + Math.sign(bx - ax) * k);
            len += l;
        }
        return { segs, len, cells };
    }
    const PATH = buildPath();

    /** Where an enemy that has walked distance d is, in cell units (the middle of its cell). */
    function posOf(d) {
        const s = PATH.segs.find((x) => d <= x.from + x.l) || PATH.segs[PATH.segs.length - 1];
        const k = Math.min(d - s.from, s.l);
        return [s.ax + s.dx * k + 0.5, s.ay + s.dy * k + 0.5];
    }

    /** The enemies of wave n, as { t: seconds after the wave starts, type, hp }. Same every time. */
    function waveSpec(n) {
        const types = [];
        if (n % 10 === 0) { types.push('boss'); for (let i = 0; i < 6; i++) types.push('trojan'); }
        else {
            const packets = 4 + n, worms = n >= 3 ? Math.floor(n / 2) : 0, trojans = n >= 6 ? Math.floor((n - 4) / 2) : 0;
            for (let i = 0; i < Math.max(packets, worms, trojans); i++) {
                if (i < trojans) types.push('trojan');
                if (i < worms) types.push('worm');
                if (i < packets) types.push('packet');
            }
        }
        const gap = Math.max(0.35, 0.9 - n * 0.02), scale = Math.pow(1.13, n - 1);   // tuned with a simple 14-tower bot: it falls around wave 22; better play can reach 30
        return types.map((type, i) => ({ t: i * gap, type, hp: Math.round(ENEMIES[type].hp * scale) }));
    }

    function newGame() {
        return { w: W, h: H, money: START_MONEY, lives: START_LIVES, wave: 0, status: 'build', towers: [], enemies: [], queue: [], clock: 0, time: 0, shots: [] };
    }

    const stats = (t) => {
        const base = TOWERS[t.type], k = t.level - 1;
        return { range: base.range * (1 + 0.15 * k), dmg: base.dmg * (1 + 0.5 * k) };
    };
    const upgradeCost = (t) => Math.round(TOWERS[t.type].cost * 0.8 * t.level);
    const sellValue = (t) => Math.round(t.spent * 0.6);

    /** Returns null when built, otherwise why not: 'type' | 'bounds' | 'path' | 'taken' | 'cost'. */
    function placeTower(g, type, x, y) {
        if (!TOWERS[type]) return 'type';
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= W || y >= H) return 'bounds';
        if (PATH.cells.has(y * W + x)) return 'path';
        if (g.towers.some((t) => t.x === x && t.y === y)) return 'taken';
        if (g.money < TOWERS[type].cost) return 'cost';
        g.money -= TOWERS[type].cost;
        g.towers.push({ type, x, y, level: 1, cd: 0, spent: TOWERS[type].cost });
        return null;
    }
    function upgradeTower(g, i) {
        const t = g.towers[i];
        if (!t || t.level >= 3) return 'max';
        const c = upgradeCost(t);
        if (g.money < c) return 'cost';
        g.money -= c; t.spent += c; t.level++;
        return null;
    }
    function sellTower(g, i) {
        const t = g.towers[i];
        if (!t) return false;
        g.money += sellValue(t); g.towers.splice(i, 1);
        return true;
    }

    /** Starts the next wave, only between waves. */
    function startWave(g) {
        if (g.status !== 'build') return false;
        g.wave++; g.queue = waveSpec(g.wave); g.clock = 0; g.status = 'wave';
        return true;
    }

    function hit(g, e, tower, s) {
        const base = TOWERS[tower.type];
        const victims = base.splash ? g.enemies.filter((o) => { const [ax, ay] = posOf(o.d), [bx, by] = posOf(e.d); return Math.hypot(ax - bx, ay - by) <= base.splash; }) : [e];
        victims.forEach((v) => { v.hp -= s.dmg; if (base.slow) v.slowUntil = g.time + base.slowTime; });
    }

    /** Advances the game by dt seconds. */
    function step(g, dt = DT) {
        if (g.status !== 'wave') return g;
        g.clock += dt; g.time += dt;
        while (g.queue.length && g.queue[0].t <= g.clock) { const q = g.queue.shift(); g.enemies.push({ type: q.type, hp: q.hp, maxHp: q.hp, d: 0, slowUntil: 0 }); }
        for (const e of g.enemies) e.d += ENEMIES[e.type].speed * (e.slowUntil > g.time ? TOWERS.firewall.slow : 1) * dt;
        for (const t of g.towers) {
            t.cd -= dt;
            if (t.cd > 0) continue;
            const s = stats(t), cx = t.x + 0.5, cy = t.y + 0.5;
            let target = null;
            for (const e of g.enemies) {
                const [ex, ey] = posOf(e.d);
                if (e.hp > 0 && Math.hypot(ex - cx, ey - cy) <= s.range && (!target || e.d > target.d)) target = e;   // the one closest to the core
            }
            if (!target) continue;
            const [tx, ty] = posOf(target.d);
            g.shots.push({ x1: cx, y1: cy, x2: tx, y2: ty, ttl: 0.12, type: t.type });
            hit(g, target, t, s);
            t.cd = TOWERS[t.type].cd;
        }
        for (const e of g.enemies) if (e.hp <= 0) g.money += ENEMIES[e.type].reward;
        const leaked = g.enemies.filter((e) => e.hp > 0 && e.d >= PATH.len);
        leaked.forEach((e) => { g.lives -= ENEMIES[e.type].dmg; });
        g.enemies = g.enemies.filter((e) => e.hp > 0 && e.d < PATH.len);
        g.shots.forEach((s) => { s.ttl -= dt; }); g.shots = g.shots.filter((s) => s.ttl > 0);
        if (g.lives <= 0) { g.lives = 0; g.status = 'over'; return g; }
        if (!g.queue.length && !g.enemies.length) {
            g.money += 10 + g.wave * 2; g.shots = [];
            g.status = g.wave >= MAX_WAVE ? 'won' : 'build';
        }
        return g;
    }

    const api = { W, H, MAX_WAVE, DT, WAYPOINTS, PATH, TOWERS, ENEMIES, posOf, waveSpec, newGame, placeTower, upgradeTower, sellTower, startWave, step, stats, upgradeCost, sellValue };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
    root.Defense = api;
    VBI18N.add('it', {
        title: 'Difendi il server — vector-box', title_h: 'Difendi il server', desc: 'Tower defense gratis nel browser: costruisci firewall, antivirus e IDS per fermare i virus prima che arrivino al nucleo. Nessun account.',
        back: '← Giochi', bytes: 'Byte', integrity: 'Integrità', wave: 'Ondata', best: 'Record', field: 'Campo di gioco',
        firewall: 'Firewall', antivirus: 'Antivirus', ids: 'IDS', upgrade: 'Potenzia', sell: 'Vendi', pause: 'Pausa', new: 'Nuova',
        help: 'Scegli una torre e tocca una casella libera per costruirla. Il firewall rallenta, l\'antivirus colpisce forte un bersaglio, l\'IDS colpisce più virus vicini. Tocca una torre per potenziarla o venderla. Premi Ondata per lanciare i virus: se arrivano al nucleo perdi integrità. Spazio fa partire l\'ondata, P mette in pausa.',
    });
    VBI18N.add('en', {
        next: 'Wave',
        m_start: 'Pick a tower and tap a free square, then press Wave.', m_cost: 'Not enough bytes.', m_path: 'Towers cannot go on the path.', m_taken: 'There is already a tower there.',
        m_wave: 'Wave in progress…', m_clear: 'Wave cleared. Build or upgrade, then press Wave.', m_over: 'The core fell. Press New to try again.', m_won: 'You defended the server through all the waves!',
        m_pause: 'Paused: press P or Pause again to continue.', m_max: 'Already at the top level.',
    });
    VBI18N.add('it', {
        next: 'Ondata',
        m_start: 'Scegli una torre e tocca una casella libera, poi premi Ondata.', m_cost: 'Byte insufficienti.', m_path: 'Non si può costruire sul percorso.', m_taken: 'C\'è già una torre.',
        m_wave: 'Ondata in corso…', m_clear: 'Ondata respinta. Costruisci o potenzia, poi premi Ondata.', m_over: 'Il nucleo è caduto. Premi Nuova per riprovare.', m_won: 'Hai difeso il server per tutte le ondate!',
        m_pause: 'In pausa: premi P o Pausa per continuare.', m_max: 'Già al livello massimo.',
    });

    document.addEventListener('DOMContentLoaded', () => {
        const $ = (id) => document.getElementById(id);
        const canvas = $('df-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const KEY = 'vb_difesa_best', COLORS = { firewall: '#4cc9f0', antivirus: '#00ff66', ids: '#f2c66d' };
        const ECOLORS = { packet: '#ffd166', worm: '#c77dff', trojan: '#ff5e5e', boss: '#ff2e63' };
        let g = newGame(), build = 'antivirus', sel = -1, hover = null, paused = false, fast = false, best = 0, raf = 0, last = 0, acc = 0, msgKey = null;
        try { best = +localStorage.getItem(KEY) || 0; } catch (e) { /* private mode */ }
        if (window.VBRecords) VBRecords.sync('difesa', best > 0 ? { '': best } : {}).then((m) => { if (m && m[''] > best) { best = m['']; try { localStorage.setItem(KEY, String(best)); } catch (e) { /* private mode */ } $('df-best').textContent = String(best); } });

        const say = (k) => { msgKey = k; $('df-msg').textContent = k ? VBLang.t(k) : ''; };
        const cell = () => canvas.width / W;
        function size() {
            const px = Math.min(window.innerWidth - 24, 600), dpr = window.devicePixelRatio || 1;
            canvas.style.width = px + 'px'; canvas.style.height = (px * H / W) + 'px';
            canvas.width = Math.round(px * dpr); canvas.height = Math.round(px * dpr * H / W);
            draw();
        }
        function ring(cx, cy, r, color) { const c = cell(); ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx * c, cy * c, r * c, 0, Math.PI * 2); ctx.stroke(); }
        function draw() {
            const c = cell();
            ctx.fillStyle = '#14121a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
                ctx.fillStyle = PATH.cells.has(y * W + x) ? '#3d3560' : '#1a1722'; ctx.fillRect(x * c + 1, y * c + 1, c - 2, c - 2);
            }
            const [ex, ey] = WAYPOINTS[WAYPOINTS.length - 1];
            ctx.fillStyle = '#ff5e5e'; ctx.fillRect(ex * c + c * 0.2, ey * c + c * 0.2, c * 0.6, c * 0.6);
            g.towers.forEach((t, i) => {
                ctx.fillStyle = COLORS[t.type]; ctx.fillRect(t.x * c + c * 0.15, t.y * c + c * 0.15, c * 0.7, c * 0.7);
                ctx.fillStyle = '#14121a'; ctx.font = 'bold ' + Math.round(c * 0.4) + 'px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(String(t.level), (t.x + 0.5) * c, (t.y + 0.55) * c);
                if (i === sel) ring(t.x + 0.5, t.y + 0.5, stats(t).range, '#ffffff');
            });
            if (hover && build && sel < 0 && !PATH.cells.has(hover[1] * W + hover[0])) ring(hover[0] + 0.5, hover[1] + 0.5, TOWERS[build].range, COLORS[build]);
            g.shots.forEach((s) => { ctx.strokeStyle = COLORS[s.type]; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(s.x1 * c, s.y1 * c); ctx.lineTo(s.x2 * c, s.y2 * c); ctx.stroke(); });
            g.enemies.forEach((e) => {
                const [x, y] = posOf(e.d), r = c * (e.type === 'boss' ? 0.38 : 0.22);
                ctx.fillStyle = ECOLORS[e.type]; ctx.beginPath(); ctx.arc(x * c, y * c, r, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#000'; ctx.fillRect(x * c - r, y * c - r - 6, r * 2, 4);
                ctx.fillStyle = '#9dffc4'; ctx.fillRect(x * c - r, y * c - r - 6, r * 2 * Math.max(0, e.hp) / e.maxHp, 4);
            });
            $('df-bytes').textContent = String(g.money); $('df-lives').textContent = String(g.lives);
            $('df-wave').textContent = g.wave + '/' + MAX_WAVE; $('df-best').textContent = String(best);
            document.querySelectorAll('[data-tower]').forEach((b) => { b.setAttribute('aria-pressed', b.dataset.tower === build ? 'true' : 'false'); b.disabled = g.money < TOWERS[b.dataset.tower].cost; });
            const t = g.towers[sel];
            $('df-sel').hidden = !t;
            if (t) { $('df-up').textContent = VBLang.t('upgrade') + (t.level < 3 ? ' (' + upgradeCost(t) + ')' : ''); $('df-sell').textContent = VBLang.t('sell') + ' (' + sellValue(t) + ')'; }
            $('df-go').disabled = g.status !== 'build';
        }
        function frame(now) {
            raf = requestAnimationFrame(frame);
            acc += Math.min(0.25, (now - last) / 1000) * (fast ? 2 : 1); last = now;
            while (acc >= DT) {
                acc -= DT; step(g);
                if (g.status === 'over' || g.status === 'won') break;
            }
            if (g.status === 'build' && msgKey === 'm_wave') say('m_clear');
            if (g.status === 'over' || g.status === 'won') finish();
            draw();
        }
        function run() { if (!raf && !paused && g.status === 'wave') { last = performance.now(); acc = 0; raf = requestAnimationFrame(frame); } }
        function stop() { cancelAnimationFrame(raf); raf = 0; }
        function finish() {
            stop();
            if (g.wave > best) { best = g.wave; try { localStorage.setItem(KEY, String(best)); } catch (e) { /* private mode */ } if (window.VBRecords) VBRecords.submit('difesa', '', best); }
            say(g.status === 'won' ? 'm_won' : 'm_over');
        }
        function go() { if (startWave(g)) { say('m_wave'); sel = -1; run(); draw(); } }
        function restart() { stop(); g = newGame(); sel = -1; paused = false; $('df-pause').setAttribute('aria-pressed', 'false'); say('m_start'); draw(); }
        function togglePause() {
            if (g.status !== 'wave') return;
            paused = !paused; $('df-pause').setAttribute('aria-pressed', paused ? 'true' : 'false');
            if (paused) { stop(); say('m_pause'); } else { say('m_wave'); run(); }
        }
        const cellAt = (e) => {
            const r = canvas.getBoundingClientRect();
            return [Math.floor((e.clientX - r.left) / r.width * W), Math.floor((e.clientY - r.top) / r.height * H)];
        };
        canvas.addEventListener('pointermove', (e) => { hover = cellAt(e); if (!raf) draw(); });
        canvas.addEventListener('pointerleave', () => { hover = null; if (!raf) draw(); });
        canvas.addEventListener('pointerdown', (e) => {
            if (paused || g.status === 'over' || g.status === 'won') return;
            const [x, y] = cellAt(e), i = g.towers.findIndex((t) => t.x === x && t.y === y);
            if (i >= 0) sel = i;
            else {
                sel = -1;
                const why = placeTower(g, build, x, y);
                if (why) say({ cost: 'm_cost', path: 'm_path', taken: 'm_taken' }[why] || null); else say(g.status === 'wave' ? 'm_wave' : 'm_start');
            }
            draw();
        });
        document.querySelectorAll('[data-tower]').forEach((b) => b.addEventListener('click', () => { build = b.dataset.tower; sel = -1; draw(); }));
        $('df-up').addEventListener('click', () => { const why = upgradeTower(g, sel); if (why) say(why === 'max' ? 'm_max' : 'm_cost'); draw(); });
        $('df-sell').addEventListener('click', () => { sellTower(g, sel); sel = -1; draw(); });
        $('df-go').addEventListener('click', go);
        $('df-speed').addEventListener('click', () => { fast = !fast; $('df-speed').setAttribute('aria-pressed', fast ? 'true' : 'false'); });
        $('df-pause').addEventListener('click', togglePause);
        $('df-new').addEventListener('click', restart);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'p' || e.key === 'P') togglePause();
            else if (e.key === ' ' && !(e.target && /^(BUTTON|SELECT|INPUT)$/.test(e.target.tagName))) { e.preventDefault(); go(); }
        });
        document.addEventListener('visibilitychange', () => { if (document.hidden && g.status === 'wave' && !paused) togglePause(); });
        window.addEventListener('resize', size);
        window.addEventListener('vb-lang', () => { say(msgKey); draw(); });
        size(); say('m_start');
    });
})(typeof window !== 'undefined' ? window : globalThis);
