#!/usr/bin/env node
// tools/rogue-balance.js — a headless bot plays seeded runs of The Server Dungeon and prints, per class: average depth, win rate, deaths by sector, average turns.
//   node tools/rogue-balance.js [runsPerClass=200] [maxTurns=40000] [class,class…]   (a class list lets you run several processes side by side)
// The bot is simple on purpose (a competent-but-not-clever player): fights what it sees, wears the best weapon/armour it finds, installs plugins, drinks
// healing cans when low, eats when hungry, uses its active skill when an enemy is close, picks the first skill offered, buys nothing.
'use strict';
const path = require('path');
const dir = process.env.ROGUE_DIR || path.join(__dirname, '..', 'public', 'js', 'rogue');   // ROGUE_DIR: compare with another copy of the rules
const MAP = require(path.join(dir, 'map.js')), CLS = require(path.join(dir, 'classes.js')), G = require(path.join(dir, 'game.js'));
const W = MAP.W;
const dist = (s, m) => Math.abs(m.x - s.p.x) + Math.abs(m.y - s.p.y);
const avg = (d, e) => (d.dmg[0] + d.dmg[1]) / 2 + (e || 0);

function play(seed, cls, maxTurns, god) {
    const meta = G.newMeta(); meta.ng = 9;
    Object.assign(meta, { best: 99, bosses: 99, wins: 99, runs: 99 });       // every class is unlocked
    const s = G.newGame(seed, cls, meta, {});
    if (god) { s.p.maxHp = s.p.hp = 4000; s.p.mods.atk = 40; s.p.mods.acc = 20; s.p.mods.def = 20; s.p.food = 1e9; }   // for tests of the content, not for balance
    let n = 0, idle = 0;
    while (s.status === 'play' && n++ < maxTurns) {
        const before = s.turn;
        if (s.p.pending) { G.act(s, { t: 'skill', id: s.p.choices[0] }); continue; }
        if (s.shop && s.shop.open) {                                                    // spend the credits: healing cans first, then better gear
            const want = (e) => { const d = G.ITEM[e.k]; return d.effect === 'heal' || (d.cat === 'armor' && d.def > (s.p.armor ? G.ITEM[s.p.armor.k].def : 0)) || (d.cat === 'weapon' && avg(d) > (s.p.weapon ? avg(G.ITEM[s.p.weapon.k]) : 0)); };
            const i = s.shop.stock.findIndex((e) => want(e) && G.price(s, e) <= s.p.gold && s.p.inv.length < G.INV_CAP);
            if (i >= 0) { G.act(s, { t: 'buy', i }); continue; }
        }
        if ((s.shop && s.shop.open) || (s.bench && s.bench.open)) { G.act(s, { t: s.bench && s.bench.open && s.p.hp < s.p.maxHp ? 'rest' : 'leave' }); if (s.bench) s.bench.open = 0; if (s.shop) s.shop.open = 0; continue; }
        if (s.hub && s.p.hp < s.p.maxHp) { G.act(s, { t: 'rest' }); }
        if (s.p.hp < s.p.maxHp / 3) {                                                   // a known healing can, else gamble on an unknown can
            let i = s.p.inv.findIndex((e) => G.ITEM[e.k].effect === 'heal' && G.known(s, e));
            if (i < 0) i = s.p.inv.findIndex((e) => G.ITEM[e.k].cat === 'drink' && !G.known(s, e));
            if (i >= 0) { G.act(s, { t: 'use', i }); continue; }
        }
        if (s.p.food < 200) { const i = s.p.inv.findIndex((e) => G.ITEM[e.k].cat === 'food'); if (i >= 0) { G.act(s, { t: 'use', i }); continue; } }
        // better gear: compare average damage / armour, try each plugin once
        const w = s.p.weapon && G.ITEM[s.p.weapon.k], a = s.p.armor && G.ITEM[s.p.armor.k];
        const bw = s.p.inv.findIndex((e) => G.ITEM[e.k].cat === 'weapon' && avg(G.ITEM[e.k], e.e) + (G.ITEM[e.k].crit || 0) / 20 > (w ? avg(w, s.p.weapon.e) + (w.crit || 0) / 20 : 0));
        if (bw >= 0) { G.act(s, { t: 'use', i: bw }); continue; }
        const ba = s.p.inv.findIndex((e) => G.ITEM[e.k].cat === 'armor' && G.ITEM[e.k].def + (e.e || 0) + (G.ITEM[e.k].dodge || 0) / 2 > (a ? a.def + (s.p.armor.e || 0) + (a.dodge || 0) / 2 : 0));
        if (ba >= 0) { G.act(s, { t: 'use', i: ba }); continue; }
        if (!s.p.plugin) { const i = s.p.inv.findIndex((e) => G.ITEM[e.k].cat === 'plugin'); if (i >= 0) { G.act(s, { t: 'use', i }); continue; } }
        const near = G.threats(s).filter((m) => !m.loot && !m.stolen && !(G.MOB[m.k].still && !G.MOB[m.k].ranged && dist(s, m) > 1)).sort((x, y) => dist(s, x) - dist(s, y))[0];
        if (near && dist(s, near) <= 4 && !s.p.cd) { const before2 = s.turn; G.act(s, { t: 'active' }); if (s.turn !== before2) continue; }
        if (near && s.p.hp < s.p.maxHp / 2) {                                           // thrown / USB help in a hard fight
            const i = s.p.inv.findIndex((e) => G.ITEM[e.k].cat === 'usb' && e.ch > 0 && G.known(s, e) && !['freeze', 'slow', 'banish'].includes(G.ITEM[e.k].effect));
            if (i >= 0) { G.act(s, { t: 'use', i }); continue; }
        }
        let v = null;
        if (near) v = dist(s, near) === 1 ? [near.x - s.p.x, near.y - s.p.y] : G.travelNext(s, near.x, near.y);
        else if (s.map.tiles[s.p.y * W + s.p.x] === MAP.T.STAIRS && !s.sealed) { G.act(s, { t: 'descend' }); continue; }
        else v = (s.p.food < 300 && !s.p.inv.some((e) => G.ITEM[e.k].cat === 'food') && G.travelNext(s, s.map.stairs.x, s.map.stairs.y)) || G.exploreNext(s) || G.travelNext(s, s.map.stairs.x, s.map.stairs.y);   // starving with no food: head down
        if (!v) v = G.exploreNext(s) || G.travelNext(s, s.map.stairs.x, s.map.stairs.y);
        G.act(s, v ? { t: 'move', dx: v[0], dy: v[1] } : { t: 'wait' });
        idle = s.turn === before ? idle + 1 : 0;
        if (idle > 80) { s.status = 'stuck'; break; }
    }
    return s;
}

/** Plays `runs` seeded runs for every class. Returns { rows, stuck }. */
function balance(runs, maxTurns, only) {
    const rows = []; let stuck = 0;
    for (const c of CLS.CLASSES.filter((x) => !only || only.includes(x.id))) {
        const r = { cls: c.id, runs, depth: 0, wins: 0, turns: 0, deaths: new Array(10).fill(0), alive: 0 };
        for (let i = 1; i <= runs; i++) {
            const s = play(1000 * (CLS.CLASSES.indexOf(c) + 1) + i, c.id, maxTurns);
            r.depth += s.depth; r.turns += s.turn;
            if (s.status === 'won') r.wins++;
            else if (s.status === 'dead') r.deaths[Math.min(9, Math.floor((s.depth - 1) / 5))]++;
            else { r.alive++; if (s.status === 'stuck') stuck++; }
        }
        rows.push(r);
    }
    return { rows, stuck };
}
function table(rows) {
    const lines = ['class        avg depth  win%   avg turns  deaths in sector 1..10'];
    let d = 0, w = 0, t = 0, n = 0; const all = new Array(10).fill(0);
    for (const r of rows) {
        lines.push(r.cls.padEnd(12) + ' ' + (r.depth / r.runs).toFixed(1).padStart(9) + ' ' + (100 * r.wins / r.runs).toFixed(1).padStart(5) + ' ' + String(Math.round(r.turns / r.runs)).padStart(10) + '  ' + r.deaths.map((x) => String(x).padStart(3)).join(' '));
        d += r.depth; w += r.wins; t += r.turns; n += r.runs; r.deaths.forEach((x, i) => { all[i] += x; });
    }
    lines.push('ALL'.padEnd(12) + ' ' + (d / n).toFixed(1).padStart(9) + ' ' + (100 * w / n).toFixed(1).padStart(5) + ' ' + String(Math.round(t / n)).padStart(10) + '  ' + all.map((x) => String(x).padStart(3)).join(' '));
    return lines.join('\n');
}
if (require.main === module) {
    const runs = +process.argv[2] || 200, maxTurns = +process.argv[3] || 40000;
    const out = balance(runs, maxTurns, process.argv[4] && process.argv[4].split(','));
    console.log(table(out.rows));
    if (out.stuck) console.log('stuck runs (soft-lock): ' + out.stuck);
}
module.exports = { play, balance, table };
