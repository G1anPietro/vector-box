// tests/scommessa.test.js — "Bet buddy" rooms (pretend chips, never money): the bank of challenges, the secret challenge card, the pick of a
// player and a stake, refusing (-1 chip to the challenger), accepting, the secret jury vote judged by the server (a tie counts as pulled off),
// the optional 1-chip bets, chips never below 0, the titles, one shared phone, leaving, the admin LIVE view, the five languages and the page files
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
const BANK = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib', 'scommessa-q.json'), 'utf8'));

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

/** Phone A (host) has P1, B has P2, C has P3, ... (n players, one per phone). */
async function room(settings = {}, n = 4) {
    try { site.db('DELETE FROM rate_limits'); } catch (e) { /* not created yet */ }
    const a = await Phone.fresh();
    const code = (await a.post({ action: 'create', game: 'scommessa', players: ['P1'], settings })).json.code;
    const phones = [a];
    for (let i = 2; i <= n; i++) { const p = await Phone.fresh(); await p.post({ action: 'join', code }); await p.post({ action: 'player_add', name: 'P' + i }); phones.push(p); }
    const s = await a.state();
    const id = Object.fromEntries(s.players.map((p) => [p.name, p.id]));
    const where = 'room_id = (SELECT id FROM spia_rooms WHERE code = ?)';
    const game = () => JSON.parse(site.db(`SELECT state FROM scommessa_games WHERE ${where}`, [code])[0].state);
    const setGame = (g) => site.db(`UPDATE scommessa_games SET state = ? WHERE ${where}`, [JSON.stringify(g), code]);
    return { a, phones, code, id, game, setGame };
}
const who = (r, pid) => r.phones[Number(Object.keys(r.id).find((k) => r.id[k] === pid).slice(1)) - 1];
const act = (r, pid, action, extra = {}) => who(r, pid).post({ action, player_id: pid, ...extra });
const view = async (r, ph = r.a) => (await ph.state()).scommessa;
const endVote = (r) => { const g = r.game(); g.deadline = Date.now() / 1000 - 1; r.setGame(g); };
const skipReveal = (r) => { const g = r.game(); g.next_at = Date.now() / 1000 - 1; r.setGame(g); };
/** The challenger picks the first other active player with a stake; returns {cur, target}. */
async function pick(r, stake = 2, target = null) {
    const g = r.game();
    const t = target || g.order.find((p) => p !== g.cur);
    assert.equal((await act(r, g.cur, 'pick', { target: t, stake })).status, 200);
    return { cur: g.cur, target: t };
}
const accept = async (r) => { const { cur, target } = await pick(r); assert.equal((await act(r, target, 'accept')).status, 200); assert.equal((await act(r, target, 'done')).status, 200); return { cur, target }; };
const jury = (r) => { const g = r.game(); return g.order.filter((p) => p !== g.cur && p !== g.target); };
const chips = (r) => r.game().chips;

test('the bank: at least 90 light challenges, five languages each, four categories, no repeats, nothing about money or dangerous things', () => {
    assert.ok(BANK.length >= 90);
    for (const [i, row] of BANK.entries()) {
        assert.equal(row.length, 6, `row ${i}`);
        assert.ok([0, 1, 2, 3].includes(row[0]), `row ${i} category`);
        assert.ok(row.slice(1).every((x) => typeof x === 'string' && x.trim().length >= 12), `row ${i}`);
    }
    assert.equal(new Set(BANK.map((r) => r[2])).size, BANK.length, 'English texts are unique');
    for (const c of [0, 1, 2, 3]) assert.ok(BANK.filter((r) => r[0] === c).length >= 20, `category ${c} is big enough`);
    const text = BANK.map((r) => r.slice(1).join(' ')).join(' ').toLowerCase();
    for (const bad of ['alcohol', 'alcol', 'beer', 'vodka', 'money', 'euro', 'dollar', 'cigarette', 'knife', 'fire', 'jump from', 'kiss']) assert.ok(!new RegExp('\\b' + bad).test(text), bad);
});

test('migration V62 created scommessa_games; settings are cleaned; three players are needed', async () => {
    await fetch(`${site.base}/api/rooms.php`);
    assert.ok(site.db('PRAGMA user_version')[0].user_version >= 62);
    const a = await Phone.fresh();
    await a.post({ action: 'create', game: 'scommessa', players: ['A', 'B'], settings: { rounds: 7, easy: 'yes', company: false, move: false, mind: false } });
    const s = await a.state();
    assert.equal(s.game, 'scommessa');
    assert.deepEqual(s.settings, { rounds: 10, easy: true, company: false, move: false, mind: false }, 'bad values cleaned, one category stays on');
    assert.equal((await a.post({ action: 'start' })).status, 409, 'two players are not enough');
    assert.equal((await a.post({ action: 'settings', settings: { rounds: 15, easy: false, company: true } })).status, 200);
    assert.deepEqual((await a.state()).settings, { rounds: 15, easy: false, company: true, move: false, mind: false });
    assert.equal((await a.post({ action: 'settings', settings: { company: false } })).status, 200);
    assert.equal((await a.state()).settings.easy, true, 'at least one category stays on');
});

test('a round: everybody starts with 10 chips, only the challenger sees the card before the pick, one swap, bad picks are refused', async () => {
    const r = await room({}, 4);
    assert.equal((await r.a.post({ action: 'start' })).status, 200);
    const g = r.game();
    const cur = g.cur, other = g.order.find((p) => p !== cur);
    assert.ok(Object.values(g.chips).every((n) => n === 10));
    const mine = await view(r, who(r, cur)), theirs = await view(r, who(r, other));
    assert.equal(mine.phase, 'pick'); assert.ok(mine.card && mine.card.text.en.length > 12);
    for (const l of ['it', 'en', 'es', 'fr', 'de']) assert.ok(mine.card.text[l].length >= 12, l);
    assert.equal(theirs.card, null, 'the others do not see the challenge yet');
    assert.ok(!(await who(r, other).get('state')).text.includes(mine.card.text.en), 'the text is not in their state at all');
    const first = mine.card.text.en;
    assert.equal((await act(r, other, 'swap')).status, 409, 'only the challenger');
    assert.equal((await act(r, cur, 'swap')).status, 200);
    assert.notEqual((await view(r, who(r, cur))).card.text.en, first);
    assert.equal((await act(r, cur, 'swap')).status, 409, 'one change per round');
    assert.equal((await act(r, other, 'pick', { target: cur, stake: 1 })).status, 409, 'not your turn');
    assert.equal((await act(r, cur, 'pick', { target: cur, stake: 1 })).status, 409, 'not yourself');
    assert.equal((await act(r, cur, 'pick', { target: other, stake: 4 })).status, 409, 'stake 1 to 3');
    assert.equal((await act(r, cur, 'pick', { target: other, stake: '2' })).status, 409, 'a number');
    assert.equal((await act(r, cur, 'pick', { target: 99999, stake: 1 })).status, 409, 'unknown player');
    assert.equal((await act(r, cur, 'pick', { target: other, stake: 3 })).status, 200);
    const v = await view(r, who(r, other));
    assert.equal(v.phase, 'respond'); assert.equal(v.target, other); assert.equal(v.stake, 3);
    assert.ok(v.card && v.card.text.en, 'now everybody sees the challenge');
    assert.equal((await act(r, cur, 'swap')).status, 409, 'too late to change');
});

test('refusing costs 1 chip, paid to the challenger; only the challenged player answers', async () => {
    const r = await room({}, 4);
    await r.a.post({ action: 'start' });
    const { cur, target } = await pick(r, 3);
    const jurors = jury(r);
    assert.equal((await act(r, cur, 'refuse')).status, 409);
    assert.equal((await act(r, jurors[0], 'accept')).status, 409);
    assert.equal((await who(r, cur).post({ action: 'accept', player_id: target })).status, 403, 'not your player');
    assert.equal((await act(r, target, 'refuse')).status, 200);
    const v = await view(r);
    assert.equal(v.phase, 'reveal'); assert.equal(v.reveal.result, 'refused'); assert.equal(v.reveal.amount, 1);
    assert.equal(v.chips[cur], 11); assert.equal(v.chips[target], 9);
    assert.equal(r.game().stats[target].ref, 1);
    skipReveal(r); await r.a.state();
    const v2 = await view(r);
    assert.equal(v2.phase, 'pick'); assert.equal(v2.round, 2); assert.notEqual(v2.cur, cur, 'the next challenger');
});

test('accepting: the jury votes in secret, the server judges, a tie counts as pulled off, the stake moves between challenger and challenged', async () => {
    const r = await room({}, 5);
    await r.a.post({ action: 'start' });
    // 2 pulled off, 1 failed -> done: the challenged player wins the stake
    let { cur, target } = await accept(r);
    let js = jury(r);
    assert.equal((await act(r, cur, 'vote', { v: 'ok' })).status, 409, 'the challenger does not vote');
    assert.equal((await act(r, target, 'vote', { v: 'ok' })).status, 409, 'the challenged player does not vote');
    await act(r, js[0], 'vote', { v: 'ok' });
    const ph = who(r, js[1]);
    let text = (await ph.get('state')).text;
    let v = await view(r, ph);
    assert.equal(v.phase, 'vote'); assert.equal(v.reveal, null); assert.deepEqual(v.voted, [js[0]]);
    assert.ok(!/"votes"/.test(text) && !/"bets"/.test(text), 'no vote or bet map in the state');
    assert.equal((await act(r, js[0], 'vote', { v: 'no' })).status, 409, 'one vote each');
    assert.equal((await act(r, js[1], 'vote', { v: 'maybe' })).status, 409, 'bad vote');
    await act(r, js[1], 'vote', { v: 'no' });
    assert.equal((await view(r)).phase, 'vote', 'one vote missing');
    await act(r, js[2], 'vote', { v: 'ok' });
    v = await view(r);
    assert.deepEqual([v.reveal.result, v.reveal.ok, v.reveal.no, v.reveal.amount], ['done', 2, 1, 2]);
    assert.equal(v.chips[target], 12); assert.equal(v.chips[cur], 8);
    assert.equal((await act(r, js[0], 'vote', { v: 'ok' })).status, 409, 'too late');
    // 1 ok, 1 no, the third never votes -> tie = pulled off
    skipReveal(r); await r.a.state();
    ({ cur, target } = await accept(r));
    js = jury(r);
    await act(r, js[0], 'vote', { v: 'ok' }); await act(r, js[1], 'vote', { v: 'no' });
    endVote(r);
    v = await view(r);
    assert.deepEqual([v.reveal.result, v.reveal.ok, v.reveal.no], ['done', 1, 1]);
    // nobody votes -> pulled off too; 0 ok, 3 no -> failed: the challenger wins the stake
    skipReveal(r); await r.a.state();
    ({ cur, target } = await accept(r));
    const before = { ...chips(r) };
    js = jury(r);
    for (const j of js) await act(r, j, 'vote', { v: 'no' });
    v = await view(r);
    assert.deepEqual([v.reveal.result, v.reveal.ok, v.reveal.no], ['failed', 0, 3]);
    assert.equal(v.chips[cur], before[cur] + 2); assert.equal(v.chips[target], before[target] - 2);
});

test('bets: 1 chip on the verdict from the jury only, hidden until the verdict, won or lost against the bank; chips never go below 0', async () => {
    const r = await room({}, 5);
    await r.a.post({ action: 'start' });
    const { cur, target } = await accept(r);
    const js = jury(r);
    assert.equal((await act(r, cur, 'bet', { v: 'ok' })).status, 409, 'the challenger does not bet');
    assert.equal((await act(r, js[0], 'bet', { v: 'x' })).status, 409, 'bad bet');
    assert.equal((await act(r, js[0], 'bet', { v: 'no' })).status, 200);
    assert.equal((await act(r, js[0], 'bet', { v: 'ok' })).status, 409, 'one bet each');
    const g0 = r.game(); g0.chips[js[1]] = 0; r.setGame(g0);
    assert.equal((await act(r, js[1], 'bet', { v: 'ok' })).status, 409, 'no chips, no bet');
    // js[2] bets together with the vote
    assert.equal((await act(r, js[2], 'vote', { v: 'ok', bet: true })).status, 200);
    let v = await view(r, who(r, js[2]));
    assert.deepEqual(v.betted.sort(), [js[0], js[2]].sort());
    assert.equal(v.me[0].bet, 'ok'); assert.equal((await view(r, who(r, js[0]))).me[0].bet, 'no', 'you see your own bet only');
    assert.ok(!(await who(r, js[2]).get('state')).text.includes('"win"'), 'results are not out yet');
    await act(r, js[0], 'vote', { v: 'ok' });
    await act(r, js[1], 'vote', { v: 'ok' });
    v = await view(r);
    assert.equal(v.reveal.result, 'done');
    const win = v.reveal.bets.find((b) => b.p === js[2]), lose = v.reveal.bets.find((b) => b.p === js[0]);
    assert.equal(win.win, true); assert.equal(lose.win, false);
    assert.equal(v.chips[js[2]], 11); assert.equal(v.chips[js[0]], 9);
    assert.equal(r.game().stats[js[2]].bw, 1);
    assert.equal((await act(r, js[1], 'bet', { v: 'ok' })).status, 409, 'too late');
    // never negative: a player with 1 chip loses it (0), another with 1 chip refuses (0), nothing goes below
    skipReveal(r); await r.a.state();
    const g = r.game();
    for (const k of Object.keys(g.chips)) g.chips[k] = 1;
    r.setGame(g);
    const p2 = await pick(r, 1);
    const j2 = jury(r);
    assert.equal((await act(r, p2.target, 'accept')).status, 200);
    await act(r, j2[0], 'bet', { v: 'ok' });
    await act(r, p2.target, 'done');
    for (const j of j2) await act(r, j, 'vote', { v: 'no' });
    v = await view(r);
    assert.equal(v.reveal.result, 'failed');
    assert.ok(Object.values(v.chips).every((n) => n >= 0), 'never negative');
    assert.equal(v.chips[p2.target], 0); assert.equal(v.chips[j2[0]], 0, 'the lost bet took the last chip');
    assert.ok(v.events.some((e) => e.t === 'out' && e.p === p2.target));
});

test('a player with 0 chips sits out but still judges; fewer than 2 players with chips ends the match, with the titles', async () => {
    const r = await room({ rounds: 15 }, 3);
    await r.a.post({ action: 'start' });
    const g = r.game();
    const ids = g.order;
    const [cur] = [g.cur];
    const others = ids.filter((p) => p !== cur);
    g.chips[cur] = 6; g.chips[others[0]] = 1; g.chips[others[1]] = 0;
    r.setGame(g);
    assert.equal((await act(r, cur, 'pick', { target: others[1], stake: 1 })).status, 409, 'a player with no chips cannot be challenged');
    await act(r, cur, 'pick', { target: others[0], stake: 1 });
    const v = await view(r);
    assert.equal(v.phase, 'respond');
    await act(r, others[0], 'accept');
    await act(r, others[0], 'done');
    assert.deepEqual(jury(r), [others[1]], 'the player with no chips is the jury');
    await act(r, others[1], 'vote', { v: 'no' });
    const w = await view(r);
    assert.equal(w.reveal.result, 'failed'); assert.equal(w.chips[others[0]], 0); assert.equal(w.chips[cur], 7);
    skipReveal(r); await r.a.state();
    const e = await view(r);
    assert.equal(e.status, 'ended'); assert.equal(e.result.reason, 'broke');
    assert.deepEqual(e.result.winners, [cur]); assert.equal(e.result.rows[0].p, cur);
    const brave = e.result.titles.find((x) => x.k === 'brave');
    assert.deepEqual(brave.ps, [others[0]], 'the one who accepted the most challenges gets the title');
    assert.ok(e.result.titles.some((x) => x.k === 'careful') === false);
});

test('the match ends after the chosen number of rounds; challengers take turns; the host cancels a stuck round and ends the match; others cannot', async () => {
    const r = await room({ rounds: 6 }, 3);
    await r.a.post({ action: 'start' });
    const seen = [];
    for (let i = 0; i < 6; i++) {
        const g = r.game();
        seen.push(g.cur);
        assert.equal(g.ri, i);
        assert.equal((await r.phones[1].post({ action: 'skip' })).status, 403);
        assert.equal((await r.a.post({ action: 'skip' })).status, 200);
    }
    assert.deepEqual(seen.slice(0, 3).sort(), Object.values(r.id).sort(), 'everybody challenges once per lap');
    assert.deepEqual(seen.slice(0, 3), seen.slice(3), 'same order every lap');
    const v = await view(r);
    assert.equal(v.status, 'ended'); assert.equal(v.result.reason, 'finished');
    assert.ok(Object.values(v.chips).every((n) => n === 10), 'a cancelled round moves no chips');
    assert.equal((await r.a.post({ action: 'skip' })).status, 409);
    assert.equal((await r.a.post({ action: 'start' })).status, 200, 'a new match');
    assert.equal((await view(r)).match, 2);
    assert.equal((await r.phones[1].post({ action: 'end' })).status, 403);
    assert.equal((await r.a.post({ action: 'end' })).status, 200);
    assert.equal((await view(r)).result.reason, 'host_ended');
});

test('one phone for everybody: the same device picks, answers, votes and bets for each local player', async () => {
    const a = await Phone.fresh();
    await a.post({ action: 'create', game: 'scommessa', players: ['X', 'Y', 'Z'], settings: { rounds: 6 } });
    assert.equal((await a.post({ action: 'start' })).status, 200);
    let s = await a.state();
    assert.equal(s.scommessa.me.length, 3);
    const cur = s.scommessa.cur;
    assert.ok(s.scommessa.card, 'the shared phone holds the challenger');
    const target = s.scommessa.order.find((p) => p !== cur);
    assert.equal((await a.post({ action: 'pick', player_id: cur, target, stake: 2 })).status, 200);
    assert.equal((await a.post({ action: 'accept', player_id: target })).status, 200);
    assert.equal((await a.post({ action: 'done', player_id: target })).status, 200);
    s = await a.state();
    const voters = s.scommessa.me.filter((m) => m.can_vote);
    assert.equal(voters.length, 1, 'the third player is the jury');
    assert.equal((await a.post({ action: 'vote', player_id: voters[0].player_id, v: 'ok', bet: true })).status, 200);
    s = await a.state();
    assert.equal(s.scommessa.reveal.result, 'done');
    assert.equal(s.scommessa.chips[target], 12); assert.equal(s.scommessa.chips[voters[0].player_id], 11);
});

test('leaving: the challenger or the challenged player leaving cancels the round; fewer than 3 players ends the match', async () => {
    const r = await room({}, 4);
    await r.a.post({ action: 'start' });
    const g = r.game();
    const { cur, target } = await pick(r, 1);
    const leaver = who(r, target) === r.a ? who(r, cur) : who(r, target);
    if (leaver !== r.a) await leaver.post({ action: 'leave' });
    const v = await view(r);
    assert.equal(v.status, 'play');
    if (leaver !== r.a) { assert.equal(v.round, 2, 'the round was cancelled, no chips moved'); assert.ok(v.events.some((e) => e.t === 'void')); }
    assert.ok(v.active.includes(v.cur));
    const e = await room({}, 3);
    await e.a.post({ action: 'start' });
    await e.phones[1].post({ action: 'leave' });
    assert.equal((await view(e)).result.reason, 'too_few');
    assert.ok(g.order.length === 4);
});

test('the admin LIVE view shows the challenge, everybody\'s chips and who voted or bet what while the round is open; a normal visitor cannot see it', async () => {
    const r = await room({}, 4);
    await r.a.post({ action: 'start' });
    const { cur, target } = await accept(r);
    const js = jury(r);
    await act(r, js[0], 'vote', { v: 'no', bet: true });
    const admin = await makeAdmin(site, 'scommessa_admin');
    const live = (await admin.get('/api/spia.php?action=live')).json.rooms.find((x) => x.code === r.code);
    assert.equal(live.game, 'scommessa');
    const P = live.scommessa;
    assert.equal(P.phase, 'vote'); assert.equal(P.cur, cur); assert.equal(P.target, target); assert.equal(P.stake, 2);
    assert.ok(P.card && P.votes[js[0]] === 'no' && P.bets[js[0]] === 'no');
    assert.equal(Object.keys(P.chips).length, 4);
    assert.equal((await new Client(site).get('/api/spia.php?action=live')).status !== 200, true);
    assert.match((await admin.get('/api/spia.php?action=ext')).text, /scommessa/i, 'the admin script knows the game');
});

test('translations: the five languages have the same keys, every key the game uses exists, the help and intro texts are complete', () => {
    const dict = { it: {}, en: {}, es: {}, fr: {}, de: {} };
    const win = { SpiaI18n: { strings: dict } };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'scommessa', 'texts.js'), 'utf8'), { window: win });
    const keys = Object.keys(dict.en);
    assert.ok(keys.length > 120);
    for (const l of ['it', 'es', 'fr', 'de']) {
        assert.deepEqual(Object.keys(dict[l]).sort(), keys.slice().sort(), l + ' has the same keys as English');
        for (const k of keys) assert.ok(String(dict[l][k]).trim(), `${l}.${k} is empty`);
    }
    const placeholders = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
    for (const k of keys) for (const l of ['it', 'es', 'fr', 'de']) assert.equal(placeholders(dict[l][k]), placeholders(dict.en[k]), `${l}.${k} placeholders`);
    const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'scommessa', 'game.js'), 'utf8');
    for (const m of js.matchAll(/'(sc_[a-z_0-9]+)'/g)) if (!m[1].endsWith('_')) assert.ok(keys.includes(m[1]), 'game.js uses an unknown key ' + m[1]);
    for (const k of ['easy', 'company', 'move', 'mind']) assert.ok(keys.includes('sc_cat_' + k));
    for (const k of [0, 1, 2, 3]) assert.ok(keys.includes('sc_card_cat_' + k));
    for (const k of ['finished', 'host_ended', 'too_few', 'broke']) assert.ok(keys.includes('sc_reason_' + k));
    for (const k of ['brave', 'ace', 'gambler', 'careful']) assert.ok(keys.includes('sc_title_' + k) && keys.includes('sc_title_' + k + '_d'), k);
    for (const k of ['start', 'round', 'pick', 'accept', 'refuse', 'vote', 'bet', 'done', 'failed', 'refused', 'out', 'skip', 'void', 'left', 'end', 'swap']) assert.ok(keys.includes('sc_ev_' + k), k);
    for (const k of ['sc_title', 'sc_tagline', 'sc_one_phone_note', 'sc_need_three', 'sc_start', 'sc_new_match', 'sc_settings_next_match', 'sc_fake', 'sc_fake_d', 'intro_sc_1', 'intro_sc_2_t', 'intro_sc_3',
        'help_sc_basics_t', 'help_sc_round', 'help_sc_jury', 'help_sc_host', 'help_sc_settings', 'err_need_players_scommessa', 'err_not_your_turn', 'err_bad_target', 'err_bad_stake', 'err_already_bet', 'err_no_chips']) assert.ok(keys.includes(k), k);
    for (const l of ['it', 'en', 'es', 'fr', 'de']) assert.ok(dict[l].sc_fake_d.length > 20 && dict[l].help_sc_basics.length > 100, l);
    for (const m of fs.readFileSync(path.join(ROOT, 'public', 'js', 'spia', 'app.js'), 'utf8').matchAll(/(?:title|tagline|note|need): '(sc_\w+)'/g)) assert.ok(keys.includes(m[1]), m[1]);
});

test('the page is served with its files, says it is pretend chips, respects reduced motion, and is listed in the games and the sitemap', async () => {
    const html = await (await fetch(`${site.base}/pages/scommessa.html`)).text();
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'no inline scripts');
    assert.match(html, /data-game="scommessa"/);
    assert.match(html, /FAKE chips only: no money/);
    assert.match(html, /No money, only fake chips/);
    for (const f of ['/js/scommessa/game.js', '/js/scommessa/texts.js', '/css/scommessa.css', '/assets/scommessa/icon.svg', '/assets/scommessa/manifest.json']) assert.equal((await fetch(site.base + f)).status, 200, f);
    assert.match(fs.readFileSync(path.join(ROOT, 'public', 'css', 'scommessa.css'), 'utf8'), /prefers-reduced-motion: reduce[^}]*sc-flow-lane/);
    const games = await (await fetch(`${site.base}/pages/giochi.php`)).text();
    const map = await (await fetch(`${site.base}/sitemap.php`)).text();
    assert.ok(games.includes('scommessa.html') && map.includes('pages/scommessa.html'));
});
