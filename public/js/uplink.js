document.addEventListener("DOMContentLoaded", () => {
    const publicSendBtn = document.getElementById('public-send-btn');
    const publicMsgInput = document.getElementById('public-msg-input');
    const publicMsgStatus = document.getElementById('public-msg-status');

    if (publicSendBtn && publicMsgInput && publicMsgStatus) {
        publicSendBtn.addEventListener('click', async () => {
            const text = publicMsgInput.value.trim();
            if (!text) return;

            publicSendBtn.innerText = "TRANSMITTING...";
            publicMsgStatus.innerHTML = '';

            try {
                const res = await fetch('api/command.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: text })
                });
                
                const data = await res.json();
                
                if (data.success) {
                    publicMsgStatus.innerHTML = '<span style="color: #00ff66;">// TRANSMISSION DELIVERED</span>';
                    publicMsgInput.value = ''; 
                } else {
                    publicMsgStatus.innerHTML = `<span style="color: #ff3333;">// ERROR: ${data.error || 'Failed'}</span>`;
                }
            } catch (err) {
                publicMsgStatus.innerHTML = '<span style="color: #ff3333;">// UPLINK FAILURE: TARGET UNREACHABLE</span>';
            }

            setTimeout(() => { 
                publicSendBtn.innerText = ">_ TRANSMIT MESSAGE";
            }, 3000);
        });
    }
});