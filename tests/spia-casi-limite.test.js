// tests/spia-casi-limite.test.js — edge cases of the party-game rooms (Chi è la spia / Lupus / Cucù): equal names, odd names,
// two phones at once, people leaving at the worst moment
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client } = require('./helpers');

let site;
class Phone {
    constructor(client) { this.c = client; this.token = null; }
    static async fresh() { return new Phone(await new Client(site).init()); }
    headers() { return this.token ? { 'X-Spia-Device': this.token } : {}; }
    async post(body) { const r = await this.c.post('/api/spia.php', body, { headers: this.headers() }); if (r.json && r.json.token) this.token = r.json.token; return r; }
    async state() { return (await this.c.get('/api/spia.php?action=state', { headers: this.headers() })).json; }
    async create(players = [], settings = {}, game = 'spia') {
        try { site.db('DELETE FROM rate_limits'); } catch (e) { /* no DB yet */ }
        return (await this.post({ action: 'create', players, settings, game })).json.code;
    }
    join(code) { return this.post({ action: 'join', code }); }
    add(name) { return this.post({ action: 'player_add', name }); }
}
const names = (s) => s.players.map((p) => p.name);
const truth = (code) => site.db(`SELECT p.name, a.is_spy, a.out_reason FROM spia_assign a JOIN spia_players p ON p.id = a.player_id JOIN spia_rooms r ON r.round_id = a.round_id WHERE r.code = ? ORDER BY p.id`, [code]);

test.before(async () => { site = await startSite(); });
test.after(() => site.stop());

test('two players with the same name are never allowed, however the name is written', async () => {
    const p = await Phone.fresh();
    const code = await p.create(['Zoë', 'Émile', 'Ana B']);
    const taken = async (n) => assert.equal((await p.add(n)).json.error, 'name_taken', JSON.stringify(n));
    await taken('zoë');
    await taken('ZOË');
    await taken('Zoë');            // the same letters written as "e" + combining dots
    await taken('émile');
    await taken('ÉMILE ');
    await taken('Ana  B');               // two spaces
    await taken('ana b');           // non-breaking space
    await taken('Ana​B'.replace('B', ' B'));   // an invisible zero-width space
    await taken('Zoë‍');
    assert.deepEqual(names(await p.state()).sort(), ['Ana B', 'Zoë', 'Émile'].sort());
});

test('a name made only of invisible characters is empty; control characters and very long names are cleaned', async () => {
    const p = await Phone.fresh();
    await p.create(['Base']);
    for (const n of ['​', '​‍', '﻿', ' \t\n ', '‮‬']) assert.equal((await p.add(n)).json.error, 'name_empty', JSON.stringify(n));
    assert.equal((await p.add('Tab\tNewline\nName')).json.success, true);
    assert.equal((await p.add('x'.repeat(200))).json.success, true);
    const s = await p.state();
    assert.ok(names(s).includes('Tab Newline Name'));
    assert.ok(names(s).every((n) => [...n].length <= 24));
    // an invisible right-to-left override must not survive: it would make a name read backwards
    assert.equal((await p.add('Eve‮')).json.success, true);
    assert.ok(names(await p.state()).every((n) => !/[‪-‮⁦-⁩]/.test(n)));
});

test('a list with the same name twice makes no room at all', async () => {
    const p = await Phone.fresh();
    const before = site.db('SELECT COUNT(*) AS n FROM spia_rooms')[0].n;
    const r = await p.post({ action: 'create', players: ['Ugo', 'ugo'] });
    assert.equal(r.json.error, 'name_taken');
    assert.equal(site.db('SELECT COUNT(*) AS n FROM spia_rooms')[0].n, before, 'no half-made room is left behind');
});

test('two phones adding the same name at the same moment: exactly one gets it', async () => {
    const a = await Phone.fresh();
    const code = await a.create(['Host']);
    const phones = [];
    for (let i = 0; i < 4; i++) { const p = await Phone.fresh(); await p.join(code); phones.push(p); }
    const results = await Promise.all(phones.map((p) => p.add('Gemma')));
    assert.equal(results.filter((r) => r.json.success).length, 1);
    assert.equal(results.filter((r) => r.json.error === 'name_taken').length, 3);
    assert.equal(names(await a.state()).filter((n) => n === 'Gemma').length, 1);
});

test('a name is free again when its player leaves; the same rule holds in Lupus and Cucù rooms', async () => {
    const a = await Phone.fresh();
    await a.create(['Nina', 'Olga']);
    let s = await a.state();
    await a.post({ action: 'player_remove', player_id: s.players.find((p) => p.name === 'Olga').id });
    assert.equal((await a.add('Olga')).json.success, true);
    for (const game of ['lupus', 'cucu']) {
        const g = await Phone.fresh();
        await g.create(['Pia'], {}, game);
        assert.equal((await g.add('PIA')).json.error, 'name_taken', game);
    }
});

test('the same name in two different rooms is fine', async () => {
    const a = await Phone.fresh(); const b = await Phone.fresh();
    await a.create(['Rita']); await b.create(['Rita']);
    assert.deepEqual(names(await a.state()), ['Rita']);
    assert.deepEqual(names(await b.state()), ['Rita']);
});

test('the spy leaves in the middle of the round: the round ends instead of going on with no spy', async () => {
    const a = await Phone.fresh();
    const code = await a.create(['Ada', 'Bruno']);
    const b = await Phone.fresh(); await b.join(code); await b.add('Cleo');
    const c = await Phone.fresh(); await c.join(code); await c.add('Dino');
    await a.post({ action: 'start' });
    assert.equal((await a.state()).round.status, 'play');
    const spy = truth(code).find((x) => x.is_spy).name;
    const phoneOf = { Ada: a, Bruno: a, Cleo: b, Dino: c };
    const s0 = await a.state();
    await phoneOf[spy].post({ action: 'player_remove', player_id: s0.players.find((p) => p.name === spy).id });
    const s = await a.state();
    assert.equal(s.round.status, 'ended', 'nobody is left to find');
    assert.equal(s.round.result.winner, 'civilians');
});

test('so many leave that fewer than three are left: the round ends', async () => {
    const a = await Phone.fresh();
    const code = await a.create(['Ada', 'Bruno']);
    const b = await Phone.fresh(); await b.join(code); await b.add('Cleo');
    await a.post({ action: 'start' });
    const s0 = await a.state();
    await b.post({ action: 'leave' });
    const s = await a.state();
    assert.equal(s.round.status, 'ended');
    // and a new round cannot start with two players
    assert.equal((await a.post({ action: 'start' })).json.error, 'need_players');
    assert.equal(names(s).length, 2);
    assert.ok(s0);
});

test('a vote that is open when somebody leaves still closes once the others have voted', async () => {
    const a = await Phone.fresh();
    const code = await a.create(['Ada', 'Bruno']);
    const b = await Phone.fresh(); await b.join(code); await b.add('Cleo');
    const c = await Phone.fresh(); await c.join(code); await c.add('Dino');
    const d = await Phone.fresh(); await d.join(code); await d.add('Elia');
    await a.post({ action: 'start', });
    let s = await a.state();
    await a.post({ action: 'vote_call' });
    const id = Object.fromEntries(s.players.map((p) => [p.name, p.id]));
    await a.post({ action: 'vote', player_id: id.Ada, target: id.Cleo });
    await a.post({ action: 'vote', player_id: id.Bruno, target: id.Cleo });
    await b.post({ action: 'vote', player_id: id.Cleo, target: id.Ada });
    await c.post({ action: 'leave' });       // Dino was the last one who had to vote
    await d.post({ action: 'vote', player_id: id.Elia, target: id.Cleo });
    s = await a.state();
    assert.equal(s.round.vote_open ? 1 : 0, 0, 'the vote is over');
});

test('late voters: a vote for yourself, for a player who left, or twice is refused or counted once', async () => {
    const a = await Phone.fresh();
    const code = await a.create(['Ada', 'Bruno']);
    const b = await Phone.fresh(); await b.join(code); await b.add('Cleo');
    await a.post({ action: 'start' });
    const s = await a.state();
    const id = Object.fromEntries(s.players.map((p) => [p.name, p.id]));
    await a.post({ action: 'vote_call' });
    assert.notEqual((await a.post({ action: 'vote', player_id: id.Ada, target: id.Ada })).json.success, true, 'no vote for yourself');
    assert.notEqual((await a.post({ action: 'vote', player_id: id.Ada, target: 99999 })).json.success, true, 'nobody with that id');
    await a.post({ action: 'vote', player_id: id.Ada, target: id.Bruno });
    await a.post({ action: 'vote', player_id: id.Ada, target: id.Cleo });   // changes her mind
    const votes = site.db('SELECT COUNT(*) AS n FROM spia_votes WHERE voter_id = ?', [id.Ada])[0].n;
    assert.equal(votes, 1, 'one vote per player');
    assert.notEqual((await b.post({ action: 'vote', player_id: id.Ada, target: id.Bruno })).json.success, true, 'not your player');
});
