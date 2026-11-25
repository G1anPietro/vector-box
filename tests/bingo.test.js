// tests/bingo.test.js — "Lesson bingo" rooms: the starter lists, the shared list of phrases (limits, plain text, who may add), the cards the
// server deals (different for everybody, the marks private), BINGO! judged by the server (a false one is refused, the real one accepted,
// the order of the winners), single round and podium, the referee mode, one shared phone, leaving, the admin LIVE view, the five
// languages and the page files
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
const BANK = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib', 'bingo-q.json'), 'utf8')).lists;

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
async function room(settings = {}, n = 3) {
    try { site.db('DELETE FROM rate_limits'); } catch (e) { /* not created yet */ }
    const a = await Phone.fresh();
    const code = (await a.post({ action: 'create', game: 'bingo', players: ['P1'], settings })).json.code;
    const phones = [a];
    for (let i = 2; i <= n; i++) { const p = await Phone.fresh(); await p.post({ action: 'join', code }); await p.post({ action: 'player_add', name: 'P' + i }); phones.push(p); }
    const s = await a.state();
    const id = Object.fromEntries(s.players.map((p) => [p.name, p.id]));
    const where = 'room_id = (SELECT id FROM spia_rooms WHERE code = ?)';
    const game = () => JSON.parse(site.db(`SELECT state FROM bingo_games WHERE ${where}`, [code])[0].state);
    return { a, phones, code, id, game };
}
const who = (r, pid) => r.phones[Number(Object.keys(r.id).find((k) => r.id[k] === pid).slice(1)) - 1];
const mark = (r, pid, cell) => who(r, pid).post({ action: 'mark', player_id: pid, cell });
const claim = (r, pid) => who(r, pid).post({ action: 'bingo', player_id: pid });
/** A room with the "lesson" list loaded in English and the match started. */
async function started(settings = {}, n = 3) {
    const r = await room(settings, n);
    assert.equal((await r.a.post({ action: 'load_list', list: 'lesson', lang: 'en' })).status, 200);
    assert.equal((await r.a.post({ action: 'start' })).status, 200);
    return r;
}
const myCard = async (r, pid) => (await who(r, pid).state()).bingo.me.find((m) => m.player_id === pid);
/** Marks every square of the first row of the player's card (cells 0..n-1). */
async function markRow(r, pid, n = 4) { for (let c = 0; c < n; c++) assert.equal((await mark(r, pid, c)).status, 200); }

test('the starter lists: six lists of 30 phrases or more, five languages each, short plain text, a name in five languages', () => {
    assert.ok(BANK.length >= 6);
    assert.deepEqual(['lesson', 'meeting', 'dinner', 'football', 'call', 'mix'].filter((id) => !BANK.some((l) => l.id === id)), []);
    for (const l of BANK) {
        assert.equal(l.name.length, 5, l.id);
        assert.ok(l.p.length >= 30, l.id + ' has ' + l.p.length);
        for (const row of l.p) {
            assert.equal(row.length, 5, l.id);
            for (const x of row) assert.ok(typeof x === 'string' && x.trim() && x.length <= 60 && !/[<>]/.test(x), `${l.id}: ${x}`);
        }
        assert.equal(new Set(l.p.map((r) => r[1].toLowerCase())).size, l.p.length, l.id + ' has duplicates');
    }
});

test('migration V57 created bingo_games; settings are cleaned; the phrases cannot be changed through settings', async () => {
    await fetch(`${site.base}/api/rooms.php`);
    assert.ok(site.db('PRAGMA user_version')[0].user_version >= 57);
    const a = await Phone.fresh();
    await a.post({ action: 'create', game: 'bingo', players: ['A', 'B'], settings: { size: 9, mode: 'x', open: 'yes', judge: 5, phrases: [{ id: 1, t: 'hacked', by: 1 }] } });
    let s = await a.state();
    assert.equal(s.game, 'bingo'); assert.equal(s.bingo, null);
    assert.equal(s.settings.size, 4); assert.equal(s.settings.mode, 'single'); assert.equal(s.settings.open, true); assert.equal(s.settings.judge, false);
    assert.deepEqual(s.settings.phrases, [], 'phrases cannot be sent at creation');
    assert.equal((await a.post({ action: 'start' })).status, 409, 'no phrases: cannot start');
    assert.equal((await a.post({ action: 'settings', settings: { size: 5, mode: 'podium', open: false, judge: true, phrases: [{ id: 9, t: 'x', by: 1 }] } })).status, 200);
    s = await a.state();
    assert.deepEqual([s.settings.size, s.settings.mode, s.settings.open, s.settings.judge], [5, 'podium', false, true]);
    assert.deepEqual(s.settings.phrases, []);
    const p = await Phone.fresh();
    await p.post({ action: 'join', code: s.code });
    assert.equal((await p.post({ action: 'settings', settings: { size: 4 } })).status, 403, 'host only');
});

test('phrases: 60 characters, plain text, no duplicates, at most 60; who may add and remove; a starter list; none during a match', async () => {
    const r = await room({}, 3);
    const [a, b] = r.phones;
    assert.equal((await a.post({ action: 'phrase_add', text: '   ' })).status, 409);
    assert.equal((await b.post({ action: 'phrase_add', text: 'x'.repeat(100) })).status, 200, 'everybody may add by default');
    assert.equal((await b.post({ action: 'phrase_add', text: '<b>Hello</b> <script>alert(1)</script>world' })).status, 200);
    let s = await a.state();
    assert.equal(s.settings.phrases[0].t.length, 60, 'cut to 60');
    assert.ok(!/[<>]/.test(JSON.stringify(s.settings.phrases)), 'no HTML');
    assert.equal(s.settings.phrases[1].t, 'Hello alert(1) world');
    assert.equal((await a.post({ action: 'phrase_add', text: 'HELLO ALERT(1) world' })).status, 409, 'duplicate, case does not matter');
    assert.ok(s.settings.phrases[0].mine === false && (await b.state()).settings.phrases[0].mine === true, 'mine is per phone');
    assert.ok(!JSON.stringify(s).includes('"by"'), 'the device ids are not sent');
    // removing: the author or the host
    const idB = s.settings.phrases[0].id, idB2 = s.settings.phrases[1].id;
    assert.equal((await r.phones[2].post({ action: 'phrase_del', id: idB })).status, 200);
    assert.equal((await a.state()).settings.phrases.length, 2, 'a stranger cannot remove it');
    assert.equal((await b.post({ action: 'phrase_del', id: idB })).status, 200);
    assert.equal((await a.post({ action: 'phrase_del', id: idB2 })).status, 200, 'the host removes any');
    assert.equal((await a.state()).settings.phrases.length, 0);
    // closed: only the host
    await a.post({ action: 'settings', settings: { open: false } });
    assert.equal((await b.post({ action: 'phrase_add', text: 'mine' })).status, 403);
    assert.equal((await a.post({ action: 'phrase_add', text: 'host phrase' })).status, 200);
    assert.equal((await b.post({ action: 'load_list', list: 'mix', lang: 'en' })).status, 403, 'only the host loads a list');
    assert.equal((await a.post({ action: 'load_list', list: 'nope', lang: 'en' })).status, 409);
    // a list, in a language, no duplicates, the limit of 60
    assert.equal((await a.post({ action: 'load_list', list: 'lesson', lang: 'it' })).status, 200);
    assert.equal((await a.post({ action: 'load_list', list: 'lesson', lang: 'it' })).status, 200);
    s = await a.state();
    assert.equal(s.settings.phrases.length, 31); assert.ok(s.settings.phrases.some((p) => p.t === 'Allora…'));
    for (const id of ['meeting', 'dinner']) await a.post({ action: 'load_list', list: id, lang: 'en' });
    s = await a.state();
    assert.equal(s.settings.phrases.length, 60); assert.equal(s.settings.max, 60);
    assert.equal((await a.post({ action: 'phrase_add', text: 'one more' })).status, 409, 'full');
    assert.equal((await a.post({ action: 'phrases_clear' })).status, 200);
    assert.equal((await a.state()).settings.phrases.length, 0);
    // not during a match
    await a.post({ action: 'load_list', list: 'mix', lang: 'es' });
    await a.post({ action: 'start' });
    assert.equal((await a.post({ action: 'phrase_add', text: 'late' })).status, 409);
    assert.equal((await a.post({ action: 'phrases_clear' })).status, 409);
});

test('you need size x size phrases and two players to start; 5x5 needs 25', async () => {
    const r = await room({ size: 5 }, 2);
    for (let i = 0; i < 20; i++) await r.a.post({ action: 'phrase_add', text: 'phrase ' + i });
    assert.equal((await r.a.post({ action: 'start' })).status, 409, '20 phrases are not enough for 5x5');
    for (let i = 20; i < 25; i++) await r.a.post({ action: 'phrase_add', text: 'phrase ' + i });
    assert.equal((await r.a.post({ action: 'start' })).status, 200);
    assert.equal((await r.a.state()).bingo.me[0].cells.length, 25);
    const one = await Phone.fresh();
    await one.post({ action: 'create', game: 'bingo', players: ['Solo'] });
    await one.post({ action: 'load_list', list: 'mix', lang: 'en' });
    assert.equal((await one.post({ action: 'start' })).status, 409, 'two players are needed');
    assert.equal((await one.post({ action: 'player_add', name: 'Duo' })).status, 200);
    assert.equal((await one.post({ action: 'start' })).status, 200);
});

test('every player gets a different card from the list; the marks are private (the others only see how many)', async () => {
    const r = await started({}, 4);
    const ids = Object.values(r.id);
    const cards = [];
    for (const pid of ids) {
        const c = await myCard(r, pid);
        assert.equal(c.cells.length, 16);
        assert.equal(new Set(c.cells.map((x) => x.t)).size, 16, 'no phrase twice on one card');
        cards.push(c.cells.map((x) => x.t).join('|'));
    }
    assert.equal(new Set(cards).size, ids.length, 'the cards are all different');
    const [p1, p2] = ids;
    assert.equal((await mark(r, p1, 3)).status, 200);
    assert.equal((await mark(r, p1, 5)).status, 200);
    const mine = await myCard(r, p1);
    assert.deepEqual(mine.cells.map((x, i) => x.m ? i : -1).filter((i) => i >= 0), [3, 5]);
    const other = (await who(r, p2).state());
    assert.equal(other.bingo.counts[p1], 2, 'the others see the number');
    assert.equal(other.bingo.me.length, 1, 'and only their own card');
    assert.ok(!('marks' in other.bingo) && !JSON.stringify(other.bingo).includes('"cards"'), 'no marks and no cards of the others');
    assert.equal(other.bingo.me[0].cells.filter((x) => x.m).length, 0);
    assert.equal((await mark(r, p1, 3)).status, 200, 'tapping again unmarks');
    assert.equal((await r.a.state()).bingo.counts[p1], 1);
    assert.equal((await mark(r, p1, 16)).status, 409, 'cell out of range');
    assert.equal((await who(r, p2).post({ action: 'mark', player_id: p1, cell: 0 })).status, 403, 'not your player');
});

test('BINGO! is judged by the server: false claims are refused, a complete row/column/diagonal is accepted, the first one is first place', async () => {
    const r = await started({}, 3);
    const [p1, p2, p3] = Object.values(r.id);
    assert.equal((await claim(r, p1)).status, 409, 'nothing marked');
    await mark(r, p1, 0); await mark(r, p1, 1); await mark(r, p1, 2);
    assert.equal((await claim(r, p1)).status, 409, 'three of four is not a line');
    await mark(r, p1, 5);
    assert.equal((await claim(r, p1)).status, 409, 'four squares that are not a line');
    await mark(r, p1, 5); // off again
    // p2 completes a column (cells 1,5,9,13) and p3 the main diagonal: p2 first
    for (const c of [1, 5, 9, 13]) await mark(r, p2, c);
    for (const c of [0, 5, 10, 15]) await mark(r, p3, c);
    assert.equal((await claim(r, p2)).status, 200);
    let g = (await r.a.state()).bingo;
    assert.equal(g.status, 'ended', 'single mode ends at the first bingo');
    assert.equal(g.winners.length, 1); assert.equal(g.winners[0].p, p2); assert.equal(g.winners[0].place, 1);
    const card = r.game().cards[String(p2)];
    assert.deepEqual(g.winners[0].row, [1, 5, 9, 13].map((c) => g.pool[card[c]]), 'the winning row is shown');
    assert.equal(g.winners[0].row.length, 4);
    assert.equal((await claim(r, p3)).status, 409, 'the match is over');
    assert.deepEqual(g.result.winners, [p2]); assert.equal(g.result.reason, 'done');
    assert.ok(g.events.some((e) => e.t === 'bingo' && e.p === p2 && e.place === 1));
    assert.equal((await r.a.post({ action: 'start' })).status, 200, 'a new match with the same phrases');
    assert.equal((await r.a.state()).bingo.match, 2);
    assert.equal((await r.a.state()).bingo.winners.length, 0);
});

test('a client that lies cannot win: the server counts only the marks it holds; diagonals work; podium mode: three places in order', async () => {
    const r = await started({ mode: 'podium' }, 4);
    const [p1, p2, p3, p4] = Object.values(r.id);
    assert.equal((await claim(r, p1)).status, 409);
    await markRow(r, p2);                      // row 0
    for (const c of [3, 6, 9, 12]) await mark(r, p3, c);   // anti-diagonal
    for (const c of [8, 9, 10, 11]) await mark(r, p1, c);  // row 2
    assert.equal((await claim(r, p3)).status, 200);
    assert.equal((await claim(r, p3)).status, 409, 'cannot win twice');
    assert.equal((await mark(r, p3, 0)).status, 409, 'a winner stops marking');
    let g = (await r.a.state()).bingo;
    assert.equal(g.status, 'play', 'the podium goes on');
    assert.equal((await claim(r, p1)).status, 200);
    assert.equal((await claim(r, p2)).status, 200);
    g = (await r.a.state()).bingo;
    assert.deepEqual(g.winners.map((w) => [w.p, w.place]), [[p3, 1], [p1, 2], [p2, 3]], 'the order of the claims');
    assert.equal(g.status, 'ended');
    assert.deepEqual(g.result.winners, [p3, p1, p2]);
    assert.ok(g.result.rows.some((x) => x.p === p4 && x.marked === 0));
    assert.equal((await claim(r, p4)).status, 409);
    // with two players the podium has two places
    const t = await started({ mode: 'podium' }, 2);
    const [q1, q2] = Object.values(t.id);
    await markRow(t, q1); await markRow(t, q2);
    await claim(t, q1);
    assert.equal((await t.a.state()).bingo.status, 'play');
    await claim(t, q2);
    assert.equal((await t.a.state()).bingo.status, 'ended');
});

test('the referee mode: a square can be marked only after the host said "it was said"; the claim needs the whole line confirmed', async () => {
    const r = await started({ judge: true }, 3);
    const [p1, p2] = Object.values(r.id);
    const c = await myCard(r, p1);
    assert.equal((await mark(r, p1, 0)).status, 409, 'not confirmed yet');
    assert.equal((await who(r, p2).post({ action: 'say', phrase: 0 })).status, 403, 'only the host confirms');
    assert.equal((await r.a.post({ action: 'say', phrase: 999 })).status, 409);
    const pool = (await r.a.state()).bingo.pool;
    for (let k = 0; k < 4; k++) assert.equal((await r.a.post({ action: 'say', phrase: pool.indexOf(c.cells[k].t) })).status, 200);
    const s = await who(r, p1).state();
    assert.ok(s.bingo.me[0].cells.slice(0, 4).every((x) => x.said), 'the card shows which are confirmed');
    assert.equal(s.bingo.said.length, 4); assert.ok(s.bingo.events.some((e) => e.t === 'said'));
    await markRow(r, p1);
    // the host takes one back: the claim is no longer valid
    assert.equal((await r.a.post({ action: 'say', phrase: pool.indexOf(c.cells[2].t) })).status, 200);
    assert.equal((await claim(r, p1)).status, 409, 'the line is not fully confirmed any more');
    await r.a.post({ action: 'say', phrase: pool.indexOf(c.cells[2].t) });
    assert.equal((await claim(r, p1)).status, 200);
    assert.equal((await r.a.state()).bingo.winners[0].p, p1);
    // without the referee the host can still confirm (it is only a help) and nothing is required
    const free = await started({}, 2);
    assert.equal((await free.a.post({ action: 'say', phrase: 0 })).status, 200);
    assert.equal((await mark(free, Object.values(free.id)[1], 7)).status, 200);
});

test('one phone for everybody: every player has their own card on the same device', async () => {
    const a = await Phone.fresh();
    await a.post({ action: 'create', game: 'bingo', players: ['X', 'Y', 'Z'] });
    await a.post({ action: 'load_list', list: 'meeting', lang: 'fr' });
    assert.equal((await a.post({ action: 'start' })).status, 200);
    let s = await a.state();
    assert.equal(s.bingo.me.length, 3);
    assert.equal(new Set(s.bingo.me.map((m) => m.cells.map((c) => c.t).join('|'))).size, 3);
    const [x, y] = s.bingo.me.map((m) => m.player_id);
    await a.post({ action: 'mark', player_id: x, cell: 0 });
    s = await a.state();
    assert.equal(s.bingo.me[0].cells[0].m, true); assert.equal(s.bingo.me[1].cells[0].m, false);
    for (let c = 0; c < 4; c++) await a.post({ action: 'mark', player_id: y, cell: c });
    assert.equal((await a.post({ action: 'bingo', player_id: x })).status, 409);
    assert.equal((await a.post({ action: 'bingo', player_id: y })).status, 200);
    assert.equal((await a.state()).bingo.winners[0].p, y);
});

test('leaving: fewer than two players ends the match; the host can end it; nobody left to win ends a podium', async () => {
    const r = await started({}, 2);
    assert.equal((await r.phones[1].post({ action: 'end' })).status, 403);
    await r.phones[1].post({ action: 'leave' });
    assert.equal((await r.a.state()).bingo.result.reason, 'too_few');
    const e = await started({}, 3);
    assert.equal((await e.a.post({ action: 'end' })).status, 200);
    let g = (await e.a.state()).bingo;
    assert.equal(g.result.reason, 'host_ended'); assert.deepEqual(g.winners, []);
    assert.equal((await e.a.post({ action: 'end' })).status, 409);
    const p = await started({ mode: 'podium' }, 3);
    const [p1, p2, p3] = Object.values(p.id);
    await markRow(p, p1);
    await claim(p, p1);
    await who(p, p3).post({ action: 'leave' });
    g = (await p.a.state()).bingo;
    assert.equal(g.status, 'play', 'p2 can still win');
    await markRow(p, p2);
    await claim(p, p2);
    assert.equal((await p.a.state()).bingo.status, 'ended');
});

test('the admin LIVE view shows every card and its marks, the confirmed phrases and the winners; a normal visitor cannot see it', async () => {
    const r = await started({ judge: true }, 3);
    const [p1, p2] = Object.values(r.id);
    const pool = (await r.a.state()).bingo.pool;
    const c = await myCard(r, p1);
    await r.a.post({ action: 'say', phrase: pool.indexOf(c.cells[0].t) });
    await mark(r, p1, 0);
    const admin = await makeAdmin(site, 'bingo_admin');
    const live = (await admin.get('/api/spia.php?action=live')).json.rooms.find((x) => x.code === r.code);
    assert.equal(live.game, 'bingo');
    assert.equal(live.bingo.size, 4); assert.equal(live.bingo.judge, true);
    assert.equal(Object.keys(live.bingo.cards).length, 3);
    assert.deepEqual(live.bingo.cards[String(p1)].marks, [0]);
    assert.equal(live.bingo.cards[String(p1)].cells[0], c.cells[0].t);
    assert.equal(live.bingo.cards[String(p2)].cells.length, 16);
    assert.deepEqual(live.bingo.said, [c.cells[0].t]);
    assert.equal((await new Client(site).get('/api/spia.php?action=live')).status !== 200, true);
    assert.match((await admin.get('/api/spia.php?action=ext')).text, /bingo/i, 'the admin script knows the game');
});

test('translations: the five languages have the same keys, every key the game uses exists, the help and intro texts are complete', () => {
    const dict = { it: {}, en: {}, es: {}, fr: {}, de: {} };
    const win = { SpiaI18n: { strings: dict } };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'bingo', 'texts.js'), 'utf8'), { window: win });
    const keys = Object.keys(dict.en);
    assert.ok(keys.length > 100);
    for (const l of ['it', 'es', 'fr', 'de']) {
        assert.deepEqual(Object.keys(dict[l]).sort(), keys.slice().sort(), l + ' has the same keys as English');
        for (const k of keys) assert.ok(String(dict[l][k]).trim(), `${l}.${k} is empty`);
    }
    const placeholders = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
    for (const k of keys) for (const l of ['it', 'es', 'fr', 'de']) assert.equal(placeholders(dict[l][k]), placeholders(dict.en[k]), `${l}.${k} placeholders`);
    const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'bingo', 'game.js'), 'utf8');
    for (const m of js.matchAll(/'(bg_[a-z_]+)'/g)) if (!m[1].endsWith('_')) assert.ok(keys.includes(m[1]), 'game.js uses an unknown key ' + m[1]);
    for (const id of ['lesson', 'meeting', 'dinner', 'football', 'call', 'mix']) assert.ok(keys.includes('bg_list_' + id), id);
    for (const l of BANK) assert.ok(keys.includes('bg_list_' + l.id), l.id);
    for (const k of ['single', 'podium']) assert.ok(keys.includes('bg_mode_' + k), k);
    for (const k of ['done', 'nobody', 'host_ended', 'too_few']) assert.ok(keys.includes('bg_reason_' + k), k);
    for (const k of ['start', 'bingo', 'said', 'left', 'end']) assert.ok(keys.includes('bg_ev_' + k), k);
    for (const k of ['need_players_bingo', 'need_phrases', 'bad_phrase', 'phrase_dup', 'phrases_full', 'not_said', 'no_bingo', 'already_won', 'no_list', 'bad_cell']) assert.ok(keys.includes('err_' + k), k);
    for (const k of ['bg_title', 'bg_tagline', 'bg_one_phone_note', 'bg_need_two', 'bg_start', 'bg_new_match', 'bg_settings_next_match', 'intro_bg_1', 'intro_bg_2_t', 'intro_bg_3',
        'help_bg_basics_t', 'help_bg_phrases', 'help_bg_bingo', 'help_bg_host', 'help_bg_settings']) assert.ok(keys.includes(k), k);
    for (const m of fs.readFileSync(path.join(ROOT, 'public', 'js', 'spia', 'app.js'), 'utf8').matchAll(/(?:title|tagline|note|need): '(bg_\w+)'/g)) assert.ok(keys.includes(m[1]), m[1]);
});

test('the page is served with its files, is listed in the games and the sitemap, and the style respects accessibility settings; the game makes no sound', async () => {
    const html = await (await fetch(`${site.base}/pages/bingo.html`)).text();
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'no inline scripts');
    assert.match(html, /data-game="bingo"/);
    for (const f of ['/js/bingo/game.js', '/js/bingo/texts.js', '/css/bingo.css', '/assets/bingo/icon.svg', '/assets/bingo/manifest.json']) assert.equal((await fetch(site.base + f)).status, 200, f);
    const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'bingo.css'), 'utf8');
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.match(css, /:focus-visible/);
    const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'bingo', 'game.js'), 'utf8');
    assert.ok(!/AudioContext|new Audio|\.play\(\)|innerHTML/.test(js), 'no sound and no innerHTML');
    assert.match(js, /'aria-pressed'/);
    const games = await (await fetch(`${site.base}/pages/giochi.php`)).text();
    const map = await (await fetch(`${site.base}/sitemap.php`)).text();
    assert.ok(games.includes('bingo.html') && map.includes('pages/bingo.html'));
});
