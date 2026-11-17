// js/rogue/bot.js — the bot that plays "Il Dungeon del Server" like a decent player. Works in the browser (Rogue.bot) and in Node (require).
//
//   const memo = {};                                   // the bot's small memory: plain JSON, keep it (and save it) between calls
//   const a = Rogue.bot.decide(s, memo);               // s = the game state (the object Rogue.game works on); a = ONE action for Rogue.game.act(s, a), or null when the run is over
//   Rogue.game.act(s, a);
// memo.style = 'normal' (default, a typical competent player) or 'careful' (a skilled one). Same state + same memo = same action (no randomness).
// A decision costs about a millisecond. The bot only uses the rules the player has (the same actions, no peeking at hidden things except what the engine shows the UI).
//
// COME PENSA (italiano): ogni turno guarda in questo ordine e fa la PRIMA cosa che si applica.
//   1. scelta abilità al livello nuovo; negozio/panca aperti (compra cure, cibo, armature; ricicla roba inutile; riposa gratis);
//   2. emergenza: sotto il 35% di vita con un nemico vicino beve una cura (sotto il 25% prova anche pozioni sconosciute); sotto il 50% usa l'abilità di classe;
//   3. combattimento: abilità della classe (regola per classe, vedi useSkill), chiavette/script/oggetti da lancio sui nemici duri o se sta male,
//      poi colpisce chi è accanto (il più debole); se il nemico arriva aspetta (colpisce per primo), altrimenti lo raggiunge; se non riesce a raggiungerlo lo ignora per un po';
//   4. calma: indossa l'arma/armatura/plugin migliore, mangia sotto 250 di fame, prova pozioni sconosciute quando è ferito e script sconosciuti, usa gli incantesimi;
//      dorme per curarsi se la vita è sotto la soglia (50%; 75% prima di un boss; careful 70%/97%) e nessun nemico è in vista;
//   5. luoghi: panca e negozio della Sala Server, negozio di piano, terminale; poi va a pugnalare i nemici addormentati (danno triplo), esplora, scende le scale;
//      se non ha più cibo smette di esplorare e scende (i piani nuovi hanno cibo); sul piano del boss va dritto dal boss quando il resto è esplorato.
//   'careful' in più: combatte nei corridoi, usa oggetti su ogni nemico duro, scappa per le scale sotto il 35%.
// HOW IT THINKS (English): each turn it checks, in order, and does the FIRST thing that applies: skill choice and shops; emergencies (drink healing below 35% HP);
// the fight (class skill rule, items on hard enemies, hit the weakest adjacent enemy, let enemies come to it); calm things (best gear, eat, try unknown potions
// when hurt, sleep to heal below the rest threshold); places (hub bench, shops, altar); stab sleepers; explore; take the stairs.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        const g = require('./game.js'), m = require('./map.js'), b = factory(g, m);
        module.exports = b;
    } else { const R = root.Rogue = root.Rogue || {}; R.bot = factory(R.game, R.map); }
})(typeof self !== 'undefined' ? self : this, function (G0, MAP0) {
    'use strict';
    // how much a skill is worth to this bot (higher first); class-specific ones come from CLASS_SKILLS
    const SKILL_W = { vigore: 9, difesa: 8, forza: 8, riflessi: 5, recupero: 5, mira: 4, stomaco: 3, sanguisuga: 4, furia: 3, secchione: 4, fortuna: 2, zuccheri: 4, allenamento: 3, smanettone: 2, colpobasso: 3, occhio: 1 };
    const CLASS_SKILLS = { cattedra: 8, carrello: 8, uptime: 7, ordine: 7, cassetta: 7, primodellaclasse: 9, schedario: 6, minimalismo: 6, proxychain: 6, scriptshell: 4, zerodayscorta: 4, cronjob: 4, mocio: 6, doppiturno: 4, autorita: 7, penna: 6, bruteforce: 6, prospettiva: 6, riparazione: 5, nottebianca: 5 };
    // what a modifier is worth when comparing plugins
    const MOD_W = { def: 3, atk: 3, maxHp: 0.5, regen: 2, dodge: 1.5, acc: 1, crit: 0.2, vamp: 0.1, xp: 0.1, hunger: 0.03, backstab: 1, fury: 0.5, usb: 0.05, cd: 0.05, drink: 0.05, stealth: 0.03, luck: 0.03, search: 0.02, sight: 0.5, recharge: 1, holy: 0.3, haggle: 0.03 };
    const modScore = (mod) => Object.keys(mod || {}).reduce((a, k) => a + (MOD_W[k] || 0) * mod[k], 0);
    const avg = (d, e) => (d.dmg[0] + d.dmg[1]) / 2 + (e || 0);
    const weaponScore = (d, e) => avg(d, e) * (1 + 0.04 * (d.acc || 0)) + (d.crit || 0) / 15 + (d.holy || 0) * 0.3;
    const armorScore = (d, e) => d.def + (e || 0) + (d.dodge || 0) / 2;
    const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

    /** The bot for one copy of the rules (G = game.js module, MAP = map.js module). */
    function create(G, MAP) {
        const W = MAP.W, T = MAP.T, ITEM = G.ITEM, MOB = G.MOB, idx = (x, y) => y * W + x;

        function decide(s, memo) {
            if (s.status !== 'play') return null;
            for (const k of ['done', 'skip', 'ignore', 'chase']) if (!memo[k]) memo[k] = {};
            if (memo.waits === undefined) memo.waits = 0;
            if (!memo.last) memo.last = { turn: -1, key: '', rep: 0 };
            let a = null;
            for (let k = 0; k < 6 && !a; k++) a = think(s, memo);
            if (!a) a = { t: 'search' };
            const key = JSON.stringify(a);                                          // the same action refused again and again in the same turn: do something else
            memo.last = memo.last.turn === s.turn && memo.last.key === key ? { turn: s.turn, key, rep: memo.last.rep + 1 } : { turn: s.turn, key, rep: 0 };
            return memo.last.rep >= 2 ? { t: 'wait' } : a;
        }

        function think(s, memo) {
            const careful = memo.style === 'careful', done = memo.done, skip = memo.skip, ignore = memo.ignore, chase = memo.chase, p = s.p;
            const inv = () => p.inv, findInv = (f) => p.inv.findIndex((e) => f(ITEM[e.k], e)), knownIt = (e) => G.known(s, e);
            const healIdx = () => findInv((d, e) => knownIt(e) && d.effect === 'heal' && (d.cat === 'drink' || d.cat === 'script'));
            const healCount = () => p.inv.filter((e) => knownIt(e) && ITEM[e.k].effect === 'heal').reduce((x, e) => x + (e.n || 1), 0);
            const foodCount = () => p.inv.filter((e) => ITEM[e.k].cat === 'food').reduce((x, e) => x + (e.n || 1), 0);
            const use = (i) => ({ t: 'use', i });
            const dmgOf = (m) => { const d = MOB[m.k]; return ((d.atk[0] + d.atk[1]) / 2) * (d.speed || 1) * 0.8; };
            const walkTo = (tx, ty) => { const v = G.travelNext(s, tx, ty); return v ? { t: 'move', dx: v[0], dy: v[1] } : null; };
            const step = (v) => (v ? { t: 'move', dx: v[0], dy: v[1] } : null);

            function manage() {                       // gear and bag
                const w = p.weapon && ITEM[p.weapon.k], ar = p.armor && ITEM[p.armor.k];
                const bw = findInv((d, e) => d.cat === 'weapon' && knownIt(e) && weaponScore(d, e.e) > (w ? weaponScore(w, p.weapon.e) : 0) + 0.2);
                if (bw >= 0) return use(bw);
                const ba = findInv((d, e) => d.cat === 'armor' && knownIt(e) && armorScore(d, e.e) > (ar ? armorScore(ar, p.armor.e) : 0) + 0.2);
                if (ba >= 0) return use(ba);
                const pl = p.plugin && ITEM[p.plugin.k];
                const bp = findInv((d, e) => d.cat === 'plugin' && (!knownIt(e) || modScore(d.mod) > (pl ? modScore(pl.mod) : -1) + 0.2));
                return bp >= 0 ? use(bp) : null;
            }
            /** Things to try when nothing is in view: food, unknown potions (when hurt, so a heal is not wasted), unknown scripts, enchantments. */
            function safeUse() {
                if (p.food < 250 && foodCount()) return use(findInv((d) => d.cat === 'food'));
                const hurt = p.hp <= p.maxHp * 0.75, ok = p.hp > p.maxHp * 0.5;
                const i = findInv((d, e) => ok && ((d.cat === 'drink' && !knownIt(e) && hurt) || (d.cat === 'script' && !knownIt(e)) ||
                    (knownIt(e) && ['enchW', 'enchA', 'strength', 'life', 'xp', 'identify', 'recipes'].includes(d.effect)) ||
                    (knownIt(e) && ['map', 'grep'].includes(d.effect) && !done['f' + s.depth])));
                if (i < 0) return null;
                if (['map', 'grep'].includes(ITEM[p.inv[i].k].effect)) done['f' + s.depth] = 1;
                return use(i);
            }
            /** Class skill rule (per effect). `thr` = awake enemies in view. */
            function useSkill(thr, near) {
                const ac = G.CLASS[s.cls].active;
                if (p.cd > 0 || !near) return null;
                const low = p.hp < p.maxHp * 0.5, hard = thr.some((m) => m.hp >= 14 || MOB[m.k].boss || m.elite);
                const incoming = thr.filter((m) => cheb(m, p) <= 3).reduce((x, m) => x + dmgOf(m), 0);
                let go;
                switch (ac.effect) {
                    case 'heal': go = low; break;
                    case 'bolt': go = hard || low; break;
                    case 'fear': case 'sleep': go = (low && incoming > 0) || thr.length >= 3; break;
                    case 'fire': go = thr.length >= 2 || (hard && p.hp < p.maxHp * 0.8); break;
                    case 'invis': go = low && incoming > 0; break;
                    case 'freeze': go = hard || low; break;
                    default: go = low;
                }
                return go ? { t: 'active' } : null;
            }
            function tryItems(thr, near) {             // scripts, USB sticks and thrown things against real danger
                const hard = careful && thr.some((m) => m.hp >= 12 || MOB[m.k].boss || m.elite), low = p.hp < p.maxHp * 0.5;
                const incoming = thr.filter((m) => cheb(m, p) <= 2).reduce((x, m) => x + dmgOf(m), 0);
                if (hard || low) {
                    const u = findInv((d, e) => d.cat === 'usb' && e.ch > 0 && (!knownIt(e) || ['bolt', 'drain', 'freeze', 'slow', 'fire'].includes(d.effect) || (low && ['sleep', 'fear', 'banish'].includes(d.effect))));
                    if (u >= 0 && cheb(near, p) <= 5) return use(u);
                }
                if (low && incoming > 0) {
                    const sc = findInv((d, e) => d.cat === 'script' && knownIt(e) && ['fear', 'sleep', 'fire', 'invis'].includes(d.effect));
                    if (sc >= 0) return use(sc);
                } else if (careful && (thr.length >= 3 || (hard && incoming > p.hp * 0.15))) {
                    const sc = findInv((d, e) => d.cat === 'script' && knownIt(e) && ['fire', 'sleep'].includes(d.effect));
                    if (sc >= 0) return use(sc);
                }
                if (p.hp < p.maxHp * 0.3 && incoming > 0) {
                    const tp = findInv((d, e) => d.cat === 'script' && knownIt(e) && d.effect === 'teleport');
                    if (tp >= 0) return use(tp);
                }
                const d2 = cheb(near, p);
                if (d2 >= 1 && d2 <= G.THROW_RANGE && (hard || low) && MAP.los(s.map, p.x, p.y, near.x, near.y)) {
                    const t = findInv((d) => d.cat === 'throw');
                    if (t >= 0) return { t: 'throw', i: t, x: near.x, y: near.y };
                }
                return null;
            }
            /** A step towards a cell with few open neighbours (a corridor) when several enemies come; null when already well placed. */
            function chokeStep(thr) {
                const open = (x, y) => { let c = 0; for (const [dx, dy] of MAP.DIRS8) if (MAP.walkable(s.map.tiles[idx(x + dx, y + dy)])) c++; return c; };
                if (open(p.x, p.y) <= 3) return null;
                const dist = MAP.flood(s.map, [idx(p.x, p.y)], (i, t) => MAP.walkable(t), true), md = Math.min(...thr.map((m) => cheb(m, p)));
                let best = -1, bs = 99;
                for (let i = 0; i < dist.length; i++) {
                    if (dist[i] < 1 || dist[i] > Math.min(5, md - 1)) continue;
                    const x = i % W, y = (i / W) | 0, o = open(x, y);
                    if (o <= 3 && o + dist[i] * 0.3 < bs && !G.hazAt(s, x, y) && !s.mobs.some((m) => m.x === x && m.y === y)) { bs = o + dist[i] * 0.3; best = i; }
                }
                return best < 0 ? null : G.travelNext(s, best % W, (best / W) | 0);
            }
            /** Walk next to a piece of furniture (straight, never diagonal) and step into it. */
            function useFurniture(f) {
                for (const [dx, dy] of MAP.DIRS) if (p.x + dx === f.x && p.y + dy === f.y) return { t: 'move', dx, dy };
                for (const [dx, dy] of MAP.DIRS) { const x = f.x - dx, y = f.y - dy; if (MAP.walkable(s.map.tiles[idx(x, y)]) && s.seen[idx(x, y)] && !G.hazAt(s, x, y)) { const m = walkTo(x, y); if (m) return m; } }
                return null;
            }
            function shopping() {
                const armor = p.armor ? armorScore(ITEM[p.armor.k], p.armor.e) : 0, wep = p.weapon ? weaponScore(ITEM[p.weapon.k], p.weapon.e) : 0;
                let best = -1, bv = 0;
                s.shop.stock.forEach((e, i) => {
                    const d = ITEM[e.k], c = G.price(s, e);
                    if (c > p.gold || (p.inv.length >= G.INV_CAP && !(d.cat === 'drink' && p.inv.some((o) => o.k === e.k)))) return;
                    let v = 0;
                    if (d.effect === 'heal' && d.cat === 'drink') v = healCount() < 5 ? 100 + d.power / 2 - c / 4 : 0;
                    else if (d.cat === 'food') v = foodCount() < 3 ? 60 + d.food / 40 - c / 3 : 0;
                    else if (d.cat === 'armor') v = (armorScore(d, e.e) - armor) * 40;
                    else if (d.cat === 'weapon') v = (weaponScore(d, e.e) - wep) * 25;
                    else if (d.cat === 'plugin' && p.gold > c + 60) v = modScore(d.mod) * 8;
                    else if (d.cat === 'script' && ['heal', 'enchA', 'enchW'].includes(d.effect)) v = 30;
                    if (v > bv) { bv = v; best = i; }
                });
                return best >= 0 ? { t: 'buy', i: best } : null;
            }
            function benchUse() {
                if (p.hp < p.maxHp || p.cd > 0 || p.st.poison) return { t: 'rest' };
                const w = p.weapon && weaponScore(ITEM[p.weapon.k], p.weapon.e), ar = p.armor && armorScore(ITEM[p.armor.k], p.armor.e);
                const junk = findInv((d, e) => (d.cat === 'weapon' && (!w || weaponScore(d, e.e) <= w)) || (d.cat === 'armor' && (!ar || armorScore(d, e.e) <= ar)) ||
                    (knownIt(e) && ['poison', 'confuse', 'summon'].includes(d.effect)));
                return junk >= 0 ? { t: 'recycle', i: junk } : null;
            }

            const here = s.map.tiles[idx(p.x, p.y)];
            // 1. skill choice, shop and bench windows
            if (p.pending) { const sc = (id) => (CLASS_SKILLS[id] || SKILL_W[id] || 1) - (p.skills[id] || 0) * 0.5; return { t: 'skill', id: p.choices.slice().sort((x, y) => sc(y) - sc(x))[0] }; }
            if (s.shop && s.shop.open) { const b = shopping(); if (b) return b; done['s' + s.depth] = 1; return { t: 'leave' }; }
            if (s.bench && s.bench.open) { const b = benchUse(); if (b) return b; done['b' + s.depth] = 1; return { t: 'leave' }; }
            const thr = G.threats(s).filter((m) => !m.loot && !m.stolen && !(ignore[m.id] > s.turn && !G.touching(s, m)));
            const awake = thr.filter((m) => !m.asleep && !m.frozen && !(MOB[m.k].still && !MOB[m.k].ranged && cheb(m, p) > 1));
            const near = awake.slice().sort((a, b) => cheb(a, p) - cheb(b, p))[0];
            // 2. emergencies
            const incoming = awake.filter((m) => cheb(m, p) <= 2 || MOB[m.k].ranged).reduce((x, m) => x + dmgOf(m), 0);
            if (p.hp < p.maxHp * 0.35 && (near || p.st.poison)) {
                const i = healIdx();
                if (i >= 0) return use(i);
                const u = findInv((d, e) => d.cat === 'drink' && !knownIt(e));
                if (u >= 0 && p.hp < p.maxHp * 0.25) return use(u);
            }
            if (near && p.hp < p.maxHp * 0.5) { const k = useSkill(awake, near); if (k) return k; }
            if (careful && near && p.hp < p.maxHp * 0.35 && !s.sealed && incoming > 0) {                      // the stairs as an escape hatch
                const d = MAP.flood(s.map, [idx(p.x, p.y)], (i, t) => MAP.walkable(t), true)[idx(s.map.stairs.x, s.map.stairs.y)];
                if (here === T.STAIRS) return { t: 'descend' };
                if (d > 0 && d * incoming * 0.6 < p.hp && s.seen[idx(s.map.stairs.x, s.map.stairs.y)]) { const m = walkTo(s.map.stairs.x, s.map.stairs.y); if (m) return m; }
            }
            // 3. a fight
            if (!near) memo.waits = 0;
            if (near) {
                const k = useSkill(awake, near) || tryItems(awake, near);
                if (k) return k;
                const adj = awake.filter((m) => G.touching(s, m));
                if (adj.length) { memo.waits = 0; const m = adj.sort((a, b) => a.hp - b.hp)[0]; return { t: 'move', dx: m.x - p.x, dy: m.y - p.y }; }
                const rng = awake.some((m) => MOB[m.k].ranged && cheb(m, p) <= MOB[m.k].ranged.range);
                if (careful && !rng && awake.length >= 2) { const v = chokeStep(awake); if (v) return step(v); }
                const fast = awake.some((m) => (MOB[m.k].speed || 1) > 1);
                if (!rng && !fast && cheb(near, p) <= 4 && !MOB[near.k].erratic && memo.waits++ < 3) return { t: 'wait' };       // let it come: we hit first
                chase[near.id] = (chase[near.id] || 0) + 1;                                  // chasing something it keeps losing sight of: give up after a while
                if (chase[near.id] > 40) { ignore[near.id] = s.turn + 400; chase[near.id] = 0; return undefined; }
                const m = walkTo(near.x, near.y);
                if (m) return m;
                ignore[near.id] = s.turn + 60; return undefined;
            }
            // 4. calm: bag, rest, eat
            let k = manage() || safeUse();
            if (k) return k;
            const bossHere = s.sealed && s.mobs.some((m) => MOB[m.k].boss);
            const restBelow = careful ? (bossHere ? 0.97 : s.mobs.some((m) => m.elite) ? 0.9 : 0.7) : (bossHere ? 0.75 : 0.5);
            if (!s.hub && p.food >= 150 && G.threats(s).length === 0 && p.hp < p.maxHp && (s.sleeping > 0 || p.hp < p.maxHp * restBelow)) return { t: 'sleep' };   // once asleep, sleep on until the engine wakes us
            // 5. places: hub bench and shop, floor shop, altar
            if (s.bench && !done['b' + s.depth] && (p.hp < p.maxHp || p.inv.length > 12 || p.cd)) { k = useFurniture(s.bench); if (k) return k; }
            if (s.shop && !done['s' + s.depth] && p.gold >= 20) { k = useFurniture(s.shop); if (k) return k; }
            if (s.altar && !s.altar.used && p.hp >= p.maxHp * 0.8 && s.seen[idx(s.altar.x, s.altar.y)]) { k = useFurniture(s.altar); if (k) return k; }
            if (s.hub && s.bench) done['b' + s.depth] = 1;
            // 6. sleeping enemies: stab them (triple damage); the rest of the floor: explore, then the stairs
            const sleepers = thr.filter((m) => m.asleep && !MOB[m.k].ambush && !skip[m.id]).sort((a, b) => cheb(a, p) - cheb(b, p));
            let hunt = memo.hunt;
            if (hunt && (hunt.until < s.turn || !s.mobs.some((m) => m.id === hunt.id && m.asleep))) hunt = memo.hunt = null;          // keep walking to a sleeper once seen, even when it drops out of view
            if (!hunt && sleepers.length) hunt = memo.hunt = { id: sleepers[0].id, until: s.turn + 60 };
            if (hunt && p.hp >= p.maxHp * (careful ? 0.7 : 0.5)) {
                const m = s.mobs.find((e) => e.id === hunt.id);
                const mv = G.touching(s, m) ? { t: 'move', dx: m.x - p.x, dy: m.y - p.y } : walkTo(m.x, m.y);
                if (mv) return mv;
                skip[m.id] = 1; memo.hunt = null;
            }
            if (here === T.STAIRS && !s.sealed && (!s.hub || done['b' + s.depth])) return { t: 'descend' };
            const stairsOnly = (p.food < 300 && !foodCount()) || p.food < 120;               // out of food: stop exploring, go down (new floors have food)
            let v = (stairsOnly && !s.sealed && G.travelNext(s, s.map.stairs.x, s.map.stairs.y)) || G.exploreNext(s);
            if (!v && s.sealed) { const b = s.mobs.find((m) => MOB[m.k].boss); v = b && G.travelNext(s, b.x, b.y); }   // boss floor: the boss sleeps in the last room; walk to it
            if (!v) v = G.travelNext(s, s.map.stairs.x, s.map.stairs.y);
            return v ? step(v) : { t: 'search' };
        }
        return { decide };
    }
    const bot = create(G0, MAP0);
    bot.create = create;
    bot.weaponScore = weaponScore; bot.armorScore = armorScore;
    return bot;
});
