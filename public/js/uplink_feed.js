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
    const roomBuffers = {};
    const unreadCounts = {};

    let eventSource = null;
    let isSubmitting = false;

    window.SESSION_STATE = window.SESSION_STATE || { isAdmin: false, csrfToken: '' };

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
                        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.SESSION_STATE.csrfToken || '' },
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

    window.switchChatRoom = async (roomId) => {
        window.activeRoomId = roomId;
        unreadCounts[roomId] = 0;
        renderRoomTabs();
        chatLog.innerHTML = '';

        if (!roomBuffers[roomId]) {
            roomBuffers[roomId] = [];
            await fetchRoomHistory(roomId);
        } else {
            roomBuffers[roomId].forEach(msg => chatLog.appendChild(createMessageElement(msg)));
            scrollToBottom();
        }
    };

    const fetchRoomHistory = async (roomId) => {
        try {
            const res = await fetch(`api/get_feed.php?room_id=${roomId}&limit=30`);
            const data = await res.json();
            if (data.success) {
                roomBuffers[roomId] = data.messages;
                if (window.activeRoomId === roomId) {
                    chatLog.innerHTML = '';
                    data.messages.forEach(msg => chatLog.appendChild(createMessageElement(msg)));
                    scrollToBottom();
                }
            }
        } catch (err) {}
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
                if (!roomBuffers[rId]) roomBuffers[rId] = [];
                roomBuffers[rId].push(data);

                if (rId === window.activeRoomId) {
                    chatLog.appendChild(createMessageElement(data));
                    scrollToBottom();
                } else {
                    unreadCounts[rId] = (unreadCounts[rId] || 0) + 1;
                    renderRoomTabs();
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
                    const res = await fetch('api/uplink_send.php', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.SESSION_STATE.csrfToken || '' },
                        credentials: 'same-origin',
                        body: JSON.stringify({ message: text, room_id: window.activeRoomId })
                    });
                    const data = await res.json();
                    if (data.success) {
                        chatInput.value = '';
                    } else {
                        chatLog.appendChild(createMessageElement({
                            created_at: new Date().toISOString().substring(11, 19),
                            username: 'SYSTEM',
                            message: `>> WARNING: ${data.error}`
                        }, true));
                    }
                } catch (err) {
                } finally {
                    isSubmitting = false;
                    chatInput.focus();
                }
            }
        });
    }

    const init = async () => {
        await window.fetchChatRooms();
        await window.switchChatRoom('general');
        initSSE();
    };

    init();
});