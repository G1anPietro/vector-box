// js/rogue/game.js — the rules of "Il Dungeon del Server". No DOM, no clock, no Math.random: the whole run is one
// plain object (JSON), so it is saved after every turn and a seed always replays the same way.
//   const s = newGame(seed, 'studente', meta);  act(s, { t: 'move', dx: 1, dy: 0 });  save(s) / load(text)
// The rules never write a sentence: log(s, 'key', { params }, colour) stores a message that the page turns into text in the language of
// the moment (see text.js; text(msg, lang) here resolves the ids in the params). A saved run keeps its messages, so it reads in either language.
// Actions: move {dx,dy} (8 directions, no corner cutting, doors straight) · wait · sleep (one turn; repeat while s.sleeping) · search · throw {i,x,y} · use {i} · drop {i} · unequip {slot} · descend · active · skill {id} · buy {i} · rest · recycle {i} · leave
// HOW TO ADD AN EFFECT (for a new item, trap or active skill): add a function to EFFECTS below; it receives
// (state, power, targetMonster). Put its name in TARGETED if it needs an enemy in sight.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        require('./text-systems.js');                                  // merges its sentences into text.js's MSG
        module.exports = factory(require('./rng.js'), require('./map.js'), require('./mobs.js'), require('./items.js'), require('./classes.js'), require('./meta.js'), require('./text.js'), require('./hazards.js'), require('./recipes.js'));
    } else { const R = root.Rogue; R.game = factory(R.rng, R.map, R.mobs, R.items, R.classes, R.meta, R.text, R.hazards, R.recipes); }
})(typeof self !== 'undefined' ? self : this, function (RNG, MAP, MOBS, ITEMS, CLS, META, TX, HZ, RC) {
    'use strict';
    // crafting adds its own category and items to the item tables (see recipes.js)
    for (const k in RC.CATS) if (!ITEMS.CATS[k]) ITEMS.CATS[k] = RC.CATS[k];
    for (const it of RC.ITEMS) if (!ITEMS.LIST.some((e) => e.id === it.id)) ITEMS.LIST.push(it);
    const VERSION = 2, W = MAP.W, H = MAP.H, T = MAP.T, DIRS = MAP.DIRS;
    const FLOORS = MOBS.SECTORS.length * MOBS.PER_SECTOR;
    const SLEEP_CAP = 100, MOB_CAP = 40, INV_CAP = 24, MAX_FOOD = 1200, SIGHT = 8, THROW_RANGE = 6, SEARCH_RADIUS = 3;
    const byId = (list) => Object.fromEntries(list.map((e) => [e.id, e]));
    const MOB = byId(MOBS.LIST), ITEM = byId(ITEMS.LIST), CLASS = byId(CLS.CLASSES), SKILL = byId(CLS.SKILLS);
    const idx = (x, y) => y * W + x;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const HAZ = HZ.BY_ID, SECTOR = byId(MOBS.SECTORS), MEDAL = byId(META.MEDALS), TRAP = byId(MOBS.TRAPS);
    const sectorOf = (depth) => MOBS.SECTORS[Math.min(MOBS.SECTORS.length - 1, Math.floor((depth - 1) / MOBS.PER_SECTOR))];
    const bossOf = (depth) => MOBS.LIST.find((d) => d.boss === depth);
    /** ELITES (mini-bosses): a monster of mobs.js with `elite: true` (the 3rd floor of the sector its `floors` start in) or `elite: <floor number>`.
     *  One per floor at most: it sleeps in its own room, wears a crown, and drops a guaranteed item (`drop: 'item id'` if the monster names one, else a good random one). */
    const eliteDepth = (d) => (typeof d.elite === 'number' ? d.elite : d.elite ? Math.floor((d.floors[0] - 1) / MOBS.PER_SECTOR) * MOBS.PER_SECTOR + 3 : 0);
    const eliteOf = (depth) => MOBS.LIST.find((d) => d.elite && !d.boss && eliteDepth(d) === depth);
    const cat = (it) => ITEMS.CATS[ITEM[it.k].cat];

    /** Adds a message to the log: `key` is a key of text.js, `p` its params (ids, numbers), `c` the colour class. */
    function log(s, key, p, c) { s.log.push({ m: p ? { k: key, p } : { k: key }, c: c || '' }); if (s.log.length > 50) s.log.shift(); }
    const mobCause = (id) => ({ k: 'cause_mob', p: { mob: id } });
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
    /** What a name needs to be written in any language later: { k, u (look index while unknown), e (+), ch (USB charges), n (stack) }. */
    function itemRef(s, it) {
        const r = { k: it.k };
        if (it.k === '$') { r.n = it.n; return r; }
        const d = ITEM[it.k];
        if (!known(s, it)) r.u = s.looks[it.k];
        if (it.e) r.e = it.e;
        if (d.cat === 'usb' && known(s, it)) r.ch = it.ch;
        if (it.n > 1) r.n = it.n;
        return r;
    }
    /** The name of an item reference in a language. */
    function itemText(r, lang) {
        if (!r) return '';
        if (r.k === '$') return TX.t('credits_n', { n: r.n }, lang);
        const d = ITEM[r.k];
        if (!d) return String(r.k);
        let n;
        if (r.u === undefined) n = TX.tx(d.name, lang);
        else { n = TX.fill(TX.tx(ITEMS.CATS[d.cat].unk, lang), { look: TX.tx(ITEMS.LOOKS[d.cat][r.u][0], lang) }); n = n.charAt(0).toUpperCase() + n.slice(1); }
        if (r.e) n += ' +' + r.e;
        if (r.ch !== undefined) n += ' (' + r.ch + ')';
        if (r.n > 1) n += ' ×' + r.n;
        return n;
    }
    const itemName = (s, it, lang) => itemText(itemRef(s, it), lang || 'en');
    /** The one-line description of an item as a message. */
    function itemInfoMsg(s, it) {
        const d = ITEM[it.k];
        if (!known(s, it)) return { k: 'item_unknown' };
        const e = it.e || 0;
        if (d.cat === 'weapon') return { k: 'item_weapon', p: { a: d.dmg[0] + e, b: d.dmg[1] + e, desc: d.id } };
        if (d.cat === 'armor') return { k: 'item_armor', p: { d: d.def + e, desc: d.id } };
        return { k: 'm_desc', p: { desc: d.id } };
    }
    const itemInfo = (s, it, lang) => text(itemInfoMsg(s, it), lang || 'en');
    // ── messages: ids in the params are turned into names, in the language asked for
    const safe = (table, pick) => (v, lang) => (table[v] ? TX.tx(pick(table[v]), lang) : String(v));
    const RESOLVE = {
        mob: safe(MOB, (d) => d.name), item: (v, lang) => itemText(v, lang), skill: safe(SKILL, (d) => d.name), cls: safe(CLASS, (d) => d.name),
        active: safe(CLASS, (d) => d.active.name), haz: safe(HAZ, (d) => d.name), recipe: safe(byId(RC.RECIPES), (d) => d.name), hazinfo: safe(HAZ, (d) => d.info), trap: safe(TRAP, (d) => d.name), sector: safe(SECTOR, (d) => d.name), intro: safe(SECTOR, (d) => d.intro),
        verb: safe(MOB, (d) => (d.ranged ? d.ranged.verb : '')), desc: safe(ITEM, (d) => d.info || ''), medal: safe(MEDAL, (d) => d.name), mobinfo: safe(MOB, (d) => d.info || ''),
        cause: (v, lang) => text(v, lang),
    };
    /** A message { k, p } (or an old saved plain string) as text in a language ('en' | 'it'). */
    function text(m, lang) {
        if (m === null || m === undefined) return '';
        if (typeof m === 'string') return m;
        if (Array.isArray(m)) return m.map((x) => text(x, lang)).join(', ');
        const vars = {};
        for (const k in m.p || {}) { const f = RESOLVE[k.replace(/\d+$/, '')]; vars[k] = f ? f(m.p[k], lang || 'en') : m.p[k]; }
        return TX.t(m.k, vars, lang || 'en');
    }
    const logText = (entry, lang) => (entry.m ? text(entry.m, lang) : entry.t || '');
    function itemLook(s, it) {
        if (it.k === '$') return { shape: 'coin', col: '#ffb000' };
        const d = ITEM[it.k], c = ITEMS.CATS[d.cat];
        // a sprite chain (exact key > archetype > category drawing); an unidentified item shows only its category drawing
        return { shape: c.unknown && !s.known[it.k] ? c.shape : [d.sprite, 'i:' + d.id, d.archetype, d.shape, c.shape].filter(Boolean).join('>'), col: c.unknown ? ITEMS.LOOKS[d.cat][s.looks[it.k]][1] : d.col || c.col };
    }
    function identify(s, k) {
        if (!ITEMS.CATS[ITEM[k].cat].unknown || s.known[k]) return;
        s.known[k] = 1;
        log(s, 'known_now', { item: { k } }, 'info');
    }
    function makeItem(r, depth) {
        const d = RNG.weighted(r, ITEMS.LIST.filter((e) => (e.from || 1) <= depth));
        const it = { k: d.id };
        if (d.cat === 'weapon' || d.cat === 'armor') it.e = RNG.chance(r, 0.15) ? (RNG.chance(r, 0.25) ? 2 : 1) : 0;
        if (d.cat === 'usb') it.ch = d.ch + RNG.int(r, 3);
        if (ITEMS.CATS[d.cat].stack) it.n = d.cat === 'throw' ? 2 + RNG.int(r, 3) : 1;
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
    const hazAt = (s, x, y) => (s.haz || []).find((h) => h.x === x && h.y === y);
    const free = (s, x, y) => s.map.tiles[idx(x, y)] === T.FLOOR && !hazAt(s, x, y) && !mobAt(s, x, y) && (s.p.x !== x || s.p.y !== y);
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
        const hp = Math.round(MOB[k].hp * (1 + 0.3 * (s.tier || 0))), m = { id: s.nid++, k, x, y, hp, max: hp, asleep: asleep ? 1 : 0 };
        s.mobs.push(m);
        return m;
    }
    function updateFov(s) {
        s.vis = MAP.fov(s.map, s.p.x, s.p.y, SIGHT + stats(s).sight);
        for (let i = 0; i < s.vis.length; i++) if (s.vis[i]) s.seen[i] = 1;
        for (const m of s.mobs) if (!s.met[m.k] && s.vis[idx(m.x, m.y)] && shown(s, m)) s.met[m.k] = 1;
    }
    /** Can the player see this monster? (Crates that bite and invisible things are not seen from far.) */
    function shown(s, m) {
        const d = MOB[m.k], near = Math.max(Math.abs(m.x - s.p.x), Math.abs(m.y - s.p.y)) <= 1;
        if (d.ambush && !m.shown) return false;
        if (d.invisible && !near) return false;
        return (!!s.vis[idx(m.x, m.y)] && (near || !fogAt(s, m.x, m.y))) || !!s.p.st.ping;
    }
    /** Fog hides what is inside it unless you stand next to it. */
    const fogAt = (s, x, y) => { const h = hazAt(s, x, y); return !!h && HAZ[h.k].kind === 'fog' && Math.max(Math.abs(x - s.p.x), Math.abs(y - s.p.y)) > 1; };
    const threats = (s) => s.mobs.filter((m) => shown(s, m) && s.vis[idx(m.x, m.y)]);
    function nearest(s) {
        let best = null, bd = 99;
        for (const m of threats(s)) { const d = Math.abs(m.x - s.p.x) + Math.abs(m.y - s.p.y); if (d < bd) { bd = d; best = m; } }
        return best;
    }

    /** Is the monster (or any {x, y}) next to the player, diagonals included, with the corner rule (nothing is hit around a corner or through a door)? */
    function touching(s, e) {
        const dx = e.x - s.p.x, dy = e.y - s.p.y;
        return Math.max(Math.abs(dx), Math.abs(dy)) === 1 && MAP.diagOk(s.map, s.p.x, s.p.y, dx, dy);
    }

    // ── terrain hazards (see hazards.js) ──
    /** Scatters the sector's hazard in a few small patches over the plain rooms: deterministic from (seed, floor), never on the spawn, the stairs or anything
     *  already placed (`taken`), and never cutting the floor: every cell that was reachable without hazards still is (checked cell by cell). */
    function placeHazards(s, m, taken) {
        const def = HZ.ofSector(sectorOf(s.depth).id);
        s.haz = [];
        if (!def) return;
        const r = RNG.make(RNG.mix(s.seed, s.depth * 104729 + 11)), fi = (s.depth - 1) % MOBS.PER_SECTOR, tiles = s.map.tiles;
        const rooms = m.rooms.filter((o) => !o.vault && o !== m.rooms[0] && !o.last);
        if (!rooms.length) return;
        const from = [idx(m.start.x, m.start.y)], blocked = new Set(), solid = (i, t) => MAP.walkable(t) && !blocked.has(i);
        const count = () => { let n = 0; for (const d of MAP.flood(s.map, from, solid)) if (d >= 0) n++; return n; };
        const base = count();
        const ok = (i) => {
            blocked.add(i);
            const good = count() === base - blocked.size && MAP.flood(s.map, from, solid)[idx(m.stairs.x, m.stairs.y)] >= 0;
            if (!good) blocked.delete(i);
            return good;
        };
        for (let n = 1 + (fi >= 2 ? 1 : 0) + (fi >= 4 ? 1 : 0) + RNG.int(r, 2); n > 0; n--) {
            const d = def.mix ? HAZ[RNG.pick(r, def.mix)] : def, o = RNG.pick(r, rooms), size = 2 + RNG.int(r, 3), dir = RNG.pick(r, DIRS);
            let x = o.x + RNG.int(r, o.w), y = o.y + RNG.int(r, o.h);
            for (let k = 0; k < size; k++) {
                const i = idx(x, y);
                if (x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h && tiles[i] === T.FLOOR && !taken.has(i) && !hazAt(s, x, y) && (d.kind === 'fog' || ok(i))) {
                    taken.add(i);
                    s.haz.push(d.kind === 'push' ? { x, y, k: d.id, d: dir } : { x, y, k: d.id });
                }
                if (d.kind === 'push') { x += dir[0]; y += dir[1]; } else { const v = RNG.pick(r, DIRS); x = clamp(x + v[0], o.x, o.x + o.w - 1); y = clamp(y + v[1], o.y, o.y + o.h - 1); }
            }
        }
    }
    const hazCause = (id) => ({ k: 'cause_haz', p: { haz: id } });
    const hazDamage = (s, d) => { const [a, b] = HZ.damageRange(d, s.depth, s.tier); return RNG.range(s.rng, a, b); };
    /** What each kind of hazard does to the hero who steps on it (dx, dy = the step that brought him). */
    const HAZARD_FX = {
        poison(s, h, d) { s.p.st.poison = Math.max(s.p.st.poison || 0, d.turns); log(s, 'haz_poison', { haz: d.id }, 'bad'); },
        slide(s, h, d, dx, dy) {
            const p = s.p, x = p.x + dx, y = p.y + dy;
            log(s, 'haz_slide', { haz: d.id }, 'bad');
            if (MAP.walkable(s.map.tiles[idx(x, y)]) && !mobAt(s, x, y) && MAP.diagOk(s.map, p.x, p.y, dx, dy)) { p.x = x; p.y = y; }
        },
        shock(s, h, d) { const n = hazDamage(s, d); log(s, 'haz_shock', { haz: d.id, n }, 'bad'); hurtPlayer(s, n, hazCause(d.id)); },
        push(s, h, d, dx, dy) {
            const p = s.p, x = p.x + h.d[0], y = p.y + h.d[1];
            if (h.d[0] === -dx && h.d[1] === -dy) { log(s, 'haz_push_against', { haz: d.id }, 'info'); return; }     // wading against the stream: no push (else it could never be crossed)
            log(s, 'haz_push', { haz: d.id }, 'bad');
            if (MAP.walkable(s.map.tiles[idx(x, y)]) && !mobAt(s, x, y)) { p.x = x; p.y = y; }
        },
        collapse(s, h, d) { const n = hazDamage(s, d); s.haz.splice(s.haz.indexOf(h), 1); log(s, 'haz_collapse', { haz: d.id, n }, 'bad'); hurtPlayer(s, n, hazCause(d.id)); },
        fog() { /* harmless: it only hides things */ },
        fire(s, h, d) { const n = hazDamage(s, d); log(s, 'haz_fire', { haz: d.id, n }, 'bad'); s.p.st.burn = Math.max(s.p.st.burn || 0, d.turns); hurtPlayer(s, n, hazCause(d.id)); },
        lag(s, h, d) { s.p.st.stun = 2; log(s, 'haz_lag', { haz: d.id }, 'bad'); },
        heat(s, h, d) { s.p.food = Math.max(0, s.p.food - d.food); s.p.cd += 3; log(s, 'haz_heat', { haz: d.id }, 'bad'); },
    };

    function newFloor(s) {
        const depth = s.depth, r = RNG.make(RNG.mix(s.seed, depth * 7919 + 17));
        const elite = eliteOf(depth), m = MAP.generate(s.seed, depth, elite ? { elite: true } : undefined), tiles = m.tiles;
        s.map = { w: W, h: H, tiles, stairs: m.stairs };
        s.seen = new Array(W * H).fill(0);
        s.mobs = []; s.items = []; s.traps = []; s.haz = []; s.shop = null; s.bench = null; s.hub = 0; s.altar = null; s.sealed = 0;
        s.p.x = m.start.x; s.p.y = m.start.y;
        const plain = m.rooms.filter((o) => !o.vault), last = m.rooms.find((o) => o.last);
        const others = RNG.shuffle(r, plain.filter((o) => o !== m.rooms[0] && !o.last && !o.elite));
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
        if (elite) { const er = m.rooms.find((o) => o.elite), c = er && cellIn(er); if (c) { spawn(s, elite.id, c[0], c[1], true).elite = 1; s.elite = elite.id; } }
        const pool = MOBS.LIST.filter((d) => !d.boss && !d.elite && d.floors[0] <= depth && depth <= d.floors[1]);
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
        placeHazards(s, m, taken);
        updateFov(s);
        if ((depth - 1) % MOBS.PER_SECTOR === 0) log(s, 'sector_intro', { intro: sectorOf(depth).id }, 'info');
        log(s, boss ? 'floor_enter_boss' : 'floor_enter', { depth, sector: sectorOf(depth).id }, 'info');
        if (s.mobs.some((e) => e.elite)) log(s, 'floor_elite', { mob: elite.id }, 'info');
        fx(s, 'stairs');
    }


    /** The safe room between two sectors (the Sala Server): a shop, a bench to rest and recycle, and the stairs down. */
    function enterHub(s) {
        const m = MAP.hub(), r = RNG.make(RNG.mix(s.seed, s.depth * 31 + 5)), nextSector = sectorOf(s.depth + 1);
        s.map = { w: W, h: H, tiles: m.tiles, stairs: m.stairs };
        s.seen = new Array(W * H).fill(0);
        for (let y = 8; y < 19; y++) for (let x = 13; x < 28; x++) s.seen[idx(x, y)] = 1;
        s.mobs = []; s.items = []; s.traps = []; s.haz = []; s.altar = null; s.sealed = 0; s.hub = 1;
        s.p.x = m.start.x; s.p.y = m.start.y;
        m.tiles[idx(16, 12)] = T.SHOP; m.tiles[idx(24, 12)] = T.BENCH;
        const stock = [{ k: 'd_cura', n: 1 }, { k: 'd_cura', n: 1 }, { k: 'merendina', n: 1 }, { k: 'panino', n: 1 }];
        while (stock.length < 9) stock.push(makeItem(r, s.depth + 3));
        s.shop = { x: 16, y: 12, open: 0, stock };
        s.bench = { x: 24, y: 12, open: 0 };
        updateFov(s);
        log(s, 'hub_enter', null, 'info');
        log(s, 'hub_next', { sector: nextSector.id }, 'info');
        fx(s, 'stairs');
    }
    function rest(s) { s.p.hp = s.p.maxHp; s.p.st = {}; s.p.cd = 0; log(s, 'rested', null, 'good'); }
    /** Recycling: an item from the bag becomes credits (half its price). Only in the hub. */
    function recycle(s, i) {
        const it = s.p.inv[i];
        if (!it) return;
        const gain = Math.max(1, Math.round(ITEM[it.k].price / 2));
        useUp(s, i); s.p.gold += gain;
        log(s, 'recycled', { item: { k: it.k }, gain }, 'good');
    }

    // ── crafting at the bench (recipes.js) ──
    const fits = (m, k) => (m.startsWith('cat:') ? ITEM[k].cat === m.slice(4) : m === k);
    /** Do the matchers `ms` accept the item ids `ks` in some order? */
    function matches(ms, ks) {
        const used = [], go = (i) => i === ms.length || ks.some((k, j) => !used[j] && fits(ms[i], k) && (used[j] = true, go(i + 1) || (used[j] = false)));
        return ms.length === ks.length && go(0);
    }
    /** The recipe (or undefined) for a list of item ids. */
    const recipeFor = (ks) => RC.RECIPES.find((r) => matches(r.in, ks));
    const CRAFT_FX = {
        recharge(s, used) { const u = used.find((it) => ITEM[it.k].cat === 'usb'); u.ch = Math.max(u.ch, ITEM[u.k].ch) + 2; return [u]; },
    };
    /** Combines the bag items at the indexes `picks` (2 or 3; a stack index may repeat, once per unit). Takes no turn. */
    function craft(s, picks) {
        const p = s.p, inv = p.inv;
        if (!Array.isArray(picks) || picks.length < 2 || picks.length > 3 || picks.some((i) => !inv[i])) return;
        const count = {};
        for (const i of picks) count[i] = (count[i] || 0) + 1;
        if (Object.keys(count).some((i) => count[i] > (inv[i].n || 1))) return;
        const r = recipeFor(picks.map((i) => inv[i].k));
        if (!r) { log(s, 'craft_none'); return; }
        const used = picks.map((i) => Object.assign({}, inv[i], { n: 1 }));
        for (const i of Object.keys(count).map(Number).sort((a, b) => b - a)) { if (inv[i].n > count[i]) inv[i].n -= count[i]; else inv.splice(i, 1); }
        let out;
        if (r.out.fn) out = CRAFT_FX[r.out.fn](s, used);
        else out = r.out.give.map((g) => { const k = g.k || g, d = ITEM[k], it = { k }; if (ITEMS.CATS[d.cat].stack) it.n = g.n || 1; if (d.cat === 'usb') it.ch = d.ch; if (d.cat === 'weapon' || d.cat === 'armor') it.e = 0; return it; });
        for (const it of out) { s.known[it.k] = 1; if (!addInv(s, it)) s.items.push({ x: p.x, y: p.y, it }); }
        log(s, 'craft_ok', { item: itemRef(s, out[0]), recipe: r.id }, 'good');
        if (!s.recipes[r.id]) { s.recipes[r.id] = 1; log(s, 'craft_new', { recipe: r.id }, 'info'); }
        fx(s, 'pick');
    }

    // ── fighting ────────────────────────────────────────────────────────────
    function gainXp(s, n) {
        const p = s.p;
        p.xp += Math.round(n * (1 + stats(s).xp / 100));
        while (p.xp >= xpNeed(p.lvl)) {
            p.xp -= xpNeed(p.lvl); p.lvl++; p.pending++;
            p.maxHp += CLASS[s.cls].hpLvl; p.hp += CLASS[s.cls].hpLvl;
            log(s, 'level_up', { lvl: p.lvl }, 'good');
            fx(s, 'level');
        }
        if (p.pending && !p.choices) rollChoices(s);
    }
    function rollChoices(s) {
        const p = s.p;
        const pool = CLS.SKILLS.filter((k) => (!k.cls || k.cls.includes(s.cls)) && (p.skills[k.id] || 0) < (k.max || 3));
        if (!pool.length) { addMods(p, { maxHp: 4 * p.pending }); p.pending = 0; p.choices = null; log(s, 'learned_all', null, 'good'); return; }   // nothing left to learn
        p.choices = RNG.shuffle(s.rng, pool.map((k) => k.id)).slice(0, 3);
    }
    function chooseSkill(s, id) {
        const p = s.p;
        if (!p.pending || !p.choices || !p.choices.includes(id)) return false;
        p.skills[id] = (p.skills[id] || 0) + 1;
        addMods(p, SKILL[id].mod);
        log(s, 'skill_learned', { skill: id }, 'good');
        p.pending--; p.choices = null;
        if (p.pending) rollChoices(s);
        return false;                                   // choosing takes no time
    }
    function heal(s, n) { s.p.hp = Math.min(s.p.maxHp, s.p.hp + n); }
    function hurtPlayer(s, dmg, cause) {
        const p = s.p;
        p.hp -= dmg; s.lastHurt = s.turn;
        s.fx.push({ t: 'hurt', x: p.x, y: p.y, n: dmg });
        if (p.hp <= 0) { p.hp = 0; s.status = 'dead'; s.cause = cause; log(s, 'defeated', { cause }, 'bad'); }
    }
    function killMob(s, m) {
        const d = MOB[m.k], p = s.p;
        s.mobs.splice(s.mobs.indexOf(m), 1);
        s.kills++; s.dex[m.k] = (s.dex[m.k] || 0) + 1;
        log(s, 'mob_killed', { mob: m.k }, 'good');
        fx(s, 'kill', m.x, m.y);
        if (m.loot) s.items.push({ x: m.x, y: m.y, it: { k: '$', n: m.loot } });
        if (m.stolen) s.items.push({ x: m.x, y: m.y, it: m.stolen });
        if (!m.loot && !m.stolen && s.map.tiles[idx(m.x, m.y)] === T.FLOOR) {
            if (m.elite && d.drop && ITEM[d.drop]) s.items.push({ x: m.x, y: m.y, it: { k: d.drop, n: 1 } });
            else if (d.boss || m.elite || RNG.chance(s.rng, 0.1)) s.items.push({ x: m.x, y: m.y, it: makeItem(s.rng, s.depth + (d.boss || m.elite ? 4 : 1)) });
            else if (RNG.chance(s.rng, 0.25)) s.items.push({ x: m.x, y: m.y, it: { k: '$', n: RNG.range(s.rng, 2, 6) + s.depth } });
        }
        if (m.elite) { s.elites = (s.elites || 0) + 1; log(s, 'elite_slain', { mob: m.k }, 'good'); fx(s, 'elite', m.x, m.y); }
        for (const f in d) if (MOB_HOOKS.death[f] && d[f]) MOB_HOOKS.death[f](s, m, d);
        if (d.explode && Math.abs(m.x - p.x) + Math.abs(m.y - p.y) <= 2) {
            log(s, 'mob_explodes', { mob: m.k }, 'bad');
            hurtPlayer(s, RNG.range(s.rng, d.explode[0], d.explode[1]), mobCause(m.k));
        }
        if (d.boss) {
            s.bosses++; s.sealed = 0;
            if (s.depth === FLOORS) { if (s.status === 'play') { s.status = 'won'; log(s, 'won', null, 'good'); } return; }
            log(s, 'stairs_unlocked', null, 'info');
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
            if (c) { const half = m.hp >> 1, n = spawn(s, m.k, c[0], c[1], false); n.hp = half; n.hunt = 1; m.hp -= half; log(s, 'mob_splits', { mob: m.k }, 'bad'); }
        }
        if (d.blink && RNG.chance(s.rng, 0.5)) { const c = freeCell(s, s.rng); if (c) { m.x = c[0]; m.y = c[1]; log(s, 'mob_blinks', { mob: m.k }); } }
    }
    function attackMob(s, m) {
        const st = stats(s), d = MOB[m.k], sleeping = m.asleep;
        m.asleep = 0; m.hunt = 1;
        if (d.ambush && !m.shown) m.shown = 1;
        if (!sleeping && !RNG.chance(s.rng, hitChance(st.acc, d.dodge || 0))) { log(s, 'you_miss', { mob: m.k }); fx(s, 'miss', m.x, m.y); return; }
        const crit = RNG.chance(s.rng, st.crit);
        let dmg = rollDamage(s.rng, st.dmg, st.atk + (d.undead ? st.holy : 0), d.def, crit);
        if (sleeping) dmg *= 2 + st.backstab;
        log(s, sleeping ? 'hit_sleep' : crit ? 'hit_crit' : 'hit', { mob: m.k, n: dmg });
        hurtMob(s, m, dmg);
        if (st.vamp && RNG.chance(s.rng, st.vamp / 100)) heal(s, 2);
    }
    function mobHit(s, m, dmg, ranged) {
        const d = MOB[m.k], p = s.p, st = stats(s);
        if (!RNG.chance(s.rng, hitChance(d.acc || 0, st.dodge))) { log(s, 'mob_misses', { mob: m.k }); return; }
        if (!ranged && d.steal === 'gold' && p.gold > 0) {
            m.loot = Math.min(p.gold, 15 + s.depth * 8); p.gold -= m.loot;
            log(s, 'mob_steals_gold', { mob: m.k, n: m.loot }, 'bad');
            return;
        }
        if (!ranged && d.steal === 'item' && p.inv.length) {
            const i = RNG.int(s.rng, p.inv.length);
            m.stolen = p.inv.splice(i, 1)[0];
            log(s, 'mob_steals_item', { mob: m.k, item: itemRef(s, m.stolen) }, 'bad');
            const c = freeCell(s, s.rng); if (c) { m.x = c[0]; m.y = c[1]; }
            return;
        }
        const n = rollDamage(s.rng, dmg, s.tier || 0, st.def, false);
        if (ranged) log(s, 'mob_ranged', { mob: m.k, verb: m.k, n }, 'bad'); else log(s, 'mob_hits', { mob: m.k, n }, 'bad');
        hurtPlayer(s, n, mobCause(m.k));
        if (d.poison && RNG.chance(s.rng, 0.5)) p.st.poison = Math.max(p.st.poison || 0, d.poison);
        if (d.weaken) p.st.weak = 12;
        if (d.stun && RNG.chance(s.rng, 0.3)) p.st.stun = 2;           // 2: the status loses a turn at the end of this one, so 1 would never skip an action
        if (d.confuse && RNG.chance(s.rng, 0.3)) p.st.conf = 5;
        if (d.leech) m.hp = Math.min(m.max, m.hp + n);
        for (const f in d) if (MOB_HOOKS.hit[f] && d[f]) MOB_HOOKS.hit[f](s, m, d, n);
    }

    /** BEHAVIOUR HOOKS: a new flag on a monster (mobs.js) becomes behaviour by registering a function here under the flag's name, no other change in the engine.
     *   MOB_HOOKS.turn.flag(s, m, d, ctx) -> true when it used up the monster's turn (ctx: { dist, adj, sees, step(dx, dy) -> moved? })
     *   MOB_HOOKS.hit.flag(s, m, d, dmg)  after its hit landed        MOB_HOOKS.death.flag(s, m, d)  when it dies
     *  `d` is the monster's definition, `m` the instance on the floor. Example: MOB_HOOKS.death.bomb = (s, m) => hurtPlayer(s, 3, mobCause(m.k)). */
    const MOB_HOOKS = { turn: {}, hit: {}, death: {} };
    function mobStep(s, m, dx, dy, occ) {
        const x = m.x + dx, y = m.y + dy, d = MOB[m.k];
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1 || occ.has(idx(x, y)) || (x === s.p.x && y === s.p.y)) return false;
        if (!d.phase && (!MAP.walkable(s.map.tiles[idx(x, y)]) || !MAP.diagOk(s.map, m.x, m.y, dx, dy))) return false;
        occ.delete(idx(m.x, m.y)); m.x = x; m.y = y; occ.add(idx(x, y));
        return true;
    }
    /** A sleeping hero is easier to notice: monsters 2 tiles further away (with a clear line) count as seeing him. */
    const hearsSleeper = (s, m) => !!s.sleeping && Math.max(Math.abs(m.x - s.p.x), Math.abs(m.y - s.p.y)) <= SIGHT + 2 && MAP.los(s.map, s.p.x, s.p.y, m.x, m.y);
    function mobTurn(s, m, d, dmap, occ) {
        const p = s.p, dist = Math.abs(m.x - p.x) + Math.abs(m.y - p.y), adj = touching(s, m);
        const hears = hearsSleeper(s, m);
        const sees = (!!s.vis[idx(m.x, m.y)] || hears) && (!p.st.invis || adj);
        const wander = () => { const v = RNG.pick(s.rng, DIRS); mobStep(s, m, v[0], v[1], occ); };
        if (m.fear) m.fear--;
        if (m.fear || m.loot || m.stolen || (d.coward && m.hp * 4 < m.max)) {
            if ((m.loot || m.stolen) && !s.vis[idx(m.x, m.y)]) {
                s.mobs.splice(s.mobs.indexOf(m), 1); occ.delete(idx(m.x, m.y)); m.hp = 0;
                log(s, 'mob_escaped', { mob: m.k }, 'bad');
                return;
            }
            const dm = dmap();
            let best = null, bd = dm[idx(m.x, m.y)];
            for (const v of MAP.DIRS8) {
                const j = idx(m.x + v[0], m.y + v[1]);
                if (dm[j] > bd && !occ.has(j) && MAP.diagOk(s.map, m.x, m.y, v[0], v[1])) { best = v; bd = dm[j]; }
            }
            if (best && mobStep(s, m, best[0], best[1], occ)) return;
            if (!adj) return;                                              // cornered: it fights
        }
        if (sees) m.hunt = 1;
        if (m.hunt) for (const f in d) if (MOB_HOOKS.turn[f] && d[f] && MOB_HOOKS.turn[f](s, m, d, { dist, adj, sees, step: (dx, dy) => mobStep(s, m, dx, dy, occ) })) return;
        if (!m.hunt) { if (d.erratic || RNG.chance(s.rng, 0.2)) wander(); return; }
        if ((p.st.invis && !adj) || (d.erratic && RNG.chance(s.rng, d.erratic))) { wander(); return; }
        if (d.summon && sees && s.turn % d.summon.every === 0 && s.mobs.length < MOB_CAP) {
            const c = freeCell(s, s.rng, m.x, m.y);
            if (c) { const n = spawn(s, d.summon.k, c[0], c[1], false); n.hunt = 1; occ.add(idx(c[0], c[1])); log(s, 'mob_calls', { mob: m.k, mob2: n.k }, 'bad'); return; }
        }
        if (d.ranged && sees && dist > 1 && dist <= d.ranged.range) { mobHit(s, m, d.ranged.dmg, true); return; }
        if (d.ambush && !m.shown) { if (!adj) return; m.shown = 1; log(s, 'mob_ambush', { mob: m.k }, 'bad'); }
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
        const dmap = () => dm || (dm = MAP.flood(s.map, [idx(p.x, p.y)], (i, t) => MAP.walkable(t), true));
        const occ = new Set(s.mobs.map((m) => idx(m.x, m.y)));
        for (const m of s.mobs.slice()) {
            if (s.status !== 'play') return;
            if (m.hp <= 0) continue;
            const d = MOB[m.k];
            if (d.regen && m.hp < m.max) m.hp = Math.min(m.max, m.hp + d.regen);
            if (m.frozen) { m.frozen--; continue; }
            if (m.asleep > 1) { m.asleep--; continue; }                     // a timed sleep (script, skill) runs out first
            if (m.asleep) { if ((s.vis[idx(m.x, m.y)] || hearsSleeper(s, m)) && !p.st.invis && RNG.chance(s.rng, wake)) { m.asleep = 0; m.hunt = 1; } continue; }
            m.en = (m.en || 0) + (d.speed || 1) * (m.slow ? 0.5 : 1);
            while (m.en >= 1 && m.hp > 0 && s.status === 'play') { m.en -= 1; mobTurn(s, m, d, dmap, occ); }
        }
    }

    // ── effects: what items, traps and active skills do ─────────────────────
    const seenMobs = (s) => threats(s).slice();
    const TARGETED = { bolt: 1, freeze: 1, banish: 1, slow: 1, drain: 1 };
    const EFFECTS = {
        heal(s, pw) { heal(s, Math.ceil(s.p.maxHp * pw / 100 * (1 + stats(s).drink / 100))); delete s.p.st.poison; log(s, 'fx_heal', null, 'good'); },
        strength(s, pw) { addMods(s.p, { atk: pw }); log(s, 'fx_strength', { n: pw }, 'good'); },
        life(s, pw) { addMods(s.p, { maxHp: pw }); log(s, 'fx_life', { n: pw }, 'good'); },
        poison(s, pw) { s.p.st.poison = Math.max(s.p.st.poison || 0, pw); log(s, 'fx_poison', null, 'bad'); },
        haste(s, pw) { s.p.st.haste = pw; log(s, 'fx_haste', null, 'good'); },
        confuse(s, pw) { s.p.st.conf = pw; log(s, 'fx_confuse', null, 'bad'); },
        invis(s, pw) { s.p.st.invis = pw; log(s, 'fx_invis', null, 'good'); },
        regen(s, pw) { s.p.st.regen = pw; log(s, 'fx_regen', null, 'good'); },
        xp(s) { gainXp(s, Math.ceil((xpNeed(s.p.lvl) - s.p.xp) / (1 + stats(s).xp / 100))); },
        teleport(s) {
            // never into a closed secret room: only cells that can be walked to from the stairs without secret doors
            const open = MAP.flood(s.map, [idx(s.map.stairs.x, s.map.stairs.y)], (i, t) => MAP.walkable(t));
            let c = null;
            for (let n = 0; n < 60 && !c; n++) { const q = freeCell(s, s.rng); if (q && open[idx(q[0], q[1])] >= 0) c = q; }
            if (c) { s.p.x = c[0]; s.p.y = c[1]; }
            log(s, 'fx_teleport', null, 'info');
        },
        map(s) {
            const t = s.map.tiles;
            for (let i = 0; i < t.length; i++) {
                if (t[i] === T.SECRET) t[i] = T.DOOR;
                if (t[i] !== T.WALL) { s.seen[i] = 1; for (const v of DIRS) s.seen[i + v[0] + v[1] * W] = 1; }
            }
            log(s, 'fx_map', null, 'info');
        },
        identify(s) { for (const it of s.p.inv) identify(s, it.k); log(s, 'fx_identify', null, 'info'); },
        enchW(s) { if (!s.p.weapon) return log(s, 'fx_ench_weapon_none'); s.p.weapon.e = (s.p.weapon.e || 0) + 1; log(s, 'fx_ench_weapon', { item: itemRef(s, s.p.weapon) }, 'good'); },
        enchA(s) { if (!s.p.armor) return log(s, 'fx_ench_armor_none'); s.p.armor.e = (s.p.armor.e || 0) + 1; log(s, 'fx_ench_armor', { item: itemRef(s, s.p.armor) }, 'good'); },
        fear(s, pw) { for (const m of seenMobs(s)) { m.asleep = 0; m.fear = MOB[m.k].boss ? pw >> 2 : pw; } log(s, 'fx_fear', null, 'good'); },
        fire(s, pw) { log(s, 'fx_fire', null, 'good'); for (const m of seenMobs(s)) hurtMob(s, m, Math.round((pw + s.depth) * (1 + stats(s).usb / 100))); },
        summon(s, pw) {
            const pool = MOBS.LIST.filter((d) => !d.boss && !d.still && d.floors[0] <= s.depth && s.depth <= d.floors[1]);
            for (let i = 0; i < pw && s.mobs.length < MOB_CAP && pool.length; i++) { const c = freeCell(s, s.rng, s.p.x, s.p.y); if (c) spawn(s, RNG.pick(s.rng, pool).id, c[0], c[1], false).hunt = 1; }
            log(s, 'fx_summon', null, 'bad');
        },
        sleep(s, pw) { for (const m of seenMobs(s)) if (!MOB[m.k].boss) m.asleep = pw + 1; log(s, 'fx_sleep', null, 'good'); },
        recipes(s) { for (const r of RC.RECIPES) s.recipes[r.id] = 1; log(s, 'book_read', null, 'good'); },
        recharge(s, pw) { for (const it of s.p.inv) if (ITEM[it.k].cat === 'usb') it.ch += pw; log(s, 'fx_recharge', null, 'good'); },
        ping(s, pw) { s.p.st.ping = pw; log(s, 'fx_ping', null, 'info'); },
        grep(s) {
            for (const t of s.traps) t.found = 1;
            for (let i = 0; i < s.map.tiles.length; i++) if (s.map.tiles[i] === T.SECRET) { s.map.tiles[i] = T.DOOR; s.seen[i] = 1; }
            log(s, 'fx_grep', null, 'info');
        },
        bolt(s, pw, m) { const n = Math.round(RNG.range(s.rng, pw, pw * 2) * (1 + stats(s).usb / 100)) + (s.p.lvl >> 1); log(s, 'fx_bolt', { mob: m.k, n }); hurtMob(s, m, n); },
        freeze(s, pw, m) { m.frozen = MOB[m.k].boss ? pw >> 1 : pw; m.asleep = 0; log(s, 'fx_freeze', { mob: m.k }, 'good'); },
        banish(s, pw, m) {
            if (MOB[m.k].boss) return log(s, 'fx_banish_boss', { mob: m.k });
            const c = freeCell(s, s.rng); if (c) { m.x = c[0]; m.y = c[1]; m.hunt = 0; }
            log(s, 'fx_banish', { mob: m.k }, 'good');
        },
        slow(s, pw, m) { m.slow = 1; log(s, 'fx_slow', { mob: m.k }, 'good'); },
        drain(s, pw, m) { const n = RNG.range(s.rng, pw, pw * 2); log(s, 'fx_drain', { n, mob: m.k }, 'good'); heal(s, n >> 1); hurtMob(s, m, n); },
        // traps
        zap(s, pw) { log(s, 'fx_zap', null, 'bad'); hurtPlayer(s, pw + (s.depth >> 1) + RNG.int(s.rng, 3), { k: 'cause_socket' }); },
        alarm(s) { for (const m of s.mobs) { m.asleep = 0; m.hunt = 1; } log(s, 'fx_alarm', null, 'bad'); },
        pit(s, pw) {
            if (s.sealed || s.depth >= FLOORS) return EFFECTS.zap(s, pw);
            log(s, 'fx_pit', null, 'bad');
            hurtPlayer(s, pw, { k: 'cause_pit' });
            if (s.status === 'play') { s.depth++; newFloor(s); }
        },
    };

    // ── the player's actions ────────────────────────────────────────────────
    /** Looks for secret doors and traps around the player. `radius` 1 is the free background search; the real one (Cerca) reaches further, less surely the farther away. */
    function search(s, chance, radius) {
        const p = s.p, R = radius || 1; let found = false;
        const c = (d) => chance * (1 - 0.25 * (d - 1));
        for (let y = p.y - R; y <= p.y + R; y++) for (let x = p.x - R; x <= p.x + R; x++) {
            if (x < 0 || y < 0 || x >= W || y >= H) continue;
            if (s.map.tiles[idx(x, y)] === T.SECRET && RNG.chance(s.rng, c(Math.max(Math.abs(x - p.x), Math.abs(y - p.y))))) { s.map.tiles[idx(x, y)] = T.DOOR; found = true; log(s, 'secret_found', null, 'good'); }
        }
        for (const t of s.traps) {
            const d = Math.max(Math.abs(t.x - p.x), Math.abs(t.y - p.y));
            if (!t.found && d <= R && RNG.chance(s.rng, c(d))) { t.found = 1; found = true; log(s, 'trap_found', { trap: t.k }, 'info'); }
        }
        if (found) updateFov(s);
        return found;
    }
    const byTrap = TRAP;
    function pickUp(s) {
        const p = s.p;
        for (const e of itemsAt(s, p.x, p.y)) {
            if (e.it.k === '$') {
                const n = Math.round(e.it.n * (1 + stats(s).luck / 100));
                p.gold += n; s.earned += n; log(s, 'got_credits', { n }, 'good');
            } else if (addInv(s, e.it)) log(s, 'picked_up', { item: itemRef(s, Object.assign({}, e.it, { n: 1 })) });
            else { log(s, 'bag_full_leave', { item: itemRef(s, e.it) }); continue; }
            s.items.splice(s.items.indexOf(e), 1);
            fx(s, 'pick');
        }
    }
    function move(s, dx, dy) {
        const p = s.p;
        if (p.st.conf && RNG.chance(s.rng, 0.5)) [dx, dy] = RNG.pick(s.rng, DIRS);
        const x = p.x + dx, y = p.y + dy, t = s.map.tiles[idx(x, y)], m = mobAt(s, x, y);
        if (!MAP.diagOk(s.map, p.x, p.y, dx, dy)) { if (dx && dy && (m || MAP.walkable(t))) log(s, 'diag_blocked', null, 'info'); return false; }   // no corner cutting, doors only straight
        if (m) { attackMob(s, m); return true; }
        if (t === T.SHOP || t === T.BENCH || t === T.ALTAR) { if (dx && dy) return false; }   // furniture is used from the side
        if (t === T.SHOP) { s.shop.open = 1; return false; }
        if (t === T.BENCH) { s.bench.open = 1; return false; }
        if (t === T.ALTAR) return pray(s);
        if (!MAP.walkable(t)) return false;
        p.x = x; p.y = y;
        const trap = s.traps.find((e) => e.x === x && e.y === y);
        if (trap) {
            const was = s.depth;
            trap.found = 1;
            log(s, 'trap_hit', { trap: trap.k }, 'bad');
            EFFECTS[byTrap[trap.k].effect](s, byTrap[trap.k].power);
            if (s.depth !== was) return true;
        }
        const hz = hazAt(s, x, y);
        if (hz) { const d = HAZ[hz.k]; HAZARD_FX[d.kind](s, hz, d, dx, dy); if (s.status !== 'play') return true; }
        pickUp(s);
        if (s.map.tiles[idx(p.x, p.y)] === T.STAIRS) log(s, s.sealed ? 'stairs_locked' : 'stairs_here', null, 'info');
        return true;
    }
    function pray(s) {
        const p = s.p;
        if (s.altar.used) { log(s, 'terminal_off'); return false; }
        s.altar.used = 1;
        const n = RNG.int(s.rng, 100);
        if (n < 15) { log(s, 'terminal_panic', null, 'bad'); EFFECTS.summon(s, 2); }
        else if (n < 40) { p.hp = p.maxHp; p.st = {}; log(s, 'terminal_backup', null, 'good'); }
        else if (n < 55) { addMods(p, { maxHp: 4 }); log(s, 'terminal_update', null, 'good'); }
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
            log(s, d.cat === 'weapon' ? 'equip_weapon' : d.cat === 'armor' ? 'equip_armor' : 'equip_plugin', { item: itemRef(s, it) });
            return true;
        }
        if (d.cat === 'throw') { log(s, 'throw_hint'); return false; }
        if (d.cat === 'craft' && !d.effect) { log(s, 'craft_item_hint'); return false; }
        if (d.cat === 'food') { p.food = Math.min(MAX_FOOD, p.food + d.food); log(s, 'eat', { item: { k: it.k } }, 'good'); useUp(s, i); return true; }
        let target = null;
        if (d.cat === 'usb') {
            if (it.ch <= 0) { log(s, 'usb_empty'); return false; }
            target = nearest(s);
            if (!target) { log(s, 'no_enemy'); return false; }
            it.ch--;
        } else useUp(s, i);
        log(s, d.cat === 'drink' ? 'use_drink' : d.cat === 'usb' ? 'use_usb' : 'use_script', { item: { k: it.k } });
        identify(s, it.k);
        EFFECTS[d.effect](s, d.power, target);
        return true;
    }
    /** Throws a throwable item from the bag at (tx, ty), at most THROW_RANGE away; it hits the first monster on the line. */
    function throwItem(s, i, tx, ty) {
        const p = s.p, it = p.inv[i];
        if (!it || ITEM[it.k].cat !== 'throw') return false;
        const dx = tx - p.x, dy = ty - p.y, n = Math.max(Math.abs(dx), Math.abs(dy));
        if (!n || n > THROW_RANGE || tx < 0 || ty < 0 || tx >= W || ty >= H) { log(s, 'throw_bad'); return false; }
        let lx = p.x, ly = p.y, hit = null;
        for (let k = 1; k <= n; k++) {
            const x = Math.round(p.x + dx * k / n), y = Math.round(p.y + dy * k / n);
            if (!MAP.walkable(s.map.tiles[idx(x, y)])) break;
            lx = x; ly = y;
            hit = mobAt(s, x, y);
            if (hit) break;
        }
        const d = ITEM[it.k], st = stats(s), one = { k: it.k, n: 1 };
        useUp(s, i);
        fx(s, 'throw', lx, ly);
        log(s, 'thrown', { item: { k: it.k } });
        if (hit) {
            const md = MOB[hit.k];
            if (hit.asleep || RNG.chance(s.rng, hitChance(st.acc, md.dodge || 0))) {
                const dmg = rollDamage(s.rng, d.dmg, st.atk >> 1, md.def, RNG.chance(s.rng, st.crit));
                log(s, 'throw_hit', { item: { k: it.k }, mob: hit.k, n: dmg });
                hurtMob(s, hit, dmg);
            } else { log(s, 'you_miss', { mob: hit.k }); hit.asleep = 0; hit.hunt = 1; }
        }
        if (RNG.chance(s.rng, 0.6) && s.map.tiles[idx(lx, ly)] === T.FLOOR) s.items.push({ x: lx, y: ly, it: one });
        return true;
    }
    function dropItem(s, i) {
        const p = s.p, it = p.inv[i];
        if (!it) return false;
        p.inv.splice(i, 1);
        s.items.push({ x: p.x, y: p.y, it });
        log(s, 'dropped', { item: itemRef(s, it) });
        return true;
    }
    function unequip(s, slot) {
        const p = s.p;
        if (!['weapon', 'armor', 'plugin'].includes(slot) || !p[slot]) return false;
        if (p.inv.length >= INV_CAP) { log(s, 'bag_full'); return false; }
        p.inv.push(p[slot]); p[slot] = null;
        return true;
    }
    /** One turn of sleep (the page repeats it while s.sleeping > 0; endTurn ends it). Refused with a monster in view, when hungry or when there is nothing to heal. */
    function sleepTurn(s) {
        const p = s.p;
        if (threats(s).length) { log(s, 'sleep_enemy', null, 'bad'); return false; }
        if (p.food < 150) { log(s, p.food <= 0 ? 'sleep_starving' : 'sleep_hungry', null, 'bad'); return false; }
        if (p.hp >= p.maxHp) { log(s, 'sleep_full', null, 'info'); return false; }
        if (!s.sleeping) log(s, 'sleep_start', null, 'info');
        s.sleeping = (s.sleeping || 0) + 1;
        return true;
    }
    /** Why a sleep ends after this turn (a message key) or null: a monster in view, being hurt, hunger, full health, the 100-turn cap. */
    function sleepWake(s) {
        const p = s.p, m = nearest(s);
        if (m) return { k: 'sleep_wake_mob', p: { mob: m.k } };
        if (s.lastHurt === s.turn) return { k: 'sleep_wake_hurt' };
        if (p.food < 150) return { k: 'sleep_wake_hungry' };
        if (p.hp >= p.maxHp) return { k: 'sleep_wake_full' };
        if (s.sleeping >= SLEEP_CAP) return { k: 'sleep_wake_cap' };
        return null;
    }
    /** Sleeps until something wakes the hero (tests, bots); the page does the same one turn at a time. Returns the number of turns slept. */
    function sleepRun(s) {
        let n = 0;
        while (s.status === 'play' && act(s, { t: 'sleep' }) && s.sleeping) n++;
        return n + 1;
    }
    function descend(s) {
        if (s.map.tiles[idx(s.p.x, s.p.y)] !== T.STAIRS) { log(s, 'stairs_none'); return false; }
        if (s.sealed) { log(s, 'stairs_locked'); return false; }
        if (s.hub) { s.depth++; newFloor(s); return true; }
        if (s.depth % MOBS.PER_SECTOR === 0 && s.depth < FLOORS) { enterHub(s); return true; }
        s.depth++;
        newFloor(s);
        return true;
    }
    function useActive(s) {
        const p = s.p, a = CLASS[s.cls].active;
        if (p.cd > 0) { log(s, 'skill_wait', { active: s.cls, n: p.cd }); return false; }
        const target = TARGETED[a.effect] ? nearest(s) : null;
        if (TARGETED[a.effect] && !target) { log(s, 'no_enemy'); return false; }
        log(s, 'skill_used', { active: s.cls }, 'info');
        p.cd = Math.round(a.cd * (1 - Math.min(60, stats(s).cd) / 100));
        EFFECTS[a.effect](s, a.power, target);
        return true;
    }
    function buy(s, i) {
        const e = s.shop.stock[i];
        if (!e) return;
        const cost = price(s, e);
        if (s.p.gold < cost) return log(s, 'no_credits');
        if (!addInv(s, e)) return log(s, 'bag_full');
        s.p.gold -= cost;
        s.shop.stock.splice(i, 1);
        s.known[e.k] = 1;
        log(s, 'bought', { item: itemRef(s, e) }, 'good');
        fx(s, 'pick');
    }

    function endTurn(s) {
        const p = s.p, st = stats(s);
        s.turn++;
        updateFov(s);
        if (!(p.st.haste && s.turn % 2)) mobsAct(s);                       // with haste the enemies move every other turn
        if (s.status !== 'play') return;
        if (p.st.poison) hurtPlayer(s, 1, { k: 'cause_sick' });
        if (p.st.burn && s.status === 'play') hurtPlayer(s, 1, { k: 'cause_haz', p: { haz: 'flame' } });
        for (const k in p.st) if (--p.st[k] <= 0) delete p.st[k];
        if (p.cd > 0) p.cd--;
        if (s.turn % 100 >= st.hunger) {
            p.food--;
            if (p.food === 150) log(s, 'hungry', null, 'bad');
            if (p.food === 0) log(s, 'starving', null, 'bad');
        }
        if (p.food <= 0) { p.food = 0; if (s.turn % 8 === 0) hurtPlayer(s, 1, { k: 'cause_hunger' }); }
        else if (p.hp < p.maxHp) {
            let iv = Math.max(2, 12 - (p.lvl >> 1) - st.regen * 2);
            if (s.sleeping) iv = Math.max(1, iv >> 1);                      // asleep: twice as fast
            if (p.st.regen || s.turn % iv === 0) p.hp++;
        }
        if (st.recharge && s.turn % Math.max(15, 60 - st.recharge * 15) === 0) for (const it of p.inv) if (ITEM[it.k].cat === 'usb' && it.ch < ITEM[it.k].ch) it.ch++;
        if (s.status === 'play') search(s, 0.12 + st.search / 100);
        if (s.sleeping && s.status === 'play') { const w = sleepWake(s); if (w) { s.sleeping = 0; log(s, w.k, w.p, w.k === 'sleep_wake_full' || w.k === 'sleep_wake_cap' ? 'info' : 'bad'); } }
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
        if (s.bench && s.bench.open) {
            if (a.t === 'rest') rest(s); else if (a.t === 'recycle') recycle(s, a.i); else if (a.t === 'craft') craft(s, a.i); else s.bench.open = 0;
            return false;
        }
        if (a.t !== 'sleep') s.sleeping = 0;
        let took = false;
        if (p.st.stun) { log(s, 'stunned', null, 'bad'); took = true; }
        else if (a.t === 'move') took = move(s, a.dx, a.dy);
        else if (a.t === 'wait') { took = true; search(s, 0.5); }
        else if (a.t === 'sleep') took = sleepTurn(s);
        else if (a.t === 'search') { took = true; if (!search(s, 1, SEARCH_RADIUS)) log(s, 'search_none'); }
        else if (a.t === 'throw') took = throwItem(s, a.i, a.x, a.y);
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
    /** Cells the player has seen and can walk on; known traps are avoided unless `through` (a trap in a corridor must not block the way). */
    function knownPass(s, through) {
        const avoid = new Set(through ? [] : s.traps.filter((t) => t.found).map((t) => idx(t.x, t.y)));
        if (!through) for (const h of s.haz || []) if (HAZ[h.k].kind !== 'fog') avoid.add(idx(h.x, h.y));       // seen hazards are walked round (fog is harmless)
        const me = idx(s.p.x, s.p.y);
        return (i, t) => !!s.seen[i] && MAP.walkable(t) && (i === me || !avoid.has(i));
    }
    /** The next step [dx, dy] towards a cell, over what the player has seen; null when there is no known way. */
    function travelNext(s, tx, ty) {
        const ti = idx(tx, ty);
        if (!s.seen[ti]) return null;
        for (const through of [false, true]) {
            const v = MAP.downhill(s.map, MAP.flood(s.map, [ti], knownPass(s, through), true), s.p.x, s.p.y);
            if (v) return v;
        }
        return null;
    }
    /** The next step towards the nearest thing worth walking to: something to pick up, or a place not seen yet. */
    function exploreNext(s) {
        const hzSet = new Set((s.haz || []).filter((h) => HAZ[h.k].kind !== "fog").map((h) => idx(h.x, h.y)));   // a hazard cell is never an exploration goal (the walk would cross it back and forth)
        const p = s.p, loot = new Set(s.items.filter((e) => s.seen[idx(e.x, e.y)] && canTake(s, e.it) && !s.traps.some((t) => t.found && t.x === e.x && t.y === e.y) && !fogAt(s, e.x, e.y)).map((e) => idx(e.x, e.y)));
        for (const through of [false, true]) {
            const dist = MAP.flood(s.map, [idx(p.x, p.y)], knownPass(s, through), true);
            let best = -1;
            for (let i = 0; i < dist.length; i++) {
                if (dist[i] < 1 || hzSet.has(i) || (best >= 0 && dist[i] >= dist[best])) continue;
                if (loot.has(i) || !s.seen[i - 1] || !s.seen[i + 1] || !s.seen[i - W] || !s.seen[i + W]) best = i;
            }
            if (best < 0) continue;
            while (dist[best] > 1) for (const v of MAP.DIRS8) { const j = best + v[0] + v[1] * W; if (dist[j] === dist[best] - 1 && MAP.diagOk(s.map, j % W, (j / W) | 0, -v[0], -v[1])) { best = j; break; } }
            return [best % W - p.x, ((best / W) | 0) - p.y];
        }
        return null;
    }

    // ── touch: what a tap, a double tap or a long press means (pure: the page only carries it out) ──
    /** The cells from the player to (tx, ty) over what has been seen (the player's own cell not included); [] when there is no way. */
    function travelPath(s, tx, ty) {
        if (!s.seen[idx(tx, ty)]) return [];
        for (const through of [false, true]) {
            const dist = MAP.flood(s.map, [idx(tx, ty)], knownPass(s, through), true), path = [];
            if (dist[idx(s.p.x, s.p.y)] < 0) continue;
            let x = s.p.x, y = s.p.y;
            while ((x !== tx || y !== ty) && path.length < 400) { const v = MAP.downhill(s.map, dist, x, y); if (!v) break; x += v[0]; y += v[1]; path.push([x, y]); }
            return path;
        }
        return [];
    }
    const TILE_NAME = { [T.WALL]: 'tile_wall', [T.SECRET]: 'tile_wall', [T.FLOOR]: 'tile_floor', [T.DOOR]: 'tile_door', [T.STAIRS]: 'tile_stairs', [T.ALTAR]: 'tile_altar', [T.SHOP]: 'tile_shop', [T.BENCH]: 'tile_bench' };
    const TILE_INFO = { [T.FLOOR]: 'tile_floor_info', [T.DOOR]: 'tile_door_info', [T.WALL]: 'tile_wall_info', [T.SECRET]: 'tile_wall_info', [T.ALTAR]: 'tile_altar_info', [T.SHOP]: 'tile_shop_info', [T.BENCH]: 'tile_bench_info' };
    const msg = (k, p) => (p ? { k, p } : { k });
    /** The info card of a cell: { title, lines[] } of messages (text(msg, lang)) — what a long press shows. Never acts. */
    function infoAt(s, x, y) {
        const p = s.p, i = idx(x, y);
        if (x === p.x && y === p.y) { const st = stats(s); return { title: msg('card_you', { cls: s.cls }), lines: [msg('card_you_hp', { hp: p.hp, max: p.maxHp, lvl: p.lvl }), msg('card_you_atk', { atk: st.atk, def: st.def })].concat(s.sleeping ? [msg('card_you_sleep')] : []) }; }
        const m = s.mobs.find((e) => e.x === x && e.y === y && shown(s, e));
        if (m) {
            const d = MOB[m.k], lines = [];
            if (d.info) lines.push(msg('m_mobinfo', { mobinfo: m.k }));
            lines.push(msg('card_mob_hp', { hp: m.hp, max: m.max }), msg('card_mob_hits', { a: d.atk[0], b: d.atk[1] }));
            if (m.asleep) lines.push(msg('card_mob_asleep'));
            if (d.ranged) lines.push(msg('card_mob_ranged'));
            if (d.speed > 1) lines.push(msg('card_mob_fast'));
            if (d.boss) lines.push(msg('card_mob_boss'));
            if (m.elite) lines.push(msg('card_mob_elite'));
            return { title: msg('m_mob', { mob: m.k }), lines };
        }
        if (!s.seen[i]) return { title: msg('card_unseen'), lines: [msg('card_unseen_info')] };
        const here = s.items.filter((e) => e.x === x && e.y === y);
        if (here.length) return { title: here.map((e) => msg('m_item', { item: itemRef(s, e.it) })), lines: here.map((e) => e.it.k === '$' ? msg('card_credits') : itemInfoMsg(s, e.it)) };
        const hz = hazAt(s, x, y);
        if (hz && !here.length) {
            const d = HAZ[hz.k], lines = [msg('haz_desc', { hazinfo: d.id })];
            if (d.dmg) { const [a, b] = HZ.damageRange(d, s.depth, s.tier); lines.push(msg('card_haz_dmg', { a, b })); }
            return { title: msg('haz_title', { haz: d.id }), lines };
        }
        const trap = s.traps.find((e) => e.x === x && e.y === y && e.found);
        if (trap) return { title: msg('card_trap', { trap: trap.k }), lines: [msg('card_trap_info')] };
        const t = s.map.tiles[i];
        return { title: msg(TILE_NAME[t] || 'card_tile'), lines: [TILE_INFO[t] ? msg(TILE_INFO[t]) : null, t === T.STAIRS && s.sealed ? msg('card_stairs_locked') : null].filter(Boolean) };
    }
    /** A known walkable cell next to (x, y) to stand on to use furniture there: the player's own cell when already next to it; null if none can be reached. */
    function reachNeighbour(s, x, y) {
        const p = s.p;
        if (Math.abs(x - p.x) + Math.abs(y - p.y) === 1) return [p.x, p.y];   // furniture is used from the side: never diagonally
        const dist = MAP.flood(s.map, [idx(p.x, p.y)], knownPass(s, true), true);
        let best = null, bd = 1e9;
        for (const v of DIRS) { const d = dist[idx(x + v[0], y + v[1])]; if (d >= 0 && d < bd) { bd = d; best = [x + v[0], y + v[1]]; } }
        return best;
    }
    /**
     * What a touch on cell (x, y) means. `kind`: 'tap' | 'double' | 'long'. `aim`: bag index of the item being aimed, or null/undefined.
     * Returns { type: 'walk'|'attack'|'pickup'|'use'|'rest'|'search'|'info'|'throw'|'cancel'|'none', … }; the page does the walking.
     */
    function intentForTap(s, x, y, kind, aim) {
        const p = s.p;
        if (x < 0 || y < 0 || x >= W || y >= H) return { type: 'none', reason: 'outside' };
        const hero = x === p.x && y === p.y;
        if (kind === 'long') return hero ? { type: 'search' } : Object.assign({ type: 'info' }, infoAt(s, x, y));
        if (aim !== undefined && aim !== null) {
            const it = p.inv[aim], d = Math.max(Math.abs(x - p.x), Math.abs(y - p.y));
            if (!it || ITEM[it.k].cat !== 'throw' || !d || d > THROW_RANGE || !s.vis[idx(x, y)]) return { type: 'cancel' };
            return { type: 'throw', i: aim, x, y };
        }
        const i = idx(x, y), t = s.map.tiles[i];
        if (hero) return kind === 'double' ? { type: 'search' } : t === T.STAIRS ? { type: 'use', what: 'stairs', x, y } : { type: 'rest' };
        const m = s.mobs.find((e) => e.x === x && e.y === y && shown(s, e));
        if (m) return { type: 'attack', id: m.id, x, y, adjacent: touching(s, m) };
        if (!s.seen[i]) return { type: 'none', reason: 'unseen' };
        if (t === T.SHOP || t === T.BENCH || t === T.ALTAR) {
            const via = reachNeighbour(s, x, y);
            return via ? { type: 'use', what: t === T.SHOP ? 'shop' : t === T.BENCH ? 'bench' : 'altar', x, y, via } : { type: 'none', reason: 'unreachable' };
        }
        if (!MAP.walkable(t)) return { type: 'none', reason: 'blocked' };
        if (!travelNext(s, x, y)) return { type: 'none', reason: 'unreachable' };
        if (t === T.STAIRS) return { type: 'use', what: 'stairs', x, y };
        if (itemsAt(s, x, y).length) return { type: 'pickup', x, y };
        return { type: 'walk', x, y };
    }
    /** What a quickslot holding item kind `k` does: use it, start aiming it, or nothing (not in the bag). */
    function slotIntent(s, k) {
        const i = s.p.inv.findIndex((it) => it.k === k);
        if (i < 0) return { type: 'none' };
        return ITEM[k].cat === 'throw' ? { type: 'aim', i } : { type: 'use', i };
    }

    // ── a new run, saving, the profile ──────────────────────────────────────
    const UP = byId(META.UPGRADES);
    const level = (meta, id) => Math.min(UP[id].max, (meta.up && meta.up[id]) || 0);
    /** `opts`: { tier } = "livello di accesso" (0 = normal, each step makes monsters 30% tougher and harder-hitting), { daily } = date text. */
    function newGame(seed, cls, meta, opts) {
        meta = meta || newMeta(); opts = opts || {};
        const c = CLASS[cls] && unlocked(meta, CLASS[cls]) ? CLASS[cls] : CLS.CLASSES[0];
        const s = {
            v: VERSION, seed: seed >>> 0, cls: c.id, rng: RNG.make(RNG.mix(seed, 4242)), depth: 1, turn: 0, status: 'play', cause: '',
            tier: Math.min(opts.tier || 0, meta.ng || 0), daily: opts.daily || '', met: {}, dex: {}, hub: 0, bench: null,
            log: [], fx: [], known: {}, looks: {}, nid: 1, kills: 0, bosses: 0, earned: 0, elites: 0, recipes: Object.assign({}, meta.recipes),
            p: { x: 0, y: 0, hp: c.hp, maxHp: c.hp, lvl: 1, xp: 0, gold: 0, food: 900, cd: 0, weapon: null, armor: null, plugin: null,
                 inv: [], st: {}, mods: {}, skills: {}, pending: 0, choices: null },
        };
        addMods(s.p, c.mods);
        const kit = c.kit.slice();
        for (const u of META.UPGRADES) {
            const n = level(meta, u.id);
            if (!n) continue;
            if (u.mod) for (let i = 0; i < n; i++) addMods(s.p, u.mod);
            if (u.gold) s.p.gold += u.gold * n;
            if (u.kit) for (let i = 0; i < n; i++) kit.push(...u.kit);
            if (u.known) for (const k of u.known) s.known[k] = 1;
        }
        const looks = RNG.make(RNG.mix(seed, 777));
        for (const k in ITEMS.LOOKS) {
            const order = RNG.shuffle(looks, ITEMS.LOOKS[k].map((e, i) => i));
            ITEMS.LIST.filter((d) => d.cat === k).forEach((d, i) => { s.looks[d.id] = order[i % order.length]; });
        }
        for (const k of kit) {
            const d = ITEM[k], slot = ITEMS.CATS[d.cat].slot, it = { k };
            if (d.cat === 'usb') it.ch = d.ch;
            if (ITEMS.CATS[d.cat].stack) it.n = 1;
            s.known[k] = 1;
            if (slot && !s.p[slot]) s.p[slot] = it; else addInv(s, it);
        }
        log(s, 'run_start', { cls: c.id }, 'info');
        if (s.tier) log(s, 'run_tier', { tier: s.tier }, 'info');
        newFloor(s);
        return s;
    }
    const save = (s) => JSON.stringify(s);
    function load(text) {
        try {
            const s = JSON.parse(text);
            if (s) { s.sleeping = 0; s.haz = s.haz || []; s.recipes = s.recipes || {}; }
            if (!s || s.v !== VERSION || !s.p || !s.map || s.map.tiles.length !== W * H || !CLASS[s.cls]) return null;
            return s;
        } catch (e) { return null; }
    }
    const newMeta = () => ({ v: 2, best: 0, wins: 0, bosses: 0, runs: 0, crediti: 0, total: 0, kills: 0, turns: 0, ng: 0, daily: 0, maxLvl: 0, up: {}, medals: [], codex: {}, dailyBest: {}, history: [], recipes: {} });
    /** Fills in what an older or damaged profile lacks. */
    function fixMeta(m) { const n = newMeta(); for (const k in n) if (m[k] === undefined || typeof m[k] !== typeof n[k]) m[k] = n[k]; return m; }
    const counters = (meta) => Object.assign({}, meta, { codex: Object.keys(meta.codex || {}).length });
    const unlocked = (meta, c) => !c.unlock || Object.keys(c.unlock).every((k) => (meta[k] || 0) >= c.unlock[k]);
    const upCost = (meta, id) => UP[id].cost * (level(meta, id) + 1);
    function buyUpgrade(meta, id) {
        if (!UP[id] || level(meta, id) >= UP[id].max || meta.crediti < upCost(meta, id)) return false;
        meta.crediti -= upCost(meta, id);
        meta.up = meta.up || {}; meta.up[id] = level(meta, id) + 1;
        return true;
    }
    /** Medals whose counters are reached and that are not yet in the profile: they are added and pay 20 crediti each. Returns the new ones. */
    function checkMedals(meta) {
        const got = [], c = counters(meta);
        for (const d of META.MEDALS) {
            if (meta.medals.includes(d.id) || !Object.keys(d.need).every((k) => (c[k] || 0) >= d.need[k])) continue;
            meta.medals.push(d.id); meta.crediti += 20; got.push(d);
        }
        return got;
    }
    /** Adds a finished run to the profile (once). `date` comes from the page: the rules have no clock. */
    function recordRun(meta, s, date) {
        if (s.status === 'play' || s.recorded) return meta;
        s.recorded = 1;
        const gain = Math.round((s.depth * 2 + s.bosses * 10 + (s.status === 'won' ? 50 : 0)) * (1 + 0.25 * (s.tier || 0)));
        meta.best = Math.max(meta.best, s.depth);
        meta.runs++; meta.bosses += s.bosses; meta.crediti += gain; meta.total += gain + s.earned;
        meta.kills += s.kills; meta.turns += s.turn; meta.maxLvl = Math.max(meta.maxLvl, s.p.lvl);
        Object.assign(meta.recipes, s.recipes);
        for (const k in s.met) { const e = meta.codex[k] = meta.codex[k] || { seen: 0, kills: 0 }; e.seen++; }
        for (const k in s.dex) { const e = meta.codex[k] = meta.codex[k] || { seen: 0, kills: 0 }; e.kills += s.dex[k]; }
        if (s.status === 'won') { meta.wins++; meta.ng = Math.max(meta.ng, (s.tier || 0) + 1); }
        if (s.daily) { meta.daily++; meta.dailyBest[s.daily] = Math.max(meta.dailyBest[s.daily] || 0, s.depth); }
        meta.history.unshift({ cls: s.cls, depth: s.depth, lvl: s.p.lvl, turns: s.turn, kills: s.kills, won: s.status === 'won', cause: s.cause, seed: s.seed, date: date || '', crediti: gain, tier: s.tier || 0, daily: s.daily || '' });
        meta.history.length = Math.min(meta.history.length, 30);
        s.medals = checkMedals(meta).map((d) => d.id);
        return meta;
    }

    return { VERSION, FLOORS, INV_CAP, MAX_FOOD, MOB, ITEM, CLASS, SKILL, EFFECTS, TARGETED, newGame, act, save, load, stats, hitChance, rollDamage, xpNeed,
        text, logText, log, itemRef, itemText, itemName, itemInfo, itemLook, MSG: TX.MSG, known, price, canTake, shown, threats, nearest, touching, mobAt, itemsAt, sectorOf, bossOf, travelNext, exploreNext, newFloor, HAZARD_FX, HAZARD: HAZ, hazAt, fogAt, sleepRun, SLEEP_CAP, MOB_HOOKS, RECIPES: RC.RECIPES, recipeFor, eliteOf, eliteDepth, THROW_RANGE, SEARCH_RADIUS, intentForTap, infoAt, slotIntent, travelPath,
        newMeta, fixMeta, unlocked, recordRun, updateFov, buyUpgrade, upCost, level, checkMedals, counters, UPGRADES: META.UPGRADES, MEDALS: META.MEDALS, enterHub };
});
