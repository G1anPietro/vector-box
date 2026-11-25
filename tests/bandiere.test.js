// tests/bandiere.test.js — Bandiere rooms (flags and capitals quiz): the country data in 5 languages, secrecy of the right
// answer, options (no duplicates, the right one inside), level and kind chosen by the host, scoring by the server, lives,
// rounds, leaving, alone / one phone (sealed token), personal records, the admin LIVE view, the page files
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

const BANK = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'lib', 'bandiere-q.json'), 'utf8'));
const LANGS = ['it', 'en', 'es', 'fr', 'de'];

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

/** Phone A (host) has P1, B has P2, C has P3 (n = number of players). */
async function room(settings = {}, n = 3) {
    try { site.db('DELETE FROM rate_limits'); } catch (e) { /* not created yet */ }
    const a = await Phone.fresh();
    const code = (await a.post({ action: 'create', game: 'bandiere', players: ['P1'], settings })).json.code;
    const phones = [a];
    for (let i = 2; i <= n; i++) { const p = await Phone.fresh(); await p.post({ action: 'join', code }); await p.post({ action: 'player_add', name: 'P' + i }); phones.push(p); }
    const s = await a.state();
    const id = Object.fromEntries(s.players.map((p) => [p.name, p.id]));
    const where = 'room_id = (SELECT id FROM spia_rooms WHERE code = ?)';
    const game = () => JSON.parse(site.db(`SELECT state FROM bandiere_games WHERE ${where}`, [code])[0].state);
    const setGame = (g) => site.db(`UPDATE bandiere_games SET state = ? WHERE ${where}`, [JSON.stringify(g), code]);
    return { a, b: phones[1], c: phones[2], phones, code, id, game, setGame };
}
const ans = (r, who, choice) => r.phones[who - 1].post({ action: 'answer', player_id: r.id['P' + who], choice });
const right = (r) => r.game().q.right;
const wrong = (r) => (right(r) + 1) % 4;
/** Skips the reveal: the next round (or the end) starts at the next poll. */
async function skip(r) { const g = r.game(); g.phase = 'reveal'; g.next_at = 0; r.setGame(g); return (await r.a.state()).bandiere; }

test('the country data: 120+ countries, valid ISO codes, 5 languages for every name and capital, no duplicates', () => {
    assert.ok(BANK.length >= 120);
    for (const d of [0, 1, 2]) assert.ok(BANK.filter((r) => r[1] === d).length >= 20, 'difficulty ' + d);
    assert.equal(new Set(BANK.map((r) => r[0])).size, BANK.length, 'unique ISO codes');
    for (const [iso, d, region, names, caps] of BANK) {
        assert.match(iso, /^[A-Z]{2}$/); assert.ok([0, 1, 2].includes(d)); assert.match(region, /^(EU|AS|AF|NA|SA|OC)$/);
        for (const arr of [names, caps]) {
            assert.equal(arr.length, 5, iso);
            assert.ok(arr.every((x) => typeof x === 'string' && x.trim() === x && x.length >= 2), iso + ' needs a text in every language');
        }
    }
    for (let l = 0; l < 5; l++) {
        assert.equal(new Set(BANK.map((r) => r[3][l])).size, BANK.length, 'names unique in ' + LANGS[l]);
        assert.equal(new Set(BANK.map((r) => r[4][l])).size, BANK.length, 'capitals unique in ' + LANGS[l]);
    }
    // contested territories are not in the list
    for (const iso of ['TW', 'XK', 'PS', 'EH']) assert.ok(!BANK.some((r) => r[0] === iso), iso);
});

test('the interface texts are complete in the five languages and every key the page uses exists', () => {
    const S = Object.fromEntries(LANGS.map((l) => [l, {}]));
    const win = { SpiaI18n: { strings: S } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'bandiere', 'texts.js'), 'utf8'), { window: win });
    const keys = Object.keys(S.en);
    assert.ok(keys.length > 80);
    for (const l of LANGS) {
        assert.deepEqual(Object.keys(S[l]).sort(), [...keys].sort(), l + ' has the same keys as English');
        for (const k of keys) assert.ok(typeof S[l][k] === 'string' && S[l][k].trim(), `${l}.${k}`);
    }
    for (const k of keys) for (const l of LANGS) assert.deepEqual((S[l][k].match(/\{\w+\}/g) || []).sort(), (S.en[k].match(/\{\w+\}/g) || []).sort(), `${l}.${k}: same placeholders`);
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'bandiere', 'game.js'), 'utf8');
    const used = new Set([...js.matchAll(/\bt\('(bd_[a-z_0-9]+)'/g)].map((m) => m[1]));
    for (const k of used) assert.ok(k.endsWith('_') || k in S.en, 'game.js uses ' + k);   // "bd_level_" + x is built at run time
    for (const k of ['bd_level_', 'bd_mode_', 'bd_reason_']) assert.ok(keys.some((x) => x.startsWith(k)));
    for (const lv of ['easy', 'normal', 'hard', 'mix']) assert.ok(('bd_level_' + lv) in S.en);
    for (const m of ['flag', 'name', 'capital', 'mix']) assert.ok(('bd_mode_' + m) in S.en);
    for (const w of ['rounds_done', 'all_out', 'last_standing', 'host_ended']) assert.ok(('bd_reason_' + w) in S.en);
    for (const k of ['err_need_players_bandiere', 'intro_bd_1', 'intro_bd_3_t', 'help_bd_basics', 'help_bd_settings_t']) assert.ok(k in S.en, k);
    // a flag that asks for the name of its country must not carry the answer in its text alternative
    assert.match(js, /flag\(q\.flag, t\('bd_flag_alt'\)/);
});

test('migration V58 created bandiere_games; settings are cleaned; one player is not enough', async () => {
    await fetch(`${site.base}/api/rooms.php`);
    assert.ok(site.db('PRAGMA user_version')[0].user_version >= 58);
    assert.ok(site.db("SELECT name FROM sqlite_master WHERE name = 'bandiere_games'").length);
    const a = await Phone.fresh();
    await a.post({ action: 'create', game: 'bandiere', players: ['Solo'], settings: { level: 'nope', mode: 'x', rounds: 7, lives: 99, scores: true } });
    const s = await a.state();
    assert.equal(s.game, 'bandiere');
    assert.deepEqual(s.settings, { level: 'mix', mode: 'mix', rounds: 10, lives: 5, scores: true });
    assert.equal((await a.post({ action: 'start' })).status, 409);
});

test('the right answer never reaches a phone before the round is over; options are four, distinct, and hold the right one', async () => {
    for (const mode of ['flag', 'name', 'capital']) {
        const r = await room({ mode });
        assert.equal((await r.a.post({ action: 'start' })).status, 200);
        const g = r.game(), row = BANK[g.q.i];
        assert.equal(g.q.opts.length, 4); assert.equal(new Set(g.q.opts).size, 4); assert.equal(g.q.opts[g.q.right], g.q.i);
        for (const ph of r.phones) {
            const s = await ph.state(), B = s.bandiere;
            assert.equal(B.phase, 'question'); assert.equal(B.reveal, null);
            assert.ok(B.q.left > 0 && B.q.time === 15);
            assert.ok(!JSON.stringify(s).includes('"right"'), 'no right answer anywhere in the view');
            if (mode === 'name') {
                assert.equal(B.q.kind, 'n2f'); assert.equal(B.q.flag, null);
                assert.equal(B.q.options.length, 4); assert.equal(new Set(B.q.options).size, 4);
                assert.equal(B.q.options[g.q.right], row[0], 'the right flag is among the options');
                assert.deepEqual(B.q.prompt, Object.fromEntries(LANGS.map((l, k) => [l, row[3][k]])));
            } else {
                for (const [l, k] of LANGS.map((l, k) => [l, k])) {
                    const o = B.q.options[l];
                    assert.equal(o.length, 4); assert.equal(new Set(o).size, 4);
                    assert.equal(o[g.q.right], row[mode === 'flag' ? 3 : 4][k], 'the right text is among the options in ' + l);
                }
                assert.equal(B.q.flag, row[0]);
                assert.equal(B.q.kind, mode === 'flag' ? 'f2n' : 'cap');
                if (mode === 'flag') assert.equal(B.q.prompt, null, 'the name is not given when the flag is the question');
            }
        }
    }
});

test('wrong options come from the same difficulty, and from the same region when possible', async () => {
    const r = await room({ level: 'easy', mode: 'flag' }, 2);
    await r.a.post({ action: 'start' });
    for (let i = 0; i < 8; i++) {
        const g = r.game(), d = BANK[g.q.i][1], reg = BANK[g.q.i][2];
        const regionPool = BANK.filter((x) => x[1] === d && x[2] === reg).length;
        for (const j of g.q.opts) assert.equal(BANK[j][1], d, 'same difficulty');
        if (regionPool >= 4) for (const j of g.q.opts) assert.equal(BANK[j][2], reg, 'same region');
        await skip(r);
    }
});

test('the host chooses level and kind; only those are asked, and no country twice in a match', async () => {
    const r = await room({ level: 'hard', mode: 'capital' }, 2);
    await r.a.post({ action: 'start' });
    const seen = new Set();
    for (let i = 0; i < 9; i++) {
        const g = r.game();
        assert.equal(BANK[g.q.i][1], 2, 'hard = small countries'); assert.equal(g.q.kind, 'cap');
        assert.ok(!seen.has(g.q.i)); seen.add(g.q.i);
        await skip(r);
    }
    const m = await room({ level: 'mix', mode: 'mix' }, 2);
    await m.a.post({ action: 'start' });
    const kinds = new Set(), diffs = new Set();
    for (let i = 0; i < 9; i++) { kinds.add(m.game().q.kind); diffs.add(BANK[m.game().q.i][1]); await skip(m); }
    assert.ok(kinds.size >= 2 && diffs.size >= 2, 'mix: the server varies the kind and the difficulty');
    const e = await room({ level: 'easy', mode: 'name' }, 2);
    await e.a.post({ action: 'start' });
    assert.equal(BANK[e.game().q.i][1], 0); assert.equal(e.game().q.kind, 'n2f');
});

test('answer checks: not your player, twice, out of range', async () => {
    const r = await room();
    await r.a.post({ action: 'start' });
    assert.equal((await r.a.post({ action: 'answer', player_id: r.id.P2, choice: 0 })).status, 403);
    assert.equal((await ans(r, 1, 7)).status, 409); assert.equal((await ans(r, 1, 'a')).status, 409); assert.equal((await ans(r, 1, -1)).status, 409);
    assert.equal((await ans(r, 1, 0)).status, 200);
    assert.equal((await ans(r, 1, 1)).status, 409, 'already answered');
    assert.equal((await r.a.post({ action: 'next' })).status, 409, 'not in a reveal');
});

test('the server judges and times: right = 100-200 points (faster is more), wrong or missing = 0; the phone sends no time', async () => {
    const r = await room();
    await r.a.post({ action: 'start' });
    const g = r.game(); g.q.started -= 10; g.q.deadline -= 10 - 5; r.setGame(g);   // 10 s ago, 5 s left
    await ans(r, 1, right(r));   // slow: about 10 s of 15
    await ans(r, 3, wrong(r));
    assert.deepEqual((await r.a.state()).bandiere.answered.sort(), [r.id.P1, r.id.P3].sort(), 'who answered is public');
    const g2 = r.game(); g2.q.started = g2.q.deadline - g2.q.time; r.setGame(g2);   // nobody else is late: the time is up for P2
    const B = (await skipTimeout(r)).bandiere;
    const slow = B.points[r.id.P1];
    assert.ok(slow >= 100 && slow < 160, 'slow right answer ' + slow);
    assert.equal(B.points[r.id.P2], 0); assert.equal(B.points[r.id.P3], 0);
    assert.equal(B.reveal.right, r.game().q.right);
    assert.deepEqual(Object.keys(B.reveal.gain), [String(r.id.P1)]);
    assert.equal(B.reveal.info.iso, BANK[r.game().q.i][0]); assert.equal(B.reveal.info.labels.en.length, 4);
    // a fast right answer scores more
    const f = await room();
    await f.a.post({ action: 'start' });
    await ans(f, 1, right(f)); await ans(f, 2, wrong(f)); await ans(f, 3, wrong(f));
    const fast = (await f.a.state()).bandiere.points[f.id.P1];
    assert.ok(fast > 180 && fast <= 200, 'fast right answer ' + fast);
    // a choice sent with a made-up time is not looked at
    const t = await room(); await t.a.post({ action: 'start' });
    await t.a.post({ action: 'answer', player_id: t.id.P1, choice: right(t), ms: 1, time: 1 });
    assert.ok(t.game().answers[t.id.P1].ms < 5000, 'the time is the server\'s own');
});
async function skipTimeout(r) { const g = r.game(); g.q.deadline = Date.now() / 1000 - 1; r.setGame(g); return { bandiere: (await r.b.state()).bandiere }; }

test('everybody answers: the round ends at once; time out: the missing answer scores nothing and the next round starts by itself', async () => {
    const r = await room({}, 2);
    await r.a.post({ action: 'start' });
    await ans(r, 1, right(r));
    let B = (await r.a.state()).bandiere; assert.equal(B.phase, 'question');
    await ans(r, 2, wrong(r));
    B = (await r.a.state()).bandiere; assert.equal(B.phase, 'reveal'); assert.ok(B.next_left > 0);
    B = await skip(r); assert.equal(B.phase, 'question'); assert.equal(B.round, 2); assert.equal(B.reveal, null);
    await ans(r, 1, right(r));
    const g = r.game(); g.q.deadline = Date.now() / 1000 - 1; r.setGame(g);
    B = (await r.b.state()).bandiere; assert.equal(B.phase, 'reveal'); assert.equal(B.reveal.answers[r.id.P2], undefined);
    assert.equal((await ans(r, 2, 0)).status, 409, 'too late');
});

test('the host can skip the reveal; others cannot', async () => {
    const r = await room();
    await r.a.post({ action: 'start' });
    await ans(r, 1, right(r)); await ans(r, 2, right(r)); await ans(r, 3, wrong(r));
    assert.equal((await r.b.post({ action: 'next' })).status, 403);
    assert.equal((await r.a.post({ action: 'next' })).status, 200);
    assert.equal((await r.a.state()).bandiere.round, 2);
});

test('the chosen number of rounds, then the most points win; a tie shares the win; the point of the room is given once', async () => {
    const r = await room({ rounds: 10, scores: true }, 3);
    await r.a.post({ action: 'start' });
    assert.equal((await r.a.state()).bandiere.total, 10);
    const g = r.game(); g.round = 10; g.points = { [r.id.P1]: 300, [r.id.P2]: 450, [r.id.P3]: 450 }; r.setGame(g);
    let B = (await skip(r));
    assert.equal(B.status, 'ended'); assert.equal(B.result.reason, 'rounds_done');
    assert.deepEqual(B.result.winners.sort(), [r.id.P2, r.id.P3].sort());
    const s = await r.a.state(); await r.a.state();
    assert.deepEqual(s.players.map((p) => p.score), [0, 1, 1]);
    assert.equal((await r.a.post({ action: 'start' })).status, 200, 'a new match');
    B = (await r.a.state()).bandiere; assert.equal(B.match, 2); assert.equal(B.round, 1);
    assert.deepEqual(Object.values(B.points), [0, 0, 0]);
    for (const n of [20, 30]) { const x = await room({ rounds: n }, 2); await x.a.post({ action: 'start' }); assert.equal((await x.a.state()).bandiere.total, n); }
});

test('lives: a mistake costs one, at zero you are out; the match ends when one is left or all are out; no lives = nobody is out', async () => {
    const r = await room({ lives: 2 }, 3);
    await r.a.post({ action: 'start' });
    await ans(r, 1, right(r)); await ans(r, 2, right(r)); await ans(r, 3, wrong(r));
    let B = (await r.a.state()).bandiere;
    assert.equal(B.lives[r.id.P3], 1); assert.deepEqual(B.reveal.fell, []); assert.equal(B.alive.length, 3);
    await skip(r);
    await ans(r, 1, right(r)); await ans(r, 2, right(r)); await ans(r, 3, wrong(r));
    B = (await r.a.state()).bandiere;
    assert.deepEqual(B.reveal.fell, [r.id.P3]); assert.deepEqual(B.alive.sort(), [r.id.P1, r.id.P2].sort());
    await skip(r);
    assert.equal((await ans(r, 3, 0)).status, 403, 'P3 is out');
    await ans(r, 1, right(r)); await ans(r, 2, wrong(r));
    await skip(r); await ans(r, 1, right(r)); await ans(r, 2, wrong(r));
    B = (await skip(r));
    assert.equal(B.status, 'ended'); assert.equal(B.result.reason, 'last_standing'); assert.deepEqual(B.result.winners, [r.id.P1]);

    const n = await room({ lives: 0 }, 2);
    await n.a.post({ action: 'start' });
    for (let i = 0; i < 4; i++) { await ans(n, 1, wrong(n)); await ans(n, 2, wrong(n)); await skip(n); }
    B = (await n.a.state()).bandiere; assert.equal(B.alive.length, 2); assert.equal(B.status, 'play'); assert.equal(B.round, 5);

    const o = await room({ lives: 1 }, 2);
    await o.a.post({ action: 'start' });
    await ans(o, 1, wrong(o)); await ans(o, 2, wrong(o));
    B = await skip(o);
    assert.equal(B.status, 'ended'); assert.equal(B.result.reason, 'all_out'); assert.deepEqual(B.result.winners, []);
});

test('leaving, ending, and several players on one phone', async () => {
    const r = await room({}, 2);
    await r.a.post({ action: 'start' });
    await r.b.post({ action: 'leave' });
    let B = (await r.a.state()).bandiere;
    assert.deepEqual(B.alive, [r.id.P1]); assert.equal(B.status, 'play', 'one player can still finish the round');
    await ans(r, 1, right(r));
    assert.equal((await r.a.state()).bandiere.phase, 'reveal', 'the round does not wait for the one who left');

    const e = await room();
    await e.a.post({ action: 'start' });
    assert.equal((await e.b.post({ action: 'end' })).status, 403);
    assert.equal((await e.a.post({ action: 'end' })).status, 200);
    assert.equal((await e.a.state()).bandiere.result.reason, 'host_ended');

    const a = await Phone.fresh();
    await a.post({ action: 'create', game: 'bandiere', players: ['X', 'Y'] });
    assert.equal((await a.post({ action: 'start' })).status, 200);
    const me = (await a.state()).bandiere.me;
    assert.equal(me.length, 2); assert.ok(me.every((m) => m.alive && !m.answered));
});

test('the admin LIVE view shows the right option and what everybody chose; a normal visitor cannot see it', async () => {
    const r = await room({ mode: 'name' });
    await r.a.post({ action: 'start' });
    await ans(r, 1, 2);
    const admin = await makeAdmin(site, 'bandiere_admin');
    const live = (await admin.get('/api/spia.php?action=live')).json.rooms.find((x) => x.code === r.code);
    assert.equal(live.game, 'bandiere');
    assert.equal(live.bandiere.phase, 'question'); assert.equal(live.bandiere.right, r.game().q.right); assert.equal(live.bandiere.answers[r.id.P1], 2);
    assert.equal(live.bandiere.options.en.length, 4); assert.equal(live.bandiere.kind, 'n2f');
    assert.equal(live.bandiere.options.it[live.bandiere.right], BANK[r.game().q.i][3][0], 'the admin reads the name of the right flag');
    assert.equal((await new Client(site).get('/api/spia.php?action=live')).status !== 200, true);
    const ext = await admin.get('/api/spia.php?action=ext');
    assert.match(ext.text, /bandiere/i, 'the admin script knows Bandiere rooms');
});

// ----- alone / one phone: sealed token, no table -----
const get = async (qs) => (await fetch(`${site.base}/api/bandiere_solo.php?action=question&${qs}`)).json();

test('alone: the question has no answer in it, the token is sealed, the server checks it; no CSRF, no check', async () => {
    const q = await get('level=normal&mode=flag');
    assert.equal(q.success, true); assert.equal(q.kind, 'f2n'); assert.equal(q.options.en.length, 4); assert.ok(q.time >= 12);
    assert.ok(!/"right"|"answer"|"results"/.test(JSON.stringify(q)), 'no right answer in the question');
    assert.throws(() => JSON.parse(Buffer.from(q.token.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1')), 'the token is encrypted, not readable JSON');
    const c = await new Client(site).init();
    const all = (await c.post('/api/bandiere_solo.php', { token: q.token, choices: [0, 1, 2, 3], pass: true })).json;
    assert.equal(all.results.filter(Boolean).length, 1); assert.equal(all.results[all.right], true);
    assert.deepEqual(all.points.filter((p) => p), [100], 'one phone: no speed bonus');
    assert.equal(all.iso, q.flag); assert.equal(all.labels.en[all.right], BANK.find((x) => x[0] === q.flag)[3][1]);
    const one = (await c.post('/api/bandiere_solo.php', { token: q.token, choices: [all.right] })).json;
    assert.ok(one.points[0] > 180 && one.points[0] <= 200, 'alone: speed bonus ' + one.points[0]);
    const bad = (await c.post('/api/bandiere_solo.php', { token: q.token, choices: [(all.right + 1) % 4, null] })).json;
    assert.deepEqual([bad.results[0], bad.results[1], bad.points[0]], [false, false, 0], 'wrong or no answer');
    assert.equal((await c.post('/api/bandiere_solo.php', { token: q.token + 'x', choices: [0] })).status, 400, 'tampered token');
    assert.equal((await c.post('/api/bandiere_solo.php', { token: 'abc', choices: [0] })).status, 400);
    assert.equal((await c.post('/api/bandiere_solo.php', { token: q.token, choices: [] })).status, 400);
    assert.equal((await c.post('/api/bandiere_solo.php', { token: q.token, choices: new Array(9).fill(0) })).status, 400);
    const noCsrf = await fetch(`${site.base}/api/bandiere_solo.php`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: q.token, choices: [0] }) });
    assert.notEqual(noCsrf.status, 200);
    assert.equal((await fetch(`${site.base}/api/bandiere_solo.php?action=nope`)).status, 400);
});

test('alone: level and kind are honoured, a country already seen is not asked again, the three kinds look right', async () => {
    const c = await new Client(site).init();
    const rightOf = async (q) => (await c.post('/api/bandiere_solo.php', { token: q.token, choices: [0, 1, 2, 3], pass: true })).json;
    const seen = [];
    for (let i = 0; i < 10; i++) {
        const q = await get(`level=easy&mode=name&exclude=${seen.join(',')}`);
        assert.equal(q.kind, 'n2f'); assert.equal(q.flag, null); assert.equal(new Set(q.options).size, 4);
        const j = await rightOf(q);
        assert.equal(BANK.find((x) => x[0] === j.iso)[1], 0, 'easy = well-known countries'); assert.equal(q.options[j.right], j.iso);
        assert.ok(!seen.includes(q.sid)); seen.push(q.sid);
    }
    const cap = await get('level=hard&mode=capital');
    assert.equal(cap.kind, 'cap'); assert.ok(cap.prompt.en && cap.flag); assert.equal(new Set(cap.options.fr).size, 4);
    assert.equal(BANK.find((x) => x[0] === cap.flag)[1], 2);
    const kinds = new Set();
    for (let i = 0; i < 14; i++) kinds.add((await get('level=mix&mode=mix')).kind);
    assert.ok(kinds.size >= 2, 'mix varies the kind');
    const junk = await get('level=zzz&mode=zzz&exclude=%3Cb%3E,1,2');
    assert.equal(junk.success, true);
});

test('records: Bandiere is a personal record per level (points), merged with the account; unknown levels are refused', async () => {
    try { site.db('DELETE FROM rate_limits'); } catch (e) { /* not created yet */ }
    const c = await new Client(site).init(); await c.register('bandiere_rec');
    const sub = (variant, value) => c.post('/api/records.php', { action: 'submit', game: 'bandiere', variant, value });
    assert.equal((await sub('easy', 640)).json.best, 640);
    assert.deepEqual([(await sub('easy', 300)).json.best, (await sub('easy', 300)).json.improved], [640, false]);
    assert.equal((await sub('mix', 250)).json.best, 250);
    assert.equal((await sub('rising', 5)).status, 400); assert.equal((await sub('easy', 0)).status, 400); assert.equal((await sub('easy', 'x')).status, 400);
    const r = (await c.post('/api/records.php', { action: 'sync', game: 'bandiere', bests: { easy: 10, hard: 900, normal: -1 } })).json;
    assert.deepEqual(r.bests, { easy: 640, hard: 900, mix: 250 });
    const mine = (await c.get('/api/records.php')).json.records;
    assert.equal(mine.bandiere.hard.best, 900);
});

test('the Flags page and its files are served, in the game list and the sitemap; no inline script; the page loads the records script', async () => {
    const games = await (await fetch(`${site.base}/pages/giochi.php`)).text();
    const map = await (await fetch(`${site.base}/sitemap.php`)).text();
    const html = await (await fetch(`${site.base}/pages/bandiere.html`)).text();
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'no inline scripts');
    assert.match(html, /<html lang="en" data-game="bandiere">/);
    assert.ok(html.indexOf('/js/records.js') > 0 && html.indexOf('/js/records.js') < html.indexOf('/js/bandiere/game.js'));
    for (const f of ['/js/bandiere/game.js', '/js/bandiere/texts.js', '/css/bandiere.css', '/assets/bandiere/icon.svg', '/assets/bandiere/manifest.json']) assert.equal((await fetch(site.base + f)).status, 200, f);
    assert.ok(games.includes('bandiere.html') && map.includes('pages/bandiere.html'));
    assert.match(games, /data-id="bandiere" data-kind="quiz"/);
});
