// tests/spia.test.js — "Who's the Spy" rooms: dealing, privacy, votes, guesses, admin view
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client, makeAdmin } = require('./helpers');

let site;

/** A phone in a room: a browser session + the device token from create/join. */
class Phone {
    constructor(client) { this.c = client; this.token = null; }
    static async fresh() { return new Phone(await new Client(site).init()); }
    headers() { return this.token ? { 'X-Spia-Device': this.token } : {}; }
    async post(body) {
        const r = await this.c.post('/api/spia.php', body, { headers: this.headers() });
        if (r.json && r.json.token) this.token = r.json.token;
        return r;
    }
    async state() { return (await this.c.get('/api/spia.php?action=state', { headers: this.headers() })).json; }
    async create(players = [], settings = {}) {
        try { site.db('DELETE FROM rate_limits'); } catch (e) { /* DB not created yet */ } // tests exceed the per-IP limit
        const r = await this.post({ action: 'create', players, settings }); return r.json.code; }
    join(code) { return this.post({ action: 'join', code }); }
    add(name) { return this.post({ action: 'player_add', name }); }
}

/** Room with phone A (host: Anna, Bea) and phone B (Carlo). */
async function room(settings = {}, hostClient = null) {
    const a = hostClient ? new Phone(hostClient) : await Phone.fresh();
    const code = await a.create(['Anna', 'Bea'], settings);
    const b = await Phone.fresh();
    await b.join(code);
    await b.add('Carlo');
    return { a, b, code };
}

const ids = (state) => Object.fromEntries(state.players.map((p) => [p.name, p.id]));
const roomId = (code) => site.db('SELECT id FROM spia_rooms WHERE code = ?', [code])[0].id;
const truth = (code) => site.db(`SELECT p.name, a.is_spy, a.role, a.fake_role, a.out_reason FROM spia_assign a
    JOIN spia_players p ON p.id = a.player_id JOIN spia_rooms r ON r.round_id = a.round_id WHERE r.code = ? ORDER BY p.id`, [code]);

test.before(async () => { site = await startSite(); });
test.after(() => site.stop());

test('migration V6 created the spy tables', async () => {
    await (await Phone.fresh()).create(['Init']); // first DB request runs the migrations
    assert.ok(site.db('PRAGMA user_version')[0].user_version >= 6);
    assert.equal(site.db("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'spia_%' AND type = 'table'")[0].n, 6);
});

test('POST without CSRF is refused; unknown device is 401', async () => {
    const p = await Phone.fresh();
    const r = await p.c.post('/api/spia.php', { action: 'create' }, { csrf: false });
    assert.equal(r.status, 403);
    assert.equal((await p.c.get('/api/spia.php?action=state')).status, 401);
});

test('each phone only receives the cards of its own players', async () => {
    const { a, b, code } = await room({ spies: 1 });
    assert.equal((await b.post({ action: 'start' })).status, 403, 'only the host starts');
    const r = await a.post({ action: 'start' });
    assert.equal(r.status, 200, JSON.stringify(r.json));

    const sa = await a.state();
    const sb = await b.state();
    assert.deepEqual(sa.cards.map((c) => c.player_id).sort(), [ids(sa).Anna, ids(sa).Bea].sort());
    assert.deepEqual(sb.cards.map((c) => c.player_id), [ids(sb).Carlo]);
    assert.equal(sa.round.spy_count, 1, 'fixed mode shows the count');

    const t = truth(code);
    assert.equal(t.filter((x) => x.is_spy).length, 1);
    const civRoles = t.filter((x) => !x.is_spy).map((x) => x.role);
    assert.equal(new Set(civRoles).size, civRoles.length, 'civilians get distinct roles');
    for (const card of [...sa.cards, ...sb.cards]) {
        assert.equal(card.x, undefined, 'no admin marker for normal sessions');
        if (card.spy) assert.equal(card.location_id, undefined, 'spy cards never carry the location');
    }
});

test('range mode: spy count drawn per round, can be 0 or everyone, and stays hidden', async () => {
    const { a, code } = await room({ spy_mode: 'range', spy_min: 0, spy_max: 3 });
    const seen = new Set();
    for (let i = 0; i < 25; i++) {
        await a.post({ action: 'start' });
        const s = await a.state();
        assert.equal(s.round.spy_count, null);
        const spies = truth(code).filter((x) => x.is_spy).length;
        assert.ok(spies >= 0 && spies <= 3);
        seen.add(spies);
        await a.post({ action: 'end' });
    }
    assert.ok(seen.size >= 3, `expected varied spy counts, got ${[...seen]}`);
});

test('votes: innocent out -> spies win; spy out -> civilians win (count visible)', async () => {
    const { a, b, code } = await room({ spies: 1, scores: true });
    await a.post({ action: 'start' });
    let s = await a.state();
    const t = truth(code);
    const spyName = t.find((x) => x.is_spy).name;
    const civ = t.filter((x) => !x.is_spy).map((x) => x.name);
    const id = ids(s);
    const voteAll = async (target) => {
        await a.post({ action: 'vote_call' });
        for (const [phone, names] of [[a, ['Anna', 'Bea']], [b, ['Carlo']]]) {
            for (const n of names) {
                const tgt = n === target ? (target === civ[0] ? id[civ[1]] : id[civ[0]]) : id[target];
                await phone.post({ action: 'vote', player_id: id[n], target: tgt });
            }
        }
    };
    await voteAll(spyName);
    s = await a.state();
    assert.equal(s.round.status, 'ended');
    assert.equal(s.round.result.winner, 'civilians');
    assert.equal(s.round.result.reason, 'all_caught');
    const scores = Object.fromEntries(s.players.map((p) => [p.name, p.score]));
    assert.equal(scores[spyName], 0);
    for (const n of civ) assert.equal(scores[n], 1);

    await a.post({ action: 'start' });
    s = await a.state();
    const t2 = truth(code);
    const civ2 = t2.filter((x) => !x.is_spy).map((x) => x.name);
    await a.post({ action: 'vote_call' });
    // everyone votes the first civilian (who votes for the other civilian)
    for (const [phone, names] of [[a, ['Anna', 'Bea']], [b, ['Carlo']]]) {
        for (const n of names) {
            await phone.post({ action: 'vote', player_id: id[n], target: n === civ2[0] ? id[civ2[1]] : id[civ2[0]] });
        }
    }
    s = await a.state();
    // civ2[0] got 2 votes, civ2[1] got 1
    assert.equal(s.round.result.winner, 'spies');
    assert.equal(s.round.result.reason, 'innocent_out');
});

test('"no spies" vote in a 0-spy round makes the civilians win', async () => {
    const { a, b } = await room({ spy_mode: 'range', spy_min: 0, spy_max: 0 });
    await a.post({ action: 'start' });
    const s = await a.state();
    const id = ids(s);
    await b.post({ action: 'vote_call' });
    for (const n of ['Anna', 'Bea']) await a.post({ action: 'vote', player_id: id[n], target: 0 });
    await b.post({ action: 'vote', player_id: id.Carlo, target: 0 });
    const end = await a.state();
    assert.equal(end.round.result.winner, 'civilians');
    assert.equal(end.round.result.reason, 'no_spies_right');
});

test('spy guess: civilians are told privately, wrong guess eliminates, right guess wins', async () => {
    const { a, b, code } = await room({ spies: 1, scores: true });
    await a.post({ action: 'start' });
    const s = await a.state();
    const id = ids(s);
    const t = truth(code);
    const spy = t.find((x) => x.is_spy).name;
    const civ = t.find((x) => !x.is_spy).name;
    const phoneOf = (n) => (n === 'Carlo' ? b : a);

    const v0 = s.version;
    const r = await phoneOf(civ).post({ action: 'guess', player_id: id[civ], location_id: s.round.pool[0] });
    assert.equal(r.json.not_spy, true);
    assert.equal((await a.state()).version, v0, 'a civilian pressing guess changes nothing');

    const real = site.db('SELECT location_id FROM spia_rounds WHERE id = (SELECT round_id FROM spia_rooms WHERE code = ?)', [code])[0].location_id;
    await phoneOf(spy).post({ action: 'guess', player_id: id[spy], location_id: real });
    const end = await a.state();
    assert.equal(end.round.result.winner, 'spies');
    assert.equal(end.round.result.reason, 'guess_right');
    assert.equal(end.players.find((p) => p.name === spy).score, 3);
});

test('late joiner is dealt in immediately', async () => {
    const { a, b } = await room({ spies: 1 });
    await a.post({ action: 'start' });
    await b.add('Dario');
    const sb = await b.state();
    const dario = sb.cards.find((c) => c.player_id === ids(sb).Dario);
    assert.ok(dario, 'Dario has a card');
    assert.equal(dario.spy, false, 'fixed count: late joiners are civilians');
});

test('offline phone: its players can be taken over; host fails over', async () => {
    const { a, b, code } = await room();
    // A cannot take over B while B is online
    const devB = (await b.state()).device_id;
    assert.equal((await a.post({ action: 'take', device_id: devB })).status, 409);

    site.db('UPDATE spia_devices SET last_seen = last_seen - 100 WHERE id = ?', [devB]);
    await a.post({ action: 'take', device_id: devB });
    let s = await a.state();
    assert.equal(s.players.find((p) => p.name === 'Carlo').device_id, s.device_id);

    // host A goes silent -> B becomes host on its next poll
    site.db('UPDATE spia_devices SET last_seen = last_seen - 100 WHERE id = ? AND room_id = ?', [s.device_id, roomId(code)]);
    s = await b.state();
    assert.equal(s.is_host, true);
});

test('admin: fake civilian card when spy, hidden everywhere else', async () => {
    const admin = await makeAdmin(site, 'spia_admin');
    const a = new Phone(admin);
    const code = await a.create(['Boss'], { spies: 4 }); // 4 spies capped to players => everyone is a spy
    const b = await Phone.fresh();
    await b.join(code);
    await b.add('Uno'); await b.add('Due');
    await a.post({ action: 'start' });

    const sa = await a.state();
    const boss = sa.cards[0];
    assert.equal(boss.spy, false, 'admin spy card looks like a civilian one');
    assert.equal(boss.x, 1);
    assert.ok(Number.isInteger(boss.role) && boss.location_id);

    const sb = await b.state();
    assert.ok(sb.cards.every((c) => c.spy === true && c.x === undefined));
    assert.ok(!JSON.stringify(sb).includes('"x"'), 'nothing about the admin reaches other phones');
    assert.ok(!JSON.stringify(sb).includes('owner'));

    // LIVE and the admin script: admins only, a plain "unknown action" for everyone else
    const live = (await admin.get('/api/spia.php?action=live')).json;
    const mine = live.rooms.find((r) => r.code === code);
    assert.equal(mine.players.find((p) => p.name === 'Boss').me, true);
    assert.ok(Number.isInteger(mine.players.find((p) => p.name === 'Boss').fake_role));
    for (const url of ['/api/spia.php?action=live', '/api/spia.php?action=ext']) {
        const r = await b.c.get(url);
        assert.equal(r.status, 400);
        assert.equal(r.json.error, 'unknown_action');
    }
    assert.equal((await admin.get('/api/spia.php?action=ext')).headers.get('content-type').split(';')[0], 'application/javascript');
    assert.equal((await b.post({ action: 'me', player_id: ids(sb).Uno })).json.error, 'unknown_action');

    // Boss's players moved to a non-admin phone: it shows a normal spy card
    site.db('UPDATE spia_devices SET last_seen = last_seen - 100 WHERE id = ?', [sa.device_id]);
    await b.post({ action: 'take', device_id: sa.device_id });
    const moved = (await b.state()).cards.find((c) => c.player_id === ids(sa).Boss);
    assert.equal(moved.spy, true);
    assert.equal(moved.x, undefined);
});

test('admin spy fake role never collides with a civilian role', async () => {
    const admin = await makeAdmin(site, 'spia_admin2');
    const a = new Phone(admin);
    const code = await a.create(['Boss', 'P1', 'P2', 'P3'], { spies: 1 });
    for (let i = 0; i < 30; i++) {
        await a.post({ action: 'start' });
        const t = truth(code);
        const boss = t.find((x) => x.name === 'Boss');
        if (boss.is_spy) {
            const civ = t.filter((x) => !x.is_spy).map((x) => x.role);
            assert.ok(!civ.includes(boss.fake_role), 'fake role is unused');
        } else {
            assert.equal(boss.fake_role, null);
        }
        await a.post({ action: 'end' });
    }
});

test('names are validated and unique per room; leaving the last phone deletes the room', async () => {
    const p = await Phone.fresh();
    const code = await p.create(['Zed']);
    assert.equal((await p.add('zed')).json.error, 'name_taken');
    assert.equal((await p.add('   ')).json.error, 'name_empty');
    assert.equal((await p.join('QQQQ')).status, 404);
    await p.post({ action: 'leave' });
    assert.equal(site.db('SELECT COUNT(*) AS n FROM spia_rooms WHERE code = ?', [code])[0].n, 0);
});

test('family mode never deals adults-only locations or tagged roles; default mode does', async () => {
    const data = require('../public/assets/spia/locations.json');
    const byId = Object.fromEntries(data.locations.map((l) => [l.id, l]));
    const isTagged = (loc, role) => !!(byId[loc].roles[role] || {}).adult;
    const play = async (settings, rounds) => {
        const { a, code } = await room({ ...settings, spies: 0, no_repeat: false });
        await a.add('Dario'); await a.add('Elena'); await a.add('Fabio'); await a.add('Gino'); await a.add('Ivo');
        const seen = { adultLoc: 0, taggedRole: 0 };
        for (let i = 0; i < rounds; i++) {
            await a.post({ action: 'start' });
            const loc = site.db('SELECT location_id FROM spia_rounds WHERE id = (SELECT round_id FROM spia_rooms WHERE code = ?)', [code])[0].location_id;
            if (byId[loc].cat === 'adult') seen.adultLoc++;
            for (const t of truth(code)) if (t.role !== null && isTagged(loc, t.role)) seen.taggedRole++;
            await a.post({ action: 'end' });
        }
        return seen;
    };
    const family = await play({ family: true }, 60);
    assert.deepEqual(family, { adultLoc: 0, taggedRole: 0 });

    const normal = await play({ family: false }, 60);
    assert.ok(normal.adultLoc > 0, 'adults-only locations are in the default rotation');
    // tagged roles are spread over few locations: just check they are reachable when only those packs are on
    const tagged = await play({ family: false, packs: ['city', 'travel'] }, 60);
    assert.ok(tagged.taggedRole > 0, 'tagged roles are dealt when family mode is off');
});
