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
        publicSendBtn.textContent = VBLang.t('up_sending');
        setStatus('', '');

        try {
            const res = await fetch('api/command.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text })
            });

            const data = await res.json();

            if (data.success) {
                setStatus(VBLang.t('up_done'), 'var(--accent-color)');
                publicMsgInput.value = '';
                // Keeping focus on the textarea prevents the keyboard from collapsing
                publicMsgInput.focus();
            } else {
                setStatus(`// ${VBLang.t('error')}: ${data.error || VBLang.t('failed')}`, '#ff3333');
            }
        } catch (err) {
            setStatus(VBLang.t('up_fail'), '#ff3333');
        } finally {
            setTimeout(() => {
                publicSendBtn.textContent = '>_ ' + VBLang.t('up_btn');
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