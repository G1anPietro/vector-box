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

/** Start, then force the roles: { P1: 'wolf', ... }; everybody not listed becomes a villager. */
async function startWith(r, assign) {
    await r.a.post({ action: 'start' });
    const g = r.game();
    for (const pid of Object.keys(g.roles)) g.roles[pid] = 'villager';
    for (const [name, role] of Object.entries(assign)) g.roles[r.id[name]] = role;
    g.orig_roles = { ...g.roles };
    r.setGame(g);
    await seeAll(r);
}

test('fisher: takes the role of the executed wolf and joins the pack', async () => {
    const r = await lupusRoom({ wolves_mode: 'fixed', wolves: 2, seer: false, guard: false, witch: false, hunter: false });
    await startWith(r, { P1: 'wolf', P2: 'wolf', P3: 'fisher', P4: 'villager', P5: 'villager', P6: 'villager' });
    const [w1, w2, fisher] = [r.id.P1, r.id.P2, r.id.P3];
    // night 1: nobody died yet, the fisher only gets the dummy question
    const st1 = (await r.a.state()).lupus.me.find((m) => m.player_id === fisher);
    assert.deepEqual(st1.fish_candidates, []);
    await night(r, { [w1]: r.id.P4, [w2]: r.id.P4 });
    assert.ok(r.game().dawn.died.includes(r.id.P4));
    // day 1: the village executes wolf P1
    await r.a.post({ action: 'vote_call' });
    for (const pid of r.game().alive) await r.as(pid, { action: 'vote', target: pid === w1 ? r.id.P5 : w1 });
    assert.equal(r.game().phase, 'night');
    // night 2: the fisher may choose between the eaten villager and the executed wolf, roles visible
    const me = (await r.a.state()).lupus.me.find((m) => m.player_id === fisher);
    assert.deepEqual(me.fish_candidates.map((c) => [c.p, c.role]).sort(), [[r.id.P4, 'villager'], [w1, 'wolf']].sort());
    assert.equal((await r.as(fisher, { action: 'night', target: r.id.P6 })).json.error, 'bad_target', 'only the dead can be fished');
    await night(r, { [fisher]: w1, [w2]: r.id.P5 });
    const g = r.game();
    assert.equal(g.roles[fisher], 'wolf');
    assert.equal(g.orig_roles[fisher], 'fisher');
    const view = (await r.a.state()).lupus.me.find((m) => m.player_id === fisher);
    assert.equal(view.role, 'wolf');
    assert.equal(view.fished.role, 'wolf');
    assert.ok(view.pack.includes(w2), 'the new wolf sees the pack');
    // fisher-wolf + wolf vs P6 alone: wolves have parity
    assert.equal(g.status, 'ended');
    assert.equal(g.result.winner, 'wolves');
});

test('fisher_sees off: candidates come without roles', async () => {
    const r = await lupusRoom({ ...fixed, seer: false, guard: false, witch: false, hunter: false, fisher_sees: false });
    await startWith(r, { P1: 'wolf', P2: 'fisher' });
    await night(r, { [r.id.P1]: r.id.P3 });
    await r.a.post({ action: 'skip_day' });
    const me = (await r.a.state()).lupus.me.find((m) => m.player_id === r.id.P2);
    assert.deepEqual(me.fish_candidates, [{ p: r.id.P3, role: null }]);
});

test('judge: the hammer overrides the vote once per game', async () => {
    const r = await lupusRoom({ ...fixed, seer: false, guard: false, witch: false, hunter: false });
    await startWith(r, { P1: 'wolf', P2: 'judge', P3: 'villager', P4: 'villager', P5: 'villager', P6: 'villager' });
    await night(r, { [r.id.P1]: r.id.P6 });
    await r.a.post({ action: 'vote_call' });
    // everybody votes P3, the judge hammers P1
    for (const pid of r.game().alive) {
        if (pid === r.id.P2) await r.as(pid, { action: 'vote', target: r.id.P1, judge: true });
        else await r.as(pid, { action: 'vote', target: pid === r.id.P3 ? r.id.P4 : r.id.P3 });
    }
    const g = r.game();
    assert.equal(g.lynch.p, r.id.P1);
    assert.equal(g.lynch.judge, true);
    assert.equal(g.result.winner, 'village');
    // a non-judge cannot use the hammer
    const r2 = await lupusRoom({ ...fixed, seer: false, guard: false, witch: false, hunter: false });
    await startWith(r2, { P1: 'wolf', P2: 'judge' });
    await night(r2, { [r2.id.P1]: r2.id.P6 });
    await r2.a.post({ action: 'vote_call' });
    assert.equal((await r2.as(r2.id.P3, { action: 'vote', target: r2.id.P1, judge: true })).json.error, 'bad_target');
});

test('jester: wins when executed, just dies when eaten', async () => {
    const r = await lupusRoom({ ...fixed, seer: false, guard: false, witch: false, hunter: false, scores: true });
    await startWith(r, { P1: 'wolf', P2: 'jester', P3: 'villager', P4: 'villager', P5: 'villager', P6: 'villager' });
    await night(r, { [r.id.P1]: r.id.P6 });
    await r.a.post({ action: 'vote_call' });
    for (const pid of r.game().alive) await r.as(pid, { action: 'vote', target: pid === r.id.P2 ? r.id.P3 : r.id.P2 });
    const g = r.game();
    assert.equal(g.result.winner, 'jester');
    assert.equal(g.result.jester, r.id.P2);
    const scores = Object.fromEntries((await r.a.state()).players.map((p) => [p.id, p.score]));
    assert.equal(scores[r.id.P2], 1);
    assert.equal(scores[r.id.P3], 0);

    const r2 = await lupusRoom({ ...fixed, seer: false, guard: false, witch: false, hunter: false });
    await startWith(r2, { P1: 'wolf', P2: 'jester' });
    await night(r2, { [r2.id.P1]: r2.id.P2 });
    assert.equal(r2.game().status, 'play');
    assert.ok(r2.game().dawn.died.includes(r2.id.P2));
});

// ---------- house standard and optional roles ----------
const ONLY = { seer: false, guard: false, witch: false, hunter: false, whore: false, jester: false, fisher: false };

test('house defaults: assassins plus whore, jester and fisherman', async () => {
    const r = await lupusRoom({}, { classic: false });
    await r.a.post({ action: 'start' });
    const deck = r.game().deck;
    assert.deepEqual(deck, { wolf: 1, whore: 1, jester: 1, fisher: 1, villager: 2 });
});

test('whore saves the victim: dawn says so', async () => {
    const r = await lupusRoom({ ...ONLY, ...fixed, whore: true });
    await startWith(r, { P1: 'wolf', P2: 'whore' });
    await night(r, { [r.id.P1]: r.id.P3, [r.id.P2]: r.id.P3 });
    const g = r.game();
    assert.deepEqual(g.dawn.died, []);
    assert.equal(g.dawn.whore, true);
    assert.equal((await r.b.state()).lupus.dawn.whore, true, 'public');
});

test('cupid: lovers die together; a killer and a villager in love win as the last two', async () => {
    const r = await lupusRoom({ ...ONLY, ...fixed, cupid: true });
    await startWith(r, { P1: 'wolf', P2: 'cupid' });
    await night(r, { [r.id.P1]: r.id.P3, [r.id.P2]: r.id.P1, [`${r.id.P2}:2`]: r.id.P4 });
    let g = r.game();
    assert.deepEqual(g.lovers.sort(), [r.id.P1, r.id.P4].sort());
    const p4 = (await r.b.state()).lupus.me.find((m) => m.player_id === r.id.P4);
    assert.equal(p4.lover, r.id.P1);
    // day 1: execute P2, night 2: eat P5, day 2: execute P6 -> P1 + P4 left
    await r.a.post({ action: 'vote_call' });
    for (const pid of g.alive) await r.as(pid, { action: 'vote', target: pid === r.id.P2 ? r.id.P5 : r.id.P2 });
    await night(r, { [r.id.P1]: r.id.P5 });
    await r.a.post({ action: 'vote_call' });
    for (const pid of r.game().alive) await r.as(pid, { action: 'vote', target: pid === r.id.P6 ? r.id.P4 : r.id.P6 });
    g = r.game();
    assert.equal(g.result.winner, 'lovers');

    // a lover's death takes the other along
    const r2 = await lupusRoom({ ...ONLY, ...fixed, cupid: true });
    await startWith(r2, { P1: 'wolf', P2: 'cupid' });
    await night(r2, { [r2.id.P1]: r2.id.P3, [r2.id.P2]: r2.id.P3, [`${r2.id.P2}:2`]: r2.id.P4 });
    assert.deepEqual(r2.game().dawn.died.sort(), [r2.id.P3, r2.id.P4].sort());
    assert.ok(r2.game().dead.some((d) => d.p === r2.id.P4 && d.cause === 'love'));
});

test('medium learns the executed role; masons know each other; minion looks clean and wins with the killers', async () => {
    const r = await lupusRoom({ ...ONLY, ...fixed, medium: true, masons: true, minion: true, seer: true, scores: true });
    await startWith(r, { P1: 'wolf', P2: 'medium', P3: 'mason', P4: 'mason', P5: 'minion', P6: 'seer' });
    const p3 = (await r.a.state()).lupus.me.find((m) => m.player_id === r.id.P3);
    assert.deepEqual(p3.masons.sort(), [r.id.P3, r.id.P4].sort());
    await night(r, { [r.id.P1]: r.id.P4, [r.id.P6]: r.id.P5 });
    const seer = (await r.b.state()).lupus.me.find((m) => m.player_id === r.id.P6);
    assert.equal(seer.seen_results[0].wolf, false, 'the minion looks like a villager');
    await r.a.post({ action: 'vote_call' });
    for (const pid of r.game().alive) await r.as(pid, { action: 'vote', target: pid === r.id.P6 ? r.id.P3 : r.id.P6 });
    const med = (await r.a.state()).lupus.me.find((m) => m.player_id === r.id.P2);
    assert.deepEqual(med.medium_info, { p: r.id.P6, role: 'seer' });
    // night 2: eat the medium -> killer vs mason + minion (the minion counts as "the others")
    await night(r, { [r.id.P1]: r.id.P2 });
    assert.equal(r.game().status, 'play');
    // day 2: execute the mason -> killer vs minion: parity, the killers' side wins
    await r.a.post({ action: 'vote_call' });
    for (const pid of r.game().alive) await r.as(pid, { action: 'vote', target: pid === r.id.P3 ? r.id.P1 : r.id.P3 });
    const g = r.game();
    assert.equal(g.result.winner, 'wolves');
    const scores = Object.fromEntries((await r.a.state()).players.map((p) => [p.id, p.score]));
    assert.equal(scores[r.id.P5], 1, 'the minion wins with the killers');
});

test('mayor counts twice, crow adds two', async () => {
    const r = await lupusRoom({ ...ONLY, ...fixed, mayor: true, crow: true });
    await startWith(r, { P1: 'wolf', P2: 'mayor', P3: 'crow' });
    await night(r, { [r.id.P1]: r.id.P6, [r.id.P3]: r.id.P5 });
    assert.equal(r.game().dawn.crow, r.id.P5);
    await r.a.post({ action: 'vote_call' });
    // P4 gets 2 plain votes (P1, P5); the mayor votes P1 (2); crow mark puts P5 at 2+1(P3)=3
    await r.as(r.id.P1, { action: 'vote', target: r.id.P4 });
    await r.as(r.id.P5, { action: 'vote', target: r.id.P4 });
    await r.as(r.id.P2, { action: 'vote', target: r.id.P1 });
    await r.as(r.id.P3, { action: 'vote', target: r.id.P5 });
    await r.as(r.id.P4, { action: 'vote', target: r.id.P1 });
    const g = r.game();
    assert.deepEqual(g.lynch.counts, { [r.id.P1]: 3, [r.id.P5]: 3, [r.id.P4]: 2 });
    assert.equal(g.lynch.p, 0, 'tie between the mayor-boosted P1 and the crow-marked P5');
});

test('elder survives the first attack; executing the elder removes the village powers', async () => {
    const r = await lupusRoom({ ...ONLY, ...fixed, elder: true, seer: true });
    await startWith(r, { P1: 'wolf', P2: 'elder', P3: 'seer' });
    await night(r, { [r.id.P1]: r.id.P2 });
    assert.deepEqual(r.game().dawn.died, [], 'the elder survives');
    await r.a.post({ action: 'vote_call' });
    for (const pid of r.game().alive) await r.as(pid, { action: 'vote', target: pid === r.id.P2 ? r.id.P4 : r.id.P2 });
    let g = r.game();
    assert.equal(g.powers_lost, true);
    const seer = (await r.a.state()).lupus.me.find((m) => m.player_id === r.id.P3);
    assert.equal(seer.power_lost, true);
    await night(r, { [r.id.P1]: r.id.P4, [r.id.P3]: r.id.P1 });
    g = r.game();
    assert.equal((g.seer_results[r.id.P3] || []).length, 1, 'no new vision after the powers are gone');
});

test('white killer eliminates a fellow killer on even nights and wins alone', async () => {
    const r = await lupusRoom({ ...ONLY, wolves_mode: 'fixed', wolves: 2, white_wolf: true });
    await startWith(r, { P1: 'white_wolf', P2: 'wolf' });
    const [white, wolf] = [r.id.P1, r.id.P2];
    const odd = await r.as(white, { action: 'night', target: r.id.P3, target2: wolf });
    assert.equal(odd.json.error, 'bad_target', 'not on odd nights');
    await night(r, { [white]: r.id.P3, [wolf]: r.id.P3 });
    await r.a.post({ action: 'skip_day' });
    assert.equal((await r.a.state()).lupus.me.find((m) => m.player_id === white).white_night, true);
    await night(r, { [white]: r.id.P4, [wolf]: r.id.P4, [`${white}:2`]: wolf });
    let g = r.game();
    assert.ok(g.dead.some((d) => d.p === wolf && d.cause === 'white'));
    assert.equal(g.status, 'play');
    // execute P5 -> the white killer vs P6: parity, and he is the only killer left: he wins alone
    await r.a.post({ action: 'vote_call' });
    for (const pid of g.alive) await r.as(pid, { action: 'vote', target: pid === r.id.P5 ? r.id.P6 : r.id.P5 });
    g = r.game();
    assert.equal(g.result.winner, 'white_wolf');
});
