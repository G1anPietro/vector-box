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

    function lw() {
        // Per-phase choices; cleared whenever the match moves to another phase
        const g = G();
        const key = `${g.match}-${g.day}-${g.phase}-${g.vote.open ? 'v' : ''}`;
        if (!C.ui.lw || C.ui.lw.key !== key) {
            C.ui.lw = { key, pick: null, heal: false, kill: NOBODY, seerShow: C.ui.lw && C.ui.lw.seerShow, review: null };
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
            class: 'btn big pick' + (selected === o.id ? ' selected' : '') + (o.id === NOBODY ? ' nospy' : ''),
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

    // ---------- the role card ----------
    function roleBack(m) {
        const wolf = m.role === 'wolf';
        const mates = (m.pack || []).filter((id) => id !== m.player_id);
        return h('div', { class: 'card-face card-back' + (wolf ? ' spy' : ''), dataset: { player: m.player_id } },
            h('div', { class: 'card-label' }, C.pname(m.player_id)),
            h('div', { class: 'card-sub' }, t('lw_your_role')),
            wolf ? h('div', { class: 'stamp' }, roleName('wolf')) : h('div', { class: 'card-loc' }, roleName(m.role)),
            h('p', { class: 'card-text' }, t('lw_desc_' + m.role)),
            wolf && mates.length ? h('p', { class: 'card-text' }, t('lw_pack', { names: names(mates) })) : null,
            !m.alive ? h('p', { class: 'card-text' }, t('lw_you_are_dead')) : null);
    }

    function revealView(m) {
        const pid = m.player_id;
        return withPass(pid, t('pass_phone_to'), () => {
            const done = async () => {
                const r = await C.run('seen', { player_id: pid });
                if (r) { C.ui.passed = null; C.ui.heldOnce = null; C.scheduleRender(true); }
            };
            const btn = h('button', { class: 'btn primary big', disabled: C.ui.heldOnce !== pid, onclick: done }, t('got_it'));
            return h('div', { class: 'reveal' },
                h('div', { class: 'muted center' }, t('lw_your_card')),
                C.holdCard({ player_id: pid }, () => { C.ui.heldOnce = pid; btn.disabled = false; }, roleBack(m)),
                h('p', { class: 'muted small center' }, t('hold_note')),
                h('div', { class: 'bottom-bar' }, btn));
        });
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
        return d && d.role ? t('lw_lynch_role', { name: C.pname(g.lynch.p), role: roleName(d.role) }) : t('lw_lynch', { name: C.pname(g.lynch.p) });
    }

    function nightWait(msg) {
        const g = G();
        const line = lastLynchLine();
        return waitView(t('lw_night_n', { n: g.day }), msg, line ? h('div', { class: 'banner' }, line) : null);
    }

    function nightActView(m) {
        const g = G();
        const pid = m.player_id;
        return withPass(pid, t('lw_night_pass'), () => {
            const s = lw();
            const others = g.alive.filter((id) => id !== pid);
            const opt = (id) => ({ id, label: C.pname(id) });
            let title, options, note = null;
            if (m.role === 'wolf') {
                title = t('lw_night_wolf');
                const pack = m.pack || [];
                options = others.filter((id) => !pack.includes(id)).map(opt);
                const votes = Object.entries(m.pack_votes || {}).filter(([w]) => +w !== pid);
                if (votes.length) note = votes.map(([w, v]) => t('lw_pack_vote', { wolf: C.pname(+w), name: C.pname(+v) })).join(' ');
            } else if (m.role === 'seer') {
                title = t('lw_night_seer');
                options = others.map(opt);
            } else if (m.role === 'guard') {
                title = t('lw_night_guard');
                options = g.alive.map((id) => ({ id, label: C.pname(id), disabled: id === m.guard_last }));
                if (m.guard_last) note = t('lw_guard_note', { name: C.pname(m.guard_last) });
            } else {
                // villager, witch (her move comes later), hunter: a question that changes nothing
                title = t('lw_night_dummy');
                options = [...others.map(opt), { id: NOBODY, label: t('lw_nobody') }];
            }
            const send = async () => {
                if (s.pick === null) return;
                const r = await C.run('night', { player_id: pid, target: s.pick });
                if (!r) return;
                if (m.role === 'seer') s.seerShow = pid; else C.ui.passed = null;
                s.pick = null;
                C.vibrate(15);
                C.scheduleRender(true);
            };
            return h('div', { class: 'stack' },
                h('div', { class: 'center' },
                    h('div', { class: 'muted small' }, t('lw_night_who', { n: g.day, name: C.pname(pid), role: roleName(m.role) })),
                    h('h2', null, title),
                    note ? h('p', { class: 'muted small' }, note) : null),
                pickList(options, s.pick, (id) => { s.pick = id; C.scheduleRender(); }),
                h('div', { class: 'bottom-bar' }, h('button', { class: 'btn primary big', disabled: s.pick === null, onclick: send }, t('lw_confirm'))));
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

    function witchView(m) {
        const g = G();
        const pid = m.player_id;
        return withPass(pid, t('lw_night_pass'), () => {
            const s = lw();
            const v = m.victim;
            const parts = [h('div', { class: 'center' },
                h('div', { class: 'muted small' }, t('lw_night_who', { n: g.day, name: C.pname(pid), role: roleName('witch') })),
                h('h2', null, v ? t('lw_witch_victim', { name: C.pname(v) }) : t('lw_witch_no_victim')))];
            if (v && m.potions.heal) {
                parts.push(h('button', {
                    class: 'btn big pick' + (s.heal ? ' selected' : ''), onclick: () => { s.heal = !s.heal; C.scheduleRender(); },
                }, t('lw_witch_heal', { name: C.pname(v) })));
            }
            if (m.potions.kill) {
                parts.push(h('p', { class: 'muted small' }, t('lw_witch_kill')));
                parts.push(pickList([...g.alive.filter((id) => id !== pid).map((id) => ({ id, label: C.pname(id) })), { id: NOBODY, label: t('lw_nobody') }],
                    s.kill, (id) => { s.kill = id; C.scheduleRender(); }));
            }
            const send = async () => {
                const r = await C.run('witch', { player_id: pid, heal: s.heal, kill: s.kill || NOBODY });
                if (r) { C.ui.passed = null; C.scheduleRender(true); }
            };
            parts.push(h('div', { class: 'bottom-bar' }, h('button', { class: 'btn primary big', onclick: send }, t('lw_confirm'))));
            return h('div', { class: 'stack' }, parts);
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
            if (!g.dawn.died.length) lines.push(t('lw_nobody_died'));
            for (const p of g.dawn.died) {
                const d = g.dead.find((x) => x.p === p);
                lines.push(d && d.role ? t('lw_died_role', { name: C.pname(p), role: roleName(d.role) }) : t('lw_died', { name: C.pname(p) }));
            }
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

    function dayView() {
        const g = G();
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

        parts.push(C.section(t('players'), h('ul', { class: 'roster' }, g.in_game.filter((id) => C.playerById(id)).map((id) => {
            const dead = !isAlive(id);
            const r = roleOf(id);
            const tag = dead ? (r ? roleName(r) : t('lw_dead')) : (g.vote.open && g.vote.voted.includes(id) ? '✓' : (r ? roleName(r) : ''));
            return h('li', { class: dead ? 'out' : '' }, h('span', null, C.pname(id)), tag ? h('span', { class: 'tag' }, tag) : null);
        }))));

        parts.push(C.plainSection(t('lw_in_play'), deckChips()));

        const buttons = [];
        if (g.me.length) buttons.push(h('button', { class: 'btn big', onclick: () => { lw().review = 'pick'; C.scheduleRender(); } }, t('see_role_again')));
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
            n > 1 ? `${n} × ${roleName(role)}` : roleName(role))));
    }

    function voteView(pid) {
        const g = G();
        return withPass(pid, t('lw_vote_pass'), () => {
            const s = lw();
            const send = async () => {
                if (s.pick === null) return;
                const r = await C.run('vote', { player_id: pid, target: s.pick });
                if (r) { C.ui.passed = null; s.pick = null; C.vibrate(15); C.scheduleRender(true); }
            };
            return h('div', { class: 'stack' },
                h('div', { class: 'center' },
                    h('div', { class: 'muted small' }, t('voting_as', { name: C.pname(pid) })),
                    h('h2', null, t('lw_vote_title')),
                    g.vote.forced ? h('div', { class: 'chip warn' }, t('final_vote')) : null),
                pickList([...g.alive.filter((id) => id !== pid).map((id) => ({ id, label: C.pname(id) })), { id: NOBODY, label: t('lw_nobody') }],
                    s.pick, (id) => { s.pick = id; C.scheduleRender(); }),
                h('div', { class: 'bottom-bar' }, h('button', { class: 'btn primary big', disabled: s.pick === null, onclick: send }, t('confirm_vote'))));
        });
    }

    // ---------- entry points used by app.js ----------
    function playView() {
        const g = G();
        const s = lw();
        if (s.review) return reviewView();
        const mine = g.me;
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
        const stamp = { village: t('lw_win_village'), wolves: t('lw_win_wolves'), none: t('lw_win_none') }[res.winner];
        const cls = res.winner === 'village' ? 'civilians' : res.winner === 'wolves' ? 'spies' : 'none';
        return h('section', { class: 'panel result ' + cls },
            h('div', { class: 'stamp result-stamp' }, stamp),
            h('div', { class: 'muted' }, t('lw_reason_' + res.reason)),
            h('ul', { class: 'result-list' }, g.in_game.filter((id) => C.playerById(id)).map((id) => {
                const role = res.roles[id];
                return h('li', { class: role === 'wolf' ? 'is-spy' : '' },
                    h('span', null, C.pname(id) + (isAlive(id) ? '' : ' †')),
                    h('span', { class: 'role' }, role ? roleName(role) : ''));
            })));
    }

    function summary() {
        const s = C.state.settings;
        const chips = [s.wolves_mode === 'auto' ? t('lw_sum_wolves_auto') : t('lw_sum_wolves', { n: s.wolves })];
        for (const r of ['seer', 'guard', 'witch', 'hunter']) if (s[r]) chips.push(roleName(r));
        if (s.day_timer) chips.push(t('sum_timer', { n: s.day_min }));
        if (s.scores) chips.push(t('set_scores'));
        return h('div', { class: 'chips' }, chips.map((c) => h('span', { class: 'chip soft' }, c)));
    }

    function settings(s, { set, toggle, stepper, host }) {
        const wolves = h('div', { class: 'set-row' },
            h('div', { class: 'set-text' }, h('span', { class: 'set-title' }, t('lw_set_wolves')), h('span', { class: 'set-desc' }, t('lw_set_wolves_d'))),
            h('div', { class: 'segmented' },
                h('button', { class: s.wolves_mode === 'auto' ? 'on' : '', disabled: !host, onclick: () => set({ wolves_mode: 'auto' }) }, t('lw_auto')),
                h('button', { class: s.wolves_mode === 'fixed' ? 'on' : '', disabled: !host, onclick: () => set({ wolves_mode: 'fixed' }) }, t('spies_fixed'))),
            s.wolves_mode === 'fixed' ? stepper('wolves', t('how_many'), 1, 9) : null);
        return [
            wolves,
            toggle('seer', roleName('seer'), t('lw_desc_seer')),
            toggle('guard', roleName('guard'), t('lw_desc_guard')),
            toggle('witch', roleName('witch'), t('lw_desc_witch')),
            toggle('hunter', roleName('hunter'), t('lw_desc_hunter')),
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
