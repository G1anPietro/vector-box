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
        if (!window.confirm(VBLang.t('ad_confirm'))) return;
        var btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        say(VBLang.t('ad_deleting'));
        try {
            var res = await fetch('../api/account_data.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ action: 'delete', password: password, delete_materials: document.getElementById('delete-materials').checked })
            });
            var data = await res.json();
            if (data.success) {
                say(VBLang.t('ad_done'));
                setTimeout(function () { window.location.href = '../index.php'; }, 2500);
                return;
            }
            say(data.error || VBLang.t('ad_fail'), true);
        } catch (err) {
            say(VBLang.t('ad_net'), true);
        }
        btn.disabled = false;
    });
})();
