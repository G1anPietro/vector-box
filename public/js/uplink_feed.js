// public/js/uplink_feed.js
document.addEventListener("DOMContentLoaded", () => {
    const chatLog = document.getElementById('uplink-chat-log');
    const chatInput = document.getElementById('chat-feed-input');
    const feedTermBox = document.getElementById('feed-term-box');

    if (!chatLog) return;

    let lastSeenId = 0;
    let eventSource = null;

    const appendMessage = (data) => {
        const p = document.createElement('p');
        p.className = 'term-white';
        p.style.cssText = 'margin: 2px 0; word-break: break-all; line-height: 1.3;';

        const timeSpan = document.createElement('span');
        timeSpan.style.cssText = 'color: #8ab4f8; margin-right: 8px; font-size: 0.8rem;';
        timeSpan.textContent = `[${data.created_at || 'LOGGED'}]`;

        const textSpan = document.createElement('span');
        textSpan.style.color = '#00ff66';
        textSpan.textContent = data.message;

        p.appendChild(timeSpan);
        p.appendChild(textSpan);
        chatLog.appendChild(p);

        if (feedTermBox) {
            feedTermBox.scrollTop = feedTermBox.scrollHeight;
        }
    };

    const initSSE = () => {
        if (eventSource) eventSource.close();

        const streamUrl = `api/uplink_stream.php?last_id=${lastSeenId}`;
        eventSource = new EventSource(streamUrl);

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.id && data.id > lastSeenId) {
                    lastSeenId = data.id;
                    appendMessage(data);
                }
            } catch (err) {
                console.warn("Payload SSE non valido:", event.data);
            }
        };

        eventSource.onerror = (err) => {
            eventSource.close();
            setTimeout(initSSE, 3000);
        };
    };

    // Invio da input del feed -> salva su SQLite per lo stream live
    if (chatInput) {
        chatInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const text = chatInput.value.trim();
                if (!text) return;

                chatInput.value = '';

                try {
                    const res = await fetch('api/uplink_send.php', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ message: text })
                    });
                    const data = await res.json();
                    if (!data.success) {
                        console.error("Errore nell'invio al feed:", data.error);
                    }
                } catch (err) {
                    console.error("Impossibile inviare al feed:", err);
                }
            }
        });
    }

    initSSE();
});