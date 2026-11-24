// tests/mimo.test.js — "Mimo" rooms: the bank of words, teams (random and chosen by the host), the word that reaches only the mime's phone,
// guessed / pass, the server-side time, rounds and the winner, one shared phone, leaving, host tools, the admin LIVE view,
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
const BANK = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib', 'mimo-q.json'), 'utf8'));

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
    const code = (await a.post({ action: 'create', game: 'mimo', players: ['P1'], settings })).json.code;
    const phones = [a];
    for (let i = 2; i <= n; i++) { const p = await Phone.fresh(); await p.post({ action: 'join', code }); await p.post({ action: 'player_add', name: 'P' + i }); phones.push(p); }
    const s = await a.state();
    const id = Object.fromEntries(s.players.map((p) => [p.name, p.id]));
    const where = 'room_id = (SELECT id FROM spia_rooms WHERE code = ?)';
    const game = () => JSON.parse(site.db(`SELECT state FROM mimo_games WHERE ${where}`, [code])[0].state);
    const setGame = (g) => site.db(`UPDATE mimo_games SET state = ? WHERE ${where}`, [JSON.stringify(g), code]);
    return { a, phones, code, id, game, setGame };
}
const who = (r, pid) => r.phones[Number(Object.keys(r.id).find((k) => r.id[k] === pid).slice(1)) - 1];
const go = (r) => who(r, r.game().mime).post({ action: 'go' });
const act = (r, action) => { const m = r.game().mime; return who(r, m).post({ action, player_id: m }); };
/** Makes the time of the turn on stage run out: the next request closes it. */
const timeUp = (r) => { const g = r.game(); g.ends_at = Date.now() / 1000 - 1; r.setGame(g); };
const textOf = (ref) => { const row = BANK[ref[0]][ref[1]][ref[2]]; return row; };

test('the bank: at least 150 words in 5 categories and 2 levels, five languages each', () => {
    let n = 0;
    assert.deepEqual(Object.keys(BANK).sort(), ['actions', 'animals', 'film', 'jobs', 'sports']);
    for (const [c, levels] of Object.entries(BANK)) {
        assert.deepEqual(Object.keys(levels).sort(), ['easy', 'hard']);
        for (const [lv, rows] of Object.entries(levels)) {
            assert.ok(rows.length >= 12, `${c}.${lv}`);
            for (const row of rows) { n++; assert.equal(row.length, 5); assert.ok(row.every((x) => typeof x === 'string' && x.trim().length >= 2), `${c}.${lv} ${row}`); }
            assert.equal(new Set(rows.map((r) => r[0])).size, rows.length, `${c}.${lv} Italian words are unique`);
        }
    }
    assert.ok(n >= 150, 'words: ' + n);
});

test('migration V53 created mimo_games; settings are cleaned; a team of two is needed on several phones', async () => {
    await fetch(`${site.base}/api/rooms.php`);
    assert.ok(site.db('PRAGMA user_version')[0].user_version >= 53);
    const a = await Phone.fresh();
    await a.post({ action: 'create', game: 'mimo', players: ['A'], settings: { teams: 9, rounds: 4, secs: 10, cat: 'x', level: 'y', assign: 'z', map: { 1: 1 } } });
    const s = await a.state();
    assert.equal(s.game, 'mimo');
    assert.deepEqual(s.settings, { teams: 2, rounds: 3, secs: 60, cat: 'mix', level: 'mix', assign: 'random', map: [] }, 'bad values cleaned');
    const b = await Phone.fresh(); await b.post({ action: 'join', code: s.code }); await b.post({ action: 'player_add', name: 'B' });
    const c = await Phone.fresh(); await c.post({ action: 'join', code: s.code }); await c.post({ action: 'player_add', name: 'C' });
    assert.equal((await a.post({ action: 'start' })).status, 409, 'three players on three phones are not enough');
    assert.equal((await b.post({ action: 'settings', settings: { teams: 3 } })).status, 403);
    assert.equal((await a.post({ action: 'settings', settings: { teams: 3, rounds: 5, secs: 90, cat: 'jobs', level: 'hard', assign: 'host' } })).status, 200);
    assert.deepEqual((await a.state()).settings, { teams: 3, rounds: 5, secs: 90, cat: 'jobs', level: 'hard', assign: 'host', map: [] });
});

test('teams at random: balanced, every player in one; the mime is of the team on stage and turns rotate', async () => {
    const r = await room({}, 4);
    assert.equal((await r.phones[1].post({ action: 'start' })).status, 403);
    assert.equal((await r.a.post({ action: 'start' })).status, 200);
    const g = r.game();
    const counts = [0, 0];
    for (const p of g.order) counts[g.team[p]]++;
    assert.deepEqual(counts, [2, 2]);
    assert.equal(g.phase, 'ready'); assert.equal(g.turn, 0); assert.equal(g.total, 6);
    assert.equal(g.team[g.mime], 0, 'team 0 opens');
    assert.equal((await r.a.post({ action: 'start' })).status, 409, 'a match is running');
    const seen = new Set([g.mime]);
    for (let i = 1; i < 4; i++) { await go(r); timeUp(r); await r.a.state(); const x = r.game(); assert.equal(x.team[x.mime], i % 2); seen.add(x.mime); }
    assert.equal(seen.size, 4, 'everybody mimed once in four turns');
});

test('the host chooses the teams: only the host, valid teams, unbalanced teams are refused, then the choice is used', async () => {
    const r = await room({ assign: 'host' }, 4);
    const [p1, p2, p3, p4] = ['P1', 'P2', 'P3', 'P4'].map((k) => r.id[k]);
    assert.equal((await r.phones[1].post({ action: 'team', player_id: p2, team: 0 })).status, 403);
    assert.equal((await r.a.post({ action: 'team', player_id: p2, team: 5 })).status, 409);
    assert.equal((await r.a.post({ action: 'team', player_id: 99999, team: 0 })).status, 409);
    for (const p of [p1, p2, p3]) assert.equal((await r.a.post({ action: 'team', player_id: p, team: 0 })).status, 200);
    assert.equal((await r.a.post({ action: 'team', player_id: p4, team: 1 })).status, 200);
    assert.equal((await r.a.state()).settings.map[p4], 1);
    assert.equal((await r.a.post({ action: 'start' })).status, 409, '3 against 1 on several phones is refused');
    assert.equal((await r.a.post({ action: 'team', player_id: p3, team: 1 })).status, 200);
    assert.equal((await r.a.post({ action: 'start' })).status, 200);
    const g = r.game();
    assert.deepEqual([p1, p2, p3, p4].map((p) => g.team[p]), [0, 0, 1, 1]);
    const t3 = await room({ teams: 3 }, 4);
    assert.equal((await t3.a.post({ action: 'start' })).status, 409, 'three teams need six players on several phones');
    const t6 = await room({ teams: 3 }, 6);
    assert.equal((await t6.a.post({ action: 'start' })).status, 200);
    assert.equal(t6.game().total, 9);
});

test('the word reaches only the mime on stage; the deadline never appears; the admin LIVE view shows the word', async () => {
    const r = await room({ secs: 30 }, 4);
    await r.a.post({ action: 'start' });
    let g = r.game();
    for (const ph of r.phones) assert.equal((await ph.state()).mimo.word, null, 'nothing before Go');
    const t0 = Date.now() / 1000;
    assert.equal((await go(r)).status, 200);
    g = r.game();
    assert.ok(g.ends_at - t0 >= 29 && g.ends_at - t0 <= 31, 'deadline = now + 30 s');
    const row = textOf(g.cur.word);
    const admin = await makeAdmin(site, 'mimo_admin_word');
    const mimePhone = who(r, g.mime);
    for (const ph of r.phones) {
        const res = await ph.get('state');
        const P = res.json.mimo;
        if (ph === mimePhone) {
            assert.deepEqual(Object.values(P.word), row, 'the mime gets the word in 5 languages');
            assert.equal(P.passes_left, 3);
        } else {
            assert.equal(P.word, null);
            assert.ok(!res.text.includes(JSON.stringify(row[1])), 'the word text is not in the response of the others');
        }
        assert.ok(!/ends_at|deadline|"cur"/.test(res.text), 'no deadline or raw state');
        assert.ok(P.left > 0 && P.left <= 30, 'the seconds left are sent');
        assert.equal(P.mime, g.mime);
    }
    const live = (await admin.get('/api/spia.php?action=live')).json.rooms.find((x) => x.code === r.code);
    assert.equal(live.game, 'mimo'); assert.equal(live.mimo.word, row[0]); assert.equal(live.mimo.mime, g.mime);
    assert.ok(!JSON.stringify(live).includes('ends_at'));
    assert.equal((await new Client(site).get('/api/spia.php?action=live')).status !== 200, true);
    assert.match((await admin.get('/api/spia.php?action=ext')).text, /mimo/i, 'the admin script knows the game');
});

test('guessed and pass: only the mime on stage, a point for a guess, 3 passes at most, new word each time, Go only once', async () => {
    const r = await room({}, 4);
    await r.a.post({ action: 'start' });
    const g0 = r.game();
    const other = g0.order.find((p) => p !== g0.mime);
    assert.equal((await act(r, 'guess')).status, 409, 'not before Go');
    assert.equal((await who(r, other).post({ action: 'go' })).status, r.a === who(r, other) ? 200 : 409, 'only the mime (or the host) starts');
    if (r.game().phase === 'ready') await go(r);
    let g = r.game();
    assert.equal((await who(r, other).post({ action: 'guess', player_id: other })).status, 409, 'not the mime');
    assert.equal((await who(r, g.mime).post({ action: 'guess', player_id: other })).status, 403, 'not your player');
    assert.equal((await r.a.post({ action: 'next' })).status, 409, 'cannot skip a running turn');
    const w0 = g.cur.word.join();
    assert.equal((await act(r, 'guess')).status, 200);
    g = r.game();
    assert.equal(g.score[0], 1); assert.equal(g.cur.got.length, 1); assert.notEqual(g.cur.word.join(), w0);
    for (let i = 0; i < 3; i++) assert.equal((await act(r, 'skip')).status, 200);
    assert.equal((await act(r, 'skip')).status, 409, 'a 4th pass is refused');
    g = r.game();
    assert.equal(g.score[0], 1, 'passes score nothing'); assert.equal(g.cur.skipped, 3);
    assert.equal((await r.a.post({ action: 'go' })).status, 409, 'already on stage');
    const P = (await who(r, g.mime).state()).mimo;
    assert.equal(P.got, 1); assert.equal(P.passes_left, 0);
});

test('time up: the server closes the turn, the other team goes on stage, the guessed words are shown; a late guess is refused', async () => {
    const r = await room({}, 4);
    await r.a.post({ action: 'start' });
    await go(r);
    const m0 = r.game().mime;
    await act(r, 'guess'); await act(r, 'guess'); await act(r, 'skip');
    timeUp(r);
    const late = await who(r, m0).post({ action: 'guess', player_id: m0 });
    assert.equal(late.status, 409, 'too late');
    const P = (await r.a.state()).mimo;
    assert.equal(P.phase, 'ready'); assert.equal(P.turn, 1); assert.equal(P.team, 1); assert.equal(P.round, 1);
    assert.equal(P.last.team, 0); assert.equal(P.last.n, 2); assert.equal(P.last.skipped, 1); assert.equal(P.last.words.length, 2);
    assert.equal(P.left, null); assert.equal(P.word, null);
    assert.deepEqual(P.score, [2, 0]);
    assert.ok(P.events.some((e) => e.t === 'timeup' && e.team === 0 && e.n === 2));
    assert.equal(r.game().ends_at, null);
    assert.notEqual(P.mime, m0);
    assert.equal(r.game().team[P.mime], 1);
});

test('a whole match: after N rounds the team with most points wins; ties are possible; a new match resets the scores', async () => {
    const r = await room({ rounds: 2 }, 4);
    await r.a.post({ action: 'start' });
    for (let turn = 0; turn < 4; turn++) {
        await go(r);
        if (turn % 2 === 0) await act(r, 'guess');            // team 0 scores one per turn, team 1 nothing
        timeUp(r); await r.a.state();
    }
    let P = (await r.a.state()).mimo;
    assert.equal(P.status, 'ended'); assert.equal(P.result.reason, 'done'); assert.equal(P.result.winner, 0);
    assert.deepEqual(P.result.rows.map((x) => x.score), [2, 0]); assert.equal(P.result.rows[0].team, 0);
    assert.equal((await r.a.post({ action: 'start' })).status, 200, 'a new match');
    P = (await r.a.state()).mimo;
    assert.equal(P.match, 2); assert.deepEqual(P.score, [0, 0]);
    for (let turn = 0; turn < 4; turn++) { await go(r); timeUp(r); await r.a.state(); }
    P = (await r.a.state()).mimo;
    assert.equal(P.result.winner, null, 'a tie has no winner'); assert.equal(P.result.reason, 'done');
});

test('one phone for everybody: both teams on one device, the phone gets the word of whoever is on stage', async () => {
    const a = await Phone.fresh();
    await a.post({ action: 'create', game: 'mimo', players: ['X', 'Y'], settings: { rounds: 2 } });
    assert.equal((await a.post({ action: 'start' })).status, 200, 'two players are enough on one phone');
    let s = await a.state();
    assert.equal(s.mimo.me.length, 2);
    assert.deepEqual(s.mimo.me.map((m) => m.team).sort(), [0, 1]);
    assert.ok(s.mimo.me.find((m) => m.player_id === s.mimo.mime).mime);
    assert.equal(s.mimo.word, null);
    assert.equal((await a.post({ action: 'go' })).status, 200);
    s = await a.state();
    assert.ok(s.mimo.word && s.mimo.word.en, 'the shared phone shows the word to the mime');
    assert.equal((await a.post({ action: 'guess', player_id: s.mimo.mime })).status, 200);
    const other = s.mimo.me.find((m) => !m.mime).player_id;
    assert.equal((await a.post({ action: 'guess', player_id: other })).status, 409, 'the other player is not the mime');
    const b = await Phone.fresh();
    await b.post({ action: 'create', game: 'mimo', players: ['Solo'] });
    assert.equal((await b.post({ action: 'start' })).status, 409, 'one player is not enough');
});

test('leaving, skipping a turn and ending: the host skips a turn whose mime is away, starts for them, ends the match; a team with nobody left ends it', async () => {
    const r = await room({}, 4);
    await r.a.post({ action: 'start' });
    const m = r.game().mime;
    assert.equal((await who(r, m).post({ action: 'next' })).status, who(r, m) === r.a ? 200 : 403);
    if (r.game().turn === 0) assert.equal((await r.a.post({ action: 'next' })).status, 200);
    assert.equal(r.game().turn, 1);
    const m1 = r.game().mime;
    assert.equal((await r.a.post({ action: 'go' })).status, 200, 'the host starts for the mime');
    assert.equal((await r.a.post({ action: 'next' })).status, 409, 'cannot skip a running turn');
    // the mime leaves while on stage: someone else of the team takes over, the clock keeps running
    const ph = who(r, m1);
    if (ph !== r.a) {
        await ph.post({ action: 'leave' });
        const g = r.game();
        assert.equal(g.status, 'play'); assert.notEqual(g.mime, m1); assert.equal(g.team[g.mime], g.team[m1]); assert.ok(g.ends_at > Date.now() / 1000);
    }
    const e = await room({}, 4);
    await e.a.post({ action: 'start' });
    assert.equal((await e.phones[1].post({ action: 'end' })).status, 403);
    assert.equal((await e.a.post({ action: 'end' })).status, 200);
    assert.equal((await e.a.state()).mimo.result.reason, 'host_ended');

    const f = await room({ assign: 'host' }, 4);
    const ids = ['P1', 'P2', 'P3', 'P4'].map((k) => f.id[k]);
    for (const [i, p] of ids.entries()) await f.a.post({ action: 'team', player_id: p, team: i < 2 ? 0 : 1 });
    await f.a.post({ action: 'start' });
    await f.phones[2].post({ action: 'leave' });
    assert.equal((await f.a.state()).mimo.status, 'play', 'a team of one still plays');
    await f.phones[3].post({ action: 'leave' });
    assert.equal((await f.a.state()).mimo.result.reason, 'too_few');
});

test('words are not repeated until the pile of their category and level is used up; the category and level settings are respected', async () => {
    const r = await room({ cat: 'jobs', level: 'hard', secs: 90 }, 4);
    await r.a.post({ action: 'start' });
    await go(r);
    const seen = new Set();
    for (let i = 0; i < 16; i++) {
        const w = r.game().cur.word; assert.deepEqual(w.slice(0, 2), ['jobs', 'hard']); assert.ok(!seen.has(w[2]), 'no repeat'); seen.add(w[2]);
        await act(r, 'guess');
    }
    const m = await room({ rounds: 5, secs: 90 }, 4);
    await m.a.post({ action: 'start' }); await go(m);
    const cats = new Set(), lvs = new Set();
    for (let i = 0; i < 60; i++) { const w = m.game().cur.word; cats.add(w[0]); lvs.add(w[1]); await act(m, 'guess'); }
    assert.equal(cats.size, 5); assert.equal(lvs.size, 2);
});

test('translations: the five languages have the same keys, every key the game uses exists, the help and intro texts are complete', () => {
    const dict = { it: {}, en: {}, es: {}, fr: {}, de: {} };
    const win = { SpiaI18n: { strings: dict } };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'mimo', 'texts.js'), 'utf8'), { window: win });
    const keys = Object.keys(dict.en);
    assert.ok(keys.length > 90);
    for (const l of ['it', 'es', 'fr', 'de']) {
        assert.deepEqual(Object.keys(dict[l]).sort(), keys.slice().sort(), l + ' has the same keys as English');
        for (const k of keys) assert.ok(String(dict[l][k]).trim(), `${l}.${k} is empty`);
    }
    const placeholders = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
    for (const k of keys) for (const l of ['it', 'es', 'fr', 'de']) assert.equal(placeholders(dict[l][k]), placeholders(dict.en[k]), `${l}.${k} placeholders`);
    const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'mimo', 'game.js'), 'utf8');
    for (const m of js.matchAll(/'(mm_[a-z_]+)'/g)) if (!m[1].endsWith('_')) assert.ok(keys.includes(m[1]), 'game.js uses an unknown key ' + m[1]);
    for (const k of ['film', 'animals', 'actions', 'jobs', 'sports', 'mix']) assert.ok(keys.includes('mm_cat_' + k));
    for (const k of ['easy', 'hard', 'mix']) assert.ok(keys.includes('mm_level_' + k));
    for (const k of ['random', 'host']) assert.ok(keys.includes('mm_assign_' + k));
    for (const k of ['done', 'host_ended', 'too_few']) assert.ok(keys.includes('mm_reason_' + k));
    for (const k of ['start', 'turn', 'go', 'timeup', 'left', 'end']) assert.ok(keys.includes('mm_ev_' + k), k);
    for (const k of ['mm_title', 'mm_tagline', 'mm_one_phone_note', 'mm_need_players', 'mm_start', 'mm_new_match', 'mm_settings_next_match', 'intro_mm_1', 'intro_mm_2_t', 'intro_mm_3',
        'help_mm_basics_t', 'help_mm_turns', 'help_mm_teams', 'help_mm_host', 'help_mm_settings', 'err_need_players_mimo', 'err_not_mime', 'err_no_passes', 'err_bad_teams', 'err_no_questions']) assert.ok(keys.includes(k), k);
    for (const m of fs.readFileSync(path.join(ROOT, 'public', 'js', 'spia', 'app.js'), 'utf8').matchAll(/(?:title|tagline|note|need|start|again|nextMatch): '(mm_\w+)'/g)) assert.ok(keys.includes(m[1]), m[1]);
    assert.equal(dict.en.mm_title, 'Mime');
});

test('the page is served with its files, respects reduced motion, and is listed in the games and the sitemap', async () => {
    const html = await (await fetch(`${site.base}/pages/mimo.html`)).text();
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'no inline scripts');
    assert.match(html, /data-game="mimo"/);
    for (const f of ['/js/mimo/game.js', '/js/mimo/texts.js', '/css/mimo.css', '/assets/mimo/icon.svg', '/assets/mimo/manifest.json']) assert.equal((await fetch(site.base + f)).status, 200, f);
    assert.match(fs.readFileSync(path.join(ROOT, 'public', 'css', 'mimo.css'), 'utf8'), /prefers-reduced-motion: reduce[^}]*mm-fig/);
    const games = await (await fetch(`${site.base}/pages/giochi.php`)).text();
    const map = await (await fetch(`${site.base}/sitemap.php`)).text();
    assert.ok(games.includes('mimo.html') && map.includes('pages/mimo.html'));
});
