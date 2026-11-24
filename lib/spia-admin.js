// lib/spia-admin.js
// Served by api/spia.php?action=ext to admin sessions only (never a public file).
//  - A small LIVE button (bottom left, faint) or a long press on the game title (0.8s): the LIVE panel with every room, every role,
//    every location; in Cucù every player's card and lives, in Botola the right answer and what everybody chose, in "Most likely to" who voted for whom, in "Would you rather" who picked A or B, in "The bomb" who holds it (never the fuse: nobody knows it but the server). It works on any screen, also when you are not in a room and when the
//    players use other phones. In a Cucù room it opens as a half-height sheet, so the table stays in view.
//  - Long-press one of your names on "this phone": marks that player as you.
//  - When you are the spy your card looks like a normal one, with a small dot in the corner.
(() => {
    'use strict';
    const App = window.SpiaApp;
    if (!App || window.__spiaExt) return;
    window.__spiaExt = true;
    const { h } = App;
    const HOLD_MS = 800;

    const TXT = {
        it: { live: 'LIVE', none: 'Nessuna stanza attiva.', waiting: 'In attesa del round', round: 'Round', spies: 'spie', spy: 'SPIA', you: 'tu', fake: 'finto', out: 'fuori', voted: 'vota', phones: 'telefoni', ended: 'finito', close: 'Chiudi', lives: 'vite', card: 'carta', dealer: 'mazziere', turn: 'tocca a', hand: 'mano', dead: 'fuori gioco', nocard: 'nessuna carta', recite: 'recita', knock: 'bussate', swap: 'scambi', confirm: 'conferma', level: 'livello', question: 'domanda', right: 'giusta', noanswer: 'non ha risposto', vote: 'vota', novote: 'non ha votato', marks: 'segni', sentence: 'frase', points: 'punti', choose: 'sceglie', nochoice: 'non ha scelto', holds: 'ha la bomba', exploded: 'esplosa', prompt: 'richiesta' },
        en: { live: 'LIVE', none: 'No active rooms.', waiting: 'Waiting for a round', round: 'Round', spies: 'spies', spy: 'SPY', you: 'you', fake: 'fake', out: 'out', voted: 'votes', phones: 'phones', ended: 'over', close: 'Close', lives: 'lives', card: 'card', dealer: 'dealer', turn: 'turn', hand: 'hand', dead: 'out', nocard: 'no card', recite: 'recital', knock: 'knocks', swap: 'swaps', confirm: 'confirm', level: 'level', question: 'question', right: 'right', noanswer: 'no answer', vote: 'votes', novote: 'no vote', marks: 'marks', sentence: 'sentence', points: 'points', choose: 'picks', nochoice: 'no pick', holds: 'holds the bomb', exploded: 'blown', prompt: 'prompt' },
    };
    const tx = (k) => (TXT[App.lang] || TXT.en)[k];

    // ---- long press helper (delegated: the app re-renders its DOM) ----
    let pressTimer = null;
    let pressStart = null;
    document.addEventListener('pointerdown', (e) => {
        const title = e.target.closest('#spia-title');
        const chip = e.target.closest('#my-players .name-chip[data-player-id]');
        if (!title && !chip) return;
        if (chip && e.target.closest('button')) return;
        pressStart = { x: e.clientX, y: e.clientY };
        pressTimer = setTimeout(() => {
            pressTimer = null;
            if (title) openLive();
            else markMe(+chip.dataset.playerId);
        }, HOLD_MS);
    });
    const cancel = () => { clearTimeout(pressTimer); pressTimer = null; };
    document.addEventListener('pointerup', cancel);
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('pointermove', (e) => {
        if (pressTimer && pressStart && Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > 12) cancel();
    });
    document.addEventListener('contextmenu', (e) => { if (e.target.closest('#spia-title, #my-players')) e.preventDefault(); });

    async function markMe(playerId) {
        try {
            await App.api('POST', { action: 'me', player_id: playerId });
            try { navigator.vibrate && navigator.vibrate([30, 60, 30]); } catch (e) { /* unsupported */ }
            App.refresh();
        } catch (e) { /* silent on purpose */ }
    }

    // ---- secret dot on your fake card ----
    window.addEventListener('spia:render', () => {
        const st = App.state;
        if (!st || !st.cards) return;
        document.querySelectorAll('.card-back[data-player]').forEach((el) => {
            const card = st.cards.find((c) => c.player_id === +el.dataset.player);
            if (card && card.x && !el.querySelector('.ext-dot')) {
                el.appendChild(h('span', {
                    class: 'ext-dot',
                    style: 'position:absolute;right:14px;bottom:14px;width:7px;height:7px;border-radius:50%;background:rgba(31,36,51,0.3);',
                }));
            }
        });
    });

    // ---- LIVE panel ----
    let panel = null;
    let liveTimer = null;

    function closeLive() {
        clearTimeout(liveTimer);
        if (panel) panel.remove();
        panel = null;
    }

    async function loadLive() {
        if (!panel) return;
        try {
            const data = await App.api('GET', null, '?action=live');
            renderLive(data.rooms);
        } catch (e) { /* keep last view */ }
        liveTimer = setTimeout(loadLive, 3000);
    }

    function openLive() {
        if (panel) return;
        try { navigator.vibrate && navigator.vibrate(20); } catch (e) { /* unsupported */ }
        const sheet = App.state && (App.state.game === 'cucu' || App.state.game === 'botola' || App.state.game === 'probabile' || App.state.game === 'preferiresti' || App.state.game === 'bomba') && App.state.code;      // in a Cucù or Botola room: half height, the table stays in view
        panel = h('div', {
            style: (sheet ? 'position:fixed;left:0;right:0;bottom:0;height:48vh;border-top:2px solid #ff8f86;' : 'position:fixed;inset:0;')
                + 'z-index:100;background:#18213b;overflow-y:auto;padding:calc(12px + env(safe-area-inset-top)) 14px calc(24px + env(safe-area-inset-bottom));',
        });
        document.body.appendChild(panel);
        renderLive(null);
        loadLive();
    }

    function renderLive(rooms) {
        if (!panel) return;
        const head = h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;position:sticky;top:0;background:#18213b;padding:4px 0;' },
            h('strong', { style: 'color:#ff8f86;letter-spacing:2px;' }, '● ' + tx('live')),
            h('button', { class: 'btn small', onclick: closeLive }, tx('close')));
        const here = App.state && App.state.code;
        const sorted = rooms ? [...rooms].sort((a, b) => (b.code === here) - (a.code === here)) : rooms;
        const body = !sorted ? [] : !sorted.length ? [h('p', { class: 'muted' }, tx('none'))] : sorted.map(roomCard);
        panel.replaceChildren(head, ...body);
    }

    function lupusCard(room, title) {
        const L = room.lupus;
        const names = Object.fromEntries(room.players.map((p) => [p.id, p.name]));
        const info = !L ? h('div', { class: 'muted small' }, tx('waiting'))
            : h('div', null,
                h('div', { style: 'font-size:20px;font-weight:700;color:#1f2433;' }, App.t('lw_title')),
                h('div', { class: 'muted small' }, `${App.t('lw_day_n', { n: L.day })} · ${L.phase}` + (L.status === 'ended' ? ` · ${tx('ended')}` : '')));
        const wolfPicks = L && L.night ? L.night.wolf || {} : {};
        const rows = room.players.map((p) => {
            const role = L ? L.roles[p.id] : null;
            const dead = L && role && !L.alive.includes(p.id);
            const extra = [];
            if (dead) extra.push(tx('out'));
            if (wolfPicks[p.id]) extra.push(`→ ${names[wolfPicks[p.id]] || '?'}`);
            if (L && L.votes && L.votes[p.id] !== undefined) extra.push(`${tx('voted')} → ${L.votes[p.id] === 0 ? '∅' : (names[L.votes[p.id]] || '?')}`);
            return h('li', { style: 'display:flex;justify-content:space-between;gap:10px;padding:7px 0;' + (dead ? 'opacity:0.5;' : '') },
                h('span', null, p.name, extra.length ? h('span', { class: 'muted small' }, ` (${extra.join(', ')})`) : null),
                h('span', { style: `color:${role === 'wolf' ? '#b8322a' : '#1f2433'};font-weight:700;text-align:right;` }, role ? App.t('lw_role_' + role) : ''));
        });
        return [title, info, h('ul', { style: 'list-style:none;' }, rows)];
    }

    const CU_RANK = { 1: 'A', 8: 'Fante', 9: 'Cavallo', 10: 'Re' };
    const CU_SUIT = { d: '♦ denari', c: '♥ coppe', s: '♠ spade', b: '♣ bastoni' };
    const cuCard = (c) => (c ? `${CU_RANK[c[1]] || c[1]} ${CU_SUIT[c[0]] || c[0]}` : '');

    /** Cucù: every player's lives and card (lives are hidden from the players; the admin sees them all). */
    function cucuCard(room, title) {
        const C = room.cucu;
        const info = !C ? h('div', { class: 'muted small' }, tx('waiting'))
            : h('div', { class: 'muted small' }, `${tx('hand')} ${C.hand} · ${tx(C.phase) || C.phase}` + (C.status === 'ended' ? ` · ${tx('ended')}` : ''));
        const rows = room.players.map((p) => {
            const lives = C ? C.lives[p.id] : undefined;
            const card = C && C.cards ? C.cards[p.id] : null;
            const dead = C && lives === 0;
            const tags = [];
            if (C && C.dealer === p.id) tags.push(tx('dealer'));
            if (C && C.turn === p.id) tags.push(tx('turn'));
            if (dead) tags.push(tx('dead'));
            return h('li', { style: 'display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.06);' + (dead ? 'opacity:0.5;' : '') },
                h('span', null, p.name, tags.length ? h('span', { class: 'muted small' }, ` (${tags.join(', ')})`) : null),
                h('span', { style: 'text-align:right;font-weight:700;' },
                    lives !== undefined ? h('span', { style: 'color:#ff8f86;margin-right:10px;' }, '♥'.repeat(Math.min(lives, 9)) || '0') : null,
                    h('span', { style: 'color:#1f2433;background:#f1e9d2;border-radius:6px;padding:2px 7px;' }, card ? cuCard(card) : tx('nocard'))));
        });
        return [title, info, h('ul', { style: 'list-style:none;' }, rows)];
    }

    const BO_SHAPE = ['▲', '●', '■', '◆'];
    /** Botola: the right answer and what every player chose, while the round is still open (the players do not see this). */
    function botolaCard(room, title) {
        const B = room.botola;
        const info = !B ? h('div', { class: 'muted small' }, tx('waiting'))
            : h('div', { class: 'muted small' }, `${tx('round')} ${B.round} · ${tx('level')} ${B.level} · ${tx(B.phase) || B.phase}` + (B.status === 'ended' ? ` · ${tx('ended')}` : ''));
        const q = B && B.question ? h('div', { style: 'margin:8px 0;' },
            h('div', { style: 'font-weight:700;margin-bottom:4px;' }, B.question),
            h('ol', { style: 'list-style:none;' }, B.options.map((o, i) => h('li', { style: 'padding:2px 0;' + (i === B.right ? 'color:#7fe0a8;font-weight:700;' : 'opacity:0.8;') },
                `${BO_SHAPE[i]} ${o}`, i === B.right ? ` ✓ (${tx('right')})` : '')))) : null;
        const rows = room.players.map((p) => {
            const lives = B ? B.lives[p.id] : undefined;
            const dead = B && lives === 0;
            const a = B ? B.answers[p.id] : undefined;
            return h('li', { style: 'display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.06);' + (dead ? 'opacity:0.5;' : '') },
                h('span', null, p.name, dead ? h('span', { class: 'muted small' }, ` (${tx('dead')})`) : null),
                h('span', { style: 'text-align:right;font-weight:700;' },
                    lives !== undefined ? h('span', { style: 'color:#ff8f86;margin-right:10px;' }, '♥'.repeat(Math.min(lives, 5)) || '0') : null,
                    dead ? '' : (a === undefined ? h('span', { class: 'muted small' }, tx('noanswer')) : h('span', { style: B.right === a ? 'color:#7fe0a8;' : 'color:#ffb4a8;' }, BO_SHAPE[a]))));
        });
        return [title, info, q, h('ul', { style: 'list-style:none;' }, rows)];
    }

    /** "Most likely to": who votes for whom while the round is still open (the players never see this). */
    function probabileCard(room, title) {
        const P = room.probabile;
        const info = !P ? h('div', { class: 'muted small' }, tx('waiting'))
            : h('div', { class: 'muted small' }, `${tx('round')} ${P.round}/${P.rounds} · ${tx(P.phase) || P.phase}` + (P.status === 'ended' ? ` · ${tx('ended')}` : ''));
        const q = P && P.question ? h('div', { style: 'margin:8px 0;font-weight:700;' }, `${tx('sentence')}: ${P.question}`) : null;
        const nameOf = (id) => { const p = room.players.find((x) => x.id === Number(id)); return p ? p.name : '?'; };
        const rows = room.players.map((p) => {
            const v = P ? P.votes[p.id] : undefined;
            return h('li', { style: 'display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.06);' },
                h('span', null, p.name),
                h('span', { style: 'text-align:right;font-weight:700;' },
                    P && P.marks[p.id] ? h('span', { style: 'color:#ff8f86;margin-right:10px;' }, `${P.marks[p.id]} ${tx('marks')}`) : null,
                    v === undefined ? h('span', { class: 'muted small' }, tx('novote')) : h('span', { style: 'color:#7fe0a8;' }, '→ ' + nameOf(v))));
        });
        return [title, info, q, h('ul', { style: 'list-style:none;' }, rows)];
    }

    /** "Would you rather": who picked A or B while the round is still open (the players never see this). */
    function preferirestiCard(room, title) {
        const P = room.preferiresti;
        const info = !P ? h('div', { class: 'muted small' }, tx('waiting'))
            : h('div', { class: 'muted small' }, `${tx('round')} ${P.round}/${P.rounds} · ${tx(P.phase) || P.phase}` + (P.status === 'ended' ? ` · ${tx('ended')}` : ''));
        const q = P && P.a ? h('div', { style: 'margin:8px 0;font-weight:700;' }, `A: ${P.a}`, h('br'), `B: ${P.b}`) : null;
        const rows = room.players.map((p) => {
            const v = P ? P.votes[p.id] : undefined;
            return h('li', { style: 'display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.06);' },
                h('span', null, p.name),
                h('span', { style: 'text-align:right;font-weight:700;' },
                    P && P.points[p.id] ? h('span', { style: 'color:#ff8f86;margin-right:10px;' }, `${P.points[p.id]} ${tx('points')}`) : null,
                    v === undefined ? h('span', { class: 'muted small' }, tx('nochoice')) : h('span', { style: 'color:#7fe0a8;' }, v.toUpperCase())));
        });
        return [title, info, q, h('ul', { style: 'list-style:none;' }, rows)];
    }

    /** "The bomb": who holds it and the lives. The fuse is not here (the server never gives it to anybody). */
    function bombaCard(room, title) {
        const P = room.bomba;
        const info = !P ? h('div', { class: 'muted small' }, tx('waiting'))
            : h('div', { class: 'muted small' }, `${tx('round')} ${P.round} · ${P.phase === 'armed' ? '' : (tx(P.phase === 'boom' ? 'exploded' : 'ended') + ' · ')}` + (P.status === 'ended' ? tx('ended') : ''));
        const q = P && P.prompt ? h('div', { style: 'margin:8px 0;font-weight:700;' }, `${tx('prompt')}: ${P.prompt}`) : null;
        const rows = room.players.map((p) => {
            const n = P ? P.lives[p.id] : undefined;
            return h('li', { style: 'display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.06);' },
                h('span', null, p.name),
                h('span', { style: 'text-align:right;font-weight:700;' },
                    P && P.holder === p.id ? h('span', { style: 'color:#ffb066;margin-right:10px;' }, tx('holds')) : null,
                    n === undefined ? null : h('span', { style: n > 0 ? 'color:#7fe0a8;' : 'color:#ff8f86;' }, n > 0 ? `${n} ${tx('lives')}` : tx('out'))));
        });
        return [title, info, q, h('ul', { style: 'list-style:none;' }, rows)];
    }

    function roomCard(room) {
        const r = room.round;
        const custom = r ? r.custom_locations : [];
        const mine = App.state && App.state.code === room.code;
        const title = h('div', { style: 'display:flex;justify-content:space-between;gap:8px;align-items:baseline;flex-wrap:wrap;' },
            h('strong', { style: 'font-size:20px;letter-spacing:3px;color:' + (mine ? '#2f6b5e' : '#1f2433') + ';' }, room.code),
            h('span', { class: 'muted small' }, `${room.phones_online}/${room.phones} ${tx('phones')}`));
        if (room.game === 'bomba') {
            return h('section', { class: 'panel', style: 'margin-bottom:14px;' + (mine ? 'outline:3px solid #2f6b5e;outline-offset:-3px;' : '') }, bombaCard(room, title));
        }
        if (room.game === 'preferiresti') {
            return h('section', { class: 'panel', style: 'margin-bottom:14px;' + (mine ? 'outline:3px solid #2f6b5e;outline-offset:-3px;' : '') }, preferirestiCard(room, title));
        }
        if (room.game === 'probabile') {
            return h('section', { class: 'panel', style: 'margin-bottom:14px;' + (mine ? 'outline:3px solid #2f6b5e;outline-offset:-3px;' : '') }, probabileCard(room, title));
        }
        if (room.game === 'botola') {
            return h('section', { class: 'panel', style: 'margin-bottom:14px;' + (mine ? 'outline:3px solid #2f6b5e;outline-offset:-3px;' : '') }, botolaCard(room, title));
        }
        if (room.game === 'cucu') {
            return h('section', { class: 'panel', style: 'margin-bottom:14px;' + (mine ? 'outline:3px solid #2f6b5e;outline-offset:-3px;' : '') }, cucuCard(room, title));
        }
        if (room.game === 'lupus') {
            return h('section', { class: 'panel', style: 'margin-bottom:14px;' + (mine ? 'outline:3px solid #2f6b5e;outline-offset:-3px;' : '') }, lupusCard(room, title));
        }
        let info;
        if (!r) info = h('div', { class: 'muted small' }, tx('waiting'));
        else {
            info = h('div', null,
                h('div', { style: 'font-size:20px;font-weight:700;color:#1f2433;' }, App.locName(r.location_id, custom)),
                h('div', { class: 'muted small' }, `${tx('round')} ${r.number} · ${r.spy_count} ${tx('spies')}` + (r.status === 'ended' ? ` · ${tx('ended')}` : '')));
        }
        const names = Object.fromEntries(room.players.map((p) => [p.id, p.name]));
        const rows = room.players.map((p) => {
            let role = '';
            let color = '#1f2433';
            if (r && p.spy === true) { role = tx('spy'); color = '#b8322a'; }
            else if (r && p.role !== null) role = App.roleName(r.location_id, p.role, custom);
            const extra = [];
            if (p.me) extra.push(tx('you'));
            if (p.me && p.spy && p.fake_role !== null) extra.push(`${tx('fake')}: ${App.roleName(r.location_id, p.fake_role, custom)}`);
            if (p.out) extra.push(tx('out'));
            if (p.voted_for !== null && p.voted_for !== undefined) extra.push(`${tx('voted')} → ${p.voted_for === 0 ? '∅' : (names[p.voted_for] || '?')}`);
            return h('li', { style: 'display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.06);' + (p.out ? 'opacity:0.5;' : '') },
                h('span', null, h('span', { style: 'display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:8px;background:' + (p.online ? '#4f9d8c' : '#3a4566') + ';' }), p.name,
                    extra.length ? h('span', { class: 'muted small' }, ` (${extra.join(', ')})`) : null),
                h('span', { style: `color:${color};font-weight:700;text-align:right;` }, role));
        });
        return h('section', { class: 'panel', style: 'margin-bottom:14px;' + (mine ? 'outline:3px solid #2f6b5e;outline-offset:-3px;' : '') },
            title, info, h('ul', { style: 'list-style:none;' }, rows));
    }

    // A small faint button: the panel on any screen, without the long press (only admin sessions load this file)
    const btn = h('button', {
        type: 'button', 'aria-label': tx('live'),
        style: 'position:fixed;left:8px;bottom:calc(8px + env(safe-area-inset-bottom));z-index:90;font:700 11px/1 monospace;letter-spacing:1px;padding:7px 9px;border-radius:99px;border:1px solid rgba(255,143,134,0.6);background:rgba(24,33,59,0.55);color:#ff8f86;opacity:0.55;',
        onclick: () => (panel ? closeLive() : openLive()),
    }, '● ' + tx('live'));
    document.body.appendChild(btn);

    // Never leave the panel open when the phone goes to sleep or changes hands
    document.addEventListener('visibilitychange', () => { if (document.hidden) closeLive(); });
})();
