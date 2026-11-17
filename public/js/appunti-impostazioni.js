// public/js/appunti-impostazioni.js — personal settings of the class chosen at the top.
// Notification choices are kept on the server per class (api/notifiche.php prefs/save_prefs); the way the week and the PDFs are
// shown is a choice of this device (localStorage).
(() => {
    'use strict';
    const C = window.AppuntiCommon;
    const { el, getJson, post } = C;
    const $ = (s) => document.querySelector(s);
    const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    let classId = null;
    let classes = [];
    let mineInfo = null;

    const status = (text, kind = '') => { const s = $('#status'); s.textContent = text; s.className = 'status ' + kind; };
    const saved = (m) => { status(typeof m === 'string' ? m : VBLang.t('saved_2'), 'ok'); setTimeout(() => status(''), 2000); };
    const fail = (e) => status(e.message, 'err');

    /** My temporary links (made with "Condividi"): who opened them, when they expire, and a button to revoke each one. */
    function linksSection() {
        const box = el('div', { class: 'stack' }, el('p', { class: 'muted small', text: VBLang.t('loading') }));
        const load = async () => {
            try {
                const { links } = await getJson('../api/appunti.php?action=share_list');
                box.replaceChildren(...(links.length ? links.map((l) => el('div', { class: 'row link-row' },
                    el('span', { class: 'grow' }, el('b', { text: l.title }), el('small', { class: 'muted', text: VBLang.t('link_meta', { date: new Date(l.expires_at * 1000).toLocaleDateString(VBLang.t('locale'), { day: 'numeric', month: 'short' }), n: `${l.views} ${l.views === 1 ? VBLang.t('time_one') : VBLang.t('time_many')}`, of: l.max_views ? VBLang.t('link_of', { max: l.max_views }) : '' }) })),
                    el('button', { type: 'button', class: 'ghost mini danger', text: VBLang.t('revoke'), onclick: async () => {
                        if (!confirm(VBLang.t('revoke_the_link_to_whoever_has', { title: l.title }))) return;
                        try { await C.post('../api/appunti.php', { action: 'share_revoke', id: l.id }); await load(); } catch (e) { fail(e); }
                    } }))) : [el('p', { class: 'muted small', text: VBLang.t('no_active_links_you_create_them') })]));
            } catch (e) { box.replaceChildren(el('p', { class: 'muted small', text: VBLang.t('cannot_load_the_links') })); }
        };
        load();
        return section(VBLang.t('temporary_links'), VBLang.t('whoever_has_the_link_opens_the'), box);
    }

    function section(title, hint, ...children) {
        return el('section', { class: 'card set-sec' }, el('h2', { text: title }), hint ? el('p', { class: 'muted small', text: hint }) : null, ...children);
    }
    function sw(label, checked, onchange, disabled = false) {
        return el('label', { class: 'switch' }, el('input', { type: 'checkbox', checked, disabled, onchange: (ev) => onchange(ev.target.checked, ev.target) }), label);
    }


    /* ---------- notifications received, and this device ---------- */
    const b64uToBytes = (s) => {
        const raw = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
        return Uint8Array.from(raw, (c) => c.charCodeAt(0));
    };
    const when = (t) => new Date(t * 1000).toLocaleString(VBLang.t('locale'), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

    async function pushBox(box, devices) {
        if (!pushSupported) {
            box.replaceChildren(el('span', { text: isIos && !isStandalone
                ? VBLang.t('to_receive_reminders_on_the_iphone')
                : VBLang.t('this_browser_does_not_support_push') }));
            return;
        }
        let sub = null;
        try { const reg = await navigator.serviceWorker.getRegistration('./'); sub = reg && await reg.pushManager.getSubscription(); } catch (e) { /* none */ }
        if (Notification.permission === 'denied') {
            box.replaceChildren(el('span', { text: VBLang.t('you_have_blocked_notifications_for_this') }));
            return;
        }
        const redo = () => drawNotifs();
        const enable = async () => {
            try {
                if (await Notification.requestPermission() !== 'granted') { status(VBLang.t('without_the_browser_s_permission_notificatio'), 'err'); redo(); return; }
                const reg = await navigator.serviceWorker.register('appunti-sw.js', { scope: './' });
                await navigator.serviceWorker.ready;
                const { public_key: key } = await getJson('../api/notifiche.php?action=vapid');
                let sb = await reg.pushManager.getSubscription();
                if (!sb) sb = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(key) });
                const j = sb.toJSON();
                await post('../api/notifiche.php', { action: 'subscribe', endpoint: j.endpoint, keys: j.keys });
                status(VBLang.t('notifications_turned_on'), 'ok'); redo();
            } catch (e) { status(VBLang.t('could_not_turn_on_notifications') + e.message, 'err'); }
        };
        const disable = async () => {
            try {
                const reg = await navigator.serviceWorker.getRegistration('./');
                const sb = reg && await reg.pushManager.getSubscription();
                if (sb) { await post('../api/notifiche.php', { action: 'unsubscribe', endpoint: sb.endpoint }); await sb.unsubscribe(); }
                status(VBLang.t('notifications_turned_off_on_this_device'), 'ok'); redo();
            } catch (e) { fail(e); }
        };
        const test = async () => {
            try {
                const r = await post('../api/notifiche.php', { action: 'test' });
                status(r.delivered ? VBLang.t('test_sent_it_should_arrive_in') : VBLang.t('the_test_did_not_go_out'), r.delivered ? 'ok' : 'err');
            } catch (e) { fail(e); }
        };
        box.replaceChildren(sub
            ? el('div', {}, el('span', { text: VBLang.t('notif_on_here', { others: devices > 1 ? VBLang.t('notif_others', { n: devices - 1 }) : '' }) }),
                el('div', { class: 'row' }, el('button', { class: 'ghost mini', text: VBLang.t('turn_off_here'), onclick: disable })))
            : el('div', {}, el('span', { text: VBLang.t('you_get_the_reminders_even_when') }),
                el('div', { class: 'row' }, el('button', { class: 'mini', text: VBLang.t('turn_on_notifications_on_this_device'), onclick: enable }))));
    }

    async function drawNotifs() {
        const box = document.querySelector('#notifs-box');
        if (!box) return;
        let r;
        try { r = await getJson('../api/notifiche.php?action=list'); } catch (e) { return; }
        const device = el('div', { class: 'push-box' });
        const KINDS = { promemoria: VBLang.t('tests_and_oral_exams'), annuncio: VBLang.t('announcements'), turno: VBLang.t('oral_exam_turns_2'), prova: VBLang.t('test_notifications') };
        const groups = new Map();
        for (const n of r.notifications) { if (!groups.has(n.kind)) groups.set(n.kind, []); groups.get(n.kind).push(n); }
        const remove = async (body) => { try { await post('../api/notifiche.php', { action: 'delete', ...body }); drawNotifs(); } catch (e) { fail(e); } };
        const open = new Set(JSON.parse(C.stored('vb_notif_open') || '[]'));
        const list = el('div', { class: 'n-groups' }, ...(groups.size ? [...groups].map(([kind, items]) => {
            const d = el('details', { class: 'n-group', open: open.has(kind) },
                el('summary', {}, el('span', { class: 'n-title', text: KINDS[kind] || VBLang.t('other') }), el('span', { class: 'n-count', text: String(items.length) }),
                    el('button', { type: 'button', class: 'ghost mini', text: VBLang.t('delete_2'), onclick: (ev) => { ev.preventDefault(); remove({ kind }); } })),
                ...items.map((n) => el('div', { class: 'n-item' + (n.read ? '' : ' unread'), onclick: () => {
                    const u = new URL(n.url || '/pages/appunti.php', location.origin);
                    if (u.origin === location.origin) location.href = u.href;
                } }, el('div', { class: 'n-text' }, el('b', { text: n.title }), n.body ? el('span', { text: n.body }) : null, el('span', { class: 'when', text: when(n.created_at) })),
                    el('button', { type: 'button', class: 'ghost mini n-x', text: '✕', title: VBLang.t('remove_this_notification'), 'aria-label': VBLang.t('remove_this_notification'),
                        onclick: (ev) => { ev.stopPropagation(); remove({ ids: [n.id] }); } }))));
            d.addEventListener('toggle', () => { d.open ? open.add(kind) : open.delete(kind); C.store('vb_notif_open', JSON.stringify([...open])); });
            return d;
        }) : [el('p', { class: 'muted', text: VBLang.t('no_notifications_yet') })]));
        if (r.notifications.length > 1) list.append(el('button', { type: 'button', class: 'ghost mini', text: VBLang.t('delete_all'), onclick: () => { if (confirm(VBLang.t('delete_all_notifications'))) remove({ all: true }); } }));
        box.replaceChildren(list);
        const slot = document.querySelector('#push-slot');
        if (slot) slot.replaceChildren(device);
        pushBox(device, r.devices);
        if (r.unread) { try { await post('../api/notifiche.php', { action: 'read_all' }); } catch (e) { /* ignore */ } }
    }

    /** The voice that reads the quiz questions aloud (the browser's own: on Linux and Windows PCs it can sound robotic; phones are better). */
    function voiceSection() {
        const sel = el('select', { 'aria-label': VBLang.t('voice'), onchange: () => { C.store('vb_tts_voice', sel.value); saved(); } });
        const fill = () => {
            const voices = speechSynthesis.getVoices().filter((v) => /^it/i.test(v.lang));
            sel.replaceChildren(el('option', { value: '', text: VBLang.t('device_default') }), ...voices.map((v) => el('option', { value: v.voiceURI, text: `${v.name} (${v.lang})` })));
            sel.value = C.stored('vb_tts_voice') || '';
        };
        fill();
        speechSynthesis.onvoiceschanged = fill;
        const rate = el('select', { 'aria-label': VBLang.t('speed'), onchange: () => { C.store('vb_tts_rate', rate.value); saved(); } },
            ...[['0.8', VBLang.t('slow')], ['1', VBLang.t('normal')], ['1.2', VBLang.t('fast')], ['1.5', VBLang.t('very_fast')]].map(([v, t]) => el('option', { value: v, text: t })));
        rate.value = C.stored('vb_tts_rate') || '1';
        return section(VBLang.t('voice_for_the_questions'), VBLang.t('in_quizzes_the_read_button_reads'),
            el('label', { text: VBLang.t('voice') }, sel), el('label', { text: VBLang.t('speed') }, rate),
            el('button', { type: 'button', class: 'ghost mini', text: VBLang.t('try_the_voice'), onclick: () => C.speak('Qual è la capitale d\'Italia? A: Roma. B: Milano.') }));
    }

    /** Three things to send in the class chat, one after the other: a short message, the link, the code (each copies with one tap). */
    function inviteDialog(c) {
        const link = `${location.origin}/pages/appunti-guida.php`;
        const msg = VBLang.t('hey_everyone_i_opened_the_class');
        const block = (title, text, rows) => [el('label', { text: title }, el('textarea', { rows, readOnly: true, value: text })),
            el('button', { type: 'button', class: 'ghost mini', text: VBLang.t('copy'), onclick: () => copy(text) })];
        C.dialogForm(VBLang.t('to_invite_the_class'), (form) => {
            form.append(el('p', { class: 'muted small', text: VBLang.t('send_them_in_order_message_link') }),
                ...block(VBLang.t('1_message'), msg, 4), ...block(VBLang.t('2_link'), link, 1), ...block(VBLang.t('3_code'), c.invite_code, 1));
            form.querySelectorAll('textarea').forEach((t, i) => { t.value = [msg, link, c.invite_code][i]; });
        }, async () => {}, VBLang.t('close'));
    }
    const copy = async (t) => { try { await navigator.clipboard.writeText(t); saved(VBLang.t('copied')); } catch (e) { fail(new Error(VBLang.t('cannot_copy_select_the_text_and'))); } };

    /** Scoreboard: I take part or not (leaving deletes my points); who manages settings also switches it on/off and chooses who sees it. */
    function scoreSection(sc, c) {
        const canSettings = (c.perms || []).includes('settings');
        const me = sw(VBLang.t('show_me_in_the_leaderboard'), sc.in, async (on, box) => {
            if (!on && !confirm(VBLang.t('if_you_leave_the_leaderboard_your'))) { box.checked = true; return; }
            try { await post('../api/classifica.php', { action: 'set_in', class_id: classId, in: on }); saved(); } catch (e) { box.checked = !on; fail(e); }
        });
        const who = el('select', { 'aria-label': VBLang.t('who_sees_the_leaderboard'), disabled: !canSettings, onchange: () => saveClass() },
            el('option', { value: 'all', text: VBLang.t('the_whole_class') }), el('option', { value: 'perm', text: VBLang.t('only_the_class_representative_and_people') }));
        who.value = sc.who || 'all';
        let on = sc.on;
        const saveClass = async () => { try { await post('../api/classifica.php', { action: 'settings', class_id: classId, on, who: who.value }); saved(); } catch (e) { fail(e); } };
        return section(VBLang.t('leaderboard'), VBLang.t('points_for_right_answers_on_the'),
            me,
            el('div', { class: 'set-sub-block' },
                sw(VBLang.t('leaderboard_on_for_the_class'), on, (v) => { on = v; saveClass(); }, !canSettings),
                el('label', { text: VBLang.t('who_sees_it') }, who),
                canSettings ? null : el('p', { class: 'muted small', text: VBLang.t('it_is_turned_on_and_off') })));
    }

    /** "Come lo vedo": choices kept on this device (no account needed). */
    function viewSection() {
        const week = el('select', { 'aria-label': VBLang.t('the_week_starts_on'), onchange: (ev) => { C.store('vb_week_start', ev.target.value); saved(); } },
            el('option', { value: 'mon', text: VBLang.t('monday') }), el('option', { value: 'sun', text: VBLang.t('sunday') }));
        week.value = C.stored('vb_week_start') === 'sun' ? 'sun' : 'mon';
        const pdf = el('select', { 'aria-label': VBLang.t('how_pdfs_open'), onchange: (ev) => { C.store('vb_pdf_mode', ev.target.value); saved(); } },
            el('option', { value: 'auto', text: VBLang.t('text_on_the_phone_pages_on') }), el('option', { value: 'text', text: VBLang.t('always_text') }), el('option', { value: 'pages', text: VBLang.t('always_pages') }));
        pdf.value = C.stored('vb_pdf_mode') || 'auto';
        const openTab = el('select', { 'aria-label': VBLang.t('notes_open_on'), onchange: (ev) => { C.store('vb_open_tab', ev.target.value); saved(); } },
            ...[['last', VBLang.t('the_last_tab_you_used')], ['board', VBLang.t('board')], ['class', VBLang.t('class_with_the_timetable')], ['calendar', VBLang.t('calendar')], ['study', VBLang.t('study')], ['score', VBLang.t('leaderboard')], ['material', VBLang.t('material')]].map(([v, t]) => el('option', { value: v, text: t })));
        openTab.value = C.stored('vb_open_tab') || 'last';
        return section(VBLang.t('how_i_see_it'), VBLang.t('on_this_device'),
            el('label', { text: VBLang.t('notes_open_on') }, openTab),
            sw(VBLang.t('i_use_the_phone_with_my'), C.stored('vb_lefty') === '1', (on) => { C.store('vb_lefty', on ? '1' : '0'); document.documentElement.classList.toggle('lefty', on); saved(); }),
            el('label', { text: VBLang.t('the_week_starts_on_2') }, week),
            el('label', { text: VBLang.t('pdfs_of_the_archive_open_with') }, pdf));
    }

    /** A visitor with no account: only what is kept on this device. */
    function drawGuest() {
        const up = window.AppuntiUpload.settings();
        $('#settings-root').replaceChildren(
            section(VBLang.t('you_have_no_account'), VBLang.t('notifications_the_name_in_class_and'),
                el('a', { class: 'ghost-link', href: 'login.php?next=appunti-impostazioni.php', text: VBLang.t('sign_in_or_sign_up') })),
            viewSection(),
            ...(C.canSpeak() ? [voiceSection()] : []),
            section(VBLang.t('uploads'), VBLang.t('on_this_device_needed_when_you'),
                sw(VBLang.t('resume_interrupted_uploads_by_themselves'), up.auto, (on) => { window.AppuntiUpload.setSetting('auto', on); saved(); }),
                sw(VBLang.t('shrink_big_photos_before_sending_them'), up.shrink, (on) => { window.AppuntiUpload.setSetting('shrink', on); saved(); })));
    }

    async function draw() {
        const root = $('#settings-root');
        root.replaceChildren(el('p', { class: 'muted', text: VBLang.t('loading') }));
        let cls, prefs, sc;
        try {
            [cls, prefs, sc] = await Promise.all([getJson(`../api/classi.php?action=class&id=${classId}`), getJson(`../api/notifiche.php?action=prefs&class_id=${classId}`),
                getJson(`../api/classifica.php?action=board&class_id=${classId}`).catch(() => null)]);
        } catch (e) {
            root.replaceChildren(section(VBLang.t('settings'), VBLang.t('to_change_the_settings_you_have'), el('a', { class: 'ghost-link', href: 'appunti.php', text: VBLang.t('back_to_notes') })));
            return;
        }
        const c = cls.class;
        const me = c.members.find((m) => m.is_me);
        const p = prefs.prefs;
        const sendPrefs = async () => {
            try { await post('../api/notifiche.php', { action: 'save_prefs', class_id: classId, prefs: p }); saved(); } catch (e) { fail(e); }
        };
        let digestRow = null;
        let hourRow = null;
        const up = window.AppuntiUpload.settings();
        const slotLabel = { d7: VBLang.t('one_week_before_at_16_00'), d3: VBLang.t('three_days_before_at_16_00'), d2: VBLang.t('two_days_before_at_16_00'), d1: VBLang.t('the_day_before_at_16_00'), sera: VBLang.t('the_evening_before_at_21_00') };

        // name in the class
        const name = el('input', { name: 'name', maxLength: 40, placeholder: VBLang.t('first_and_last_name'), value: me ? me.display_name : '' });
        const nameForm = el('form', { class: 'name-form' }, el('label', { for: 'my-name', text: VBLang.t('your_name_in_this_class') }),
            el('div', { class: 'inline-pair' }, name, el('button', { class: 'ghost', text: VBLang.t('save') })));
        name.id = 'my-name';
        nameForm.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            try { await post('../api/classi.php', { action: 'display_name', id: classId, name: name.value }); saved(); } catch (e) { fail(e); }
        });

        const slotBox = el('div', { class: 'set-sub' }, ...prefs.slots.map((s) => sw(slotLabel[s.key] || s.key, p.slots.includes(s.key), (on) => {
            p.slots = on ? [...new Set([...p.slots, s.key])] : p.slots.filter((x) => x !== s.key);
            sendPrefs();
        })));
        slotBox.hidden = !p.promemoria;


        // class code and the automatic summary (who may manage settings changes the summary; the code is for who manages members)
        const canSettings = (c.perms || []).includes('settings');
        const codeBox = c.invite_code ? el('div', {},
            el('p', { class: 'muted small', text: VBLang.t('invite_code_give_it_only_to') }),
            el('span', { class: 'code', text: c.invite_code }),
            el('div', { class: 'code-actions' },
                el('button', { class: 'ghost mini', text: VBLang.t('copy'), onclick: () => navigator.clipboard && navigator.clipboard.writeText(c.invite_code).then(() => saved(VBLang.t('code_copied'))) }),
                el('button', { class: 'ghost mini danger-soft', text: VBLang.t('new_code'), onclick: async () => {
                    if (!confirm(VBLang.t('the_old_code_will_stop_working'))) return;
                    try { await post('../api/classi.php', { action: 'regen_code', id: classId }); await draw(); drawNotifs(); saved(VBLang.t('new_code_created')); } catch (e) { fail(e); }
                } })),
            el('div', { class: 'invite-row' }, el('button', { type: 'button', class: 'ghost mini invite-btn', text: VBLang.t('invite_the_class'), onclick: () => inviteDialog(c) })))
            : el('p', { class: 'muted small', text: VBLang.t('the_invite_code_is_held_by') });
        const time = el('input', { type: 'time', name: 'summary_time', value: c.summary_time, required: true, disabled: !canSettings });
        const sumForm = el('form', { class: 'row' }, el('label', { text: VBLang.t('every_day_at') }, time), canSettings ? el('button', { class: 'ghost', text: VBLang.t('save_the_time') }) : null);
        const sendSummary = async (on) => post('../api/classi.php', { action: 'settings', id: classId, summary_time: time.value, timezone: c.timezone, summary_on: on });
        let summaryOn = c.summary_on;
        sumForm.addEventListener('submit', async (ev) => { ev.preventDefault(); try { await sendSummary(summaryOn); c.summary_time = time.value; saved(); } catch (e) { fail(e); } });
        // the AI (Google Gemini) only reads the class if every student is an adult: declared when the class is requested, switched on here later
        const aiOn = c.ai_allowed !== false;
        const aiBox = el('div', {},
            el('p', {}, el('b', { text: aiOn ? VBLang.t('the_ai_is_on_for_this') : VBLang.t('the_ai_is_off_for_this') })),
            el('p', { class: 'muted small', text: aiOn
                ? VBLang.t('it_is_on_because_all_the') + (c.ai_adults_at ? VBLang.t('declared_on', { date: new Date(c.ai_adults_at * 1000).toLocaleDateString(VBLang.t('locale')) }) : '') + VBLang.t('ai_google_reads')
                : VBLang.t('until_all_students_are_of_age') }),
            canSettings
                ? (aiOn
                    ? el('button', { type: 'button', class: 'ghost mini danger-soft', text: VBLang.t('turn_off_the_ai'), onclick: async () => {
                        if (!confirm(VBLang.t('turn_off_the_ai_for_this'))) return;
                        try { await post('../api/classi.php', { action: 'ai_switch', id: classId, on: false }); await draw(); drawNotifs(); saved(VBLang.t('ai_turned_off')); } catch (e) { fail(e); }
                    } })
                    : el('button', { type: 'button', class: 'ghost mini', text: VBLang.t('turn_on_the_ai'), onclick: () => C.dialogForm(VBLang.t('turn_on_the_ai_for_the'), (form) => {
                        form.append(el('p', { class: 'muted small', text: VBLang.t('the_class_material_will_be_sent') }),
                            el('label', { class: 'check-row' }, el('input', { type: 'checkbox', name: 'adults', required: true }), el('span', { text: VBLang.t('i_confirm_that_all_the_students') })));
                    }, async (form) => {
                        await post('../api/classi.php', { action: 'ai_switch', id: classId, on: true, adults_confirm: form.adults.checked });
                        await draw(); drawNotifs(); saved(VBLang.t('ai_turned_on'));
                    }, VBLang.t('turn_on')) }))
                : el('p', { class: 'muted small', text: VBLang.t('the_class_representative_or_someone_with') }));
        const summaryBox = el('div', {},
            sw(VBLang.t('automatic_summary_of_the_notes'), summaryOn, async (on, box) => {
                try { await sendSummary(on); summaryOn = on; sumForm.hidden = !on; saved(); } catch (e) { box.checked = !on; fail(e); }
            }, !canSettings),
            sumForm,
            el('p', { class: 'muted small', text: VBLang.t('once_a_day_the_ai_redoes') + (canSettings ? '' : VBLang.t('the_class_representative_or_someone_with_2')) }));
        sumForm.hidden = !summaryOn;

        // missing notes: the class chooses from when to when, and which subjects do not count
        const mi = c.missing || { on: false, from: '', to: '', subjects_off: [] };
        let missingOn = mi.on;
        const fromIn = el('input', { type: 'date', value: mi.from, disabled: !canSettings });
        const toIn = el('input', { type: 'date', value: mi.to, disabled: !canSettings });
        const offs = new Set(mi.subjects_off);
        const sendMissing = async () => {
            try { await post('../api/classi.php', { action: 'settings', id: classId, summary_time: c.summary_time, timezone: c.timezone, missing_on: missingOn, missing_from: fromIn.value, missing_to: toIn.value, missing_subjects_off: [...offs] }); saved(); } catch (e) { fail(e); }
        };
        fromIn.addEventListener('change', sendMissing); toIn.addEventListener('change', sendMissing);
        const missingBody = el('div', { class: 'set-sub-block' },
            el('div', { class: 'grid2' }, el('label', { text: VBLang.t('from_2') }, fromIn), el('label', { text: VBLang.t('to_optional') }, toIn)),
            el('p', { class: 'muted small', text: VBLang.t('which_subjects_count') }),
            ...c.subjects.map((s) => sw(s.name, !offs.has(s.id), (on) => { if (on) offs.delete(s.id); else offs.add(s.id); sendMissing(); }, !canSettings)));
        missingBody.hidden = !missingOn;
        const missingBox = el('div', {},
            sw(VBLang.t('report_missing_notes_on_the_board'), missingOn, (on) => { missingOn = on; missingBody.hidden = !on; if (on && !fromIn.value) fromIn.value = new Date().toISOString().slice(0, 10); sendMissing(); }, !canSettings),
            missingBody,
            el('p', { class: 'muted small', text: VBLang.t('shows_the_lessons_already_held_for') + (canSettings ? '' : VBLang.t('the_class_representative_or_someone_with_3')) }));

        // weekly digest: chosen by who manages the class settings (default Sunday 19:00)
        const dg = c.digest || { on: true, day: 0, hour: 19 };
        let digestOn = dg.on;
        const dayPick = el('select', { 'aria-label': VBLang.t('day_of_the_summary'), disabled: !canSettings, onchange: () => sendDigest() },
            ...[[1, VBLang.t('monday')], [2, VBLang.t('tuesday')], [3, VBLang.t('wednesday')], [4, VBLang.t('thursday')], [5, VBLang.t('friday')], [6, VBLang.t('saturday')], [0, VBLang.t('sunday')]].map(([v, t]) => el('option', { value: v, text: t })));
        dayPick.value = String(dg.day);
        const hourPick = el('select', { 'aria-label': VBLang.t('time_of_the_summary'), disabled: !canSettings, onchange: () => sendDigest() },
            ...Array.from({ length: 24 }, (_, h) => el('option', { value: h, text: `${String(h).padStart(2, '0')}:00` })));
        hourPick.value = String(dg.hour);
        const sendDigest = async () => {
            try { await post('../api/classi.php', { action: 'settings', id: classId, summary_time: c.summary_time, timezone: c.timezone, digest_on: digestOn, digest_day: Number(dayPick.value), digest_hour: Number(hourPick.value) }); saved(); } catch (e) { fail(e); }
        };
        const digestBox = el('div', {},
            sw(VBLang.t('weekly_summary_to_the_whole_class'), digestOn, (on) => { digestOn = on; digestRow.hidden = !on; sendDigest(); }, !canSettings),
            (() => { const r = el('div', { class: 'row' }, el('label', { text: VBLang.t('day_2') }, dayPick), el('label', { text: VBLang.t('time') }, hourPick)); digestRow = r; r.hidden = !digestOn; return r; })(),
            el('p', { class: 'muted small', text: VBLang.t('tests_homework_days_without_lessons_of') + (canSettings ? '' : VBLang.t('the_class_representative_or_someone_with_3')) }));

        // temporary links: the representative (or who has the settings permission) can switch them off for the whole class
        let linksOn = c.links_on !== false;
        const linksBox = el('div', {},
            sw(VBLang.t('allow_temporary_links'), linksOn, async (on, box) => {
                try { await post('../api/classi.php', { action: 'settings', id: classId, summary_time: c.summary_time, timezone: c.timezone, links_on: on }); linksOn = on; saved(); }
                catch (e) { box.checked = !on; fail(e); }
            }, !canSettings),
            el('p', { class: 'muted small', text: VBLang.t('with_links_off_nobody_can_create') + (canSettings ? '' : VBLang.t('the_class_representative_or_someone_with_2')) }));

        // which class the app shows; another class by code, or ask for a new one
        const picker = el('select', { 'aria-label': VBLang.t('class'), onchange: () => { classId = Number(picker.value); C.store(C.CLASS_KEY, String(classId)); draw().then(drawNotifs); } },
            ...classes.map((k) => el('option', { value: k.id, text: `${k.name} · ${k.school}`, selected: k.id === classId })));
        const codeIn = el('input', { name: 'code', placeholder: VBLang.t('invite_code'), autocomplete: 'off', required: true, maxLength: 20 });
        const joinForm = el('form', { class: 'row join-row' }, codeIn, el('button', { text: VBLang.t('join_2') }));
        joinForm.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            try { const j = await post('../api/classi.php', { action: 'join', code: codeIn.value }); C.store(C.CLASS_KEY, String(j.id)); classes = (await getJson('../api/classi.php?action=mine')).classes; classId = j.id; await draw(); drawNotifs(); saved(VBLang.t('you_joined', { name: j.name })); }
            catch (e) { fail(e); }
        });
        const askClass = el('button', { type: 'button', class: 'ghost', text: VBLang.t('ask_for_a_new_class'), onclick: () => C.dialogForm(VBLang.t('ask_for_a_new_class'), (form) => {
            form.append(el('label', { text: VBLang.t('class') }, el('input', { name: 'name', required: true, maxLength: 40 })),
                el('label', { text: VBLang.t('school') }, el('input', { name: 'school', required: true, maxLength: 100 })),
                el('label', { text: VBLang.t('notes_for_the_administrator_optional') }, el('textarea', { name: 'note', rows: 2, maxLength: 300 })),
                el('label', { class: 'check-row' }, el('input', { type: 'checkbox', name: 'adults' }), el('span', { text: VBLang.t('all_the_students_of_the_class') })),
                el('p', { class: 'muted small', text: VBLang.t('if_you_tick_it_google_s') }));
        }, async (form) => {
            await post('../api/classi.php', { action: 'request', name: form.name.value, school: form.school.value, note: form.note.value, adults: form.adults.checked });
            saved(VBLang.t('request_sent_you_will_see_it'));
        }, VBLang.t('send_the_request')) });
        const classesSection = section(VBLang.t('your_classes'), VBLang.t('the_class_you_see_in_notes'),
            classes.length > 1 ? el('label', { text: VBLang.t('active_class') }, picker) : null,
            el('p', { class: 'muted small', text: VBLang.t('do_you_have_the_code_of') }), joinForm,
            mineInfo && (mineInfo.requests_open || mineInfo.is_admin) ? askClass : el('p', { class: 'muted small', text: VBLang.t('requests_for_new_classes_are_closed') }));

        $('#settings-root').replaceChildren(
            Object.assign(section(VBLang.t('received_notifications'), VBLang.t('the_ones_that_reached_you_by'), el('div', { id: 'notifs-box' })), { id: 'notifiche' }),
            classesSection,
            section(`${c.name} · ${c.school}`, VBLang.t('these_choices_only_apply_to_you'), nameForm,
                el('p', { class: 'muted small', text: VBLang.t('only_classmates_of_this_class_see') })),
            section(VBLang.t('what_to_receive'), VBLang.t('for_this_class_to_get_them'),
                el('div', { id: 'push-slot' }),
                el('div', { class: 'row test-row' }, el('button', { type: 'button', class: 'ghost mini', text: VBLang.t('send_a_test_notification'), onclick: async () => {
                    try { const r = await post('../api/notifiche.php', { action: 'test' }); status(r.delivered ? VBLang.t('test_sent_it_should_arrive_in') : VBLang.t('the_test_did_not_go_out_2'), r.delivered ? 'ok' : 'err'); drawNotifs(); } catch (e) { fail(e); }
                } })),
                sw(VBLang.t('reminders_for_tests_and_oral_exams'), p.promemoria, (on) => { p.promemoria = on; slotBox.hidden = !on; sendPrefs(); }), slotBox,
                sw(VBLang.t('warn_me_the_afternoon_before_if'), p.turno, (on) => { p.turno = on; sendPrefs(); }),
                sw(VBLang.t('remind_me_of_each_day_s'), p.ripasso_on, (on) => { p.ripasso_on = on; hourRow.hidden = !on; sendPrefs(); }),
                (() => { const h = el('select', { 'aria-label': VBLang.t('time_of_the_review_reminder'), onchange: () => { p.ripasso_hour = Number(h.value); sendPrefs(); } },
                    ...Array.from({ length: 24 }, (_, i) => el('option', { value: i, text: `${String(i).padStart(2, '0')}:00` }))); h.value = String(p.ripasso_hour);
                    hourRow = el('div', { class: 'set-sub' }, el('label', { text: VBLang.t('at_what_time') }, h)); hourRow.hidden = !p.ripasso_on; return hourRow; })(),
                sw(VBLang.t('the_weekly_summary'), p.riepilogo, (on) => { p.riepilogo = on; sendPrefs(); }),
                sw(VBLang.t('board_announcements'), p.annuncio, (on) => { p.annuncio = on; sendPrefs(); }),
                sw(VBLang.t('5_minutes_before_the_end_of'), prefs.bell, async (on, box) => {
                    try { await post('../api/notifiche.php', { action: 'bell_notify', class_id: classId, on }); saved(); } catch (e) { box.checked = !on; fail(e); }
                })),
            section(VBLang.t('uploads'), VBLang.t('on_this_device_files_are_uploaded'),
                sw(VBLang.t('resume_interrupted_uploads_by_themselves'), up.auto, (on) => { window.AppuntiUpload.setSetting('auto', on); saved(); }),
                sw(VBLang.t('upload_only_on_wi_fi_works'), up.wifi, (on) => { window.AppuntiUpload.setSetting('wifi', on); saved(); }),
                sw(VBLang.t('shrink_big_photos_before_sending_them'), up.shrink, (on) => { window.AppuntiUpload.setSetting('shrink', on); saved(); })),
            ...(sc ? [scoreSection(sc, c)] : []),
            ...(C.canSpeak() ? [voiceSection()] : []),
            viewSection(),
            el('div', { class: 'set-pair' },
            section(VBLang.t('class_code'), VBLang.t('classmates_roles_subjects_and_timetable_are'), codeBox,
                el('a', { class: 'ghost-link', href: 'appunti.php?class=' + classId + '&tab=class', text: VBLang.t('open_the_class_tab') })),
            section(VBLang.t('artificial_intelligence'), null, aiBox),
            section(VBLang.t('automatic_summary'), null, summaryBox)),
            section(VBLang.t('temporary_links_of_the_class'), null, linksBox),
            section(VBLang.t('weekly_summary'), null, digestBox),
            section(VBLang.t('missing_notes'), null, missingBox),
            linksSection());
    }

    window.VBDrop.attach({ label: VBLang.t('drop_them_here'), hint: VBLang.t('they_open_in_the_upload_page'), onFiles: (files) => C.handOff(files) });
    (async () => {
        try {
            const mine = await getJson('../api/classi.php?action=mine');
            if (mine.guest) { drawGuest(); return; }
            classes = mine.classes;
            if (!classes.length) { location.href = 'appunti.php'; return; }
            const want = Number(new URLSearchParams(location.search).get('class') || C.stored(C.CLASS_KEY));
            const pick = classes.find((c) => c.id === want) || classes[0];
            classId = pick.id;
            mineInfo = mine;
            await draw();
            drawNotifs();
            if (location.hash === '#notifiche') document.getElementById('notifiche').scrollIntoView();
        } catch (e) { fail(e); }
    })();
})();
