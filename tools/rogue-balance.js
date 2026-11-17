#!/usr/bin/env node
// tools/rogue-balance.js — a bot (tools/rogue-bot.js) plays seeded runs of The Server Dungeon; prints per class: average and median depth, win rate,
// deaths per sector, cause of death (monster / hazard / hunger) and average turns, plus the checks that matter for balance.
//   node tools/rogue-balance.js [runsPerClass=100] [maxTurns=40000] [class,class…] [--jobs=N] [--seed=N]
// --jobs=N runs N worker processes (default: number of CPUs - 1, at least 1); --seed=N moves the seed block (a new sample). Same seed + same data = same numbers.
// ROGUE_STYLE=careful measures the skilled-player bot (default: normal). ROGUE_JSON=file saves the raw records.
// ROGUE_PARTIAL=file makes a batch resumable (finished runs are appended as JSON lines; delete the file when data or bot change).
// ROGUE_DIR=/other/rogue/folder compares another copy of the rules.
'use strict';
const path = require('path');
const { fork } = require('child_process');
const fs = require('fs');
const dir = process.env.ROGUE_DIR || path.join(__dirname, '..', 'public', 'js', 'rogue');
const CLS = require(path.join(dir, 'classes.js'));
const { play, ending } = require('./rogue-bot.js');

const seedOf = (ci, i, seed0) => 1000 * (ci + 1) + i + (seed0 || 0) * 100000;
/** One run as a small record. */
function run(cls, seed, maxTurns) {
    const s = play(seed, cls, { maxTurns, style: process.env.ROGUE_STYLE });
    return { cls, seed, depth: s.depth, turns: s.turn, end: ending(s), status: s.status, cause: s.cause && s.cause.p ? (s.cause.p.mob || s.cause.p.haz || '') : (s.cause && s.cause.k) || '' };
}
/** Plays `runs` seeded runs for every class in this process. Returns the records. */
function runs(n, maxTurns, only, seed0) {
    const out = [];
    CLS.CLASSES.forEach((c, ci) => { if (!only || only.includes(c.id)) for (let i = 1; i <= n; i++) out.push(run(c.id, seedOf(ci, i, seed0), maxTurns)); });
    return out;
}
/** Same, spread over `jobs` child processes (tasks dealt round-robin so every worker gets every class). Resolves to the records. */
function runsParallel(n, maxTurns, only, seed0, jobs) {
    let tasks = [], old = [];
    CLS.CLASSES.forEach((c, ci) => { if (!only || only.includes(c.id)) for (let i = 1; i <= n; i++) tasks.push([c.id, seedOf(ci, i, seed0)]); });
    const part = process.env.ROGUE_PARTIAL;                       // resumable: every finished run is appended there (JSON lines); a rerun skips what is already in it
    if (part && fs.existsSync(part)) {
        old = fs.readFileSync(part, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
        const have = new Set(old.map((r) => r.cls + ':' + r.seed));
        tasks = tasks.filter(([c, sd]) => !have.has(c + ':' + sd));
    }
    const parts = Array.from({ length: Math.max(1, jobs) }, () => []);
    tasks.forEach((t, i) => parts[i % parts.length].push(t));
    return Promise.all(parts.filter((p) => p.length).map((p) => new Promise((resolve, reject) => {
        const w = fork(__filename, ['--worker'], { env: process.env });
        w.on('message', (m) => { resolve(m); w.kill(); });
        w.on('error', reject);
        w.on('exit', (c) => { if (c) reject(new Error('worker exit ' + c)); });
        w.send({ tasks: p, maxTurns });
    }))).then((l) => old.concat(...l));
}

const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[(b.length - 1) >> 1] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : 0; };
const sectorOf = (d) => Math.min(9, Math.floor((d - 1) / 5));
/** Per-class summary of the records. */
function summarize(recs) {
    const by = {};
    for (const c of CLS.CLASSES) by[c.id] = [];
    for (const r of recs) by[r.cls].push(r);
    return CLS.CLASSES.filter((c) => by[c.id].length).map((c) => {
        const l = by[c.id], dead = l.filter((r) => r.status === 'dead'), sec = new Array(10).fill(0);
        for (const r of dead) sec[sectorOf(r.depth)]++;
        return { cls: c.id, n: l.length, avg: l.reduce((a, r) => a + r.depth, 0) / l.length, med: med(l.map((r) => r.depth)), wins: l.filter((r) => r.status === 'won').length / l.length,
            turns: l.reduce((a, r) => a + r.turns, 0) / l.length, sec, monster: l.filter((r) => r.end === 'monster').length, hazard: l.filter((r) => r.end === 'hazard').length,
            hunger: l.filter((r) => r.end === 'hunger').length, alive: l.filter((r) => r.end === 'alive').length, stuck: l.filter((r) => r.end === 'stuck').length };
    });
}
const f1 = (x) => x.toFixed(1);
function table(rows) {
    const L = ['class        runs avg  med  win%  turns  monster haz hung | deaths in sector 1..10'];
    const all = { n: 0, avg: 0, wins: 0, turns: 0, sec: new Array(10).fill(0), monster: 0, hazard: 0, hunger: 0, alive: 0, stuck: 0 };
    const line = (name, r) => name.padEnd(12) + String(r.n).padStart(4) + f1(r.avg).padStart(6) + (r.med === undefined ? '' : f1(r.med).padStart(5)).padEnd(5) + (100 * r.wins).toFixed(0).padStart(5) + String(Math.round(r.turns)).padStart(8) +
        String(r.monster).padStart(8) + String(r.hazard).padStart(4) + String(r.hunger).padStart(5) + ' | ' + r.sec.map((x) => String(x).padStart(3)).join(' ');
    for (const r of rows) {
        L.push(line(r.cls, r));
        all.n += r.n; all.avg += r.avg * r.n; all.wins += r.wins * r.n; all.turns += r.turns * r.n;
        for (const k of ['monster', 'hazard', 'hunger', 'alive', 'stuck']) all[k] += r[k];
        r.sec.forEach((x, i) => { all.sec[i] += x; });
    }
    if (all.n) { all.avg /= all.n; all.wins /= all.n; all.turns /= all.n; L.push(line('ALL', all)); }
    const meds = rows.map((r) => r.med).sort((a, b) => a - b), m = med(meds), dead = all.sec.reduce((a, b) => a + b, 0);
    L.push('');
    L.push('median of class medians ' + f1(m) + '; class avg vs median of class avgs: ' + rows.map((r) => r.cls + ' ' + (100 * (r.avg / (med(rows.map((x) => x.avg)) || 1) - 1)).toFixed(0) + '%').join(', '));
    if (dead) L.push('share of deaths per sector: ' + all.sec.map((x, i) => (i + 1) + ':' + (100 * x / dead).toFixed(0) + '%').join(' ') + '   (sector 1-2 death rate ' + (100 * (all.sec[0] + all.sec[1]) / all.n).toFixed(1) + '% of runs)');
    L.push('starvation ' + (100 * all.hunger / (all.n || 1)).toFixed(1) + '% of runs, hazards ' + (100 * all.hazard / (all.n || 1)).toFixed(1) + '%' + (all.alive ? '; still alive at the turn limit: ' + all.alive : '') + (all.stuck ? '; STUCK (soft-lock): ' + all.stuck : ''));
    return L.join('\n');
}

if (process.argv.includes('--worker')) {
    process.on('message', (m) => { process.send(m.tasks.map(([c, sd]) => { const r = run(c, sd, m.maxTurns); if (process.env.ROGUE_PARTIAL) fs.appendFileSync(process.env.ROGUE_PARTIAL, JSON.stringify(r) + '\n'); return r; })); });
} else if (require.main === module) {
    const a = process.argv.slice(2), opt = (k, d) => { const x = a.find((v) => v.startsWith('--' + k + '=')); return x ? +x.split('=')[1] : d; };
    const pos = a.filter((v) => !v.startsWith('--'));
    const n = +pos[0] || 100, maxTurns = +pos[1] || 40000, only = pos[2] && pos[2].split(','), jobs = opt('jobs', Math.max(1, require('os').cpus().length - 1));
    const t0 = Date.now();
    runsParallel(n, maxTurns, only, opt('seed', 0), jobs).then((recs) => {
        console.log(table(summarize(recs)));
        const kill = {}, floors = {};
        for (const r of recs) if (r.status === 'dead') { const k = kill[r.cause] = kill[r.cause] || { n: 0, d: 0 }; k.n++; k.d += r.depth; floors[r.depth] = (floors[r.depth] || 0) + 1; }
        console.log('top killers (count, avg floor): ' + Object.entries(kill).sort((a, b) => b[1].n - a[1].n).slice(0, 12).map(([c, k]) => c + ' ' + k.n + ' (' + (k.d / k.n).toFixed(0) + ')').join(', '));
        console.log('deaths per floor: ' + Object.entries(floors).sort((a, b) => a[0] - b[0]).map(([f, n]) => f + ':' + n).join(' '));
        console.log('(' + recs.length + ' runs, ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s, ' + jobs + ' jobs)');
        if (process.env.ROGUE_JSON) require('fs').writeFileSync(process.env.ROGUE_JSON, JSON.stringify(recs));
    });
}
module.exports = { run, runs, runsParallel, summarize, table, play, ending };
