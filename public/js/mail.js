// js/mail.js — the e-mail box (admin). Every piece of text goes in with textContent: subjects and addresses come from outside.
(function () {
    const $ = (id) => document.getElementById(id);
    let folder = 'draft';
    let current = null;      // the draft being edited: {id}

    async function api(path, body) {
        const r = await fetch('../api/mail.php' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
        const j = await r.json().catch(() => null);
        if (!r.ok || !j || !j.success) throw new Error((j && j.error) || VBLang.t('wrong'));
        return j;
    }
    const say = (t) => { $('mb-msg').textContent = t || ''; };
    const when = (ts) => (ts ? new Date(ts * 1000).toLocaleString() : '');

    async function status() {
        const s = await api('?action=status');
        $('mb-status').textContent = (s.driver ? VBLang.t('mb_sending', { d: s.driver }) : VBLang.t('mb_off'))
            + VBLang.t('mb_counts', { a: s.sent_today, b: s.daily_limit, c: s.pending, d: s.failed })
            + VBLang.t('mb_news', { a: s.audience.optin, b: s.audience.supporters });
    }

    function row(main, meta, extra) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'mb-row' + (extra || '');
        const a = document.createElement('span'); a.className = 'mb-sub'; a.textContent = main;
        const m = document.createElement('span'); m.className = 'mb-meta'; m.textContent = meta;
        b.append(a, m);
        return b;
    }

    async function show(f) {
        folder = f;
        current = null;
        $('mb-form').hidden = true;
        $('mb-list').hidden = false;
        document.querySelectorAll('.mb-folder').forEach((b) => b.classList.toggle('active', b.dataset.folder === f));
        const list = $('mb-list');
        list.replaceChildren();
        const { rows } = await api('?action=list&folder=' + f);
        if (!rows.length) { const p = document.createElement('p'); p.className = 'term-muted'; p.textContent = VBLang.t('mb_nothing'); list.append(p); }
        for (const r of rows) {
            if (f === 'queue') {
                list.append(row(`${r.to_email} — ${r.subject}`, `${r.status}${r.attempts ? ' ×' + r.attempts : ''} · ${when(r.sent_at || r.created_at)}${r.last_error ? ' · ' + r.last_error : ''}`, r.status === 'failed' ? ' fail' : ''));
            } else {
                const b = row(r.subject || VBLang.t('mb_nosubject'), f === 'sent' ? `${VBLang.t('mb_people', { n: r.recipients })} · ${when(r.sent_at)}` : when(r.created_at));
                b.addEventListener('click', () => open(r.id, f === 'sent'));
                list.append(b);
            }
        }
    }

    async function open(id, readOnly) {
        const { message } = await api('?action=get&id=' + id);
        compose(message, readOnly);
    }

    function compose(m, readOnly) {
        current = m ? { id: m.id } : null;
        $('mb-list').hidden = true;
        $('mb-form').hidden = false;
        $('mb-subject').value = m ? m.subject : '';
        $('mb-body').value = m ? m.body : '';
        $('mb-audience').value = m ? m.audience : 'optin';
        for (const id of ['mb-subject', 'mb-body', 'mb-audience', 'mb-save', 'mb-send', 'mb-delete']) $(id).disabled = !!readOnly;
        $('mb-test').disabled = !!readOnly;
        say(readOnly ? VBLang.t('mb_readonly') : '');
    }

    async function save() {
        const r = await api('', { action: 'save_draft', id: current ? current.id : 0, subject: $('mb-subject').value, body: $('mb-body').value, audience: $('mb-audience').value });
        current = { id: r.id };
        return r.id;
    }

    $('mb-compose').addEventListener('click', () => compose(null, false));
    document.querySelectorAll('.mb-folder').forEach((b) => b.addEventListener('click', () => show(b.dataset.folder).catch((e) => say(e.message))));
    $('mb-form').addEventListener('submit', async (ev) => { ev.preventDefault(); try { await save(); say(VBLang.t('mb_saved')); status(); } catch (e) { say(e.message); } });
    $('mb-test').addEventListener('click', async () => { try { const id = await save(); const r = await api('', { action: 'send_test', id }); say(VBLang.t('mb_test', { n: r.queued })); status(); } catch (e) { say(e.message); } });
    $('mb-send').addEventListener('click', async () => {
        try {
            const id = await save();
            const s = await api('?action=status');
            const n = $('mb-audience').value === 'supporters' ? s.audience.supporters : s.audience.optin;
            if (!window.confirm(VBLang.t('mb_confirm', { n }))) return;
            const r = await api('', { action: 'send', id });
            say(VBLang.t('mb_queued', { n: r.queued }));
            status();
            show('sent').catch(() => {});
        } catch (e) { say(e.message); }
    });
    $('mb-delete').addEventListener('click', async () => {
        if (!current || !window.confirm(VBLang.t('mb_del'))) return;
        try { await api('', { action: 'delete', id: current.id }); show('draft'); } catch (e) { say(e.message); }
    });
    $('mb-process').addEventListener('click', async () => {
        try { const r = await api('', { action: 'process' }); $('mb-status').dataset.last = ''; await status(); say(r.off ? VBLang.t('mb_off2') : VBLang.t('mb_sent', { a: r.sent, b: r.left })); } catch (e) { say(e.message); }
    });

    status().catch(() => {});
    show('draft').catch((e) => say(e.message));
})();
