// tests/probabile.test.js — "Most likely to" rooms: the sentence bank, secret votes, counts, ties, nobody voting, rounds and
// standings, one shared phone, categories, leaving, host tools, the admin LIVE view, the five languages and the page files
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
const BANK = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib', 'probabile-q.json'), 'utf8'));

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
    const code = (await a.post({ action: 'create', game: 'probabile', players: ['P1'], settings })).json.code;
    const phones = [a];
    for (let i = 2; i <= n; i++) { const p = await Phone.fresh(); await p.post({ action: 'join', code }); await p.post({ action: 'player_add', name: 'P' + i }); phones.push(p); }
    const s = await a.state();
    const id = Object.fromEntries(s.players.map((p) => [p.name, p.id]));
    const where = 'room_id = (SELECT id FROM spia_rooms WHERE code = ?)';
    const game = () => JSON.parse(site.db(`SELECT state FROM probabile_games WHERE ${where}`, [code])[0].state);
    const setGame = (g) => site.db(`UPDATE probabile_games SET state = ? WHERE ${where}`, [JSON.stringify(g), code]);
    return { a, phones, code, id, game, setGame };
}
const vote = (r, who, target) => r.phones[who - 1].post({ action: 'vote', player_id: r.id['P' + who], target: r.id['P' + target] });
const expire = (r) => { const g = r.game(); g.q.deadline = Date.now() / 1000 - 1; r.setGame(g); };
const skipReveal = async (r) => { const g = r.game(); g.next_at = Date.now() / 1000 - 1; r.setGame(g); return (await r.a.state()).probabile; };

test('the sentence bank: at least 80 sentences, three categories, the five languages, French ones start with de / d\'', () => {
    assert.ok(BANK.length >= 80);
    for (const c of [0, 1, 2]) assert.ok(BANK.filter((q) => q[0] === c).length >= 20, 'category ' + c);
    for (const [i, row] of BANK.entries()) {
        assert.equal(row.length, 6, 'row ' + i);
        assert.ok([0, 1, 2].includes(row[0]));
        assert.ok(row.slice(1).every((x) => typeof x === 'string' && x.trim().length > 5), 'row ' + i);
        assert.match(row[4], /^(de |d')/, 'French sentence ' + i);
    }
    assert.equal(new Set(BANK.map((q) => q[2])).size, BANK.length, 'no sentence twice');
});

test('migration V48 created probabile_games; settings are cleaned; three players are needed', async () => {
    await fetch(`${site.base}/api/rooms.php`);
    assert.ok(site.db('PRAGMA user_version')[0].user_version >= 48);
    const a = await Phone.fresh();
    await a.post({ action: 'create', game: 'probabile', players: ['A', 'B'], settings: { rounds: 99, time: 3, calm: false, friends: false, spicy: false } });
    const s = await a.state();
    assert.equal(s.game, 'probabile');
    assert.deepEqual(s.settings, { rounds: 10, time: 30, calm: true, friends: false, spicy: false }, 'bad values cleaned, at least one category');
    assert.equal((await a.post({ action: 'start' })).status, 409, 'two players are not enough');
    assert.equal((await a.post({ action: 'settings', settings: { rounds: 15, time: 45, spicy: true } })).status, 200);
    assert.deepEqual((await a.state()).settings, { rounds: 15, time: 45, calm: true, friends: false, spicy: true });
});

test('votes are secret: no phone ever gets who voted for whom, and no counts before the reveal', async () => {
    const r = await room();
    assert.equal((await r.a.post({ action: 'start' })).status, 200);
    assert.equal((await vote(r, 1, 2)).status, 200);
    assert.equal((await vote(r, 2, 3)).status, 200);
    for (const ph of r.phones) {
        const s = await ph.state();
        const P = s.probabile;
        assert.equal(P.phase, 'vote'); assert.equal(P.reveal, null);
        assert.deepEqual(P.voted.sort(), [r.id.P1, r.id.P2].sort(), 'who voted is public');
        assert.ok(!('votes' in P) && !JSON.stringify(s).includes('"target"') && !JSON.stringify(s).includes('"counts"'), 'nothing about the votes');
        assert.equal(P.q.text.it.length > 3 && !!P.q.text.de && !!P.q.text.fr && !!P.q.text.es && !!P.q.text.en, true, 'sentence in 5 languages');
    }
    const mine = (await r.a.state()).probabile.me;
    assert.deepEqual(mine, [{ player_id: r.id.P1, active: true, voted: true }]);
});

test('vote checks: not yourself, not your player, unknown target, twice', async () => {
    const r = await room();
    await r.a.post({ action: 'start' });
    const self = await vote(r, 1, 1);
    assert.equal(self.status, 409); assert.equal(self.json.error, 'not_yourself');
    assert.equal((await r.a.post({ action: 'vote', player_id: r.id.P2, target: r.id.P3 })).status, 403, 'not your player');
    assert.equal((await r.a.post({ action: 'vote', player_id: r.id.P1, target: 99999 })).status, 409);
    assert.equal((await r.a.post({ action: 'vote', player_id: r.id.P1, target: 'x' })).status, 409);
    assert.equal((await vote(r, 1, 2)).status, 200);
    assert.equal((await vote(r, 1, 3)).status, 409, 'already voted');
});

test('everybody voted: the counts appear, the most voted takes the mark, only counts are shown', async () => {
    const r = await room({}, 4);
    await r.a.post({ action: 'start' });
    await vote(r, 1, 3); await vote(r, 2, 3); await vote(r, 3, 1);
    assert.equal((await r.a.state()).probabile.phase, 'vote', 'one vote still missing');
    await vote(r, 4, 3);
    const P = (await r.phones[1].state()).probabile;
    assert.equal(P.phase, 'reveal');
    assert.deepEqual(P.reveal.marked, [r.id.P3]);
    assert.equal(P.reveal.counts[r.id.P3], 3); assert.equal(P.reveal.counts[r.id.P1], 1); assert.equal(P.reveal.counts[r.id.P2], 0);
    assert.deepEqual(Object.keys(P.reveal).sort(), ['counts', 'last', 'marked', 'max', 'voted']);
    assert.ok(P.events.some((e) => e.t === 'marked' && e.p === r.id.P3));
    assert.ok(P.next_left > 0);
});

test('a tie: all the tied players take the mark; nobody voted: no mark', async () => {
    const r = await room();
    await r.a.post({ action: 'start' });
    await vote(r, 1, 2); await vote(r, 2, 1);   // P3 does not vote in time
    expire(r);
    let P = (await r.a.state()).probabile;
    assert.deepEqual(P.reveal.marked.sort(), [r.id.P1, r.id.P2].sort());
    assert.ok(P.events.some((e) => e.t === 'tie'));

    const e = await room();
    await e.a.post({ action: 'start' });
    expire(e);
    P = (await e.a.state()).probabile;
    assert.deepEqual(P.reveal.marked, []); assert.equal(P.reveal.max, 0);
    assert.ok(P.events.some((x) => x.t === 'none'));
});

test('the host can skip the reveal, others cannot; after the last round the standings come with titles; a new match is possible', async () => {
    const r = await room({ rounds: 5, time: 20 });
    await r.a.post({ action: 'start' });
    const seen = new Set();
    for (let round = 1; round <= 5; round++) {
        const g = r.game(); assert.equal(g.round, round); assert.ok(!seen.has(g.q.i), 'sentence not repeated'); seen.add(g.q.i);
        await vote(r, 1, 3); await vote(r, 2, 3); await vote(r, 3, 1);
        let P = (await r.a.state()).probabile;
        assert.equal(P.reveal.last, round === 5);
        if (round === 1) {
            assert.equal((await r.phones[1].post({ action: 'next' })).status, 403);
            assert.equal((await r.a.post({ action: 'next' })).status, 200);
        } else P = await skipReveal(r);
    }
    const P = (await r.a.state()).probabile;
    assert.equal(P.status, 'ended'); assert.equal(P.result.reason, 'finished');
    assert.equal(P.result.rows[0].p, r.id.P3); assert.equal(P.result.rows[0].marks, 5); assert.equal(P.result.rows[0].got, 10);
    assert.equal(P.result.titles[r.id.P3], 'target');
    assert.equal(Object.values(P.result.titles).length, new Set(Object.values(P.result.titles)).size, 'one title each');
    assert.ok(Object.values(P.result.titles).includes('saint'));
    assert.equal((await r.a.post({ action: 'start' })).status, 200, 'a new match');
    assert.equal((await r.a.state()).probabile.match, 2);
});

test('one phone for everybody: several players on one device vote in turn', async () => {
    const a = await Phone.fresh();
    await a.post({ action: 'create', game: 'probabile', players: ['X', 'Y', 'Z'] });
    assert.equal((await a.post({ action: 'start' })).status, 200);
    const s = await a.state();
    assert.equal(s.probabile.me.length, 3);
    const id = Object.fromEntries(s.players.map((p) => [p.name, p.id]));
    assert.equal((await a.post({ action: 'vote', player_id: id.X, target: id.Y })).status, 200);
    assert.equal((await a.post({ action: 'vote', player_id: id.Y, target: id.X })).status, 200);
    assert.equal((await a.state()).probabile.phase, 'vote');
    assert.equal((await a.post({ action: 'vote', player_id: id.Z, target: id.X })).status, 200);
    const P = (await a.state()).probabile;
    assert.equal(P.phase, 'reveal'); assert.deepEqual(P.reveal.marked, [id.X]); assert.equal(P.reveal.counts[id.X], 2);
});

test('categories: spicy sentences only when the host turns them on', async () => {
    const r = await room({});
    await r.a.post({ action: 'start' });
    for (let i = 0; i < 12; i++) {
        const g = r.game(); assert.notEqual(BANK[g.q.i][0], 2, 'no spicy by default');
        g.phase = 'reveal'; g.next_at = 0; r.setGame(g); await r.a.state();
    }
    const s = await room({ calm: false, friends: false, spicy: true });
    await s.a.post({ action: 'start' });
    for (let i = 0; i < 6; i++) {
        const g = s.game(); assert.equal(BANK[g.q.i][0], 2);
        g.phase = 'reveal'; g.next_at = 0; s.setGame(g); await s.a.state();
    }
    const f = await room({ calm: false, friends: true, spicy: false });
    await f.a.post({ action: 'start' });
    assert.equal(BANK[f.game().q.i][0], 1);
});

test('leaving: with fewer than 3 players the match ends; the host can end it; others cannot', async () => {
    const r = await room({}, 3);
    await r.a.post({ action: 'start' });
    await vote(r, 1, 2);
    await r.phones[2].post({ action: 'leave' });
    const P = (await r.a.state()).probabile;
    assert.equal(P.status, 'ended'); assert.equal(P.result.reason, 'too_few');

    const e = await room();
    await e.a.post({ action: 'start' });
    assert.equal((await e.phones[1].post({ action: 'end' })).status, 403);
    assert.equal((await e.a.post({ action: 'end' })).status, 200);
    assert.equal((await e.a.state()).probabile.result.reason, 'host_ended');
});

test('the admin LIVE view shows who voted for whom; a normal visitor cannot see it', async () => {
    const r = await room();
    await r.a.post({ action: 'start' });
    await vote(r, 1, 2);
    const admin = await makeAdmin(site, 'probabile_admin');
    const live = (await admin.get('/api/spia.php?action=live')).json.rooms.find((x) => x.code === r.code);
    assert.equal(live.game, 'probabile');
    assert.equal(live.probabile.phase, 'vote'); assert.equal(live.probabile.votes[r.id.P1], r.id.P2);
    assert.ok(live.probabile.question);
    assert.equal((await new Client(site).get('/api/spia.php?action=live')).status !== 200, true);
    assert.match((await admin.get('/api/spia.php?action=ext')).text, /probabile/i, 'the admin script knows the game');
});

test('translations: the five languages have the same keys, every key the game uses exists, the help and intro texts are complete', () => {
    const dict = { it: {}, en: {}, es: {}, fr: {}, de: {} };
    const win = { SpiaI18n: { strings: dict } };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'probabile', 'texts.js'), 'utf8'), { window: win });
    const keys = Object.keys(dict.en);
    assert.ok(keys.length > 80);
    for (const l of ['it', 'es', 'fr', 'de']) {
        assert.deepEqual(Object.keys(dict[l]).sort(), keys.slice().sort(), l + ' has the same keys as English');
        for (const k of keys) assert.ok(String(dict[l][k]).trim(), `${l}.${k} is empty`);
    }
    const placeholders = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
    for (const k of keys) for (const l of ['it', 'es', 'fr', 'de']) assert.equal(placeholders(dict[l][k]), placeholders(dict.en[k]), `${l}.${k} placeholders`);
    const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'probabile', 'game.js'), 'utf8');
    for (const m of js.matchAll(/\bt\(\s*'(pr_[a-z_]+)'/g)) if (!m[1].endsWith('_')) assert.ok(keys.includes(m[1]), 'game.js uses an unknown key ' + m[1]);
    for (const k of ['pr_title', 'pr_tagline', 'pr_one_phone_note', 'pr_need_three', 'pr_start', 'pr_new_match', 'pr_settings_next_match', 'intro_pr_1', 'intro_pr_2_t', 'intro_pr_3',
        'help_pr_basics_t', 'help_pr_rounds', 'help_pr_titles', 'help_pr_host', 'help_pr_settings', 'err_need_players_probabile', 'err_already_voted', 'err_not_yourself',
        'pr_title_target', 'pr_title_saint', 'pr_title_oracle', 'pr_title_rebel', 'pr_reason_finished', 'pr_reason_host_ended', 'pr_reason_too_few', 'pr_cat_calm', 'pr_cat_friends', 'pr_cat_spicy', 'pr_title_target_d', 'pr_title_rebel_d', 'pr_votes_zero', 'pr_votes_one', 'pr_votes_n']) assert.ok(keys.includes(k), k);
    for (const m of fs.readFileSync(path.join(ROOT, 'public', 'js', 'spia', 'app.js'), 'utf8').matchAll(/(?:title|tagline|note|need): '(pr_\w+)'/g)) assert.ok(keys.includes(m[1]), m[1]);
});

test('the page is served in English with its files, listed in the games and the sitemap; the old "Serata" page is gone', async () => {
    const html = await (await fetch(`${site.base}/pages/probabile.html`)).text();
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'no inline scripts');
    for (const f of ['/js/probabile/game.js', '/js/probabile/texts.js', '/css/probabile.css', '/assets/probabile/icon.svg', '/assets/probabile/manifest.json']) assert.equal((await fetch(site.base + f)).status, 200, f);
    const games = await (await fetch(`${site.base}/pages/giochi.php`)).text();
    const map = await (await fetch(`${site.base}/sitemap.php`)).text();
    assert.ok(games.includes('probabile.html') && map.includes('pages/probabile.html'));
    assert.ok(!games.includes('serata.html') && !map.includes('serata.html'));
    for (const f of ['/pages/serata.html', '/js/serata.js', '/css/serata.css', '/assets/serata/icon.svg']) assert.equal((await fetch(site.base + f)).status, 404, f);
    assert.ok(!fs.existsSync(path.join(ROOT, 'tests', 'serata.test.js')));
});
