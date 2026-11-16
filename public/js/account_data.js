// public/js/account_data.js — "delete my account" on the account page (api/account_data.php). csrf.js adds the token.
(function () {
    'use strict';
    var form = document.getElementById('delete-account-form');
    if (!form) return;
    var out = document.getElementById('delete-result');
    function say(text, bad) { out.textContent = text; out.style.color = bad ? '#ff3333' : ''; }

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var password = document.getElementById('delete-password').value;
        if (!password) return;
        if (!window.confirm('Delete your account and your data for good? This cannot be undone.')) return;
        var btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        say('Deleting...');
        try {
            var res = await fetch('../api/account_data.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ action: 'delete', password: password, delete_materials: document.getElementById('delete-materials').checked })
            });
            var data = await res.json();
            if (data.success) {
                say('Done: your account and data were deleted. Goodbye!');
                setTimeout(function () { window.location.href = '../index.php'; }, 2500);
                return;
            }
            say(data.error || 'Could not delete the account.', true);
        } catch (err) {
            say('Network error: try again.', true);
        }
        btn.disabled = false;
    });
})();
