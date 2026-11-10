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
    let streamResumeId = 0;   // newest message id known before the stream starts
    let reconnectTimer = null;
    let chatHub = null;       // { url, token } from check_session.php, null = PHP stream only
    let hubLastEventId = '';  // resume point on the hub ("<boot>-<seq>")
    let hubFailures = 0;
    const HUB_MAX_FAILURES = 3;
    const HUB_RETRY_MS = 5 * 60 * 1000;
    let isSubmitting = false;
    let isLoadingHistory = false;
    let usingHub = false;            // presence/typing only exist on the hub
    let lastTypingSent = 0;
    const typers = new Map();        // username -> expiry (ms) for the active room
    let onlineUsers = [];

    // Status line under the log: "● 3 online · alice is typing…" (hub only)
    const statusBar = document.createElement('div');
    statusBar.id = 'chat-status-bar';
    statusBar.style.cssText = 'display:none; font-size:0.72rem; color:var(--text-muted, #8ab4f8); padding:2px 6px; min-height:1.1em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; user-select:none;';
    const presenceSpan = document.createElement('span');
    const typingSpan = document.createElement('span');
    typingSpan.style.cssText = 'margin-left:10px; font-style:italic; color:var(--accent-color, #00f3ff);';
    statusBar.appendChild(presenceSpan);
    statusBar.appendChild(typingSpan);
    chatLog.insertAdjacentElement('afterend', statusBar);

    const renderStatusBar = () => {
        statusBar.style.display = usingHub ? 'block' : 'none';
        if (!usingHub) return;
        presenceSpan.textContent = `\u25CF ${onlineUsers.length} online`;
        presenceSpan.title = onlineUsers.join(', ');
        const now = Date.now();
        const names = [...typers].filter(([, exp]) => exp > now).map(([name]) => name);
        typingSpan.textContent = names.length === 0 ? ''
            : names.length === 1 ? `${names[0]} is typing\u2026`
            : names.length <= 3 ? `${names.join(', ')} are typing\u2026`
            : 'several people are typing\u2026';
    };
    setInterval(() => {
        const now = Date.now();
        let changed = false;
        for (const [name, exp] of typers) if (exp <= now) { typers.delete(name); changed = true; }
        if (changed) renderStatusBar();
    }, 1000);

    window.SESSION_STATE = window.SESSION_STATE || { isAdmin: false, csrfToken: '' };

    // Fill `container` with the message text, turning http(s) URLs into links.
    // Built with text nodes only: user text never goes through innerHTML.
    const appendTextWithLinks = (container, text) => {
        const urlRegex = /https?:\/\/[^\s]+/g;
        const str = String(text);
        let last = 0;
        let match;
        while ((match = urlRegex.exec(str)) !== null) {
            if (match.index > last) {
                container.appendChild(document.createTextNode(str.slice(last, match.index)));
            }
            const a = document.createElement('a');
            a.href = match[0];
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.style.cssText = 'color: var(--accent-color, #00f3ff); text-decoration: underline; word-break: break-all;';
            a.textContent = match[0];
            container.appendChild(a);
            last = match.index + match[0].length;
        }
        if (last < str.length) {
            container.appendChild(document.createTextNode(str.slice(last)));
        }
    };

    const checkSessionState = async () => {
        try {
            const res = await fetch('api/check_session.php', { credentials: 'same-origin' });
            const data = await res.json();
            if (data) {
                window.SESSION_STATE.isAdmin = data.is_admin === 1;
                window.SESSION_STATE.csrfToken = data.csrf_token || '';
                window.SESSION_STATE.username = data.username || '';
                chatHub = data.chat_stream && data.chat_stream.url && data.chat_stream.token
                    ? data.chat_stream : null;

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
        div.style.cssText = 'text-align: center; color: var(--text-muted, #8ab4f8); font-size: 0.75rem; margin: 12px 0 6px 0; opacity: 0.9; font-weight: bold; user-select: none;';
        div.textContent = `─── ${formatDateLabel(dateStr)} ───`;
        return div;
    };

    // ---- @mentions -------------------------------------------------------
    const escapeRegExp = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mentionsMe = (data) => {
        const me = window.SESSION_STATE.username;
        if (!me || !data || !data.message || data.username === me) return false;
        return new RegExp(`(^|[^\\w@])@${escapeRegExp(me)}(?![\\w-])`, 'i').test(data.message);
    };

    const baseTitle = document.title;
    let unseenMentions = 0;
    const updateTitle = () => {
        document.title = unseenMentions > 0 ? `(${unseenMentions}) ${baseTitle}` : baseTitle;
    };
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) { unseenMentions = 0; updateTitle(); }
    });

    // Called only for NEW live messages (not history)
    const notifyMention = (data) => {
        if (!document.hidden) return;
        unseenMentions++;
        updateTitle();
        if ('Notification' in window && Notification.permission === 'granted') {
            try {
                const n = new Notification(`${data.username} mentioned you in #${data.room_id || 'general'}`, {
                    body: String(data.message).slice(0, 140),
                    tag: `vb-mention-${data.id}`
                });
                n.onclick = () => { window.focus(); window.switchChatRoom(data.room_id || 'general'); n.close(); };
            } catch (err) {}
        }
    };

    // Names for @-completion: online users + recent authors
    const knownNames = () => {
        const names = new Set(onlineUsers);
        Object.values(roomStates).forEach((st) => st.messages.slice(-100).forEach((m) => m.username && names.add(m.username)));
        names.delete(window.SESSION_STATE.username);
        return [...names].sort();
    };

    const createMessageElement = (data, isError = false) => {
        const p = document.createElement('p');
        if (data.id) p.id = `msg-${data.id}`;
        p.className = 'chat-msg-row';
        if (!isError && mentionsMe(data)) {
            p.classList.add('chat-mention');
            p.style.cssText = 'background: rgba(255, 200, 0, 0.10); border-left: 2px solid #ffc800; padding-left: 4px;';
        }

        const prefixContainer = document.createElement('span');
        prefixContainer.className = 'chat-msg-prefix';

        if (window.SESSION_STATE.isAdmin && data.id && !isError) {
            const delBtn = document.createElement('button');
            delBtn.textContent = '[X]';
            delBtn.title = 'Delete transmission';
            delBtn.className = 'chat-del-btn';
            delBtn.addEventListener('click', async () => {
                try {
                    const res = await fetch('api/delete_message.php', {
                        method: 'POST',
                        // csrf.js adds X-CSRF-Token
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'same-origin',
                        body: JSON.stringify({ id: data.id })
                    });
                    const resData = await res.json();
                    if (resData.success) p.remove();
                } catch (err) {}
            });
            prefixContainer.appendChild(delBtn);
        }

        const timeSpan = document.createElement('span');
        timeSpan.className = 'chat-time-tag';
        timeSpan.textContent = `[${data.created_at || 'LOGGED'}]`;

        const userSpan = document.createElement('span');
        userSpan.className = 'chat-user-tag';
        userSpan.textContent = `${data.username || 'guest'}:`;

        prefixContainer.appendChild(timeSpan);
        prefixContainer.appendChild(userSpan);

        const textSpan = document.createElement('span');
        textSpan.className = 'chat-msg-body';
        // isError: true = red warning, 'notice' = green confirmation (e.g. moderation commands)
        if (isError) textSpan.style.color = isError === 'notice' ? '#33ff77' : '#ff3333';
        appendTextWithLinks(textSpan, data.message || '');

        p.appendChild(prefixContainer);
        p.appendChild(textSpan);

        return p;
    };

    const renderRoomTabs = () => {
        if (!tabsContainer) return;
        tabsContainer.innerHTML = '';

        window.chatRooms.forEach(room => {
            const tabBtn = document.createElement('button');
            tabBtn.className = `chat-tab ${room.id === window.activeRoomId ? 'active' : ''}`;
            const tabLabel = document.createElement('span');
            tabLabel.textContent = `#${room.name}`;
            tabBtn.appendChild(tabLabel);

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
                if (data.success && data.latest_id > streamResumeId) {
                    streamResumeId = data.latest_id;
                }
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
        typers.clear();
        renderStatusBar();
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

    const handleIncomingMessage = (data) => {
        if (!data || !data.id) return;
        if (data.id > streamResumeId) streamResumeId = data.id;
        const rId = data.room_id || 'general';
        const state = getRoomState(rId);
        if (data.id <= state.latestId) return; // already shown (history or replay)

        state.latestId = data.id;
        state.messages.push(data);
        if (mentionsMe(data)) notifyMention(data);
        if (typers.delete(data.username)) renderStatusBar();

        if (rId === window.activeRoomId) {
            appendMessageToUI(data, state);
        } else {
            unreadCounts[rId] = (unreadCounts[rId] || 0) + 1;
            renderRoomTabs();
        }
    };

    const handleDeletedMessage = (data) => {
        if (!data || !data.id) return;
        const state = roomStates[data.room_id];
        if (state) state.messages = state.messages.filter((m) => m.id !== data.id);
        const el = document.getElementById(`msg-${data.id}`);
        if (el) el.remove();
    };

    // The hub could not replay what we missed (first connect, Node restart, long
    // disconnect): pull the active room from PHP and mark the others stale.
    const resyncFromServer = async () => {
        Object.keys(roomStates).forEach((rId) => {
            if (rId !== window.activeRoomId) {
                roomStates[rId].isInitialized = false;
                roomStates[rId].messages = [];
                roomStates[rId].latestId = 0;
            }
        });
        try {
            const rId = window.activeRoomId;
            const res = await fetch(`api/get_feed.php?room_id=${encodeURIComponent(rId)}&limit=25`);
            const data = await res.json();
            if (!data.success || rId !== window.activeRoomId) return;
            const state = getRoomState(rId);
            const fresh = data.messages.filter((m) => m.id > state.latestId);
            if (fresh.length === data.messages.length && state.latestId > 0 && fresh.length > 0) {
                // Missed more than one page: rebuild the room from scratch
                state.messages = data.messages;
                state.oldestId = data.messages[0].id;
                state.latestId = data.messages[data.messages.length - 1].id;
                state.hasMore = data.has_more;
                renderFullBuffer(state);
            } else {
                fresh.forEach(handleIncomingMessage);
            }
        } catch (err) {}
    };

    const startStream = () => {
        clearTimeout(reconnectTimer);
        if (chatHub && hubFailures < HUB_MAX_FAILURES) {
            initHubSSE();
        } else {
            initSSE();
            // Node hub configured but failing: try it again later
            if (chatHub) {
                reconnectTimer = setTimeout(() => { hubFailures = 0; startStream(); }, HUB_RETRY_MS);
            }
        }
    };

    // Preferred: one SSE connection to the Node chat hub (pushes new + deleted messages)
    const initHubSSE = () => {
        if (eventSource) eventSource.close();

        const url = new URL(chatHub.url, location.href);
        url.searchParams.set('token', chatHub.token);
        if (hubLastEventId) url.searchParams.set('last_id', hubLastEventId);

        const es = new EventSource(url.href);
        eventSource = es;
        const track = (event) => { if (event.lastEventId) hubLastEventId = event.lastEventId; };

        es.onopen = () => { hubFailures = 0; usingHub = true; renderStatusBar(); };
        es.addEventListener('presence', (event) => {
            try {
                const data = JSON.parse(event.data);
                onlineUsers = Array.isArray(data.users) ? data.users.map(String) : [];
                renderStatusBar();
            } catch (err) {}
        });
        es.addEventListener('typing', (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.room_id !== window.activeRoomId || !data.username) return;
                typers.set(String(data.username), Date.now() + 4000);
                renderStatusBar();
            } catch (err) {}
        });
        es.onmessage = (event) => {
            track(event);
            try { handleIncomingMessage(JSON.parse(event.data)); } catch (err) {}
        };
        es.addEventListener('delete', (event) => {
            track(event);
            try { handleDeletedMessage(JSON.parse(event.data)); } catch (err) {}
        });
        es.addEventListener('ready', (event) => {
            track(event);
            resyncFromServer();
        });
        es.onerror = async () => {
            if (es !== eventSource) return;
            hubFailures++; // reset by onopen
            // CONNECTING: the browser retries by itself (with Last-Event-ID), up to a limit.
            // CLOSED: HTTP error (expired token -> 401, hub down -> 502).
            // Either way, after too many failures refresh the token and pick a stream again
            // (startStream falls back to PHP once HUB_MAX_FAILURES is reached).
            if (es.readyState === EventSource.CLOSED || hubFailures >= HUB_MAX_FAILURES) {
                es.close();
                await checkSessionState();
                if (es !== eventSource) return;
                clearTimeout(reconnectTimer);
                reconnectTimer = setTimeout(startStream, 2000);
            }
        };
    };

    // Fallback: PHP stream. Event ids are message ids, so the browser's automatic
    // reconnect (Last-Event-ID) resumes without gaps.
    const initSSE = () => {
        if (eventSource) eventSource.close();
        usingHub = false;
        typers.clear();
        renderStatusBar();

        eventSource = new EventSource(`api/uplink_stream.php?last_id=${encodeURIComponent(streamResumeId)}`);

        eventSource.onmessage = (event) => {
            if (event.lastEventId) streamResumeId = Math.max(streamResumeId, Number(event.lastEventId) || 0);
            if (!event.data || !event.data.trim()) return;
            try {
                handleIncomingMessage(JSON.parse(event.data));
            } catch (err) {
                // Ignore malformed frames
            }
        };

        eventSource.addEventListener('ready', (event) => {
            if (event.lastEventId) streamResumeId = Math.max(streamResumeId, Number(event.lastEventId) || 0);
        });

        const es = eventSource;
        es.onerror = () => {
            if (es !== eventSource) return;
            // CONNECTING = the browser retries by itself (with Last-Event-ID).
            // CLOSED = HTTP error: rebuild the stream ourselves from the last id we saw.
            if (es.readyState === EventSource.CLOSED) {
                clearTimeout(reconnectTimer);
                reconnectTimer = setTimeout(startStream, 3000);
            }
        };
    };

    if (chatInput) {
        // Tell others we're typing (hub only, at most every 2.5s, not for /commands)
        chatInput.addEventListener('input', () => {
            const v = chatInput.value;
            if (!usingHub || !v.trim() || v.startsWith('/')) return;
            const now = Date.now();
            if (now - lastTypingSent < 2500) return;
            lastTypingSent = now;
            fetch('api/chat_typing.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ room_id: window.activeRoomId })
            }).catch(() => {});
        });

        chatInput.addEventListener('keydown', async (e) => {
            // Tab: complete @name from online users / recent authors
            if (e.key === 'Tab') {
                const pos = chatInput.selectionStart;
                const before = chatInput.value.slice(0, pos);
                const m = /@([\w-]*)$/.exec(before);
                if (!m) return;
                e.preventDefault();
                const match = knownNames().find((n) => n.toLowerCase().startsWith(m[1].toLowerCase()));
                if (!match) return;
                const after = chatInput.value.slice(pos);
                const insert = `@${match} `;
                chatInput.value = before.slice(0, before.length - m[0].length) + insert + after;
                const caret = pos - m[0].length + insert.length;
                chatInput.setSelectionRange(caret, caret);
                return;
            }

            if (e.key === 'Enter') {
                e.preventDefault();
                const text = chatInput.value.trim();
                if (!text || isSubmitting) return;

                // Local command: enable desktop notifications for @mentions
                if (text.toLowerCase() === '/notify') {
                    chatInput.value = '';
                    const say = (message, kind) => appendMessageToUI({
                        created_at: new Date().toISOString().substring(11, 19), username: 'SYSTEM', message
                    }, getRoomState(window.activeRoomId), kind);
                    if (!('Notification' in window)) {
                        say('>> This browser does not support notifications.', true);
                    } else {
                        const perm = await Notification.requestPermission();
                        if (perm === 'granted') say('>> Notifications enabled: you will be alerted when someone @mentions you.', 'notice');
                        else say('>> Notifications blocked. Allow them in the browser site settings.', true);
                    }
                    return;
                }

                isSubmitting = true;
                try {
                    // csrf.js adds X-CSRF-Token
                    const headers = { 'Content-Type': 'application/json' };

                    const res = await fetch('api/uplink_send.php', {
                        method: 'POST',
                        headers: headers,
                        credentials: 'same-origin',
                        body: JSON.stringify({ message: text, room_id: window.activeRoomId })
                    });
                    
                    const responseText = await res.text();
                    let data = {};
                    try {
                        data = JSON.parse(responseText);
                    } catch (parseErr) {
                        console.error("Server raw response:", responseText);
                        data = { success: false, error: "Server returned non-JSON response." };
                    }

                    if (data.success) {
                        chatInput.value = '';
                        if (data.notice) {
                            appendMessageToUI({
                                created_at: new Date().toISOString().substring(11, 19),
                                username: 'SYSTEM',
                                message: `>> ${data.notice}`
                            }, getRoomState(window.activeRoomId), 'notice');
                        }
                    } else {
                        const state = getRoomState(window.activeRoomId);
                        appendMessageToUI({
                            created_at: new Date().toISOString().substring(11, 19),
                            username: 'SYSTEM',
                            message: `>> WARNING: ${data.error || 'Failed to send message.'}`
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
        startStream();
    };

    init();
});