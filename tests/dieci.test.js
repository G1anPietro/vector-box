// tests/dieci.test.js — "10 out of 10, but…" rooms: the example bank, anonymous sentences (authors only at the reveal), random order,
// no vote for your own sentence, the double-point prize, the family word filter, text limits, the hints (3 each), the clock,
// host tools, one shared phone, a fair rotation, the admin LIVE view, the five languages and the page files
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
const BANK = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib', 'dieci-q.json'), 'utf8'));

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

/** Phone A (host) has P1, B has P2, ... (n players, one per phone). */
async function room(settings = {}, n = 3) {
    try { site.db('DELETE FROM rate_limits'); } catch (e) { /* not created yet */ }
    const a = await Phone.fresh();
    const code = (await a.post({ action: 'create', game: 'dieci', players: ['P1'], settings })).json.code;
    const phones = [a];
    for (let i = 2; i <= n; i++) { const p = await Phone.fresh(); await p.post({ action: 'join', code }); await p.post({ action: 'player_add', name: 'P' + i }); phones.push(p); }
    const s = await a.state();
    const id = Object.fromEntries(s.players.map((p) => [p.name, p.id]));
    const where = 'room_id = (SELECT id FROM spia_rooms WHERE code = ?)';
    const game = () => JSON.parse(site.db(`SELECT state FROM dieci_games WHERE ${where}`, [code])[0].state);
    const setGame = (g) => site.db(`UPDATE dieci_games SET state = ? WHERE ${where}`, [JSON.stringify(g), code]);
    return { a, phones, code, id, game, setGame, n };
}
const write = (r, who, text) => r.phones[who - 1].post({ action: 'write', player_id: r.id['P' + who], text });
const writeAll = async (r, texts) => { for (let i = 1; i <= r.n; i++) await write(r, i, texts ? texts[i - 1] : `flaw ${i}`); };
/** The vote item index of the sentence written by player k (the server keeps the secret mapping, the test reads it from the DB). */
const itemOf = (r, k) => r.game().show.indexOf(r.id['P' + k]);
const vote = (r, who, idx, prize) => r.phones[who - 1].post({ action: 'vote', player_id: r.id['P' + who], idx, ...(prize === undefined ? {} : { prize }) });
const expireWrite = (r) => { const g = r.game(); g.q.deadline = Date.now() / 1000 - 1; r.setGame(g); };
const skipReveal = (r) => { const g = r.game(); g.next_at = Date.now() / 1000 - 1; r.setGame(g); };
const targetNo = (r) => Number(Object.keys(r.id).find((k) => r.id[k] === r.game().q.target).slice(1));

test('the example bank: at least 80 clean examples, five languages, short, no repeats', () => {
    assert.ok(BANK.length >= 80);
    assert.ok(BANK.filter((q) => q[0] === 0).length >= 80, 'enough clean examples for the family filter');
    for (const [i, row] of BANK.entries()) {
        assert.equal(row.length, 6, 'row ' + i);
        assert.ok([0, 1].includes(row[0]));
        assert.ok(row.slice(1).every((x) => typeof x === 'string' && x.trim().length > 4 && [...x].length <= 66 && !/[<>]/.test(x)), 'row ' + i);
    }
    assert.equal(new Set(BANK.map((q) => q[2])).size, BANK.length);
});

test('migration V61 created dieci_games; settings are cleaned; three players are needed', async () => {
    await fetch(`${site.base}/api/rooms.php`);
    assert.ok(site.db('PRAGMA user_version')[0].user_version >= 61);
    const a = await Phone.fresh();
    await a.post({ action: 'create', game: 'dieci', players: ['A', 'B'], settings: { turns: 9, time: 3, family: 'no' } });
    const s = await a.state();
    assert.equal(s.game, 'dieci');
    assert.deepEqual(s.settings, { turns: 1, time: 60, family: true });
    assert.equal((await a.post({ action: 'start' })).status, 409, 'two players are not enough');
    assert.equal((await a.post({ action: 'settings', settings: { turns: 2, time: 90, family: false } })).status, 200);
    assert.deepEqual((await a.state()).settings, { turns: 2, time: 90, family: false });
});

test('the rotation is fair: everybody is the 10/10 once (or twice), the next target never repeats at once', async () => {
    const r = await room({ turns: 2 }, 4);
    await r.a.post({ action: 'start' });
    const q = r.game().queue;
    assert.equal(q.length, 8);
    for (const pid of Object.values(r.id)) assert.equal(q.filter((x) => x === pid).length, 2);
    for (let i = 1; i < q.length; i++) assert.notEqual(q[i], q[i - 1]);
    assert.equal((await r.a.state()).dieci.rounds, 8);
});

test('sentences are anonymous: nobody gets the authors or the texts before the vote, the order is random, own sentence cannot be voted', async () => {
    const r = await room({}, 4);
    await r.a.post({ action: 'start' });
    await write(r, 1, 'alpha'); await write(r, 2, 'bravo');
    for (const ph of r.phones) {
        const s = await ph.state();
        assert.equal(s.dieci.phase, 'write'); assert.equal(s.dieci.items, null);
        assert.deepEqual(s.dieci.wrote.sort(), [r.id.P1, r.id.P2].sort(), 'who wrote is public, not what');
        assert.ok(!JSON.stringify(s).includes('alpha') && !JSON.stringify(s).includes('bravo'));
    }
    await write(r, 3, 'charlie'); await write(r, 4, 'delta');
    for (const ph of r.phones) {
        const s = await ph.state(), P = s.dieci;
        assert.equal(P.phase, 'vote'); assert.equal(P.items.length, 4); assert.equal(P.reveal, null);
        assert.deepEqual(Object.keys(P.items[0]).sort(), ['i', 'text']);
        const raw = JSON.stringify(s);
        assert.ok(!raw.includes('"show"') && !raw.includes('"texts"') && !raw.includes('"author"'), 'no author in the state');
    }
    // own sentence index is told only to its own phone
    const mine = (await r.phones[2].state()).dieci.me;
    assert.deepEqual(mine[0].own, [itemOf(r, 3)]);
    assert.deepEqual((await r.phones[0].state()).dieci.me[0].own, [itemOf(r, 1)]);
    const self = await vote(r, 3, itemOf(r, 3));
    assert.equal(self.status, 409); assert.equal(self.json.error, 'not_yourself');
    assert.equal((await vote(r, 3, 99)).status, 409, 'unknown sentence');
    assert.equal((await r.a.post({ action: 'vote', player_id: r.id.P2, idx: 0 })).status, 403, 'not your player');
    // random order: over several rooms the display order is not always the writing order
    let differs = false;
    for (let k = 0; k < 8 && !differs; k++) {
        const x = await room({}, 4);
        await x.a.post({ action: 'start' });
        await writeAll(x);
        if (x.game().show.join() !== x.game().order.join()) differs = true;
    }
    assert.ok(differs, 'the order is shuffled');
});

test('votes are secret and the winner scores; the prize is only for the 10/10 and is worth double; authors appear at the reveal', async () => {
    const r = await room({}, 4);
    await r.a.post({ action: 'start' });
    const T = targetNo(r);
    await writeAll(r, ['one', 'two', 'three', 'four']);
    const others = [1, 2, 3, 4].filter((k) => k !== T);
    const winner = others[0];                       // the target prizes another sentence
    const prized = others[1];
    // a normal player cannot give the prize; a bad prize is refused; the target cannot prize their own sentence
    const nonTarget = others[2];
    assert.equal((await vote(r, nonTarget, itemOf(r, winner), itemOf(r, prized))).status, 403);
    assert.equal((await vote(r, T, itemOf(r, winner), itemOf(r, T))).status, 409);
    assert.equal((await vote(r, T, itemOf(r, winner), 99)).status, 409);
    // votes: everybody (not for themselves) votes for `winner`; the winner votes for `prized`
    for (const k of [T, nonTarget]) assert.equal((await vote(r, k, itemOf(r, winner), k === T ? itemOf(r, prized) : undefined)).status, 200);
    assert.equal((await vote(r, nonTarget, itemOf(r, winner))).status, 409, 'twice');
    const mid = (await r.phones[0].state()).dieci;
    assert.equal(mid.phase, 'vote');
    assert.ok(!JSON.stringify(mid).includes('"votes"') && mid.reveal === null);
    assert.equal((await vote(r, winner, itemOf(r, prized))).status, 200);
    assert.equal((await r.a.state()).dieci.phase, 'vote', 'one vote still missing');
    assert.equal((await vote(r, prized, itemOf(r, winner))).status, 200);
    const P = (await r.a.state()).dieci;
    assert.equal(P.phase, 'reveal');
    const rows = Object.fromEntries(P.reveal.rows.map((x) => [x.p, x]));
    assert.equal(rows[r.id['P' + winner]].n, 3); assert.equal(rows[r.id['P' + winner]].win, true);
    assert.equal(rows[r.id['P' + prized]].n, 1); assert.equal(rows[r.id['P' + prized]].prize, true); assert.equal(rows[r.id['P' + prized]].win, false);
    assert.equal(rows[r.id['P' + prized]].text, ['one', 'two', 'three', 'four'][prized - 1], 'authors and texts come with the reveal');
    assert.equal(P.scores[r.id['P' + winner]], 1);
    assert.equal(P.scores[r.id['P' + prized]], 2, 'the prize is worth double a win');
    assert.equal(P.scores[r.id['P' + T]], 0);
    assert.ok(P.events.some((e) => e.t === 'prize' && e.p === r.id['P' + prized]));
    assert.ok(P.next_left > 0);
});

test('a tie: every tied sentence scores; the host can skip the reveal, others cannot; the match ends with the standings; a new match starts', async () => {
    const r = await room({ turns: 1 }, 3);
    await r.a.post({ action: 'start' });
    for (let round = 1; round <= 3; round++) {
        assert.equal(r.game().round, round);
        await writeAll(r);
        // everybody votes for the next player (a cycle): every sentence gets one vote, all tie
        for (let k = 1; k <= 3; k++) {
            const T = targetNo(r);
            assert.equal((await vote(r, k, itemOf(r, (k % 3) + 1), k === T ? itemOf(r, (k % 3) + 1) : undefined)).status, 200);
        }
        const P = (await r.a.state()).dieci;
        assert.equal(P.phase, 'reveal');
        assert.equal(P.reveal.last, round === 3);
        assert.ok(P.reveal.rows.every((x) => x.win), 'a tie scores for all');
        if (round === 1) {
            assert.equal((await r.phones[1].post({ action: 'next' })).status, 403);
            assert.equal((await r.a.post({ action: 'next' })).status, 200);
        } else if (round === 2) skipReveal(r);
        if (round < 3) assert.equal((await r.a.state()).dieci.round, round + 1);
    }
    skipReveal(r);
    const P = (await r.a.state()).dieci;
    assert.equal(P.status, 'ended'); assert.equal(P.result.reason, 'finished');
    assert.equal(P.result.rows.length, 3);
    assert.ok(P.result.rows[0].pts >= P.result.rows[2].pts);
    assert.equal((await r.a.post({ action: 'start' })).status, 200);
    assert.equal((await r.a.state()).dieci.match, 2);
});

test('the clock: when the time is up the missing sentences are skipped; nobody wrote: no points', async () => {
    const r = await room({}, 3);
    await r.a.post({ action: 'start' });
    await write(r, 1, 'only one');
    expireWrite(r);
    let P = (await r.a.state()).dieci;
    assert.equal(P.phase, 'vote'); assert.equal(P.items.length, 1);
    assert.equal((await write(r, 2, 'late')).status, 409, 'too late');
    const g = r.game(); g.q.vote_deadline = Date.now() / 1000 - 1; r.setGame(g);
    P = (await r.a.state()).dieci;
    assert.equal(P.phase, 'reveal'); assert.equal(P.reveal.skipped.length, 2);
    const e = await room({}, 3);
    await e.a.post({ action: 'start' });
    expireWrite(e);
    P = (await e.a.state()).dieci;
    assert.equal(P.phase, 'reveal'); assert.deepEqual(P.reveal.rows, []);
    assert.ok(P.events.some((x) => x.t === 'none'));
});

test('texts: no HTML, 60 characters at most, not empty, once only, the family filter refuses heavy words (and only when on)', async () => {
    const r = await room({}, 3);
    await r.a.post({ action: 'start' });
    const code = async (text) => (await write(r, 1, text)).json.error || 'ok';
    assert.equal(await code(''), 'empty_text');
    assert.equal(await code('   '), 'empty_text');
    assert.equal(await code('<script>alert(1)</script>'), 'bad_text');
    assert.equal(await code('a'.repeat(61)), 'text_too_long');
    assert.equal(await code('è'.repeat(61)), 'text_too_long', 'characters, not bytes');
    assert.equal(await code('mangia la pizza con la merda'), 'bad_word');
    assert.equal(await code('Is a F.U.C.K machine'), 'ok', 'simple matching only');
    assert.equal((await write(r, 2, 'You are a FUCKing idiot')).json.error, 'bad_word');
    assert.equal((await write(r, 2, 'ist ein Arschloch')).json.error, 'bad_word');
    assert.equal((await write(r, 2, 'es un gilipollas')).json.error, 'bad_word');
    assert.equal((await write(r, 2, 'est un connard')).json.error, 'bad_word');
    assert.equal((await write(r, 2, 'Cazzo che sfortuna')).json.error, 'bad_word');
    assert.equal((await write(r, 2, 'mangia pasta al dente e usa il cazzuolo da muratore')).status, 200, 'a harmless word that contains a short one');
    assert.equal(await code('x'), 'already_wrote');
    assert.equal(r.game().texts[String(r.id.P1)], 'Is a F.U.C.K machine');
    const sixty = await room({}, 3);
    await sixty.a.post({ action: 'start' });
    assert.equal((await write(sixty, 1, '  ' + 'a'.repeat(60) + '  ')).status, 200, 'exactly 60 characters (spaces trimmed)');
    // family filter off: the same words are accepted
    const open = await room({ family: false }, 3);
    await open.a.post({ action: 'start' });
    assert.equal((await write(open, 1, 'è una merda')).status, 200);
    assert.equal(open.game().texts[String(open.id.P1)], 'è una merda');
    // the text is stored as plain text and comes back untouched in the vote
    const html = await room({}, 3);
    await html.a.post({ action: 'start' });
    await write(html, 1, 'AT&T "quotes" & more');
    assert.equal(html.game().texts[String(html.id.P1)], 'AT&T "quotes" & more');
});

test('hints: three per player, each phone sees only its own, the family filter drops the cheeky examples', async () => {
    const r = await room({}, 3);
    await r.a.post({ action: 'start' });
    const hint = (who) => r.phones[who - 1].post({ action: 'hint', player_id: r.id['P' + who] });
    for (let i = 0; i < 3; i++) assert.equal((await hint(1)).status, 200);
    const over = await hint(1);
    assert.equal(over.status, 409); assert.equal(over.json.error, 'hints_over');
    assert.equal((await hint(2)).status, 200, 'the others still have theirs');
    const mine = (await r.a.state()).dieci.me[0];
    assert.equal(mine.hints_left, 0);
    for (const l of ['it', 'en', 'es', 'fr', 'de']) assert.ok(mine.hint[l].length > 4, l);
    const other = (await r.phones[2].state()).dieci;
    assert.equal(other.me[0].hint, null); assert.equal(other.me[0].hints_left, 3);
    assert.equal((await r.phones[2].post({ action: 'hint', player_id: r.id.P1 })).status, 403, 'not your player');
    for (const i of r.game().hint_used) assert.equal(BANK[i][0], 0, 'family on: clean examples only');
    await writeAll(r);
    assert.equal((await hint(3)).status, 409, 'only while writing');
});

test('host tools: remove a sentence during the vote (the host never sees authors), exclude a player, end the match; others cannot', async () => {
    const r = await room({}, 4);
    await r.a.post({ action: 'start' });
    assert.equal((await r.a.post({ action: 'remove', idx: 0 })).status, 409, 'only while voting');
    await writeAll(r);
    const items = (await r.a.state()).dieci.items;
    assert.equal(items.length, 4);
    assert.ok(!JSON.stringify(items).includes('P1'));
    assert.equal((await r.phones[1].post({ action: 'remove', idx: 0 })).status, 403);
    const victim = itemOf(r, 2);
    await vote(r, 3, victim);
    assert.equal((await r.a.post({ action: 'remove', idx: victim })).status, 200);
    const P = (await r.a.state()).dieci;
    assert.equal(P.items.length, 3); assert.ok(!P.items.some((x) => x.i === victim));
    assert.deepEqual(P.voted, [], 'votes for a removed sentence are dropped, the voter can vote again');
    assert.equal((await vote(r, 1, victim)).status, 409);
    assert.equal((await r.phones[1].post({ action: 'exclude', player_id: r.id.P3 })).status, 403);
    assert.equal((await r.a.post({ action: 'exclude', player_id: r.id.P4 })).status, 200);
    const Q = (await r.a.state()).dieci;
    assert.ok(!Q.active.includes(r.id.P4)); assert.ok(Q.events.some((e) => e.t === 'excluded' && e.p === r.id.P4));
    assert.equal((await r.a.post({ action: 'exclude', player_id: r.id.P3 })).status, 200);
    const E = (await r.a.state()).dieci;
    assert.equal(E.status, 'ended'); assert.equal(E.result.reason, 'too_few');

    const e = await room({}, 3);
    await e.a.post({ action: 'start' });
    assert.equal((await e.phones[1].post({ action: 'end' })).status, 403);
    assert.equal((await e.a.post({ action: 'end' })).status, 200);
    assert.equal((await e.a.state()).dieci.result.reason, 'host_ended');
});

test('leaving: the round of a target who leaves is skipped; with fewer than 3 players the match ends', async () => {
    const r = await room({}, 4);
    await r.a.post({ action: 'start' });
    const T = targetNo(r);
    const leaver = T === 1 ? 2 : T;                 // never the host phone
    await r.phones[leaver - 1].post({ action: 'leave' });
    const P = (await r.a.state()).dieci;
    assert.equal(P.status, 'play');
    if (leaver === T) assert.equal(P.round, 2, 'the target left: next round');
    assert.ok(!P.active.includes(r.id['P' + leaver]));
    const other = [1, 2, 3, 4].filter((k) => k !== leaver && k !== 1)[0];
    await r.phones[other - 1].post({ action: 'leave' });
    assert.equal((await r.a.state()).dieci.result.reason, 'too_few');
});

test('one phone for everybody: several players on one device write and vote in turn', async () => {
    const a = await Phone.fresh();
    await a.post({ action: 'create', game: 'dieci', players: ['X', 'Y', 'Z'] });
    assert.equal((await a.post({ action: 'start' })).status, 200);
    const s = await a.state();
    assert.equal(s.dieci.me.length, 3);
    const id = Object.fromEntries(s.players.map((p) => [p.name, p.id]));
    for (const n of ['X', 'Y', 'Z']) assert.equal((await a.post({ action: 'write', player_id: id[n], text: 'flaw of ' + n })).status, 200);
    const V = (await a.state()).dieci;
    assert.equal(V.phase, 'vote'); assert.equal(V.items.length, 3);
    for (const m of V.me) assert.equal(m.own.length, 1);
    const target = V.target;
    for (const m of V.me) {
        const idx = V.items.find((it) => !m.own.includes(it.i)).i;
        assert.equal((await a.post({ action: 'vote', player_id: m.player_id, idx, ...(m.player_id === target ? { prize: idx } : {}) })).status, 200);
    }
    assert.equal((await a.state()).dieci.phase, 'reveal');
});

test('the admin LIVE view shows the authors and who voted for whom; a normal visitor cannot see it', async () => {
    const r = await room({}, 3);
    await r.a.post({ action: 'start' });
    await writeAll(r, ['aa', 'bb', 'cc']);
    const T = targetNo(r);
    const other = [1, 2, 3].find((k) => k !== T);
    const auth = [1, 2, 3].find((k) => k !== other);
    await vote(r, other, itemOf(r, auth));
    const admin = await makeAdmin(site, 'dieci_admin');
    const live = (await admin.get('/api/spia.php?action=live')).json.rooms.find((x) => x.code === r.code);
    assert.equal(live.game, 'dieci');
    assert.equal(live.dieci.phase, 'vote');
    assert.equal(live.dieci.texts[r.id.P1], 'aa'); assert.equal(live.dieci.texts[r.id.P3], 'cc');
    assert.equal(live.dieci.votes[r.id['P' + other]], r.id['P' + auth]);
    assert.equal(live.dieci.target, r.id['P' + T]);
    assert.equal((await new Client(site).get('/api/spia.php?action=live')).status !== 200, true);
    assert.match((await admin.get('/api/spia.php?action=ext')).text, /dieci/i, 'the admin script knows the game');
});

test('translations: the five languages have the same keys, every key the game uses exists, the help and intro texts are complete', () => {
    const dict = { it: {}, en: {}, es: {}, fr: {}, de: {} };
    const win = { SpiaI18n: { strings: dict } };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'dieci', 'texts.js'), 'utf8'), { window: win });
    const keys = Object.keys(dict.en);
    assert.ok(keys.length > 90);
    for (const l of ['it', 'es', 'fr', 'de']) {
        assert.deepEqual(Object.keys(dict[l]).sort(), keys.slice().sort(), l + ' has the same keys as English');
        for (const k of keys) assert.ok(String(dict[l][k]).trim(), `${l}.${k} is empty`);
    }
    const placeholders = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
    for (const k of keys) for (const l of ['it', 'es', 'fr', 'de']) assert.equal(placeholders(dict[l][k]), placeholders(dict.en[k]), `${l}.${k} placeholders`);
    assert.match(dict.en.dz_lead, /\{p\}.*10\/10/); assert.match(dict.it.dz_lead, /\{p\} è un 10\/10… ma/);
    const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'dieci', 'game.js'), 'utf8');
    for (const m of js.matchAll(/\bt\(\s*'(dz_[a-z_]+)'/g)) if (!m[1].endsWith('_')) assert.ok(keys.includes(m[1]), 'game.js uses an unknown key ' + m[1]);
    for (const m of js.matchAll(/'(dz_[a-z_]+)'/g)) assert.ok(keys.includes(m[1]) || m[1].endsWith('_'), 'game.js mentions an unknown key ' + m[1]);
    for (const k of ['dz_title', 'dz_tagline', 'dz_one_phone_note', 'dz_need_three', 'dz_start', 'dz_new_match', 'dz_settings_next_match', 'intro_dz_1', 'intro_dz_2_t', 'intro_dz_3',
        'help_dz_basics_t', 'help_dz_write', 'help_dz_vote', 'help_dz_host', 'help_dz_settings', 'err_need_players_dieci', 'err_bad_word', 'err_text_too_long', 'err_hints_over',
        'dz_reason_finished', 'dz_reason_host_ended', 'dz_reason_too_few']) assert.ok(keys.includes(k), k);
    for (const m of fs.readFileSync(path.join(ROOT, 'public', 'js', 'spia', 'app.js'), 'utf8').matchAll(/(?:title|tagline|note|need): '(dz_\w+)'/g)) assert.ok(keys.includes(m[1]), m[1]);
    // no HTML in any text (everything is inserted with textContent)
    for (const l of Object.keys(dict)) for (const k of keys) assert.ok(!/[<>]/.test(dict[l][k]), `${l}.${k} has markup`);
});

test('the page is served in English with its files, listed in the games (kind talk) and the sitemap', async () => {
    const html = await (await fetch(`${site.base}/pages/dieci.html`)).text();
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'no inline scripts');
    assert.match(html, /<html lang="en" data-game="dieci">/);
    for (const f of ['/js/dieci/game.js', '/js/dieci/texts.js', '/css/dieci.css', '/assets/dieci/icon.svg', '/assets/dieci/manifest.json']) assert.equal((await fetch(site.base + f)).status, 200, f);
    const games = await (await fetch(`${site.base}/pages/giochi.php`)).text();
    const map = await (await fetch(`${site.base}/sitemap.php`)).text();
    assert.ok(games.includes('dieci.html') && map.includes('pages/dieci.html'));
    const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'dieci.css'), 'utf8');
    assert.match(css, /prefers-reduced-motion/);
});
