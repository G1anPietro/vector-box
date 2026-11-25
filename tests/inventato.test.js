// tests/inventato.test.js — "Fake or fact" (inventato) rooms: the claim bank (5 languages, explanations, balance), the truth never sent
// before the reveal, scores and the speed bonus, the one-phone mode, leaving, host tools, alone (sealed token, records), the admin LIVE
// view, the five languages of the page texts and the page files
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
const BANK = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib', 'inventato-q.json'), 'utf8'));
const LANGS = ['it', 'en', 'es', 'fr', 'de'];

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
async function room(settings = {}, n = 2) {
    try { site.db('DELETE FROM rate_limits'); } catch (e) { /* not created yet */ }
    const a = await Phone.fresh();
    const code = (await a.post({ action: 'create', game: 'inventato', players: ['P1'], settings })).json.code;
    const phones = [a];
    for (let i = 2; i <= n; i++) { const p = await Phone.fresh(); await p.post({ action: 'join', code }); await p.post({ action: 'player_add', name: 'P' + i }); phones.push(p); }
    const s = await a.state();
    const id = Object.fromEntries(s.players.map((p) => [p.name, p.id]));
    const where = 'room_id = (SELECT id FROM spia_rooms WHERE code = ?)';
    const game = () => JSON.parse(site.db(`SELECT state FROM inventato_games WHERE ${where}`, [code])[0].state);
    const setGame = (g) => site.db(`UPDATE inventato_games SET state = ? WHERE ${where}`, [JSON.stringify(g), code]);
    return { a, phones, code, id, game, setGame };
}
const answer = (r, who, choice) => r.phones[who - 1].post({ action: 'answer', player_id: r.id['P' + who], choice });
const truthNow = (r) => (BANK[r.game().q.i][2] === 1 ? 1 : 0);
const expire = (r) => { const g = r.game(); g.q.deadline = Date.now() / 1000 - 1; r.setGame(g); };
const skipReveal = async (r) => { const g = r.game(); g.next_at = Date.now() / 1000 - 1; r.setGame(g); return (await r.a.state()).inventato; };

test('the claim bank: 150+ claims, five languages and an explanation each, half true, both levels, six categories, no claim twice', () => {
    assert.ok(BANK.length >= 150);
    const trues = BANK.filter((r) => r[2] === 1).length;
    assert.ok(trues >= BANK.length * 0.4 && trues <= BANK.length * 0.6, 'balanced: ' + trues + '/' + BANK.length);
    for (const d of [0, 1]) assert.ok(BANK.filter((r) => r[1] === d).length >= 50, 'difficulty ' + d);
    for (let c = 0; c <= 5; c++) assert.ok(BANK.filter((r) => r[0] === c).length >= 20, 'category ' + c);
    for (const [i, row] of BANK.entries()) {
        assert.equal(row.length, 5, 'row ' + i);
        assert.ok([0, 1].includes(row[1]) && [0, 1].includes(row[2]));
        for (const col of [3, 4]) {
            assert.equal(row[col].length, 5, `row ${i} column ${col} has the five languages`);
            assert.ok(row[col].every((x) => typeof x === 'string' && x.trim().length > 8), `row ${i} column ${col}`);
        }
        assert.ok(row[3].every((x) => x.length <= 200), 'claim fits a phone, row ' + i);
    }
    assert.equal(new Set(BANK.map((r) => r[3][1])).size, BANK.length, 'no claim twice');
});

test('migration V60 created inventato_games; settings are cleaned; two players are needed', async () => {
    await fetch(`${site.base}/api/rooms.php`);
    assert.ok(site.db('PRAGMA user_version')[0].user_version >= 60);
    const a = await Phone.fresh();
    await a.post({ action: 'create', game: 'inventato', players: ['A'], settings: { level: 'zzz', rounds: 99, time: 3, scores: 'x' } });
    const s = await a.state();
    assert.equal(s.game, 'inventato');
    assert.deepEqual(s.settings, { level: 'mix', rounds: 10, time: 25, scores: false });
    assert.equal((await a.post({ action: 'start' })).status, 409, 'one player is not enough');
    assert.equal((await a.post({ action: 'settings', settings: { level: 'hard', rounds: 20, time: 40, scores: true } })).status, 200);
    assert.deepEqual((await a.state()).settings, { level: 'hard', rounds: 20, time: 40, scores: true });
});

test('the truth never reaches a phone before the reveal; the claim comes in five languages; who answered is public, what is not', async () => {
    const r = await room({}, 3);
    assert.equal((await r.a.post({ action: 'start' })).status, 200);
    assert.equal((await answer(r, 1, 1)).status, 200);
    for (const ph of r.phones) {
        const s = await ph.state();
        const V = s.inventato, raw = JSON.stringify(s);
        assert.equal(V.phase, 'question'); assert.equal(V.reveal, null);
        assert.ok(!raw.includes('"truth"') && !raw.includes('"explain"') && !raw.includes('"answers"'), 'no truth, no explanation, no choices');
        assert.deepEqual(V.answered, [r.id.P1], 'who answered is public');
        assert.ok(LANGS.every((l) => V.q.text[l].length > 5), 'claim in 5 languages');
    }
    assert.deepEqual((await r.a.state()).inventato.me, [{ player_id: r.id.P1, active: true, answered: true }]);
});

test('answer checks: not your player, bad choice, twice, not in time', async () => {
    const r = await room();
    await r.a.post({ action: 'start' });
    assert.equal((await r.a.post({ action: 'answer', player_id: r.id.P2, choice: 1 })).status, 403);
    for (const bad of [2, -1, 'x', null, 1.5]) assert.equal((await answer(r, 1, bad)).status, 409, String(bad));
    assert.equal((await answer(r, 1, 0)).status, 200);
    assert.equal((await answer(r, 1, 1)).status, 409, 'already answered');
    const g = r.game(); g.q.deadline = Date.now() / 1000 - 5; g.answers = {}; r.setGame(g);
    assert.equal((await answer(r, 2, 1)).status, 409, 'too late');
});

test('everybody answered: the truth and the explanation appear, right answers score 100 plus a speed bonus, wrong ones nothing', async () => {
    const r = await room({}, 3);
    await r.a.post({ action: 'start' });
    const truth = truthNow(r);
    await answer(r, 1, truth); await answer(r, 2, 1 - truth);
    assert.equal((await r.a.state()).inventato.phase, 'question', 'P3 is still missing');
    await answer(r, 3, truth);
    const V = (await r.phones[1].state()).inventato;
    assert.equal(V.phase, 'reveal');
    assert.equal(V.reveal.truth, truth === 1);
    assert.ok(LANGS.every((l) => V.reveal.explain[l].length > 8));
    for (const p of ['P1', 'P3']) { const g = V.reveal.gain[r.id[p]]; assert.ok(g >= 100 && g <= 150 && V.points[r.id[p]] === g, p + ' ' + g); }
    assert.equal(V.reveal.gain[r.id.P2], undefined); assert.equal(V.points[r.id.P2], 0);
    assert.deepEqual(V.reveal.answers[r.id.P2], 1 - truth);
    assert.ok(V.next_left > 0);
    assert.ok(Math.max(...Object.values(V.reveal.gain)) <= 150);
});

test('speed bonus: a slow right answer scores less than a quick one; no answer at the deadline scores nothing', async () => {
    const r = await room({ time: 15 }, 3);
    await r.a.post({ action: 'start' });
    const truth = truthNow(r);
    await answer(r, 1, truth);
    const g = r.game(); g.q.started -= 7.5; g.q.deadline -= 7.5; r.setGame(g);   // half of the time has passed
    await answer(r, 2, truth);
    expire(r);
    const V = (await r.a.state()).inventato;
    assert.equal(V.phase, 'reveal');
    assert.ok(V.reveal.gain[r.id.P1] > V.reveal.gain[r.id.P2], 'quick > slow');
    assert.ok(V.reveal.gain[r.id.P2] >= 124 && V.reveal.gain[r.id.P2] <= 126, 'about 125: ' + V.reveal.gain[r.id.P2]);
    assert.equal(V.reveal.gain[r.id.P3], undefined);
});

test('rounds: the host can skip the reveal, others cannot; the claims do not repeat; after the last round the standings come; a new match is possible', async () => {
    const r = await room({ rounds: 10, time: 15 }, 2);
    await r.a.post({ action: 'start' });
    const seen = new Set();
    for (let round = 1; round <= 10; round++) {
        const g = r.game(); assert.equal(g.round, round); assert.ok(!seen.has(g.q.i), 'claim not repeated'); seen.add(g.q.i);
        const t = truthNow(r);
        await answer(r, 1, t); await answer(r, 2, 1 - t);
        const V = (await r.a.state()).inventato;
        assert.equal(V.reveal.last, round === 10);
        if (round === 1) {
            assert.equal((await r.phones[1].post({ action: 'next' })).status, 403);
            assert.equal((await r.a.post({ action: 'next' })).status, 200);
        } else await skipReveal(r);
    }
    const V = (await r.a.state()).inventato;
    assert.equal(V.status, 'ended'); assert.equal(V.result.reason, 'rounds_done');
    assert.deepEqual(V.result.winners, [r.id.P1]); assert.equal(V.result.right[r.id.P1], 10); assert.equal(V.result.right[r.id.P2], 0);
    assert.ok(V.result.points[r.id.P1] >= 1000);
    assert.equal((await r.a.post({ action: 'start' })).status, 200, 'a new match');
    assert.equal((await r.a.state()).inventato.match, 2);
});

test('levels: easy only easy claims, hard only hard claims, mix has both; both truths turn up', async () => {
    for (const [level, want] of [['easy', [0]], ['hard', [1]]]) {
        const r = await room({ level });
        await r.a.post({ action: 'start' });
        const truths = new Set();
        for (let i = 0; i < 14; i++) {
            const g = r.game(); assert.ok(want.includes(BANK[g.q.i][1]), level); truths.add(BANK[g.q.i][2]);
            g.phase = 'reveal'; g.next_at = 0; r.setGame(g); await r.a.state();
        }
        assert.equal(truths.size, 2, 'true and made-up claims both appear');
    }
    const m = await room({ level: 'mix' });
    await m.a.post({ action: 'start' });
    const d = new Set();
    for (let i = 0; i < 20; i++) { const g = m.game(); d.add(BANK[g.q.i][1]); g.phase = 'reveal'; g.next_at = 0; m.setGame(g); await m.a.state(); }
    assert.equal(d.size, 2);
});

test('one phone for everybody: several players on one device answer in turn', async () => {
    const a = await Phone.fresh();
    await a.post({ action: 'create', game: 'inventato', players: ['X', 'Y', 'Z'] });
    assert.equal((await a.post({ action: 'start' })).status, 200);
    const s = await a.state();
    assert.equal(s.inventato.me.length, 3);
    const id = Object.fromEntries(s.players.map((p) => [p.name, p.id]));
    assert.equal((await a.post({ action: 'answer', player_id: id.X, choice: 1 })).status, 200);
    assert.equal((await a.post({ action: 'answer', player_id: id.Y, choice: 0 })).status, 200);
    assert.equal((await a.state()).inventato.phase, 'question');
    assert.equal((await a.post({ action: 'answer', player_id: id.Z, choice: 1 })).status, 200);
    assert.equal((await a.state()).inventato.phase, 'reveal');
});

test('leaving: with fewer than 2 players the match ends; the host can end it; others cannot; a room score goes to the winner once', async () => {
    const r = await room({}, 2);
    await r.a.post({ action: 'start' });
    await r.phones[1].post({ action: 'leave' });
    assert.equal((await r.a.state()).inventato.result.reason, 'too_few');

    const e = await room({ scores: true }, 2);
    await e.a.post({ action: 'start' });
    assert.equal((await e.phones[1].post({ action: 'end' })).status, 403);
    const t = truthNow(e);
    await answer(e, 1, t); await answer(e, 2, 1 - t);
    assert.equal((await e.a.post({ action: 'end' })).status, 200);
    const s = await e.a.state();
    assert.equal(s.inventato.result.reason, 'host_ended');
    assert.equal(s.players.find((p) => p.name === 'P1').score, 1, 'winner got a point');
    await e.a.state();
    assert.equal((await e.a.state()).players.find((p) => p.name === 'P1').score, 1, 'only once');
});

test('the admin LIVE view shows the claim, its truth and what everybody picked; a normal visitor cannot see it', async () => {
    const r = await room();
    await r.a.post({ action: 'start' });
    const t = truthNow(r);
    await answer(r, 1, t);
    const admin = await makeAdmin(site, 'inventato_admin');
    const live = (await admin.get('/api/spia.php?action=live')).json.rooms.find((x) => x.code === r.code);
    assert.equal(live.game, 'inventato');
    assert.equal(live.inventato.phase, 'question'); assert.equal(live.inventato.truth, t === 1);
    assert.equal(live.inventato.answers[r.id.P1], t); assert.ok(LANGS.every((l) => live.inventato.claim[l]));
    assert.equal((await new Client(site).get('/api/spia.php?action=live')).status !== 200, true);
    assert.match((await admin.get('/api/spia.php?action=ext')).text, /inventato/i, 'the admin script knows the game');
});

// ----- alone: sealed token, no table -----
const get = async (qs) => (await fetch(`${site.base}/api/inventato_solo.php?action=question&${qs}`)).json();
const check = (c, token, choice) => c.post('/api/inventato_solo.php', { token, choice });

test('alone: the claim has no truth in it, the token is sealed, the server judges and times it; no CSRF, no check', async () => {
    try { site.db('DELETE FROM rate_limits'); } catch (e) { /* not created yet */ }
    const q = await get('level=mix&time=40');
    assert.equal(q.success, true); assert.equal(q.time, 40); assert.ok(LANGS.every((l) => q.text[l]));
    assert.ok(!/"truth"|"explain"|"right"/.test(JSON.stringify(q)), 'nothing about the truth in the claim');
    assert.throws(() => JSON.parse(Buffer.from(q.token.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1')), 'the token is encrypted');
    const c = await new Client(site).init();
    const wrongWay = (await check(c, q.token, 0)).json, rightWay = (await check(c, q.token, 1)).json;
    assert.equal(wrongWay.truth, rightWay.truth);
    const truth = rightWay.truth ? 1 : 0;
    assert.equal(BANK.find((x) => x[3][1] === q.text.en)[2], truth);
    const good = (await check(c, q.token, truth)).json;
    assert.equal(good.right, true); assert.ok(good.points > 140 && good.points <= 150, 'speed bonus ' + good.points);
    assert.ok(LANGS.every((l) => good.explain[l]));
    const bad = (await check(c, q.token, 1 - truth)).json;
    assert.deepEqual([bad.right, bad.points], [false, 0]);
    const none = (await check(c, q.token, null)).json;
    assert.equal(none.right, false);
    assert.equal((await check(c, q.token + 'x', 1)).status, 400, 'tampered token');
    assert.equal((await check(c, 'abc', 1)).status, 400);
    const noCsrf = await fetch(`${site.base}/api/inventato_solo.php`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: q.token, choice: 1 }) });
    assert.notEqual(noCsrf.status, 200);
    assert.equal((await fetch(`${site.base}/api/inventato_solo.php?action=nope`)).status, 400);
    assert.equal((await get('level=hard&time=15')).time, 15);
});

test('alone: the level is honoured, a claim already seen is not asked again, bad parameters fall back', async () => {
    const seen = [];
    for (let i = 0; i < 12; i++) {
        const q = await get(`level=easy&exclude=${seen.join(',')}`);
        const row = BANK.find((x) => x[3][1] === q.text.en);
        assert.equal(row[1], 0, 'easy'); assert.ok(!seen.includes(q.sid)); seen.push(q.sid);
        assert.equal(q.diff, 0);
    }
    const hard = await get('level=hard'); assert.equal(hard.diff, 1);
    const junk = await get('level=zzz&time=7&exclude=%3Cb%3E,1,2'); assert.equal(junk.success, true); assert.equal(junk.time, 25);
});

test('records: Fake or fact alone is a personal record per level (right answers), merged with the account; unknown levels are refused', async () => {
    try { site.db('DELETE FROM rate_limits'); } catch (e) { /* not created yet */ }
    const c = await new Client(site).init(); await c.register('inventato_rec');
    const sub = (variant, value) => c.post('/api/records.php', { action: 'submit', game: 'inventato', variant, value });
    assert.equal((await sub('easy', 14)).json.best, 14);
    assert.deepEqual([(await sub('easy', 9)).json.best, (await sub('easy', 9)).json.improved], [14, false]);
    assert.equal((await sub('mix', 6)).json.best, 6);
    assert.equal((await sub('normal', 5)).status, 400); assert.equal((await sub('easy', 0)).status, 400); assert.equal((await sub('easy', 'x')).status, 400);
    const r = (await c.post('/api/records.php', { action: 'sync', game: 'inventato', bests: { easy: 3, hard: 20, normal: -1 } })).json;
    assert.deepEqual(r.bests, { easy: 14, hard: 20, mix: 6 });
    assert.equal((await c.get('/api/records.php')).json.records.inventato.hard.best, 20);
});

test('translations: the five languages have the same keys and placeholders, every key the game uses exists, the help and intro texts are complete', () => {
    const dict = { it: {}, en: {}, es: {}, fr: {}, de: {} };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'inventato', 'texts.js'), 'utf8'), { window: { SpiaI18n: { strings: dict } } });
    const keys = Object.keys(dict.en);
    assert.ok(keys.length > 90);
    for (const l of ['it', 'es', 'fr', 'de']) {
        assert.deepEqual(Object.keys(dict[l]).sort(), keys.slice().sort(), l + ' has the same keys as English');
        for (const k of keys) assert.ok(String(dict[l][k]).trim(), `${l}.${k} is empty`);
    }
    const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
    for (const k of keys) for (const l of ['it', 'es', 'fr', 'de']) assert.equal(ph(dict[l][k]), ph(dict.en[k]), `${l}.${k} placeholders`);
    const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'inventato', 'game.js'), 'utf8');
    for (const m of js.matchAll(/\bt\(\s*'(vi_[a-z_0-9]+)'/g)) assert.ok(m[1].endsWith('_') ? keys.some((k) => k.startsWith(m[1])) : keys.includes(m[1]), 'game.js uses an unknown key ' + m[1]);
    for (const k of ['vi_title', 'vi_tagline', 'vi_one_phone_note', 'vi_need_two', 'vi_start', 'vi_new_match', 'vi_settings_next_match', 'intro_vi_1', 'intro_vi_2_t', 'intro_vi_3',
        'help_vi_basics_t', 'help_vi_rounds', 'help_vi_scoring', 'help_vi_host', 'help_vi_settings', 'err_need_players_inventato', 'err_bad_choice', 'vi_level_easy', 'vi_level_hard', 'vi_level_mix',
        'vi_reason_rounds_done', 'vi_reason_host_ended', 'vi_reason_too_few', 'vi_cat_0', 'vi_cat_5', 'vi_true', 'vi_fake']) assert.ok(keys.includes(k), k);
    for (const m of fs.readFileSync(path.join(ROOT, 'public', 'js', 'spia', 'app.js'), 'utf8').matchAll(/(?:title|tagline|note|need): '(vi_\w+)'/g)) assert.ok(keys.includes(m[1]), m[1]);
});

test('the page is served in English with its files, loads the records script, is in the games list and the sitemap; no inline script', async () => {
    const html = await (await fetch(`${site.base}/pages/inventato.html`)).text();
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'no inline scripts');
    assert.match(html, /<html lang="en" data-game="inventato">/);
    assert.ok(html.indexOf('/js/records.js') > 0 && html.indexOf('/js/records.js') < html.indexOf('/js/inventato/game.js'));
    for (const f of ['/js/inventato/game.js', '/js/inventato/texts.js', '/css/inventato.css', '/assets/inventato/icon.svg', '/assets/inventato/manifest.json']) assert.equal((await fetch(site.base + f)).status, 200, f);
    const games = await (await fetch(`${site.base}/pages/giochi.php`)).text();
    const map = await (await fetch(`${site.base}/sitemap.php`)).text();
    assert.ok(games.includes('inventato.html') && map.includes('pages/inventato.html'));
    assert.match(games, /data-id="inventato" data-kind="quiz"/);
});
