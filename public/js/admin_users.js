// js/admin_users.js — the people panel (admin). Names, e-mails and notes come from users: everything goes in with textContent.
(function () {
    const $ = (id) => document.getElementById(id);
    let page = 1, pages = 1, current = null, flash = '';   // flash: what to say again after the panel is redrawn

    async function api(path, body) {
        const r = await fetch('../api/admin_users.php' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
        const j = await r.json().catch(() => null);
        if (!r.ok || !j || !j.success) throw new Error((j && j.error) || VBLang.t('wrong'));
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
        $('au-totals').replaceChildren(...[[VBLang.t('au_people'), t.all], [VBLang.t('au_new7'), t.new_7d], [VBLang.t('au_admins'), t.admins], [VBLang.t('au_banned'), t.banned], [VBLang.t('au_withmail'), t.with_email], [VBLang.t('au_news'), t.news]]
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
        list.replaceChildren(...(r.users.length ? r.users.map(row) : [h('p', { class: 'term-muted', text: VBLang.t('au_nobody') })]));
    }

    function row(u) {
        const tags = h('span', { class: 'au-tags' },
            u.is_admin ? tag(VBLang.t('au_t_admin'), 'ok') : null, banned(u) ? tag(VBLang.t('au_t_banned'), 'warn') : null, u.supporter ? tag(VBLang.t('au_t_supporter'), 'ok') : null,
            u.email ? tag(u.email_verified ? (u.email_optin ? VBLang.t('au_t_mailnews') : 'e-mail') : VBLang.t('au_t_unconf')) : null);
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
        const act = (body, ok) => async () => { try { await api('', { user_id: id, ...body }); flash = ok || VBLang.t('au_done'); await load(); await open(id); } catch (e) { say(e.message); } };
        const flag = (name, label) => h('label', {}, h('input', { type: 'checkbox', checked: !!u[name], onchange: (e) => act({ action: 'set_flag', flag: name, value: e.target.checked }, VBLang.t('au_saved'))() }), label);
        const subj = h('input', { maxlength: '150', placeholder: VBLang.t('au_subject'), 'aria-label': VBLang.t('au_subject') });
        const body = h('textarea', { rows: '6', maxlength: '5000', placeholder: VBLang.t('au_msgph'), 'aria-label': VBLang.t('au_msg') });
        const canMail = u.email && u.email_verified;
        box.replaceChildren(
            h('h2', { text: u.username }),
            h('dl', {},
                h('dt', { text: VBLang.t('au_joined') }), h('dd', { text: u.created_at || '' }),
                h('dt', { text: VBLang.t('au_role') }), h('dd', { text: u.is_admin ? VBLang.t('au_r_admin') : VBLang.t('au_r_user') }),
                h('dt', { text: VBLang.t('au_status') }), h('dd', { text: u.is_banned ? VBLang.t('au_s_banned') : banned(u) ? VBLang.t('au_s_timed', { d: u.banned_until }) : VBLang.t('au_s_active') }),
                h('dt', { text: 'E-mail' }), h('dd', { text: u.email ? `${u.email} (${u.email_verified ? VBLang.t('au_confirmed') : VBLang.t('au_notconf')}${u.email_optin ? VBLang.t('au_wantsnews') : ''})` : VBLang.t('au_none') }),
                h('dt', { text: VBLang.t('au_activity') }), h('dd', { text: VBLang.t('au_counts', { a: r.counts.messages, b: r.counts.classes, c: r.counts.notes }) }),
                u.bio ? h('dt', { text: 'Bio' }) : null, u.bio ? h('dd', { text: u.bio }) : null),
            h('div', { class: 'au-checks' }, flag('can_read_books', VBLang.t('au_f_read')), flag('can_upload_books', VBLang.t('au_f_upload')), flag('can_view_resume', VBLang.t('au_f_cv')), flag('ads_free', VBLang.t('au_f_ads'))),
            h('div', { class: 'au-actions' },
                h('button', { type: 'button', class: 'nav-btn', text: u.supporter ? VBLang.t('au_badge_off') : VBLang.t('au_badge_on'), onclick: act({ action: 'badge', value: !u.supporter }) }),
                u.is_admin ? null : h('button', { type: 'button', class: 'nav-btn', text: VBLang.t('au_timeout'), onclick: act({ action: 'timeout', minutes: 60 }, VBLang.t('au_timeout_done')) }),
                u.is_admin ? null : (u.is_banned ? null : h('button', { type: 'button', class: 'nav-btn au-danger', text: VBLang.t('au_ban'), onclick: () => { if (window.confirm(VBLang.t('au_ban_confirm', { u: u.username }))) act({ action: 'ban' }, VBLang.t('au_banned_done'))(); } })),
                (u.is_banned || banned(u)) ? h('button', { type: 'button', class: 'nav-btn', text: VBLang.t('au_lift'), onclick: act({ action: 'unban' }, VBLang.t('au_lifted')) }) : null),
            h('div', { class: 'au-mail' },
                h('b', { text: VBLang.t('au_sendmail') }),
                canMail ? [subj, body, h('button', { type: 'button', class: 'nav-btn', text: '>_ ' + VBLang.t('au_send'), onclick: async () => {
                    if (!window.confirm(VBLang.t('au_send_confirm', { u: u.username }))) return;
                    try { const s = await api('', { action: 'send_mail', user_id: id, subject: subj.value, body: body.value }); flash = s.driver_off ? VBLang.t('au_f_off') : s.sent_now ? VBLang.t('au_f_sent') : VBLang.t('au_f_queued'); await open(id); } catch (e) { say(e.message); }
                } })] : h('p', { class: 'term-muted', text: u.email ? VBLang.t('au_unconf_note') : VBLang.t('au_noaddr') })),
            msg,
            r.mail.length ? h('div', { class: 'au-hist' }, h('b', { text: VBLang.t('au_hist') }), ...r.mail.map((m) => h('span', { text: `${m.status} · ${m.kind} · ${m.subject}` }))) : null);
    }

    $('au-search').addEventListener('submit', (e) => { e.preventDefault(); page = 1; load().catch((x) => { $('au-list').textContent = x.message; }); });
    $('au-prev').addEventListener('click', () => { page = Math.max(1, page - 1); load(); });
    $('au-next').addEventListener('click', () => { page = Math.min(pages, page + 1); load(); });
    load().catch((x) => { $('au-list').textContent = x.message; });
})();
