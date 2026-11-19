// tests/difesa.test.js — "Difendi il server" (tower defense): the rules (no browser, no randomness) and the page
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../public/js/difesa.js');

const run = (g) => { let n = 0; while (g.status === 'wave' && n++ < 200000) D.step(g); return g; };
const freeCell = () => { for (let y = 0; y < D.H; y++) for (let x = 0; x < D.W; x++) if (!D.PATH.cells.has(y * D.W + x)) return [x, y]; };

test('defense: building checks the type, the board, the path, an occupied square and the money', () => {
    const g = D.newGame(), [x, y] = freeCell(), [px, py] = D.WAYPOINTS[0];
    assert.equal(D.placeTower(g, 'laser', x, y), 'type');
    assert.equal(D.placeTower(g, 'antivirus', -1, 0), 'bounds');
    assert.equal(D.placeTower(g, 'antivirus', px, py), 'path');
    assert.equal(D.placeTower(g, 'antivirus', x, y), null);
    assert.equal(g.money, 150 - D.TOWERS.antivirus.cost);
    assert.equal(D.placeTower(g, 'antivirus', x, y), 'taken');
    g.money = 10;
    assert.equal(D.placeTower(g, 'ids', x + 1, y), 'cost');
});

test('defense: upgrade costs money and stops at level 3, selling gives back 60% of what was spent', () => {
    const g = D.newGame(); g.money = 1000; D.placeTower(g, 'antivirus', 0, 0);
    const before = D.stats(g.towers[0]).dmg;
    assert.equal(D.upgradeTower(g, 0), null); assert.equal(D.upgradeTower(g, 0), null);
    assert.equal(D.upgradeTower(g, 0), 'max');
    assert.ok(D.stats(g.towers[0]).dmg > before * 1.9);
    const spent = g.towers[0].spent, m = g.money;
    assert.ok(D.sellTower(g, 0)); assert.equal(g.money, m + Math.round(spent * 0.6)); assert.equal(g.towers.length, 0);
    g.money = 5; D.placeTower(g, 'firewall', 0, 0); assert.equal(g.towers.length, 0); g.money = 100; D.placeTower(g, 'firewall', 0, 0);
    g.money = 1; assert.equal(D.upgradeTower(g, 0), 'cost');
});

test('defense: waves are the same every time, grow, and have a boss every 10th wave', () => {
    assert.deepEqual(D.waveSpec(7), D.waveSpec(7));
    assert.ok(D.waveSpec(12).length > D.waveSpec(2).length);
    assert.ok(D.waveSpec(12)[0].hp > D.waveSpec(2)[0].hp, 'later enemies are tougher');
    for (const n of [10, 20, 30]) assert.equal(D.waveSpec(n).filter((e) => e.type === 'boss').length, 1);
    assert.equal(D.waveSpec(9).filter((e) => e.type === 'boss').length, 0);
});

test('defense: enemies walk the path to the core; with no towers they cost integrity and a wave can start only when the board is quiet', () => {
    assert.deepEqual(D.posOf(0), [0.5, 1.5]);
    const end = D.posOf(D.PATH.len); assert.deepEqual(end, [11.5, 5.5]);
    const g = D.newGame();
    assert.ok(D.startWave(g)); assert.equal(D.startWave(g), false, 'not while a wave is running');
    run(g);
    assert.equal(g.status, 'build'); assert.equal(g.lives, 20 - 5, 'five packets reached the core');
    assert.equal(g.wave, 1); assert.deepEqual(g.shots, [], 'no shot lines left over');
});

test('defense: when a wave is cleared with towers the board is quiet again and the bonus is paid', () => {
    const g = D.newGame(); D.placeTower(g, 'antivirus', 2, 2); D.placeTower(g, 'antivirus', 5, 2); D.placeTower(g, 'antivirus', 8, 2);
    D.startWave(g); run(g);
    assert.equal(g.status, 'build'); assert.equal(g.lives, 20); assert.equal(g.enemies.length, 0); assert.deepEqual(g.shots, []);
    assert.equal(g.money, 5 * D.ENEMIES.packet.reward + 12);
});

test('defense: a firewall slows what it hits and the IDS hurts several viruses at once', () => {
    const g = D.newGame(); g.money = 500;
    D.placeTower(g, 'firewall', 0, 0);   // next to the entrance
    D.startWave(g); for (let i = 0; i < 40; i++) D.step(g);
    assert.ok(g.enemies.some((e) => e.slowUntil > g.time), 'a hit virus is slowed');
    const h = D.newGame(); h.money = 500; D.placeTower(h, 'ids', 3, 2); D.startWave(h);
    h.queue = [{ t: 0, type: 'trojan', hp: 100 }, { t: 0, type: 'trojan', hp: 100 }];
    D.step(h); h.enemies.forEach((e) => { e.d = 3.2; });
    h.towers[0].cd = 0; D.step(h, 0.001);
    assert.ok(h.enemies.every((e) => e.hp < 100), 'both trojans took damage from one shot');
});

test('defense: balance guard: a plain 14-tower bot beats the early waves without leaks but does not win all 30', () => {
    const cands = [];
    for (let y = 0; y < D.H; y++) for (let x = 0; x < D.W; x++) {
        if (D.PATH.cells.has(y * D.W + x)) continue;
        let n = 0; D.PATH.cells.forEach((c) => { if (Math.hypot((c % D.W) - x, ((c / D.W) | 0) - y) <= 2.6) n++; });
        cands.push({ x, y, n });
    }
    cands.sort((a, b) => b.n - a.n);
    const g = D.newGame(); let leakedEarly = false;
    while (g.status !== 'over' && g.status !== 'won') {
        for (let acted = true; acted;) {
            acted = false;
            const c = cands.find((k) => !g.towers.some((t) => t.x === k.x && t.y === k.y));
            if (c && g.towers.length < 14 && D.placeTower(g, 'antivirus', c.x, c.y) === null) { acted = true; continue; }
            const i = g.towers.findIndex((t) => t.level < 3 && g.money >= D.upgradeCost(t));
            if (i >= 0) { D.upgradeTower(g, i); acted = true; }
        }
        D.startWave(g); run(g);
        if (g.wave <= 8 && g.lives < 20) leakedEarly = true;
    }
    assert.equal(leakedEarly, false, 'the first waves are easy');
    assert.equal(g.status, 'over', 'it is not a walkover');
    assert.ok(g.wave >= 12, 'but it is not impossible either (wave ' + g.wave + ')');
});

test('defense: the page is registered in the games list and the sitemap, with its assets', () => {
    const pub = path.join(__dirname, '..', 'public'), read = (p) => fs.readFileSync(path.join(pub, p), 'utf8');
    assert.match(read('pages/giochi.php'), /'href' => 'difesa\.html'/);
    assert.match(read('sitemap.php'), /\/pages\/difesa\.html/);
    for (const f of ['pages/difesa.html', 'js/difesa.js', 'css/difesa.css', 'assets/difesa/icon.svg']) assert.ok(fs.existsSync(path.join(pub, f)), f);
});
