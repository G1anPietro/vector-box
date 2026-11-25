// public/js/lupus/game.js
// Lupus (werewolf) screens. Runs inside public/js/spia/app.js, which owns rooms, phones,
// settings, help and the render loop; this file only draws the match itself.
// At night EVERY player gets a screen with a choice (plain roles get a dummy question),
// so nobody can tell roles apart by who is busy with their phone.
window.LupusGame = (() => {
    'use strict';
    let C = null;
    const NOBODY = 0;

    const G = () => C.state.lupus;
    const t = (k, v) => C.t(k, v);
    const h = (...a) => C.h(...a);
    const roleName = (r) => t('lw_role_' + r);
    const meOf = (pid) => G().me.find((m) => m.player_id === pid);
    const isAlive = (pid) => G().alive.includes(pid);
    const shared = () => C.myPlayers().length > 1;
    const names = (ids) => ids.map((id) => C.pname(id)).join(', ');
    const ICON = {
        wolf: '🐺', white_wolf: '🐺', seer: '🔮', guard: '🛡️', witch: '🧪', hunter: '🏹', villager: '🏠', whore: '🌹', jester: '🃏', fisher: '🎣',
        judge: '⚖️', cupid: '💘', medium: '🕯️', minion: '😈', mayor: '🎖️', crow: '🐦‍⬛', elder: '🧓', mason: '🔨',
        bear: '🐻', shaman: '🪘', vampire: '🧛', vampire_hunter: '🪵',
    };
    const roleIcon = (r) => (ICON[r] || '') + ' ';
    // players needed before the server deals these roles (mirrors LUPUS_ROLE_MIN in api/lupus_lib.php)
    const ROLE_MIN = { bear: 5, shaman: 6, vampire: 7, vampire_hunter: 7 };
    const timerChip = () => (G().timer_ends ? h('div', { class: 'timer', dataset: { ends: G().timer_ends } }, '') : null);

    function lw() {
        // Per-phase choices; cleared whenever the match moves to another phase
        const g = G();
        const key = `${g.match}-${g.day}-${g.phase}-${g.vote.open ? 'v' : ''}`;
        if (!C.ui.lw || C.ui.lw.key !== key) {
            C.ui.lw = { key, pick: null, pick2: NOBODY, picks: [], heal: false, kill: NOBODY, judge: false, seerShow: C.ui.lw && C.ui.lw.seerShow, review: null };
            if (g.phase !== 'night') C.ui.lw.seerShow = null;
        }
        return C.ui.lw;
    }

    /** On a shared phone, first hand it to the right person. */
    function withPass(pid, title, draw) {
        if (shared() && C.ui.passed !== pid) {
            return C.passView(pid, title, () => {
                C.ui.passed = pid;
                C.ui.heldOnce = null;
                lw().pick = null;
                C.scheduleRender();
            });
        }
        return draw();
    }

    function pickList(options, selected, onPick) {
        return h('div', { class: 'pick-list' }, options.map((o) => h('button', {
            class: 'btn big pick' + ((Array.isArray(selected) ? selected.includes(o.id) : selected === o.id) ? ' selected' : '') + (o.id === NOBODY ? ' nospy' : ''),
            disabled: !!o.disabled,
            onclick: () => onPick(o.id),
        }, o.label)));
    }

    function waitView(big, small, extra = null) {
        return h('div', { class: 'pass' },
            h('div', { class: 'pass-name small-name' }, big),
            small ? h('p', { class: 'muted center' }, small) : null,
            extra);
    }

    function shamanLine(i) {
        return i.answer === null ? t('lw_shaman_waiting', { name: C.pname(i.p) }) : t('lw_shaman_answer', { name: C.pname(i.p), answer: i.answer ? t('lw_yes') : t('lw_no') });
    }

    // ---------- the role card ----------
    function roleBack(m) {
        const wolf = m.role === 'wolf' || m.role === 'white_wolf';
        const masons = (m.masons || []).filter((id) => id !== m.player_id);
        const mates = (m.pack || []).filter((id) => id !== m.player_id);
        return h('div', { class: 'card-face card-back' + (wolf || m.role === 'vampire' ? ' spy' : ''), dataset: { player: m.player_id } },
            h('div', { class: 'card-label' }, C.pname(m.player_id)),
            h('div', { class: 'card-sub' }, t('lw_your_role')),
            wolf || m.role === 'vampire' ? h('div', { class: 'stamp' }, roleIcon(m.role) + roleName(m.role)) : h('div', { class: 'card-loc' }, roleIcon(m.role) + roleName(m.role)),
            h('p', { class: 'card-text' }, t('lw_desc_' + m.role)),
            wolf && mates.length ? h('p', { class: 'card-text' }, t('lw_pack', { names: names(mates) })) : null,
            m.fished ? h('p', { class: 'card-text' }, t('lw_fished_note', { name: C.pname(m.fished.p) })) : null,
            masons.length ? h('p', { class: 'card-text' }, t('lw_masons', { names: names(masons) })) : null,
            m.lover ? h('p', { class: 'card-text' }, t('lw_lover', { name: C.pname(m.lover) })) : null,
            m.role === 'vampire' && (m.vamps || []).length > 1 ? h('p', { class: 'card-text' }, t('lw_vamp_pack', { names: names(m.vamps.filter((id) => id !== m.player_id)) })) : null,
            m.bitten ? h('p', { class: 'card-text' }, t('lw_bitten_note')) : null,
            m.turned ? h('p', { class: 'card-text' }, t('lw_turned_note')) : null,
            m.shaman_info ? h('p', { class: 'card-text' }, shamanLine(m.shaman_info)) : null,
            m.power_lost ? h('p', { class: 'card-text' }, t('lw_power_lost')) : null,
            !m.alive ? h('p', { class: 'card-text' }, t('lw_you_are_dead')) : null);
    }

    /** The card screen. `action` null = a decoy (shared phone): nothing is sent, `after` just moves on. */
    function revealBody(m, action, after = null) {
        const pid = m.player_id;
        const done = async () => {
            if (action) { const r = await C.run(action, { player_id: pid }); if (!r) return; }
            C.ui.passed = null; C.ui.heldOnce = null;
            if (after) after(); else C.scheduleRender(true);
        };
        const btn = h('button', { class: 'btn primary big', disabled: C.ui.heldOnce !== pid, onclick: done }, t('got_it'));
        return h('div', { class: 'reveal' },
            h('div', { class: 'muted center' }, action === 'fish_seen' ? t('lw_fish_reveal') : action === 'turn_seen' ? t('lw_turned_reveal') : t('lw_your_card')),
            C.holdCard({ player_id: pid }, () => { C.ui.heldOnce = pid; btn.disabled = false; }, roleBack(m)),
            h('p', { class: 'muted small center' }, t('hold_note')),
            h('div', { class: 'bottom-bar' }, btn));
    }

    function revealView(m, action = 'seen') {
        return withPass(m.player_id, t('pass_phone_to'), () => revealBody(m, action));
    }

    function reviewView() {
        const s = lw();
        const mine = G().me;
        const close = () => { s.review = null; C.scheduleRender(); };
        if (s.review === 'pick') {
            if (mine.length === 1) s.review = mine[0].player_id;
            else {
                return h('div', { class: 'stack' },
                    h('h2', { class: 'center' }, t('who_are_you')),
                    pickList(mine.map((m) => ({ id: m.player_id, label: C.pname(m.player_id) })), null, (id) => { s.review = id; C.scheduleRender(true); }),
                    h('div', { class: 'bottom-bar' }, h('button', { class: 'btn ghost big', onclick: close }, t('cancel'))));
            }
        }
        const m = meOf(s.review);
        if (!m) { s.review = null; return dayView(); }
        return h('div', { class: 'reveal' },
            C.holdCard({ player_id: m.player_id }, null, roleBack(m)),
            h('p', { class: 'muted small center' }, t('hold_note')),
            h('div', { class: 'bottom-bar' }, h('button', { class: 'btn big', onclick: close }, t('close'))));
    }

    // ---------- night ----------
    function lastLynchLine() {
        const g = G();
        if (!g.lynch || g.lynch.day !== g.day - 1) return null;
        if (!g.lynch.p) return t('lw_lynch_nobody');
        const d = g.dead.find((x) => x.p === g.lynch.p);
        if (g.lynch.judge) return t('lw_judge_used') + ' ' + (d && d.role ? t('lw_lynch_role', { name: C.pname(g.lynch.p), role: roleName(d.role) }) : t('lw_lynch', { name: C.pname(g.lynch.p) }));
        return d && d.role ? t('lw_lynch_role', { name: C.pname(g.lynch.p), role: roleName(d.role) }) : t('lw_lynch', { name: C.pname(g.lynch.p) });
    }

    function nightWait(msg) {
        const g = G();
        const lines = [lastLynchLine()];
        if (g.log.some((e) => e.t === 'powers_lost' && e.day === g.day - 1)) lines.push(t('lw_powers_lost_line'));
        const shown = lines.filter(Boolean);
        return waitView(t('lw_night_n', { n: g.day }), msg, h('div', null, timerChip(), shown.length ? h('div', { class: 'banner' }, shown.join(' ')) : null));
    }

    function nightActView(m) {
        const g = G();
        const pid = m.player_id;
        return withPass(pid, t('lw_night_pass'), () => {
            const s = lw();
            const others = g.alive.filter((id) => id !== pid);
            const opt = (id) => ({ id, label: C.pname(id) });
            let title, options, note = null;
            let extra = null;          // second list: the white killer's optional extra kill
            let multi = false;         // cupid picks two names
            const role = m.power_lost ? 'villager' : m.role;
            const dummy = () => {
                title = t('lw_night_dummy');
                options = [...others.map(opt), { id: NOBODY, label: t('lw_nobody') }];
            };
            if (role === 'wolf' || role === 'white_wolf') {
                title = t('lw_night_wolf');
                const pack = m.pack || [pid];
                options = others.filter((id) => !pack.includes(id)).map(opt);
                const votes = Object.entries(m.pack_votes || {}).filter(([w]) => +w !== pid);
                if (votes.length) note = votes.map(([w, v]) => t('lw_pack_vote', { wolf: C.pname(+w), name: C.pname(+v) })).join(' ');
                if (role === 'white_wolf' && m.white_night) {
                    const mates = pack.filter((id) => id !== pid && isAlive(id));
                    if (mates.length) {
                        extra = h('div', { class: 'stack' },
                            h('h2', { class: 'center' }, t('lw_white_extra')),
                            pickList([...mates.map(opt), { id: NOBODY, label: t('lw_nobody') }], s.pick2, (id) => { s.pick2 = id; C.scheduleRender(); }));
                    }
                }
            } else if (role === 'vampire') {
                title = t('lw_night_vampire');
                const mates = m.vamps || [pid];
                options = others.filter((id) => !mates.includes(id)).map(opt);
                const votes = Object.entries(m.vamp_votes || {}).filter(([w]) => +w !== pid);
                note = [t('lw_vamp_pack', { names: names(mates.filter((id) => id !== pid)) || '-' }),
                    ...votes.map(([w, v]) => t('lw_vamp_vote', { vamp: C.pname(+w), name: C.pname(+v) }))].join(' ');
            } else if (role === 'vampire_hunter' && !m.stake_used) {
                title = t('lw_night_stake');
                options = [...others.map(opt), { id: NOBODY, label: t('lw_nobody') }];
                note = t('lw_stake_note');
            } else if (role === 'shaman' && (m.shaman_candidates || []).length) {
                title = t('lw_night_shaman');
                options = [...m.shaman_candidates.map(opt), { id: NOBODY, label: t('lw_nobody') }];
                note = t('lw_shaman_note') + (m.shaman_info ? ' ' + shamanLine(m.shaman_info) : '');
            } else if (role === 'seer') {
                title = t('lw_night_seer');
                options = others.map(opt);
            } else if (role === 'guard' || role === 'whore') {
                title = role === 'guard' ? t('lw_night_guard') : t('lw_night_whore');
                options = g.alive.map((id) => ({ id, label: C.pname(id), disabled: id === m.guard_last }));
                if (m.guard_last) note = t('lw_guard_note', { name: C.pname(m.guard_last) });
            } else if (role === 'fisher' && (m.fish_candidates || []).length) {
                title = t('lw_night_fisher');
                options = m.fish_candidates.map((c) => ({ id: c.p, label: c.role ? `${C.pname(c.p)} (${roleName(c.role)})` : C.pname(c.p) }));
                note = t('lw_fish_note');
            } else if (role === 'cupid' && m.cupid_turn) {
                title = t('lw_night_cupid');
                options = g.alive.map(opt);
                multi = true;
            } else if (role === 'crow') {
                title = t('lw_night_crow');
                options = [...others.map(opt), { id: NOBODY, label: t('lw_nobody') }];
            } else {
                // everyone else answers a question that changes nothing; the medium also learns something
                dummy();
                if (role === 'medium' && m.medium_info) {
                    note = t('lw_medium_info', { name: C.pname(m.medium_info.p), role: roleName(m.medium_info.role) });
                }
            }
            if (m.power_lost) note = t('lw_power_lost');
            if (m.bitten) note = [note, t('lw_bitten_note')].filter(Boolean).join(' ');
            const ready = multi ? s.picks.length === 2 : s.pick !== null;
            const choose = (id) => {
                if (multi) {
                    s.picks = s.picks.includes(id) ? s.picks.filter((x) => x !== id) : [...s.picks, id].slice(-2);
                } else s.pick = id;
                C.scheduleRender();
            };
            const send = async () => {
                if (!ready) return;
                const body = multi ? { player_id: pid, target: s.picks[0], target2: s.picks[1] } : { player_id: pid, target: s.pick };
                if (extra && s.pick2) body.target2 = s.pick2;
                const r = await C.run('night', body);
                if (!r) return;
                if (role === 'seer') s.seerShow = pid; else C.ui.passed = null;
                s.pick = null; s.pick2 = NOBODY; s.picks = [];
                C.vibrate(15);
                C.scheduleRender(true);
            };
            return h('div', { class: 'stack' },
                h('div', { class: 'center' },
                    h('div', { class: 'muted small' }, t('lw_night_who', { n: g.day, name: C.pname(pid), role: roleName(m.role) })),
                    h('h2', null, title),
                    timerChip(),
                    note ? h('p', { class: 'muted small' }, note) : null),
                pickList(options, multi ? s.picks : s.pick, choose),
                extra,
                h('div', { class: 'bottom-bar' }, h('button', { class: 'btn primary big', disabled: !ready, onclick: send }, t('lw_confirm'))));
        });
    }

    function seerResultView(pid) {
        const res = (meOf(pid).seen_results || []).slice(-1)[0];
        const ok = () => { lw().seerShow = null; C.ui.passed = null; C.scheduleRender(true); };
        if (!res) { ok(); return nightWait(''); }
        return h('div', { class: 'pass' },
            h('div', { class: 'muted' }, C.pname(res.p)),
            res.wolf ? h('div', { class: 'stamp' }, t('lw_is_wolf')) : h('div', { class: 'pass-name small-name' }, t('lw_not_wolf')),
            h('div', { class: 'bottom-bar' }, h('button', { class: 'btn primary big', onclick: ok }, t('got_it'))));
    }

    /** The witch's screen. `fake` (shared phone, a player who is not the witch) looks the same but sends nothing. */
    function witchBody(m, after = null, fake = false) {
        const g = G();
        const pid = m.player_id;
        {
            const s = lw();
            // the decoy shows a made-up victim (picked from the living, stable for this player and day)
            const others = g.alive.filter((id) => id !== pid);
            const v = fake ? others[(pid * 7 + g.day) % others.length] : m.victim;
            const potions = fake ? { heal: true, kill: true } : m.potions;
            const parts = [h('div', { class: 'center' },
                h('div', { class: 'muted small' }, t('lw_night_who', { n: g.day, name: C.pname(pid), role: roleName('witch') })),
                h('h2', null, v ? t('lw_witch_victim', { name: C.pname(v) }) : t('lw_witch_no_victim')))];
            if (v && potions.heal) {
                parts.push(h('button', {
                    class: 'btn big pick' + (s.heal ? ' selected' : ''), onclick: () => { s.heal = !s.heal; C.scheduleRender(); },
                }, t('lw_witch_heal', { name: C.pname(v) })));
            }
            if (potions.kill) {
                parts.push(h('p', { class: 'muted small' }, t('lw_witch_kill')));
                parts.push(pickList([...g.alive.filter((id) => id !== pid).map((id) => ({ id, label: C.pname(id) })), { id: NOBODY, label: t('lw_nobody') }],
                    s.kill, (id) => { s.kill = id; C.scheduleRender(); }));
            }
            const send = async () => {
                if (!fake) {
                    const r = await C.run('witch', { player_id: pid, heal: s.heal, kill: s.kill || NOBODY });
                    if (!r) return;
                }
                s.heal = false; s.kill = NOBODY;
                C.ui.passed = null;
                if (after) after(!fake); else C.scheduleRender(true);
            };
            parts.push(h('div', { class: 'bottom-bar' }, h('button', { class: 'btn primary big', onclick: send }, t('lw_confirm'))));
            return h('div', { class: 'stack' }, parts);
        }
    }

    function witchView(m) {
        return withPass(m.player_id, t('lw_night_pass'), () => witchBody(m));
    }

    // ---------- shaman call (the called dead answers yes or no) ----------
    function summonBody(m, after = null, fake = false) {
        const pid = m.player_id;
        const answer = async (yes) => {
            if (!fake) { const r = await C.run('shaman_reply', { player_id: pid, answer: yes }); if (!r) return; }
            C.ui.passed = null;
            if (after) after(!fake); else C.scheduleRender(true);
        };
        return h('div', { class: 'stack' },
            h('div', { class: 'center' }, h('div', { class: 'muted small' }, C.pname(pid)), h('h2', null, t('lw_summon_title')), h('p', { class: 'muted small' }, t('lw_summon_note'))),
            h('div', { class: 'actions' },
                h('button', { class: 'btn primary big', onclick: () => answer(true) }, t('lw_yes')),
                h('button', { class: 'btn big', onclick: () => answer(false) }, t('lw_no'))));
    }

    /**
     * Shared phone, secret turn (the witch's, a called ghost's, a player who turned into a vampire): the phone goes round
     * EVERY player of that phone and the others get a decoy screen, so nobody can tell who the real one is.
     */
    function secretTurn() {
        const g = G();
        const st = g.secret_turn;
        const k = `${g.match}-${g.day}`;
        let q = C.ui.seq;
        if (q && (q.k !== k || (!st && !q.after))) q = C.ui.seq = null;
        if (!q && st && shared()) q = C.ui.seq = { k, kind: st.kind, ids: st.players.slice(), i: 0, after: false };
        if (!q || q.i >= q.ids.length) return null;
        const pid = q.ids[q.i];
        const m = meOf(pid);
        if (!m) { q.i++; return secretTurn(); }
        const next = (real) => { if (real) q.after = true; q.i++; C.ui.passed = null; C.ui.heldOnce = null; C.scheduleRender(true); };
        const title = { witch: t('lw_night_pass'), summon: t('lw_summon_pass'), turn: t('pass_phone_to') }[q.kind];
        return withPass(pid, title, () => {
            if (q.kind === 'witch') return witchBody(m, next, !m.witch_turn);
            if (q.kind === 'summon') return summonBody(m, next, !m.summoned);
            return revealBody(m, m.turned && !m.turned.seen ? 'turn_seen' : null, () => next(!!(m.turned && !m.turned.seen)));
        });
    }

    function hunterView(pid) {
        const g = G();
        return withPass(pid, t('lw_hunter_pass'), () => {
            const s = lw();
            const send = async () => {
                if (s.pick === null) return;
                const r = await C.run('shoot', { player_id: pid, target: s.pick });
                if (r) { C.ui.passed = null; C.scheduleRender(true); }
            };
            return h('div', { class: 'stack' },
                h('div', { class: 'center' },
                    h('div', { class: 'muted small' }, C.pname(pid)),
                    h('h2', null, t('lw_hunter_title'))),
                pickList([...g.alive.map((id) => ({ id, label: C.pname(id) })), { id: NOBODY, label: t('lw_nobody') }], s.pick, (id) => { s.pick = id; C.scheduleRender(); }),
                h('div', { class: 'bottom-bar' }, h('button', { class: 'btn primary big', disabled: s.pick === null, onclick: send }, t('lw_shoot'))));
        });
    }

    // ---------- day ----------
    function dawnLines() {
        const g = G();
        const lines = [];
        if (g.dawn && g.dawn.day === g.day) {
            if (g.dawn.whore) lines.push(t('lw_dawn_whore'));
            if (!g.dawn.died.length) lines.push(t('lw_nobody_died'));
            for (const p of g.dawn.died) {
                const d = g.dead.find((x) => x.p === p);
                if (d && d.cause === 'stake') { lines.push(t('lw_died_stake', { name: C.pname(p) })); continue; }
                if (d && d.cause === 'stake_miss') { lines.push(t('lw_died_stake_miss', { name: C.pname(p) })); continue; }
                if (d && d.cause === 'love') { lines.push(t('lw_died_love', { name: C.pname(p) })); continue; }
                lines.push(d && d.role ? t('lw_died_role', { name: C.pname(p), role: roleName(d.role) }) : t('lw_died', { name: C.pname(p) }));
            }
            if (g.dawn.growl) lines.push(t('lw_dawn_growl'));
            if (g.dawn.crow && isAlive(g.dawn.crow)) lines.push(t('lw_dawn_crow', { name: C.pname(g.dawn.crow) }));
        }
        for (const ev of g.log.filter((e) => e.day === g.day && e.t === 'shot' && e.target)) {
            lines.push(t('lw_hunter_shot', { hunter: C.pname(ev.p), name: C.pname(ev.target) }));
        }
        for (const ev of g.log.filter((e) => e.day === g.day && e.t === 'left')) lines.push(t('lw_left', { name: C.pname(ev.p) }));
        return lines;
    }

    function roleOf(pid) {
        const g = G();
        if (g.all_roles) return g.all_roles[pid];
        const d = g.dead.find((x) => x.p === pid);
        return d ? d.role : null;
    }

    function hauntView(pid) {
        const s = lw();
        const words = ['boo', 'liar', 'trust', 'behind', 'run', 'silence', 'betrayal', 'help'];
        const send = async (w) => {
            const r = await C.run('haunt', { player_id: pid, word: w });
            if (r) { s.haunt = null; C.vibrate(15); C.scheduleRender(true); }
        };
        return h('div', { class: 'stack' },
            h('div', { class: 'center' }, h('h2', null, '👻 ' + t('lw_haunt_title', { name: C.pname(pid) }))),
            h('div', { class: 'pick-list' }, words.map((w) => h('button', { class: 'btn big pick', onclick: () => send(w) }, t('lw_haunt_' + w)))),
            h('div', { class: 'bottom-bar' }, h('button', { class: 'btn ghost big', onclick: () => { s.haunt = null; C.scheduleRender(); } }, t('cancel'))));
    }

    function dayView() {
        const g = G();
        if (lw().haunt) return hauntView(lw().haunt);
        const parts = [];
        const myAlive = g.me.filter((m) => m.alive);
        if (g.me.length && !myAlive.length) parts.push(h('div', { class: 'banner' }, t('lw_dead_note')));
        if (!g.me.length) parts.push(h('div', { class: 'banner' }, t('lw_spectator')));

        parts.push(h('section', { class: 'round-head' },
            h('div', { class: 'round-line' }, h('strong', null, t('lw_day_n', { n: g.day }))),
            h('ul', { class: 'log' }, dawnLines().map((l) => h('li', null, l))),
            g.timer_ends ? h('div', { class: 'timer', dataset: { ends: g.timer_ends } }, '') : null));

        if (g.vote.open) {
            const voted = g.vote.voted.filter((id) => isAlive(id)).length;
            parts.push(h('section', { class: 'vote-status' },
                h('strong', null, g.vote.forced ? t('final_vote') : t('vote_running')),
                h('div', { class: 'muted' }, t('voted_n', { n: voted, total: g.alive.length })),
                C.state.is_host ? h('button', {
                    class: 'btn small ghost', onclick: () => C.askConfirm(t('close_vote_q'), t('close_vote'), () => C.run('vote_close')),
                }, t('close_vote')) : null));
        }

        if ((g.haunts || []).length) {
            parts.push(h('section', { class: 'round-head ghost-lines' }, h('ul', { class: 'log' },
                g.haunts.map((x) => h('li', null, '👻 ' + t('lw_haunt_msg', { name: C.pname(x.p), word: t('lw_haunt_' + x.w) }))))));
        }

        parts.push(C.section(t('players'), h('ul', { class: 'roster' }, g.in_game.filter((id) => C.playerById(id)).map((id) => {
            const dead = !isAlive(id);
            const r = roleOf(id);
            const tag = dead ? (r ? roleName(r) : t('lw_dead')) : (g.vote.open && g.vote.voted.includes(id) ? '✓' : (r ? roleName(r) : ''));
            return h('li', { class: dead ? 'out' : '' }, h('span', null, C.pname(id)), tag ? h('span', { class: 'tag' }, tag) : null);
        }))));

        parts.push(C.plainSection(t('lw_in_play'), deckChips()));

        const buttons = [];
        if (g.me.length) buttons.push(h('button', { class: 'btn big', onclick: () => { lw().review = 'pick'; C.scheduleRender(); } }, t('see_role_again')));
        for (const m of g.me.filter((x) => x.can_haunt)) {
            buttons.push(h('button', { class: 'btn big', onclick: () => { lw().haunt = m.player_id; C.scheduleRender(); } }, '👻 ' + t('lw_haunt_btn', { name: C.pname(m.player_id) })));
        }
        if (!g.vote.open && myAlive.length) {
            buttons.push(h('button', {
                class: 'btn primary big', onclick: () => C.askConfirm(t('lw_call_vote_q'), t('call_vote'), () => C.run('vote_call')),
            }, t('call_vote')));
        }
        if (C.state.is_host && !g.vote.open) {
            buttons.push(h('button', {
                class: 'btn ghost big', onclick: () => C.askConfirm(t('lw_skip_q'), t('lw_skip'), () => C.run('skip_day')),
            }, t('lw_skip')));
        }
        if (C.state.is_host) {
            buttons.push(h('button', {
                class: 'btn ghost big danger', onclick: () => C.askConfirm(t('lw_end_q'), t('lw_end'), () => C.run('end'), true),
            }, t('lw_end')));
        }
        parts.push(h('div', { class: 'actions' }, buttons));
        return h('div', { class: 'stack' }, parts);
    }

    function deckChips() {
        const deck = G().deck || {};
        return h('div', { class: 'chips' }, Object.entries(deck).map(([role, n]) => h('span', { class: 'chip soft' },
            n > 1 ? `${n} × ${roleIcon(role)}${roleName(role)}` : roleIcon(role) + roleName(role))));
    }

    function voteView(pid) {
        const g = G();
        const m = meOf(pid);
        return withPass(pid, t('lw_vote_pass'), () => {
            const s = lw();
            const hammer = !!(m && m.judge_available && s.judge);
            const send = async () => {
                if (s.pick === null || (hammer && s.pick === NOBODY)) return;
                const r = await C.run('vote', { player_id: pid, target: s.pick, judge: hammer });
                if (r) { C.ui.passed = null; s.pick = null; s.judge = false; C.vibrate(15); C.scheduleRender(true); }
            };
            const options = g.alive.filter((id) => id !== pid).map((id) => ({ id, label: C.pname(id) }));
            if (!hammer) options.push({ id: NOBODY, label: t('lw_nobody') });
            return h('div', { class: 'stack' },
                h('div', { class: 'center' },
                    h('div', { class: 'muted small' }, t('voting_as', { name: C.pname(pid) })),
                    h('h2', null, t('lw_vote_title')),
                    g.vote.forced ? h('div', { class: 'chip warn' }, t('final_vote')) : null),
                m && m.judge_available ? h('button', {
                    class: 'btn big pick' + (hammer ? ' selected' : ''),
                    onclick: () => { s.judge = !s.judge; if (s.judge && s.pick === NOBODY) s.pick = null; C.scheduleRender(); },
                }, t('lw_judge_hammer')) : null,
                hammer ? h('p', { class: 'muted small center' }, t('lw_judge_note')) : null,
                pickList(options, s.pick, (id) => { s.pick = id; C.scheduleRender(); }),
                h('div', { class: 'bottom-bar' }, h('button', { class: 'btn primary big', disabled: s.pick === null, onclick: send }, t('confirm_vote'))));
        });
    }

    // ---------- entry points used by app.js ----------
    function playView() {
        const g = G();
        const s = lw();
        if (s.review) return reviewView();
        const mine = g.me;
        const seq = secretTurn();
        if (seq) return seq;
        switch (g.phase) {
            case 'reveal': {
                const m = mine.find((x) => !x.seen && x.alive);
                return m ? revealView(m) : waitView(t('lw_title'), t('lw_wait_reveal', { n: g.seen.length, total: g.alive.length }));
            }
            case 'night': {
                if (s.seerShow && meOf(s.seerShow)) return seerResultView(s.seerShow);
                const m = mine.find((x) => x.alive && !x.acted);
                return m ? nightActView(m) : nightWait(t('lw_wait_night', { n: g.acted, total: g.alive.length }));
            }
            case 'witch': {
                const m = mine.find((x) => x.witch_turn);
                return m ? witchView(m) : nightWait(t('lw_wait_witch'));
            }
            case 'hunter':
                return mine.some((x) => x.player_id === g.hunter) ? hunterView(g.hunter) : waitView(t('lw_role_hunter'), t('lw_wait_hunter', { name: C.pname(g.hunter) }));
            case 'day': {
                const called = mine.find((x) => x.summoned);
                if (called) return withPass(called.player_id, t('lw_summon_pass'), () => summonBody(called));
                const turned = mine.find((x) => x.turned && !x.turned.seen && x.alive);
                if (turned) return revealView(turned, 'turn_seen');
                const fished = mine.find((x) => x.fished && !x.fished.seen);
                if (fished) return revealView(fished, 'fish_seen');
                const voter = g.vote.open ? mine.find((x) => x.alive && !g.vote.voted.includes(x.player_id)) : null;
                return voter ? voteView(voter.player_id) : dayView();
            }
            default:
                return dayView();
        }
    }

    function resultCard() {
        const g = G();
        const res = g.result || { winner: 'none', reason: 'host_ended', roles: {} };
        const stamp = {
            village: t('lw_win_village'), wolves: t('lw_win_wolves'), jester: t('lw_win_jester'),
            lovers: t('lw_win_lovers'), vampires: t('lw_win_vampires'), white_wolf: t('lw_win_white_wolf'), none: t('lw_win_none'),
        }[res.winner];
        const cls = res.winner === 'village' ? 'civilians' : res.winner === 'wolves' || res.winner === 'vampires' ? 'spies' : 'none';
        return h('section', { class: 'panel result ' + cls },
            h('div', { class: 'stamp result-stamp' }, stamp),
            h('div', { class: 'muted' }, t('lw_reason_' + res.reason)),
            h('ul', { class: 'result-list' }, g.in_game.filter((id) => C.playerById(id)).map((id) => {
                const role = res.roles[id];
                const orig = (res.orig_roles || {})[id];
                const label = role ? (orig && orig !== role ? `${roleName(orig)} → ${roleName(role)}` : roleName(role)) : '';
                return h('li', { class: role === 'wolf' || role === 'white_wolf' || role === 'vampire' ? 'is-spy' : '' },
                    h('span', null, C.pname(id) + (isAlive(id) ? '' : ' †')),
                    h('span', { class: 'role' }, label));
            })));
    }

    function summary() {
        const s = C.state.settings;
        const chips = [s.wolves_mode === 'auto' ? t('lw_sum_wolves_auto') : t('lw_sum_wolves', { n: s.wolves })];
        for (const r of SETTING_ROLES) if (s[r]) chips.push(roleName(r === 'masons' ? 'mason' : r));
        if (s.day_timer) chips.push(t('sum_timer', { n: s.day_min }));
        if (s.night_sec) chips.push(t('lw_sum_night', { n: s.night_sec }));
        if (s.ghost) chips.push('👻 ' + t('lw_set_ghost'));
        if (s.scores) chips.push(t('set_scores'));
        return h('div', { class: 'chips' }, chips.map((c) => h('span', { class: 'chip soft' }, c)));
    }

    const HOUSE_ROLES = ['whore', 'jester', 'fisher'];
    const OPTIONAL_ROLES = ['seer', 'guard', 'witch', 'hunter', 'judge', 'cupid', 'medium', 'minion', 'mayor', 'crow', 'elder', 'masons', 'white_wolf'];
    const MONSTER_ROLES = ['bear', 'shaman', 'vampire', 'vampire_hunter'];
    const SETTING_ROLES = [...HOUSE_ROLES, ...OPTIONAL_ROLES, ...MONSTER_ROLES];

    function settings(s, { set, toggle, stepper, host }) {
        const roleToggle = (r, extra = null) => toggle(r, roleIcon(r === 'masons' ? 'mason' : r) + roleName(r === 'masons' ? 'mason' : r),
            t('lw_desc_' + (r === 'masons' ? 'mason' : r)) + (ROLE_MIN[r] ? ' ' + t('lw_min_players', { n: ROLE_MIN[r] }) : ''), extra);
        // the host seats the players in a circle, as they really sit: the server works out the bear's neighbours from it
        const seatEditor = () => {
            const ids = (C.state.players || []).map((p) => p.id);
            const order = [...(s.seating || []).filter((id) => ids.includes(id)), ...ids.filter((id) => !(s.seating || []).includes(id))];
            const move = (i, d) => { const o = order.slice(); [o[i], o[i + d]] = [o[i + d], o[i]]; set({ seating: o }); };
            return h('div', { class: 'seat-editor' },
                h('p', { class: 'muted small' }, t('lw_set_seating_d')),
                h('ol', { class: 'seat-list' }, order.map((id, i) => h('li', null,
                    h('span', null, C.pname(id)),
                    h('span', null,
                        h('button', { class: 'step', disabled: !host || i === 0, onclick: () => move(i, -1), 'aria-label': t('lw_seat_up') }, '↑'),
                        h('button', { class: 'step', disabled: !host || i === order.length - 1, onclick: () => move(i, 1), 'aria-label': t('lw_seat_down') }, '↓'))))),
                h('p', { class: 'muted small' }, '↻ ' + t('lw_seat_ring')));
        };
        const nightTimer = h('div', { class: 'set-row' },
            h('div', { class: 'set-text' }, h('span', { class: 'set-title' }, t('lw_set_night_timer')), h('span', { class: 'set-desc' }, t('lw_set_night_timer_d'))),
            h('div', { class: 'segmented' }, [0, 30, 45, 60].map((n) => h('button', {
                class: (s.night_sec || 0) === n ? 'on' : '', disabled: !host, onclick: () => set({ night_sec: n }),
            }, n ? t('lw_sec', { n }) : t('lw_off')))));
        const fisherSees = h('label', { class: 'set-main sub' },
            h('span', { class: 'set-text' }, h('span', { class: 'set-title' }, t('lw_set_fisher_sees')), h('span', { class: 'set-desc' }, t('lw_set_fisher_sees_d'))),
            h('input', { type: 'checkbox', role: 'switch', class: 'switch', checked: !!s.fisher_sees, disabled: !host, onchange: (e) => set({ fisher_sees: e.target.checked }) }));
        const wolves = h('div', { class: 'set-row' },
            h('div', { class: 'set-text' }, h('span', { class: 'set-title' }, t('lw_set_wolves')), h('span', { class: 'set-desc' }, t('lw_set_wolves_d'))),
            h('div', { class: 'segmented' },
                h('button', { class: s.wolves_mode === 'auto' ? 'on' : '', disabled: !host, onclick: () => set({ wolves_mode: 'auto' }) }, t('lw_auto')),
                h('button', { class: s.wolves_mode === 'fixed' ? 'on' : '', disabled: !host, onclick: () => set({ wolves_mode: 'fixed' }) }, t('spies_fixed'))),
            s.wolves_mode === 'fixed' ? stepper('wolves', t('how_many'), 1, 9) : null);
        return [
            wolves,
            h('h3', { class: 'set-group' }, t('lw_set_group_house')),
            ...HOUSE_ROLES.map((r) => roleToggle(r, r === 'fisher' ? fisherSees : null)),
            h('h3', { class: 'set-group' }, t('lw_set_group_optional')),
            ...OPTIONAL_ROLES.map((r) => roleToggle(r)),
            h('h3', { class: 'set-group' }, '🧛 ' + t('lw_set_group_monsters')),
            h('p', { class: 'muted small' }, t('lw_set_monsters_warn')),
            ...MONSTER_ROLES.map((r) => roleToggle(r, r === 'bear' ? seatEditor() : null)),
            toggle('ghost', '👻 ' + t('lw_set_ghost'), t('lw_set_ghost_d')),
            h('h3', { class: 'set-group' }, t('lw_set_group_rules')),
            nightTimer,
            toggle('wolves_know', t('lw_set_know'), t('lw_set_know_d')),
            toggle('reveal_dead', t('lw_set_reveal'), t('lw_set_reveal_d')),
            toggle('dead_see_all', t('lw_set_dead_see'), t('lw_set_dead_see_d')),
            toggle('day_timer', t('lw_set_timer'), t('lw_set_timer_d'), stepper('day_min', t('minutes'), 1, 30)),
            toggle('scores', t('set_scores'), t('lw_set_scores_d')),
        ];
    }

    return {
        init(core) { C = core; return { playView, resultCard, summary, settings }; },
    };
})();
