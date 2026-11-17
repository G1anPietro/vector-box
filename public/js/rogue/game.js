// js/rogue/game.js — the rules of "Il Dungeon del Server". No DOM, no clock, no Math.random: the whole run is one
// plain object (JSON), so it is saved after every turn and a seed always replays the same way.
//   const s = newGame(seed, 'studente', meta);  act(s, { t: 'move', dx: 1, dy: 0 });  save(s) / load(text)
// Actions: move {dx,dy} · wait · use {i} · drop {i} · unequip {slot} · descend · active · skill {id} · buy {i} · leave
// HOW TO ADD AN EFFECT (for a new item, trap or active skill): add a function to EFFECTS below; it receives
// (state, power, targetMonster). Put its name in TARGETED if it needs an enemy in sight.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./rng.js'), require('./map.js'), require('./mobs.js'), require('./items.js'), require('./classes.js'));
    } else { const R = root.Rogue; R.game = factory(R.rng, R.map, R.mobs, R.items, R.classes); }
})(typeof self !== 'undefined' ? self : this, function (RNG, MAP, MOBS, ITEMS, CLS) {
    'use strict';
    const VERSION = 1, W = MAP.W, H = MAP.H, T = MAP.T, DIRS = MAP.DIRS;
    const FLOORS = MOBS.SECTORS.length * MOBS.PER_SECTOR;
    const MOB_CAP = 40, INV_CAP = 24, MAX_FOOD = 1200, SIGHT = 8;
    const byId = (list) => Object.fromEntries(list.map((e) => [e.id, e]));
    const MOB = byId(MOBS.LIST), ITEM = byId(ITEMS.LIST), CLASS = byId(CLS.CLASSES), SKILL = byId(CLS.SKILLS);
    const idx = (x, y) => y * W + x;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const sectorOf = (depth) => MOBS.SECTORS[Math.min(MOBS.SECTORS.length - 1, Math.floor((depth - 1) / MOBS.PER_SECTOR))];
    const bossOf = (depth) => MOBS.LIST.find((d) => d.boss === depth);
    const cat = (it) => ITEMS.CATS[ITEM[it.k].cat];

    function log(s, text, c) { s.log.push({ t: text, c: c || '' }); if (s.log.length > 50) s.log.shift(); }
    const fx = (s, t, x, y) => s.fx.push({ t, x, y });

    // ── numbers ─────────────────────────────────────────────────────────────
    function addMods(p, mod) {
        for (const k in mod) {
            if (k === 'maxHp') { p.maxHp += mod[k]; p.hp += mod[k]; } else p.mods[k] = (p.mods[k] || 0) + mod[k];
        }
    }
    /** Everything the player's numbers add up to right now. */
    function stats(s) {
        const p = s.p, m = Object.assign({}, p.mods);
        if (p.plugin) for (const k in ITEM[p.plugin.k].mod) m[k] = (m[k] || 0) + ITEM[p.plugin.k].mod[k];
        const g = (k) => m[k] || 0;
        const w = p.weapon && ITEM[p.weapon.k], a = p.armor && ITEM[p.armor.k];
        return {
            dmg: w ? w.dmg : [1, 3],
            atk: g('atk') + (w ? p.weapon.e || 0 : 0) - (p.st.weak ? 2 : 0) + (p.hp * 2 < p.maxHp ? g('fury') : 0),
            acc: g('acc') + (w ? w.acc || 0 : 0) + (p.lvl >> 1),
            def: g('def') + (a ? a.def + (p.armor.e || 0) : 0),
            dodge: g('dodge') + (a ? a.dodge || 0 : 0),
            crit: (5 + g('crit') + (w ? w.crit || 0 : 0)) / 100,
            holy: g('holy') + (w ? w.holy || 0 : 0),
            regen: g('regen'), hunger: g('hunger'), vamp: g('vamp'), luck: g('luck'), search: g('search'), sight: g('sight'),
            usb: g('usb'), drink: g('drink'), backstab: g('backstab'), stealth: g('stealth'), recharge: g('recharge'),
            haggle: g('haggle'), xp: g('xp'), cd: g('cd'),
        };
    }
    const hitChance = (acc, dodge) => clamp(0.82 + 0.04 * (acc - dodge), 0.25, 0.97);
    /** A roll of the weapon plus the bonus, doubled on a critical hit, minus a random part of the armour. Never less than 1. */
    function rollDamage(r, dmg, bonus, def, crit) {
        let d = RNG.range(r, dmg[0], dmg[1]) + bonus;
        if (crit) d *= 2;
        return Math.max(1, d - RNG.int(r, (def || 0) + 1));
    }
    const xpNeed = (lvl) => 10 * lvl;

    // ── things ──────────────────────────────────────────────────────────────
    const known = (s, it) => !cat(it).unknown || !!s.known[it.k];
    function itemName(s, it) {
        if (it.k === '$') return it.n + ' crediti';
        const d = ITEM[it.k], c = ITEMS.CATS[d.cat];
        let n = known(s, it) ? d.name : c.name + ' ' + ITEMS.LOOKS[d.cat][s.looks[it.k]][0];
        if (it.e) n += ' +' + it.e;
        if (d.cat === 'usb' && known(s, it)) n += ' (' + it.ch + ')';
        if (it.n > 1) n += ' ×' + it.n;
        return n;
    }
    function itemInfo(s, it) {
        const d = ITEM[it.k];
        if (!known(s, it)) return 'Non sai cosa fa: provalo per scoprirlo.';
        const e = it.e || 0;
        if (d.cat === 'weapon') return `Danno ${d.dmg[0] + e}-${d.dmg[1] + e}. ${d.info || ''}`;
        if (d.cat === 'armor') return `Difesa ${d.def + e}. ${d.info || ''}`;
        return d.info || '';
    }
    function itemLook(s, it) {
        if (it.k === '$') return { shape: 'coin', col: '#ffb000' };
        const d = ITEM[it.k], c = ITEMS.CATS[d.cat];
        return { shape: d.shape || c.shape, col: c.unknown ? ITEMS.LOOKS[d.cat][s.looks[it.k]][1] : d.col || c.col };
    }
    function identify(s, k) {
        if (!ITEMS.CATS[ITEM[k].cat].unknown || s.known[k]) return;
        s.known[k] = 1;
        log(s, 'Ora sai cos’è: ' + ITEM[k].name + '.', 'info');
    }
    function makeItem(r, depth) {
        const d = RNG.weighted(r, ITEMS.LIST.filter((e) => (e.from || 1) <= depth));
        const it = { k: d.id };
        if (d.cat === 'weapon' || d.cat === 'armor') it.e = RNG.chance(r, 0.15) ? (RNG.chance(r, 0.25) ? 2 : 1) : 0;
        if (d.cat === 'usb') it.ch = d.ch + RNG.int(r, 3);
        if (ITEMS.CATS[d.cat].stack) it.n = 1;
        return it;
    }
    const canTake = (s, it) => it.k === '$' || (cat(it).stack && s.p.inv.some((o) => o.k === it.k)) || s.p.inv.length < INV_CAP;
    function addInv(s, it) {
        if (!canTake(s, it)) return false;
        const same = cat(it).stack && s.p.inv.find((o) => o.k === it.k);
        if (same) same.n += it.n || 1; else s.p.inv.push(it);
        return true;
    }
    function useUp(s, i) { const it = s.p.inv[i]; if (it.n > 1) it.n--; else s.p.inv.splice(i, 1); }
    const price = (s, it) => Math.max(1, Math.round(ITEM[it.k].price * (1 + s.depth * 0.06) * (1 - stats(s).haggle / 100)));

    // ── the floor ───────────────────────────────────────────────────────────
    const mobAt = (s, x, y) => s.mobs.find((m) => m.x === x && m.y === y);
    const itemsAt = (s, x, y) => s.items.filter((e) => e.x === x && e.y === y);
    const free = (s, x, y) => s.map.tiles[idx(x, y)] === T.FLOOR && !mobAt(s, x, y) && (s.p.x !== x || s.p.y !== y);
    /** A free floor cell: near (x, y) when given, anywhere otherwise. */
    function freeCell(s, r, x, y) {
        if (x !== undefined) {
            for (let d = 1; d <= 3; d++) {
                const ring = [];
                for (let yy = y - d; yy <= y + d; yy++) for (let xx = x - d; xx <= x + d; xx++) if (xx > 0 && yy > 0 && xx < W - 1 && yy < H - 1 && free(s, xx, yy)) ring.push([xx, yy]);
                if (ring.length) return RNG.pick(r, ring);
            }
            return null;
        }
        for (let i = 0; i < 400; i++) { const xx = 1 + RNG.int(r, W - 2), yy = 1 + RNG.int(r, H - 2); if (free(s, xx, yy)) return [xx, yy]; }
        return null;
    }
    function spawn(s, k, x, y, asleep) {
        const m = { id: s.nid++, k, x, y, hp: MOB[k].hp, max: MOB[k].hp, asleep: asleep ? 1 : 0 };
        s.mobs.push(m);
        return m;
    }
    function updateFov(s) {
        s.vis = MAP.fov(s.map, s.p.x, s.p.y, SIGHT + stats(s).sight);
        for (let i = 0; i < s.vis.length; i++) if (s.vis[i]) s.seen[i] = 1;
    }
    /** Can the player see this monster? (Crates that bite and invisible things are not seen from far.) */
    function shown(s, m) {
        const d = MOB[m.k], near = Math.abs(m.x - s.p.x) + Math.abs(m.y - s.p.y) <= 1;
        if (d.ambush && !m.shown) return false;
        if (d.invisible && !near) return false;
        return !!s.vis[idx(m.x, m.y)] || !!s.p.st.ping;
    }
    const threats = (s) => s.mobs.filter((m) => shown(s, m) && s.vis[idx(m.x, m.y)]);
    function nearest(s) {
        let best = null, bd = 99;
        for (const m of threats(s)) { const d = Math.abs(m.x - s.p.x) + Math.abs(m.y - s.p.y); if (d < bd) { bd = d; best = m; } }
        return best;
    }

    function newFloor(s) {
        const depth = s.depth, r = RNG.make(RNG.mix(s.seed, depth * 7919 + 17));
        const m = MAP.generate(s.seed, depth), tiles = m.tiles;
        s.map = { w: W, h: H, tiles, stairs: m.stairs };
        s.seen = new Array(W * H).fill(0);
        s.mobs = []; s.items = []; s.traps = []; s.shop = null; s.altar = null; s.sealed = 0;
        s.p.x = m.start.x; s.p.y = m.start.y;
        const plain = m.rooms.filter((o) => !o.vault), last = m.rooms.find((o) => o.last);
        const others = RNG.shuffle(r, plain.filter((o) => o !== m.rooms[0] && !o.last));
        const taken = new Set([idx(m.start.x, m.start.y), idx(m.stairs.x, m.stairs.y)]);
        const cellIn = (o) => {
            for (let i = 0; i < 40; i++) {
                const x = o.x + RNG.int(r, o.w), y = o.y + RNG.int(r, o.h);
                if (tiles[idx(x, y)] === T.FLOOR && !taken.has(idx(x, y))) { taken.add(idx(x, y)); return [x, y]; }
            }
            return null;
        };
        // furniture stands on the centre of a room: a room is at least 4x3, so it never blocks the way
        const put = (o, t) => { const c = MAP.centre(o); tiles[idx(c.x, c.y)] = t; taken.add(idx(c.x, c.y)); return c; };
        if (depth % MOBS.PER_SECTOR === 3 && others[0]) {
            const c = put(others[0], T.SHOP), stock = [{ k: 'd_cura', n: 1 }, { k: 'merendina', n: 1 }];
            while (stock.length < 6) stock.push(makeItem(r, depth + 2));
            s.shop = { x: c.x, y: c.y, open: 0, stock };
        }
        if (others[1] && RNG.chance(r, 0.4)) { const c = put(others[1], T.ALTAR); s.altar = { x: c.x, y: c.y, used: 0 }; }
        const boss = bossOf(depth);
        if (boss) { const c = cellIn(last); spawn(s, boss.id, c[0], c[1], true); s.sealed = 1; }
        if (depth === FLOORS) tiles[idx(m.stairs.x, m.stairs.y)] = T.FLOOR;      // nothing below the last floor
        const pool = MOBS.LIST.filter((d) => !d.boss && d.floors[0] <= depth && depth <= d.floors[1]);
        const away = plain.filter((o) => o !== m.rooms[0]);
        for (let n = 4 + Math.min(6, depth >> 1) + RNG.int(r, 3); n > 0 && pool.length; n--) {
            const c = cellIn(RNG.pick(r, away));
            if (c) spawn(s, RNG.weighted(r, pool).id, c[0], c[1], RNG.chance(r, 0.7));
        }
        const drop = (o, it) => { const c = cellIn(o); if (c) s.items.push({ x: c[0], y: c[1], it }); };
        for (let n = 4 + RNG.int(r, 4); n > 0; n--) drop(RNG.pick(r, plain), makeItem(r, depth));
        for (let n = 3 + RNG.int(r, 3); n > 0; n--) drop(RNG.pick(r, plain), { k: '$', n: RNG.range(r, 4, 10) + depth * 2 });
        for (const v of m.rooms.filter((o) => o.vault)) {
            drop(v, makeItem(r, depth + 4)); drop(v, makeItem(r, depth + 4)); drop(v, { k: '$', n: 30 + depth * 6 });
        }
        if (depth > 1) {
            const kinds = MOBS.TRAPS.filter((t) => t.effect !== 'pit' || (!boss && depth < FLOORS));
            for (let n = 2 + RNG.int(r, 3); n > 0; n--) { const c = cellIn(RNG.pick(r, plain)); if (c) s.traps.push({ x: c[0], y: c[1], k: RNG.weighted(r, kinds).id, found: 0 }); }
        }
        updateFov(s);
        if ((depth - 1) % MOBS.PER_SECTOR === 0) log(s, sectorOf(depth).intro, 'info');
        log(s, `Piano ${depth} — ${sectorOf(depth).name}.` + (boss ? ' Senti una presenza: le scale sono bloccate.' : ''), 'info');
        fx(s, 'stairs');
    }

    // ── fighting ────────────────────────────────────────────────────────────
    function gainXp(s, n) {
        const p = s.p;
        p.xp += Math.round(n * (1 + stats(s).xp / 100));
        while (p.xp >= xpNeed(p.lvl)) {
            p.xp -= xpNeed(p.lvl); p.lvl++; p.pending++;
            p.maxHp += CLASS[s.cls].hpLvl; p.hp += CLASS[s.cls].hpLvl;
            log(s, `Livello ${p.lvl}! Scegli cosa imparare.`, 'good');
            fx(s, 'level');
        }
        if (p.pending && !p.choices) rollChoices(s);
    }
    function rollChoices(s) {
        const p = s.p;
        const pool = CLS.SKILLS.filter((k) => (!k.cls || k.cls.includes(s.cls)) && (p.skills[k.id] || 0) < (k.max || 3));
        p.choices = RNG.shuffle(s.rng, pool.map((k) => k.id)).slice(0, 3);
    }
    function chooseSkill(s, id) {
        const p = s.p;
        if (!p.pending || !p.choices || !p.choices.includes(id)) return false;
        p.skills[id] = (p.skills[id] || 0) + 1;
        addMods(p, SKILL[id].mod);
        log(s, 'Hai imparato: ' + SKILL[id].name + '.', 'good');
        p.pending--; p.choices = null;
        if (p.pending) rollChoices(s);
        return false;                                   // choosing takes no time
    }
    function heal(s, n) { s.p.hp = Math.min(s.p.maxHp, s.p.hp + n); }
    function hurtPlayer(s, dmg, cause) {
        const p = s.p;
        p.hp -= dmg;
        fx(s, 'hurt', p.x, p.y);
        if (p.hp <= 0) { p.hp = 0; s.status = 'dead'; s.cause = cause; log(s, 'Sei stato sconfitto da ' + cause + '.', 'bad'); }
    }
    function killMob(s, m) {
        const d = MOB[m.k], p = s.p;
        s.mobs.splice(s.mobs.indexOf(m), 1);
        s.kills++;
        log(s, `${d.name}: eliminato.`, 'good');
        fx(s, 'kill', m.x, m.y);
        if (m.loot) s.items.push({ x: m.x, y: m.y, it: { k: '$', n: m.loot } });
        if (m.stolen) s.items.push({ x: m.x, y: m.y, it: m.stolen });
        if (!m.loot && !m.stolen && s.map.tiles[idx(m.x, m.y)] === T.FLOOR) {
            if (d.boss || RNG.chance(s.rng, 0.1)) s.items.push({ x: m.x, y: m.y, it: makeItem(s.rng, s.depth + (d.boss ? 4 : 1)) });
            else if (RNG.chance(s.rng, 0.25)) s.items.push({ x: m.x, y: m.y, it: { k: '$', n: RNG.range(s.rng, 2, 6) + s.depth } });
        }
        if (d.explode && Math.abs(m.x - p.x) + Math.abs(m.y - p.y) <= 2) {
            log(s, `${d.name} esplode!`, 'bad');
            hurtPlayer(s, RNG.range(s.rng, d.explode[0], d.explode[1]), d.name);
        }
        if (d.boss) {
            s.bosses++; s.sealed = 0;
            if (s.depth === FLOORS) { if (s.status === 'play') { s.status = 'won'; log(s, 'Il server è tuo. Hai vinto!', 'good'); } return; }
            log(s, 'Le scale si sbloccano.', 'info');
        }
        gainXp(s, d.xp);
    }
    function hurtMob(s, m, dmg) {
        const d = MOB[m.k];
        m.hp -= dmg; m.asleep = 0; m.hunt = 1;
        fx(s, 'hit', m.x, m.y);
        if (m.hp <= 0) { killMob(s, m); return; }
        if (d.split && m.hp >= 4 && s.mobs.length < MOB_CAP) {
            const c = freeCell(s, s.rng, m.x, m.y);
            if (c) { const half = m.hp >> 1, n = spawn(s, m.k, c[0], c[1], false); n.hp = half; n.hunt = 1; m.hp -= half; log(s, `${d.name} si divide!`, 'bad'); }
        }
        if (d.blink && RNG.chance(s.rng, 0.5)) { const c = freeCell(s, s.rng); if (c) { m.x = c[0]; m.y = c[1]; log(s, `${d.name} si teletrasporta.`); } }
    }
    function attackMob(s, m) {
        const st = stats(s), d = MOB[m.k], sleeping = m.asleep;
        m.asleep = 0; m.hunt = 1;
        if (d.ambush && !m.shown) m.shown = 1;
        if (!sleeping && !RNG.chance(s.rng, hitChance(st.acc, d.dodge || 0))) { log(s, `Manchi ${d.name}.`); fx(s, 'miss', m.x, m.y); return; }
        const crit = RNG.chance(s.rng, st.crit);
        let dmg = rollDamage(s.rng, st.dmg, st.atk + (d.undead ? st.holy : 0), d.def, crit);
        if (sleeping) dmg *= 2 + st.backstab;
        log(s, `${sleeping ? 'Colpisci nel sonno' : crit ? 'Colpo critico su' : 'Colpisci'} ${d.name}: ${dmg}.`);
        hurtMob(s, m, dmg);
        if (st.vamp && RNG.chance(s.rng, st.vamp / 100)) heal(s, 2);
    }
    function mobHit(s, m, dmg, ranged) {
        const d = MOB[m.k], p = s.p, st = stats(s);
        if (!RNG.chance(s.rng, hitChance(d.acc || 0, st.dodge))) { log(s, `${d.name} ti manca.`); return; }
        if (!ranged && d.steal === 'gold' && p.gold > 0) {
            m.loot = Math.min(p.gold, 15 + s.depth * 8); p.gold -= m.loot;
            log(s, `${d.name} ti ruba ${m.loot} crediti e scappa!`, 'bad');
            return;
        }
        if (!ranged && d.steal === 'item' && p.inv.length) {
            const i = RNG.int(s.rng, p.inv.length);
            m.stolen = p.inv.splice(i, 1)[0];
            log(s, `${d.name} ti ruba: ${itemName(s, m.stolen)}!`, 'bad');
            const c = freeCell(s, s.rng); if (c) { m.x = c[0]; m.y = c[1]; }
            return;
        }
        const n = rollDamage(s.rng, dmg, 0, st.def, false);
        log(s, `${d.name} ${ranged ? d.ranged.verb : 'ti colpisce'}: ${n}.`, 'bad');
        hurtPlayer(s, n, d.name);
        if (d.poison && RNG.chance(s.rng, 0.5)) p.st.poison = Math.max(p.st.poison || 0, d.poison);
        if (d.weaken) p.st.weak = 12;
        if (d.stun && RNG.chance(s.rng, 0.3)) p.st.stun = 1;
        if (d.confuse && RNG.chance(s.rng, 0.3)) p.st.conf = 5;
        if (d.leech) m.hp = Math.min(m.max, m.hp + n);
    }

    function mobStep(s, m, dx, dy, occ) {
        const x = m.x + dx, y = m.y + dy, d = MOB[m.k];
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1 || occ.has(idx(x, y)) || (x === s.p.x && y === s.p.y)) return false;
        if (!d.phase && !MAP.walkable(s.map.tiles[idx(x, y)])) return false;
        occ.delete(idx(m.x, m.y)); m.x = x; m.y = y; occ.add(idx(x, y));
        return true;
    }
    function mobTurn(s, m, d, dmap, occ) {
        const p = s.p, dist = Math.abs(m.x - p.x) + Math.abs(m.y - p.y), adj = dist === 1;
        const sees = !!s.vis[idx(m.x, m.y)] && (!p.st.invis || adj);
        const wander = () => { const v = RNG.pick(s.rng, DIRS); mobStep(s, m, v[0], v[1], occ); };
        if (m.fear) m.fear--;
        if (m.fear || m.loot || m.stolen || (d.coward && m.hp * 4 < m.max)) {
            if ((m.loot || m.stolen) && !s.vis[idx(m.x, m.y)]) {
                s.mobs.splice(s.mobs.indexOf(m), 1); occ.delete(idx(m.x, m.y)); m.hp = 0;
                log(s, `${d.name} è sparito con il bottino.`, 'bad');
                return;
            }
            const dm = dmap();
            let best = null, bd = dm[idx(m.x, m.y)];
            for (const v of DIRS) {
                const j = idx(m.x + v[0], m.y + v[1]);
                if (dm[j] > bd && !occ.has(j)) { best = v; bd = dm[j]; }
            }
            if (best && mobStep(s, m, best[0], best[1], occ)) return;
            if (!adj) return;                                              // cornered: it fights
        }
        if (sees) m.hunt = 1;
        if (!m.hunt) { if (d.erratic || RNG.chance(s.rng, 0.2)) wander(); return; }
        if ((p.st.invis && !adj) || (d.erratic && RNG.chance(s.rng, d.erratic))) { wander(); return; }
        if (d.summon && sees && s.turn % d.summon.every === 0 && s.mobs.length < MOB_CAP) {
            const c = freeCell(s, s.rng, m.x, m.y);
            if (c) { const n = spawn(s, d.summon.k, c[0], c[1], false); n.hunt = 1; occ.add(idx(c[0], c[1])); log(s, `${d.name} chiama ${MOB[n.k].name}!`, 'bad'); return; }
        }
        if (d.ranged && sees && dist > 1 && dist <= d.ranged.range) { mobHit(s, m, d.ranged.dmg, true); return; }
        if (d.ambush && !m.shown) { if (!adj) return; m.shown = 1; log(s, `Non era uno scatolone: ${d.name}!`, 'bad'); }
        if (adj) { mobHit(s, m, d.atk, false); return; }
        if (d.still) return;
        if (d.phase) {
            const ax = Math.sign(p.x - m.x), ay = Math.sign(p.y - m.y);
            if (Math.abs(p.x - m.x) >= Math.abs(p.y - m.y)) { if (!mobStep(s, m, ax, 0, occ) && ay) mobStep(s, m, 0, ay, occ); }
            else if (!mobStep(s, m, 0, ay, occ) && ax) mobStep(s, m, ax, 0, occ);
            return;
        }
        const v = MAP.downhill(s.map, dmap(), m.x, m.y, (j) => occ.has(j));
        if (v) mobStep(s, m, v[0], v[1], occ);
    }
    function mobsAct(s) {
        const p = s.p, wake = 0.4 * (1 - stats(s).stealth / 100);
        let dm = null;
        const dmap = () => dm || (dm = MAP.flood(s.map, [idx(p.x, p.y)], (i, t) => MAP.walkable(t)));
        const occ = new Set(s.mobs.map((m) => idx(m.x, m.y)));
        for (const m of s.mobs.slice()) {
            if (s.status !== 'play') return;
            if (m.hp <= 0) continue;
            const d = MOB[m.k];
            if (d.regen && m.hp < m.max) m.hp = Math.min(m.max, m.hp + d.regen);
            if (m.frozen) { m.frozen--; continue; }
            if (m.asleep > 1) { m.asleep--; continue; }                     // a timed sleep (script, skill) runs out first
            if (m.asleep) { if (s.vis[idx(m.x, m.y)] && !p.st.invis && RNG.chance(s.rng, wake)) { m.asleep = 0; m.hunt = 1; } continue; }
            m.en = (m.en || 0) + (d.speed || 1) * (m.slow ? 0.5 : 1);
            while (m.en >= 1 && m.hp > 0 && s.status === 'play') { m.en -= 1; mobTurn(s, m, d, dmap, occ); }
        }
    }

    // ── effects: what items, traps and active skills do ─────────────────────
    const seenMobs = (s) => threats(s).slice();
    const TARGETED = { bolt: 1, freeze: 1, banish: 1, slow: 1, drain: 1 };
    const EFFECTS = {
        heal(s, pw) { heal(s, Math.ceil(s.p.maxHp * pw / 100 * (1 + stats(s).drink / 100))); delete s.p.st.poison; log(s, 'Ti senti molto meglio.', 'good'); },
        strength(s, pw) { addMods(s.p, { atk: pw }); log(s, 'Ti senti più forte: attacco +' + pw + '.', 'good'); },
        life(s, pw) { addMods(s.p, { maxHp: pw }); log(s, 'Vita massima +' + pw + '.', 'good'); },
        poison(s, pw) { s.p.st.poison = Math.max(s.p.st.poison || 0, pw); log(s, 'Che schifo! Ti senti male.', 'bad'); },
        haste(s, pw) { s.p.st.haste = pw; log(s, 'Vai velocissimo!', 'good'); },
        confuse(s, pw) { s.p.st.conf = pw; log(s, 'Ti gira la testa.', 'bad'); },
        invis(s, pw) { s.p.st.invis = pw; log(s, 'Nessuno fa più caso a te.', 'good'); },
        regen(s, pw) { s.p.st.regen = pw; log(s, 'Ti rilassi: recuperi vita a ogni turno.', 'good'); },
        xp(s) { gainXp(s, Math.ceil((xpNeed(s.p.lvl) - s.p.xp) / (1 + stats(s).xp / 100))); },
        teleport(s) { const c = freeCell(s, s.rng); if (c) { s.p.x = c[0]; s.p.y = c[1]; } log(s, 'Ti ritrovi da un’altra parte.', 'info'); },
        map(s) {
            const t = s.map.tiles;
            for (let i = 0; i < t.length; i++) {
                if (t[i] === T.SECRET) t[i] = T.DOOR;
                if (t[i] !== T.WALL) { s.seen[i] = 1; for (const v of DIRS) s.seen[i + v[0] + v[1] * W] = 1; }
            }
            log(s, 'Ora conosci la mappa del piano.', 'info');
        },
        identify(s) { for (const it of s.p.inv) identify(s, it.k); log(s, 'Hai letto il manuale: conosci tutto quello che hai nello zaino.', 'info'); },
        enchW(s) { if (!s.p.weapon) return log(s, 'Non impugni niente: lo script non fa nulla.'); s.p.weapon.e = (s.p.weapon.e || 0) + 1; log(s, 'La tua arma migliora: ' + itemName(s, s.p.weapon) + '.', 'good'); },
        enchA(s) { if (!s.p.armor) return log(s, 'Non indossi niente: lo script non fa nulla.'); s.p.armor.e = (s.p.armor.e || 0) + 1; log(s, 'La tua protezione migliora: ' + itemName(s, s.p.armor) + '.', 'good'); },
        fear(s, pw) { for (const m of seenMobs(s)) { m.asleep = 0; m.fear = MOB[m.k].boss ? pw >> 2 : pw; } log(s, 'I nemici scappano!', 'good'); },
        fire(s, pw) { log(s, 'Tutti i nemici in vista vengono colpiti.', 'good'); for (const m of seenMobs(s)) hurtMob(s, m, Math.round((pw + s.depth) * (1 + stats(s).usb / 100))); },
        summon(s, pw) {
            const pool = MOBS.LIST.filter((d) => !d.boss && !d.still && d.floors[0] <= s.depth && s.depth <= d.floors[1]);
            for (let i = 0; i < pw && s.mobs.length < MOB_CAP && pool.length; i++) { const c = freeCell(s, s.rng, s.p.x, s.p.y); if (c) spawn(s, RNG.pick(s.rng, pool).id, c[0], c[1], false).hunt = 1; }
            log(s, 'Hai generato dei processi ostili!', 'bad');
        },
        sleep(s, pw) { for (const m of seenMobs(s)) if (!MOB[m.k].boss) m.asleep = pw + 1; log(s, 'I nemici si addormentano.', 'good'); },
        recharge(s, pw) { for (const it of s.p.inv) if (ITEM[it.k].cat === 'usb') it.ch += pw; log(s, 'Le tue chiavette si ricaricano.', 'good'); },
        ping(s, pw) { s.p.st.ping = pw; log(s, 'Per un po’ vedi dove sono tutti i nemici.', 'info'); },
        grep(s) {
            for (const t of s.traps) t.found = 1;
            for (let i = 0; i < s.map.tiles.length; i++) if (s.map.tiles[i] === T.SECRET) { s.map.tiles[i] = T.DOOR; s.seen[i] = 1; }
            log(s, 'Trappole e porte segrete del piano: trovate.', 'info');
        },
        bolt(s, pw, m) { const n = Math.round(RNG.range(s.rng, pw, pw * 2) * (1 + stats(s).usb / 100)) + (s.p.lvl >> 1); log(s, `Colpisci ${MOB[m.k].name} da lontano: ${n}.`); hurtMob(s, m, n); },
        freeze(s, pw, m) { m.frozen = MOB[m.k].boss ? pw >> 1 : pw; m.asleep = 0; log(s, `${MOB[m.k].name} è bloccato.`, 'good'); },
        banish(s, pw, m) {
            if (MOB[m.k].boss) return log(s, `${MOB[m.k].name} resiste.`);
            const c = freeCell(s, s.rng); if (c) { m.x = c[0]; m.y = c[1]; m.hunt = 0; }
            log(s, `${MOB[m.k].name} finisce altrove.`, 'good');
        },
        slow(s, pw, m) { m.slow = 1; log(s, `${MOB[m.k].name} va a scatti.`, 'good'); },
        drain(s, pw, m) { const n = RNG.range(s.rng, pw, pw * 2); log(s, `Rubi ${n} di vita a ${MOB[m.k].name}.`, 'good'); heal(s, n >> 1); hurtMob(s, m, n); },
        // traps
        zap(s, pw) { log(s, 'Una scossa!', 'bad'); hurtPlayer(s, pw + (s.depth >> 1) + RNG.int(s.rng, 3), 'una presa scoperta'); },
        alarm(s) { for (const m of s.mobs) { m.asleep = 0; m.hunt = 1; } log(s, 'Suona un allarme: tutto il piano sa dove sei!', 'bad'); },
        pit(s, pw) {
            if (s.sealed || s.depth >= FLOORS) return EFFECTS.zap(s, pw);
            log(s, 'Il pavimento cede: cadi al piano di sotto!', 'bad');
            hurtPlayer(s, pw, 'una botola');
            if (s.status === 'play') { s.depth++; newFloor(s); }
        },
    };

    // ── the player's actions ────────────────────────────────────────────────
    function search(s, chance) {
        const p = s.p; let found = false;
        for (let y = p.y - 1; y <= p.y + 1; y++) for (let x = p.x - 1; x <= p.x + 1; x++) {
            if (s.map.tiles[idx(x, y)] === T.SECRET && RNG.chance(s.rng, chance)) { s.map.tiles[idx(x, y)] = T.DOOR; found = true; log(s, 'Hai trovato una porta segreta!', 'good'); }
        }
        for (const t of s.traps) if (!t.found && Math.abs(t.x - p.x) <= 1 && Math.abs(t.y - p.y) <= 1 && RNG.chance(s.rng, chance)) { t.found = 1; log(s, 'Attento: ' + byTrap[t.k].name + '.', 'info'); }
        if (found) updateFov(s);
    }
    const byTrap = byId(MOBS.TRAPS);
    function pickUp(s) {
        const p = s.p;
        for (const e of itemsAt(s, p.x, p.y)) {
            if (e.it.k === '$') {
                const n = Math.round(e.it.n * (1 + stats(s).luck / 100));
                p.gold += n; s.earned += n; log(s, `+${n} crediti.`, 'good');
            } else if (addInv(s, e.it)) log(s, 'Raccogli: ' + itemName(s, Object.assign({}, e.it, { n: 1 })) + '.');
            else { log(s, 'Lo zaino è pieno: lasci ' + itemName(s, e.it) + '.'); continue; }
            s.items.splice(s.items.indexOf(e), 1);
            fx(s, 'pick');
        }
    }
    function move(s, dx, dy) {
        const p = s.p;
        if (p.st.conf && RNG.chance(s.rng, 0.5)) [dx, dy] = RNG.pick(s.rng, DIRS);
        const x = p.x + dx, y = p.y + dy, t = s.map.tiles[idx(x, y)], m = mobAt(s, x, y);
        if (m) { attackMob(s, m); return true; }
        if (t === T.SHOP) { s.shop.open = 1; return false; }
        if (t === T.ALTAR) return pray(s);
        if (!MAP.walkable(t)) return false;
        p.x = x; p.y = y;
        const trap = s.traps.find((e) => e.x === x && e.y === y);
        if (trap) {
            const was = s.depth;
            trap.found = 1;
            log(s, byTrap[trap.k].name + '!', 'bad');
            EFFECTS[byTrap[trap.k].effect](s, byTrap[trap.k].power);
            if (s.depth !== was) return true;
        }
        pickUp(s);
        if (t === T.STAIRS) log(s, s.sealed ? 'Le scale sono bloccate: c’è ancora il boss.' : 'Qui ci sono le scale: premi Scendi.', 'info');
        return true;
    }
    function pray(s) {
        const p = s.p;
        if (s.altar.used) { log(s, 'Il terminale è spento.'); return false; }
        s.altar.used = 1;
        const n = RNG.int(s.rng, 100);
        if (n < 15) { log(s, 'Il vecchio terminale si accende… KERNEL PANIC.', 'bad'); EFFECTS.summon(s, 2); }
        else if (n < 40) { p.hp = p.maxHp; p.st = {}; log(s, 'Il terminale ripristina un backup: sei come nuovo.', 'good'); }
        else if (n < 55) { addMods(p, { maxHp: 4 }); log(s, 'Il terminale installa un aggiornamento: vita massima +4.', 'good'); }
        else if (n < 70) EFFECTS.enchW(s);
        else if (n < 85) EFFECTS.enchA(s);
        else { p.food = MAX_FOOD; EFFECTS.identify(s); }
        return true;
    }
    function useItem(s, i) {
        const p = s.p, it = p.inv[i];
        if (!it) return false;
        const d = ITEM[it.k], c = ITEMS.CATS[d.cat];
        if (c.slot) {
            p.inv.splice(i, 1);
            if (p[c.slot]) p.inv.push(p[c.slot]);
            p[c.slot] = it;
            identify(s, it.k);
            log(s, (d.cat === 'weapon' ? 'Impugni: ' : d.cat === 'armor' ? 'Indossi: ' : 'Installi: ') + itemName(s, it) + '.');
            return true;
        }
        if (d.cat === 'food') { p.food = Math.min(MAX_FOOD, p.food + d.food); log(s, 'Mangi: ' + d.name + '.', 'good'); useUp(s, i); return true; }
        let target = null;
        if (d.cat === 'usb') {
            if (it.ch <= 0) { log(s, 'La chiavetta è scarica.'); return false; }
            target = nearest(s);
            if (!target) { log(s, 'Non vedi nessun nemico.'); return false; }
            it.ch--;
        } else useUp(s, i);
        log(s, (d.cat === 'drink' ? 'Bevi: ' : d.cat === 'script' ? 'Lanci: ' : 'Usi: ') + d.name + '.');
        identify(s, it.k);
        EFFECTS[d.effect](s, d.power, target);
        return true;
    }
    function dropItem(s, i) {
        const p = s.p, it = p.inv[i];
        if (!it) return false;
        p.inv.splice(i, 1);
        s.items.push({ x: p.x, y: p.y, it });
        log(s, 'Lasci: ' + itemName(s, it) + '.');
        return true;
    }
    function unequip(s, slot) {
        const p = s.p;
        if (!['weapon', 'armor', 'plugin'].includes(slot) || !p[slot]) return false;
        if (p.inv.length >= INV_CAP) { log(s, 'Lo zaino è pieno.'); return false; }
        p.inv.push(p[slot]); p[slot] = null;
        return true;
    }
    function descend(s) {
        if (s.map.tiles[idx(s.p.x, s.p.y)] !== T.STAIRS) { log(s, 'Qui non ci sono scale.'); return false; }
        if (s.sealed) { log(s, 'Le scale sono bloccate: c’è ancora il boss.'); return false; }
        s.depth++;
        newFloor(s);
        return true;
    }
    function useActive(s) {
        const p = s.p, a = CLASS[s.cls].active;
        if (p.cd > 0) { log(s, `${a.name}: pronta tra ${p.cd} turni.`); return false; }
        const target = TARGETED[a.effect] ? nearest(s) : null;
        if (TARGETED[a.effect] && !target) { log(s, 'Non vedi nessun nemico.'); return false; }
        log(s, a.name + '!', 'info');
        p.cd = Math.round(a.cd * (1 - Math.min(60, stats(s).cd) / 100));
        EFFECTS[a.effect](s, a.power, target);
        return true;
    }
    function buy(s, i) {
        const e = s.shop.stock[i];
        if (!e) return;
        const cost = price(s, e);
        if (s.p.gold < cost) return log(s, 'Non hai abbastanza crediti.');
        if (!addInv(s, e)) return log(s, 'Lo zaino è pieno.');
        s.p.gold -= cost;
        s.shop.stock.splice(i, 1);
        s.known[e.k] = 1;
        log(s, 'Compri: ' + itemName(s, e) + '.', 'good');
        fx(s, 'pick');
    }

    function endTurn(s) {
        const p = s.p, st = stats(s);
        s.turn++;
        updateFov(s);
        if (!(p.st.haste && s.turn % 2)) mobsAct(s);                       // with haste the enemies move every other turn
        if (s.status !== 'play') return;
        if (p.st.poison) hurtPlayer(s, 1, 'un malessere');
        for (const k in p.st) if (--p.st[k] <= 0) delete p.st[k];
        if (p.cd > 0) p.cd--;
        if (s.turn % 100 >= st.hunger) {
            p.food--;
            if (p.food === 150) log(s, 'Hai fame: mangia qualcosa.', 'bad');
            if (p.food === 0) log(s, 'Stai morendo di fame!', 'bad');
        }
        if (p.food <= 0) { p.food = 0; if (s.turn % 8 === 0) hurtPlayer(s, 1, 'la fame'); }
        else if (p.hp < p.maxHp && (p.st.regen || s.turn % Math.max(2, 12 - (p.lvl >> 1) - st.regen * 2) === 0)) p.hp++;
        if (st.recharge && s.turn % Math.max(15, 60 - st.recharge * 15) === 0) for (const it of p.inv) if (ITEM[it.k].cat === 'usb' && it.ch < ITEM[it.k].ch) it.ch++;
        if (s.status === 'play') search(s, 0.12 + st.search / 100);
    }

    /** Plays one action. True when it took a turn (the enemies moved). */
    function act(s, a) {
        if (s.status !== 'play') return false;
        const p = s.p;
        s.fx = [];
        if (a.t === 'skill') return chooseSkill(s, a.id);
        if (p.pending) return false;
        if (s.shop && s.shop.open) {
            if (a.t === 'buy') buy(s, a.i); else s.shop.open = 0;
            return false;
        }
        let took = false;
        if (p.st.stun) { log(s, 'Sei bloccato!', 'bad'); took = true; }
        else if (a.t === 'move') took = move(s, a.dx, a.dy);
        else if (a.t === 'wait') { took = true; search(s, 0.5); }
        else if (a.t === 'use') took = useItem(s, a.i);
        else if (a.t === 'drop') took = dropItem(s, a.i);
        else if (a.t === 'unequip') took = unequip(s, a.slot);
        else if (a.t === 'descend') took = descend(s);
        else if (a.t === 'active') took = useActive(s);
        if (took && s.status === 'play') endTurn(s);
        if (s.status === 'play') updateFov(s);
        return took;
    }

    // ── walking by itself (tap a cell, the Esplora button, the test bot) ────
    function knownPass(s) {
        const traps = new Set(s.traps.filter((t) => t.found).map((t) => idx(t.x, t.y)));
        return (i, t) => !!s.seen[i] && MAP.walkable(t) && !traps.has(i);
    }
    /** The next step [dx, dy] towards a cell, over what the player has seen; null when there is no known way. */
    function travelNext(s, tx, ty) {
        const ok = knownPass(s), ti = idx(tx, ty);
        if (!s.seen[ti]) return null;
        const dist = MAP.flood(s.map, [ti], ok);
        return MAP.downhill(s.map, dist, s.p.x, s.p.y);
    }
    /** The next step towards the nearest thing worth walking to: something to pick up, or a place not seen yet. */
    function exploreNext(s) {
        const p = s.p, ok = knownPass(s), dist = MAP.flood(s.map, [idx(p.x, p.y)], ok);
        const loot = new Set(s.items.filter((e) => s.seen[idx(e.x, e.y)] && canTake(s, e.it)).map((e) => idx(e.x, e.y)));
        let best = -1;
        for (let i = 0; i < dist.length; i++) {
            if (dist[i] < 1 || (best >= 0 && dist[i] >= dist[best])) continue;
            if (loot.has(i) || !s.seen[i - 1] || !s.seen[i + 1] || !s.seen[i - W] || !s.seen[i + W]) best = i;
        }
        if (best < 0) return null;
        while (dist[best] > 1) for (const v of DIRS) { const j = best + v[0] + v[1] * W; if (dist[j] === dist[best] - 1) { best = j; break; } }
        return [best % W - p.x, ((best / W) | 0) - p.y];
    }

    // ── a new run, saving, the profile ──────────────────────────────────────
    function newGame(seed, cls, meta) {
        const c = CLASS[cls] && unlocked(meta || newMeta(), CLASS[cls]) ? CLASS[cls] : CLS.CLASSES[0];
        const s = {
            v: VERSION, seed: seed >>> 0, cls: c.id, rng: RNG.make(RNG.mix(seed, 4242)), depth: 1, turn: 0, status: 'play', cause: '',
            log: [], fx: [], known: {}, looks: {}, nid: 1, kills: 0, bosses: 0, earned: 0,
            p: { x: 0, y: 0, hp: c.hp, maxHp: c.hp, lvl: 1, xp: 0, gold: 0, food: 900, cd: 0, weapon: null, armor: null, plugin: null,
                 inv: [], st: {}, mods: {}, skills: {}, pending: 0, choices: null },
        };
        addMods(s.p, c.mods);
        const looks = RNG.make(RNG.mix(seed, 777));
        for (const k in ITEMS.LOOKS) {
            const order = RNG.shuffle(looks, ITEMS.LOOKS[k].map((e, i) => i));
            ITEMS.LIST.filter((d) => d.cat === k).forEach((d, i) => { s.looks[d.id] = order[i % order.length]; });
        }
        for (const k of c.kit) {
            const d = ITEM[k], slot = ITEMS.CATS[d.cat].slot, it = { k };
            if (d.cat === 'usb') it.ch = d.ch;
            if (ITEMS.CATS[d.cat].stack) it.n = 1;
            s.known[k] = 1;
            if (slot && !s.p[slot]) s.p[slot] = it; else addInv(s, it);
        }
        log(s, `Sei ${c.name}. Scendi fino in fondo e spegni il server.`, 'info');
        newFloor(s);
        return s;
    }
    const save = (s) => JSON.stringify(s);
    function load(text) {
        try {
            const s = JSON.parse(text);
            if (!s || s.v !== VERSION || !s.p || !s.map || s.map.tiles.length !== W * H || !CLASS[s.cls]) return null;
            return s;
        } catch (e) { return null; }
    }
    const newMeta = () => ({ v: 1, best: 0, wins: 0, bosses: 0, runs: 0, crediti: 0, history: [] });
    const unlocked = (meta, c) => !c.unlock || Object.keys(c.unlock).every((k) => (meta[k] || 0) >= c.unlock[k]);
    /** Adds a finished run to the profile (once). `date` comes from the page: the rules have no clock. */
    function recordRun(meta, s, date) {
        if (s.status === 'play' || s.recorded) return meta;
        s.recorded = 1;
        const gain = s.depth * 2 + s.bosses * 10 + (s.status === 'won' ? 50 : 0);
        meta.best = Math.max(meta.best, s.depth);
        meta.runs++; meta.bosses += s.bosses; meta.crediti += gain;
        if (s.status === 'won') meta.wins++;
        meta.history.unshift({ cls: s.cls, depth: s.depth, lvl: s.p.lvl, turns: s.turn, kills: s.kills, won: s.status === 'won', cause: s.cause, seed: s.seed, date: date || '', crediti: gain });
        meta.history.length = Math.min(meta.history.length, 30);
        return meta;
    }

    return { VERSION, FLOORS, INV_CAP, MAX_FOOD, MOB, ITEM, CLASS, SKILL, EFFECTS, TARGETED, newGame, act, save, load, stats, hitChance, rollDamage, xpNeed,
        itemName, itemInfo, itemLook, known, price, canTake, shown, threats, nearest, mobAt, itemsAt, sectorOf, bossOf, travelNext, exploreNext,
        newMeta, unlocked, recordRun, updateFov };
});
