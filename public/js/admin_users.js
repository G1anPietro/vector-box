// js/admin_users.js — the people panel (admin). Names, e-mails and notes come from users: everything goes in with textContent.
(function () {
    const $ = (id) => document.getElementById(id);
    let page = 1, pages = 1, current = null, flash = '';   // flash: what to say again after the panel is redrawn

    async function api(path, body) {
        const r = await fetch('../api/admin_users.php' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
        const j = await r.json().catch(() => null);
        if (!r.ok || !j || !j.success) throw new Error((j && j.error) || 'Something went wrong.');
        return j;
    }
    const h = (tag, props = {}, ...kids) => {
        const n = document.createElement(tag);
        for (const [k, v] of Object.entries(props)) {
            if (v === undefined || v === null || v === false) continue;
            if (k === 'text') n.textContent = v; else if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
            else if (k in n && typeof v !== 'string') n[k] = v; else n.setAttribute(k, v === true ? '' : v);
        }
        n.append(...kids.flat().filter((x) => x !== null && x !== undefined && x !== false));
        return n;
    };
    const tag = (text, cls) => h('span', { class: 'au-tag ' + (cls || ''), text });
    const banned = (u) => u.is_banned || u.timed_out;

    function totals(t) {
        $('au-totals').replaceChildren(...[['People', t.all], ['New (7 days)', t.new_7d], ['Admins', t.admins], ['Banned', t.banned], ['With e-mail', t.with_email], ['Want news', t.news]]
            .map(([k, v]) => h('div', { class: 'au-stat' }, h('b', { text: String(v) }), k)));
    }

    async function load() {
        const q = new URLSearchParams({ action: 'list', q: $('au-q').value, filter: $('au-filter').value, page: String(page) });
        const r = await api('?' + q);
        pages = r.pages;
        totals(r.totals);
        $('au-page').textContent = `${r.page} / ${r.pages} · ${r.total}`;
        $('au-prev').disabled = page <= 1; $('au-next').disabled = page >= pages;
        const list = $('au-list');
        list.replaceChildren(...(r.users.length ? r.users.map(row) : [h('p', { class: 'term-muted', text: 'Nobody found.' })]));
    }

    function row(u) {
        const tags = h('span', { class: 'au-tags' },
            u.is_admin ? tag('admin', 'ok') : null, banned(u) ? tag('banned', 'warn') : null, u.supporter ? tag('supporter', 'ok') : null,
            u.email ? tag(u.email_verified ? (u.email_optin ? 'e-mail + news' : 'e-mail') : 'e-mail unconfirmed') : null);
        const b = h('button', { type: 'button', class: 'au-row', 'aria-current': String(current === u.id), onclick: () => open(u.id) }, h('span', { class: 'au-name', text: u.username }), tags);
        return b;
    }

    async function open(id) {
        current = id;
        const r = await api('?action=user&id=' + id);
        const u = r.user, box = $('au-detail');
        box.hidden = false;
        const msg = h('div', { class: 'au-msg', role: 'status', text: flash });
        flash = '';
        const say = (t) => { msg.textContent = t; };
        const act = (body, ok) => async () => { try { await api('', { user_id: id, ...body }); flash = ok || 'Done.'; await load(); await open(id); } catch (e) { say(e.message); } };
        const flag = (name, label) => h('label', {}, h('input', { type: 'checkbox', checked: !!u[name], onchange: (e) => act({ action: 'set_flag', flag: name, value: e.target.checked }, 'Saved.')() }), label);
        const subj = h('input', { maxlength: '150', placeholder: 'Subject', 'aria-label': 'Subject' });
        const body = h('textarea', { rows: '6', maxlength: '5000', placeholder: 'Message (plain text)', 'aria-label': 'Message' });
        const canMail = u.email && u.email_verified;
        box.replaceChildren(
            h('h2', { text: u.username }),
            h('dl', {},
                h('dt', { text: 'Joined' }), h('dd', { text: u.created_at || '' }),
                h('dt', { text: 'Role' }), h('dd', { text: u.is_admin ? 'Administrator' : 'Standard user' }),
                h('dt', { text: 'Status' }), h('dd', { text: u.is_banned ? 'Banned' : banned(u) ? 'Timed out until ' + u.banned_until : 'Active' }),
                h('dt', { text: 'E-mail' }), h('dd', { text: u.email ? `${u.email} (${u.email_verified ? 'confirmed' : 'not confirmed'}${u.email_optin ? ', wants news' : ''})` : 'none' }),
                h('dt', { text: 'Activity' }), h('dd', { text: `${r.counts.messages} chat messages · ${r.counts.classes} classes · ${r.counts.notes} notes` }),
                u.bio ? h('dt', { text: 'Bio' }) : null, u.bio ? h('dd', { text: u.bio }) : null),
            h('div', { class: 'au-checks' }, flag('can_read_books', 'Can read books'), flag('can_upload_books', 'Can upload books'), flag('can_view_resume', 'Can see the résumé'), flag('ads_free', 'Never sees ads')),
            h('div', { class: 'au-actions' },
                h('button', { type: 'button', class: 'nav-btn', text: u.supporter ? 'Remove supporter badge' : 'Give supporter badge', onclick: act({ action: 'badge', value: !u.supporter }) }),
                u.is_admin ? null : h('button', { type: 'button', class: 'nav-btn', text: 'Time out 1 hour', onclick: act({ action: 'timeout', minutes: 60 }, 'Timed out for 1 hour.') }),
                u.is_admin ? null : (u.is_banned ? null : h('button', { type: 'button', class: 'nav-btn au-danger', text: 'Ban', onclick: () => { if (window.confirm(`Ban ${u.username}?`)) act({ action: 'ban' }, 'Banned.')(); } })),
                (u.is_banned || banned(u)) ? h('button', { type: 'button', class: 'nav-btn', text: 'Lift ban / timeout', onclick: act({ action: 'unban' }, 'Lifted.') }) : null),
            h('div', { class: 'au-mail' },
                h('b', { text: 'Send an e-mail' }),
                canMail ? [subj, body, h('button', { type: 'button', class: 'nav-btn', text: '>_ SEND', onclick: async () => {
                    if (!window.confirm(`Send this message to ${u.username}?`)) return;
                    try { const s = await api('', { action: 'send_mail', user_id: id, subject: subj.value, body: body.value }); flash = s.driver_off ? 'Saved in the queue: sending is OFF (MAIL_DRIVER).' : s.sent_now ? 'Sent.' : 'Queued.'; await open(id); } catch (e) { say(e.message); }
                } })] : h('p', { class: 'term-muted', text: u.email ? 'The address is not confirmed yet: nothing can be sent to it.' : 'This person has not given an e-mail address.' })),
            msg,
            r.mail.length ? h('div', { class: 'au-hist' }, h('b', { text: 'Latest e-mails to this person' }), ...r.mail.map((m) => h('span', { text: `${m.status} · ${m.kind} · ${m.subject}` }))) : null);
    }

    $('au-search').addEventListener('submit', (e) => { e.preventDefault(); page = 1; load().catch((x) => { $('au-list').textContent = x.message; }); });
    $('au-prev').addEventListener('click', () => { page = Math.max(1, page - 1); load(); });
    $('au-next').addEventListener('click', () => { page = Math.min(pages, page + 1); load(); });
    load().catch((x) => { $('au-list').textContent = x.message; });
})();
