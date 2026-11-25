// tests/bugiardo.test.js — "Find the liar" rooms: the bank of question pairs, the liar and his question that never reach the other phones,
// anonymous answers in random order, the secret vote (a tie catches nobody), the caught liar's guess judged by the server, clean texts,
// one shared phone, leaving, host tools, the admin LIVE view, the five languages and the page files
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
const BANK = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib', 'bugiardo-q.json'), 'utf8'));
const IDX = { n: BANK.findIndex((r) => r[0] === 'n'), t: BANK.findIndex((r) => r[0] === 't'), c: BANK.findIndex((r) => r[0] === 'c') };

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
    const code = (await a.post({ action: 'create', game: 'bugiardo', players: ['P1'], settings })).json.code;
    const phones = [a];
    for (let i = 2; i <= n; i++) { const p = await Phone.fresh(); await p.post({ action: 'join', code }); await p.post({ action: 'player_add', name: 'P' + i }); phones.push(p); }
    const s = await a.state();
    const id = Object.fromEntries(s.players.map((p) => [p.name, p.id]));
    const where = 'room_id = (SELECT id FROM spia_rooms WHERE code = ?)';
    const game = () => JSON.parse(site.db(`SELECT state FROM bugiardo_games WHERE ${where}`, [code])[0].state);
    const setGame = (g) => site.db(`UPDATE bugiardo_games SET state = ? WHERE ${where}`, [JSON.stringify(g), code]);
    return { a, phones, code, id, game, setGame };
}
const who = (r, pid) => r.phones[Number(Object.keys(r.id).find((k) => r.id[k] === pid).slice(1)) - 1];
const B = async (r) => (await r.a.state()).bugiardo;
/** Starts the match and forces the question pair and the liar of round 1. */
async function begin(r, type = 'n', liarName = 'P1') {
    assert.equal((await r.a.post({ action: 'start' })).status, 200);
    const g = r.game(); g.pair = IDX[type]; g.liar = g.prev_liar = r.id[liarName]; r.setGame(g);
    return g.order;
}
const answer = (r, pid, value) => who(r, pid).post({ action: 'answer', player_id: pid, value });
const vote = (r, voter, target) => who(r, voter).post({ action: 'vote', player_id: voter, target });
/** Everybody answers (numbers: 1, 2, 3...) and the host opens the vote. */
async function toVote(r) {
    for (const [i, pid] of r.game().order.entries()) assert.equal((await answer(r, pid, i + 1)).status, 200);
    assert.equal((await B(r)).phase, 'show');
    assert.equal((await r.a.post({ action: 'next' })).status, 200);
    assert.equal((await B(r)).phase, 'vote');
}
/** All the others vote for `target`; the target votes for somebody else. */
async function voteFor(r, target) {
    const order = r.game().order;
    for (const v of order) assert.equal((await vote(r, v, v === target ? order.find((p) => p !== target) : target)).status, 200);
}

test('the bank: at least 80 pairs, five languages, the two questions always differ, the three kinds are there', () => {
    assert.ok(BANK.length >= 80);
    for (const [i, row] of BANK.entries()) {
        assert.ok(['n', 't', 'c'].includes(row[0]), `type ${i}`);
        for (const side of [row[1], row[2]]) { assert.equal(side.length, 5, `pair ${i}`); assert.ok(side.every((x) => typeof x === 'string' && x.trim().length >= 8), `pair ${i}`); }
        for (let l = 0; l < 5; l++) assert.notEqual(row[1][l], row[2][l], `pair ${i} lang ${l}`);
        if (row[0] === 'c') { assert.equal(row[3].length, 4); assert.ok(row[3].every((o) => o.length === 5 && o.every((x) => x.trim()))); } else assert.equal(row[3], undefined);
    }
    assert.equal(new Set(BANK.map((r) => r[1][1])).size, BANK.length, 'English true questions are unique');
    for (const k of ['n', 't', 'c']) assert.ok(BANK.filter((r) => r[0] === k).length >= 15, 'kind ' + k);
});

test('migration V59 created bugiardo_games; settings are cleaned; three players are needed', async () => {
    await fetch(`${site.base}/api/rooms.php`);
    assert.ok(site.db('PRAGMA user_version')[0].user_version >= 59);
    const a = await Phone.fresh();
    await a.post({ action: 'create', game: 'bugiardo', players: ['A', 'B'], settings: { rounds: 9 } });
    const s = await a.state();
    assert.equal(s.game, 'bugiardo');
    assert.deepEqual(s.settings, { rounds: 5 }, 'bad value cleaned');
    assert.equal((await a.post({ action: 'start' })).status, 409, 'two players are not enough');
    assert.equal((await a.post({ action: 'settings', settings: { rounds: 8 } })).status, 200);
    assert.deepEqual((await a.state()).settings, { rounds: 8 });
});

test('SECRET: a phone gets its own question only; nobody is told who the liar is, and the liar\'s question reaches only the liar', async () => {
    const r = await room({}, 5);
    await begin(r, 'n', 'P3');
    const row = BANK[IDX.n];
    for (const ph of r.phones) {
        const res = await ph.get('state');
        const P = res.json.bugiardo, me = P.me[0];
        const liar = me.player_id === r.id.P3;
        assert.deepEqual(me.question, row[liar ? 2 : 1]);
        assert.ok(!res.text.includes(JSON.stringify(row[liar ? 1 : 2])), 'the other question never arrives');
        assert.ok(!/"liar"|"fake"|"true"|"pair"|"answers"|"votes"/.test(res.text), 'no hint of who is the liar');
        assert.equal(P.phase, 'answer'); assert.equal(P.me.length, 1); assert.equal(me.guesser, false); assert.equal(P.last, null);
    }
    assert.notEqual((await new Client(site).get('/api/spia.php?action=live')).status, 200);
    assert.notEqual((await r.phones[1].get('live')).status, 200);
});

test('answers: valid ones only, once each; they are shown without names, in an order the server draws', async () => {
    const r = await room({}, 4);
    await begin(r, 'n');
    const [p1, p2, p3, p4] = r.game().order;
    assert.equal((await answer(r, p1, 11)).status, 409, 'above 10');
    assert.equal((await answer(r, p1, 'x')).status, 409);
    assert.equal((await who(r, p1).post({ action: 'answer', player_id: p2, value: 3 })).status, 403, 'not your player');
    assert.equal((await r.a.post({ action: 'next' })).status, 409, 'nothing to show yet');
    assert.equal((await answer(r, p1, 0)).status, 200);
    assert.equal((await answer(r, p1, 5)).status, 409, 'once only');
    assert.deepEqual((await B(r)).answered, [p1]);
    assert.equal((await r.phones[1].post({ action: 'next' })).status, 403, 'only the host moves on');
    for (const [pid, v] of [[p2, 10], [p3, 2], [p4, 7]]) await answer(r, pid, v);
    const P = await B(r);
    assert.equal(P.phase, 'show');
    assert.deepEqual(P.shown.map((a) => a.v).sort((x, y) => x - y), [0, 2, 7, 10]);
    const text = JSON.stringify(P.shown);
    assert.ok(!/"p"|player|P\d/.test(text), 'no name or id next to an answer');
    const orders = new Set();
    for (let i = 0; i < 8; i++) {
        const q = await room({}, 4); await begin(q, 'n');
        for (const [k, pid] of q.game().order.entries()) await answer(q, pid, k + 1);
        orders.add((await B(q)).shown.map((a) => a.v).join());
    }
    assert.ok(orders.size > 1, 'the order is random, not the seating');
});

test('answers: the host may show them without a slow player; text answers are cut, cleaned and never HTML; choices are checked', async () => {
    const r = await room({}, 3);
    await begin(r, 't');
    const [p1, p2, p3] = r.game().order;
    assert.equal((await answer(r, p1, '   ')).status, 409, 'empty');
    assert.equal((await answer(r, p1, 7)).status, 409, 'a number is not a text');
    assert.equal((await answer(r, p1, '<img src=x onerror=alert(1)><b>Hi</b>\u0007')).status, 200);
    assert.equal((await answer(r, p2, 'x'.repeat(100))).status, 200);
    assert.equal((await r.a.post({ action: 'next' })).status, 200, 'host does not wait for P3');
    const P = await B(r);
    assert.equal(P.phase, 'show'); assert.equal(P.shown.length, 2);
    for (const a of P.shown) { assert.equal(typeof a.v, 'string'); assert.ok(a.v.length <= 40); assert.ok(!/[<>\u0000-\u001f]/.test(a.v), a.v); }
    assert.ok(P.shown.some((a) => a.v === 'x'.repeat(40)));
    assert.equal((await answer(r, p3, 'late')).status, 409, 'too late');
    const c = await room({}, 3);
    await begin(c, 'c');
    const [q1, q2] = c.game().order;
    assert.equal((await answer(c, q1, 4)).status, 409, 'only four choices');
    assert.equal((await answer(c, q1, 3)).status, 200);
    assert.equal((await answer(c, q2, 'abc')).status, 409);
    assert.deepEqual((await B(c)).opts, BANK[IDX.c][3]);
});

test('the vote is secret and judged by the server: the caught liar guesses among four; a wrong guess pays the civilians who voted for him', async () => {
    const r = await room({}, 4);
    await begin(r, 'n', 'P2');
    await toVote(r);
    const liar = r.id.P2;
    assert.equal((await vote(r, r.id.P1, r.id.P1)).status, 409, 'not yourself');
    assert.equal((await vote(r, r.id.P1, 99999)).status, 409);
    assert.equal((await vote(r, r.id.P1, liar)).status, 200);
    assert.equal((await vote(r, r.id.P1, liar)).status, 409, 'once only');
    let s = await r.a.state(); const raw = JSON.stringify(s);
    assert.deepEqual(s.bugiardo.voted, [r.id.P1]); assert.ok(!('votes' in s.bugiardo) && !raw.includes('"last":{'), 'nobody sees the votes');
    await vote(r, r.id.P3, liar);
    await vote(r, r.id.P4, r.id.P3);   // a civilian who guessed wrong
    await vote(r, liar, r.id.P1);
    s = await r.a.state();
    assert.equal(s.bugiardo.phase, 'guess');
    for (const ph of r.phones) {
        const me = (await ph.state()).bugiardo.me[0];
        if (me.player_id === liar) {
            assert.equal(me.guesser, true); assert.equal(me.options.length, 4);
            assert.ok(me.options.some((o) => JSON.stringify(o) === JSON.stringify(BANK[IDX.n][1])), 'the real question is among them');
            assert.ok(!me.options.some((o) => JSON.stringify(o) === JSON.stringify(BANK[IDX.n][2])), 'his own question is not');
        } else { assert.equal(me.guesser, false); assert.equal(me.options, null); }
    }
    assert.equal((await who(r, r.id.P1).post({ action: 'guess', player_id: r.id.P1, pick: 0 })).status, 403, 'only the liar guesses');
    assert.equal((await who(r, liar).post({ action: 'guess', player_id: liar, pick: 7 })).status, 409);
    const opts = (await who(r, liar).state()).bugiardo.me[0].options;
    const right = opts.findIndex((o) => JSON.stringify(o) === JSON.stringify(BANK[IDX.n][1]));
    const wrong = [0, 1, 2, 3].find((i) => i !== right);
    assert.equal((await who(r, liar).post({ action: 'guess', player_id: liar, pick: wrong })).status, 200);
    s = await r.a.state();
    assert.equal(s.bugiardo.phase, 'reveal');
    assert.equal(s.bugiardo.last.kind, 'caught'); assert.equal(s.bugiardo.last.liar, liar);
    assert.deepEqual(s.bugiardo.last.true, BANK[IDX.n][1]); assert.deepEqual(s.bugiardo.last.fake, BANK[IDX.n][2]);
    assert.equal(s.bugiardo.last.answers[liar], 2, 'the names come out with the reveal');
    assert.equal(s.bugiardo.scores[r.id.P1], 2); assert.equal(s.bugiardo.scores[r.id.P3], 2);
    assert.equal(s.bugiardo.scores[r.id.P4], 0, 'who voted for a civilian scores nothing'); assert.equal(s.bugiardo.scores[liar], 0);
});

test('the caught liar who guesses the real question steals the round; the host can skip the guess', async () => {
    const r = await room({}, 3);
    await begin(r, 'n', 'P3');
    await toVote(r);
    await voteFor(r, r.id.P3);
    assert.equal((await B(r)).phase, 'guess');
    const opts = (await who(r, r.id.P3).state()).bugiardo.me[0].options;
    const right = opts.findIndex((o) => JSON.stringify(o) === JSON.stringify(BANK[IDX.n][1]));
    assert.equal((await who(r, r.id.P3).post({ action: 'guess', player_id: r.id.P3, pick: right })).status, 200);
    let P = await B(r);
    assert.equal(P.last.kind, 'stolen'); assert.equal(P.scores[r.id.P3], 2); assert.equal(P.scores[r.id.P1], 0);
    const q = await room({}, 3);
    await begin(q, 'n', 'P3'); await toVote(q); await voteFor(q, q.id.P3);
    assert.equal((await q.phones[1].post({ action: 'next' })).status, 403);
    assert.equal((await q.a.post({ action: 'next' })).status, 200);
    P = await B(q); assert.equal(P.last.kind, 'caught'); assert.equal(P.last.pick, null); assert.equal(P.scores[q.id.P1], 2);
});

test('a tie catches nobody: the liar scores 3 and there is no guess; a liar with fewer votes than another escapes', async () => {
    const r = await room({}, 4);
    await begin(r, 'n', 'P1');
    await toVote(r);
    const [a, b, c, d] = r.game().order;
    await vote(r, a, b); await vote(r, b, a); await vote(r, c, a); await vote(r, d, b);
    let P = await B(r);
    assert.equal(P.phase, 'reveal'); assert.equal(P.last.kind, 'escaped'); assert.equal(P.scores[a], 3);
    const q = await room({}, 3);
    await begin(q, 'n', 'P1'); await toVote(q);
    const [x, y, z] = q.game().order;
    await vote(q, x, y); await vote(q, y, z); await vote(q, z, y);
    P = await B(q);
    assert.equal(P.last.kind, 'escaped'); assert.equal(P.scores[x], 3);
});

test('rounds: after the reveal the next round has its own question and liar; the last one ends with the standings', async () => {
    const r = await room({ rounds: 3 }, 3);
    await begin(r, 'n', 'P1');
    assert.equal((await B(r)).total, 3);
    const liars = [];
    for (let round = 1; round <= 3; round++) {
        let P = await B(r);
        assert.equal(P.round, round);
        liars.push(r.game().liar);
        const gg = r.game(); gg.pair = IDX.n; r.setGame(gg);   // numbers for every round, whatever the draw
        await toVote(r);
        const order = r.game().order;
        for (const v of order) await vote(r, v, order.find((p) => p !== v && p !== r.game().liar) ?? order[0]);   // nobody guesses the liar: he escapes
        P = await B(r);
        assert.equal(P.phase, 'reveal', 'round ' + round);
        assert.equal((await r.phones[1].post({ action: 'next' })).status, 403);
        assert.equal((await r.a.post({ action: 'next' })).status, 200);
    }
    const P = await B(r);
    assert.equal(P.status, 'ended'); assert.equal(P.result.reason, 'done'); assert.equal(P.result.rows.length, 3);
    assert.ok(P.result.rows[0].pts >= P.result.rows[1].pts);
    assert.ok(liars[1] !== liars[0] && liars[2] !== liars[1], 'the liar is never the same two rounds in a row');
    assert.equal((await r.a.post({ action: 'start' })).status, 200, 'a new match');
    assert.equal((await B(r)).match, 2);
});

test('one shared phone: every local player gets own question; the liar is told nothing; the match plays through', async () => {
    try { site.db('DELETE FROM rate_limits'); } catch (e) { /* none */ }
    const a = await Phone.fresh();
    const code = (await a.post({ action: 'create', game: 'bugiardo', players: ['X', 'Y', 'Z'] })).json.code;
    assert.equal((await a.post({ action: 'start' })).status, 200);
    const where = 'room_id = (SELECT id FROM spia_rooms WHERE code = ?)';
    const g = JSON.parse(site.db(`SELECT state FROM bugiardo_games WHERE ${where}`, [code])[0].state);
    let P = (await a.state()).bugiardo;
    assert.equal(P.me.length, 3);
    for (const m of P.me) assert.deepEqual(m.question, BANK[g.pair][m.player_id === g.liar ? 2 : 1]);
    assert.equal(new Set(P.me.map((m) => JSON.stringify(m.question))).size, 2, 'two different questions on the one phone');
    assert.ok(!/"liar"/.test(JSON.stringify(P)));
    for (const [i, m] of P.me.entries()) assert.equal((await a.post({ action: 'answer', player_id: m.player_id, value: i })).status, 200);
    assert.equal((await a.state()).bugiardo.phase, 'show');
    await a.post({ action: 'next' });
    for (const m of P.me) assert.equal((await a.post({ action: 'vote', player_id: m.player_id, target: P.me.find((x) => x.player_id !== m.player_id).player_id })).status, 200);
    assert.ok(['guess', 'reveal'].includes((await a.state()).bugiardo.phase));
});

test('leaving: the liar leaving cancels the round; a civilian leaving does not block the vote; too few left ends the match; the host can end it', async () => {
    const r = await room({}, 5);
    await begin(r, 'n', 'P4');
    await answer(r, r.id.P1, 1);
    await r.phones[1].post({ action: 'leave' });   // a civilian: his answer is not awaited
    for (const n of ['P3', 'P4', 'P5']) await answer(r, r.id[n], 2);
    assert.equal((await B(r)).phase, 'show');
    assert.equal((await B(r)).shown.length, 4);
    await r.a.post({ action: 'next' });
    await r.phones[3].post({ action: 'leave' });   // the liar
    let P = await B(r);
    assert.equal(P.phase, 'reveal'); assert.equal(P.last.kind, 'void');
    assert.ok(Object.values(P.scores).every((v) => v === 0));
    const e = await room({}, 3);
    await begin(e);
    assert.equal((await e.phones[1].post({ action: 'end' })).status, 403);
    assert.equal((await e.a.post({ action: 'end' })).status, 200);
    P = await B(e); assert.equal(P.result.reason, 'host_ended'); assert.equal(P.result.rows.length, 3);
    const f = await room({}, 3);
    await begin(f);
    await f.phones[2].post({ action: 'leave' });
    assert.equal((await B(f)).status, 'ended'); assert.equal((await B(f)).result.reason, 'too_few');
});

test('the admin LIVE view shows both questions, the liar, every answer with its name and the votes; a normal visitor cannot see it', async () => {
    const r = await room({}, 4);
    await begin(r, 'c', 'P2');
    await answer(r, r.id.P1, 2);
    const admin = await makeAdmin(site, 'bugiardo_admin');
    let live = (await admin.get('/api/spia.php?action=live')).json.rooms.find((x) => x.code === r.code);
    assert.equal(live.game, 'bugiardo'); assert.equal(live.bugiardo.phase, 'answer');
    assert.equal(live.bugiardo.liar, r.id.P2);
    assert.deepEqual(live.bugiardo.true, BANK[IDX.c][1]); assert.deepEqual(live.bugiardo.fake, BANK[IDX.c][2]);
    assert.equal(live.bugiardo.answers[r.id.P1], 2);
    for (const n of ['P2', 'P3', 'P4']) await answer(r, r.id[n], 1);
    await r.a.post({ action: 'next' });
    await vote(r, r.id.P1, r.id.P2);
    live = (await admin.get('/api/spia.php?action=live')).json.rooms.find((x) => x.code === r.code);
    assert.equal(live.bugiardo.votes[r.id.P1], r.id.P2);
    assert.equal((await new Client(site).get('/api/spia.php?action=live')).status !== 200, true);
    assert.match((await admin.get('/api/spia.php?action=ext')).text, /bugiardo/i, 'the admin script knows the game');
});

test('translations: the five languages have the same keys, every key the game uses exists, the help and intro texts are complete', () => {
    const dict = { it: {}, en: {}, es: {}, fr: {}, de: {} };
    const win = { SpiaI18n: { strings: dict } };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'bugiardo', 'texts.js'), 'utf8'), { window: win });
    const keys = Object.keys(dict.en);
    assert.ok(keys.length > 80);
    for (const l of ['it', 'es', 'fr', 'de']) {
        assert.deepEqual(Object.keys(dict[l]).sort(), keys.slice().sort(), l + ' has the same keys as English');
        for (const k of keys) assert.ok(String(dict[l][k]).trim(), `${l}.${k} is empty`);
    }
    const placeholders = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
    for (const k of keys) for (const l of ['it', 'es', 'fr', 'de']) assert.equal(placeholders(dict[l][k]), placeholders(dict.en[k]), `${l}.${k} placeholders`);
    const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'bugiardo', 'game.js'), 'utf8');
    for (const m of js.matchAll(/'(bg_[a-z_]+)'/g)) if (!m[1].endsWith('_')) assert.ok(keys.includes(m[1]), 'game.js uses an unknown key ' + m[1]);
    for (const k of ['escaped', 'caught', 'stolen', 'void']) assert.ok(keys.includes('bg_v_' + k), k);
    for (const k of ['done', 'host_ended', 'too_few']) assert.ok(keys.includes('bg_reason_' + k), k);
    for (const k of ['bg_title', 'bg_tagline', 'bg_one_phone_note', 'bg_need_three', 'bg_start', 'bg_new_match', 'bg_settings_next_match', 'intro_bg_1', 'intro_bg_2_t', 'intro_bg_3',
        'help_bg_basics_t', 'help_bg_rounds', 'help_bg_scoring', 'help_bg_host', 'help_bg_settings', 'err_need_players_bugiardo', 'err_not_liar', 'err_bad_answer', 'err_already_answered']) assert.ok(keys.includes(k), k);
    for (const m of fs.readFileSync(path.join(ROOT, 'public', 'js', 'spia', 'app.js'), 'utf8').matchAll(/(?:title|tagline|note|need): '(bg_\w+)'/g)) assert.ok(keys.includes(m[1]), m[1]);
    const lib = fs.readFileSync(path.join(ROOT, 'public', 'api', 'bugiardo_lib.php'), 'utf8');
    for (const m of lib.matchAll(/return '([a-z_]+)'/g)) assert.ok(keys.includes('err_' + m[1]) || ['host_only', 'not_now', 'round_running', 'no_round', 'not_your_player', 'you_are_out', 'bad_target'].includes(m[1]), 'no text for error ' + m[1]);
});

test('the game only puts texts in with textContent: no innerHTML, no inline handlers', () => {
    const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'bugiardo', 'game.js'), 'utf8');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\.onclick\s*=/.test(js));
});

test('the page is served with its files, respects reduced motion, and is listed in the games and the sitemap', async () => {
    const html = await (await fetch(`${site.base}/pages/bugiardo.html`)).text();
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'no inline scripts');
    assert.match(html, /data-game="bugiardo"/);
    for (const f of ['/js/bugiardo/game.js', '/js/bugiardo/texts.js', '/css/bugiardo.css', '/assets/bugiardo/icon.svg', '/assets/bugiardo/manifest.json']) assert.equal((await fetch(site.base + f)).status, 200, f);
    assert.match(fs.readFileSync(path.join(ROOT, 'public', 'css', 'bugiardo.css'), 'utf8'), /prefers-reduced-motion: reduce[^}]*bg-trace-line/);
    const games = await (await fetch(`${site.base}/pages/giochi.php`)).text();
    const map = await (await fetch(`${site.base}/sitemap.php`)).text();
    assert.ok(games.includes('bugiardo.html') && map.includes('pages/bugiardo.html'));
});
