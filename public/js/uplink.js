// public/js/uplink.js
document.addEventListener("DOMContentLoaded", () => {
    const publicSendBtn = document.getElementById('public-send-btn');
    const publicMsgInput = document.getElementById('public-msg-input');
    const publicMsgStatus = document.getElementById('public-msg-status');

    if (!publicSendBtn || !publicMsgInput || !publicMsgStatus) return;

    const setStatus = (message, color) => {
        publicMsgStatus.textContent = message;
        publicMsgStatus.style.color = color;
    };

    const transmitNtfyMessage = async () => {
        const text = publicMsgInput.value.trim();
        if (!text || publicSendBtn.disabled) return;

        publicSendBtn.disabled = true;
        publicSendBtn.textContent = "TRANSMITTING...";
        setStatus('', '');

        try {
            // Invia esclusivamente a command.php per ntfy.sh
            const res = await fetch('api/command.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text })
            });

            const data = await res.json();

            if (data.success) {
                setStatus('// TRANSMISSION DELIVERED TO NTFY', '#00ff66');
                publicMsgInput.value = '';
            } else {
                setStatus(`// ERROR: ${data.error || 'Failed'}`, '#ff3333');
            }
        } catch (err) {
            setStatus('// UPLINK FAILURE: TARGET UNREACHABLE', '#ff3333');
        } finally {
            setTimeout(() => {
                publicSendBtn.textContent = ">_ TRANSMIT MESSAGE";
                publicSendBtn.disabled = false;
            }, 1500);
        }
    };

    publicSendBtn.addEventListener('click', transmitNtfyMessage);

    publicMsgInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            transmitNtfyMessage();
        }
    });
});