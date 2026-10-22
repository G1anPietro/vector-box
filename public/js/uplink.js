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
            const res = await fetch('api/command.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text })
            });

            const data = await res.json();

            if (data.success) {
                setStatus('// TRANSMISSION DELIVERED TO NTFY', 'var(--accent-color)');
                publicMsgInput.value = '';
                // Keeping focus on the textarea prevents the keyboard from collapsing
                publicMsgInput.focus();
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

    // Prevent default touch focus shift on button tap so the keyboard stays stable
    publicSendBtn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        transmitNtfyMessage();
    });

    publicMsgInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            transmitNtfyMessage();
        }
    });
});