// public/js/uplink_feed.js
document.addEventListener("DOMContentLoaded", () => {
    const chatLog = document.getElementById('uplink-chat-log');
    const chatInput = document.getElementById('chat-feed-input');
    const feedTermBox = document.getElementById('feed-term-box');

    if (!chatLog) return;

    let latestId = 0;
    let oldestId = 0;
    let eventSource = null;
    let isSubmitting = false;
    let isLoadingHistory = false;
    let hasMoreHistory = true;

    window.SESSION_STATE = window.SESSION_STATE || {
        isAdmin: false,
        csrfToken: ''
    };

    let lastAppendedDate = null;
    let firstPrependedDate = null;

    const scrollToBottom = () => {
        requestAnimationFrame(() => {
            if (chatLog) chatLog.scrollTop = chatLog.scrollHeight;
            if (feedTermBox) feedTermBox.scrollTop = feedTermBox.scrollHeight;
        });
    };

    const formatDateLabel = (rawDate) => {
        if (!rawDate) return '';
        const today = new Date().toISOString().substring(0, 10);
        if (rawDate === today) return 'Today';
        return rawDate;
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
        p.id = `msg-${data.id}`;
        p.className = 'term-white';
        p.style.cssText = 'margin: 2px 0; word-break: break-all; line-height: 1.3; display: flex; align-items: center;';

        // Render deletion command to the far left (before timestamp) for admin users
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
                    if (resData.success) {
                        p.remove();
                    } else {
                        alert(`Deletion failed: ${resData.error}`);
                    }
                } catch (err) {
                    console.error("Deletion error:", err);
                }
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

    const appendMessage = (data, isError = false) => {
        if (data.date && data.date !== lastAppendedDate) {
            chatLog.appendChild(createDateSeparator(data.date));
            lastAppendedDate = data.date;
            if (!firstPrependedDate) firstPrependedDate = data.date;
        }

        const msgEl = createMessageElement(data, isError);
        chatLog.appendChild(msgEl);
        scrollToBottom();
    };

    const prependMessages = (messages) => {
        const oldScrollHeight = chatLog.scrollHeight;
        const fragment = document.createDocumentFragment();

        let currentGroupDate = null;

        messages.forEach(data => {
            if (data.date && data.date !== currentGroupDate) {
                currentGroupDate = data.date;
                fragment.appendChild(createDateSeparator(data.date));
            }
            fragment.appendChild(createMessageElement(data));
        });

        chatLog.insertBefore(fragment, chatLog.firstChild);
        chatLog.scrollTop = chatLog.scrollHeight - oldScrollHeight;
    };

    // 1. Fetch user session state & trigger admin command script loading if privileged
    const checkSessionState = async () => {
        try {
            const res = await fetch('api/check_session.php', { credentials: 'same-origin' });
            const data = await res.json();
            if (data) {
                window.SESSION_STATE.isAdmin = data.is_admin === 1;
                window.SESSION_STATE.csrfToken = data.csrf_token || '';

                // Dynamically load admin moderation script if authenticated user is admin
                if (typeof loadAdminCommandsIfEligible === 'function') {
                    loadAdminCommandsIfEligible();
                }
            }
        } catch (err) {
            console.error("Error checking session:", err);
        }
    };

    // 2. Load initial history feed
    const loadInitialFeed = async () => {
        await checkSessionState();

        try {
            const res = await fetch('api/get_feed.php?limit=25');
            const data = await res.json();

            if (data.success && data.messages.length > 0) {
                data.messages.forEach(msg => {
                    appendMessage(msg);
                    if (!oldestId || msg.id < oldestId) oldestId = msg.id;
                    if (msg.id > latestId) latestId = msg.id;
                });
                hasMoreHistory = data.has_more;
            }
        } catch (err) {
            console.error("Error loading initial feed:", err);
        } finally {
            initSSE();
        }
    };

    const loadOlderHistory = async () => {
        if (isLoadingHistory || !hasMoreHistory || !oldestId) return;

        isLoadingHistory = true;
        try {
            const res = await fetch(`api/get_feed.php?before_id=${oldestId}&limit=25`);
            const data = await res.json();

            if (data.success && data.messages.length > 0) {
                prependMessages(data.messages);
                oldestId = data.messages[0].id;
                hasMoreHistory = data.has_more;
            } else {
                hasMoreHistory = false;
            }
        } catch (err) {
            console.error("Error loading history:", err);
        } finally {
            isLoadingHistory = false;
        }
    };

    chatLog.addEventListener('scroll', () => {
        if (chatLog.scrollTop < 50) {
            loadOlderHistory();
        }
    });

    const initSSE = () => {
        if (eventSource) eventSource.close();
        eventSource = new EventSource(`api/uplink_stream.php?last_id=${latestId}`);

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.id && data.id > latestId) {
                    latestId = data.id;
                    appendMessage(data);
                }
            } catch (err) {}
        };

        eventSource.onerror = () => {
            eventSource.close();
            setTimeout(initSSE, 3000);
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
                        headers: { 
                            'Content-Type': 'application/json',
                            'X-CSRF-Token': window.SESSION_STATE.csrfToken || ''
                        },
                        credentials: 'same-origin',
                        body: JSON.stringify({ message: text })
                    });
                    
                    const data = await res.json();
                    
                    if (data.success) {
                        chatInput.value = '';
                    } else {
                        appendMessage({
                            created_at: new Date().toISOString().substring(11, 19),
                            username: 'SYSTEM',
                            message: `>> WARNING: ${data.error}`
                        }, true);
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

    loadInitialFeed();
});