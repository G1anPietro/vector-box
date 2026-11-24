// tests/preferiresti.test.js — "Would you rather" rooms: the bank of pairs, secret picks, the split, the minority scoring, ties,
// unanimity, nobody picking, rounds and standings, one shared phone, categories, leaving, host tools, the admin LIVE view,
// the five languages and the page files
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
const BANK = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib', 'preferiresti-q.json'), 'utf8'));

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

/** Phone A (host) has P1, B has P2, C has P3, D has P4 (n players, one per phone). */
async function room(settings = {}, n = 3) {
    try { site.db('DELETE FROM rate_limits'); } catch (e) { /* not created yet */ }
    const a = await Phone.fresh();
    const code = (await a.post({ action: 'create', game: 'preferiresti', players: ['P1'], settings })).json.code;
    const phones = [a];
    for (let i = 2; i <= n; i++) { const p = await Phone.fresh(); await p.post({ action: 'join', code }); await p.post({ action: 'player_add', name: 'P' + i }); phones.push(p); }
    const s = await a.state();
    const id = Object.fromEntries(s.players.map((p) => [p.name, p.id]));
    const where = 'room_id = (SELECT id FROM spia_rooms WHERE code = ?)';
    const game = () => JSON.parse(site.db(`SELECT state FROM preferiresti_games WHERE ${where}`, [code])[0].state);
    const setGame = (g) => site.db(`UPDATE preferiresti_games SET state = ? WHERE ${where}`, [JSON.stringify(g), code]);
    return { a, phones, code, id, game, setGame };
}
const pick = (r, who, side) => r.phones[who - 1].post({ action: 'vote', player_id: r.id['P' + who], side });
const expire = (r) => { const g = r.game(); g.q.deadline = Date.now() / 1000 - 1; r.setGame(g); };
const skipReveal = async (r) => { const g = r.game(); g.next_at = Date.now() / 1000 - 1; r.setGame(g); return (await r.a.state()).preferiresti; };

test('the bank: at least 80 pairs, three categories, A and B in the five languages, French texts are infinitives', () => {
    assert.ok(BANK.length >= 80);
    for (const c of [0, 1, 2]) assert.ok(BANK.filter((q) => q[0] === c).length >= 20, 'category ' + c);
    for (const [i, row] of BANK.entries()) {
        assert.equal(row.length, 3, 'row ' + i);
        assert.ok([0, 1, 2].includes(row[0]));
        for (const side of [row[1], row[2]]) {
            assert.equal(side.length, 5, 'row ' + i);
            assert.ok(side.every((x) => typeof x === 'string' && x.trim().length > 5), 'row ' + i);
        }
        assert.notEqual(row[1][1], row[2][1], 'A and B differ in row ' + i);
    }
    assert.equal(new Set(BANK.map((q) => q[1][1])).size, BANK.length, 'no pair twice');
});

test('migration V49 created preferiresti_games; settings are cleaned; three players are needed', async () => {
    await fetch(`${site.base}/api/rooms.php`);
    assert.ok(site.db('PRAGMA user_version')[0].user_version >= 49);
    const a = await Phone.fresh();
    await a.post({ action: 'create', game: 'preferiresti', players: ['A', 'B'], settings: { rounds: 99, time: 3, calm: false, absurd: false, spicy: false } });
    const s = await a.state();
    assert.equal(s.game, 'preferiresti');
    assert.deepEqual(s.settings, { rounds: 10, time: 30, calm: true, absurd: false, spicy: false }, 'bad values cleaned, at least one category');
    assert.equal((await a.post({ action: 'start' })).status, 409, 'two players are not enough');
    assert.equal((await a.post({ action: 'settings', settings: { rounds: 15, time: 45, spicy: true } })).status, 200);
    assert.deepEqual((await a.state()).settings, { rounds: 15, time: 45, calm: true, absurd: false, spicy: true });
});

test('picks are secret: no phone ever gets who chose what, and no split before the reveal', async () => {
    const r = await room();
    assert.equal((await r.a.post({ action: 'start' })).status, 200);
    assert.equal((await pick(r, 1, 'a')).status, 200);
    assert.equal((await pick(r, 2, 'b')).status, 200);
    for (const ph of r.phones) {
        const s = await ph.state();
        const P = s.preferiresti;
        assert.equal(P.phase, 'vote'); assert.equal(P.reveal, null);
        assert.deepEqual(P.voted.sort(), [r.id.P1, r.id.P2].sort(), 'who has picked is public');
        const raw = JSON.stringify(s);
        assert.ok(!('votes' in P) && !raw.includes('"choices"') && !raw.includes('"side"') && !raw.includes('"minority"'), 'nothing about the picks');
        for (const side of ['a', 'b']) for (const l of ['it', 'en', 'es', 'fr', 'de']) assert.ok(P.q[side][l].length > 3, `${side}.${l}`);
    }
    assert.deepEqual((await r.a.state()).preferiresti.me, [{ player_id: r.id.P1, active: true, voted: true }]);
});

test('pick checks: bad side, not your player, twice', async () => {
    const r = await room();
    await r.a.post({ action: 'start' });
    const bad = await pick(r, 1, 'c');
    assert.equal(bad.status, 409); assert.equal(bad.json.error, 'bad_side');
    assert.equal((await r.a.post({ action: 'vote', player_id: r.id.P2, side: 'a' })).status, 403, 'not your player');
    assert.equal((await r.a.post({ action: 'vote', player_id: r.id.P1, side: 1 })).status, 409);
    assert.equal((await pick(r, 1, 'a')).status, 200);
    assert.equal((await pick(r, 1, 'b')).status, 409, 'already picked');
});

test('everybody picked: the split appears, the minority scores, and only now who chose what', async () => {
    const r = await room({}, 4);
    await r.a.post({ action: 'start' });
    await pick(r, 1, 'a'); await pick(r, 2, 'a'); await pick(r, 3, 'a');
    assert.equal((await r.a.state()).preferiresti.phase, 'vote', 'one pick still missing');
    await pick(r, 4, 'b');
    const P = (await r.phones[1].state()).preferiresti;
    assert.equal(P.phase, 'reveal');
    assert.equal(P.reveal.a, 3); assert.equal(P.reveal.b, 1); assert.equal(P.reveal.minority, 'b');
    assert.deepEqual(P.reveal.scorers, [r.id.P4]);
    assert.equal(P.reveal.choices[r.id.P4], 'b'); assert.equal(P.reveal.choices[r.id.P1], 'a');
    assert.deepEqual(Object.keys(P.reveal).sort(), ['a', 'b', 'choices', 'last', 'minority', 'scorers', 'voted']);
    assert.ok(P.events.some((e) => e.t === 'fly' && e.p === r.id.P4));
    assert.ok(P.next_left > 0);
    assert.equal(r.game().stats[r.id.P4].pts, 1); assert.equal(r.game().stats[r.id.P1].pts, 0);
});

test('a tie, everybody on the same side, nobody picking: nobody scores; a missing player does not count', async () => {
    const r = await room({}, 4);
    await r.a.post({ action: 'start' });
    await pick(r, 1, 'a'); await pick(r, 2, 'a'); await pick(r, 3, 'b'); await pick(r, 4, 'b');
    let P = (await r.a.state()).preferiresti;
    assert.equal(P.reveal.minority, null); assert.deepEqual(P.reveal.scorers, []);
    assert.ok(P.events.some((e) => e.t === 'tie'));

    const s = await room();
    await s.a.post({ action: 'start' });
    await pick(s, 1, 'b'); await pick(s, 2, 'b'); await pick(s, 3, 'b');
    P = (await s.a.state()).preferiresti;
    assert.equal(P.reveal.minority, null); assert.ok(P.events.some((e) => e.t === 'same'));

    const e = await room();
    await e.a.post({ action: 'start' });
    expire(e);
    P = (await e.a.state()).preferiresti;
    assert.equal(P.reveal.voted, 0); assert.deepEqual(P.reveal.scorers, []);
    assert.ok(P.events.some((x) => x.t === 'none'));

    const m = await room();
    await m.a.post({ action: 'start' });
    await pick(m, 1, 'a'); await pick(m, 2, 'b');   // P3 is too slow
    expire(m);
    P = (await m.a.state()).preferiresti;
    assert.equal(P.reveal.minority, null, '1 against 1: a tie');
    assert.equal(m.game().stats[m.id.P3].missed, 1);
});

test('the host can skip the reveal, others cannot; after the last round the standings come with titles; a new match is possible', async () => {
    const r = await room({ rounds: 5, time: 20 });
    await r.a.post({ action: 'start' });
    const seen = new Set();
    for (let round = 1; round <= 5; round++) {
        const g = r.game(); assert.equal(g.round, round); assert.ok(!seen.has(g.q.i), 'pair not repeated'); seen.add(g.q.i);
        await pick(r, 1, 'a'); await pick(r, 2, 'a');
        if (round === 5) expire(r); else await pick(r, 3, 'b');   // P3 is always alone; in the last round P3 misses
        let P = (await r.a.state()).preferiresti;
        assert.equal(P.reveal.last, round === 5);
        if (round === 1) {
            assert.equal((await r.phones[1].post({ action: 'next' })).status, 403);
            assert.equal((await r.a.post({ action: 'next' })).status, 200);
        } else P = await skipReveal(r);
    }
    const P = (await r.a.state()).preferiresti;
    assert.equal(P.status, 'ended'); assert.equal(P.result.reason, 'finished');
    assert.equal(P.result.rows[0].p, r.id.P3); assert.equal(P.result.rows[0].pts, 4);
    assert.equal(P.result.titles[r.id.P3], 'fly');
    assert.ok(Object.values(P.result.titles).includes('herd'));
    assert.equal(Object.values(P.result.titles).length, new Set(Object.values(P.result.titles)).size, 'one title each');
    assert.equal((await r.a.post({ action: 'start' })).status, 200, 'a new match');
    assert.equal((await r.a.state()).preferiresti.match, 2);
});

test('one phone for everybody: several players on one device pick in turn', async () => {
    const a = await Phone.fresh();
    await a.post({ action: 'create', game: 'preferiresti', players: ['X', 'Y', 'Z'] });
    assert.equal((await a.post({ action: 'start' })).status, 200);
    const s = await a.state();
    assert.equal(s.preferiresti.me.length, 3);
    const id = Object.fromEntries(s.players.map((p) => [p.name, p.id]));
    assert.equal((await a.post({ action: 'vote', player_id: id.X, side: 'a' })).status, 200);
    assert.equal((await a.post({ action: 'vote', player_id: id.Y, side: 'a' })).status, 200);
    assert.equal((await a.state()).preferiresti.phase, 'vote');
    assert.equal((await a.post({ action: 'vote', player_id: id.Z, side: 'b' })).status, 200);
    const P = (await a.state()).preferiresti;
    assert.equal(P.phase, 'reveal'); assert.deepEqual(P.reveal.scorers, [id.Z]); assert.equal(P.reveal.a, 2);
});

test('categories: spicy pairs only when the host turns them on', async () => {
    const r = await room({});
    await r.a.post({ action: 'start' });
    for (let i = 0; i < 12; i++) {
        const g = r.game(); assert.notEqual(BANK[g.q.i][0], 2, 'no spicy by default');
        g.phase = 'reveal'; g.next_at = 0; r.setGame(g); await r.a.state();
    }
    const s = await room({ calm: false, absurd: false, spicy: true });
    await s.a.post({ action: 'start' });
    for (let i = 0; i < 6; i++) {
        const g = s.game(); assert.equal(BANK[g.q.i][0], 2);
        g.phase = 'reveal'; g.next_at = 0; s.setGame(g); await s.a.state();
    }
    const f = await room({ calm: false, absurd: true, spicy: false });
    await f.a.post({ action: 'start' });
    assert.equal(BANK[f.game().q.i][0], 1);
});

test('leaving: with fewer than 3 players the match ends; the host can end it; others cannot', async () => {
    const r = await room({}, 3);
    await r.a.post({ action: 'start' });
    await pick(r, 1, 'a');
    await r.phones[2].post({ action: 'leave' });
    const P = (await r.a.state()).preferiresti;
    assert.equal(P.status, 'ended'); assert.equal(P.result.reason, 'too_few');

    const e = await room();
    await e.a.post({ action: 'start' });
    assert.equal((await e.phones[1].post({ action: 'end' })).status, 403);
    assert.equal((await e.a.post({ action: 'end' })).status, 200);
    assert.equal((await e.a.state()).preferiresti.result.reason, 'host_ended');
});

test('the admin LIVE view shows who chose what; a normal visitor cannot see it', async () => {
    const r = await room();
    await r.a.post({ action: 'start' });
    await pick(r, 1, 'b');
    const admin = await makeAdmin(site, 'preferiresti_admin');
    const live = (await admin.get('/api/spia.php?action=live')).json.rooms.find((x) => x.code === r.code);
    assert.equal(live.game, 'preferiresti');
    assert.equal(live.preferiresti.phase, 'vote'); assert.equal(live.preferiresti.votes[r.id.P1], 'b');
    assert.ok(live.preferiresti.a && live.preferiresti.b);
    assert.equal((await new Client(site).get('/api/spia.php?action=live')).status !== 200, true);
    assert.match((await admin.get('/api/spia.php?action=ext')).text, /preferiresti/i, 'the admin script knows the game');
});

test('translations: the five languages have the same keys, every key the game uses exists, the help and intro texts are complete', () => {
    const dict = { it: {}, en: {}, es: {}, fr: {}, de: {} };
    const win = { SpiaI18n: { strings: dict } };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'preferiresti', 'texts.js'), 'utf8'), { window: win });
    const keys = Object.keys(dict.en);
    assert.ok(keys.length > 80);
    for (const l of ['it', 'es', 'fr', 'de']) {
        assert.deepEqual(Object.keys(dict[l]).sort(), keys.slice().sort(), l + ' has the same keys as English');
        for (const k of keys) assert.ok(String(dict[l][k]).trim(), `${l}.${k} is empty`);
    }
    const placeholders = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
    for (const k of keys) for (const l of ['it', 'es', 'fr', 'de']) assert.equal(placeholders(dict[l][k]), placeholders(dict.en[k]), `${l}.${k} placeholders`);
    const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'preferiresti', 'game.js'), 'utf8');
    for (const m of js.matchAll(/'(pf_[a-z_]+)'/g)) if (!m[1].endsWith('_')) assert.ok(keys.includes(m[1]), 'game.js uses an unknown key ' + m[1]);
    for (const side of ['a', 'b']) assert.ok(keys.includes('pf_option_' + side) && keys.includes('pf_chose_' + side));
    for (const k of ['fly', 'herd', 'ghost']) assert.ok(keys.includes('pf_title_' + k) && keys.includes('pf_title_' + k + '_d'));
    for (const k of ['finished', 'host_ended', 'too_few']) assert.ok(keys.includes('pf_reason_' + k));
    for (const k of ['calm', 'absurd', 'spicy']) assert.ok(keys.includes('pf_cat_' + k));
    for (const k of ['pf_title', 'pf_tagline', 'pf_one_phone_note', 'pf_need_three', 'pf_start', 'pf_new_match', 'pf_settings_next_match', 'intro_pf_1', 'intro_pf_2_t', 'intro_pf_3',
        'help_pf_basics_t', 'help_pf_rounds', 'help_pf_titles', 'help_pf_host', 'help_pf_settings', 'err_need_players_preferiresti', 'err_already_voted', 'err_bad_side']) assert.ok(keys.includes(k), k);
    for (const m of fs.readFileSync(path.join(ROOT, 'public', 'js', 'spia', 'app.js'), 'utf8').matchAll(/(?:title|tagline|note|need): '(pf_\w+)'/g)) assert.ok(keys.includes(m[1]), m[1]);
});

test('the page is served with its files and listed in the games and the sitemap', async () => {
    const html = await (await fetch(`${site.base}/pages/preferiresti.html`)).text();
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'no inline scripts');
    assert.match(html, /data-game="preferiresti"/);
    for (const f of ['/js/preferiresti/game.js', '/js/preferiresti/texts.js', '/css/preferiresti.css', '/assets/preferiresti/icon.svg', '/assets/preferiresti/manifest.json']) assert.equal((await fetch(site.base + f)).status, 200, f);
    const games = await (await fetch(`${site.base}/pages/giochi.php`)).text();
    const map = await (await fetch(`${site.base}/sitemap.php`)).text();
    assert.ok(games.includes('preferiresti.html') && map.includes('pages/preferiresti.html'));
});
