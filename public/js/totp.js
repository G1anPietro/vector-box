// js/totp.js — the admin's two-step login settings (Account page). Everything is drawn with textContent: nothing from the server is HTML.
(() => {
    const it = document.documentElement.lang === 'it';
    const T = it ? {
        off: 'Spento. Con la verifica in due passaggi, la password da sola non basta per entrare.', on: (n) => 'Attivo. Codici di emergenza rimasti: ' + n + '.',
        start: 'Attiva', key: 'Chiave da inserire nell’app (Aegis, Google Authenticator…):', open: 'Apri nell’app', code: 'Codice a 6 cifre', confirm: 'Conferma',
        saveCodes: 'Codici di emergenza: salvali ADESSO in un posto sicuro, ognuno vale una volta sola e non si rivedono.', pw: 'Password', newCodes: 'Nuovi codici di emergenza', off2: 'Disattiva', err: 'Non è andata: controlla i dati.', wait: 'Riprova tra qualche minuto.' }
      : {
        off: 'Off. With two-step login, the password alone is not enough to get in.', on: (n) => 'On. Backup codes left: ' + n + '.',
        start: 'Turn on', key: 'Key to enter in the app (Aegis, Google Authenticator…):', open: 'Open in app', code: '6-digit code', confirm: 'Confirm',
        saveCodes: 'Backup codes: save them NOW somewhere safe, each works once and they are never shown again.', pw: 'Password', newCodes: 'New backup codes', off2: 'Turn off', err: 'That did not work: check the details.', wait: 'Try again in a few minutes.' };
    const $ = (id) => document.getElementById(id);
    const el = (tag, props = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'text') n.textContent = v; else n.setAttribute(k, v); } n.append(...kids); return n; };
    const field = (id, label, type = 'text', extra = {}) => el('label', { for: id, style: 'display:block;font-size:.75rem;margin-top:6px;' }, label, el('input', Object.assign({ id, type, class: 'terminal-input', style: 'display:block;width:100%;padding:8px;background:rgba(0,0,0,.85);color:#fff;border:1px solid var(--border-color);' }, extra)));
    const btn = (text, fn) => { const b = el('button', { type: 'button', class: 'nav-btn', style: 'margin-top:8px;padding:8px;', text }); b.addEventListener('click', fn); return b; };
    async function api(body) {
        const r = await fetch('../api/totp.php', body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
        const j = await r.json().catch(() => ({ success: false }));
        j.status = r.status;
        return j;
    }
    const say = (msg) => { $('totp-state').textContent = msg; };
    function showCodes(codes) {
        const pre = el('pre', { style: 'user-select:all;margin:6px 0;white-space:pre-wrap;', text: codes.join('\n') });
        $('totp-body').replaceChildren(el('p', { class: 'term-muted', text: T.saveCodes }), pre, btn('OK', render));
    }
    async function render() {
        const s = await api();
        if (!s.success) return;
        const body = $('totp-body');
        if (!s.enabled) {
            say(T.off);
            body.replaceChildren(btn(T.start, async () => {
                const d = await api({ action: 'begin' });
                if (!d.success) { say(d.status === 429 ? T.wait : T.err); return; }
                const link = el('a', { href: d.uri, text: T.open, style: 'display:inline-block;margin-top:6px;' });
                const input = field('totp-code', T.code, 'text', { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '8' });
                body.replaceChildren(el('p', { class: 'term-muted', text: T.key }), el('pre', { style: 'user-select:all;margin:6px 0;word-break:break-all;white-space:pre-wrap;', text: d.secret }), link, input,
                    btn(T.confirm, async () => {
                        const c = await api({ action: 'confirm', code: $('totp-code').value });
                        if (c.success) { say(''); showCodes(c.backup_codes); } else say(c.status === 429 ? T.wait : T.err);
                    }));
            }));
            return;
        }
        say(T.on(s.backup_left));
        const pw = field('totp-pw', T.pw, 'password', { autocomplete: 'current-password' });
        const cd = field('totp-code2', T.code, 'text', { inputmode: 'text', autocomplete: 'one-time-code', maxlength: '16' });
        const proof = () => ({ password: $('totp-pw').value, code: $('totp-code2').value });
        body.replaceChildren(pw, cd,
            btn(T.newCodes, async () => { const d = await api(Object.assign({ action: 'backup' }, proof())); if (d.success) { say(''); showCodes(d.backup_codes); } else say(d.status === 429 ? T.wait : T.err); }),
            btn(T.off2, async () => { const d = await api(Object.assign({ action: 'disable' }, proof())); if (d.success) render(); else say(d.status === 429 ? T.wait : T.err); }));
    }
    render();
})();
