// tests/cucu.test.js — Cucù rooms with the house rules: hidden lives, knocks, swaps and the King, ties,
// the host (capotavola) deciding lives, talking to the dead, the dealer's recital, the declared admin power
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

/** Start, put P1 as dealer with the given cards, accept the recital and knock twice. */
async function toSwap(r, cards) {
    assert.equal((await r.a.post({ action: 'start' })).status, 200);
    const g = r.game(); g.dealer = r.id.P1; g.order = [r.id.P1, r.id.P2, r.id.P3]; r.setGame(g);
    assert.equal((await r.a.post({ action: 'recite', ok: true })).status, 200);
    const d = r.game();
    d.cards = { [r.id.P1]: cards[0], [r.id.P2]: cards[1], [r.id.P3]: cards[2] };
    d.deck = [['d', 5], ['c', 6], ['s', 7], ['b', 4], ['d', 10]];
    r.setGame(d);
    await r.a.post({ action: 'knock' });
    await r.a.post({ action: 'knock' });
}

test('migration V11 created cucu_games', async () => {
    await fetch(`${site.base}/api/rooms.php`);   // the first request that opens the DB creates it
    assert.ok(site.db('PRAGMA user_version')[0].user_version >= 11);
});

test('lives are never shown to players; only the host sees them while judging the recital', async () => {
    const r = await cucuRoom({ lives: 3 });
    await r.a.post({ action: 'start' });
    const host = (await r.a.state()).cucu, other = (await r.b.state()).cucu;
    assert.equal(host.phase, 'recite');
    assert.equal(host.lives[r.id.P2], 3);
    assert.equal(other.lives, null);
    assert.equal((await r.b.post({ action: 'recite', ok: true })).status, 403, 'only the host judges');
});

test('cards stay hidden until the dealer knocks twice; each phone sees only its own card', async () => {
    const r = await cucuRoom();
    await r.a.post({ action: 'start' });
    const g = r.game(); g.dealer = r.id.P1; r.setGame(g);
    await r.a.post({ action: 'recite', ok: true });
    assert.equal((await r.b.state()).cucu.me[0].card, null);
    assert.equal((await r.b.post({ action: 'knock' })).status, 403, 'only the dealer knocks');
    await r.a.post({ action: 'knock' });
    assert.equal((await r.b.state()).cucu.me[0].card, null);
    await r.a.post({ action: 'knock' });
    const sb = (await r.b.state()).cucu;
    assert.equal(sb.phase, 'swap');
    assert.ok(Array.isArray(sb.me[0].card));
    assert.equal(sb.me.length, 1, 'phone B sees only P2');
    assert.equal(sb.turn, r.id.P2, 'the player after the dealer starts');
});

test('swap with the next player; the King stops it ("Cucù"); dealer swaps with the deck; lowest loses', async () => {
    const r = await cucuRoom();
    await toSwap(r, [['d', 8], ['c', 2], ['s', 10]]);           // P1 dealer: Fante, P2: 2, P3: Re
    // P2 asks P3, who holds the King: blocked
    assert.equal((await r.b.post({ action: 'swap' })).status, 200);
    let g = r.game();
    assert.deepEqual(g.cards[r.id.P2], ['c', 2]);
    assert.equal(g.events.at(-1).t, 'cucu');
    assert.equal(g.turn, r.id.P3);
    assert.equal((await r.b.post({ action: 'keep' })).status, 403, 'not P2 turn any more');
    // P3 keeps; the dealer takes from the deck (top = last: ['d', 10])
    await r.c.post({ action: 'keep' });
    assert.equal((await r.a.post({ action: 'deck' })).status, 200);
    g = r.game();
    assert.equal(g.phase, 'confirm');
    assert.equal(g.reveal.loser, r.id.P2);
    // everybody sees the revealed cards and the proposed loser, but not the lives
    const sc = (await r.c.state()).cucu;
    assert.equal(sc.reveal.loser, r.id.P2);
    assert.equal(sc.lives, null);
    // the host confirms: event on every phone, P2 -1, the deck passes to P2 (next after P1)
    assert.equal((await r.a.post({ action: 'confirm' })).status, 200);
    g = r.game();
    assert.equal(g.lives[r.id.P2], 2);
    assert.equal(g.dealer, r.id.P2);
    assert.equal(g.phase, 'recite');
    const ev = (await r.b.state()).cucu.events;
    assert.ok(ev.some((e) => e.t === 'life' && e.p === r.id.P2 && e.d === -1 && e.why === 'hand'));
});

test('a normal swap exchanges the two cards', async () => {
    const r = await cucuRoom();
    await toSwap(r, [['d', 8], ['c', 2], ['s', 6]]);
    await r.b.post({ action: 'swap' });
    const g = r.game();
    assert.deepEqual(g.cards[r.id.P2], ['s', 6]);
    assert.deepEqual(g.cards[r.id.P3], ['c', 2]);
});

test('ties on the lowest card: the tied players draw again until one is lowest', async () => {
    const r = await cucuRoom();
    await toSwap(r, [['d', 9], ['c', 3], ['s', 3]]);
    const g = r.game(); g.deck = [['d', 5], ['b', 4]]; r.setGame(g);   // P2 draws ['b',4], P3 draws ['d',5]
    await r.b.post({ action: 'keep' });
    await r.c.post({ action: 'keep' });
    await r.a.post({ action: 'keep' });
    const rev = r.game().reveal;
    assert.equal(rev.redraws.length, 1);
    assert.equal(rev.loser, r.id.P2);
});

test('wrong recital: the dealer loses a life and the deck passes on', async () => {
    const r = await cucuRoom();
    await r.a.post({ action: 'start' });
    const g = r.game(); g.dealer = r.id.P1; g.order = [r.id.P1, r.id.P2, r.id.P3]; r.setGame(g);
    await r.a.post({ action: 'recite', ok: false });
    const n = r.game();
    assert.equal(n.lives[r.id.P1], 2);
    assert.equal(n.dealer, r.id.P2);
    assert.equal(n.phase, 'recite');
});

test('talking to the dead: living -1, dead +1 (back in), the dealer may talk; last one alive wins', async () => {
    const r = await cucuRoom({ lives: 1 });
    await r.a.post({ action: 'start' });
    const g = r.game(); g.dealer = r.id.P1; g.lives[r.id.P3] = 0; r.setGame(g);
    assert.equal((await r.a.post({ action: 'talk', player_id: r.id.P1, dead_id: r.id.P3 })).status, 409, 'the dealer may talk to the dead');
    assert.equal((await r.a.post({ action: 'talk', player_id: r.id.P2, dead_id: r.id.P3 })).status, 200);
    let n = r.game();
    assert.equal(n.lives[r.id.P2], 0);
    assert.equal(n.lives[r.id.P3], 1);
    assert.ok(n.events.some((e) => e.t === 'back' && e.p === r.id.P3));
    await r.a.post({ action: 'life', player_id: r.id.P3, delta: -1 });
    n = r.game();
    assert.equal(n.status, 'ended');
    assert.equal(n.result.winner, r.id.P1);
    assert.equal((await r.c.state()).cucu.lives[r.id.P1], 1, 'lives are shown once it is over');
});

test('admin power: only when declared in the settings, only the site admin, announced to everyone', async () => {
    const adminClient = await makeAdmin(site, 'cucu_admin');
    const r = await cucuRoom({ admin_power: true }, adminClient);
    await toSwap(r, [['d', 8], ['c', 2], ['s', 6]]);
    assert.equal((await r.b.post({ action: 'admin_power', player_id: r.id.P2 })).status, 409, 'not a site admin');
    assert.equal((await r.a.post({ action: 'admin_power', player_id: r.id.P1 })).status, 200);
    const g = r.game();
    assert.ok(g.cards[r.id.P1][1] > 2, 'a card above the lowest of the others');
    assert.ok((await r.c.state()).cucu.events.some((e) => e.t === 'admin_power' && e.p === r.id.P1));
    assert.equal((await r.a.post({ action: 'admin_power', player_id: r.id.P1 })).status, 409, 'once per hand');

    const plain = await cucuRoom({}, adminClient);
    await toSwap(plain, [['d', 8], ['c', 2], ['s', 6]]);
    assert.equal((await plain.a.post({ action: 'admin_power', player_id: plain.id.P1 })).status, 409, 'off unless declared');
});
