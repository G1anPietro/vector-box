// tests/obbligo.test.js — "Truth or dare" rooms: the bank of cards, the turn order (fair, server drawn), truth/dare choice, change card
// once per turn, pass once per match, the secret vote judged by the server (strict majority), one shared phone, leaving, host tools,
// the admin LIVE view, the five languages and the page files
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
const BANK = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib', 'obbligo-q.json'), 'utf8'));

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
async function room(settings = {}, n = 3) {
    try { site.db('DELETE FROM rate_limits'); } catch (e) { /* not created yet */ }
    const a = await Phone.fresh();
    const code = (await a.post({ action: 'create', game: 'obbligo', players: ['P1'], settings })).json.code;
    const phones = [a];
    for (let i = 2; i <= n; i++) { const p = await Phone.fresh(); await p.post({ action: 'join', code }); await p.post({ action: 'player_add', name: 'P' + i }); phones.push(p); }
    const s = await a.state();
    const id = Object.fromEntries(s.players.map((p) => [p.name, p.id]));
    const where = 'room_id = (SELECT id FROM spia_rooms WHERE code = ?)';
    const game = () => JSON.parse(site.db(`SELECT state FROM obbligo_games WHERE ${where}`, [code])[0].state);
    const setGame = (g) => site.db(`UPDATE obbligo_games SET state = ? WHERE ${where}`, [JSON.stringify(g), code]);
    return { a, phones, code, id, game, setGame };
}
const who = (r, pid) => r.phones[Number(Object.keys(r.id).find((k) => r.id[k] === pid).slice(1)) - 1];
const act = (r, pid, action, extra = {}) => who(r, pid).post({ action, player_id: pid, ...extra });
const view = async (r) => (await r.a.state()).obbligo;
/** The vote of everybody but the player in the spotlight: a list of 'ok' / 'no', one per other player in seating order. */
async function castVotes(r, votes) {
    const g = r.game();
    const voters = g.order.filter((p) => p !== g.cur);
    for (let i = 0; i < voters.length; i++) if (votes[i]) assert.equal((await act(r, voters[i], 'vote', { v: votes[i] })).status, 200);
    return voters;
}
/** A full turn up to the vote: choose a truth, then "done". */
async function toVote(r, kind = 't') {
    const cur = r.game().cur;
    assert.equal((await act(r, cur, 'choose', { kind })).status, 200);
    assert.equal((await act(r, cur, 'done')).status, 200);
    return cur;
}
const endVote = (r) => { const g = r.game(); g.deadline = Date.now() / 1000 - 1; r.setGame(g); };
const skipReveal = (r) => { const g = r.game(); g.next_at = Date.now() / 1000 - 1; r.setGame(g); };

test('the bank: at least 60 truths and 60 dares, five languages each, three categories, no repeats', () => {
    assert.ok(BANK.t.length >= 60 && BANK.d.length >= 60);
    for (const k of ['t', 'd']) {
        for (const [i, row] of BANK[k].entries()) {
            assert.equal(row.length, 6, `${k} ${i}`);
            assert.ok([0, 1, 2].includes(row[0]), `${k} ${i} category`);
            assert.ok(row.slice(1).every((x) => typeof x === 'string' && x.trim().length >= 8), `${k} ${i}`);
        }
        assert.equal(new Set(BANK[k].map((r) => r[2])).size, BANK[k].length, k + ' English texts are unique');
        for (const c of [0, 1, 2]) assert.ok(BANK[k].filter((r) => r[0] === c).length >= 15, `${k} category ${c} is big enough`);
    }
});

test('migration V52 created obbligo_games; settings are cleaned (spicy off by default); three players are needed', async () => {
    await fetch(`${site.base}/api/rooms.php`);
    assert.ok(site.db('PRAGMA user_version')[0].user_version >= 52);
    const a = await Phone.fresh();
    await a.post({ action: 'create', game: 'obbligo', players: ['A', 'B'], settings: { laps: 9, spicy: 'yes', calm: false, friends: false } });
    const s = await a.state();
    assert.equal(s.game, 'obbligo');
    assert.deepEqual(s.settings, { laps: 2, calm: true, friends: false, spicy: false }, 'bad values cleaned, one category stays on');
    assert.equal((await a.post({ action: 'start' })).status, 409, 'two players are not enough');
    assert.equal((await a.post({ action: 'settings', settings: { laps: 3, spicy: true, calm: false, friends: false } })).status, 200);
    assert.deepEqual((await a.state()).settings, { laps: 3, calm: false, friends: false, spicy: true });
    assert.equal((await a.post({ action: 'settings', settings: { calm: false, spicy: false } })).status, 200);
    assert.equal((await a.state()).settings.calm, true, 'at least one category stays on');
});

test('a turn: only the player in the spotlight chooses, the card has five languages, one change per turn, then the vote opens', async () => {
    const r = await room({}, 4);
    assert.equal((await r.a.post({ action: 'start' })).status, 200);
    let g = r.game();
    const cur = g.cur, other = g.order.find((p) => p !== cur);
    let v = await view(r);
    assert.equal(v.phase, 'choose'); assert.equal(v.cur, cur); assert.equal(v.card, null); assert.equal(v.turns, 8);
    assert.equal((await act(r, other, 'choose', { kind: 't' })).status, 409, 'not your turn');
    assert.equal((await act(r, cur, 'choose', { kind: 'x' })).status, 409, 'bad kind');
    assert.equal((await act(r, cur, 'swap')).status, 409, 'no card yet');
    assert.equal((await who(r, cur).post({ action: 'choose', player_id: other, kind: 't' })).status, 403, 'not your player');
    assert.equal((await act(r, cur, 'choose', { kind: 'd' })).status, 200);
    v = await view(r);
    assert.equal(v.phase, 'card'); assert.equal(v.card.k, 'd');
    for (const l of ['it', 'en', 'es', 'fr', 'de']) assert.ok(v.card.text[l].length >= 8, l);
    assert.equal((await act(r, cur, 'choose', { kind: 't' })).status, 409, 'cannot choose twice');
    const first = v.card.text.en;
    assert.equal((await act(r, other, 'swap')).status, 409, 'only the player in the spotlight');
    assert.equal((await act(r, cur, 'swap')).status, 200);
    v = await view(r);
    assert.equal(v.swapped, true); assert.equal(v.card.k, 'd', 'same kind'); assert.notEqual(v.card.text.en, first);
    assert.equal((await act(r, cur, 'swap')).status, 409, 'one change per turn');
    assert.equal((await act(r, other, 'done')).status, 409);
    assert.equal((await act(r, cur, 'done')).status, 200);
    assert.equal((await view(r)).phase, 'vote');
    assert.equal((await act(r, cur, 'vote', { v: 'ok' })).status, 409, 'the player in the spotlight does not vote');
});

test('the vote is secret and the server judges: a strict majority of "done" scores, a tie or "not valid" does not, no votes is no point', async () => {
    const r = await room({ laps: 3 }, 4);
    await r.a.post({ action: 'start' });
    // 2 ok, 1 no -> point
    let cur = await toVote(r);
    let voters = r.game().order.filter((p) => p !== cur);
    await act(r, voters[0], 'vote', { v: 'ok' });
    let v = await view(r);
    assert.equal(v.phase, 'vote'); assert.equal(v.reveal, null); assert.deepEqual(v.voted, [voters[0]]);
    const text = (await r.a.get('state')).text;
    assert.ok(!/"votes"/.test(text), 'no vote map in the state');
    assert.equal((await act(r, voters[0], 'vote', { v: 'no' })).status, 409, 'one vote each');
    assert.equal((await act(r, voters[1], 'vote', { v: 'maybe' })).status, 409, 'bad vote');
    await act(r, voters[1], 'vote', { v: 'no' });
    assert.equal((await view(r)).phase, 'vote', 'one vote missing');
    await act(r, voters[2], 'vote', { v: 'ok' });
    v = await view(r);
    assert.equal(v.phase, 'reveal'); assert.deepEqual([v.reveal.ok, v.reveal.no, v.reveal.result], [2, 1, 'done']);
    assert.equal(v.pts[cur], 1);
    assert.equal((await act(r, voters[0], 'vote', { v: 'ok' })).status, 409, 'too late');
    // host skips the wait; 1 ok, 1 no (+1 missing when the time is up) -> tie, no point
    assert.equal((await r.phones[1].post({ action: 'next' })).status, 403);
    assert.equal((await r.a.post({ action: 'next' })).status, 200);
    cur = await toVote(r);
    voters = r.game().order.filter((p) => p !== cur);
    await act(r, voters[0], 'vote', { v: 'ok' }); await act(r, voters[1], 'vote', { v: 'no' });
    endVote(r);
    v = await view(r);
    assert.deepEqual([v.reveal.ok, v.reveal.no, v.reveal.result], [1, 1, 'fail']); assert.equal(v.pts[cur], 0);
    skipReveal(r); await r.a.state();
    // nobody votes -> none
    cur = await toVote(r);
    endVote(r);
    v = await view(r);
    assert.equal(v.reveal.result, 'none'); assert.equal(v.pts[cur], 0);
    skipReveal(r);
    v = await view(r);
    assert.equal(v.phase, 'choose'); assert.equal(v.turn, 4, 'the next turn started by itself');
});

test('pass: once per match, the turn ends with no point; swapping does not use the pass; a second pass is refused', async () => {
    const r = await room({ laps: 2 }, 3);
    await r.a.post({ action: 'start' });
    const order = r.game().seq.slice(0, 3);
    const p0 = order[0];
    assert.equal((await act(r, order[1], 'pass')).status, 409, 'not your turn');
    assert.equal((await act(r, p0, 'pass')).status, 200);
    let v = await view(r);
    assert.equal(v.cur, order[1], 'the turn moved on'); assert.equal(v.pass_used[p0], true); assert.equal(v.pts[p0], 0);
    assert.ok(v.events.some((e) => e.t === 'pass' && e.p === p0));
    // finish the lap with skips until p0 plays again (second lap), then try to pass again
    for (let i = 0; i < 2; i++) assert.equal((await r.a.post({ action: 'skip' })).status, 200);
    v = await view(r);
    assert.equal(v.cur, p0); assert.equal(v.lap, 2);
    await act(r, p0, 'choose', { kind: 't' });
    assert.equal((await act(r, p0, 'pass')).status, 409, 'the pass is already used');
    assert.equal(r.game().stats[String(p0)].passes, 1);
    // a pass taken after choosing works for a player who has not used it
    const other = r.game().seq[4];
    assert.equal((await act(r, p0, 'done')).status, 200);
    endVote(r); skipReveal(r); await r.a.state(); skipReveal(r); await r.a.state();
    assert.equal(r.game().cur, other);
    await act(r, other, 'choose', { kind: 'd' });
    assert.equal((await act(r, other, 'pass')).status, 200, 'pass after choosing');
});

test('fair turns: everybody plays the same number of turns in every lap, and the match ends with a standing', async () => {
    for (const laps of [1, 3]) {
        const r = await room({ laps }, 4);
        await r.a.post({ action: 'start' });
        const seq = r.game().seq;
        assert.equal(seq.length, 4 * laps);
        for (const p of Object.values(r.id)) assert.equal(seq.filter((x) => x === p).length, laps, 'each player appears once per lap');
        for (let l = 0; l < laps; l++) assert.equal(new Set(seq.slice(l * 4, l * 4 + 4)).size, 4, 'each lap has every player once');
        for (let i = 0; i < seq.length; i++) assert.equal((await r.a.post({ action: 'skip' })).status, 200);
        const v = await view(r);
        assert.equal(v.status, 'ended'); assert.equal(v.result.reason, 'finished');
        assert.ok(v.result.rows.every((x) => x.turns === laps), 'everybody played ' + laps);
        assert.equal((await r.a.post({ action: 'skip' })).status, 409, 'nothing to skip after the end');
    }
    const w = await room({ laps: 1 }, 3);
    await w.a.post({ action: 'start' });
    const first = await toVote(w);
    await castVotes(w, ['ok', 'ok']);
    skipReveal(w); await w.a.state();
    for (let i = 0; i < 2; i++) await w.a.post({ action: 'skip' });
    const res = (await view(w)).result;
    assert.deepEqual(res.winners, [first]); assert.equal(res.rows[0].p, first); assert.equal(res.rows[0].pts, 1);
    assert.equal((await w.a.post({ action: 'start' })).status, 200, 'a new match');
    assert.equal((await view(w)).match, 2);
});

test('one phone for everybody: the same device chooses and votes for each local player', async () => {
    const a = await Phone.fresh();
    await a.post({ action: 'create', game: 'obbligo', players: ['X', 'Y', 'Z'], settings: { laps: 1 } });
    assert.equal((await a.post({ action: 'start' })).status, 200);
    let s = await a.state();
    assert.equal(s.obbligo.me.length, 3);
    const cur = s.obbligo.cur;
    assert.ok(s.obbligo.me.find((m) => m.player_id === cur).current);
    assert.equal((await a.post({ action: 'choose', player_id: cur, kind: 't' })).status, 200);
    assert.equal((await a.post({ action: 'done', player_id: cur })).status, 200);
    s = await a.state();
    assert.deepEqual(s.obbligo.me.filter((m) => m.can_vote).length, 2, 'the two others vote on this phone');
    for (const m of s.obbligo.me.filter((m) => m.can_vote)) assert.equal((await a.post({ action: 'vote', player_id: m.player_id, v: 'ok' })).status, 200);
    s = await a.state();
    assert.equal(s.obbligo.reveal.result, 'done'); assert.equal(s.obbligo.pts[cur], 1);
});

test('categories: spicy cards are never drawn unless the host turns them on; cards are not repeated until the pile is used up', async () => {
    const r = await room({ laps: 3 }, 4);
    await r.a.post({ action: 'start' });
    const seen = [];
    for (let i = 0; i < 12; i++) {
        const g = r.game();
        const k = i % 2 ? 't' : 'd';
        await act(r, g.cur, 'choose', { kind: k });
        const c = r.game().card;
        assert.notEqual(BANK[k][c.i][0], 2, 'no spicy card');
        assert.ok(!seen.includes(k + c.i), 'no repeat');
        seen.push(k + c.i);
        await r.a.post({ action: 'skip' });
    }
    const s = await room({ calm: false, friends: false, spicy: true }, 3);
    await s.a.post({ action: 'start' });
    for (let i = 0; i < 4; i++) { const g = s.game(); await act(s, g.cur, 'choose', { kind: 't' }); assert.equal(BANK.t[s.game().card.i][0], 2); await act(s, g.cur, 'swap'); assert.equal(BANK.t[s.game().card.i][0], 2); await s.a.post({ action: 'skip' }); }
});

test('leaving: the player in the spotlight leaving hands the turn on; fewer than 3 players ends the match; only the host ends or skips', async () => {
    const r = await room({}, 4);
    await r.a.post({ action: 'start' });
    const g = r.game();
    const ph = who(r, g.cur);
    if (ph === r.a) await r.phones[1].post({ action: 'leave' }); else await ph.post({ action: 'leave' });
    const v = await view(r);
    assert.equal(v.status, 'play');
    assert.ok(v.active.includes(v.cur), 'the spotlight is on a player who is still here');
    if (ph !== r.a) assert.notEqual(v.cur, g.cur);

    const e = await room({}, 3);
    await e.a.post({ action: 'start' });
    assert.equal((await e.phones[1].post({ action: 'end' })).status, 403);
    assert.equal((await e.phones[1].post({ action: 'skip' })).status, 403);
    await e.phones[1].post({ action: 'leave' });
    assert.equal((await view(e)).result.reason, 'too_few');
    const f = await room({}, 3);
    await f.a.post({ action: 'start' });
    assert.equal((await f.a.post({ action: 'end' })).status, 200);
    assert.equal((await view(f)).result.reason, 'host_ended');
});

test('the admin LIVE view shows the card and who voted what while the vote is open; a normal visitor cannot see it', async () => {
    const r = await room({}, 3);
    await r.a.post({ action: 'start' });
    const cur = await toVote(r);
    const voter = r.game().order.find((p) => p !== cur);
    await act(r, voter, 'vote', { v: 'no' });
    const admin = await makeAdmin(site, 'obbligo_admin');
    const live = (await admin.get('/api/spia.php?action=live')).json.rooms.find((x) => x.code === r.code);
    assert.equal(live.game, 'obbligo');
    assert.equal(live.obbligo.phase, 'vote'); assert.equal(live.obbligo.cur, cur); assert.equal(live.obbligo.kind, 't');
    assert.ok(live.obbligo.card && live.obbligo.votes[voter] === 'no');
    assert.equal((await new Client(site).get('/api/spia.php?action=live')).status !== 200, true);
    assert.match((await admin.get('/api/spia.php?action=ext')).text, /obbligo/i, 'the admin script knows the game');
});

test('translations: the five languages have the same keys, every key the game uses exists, the help and intro texts are complete', () => {
    const dict = { it: {}, en: {}, es: {}, fr: {}, de: {} };
    const win = { SpiaI18n: { strings: dict } };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'obbligo', 'texts.js'), 'utf8'), { window: win });
    const keys = Object.keys(dict.en);
    assert.ok(keys.length > 90);
    for (const l of ['it', 'es', 'fr', 'de']) {
        assert.deepEqual(Object.keys(dict[l]).sort(), keys.slice().sort(), l + ' has the same keys as English');
        for (const k of keys) assert.ok(String(dict[l][k]).trim(), `${l}.${k} is empty`);
    }
    const placeholders = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
    for (const k of keys) for (const l of ['it', 'es', 'fr', 'de']) assert.equal(placeholders(dict[l][k]), placeholders(dict.en[k]), `${l}.${k} placeholders`);
    const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'obbligo', 'game.js'), 'utf8');
    for (const m of js.matchAll(/'(ob_[a-z_0-9]+)'/g)) if (!m[1].endsWith('_')) assert.ok(keys.includes(m[1]), 'game.js uses an unknown key ' + m[1]);
    for (const k of ['calm', 'friends', 'spicy']) assert.ok(keys.includes('ob_cat_' + k));
    for (const k of [0, 1, 2]) assert.ok(keys.includes('ob_card_cat_' + k));
    for (const k of ['finished', 'host_ended', 'too_few']) assert.ok(keys.includes('ob_reason_' + k));
    for (const k of ['start', 'turn', 'truth', 'dare', 'swap', 'pass', 'vote', 'done', 'fail', 'none', 'skip', 'left', 'end']) assert.ok(keys.includes('ob_ev_' + k), k);
    for (const k of ['ob_title', 'ob_tagline', 'ob_one_phone_note', 'ob_need_three', 'ob_start', 'ob_new_match', 'ob_settings_next_match', 'intro_ob_1', 'intro_ob_2_t', 'intro_ob_3',
        'help_ob_basics_t', 'help_ob_turn', 'help_ob_vote', 'help_ob_host', 'help_ob_settings', 'err_need_players_obbligo', 'err_not_your_turn', 'err_pass_used', 'err_swap_used']) assert.ok(keys.includes(k), k);
    for (const m of fs.readFileSync(path.join(ROOT, 'public', 'js', 'spia', 'app.js'), 'utf8').matchAll(/(?:title|tagline|note|need): '(ob_\w+)'/g)) assert.ok(keys.includes(m[1]), m[1]);
});

test('the page is served with its files, respects reduced motion, and is listed in the games and the sitemap', async () => {
    const html = await (await fetch(`${site.base}/pages/obbligo.html`)).text();
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'no inline scripts');
    assert.match(html, /data-game="obbligo"/);
    for (const f of ['/js/obbligo/game.js', '/js/obbligo/texts.js', '/css/obbligo.css', '/assets/obbligo/icon.svg', '/assets/obbligo/manifest.json']) assert.equal((await fetch(site.base + f)).status, 200, f);
    assert.match(fs.readFileSync(path.join(ROOT, 'public', 'css', 'obbligo.css'), 'utf8'), /prefers-reduced-motion: reduce[^}]*ob-bottle/);
    const games = await (await fetch(`${site.base}/pages/giochi.php`)).text();
    const map = await (await fetch(`${site.base}/sitemap.php`)).text();
    assert.ok(games.includes('obbligo.html') && map.includes('pages/obbligo.html'));
});
