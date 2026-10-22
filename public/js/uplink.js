// public/uplink.js
document.addEventListener("DOMContentLoaded", () => {
    const publicSendBtn = document.getElementById('public-send-btn');
    const publicMsgInput = document.getElementById('public-msg-input');
    const publicMsgStatus = document.getElementById('public-msg-status');

    if (!publicSendBtn || !publicMsgInput || !publicMsgStatus) return;

    // Helper: Render status message safely (Anti-XSS)
    const setStatus = (message, color) => {
        publicMsgStatus.textContent = message;
        publicMsgStatus.style.color = color;
    };

    const transmitMessage = async () => {
        const text = publicMsgInput.value.trim();
        if (!text || publicSendBtn.disabled) return;

        // Lock button during transmission
        publicSendBtn.disabled = true;
        publicSendBtn.textContent = "TRANSMITTING...";
        setStatus('', '');

        try {
            const res = await fetch('api/command.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text })
            });

            const data = await res.json();

            if (data.success) {
                setStatus('// TRANSMISSION DELIVERED', '#00ff66');
                publicMsgInput.value = '';
            } else {
                setStatus(`// ERROR: ${data.error || 'Failed'}`, '#ff3333');
            }
        } catch (err) {
            setStatus('// UPLINK FAILURE: TARGET UNREACHABLE', '#ff3333');
        } finally {
            // Re-enable transmit button after timeout delay
            setTimeout(() => {
                publicSendBtn.textContent = ">_ TRANSMIT MESSAGE";
                publicSendBtn.disabled = false;
            }, 3000);
        }
    };

    // Event Listeners
    publicSendBtn.addEventListener('click', transmitMessage);

    publicMsgInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            transmitMessage();
        }
    });
});