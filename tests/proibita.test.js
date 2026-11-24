// tests/proibita.test.js — "Forbidden word" rooms: the bank of cards, the teams, the card that never reaches the guessing team,
// BUZZ only from the opposing guardian, got it / skip, the server clock (time up simulated by writing the end in the past), the
// score and the winner, one shared phone, leaving, host tools, the admin LIVE view, the five languages and the page files
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
const BANK = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib', 'proibita-q.json'), 'utf8'));
const LANGS = ['it', 'en', 'es', 'fr', 'de'];
const cardOf = (ref) => BANK[ref[0] === 'e' ? 'easy' : 'hard'][Number(ref.slice(1))];

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
    const code = (await a.post({ action: 'create', game: 'proibita', players: ['P1'], settings })).json.code;
    const phones = [a];
    for (let i = 2; i <= n; i++) { const p = await Phone.fresh(); await p.post({ action: 'join', code }); await p.post({ action: 'player_add', name: 'P' + i }); phones.push(p); }
    const s = await a.state();
    const id = Object.fromEntries(s.players.map((p) => [p.name, p.id]));
    const where = 'room_id = (SELECT id FROM spia_rooms WHERE code = ?)';
    const game = () => JSON.parse(site.db(`SELECT state FROM proibita_games WHERE ${where}`, [code])[0].state);
    const setGame = (g) => site.db(`UPDATE proibita_games SET state = ? WHERE ${where}`, [JSON.stringify(g), code]);
    return { a, phones, code, id, game, setGame };
}
const who = (r, pid) => r.phones[Number(Object.keys(r.id).find((k) => r.id[k] === pid).slice(1)) - 1];
const begin = (r) => { const g = r.game(); return who(r, g.giver).post({ action: 'begin', player_id: g.giver }); };
const right = (r, n) => { const g = r.game(); return who(r, g.giver).post({ action: 'right', player_id: g.giver, n: n ?? g.card_n }); };
const skip = (r, n) => { const g = r.game(); return who(r, g.giver).post({ action: 'skip', player_id: g.giver, n: n ?? g.card_n }); };
const buzz = (r, n) => { const g = r.game(); return who(r, g.guardian).post({ action: 'buzz', player_id: g.guardian, n: n ?? g.card_n }); };
/** The time of the turn runs out (the end is written in the past): the next request closes the turn. */
const expire = (r) => { const g = r.game(); g.ends_at = Date.now() / 1000 - 1; r.setGame(g); };
const skipWait = async (r) => { const g = r.game(); g.next_at = Date.now() / 1000 - 1; r.setGame(g); return (await r.a.state()).proibita; };
/** One whole turn: begin, some got-its and BUZZes, then the time runs out and the review is skipped. */
async function turn(r, oks, buzzes) {
    assert.equal((await begin(r)).status, 200);
    for (let i = 0; i < oks; i++) assert.equal((await right(r)).status, 200);
    for (let i = 0; i < buzzes; i++) assert.equal((await buzz(r)).status, 200);
    expire(r);
    assert.equal((await r.a.state()).proibita.phase, 'turn_end');
    return await skipWait(r);
}

test('the bank: at least 120 cards, five languages, a word and five forbidden words each, unique', () => {
    assert.ok(BANK.easy.length >= 40 && BANK.hard.length >= 40 && BANK.easy.length + BANK.hard.length >= 120);
    const en = new Set();
    for (const k of ['easy', 'hard']) {
        for (const [i, card] of BANK[k].entries()) {
            assert.equal(card.length, 5, `${k} ${i}`);
            for (const row of card) {
                assert.equal(row.length, 6, `${k} ${i} has a word and five forbidden words`);
                assert.ok(row.every((x) => typeof x === 'string' && x.trim().length >= 1), `${k} ${i}`);
                assert.ok(!row.slice(1).some((x) => x.toLowerCase() === row[0].toLowerCase()), `${k} ${i}: the word is not forbidden`);
            }
            en.add(card[1][0].toLowerCase());
        }
    }
    assert.equal(en.size, BANK.easy.length + BANK.hard.length, 'English words are unique');
});

test('migration V54 created proibita_games; settings are cleaned; the minimum depends on the phones', async () => {
    await fetch(`${site.base}/api/rooms.php`);
    assert.ok(site.db('PRAGMA user_version')[0].user_version >= 54);
    const a = await Phone.fresh();
    await a.post({ action: 'create', game: 'proibita', players: ['A'], settings: { rounds: 9, time: 5, level: 'x' } });
    let s = await a.state();
    assert.equal(s.game, 'proibita');
    assert.deepEqual(s.settings, { rounds: 3, time: 60, level: 'mix' }, 'bad values cleaned');
    assert.equal((await a.post({ action: 'start' })).status, 409, 'one player is not enough');
    assert.equal((await a.post({ action: 'settings', settings: { rounds: 5, time: 90, level: 'hard' } })).status, 200);
    assert.deepEqual((await a.state()).settings, { rounds: 5, time: 90, level: 'hard' });
    const b = await room({}, 3);
    assert.equal((await b.a.post({ action: 'start' })).status, 409, 'three players on three phones: two per team are needed');
    await a.post({ action: 'player_add', name: 'B' });
    assert.equal((await a.post({ action: 'start' })).status, 200, 'two players on one phone are enough');
    s = await a.state();
    assert.equal(s.proibita.teams.A.length, 1); assert.equal(s.proibita.teams.B.length, 1);
});

test('teams: balanced, two per team on four phones; the giver is on the active team and the guardian on the other', async () => {
    const r = await room({}, 5);
    assert.equal((await r.a.post({ action: 'start' })).status, 200);
    const g = r.game();
    assert.equal(g.teams.A.length + g.teams.B.length, 5);
    assert.ok(Math.abs(g.teams.A.length - g.teams.B.length) <= 1);
    assert.ok(g.teams.A.includes(g.giver) && g.teams.B.includes(g.guardian), 'turn 1: red clues, white guards');
    assert.equal(g.phase, 'ready'); assert.equal(g.card, null);
    const P = (await r.a.state()).proibita;
    assert.equal(P.turn, 0); assert.equal(P.turns, 6); assert.equal(P.team, 'A');
    assert.equal(P.giver, g.giver); assert.equal(P.guardian, g.guardian);
    assert.equal(P.card, null);
});

test('the card never reaches the guessing team or the spectators; only the clue-giver and the guardian phones get it', async () => {
    const r = await room({}, 5);
    await r.a.post({ action: 'start' });
    const g0 = r.game();
    const early = [];
    for (const ph of r.phones) early.push((await ph.get('state')).text);
    assert.ok(early.every((b) => (JSON.parse(b).proibita.card) === null), 'no card before the clock starts');
    assert.equal((await who(r, g0.guardian).post({ action: 'begin', player_id: g0.guardian })).status, r.a === who(r, g0.guardian) ? 200 : 409, 'only the clue-giver (or the host) starts the clock');
    if (r.game().phase === 'ready') assert.equal((await begin(r)).status, 200);
    const g = r.game();
    const row = cardOf(g.card);
    const seen = [];
    for (const ph of r.phones) {
        const body = (await ph.get('state')).text;
        const P = JSON.parse(body).proibita;
        const isRole = ph === who(r, g.giver) || ph === who(r, g.guardian);
        if (isRole) {
            seen.push(ph);
            assert.ok(P.card && LANGS.every((l) => P.card.text[l].length === 6), 'role phones get all five languages');
            assert.equal(P.card.text.en[0], row[1][0]);
        } else {
            assert.equal(P.card, null);
            for (const rw of row) assert.ok(!body.includes(JSON.stringify(rw[0])), 'the word is nowhere in the response');
        }
    }
    assert.ok(seen.length >= 2 || who(r, g.giver) === who(r, g.guardian));
    const P = (await r.a.state()).proibita;
    assert.ok(P.ends_at > Date.now() / 1000 && P.ends_at <= Date.now() / 1000 + 61, 'the end comes from the server');
    assert.ok(P.left > 55 && P.left <= 60);
});

test('got it, skip and BUZZ: roles, limits, double taps and the score', async () => {
    const r = await room({}, 4);
    await r.a.post({ action: 'start' });
    const g0 = r.game();
    const mate = g0.teams.A.find((p) => p !== g0.giver), foe = g0.teams.B.find((p) => p !== g0.guardian);
    assert.equal((await right(r)).status, 409, 'not before the clock starts');
    assert.equal((await begin(r)).status, 200);
    assert.equal((await who(r, g0.giver).post({ action: 'begin', player_id: g0.giver })).status, 409, 'the clock starts once');
    let g = r.game(); const n0 = g.card_n; const first = g.card;
    assert.equal((await who(r, mate).post({ action: 'right', player_id: mate, n: n0 })).status, 409, 'a teammate cannot press Got it');
    assert.equal((await who(r, g0.guardian).post({ action: 'right', player_id: g0.guardian, n: n0 })).status, 409, 'nor can the guardian');
    assert.equal((await who(r, g0.giver).post({ action: 'buzz', player_id: g0.giver, n: n0 })).status, 409, 'the clue-giver cannot buzz');
    assert.equal((await who(r, mate).post({ action: 'buzz', player_id: mate, n: n0 })).status, 409, 'a teammate cannot buzz');
    assert.equal((await who(r, foe).post({ action: 'buzz', player_id: foe, n: n0 })).status, 409, 'only the guardian of this turn buzzes');
    assert.equal((await who(r, g0.giver).post({ action: 'right', player_id: g0.guardian, n: n0 })).status, 403, 'not your player');
    assert.equal(r.game().score.A, 0);
    assert.equal((await right(r, n0)).status, 200);
    g = r.game(); assert.equal(g.score.A, 1); assert.equal(g.card_n, n0 + 1); assert.notEqual(g.card, first);
    assert.equal((await right(r, n0)).status, 409, 'a double tap on the old card is ignored');
    assert.equal(r.game().score.A, 1);
    assert.equal((await buzz(r, n0)).status, 409, 'so is a late BUZZ for the old card');
    assert.equal((await buzz(r)).status, 200);
    g = r.game(); assert.equal(g.score.A, 0, 'BUZZ takes a point from the clue-giver’s team'); assert.equal(g.score.B, 0);
    assert.equal((await buzz(r)).status, 200);
    assert.equal(r.game().score.A, -1, 'the score may go below zero');
    for (let i = 0; i < 3; i++) assert.equal((await skip(r)).status, 200);
    assert.equal(r.game().passes_left, 0);
    assert.equal((await skip(r)).status, 409, 'at most 3 skips per turn');
    assert.equal(r.game().score.A, -1, 'skips cost nothing');
    const P = (await r.a.state()).proibita;
    assert.equal(P.skips_left, 0); assert.equal(P.score.A, -1);
    assert.deepEqual(P.events.filter((e) => ['ok', 'buzz', 'skip'].includes(e.t)).map((e) => e.t), ['ok', 'buzz', 'buzz', 'skip', 'skip', 'skip']);
    assert.equal(r.game().stats[g0.giver].ok, 1); assert.equal(r.game().stats[g0.guardian].buzz, 2);
});

test('time up: the server closes the turn, late taps are refused, the words are shown, then the other team plays with new roles', async () => {
    const r = await room({}, 4);
    await r.a.post({ action: 'start' });
    const g0 = r.game();
    await begin(r); await right(r);
    const lastCard = r.game().card;
    expire(r);
    const late = await right(r);
    assert.equal(late.status, 409, 'too late: the time is over');
    let P = (await r.a.state()).proibita;
    assert.equal(P.phase, 'turn_end'); assert.equal(P.card, null); assert.equal(P.score.A, 1);
    assert.deepEqual(P.log.map((l) => l.r), ['ok', 'time']);
    assert.equal(P.log[1].word.en, cardOf(lastCard)[1][0], 'the last words are shown, never the forbidden ones');
    assert.ok(!JSON.stringify(P.log).includes(JSON.stringify(cardOf(lastCard)[1][1])), 'forbidden words are not in the log');
    assert.ok(P.events.some((e) => e.t === 'time' && e.team === 'A' && e.n === 1));
    assert.equal((await r.phones[1].post({ action: 'next' })).status, 403, 'only the host skips the wait');
    P = await skipWait(r);
    assert.equal(P.phase, 'ready'); assert.equal(P.turn, 1); assert.equal(P.team, 'B');
    const g1 = r.game();
    assert.ok(g1.teams.B.includes(g1.giver) && g1.teams.A.includes(g1.guardian), 'the white team gives clues now');
    assert.equal(g1.passes_left, 3); assert.equal(g1.card, null);
    // roles rotate inside the teams on the next round
    await turn(r, 0, 0);
    const g2 = r.game();
    assert.equal(g2.turn, 2);
    assert.notEqual(g2.giver, g0.giver, 'the other player of the red team gives clues');
});

test('a whole match: points, the winner, a tie, and a new match', async () => {
    const r = await room({ rounds: 2 }, 4);
    await r.a.post({ action: 'start' });
    await turn(r, 3, 1);     // red +2
    await turn(r, 1, 0);     // white +1
    await turn(r, 1, 0);     // red +1 -> 3
    let P = await turn(r, 0, 1);   // white -1 -> 0: the last turn is over and its review skipped
    assert.equal(P.status, 'ended'); assert.equal(P.phase, 'ended');
    assert.equal(P.result.winner, 'A'); assert.equal(P.result.reason, 'done');
    assert.deepEqual(P.result.score, { A: 3, B: 0 });
    assert.equal(P.result.rows.length, 4); assert.equal(P.result.rows.reduce((x, y) => x + y.ok, 0), 5); assert.equal(P.result.rows.reduce((x, y) => x + y.buzz, 0), 2);
    for (const ph of r.phones) assert.equal((await ph.state()).proibita.card, null);
    // a new match: scores and turns start again
    assert.equal((await r.a.post({ action: 'start' })).status, 200);
    P = (await r.a.state()).proibita;
    assert.equal(P.match, 2); assert.deepEqual(P.score, { A: 0, B: 0 }); assert.equal(P.turn, 0);
    // a tie
    const t = await room({ rounds: 2 }, 4);
    await t.a.post({ action: 'start' });
    await turn(t, 1, 0); await turn(t, 1, 0); await turn(t, 0, 0);
    P = await turn(t, 0, 0);
    assert.equal(P.status, 'ended'); assert.equal(P.result.winner, null, 'equal scores: no winner');
});

test('one phone for everybody: the clue-giver holds it, the same screen has the BUZZ for the guardian', async () => {
    const a = await Phone.fresh();
    await a.post({ action: 'create', game: 'proibita', players: ['X', 'Y', 'Z'], settings: { rounds: 2, time: 45 } });
    assert.equal((await a.post({ action: 'start' })).status, 200);
    let s = await a.state();
    assert.equal(s.proibita.me.length, 3);
    const G = s.proibita;
    assert.ok(s.proibita.me.find((m) => m.player_id === G.giver).giver);
    assert.ok(s.proibita.me.find((m) => m.player_id === G.guardian).guardian);
    assert.equal(G.card, null);
    assert.equal((await a.post({ action: 'begin', player_id: G.giver })).status, 200);
    s = await a.state();
    assert.ok(s.proibita.card, 'this phone owns both roles: it gets the card');
    assert.ok(s.proibita.left > 40 && s.proibita.left <= 45);
    assert.equal((await a.post({ action: 'buzz', player_id: G.guardian, n: s.proibita.card_n })).status, 200);
    s = await a.state();
    assert.equal(s.proibita.score[s.proibita.team], -1);
    assert.equal((await a.post({ action: 'right', player_id: G.giver, n: s.proibita.card_n })).status, 200);
    assert.equal((await a.state()).proibita.score[s.proibita.team], 0);
});

test('leaving: the guardian or the clue-giver leaving ends the turn; a team without players ends the match; the host can end it', async () => {
    const r = await room({}, 5);
    await r.a.post({ action: 'start' });
    await begin(r);
    const g = r.game();
    const gp = who(r, g.guardian);
    if (gp !== r.a) {
        await gp.post({ action: 'leave' });
        const P = (await r.a.state()).proibita;
        assert.equal(P.phase, 'turn_end', 'the turn ends when the guardian leaves');
        assert.ok(P.gone.includes(g.guardian));
    }
    const e = await room({}, 4);
    await e.a.post({ action: 'start' });
    assert.equal((await e.phones[1].post({ action: 'end' })).status, 403);
    assert.equal((await e.a.post({ action: 'end' })).status, 200);
    assert.equal((await e.a.state()).proibita.result.reason, 'host_ended');
    assert.equal((await e.a.post({ action: 'next' })).status, 409, 'nothing to skip any more');

    const f = await room({}, 4);
    await f.a.post({ action: 'start' });
    const ff = f.game();
    const team = ff.teams.A.filter((p) => who(f, p) !== f.a);
    if (team.length === ff.teams.A.length) {
        for (const p of team) await who(f, p).post({ action: 'leave' });
        assert.equal((await f.a.state()).proibita.result.reason, 'too_few');
    }
});

test('the host can skip a turn that does not start', async () => {
    const r = await room({}, 4);
    await r.a.post({ action: 'start' });
    assert.equal((await r.phones[1].post({ action: 'next' })).status, 403);
    assert.equal((await r.a.post({ action: 'next' })).status, 200);
    const P = (await r.a.state()).proibita;
    assert.equal(P.turn, 1); assert.equal(P.team, 'B'); assert.equal(P.phase, 'ready');
});

test('the admin LIVE view shows teams, score, roles and the current card; a normal visitor cannot see it', async () => {
    const r = await room();
    await r.a.post({ action: 'start' });
    await begin(r);
    const g = r.game();
    const admin = await makeAdmin(site, 'proibita_admin');
    const live = (await admin.get('/api/spia.php?action=live')).json.rooms.find((x) => x.code === r.code);
    assert.equal(live.game, 'proibita');
    assert.equal(live.proibita.phase, 'play'); assert.equal(live.proibita.giver, g.giver); assert.equal(live.proibita.guardian, g.guardian);
    assert.equal(live.proibita.word, cardOf(g.card)[0][0]);
    assert.deepEqual(live.proibita.taboo, cardOf(g.card)[0].slice(1));
    assert.deepEqual(live.proibita.score, { A: 0, B: 0 });
    assert.equal((await new Client(site).get('/api/spia.php?action=live')).status !== 200, true);
    assert.match((await admin.get('/api/spia.php?action=ext')).text, /proibita/i, 'the admin script knows the game');
});

test('translations: the five languages have the same keys, every key the game uses exists, the help and intro texts are complete', () => {
    const dict = { it: {}, en: {}, es: {}, fr: {}, de: {} };
    const win = { SpiaI18n: { strings: dict } };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'proibita', 'texts.js'), 'utf8'), { window: win });
    const keys = Object.keys(dict.en);
    assert.ok(keys.length > 90);
    for (const l of ['it', 'es', 'fr', 'de']) {
        assert.deepEqual(Object.keys(dict[l]).sort(), keys.slice().sort(), l + ' has the same keys as English');
        for (const k of keys) assert.ok(String(dict[l][k]).trim(), `${l}.${k} is empty`);
    }
    const placeholders = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
    for (const k of keys) for (const l of ['it', 'es', 'fr', 'de']) assert.equal(placeholders(dict[l][k]), placeholders(dict.en[k]), `${l}.${k} placeholders`);
    const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'proibita', 'game.js'), 'utf8');
    for (const m of js.matchAll(/'(pb_[a-z_]+)'/g)) if (!m[1].endsWith('_')) assert.ok(keys.includes(m[1]), 'game.js uses an unknown key ' + m[1]);
    for (const k of ['ok', 'buzz', 'skip', 'time']) assert.ok(keys.includes('pb_r_' + k), k);
    for (const k of ['easy', 'hard', 'mix']) assert.ok(keys.includes('pb_level_' + k), k);
    for (const k of ['done', 'host_ended', 'too_few']) assert.ok(keys.includes('pb_reason_' + k), k);
    for (const k of ['start', 'turn', 'begin', 'ok', 'skip', 'buzz', 'time', 'left', 'end']) assert.ok(keys.includes('pb_ev_' + k), k);
    for (const k of ['pb_title', 'pb_tagline', 'pb_one_phone_note', 'pb_need_four', 'pb_start', 'pb_new_match', 'pb_settings_next_match', 'intro_pb_1', 'intro_pb_2_t', 'intro_pb_3',
        'help_pb_basics_t', 'help_pb_turn', 'help_pb_buzz', 'help_pb_host', 'help_pb_settings', 'err_need_players_proibita', 'err_not_giver', 'err_not_guardian', 'err_no_skips']) assert.ok(keys.includes(k), k);
    for (const m of fs.readFileSync(path.join(ROOT, 'public', 'js', 'spia', 'app.js'), 'utf8').matchAll(/(?:title|tagline|note|need): '(pb_\w+)'/g)) assert.ok(keys.includes(m[1]), m[1]);
});

test('the page is served with its files, respects reduced motion, and is listed in the games and the sitemap', async () => {
    const html = await (await fetch(`${site.base}/pages/proibita.html`)).text();
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'no inline scripts');
    assert.match(html, /data-game="proibita"/);
    for (const f of ['/js/proibita/game.js', '/js/proibita/texts.js', '/css/proibita.css', '/assets/proibita/icon.svg', '/assets/proibita/manifest.json']) assert.equal((await fetch(site.base + f)).status, 200, f);
    assert.match(fs.readFileSync(path.join(ROOT, 'public', 'css', 'proibita.css'), 'utf8'), /prefers-reduced-motion: reduce/);
    const games = await (await fetch(`${site.base}/pages/giochi.php`)).text();
    const map = await (await fetch(`${site.base}/sitemap.php`)).text();
    assert.ok(games.includes('proibita.html') && map.includes('pages/proibita.html'));
});
