// tests/indovina.test.js — "Guess what" rooms: the bank of words, the SECRET word (only the keeper's own phone gets it), yes/no/maybe
// answers counted by the server, the 20 question limit, guesses judged by the server (aliases, accents, articles, one try per
// round), points, the round timer (an instant the server owns), rotating keepers, one shared phone, leaving, the admin LIVE
// view, the five languages and the page files
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
const BANK = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib', 'indovina-q.json'), 'utf8')).w;

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
    const code = (await a.post({ action: 'create', game: 'indovina', players: ['P1'], settings })).json.code;
    const phones = [a];
    for (let i = 2; i <= n; i++) { const p = await Phone.fresh(); await p.post({ action: 'join', code }); await p.post({ action: 'player_add', name: 'P' + i }); phones.push(p); }
    const s = await a.state();
    const id = Object.fromEntries(s.players.map((p) => [p.name, p.id]));
    const where = 'room_id = (SELECT id FROM spia_rooms WHERE code = ?)';
    const game = () => JSON.parse(site.db(`SELECT state FROM indovina_games WHERE ${where}`, [code])[0].state);
    const setGame = (g) => site.db(`UPDATE indovina_games SET state = ? WHERE ${where}`, [JSON.stringify(g), code]);
    return { a, phones, code, id, game, setGame };
}
const who = (r, pid) => r.phones[Number(Object.keys(r.id).find((k) => r.id[k] === pid).slice(1)) - 1];
const answer = (r, from, a) => who(r, from).post({ action: 'answer', player_id: from, a });
const guess = (r, from, text) => who(r, from).post({ action: 'guess', player_id: from, text });
/** Forces the secret word of the running round (by its English name) so the tests know it. */
const setWord = (r, en) => { const g = r.game(); g.w = BANK.findIndex((e) => e[2][1] === en); assert.ok(g.w >= 0, en); r.setGame(g); };
const late = (r) => { const g = r.game(); g.ends_at = Date.now() / 1000 - 1; r.setGame(g); };
const skipReveal = (r) => { const g = r.game(); g.next_at = Date.now() / 1000 - 1; r.setGame(g); };

test('the bank: at least 150 words, four categories, five names each, aliases, unique English names', () => {
    assert.ok(BANK.length >= 150);
    for (const [i, e] of BANK.entries()) {
        assert.ok(['p', 'o', 'l', 'a'].includes(e[0]) && [1, 2].includes(e[1]), 'entry ' + i);
        assert.equal(e[2].length, 5, 'five names ' + i);
        assert.ok(e[2].every((x) => typeof x === 'string' && x.trim().length >= 2), 'names ' + i);
        assert.ok(Array.isArray(e[3]), 'aliases ' + i);
    }
    for (const c of ['p', 'o', 'l', 'a']) assert.ok(BANK.filter((e) => e[0] === c).length >= 30, c);
    assert.equal(new Set(BANK.map((e) => e[2][1])).size, BANK.length, 'English names are unique');
    assert.ok([1, 2].every((d) => BANK.some((e) => e[1] === d)), 'both difficulty levels exist');
});

test('migration V55 created indovina_games; settings are cleaned; three players are needed', async () => {
    await fetch(`${site.base}/api/rooms.php`);
    assert.ok(site.db('PRAGMA user_version')[0].user_version >= 55);
    const a = await Phone.fresh();
    await a.post({ action: 'create', game: 'indovina', players: ['A', 'B'], settings: { rounds: 9, cat: 'x', diff: 'y', time: 7 } });
    const s = await a.state();
    assert.equal(s.game, 'indovina');
    assert.deepEqual(s.settings, { rounds: 1, cat: 'mix', diff: 'mix', time: 300 }, 'bad values cleaned');
    assert.equal((await a.post({ action: 'start' })).status, 409, 'two players are not enough');
    assert.equal((await a.post({ action: 'settings', settings: { rounds: 2, cat: 'animals', diff: 'easy', time: 180 } })).status, 200);
    assert.deepEqual((await a.state()).settings, { rounds: 2, cat: 'animals', diff: 'easy', time: 180 });
});

test('the word is secret: only the keeper phone gets it while the round runs; the category is public; the end shows it to all', async () => {
    const r = await room({ cat: 'places' }, 4);
    assert.equal((await r.a.post({ action: 'start' })).status, 200);
    setWord(r, 'Colosseum');
    const g = r.game();
    assert.equal(g.keeper, g.turns[0]);
    for (const ph of r.phones) {
        const s = await ph.state();
        const P = s.indovina, text = JSON.stringify(s);
        const keeperPhone = who(r, g.keeper) === ph;
        assert.equal(P.keeper, g.keeper); assert.equal(P.cat, 'l'); assert.equal(P.phase, 'ask');
        if (keeperPhone) { assert.equal(P.secret.word.en, 'Colosseum'); assert.equal(P.secret.player_id, g.keeper); }
        else { assert.equal(P.secret, null); assert.ok(!/Colosseum|Colosseo|Coliseo|Colis/.test(text), 'the word is nowhere'); }
        assert.ok(P.reveal === null);
    }
    const guesser = g.order.find((p) => p !== g.keeper);
    assert.equal((await guess(r, guesser, 'Colosseo')).status, 200);
    for (const ph of r.phones) {
        const P = (await ph.state()).indovina;
        assert.equal(P.phase, 'reveal'); assert.equal(P.reveal.word.en, 'Colosseum'); assert.equal(P.secret, null);
    }
});

test('answers: only the keeper presses yes/no/maybe; the server counts and keeps the history for everybody; undo; the limit of 20', async () => {
    const r = await room({}, 4);
    await r.a.post({ action: 'start' });
    const g = r.game(), k = g.keeper, other = g.order.find((p) => p !== k);
    assert.equal((await answer(r, other, 'y')).status, 409, 'not the keeper');
    assert.equal((await who(r, k).post({ action: 'answer', player_id: other, a: 'y' })).status, 403, 'not your player');
    assert.equal((await answer(r, k, 'x')).status, 409, 'bad answer');
    for (const a of ['y', 'n', 'm']) assert.equal((await answer(r, k, a)).status, 200);
    for (const ph of r.phones) {
        const P = (await ph.state()).indovina;
        assert.deepEqual(P.answers, ['y', 'n', 'm']); assert.equal(P.limit, 20);
    }
    assert.equal((await who(r, k).post({ action: 'undo', player_id: k })).status, 200);
    assert.deepEqual((await r.a.state()).indovina.answers, ['y', 'n']);
    assert.equal((await who(r, other).post({ action: 'undo', player_id: other })).status, 409, 'only the keeper can undo');
    for (let i = 0; i < 18; i++) assert.equal((await answer(r, k, 'y')).status, 200);
    let P = (await r.a.state()).indovina;
    assert.equal(P.answers.length, 20);
    assert.ok(P.left <= 31 && P.left > 0, 'only the last seconds are left after the 20th answer: ' + P.left);
    assert.equal((await answer(r, k, 'n')).status, 409, 'the 21st question is refused');
    assert.ok(P.events.some((e) => e.t === 'limit'));
});

test('a guess is judged by the server: case, accents, articles, aliases and other languages; one try per round; the keeper cannot guess', async () => {
    const r = await room({}, 4);
    await r.a.post({ action: 'start' });
    const g = r.game(), k = g.keeper;
    const [p1, p2, p3] = g.order.filter((p) => p !== k);
    setWord(r, 'Eiffel Tower');
    assert.equal((await guess(r, k, 'Torre Eiffel')).status, 403, 'the keeper cannot guess');
    assert.equal((await guess(r, p1, '   ')).status, 409, 'empty guess');
    assert.equal((await guess(r, p1, 'Big Ben')).status, 200);
    let P = (await r.a.state()).indovina;
    assert.deepEqual(P.tried, [p1]); assert.equal(P.phase, 'ask');
    assert.ok(P.events.some((e) => e.t === 'wrong' && e.p === p1));
    assert.equal((await guess(r, p1, 'Eiffel Tower')).status, 409, 'one try per round: it was already used');
    assert.equal((await guess(r, p2, 'LA TOUR   EIFFEL!')).status, 200, 'case, article and punctuation are tolerated (alias in French)');
    P = (await r.a.state()).indovina;
    assert.equal(P.phase, 'reveal'); assert.equal(P.reveal.kind, 'found'); assert.equal(P.reveal.p, p2);
    assert.equal(P.scores[p2], 3); assert.equal(P.scores[k], 0); assert.equal(P.scores[p1], 0);
    assert.equal((await guess(r, p3, 'Eiffel Tower')).status, 409, 'the round is over');
    assert.ok(P.reveal.tries.some((t) => t.p === p1 && t.text === 'Big Ben'));

    // accents and typos
    const checks = [['Leonardo da Vinci', 'léonard de vinci'], ['Pelé', 'PELE'], ['Sagrada Família', 'sagrada familia'], ['Statue of Liberty', 'the statue of liberty'], ['washing machine', 'the washing  machine'], ['Mount Everest', 'everest']];
    for (const [word, text] of checks) {
        const q = await room({}, 3);
        await q.a.post({ action: 'start' });
        setWord(q, word);
        const kk = q.game().keeper, gg = q.game().order.find((p) => p !== kk);
        assert.equal((await guess(q, gg, text)).status, 200, text);
        assert.equal((await q.a.state()).indovina.reveal.kind, 'found', `${word} <- ${text}`);
    }
});

test('if nobody finds it the keeper gets 1 point per guesser: everybody wrong, or the time is up', async () => {
    const r = await room({}, 4);
    await r.a.post({ action: 'start' });
    let g = r.game(), k = g.keeper;
    setWord(r, 'Pelé');
    for (const p of g.order.filter((x) => x !== k)) assert.equal((await guess(r, p, 'nope ' + p)).status, 200);
    let P = (await r.a.state()).indovina;
    assert.equal(P.reveal.kind, 'nobody'); assert.equal(P.scores[k], 3); assert.equal(P.reveal.word.en, 'Pelé');

    // time up: the end instant is on the server; writing it in the past ends the round on the next request
    skipReveal(r);
    P = (await r.a.state()).indovina;
    assert.equal(P.round, 2); assert.equal(P.phase, 'ask'); assert.notEqual(P.keeper, k, 'keepers rotate');
    const k2 = P.keeper;
    assert.ok(P.left > 280 && P.left <= 300, 'the client gets the time left: ' + P.left);
    assert.ok(Math.abs(P.ends_at - (Date.now() / 1000 + P.left)) < 3);
    late(r);
    P = (await r.a.state()).indovina;
    assert.equal(P.phase, 'reveal'); assert.equal(P.reveal.kind, 'nobody'); assert.equal(P.scores[k2], 3);
    assert.equal((await answer(r, k2, 'y')).status, 409, 'too late');
});

test('rotation and the end: every player is the keeper once (twice with 2 turns), the host skips the wait, the standings come at the end', async () => {
    const r = await room({}, 3);
    await r.a.post({ action: 'start' });
    const order = r.game().order;
    const keepers = [];
    for (let i = 0; i < 3; i++) {
        const P = (await r.a.state()).indovina;
        keepers.push(P.keeper); assert.equal(P.round, i + 1); assert.equal(P.total, 3);
        late(r);
        await r.a.state();
        if (i === 0) assert.equal((await r.phones[1].post({ action: 'next' })).status, 403, 'host only');
        if (i < 2) assert.equal((await r.a.post({ action: 'next' })).status, 200);
    }
    assert.deepEqual(keepers, order, 'one turn each, in the seating order');
    let P = (await r.a.state()).indovina;
    assert.equal(P.last, true);
    assert.equal((await r.a.post({ action: 'next' })).status, 200);
    P = (await r.a.state()).indovina;
    assert.equal(P.status, 'ended'); assert.equal(P.result.reason, 'done');
    assert.equal(P.result.rows.length, 3); assert.ok(P.result.rows.every((x) => x.pts === 2), 'each keeper got 2 points');
    assert.equal(P.result.winners.length, 3);
    assert.equal((await r.a.post({ action: 'start' })).status, 200, 'a new match');
    assert.equal((await r.a.state()).indovina.match, 2);

    const t = await room({ rounds: 2 }, 3);
    await t.a.post({ action: 'start' });
    assert.equal((await t.a.state()).indovina.total, 6);
});

test('one phone for everybody: the phone has all the players, the keeper answers and the others guess from the same device', async () => {
    const a = await Phone.fresh();
    await a.post({ action: 'create', game: 'indovina', players: ['X', 'Y', 'Z'] });
    assert.equal((await a.post({ action: 'start' })).status, 200);
    let s = await a.state();
    assert.equal(s.indovina.me.length, 3);
    const k = s.indovina.keeper;
    assert.ok(s.indovina.me.find((m) => m.player_id === k).keeper);
    assert.ok(s.indovina.secret && s.indovina.secret.player_id === k && s.indovina.secret.word.en);
    assert.equal(s.indovina.me.filter((m) => m.can_try).length, 2);
    assert.equal((await a.post({ action: 'answer', player_id: k, a: 'n' })).status, 200);
    const [g1, g2] = s.indovina.me.filter((m) => m.can_try).map((m) => m.player_id);
    assert.equal((await a.post({ action: 'guess', player_id: g1, text: 'zzz' })).status, 200);
    s = await a.state();
    assert.ok(s.indovina.me.find((m) => m.player_id === g1).tried);
    assert.equal(s.indovina.me.find((m) => m.player_id === g1).can_try, false);
    assert.equal((await a.post({ action: 'guess', player_id: g2, text: s.indovina.secret.word.en })).status, 200);
    s = await a.state();
    assert.equal(s.indovina.reveal.kind, 'found'); assert.equal(s.indovina.scores[g2], 3);
});

test('leaving: the keeper leaving cancels the round, a guesser leaving can end it; fewer than 3 players ends the match; the host can end it', async () => {
    const r = await room({}, 4);
    await r.a.post({ action: 'start' });
    const g = r.game();
    const kp = who(r, g.keeper);
    const leaver = kp === r.a ? r.phones[1] : kp;
    if (kp === r.a) { // the host phone is the keeper: another phone leaves instead, the round goes on
        await leaver.post({ action: 'leave' });
        assert.equal((await r.a.state()).indovina.phase, 'ask');
    } else {
        await leaver.post({ action: 'leave' });
        const P = (await r.a.state()).indovina;
        assert.equal(P.phase, 'reveal'); assert.equal(P.reveal.kind, 'void'); assert.equal(P.reveal.word !== null, true);
        assert.ok(Object.values(P.scores).every((x) => x === 0), 'no points for a cancelled round');
    }
    const e = await room({}, 3);
    await e.a.post({ action: 'start' });
    assert.equal((await e.phones[1].post({ action: 'end' })).status, 403);
    assert.equal((await e.a.post({ action: 'end' })).status, 200);
    assert.equal((await e.a.state()).indovina.result.reason, 'host_ended');
    const f = await room({}, 3);
    await f.a.post({ action: 'start' });
    await f.phones[2].post({ action: 'leave' });
    assert.equal((await f.a.state()).indovina.result.reason, 'too_few');
});

test('the admin LIVE view shows the secret word, the answers and the scores; a normal visitor cannot see it', async () => {
    const r = await room({}, 3);
    await r.a.post({ action: 'start' });
    setWord(r, 'penguin');
    const g = r.game();
    await answer(r, g.keeper, 'm');
    const admin = await makeAdmin(site, 'indovina_admin');
    const live = (await admin.get('/api/spia.php?action=live')).json.rooms.find((x) => x.code === r.code);
    assert.equal(live.game, 'indovina');
    assert.equal(live.indovina.phase, 'ask'); assert.equal(live.indovina.keeper, g.keeper);
    assert.equal(live.indovina.word.en, 'penguin'); assert.equal(live.indovina.word.it, 'pinguino');
    assert.deepEqual(live.indovina.answers, ['m']);
    assert.equal((await new Client(site).get('/api/spia.php?action=live')).status !== 200, true);
    assert.match((await admin.get('/api/spia.php?action=ext')).text, /indovina/i, 'the admin script knows the game');
});

test('translations: the five languages have the same keys, every key the game uses exists, the help and intro texts are complete', () => {
    const dict = { it: {}, en: {}, es: {}, fr: {}, de: {} };
    const win = { SpiaI18n: { strings: dict } };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'indovina', 'texts.js'), 'utf8'), { window: win });
    const keys = Object.keys(dict.en);
    assert.ok(keys.length > 100);
    for (const l of ['it', 'es', 'fr', 'de']) {
        assert.deepEqual(Object.keys(dict[l]).sort(), keys.slice().sort(), l + ' has the same keys as English');
        for (const k of keys) assert.ok(String(dict[l][k]).trim(), `${l}.${k} is empty`);
    }
    const placeholders = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
    for (const k of keys) for (const l of ['it', 'es', 'fr', 'de']) assert.equal(placeholders(dict[l][k]), placeholders(dict.en[k]), `${l}.${k} placeholders`);
    const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'indovina', 'game.js'), 'utf8');
    for (const m of js.matchAll(/'(iv_[a-z_]+)'/g)) if (!m[1].endsWith('_')) assert.ok(keys.includes(m[1]), 'game.js uses an unknown key ' + m[1]);
    for (const k of ['mix', 'people', 'objects', 'places', 'animals']) assert.ok(keys.includes('iv_cat_' + k), k);
    for (const k of ['p', 'o', 'l', 'a']) assert.ok(keys.includes('iv_hint_' + k), k);
    for (const k of ['y', 'n', 'm']) assert.ok(keys.includes('iv_a_' + k), k);
    for (const k of ['done', 'host_ended', 'too_few']) assert.ok(keys.includes('iv_reason_' + k), k);
    for (const k of ['start', 'round', 'found', 'nobody', 'void', 'wrong', 'limit', 'left', 'end']) assert.ok(keys.includes('iv_ev_' + k), k);
    for (const k of ['iv_title', 'iv_tagline', 'iv_one_phone_note', 'iv_need_three', 'iv_start', 'iv_new_match', 'iv_settings_next_match', 'intro_iv_1', 'intro_iv_2_t', 'intro_iv_3',
        'help_iv_basics_t', 'help_iv_rounds', 'help_iv_scoring', 'help_iv_host', 'help_iv_settings', 'err_need_players_indovina', 'err_not_keeper', 'err_already_tried', 'err_limit_reached']) assert.ok(keys.includes(k), k);
    for (const m of fs.readFileSync(path.join(ROOT, 'public', 'js', 'spia', 'app.js'), 'utf8').matchAll(/(?:title|tagline|note|need): '(iv_\w+)'/g)) assert.ok(keys.includes(m[1]), m[1]);
});

test('the page is served with its files, is listed in the games and the sitemap, and the style respects accessibility settings', async () => {
    const html = await (await fetch(`${site.base}/pages/indovina.html`)).text();
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'no inline scripts');
    assert.match(html, /data-game="indovina"/);
    for (const f of ['/js/indovina/game.js', '/js/indovina/texts.js', '/css/indovina.css', '/assets/indovina/icon.svg', '/assets/indovina/manifest.json']) assert.equal((await fetch(site.base + f)).status, 200, f);
    const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'indovina.css'), 'utf8');
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.match(css, /:focus-visible/);
    const games = await (await fetch(`${site.base}/pages/giochi.php`)).text();
    const map = await (await fetch(`${site.base}/sitemap.php`)).text();
    assert.ok(games.includes('indovina.html') && map.includes('pages/indovina.html'));
});
