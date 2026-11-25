// tests/lupus-mostri.test.js — Lupus mystic monsters and new rules: bear, shaman, vampires, vampire hunter, ghosts,
// night timer, shared-phone decoys, translations
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { startSite, Client } = require('./helpers');

let site;

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

// all optional roles off, house roles off: only what a test asks for
const BARE = { seer: false, guard: false, witch: false, hunter: false, whore: false, jester: false, fisher: false };

/** Phone A (host) has P1..P(n-3), phone B has the last three. */
async function room(n, settings = {}) {
    try { site.db('DELETE FROM rate_limits'); } catch (e) { /* DB not created yet */ }
    const names = Array.from({ length: n }, (_, i) => 'P' + (i + 1));
    const a = await Phone.fresh();
    const code = (await a.post({ action: 'create', game: 'lupus', players: names.slice(0, n - 3), settings: { ...BARE, wolves_mode: 'fixed', wolves: 1, ...settings } })).json.code;
    const b = await Phone.fresh();
    await b.post({ action: 'join', code });
    for (const nm of names.slice(n - 3)) await b.post({ action: 'player_add', name: nm });
    const s = await a.state();
    const id = Object.fromEntries(s.players.map((p) => [p.name, p.id]));
    const mineA = names.slice(0, n - 3).map((x) => id[x]);
    const phoneOf = (pid) => (mineA.includes(pid) ? a : b);
    const game = () => JSON.parse(site.db('SELECT state FROM lupus_games WHERE room_id = (SELECT id FROM spia_rooms WHERE code = ?)', [code])[0].state);
    const setGame = (g) => site.db('UPDATE lupus_games SET state = ? WHERE room_id = (SELECT id FROM spia_rooms WHERE code = ?)', [JSON.stringify(g), code]);
    const as = (pid, body) => phoneOf(pid).post({ ...body, player_id: pid });
    const r = { a, b, code, id, names, phoneOf, game, setGame, as };
    r.P = (nm) => id[nm];
    /** Start, give exactly these roles (name => role, others villagers) and let everybody look at their card. */
    r.begin = async (roles) => {
        assert.equal((await a.post({ action: 'start' })).status, 200);
        const g = game();
        for (const pid of Object.keys(g.roles)) g.roles[pid] = 'villager';
        for (const [nm, role] of Object.entries(roles)) g.roles[id[nm]] = role;
        g.orig_roles = { ...g.roles };
        setGame(g);
        for (const pid of game().alive) await as(pid, { action: 'seen' });
        assert.equal(game().phase, 'night');
    };
    /** Every living player does a night move; `c` maps name => target name (or 0 / [t1, t2]). Killers default to the first villager-side player. */
    r.night = async (c = {}) => {
        const g = game();
        for (const pid of g.alive) {
            const nm = names.find((x) => id[x] === pid);
            const role = g.roles[pid];
            let target = c[nm] !== undefined ? (c[nm] === 0 ? 0 : id[c[nm]]) : 0;
            if (c[nm] === undefined && (role === 'wolf' || role === 'vampire')) {
                target = g.alive.find((x) => x !== pid && g.roles[x] !== role && g.roles[x] !== 'wolf' && g.roles[x] !== 'vampire');
            }
            const res = await as(pid, { action: 'night', target });
            assert.equal(res.status, 200, `${nm} (${role}) night: ${JSON.stringify(res.json)}`);
        }
    };
    return r;
}

test.before(async () => { site = await startSite(); });
test.after(() => site.stop());

test('every new option is off by default, bad values are cleaned, seating is kept', async () => {
    const r = await room(6, { bear: true });
    const s = (await r.a.state()).settings;
    for (const k of ['bear', 'shaman', 'vampire', 'vampire_hunter', 'ghost']) assert.equal(k === 'bear' ? s[k] : s[k], k === 'bear', k);
    assert.equal(s.night_sec, 0);
    await r.a.post({ action: 'settings', settings: { night_sec: 99, seating: [r.P('P3'), 'x', r.P('P1')] } });
    const s2 = (await r.a.state()).settings;
    assert.equal(s2.night_sec, 0, 'only 0, 30, 45, 60 are accepted');
    assert.ok(s2.seating.every((x) => Number.isInteger(x)), 'junk is cleaned');
    assert.ok(s2.seating.includes(r.P('P3')) && s2.seating.includes(r.P('P1')));
    assert.equal((await r.b.post({ action: 'settings', settings: { vampire: true } })).status, 403, 'only the host');
    await r.a.post({ action: 'settings', settings: { night_sec: 45 } });
    assert.equal((await r.a.state()).settings.night_sec, 45);
});

test('monsters are dealt only with enough players, and vampires scale with the table', async () => {
    const small = await room(6, { bear: true, shaman: true, vampire: true, vampire_hunter: true });
    await small.a.post({ action: 'start' });
    let counts = Object.values(small.game().roles).reduce((m, x) => ({ ...m, [x]: (m[x] || 0) + 1 }), {});
    assert.deepEqual(counts, { wolf: 1, bear: 1, shaman: 1, villager: 3 }, 'no vampires below 7 players');
    const mid = await room(8, { vampire: true, vampire_hunter: true });
    await mid.a.post({ action: 'start' });
    counts = Object.values(mid.game().roles).reduce((m, x) => ({ ...m, [x]: (m[x] || 0) + 1 }), {});
    assert.equal(counts.vampire, 1); assert.equal(counts.vampire_hunter, 1);
    const big = await room(12, { vampire: true });
    await big.a.post({ action: 'start' });
    assert.equal(Object.values(big.game().roles).filter((x) => x === 'vampire').length, 2, '12 players: 2 vampires');
    const onlyHunter = await room(8, { vampire_hunter: true });
    await onlyHunter.a.post({ action: 'start' });
    assert.ok(!Object.values(onlyHunter.game().roles).includes('vampire_hunter'), 'no vampires, no hunter of them');
});

test('bear: seating from the host, the server works out the neighbours and he growls only next to a killer', async () => {
    const r = await room(6, { bear: true });
    const order = ['P1', 'P3', 'P5', 'P2', 'P4', 'P6'].map((n) => r.P(n));
    assert.equal((await r.a.post({ action: 'settings', settings: { seating: order } })).status, 200);
    await r.begin({ P1: 'bear', P2: 'wolf' });
    assert.deepEqual(r.game().seating, order, 'the order is saved in the match');
    // P1 sits between P6 and P3: the wolf P2 is far away
    await r.night({ P2: 'P5' });
    let g = r.game();
    assert.equal(g.dawn.growl, false);
    assert.ok(!g.alive.includes(r.P('P5')));
    // the dead are skipped: with P3 dead the nearest living on P1's right is P2 only if everybody in between is gone
    g.phase = 'night'; g.day = 2; g.night = { acted: [], wolf: [], seer: [], guard: [], whore: [], fish: [], crow: [], white: [], cupid: null, vamp: [], stake: [], shaman: [] };
    g.alive = [r.P('P1'), r.P('P2'), r.P('P4'), r.P('P6')]; g.dead.push({ p: r.P('P3'), cause: 'wolves', day: 1, role: 'villager' });
    g.seating = [r.P('P1'), r.P('P3'), r.P('P5'), r.P('P2'), r.P('P4'), r.P('P6')];
    r.setGame(g);
    await r.night({ P2: 'P6' });
    g = r.game();
    assert.equal(g.dawn.growl, true, 'with P3 and P5 gone the wolf is the bear\'s nearest living neighbour');
    const st = (await r.b.state()).lupus;
    assert.equal(st.dawn.growl, true, 'the growl is public');
    assert.ok(!JSON.stringify(st).includes('"wolf"') || st.all_roles === null, 'but nobody learns who the killer is');
});

test('shaman: the dead player answers yes or no, only the shaman sees it', async () => {
    const r = await room(6, { shaman: true });
    await r.begin({ P1: 'shaman', P2: 'wolf' });
    await r.night({ P2: 'P5' });                       // P5 dies, no candidates to call the first night
    assert.equal((await r.as(r.P('P1'), { action: 'night', target: 0 })).status, 409, 'already acted');
    await r.a.post({ action: 'skip_day' });
    const nightView = (await r.a.state()).lupus.me.find((m) => m.player_id === r.P('P1'));
    assert.deepEqual(nightView.shaman_candidates, [r.P('P5')]);
    // calling someone who is alive is refused
    assert.equal((await r.as(r.P('P1'), { action: 'night', target: r.P('P3') })).status, 409);
    await r.night({ P1: 'P5', P2: 'P6' });
    // P5 (on phone B) is called; phone A never sees it
    const g = r.game();
    assert.equal(g.shaman.p, r.P('P5'));
    const sb = (await r.b.state()).lupus;
    assert.equal(sb.me.find((m) => m.player_id === r.P('P5')).summoned, true);
    assert.equal((await r.as(r.P('P4'), { action: 'shaman_reply', answer: true })).status, 409, 'not the called one');
    assert.equal((await r.as(r.P('P5'), { action: 'shaman_reply', answer: true })).status, 200);
    assert.equal((await r.as(r.P('P5'), { action: 'shaman_reply', answer: false })).status, 409, 'one answer only');
    const info = (await r.a.state()).lupus.me.find((m) => m.player_id === r.P('P1')).shaman_info;
    assert.deepEqual(info, { p: r.P('P5'), answer: true });
    const other = JSON.stringify((await r.b.state()).lupus);
    assert.ok(!other.includes('shaman_info') && !other.includes('shaman_candidates'), 'phone B never gets the shaman\'s data');
    const stateB = JSON.stringify((await r.b.state()).lupus.log);
    assert.ok(!stateB.includes('answer'));
});

test('vampires: the bite turns the victim after two nights, protection cures, a bite on a protected player fails', async () => {
    const r = await room(8, { vampire: true, guard: true });
    await r.begin({ P1: 'vampire', P2: 'wolf', P3: 'guard' });
    await r.night({ P1: 'P5', P2: 'P6', P3: 'P3' });
    let g = r.game();
    assert.deepEqual(Object.keys(g.bitten), [String(r.P('P5'))]);
    assert.equal(g.roles[r.P('P5')], 'villager', 'not a vampire yet');
    // the bitten player knows; nobody else's view says so
    const mine = (await r.a.state()).lupus.me.find((m) => m.player_id === r.P('P5'));
    assert.equal(mine.bitten, true);
    const rest = JSON.stringify((await r.b.state()).lupus);
    assert.ok(!rest.includes('"bitten"') && !rest.includes('vamp_votes'));
    await r.a.post({ action: 'skip_day' });
    await r.night({ P1: 'P4', P2: 'P7', P3: 'P1' });   // night 2: nobody protects P5
    assert.equal(r.game().roles[r.P('P5')], 'villager', 'still one night to go');
    await r.a.post({ action: 'skip_day' });
    await r.night({ P1: 'P4', P2: 'P8', P3: 'P3' });   // night 3: converted at dawn
    g = r.game();
    assert.equal(g.roles[r.P('P5')], 'vampire');
    assert.equal(g.turned[r.P('P5')].seen, false);
    const turned = (await r.a.state()).lupus.me.find((m) => m.player_id === r.P('P5'));
    assert.equal(turned.role, 'vampire'); assert.deepEqual(turned.vamps.sort(), [r.P('P1'), r.P('P5')].sort());
    assert.ok(!JSON.stringify((await r.b.state()).lupus).includes(`"${r.P('P5')}":"vampire"`));
    assert.equal((await r.as(r.P('P5'), { action: 'turn_seen' })).status, 200);

    // protection on the following night cures
    const c = await room(8, { vampire: true, guard: true });
    await c.begin({ P1: 'vampire', P2: 'wolf', P3: 'guard' });
    await c.night({ P1: 'P5', P2: 'P6', P3: 'P3' });
    await c.a.post({ action: 'skip_day' });
    await c.night({ P1: 'P4', P2: 'P7', P3: 'P5' });
    assert.ok(!(String(c.P('P5')) in c.game().bitten), 'the guard cured the bitten player');
    await c.a.post({ action: 'skip_day' });
    await c.night({ P1: 'P4', P2: 'P8', P3: 'P3' });
    assert.equal(c.game().roles[c.P('P5')], 'villager');

    // a bite on the player the guard protects the same night does nothing
    const d = await room(8, { vampire: true, guard: true });
    await d.begin({ P1: 'vampire', P2: 'wolf', P3: 'guard' });
    await d.night({ P1: 'P5', P2: 'P6', P3: 'P5' });
    assert.equal(Object.keys(d.game().bitten).length, 0, 'no bite');
});

test('vampire hunter: the stake kills a vampire, kills the hunter when the target is innocent, and works once', async () => {
    const right = await room(8, { vampire: true, vampire_hunter: true });
    await right.begin({ P1: 'vampire', P2: 'wolf', P3: 'vampire_hunter' });
    await right.night({ P1: 'P5', P2: 'P6', P3: 'P1' });
    let g = right.game();
    assert.ok(!g.alive.includes(right.P('P1')), 'the vampire is dead');
    assert.ok(g.alive.includes(right.P('P3')));
    assert.equal(g.dead.find((d) => d.p === right.P('P1')).cause, 'stake');
    assert.equal(g.stake_used, true);

    const wrong = await room(8, { vampire: true, vampire_hunter: true });
    await wrong.begin({ P1: 'vampire', P2: 'wolf', P3: 'vampire_hunter' });
    await wrong.night({ P1: 'P5', P2: 'P6', P3: 'P4' });
    g = wrong.game();
    assert.ok(!g.alive.includes(wrong.P('P3')), 'the hunter died');
    assert.ok(g.alive.includes(wrong.P('P4')) && g.alive.includes(wrong.P('P1')));
    assert.equal(g.dead.find((d) => d.p === wrong.P('P3')).cause, 'stake_miss');

    const keep = await room(8, { vampire: true, vampire_hunter: true });
    await keep.begin({ P1: 'vampire', P2: 'wolf', P3: 'vampire_hunter' });
    await keep.night({ P1: 'P5', P2: 'P6', P3: 0 });
    assert.equal(keep.game().stake_used, false, 'choosing nobody keeps the stake');
    await keep.a.post({ action: 'skip_day' });
    await keep.night({ P1: 'P4', P2: 'P7', P3: 'P1' });
    await keep.a.post({ action: 'skip_day' });
    const view = (await keep.a.state()).lupus.me.find((m) => m.player_id === keep.P('P3'));
    assert.equal(view.stake_used, true);
    const before = keep.game().alive.length;
    await keep.night({ P1: 'P4', P2: 'P8', P3: 'P4' });   // a second stake is only a dummy answer
    assert.ok(keep.game().alive.includes(keep.P('P4')) && keep.game().alive.includes(keep.P('P3')));
    assert.ok(keep.game().alive.length >= before - 2);
});

test('vampire victory: they win with the assassins dead and as many as the rest; the village needs them dead too', async () => {
    const r = await room(8, { vampire: true });
    await r.begin({ P1: 'vampire', P2: 'vampire', P3: 'wolf' });
    const g = r.game();
    // the wolf is gone already; 2 vampires and 2 villagers are left: not enough yet, the match goes on
    g.alive = [r.P('P1'), r.P('P2'), r.P('P4'), r.P('P5'), r.P('P6')];
    g.dead.push({ p: r.P('P3'), cause: 'lynch', day: 0, role: 'wolf' });
    r.setGame(g);
    await r.night({ P1: 'P4', P2: 'P4' });
    let s = r.game();
    assert.equal(s.status, 'play', 'no assassins, but the vampires are still outnumbered');
    assert.ok(!s.alive.includes(r.P('P4')) === false);
    // now two vampires and two others
    s.alive = [r.P('P1'), r.P('P2'), r.P('P5'), r.P('P6')];
    s.phase = 'night'; s.day = 3;
    s.night = { acted: [], wolf: [], seer: [], guard: [], whore: [], fish: [], crow: [], white: [], cupid: null, vamp: [], stake: [], shaman: [] };
    r.setGame(s);
    s = r.game();
    await r.as(r.P('P1'), { action: 'night', target: r.P('P5') });
    await r.as(r.P('P2'), { action: 'night', target: r.P('P5') });
    await r.as(r.P('P5'), { action: 'night', target: 0 });
    await r.as(r.P('P6'), { action: 'night', target: 0 });
    s = r.game();
    assert.equal(s.status, 'ended');
    assert.equal(s.result.winner, 'vampires');
    assert.equal(s.result.reason, 'vampires_parity');

    // the village does not win while a vampire is alive and the assassins are dead
    const v = await room(8, { vampire: true });
    await v.begin({ P1: 'vampire', P2: 'wolf' });
    const g2 = v.game();
    g2.alive = [v.P('P1'), v.P('P4'), v.P('P5'), v.P('P6'), v.P('P7')];
    v.setGame(g2);
    await v.night({ P1: 'P4' });
    assert.equal(v.game().status, 'play');
    const g3 = v.game();
    g3.alive = [v.P('P4'), v.P('P5'), v.P('P6'), v.P('P7')];   // the vampire is gone too
    g3.phase = 'night'; g3.day = 5; g3.bitten = {};
    g3.night = { acted: [], wolf: [], seer: [], guard: [], whore: [], fish: [], crow: [], white: [], cupid: null, vamp: [], stake: [], shaman: [] };
    v.setGame(g3);
    for (const nm of ['P4', 'P5', 'P6', 'P7']) { const x = await v.as(v.P(nm), { action: 'night', target: 0 }); assert.equal(x.status, 200, JSON.stringify(x.json)); }
    assert.equal(v.game().result.winner, 'village');
});

test('night timer: set by the host, ends the night on the server when it runs out; who did not choose skips', async () => {
    const r = await room(6, { night_sec: 30 });
    await r.begin({ P1: 'wolf' });
    let g = r.game();
    assert.ok(g.timer_ends > Date.now() / 1000 + 20 && g.timer_ends <= Date.now() / 1000 + 31, 'the server sets the deadline');
    assert.equal((await r.a.state()).lupus.timer_ends, g.timer_ends);
    await r.as(r.P('P1'), { action: 'night', target: r.P('P2') });   // only the wolf acts
    assert.equal(r.game().phase, 'night');
    g = r.game();
    g.timer_ends = Math.floor(Date.now() / 1000) - 1;
    r.setGame(g);
    await r.b.state();                                               // a poll runs the tick
    g = r.game();
    assert.equal(g.phase, 'day');
    assert.ok(!g.alive.includes(r.P('P2')), 'the wolf\'s choice still counts');
    assert.equal(g.timer_ends, null);

    const off = await room(6);
    await off.begin({ P1: 'wolf' });
    assert.equal(off.game().timer_ends, null, 'no timer by default');
});

test('shared phone: the witch\'s turn goes round every player of her phone and the others get no witch data', async () => {
    const r = await room(6, { witch: true });
    await r.begin({ P2: 'witch', P5: 'wolf' });
    await r.night({ P5: 'P3' });
    assert.equal(r.game().phase, 'witch');
    const sa = (await r.a.state()).lupus;
    assert.deepEqual(sa.secret_turn, { kind: 'witch', players: [r.P('P1'), r.P('P2'), r.P('P3')].filter((p) => sa.alive.includes(p)) });
    assert.ok(sa.secret_turn.players.length >= 2, 'the phone is passed to several players');
    for (const m of sa.me) {
        if (m.player_id === r.P('P2')) { assert.equal(m.witch_turn, true); assert.equal(m.victim, r.P('P3')); }
        else { assert.equal(m.witch_turn, undefined); assert.equal(m.victim, undefined, 'a decoy player gets no victim'); assert.equal(m.potions, undefined); }
    }
    const sb = (await r.b.state()).lupus;
    assert.equal(sb.secret_turn, null, 'the other phone sees nothing');
    assert.equal((await r.as(r.P('P1'), { action: 'witch', heal: true, kill: 0 })).status, 409, 'a decoy cannot act');
    assert.equal((await r.as(r.P('P2'), { action: 'witch', heal: true, kill: 0 })).status, 200);
    assert.equal(r.game().dawn.died.length, 0);
});

test('a player who turns into a vampire gets a secret turn that goes round the whole phone', async () => {
    const r = await room(8, { vampire: true });
    await r.begin({ P1: 'vampire', P2: 'wolf' });
    const g = r.game();
    g.bitten = { [r.P('P4')]: g.day - 2 };
    r.setGame(g);
    await r.night({ P1: 'P6', P2: 'P7' });
    const sa = (await r.a.state()).lupus;
    assert.equal(sa.secret_turn.kind, 'turn');
    assert.ok(sa.secret_turn.players.includes(r.P('P4')) && sa.secret_turn.players.length > 1);
    assert.equal((await r.b.state()).lupus.secret_turn, null);
});

test('ghosts: a dead player whispers one listed word a day, everybody sees it, free text is refused', async () => {
    const r = await room(6, { ghost: true });
    await r.begin({ P1: 'wolf' });
    await r.night({ P1: 'P4' });
    assert.equal(r.game().phase, 'day');
    const dead = r.P('P4');
    assert.equal((await r.as(dead, { action: 'haunt', word: 'boo' })).status, 200);
    assert.equal((await r.as(dead, { action: 'haunt', word: 'run' })).status, 409, 'once a day');
    assert.equal((await r.as(r.P('P5'), { action: 'haunt', word: 'boo' })).status, 409, 'the living cannot haunt');
    assert.equal((await r.as(r.P('P5'), { action: 'haunt', word: 'hello <b>' })).status, 409);
    for (const ph of [r.a, r.b]) assert.deepEqual((await ph.state()).lupus.haunts, [{ p: dead, day: 1, w: 'boo' }]);
    // the dead may haunt again on the next day, never with free text
    await r.a.post({ action: 'skip_day' });
    await r.night({ P1: 'P5' });
    assert.equal((await r.as(dead, { action: 'haunt', word: 'my own words' })).status, 409);
    assert.equal((await r.as(dead, { action: 'haunt', word: 'help' })).status, 200);
    const off = await room(6);
    await off.begin({ P1: 'wolf' });
    await off.night({ P1: 'P4' });
    assert.equal((await off.as(off.P('P4'), { action: 'haunt', word: 'boo' })).status, 409, 'switched off by default');
});

test('admin LIVE shows the new roles, bites and the shaman\'s call', async () => {
    const { makeAdmin } = require('./helpers');
    const r = await room(8, { vampire: true });
    await r.begin({ P1: 'vampire', P2: 'wolf' });
    await r.as(r.P('P1'), { action: 'night', target: r.P('P4') });
    const admin = await makeAdmin(site, 'lupus_mostri_admin');
    const live = (await admin.get('/api/spia.php?action=live')).json.rooms.find((x) => x.code === r.code);
    assert.equal(live.lupus.roles[r.P('P1')], 'vampire');
    assert.equal(live.lupus.night.vamp[r.P('P1')], r.P('P4'));
    assert.ok('bitten' in live.lupus && 'seating' in live.lupus);
    assert.equal(fs.readFileSync(path.join(__dirname, '..', 'lib', 'spia-admin.js'), 'utf8').includes('L.night.vamp'), true);
});

test('translations: the new texts exist in all five languages with the same keys and placeholders', () => {
    const ROOT = path.join(__dirname, '..');
    const win = { document: { currentScript: null, cookie: '' }, navigator: { languages: [] } };
    win.window = win;
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public/js/spia/i18n.js'), 'utf8'), win);
    const S = win.SpiaI18n.strings;
    const before = Object.fromEntries(Object.keys(S).map((l) => [l, new Set(Object.keys(S[l]))]));
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public/js/lupus/texts.js'), 'utf8'), { window: win });
    const added = Object.keys(S.en).filter((k) => !before.en.has(k));
    assert.ok(added.length > 50);
    const ph = (x) => (String(x).match(/\{\w+\}/g) || []).sort().join();
    for (const l of ['it', 'es', 'fr', 'de']) {
        assert.deepEqual(Object.keys(S[l]).filter((k) => !before[l].has(k)).sort(), added.slice().sort(), l + ' has the same new keys as English');
        for (const k of added) { assert.ok(String(S[l][k]).trim(), `${l}.${k} empty`); assert.equal(ph(S[l][k]), ph(S.en[k]), `${l}.${k} placeholders`); }
    }
    for (const l of ['it', 'en', 'es', 'fr', 'de']) {
        for (const role of ['bear', 'shaman', 'vampire', 'vampire_hunter']) {
            assert.ok(S[l]['lw_role_' + role], `${l} role name ${role}`);
            assert.ok(S[l]['lw_desc_' + role], `${l} role text ${role}`);
        }
        for (const w of ['boo', 'liar', 'trust', 'behind', 'run', 'silence', 'betrayal', 'help']) assert.ok(S[l]['lw_haunt_' + w], `${l} haunt word ${w}`);
    }
    const js = fs.readFileSync(path.join(ROOT, 'public/js/lupus/game.js'), 'utf8');
    for (const m of js.matchAll(/\bt\('(lw_[a-z_]+)'/g)) if (!m[1].endsWith('_')) assert.ok(m[1] in S.en && m[1] in S.it, 'game.js uses an unknown key ' + m[1]);
    const php = fs.readFileSync(path.join(ROOT, 'public/api/lupus_lib.php'), 'utf8');
    const words = php.match(/LUPUS_HAUNT_WORDS = \[([^\]]*)\]/)[1].match(/'(\w+)'/g).map((x) => x.slice(1, -1));
    for (const w of words) assert.ok(('lw_haunt_' + w) in S.en, w);
    assert.match(fs.readFileSync(path.join(ROOT, 'public/pages/lupus.html'), 'utf8'), /js\/lupus\/texts\.js\?v=\d{10}/);
});
