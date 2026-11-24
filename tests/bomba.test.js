// tests/bomba.test.js — "The bomb" rooms: the bank of prompts, the HIDDEN fuse (never in any response), passing rules, the blast
// takes a life, elimination and the winner, new rounds, one shared phone, leaving, host tools, the admin LIVE view,
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
const BANK = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib', 'bomba-q.json'), 'utf8'));

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
    const code = (await a.post({ action: 'create', game: 'bomba', players: ['P1'], settings })).json.code;
    const phones = [a];
    for (let i = 2; i <= n; i++) { const p = await Phone.fresh(); await p.post({ action: 'join', code }); await p.post({ action: 'player_add', name: 'P' + i }); phones.push(p); }
    const s = await a.state();
    const id = Object.fromEntries(s.players.map((p) => [p.name, p.id]));
    const where = 'room_id = (SELECT id FROM spia_rooms WHERE code = ?)';
    const game = () => JSON.parse(site.db(`SELECT state FROM bomba_games WHERE ${where}`, [code])[0].state);
    const setGame = (g) => site.db(`UPDATE bomba_games SET state = ? WHERE ${where}`, [JSON.stringify(g), code]);
    return { a, phones, code, id, game, setGame };
}
const who = (r, pid) => r.phones[Number(Object.keys(r.id).find((k) => r.id[k] === pid).slice(1)) - 1];
const pass = (r, from, to) => who(r, from).post({ action: 'pass', player_id: from, to });
/** Makes the (secret) fuse burn out: the next request explodes the bomb. */
const burn = (r) => { const g = r.game(); g.fuse_at = Date.now() / 1000 - 1; r.setGame(g); };
const skipBoom = async (r) => { const g = r.game(); g.next_at = Date.now() / 1000 - 1; r.setGame(g); return (await r.a.state()).bomba; };

test('the bank: at least 60 categories and 40 syllables, five languages each, no repeats', () => {
    assert.ok(BANK.cat.length >= 60 && BANK.syl.length >= 40);
    for (const k of ['cat', 'syl']) {
        for (const [i, row] of BANK[k].entries()) {
            assert.equal(row.length, 5, `${k} ${i}`);
            assert.ok(row.every((x) => typeof x === 'string' && x.trim().length >= 2), `${k} ${i}`);
        }
        assert.equal(new Set(BANK[k].map((r) => r[1])).size, BANK[k].length, k + ' English texts are unique');
    }
    assert.ok(BANK.syl.every((r) => r.every((x) => /^[A-ZÄÖÜ]{2,3}$/.test(x))), 'syllables are 2-3 capitals');
});

test('migration V50 created bomba_games; settings are cleaned; three players are needed', async () => {
    await fetch(`${site.base}/api/rooms.php`);
    assert.ok(site.db('PRAGMA user_version')[0].user_version >= 50);
    const a = await Phone.fresh();
    await a.post({ action: 'create', game: 'bomba', players: ['A', 'B'], settings: { lives: 9, kind: 'x', fuse: 3 } });
    const s = await a.state();
    assert.equal(s.game, 'bomba');
    assert.deepEqual(s.settings, { lives: 3, kind: 'mix', fuse: 45 }, 'bad values cleaned');
    assert.equal((await a.post({ action: 'start' })).status, 409, 'two players are not enough');
    assert.equal((await a.post({ action: 'settings', settings: { lives: 5, kind: 'syl', fuse: 25 } })).status, 200);
    assert.deepEqual((await a.state()).settings, { lives: 5, kind: 'syl', fuse: 25 });
});

test('the fuse is secret: it is drawn between 12 s and the maximum and never appears in any response', async () => {
    const r = await room({ fuse: 25 }, 4);
    const t0 = Date.now() / 1000;
    assert.equal((await r.a.post({ action: 'start' })).status, 200);
    const g = r.game();
    assert.ok(g.fuse_at - t0 >= 11.9 && g.fuse_at - t0 <= 25.5, 'fuse in range');
    const admin = await makeAdmin(site, 'bomba_admin_fuse');
    const bodies = [];
    for (const ph of r.phones) bodies.push((await ph.get('state')).text);
    bodies.push((await admin.get('/api/spia.php?action=live')).text);
    await pass(r, g.holder, r.game().order.find((p) => p !== g.holder));
    for (const ph of r.phones) bodies.push((await ph.get('state')).text);
    const fuse = String(g.fuse_at);
    for (const b of bodies) {
        assert.ok(!/fuse_at|deadline|started|"left"|"time"/.test(b), 'no timing key');
        assert.ok(!b.includes(fuse) && !b.includes(fuse.slice(0, 12)), 'the fuse value is nowhere');
    }
    const P = (await r.a.state()).bomba;
    assert.ok(!('fuse_at' in P) && !('next_at' in P));
    for (const l of ['it', 'en', 'es', 'fr', 'de']) assert.ok(P.q.text[l].length >= 2, l);
});

test('passing: only the holder, to a living player who is not themselves; invalid passes are refused', async () => {
    const r = await room({}, 4);
    await r.a.post({ action: 'start' });
    let g = r.game();
    const h = g.holder, others = g.order.filter((p) => p !== h);
    assert.equal((await pass(r, others[0], others[1])).status, 409, 'not the holder');
    assert.equal((await pass(r, h, h)).status, 409, 'not to yourself');
    assert.equal((await pass(r, h, 999999)).status, 409, 'not to a stranger');
    assert.equal((await who(r, h).post({ action: 'pass', player_id: others[0], to: others[1] })).status, 403, 'not your player');
    assert.equal(r.game().holder, h, 'nothing changed');
    assert.equal((await pass(r, h, others[0])).status, 200);
    g = r.game(); assert.equal(g.holder, others[0]); assert.equal(g.stats[h].passes, 1);
    for (const ph of r.phones) {
        const P = (await ph.state()).bomba;
        assert.equal(P.holder, others[0]); assert.equal(P.passes, 1);
        assert.ok(P.events.some((e) => e.t === 'pass' && e.p === h && e.to === others[0]));
    }
    const mineHolder = (await who(r, others[0]).state()).bomba.me;
    assert.equal(mineHolder[0].holder, true);
});

test('the fuse burns out: the holder loses a life, a new round starts with a new fuse and prompt; the host can skip the wait', async () => {
    const r = await room({ lives: 3 }, 3);
    await r.a.post({ action: 'start' });
    const g0 = r.game(); const h = g0.holder;
    burn(r);
    const P = (await r.a.state()).bomba;
    assert.equal(P.phase, 'boom'); assert.equal(P.boom.p, h); assert.equal(P.boom.lives, 2); assert.equal(P.lives[h], 2);
    assert.equal(P.holder, null); assert.ok(P.events.some((e) => e.t === 'boom' && e.p === h));
    assert.equal(r.game().fuse_at, null, 'no fuse between rounds');
    const late = await pass(r, h, g0.order.find((p) => p !== h));
    assert.equal(late.status, 409, 'too late: the bomb already blew');
    assert.equal((await r.phones[1].post({ action: 'next' })).status, 403);
    assert.equal((await r.a.post({ action: 'next' })).status, 200);
    const g1 = r.game();
    assert.equal(g1.phase, 'armed'); assert.equal(g1.round, 2); assert.ok(g1.fuse_at > Date.now() / 1000);
    assert.notEqual(g1.holder, h, 'the next living player gets it');
    await skipBoom(r);   // not in the boom phase: nothing happens
    burn(r); await r.a.state();
    const P2 = await skipBoom(r);
    assert.equal(P2.round, 3);
});

test('elimination and the winner: at 0 lives a player is out, the last one with lives wins', async () => {
    const r = await room({ lives: 1 }, 3);
    await r.a.post({ action: 'start' });
    const order = r.game().order;
    const first = r.game().holder;
    burn(r);
    let P = (await r.a.state()).bomba;
    assert.equal(P.boom.out, true); assert.ok(!P.alive.includes(first)); assert.equal(P.alive.length, 2);
    assert.ok(P.events.some((e) => e.t === 'out' && e.p === first));
    P = await skipBoom(r);
    assert.ok(P.holder !== first && P.alive.includes(P.holder), 'the bomb goes to a living player');
    assert.equal((await pass(r, P.holder, first)).status, 409, 'not to an eliminated player');
    burn(r);
    P = (await r.a.state()).bomba;
    assert.equal(P.status, 'ended'); assert.equal(P.result.reason, 'last');
    const winner = P.alive[0];
    assert.equal(P.result.winner, winner); assert.equal(P.result.rows[0].p, winner);
    assert.equal(P.result.rows.length, 3); assert.ok(order.every((p) => P.result.rows.some((x) => x.p === p)));
    assert.equal((await r.a.post({ action: 'start' })).status, 200, 'a new match');
    assert.equal((await r.a.state()).bomba.match, 2);
    assert.equal(Object.values(r.game().lives).every((n) => n === 1), true);
});

test('one phone for everybody: the phone shows who holds it and the holder passes from the same device', async () => {
    const a = await Phone.fresh();
    await a.post({ action: 'create', game: 'bomba', players: ['X', 'Y', 'Z'], settings: { lives: 1 } });
    assert.equal((await a.post({ action: 'start' })).status, 200);
    let s = await a.state();
    assert.equal(s.bomba.me.length, 3);
    const id = Object.fromEntries(s.players.map((p) => [p.name, p.id]));
    const h = s.bomba.holder;
    assert.ok(s.bomba.me.find((m) => m.player_id === h).holder);
    const to = Object.values(id).find((p) => p !== h);
    assert.equal((await a.post({ action: 'pass', player_id: h, to })).status, 200);
    s = await a.state(); assert.equal(s.bomba.holder, to);
    assert.equal((await a.post({ action: 'pass', player_id: h, to: h })).status, 409, 'the old holder cannot pass any more');
});

test('prompt kinds: only categories, only syllables, or a mix; prompts are not repeated until the pile is used', async () => {
    const c = await room({ kind: 'cat' });
    await c.a.post({ action: 'start' });
    for (let i = 0; i < 8; i++) { assert.equal(c.game().q.k, 'cat'); burn(c); await c.a.state(); await skipBoom(c); }
    const s = await room({ kind: 'syl', lives: 5 });
    await s.a.post({ action: 'start' });
    const seen = new Set();
    for (let i = 0; i < 8; i++) { const g = s.game(); assert.equal(g.q.k, 'syl'); assert.ok(!seen.has(g.q.i)); seen.add(g.q.i); burn(s); await s.a.state(); await skipBoom(s); }
    const m = await room({ kind: 'mix', lives: 5 });
    await m.a.post({ action: 'start' });
    const kinds = new Set();
    for (let i = 0; i < 30; i++) { kinds.add(m.game().q.k); burn(m); await m.a.state(); await skipBoom(m); }
    assert.deepEqual([...kinds].sort(), ['cat', 'syl']);
});

test('leaving: the holder leaving hands the bomb on; fewer than 2 players ends the match; the host can end it, others cannot', async () => {
    const r = await room({ lives: 5 }, 4);
    await r.a.post({ action: 'start' });
    const g = r.game();
    const holderPhone = who(r, g.holder);
    if (holderPhone === r.a) { await r.phones[1].post({ action: 'leave' }); } else await holderPhone.post({ action: 'leave' });
    const P = (await r.a.state()).bomba;
    assert.equal(P.status, 'play');
    if (holderPhone !== r.a) assert.notEqual(P.holder, g.holder);
    assert.ok(P.holder === null || P.alive.includes(P.holder));

    const e = await room({}, 3);
    await e.a.post({ action: 'start' });
    assert.equal((await e.phones[1].post({ action: 'end' })).status, 403);
    assert.equal((await e.a.post({ action: 'end' })).status, 200);
    assert.equal((await e.a.state()).bomba.result.reason, 'host_ended');

    const f = await room({}, 3);
    await f.a.post({ action: 'start' });
    await f.phones[1].post({ action: 'leave' });
    assert.equal((await f.a.state()).bomba.status, 'play', 'two players are still enough');
    await f.phones[2].post({ action: 'leave' });
    assert.equal((await f.a.state()).bomba.result.reason, 'too_few');
});

test('the admin LIVE view shows who holds the bomb and the lives, never the fuse; a normal visitor cannot see it', async () => {
    const r = await room();
    await r.a.post({ action: 'start' });
    const g = r.game();
    const admin = await makeAdmin(site, 'bomba_admin');
    const live = (await admin.get('/api/spia.php?action=live')).json.rooms.find((x) => x.code === r.code);
    assert.equal(live.game, 'bomba');
    assert.equal(live.bomba.phase, 'armed'); assert.equal(live.bomba.holder, g.holder);
    assert.ok(live.bomba.prompt && live.bomba.lives[g.holder] === 3);
    assert.ok(!JSON.stringify(live).includes('fuse_at') && !JSON.stringify(live).includes(String(g.fuse_at).slice(0, 12)));
    assert.equal((await new Client(site).get('/api/spia.php?action=live')).status !== 200, true);
    assert.match((await admin.get('/api/spia.php?action=ext')).text, /bomba/i, 'the admin script knows the game');
});

test('translations: the five languages have the same keys, every key the game uses exists, the help and intro texts are complete', () => {
    const dict = { it: {}, en: {}, es: {}, fr: {}, de: {} };
    const win = { SpiaI18n: { strings: dict } };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'bomba', 'texts.js'), 'utf8'), { window: win });
    const keys = Object.keys(dict.en);
    assert.ok(keys.length > 70);
    for (const l of ['it', 'es', 'fr', 'de']) {
        assert.deepEqual(Object.keys(dict[l]).sort(), keys.slice().sort(), l + ' has the same keys as English');
        for (const k of keys) assert.ok(String(dict[l][k]).trim(), `${l}.${k} is empty`);
    }
    const placeholders = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
    for (const k of keys) for (const l of ['it', 'es', 'fr', 'de']) assert.equal(placeholders(dict[l][k]), placeholders(dict.en[k]), `${l}.${k} placeholders`);
    const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'bomba', 'game.js'), 'utf8');
    for (const m of js.matchAll(/'(bm_[a-z_]+)'/g)) if (!m[1].endsWith('_')) assert.ok(keys.includes(m[1]), 'game.js uses an unknown key ' + m[1]);
    for (const k of ['cat', 'syl', 'mix']) assert.ok(keys.includes('bm_kind_' + k));
    for (const k of ['last', 'host_ended', 'too_few']) assert.ok(keys.includes('bm_reason_' + k));
    for (const k of ['start', 'round', 'pass', 'boom', 'out', 'left', 'end']) assert.ok(keys.includes('bm_ev_' + k), k);
    for (const k of ['bm_title', 'bm_tagline', 'bm_one_phone_note', 'bm_need_three', 'bm_start', 'bm_new_match', 'bm_settings_next_match', 'intro_bm_1', 'intro_bm_2_t', 'intro_bm_3',
        'help_bm_basics_t', 'help_bm_rounds', 'help_bm_lives', 'help_bm_host', 'help_bm_settings', 'err_need_players_bomba', 'err_not_holder', 'err_bad_target']) assert.ok(keys.includes(k), k);
    for (const m of fs.readFileSync(path.join(ROOT, 'public', 'js', 'spia', 'app.js'), 'utf8').matchAll(/(?:title|tagline|note|need): '(bm_\w+)'/g)) assert.ok(keys.includes(m[1]), m[1]);
});

test('the page is served with its files, respects reduced motion, and is listed in the games and the sitemap', async () => {
    const html = await (await fetch(`${site.base}/pages/bomba.html`)).text();
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'no inline scripts');
    assert.match(html, /data-game="bomba"/);
    for (const f of ['/js/bomba/game.js', '/js/bomba/texts.js', '/css/bomba.css', '/assets/bomba/icon.svg', '/assets/bomba/manifest.json']) assert.equal((await fetch(site.base + f)).status, 200, f);
    assert.match(fs.readFileSync(path.join(ROOT, 'public', 'css', 'bomba.css'), 'utf8'), /prefers-reduced-motion: reduce[^}]*bm-spark/);
    const games = await (await fetch(`${site.base}/pages/giochi.php`)).text();
    const map = await (await fetch(`${site.base}/sitemap.php`)).text();
    assert.ok(games.includes('bomba.html') && map.includes('pages/bomba.html'));
});
