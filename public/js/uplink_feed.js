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

    const scrollToBottom = () => {
        requestAnimationFrame(() => {
            if (chatLog) chatLog.scrollTop = chatLog.scrollHeight;
            if (feedTermBox) feedTermBox.scrollTop = feedTermBox.scrollHeight;
        });
    };

    const createMessageElement = (data, isError = false) => {
        const p = document.createElement('p');
        p.className = 'term-white';
        p.style.cssText = 'margin: 2px 0; word-break: break-all; line-height: 1.3;';

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

    // Append new live message to bottom
    const appendMessage = (data, isError = false) => {
        const msgEl = createMessageElement(data, isError);
        chatLog.appendChild(msgEl);
        scrollToBottom();
    };

    // Prepend older messages to top during scroll up
    const prependMessages = (messages) => {
        const oldScrollHeight = chatLog.scrollHeight;

        const fragment = document.createDocumentFragment();
        messages.forEach(data => {
            fragment.appendChild(createMessageElement(data));
        });

        chatLog.insertBefore(fragment, chatLog.firstChild);

        // Maintain scroll position after prepending older messages
        chatLog.scrollTop = chatLog.scrollHeight - oldScrollHeight;
    };

    // Fetch initial 25 latest messages
    const loadInitialFeed = async () => {
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

    // Fetch older history when scrolling near top
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

    // Listen for scroll-up event
    chatLog.addEventListener('scroll', () => {
        if (chatLog.scrollTop < 50) {
            loadOlderHistory();
        }
    });

    // Connect SSE for real-time live updates
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
                        headers: { 'Content-Type': 'application/json' },
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