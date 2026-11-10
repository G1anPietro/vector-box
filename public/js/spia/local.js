// public/js/spia/local.js
// Offline "one phone" game. Same rules and the same state shape as api/spia.php,
// so the UI does not care which one it talks to. Saved in localStorage.
window.SpiaLocal = (() => {
    'use strict';
    const KEY = 'spia_local';
    const MAX_PLAYERS = 20;
    let data = { locations: {}, categories: [] };
    let g = null;

    const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } };
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(g)); } catch (e) { /* private mode */ } };
    g = load();

    // Unbiased random integer in [0, n)
    const rnd = (n) => {
        const max = Math.floor(0x100000000 / n) * n;
        const a = new Uint32Array(1);
        do { crypto.getRandomValues(a); } while (a[0] >= max);
        return a[0] % n;
    };
    const between = (min, max) => min + rnd(max - min + 1);
    const shuffle = (arr) => {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
        return a;
    };
    const clean = (s, max) => String(s || '').replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
    const fail = (code) => { const e = new Error(code); e.code = code; throw e; };

    function setData(loc) {
        data = { locations: {}, categories: loc.categories.map((c) => c.id) };
        for (const l of loc.locations) {
            data.locations[l.id] = { cat: l.cat, roles: l.roles.length, adult: l.roles.map((r, i) => (r.adult ? i : -1)).filter((i) => i >= 0) };
        }
    }

    function defaults() {
        return {
            spy_mode: 'fixed', spies: 1, spy_min: 1, spy_max: 2, show_count: false,
            vote: true, guess: true, timer: false, timer_min: 8, scores: false,
            spy_list: true, spy_hint: false, no_repeat: true, no_repeat_n: 5,
            packs: data.categories.slice(), custom: false, custom_locations: [], family: false,
        };
    }

    function sanitize(input, base) {
        const s = { ...defaults(), ...(base || {}) };
        const inp = input || {};
        const int = (v, min, max, d) => (Number.isFinite(+v) && v !== '' && v !== null ? Math.max(min, Math.min(max, Math.trunc(+v))) : d);
        if (inp.spy_mode === 'fixed' || inp.spy_mode === 'range') s.spy_mode = inp.spy_mode;
        s.spies = int(inp.spies ?? s.spies, 0, MAX_PLAYERS, 1);
        s.spy_min = int(inp.spy_min ?? s.spy_min, 0, MAX_PLAYERS, 0);
        s.spy_max = int(inp.spy_max ?? s.spy_max, 0, MAX_PLAYERS, 2);
        if (s.spy_max < s.spy_min) s.spy_max = s.spy_min;
        for (const k of ['show_count', 'vote', 'guess', 'timer', 'scores', 'spy_list', 'spy_hint', 'no_repeat', 'custom', 'family']) {
            if (k in inp) s[k] = !!inp[k];
        }
        s.timer_min = int(inp.timer_min ?? s.timer_min, 1, 30, 8);
        s.no_repeat_n = int(inp.no_repeat_n ?? s.no_repeat_n, 1, 15, 5);
        if (Array.isArray(inp.packs)) s.packs = data.categories.filter((c) => inp.packs.includes(c));
        if (Array.isArray(inp.custom_locations)) {
            s.custom_locations = inp.custom_locations.slice(0, 30).map((l) => ({
                name: clean(l && l.name, 40),
                roles: (Array.isArray(l && l.roles) ? l.roles : []).slice(0, 12).map((r) => clean(r, 40)).filter(Boolean),
            })).filter((l) => l.name && l.roles.length);
        }
        return s;
    }

    const pool = (s) => [
        ...Object.keys(data.locations).filter((id) => s.packs.includes(data.locations[id].cat) && !(s.family && data.locations[id].cat === 'adult')),
        ...(s.custom ? s.custom_locations.map((_, i) => 'c' + i) : []),
    ];
    /** Role indexes that may be dealt here; family mode drops tagged roles (same rule as the server). */
    const rolePool = (loc, s) => {
        if (/^c\d+$/.test(loc)) return [...Array((s.custom_locations[+loc.slice(1)] || { roles: [] }).roles.length).keys()];
        const l = data.locations[loc];
        if (!l) return [];
        const all = [...Array(l.roles).keys()];
        if (!s.family) return all;
        const clean = all.filter((i) => !l.adult.includes(i));
        return clean.length ? clean : all;
    };
    const pick = (list) => list[rnd(list.length)];
    const now = () => Math.floor(Date.now() / 1000);
    const players = () => g.players;
    const alive = (r) => Object.keys(r.assign).map(Number).filter((id) => !r.assign[id].out && players().some((p) => p.id === id));
    const aliveSpies = (r) => alive(r).filter((id) => r.assign[id].spy).length;
    const log = (r, ev) => r.log.push(ev);

    function create(settings, names) {
        g = { settings: sanitize(settings, {}), players: [], nextId: 1, round: null, roundCount: 0, recent: [], version: 1 };
        for (const n of names || []) { try { addPlayer(n); } catch (e) { /* skip duplicates */ } }
        save();
        return view();
    }

    function addPlayer(raw) {
        const name = clean(raw, 24);
        if (!name) fail('name_empty');
        if (g.players.length >= MAX_PLAYERS) fail('room_full');
        if (g.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) fail('name_taken');
        const p = { id: g.nextId++, name, score: 0 };
        g.players.push(p);
        const r = g.round;
        if (r && r.status === 'play') {
            const free = freeRoles(r);
            let spy = false;
            if (r.rules.late_spy_max > r.spy_count && r.deal_players > 0) spy = between(1, r.deal_players) <= Math.max(1, r.spy_count);
            r.assign[p.id] = spy ? { spy: true, role: null, seen: false, out: null }
                : { spy: false, role: pick(free.length ? free : rolePool(r.location_id, r.rules)), seen: false, out: null };
            if (spy) r.spy_count++;
            log(r, { t: 'join', p: p.id });
        }
    }

    function freeRoles(r) {
        const taken = Object.values(r.assign).filter((a) => a.role !== null).map((a) => a.role);
        return rolePool(r.location_id, r.rules).filter((i) => !taken.includes(i));
    }

    function start() {
        const s = sanitize({}, g.settings);
        if (g.players.length < 3) fail('need_players');
        const p = pool(s);
        if (!p.length) fail('no_locations');
        let cand = p;
        if (s.no_repeat) {
            const recent = g.recent.slice(-s.no_repeat_n);
            const fresh = p.filter((id) => !recent.includes(id));
            if (fresh.length) cand = fresh;
        }
        const loc = cand[rnd(cand.length)];
        const n = g.players.length;
        const spies = s.spy_mode === 'range'
            ? between(Math.min(s.spy_min, n), Math.max(Math.min(s.spy_min, n), Math.min(s.spy_max, n)))
            : Math.min(s.spies, n);
        const visible = s.spy_mode === 'fixed' || s.show_count;
        const rules = {
            vote: s.vote, guess: s.guess, scores: s.scores, timer: s.timer, timer_min: s.timer_min,
            spy_hint: s.spy_hint, spy_list: s.spy_list, count_visible: visible,
            late_spy_max: visible ? 0 : s.spy_max, custom_locations: s.custom_locations, family: s.family,
        };
        const order = shuffle(g.players.map((x) => x.id));
        const spyIds = order.slice(0, spies);
        const allowed = rolePool(loc, s);
        let roles = shuffle(allowed);
        const assign = {};
        for (const pl of g.players) {
            if (spyIds.includes(pl.id)) assign[pl.id] = { spy: true, role: null, seen: false, out: null };
            else assign[pl.id] = { spy: false, role: roles.length ? roles.pop() : pick(allowed), seen: false, out: null };
        }
        g.roundCount++;
        g.recent = [...g.recent, loc].slice(-15);
        g.round = {
            number: g.roundCount, location_id: loc, pool: p, rules, spy_count: spies, deal_players: n,
            status: 'play', result: null, vote: { no: 0, open: false, forced: false, votes: {} },
            timer_ends: null, starter: g.players[rnd(n)].id, log: [], assign, timer_started: false,
        };
    }

    function end(winner, reason, extra = {}) {
        const r = g.round;
        const spies = Object.keys(r.assign).map(Number).filter((id) => r.assign[id].spy);
        if (winner === 'spies' && !spies.length) winner = 'none';
        if (r.rules.scores && (winner === 'spies' || winner === 'civilians')) {
            for (const [id, a] of Object.entries(r.assign)) {
                const p = g.players.find((x) => x.id === +id);
                if (!p) continue;
                if (winner === 'civilians' && !a.spy) p.score += 1;
                if (winner === 'spies' && a.spy && !a.out) p.score += 2 + (extra.guesser === +id ? 1 : 0);
            }
        }
        const roles = {};
        for (const [id, a] of Object.entries(r.assign)) roles[id] = a.spy ? null : a.role;
        r.status = 'ended';
        r.vote.open = false;
        r.timer_ends = null;
        r.result = { winner, reason, location_id: r.location_id, spies, roles, ...extra };
    }

    function resolveVote() {
        const r = g.round;
        const forced = r.vote.forced;
        r.vote.open = false;
        r.vote.forced = false;
        const counts = {};
        for (const tgt of Object.values(r.vote.votes)) counts[tgt] = (counts[tgt] || 0) + 1;
        const tally = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        if (!tally.length || (tally.length > 1 && tally[0][1] === tally[1][1])) {
            log(r, { t: 'tie', vote: r.vote.no, counts });
            if (forced) end('spies', 'final_tie');
            return;
        }
        const target = +tally[0][0];
        if (target === 0) {
            const left = aliveSpies(r);
            log(r, { t: 'no_spies', vote: r.vote.no, counts });
            end(left === 0 ? 'civilians' : 'spies', left === 0 ? 'no_spies_right' : 'no_spies_wrong');
            return;
        }
        const isSpy = r.assign[target].spy;
        r.assign[target].out = 'vote';
        log(r, { t: 'out', p: target, spy: isSpy, why: 'vote', vote: r.vote.no, counts });
        if (!isSpy) end('spies', 'innocent_out', { out: target });
        else if (forced) end('civilians', 'final_caught', { out: target });
        else if (r.rules.count_visible && aliveSpies(r) === 0) end('civilians', 'all_caught');
    }

    function maybeCloseVote() {
        const r = g.round;
        if (r.vote.open && alive(r).every((id) => id in r.vote.votes)) resolveVote();
    }

    function openVote(forced) {
        const r = g.round;
        r.vote = { no: r.vote.no + 1, open: true, forced, votes: {} };
    }

    function tick() {
        const r = g && g.round;
        if (r && r.status === 'play' && r.rules.timer && r.timer_ends && now() >= r.timer_ends && !r.vote.open) {
            r.timer_ends = null;
            if (r.rules.vote) openVote(true);
            log(r, { t: 'time_up' });
            g.version++;
            save();
        }
    }

    function act(action, d = {}) {
        if (!g) fail('gone');
        const r = g.round;
        const playing = r && r.status === 'play';
        const own = (id) => { if (!g.players.some((p) => p.id === +id)) fail('not_your_player'); return +id; };
        switch (action) {
            case 'leave': g = null; try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } return { success: true, left: true };
            case 'player_add': addPlayer(d.name); break;
            case 'player_remove': {
                const id = own(d.player_id);
                g.players = g.players.filter((p) => p.id !== id);
                if (playing && r.assign[id] && !r.assign[id].out) { r.assign[id].out = 'left'; maybeCloseVote(); }
                break;
            }
            case 'settings': g.settings = sanitize(d.settings, g.settings); break;
            case 'start': if (playing) fail('round_running'); start(); break;
            case 'end': if (!playing) fail('no_round'); end('host', 'host_ended'); break;
            case 'seen': {
                if (!r) fail('no_round');
                const id = own(d.player_id);
                if (r.assign[id]) r.assign[id].seen = true;
                if (playing && r.rules.timer && !r.timer_started && alive(r).every((x) => r.assign[x].seen)) {
                    r.timer_started = true;
                    r.timer_ends = now() + 60 * r.rules.timer_min;
                    log(r, { t: 'timer' });
                }
                break;
            }
            case 'vote_call':
                if (!playing || !r.rules.vote) fail('no_round');
                if (r.vote.open) fail('vote_open');
                openVote(false);
                log(r, { t: 'vote', vote: r.vote.no });
                break;
            case 'vote': {
                if (!playing || !r.vote.open) fail('no_vote');
                const id = own(d.player_id);
                const al = alive(r);
                if (!al.includes(id)) fail('you_are_out');
                const tgt = +d.target;
                if (tgt !== 0 && (!al.includes(tgt) || tgt === id)) fail('bad_target');
                r.vote.votes[id] = tgt;
                maybeCloseVote();
                break;
            }
            case 'vote_close': if (!playing || !r.vote.open) fail('no_vote'); resolveVote(); break;
            case 'guess': {
                if (!playing || !r.rules.guess) fail('no_round');
                const id = own(d.player_id);
                if (!alive(r).includes(id)) fail('you_are_out');
                if (!r.assign[id].spy) return { success: true, not_spy: true };
                if (!r.pool.includes(d.location_id)) fail('bad_target');
                if (d.location_id === r.location_id) {
                    log(r, { t: 'guess', p: id, loc: d.location_id, ok: true });
                    end('spies', 'guess_right', { guesser: id, guess: d.location_id });
                } else {
                    r.assign[id].out = 'guess';
                    log(r, { t: 'guess', p: id, loc: d.location_id, ok: false });
                    if (r.rules.count_visible && aliveSpies(r) === 0) end('civilians', 'all_caught');
                    else maybeCloseVote();
                }
                break;
            }
            case 'reset_scores': g.players.forEach((p) => { p.score = 0; }); break;
            default: fail('unknown_action');
        }
        g.version++;
        save();
        return view();
    }

    function view() {
        if (!g) return null;
        tick();
        const s = sanitize({}, g.settings);
        const v = {
            success: true, local: true, now: now(), code: null, version: g.version, device_id: 1, is_host: true,
            settings: s,
            devices: [{ id: 1, online: true, host: true, players: g.players.map((p) => p.id) }],
            players: g.players.map((p) => ({ id: p.id, name: p.name, device_id: 1, score: p.score })),
            round: null, cards: [],
        };
        const r = g.round;
        if (!r) return v;
        const ids = Object.keys(r.assign).map(Number);
        const allSeen = alive(r).every((id) => r.assign[id].seen);
        const hint = r.rules.spy_hint ? (/^c\d+$/.test(r.location_id) ? 'custom' : data.locations[r.location_id].cat) : null;
        v.round = {
            number: r.number, status: r.status,
            rules: { vote: r.rules.vote, guess: r.rules.guess, scores: r.rules.scores, timer: r.rules.timer, timer_min: r.rules.timer_min,
                spy_hint: r.rules.spy_hint, spy_list: r.rules.spy_list, count_visible: r.rules.count_visible },
            custom_locations: r.rules.custom_locations,
            spy_count: r.rules.count_visible ? r.spy_count : null,
            pool: r.pool, all_seen: allSeen, starter: allSeen ? r.starter : null, timer_ends: r.timer_ends,
            vote: { open: r.vote.open, no: r.vote.no, forced: r.vote.forced, voted: r.vote.open ? Object.keys(r.vote.votes).map(Number) : [] },
            in_round: ids,
            out: ids.filter((id) => r.assign[id].out && r.assign[id].out !== 'left'),
            seen: ids.filter((id) => r.assign[id].seen),
            log: r.log, result: r.result,
        };
        for (const p of g.players) {
            const a = r.assign[p.id];
            if (!a) continue;
            const card = { player_id: p.id, seen: a.seen, out: a.out };
            if (a.spy) Object.assign(card, { spy: true, hint });
            else Object.assign(card, { spy: false, location_id: r.location_id, role: a.role });
            v.cards.push(card);
        }
        return v;
    }

    return {
        setData, defaults, create, act,
        state: () => view(),
        active: () => !!g,
    };
})();
