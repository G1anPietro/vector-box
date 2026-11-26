// js/webmail.js — personal mail, Gmail-like: folders, search, stars, read/unread, trash, reply/forward, a writing window, and (admin) addresses.
// Everything that comes from outside (senders, subjects, bodies) goes in with textContent.
(function () {
    const $ = (id) => document.getElementById(id);
    let T = {};
    try { T = JSON.parse($('wm-i18n').textContent); } catch (e) { /* the page still works with empty texts */ }
    const t = (k) => T[k] || k;
    const state = { folder: 'inbox', q: '', rows: [], open: null, sel: new Set(), addresses: [], domain: '', draftId: 0, admin: document.body.dataset.admin === '1', addr: '', me: '' };

    async function api(path, body) {
        const r = await fetch('../api/webmail.php' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
        const j = await r.json().catch(() => null);
        if (!r.ok || !j || !j.success) throw new Error((j && j.error) || t('wrong'));
        return j;
    }
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const note = (m) => { $('wm-note').textContent = m || ''; };
    const when = (ts) => {
        const d = new Date(ts * 1000), n = new Date();
        return d.toDateString() === n.toDateString() ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : d.toLocaleDateString([], d.getFullYear() === n.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
    };
    const bare = (a) => { const m = /<([^>]+)>/.exec(a || ''); return (m ? m[1] : a || '').trim(); };
    const who = (r) => (r.folder === 'sent' || r.folder === 'draft' || r.folder === 'sys') ? t('to') + ': ' + (r.to_addr || '—') : (r.from_addr || '—');

    async function boot() {
        const b = await api('?action=boot');
        state.me = b.username || ''; state.addresses = b.addresses; state.domain = b.domain; state.driver = b.driver;
        $('wm-n-inbox').textContent = b.counts.inbox_unread ? String(b.counts.inbox_unread) : '';
        $('wm-n-draft').textContent = b.counts.draft ? String(b.counts.draft) : '';
        $('wm-mine').textContent = b.addresses.length ? t('mine') + ': ' + b.addresses.map((a) => a.address).join(', ') : t('noaddr');
        const from = $('wm-from'); from.replaceChildren();
        for (const a of b.addresses) { const o = el('option', '', a.address); o.value = String(a.id); from.append(o); }
        const sw = $('wm-switch');   // admin only: choose which of my addresses I am using (all of them, or one)
        if (sw) {
            sw.replaceChildren(); const all = el('option', '', t('all_addr')); all.value = ''; sw.append(all);
            for (const a of b.addresses) { const o = el('option', '', a.address); o.value = a.address; sw.append(o); }
            if (!b.addresses.some((a) => a.address === state.addr)) state.addr = '';
            sw.value = state.addr; sw.hidden = b.addresses.length < 2;
            const cur = b.addresses.find((a) => a.address === state.addr); if (cur) from.value = String(cur.id);
        }
        $('wm-compose').disabled = $('wm-fab').disabled = !b.addresses.length;
        return b;
    }

    function syncBar() {
        const f = state.folder, reading = !!state.open, listing = !reading && f !== 'addresses';
        $('wm-back').hidden = !reading;
        document.querySelectorAll('[data-bulk]').forEach((b) => {
            const k = b.dataset.bulk, inTrash = f === 'trash';
            b.hidden = f === 'system' || !(listing || reading) || (k === 'restore' || k === 'delete' ? !inTrash : k === 'trash' ? inTrash : (inTrash || f === 'draft'));
        });
        $('wm-refresh').hidden = !listing;
        $('wm-empty').hidden = !(listing && f === 'trash');
        document.querySelectorAll('.wm-folder').forEach((b) => b.classList.toggle('active', b.dataset.folder === f));
    }

    function show(which) { $('wm-list').hidden = which !== 'list'; $('wm-read').hidden = which !== 'read'; $('wm-addr').hidden = which !== 'addr'; }

    async function load(folder, q) {
        if (folder != null) state.folder = folder;
        if (q != null) state.q = q;
        state.open = null; state.sel.clear(); note('');
        syncBar();
        if (state.folder === 'addresses') return addresses();
        show('list');
        const { rows } = await api('?action=list&folder=' + state.folder + (state.q ? '&q=' + encodeURIComponent(state.q) : '') + (state.addr ? '&addr=' + encodeURIComponent(state.addr) : ''));
        state.rows = rows;
        const list = $('wm-list'); list.replaceChildren();
        if (!rows.length) list.append(el('p', 'muted wm-empty', t('nothing')));
        for (const r of rows) list.append(row(r));
    }

    function row(r) {
        const li = el('div', 'wm-row' + (r.is_read || r.folder === 'draft' || r.folder === 'sent' ? '' : ' unread'));
        const cb = el('input'); cb.type = 'checkbox'; cb.setAttribute('aria-label', 'select');
        const pick = (on) => { cb.checked = on; on ? state.sel.add(r.id) : state.sel.delete(r.id); li.classList.toggle('picked', on); };
        cb.addEventListener('click', (e) => { e.stopPropagation(); pick(cb.checked); });
        // the round initial (phones, like Gmail): tapping it selects the message
        const av = el('span', 'wm-av', ((r.folder === 'sent' || r.folder === 'draft' ? r.to_addr : r.from_addr) || '?').replace(/^[^A-Za-z0-9]+/, '').charAt(0).toUpperCase() || '?');
        av.addEventListener('click', (e) => { e.stopPropagation(); pick(!cb.checked); });
        const star = el('button', 'wm-star' + (r.is_starred ? ' on' : ''), r.is_starred ? '★' : '☆'); star.type = 'button'; star.title = '★';
        if (r.folder === 'sys') star.style.visibility = 'hidden';
        star.addEventListener('click', async (e) => { e.stopPropagation(); const v = r.is_starred ? 0 : 1; await api('', { action: 'star', ids: [r.id], value: v }).catch((x) => note(x.message)); r.is_starred = v; star.textContent = v ? '★' : '☆'; star.classList.toggle('on', !!v); });
        const from = el('span', 'wm-from', who(r));
        const mid = el('span', 'wm-mid'); mid.append(el('b', '', r.subject || t('nosub')), el('span', 'muted', ' — ' + (r.snippet || '')));
        const date = el('span', 'wm-date', when(r.created_at));
        li.append(cb, av, star, from, mid, date);
        li.addEventListener('click', () => (r.folder === 'draft' ? compose(r) : open(r.id, r.folder === 'sys')));
        return li;
    }

    async function open(id, sys) {
        const { message: m } = await api('?action=get&id=' + id + (sys ? '&sys=1' : ''));
        state.open = m; syncBar(); show('read');
        const box = $('wm-read'); box.replaceChildren();
        box.append(el('h2', '', m.subject || t('nosub')));
        const meta = el('p', 'muted'); meta.textContent = t('from') + ': ' + (m.from_addr || '—') + '  ·  ' + t('to') + ': ' + (m.to_addr || '—') + '  ·  ' + new Date(m.created_at * 1000).toLocaleString();
        box.append(meta, el('pre', 'wm-text', m.body));
        const acts = el('div', 'wm-acts');
        const rep = el('button', 'wm-pill', '↩ ' + t('reply')); rep.type = 'button';
        rep.addEventListener('click', () => compose(null, { to: bare(m.folder === 'sent' ? m.to_addr : m.from_addr), subject: /^re:/i.test(m.subject) ? m.subject : 'Re: ' + m.subject, body: '\n\n' + new Date(m.created_at * 1000).toLocaleString() + ', ' + m.from_addr + ' ' + t('wrote') + ':\n' + m.body.split('\n').map((l) => '> ' + l).join('\n') }));
        const fwd = el('button', 'wm-pill', '➦ ' + t('forward')); fwd.type = 'button';
        fwd.addEventListener('click', () => compose(null, { to: '', subject: /^fwd:/i.test(m.subject) ? m.subject : 'Fwd: ' + m.subject, body: '\n\n---------- \n' + t('from') + ': ' + m.from_addr + '\n\n' + m.body }));
        acts.append(rep, fwd);
        if (state.addresses.length === 0 || sys) acts.hidden = true;
        box.append(acts);
        boot().catch(() => {});
    }

    function compose(draft, pre) {
        if (!state.addresses.length) return note(t('noaddr'));
        state.draftId = draft ? draft.id : 0;
        const w = $('wm-win'); w.style.left = w.style.top = w.style.right = w.style.bottom = '';   // back to the corner each time
        $('wm-win').hidden = false;
        $('wm-win-title').textContent = t('newm');
        $('wm-to').value = draft ? draft.to_addr : (pre ? pre.to : '');
        $('wm-subject').value = draft ? draft.subject : (pre ? pre.subject : '');
        $('wm-body').value = draft ? '' : (pre ? pre.body : '');
        $('wm-win-msg').textContent = !state.admin ? t('local_only') : (state.driver ? '' : t('off'));
        if (draft) api('?action=get&id=' + draft.id).then(({ message }) => { $('wm-body').value = message.body; const o = [...$('wm-from').options].find((x) => state.addresses.find((a) => String(a.id) === x.value && a.address === message.from_addr)); if (o) $('wm-from').value = o.value; });
        ($('wm-to').value ? $('wm-body') : $('wm-to')).focus();
    }
    const dirty = () => $('wm-to').value.trim() || $('wm-subject').value.trim() || $('wm-body').value.trim();
    const payload = () => ({ from_id: Number($('wm-from').value), to: $('wm-to').value, subject: $('wm-subject').value, body: $('wm-body').value });

    async function closeWin() {
        if (dirty()) { try { await api('', { action: 'save_draft', id: state.draftId, ...payload() }); note(t('saved')); } catch (e) { note(e.message); } }
        $('wm-win').hidden = true; state.draftId = 0;
        boot().catch(() => {}); if (state.folder === 'draft') load().catch(() => {});
    }

    async function bulk(kind) {
        const ids = state.open ? [state.open.id] : [...state.sel];
        if (!ids.length) return;
        if (kind === 'delete' && !window.confirm(t('confirm_del'))) return;
        const map = { read: { action: 'read', value: 1 }, unread: { action: 'read', value: 0 }, trash: { action: 'trash' }, restore: { action: 'restore' }, delete: { action: 'delete' } };
        try { await api('', { ids, ...map[kind] }); note(kind === 'trash' ? t('moved') : kind === 'restore' ? t('restored') : kind === 'delete' ? t('deleted') : ''); await load(); boot().catch(() => {}); } catch (e) { note(e.message); }
    }

    async function addresses() {
        show('addr');
        const box = $('wm-addr'); box.replaceChildren();
        const { rows, domain, users } = await api('?action=addresses');
        const form = el('form', 'wm-newaddr');
        const local = el('input'); local.placeholder = t('a_local'); local.maxLength = 32; local.autocomplete = 'off';
        const at = el('span', 'muted', '@' + domain);
        const user = el('input'); user.placeholder = t('a_user'); user.value = state.me; user.setAttribute('list', 'wm-users'); user.setAttribute('aria-label', t('a_user'));
        const dl = el('datalist'); dl.id = 'wm-users'; for (const u of users || []) { const o = el('option'); o.value = u; dl.append(o); } user.maxLength = 40; user.autocomplete = 'off';
        const go = el('button', 'wm-send', t('a_make')); go.type = 'submit';
        form.append(el('b', '', t('a_new')), local, at, user, dl, go);
        const msg = el('p', 'muted'); msg.setAttribute('role', 'status');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            try { const r = await api('', { action: 'create_address', local: local.value, username: user.value }); await boot(); await addresses(); $('wm-addr').append(el('p', 'muted', t('a_made') + r.address)); }
            catch (x) { msg.textContent = x.message; }
        });
        box.append(form, msg);
        if (!rows.length) box.append(el('p', 'muted', t('a_none')));
        for (const r of rows) {
            const line = el('div', 'wm-arow'); const who = el('span', 'wm-who'); who.append(el('b', '', r.address), el('span', 'muted', t('a_owner') + ': ' + (r.username || '—'))); line.append(who);
            const del = el('button', 'wm-pill', t('a_del')); del.type = 'button';
            del.addEventListener('click', async () => { if (!window.confirm(t('a_sure'))) return; try { await api('', { action: 'delete_address', id: r.id }); await boot(); await addresses(); } catch (x) { note(x.message); } });
            line.append(del); box.append(line);
        }
    }

    document.querySelectorAll('.wm-folder').forEach((b) => b.addEventListener('click', () => { $('wm-q').value = ''; load(b.dataset.folder, '').catch((e) => note(e.message)); }));
    document.querySelectorAll('[data-bulk]').forEach((b) => b.addEventListener('click', () => bulk(b.dataset.bulk)));
    $('wm-back').addEventListener('click', () => load().catch((e) => note(e.message)));
    $('wm-refresh').addEventListener('click', () => { boot().catch(() => {}); load().catch((e) => note(e.message)); });
    if ($('wm-switch')) $('wm-switch').addEventListener('change', (e) => { state.addr = e.target.value; const cur = state.addresses.find((a) => a.address === state.addr); if (cur) $('wm-from').value = String(cur.id); load().catch(() => {}); });
    $('wm-search').addEventListener('submit', (e) => { e.preventDefault(); load(state.folder === 'addresses' ? 'inbox' : state.folder, $('wm-q').value.trim()).catch((x) => note(x.message)); });
    $('wm-compose').addEventListener('click', () => compose(null));
    $('wm-win-close').addEventListener('click', closeWin);
    // the writing window can be dragged by its title bar (not on phones, where it fills the screen)
    $('wm-win').querySelector('.wm-win-head').addEventListener('pointerdown', (e) => {
        if (e.target.closest('button') || e.button > 0 || matchMedia('(max-width: 760px)').matches) return;
        const w = $('wm-win'), r = w.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
        w.style.right = w.style.bottom = 'auto'; w.style.left = r.left + 'px'; w.style.top = r.top + 'px';
        const head = e.currentTarget; head.setPointerCapture(e.pointerId);
        const move = (m) => {
            w.style.left = Math.min(Math.max(0, m.clientX - dx), innerWidth - 80) + 'px';   // always keep part of the bar on screen
            w.style.top = Math.min(Math.max(0, m.clientY - dy), innerHeight - 40) + 'px';
        };
        const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', up); };
        head.addEventListener('pointermove', move); head.addEventListener('pointerup', up); head.addEventListener('pointercancel', up);
    });
    $('wm-empty').addEventListener('click', async () => { if (!window.confirm(t('confirm_empty'))) return; try { await api('', { action: 'empty_trash' }); await load(); } catch (e) { note(e.message); } });
    $('wm-win').addEventListener('submit', async (e) => {
        e.preventDefault();
        $('wm-send').disabled = true;
        try {
            const r = await api('', { action: 'send', draft_id: state.draftId, ...payload() });
            $('wm-win').hidden = true; state.draftId = 0;
            note(r.external && !r.sent_now ? t('sentext') : t('sent'));
            boot().catch(() => {}); load().catch(() => {});
        } catch (x) { $('wm-win-msg').textContent = x.message; }
        $('wm-send').disabled = false;
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('wm-win').hidden) closeWin(); });

    const drawer = (on) => { $('wm-rail').classList.toggle('open', on); $('wm-scrim').hidden = !on; $('wm-burger').setAttribute('aria-expanded', String(on)); };
    $('wm-burger').addEventListener('click', () => drawer(!$('wm-rail').classList.contains('open')));
    $('wm-scrim').addEventListener('click', () => drawer(false));
    document.querySelectorAll('.wm-folder, .wm-compose').forEach((b) => b.addEventListener('click', () => drawer(false)));
    $('wm-fab').addEventListener('click', () => compose(null));

    boot().then(() => load('inbox', '')).catch((e) => note(e.message));
})();
