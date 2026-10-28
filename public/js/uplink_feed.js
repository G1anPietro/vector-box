// public/js/uplink_feed.js
document.addEventListener("DOMContentLoaded", () => {
    const chatLog = document.getElementById('uplink-chat-log');
    const chatInput = document.getElementById('chat-feed-input');
    const feedTermBox = document.getElementById('feed-term-box');
    const tabsContainer = document.getElementById('chat-room-tabs');
    const promptLabel = document.getElementById('chat-prompt-label');

    if (!chatLog) return;

    window.activeRoomId = 'general';
    window.chatRooms = [];
    
    const roomStates = {}; 
    const unreadCounts = {};

    let eventSource = null;
    let isSubmitting = false;
    let isLoadingHistory = false;

    window.SESSION_STATE = window.SESSION_STATE || { isAdmin: false, csrfToken: '' };

    const checkSessionState = async () => {
        try {
            const res = await fetch('api/check_session.php', { credentials: 'same-origin' });
            const data = await res.json();
            if (data) {
                window.SESSION_STATE.isAdmin = data.is_admin === 1;
                window.SESSION_STATE.csrfToken = data.csrf_token || '';

                if (typeof loadAdminCommandsIfEligible === 'function') {
                    loadAdminCommandsIfEligible();
                }
            }
        } catch (err) {
            console.error("Error checking session:", err);
        }
    };

    const getRoomState = (roomId) => {
        if (!roomStates[roomId]) {
            roomStates[roomId] = {
                messages: [],
                oldestId: 0,
                latestId: 0,
                hasMore: true,
                lastAppendedDate: null,
                isInitialized: false
            };
        }
        return roomStates[roomId];
    };

    const scrollToBottom = () => {
        requestAnimationFrame(() => {
            if (chatLog) chatLog.scrollTop = chatLog.scrollHeight;
            if (feedTermBox) feedTermBox.scrollTop = feedTermBox.scrollHeight;
        });
    };

    const formatDateLabel = (rawDate) => {
        if (!rawDate) return '';
        const today = new Date().toISOString().substring(0, 10);
        return rawDate === today ? 'Today' : rawDate;
    };

    const createDateSeparator = (dateStr) => {
        const div = document.createElement('div');
        div.className = 'date-separator';
        div.setAttribute('data-date', dateStr);
        div.style.cssText = 'text-align: center; color: #8ab4f8; font-size: 0.75rem; margin: 12px 0 6px 0; opacity: 0.8; font-weight: bold; user-select: none;';
        div.textContent = `─── ${formatDateLabel(dateStr)} ───`;
        return div;
    };

    const createMessageElement = (data, isError = false) => {
        const p = document.createElement('p');
        if (data.id) p.id = `msg-${data.id}`;
        p.className = 'term-white';
        p.style.cssText = 'margin: 2px 0; word-break: break-all; line-height: 1.3; display: flex; align-items: center;';

        if (window.SESSION_STATE.isAdmin && data.id && !isError) {
            const delBtn = document.createElement('button');
            delBtn.textContent = '[X]';
            delBtn.title = 'Delete transmission';
            delBtn.style.cssText = 'background: none; border: none; color: #ff3333; cursor: pointer; margin-right: 8px; font-size: 0.75rem; font-family: inherit; font-weight: bold; flex-shrink: 0;';
            delBtn.addEventListener('click', async () => {
                try {
                    const res = await fetch('api/delete_message.php', {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json', 
                            'X-CSRF-Token': window.SESSION_STATE.csrfToken || '' 
                        },
                        credentials: 'same-origin',
                        body: JSON.stringify({ id: data.id })
                    });
                    const resData = await res.json();
                    if (resData.success) p.remove();
                } catch (err) {}
            });
            p.appendChild(delBtn);
        }

        const timeSpan = document.createElement('span');
        timeSpan.style.cssText = 'color: #8ab4f8; margin-right: 6px; font-size: 0.8rem;';
        timeSpan.textContent = `[${data.created_at || 'LOGGED'}]`;

        const userSpan = document.createElement('span');
        userSpan.style.cssText = 'color: var(--accent-color); font-weight: bold; margin-right: 8px;';
        userSpan.textContent = `${data.username || 'guest'}:`;

        const textSpan = document.createElement('span');
        textSpan.style.color = isError ? '#ff3333' : '#ffffff';
        textSpan.textContent = data.message;

        p.appendChild(timeSpan);
        p.appendChild(userSpan);
        p.appendChild(textSpan);

        return p;
    };

    const renderRoomTabs = () => {
        if (!tabsContainer) return;
        tabsContainer.innerHTML = '';

        window.chatRooms.forEach(room => {
            const tabBtn = document.createElement('button');
            tabBtn.className = `chat-tab ${room.id === window.activeRoomId ? 'active' : ''}`;
            tabBtn.innerHTML = `<span>#${room.name}</span>`;

            if (unreadCounts[room.id] > 0 && room.id !== window.activeRoomId) {
                const badge = document.createElement('span');
                badge.className = 'unread-badge';
                badge.textContent = unreadCounts[room.id];
                tabBtn.appendChild(badge);
            }

            tabBtn.addEventListener('click', () => window.switchChatRoom(room.id));
            tabsContainer.appendChild(tabBtn);
        });

        if (promptLabel) promptLabel.textContent = `#${window.activeRoomId}:$`;
    };

    const appendMessageToUI = (data, state, isError = false) => {
        if (data.date && data.date !== state.lastAppendedDate) {
            chatLog.appendChild(createDateSeparator(data.date));
            state.lastAppendedDate = data.date;
        }
        chatLog.appendChild(createMessageElement(data, isError));
        scrollToBottom();
    };

    const renderFullBuffer = (state) => {
        chatLog.innerHTML = '';
        state.lastAppendedDate = null;
        
        state.messages.forEach(msg => {
            if (msg.date && msg.date !== state.lastAppendedDate) {
                chatLog.appendChild(createDateSeparator(msg.date));
                state.lastAppendedDate = msg.date;
            }
            chatLog.appendChild(createMessageElement(msg));
        });
        scrollToBottom();
    };

    const prependMessages = (state, newMessages) => {
        const oldScrollHeight = chatLog.scrollHeight;
        const fragment = document.createDocumentFragment();

        let currentGroupDate = null;

        newMessages.forEach(msg => {
            if (msg.date && msg.date !== currentGroupDate) {
                currentGroupDate = msg.date;
                fragment.appendChild(createDateSeparator(msg.date));
            }
            fragment.appendChild(createMessageElement(msg));
        });

        chatLog.insertBefore(fragment, chatLog.firstChild);
        chatLog.scrollTop = chatLog.scrollHeight - oldScrollHeight;
    };

    const loadOlderHistory = async () => {
        const state = getRoomState(window.activeRoomId);
        if (isLoadingHistory || !state.hasMore || !state.oldestId) return false;

        isLoadingHistory = true;
        try {
            const res = await fetch(`api/get_feed.php?room_id=${window.activeRoomId}&before_id=${state.oldestId}&limit=25`);
            const data = await res.json();

            if (data.success && data.messages.length > 0) {
                state.messages = [...data.messages, ...state.messages];
                state.oldestId = data.messages[0].id;
                state.hasMore = data.has_more;
                prependMessages(state, data.messages);
                return true;
            } else {
                state.hasMore = false;
                return false;
            }
        } catch (err) {
            return false;
        } finally {
            isLoadingHistory = false;
        }
    };

    const fillFeedToOverflow = async () => {
        const state = getRoomState(window.activeRoomId);

        if (!state.isInitialized) {
            try {
                const res = await fetch(`api/get_feed.php?room_id=${window.activeRoomId}&limit=25`);
                const data = await res.json();

                state.isInitialized = true;
                if (data.success && data.messages.length > 0) {
                    state.messages = data.messages;
                    state.oldestId = data.messages[0].id;
                    state.latestId = data.messages[data.messages.length - 1].id;
                    state.hasMore = data.has_more;
                } else {
                    state.hasMore = false;
                }
            } catch (err) {}
        }

        renderFullBuffer(state);

        let safetyCap = 0;
        while (state.hasMore && chatLog.scrollHeight <= chatLog.clientHeight + 100 && safetyCap < 10) {
            safetyCap++;
            const loadedMore = await loadOlderHistory();
            if (!loadedMore) break;
        }
    };

    chatLog.addEventListener('scroll', () => {
        if (chatLog.scrollTop < 30) {
            loadOlderHistory();
        }
    });

    if (typeof ResizeObserver !== 'undefined') {
        const resizeObserver = new ResizeObserver(() => {
            const state = getRoomState(window.activeRoomId);
            if (state.hasMore && chatLog.scrollHeight <= chatLog.clientHeight + 50) {
                fillFeedToOverflow();
            }
        });
        resizeObserver.observe(chatLog);
    }

    window.switchChatRoom = async (roomId) => {
        window.activeRoomId = roomId;
        unreadCounts[roomId] = 0;
        renderRoomTabs();
        await fillFeedToOverflow();
    };

    window.fetchChatRooms = async () => {
        try {
            const res = await fetch('api/rooms.php');
            const data = await res.json();
            if (data.success) {
                window.chatRooms = data.rooms;
                renderRoomTabs();
            }
        } catch (err) {}
    };

    const initSSE = () => {
        if (eventSource) eventSource.close();
        eventSource = new EventSource(`api/uplink_stream.php`);

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                const rId = data.room_id || 'general';
                const state = getRoomState(rId);

                if (data.id && data.id > state.latestId) {
                    state.latestId = data.id;
                    state.messages.push(data);

                    if (rId === window.activeRoomId) {
                        appendMessageToUI(data, state);
                    } else {
                        unreadCounts[rId] = (unreadCounts[rId] || 0) + 1;
                        renderRoomTabs();
                    }
                }
            } catch (err) {}
        };
    };

    if (chatInput) {
        chatInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const text = chatInput.value.trim();
                if (!text || isSubmitting) return;

                isSubmitting = true;
                try {
                    const headers = { 'Content-Type': 'application/json' };
                    if (window.SESSION_STATE.csrfToken) {
                        headers['X-CSRF-Token'] = window.SESSION_STATE.csrfToken;
                    }

                    const res = await fetch('api/uplink_send.php', {
                        method: 'POST',
                        headers: headers,
                        credentials: 'same-origin',
                        body: JSON.stringify({ message: text, room_id: window.activeRoomId })
                    });
                    const data = await res.json();
                    if (data.success) {
                        chatInput.value = '';
                    } else {
                        const state = getRoomState(window.activeRoomId);
                        appendMessageToUI({
                            created_at: new Date().toISOString().substring(11, 19),
                            username: 'SYSTEM',
                            message: `>> WARNING: ${data.error}`
                        }, state, true);
                    }
                } catch (err) {
                    console.error("Send Error:", err);
                } finally {
                    isSubmitting = false;
                    chatInput.focus();
                }
            }
        });
    }

    const init = async () => {
        await checkSessionState();
        await window.fetchChatRooms();
        await window.switchChatRoom('general');
        initSSE();
    };

    init();
});