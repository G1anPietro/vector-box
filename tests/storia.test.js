// tests/storia.test.js — "Chain story" rooms: the bank of openings, the turn order (the server's), the rule that a phone only ever gets the
// sentence written just before its own (never the rest, never an author), the 200 character limit and the clean-up of player text, the
// turn timer (an instant the server owns), reading, the secret vote, moderation (remove a sentence, exclude a player), one shared
// phone, the admin LIVE view, the five languages and the page files
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
const BANK = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib', 'storia-q.json'), 'utf8')).i;
const OPEN = 'ZZ opening line ZZ';

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
    async raw() { return (await this.get('state')).text; }
}

/** Phone A (host) has P1, B has P2, C has P3, ... (n players, one per phone). The opening line is OPEN (the host's own). */
async function room(settings = {}, n = 3) {
    try { site.db('DELETE FROM rate_limits'); } catch (e) { /* not created yet */ }
    const a = await Phone.fresh();
    const code = (await a.post({ action: 'create', game: 'storia', players: ['P1'], settings: { own: OPEN, ...settings } })).json.code;
    const phones = [a];
    for (let i = 2; i <= n; i++) { const p = await Phone.fresh(); await p.post({ action: 'join', code }); await p.post({ action: 'player_add', name: 'P' + i }); phones.push(p); }
    const s = await a.state();
    const id = Object.fromEntries(s.players.map((p) => [p.name, p.id]));
    const where = 'room_id = (SELECT id FROM spia_rooms WHERE code = ?)';
    const game = () => JSON.parse(site.db(`SELECT state FROM storia_games WHERE ${where}`, [code])[0].state);
    const setGame = (g) => site.db(`UPDATE storia_games SET state = ? WHERE ${where}`, [JSON.stringify(g), code]);
    return { a, phones, code, id, game, setGame };
}
const who = (r, pid) => r.phones[Number(Object.keys(r.id).find((k) => r.id[k] === pid).slice(1)) - 1];
const write = (r, pid, text) => who(r, pid).post({ action: 'write', player_id: pid, text });
const vote = (r, pid, line) => who(r, pid).post({ action: 'vote', player_id: pid, line });
const late = (r, field) => { const g = r.game(); g[field] = Date.now() / 1000 - 1; r.setGame(g); };

/** Plays the writing phase: every turn writes "S<i>". Returns the turn order. */
async function writeAll(r) {
    const turns = r.game().turns.slice();
    for (const [i, pid] of turns.entries()) assert.equal((await write(r, pid, 'S' + (i + 1))).status, 200, 'turn ' + i);
    return turns;
}

test('the bank: at least 60 openings, five languages each, short, five genres, no duplicates', () => {
    assert.ok(BANK.length >= 60);
    const seen = new Set();
    for (const [i, e] of BANK.entries()) {
        assert.ok(['m', 'f', 'd', 's', 'a'].includes(e[0]), 'genre ' + i);
        assert.equal(e[1].length, 5, 'five languages ' + i);
        for (const x of e[1]) { assert.ok(typeof x === 'string' && x.trim().length >= 20 && x.length <= 200, 'text ' + i); assert.ok(!seen.has(x), 'duplicate ' + x); seen.add(x); }
    }
    for (const c of ['m', 'f', 'd', 's', 'a']) assert.ok(BANK.filter((e) => e[0] === c).length >= 10, c);
});

test('migration V56 created storia_games; settings are cleaned; three players are needed; a bank opening is used when the host wrote none', async () => {
    await fetch(`${site.base}/api/rooms.php`);
    assert.ok(site.db('PRAGMA user_version')[0].user_version >= 56);
    const a = await Phone.fresh();
    await a.post({ action: 'create', game: 'storia', players: ['A', 'B'], settings: { rounds: 9, timer: 7, genre: 'x', own: 'a\u0007b\n  c' } });
    const s = await a.state();
    assert.equal(s.game, 'storia');
    assert.deepEqual(s.settings, { rounds: 1, timer: 0, genre: 'mix', own: 'a b c', own_on: true }, 'bad values cleaned');
    assert.equal((await a.post({ action: 'start' })).status, 409, 'two players are not enough');
    assert.equal((await a.post({ action: 'settings', settings: { rounds: 3, timer: 60, genre: 'scifi', own: '' } })).status, 200);
    assert.deepEqual((await a.state()).settings, { rounds: 3, timer: 60, genre: 'scifi', own: '', own_on: false });

    const r = await room({ own: '', genre: 'fantasy' }, 3);
    assert.equal((await r.a.post({ action: 'start' })).status, 200);
    const g = r.game();
    assert.deepEqual(g.story[0].tr.length, 5);
    assert.ok(BANK.some((e) => e[0] === 'f' && e[1][1] === g.story[0].text), 'a fantasy opening from the bank');
});

test('the server decides the order: every player once per lap, never the same player twice in a row, a new shuffle per lap', async () => {
    const r = await room({ rounds: 3 }, 4);
    await r.a.post({ action: 'start' });
    const g = r.game();
    assert.equal(g.turns.length, 12);
    for (let lap = 0; lap < 3; lap++) assert.deepEqual(g.turns.slice(lap * 4, lap * 4 + 4).sort(), Object.values(r.id).sort());
    for (let i = 1; i < g.turns.length; i++) assert.notEqual(g.turns[i], g.turns[i - 1]);
    assert.equal((await r.phones[1].post({ action: 'settings', settings: { rounds: 1 } })).status, 403, 'settings are for the host');
});

test('a phone only gets the sentence just before its own: never the rest of the story, never an author', async () => {
    const r = await room({}, 4);
    await r.a.post({ action: 'start' });
    const turns = r.game().turns;
    const [w1, w2, w3, w4] = turns;
    // turn 1: only the opening line, only on the phone of the first writer
    for (const ph of r.phones) {
        const s = await ph.state(), raw = JSON.stringify(s);
        const isW = who(r, w1) === ph;
        assert.equal(s.storia.phase, 'write'); assert.equal(s.storia.writer, w1);
        assert.deepEqual(s.storia.story, [], 'no story is sent while writing');
        if (isW) { assert.equal(s.storia.prev.text, OPEN); assert.equal(s.storia.prev.incipit, true); } else { assert.equal(s.storia.prev, null); if (ph !== r.a) assert.ok(!raw.includes(OPEN), 'the opening is not on the other phones'); }
    }
    assert.equal((await write(r, w2, 'nope')).status, 409, 'not your turn');
    assert.equal((await who(r, w2).post({ action: 'write', player_id: w1, text: 'x' })).status, 403, 'not your player');
    assert.equal((await write(r, w1, '   ')).status, 409, 'empty');
    assert.equal((await write(r, w1, 'FIRST_SENTENCE_AAA')).status, 200);
    assert.equal((await write(r, w1, 'again')).status, 409, 'the turn passed on');
    // turn 2: the writer sees FIRST only (not the opening); the others see none of it
    for (const ph of r.phones) {
        const s = await ph.state(), raw = JSON.stringify(s);
        if (who(r, w2) === ph) { assert.equal(s.storia.prev.text, 'FIRST_SENTENCE_AAA'); assert.equal(s.storia.prev.incipit, false); assert.ok(ph === r.a || !raw.includes(OPEN), 'not the opening'); }
        else assert.ok(!raw.includes('FIRST_SENTENCE_AAA') && (ph === r.a || !raw.includes(OPEN)));
        assert.equal(s.storia.written, 1);
    }
    assert.equal((await write(r, w2, 'SECOND_SENTENCE_BBB')).status, 200);
    // turn 3: only SECOND; neither FIRST nor the opening, on any phone
    for (const ph of r.phones) {
        const raw = await ph.raw();
        assert.ok(!raw.includes('FIRST_SENTENCE_AAA') && (ph === r.a || !raw.includes(OPEN)));
        if (who(r, w3) === ph) assert.ok(raw.includes('SECOND_SENTENCE_BBB')); else assert.ok(!raw.includes('SECOND_SENTENCE_BBB'));
    }
    assert.equal((await write(r, w3, 'THIRD')).status, 200);
    assert.equal((await write(r, w4, 'FOURTH')).status, 200);
    // reading: the lines are there but no author; the vote is secret
    const s = await r.a.state();
    assert.equal(s.storia.phase, 'read');
    assert.ok(!JSON.stringify(s.storia).includes('"p":'), 'no author while reading');
    assert.equal(s.storia.result, null);
});

test('player text: HTML stays inert text, control characters are removed, spaces collapse, 200 characters at most; the client never uses innerHTML', async () => {
    const r = await room({}, 3);
    await r.a.post({ action: 'start' });
    const [w1, w2, w3] = r.game().turns;
    const evil = '<img src=x onerror=alert(1)>\u0000\u0007 ok‮ ​go\n\nnow';
    assert.equal((await write(r, w1, evil)).status, 200);
    let t = r.game().story[1].text;
    assert.ok(!/[\u0000-\u001f‮​]/.test(t), 'control and direction characters are gone: ' + JSON.stringify(t));
    assert.equal(t, '<img src=x onerror=alert(1)> ok go now');
    assert.equal((await write(r, w2, 'é'.repeat(500))).status, 200);
    t = r.game().story[2].text;
    assert.equal([...t].length, 200);
    assert.equal((await write(r, w3, '…')).status, 409, 'the skip mark cannot be typed');
    const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'storia', 'game.js'), 'utf8');
    assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML|document\.write|onclick\s*=\s*['"`]/.test(js), 'player text goes in with textContent only');
});

test('the turn timer is a server instant: no timer means no deadline; an expired turn becomes "…" and the next player gets the last real sentence', async () => {
    const none = await room({}, 3);
    await none.a.post({ action: 'start' });
    const sn = (await none.a.state()).storia;
    assert.equal(sn.ends_at, null); assert.equal(sn.left, null);

    const r = await room({ timer: 30 }, 3);
    await r.a.post({ action: 'start' });
    const [w1, w2] = r.game().turns;
    let P = (await r.a.state()).storia;
    assert.ok(P.left > 25 && P.left <= 30, 'the client gets the time left: ' + P.left);
    assert.ok(Math.abs(P.ends_at - (Date.now() / 1000 + P.left)) < 3);
    assert.equal((await write(r, w1, 'REAL_ONE')).status, 200);
    late(r, 'ends_at');                          // the deadline of w2 passes
    P = (await r.a.state()).storia;
    assert.equal(r.game().story[2].text, '…'); assert.equal(r.game().story[2].k, 'skip'); assert.equal(r.game().story[2].p, w2);
    assert.ok(P.events.some((e) => e.t === 'timeout' && e.p === w2));
    assert.equal(P.writer, r.game().turns[2]);
    assert.ok(P.left > 25, 'a fresh timer for the next writer');
    assert.equal((await write(r, w2, 'too late')).status, 409);
    const raw = await who(r, P.writer).raw();
    assert.ok(raw.includes('REAL_ONE'), 'the last real sentence is what the next writer reads');
});

test('reading, the secret vote and the end: lines appear one at a time, you cannot vote for yourself, nobody sees the votes, the winner is the most voted line', async () => {
    const r = await room({}, 3);
    await r.a.post({ action: 'start' });
    const turns = await writeAll(r);
    let P = (await r.a.state()).storia;
    assert.equal(P.phase, 'read'); assert.equal(P.story.length, 1, 'the opening is first'); assert.equal(P.story[0].t, OPEN);
    assert.equal((await r.phones[1].post({ action: 'next' })).status, 403, 'host only');
    late(r, 'next_at');
    P = (await r.a.state()).storia;
    assert.ok(P.story.length >= 2, 'the server clock showed the next sentence');
    assert.ok(P.read_left > 0);
    for (let i = 0; i < 4 && P.phase === 'read'; i++) { assert.equal((await r.a.post({ action: 'next' })).status, 200); P = (await r.a.state()).storia; }
    assert.equal(P.phase, 'vote'); assert.equal(P.story.length, 4);
    assert.ok(!JSON.stringify(P).includes('"p":'), 'no author in the vote');
    // lines: index 0 opening, 1..3 written by turns[0..2]
    const mine = (pid) => 1 + turns.indexOf(pid);
    assert.equal((await vote(r, turns[0], mine(turns[0]))).status, 409, 'not your own sentence');
    assert.equal((await vote(r, turns[0], 0)).status, 409, 'not the opening');
    assert.equal((await vote(r, turns[0], 9)).status, 409, 'not a line');
    assert.equal((await vote(r, turns[0], mine(turns[1]))).status, 200);
    assert.equal((await vote(r, turns[0], mine(turns[2]))).status, 200, 'a vote can be changed until the end');
    // secret: another phone sees THAT P voted but not for what
    const other = who(r, turns[1]);
    const view = (await other.state()).storia;
    assert.ok(view.voted.includes(turns[0])); assert.deepEqual(view.my_votes, {});
    assert.equal((await vote(r, turns[1], mine(turns[2]))).status, 200);
    assert.equal((await r.a.state()).storia.phase, 'vote');
    assert.equal((await vote(r, turns[2], mine(turns[1]))).status, 200, 'the last vote closes it');
    P = (await r.a.state()).storia;
    assert.equal(P.status, 'ended'); assert.equal(P.result.reason, 'done');
    assert.equal(P.result.top, 2); assert.deepEqual(P.result.winners, [turns[2]]);
    assert.deepEqual(P.result.story.map((l) => l.p), [null, ...turns], 'the authors come out at the end');
    assert.equal(P.result.story[0].text, OPEN); assert.equal(P.result.story[mine(turns[2])].votes, 2);
    assert.equal((await r.a.post({ action: 'start' })).status, 200, 'a new story');
    assert.equal((await r.a.state()).storia.match, 2);
});

test('the host closes the vote; with no vote there is no winner; two laps give two sentences each', async () => {
    const r = await room({ rounds: 2 }, 3);
    await r.a.post({ action: 'start' });
    await writeAll(r);
    assert.equal(r.game().story.length, 7);
    const g = r.game(); g.phase = 'vote'; g.shown = 7; g.next_at = null; r.setGame(g);
    assert.equal((await r.phones[1].post({ action: 'next' })).status, 403);
    assert.equal((await r.a.post({ action: 'next' })).status, 200);
    const P = (await r.a.state()).storia;
    assert.equal(P.status, 'ended'); assert.deepEqual(P.result.winners, []); assert.equal(P.result.top, 0);
});

test('moderation: the host removes a sentence (it becomes "…" for everybody, votes for it are dropped) and excludes a player (their turns are skipped); only the host can', async () => {
    const r = await room({ rounds: 2 }, 4);
    await r.a.post({ action: 'start' });
    const turns = r.game().turns;
    assert.equal((await write(r, turns[0], 'BAD_WORDS_HERE')).status, 200);
    assert.equal((await r.phones[1].post({ action: 'remove_line', line: 1 })).status, 403);
    assert.equal((await r.a.post({ action: 'remove_line', line: 0 })).status, 409, 'the opening line is not a player sentence');
    assert.equal((await r.a.post({ action: 'remove_line', line: 1 })).status, 200);
    assert.equal(r.game().story[1].rm, true);
    assert.equal((await r.phones[1].post({ action: 'exclude', target: turns[3] })).status, 403);
    // exclude the next-but-one writer: their turn in lap 1 and lap 2 are skipped
    const out = turns[2];
    assert.equal((await r.a.post({ action: 'exclude', target: out })).status, 200);
    const s = (await who(r, out).state()).storia;
    assert.ok(s.me[0].excluded); assert.ok(!s.active.includes(out));
    assert.equal((await write(r, turns[1], 'second')).status, 200);
    assert.equal((await r.a.state()).storia.writer, turns[3], 'the excluded player is skipped');
    assert.equal((await write(r, out, 'x')).status, 409);
    const rest = r.game().turns.slice(r.game().turn).filter((p) => p !== out);
    for (const p of rest) assert.equal((await write(r, p, 'later')).status, 200);
    let P = (await r.a.state()).storia;
    assert.equal(P.phase, 'read');
    const g = r.game(); g.phase = 'vote'; g.shown = g.story.length; g.next_at = null; r.setGame(g);
    P = (await r.phones[2].state()).storia;
    assert.ok(!JSON.stringify(P.story).includes('BAD_WORDS_HERE'), 'the removed sentence is gone for everybody');
    assert.ok(P.story.some((l) => l.t === '…'));
    assert.equal((await vote(r, turns[3], 1)).status, 409, 'a removed sentence cannot be voted');
    assert.equal((await vote(r, out, 2)).status, 403, 'an excluded player does not vote');
    // fewer than 3 players left ends the story
    const f = await room({}, 3);
    await f.a.post({ action: 'start' });
    assert.equal((await f.a.post({ action: 'exclude', target: f.game().turns[1] })).status, 200);
    assert.equal((await f.a.state()).storia.result.reason, 'too_few');
});

test('the host can skip the turn of somebody who is away, leaving works, the host can end the story', async () => {
    const r = await room({}, 4);
    await r.a.post({ action: 'start' });
    const [w1, w2] = r.game().turns;
    assert.equal((await r.phones[1].post({ action: 'skip' })).status, 403);
    assert.equal((await r.a.post({ action: 'skip' })).status, 200);
    assert.equal(r.game().story[1].text, '…');
    assert.equal((await r.a.state()).storia.writer, w2);
    const leaver = [r.phones[2], r.phones[3]].find((p) => p === who(r, w2)) || r.phones[3];   // never the host nor phones[1] (used below)
    await leaver.post({ action: 'leave' });
    const P = (await r.a.state()).storia;
    const gg = r.game();
    assert.equal(gg.gone.length, 1);
    assert.ok(P.phase !== 'write' || (P.writer !== null && !gg.gone.includes(P.writer)), 'a leaving writer does not block the story');
    assert.equal((await r.phones[1].post({ action: 'end' })).status, 403);
    if (P.status === 'play') { assert.equal((await r.a.post({ action: 'end' })).status, 200); assert.equal((await r.a.state()).storia.result.reason, 'host_ended'); }
    void w1;
});

test('one phone for everybody: the phone holds all players, only the current writer gets the sentence, the same phone votes for each player', async () => {
    const a = await Phone.fresh();
    const code = (await a.post({ action: 'create', game: 'storia', players: ['X', 'Y', 'Z'], settings: { own: OPEN } })).json.code;
    assert.equal((await a.post({ action: 'start' })).status, 200);
    let s = (await a.state()).storia;
    assert.equal(s.me.length, 3); assert.equal(s.me.filter((m) => m.writing).length, 1);
    const turns = [];
    for (let i = 0; i < 3; i++) {
        s = (await a.state()).storia;
        const cur = s.me.find((m) => m.writing).player_id;
        turns.push(cur);
        assert.equal(s.prev.player_id, cur);
        assert.equal(s.prev.text, i === 0 ? OPEN : 'L' + i);
        assert.equal((await a.post({ action: 'write', player_id: cur, text: 'L' + (i + 1) })).status, 200);
    }
    assert.equal(new Set(turns).size, 3);
    const g = JSON.parse(site.db('SELECT state FROM storia_games WHERE room_id = (SELECT id FROM spia_rooms WHERE code = ?)', [code])[0].state);
    assert.equal(g.phase, 'read');
    // jump to the vote (the clock) and vote for the three players from the same phone
    s = (await a.state()).storia;
    for (let i = 0; i < 6 && s.phase === 'read'; i++) { await a.post({ action: 'next' }); s = (await a.state()).storia; }
    assert.equal(s.phase, 'vote');
    assert.equal(s.me.filter((m) => m.can_vote).length, 3);
    assert.deepEqual(Object.keys(s.my_lines).sort(), turns.map(String).sort(), 'the phone knows which lines are its players');
    assert.equal((await a.post({ action: 'vote', player_id: turns[0], line: s.my_lines[turns[0]][0] })).status, 409, 'not their own');
    for (const [i, pid] of turns.entries()) {
        const target = s.my_lines[turns[(i + 1) % 3]][0];
        assert.equal((await a.post({ action: 'vote', player_id: pid, line: target })).status, 200);
    }
    s = (await a.state()).storia;
    assert.equal(s.status, 'ended'); assert.equal(s.result.winners.length, 3, 'one vote each: a three-way tie');
});

test('the admin LIVE view shows the whole story with who wrote what; a normal visitor cannot see it', async () => {
    const r = await room({}, 3);
    await r.a.post({ action: 'start' });
    const turns = r.game().turns;
    await write(r, turns[0], 'LIVE_ONE');
    await write(r, turns[1], 'LIVE_TWO');
    const admin = await makeAdmin(site, 'storia_admin');
    const live = (await admin.get('/api/spia.php?action=live')).json.rooms.find((x) => x.code === r.code);
    assert.equal(live.game, 'storia');
    assert.equal(live.storia.phase, 'write'); assert.equal(live.storia.writer, turns[2]);
    assert.deepEqual(live.storia.story.map((l) => [l.p, l.text]), [[null, OPEN], [turns[0], 'LIVE_ONE'], [turns[1], 'LIVE_TWO']]);
    assert.equal((await new Client(site).get('/api/spia.php?action=live')).status !== 200, true);
    assert.match((await admin.get('/api/spia.php?action=ext')).text, /storia/i, 'the admin script knows the game');
});

test('translations: the five languages have the same keys, every key the game uses exists, the help and intro texts are complete', () => {
    const dict = { it: {}, en: {}, es: {}, fr: {}, de: {} };
    const win = { SpiaI18n: { strings: dict } };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'storia', 'texts.js'), 'utf8'), { window: win });
    const keys = Object.keys(dict.en);
    assert.ok(keys.length > 100);
    for (const l of ['it', 'es', 'fr', 'de']) {
        assert.deepEqual(Object.keys(dict[l]).sort(), keys.slice().sort(), l + ' has the same keys as English');
        for (const k of keys) assert.ok(String(dict[l][k]).trim(), `${l}.${k} is empty`);
    }
    const placeholders = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
    for (const k of keys) for (const l of ['it', 'es', 'fr', 'de']) assert.equal(placeholders(dict[l][k]), placeholders(dict.en[k]), `${l}.${k} placeholders`);
    const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'storia', 'game.js'), 'utf8');
    for (const m of js.matchAll(/'(st_[a-z_]+)'/g)) if (!m[1].endsWith('_')) assert.ok(keys.includes(m[1]), 'game.js uses an unknown key ' + m[1]);
    for (const k of ['mix', 'mystery', 'fantasy', 'daily', 'scifi', 'absurd']) assert.ok(keys.includes('st_genre_' + k), k);
    for (const k of ['done', 'host_ended', 'too_few']) assert.ok(keys.includes('st_reason_' + k), k);
    for (const k of ['start', 'timeout', 'left', 'excluded', 'removed', 'read', 'vote', 'voted', 'end']) assert.ok(keys.includes('st_ev_' + k), k);
    for (const k of ['st_title', 'st_tagline', 'st_one_phone_note', 'st_need_three', 'st_start', 'st_new_match', 'st_settings_next_match', 'intro_st_1', 'intro_st_2_t', 'intro_st_3',
        'help_st_basics_t', 'help_st_rounds', 'help_st_vote', 'help_st_host', 'help_st_settings', 'err_need_players_storia', 'err_not_your_turn', 'err_bad_text', 'err_own_line', 'err_bad_vote']) assert.ok(keys.includes(k), k);
    for (const m of fs.readFileSync(path.join(ROOT, 'public', 'js', 'spia', 'app.js'), 'utf8').matchAll(/(?:title|tagline|note|need): '(st_\w+)'/g)) assert.ok(keys.includes(m[1]), m[1]);
    for (const m of fs.readFileSync(path.join(ROOT, 'public', 'api', 'storia_lib.php'), 'utf8').matchAll(/return '([a-z_]+)';/g)) {
        if (/^(host_only|not_now|not_your_player|you_are_out|round_running|no_round)$/.test(m[1])) continue;
        assert.ok(keys.includes('err_' + m[1]), 'no text for the error ' + m[1]);
    }
});

test('the page is served with its files, is listed in the games and the sitemap, and the style respects accessibility settings', async () => {
    const html = await (await fetch(`${site.base}/pages/storia.html`)).text();
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'no inline scripts');
    assert.match(html, /data-game="storia"/);
    for (const f of ['/js/storia/game.js', '/js/storia/texts.js', '/css/storia.css', '/assets/storia/icon.svg', '/assets/storia/manifest.json']) assert.equal((await fetch(site.base + f)).status, 200, f);
    const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'storia.css'), 'utf8');
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.match(css, /:focus-visible/);
    const games = await (await fetch(`${site.base}/pages/giochi.php`)).text();
    const map = await (await fetch(`${site.base}/sitemap.php`)).text();
    assert.ok(games.includes('storia.html') && map.includes('pages/storia.html'));
});
