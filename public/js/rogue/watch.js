// js/rogue/watch.js — the loop behind "Watch the bot play": a separate game state played by Rogue.bot, with speed, pause, step, no-progress detection,
// an action cap and save/restore. No DOM, no storage, no clock of its own: the page (dungeon.js) calls tick() from requestAnimationFrame and stores serialise().
// It never touches a profile: the state is built from a throw-away profile with everything unlocked (the bot may use any class).
//   const w = Rogue.watch.create(Rogue.game, Rogue.bot, { seed, cls: 'studente', style: 'normal' });   // or { saved: textFromSerialise }
//   w.tick(dtMs)     // from rAF: runs the actions that are due at the current speed (max speed: as many as fit in ~12 ms)
//   w.step()         // one action; w.run(budgetMs) many; w.status = 'play' | 'dead' | 'won' | 'stalled' | 'cap'
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else { const R = root.Rogue = root.Rogue || {}; R.watch = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    const SPEEDS = { '1x': 600, '2x': 300, '5x': 120, '20x': 30, max: 0 };   // ms per action; max = as many as the frame budget allows
    const MAX_ACTIONS = 60000, STALL = 200, KEEP_WHYS = 12, FORMAT = 1;
    const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
    /** "ABC123" or "0xabc123" (up to 8 hex digits, like the seed on the recap screen) → a 32-bit number; null if it is not one. */
    const parseSeed = (text) => { const m = /^(?:0x)?([0-9a-f]{1,8})$/i.exec(String(text).trim()); return m ? parseInt(m[1], 16) >>> 0 : null; };
    const seedText = (n) => (n >>> 0).toString(16).toUpperCase();

    function create(G, bot, opts) {
        opts = opts || {};
        const w = { SPEEDS, status: 'play', speed: opts.speed in SPEEDS ? opts.speed : '5x', paused: false, acc: 0, count: 0, whys: [], same: 0, sig: '' };
        const cap = opts.maxActions || MAX_ACTIONS, stall = opts.stall || STALL;
        if (opts.saved) {
            const o = restore(G, opts.saved);
            if (!o) return null;
            Object.assign(w, { s: o.s, memo: o.memo, count: o.count, whys: o.whys, same: o.same, sig: o.sig, status: o.status, speed: o.speed in SPEEDS ? o.speed : w.speed });
        } else {
            const meta = G.newMeta(); Object.assign(meta, { ng: 9, best: 99, bosses: 99, wins: 99, runs: 99 });   // every class open, nothing bought; thrown away
            w.s = G.newGame(opts.seed >>> 0, opts.cls || 'studente', meta, {});
            w.memo = { style: opts.style === 'careful' ? 'careful' : 'normal' };
        }
        /** What "the same state" means: where it is, its life and bag, the floor, gold, kills (the turn counter and hunger are left out on purpose: waiting forever ticks them). */
        const signature = () => { const s = w.s, p = s.p; return [s.depth, p.x, p.y, p.hp, p.xp, p.gold, p.inv.length, s.kills, s.shop && s.shop.open, s.bench && s.bench.open, p.pending].join(','); };

        /** One action of the bot. Returns the action, or null when the run is over (w.status says how). */
        w.step = function () {
            if (w.status !== 'play') return null;
            const s = w.s;
            if (s.status !== 'play') { w.status = s.status; return null; }
            if (w.count >= cap) { w.status = 'cap'; return null; }
            const a = bot.decide(s, w.memo);
            if (!a) { w.status = s.status === 'play' ? 'stalled' : s.status; return null; }
            const turn = s.turn;
            if (w.memo.why) { w.whys.push({ n: w.count, turn, why: { key: w.memo.why.key, params: w.memo.why.params || {} }, t: a.t }); if (w.whys.length > KEEP_WHYS) w.whys.shift(); }
            G.act(s, a);
            w.count++;
            if (s.status !== 'play') w.status = s.status;
            else if (w.count >= cap) w.status = 'cap';
            else {
                const sg = signature();
                w.same = sg === w.sig ? w.same + 1 : 0; w.sig = sg;
                if (w.same >= stall) w.status = 'stalled';
            }
            return a;
        };
        /** Many actions for at most `budgetMs` (checked after every action). Returns how many were played. */
        w.run = function (budgetMs, clock) {
            const t = (clock || now), t0 = t(); let n = 0;
            do { if (!w.step()) break; n++; } while (t() - t0 < budgetMs);
            return n;
        };
        /** From requestAnimationFrame: dtMs since the last call. Paused = nothing. Returns the number of actions played. */
        w.tick = function (dtMs, budgetMs, clock) {
            if (w.paused || w.status !== 'play') return 0;
            budgetMs = budgetMs || 12;
            const iv = SPEEDS[w.speed];
            if (!iv) return w.run(budgetMs, clock);
            w.acc += Math.min(dtMs, iv * 2);                // a long pause (tab in the background) must not fire a burst
            const due = Math.floor(w.acc / iv);
            if (!due) return 0;
            w.acc -= due * iv;
            const t = (clock || now), t0 = t(); let n = 0;
            while (n < due && w.status === 'play') { if (!w.step()) break; n++; if (t() - t0 >= budgetMs) { w.acc = 0; break; } }
            return n;
        };
        w.setSpeed = (k) => { if (k in SPEEDS) { w.speed = k; w.acc = 0; } };
        w.serialise = () => JSON.stringify({ f: FORMAT, count: w.count, status: w.status, speed: w.speed, same: w.same, sig: w.sig, memo: w.memo, whys: w.whys, s: w.s });
        return w;
    }
    /** The inverse of serialise: { s, memo, ... } or null if the text is not a valid watched run. The state is NOT passed through game.load (that one resets the sleep counter: the bot would continue differently). */
    function restore(G, text) {
        try {
            const o = JSON.parse(text), s = o && o.s;
            if (!o || o.f !== FORMAT || !s || s.v !== G.VERSION || !s.p || !s.map || !s.map.tiles || !s.map.tiles.length || !G.CLASS[s.cls] || !o.memo || typeof o.memo !== 'object') return null;
            if (!Array.isArray(o.whys) || typeof o.count !== 'number') return null;
            if (s.status === 'play') G.updateFov(s);
            return o;
        } catch (e) { return null; }
    }
    return { create, restore, parseSeed, seedText, SPEEDS, MAX_ACTIONS, STALL };
});
