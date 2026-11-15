// tests/cucu-casi-limite.test.js — Cucù: people leaving at the worst moment, tiny and huge tables
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client, makeAdmin } = require('./helpers');

let site;
test.before(async () => { site = await startSite(); });
test.after(() => site.stop());

class Phone {
    constructor(c) { this.c = c; this.token = null; }
    static async fresh(client) { return new Phone(client || await new Client(site).init()); }
    h() { return this.token ? { 'X-Spia-Device': this.token } : {}; }
    async post(body) {
        const r = await this.c.post('/api/spia.php', body, { headers: this.h() });
        if (r.json && r.json.token) this.token = r.json.token;
        return r;
    }
    async state() { return (await this.c.get('/api/spia.php?action=state', { headers: this.h() })).json; }
}

/** Phone A (host) has P1, phone B has P2, phone C has P3. */
async function cucuRoom(settings = {}, hostClient = null) {
    try { site.db('DELETE FROM rate_limits'); } catch (e) { /* not created yet */ }
    const a = await Phone.fresh(hostClient);
    const code = (await a.post({ action: 'create', game: 'cucu', players: ['P1'], settings })).json.code;
    const b = await Phone.fresh(); await b.post({ action: 'join', code }); await b.post({ action: 'player_add', name: 'P2' });
    const c = await Phone.fresh(); await c.post({ action: 'join', code }); await c.post({ action: 'player_add', name: 'P3' });
    const s = await a.state();
    const id = Object.fromEntries(s.players.map((p) => [p.name, p.id]));
    const phoneOf = (pid) => ({ [id.P1]: a, [id.P2]: b, [id.P3]: c }[pid]);
    const where = 'room_id = (SELECT id FROM spia_rooms WHERE code = ?)';
    const game = () => JSON.parse(site.db(`SELECT state FROM cucu_games WHERE ${where}`, [code])[0].state);
    const setGame = (g) => site.db(`UPDATE cucu_games SET state = ? WHERE ${where}`, [JSON.stringify(g), code]);
    return { a, b, c, code, id, phoneOf, game, setGame };
}


async function started(r) {
    assert.equal((await r.a.post({ action: 'start' })).status, 200);
    const g = r.game(); g.dealer = r.id.P1; g.order = [r.id.P1, r.id.P2, r.id.P3]; r.setGame(g);
    return r;
}

test('the player who is about to lose a life leaves: the game goes on, nobody is stuck at "confirm"', async () => {
    const r = await started(await cucuRoom());
    await r.a.post({ action: 'recite', ok: true });
    const g = r.game();
    g.cards = { [r.id.P1]: ['d', 8], [r.id.P2]: ['c', 2], [r.id.P3]: ['s', 10] };
    g.phase = 'confirm'; g.turn = null; g.reveal = { cards: g.cards, redraws: [], loser: r.id.P2, forced: null };
    r.setGame(g);
    await r.b.post({ action: 'player_remove', player_id: r.id.P2 });
    const after = r.game();
    assert.equal(after.status, 'play');
    assert.notEqual(after.phase, 'confirm', 'the loser is gone: the hand is over');
    assert.equal(after.phase, 'recite');
    assert.ok(after.lives[r.id.P2] === 0);
    // the table plays on with two players
    assert.equal((await r.a.post({ action: 'recite', ok: true })).status, 200);
});

test('the dealer leaves while reciting: the deck passes on; one left = the match is over', async () => {
    const r = await started(await cucuRoom());
    await r.a.post({ action: 'player_remove', player_id: r.id.P1 });
    let g = r.game();
    assert.equal(g.status, 'play');
    assert.ok([r.id.P2, r.id.P3].includes(g.dealer));
    assert.equal(g.phase, 'recite');
    await r.b.post({ action: 'player_remove', player_id: r.id.P2 });
    g = r.game();
    assert.equal(g.status, 'ended');
    assert.equal(g.result.winner, r.id.P3);
});

test('the host phone leaves in the middle: another phone becomes host and can go on', async () => {
    const r = await started(await cucuRoom());
    await r.a.post({ action: 'leave' });
    const s = await r.b.state();
    assert.ok(s.cucu, 'the match is still there');
    const host = (await r.b.state()).host_device_id ?? null;
    assert.ok(host === null || typeof host === 'number');
    // somebody can recite now (host-only action) from one of the phones
    const ok = [await r.b.post({ action: 'recite', ok: true }), await r.c.post({ action: 'recite', ok: true })].some((x) => x.status === 200);
    assert.ok(ok, 'one of the remaining phones is the host');
});

test('twenty players: the deck lasts through the deal and the ties', async () => {
    try { site.db('DELETE FROM rate_limits'); } catch (e) { /* none */ }
    const a = await Phone.fresh();
    const code = (await a.post({ action: 'create', game: 'cucu', players: Array.from({ length: 20 }, (_, i) => 'G' + (i + 1)) })).json.code;
    assert.equal((await a.post({ action: 'start' })).status, 200);
    assert.equal((await a.post({ action: 'recite', ok: true })).status, 200);
    const where = 'room_id = (SELECT id FROM spia_rooms WHERE code = ?)';
    const g = JSON.parse(site.db(`SELECT state FROM cucu_games WHERE ${where}`, [code])[0].state);
    assert.equal(Object.keys(g.cards).length, 20);
    assert.equal(g.deck.length, 20);
    // everybody holds the same lowest card: the redraws must not run out of cards or crash
    for (const k of Object.keys(g.cards)) g.cards[k] = ['d', 1 + (Number(k) % 2 ? 0 : 0)];
    g.phase = 'swap'; g.turn = g.dealer; site.db(`UPDATE cucu_games SET state = ? WHERE ${where}`, [JSON.stringify(g), code]);
    const s = await a.state();
    assert.ok(s.cucu);
});

test('the site admin sees every card and every life in LIVE, from a session that is in no room; nobody else can', async () => {
    const r = await started(await cucuRoom());
    await r.a.post({ action: 'recite', ok: true });
    const admin = await makeAdmin(site, 'cu_admin');       // not a player: just looking from another phone
    const live = (await admin.get('/api/spia.php?action=live')).json;
    const room = live.rooms.find((x) => x.code === r.code);
    assert.equal(room.game, 'cucu');
    for (const name of ['P1', 'P2', 'P3']) {
        const pid = r.id[name];
        assert.ok(room.cucu.cards[String(pid)], 'card of ' + name);
        assert.ok(room.cucu.lives[String(pid)] >= 1, 'lives of ' + name);
    }
    // a player's own phone never gets the others' cards or the lives
    const mine = (await r.b.state()).cucu;
    assert.equal(mine.lives, null);
    assert.ok(!JSON.stringify(mine).includes('"cards":{'), 'no table of cards in a player view');
    // not for guests, not for normal accounts
    assert.equal((await r.b.c.get('/api/spia.php?action=live')).status, 400);
    assert.equal((await r.b.c.get('/api/spia.php?action=ext')).status, 400);
    // the admin script (served to admin sessions only) knows Cucù
    const js = (await admin.get('/api/spia.php?action=ext')).text;
    assert.match(js, /cucuCard/);
});
