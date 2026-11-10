// tests/lupus.test.js — Lupus (werewolf) rooms: dealing, privacy, night, witch, hunter, votes, wins
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

/** Two phones: A (host) has P1-P3, B has P4-P6. Returns helpers to act as any player. */
async function lupusRoom(settings = {}) {
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
            target = role === 'wolf' ? others.find((x) => g.roles[x] !== 'wolf')
                : role === 'guard' ? pid
                    : role === 'seer' ? others[0] : 0;
        }
        const res = await r.as(pid, { action: 'night', target });
        assert.equal(res.status, 200, `${role} night: ${JSON.stringify(res.json)}`);
    }
}

const fixed = { wolves_mode: 'fixed', wolves: 1 };

test.before(async () => { site = await startSite(); });
test.after(() => site.stop());

test('dealing: right deck, each phone sees only its own roles, wolves know each other', async () => {
    const r = await lupusRoom({ wolves_mode: 'fixed', wolves: 2 });
    assert.equal((await r.b.post({ action: 'start' })).status, 403, 'only the host starts');
    assert.equal((await r.a.post({ action: 'start' })).status, 200);
    const g = r.game();
    const counts = Object.values(g.roles).reduce((m, x) => ({ ...m, [x]: (m[x] || 0) + 1 }), {});
    assert.deepEqual(counts, { wolf: 2, seer: 1, guard: 1, witch: 1, hunter: 1 });
    assert.equal(g.phase, 'reveal');

    const sb = await r.b.state();
    assert.equal(sb.game, 'lupus');
    assert.deepEqual(sb.lupus.me.map((m) => m.player_id).sort(), ['P4', 'P5', 'P6'].map((n) => r.id[n]).sort());
    assert.equal(sb.lupus.all_roles, null);
    for (const m of sb.lupus.me) {
        if (m.role === 'wolf') assert.deepEqual(m.pack.sort(), r.byRole('wolf').sort());
        else assert.equal(m.pack, undefined, 'only wolves see the pack');
    }
    assert.deepEqual(sb.lupus.deck, { wolf: 2, seer: 1, guard: 1, witch: 1, hunter: 1 }, 'roles in play are public');

    await seeAll(r);
    assert.equal(r.game().phase, 'night');
    assert.equal(r.game().day, 1);
});

test('night: guard saves the victim, seer learns the truth, then village lynches the wolf and wins', async () => {
    const r = await lupusRoom({ ...fixed, scores: true });
    await r.a.post({ action: 'start' });
    await seeAll(r);
    const g = r.game();
    const wolf = r.byRole('wolf')[0], seer = r.byRole('seer')[0], guard = r.byRole('guard')[0], witch = r.byRole('witch')[0];
    const victim = r.byRole('villager')[0] || r.byRole('hunter')[0];

    await night(r, { [wolf]: victim, [seer]: wolf, [guard]: victim });
    assert.equal(r.game().phase, 'witch');
    const witchView = (await r.phoneOf(witch).state()).lupus.me.find((m) => m.player_id === witch);
    assert.equal(witchView.witch_turn, true);
    assert.equal(witchView.victim, victim);
    await r.as(witch, { action: 'witch', heal: false, kill: 0 });

    let st = r.game();
    assert.equal(st.phase, 'day');
    assert.deepEqual(st.dawn.died, [], 'protected by the guard');
    const seerView = (await r.phoneOf(seer).state()).lupus.me.find((m) => m.player_id === seer);
    assert.deepEqual(seerView.seen_results.map((x) => [x.p, x.wolf]), [[wolf, true]]);

    await r.a.post({ action: 'vote_call' });
    for (const pid of st.alive) await r.as(pid, { action: 'vote', target: pid === wolf ? seer : wolf });
    st = r.game();
    assert.equal(st.status, 'ended');
    assert.equal(st.result.winner, 'village');
    const scores = Object.fromEntries((await r.a.state()).players.map((p) => [p.id, p.score]));
    assert.equal(scores[wolf], 0);
    assert.equal(scores[seer], 1);
});

test('witch potions: heal once, poison once; guard repeat is refused', async () => {
    const r = await lupusRoom({ ...fixed, hunter: false });
    await r.a.post({ action: 'start' });
    await seeAll(r);
    const wolf = r.byRole('wolf')[0], witch = r.byRole('witch')[0], guard = r.byRole('guard')[0], seer = r.byRole('seer')[0];
    await night(r, { [wolf]: seer, [guard]: guard });
    await r.as(witch, { action: 'witch', heal: true, kill: 0 });
    assert.deepEqual(r.game().dawn.died, []);
    assert.equal(r.game().witch.heal, false);

    await r.a.post({ action: 'skip_day' });
    assert.equal((await r.as(guard, { action: 'night', target: guard })).json.error, 'guard_repeat');
    const villager = r.byRole('villager')[0];
    await night(r, { [wolf]: seer, [guard]: villager });
    assert.equal((await r.as(witch, { action: 'witch', heal: true, kill: 0 })).json.error, 'bad_target', 'heal already used');
    await r.as(witch, { action: 'witch', heal: false, kill: villager });
    assert.deepEqual(r.game().dawn.died.sort(), [seer, villager].sort(), 'wolves ate the seer, the witch poisoned a villager');
});

test('dead witch: the witch step still happens and ends by itself', async () => {
    const r = await lupusRoom(fixed);
    await r.a.post({ action: 'start' });
    await seeAll(r);
    const wolf = r.byRole('wolf')[0], witch = r.byRole('witch')[0], guard = r.byRole('guard')[0];
    await night(r, { [wolf]: witch, [guard]: guard });
    await r.as(witch, { action: 'witch', heal: false, kill: 0 });
    assert.ok(r.game().dawn.died.includes(witch));
    await r.a.post({ action: 'skip_day' });
    const g0 = r.game();
    const victim = g0.alive.find((p) => g0.roles[p] === 'villager');
    await night(r, { [wolf]: victim, [guard]: wolf });
    let g = r.game();
    assert.equal(g.phase, 'witch');
    assert.equal(g.witch_step.p, null);
    g.witch_step.auto_at = Math.floor(Date.now() / 1000) - 1;
    r.setGame(g);
    await r.a.state(); // a poll runs the tick
    g = r.game();
    assert.equal(g.phase, 'day');
    assert.ok(g.dawn.died.includes(victim));
});

test('hunter shoots when lynched; wolves win at parity', async () => {
    const r = await lupusRoom({ ...fixed, seer: false, guard: false, witch: false });
    await r.a.post({ action: 'start' });
    await seeAll(r);
    const wolf = r.byRole('wolf')[0], hunter = r.byRole('hunter')[0];
    const villagers = r.byRole('villager');
    await night(r, { [wolf]: villagers[0] });
    assert.equal(r.game().phase, 'day');
    // village wrongly lynches the hunter, who shoots a villager
    await r.a.post({ action: 'vote_call' });
    for (const pid of r.game().alive) await r.as(pid, { action: 'vote', target: pid === hunter ? wolf : hunter });
    assert.equal(r.game().phase, 'hunter');
    assert.equal((await r.a.state()).lupus.hunter, hunter);
    await r.as(hunter, { action: 'shoot', target: villagers[1] });
    const g = r.game();
    // 6 players: villager eaten, hunter lynched, villager shot -> wolf vs 2 villagers... still playing
    assert.equal(g.status, 'play');
    assert.equal(g.phase, 'night');
    await night(r, { [wolf]: villagers[2] });
    const end = r.game();
    assert.equal(end.status, 'ended');
    assert.equal(end.result.winner, 'wolves');
    assert.equal(end.result.reason, 'wolves_parity');
});

test('a player leaving at night no longer blocks the night', async () => {
    const r = await lupusRoom({ ...fixed, witch: false });
    await r.a.post({ action: 'start' });
    await seeAll(r);
    const g = r.game();
    const leaver = g.alive.find((p) => r.phoneOf(p) === r.b && g.roles[p] !== 'wolf');
    // everyone except the leaver acts
    for (const pid of g.alive.filter((p) => p !== leaver)) {
        const role = g.roles[pid];
        const target = role === 'wolf' ? g.alive.find((x) => g.roles[x] !== 'wolf' && x !== leaver)
            : role === 'guard' ? pid
                : role === 'seer' ? g.alive.find((x) => x !== pid) : 0;
        assert.equal((await r.as(pid, { action: 'night', target })).status, 200);
    }
    assert.equal(r.game().phase, 'night');
    await r.b.post({ action: 'player_remove', player_id: leaver });
    const after = r.game();
    assert.notEqual(after.phase, 'night');
    assert.ok(after.dead.some((d) => d.p === leaver && d.cause === 'left'));
});

test('late joiners wait for the next match; spy actions are refused in a lupus room', async () => {
    const r = await lupusRoom(fixed);
    await r.a.post({ action: 'start' });
    await r.b.post({ action: 'player_add', name: 'Late' });
    const sb = await r.b.state();
    const late = sb.players.find((p) => p.name === 'Late').id;
    assert.ok(!sb.lupus.in_game.includes(late));
    assert.ok(!sb.lupus.me.some((m) => m.player_id === late));
    assert.equal((await r.a.post({ action: 'guess', player_id: r.id.P1, location_id: 'bank' })).json.error, 'unknown_action');
});

test('admin LIVE shows lupus roles; nothing extra reaches normal phones', async () => {
    const admin = await makeAdmin(site, 'lupus_admin');
    const r = await lupusRoom(fixed);
    await r.a.post({ action: 'start' });
    const live = (await admin.get('/api/spia.php?action=live')).json.rooms.find((x) => x.code === r.code);
    assert.equal(live.game, 'lupus');
    assert.deepEqual(Object.keys(live.lupus.roles).length, 6);
    const raw = JSON.stringify(await r.b.state());
    for (const pid of ['P1', 'P2', 'P3'].map((n) => r.id[n])) {
        assert.ok(!raw.includes(`"${pid}":"`), 'no role of another phone in the payload');
    }
});
