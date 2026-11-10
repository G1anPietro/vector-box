// lib/spia-admin.js
// Served by api/spia.php?action=ext to admin sessions only (never a public file).
//  - Long-press the game title (0.8s): LIVE panel with every room and every role.
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
        it: { live: 'LIVE', none: 'Nessuna stanza attiva.', waiting: 'In attesa del round', round: 'Round', spies: 'spie', spy: 'SPIA', you: 'tu', fake: 'finto', out: 'fuori', voted: 'vota', phones: 'telefoni', ended: 'finito', close: 'Chiudi' },
        en: { live: 'LIVE', none: 'No active rooms.', waiting: 'Waiting for a round', round: 'Round', spies: 'spies', spy: 'SPY', you: 'you', fake: 'fake', out: 'out', voted: 'votes', phones: 'phones', ended: 'over', close: 'Close' },
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
        panel = h('div', {
            style: 'position:fixed;inset:0;z-index:100;background:#18213b;overflow-y:auto;padding:calc(12px + env(safe-area-inset-top)) 14px calc(24px + env(safe-area-inset-bottom));',
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
        const body = !rooms ? [] : !rooms.length ? [h('p', { class: 'muted' }, tx('none'))] : rooms.map(roomCard);
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

    function roomCard(room) {
        const r = room.round;
        const custom = r ? r.custom_locations : [];
        const mine = App.state && App.state.code === room.code;
        const title = h('div', { style: 'display:flex;justify-content:space-between;gap:8px;align-items:baseline;flex-wrap:wrap;' },
            h('strong', { style: 'font-size:20px;letter-spacing:3px;color:' + (mine ? '#2f6b5e' : '#1f2433') + ';' }, room.code),
            h('span', { class: 'muted small' }, `${room.phones_online}/${room.phones} ${tx('phones')}`));
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

    // Never leave the panel open when the phone goes to sleep or changes hands
    document.addEventListener('visibilitychange', () => { if (document.hidden) closeLive(); });
})();
