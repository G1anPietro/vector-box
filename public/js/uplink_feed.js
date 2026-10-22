// public/js/uplink_feed.js
document.addEventListener("DOMContentLoaded", () => {
    const chatLog = document.getElementById('uplink-chat-log');
    const chatInput = document.getElementById('chat-feed-input');
    const feedTermBox = document.getElementById('feed-term-box');

    if (!chatLog) return;

    let lastSeenId = 0;
    let eventSource = null;
    let isSubmitting = false;

    const scrollToBottom = () => {
        requestAnimationFrame(() => {
            if (chatLog) chatLog.scrollTop = chatLog.scrollHeight;
            if (feedTermBox) feedTermBox.scrollTop = feedTermBox.scrollHeight;
        });
    };

    const appendMessage = (data, isError = false) => {
        const p = document.createElement('p');
        p.className = 'term-white';
        p.style.cssText = 'margin: 2px 0; word-break: break-all; line-height: 1.3;';

        const timeSpan = document.createElement('span');
        timeSpan.style.cssText = 'color: #8ab4f8; margin-right: 8px; font-size: 0.8rem;';
        timeSpan.textContent = `[${data.created_at || 'LOGGED'}]`;

        const textSpan = document.createElement('span');
        textSpan.style.color = isError ? '#ff3333' : '#00ff66';
        textSpan.textContent = data.message;

        p.appendChild(timeSpan);
        p.appendChild(textSpan);
        chatLog.appendChild(p);

        scrollToBottom();
    };

    const initSSE = () => {
        if (eventSource) eventSource.close();
        eventSource = new EventSource(`api/uplink_stream.php?last_id=${lastSeenId}`);

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.id && data.id > lastSeenId) {
                    lastSeenId = data.id;
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
                chatInput.disabled = true;

                try {
                    const res = await fetch('api/uplink_send.php', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ message: text })
                    });
                    
                    const data = await res.json();
                    
                    if (data.success) {
                        chatInput.value = '';
                    } else {
                        // Display error directly in feed
                        appendMessage({
                            created_at: new Date().toISOString().substring(11, 19),
                            message: `>> SYSTEM_WARNING: ${data.error}`
                        }, true);
                    }
                } catch (err) {
                    appendMessage({
                        created_at: new Date().toISOString().substring(11, 19),
                        message: '>> SYSTEM_ERROR: Network request failed'
                    }, true);
                } finally {
                    // Local 1-second cooldown per submission
                    setTimeout(() => {
                        isSubmitting = false;
                        chatInput.disabled = false;
                        chatInput.focus();
                    }, 1000);
                }
            }
        });
    }

    initSSE();
});