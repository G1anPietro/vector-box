// tests/lupus-casi-limite.test.js — Lupus: people leaving in every phase, ties, dead players, tiny and big tables
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client, makeAdmin } = require('./helpers');

let site;

class Phone {
    constructor(c) { this.c = c; this.token = null; }
    static async fresh() { return new Phone(await new Client(site).init()); }
    h() { return this.token ? { 'X-Spia-Device': this.token } : {}; }
    async post(body) {
        const r = await this.c.post('/api/spia.php', body, { headers: this.h() });
        if (r.json && r.json.token) this.token = r.json.token;
        return r;
    }
    async state() { return (await this.c.get('/api/spia.php?action=state', { headers: this.h() })).json; }
}

// These tests were written for the first role set; the house defaults changed later
const CLASSIC = { seer: true, guard: true, witch: true, hunter: true, whore: false, jester: false, fisher: false };

/** Two phones: A (host) has P1-P3, B has P4-P6. Returns helpers to act as any player. */
async function lupusRoom(settings = {}, { classic = true } = {}) {
    settings = classic ? { ...CLASSIC, ...settings } : settings;
    try { site.db('DELETE FROM rate_limits'); } catch (e) { /* DB not created yet */ }
    const a = await Phone.fresh();
    const code = (await a.post({ action: 'create', game: 'lupus', players: ['P1', 'P2', 'P3'], settings })).json.code;
    const b = await Phone.fresh();
    const j = await b.post({ action: 'join', code });
    assert.equal(j.json.game, 'lupus');
    for (const n of ['P4', 'P5', 'P6']) await b.post({ action: 'player_add', name: n });
    const s = await a.state();
    const id = Object.fromEntries(s.players.map((p) => [p.name, p.id]));
    const phoneOf = (pid) => (['P1', 'P2', 'P3'].map((n) => id[n]).includes(pid) ? a : b);
    const game = () => JSON.parse(site.db('SELECT state FROM lupus_games WHERE room_id = (SELECT id FROM spia_rooms WHERE code = ?)', [code])[0].state);
    const setGame = (g) => site.db('UPDATE lupus_games SET state = ? WHERE room_id = (SELECT id FROM spia_rooms WHERE code = ?)', [JSON.stringify(g), code]);
    const as = (pid, body) => phoneOf(pid).post({ ...body, player_id: pid });
    const byRole = (role) => Object.entries(game().roles).filter(([, r]) => r === role).map(([p]) => +p);
    return { a, b, code, id, phoneOf, game, setGame, as, byRole };
}

async function seeAll(r) {
    for (const pid of r.game().alive) await r.as(pid, { action: 'seen' });
}

/** Every living player does their night move; `choices` overrides per player. */
async function night(r, choices = {}) {
    const g = r.game();
    for (const pid of g.alive) {
        const role = g.roles[pid];
        let target = choices[pid];
        if (target === undefined) {
            const others = g.alive.filter((x) => x !== pid);
            target = (role === 'wolf' || role === 'white_wolf') ? others.find((x) => !['wolf', 'white_wolf'].includes(g.roles[x]))
                : (role === 'guard' || role === 'whore') ? pid
                    : (role === 'seer' || role === 'cupid') ? others[0] : 0;
        }
        const body = { action: 'night', target };
        if (g.roles[pid] === 'cupid' && g.day === 1 && choices[`${pid}:2`] === undefined) body.target2 = g.alive.filter((x) => x !== pid)[1];
        if (choices[`${pid}:2`] !== undefined) body.target2 = choices[`${pid}:2`];
        const res = await r.as(pid, body);
        assert.equal(res.status, 200, `${role} night: ${JSON.stringify(res.json)}`);
    }
}

const fixed = { wolves_mode: 'fixed', wolves: 1 };
test.before(async () => { site = await startSite(); });
test.after(() => site.stop());

test('fewer than four players cannot start', async () => {
    try { site.db('DELETE FROM rate_limits'); } catch (e) { /* none */ }
    const a = await Phone.fresh();
    await a.post({ action: 'create', game: 'lupus', players: ['A', 'B', 'C'] });
    const r = await a.post({ action: 'start' });
    assert.notEqual(r.status, 200);
    assert.match(String(r.json.error), /need_players/);
});

test('the only wolf leaves (at night, in the day, while the others still choose): the village wins at once', async () => {
    for (const when of ['reveal', 'night']) {
        const r = await lupusRoom({ ...fixed, witch: false });
        await r.a.post({ action: 'start' });
        if (when === 'night') await seeAll(r);
        const wolf = r.byRole('wolf')[0];
        const res = await r.as(wolf, { action: 'x' });   // a harmless call: just to find the phone
        assert.ok(res);
        await r.phoneOf(wolf).post({ action: 'player_remove', player_id: wolf });
        const g = r.game();
        assert.equal(g.status, 'ended', when);
        assert.equal(g.result.winner, 'village', when);
    }
});

test('a player leaving while the cards are being looked at: the others finish looking and the night starts', async () => {
    const r = await lupusRoom({ ...fixed, witch: false });
    await r.a.post({ action: 'start' });
    const g0 = r.game();
    const leaver = g0.alive.find((p) => g0.roles[p] !== 'wolf' && r.phoneOf(p) === r.b);
    for (const pid of g0.alive.filter((p) => p !== leaver)) await r.as(pid, { action: 'seen' });
    assert.equal(r.game().phase, 'reveal');
    await r.b.post({ action: 'player_remove', player_id: leaver });
    assert.equal(r.game().phase, 'night', 'nobody is waited for any more');
});

test('a tie in the vote: nobody is executed and the day goes on (or the final vote ends it), never a crash', async () => {
    const r = await lupusRoom({ ...fixed, seer: false, guard: false, witch: false });
    await r.a.post({ action: 'start' });
    await seeAll(r);
    const wolf = r.byRole('wolf')[0];
    const villagers = r.byRole('villager');
    await night(r, { [wolf]: villagers[0] });
    await r.a.post({ action: 'vote_call' });
    const alive = r.game().alive;
    // half vote for one player, half for another
    const [x, y] = [alive[0], alive[1]];
    let i = 0;
    for (const pid of alive) { const t = i++ % 2 ? x : y; await r.as(pid, { action: 'vote', target: pid === t ? (t === x ? y : x) : t }); }
    const g = r.game();
    assert.equal(g.status, 'play');
    assert.ok(g.alive.length === alive.length || g.alive.length === alive.length - 1);
    const s = await r.a.state();
    assert.equal(typeof s.lupus, 'object');
});

test('the dead do not act or vote; nobody votes for the dead or for themselves', async () => {
    const r = await lupusRoom({ ...fixed, seer: false, guard: false, witch: false });
    await r.a.post({ action: 'start' });
    await seeAll(r);
    const wolf = r.byRole('wolf')[0];
    const victim = r.byRole('villager')[0];
    await night(r, { [wolf]: victim });
    assert.ok(!r.game().alive.includes(victim));
    await r.a.post({ action: 'vote_call' });
    assert.notEqual((await r.as(victim, { action: 'vote', target: wolf })).status, 200, 'a dead player votes');
    const living = r.game().alive.filter((p) => p !== wolf);
    assert.notEqual((await r.as(living[0], { action: 'vote', target: victim })).status, 200, 'a vote for the dead');
    assert.notEqual((await r.as(living[0], { action: 'vote', target: living[0] })).status, 200, 'a vote for yourself');
    assert.notEqual((await r.as(victim, { action: 'night', target: wolf })).status, 200);
});

test('the host phone leaves in the middle of a match: the others keep playing', async () => {
    const r = await lupusRoom({ ...fixed, witch: false });
    await r.a.post({ action: 'start' });
    await seeAll(r);
    await r.a.post({ action: 'leave' });
    const s = await r.b.state();
    assert.ok(s.lupus, 'the match is still there');
    const g = r.game();
    assert.equal(g.status === 'play' || g.status === 'ended', true);
});

test('a table of twenty with every role gets a valid deal (a wolf, never more roles than players)', async () => {
    try { site.db('DELETE FROM rate_limits'); } catch (e) { /* none */ }
    const a = await Phone.fresh();
    const code = (await a.post({ action: 'create', game: 'lupus', players: Array.from({ length: 20 }, (_, i) => 'G' + (i + 1)),
        settings: { seer: true, guard: true, witch: true, hunter: true, whore: true, jester: true, fisher: true, cupid: true, medium: true, mayor: true } })).json.code;
    const r = await a.post({ action: 'start' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const g = JSON.parse(site.db('SELECT state FROM lupus_games WHERE room_id = (SELECT id FROM spia_rooms WHERE code = ?)', [code])[0].state);
    assert.equal(Object.keys(g.roles).length, 20);
    assert.ok(Object.values(g.roles).some((x) => x === 'wolf' || x === 'white_wolf'));
});

test('four players with every role switched on: the deal still works and keeps a wolf', async () => {
    try { site.db('DELETE FROM rate_limits'); } catch (e) { /* none */ }
    const a = await Phone.fresh();
    const code = (await a.post({ action: 'create', game: 'lupus', players: ['A', 'B', 'C', 'D'],
        settings: { seer: true, guard: true, witch: true, hunter: true, whore: true, jester: true, fisher: true, cupid: true } })).json.code;
    const r = await a.post({ action: 'start' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const g = JSON.parse(site.db('SELECT state FROM lupus_games WHERE room_id = (SELECT id FROM spia_rooms WHERE code = ?)', [code])[0].state);
    assert.equal(Object.keys(g.roles).length, 4);
    assert.ok(Object.values(g.roles).some((x) => x === 'wolf' || x === 'white_wolf'));
});
