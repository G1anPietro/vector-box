// public/js/poker.js
document.addEventListener("DOMContentLoaded", () => {
    let currentRoomTarget = 'general';
    // Leaving the page aborts the poll in flight; don't report that as an error
    let leavingPage = false;
    window.addEventListener('pagehide', () => { leavingPage = true; });
    window.addEventListener('beforeunload', () => { leavingPage = true; });

    const potVal = document.getElementById('poker-pot-val');
    const stageIndicator = document.getElementById('poker-stage-indicator');
    const communityBox = document.getElementById('poker-community-cards');
    const seatsGrid = document.getElementById('poker-seats-grid');
    const winnerBanner = document.getElementById('poker-winner-banner');
    
    const btnJoin = document.getElementById('poker-btn-join');
    const btnLeave = document.getElementById('poker-btn-leave');
    const btnDeal = document.getElementById('poker-btn-deal');
    const btnFold = document.getElementById('poker-btn-fold');
    const btnCall = document.getElementById('poker-btn-call');
    const btnRaise = document.getElementById('poker-btn-raise');
    const betInput = document.getElementById('poker-bet-input');

    const btnJoinRoom = document.getElementById('poker-btn-join-room');
    const joinRoomInput = document.getElementById('poker-join-input');

    const btnCreateRoom = document.getElementById('poker-btn-create-room');
    const createNameInput = document.getElementById('poker-create-name');
    const createCodeInput = document.getElementById('poker-create-code');
    const createBotsSelect = document.getElementById('poker-create-bots');

    if (!seatsGrid) return;

    // ---- Leaderboard ----------------------------------------------------------
    const btnLeaderboard = document.getElementById('poker-btn-leaderboard');
    const leaderboardBox = document.getElementById('poker-leaderboard');

    const renderLeaderboard = (data) => {
        leaderboardBox.replaceChildren();
        const title = document.createElement('div');
        title.style.cssText = 'color:#ffc800; font-weight:bold; margin-bottom:4px;';
        title.textContent = '== ' + VBLang.t('pk_top') + ' ==';
        leaderboardBox.appendChild(title);

        const line = (cells, color) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:grid; grid-template-columns: 2.2em 1fr 4.5em 4.5em 6em; gap:6px; padding:1px 0;';
            if (color) row.style.color = color;
            cells.forEach((c) => {
                const span = document.createElement('span');
                span.textContent = String(c);
                span.style.overflow = 'hidden';
                span.style.textOverflow = 'ellipsis';
                span.style.whiteSpace = 'nowrap';
                row.appendChild(span);
            });
            leaderboardBox.appendChild(row);
        };

        line(['#', VBLang.t('pk_player'), VBLang.t('pk_won'), 'WIN%', VBLang.t('pk_crwon')], 'var(--text-muted, #8ab4f8)');
        if (!data.top.length) {
            const empty = document.createElement('div');
            empty.className = 'term-muted';
            empty.textContent = VBLang.t('pk_nohands');
            leaderboardBox.appendChild(empty);
        }
        data.top.forEach((r) => line([r.rank, r.username, `${r.hands_won}/${r.hands_played}`, `${r.win_rate}%`, r.chips_won]));
        if (data.me && !data.top.some((r) => r.username === data.me.username)) {
            line(['..', '', '', '', '']);
            line([data.me.rank, data.me.username, `${data.me.hands_won}/${data.me.hands_played}`, `${data.me.win_rate}%`, data.me.chips_won], '#00f3ff');
        }
        if (data.me) {
            const best = document.createElement('div');
            best.className = 'term-muted';
            best.style.marginTop = '4px';
            best.textContent = VBLang.t('pk_biggest', { n: data.me.biggest_pot });
            leaderboardBox.appendChild(best);
        }
    };

    if (btnLeaderboard && leaderboardBox) {
        btnLeaderboard.addEventListener('click', async () => {
            if (!leaderboardBox.classList.contains('hidden')) {
                leaderboardBox.classList.add('hidden');
                return;
            }
            leaderboardBox.classList.remove('hidden');
            leaderboardBox.textContent = VBLang.t('loading');
            try {
                const res = await fetch('api/poker_leaderboard.php', { credentials: 'same-origin' });
                const data = await res.json();
                if (data.success) renderLeaderboard(data);
                else leaderboardBox.textContent = '>> ' + VBLang.t('pk_lb_fail');
            } catch (err) {
                leaderboardBox.textContent = '>> ' + VBLang.t('pk_lb_fail');
            }
        });
    }

    window.switchPokerRoom = (roomOrCode) => {
        currentRoomTarget = roomOrCode || 'general';
        fetchPokerState();
    };

    const parseCard = (cardStr) => {
        if (!cardStr || cardStr === '??') {
            return { rank: '?', suitSymbol: '🂠', color: '#555555' };
        }

        const suitChar = cardStr.slice(-1).toLowerCase();
        const rank = cardStr.slice(0, -1);

        const suits = {
            'h': { symbol: '♥', color: '#ff4444' },
            'd': { symbol: '♦', color: '#ff4444' },
            'c': { symbol: '♣', color: '#00f3ff' },
            's': { symbol: '♠', color: '#00f3ff' }
        };

        const suitInfo = suits[suitChar] || { symbol: suitChar, color: 'var(--accent-color)' };
        return { rank, suitSymbol: suitInfo.symbol, color: suitInfo.color };
    };

    const renderCard = (cardStr) => {
        const { rank, suitSymbol, color } = parseCard(cardStr);

        const span = document.createElement('span');
        span.className = 'poker-card';
        span.style.cssText = `
            background: #020304;
            border: 1px solid ${color};
            color: ${color};
            font-family: monospace;
            font-size: 0.85rem;
            font-weight: bold;
            padding: 3px 6px;
            border-radius: 3px;
            display: inline-flex;
            align-items: center;
            gap: 2px;
            box-shadow: 0 0 5px ${color}33;
        `;

        span.innerHTML = `<span>${rank}</span><span style="font-size: 1rem; line-height: 1;">${suitSymbol}</span>`;
        return span;
    };

    const fetchPokerState = async () => {
        try {
            const res = await fetch(`api/poker.php?action=state&table_id=${currentRoomTarget}`);
            const data = await res.json();

            if (data.success) {
                currentRoomTarget = data.table.id;
                if (potVal) potVal.textContent = data.table.pot;
                if (stageIndicator) {
                    const codeDisplay = data.table.room_code ? ` [CODE: ${data.table.room_code}]` : '';
                    stageIndicator.textContent = `${VBLang.t('pk_room')}: #${data.table.id}${codeDisplay} // ${VBLang.t('pk_stage')}: ${data.table.game_stage}`;
                }

                if (winnerBanner) {
                    if (data.table.last_winner_msg) {
                        winnerBanner.classList.remove('hidden');
                        winnerBanner.textContent = `>> ${data.table.last_winner_msg}`;
                    } else {
                        winnerBanner.classList.add('hidden');
                    }
                }

                if (communityBox) {
                    communityBox.innerHTML = '';
                    if (data.table.community_cards && data.table.community_cards.length > 0) {
                        data.table.community_cards.forEach(c => communityBox.appendChild(renderCard(c)));
                    } else {
                        communityBox.innerHTML = '<span style="color:var(--text-muted); font-size:0.75rem;">' + VBLang.t('pk_nocards') + '</span>';
                    }
                }

                seatsGrid.innerHTML = '';
                if (data.players && data.players.length > 0) {
                    data.players.forEach(p => {
                        const isCurrentTurn = (p.seat === data.table.current_turn_seat && data.table.game_stage !== 'WAITING' && data.table.game_stage !== 'SHOWDOWN');
                        const box = document.createElement('div');
                        box.className = `poker-seat-box ${isCurrentTurn ? 'active-turn' : ''}`;
                        box.style.cssText = `
                            background: ${p.is_folded ? 'rgba(20,0,0,0.4)' : 'rgba(0, 0, 0, 0.6)'};
                            border: 1px solid ${isCurrentTurn ? 'var(--accent-color)' : 'var(--border-color)'};
                            padding: 8px;
                            border-radius: 3px;
                            opacity: ${p.is_folded ? '0.5' : '1'};
                        `;

                        box.innerHTML = `
                            <div style="display:flex; justify-content:space-between; font-weight:bold; font-size:0.8rem;">
                                <span style="color:${isCurrentTurn ? 'var(--accent-color)' : '#fff'};">
                                    <span class="pk-name"></span> ${p.is_bot ? '[BOT]' : ''} ${p.is_folded ? '<small>(' + VBLang.t('pk_folded') + ')</small>' : ''}
                                </span>
                                <span style="color:#ffaa00;">${Number(p.chips) || 0} CR</span>
                            </div>
                            <div class="card-row" style="display:flex; gap:4px; margin-top:6px;"></div>
                        `;

                        box.querySelector('.pk-name').textContent = p.username;   // names go in as text
                        const cardRow = box.querySelector('.card-row');
                        if (p.hole_cards && p.hole_cards.length > 0) {
                            p.hole_cards.forEach(c => cardRow.appendChild(renderCard(c)));
                        }
                        seatsGrid.appendChild(box);
                    });
                } else {
                    seatsGrid.innerHTML = '<div style="grid-column: span 2; text-align: center; color: var(--text-muted); padding: 20px;"></div>';
                    seatsGrid.firstChild.textContent = '>> ' + VBLang.t('pk_empty');
                }
            }
        } catch (err) {
            if (!leavingPage && err && err.name !== 'AbortError') console.error("Poker State Fetch Error:", err);
        }
    };

    if (btnJoinRoom && joinRoomInput) {
        btnJoinRoom.addEventListener('click', () => {
            const target = joinRoomInput.value.trim();
            if (target) {
                window.switchPokerRoom(target);
                joinRoomInput.value = '';
            }
        });
    }

    if (btnCreateRoom && createNameInput) {
        btnCreateRoom.addEventListener('click', async () => {
            const name = createNameInput.value.trim();
            const code = createCodeInput.value.trim();
            const bots = createBotsSelect.value;

            if (!name) return;

            const res = await fetch('api/poker.php?action=create_room', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `room_name=${encodeURIComponent(name)}&room_code=${encodeURIComponent(code)}&bot_count=${bots}`
            });
            const data = await res.json();

            if (data.success) {
                createNameInput.value = '';
                createCodeInput.value = '';
                window.switchPokerRoom(data.room_id);
            } else {
                alert(data.error || VBLang.t('pk_create_fail'));
            }
        });
    }

    if (btnJoin) {
        btnJoin.addEventListener('click', async () => {
            const res = await fetch(`api/poker.php?action=join&table_id=${currentRoomTarget}`, { method: 'POST' });
            const data = await res.json();
            if (data.table_id) currentRoomTarget = data.table_id;
            fetchPokerState();
        });
    }

    if (btnLeave) {
        btnLeave.addEventListener('click', async () => {
            await fetch(`api/poker.php?action=leave&table_id=${currentRoomTarget}`, { method: 'POST' });
            fetchPokerState();
        });
    }

    if (btnDeal) {
        btnDeal.addEventListener('click', async () => {
            await fetch(`api/poker.php?action=deal&table_id=${currentRoomTarget}`, { method: 'POST' });
            fetchPokerState();
        });
    }

    if (btnCall) {
        btnCall.addEventListener('click', async () => {
            await fetch(`api/poker.php?action=play&table_id=${currentRoomTarget}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'user_action=call'
            });
            fetchPokerState();
        });
    }

    if (btnRaise && betInput) {
        btnRaise.addEventListener('click', async () => {
            const amt = betInput.value || 40;
            await fetch(`api/poker.php?action=play&table_id=${currentRoomTarget}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `user_action=raise&raise_amount=${amt}`
            });
            fetchPokerState();
        });
    }

    if (btnFold) {
        btnFold.addEventListener('click', async () => {
            await fetch(`api/poker.php?action=play&table_id=${currentRoomTarget}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'user_action=fold'
            });
            fetchPokerState();
        });
    }

    setInterval(() => { if (!document.hidden) fetchPokerState(); }, 2000);   // a hidden tab does not poll (it runs bots and writes)
    fetchPokerState();
});