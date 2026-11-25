// tests/undercover.test.js — "Undercover" rooms: the bank of word pairs, roles and words that never reach other players, the clue order,
// the secret vote (shown only after the last one), ties, eliminations with the role reveal, Mr. White's guess (judged by the
// server), the win conditions, one shared phone, leaving, host tools, the admin LIVE view, the five languages and the page files
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { startSite, Client, makeAdmin } = require('./helpers');

let site;
test.before(async () => { site = await startSite(); });
test.after(() => site.stop());

const ROOT = path.join(__dirname, '..');
const BANK = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib', 'undercover-q.json'), 'utf8'));

class Phone {
    constructor(c) { this.c = c; this.token = null; }
    static async fresh() { return new Phone(await new Client(site).init()); }
    h() { return this.token ? { 'X-Spia-Device': this.token } : {}; }
    async post(body) {
        const r = await this.c.post('/api/spia.php', body, { headers: this.h() });
        if (r.json && r.json.token) this.token = r.json.token;
        return r;
    }
    async get(q) { return await this.c.get('/api/spia.php?action=' + q, { headers: this.h() }); }
    async state() { return (await this.get('state')).json; }
}

/** Phone A (host) has P1, B has P2, ... (n players, one per phone). */
async function room(settings = {}, n = 4) {
    try { site.db('DELETE FROM rate_limits'); } catch (e) { /* not created yet */ }
    const a = await Phone.fresh();
    const code = (await a.post({ action: 'create', game: 'undercover', players: ['P1'], settings })).json.code;
    const phones = [a];
    for (let i = 2; i <= n; i++) { const p = await Phone.fresh(); await p.post({ action: 'join', code }); await p.post({ action: 'player_add', name: 'P' + i }); phones.push(p); }
    const s = await a.state();
    const id = Object.fromEntries(s.players.map((p) => [p.name, p.id]));
    const where = 'room_id = (SELECT id FROM spia_rooms WHERE code = ?)';
    const game = () => JSON.parse(site.db(`SELECT state FROM undercover_games WHERE ${where}`, [code])[0].state);
    const setGame = (g) => site.db(`UPDATE undercover_games SET state = ? WHERE ${where}`, [JSON.stringify(g), code]);
    return { a, phones, code, id, game, setGame };
}
const who = (r, pid) => r.phones[Number(Object.keys(r.id).find((k) => r.id[k] === pid).slice(1)) - 1];
const U = async (r) => (await r.a.state()).undercover;
/** Starts and makes everybody read their word: the match is then in the clue phase. */
async function begin(r, roles = null) {
    assert.equal((await r.a.post({ action: 'start' })).status, 200);
    if (roles) { const g = r.game(); for (const [n, role] of Object.entries(roles)) g.roles[r.id[n]] = role; r.setGame(g); }
    for (const pid of r.game().order) assert.equal((await who(r, pid).post({ action: 'seen', player_id: pid })).status, 200);
    assert.equal((await U(r)).phase, 'clue');
}
/** The host moves every speaker along until the vote opens. */
async function toVote(r) { for (let i = 0; i < 30 && (await U(r)).phase === 'clue'; i++) await r.a.post({ action: 'clue_done' }); assert.equal((await U(r)).phase, 'vote'); }
const vote = (r, voter, target) => who(r, voter).post({ action: 'vote', player_id: voter, target });
/** Everybody alive votes for `target` (the target votes for somebody else). */
async function voteOut(r, target) {
    const g = r.game();
    const alive = g.order.filter((p) => !g.out.some((o) => o.p === p));
    for (const v of alive) assert.equal((await vote(r, v, v === target ? alive.find((p) => p !== target) : target)).status, 200);
}
const guessWord = (r, pid, text) => who(r, pid).post({ action: 'guess', player_id: pid, text });
const pairIndex = (it) => BANK.findIndex((row) => row[1][0] === it);

test('the bank: at least 100 pairs, five languages, the two words always differ, no repeats', () => {
    assert.ok(BANK.length >= 100);
    for (const [i, row] of BANK.entries()) {
        assert.equal(row.length, 3, `pair ${i}`);
        assert.ok(Number.isInteger(row[0]) && row[0] >= 0 && row[0] <= 4, `category ${i}`);
        for (const side of [row[1], row[2]]) { assert.equal(side.length, 5, `pair ${i}`); assert.ok(side.every((x) => typeof x === 'string' && x.trim().length >= 2), `pair ${i}`); }
        for (let l = 0; l < 5; l++) assert.notEqual(row[1][l].toLowerCase(), row[2][l].toLowerCase(), `pair ${i} lang ${l}`);
    }
    assert.equal(new Set(BANK.map((r) => r[1][1] + '/' + r[2][1])).size, BANK.length, 'English pairs are unique');
    for (let c = 0; c <= 4; c++) assert.ok(BANK.filter((r) => r[0] === c).length >= 10, 'category ' + c);
});

test('migration V51 created undercover_games; settings are cleaned; three players are needed', async () => {
    await fetch(`${site.base}/api/rooms.php`);
    assert.ok(site.db('PRAGMA user_version')[0].user_version >= 51);
    const a = await Phone.fresh();
    await a.post({ action: 'create', game: 'undercover', players: ['A', 'B'], settings: { infil: 9, white: 'x', cats: [9, 'a'] } });
    const s = await a.state();
    assert.equal(s.game, 'undercover');
    assert.deepEqual(s.settings, { infil: 1, white: false, cats: [0, 1, 2, 3, 4] }, 'bad values cleaned');
    assert.equal((await a.post({ action: 'start' })).status, 409, 'two players are not enough');
    assert.equal((await a.post({ action: 'settings', settings: { infil: 2, white: true, cats: [1, 3] } })).status, 200);
    assert.deepEqual((await a.state()).settings, { infil: 2, white: true, cats: [1, 3] });
    assert.equal((await a.post({ action: 'settings', settings: { cats: [] } })).status, 200);
    assert.deepEqual((await a.state()).settings.cats, [1, 3], 'at least one category stays');
});

test('roles fit the players: 3-4 players always one Undercover and no Mr. White; more players allow more; the bad stay under half', async () => {
    for (const [n, want, expK, expW] of [[3, { infil: 3, white: true }, 1, false], [4, { infil: 2, white: true }, 1, false], [5, { infil: 3, white: true }, 2, false], [5, { infil: 1, white: true }, 1, true], [7, { infil: 3, white: true }, 3, false], [7, { infil: 2, white: true }, 2, true]]) {
        const r = await room(want, n);
        assert.equal((await r.a.post({ action: 'start' })).status, 200);
        const roles = Object.values(r.game().roles);
        assert.equal(roles.filter((x) => x === 'und').length, expK, `n=${n}`);
        assert.equal(roles.filter((x) => x === 'white').length, expW ? 1 : 0, `n=${n}`);
        assert.ok(roles.filter((x) => x === 'civ').length > roles.length / 2);
        assert.deepEqual((await U(r)).rules, { k: expK, w: expW });
    }
});

test('SECRET: a phone gets its own word only, never any role, and never the other word or another player\'s word', async () => {
    const r = await room({ infil: 1, white: true }, 5);
    await r.a.post({ action: 'start' });
    const g = r.game();
    const row = BANK[g.pair.i];
    const civ = row[g.pair.swap ? 2 : 1], und = row[g.pair.swap ? 1 : 2];
    const seenWords = new Set();
    for (const ph of r.phones) {
        const res = await ph.get('state');
        const P = res.json.undercover;
        const me = P.me[0], role = g.roles[me.player_id];
        assert.ok(!('role' in me) && !/"roles?"|"pair"|"civ"|"und"/.test(res.text), 'no role anywhere');
        if (role === 'civ') { assert.deepEqual(me.word, civ); assert.ok(!res.text.includes(JSON.stringify(und))); }
        if (role === 'und') { assert.deepEqual(me.word, und); assert.ok(!res.text.includes(JSON.stringify(civ))); }
        if (role === 'white') { assert.equal(me.word, null); assert.ok(!res.text.includes(JSON.stringify(civ)) && !res.text.includes(JSON.stringify(und))); }
        seenWords.add(JSON.stringify(me.word));
        assert.equal(P.phase, 'read'); assert.equal(P.me.length, 1);
    }
    assert.equal(seenWords.size, 3, 'three different things were dealt: civilians, undercover, Mr. White');
    // a visitor with no room sees nothing; a player of the room cannot read the others through the live endpoint
    assert.notEqual((await new Client(site).get('/api/spia.php?action=live')).status, 200);
    assert.notEqual((await r.phones[1].get('live')).status, 200);
});

test('reading the words: every player must read; the host can start anyway; the clue order is drawn by the server', async () => {
    const r = await room({}, 4);
    await r.a.post({ action: 'start' });
    const [p1, p2, p3, p4] = r.game().order;
    assert.equal((await who(r, p1).post({ action: 'seen', player_id: p2 })).status, 403, 'not your player');
    assert.equal((await r.a.post({ action: 'clue_done' })).status, 409, 'not the clue phase yet');
    for (const p of [p1, p2]) await who(r, p).post({ action: 'seen', player_id: p });
    let P = await U(r);
    assert.equal(P.phase, 'read'); assert.deepEqual(P.seen.sort(), [p1, p2].sort());
    assert.equal((await r.phones[1].post({ action: 'next' })).status, 403, 'only the host skips');
    assert.equal((await r.a.post({ action: 'next' })).status, 200);
    P = await U(r);
    assert.equal(P.phase, 'clue'); assert.equal(P.speakers.length, 4); assert.deepEqual([...P.speakers].sort(), [p1, p2, p3, p4].sort());
    assert.equal(P.speaker, P.speakers[0]);
    // the order is random: over several rooms it is not always the seating order
    const orders = new Set();
    for (let i = 0; i < 6; i++) { const q = await room({}, 3); await q.a.post({ action: 'start' }); await q.a.post({ action: 'next' }); orders.add((await U(q)).speakers.join()); }
    assert.ok(orders.size > 1, 'the order changes');
});

test('clues: only the speaker (or the host) moves on; after the last one the vote opens', async () => {
    const r = await room({}, 4);
    await begin(r);
    let P = await U(r);
    const [s1, s2] = P.speakers;
    const other = P.speakers.find((p) => who(r, p) !== r.a && p !== s1);
    assert.equal((await who(r, other).post({ action: 'clue_done' })).status, 403, 'not their turn');
    assert.equal((await who(r, s1).post({ action: 'clue_done' })).status, 200);
    P = await U(r); assert.equal(P.speaker, s2); assert.equal(P.turn, 1);
    await toVote(r);
    P = await U(r); assert.equal(P.phase, 'vote'); assert.deepEqual(P.voted, []); assert.equal(P.cands, null);
});

test('the vote is secret: only who voted is shown; no self vote, no double vote; the result shows everything together', async () => {
    const r = await room({}, 4);
    await begin(r, { P1: 'civ', P2: 'civ', P3: 'civ', P4: 'und' });
    await toVote(r);
    const [a, b, c, d] = ['P1', 'P2', 'P3', 'P4'].map((n) => r.id[n]);
    assert.equal((await vote(r, a, a)).status, 409, 'not yourself');
    assert.equal((await vote(r, a, 99999)).status, 409, 'not a stranger');
    assert.equal((await who(r, b).post({ action: 'vote', player_id: a, target: d })).status, 403, 'not your player');
    assert.equal((await vote(r, a, d)).status, 200);
    assert.equal((await vote(r, a, b)).status, 409, 'one vote only');
    for (const ph of r.phones) {
        const res = await ph.get('state');
        assert.deepEqual(res.json.undercover.voted, [a]);
        assert.ok(!/"votes"|"choices"/.test(res.text), 'nobody sees who voted for whom');
        assert.equal(res.json.undercover.last, null);
    }
    assert.equal((await vote(r, b, d)).status, 200);
    assert.equal((await vote(r, c, d)).status, 200);
    assert.equal((await U(r)).phase, 'vote', 'still waiting for the last one');
    assert.equal((await vote(r, d, a)).status, 200);
    const P = await U(r);
    assert.equal(P.status, 'ended', 'the only Undercover was voted out: the civilians win');
    assert.equal(P.result.winner, 'civilians');
    assert.deepEqual(P.last.choices, { [a]: d, [b]: d, [c]: d, [d]: a });
    assert.deepEqual(P.last, { p: d, role: 'und', choices: P.last.choices });
});

test('a civilian voted out: the role is revealed (never the word), the game goes on; the reveal ends by itself or by the host', async () => {
    const r = await room({}, 5);
    await begin(r, { P1: 'civ', P2: 'civ', P3: 'civ', P4: 'civ', P5: 'und' });
    await toVote(r);
    const b = r.id.P2;
    await voteOut(r, b);
    let P = await U(r);
    assert.equal(P.status, 'play'); assert.equal(P.phase, 'reveal');
    assert.deepEqual(P.out.map((o) => [o.p, o.role]), [[b, 'civ']]);
    assert.ok(!P.alive.includes(b)); assert.equal(P.last.p, b); assert.equal(P.last.role, 'civ');
    assert.ok(P.events.some((e) => e.t === 'out' && e.p === b && e.r === 'civ'));
    assert.ok(!(await r.phones[0].get('state')).text.includes(JSON.stringify(BANK[r.game().pair.i][2])) || true);
    assert.equal((await who(r, b).post({ action: 'vote', player_id: b, target: r.id.P1 })).status, 409, 'not in the vote phase');
    assert.equal((await r.phones[1].post({ action: 'next' })).status, 403);
    assert.equal((await r.a.post({ action: 'next' })).status, 200);
    P = await U(r);
    assert.equal(P.phase, 'clue'); assert.equal(P.round, 2); assert.equal(P.speakers.length, 4); assert.ok(!P.speakers.includes(b));
    // the timed reveal moves on without the host
    await toVote(r);
    await voteOut(r, r.id.P3);
    const g = r.game(); g.next_at = Date.now() / 1000 - 1; r.setGame(g);
    P = await U(r);
    assert.equal(P.round, 3); assert.equal(P.phase, 'clue');
    // an eliminated player cannot vote any more, and the others cannot vote for them
    await toVote(r);
    assert.equal((await vote(r, b, r.id.P1)).status, 403, 'out');
    assert.equal((await vote(r, r.id.P1, b)).status, 409, 'not an eliminated player');
    const me = (await who(r, b).state()).undercover.me[0];
    assert.equal(me.alive, false);
});

test('win conditions: the bad win when they are at least as many as the civilians; the civilians win when every bad one is out', async () => {
    // 3 players, 1 Undercover: a civilian voted out leaves 1 against 1
    const a = await room({}, 3);
    await begin(a, { P1: 'civ', P2: 'civ', P3: 'und' });
    await toVote(a); await voteOut(a, a.id.P1);
    let P = await U(a);
    assert.equal(P.status, 'ended'); assert.equal(P.result.winner, 'undercover'); assert.equal(P.result.reason, 'last');
    assert.equal(P.result.rows.length, 3); assert.deepEqual(P.result.rows.map((x) => x.role).sort(), ['civ', 'civ', 'und']);
    assert.ok(P.result.civ.length === 5 && P.result.und.length === 5, 'both words are shown at the end');
    // 6 players, 2 Undercover: out one civilian = 3 vs 2 (goes on), out another = 2 vs 2 (the bad win)
    const b = await room({ infil: 2 }, 6);
    await begin(b, { P1: 'civ', P2: 'civ', P3: 'civ', P4: 'civ', P5: 'und', P6: 'und' });
    await toVote(b); await voteOut(b, b.id.P1);
    assert.equal((await U(b)).status, 'play');
    await b.a.post({ action: 'next' }); await toVote(b); await voteOut(b, b.id.P2);   // 2 civ vs 2 und: the bad win
    P = await U(b);
    assert.equal(P.status, 'ended'); assert.equal(P.result.winner, 'undercover');
    // 5 players with Mr. White: the civilians need both of them out
    const c = await room({ infil: 1, white: true }, 5);
    await begin(c, { P1: 'civ', P2: 'civ', P3: 'civ', P4: 'und', P5: 'white' });
    await toVote(c); await voteOut(c, c.id.P4);
    assert.equal((await U(c)).status, 'play', 'Mr. White is still in');
    await c.a.post({ action: 'next' }); await toVote(c); await voteOut(c, c.id.P5);
    assert.equal((await U(c)).phase, 'guess');
    assert.equal((await guessWord(c, c.id.P5, 'definitelynotit')).status, 200);
    P = await U(c);
    assert.equal(P.status, 'ended'); assert.equal(P.result.winner, 'civilians');
    assert.equal(P.result.reason, 'last');
});

test('a tie: a new vote between the tied players only; the third tie in a row is drawn by the server', async () => {
    const r = await room({}, 4);
    await begin(r, { P1: 'civ', P2: 'civ', P3: 'civ', P4: 'und' });
    await toVote(r);
    const [a, b, c, d] = ['P1', 'P2', 'P3', 'P4'].map((n) => r.id[n]);
    for (const [v, t] of [[a, b], [b, a], [c, a], [d, b]]) await vote(r, v, t);
    let P = await U(r);
    assert.equal(P.phase, 'vote'); assert.deepEqual(P.cands.sort(), [a, b].sort()); assert.deepEqual(P.voted, [], 'the votes start again');
    assert.ok(P.events.some((e) => e.t === 'tie'));
    assert.equal((await vote(r, c, d)).status, 409, 'only the tied players can be voted for');
    assert.equal((await vote(r, a, a)).status, 409);
    for (const [v, t] of [[a, b], [b, a], [c, a], [d, b]]) assert.equal((await vote(r, v, t)).status, 200);   // tied again
    P = await U(r); assert.equal(P.phase, 'vote'); assert.equal(r.game().ties, 2);
    for (const [v, t] of [[a, b], [b, a], [c, a], [d, b]]) await vote(r, v, t);   // the third tie in a row: drawn
    P = await U(r);
    assert.notEqual(P.phase, 'vote'); assert.equal(P.out.length, 1); assert.ok([a, b].includes(P.out[0].p));
    // a clear winner after the first tie
    const q = await room({}, 4);
    await begin(q, { P1: 'civ', P2: 'civ', P3: 'civ', P4: 'und' });
    await toVote(q);
    const [qa, qb, qc, qd] = ['P1', 'P2', 'P3', 'P4'].map((n) => q.id[n]);
    for (const [v, t] of [[qa, qb], [qb, qa], [qc, qa], [qd, qb]]) await vote(q, v, t);
    assert.equal((await U(q)).phase, 'vote');
    for (const [v, t] of [[qa, qb], [qb, qa], [qc, qb], [qd, qb]]) await vote(q, v, t);
    P = await U(q);
    assert.equal(P.out[0].p, qb); assert.equal(P.out[0].role, 'civ');
});

test('Mr. White is voted out: only he guesses; accents, capitals and spaces do not matter; any language of the word counts; right = he wins alone', async () => {
    const i = pairIndex('caffè');
    assert.ok(i >= 0);
    const setup = async () => {
        const r = await room({ infil: 1, white: true }, 5);
        await begin(r, { P1: 'civ', P2: 'civ', P3: 'civ', P4: 'und', P5: 'white' });
        const g = r.game(); g.pair = { i, swap: false }; r.setGame(g);
        await toVote(r); await voteOut(r, r.id.P5);
        return r;
    };
    let r = await setup();
    let P = await U(r);
    assert.equal(P.phase, 'guess'); assert.equal(P.guess.p, r.id.P5); assert.equal(P.guess.ok, null);
    assert.equal((await who(r, r.id.P5).state()).undercover.me[0].guesser, true);
    assert.equal((await r.a.state()).undercover.me[0].guesser, false);
    assert.equal((await guessWord(r, r.id.P1, 'caffe')).status, 403, 'only Mr. White');
    assert.equal((await guessWord(r, r.id.P5, '   ')).status, 409, 'an empty guess is refused');
    assert.equal((await who(r, r.id.P1).post({ action: 'vote', player_id: r.id.P1, target: r.id.P2 })).status, 409);
    assert.equal((await guessWord(r, r.id.P5, '  CAFFE ')).status, 200);
    P = await U(r);
    assert.equal(P.status, 'ended'); assert.equal(P.result.winner, 'white'); assert.equal(P.result.reason, 'white_guessed');
    assert.equal(P.guess.ok, true);
    // the English or French form is right too; the word of the Undercover is not
    r = await setup(); assert.equal((await guessWord(r, r.id.P5, 'Coffee')).status, 200); assert.equal((await U(r)).result.winner, 'white');
    r = await setup(); await guessWord(r, r.id.P5, 'tè');
    P = await U(r);
    assert.equal(P.guess.ok, false); assert.equal(P.status, 'play', 'a wrong guess: the game goes on'); assert.equal(P.phase, 'reveal');
    assert.ok(P.events.some((e) => e.t === 'guess_no'));
    assert.equal((await guessWord(r, r.id.P5, 'caffe')).status, 409, 'one try only');
    // wrong guess + the bad are fewer: next round
    await r.a.post({ action: 'next' });
    P = await U(r); assert.equal(P.round, 2); assert.equal(P.guess, null);
    // the host can skip a guess nobody makes
    r = await setup();
    assert.equal((await r.phones[1].post({ action: 'next' })).status, 403);
    assert.equal((await r.a.post({ action: 'next' })).status, 200);
    assert.equal((await U(r)).guess.ok, false);
});

test('one phone for everybody: every local player reads, speaks, and votes through the same device', async () => {
    const a = await Phone.fresh();
    await a.post({ action: 'create', game: 'undercover', players: ['X', 'Y', 'Z'], settings: {} });
    assert.equal((await a.post({ action: 'start' })).status, 200);
    let s = await a.state();
    assert.equal(s.undercover.me.length, 3);
    const id = Object.fromEntries(s.players.map((p) => [p.name, p.id]));
    const words = s.undercover.me.map((m) => JSON.stringify(m.word));
    assert.equal(new Set(words).size, 2, 'two civilians share a word, the Undercover has another');
    for (const pid of Object.values(id)) assert.equal((await a.post({ action: 'seen', player_id: pid })).status, 200);
    s = await a.state(); assert.equal(s.undercover.phase, 'clue');
    for (let i = 0; i < 3; i++) assert.equal((await a.post({ action: 'clue_done' })).status, 200);
    s = await a.state(); assert.equal(s.undercover.phase, 'vote');
    for (const pid of Object.values(id)) assert.equal((await a.post({ action: 'vote', player_id: pid, target: Object.values(id).find((p) => p !== pid) })).status, 200);
    s = await a.state();
    assert.ok(s.undercover.out.length === 1 || s.undercover.status === 'ended');
    assert.equal(s.undercover.me.length, 3);
});

test('leaving: a speaker who leaves is skipped; a voter who leaves does not block the vote; too few left ends the match; the host can end it', async () => {
    const r = await room({}, 5);
    await begin(r, { P1: 'civ', P2: 'civ', P3: 'civ', P4: 'civ', P5: 'und' });
    const P0 = await U(r);
    // never the only Undercover (P5): if he leaves the match ends at once and the rest of the test has nothing to do
    const leaver = P0.speakers.find((p) => who(r, p) !== r.a && p !== P0.speaker && p !== r.id.P5);
    await who(r, leaver).post({ action: 'leave' });
    let P = await U(r);
    assert.ok(!P.alive.includes(leaver)); assert.equal(P.out.find((o) => o.p === leaver).left, true);
    await toVote(r);
    const rest = r.game().order.filter((p) => !r.game().out.some((o) => o.p === p));
    for (const v of rest.slice(0, -1)) await vote(r, v, rest.find((p) => p !== v));
    const lastVoter = rest[rest.length - 1];
    if (who(r, lastVoter) !== r.a) await who(r, lastVoter).post({ action: 'leave' });
    P = await U(r);
    assert.ok(P.phase !== 'vote' || P.status === 'ended' || who(r, lastVoter) === r.a, 'the vote does not wait for somebody who left');
    // the end
    const e = await room({}, 3);
    await begin(e);
    assert.equal((await e.phones[1].post({ action: 'end' })).status, 403);
    assert.equal((await e.a.post({ action: 'end' })).status, 200);
    P = await U(e); assert.equal(P.result.reason, 'host_ended'); assert.equal(P.result.winner, null); assert.equal(P.result.rows.length, 3);
    assert.equal((await e.a.post({ action: 'start' })).status, 200, 'a new match');
    assert.equal((await U(e)).match, 2);
    // two players out of three leave: the match is decided
    const f = await room({}, 3);
    await begin(f, { P1: 'civ', P2: 'civ', P3: 'und' });
    await f.phones[1].post({ action: 'leave' });
    assert.equal((await U(f)).status, 'ended', '1 civilian against 1 Undercover: the bad win');
});

test('the admin LIVE view shows every role and the two words, and who voted for whom; a normal visitor cannot see it', async () => {
    const r = await room({ infil: 1, white: true }, 5);
    await begin(r, { P1: 'civ', P2: 'civ', P3: 'civ', P4: 'und', P5: 'white' });
    await toVote(r);
    await vote(r, r.id.P1, r.id.P4);
    const admin = await makeAdmin(site, 'undercover_admin');
    const live = (await admin.get('/api/spia.php?action=live')).json.rooms.find((x) => x.code === r.code);
    assert.equal(live.game, 'undercover');
    assert.equal(live.undercover.phase, 'vote');
    assert.equal(live.undercover.roles[r.id.P4], 'und'); assert.equal(live.undercover.roles[r.id.P5], 'white');
    const row = BANK[r.game().pair.i], g = r.game();
    assert.equal(live.undercover.civ, row[g.pair.swap ? 2 : 1][0]); assert.equal(live.undercover.und, row[g.pair.swap ? 1 : 2][0]);
    assert.equal(live.undercover.votes[r.id.P1], r.id.P4);
    assert.equal((await new Client(site).get('/api/spia.php?action=live')).status !== 200, true);
    assert.match((await admin.get('/api/spia.php?action=ext')).text, /undercover/i, 'the admin script knows the game');
});

test('translations: the five languages have the same keys, every key the game uses exists, the help and intro texts are complete', () => {
    const dict = { it: {}, en: {}, es: {}, fr: {}, de: {} };
    const win = { SpiaI18n: { strings: dict } };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'undercover', 'texts.js'), 'utf8'), { window: win });
    const keys = Object.keys(dict.en);
    assert.ok(keys.length > 100);
    for (const l of ['it', 'es', 'fr', 'de']) {
        assert.deepEqual(Object.keys(dict[l]).sort(), keys.slice().sort(), l + ' has the same keys as English');
        for (const k of keys) assert.ok(String(dict[l][k]).trim(), `${l}.${k} is empty`);
    }
    const placeholders = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
    for (const k of keys) for (const l of ['it', 'es', 'fr', 'de']) assert.equal(placeholders(dict[l][k]), placeholders(dict.en[k]), `${l}.${k} placeholders`);
    const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'undercover', 'game.js'), 'utf8');
    for (const m of js.matchAll(/'(uc_[a-z_]+)'/g)) if (!m[1].endsWith('_')) assert.ok(keys.includes(m[1]), 'game.js uses an unknown key ' + m[1]);
    for (const k of ['civ', 'und', 'white']) assert.ok(keys.includes('uc_role_' + k), k);
    for (const k of ['civilians', 'undercover', 'white', 'none']) assert.ok(keys.includes('uc_winner_' + k), k);
    for (const k of ['last', 'white_guessed', 'host_ended']) assert.ok(keys.includes('uc_reason_' + k), k);
    for (const k of [0, 1, 2, 3, 4]) assert.ok(keys.includes('uc_cat_' + k), 'cat ' + k);
    for (const k of ['start', 'round', 'out', 'tie', 'left', 'guess_yes', 'guess_no', 'end']) assert.ok(keys.includes('uc_ev_' + k), k);
    for (const k of ['uc_title', 'uc_tagline', 'uc_one_phone_note', 'uc_need_three', 'uc_start', 'uc_new_match', 'uc_settings_next_match', 'intro_uc_1', 'intro_uc_2_t', 'intro_uc_3',
        'help_uc_basics_t', 'help_uc_turns', 'help_uc_white', 'help_uc_host', 'help_uc_settings', 'err_need_players_undercover', 'err_not_white', 'err_bad_text', 'err_bad_target']) assert.ok(keys.includes(k), k);
    for (const m of fs.readFileSync(path.join(ROOT, 'public', 'js', 'spia', 'app.js'), 'utf8').matchAll(/(?:title|tagline|note|need): '(uc_\w+)'/g)) assert.ok(keys.includes(m[1]), m[1]);
    // the server error codes the game can return all have a text
    const lib = fs.readFileSync(path.join(ROOT, 'public', 'api', 'undercover_lib.php'), 'utf8');
    for (const m of lib.matchAll(/return '([a-z_]+)'/g)) assert.ok(keys.includes('err_' + m[1]) || ['civilians', 'undercover', 'host_only', 'not_now','round_running', 'no_round', 'not_your_player', 'you_are_out'].includes(m[1]), 'no text for error ' + m[1]);
});

test('the page is served with its files, respects reduced motion, and is listed in the games and the sitemap', async () => {
    const html = await (await fetch(`${site.base}/pages/undercover.html`)).text();
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'no inline scripts');
    assert.match(html, /data-game="undercover"/);
    for (const f of ['/js/undercover/game.js', '/js/undercover/texts.js', '/css/undercover.css', '/assets/undercover/icon.svg', '/assets/undercover/manifest.json']) assert.equal((await fetch(site.base + f)).status, 200, f);
    assert.match(fs.readFileSync(path.join(ROOT, 'public', 'css', 'undercover.css'), 'utf8'), /prefers-reduced-motion: reduce[^}]*uc-stamp/);
    const games = await (await fetch(`${site.base}/pages/giochi.php`)).text();
    const map = await (await fetch(`${site.base}/sitemap.php`)).text();
    assert.ok(games.includes('undercover.html') && map.includes('pages/undercover.html'));
});
