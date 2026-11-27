// js/webmail.js — personal mail, Gmail-like: folders, search, stars, read/unread, trash, reply/forward, a writing window, and (admin) addresses.
// Everything that comes from outside (senders, subjects, bodies) goes in with textContent.
(function () {
    const $ = (id) => document.getElementById(id);
    let T = {};
    try { T = JSON.parse($('wm-i18n').textContent); } catch (e) { /* the page still works with empty texts */ }
    const t = (k) => T[k] || k;
    const state = { folder: 'inbox', q: '', rows: [], open: null, sel: new Set(), addresses: [], domain: '', draftId: 0, admin: document.body.dataset.admin === '1', addr: '', me: '', files: [], uploading: 0, unread: null, title: document.title, win: 0, saving: null, saveT: 0, pending: null, sigBlock: '' };

    async function api(path, body, keepalive) {
        const r = await fetch('../api/webmail.php' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: !!keepalive } : {});
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
        const n = b.counts.inbox_unread;   // the unread count in the tab title; new mail while I am away shows a desktop notification (if allowed)
        document.title = (n ? '(' + n + ') ' : '') + state.title;
        if (state.unread !== null && n > state.unread) {
            if (document.hidden && 'Notification' in window && Notification.permission === 'granted') { try { new Notification(state.title, { body: (n - state.unread) + ' ' + t('new_mail'), tag: 'wm-new' }); } catch (e) { /* some phones refuse */ } }
            if (!state.open && state.folder === 'inbox' && !state.q) load().catch(() => {});
        }
        state.unread = n;
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
        $('wm-label').hidden = f === 'system' || f === 'draft' || !(listing || reading);
        $('wm-label').value = '?';
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
        const mid = el('span', 'wm-mid'); if (r.label) mid.append(el('i', 'wm-dot l-' + r.label));
        mid.append(el('b', '', (r.nfiles > 0 ? '📎 ' : '') + (r.subject || t('nosub'))), el('span', 'muted', ' — ' + (r.snippet || '')));
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
        const meta = el('p', 'muted'); meta.textContent = t('from') + ': ' + (m.from_addr || '—') + '  ·  ' + t('to') + ': ' + (m.to_addr || '—') + (m.cc_addr ? '  ·  ' + t('cc') + ': ' + m.cc_addr : '') + (m.bcc_addr ? '  ·  ' + t('bcc') + ': ' + m.bcc_addr : '') + '  ·  ' + new Date(m.created_at * 1000).toLocaleString();
        box.append(meta, el('pre', 'wm-text', m.body));
        if (m.files && m.files.length) {
            const fl = el('div', 'wm-files'); fl.append(el('b', '', t('attached') + ': '));
            const pv = el('div', 'wm-previews');
            for (const f of m.files) {
                const url = '../api/webmail.php?action=file&id=' + f.id;
                const a = el('a', 'wm-chip', '📎 ' + f.name + ' (' + size(f.size) + ')'); a.href = url; a.setAttribute('download', f.name); fl.append(a);
                // pictures and PDFs can be looked at without downloading; the server checks the real bytes before it shows anything inline
                if (/^image\/(png|jpeg|gif|webp)$/.test(f.mime)) { const l = el('a'); l.href = url + '&preview=1'; l.target = '_blank'; l.rel = 'noopener'; const im = el('img', 'wm-thumb'); im.src = url + '&preview=1'; im.alt = f.name; im.loading = 'lazy'; l.append(im); pv.append(l); }
                else if (f.mime === 'application/pdf') { const l = el('a', 'wm-chip', '👁 ' + t('preview') + ' PDF'); l.href = url + '&preview=1'; l.target = '_blank'; l.rel = 'noopener'; fl.append(l); }
            }
            box.append(fl, pv);
        }
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
        flushPending(false);   // a message still waiting in its "undo" seconds goes out now
        clearTimeout(state.saveT); state.win++;
        state.draftId = draft ? draft.id : 0; state.files = []; renderFiles();
        $('wm-win').hidden = false; $('wm-sigbox').hidden = true;
        $('wm-win-title').textContent = t('newm');
        $('wm-to').value = draft ? draft.to_addr : (pre ? pre.to : '');
        $('wm-subject').value = draft ? draft.subject : (pre ? pre.subject : '');
        $('wm-cc').value = draft ? (draft.cc_addr || '') : ''; $('wm-bcc').value = ''; $('wm-ccrow').hidden = !$('wm-cc').value;
        $('wm-body').value = ''; state.sigBlock = '';
        if (!draft) { swapSig(); $('wm-body').value += pre ? pre.body : ''; }
        $('wm-win-msg').textContent = !state.admin ? t('local_only') : (state.driver ? '' : t('off'));
        if (draft) api('?action=get&id=' + draft.id).then(({ message }) => { $('wm-body').value = message.body; const o = [...$('wm-from').options].find((x) => state.addresses.find((a) => String(a.id) === x.value && a.address === message.from_addr)); if (o) $('wm-from').value = o.value; $('wm-cc').value = message.cc_addr || ''; $('wm-bcc').value = message.bcc_addr || ''; $('wm-ccrow').hidden = !(message.cc_addr || message.bcc_addr); });
        loadContacts();
        if ($('wm-to').value) { $('wm-body').focus(); $('wm-body').setSelectionRange(0, 0); } else $('wm-to').focus();
    }
    // suggestions for the "To" field: the addresses I wrote to before from the chosen sender, completing the last item of a comma list
    let contacts = [];
    async function loadContacts() { try { contacts = (await api('?action=contacts&from_id=' + Number($('wm-from').value || 0))).contacts || []; } catch (e) { contacts = []; } suggest(); }
    function suggest(box) {
        const v = (box && box.value != null ? box : $('wm-to')).value, cut = Math.max(v.lastIndexOf(','), v.lastIndexOf(';')), head = v.slice(0, cut + 1), tail = v.slice(cut + 1).trim().toLowerCase();
        const dl = $('wm-contacts'); dl.replaceChildren();
        for (const c of contacts.filter((c) => c.includes(tail) && !head.toLowerCase().includes(c)).slice(0, 8)) { const o = el('option'); o.value = head + (head ? ' ' : '') + c; dl.append(o); }
    }
    for (const id of ['wm-to', 'wm-cc', 'wm-bcc']) $(id).addEventListener('input', (e) => suggest(e.target));
    // the signature of the chosen address goes at the end of a new message (a reply: above the quote); changing the sender swaps it
    function swapSig() {
        const a = state.addresses.find((x) => String(x.id) === $('wm-from').value), nb = a && a.signature ? '\n\n-- \n' + a.signature : '', b = $('wm-body');
        if (state.sigBlock && b.value.includes(state.sigBlock)) b.value = b.value.replace(state.sigBlock, () => nb);
        else if (!state.sigBlock && !b.value.trim()) b.value = nb;
        state.sigBlock = nb;
    }
    $('wm-from').addEventListener('change', () => { loadContacts(); swapSig(); });
    $('wm-cc-btn').addEventListener('click', () => { $('wm-ccrow').hidden = !$('wm-ccrow').hidden; });
    $('wm-sig-btn').addEventListener('click', () => {
        const a = state.addresses.find((x) => String(x.id) === $('wm-from').value);
        $('wm-sigbox').hidden = !$('wm-sigbox').hidden; $('wm-sig').value = a ? a.signature || '' : '';
    });
    $('wm-sig-save').addEventListener('click', async () => {
        const a = state.addresses.find((x) => String(x.id) === $('wm-from').value); if (!a) return;
        try { await api('', { action: 'set_signature', id: a.id, signature: $('wm-sig').value }); a.signature = $('wm-sig').value.replace(/\r/g, '').slice(0, 500); swapSig(); $('wm-sigbox').hidden = true; $('wm-win-msg').textContent = t('sig_saved'); }
        catch (x) { $('wm-win-msg').textContent = x.message; }
    });
    const dirty = () => $('wm-to').value.trim() || $('wm-cc').value.trim() || $('wm-bcc').value.trim() || $('wm-subject').value.trim() || $('wm-body').value.replace(state.sigBlock, '').trim();   // the automatic signature alone is not a message
    const payload = () => ({ from_id: Number($('wm-from').value), to: $('wm-to').value, cc: $('wm-cc').value, bcc: $('wm-bcc').value, subject: $('wm-subject').value, body: $('wm-body').value, file_ids: state.files.map((f) => f.id) });
    const size = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
    // attachments: each file goes up at once (the server keeps it "pending" until the message is sent)
    function renderFiles() {
        const box = $('wm-files'); box.replaceChildren();
        for (const f of state.files) {
            const chip = el('span', 'wm-chip'); chip.append(el('span', '', f.name + ' (' + size(f.size) + ')'));
            const x = el('button', 'wm-ico', '✕'); x.type = 'button'; x.setAttribute('aria-label', t('del') || 'remove');
            x.addEventListener('click', async () => { state.files = state.files.filter((g) => g.id !== f.id); renderFiles(); api('', { action: 'remove_file', id: f.id }).catch(() => {}); });
            chip.append(x); box.append(chip);
        }
    }
    async function uploadFile(file) {
        const fd = new FormData(); fd.append('action', 'upload'); fd.append('file', file);
        const r = await fetch('../api/webmail.php', { method: 'POST', body: fd });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j || !j.success) throw new Error((j && j.error) || t('wrong'));
        return j;
    }
    $('wm-attach').addEventListener('click', () => $('wm-file').click());
    $('wm-file').addEventListener('change', () => { const list = [...$('wm-file').files]; $('wm-file').value = ''; addFiles(list); });
    // drag and drop onto the writing window
    const win = $('wm-win');
    const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    win.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; win.classList.add('wm-drop'); });
    win.addEventListener('dragleave', (e) => { if (!win.contains(e.relatedTarget)) win.classList.remove('wm-drop'); });
    win.addEventListener('drop', (e) => { if (!hasFiles(e)) return; e.preventDefault(); win.classList.remove('wm-drop'); addFiles([...e.dataTransfer.files]); });
    async function addFiles(list) {
        for (const file of list) {
            if (file.size > 10 * 1048576) { $('wm-win-msg').textContent = t('too_big'); continue; }
            state.uploading++; $('wm-send').disabled = true; $('wm-win-msg').textContent = '…';
            try { state.files.push(await uploadFile(file)); $('wm-win-msg').textContent = ''; renderFiles(); }
            catch (x) { $('wm-win-msg').textContent = x.message; }
            if (--state.uploading === 0) $('wm-send').disabled = false;
        }
    }

    async function closeWin() {
        clearTimeout(state.saveT); await state.saving;
        if (dirty()) { try { await api('', { action: 'save_draft', id: state.draftId, ...payload() }); note(state.files.length ? t('saved_nofiles') : t('saved')); } catch (e) { note(e.message); } }
        for (const f of state.files) api('', { action: 'remove_file', id: f.id }).catch(() => {});
        state.files = []; renderFiles();
        $('wm-win').hidden = true; state.draftId = 0; state.win++;
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
    $('wm-search').addEventListener('submit', (e) => { e.preventDefault(); const q = $('wm-q').value.trim(); (q ? load('all', q) : load('inbox', '')).catch((x) => note(x.message)); });   // a search looks in every folder but the trash
    $('wm-compose').addEventListener('click', () => compose(null));
    $('wm-win-close').addEventListener('click', closeWin);
    // the writing window moves and resizes with the desktop's window manager (js/window_manager.js); the size and place are remembered
    document.addEventListener('DOMContentLoaded', () => { if (window.makeWindowInteractive) window.makeWindowInteractive($('wm-win'), 'wm-win', { simple: true, header: '.wm-win-head' }); });
    $('wm-empty').addEventListener('click', async () => { if (!window.confirm(t('confirm_empty'))) return; try { await api('', { action: 'empty_trash' }); await load(); } catch (e) { note(e.message); } });
    // drafts save themselves 5 seconds after the last key
    async function autosave() {
        if ($('wm-win').hidden || !dirty()) return;
        const w = state.win;
        state.saving = (async () => {
            try {
                const r = await api('', { action: 'save_draft', id: state.draftId, ...payload() });
                if (w === state.win && !$('wm-win').hidden) { state.draftId = r.id; $('wm-win-msg').textContent = t('autosaved') + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
            } catch (e) { /* the next key tries again; closing the window saves too */ }
        })();
        await state.saving;
    }
    for (const id of ['wm-to', 'wm-cc', 'wm-bcc', 'wm-subject', 'wm-body']) $(id).addEventListener('input', () => { clearTimeout(state.saveT); state.saveT = setTimeout(autosave, 5000); });

    // Send waits 10 seconds with an "Undo" button; closing the page meanwhile sends at once
    const UNDO_MS = 10000;
    function restore(job) {
        state.win++; state.draftId = job.draftId; state.files = job.files; renderFiles(); state.sigBlock = '';
        $('wm-win').hidden = false; $('wm-sigbox').hidden = true;
        const p = job.p; $('wm-from').value = String(p.from_id); $('wm-to').value = p.to; $('wm-cc').value = p.cc; $('wm-bcc').value = p.bcc; $('wm-ccrow').hidden = !(p.cc || p.bcc);
        $('wm-subject').value = p.subject; $('wm-body').value = p.body;
    }
    async function transmit(job, keepalive) {
        try {
            const r = await api('', { action: 'send', draft_id: job.draftId, ...job.p }, keepalive);
            if (keepalive) return;
            boot().catch(() => {}); await load().catch(() => {});   // load() clears the note line: say "sent" after it
            note(r.external && !r.sent_now ? t('sentext') : t('sent'));
        } catch (x) {
            if (keepalive) return;
            note(t('not_sent') + x.message);
            if ($('wm-win').hidden) { restore(job); $('wm-win-msg').textContent = t('not_sent') + x.message; }
            else api('', { action: 'save_draft', id: job.draftId, ...job.p }).then(() => boot()).catch(() => {});   // I am writing something else: the failed one waits in the drafts
        }
    }
    function flushPending(keepalive) {
        const j = state.pending; if (!j) return Promise.resolve();
        state.pending = null; clearTimeout(j.timer); $('wm-undo').hidden = true;
        return transmit(j, keepalive);
    }
    window.addEventListener('pagehide', () => flushPending(true));
    $('wm-undo-btn').addEventListener('click', () => {
        const j = state.pending; if (!j) return;
        state.pending = null; clearTimeout(j.timer); $('wm-undo').hidden = true;
        restore(j); note(t('undo_ok'));
    });
    $('wm-win').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!$('wm-to').value.trim()) { $('wm-win-msg').textContent = t('no_to'); return; }
        clearTimeout(state.saveT); await state.saving; await flushPending(false);
        const job = { p: payload(), draftId: state.draftId, files: state.files };
        $('wm-win').hidden = true; state.win++; state.draftId = 0; state.files = []; renderFiles();
        state.pending = job; $('wm-undo-txt').textContent = t('sending'); $('wm-undo').hidden = false;
        job.timer = setTimeout(() => flushPending(false), UNDO_MS);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('wm-win').hidden) closeWin(); });

    const drawer = (on) => { $('wm-rail').classList.toggle('open', on); $('wm-scrim').hidden = !on; $('wm-burger').setAttribute('aria-expanded', String(on)); };
    $('wm-burger').addEventListener('click', () => drawer(!$('wm-rail').classList.contains('open')));
    $('wm-scrim').addEventListener('click', () => drawer(false));
    document.querySelectorAll('.wm-folder, .wm-compose').forEach((b) => b.addEventListener('click', () => drawer(false)));
    $('wm-fab').addEventListener('click', () => compose(null));

    $('wm-label').addEventListener('change', async (e) => {
        const v = e.target.value; if (v === '?') return;
        const ids = state.open ? [state.open.id] : [...state.sel]; e.target.value = '?';
        if (!ids.length) return;
        try { await api('', { action: 'label', ids, value: v }); if (state.open) state.open.label = v; else await load(); } catch (x) { note(x.message); }
    });
    const bell = $('wm-bell');
    if ('Notification' in window && Notification.permission === 'default') {
        bell.hidden = false;
        bell.addEventListener('click', async () => { try { await Notification.requestPermission(); } catch (e) { /* old browsers */ } bell.hidden = Notification.permission !== 'default'; });
    }
    setInterval(() => boot().catch(() => {}), 60000);   // new mail: the tab title, the list and (if allowed) a notification

    boot().then(() => load('inbox', '')).catch((e) => note(e.message));
})();
