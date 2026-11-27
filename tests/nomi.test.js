// tests/nomi.test.js — "Names, things, cities" rooms: settings, the letter, sheets that stay secret until the review, the points
// (only yours 10, the same 5, the only valid word 20, wrong letter / empty 0, articles and accents), the 10-second cut, host tools,
// leaving players, the admin LIVE view, the five languages and the page files
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
    const code = (await a.post({ action: 'create', game: 'nomi', players: ['P1'], settings })).json.code;
    const phones = [a];
    for (let i = 2; i <= n; i++) { const p = await Phone.fresh(); await p.post({ action: 'join', code }); await p.post({ action: 'player_add', name: 'P' + i }); phones.push(p); }
    const s = await a.state();
    const id = Object.fromEntries(s.players.map((p) => [p.name, p.id]));
    const where = 'room_id = (SELECT id FROM spia_rooms WHERE code = ?)';
    const game = () => JSON.parse(site.db(`SELECT state FROM nomi_games WHERE ${where}`, [code])[0].state);
    const setGame = (g) => site.db(`UPDATE nomi_games SET state = ? WHERE ${where}`, [JSON.stringify(g), code]);
    return { a, phones, code, id, game, setGame, n };
}
const submit = (r, who, answers) => r.phones[who - 1].post({ action: 'submit', player_id: r.id['P' + who], answers });
const forceLetter = (r, letter) => { const g = r.game(); g.q.letter = letter; g.letters[g.round - 1] = letter; r.setGame(g); };
const expire = (r) => { const g = r.game(); g.q.deadline = Date.now() / 1000 - 1; r.setGame(g); };
const cell = (review, cat, p) => review.cats.find((c) => c.cat === cat).answers.find((a) => a.p === p);

test('settings are cleaned (categories in order, at least two, no strangers); two players are enough', async () => {
    const r = await room({ cats: ['food', 'bogus', 'name', 'name'], time: 77, rounds: 5, family: 'no' }, 2);
    const s = (await r.a.state()).settings;
    assert.deepEqual(s.cats, ['name', 'food'], 'canonical order, no strangers, no repeats');
    assert.deepEqual([s.time, s.rounds, s.family], [90, 5, true], 'bad values keep the defaults');
    await r.a.post({ action: 'settings', settings: { cats: ['city'] } });
    assert.deepEqual((await r.a.state()).settings.cats, ['name', 'food'], 'a single category is refused');
    await r.a.post({ action: 'settings', settings: { cats: ['animal', 'job', 'color'], time: 60, rounds: 3 } });
    assert.deepEqual((await r.a.state()).settings, { cats: ['animal', 'job', 'color'], time: 60, rounds: 3, family: true });
    const solo = await Phone.fresh();
    await solo.post({ action: 'create', game: 'nomi', players: ['Lonely'] });
    const st = await solo.post({ action: 'start' });
    assert.equal(st.status, 409); assert.equal(st.json.error, 'need_players_nomi');
    assert.equal((await r.phones[1].post({ action: 'settings', settings: { time: 120 } })).status, 403, 'only the host');
});

test('sheets stay secret until the review; the first complete sheet gives the others 10 seconds; the letter comes from the server', async () => {
    const r = await room({ cats: ['name', 'city', 'animal'] }, 3);
    assert.equal((await r.a.post({ action: 'start' })).json.success, true);
    forceLetter(r, 'M');
    const s0 = await r.a.state();
    assert.equal(s0.nomi.letter, 'M'); assert.equal(s0.nomi.phase, 'write'); assert.equal(s0.nomi.review, null);
    assert.equal((await submit(r, 1, ['Marco', 'Milano'])).json.error, 'bad_text', 'one box per category');
    assert.equal((await submit(r, 1, ['<b>x</b>', 'Milano', 'Mucca'])).json.error, 'bad_text', 'no markup');
    assert.equal((await submit(r, 1, ['x'.repeat(31), 'Milano', 'Mucca'])).json.error, 'bad_text', '30 characters at most');
    assert.equal((await submit(r, 1, ['Marco', 'fuck', 'Mucca'])).json.error, 'bad_word', 'family filter');
    assert.equal((await r.a.post({ action: 'submit', player_id: r.id.P2, answers: ['a', 'b', 'c'] })).status, 403, 'not your player');
    const before = r.game().q.deadline;
    assert.equal((await submit(r, 1, ['Marco', 'Milano', 'Mucca'])).json.success, true);
    const g = r.game();
    assert.ok(g.q.cut && g.q.deadline <= Date.now() / 1000 + 11 && g.q.deadline < before, 'the others have about 10 seconds');
    assert.equal((await submit(r, 1, ['Marco', 'Milano', 'Mucca'])).json.error, 'already_wrote');
    assert.ok(g.events.some((e) => e.t === 'cut'));
    for (const ph of r.phones) {
        const raw = JSON.stringify(await ph.state());
        assert.ok(!raw.includes('Marco') && !raw.includes('Milano'), 'nobody sees a sheet while the round is open');
    }
    assert.deepEqual((await r.phones[1].state()).nomi.sent, [r.id.P1], 'who handed in is public, not what');
});

test('points: only yours 10, the same word 5, the only valid word 20, wrong letter and empty 0; accents, case and articles do not matter', async () => {
    const r = await room({ cats: ['name', 'city', 'animal', 'job'], rounds: 5 }, 3);
    await r.a.post({ action: 'start' });
    forceLetter(r, 'M');
    await submit(r, 1, ['Marco', 'Milano', 'Mucca', 'Medico']);
    await submit(r, 2, ['Marta', 'MILANO', 'Maiale', '']);
    await submit(r, 3, ['Giulia', '', 'Mucca', 'Muratore']);
    const P = (await r.a.state()).nomi;
    assert.equal(P.phase, 'review', 'everybody handed in');
    const rv = P.review, [p1, p2, p3] = [r.id.P1, r.id.P2, r.id.P3];
    assert.deepEqual([cell(rv, 'name', p1).pts, cell(rv, 'name', p2).pts, cell(rv, 'name', p3).pts], [10, 10, 0]);
    assert.equal(cell(rv, 'name', p3).kind, 'wrong', 'Giulia does not start with M');
    assert.deepEqual([cell(rv, 'city', p1).pts, cell(rv, 'city', p2).pts, cell(rv, 'city', p3).pts], [5, 5, 0], 'Milano = MILANO');
    assert.equal(cell(rv, 'city', p3).kind, 'none');
    assert.deepEqual([cell(rv, 'animal', p1).pts, cell(rv, 'animal', p2).pts, cell(rv, 'animal', p3).pts], [5, 10, 5]);
    assert.deepEqual([cell(rv, 'job', p1).pts, cell(rv, 'job', p2).pts, cell(rv, 'job', p3).pts], [10, 0, 10]);
    assert.equal(rv.round[p1], 30); assert.equal(rv.round[p2], 25); assert.equal(rv.round[p3], 15);
    assert.deepEqual((await r.a.state()).nomi.scores, { [p1]: 0, [p2]: 0, [p3]: 0 }, 'the standings move when the round is over');
    // articles and accents; and a lone valid word is worth 20
    assert.equal((await r.a.post({ action: 'next' })).json.success, true);
    forceLetter(r, 'G');
    await submit(r, 1, ['Gigi', 'Genova', 'Il gatto', 'Giudice']);
    await submit(r, 2, ['', 'Genòva', 'gatto', '']);
    await submit(r, 3, ['', '', 'Gufo', '']);
    const rv2 = (await r.a.state()).nomi.review;
    assert.deepEqual([cell(rv2, 'name', p1).pts, cell(rv2, 'name', p1).kind], [20, 'solo'], 'the only valid word of the table');
    assert.deepEqual([cell(rv2, 'city', p1).pts, cell(rv2, 'city', p2).pts], [5, 5], 'accents do not matter');
    assert.deepEqual([cell(rv2, 'animal', p1).pts, cell(rv2, 'animal', p2).pts, cell(rv2, 'animal', p3).pts], [5, 5, 10], 'the article does not matter');
    const sc = (await r.a.state()).nomi.scores;
    assert.deepEqual([sc[p1], sc[p2], sc[p3]], [30, 25, 15], 'round one is in the standings now');
});

test('the host cancels and gives back a doubtful word in the review; nobody else can; the clock moves the match on and the match ends', async () => {
    const r = await room({ cats: ['name', 'city'], rounds: 3 }, 3);
    await r.a.post({ action: 'start' });
    forceLetter(r, 'B');
    await submit(r, 1, ['Bruno', 'Bari']); await submit(r, 2, ['Bruno', 'Berlino']);
    assert.equal((await r.a.post({ action: 'reject', player_id: r.id.P1, cat: 0 })).json.error, 'not_now', 'only in the review');
    // P3 never handed in: when the time is up they simply have nothing
    assert.equal((await r.a.state()).nomi.phase, 'write', 'P3 is still missing');
    expire(r);
    assert.equal((await r.a.state()).nomi.phase, 'review');
    assert.equal(cell((await r.a.state()).nomi.review, 'city', r.id.P3).kind, 'none');
    assert.equal((await r.a.post({ action: 'reject', player_id: r.id.P1, cat: 0 })).json.success, true);
    let rv = (await r.a.state()).nomi.review;
    assert.deepEqual([cell(rv, 'name', r.id.P1).kind, cell(rv, 'name', r.id.P1).pts], ['cancelled', 0]);
    assert.equal(cell(rv, 'name', r.id.P2).kind, 'solo', 'now it is the only valid one');
    assert.equal((await r.phones[1].post({ action: 'reject', player_id: r.id.P2, cat: 0 })).status, 403, 'only the host');
    assert.equal((await r.a.post({ action: 'reject', player_id: r.id.P1, cat: 0 })).json.success, true, 'given back');
    rv = (await r.a.state()).nomi.review;
    assert.equal(cell(rv, 'name', r.id.P1).pts, 5);
    assert.equal((await r.phones[1].post({ action: 'next' })).status, 403, 'only the host skips the wait');
    await r.a.post({ action: 'next' });
    assert.equal((await r.a.state()).nomi.round, 2);
    // second and third round: the letters are all different, then the standings
    const letters = r.game().letters; assert.equal(new Set(letters).size, 3);
    for (let k = 2; k <= 3; k++) { expire(r); await r.a.state(); await r.a.post({ action: 'next' }); }
    const end = (await r.a.state()).nomi;
    assert.equal(end.status, 'ended'); assert.equal(end.result.reason, 'finished'); assert.equal(end.result.rows.length, 3);
    assert.ok(end.result.rows[0].pts >= end.result.rows[1].pts, 'sorted by points');
    // a new match starts again from zero
    assert.equal((await r.a.post({ action: 'start' })).json.success, true);
    assert.equal((await r.a.state()).nomi.match, 2);
});

test('a player who leaves or is excluded is out; with one player left the match ends; the admin LIVE view shows the sheets', async () => {
    const r = await room({ cats: ['name', 'city'] }, 3);
    await r.a.post({ action: 'start' });
    forceLetter(r, 'T');
    await submit(r, 1, ['Tom', 'Torino']);
    const admin = await makeAdmin(site, 'nomi_admin');
    const live = (await admin.get('/api/spia.php?action=live')).json.rooms.find((x) => x.code === r.code);
    assert.equal(live.game, 'nomi'); assert.equal(live.nomi.letter, 'T');
    assert.deepEqual(live.nomi.answers[r.id.P1], ['Tom', 'Torino']);
    assert.match((await admin.get('/api/spia.php?action=ext')).text, /nomi/i, 'the admin script knows the game');
    assert.equal((await r.a.post({ action: 'exclude', player_id: r.id.P3 })).json.success, true);
    assert.deepEqual((await r.a.state()).nomi.active.sort(), [r.id.P1, r.id.P2].sort());
    assert.equal((await submit(r, 3, ['a', 'b'])).json.error, 'you_are_out');
    await r.phones[1].post({ action: 'leave' });
    const e = (await r.a.state()).nomi;
    assert.equal(e.status, 'ended'); assert.equal(e.result.reason, 'too_few');
});

test('translations: the five languages have the same keys and placeholders, every key the game uses exists, help and intro are complete', () => {
    const dict = { it: {}, en: {}, es: {}, fr: {}, de: {} };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'nomi', 'texts.js'), 'utf8'), { window: { SpiaI18n: { strings: dict } } });
    const keys = Object.keys(dict.en);
    assert.ok(keys.length > 90);
    for (const l of ['it', 'es', 'fr', 'de']) {
        assert.deepEqual(Object.keys(dict[l]).sort(), keys.slice().sort(), l + ' has the same keys as English');
        for (const k of keys) assert.ok(String(dict[l][k]).trim(), `${l}.${k} is empty`);
    }
    const placeholders = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
    for (const k of keys) for (const l of ['it', 'es', 'fr', 'de']) assert.equal(placeholders(dict[l][k]), placeholders(dict.en[k]), `${l}.${k} placeholders`);
    const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'nomi', 'game.js'), 'utf8');
    for (const m of js.matchAll(/\bt\(\s*'(nm_[a-z_]+)'/g)) if (!m[1].endsWith('_')) assert.ok(keys.includes(m[1]), 'game.js uses an unknown key ' + m[1]);
    for (const m of js.matchAll(/'(nm_[a-z_]+)'/g)) assert.ok(keys.includes(m[1]) || m[1].endsWith('_'), 'game.js mentions an unknown key ' + m[1]);
    for (const c of ['name', 'thing', 'city', 'animal', 'job', 'film', 'color', 'food']) assert.ok(keys.includes('nm_cat_' + c), 'category ' + c);
    for (const k of ['solo', 'unique', 'shared', 'wrong', 'cancelled', 'none']) assert.ok(keys.includes('nm_k_' + k), 'kind ' + k);
    for (const e of ['finished', 'host_ended', 'too_few']) assert.ok(keys.includes('nm_reason_' + e), e);
    for (const k of ['intro_nm_1', 'intro_nm_2_t', 'intro_nm_3', 'help_nm_basics_t', 'help_nm_write', 'help_nm_score', 'help_nm_host', 'help_nm_settings', 'err_need_players_nomi', 'err_bad_word', 'err_bad_text', 'err_already_wrote']) assert.ok(keys.includes(k), k);
    for (const m of fs.readFileSync(path.join(ROOT, 'public', 'js', 'spia', 'app.js'), 'utf8').matchAll(/(?:title|tagline|note|need): '(nm_\w+)'/g)) assert.ok(keys.includes(m[1]), m[1]);
    for (const l of Object.keys(dict)) for (const k of keys) assert.ok(!/[<>]/.test(dict[l][k]), `${l}.${k} has markup`);
});

test('the page is served in English with its files, listed in the games and the sitemap', async () => {
    const html = await (await fetch(`${site.base}/pages/nomi.html`)).text();
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'no inline scripts');
    assert.match(html, /<html lang="en" data-game="nomi">/);
    for (const f of ['/js/nomi/game.js', '/js/nomi/texts.js', '/css/nomi.css', '/assets/nomi/icon.svg', '/assets/nomi/manifest.json']) assert.equal((await fetch(site.base + f)).status, 200, f);
    const games = await (await fetch(`${site.base}/pages/giochi.php`)).text();
    const map = await (await fetch(`${site.base}/sitemap.php`)).text();
    assert.ok(games.includes('nomi.html') && map.includes('pages/nomi.html'));
    assert.match(fs.readFileSync(path.join(ROOT, 'public', 'css', 'nomi.css'), 'utf8'), /prefers-reduced-motion/);
});
