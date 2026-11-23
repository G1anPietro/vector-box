// tests/botola.test.js — Botola rooms: the question bank, secrecy of the right answer, falling rules (wrong / slowest /
// nobody), levels, lives, timeouts, scores, leaving, the admin LIVE view, and the page + Skill check files
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startSite, Client, makeAdmin } = require('./helpers');

let site;
test.before(async () => { site = await startSite(); });
test.after(() => site.stop());

const BANK = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'lib', 'botola-q.json'), 'utf8'));

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

/** Phone A (host) has P1, B has P2, C has P3 (n = number of players, 2 or 3). */
async function room(settings = {}, n = 3, hostClient = null) {
    try { site.db('DELETE FROM rate_limits'); } catch (e) { /* not created yet */ }
    const a = await Phone.fresh(hostClient);
    const code = (await a.post({ action: 'create', game: 'botola', players: ['P1'], settings })).json.code;
    const phones = [a];
    for (let i = 2; i <= n; i++) { const p = await Phone.fresh(); await p.post({ action: 'join', code }); await p.post({ action: 'player_add', name: 'P' + i }); phones.push(p); }
    const s = await a.state();
    const id = Object.fromEntries(s.players.map((p) => [p.name, p.id]));
    const where = 'room_id = (SELECT id FROM spia_rooms WHERE code = ?)';
    const game = () => JSON.parse(site.db(`SELECT state FROM botola_games WHERE ${where}`, [code])[0].state);
    const setGame = (g) => site.db(`UPDATE botola_games SET state = ? WHERE ${where}`, [JSON.stringify(g), code]);
    const [b, c] = [phones[1], phones[2]];
    return { a, b, c, phones, code, id, game, setGame };
}
const ans = (r, who, choice) => r.phones[who - 1].post({ action: 'answer', player_id: r.id['P' + who], choice });
const right = (r) => r.game().q.right;
const wrong = (r) => (right(r) + 1) % 4;

test('the question bank: plenty of questions of each difficulty, 4 distinct answers in both languages, same difficulty in both', () => {
    assert.ok(BANK.length >= 1000);
    for (const d of [0, 1, 2]) assert.ok(BANK.filter((q) => q[0] === d).length >= 150, 'difficulty ' + d);
    for (const [i, [d, en, it]] of BANK.entries()) {
        assert.ok([0, 1, 2].includes(d));
        for (const row of [en, it]) { assert.equal(row.length, 5, 'row ' + i); assert.equal(new Set(row.slice(1)).size, 4, 'row ' + i); assert.ok(row.every((x) => typeof x === 'string' && x.trim())); }
    }
});

test('migration V45 created botola_games, a room is created and needs two players to start', async () => {
    await fetch(`${site.base}/api/rooms.php`);
    assert.ok(site.db('PRAGMA user_version')[0].user_version >= 45);
    const a = await Phone.fresh();
    const code = (await a.post({ action: 'create', game: 'botola', players: ['Solo'], settings: { level: 'nope', lives: 99, scores: true } })).json.code;
    const s = await a.state();
    assert.equal(s.game, 'botola');
    assert.deepEqual(s.settings, { level: 'rising', lives: 5, scores: true }, 'bad values are cleaned');
    assert.equal((await a.post({ action: 'start' })).status, 409, 'one player is not enough');
    assert.ok(code);
});

test('the right answer never reaches a phone before the round is over; the question has four options in both languages', async () => {
    const r = await room();
    assert.equal((await r.a.post({ action: 'start' })).status, 200);
    for (const ph of r.phones) {
        const s = await ph.state();
        const B = s.botola;
        assert.equal(B.phase, 'question'); assert.equal(B.reveal, null);
        assert.equal(B.q.options.en.length, 4); assert.equal(B.q.options.it.length, 4);
        assert.ok(B.q.left > 0 && B.q.time === 15);
        assert.ok(!JSON.stringify(s).includes('"right"'), 'no right answer anywhere in the view');
    }
    const g = r.game();
    assert.ok(g.q.right >= 0 && g.q.right <= 3);
});

test('wrong answer: that player falls and the others go on; the right answer is shown after the round', async () => {
    const r = await room();
    await r.a.post({ action: 'start' });
    assert.equal((await ans(r, 1, right(r))).status, 200);
    assert.equal((await ans(r, 3, right(r))).status, 200);
    assert.deepEqual((await r.a.state()).botola.answered.sort(), [r.id.P1, r.id.P3].sort(), 'who answered is public');
    assert.equal((await ans(r, 2, wrong(r))).status, 200);
    const B = (await r.a.state()).botola;
    assert.equal(B.phase, 'reveal');
    assert.deepEqual(B.reveal.fell, [r.id.P2]); assert.equal(B.reveal.right, r.game().q.right);
    assert.deepEqual(B.alive.sort(), [r.id.P1, r.id.P3].sort());
    assert.ok(B.events.some((e) => e.t === 'fell' && e.p === r.id.P2));
    assert.ok(B.next_left > 0);
});

test('answer checks: not your player, twice, out of range, after falling', async () => {
    const r = await room();
    await r.a.post({ action: 'start' });
    assert.equal((await r.a.post({ action: 'answer', player_id: r.id.P2, choice: 0 })).status, 403, 'not your player');
    assert.equal((await ans(r, 1, 7)).status, 409, 'bad choice');
    assert.equal((await ans(r, 1, 'a')).status, 409);
    assert.equal((await ans(r, 1, 0)).status, 200);
    assert.equal((await ans(r, 1, 1)).status, 409, 'already answered');
    r.setGame({ ...r.game(), lives: { ...r.game().lives, [r.id.P3]: 0 } });
    assert.equal((await ans(r, 3, 0)).status, 403, 'out');
});

test('everybody right: the slowest falls. Everybody wrong: nobody falls', async () => {
    const r = await room();
    await r.a.post({ action: 'start' });
    let g = r.game();
    g.answers = { [r.id.P1]: { c: g.q.right, ms: 4000 }, [r.id.P2]: { c: g.q.right, ms: 9000 }, [r.id.P3]: { c: g.q.right, ms: 2000 } };
    r.setGame(g);
    let B = (await r.a.state()).botola;   // the poll runs the clock: everybody answered -> the round ends
    assert.deepEqual(B.reveal.fell, [r.id.P2]); assert.equal(B.reveal.slowest, r.id.P2);

    const r2 = await room();
    await r2.a.post({ action: 'start' });
    g = r2.game(); const bad = (g.q.right + 1) % 4;
    g.answers = { [r2.id.P1]: { c: bad, ms: 1 }, [r2.id.P2]: { c: bad, ms: 2 } };
    r2.setGame(g);
    await ans(r2, 3, bad);
    B = (await r2.a.state()).botola;
    assert.equal(B.reveal.nobody, true); assert.deepEqual(B.reveal.fell, []); assert.equal(B.alive.length, 3);
});

test('time out: whoever did not answer falls; after the reveal the next round starts by itself', async () => {
    const r = await room();
    await r.a.post({ action: 'start' });
    await ans(r, 1, right(r));
    await ans(r, 2, right(r));
    let g = r.game(); g.q.deadline = Date.now() / 1000 - 1; r.setGame(g);
    let B = (await r.b.state()).botola;
    assert.deepEqual(B.reveal.fell, [r.id.P3]);
    g = r.game(); g.next_at = Date.now() / 1000 - 1; r.setGame(g);
    B = (await r.a.state()).botola;
    assert.equal(B.phase, 'question'); assert.equal(B.round, 2); assert.equal(B.reveal, null);
    assert.equal(B.alive.length, 2);
    assert.equal((await ans(r, 3, 0)).status, 403, 'P3 is out');
});

test('the host can skip the reveal; others cannot', async () => {
    const r = await room();
    await r.a.post({ action: 'start' });
    await ans(r, 1, right(r)); await ans(r, 2, right(r)); await ans(r, 3, wrong(r));
    assert.equal((await r.b.post({ action: 'next' })).status, 403);
    assert.equal((await r.a.post({ action: 'next' })).status, 200);
    assert.equal((await r.a.state()).botola.phase, 'question');
});

test('last one standing wins, the result is public, the point is given once when scores are on; a new match is possible', async () => {
    const r = await room({ scores: true }, 2);
    await r.a.post({ action: 'start' });
    await ans(r, 1, right(r)); await ans(r, 2, wrong(r));
    let s = await r.a.state(); await r.a.state();
    assert.equal(s.botola.status, 'ended'); assert.equal(s.botola.result.winner, r.id.P1); assert.equal(s.botola.result.reason, 'last_standing');
    assert.equal(s.players.find((p) => p.name === 'P1').score, 1, 'one point');
    assert.equal((await r.a.state()).players.find((p) => p.name === 'P1').score, 1, 'and only one');
    assert.equal((await r.a.post({ action: 'start' })).status, 200, 'a new match');
    s = await r.a.state(); assert.equal(s.botola.match, 2); assert.equal(s.botola.status, 'play');
});

test('lives: with 2 lives a wrong answer costs one and the player stays; levels pick the difficulty', async () => {
    const r = await room({ lives: 2, level: 'hard' }, 3);
    await r.a.post({ action: 'start' });
    assert.equal(BANK[r.game().q.i][0], 2, 'hard = difficulty 2');
    await ans(r, 1, right(r)); await ans(r, 2, right(r)); await ans(r, 3, wrong(r));
    const B = (await r.a.state()).botola;
    assert.equal(B.lives[r.id.P3], 1); assert.deepEqual(B.reveal.fell, []); assert.equal(B.alive.length, 3);
    const e = await room({ level: 'easy' }, 2); await e.a.post({ action: 'start' });
    assert.equal(BANK[e.game().q.i][0], 0);
    const n = await room({ level: 'rising' }, 2); await n.a.post({ action: 'start' });
    assert.equal(BANK[n.game().q.i][0], 0, 'rising starts easy');
});

test('a question is not repeated inside a match, and one phone can hold several players', async () => {
    const r = await room({ level: 'easy' }, 2);
    await r.a.post({ action: 'start' });
    const seen = new Set([r.game().q.i]);
    for (let i = 0; i < 6; i++) {
        const g = r.game(); g.phase = 'reveal'; g.next_at = 0; r.setGame(g);
        await r.a.state();
        const q = r.game().q.i; assert.ok(!seen.has(q)); seen.add(q);
    }
    const a = await Phone.fresh();
    await a.post({ action: 'create', game: 'botola', players: ['X', 'Y'] });
    assert.equal((await a.post({ action: 'start' })).status, 200);
    const me = (await a.state()).botola.me;
    assert.equal(me.length, 2); assert.ok(me.every((m) => m.alive && !m.answered));
});

test('leaving: the last player standing wins at once; the host can end the match', async () => {
    const r = await room({}, 2);
    await r.a.post({ action: 'start' });
    await r.b.post({ action: 'leave' });
    const B = (await r.a.state()).botola;
    assert.equal(B.status, 'ended'); assert.equal(B.result.winner, r.id.P1);

    const e = await room();
    await e.a.post({ action: 'start' });
    assert.equal((await e.b.post({ action: 'end' })).status, 403);
    assert.equal((await e.a.post({ action: 'end' })).status, 200);
    assert.equal((await e.a.state()).botola.result.reason, 'host_ended');
});

test('the admin LIVE view shows the right answer and what everybody chose; a normal visitor cannot see it', async () => {
    const r = await room();
    await r.a.post({ action: 'start' });
    await ans(r, 1, 2);
    const admin = await makeAdmin(site, 'botola_admin');
    const live = (await admin.get('/api/spia.php?action=live')).json.rooms.find((x) => x.code === r.code);
    assert.equal(live.game, 'botola');
    assert.equal(live.botola.phase, 'question'); assert.equal(live.botola.right, r.game().q.right); assert.equal(live.botola.answers[r.id.P1], 2);
    assert.equal(live.botola.options.length, 4);
    assert.equal((await new Client(site).get('/api/spia.php?action=live')).status !== 200, true);
    const ext = await admin.get('/api/spia.php?action=ext');
    assert.match(ext.text, /botola/i, 'the admin script knows Botola rooms');
});

test('the Botola and Skill check pages are served, in the game list and the sitemap; no inline script', async () => {
    const games = await (await fetch(`${site.base}/pages/giochi.php`)).text();
    const map = await (await fetch(`${site.base}/sitemap.php`)).text();
    for (const [g, files] of [['botola', ['/js/botola/game.js', '/js/botola/texts.js', '/css/botola.css', '/assets/botola/icon.svg', '/assets/botola/manifest.json']], ['skillcheck', ['/js/skillcheck.js', '/css/skillcheck.css', '/assets/skillcheck/icon.svg']]]) {
        const html = await (await fetch(`${site.base}/pages/${g}.html`)).text();
        assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), g + ': no inline scripts');
        for (const f of files) assert.equal((await fetch(site.base + f)).status, 200, f);
        assert.ok(games.includes(`${g}.html`) && map.includes(`pages/${g}.html`), g);
    }
});

// ----- Skill check: the rules (no browser) -----
const S = require(path.join(__dirname, '..', 'public', 'js', 'skillcheck.js'));
test('skillcheck: zone shrinks and the needle speeds up within limits; difficulty shifts the start; wrap-around; endless zones are ahead of the needle', () => {
    assert.ok(S.levelFor(10).size < S.levelFor(0).size && S.levelFor(10).speed > S.levelFor(0).speed);
    assert.ok(S.levelFor(999, 'hard').size >= 10 && S.levelFor(999, 'hard').speed <= 520);
    assert.ok(S.levelFor(0, 'easy').size > S.levelFor(0).size && S.levelFor(0, 'easy').speed < S.levelFor(0).speed);
    assert.ok(S.levelFor(0, 'hard').size < S.levelFor(0).size && S.levelFor(0, 'hard').speed > S.levelFor(0).speed);
    assert.equal(S.tap(100, 90, 30), 'hit'); assert.equal(S.tap(130, 90, 30), 'miss'); assert.equal(S.tap(10, 340, 40), 'hit');
    assert.equal(S.passed(121, 90, 30), true); assert.equal(S.passed(119, 90, 30), false);
    for (let i = 0; i < 300; i++) {
        const a = Math.random() * 720, size = S.levelFor(0).size, z = S.zoneAhead(a, size);
        assert.ok(z >= 0 && z < 360); assert.equal(S.inZone(a, z, size), false, 'never under the needle');
        const gap = ((z - a) % 360 + 360) % 360; assert.ok(gap >= 70 && gap <= 360 - size - 70, 'ahead of the needle');
        const s0 = S.zoneStart(size); assert.ok(s0 >= 80 && s0 + size <= 340);
    }
});
