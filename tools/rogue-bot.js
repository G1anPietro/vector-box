// tools/rogue-bot.js — Node wrapper around the bot of public/js/rogue/bot.js (the rules of how it thinks are explained at the top of that file).
//   const { play, ending } = require('./rogue-bot.js');  const s = play(seed, 'studente', { maxTurns: 40000, style: 'normal' });   // s = the final game state
// Used by tools/rogue-balance.js and tests/dungeon-balance.test.js. ROGUE_DIR=/other/rogue/folder runs the same bot on another copy of the rules (data comparison).
'use strict';
const path = require('path');
const dir = process.env.ROGUE_DIR || path.join(__dirname, '..', 'public', 'js', 'rogue');
const MAP = require(path.join(dir, 'map.js')), G = require(path.join(dir, 'game.js'));
const BOT = require(path.join(__dirname, '..', 'public', 'js', 'rogue', 'bot.js')).create(G, MAP);

/** Plays one seeded run with the bot. opt: maxTurns, style ('normal' | 'careful'), meta (profile overrides). The final status is 'stuck' if the bot stops making progress. */
function play(seed, cls, opt) {
    opt = opt || {};
    const maxTurns = opt.maxTurns || 40000;
    const meta = G.newMeta(); Object.assign(meta, { ng: 9, best: 99, bosses: 99, wins: 99, runs: 99 });   // every class unlocked, no upgrades bought
    if (opt.meta) Object.assign(meta, opt.meta);
    const s = G.newGame(seed, cls, meta, {});
    const memo = { style: opt.style === 'careful' ? 'careful' : 'normal' };
    let idle = 0, last = -1;
    while (s.status === 'play' && s.turn < maxTurns) {
        const a = BOT.decide(s, memo);
        if (!a) break;
        G.act(s, a);
        idle = s.turn === last ? idle + 1 : 0; last = s.turn;
        if (idle > 400) { s.status = 'stuck'; break; }
    }
    return s;
}

/** How a run ended: 'won' | 'monster' | 'hazard' | 'hunger' | 'alive' (turn limit) | 'stuck'. */
function ending(s) {
    if (s.status !== 'dead') return s.status === 'play' ? 'alive' : s.status;
    const k = s.cause && s.cause.k;
    return k === 'cause_mob' ? 'monster' : k === 'cause_hunger' ? 'hunger' : 'hazard';   // haz, trap, pit, poison/burn
}
module.exports = { play, ending };
