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
    const saved = (m) => { status(typeof m === 'string' ? m : 'Salvato.', 'ok'); setTimeout(() => status(''), 2000); };
    const fail = (e) => status(e.message, 'err');

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
    const when = (t) => new Date(t * 1000).toLocaleString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

    async function pushBox(box, devices) {
        if (!pushSupported) {
            box.replaceChildren(el('span', { text: isIos && !isStandalone
                ? 'Per ricevere i promemoria sull\'iPhone: tocca Condividi, poi "Aggiungi alla schermata Home", apri gli Appunti da quell\'icona e attiva qui le notifiche.'
                : 'Questo browser non supporta le notifiche push: i promemoria li trovi comunque qui sotto.' }));
            return;
        }
        let sub = null;
        try { const reg = await navigator.serviceWorker.getRegistration('./'); sub = reg && await reg.pushManager.getSubscription(); } catch (e) { /* none */ }
        if (Notification.permission === 'denied') {
            box.replaceChildren(el('span', { text: 'Hai bloccato le notifiche per questo sito: riattivale dalle impostazioni del browser (lucchetto accanto all\'indirizzo).' }));
            return;
        }
        const redo = () => drawNotifs();
        const enable = async () => {
            try {
                if (await Notification.requestPermission() !== 'granted') { status('Senza il permesso del browser le notifiche non possono arrivare.', 'err'); redo(); return; }
                const reg = await navigator.serviceWorker.register('appunti-sw.js', { scope: './' });
                await navigator.serviceWorker.ready;
                const { public_key: key } = await getJson('../api/notifiche.php?action=vapid');
                let sb = await reg.pushManager.getSubscription();
                if (!sb) sb = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(key) });
                const j = sb.toJSON();
                await post('../api/notifiche.php', { action: 'subscribe', endpoint: j.endpoint, keys: j.keys });
                status('Notifiche attivate.', 'ok'); redo();
            } catch (e) { status('Non sono riuscito ad attivare le notifiche: ' + e.message, 'err'); }
        };
        const disable = async () => {
            try {
                const reg = await navigator.serviceWorker.getRegistration('./');
                const sb = reg && await reg.pushManager.getSubscription();
                if (sb) { await post('../api/notifiche.php', { action: 'unsubscribe', endpoint: sb.endpoint }); await sb.unsubscribe(); }
                status('Notifiche disattivate su questo dispositivo.', 'ok'); redo();
            } catch (e) { fail(e); }
        };
        const test = async () => {
            try {
                const r = await post('../api/notifiche.php', { action: 'test' });
                status(r.delivered ? 'Prova inviata: dovrebbe arrivare tra pochi secondi.' : 'La prova non è partita: riattiva le notifiche.', r.delivered ? 'ok' : 'err');
            } catch (e) { fail(e); }
        };
        box.replaceChildren(sub
            ? el('div', {}, el('span', { text: `Notifiche attive su questo dispositivo${devices > 1 ? ` (e su altri ${devices - 1})` : ''}.` }),
                el('div', { class: 'row' }, el('button', { class: 'ghost mini', text: 'Disattiva qui', onclick: disable })))
            : el('div', {}, el('span', { text: 'Ricevi i promemoria anche a sito chiuso.' }),
                el('div', { class: 'row' }, el('button', { class: 'mini', text: 'Attiva le notifiche su questo dispositivo', onclick: enable }))));
    }

    async function drawNotifs() {
        const box = document.querySelector('#notifs-box');
        if (!box) return;
        let r;
        try { r = await getJson('../api/notifiche.php?action=list'); } catch (e) { return; }
        const device = el('div', { class: 'push-box' });
        const KINDS = { promemoria: 'Verifiche e interrogazioni', annuncio: 'Annunci', turno: 'Turni di interrogazione', prova: 'Prove' };
        const groups = new Map();
        for (const n of r.notifications) { if (!groups.has(n.kind)) groups.set(n.kind, []); groups.get(n.kind).push(n); }
        const remove = async (body) => { try { await post('../api/notifiche.php', { action: 'delete', ...body }); drawNotifs(); } catch (e) { fail(e); } };
        const open = new Set(JSON.parse(C.stored('vb_notif_open') || '[]'));
        const list = el('div', { class: 'n-groups' }, ...(groups.size ? [...groups].map(([kind, items]) => {
            const d = el('details', { class: 'n-group', open: open.has(kind) },
                el('summary', {}, el('span', { class: 'n-title', text: KINDS[kind] || 'Altro' }), el('span', { class: 'n-count', text: String(items.length) }),
                    el('button', { type: 'button', class: 'ghost mini', text: 'Cancella', onclick: (ev) => { ev.preventDefault(); remove({ kind }); } })),
                ...items.map((n) => el('div', { class: 'n-item' + (n.read ? '' : ' unread'), onclick: () => {
                    const u = new URL(n.url || '/pages/appunti.php', location.origin);
                    if (u.origin === location.origin) location.href = u.href;
                } }, el('div', { class: 'n-text' }, el('b', { text: n.title }), n.body ? el('span', { text: n.body }) : null, el('span', { class: 'when', text: when(n.created_at) })),
                    el('button', { type: 'button', class: 'ghost mini n-x', text: '✕', title: 'Togli questa notifica', 'aria-label': 'Togli questa notifica',
                        onclick: (ev) => { ev.stopPropagation(); remove({ ids: [n.id] }); } }))));
            d.addEventListener('toggle', () => { d.open ? open.add(kind) : open.delete(kind); C.store('vb_notif_open', JSON.stringify([...open])); });
            return d;
        }) : [el('p', { class: 'muted', text: 'Nessuna notifica ancora.' })]));
        if (r.notifications.length > 1) list.append(el('button', { type: 'button', class: 'ghost mini', text: 'Cancella tutte', onclick: () => { if (confirm('Cancellare tutte le notifiche?')) remove({ all: true }); } }));
        box.replaceChildren(list);
        const slot = document.querySelector('#push-slot');
        if (slot) slot.replaceChildren(device);
        pushBox(device, r.devices);
        if (r.unread) { try { await post('../api/notifiche.php', { action: 'read_all' }); } catch (e) { /* ignore */ } }
    }

    /** The voice that reads the quiz questions aloud (the browser's own: on Linux and Windows PCs it can sound robotic; phones are better). */
    function voiceSection() {
        const sel = el('select', { 'aria-label': 'Voce', onchange: () => { C.store('vb_tts_voice', sel.value); saved(); } });
        const fill = () => {
            const voices = speechSynthesis.getVoices().filter((v) => /^it/i.test(v.lang));
            sel.replaceChildren(el('option', { value: '', text: 'Predefinita del dispositivo' }), ...voices.map((v) => el('option', { value: v.voiceURI, text: `${v.name} (${v.lang})` })));
            sel.value = C.stored('vb_tts_voice') || '';
        };
        fill();
        speechSynthesis.onvoiceschanged = fill;
        const rate = el('select', { 'aria-label': 'Velocità', onchange: () => { C.store('vb_tts_rate', rate.value); saved(); } },
            ...[['0.8', 'Lenta'], ['1', 'Normale'], ['1.2', 'Veloce'], ['1.5', 'Molto veloce']].map(([v, t]) => el('option', { value: v, text: t })));
        rate.value = C.stored('vb_tts_rate') || '1';
        return section('Voce per le domande', 'Nei quiz il pulsante "Leggi" legge la domanda e le risposte. Su computer con Linux o Windows la voce può essere robotica: sui telefoni di solito è migliore.',
            el('label', { text: 'Voce' }, sel), el('label', { text: 'Velocità' }, rate),
            el('button', { type: 'button', class: 'ghost mini', text: 'Prova la voce', onclick: () => C.speak('Qual è la capitale d\'Italia? A: Roma. B: Milano.') }));
    }

    /** Three things to send in the class chat, one after the other: a short message, the link, the code (each copies with one tap). */
    function inviteDialog(c) {
        const link = `${location.origin}/pages/appunti-guida.php`;
        const msg = 'Ragazzi, ho aperto gli appunti di classe su vector-box. Ognuno carica foto e audio delle lezioni e il sito prepara riassunti e quiz per le verifiche. Qui sotto vi mando il link e il codice: vi registrate e mettete il codice.';
        const block = (title, text, rows) => [el('label', { text: title }, el('textarea', { rows, readOnly: true, value: text })),
            el('button', { type: 'button', class: 'ghost mini', text: 'Copia', onclick: () => copy(text) })];
        C.dialogForm('Per invitare la classe', (form) => {
            form.append(el('p', { class: 'muted small', text: 'Mandali in ordine: messaggio, link, codice. Così link e codice si copiano con un tocco.' }),
                ...block('1. Messaggio', msg, 4), ...block('2. Link', link, 1), ...block('3. Codice', c.invite_code, 1));
            form.querySelectorAll('textarea').forEach((t, i) => { t.value = [msg, link, c.invite_code][i]; });
        }, async () => {}, 'Chiudi');
    }
    const copy = async (t) => { try { await navigator.clipboard.writeText(t); saved('Copiato.'); } catch (e) { fail(new Error('Non riesco a copiare: seleziona il testo e copialo a mano.')); } };

    /** Scoreboard: I take part or not (leaving deletes my points); who manages settings also switches it on/off and chooses who sees it. */
    function scoreSection(sc, c) {
        const canSettings = (c.perms || []).includes('settings');
        const me = sw('Compaio nella classifica', sc.in, async (on, box) => {
            if (!on && !confirm('Se esci dalla classifica i tuoi punti vengono cancellati e non si contano più. Continuare?')) { box.checked = true; return; }
            try { await post('../api/classifica.php', { action: 'set_in', class_id: classId, in: on }); saved(); } catch (e) { box.checked = !on; fail(e); }
        });
        const who = el('select', { 'aria-label': 'Chi vede la classifica', disabled: !canSettings, onchange: () => saveClass() },
            el('option', { value: 'all', text: 'Tutta la classe' }), el('option', { value: 'perm', text: 'Solo il rappresentante e chi ha il permesso' }));
        who.value = sc.who || 'all';
        let on = sc.on;
        const saveClass = async () => { try { await post('../api/classifica.php', { action: 'settings', class_id: classId, on, who: who.value }); saved(); } catch (e) { fail(e); } };
        return section('Classifica', 'Punti per le risposte giuste al primo tentativo nei quiz (10) e per il ripasso di ogni giorno (5). I punti li conta il server.',
            me,
            el('div', { class: 'set-sub-block' },
                sw('Classifica accesa per la classe', on, (v) => { on = v; saveClass(); }, !canSettings),
                el('label', { text: 'Chi la vede' }, who),
                canSettings ? null : el('p', { class: 'muted small', text: 'La accende e la spegne il rappresentante (o chi ha il permesso).' })));
    }

    async function draw() {
        const root = $('#settings-root');
        root.replaceChildren(el('p', { class: 'muted', text: 'Carico…' }));
        let cls, prefs, sc;
        try {
            [cls, prefs, sc] = await Promise.all([getJson(`../api/classi.php?action=class&id=${classId}`), getJson(`../api/notifiche.php?action=prefs&class_id=${classId}`),
                getJson(`../api/classifica.php?action=board&class_id=${classId}`).catch(() => null)]);
        } catch (e) {
            root.replaceChildren(section('Impostazioni', 'Per cambiare le impostazioni devi far parte della classe.', el('a', { class: 'ghost-link', href: 'appunti.php', text: 'Torna agli Appunti' })));
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
        const slotLabel = { d7: 'Una settimana prima, alle 16:00', d3: 'Tre giorni prima, alle 16:00', d2: 'Due giorni prima, alle 16:00', d1: 'Il giorno prima, alle 16:00', sera: 'La sera prima, alle 21:00' };

        // name in the class
        const name = el('input', { name: 'name', maxLength: 40, placeholder: 'Nome e cognome', value: me ? me.display_name : '' });
        const nameForm = el('form', { class: 'name-form' }, el('label', { for: 'my-name', text: 'Il tuo nome in questa classe' }),
            el('div', { class: 'inline-pair' }, name, el('button', { class: 'ghost', text: 'Salva' })));
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

        const week = el('select', { 'aria-label': 'La settimana inizia', onchange: (ev) => { C.store('vb_week_start', ev.target.value); saved(); } },
            el('option', { value: 'mon', text: 'Lunedì' }), el('option', { value: 'sun', text: 'Domenica' }));
        week.value = C.stored('vb_week_start') === 'sun' ? 'sun' : 'mon';
        const pdf = el('select', { 'aria-label': 'Come si aprono i PDF', onchange: (ev) => { C.store('vb_pdf_mode', ev.target.value); saved(); } },
            el('option', { value: 'auto', text: 'Testo sul telefono, pagine sul computer' }), el('option', { value: 'text', text: 'Sempre il testo' }), el('option', { value: 'pages', text: 'Sempre le pagine' }));
        pdf.value = C.stored('vb_pdf_mode') || 'auto';
        const openTab = el('select', { 'aria-label': 'Gli Appunti si aprono su', onchange: (ev) => { C.store('vb_open_tab', ev.target.value); saved(); } },
            ...[['last', 'L\'ultima scheda che hai usato'], ['board', 'Bacheca'], ['class', 'Classe (con l\'orario)'], ['calendar', 'Calendario'], ['study', 'Studio'], ['score', 'Classifica'], ['material', 'Materiale']].map(([v, t]) => el('option', { value: v, text: t })));
        openTab.value = C.stored('vb_open_tab') || 'last';

        // class code and the automatic summary (who may manage settings changes the summary; the code is for who manages members)
        const canSettings = (c.perms || []).includes('settings');
        const codeBox = c.invite_code ? el('div', {},
            el('p', { class: 'muted small', text: 'Codice d\'invito (dallo solo ai compagni):' }),
            el('span', { class: 'code', text: c.invite_code }),
            el('div', { class: 'code-actions' },
                el('button', { class: 'ghost mini', text: 'Copia', onclick: () => navigator.clipboard && navigator.clipboard.writeText(c.invite_code).then(() => saved('Codice copiato.')) }),
                el('button', { class: 'ghost mini danger-soft', text: 'Nuovo codice', onclick: async () => {
                    if (!confirm('Il codice vecchio smetterà di funzionare. Continuare?')) return;
                    try { await post('../api/classi.php', { action: 'regen_code', id: classId }); await draw(); drawNotifs(); saved('Nuovo codice creato.'); } catch (e) { fail(e); }
                } })),
            el('div', { class: 'invite-row' }, el('button', { type: 'button', class: 'ghost mini invite-btn', text: 'Invita la classe', onclick: () => inviteDialog(c) })))
            : el('p', { class: 'muted small', text: 'Il codice d\'invito lo ha il rappresentante della classe.' });
        const time = el('input', { type: 'time', name: 'summary_time', value: c.summary_time, required: true, disabled: !canSettings });
        const sumForm = el('form', { class: 'row' }, el('label', { text: 'Ogni giorno alle' }, time), canSettings ? el('button', { class: 'ghost', text: 'Salva l\'ora' }) : null);
        const sendSummary = async (on) => post('../api/classi.php', { action: 'settings', id: classId, summary_time: time.value, timezone: c.timezone, summary_on: on });
        let summaryOn = c.summary_on;
        sumForm.addEventListener('submit', async (ev) => { ev.preventDefault(); try { await sendSummary(summaryOn); saved(); } catch (e) { fail(e); } });
        const summaryBox = el('div', {},
            sw('Riassunto automatico degli appunti', summaryOn, async (on, box) => {
                try { await sendSummary(on); summaryOn = on; sumForm.hidden = !on; saved(); } catch (e) { box.checked = !on; fail(e); }
            }, !canSettings),
            sumForm,
            el('p', { class: 'muted small', text: 'Una volta al giorno l\'AI rifà gli appunti delle materie con il materiale nuovo. Spento, lo fa solo quando premi "Genera ora" nella scheda Studio.' + (canSettings ? '' : ' Lo cambia il rappresentante (o chi ha il permesso).') }));
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
            el('div', { class: 'grid2' }, el('label', { text: 'Dal' }, fromIn), el('label', { text: 'Al (facoltativo)' }, toIn)),
            el('p', { class: 'muted small', text: 'Quali materie contano:' }),
            ...c.subjects.map((s) => sw(s.name, !offs.has(s.id), (on) => { if (on) offs.delete(s.id); else offs.add(s.id); sendMissing(); }, !canSettings)));
        missingBody.hidden = !missingOn;
        const missingBox = el('div', {},
            sw('Segnala gli appunti mancanti nella Bacheca', missingOn, (on) => { missingOn = on; missingBody.hidden = !on; if (on && !fromIn.value) fromIn.value = new Date().toISOString().slice(0, 10); sendMissing(); }, !canSettings),
            missingBody,
            el('p', { class: 'muted small', text: 'Mostra le lezioni già fatte per cui nessuno ha caricato niente. I giorni senza lezione non contano; una lezione si può togliere dal menu ⋯ della Bacheca.' + (canSettings ? '' : ' Lo sceglie il rappresentante (o chi ha il permesso).') }));

        // weekly digest: chosen by who manages the class settings (default Sunday 19:00)
        const dg = c.digest || { on: true, day: 0, hour: 19 };
        let digestOn = dg.on;
        const dayPick = el('select', { 'aria-label': 'Giorno del riepilogo', disabled: !canSettings, onchange: () => sendDigest() },
            ...[[1, 'Lunedì'], [2, 'Martedì'], [3, 'Mercoledì'], [4, 'Giovedì'], [5, 'Venerdì'], [6, 'Sabato'], [0, 'Domenica']].map(([v, t]) => el('option', { value: v, text: t })));
        dayPick.value = String(dg.day);
        const hourPick = el('select', { 'aria-label': 'Ora del riepilogo', disabled: !canSettings, onchange: () => sendDigest() },
            ...Array.from({ length: 24 }, (_, h) => el('option', { value: h, text: `${String(h).padStart(2, '0')}:00` })));
        hourPick.value = String(dg.hour);
        const sendDigest = async () => {
            try { await post('../api/classi.php', { action: 'settings', id: classId, summary_time: c.summary_time, timezone: c.timezone, digest_on: digestOn, digest_day: Number(dayPick.value), digest_hour: Number(hourPick.value) }); saved(); } catch (e) { fail(e); }
        };
        const digestBox = el('div', {},
            sw('Riepilogo della settimana a tutta la classe', digestOn, (on) => { digestOn = on; digestRow.hidden = !on; sendDigest(); }, !canSettings),
            (() => { const r = el('div', { class: 'row' }, el('label', { text: 'Giorno' }, dayPick), el('label', { text: 'Ora' }, hourPick)); digestRow = r; r.hidden = !digestOn; return r; })(),
            el('p', { class: 'muted small', text: 'Verifiche, compiti, giorni senza lezione dei 7 giorni dopo e i turni di chi è interrogato. Non parte se non c\'è niente da dire.' + (canSettings ? '' : ' Lo sceglie il rappresentante (o chi ha il permesso).') }));

        // which class the app shows; another class by code, or ask for a new one
        const picker = el('select', { 'aria-label': 'Classe', onchange: () => { classId = Number(picker.value); C.store(C.CLASS_KEY, String(classId)); draw().then(drawNotifs); } },
            ...classes.map((k) => el('option', { value: k.id, text: `${k.name} · ${k.school}`, selected: k.id === classId })));
        const codeIn = el('input', { name: 'code', placeholder: 'Codice d\'invito', autocomplete: 'off', required: true, maxLength: 20 });
        const joinForm = el('form', { class: 'row join-row' }, codeIn, el('button', { text: 'Entra' }));
        joinForm.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            try { const j = await post('../api/classi.php', { action: 'join', code: codeIn.value }); C.store(C.CLASS_KEY, String(j.id)); classes = (await getJson('../api/classi.php?action=mine')).classes; classId = j.id; await draw(); drawNotifs(); saved(`Sei entrato in ${j.name}.`); }
            catch (e) { fail(e); }
        });
        const askClass = el('button', { type: 'button', class: 'ghost', text: 'Chiedi una nuova classe', onclick: () => C.dialogForm('Chiedi una nuova classe', (form) => {
            form.append(el('label', { text: 'Classe' }, el('input', { name: 'name', required: true, maxLength: 40 })),
                el('label', { text: 'Scuola' }, el('input', { name: 'school', required: true, maxLength: 100 })),
                el('label', { text: 'Note per l\'amministratore (facoltative)' }, el('textarea', { name: 'note', rows: 2, maxLength: 300 })));
        }, async (form) => {
            await post('../api/classi.php', { action: 'request', name: form.name.value, school: form.school.value, note: form.note.value });
            saved('Richiesta inviata: la vedrai attiva quando l\'amministratore la approva.');
        }, 'Invia la richiesta') });
        const classesSection = section('Le tue classi', 'La classe che vedi negli Appunti e nell\'archivio.',
            classes.length > 1 ? el('label', { text: 'Classe attiva' }, picker) : null,
            el('p', { class: 'muted small', text: 'Hai il codice di un\'altra classe?' }), joinForm,
            mineInfo && (mineInfo.requests_open || mineInfo.is_admin) ? askClass : el('p', { class: 'muted small', text: 'Le richieste di nuove classi sono chiuse in questo momento.' }));

        $('#settings-root').replaceChildren(
            Object.assign(section('Notifiche ricevute', 'Quelle che ti sono arrivate, per tipo.', el('div', { id: 'notifs-box' })), { id: 'notifiche' }),
            classesSection,
            section(`${c.name} · ${c.school}`, 'Queste scelte valgono solo per te.', nameForm,
                el('p', { class: 'muted small', text: 'Lo vedono solo i compagni di questa classe; nel resto del sito resta il tuo nome utente.' })),
            section('Cosa ricevere', 'Per questa classe. Per averle anche a sito chiuso attiva le notifiche su questo dispositivo.',
                el('div', { id: 'push-slot' }),
                el('div', { class: 'row test-row' }, el('button', { type: 'button', class: 'ghost mini', text: 'Manda una notifica di prova', onclick: async () => {
                    try { const r = await post('../api/notifiche.php', { action: 'test' }); status(r.delivered ? 'Prova inviata: dovrebbe arrivare tra pochi secondi.' : 'La prova non è partita: attiva prima le notifiche su questo dispositivo.', r.delivered ? 'ok' : 'err'); drawNotifs(); } catch (e) { fail(e); }
                } })),
                sw('Promemoria di verifiche e interrogazioni', p.promemoria, (on) => { p.promemoria = on; slotBox.hidden = !on; sendPrefs(); }), slotBox,
                sw('Avvisami il pomeriggio prima se sono di turno per l\'interrogazione', p.turno, (on) => { p.turno = on; sendPrefs(); }),
                sw('Ricordami il ripasso di ogni giorno (se ci sono domande da ripassare)', p.ripasso_on, (on) => { p.ripasso_on = on; hourRow.hidden = !on; sendPrefs(); }),
                (() => { const h = el('select', { 'aria-label': 'Ora del promemoria del ripasso', onchange: () => { p.ripasso_hour = Number(h.value); sendPrefs(); } },
                    ...Array.from({ length: 24 }, (_, i) => el('option', { value: i, text: `${String(i).padStart(2, '0')}:00` }))); h.value = String(p.ripasso_hour);
                    hourRow = el('div', { class: 'set-sub' }, el('label', { text: 'A che ora' }, h)); hourRow.hidden = !p.ripasso_on; return hourRow; })(),
                sw('Il riepilogo della settimana', p.riepilogo, (on) => { p.riepilogo = on; sendPrefs(); }),
                sw('Annunci della bacheca', p.annuncio, (on) => { p.annuncio = on; sendPrefs(); }),
                sw('5 minuti prima della fine di ogni ora: materia e aula dopo', prefs.bell, async (on, box) => {
                    try { await post('../api/notifiche.php', { action: 'bell_notify', class_id: classId, on }); saved(); } catch (e) { box.checked = !on; fail(e); }
                })),
            section('Caricamenti', 'Su questo dispositivo. I file si caricano a pezzi e, se la connessione cade, riprendono da dove erano.',
                sw('Riprendi da solo i caricamenti rimasti a metà', up.auto, (on) => { window.AppuntiUpload.setSetting('auto', on); saved(); }),
                sw('Carica solo con il Wi-Fi (funziona solo su Android con Chrome: altrove carica sempre)', up.wifi, (on) => { window.AppuntiUpload.setSetting('wifi', on); saved(); }),
                sw('Riduci le foto grandi prima di inviarle (più veloce, la scrittura resta leggibile)', up.shrink, (on) => { window.AppuntiUpload.setSetting('shrink', on); saved(); })),
            ...(sc ? [scoreSection(sc, c)] : []),
            ...(C.canSpeak() ? [voiceSection()] : []),
            section('Come lo vedo', 'Su questo dispositivo.',
                el('label', { text: 'Gli Appunti si aprono su' }, openTab),
                sw('Uso il telefono con la mano sinistra (menu e pulsanti specchiati)', C.stored('vb_lefty') === '1', (on) => { C.store('vb_lefty', on ? '1' : '0'); document.documentElement.classList.toggle('lefty', on); saved(); }),
                el('label', { text: 'La settimana inizia di' }, week),
                el('label', { text: 'I PDF dell\'archivio si aprono con' }, pdf)),
            el('div', { class: 'set-pair' },
            section('Codice della classe', 'Compagni, ruoli, materie e orario si gestiscono dalla scheda Classe.', codeBox,
                el('a', { class: 'ghost-link', href: 'appunti.php?class=' + classId + '&tab=class', text: 'Apri la scheda Classe' })),
            section('Riassunto automatico', null, summaryBox)),
            section('Riepilogo settimanale', null, digestBox),
            section('Appunti mancanti', null, missingBox));
    }

    window.VBDrop.attach({ label: 'Mettili qui', hint: 'si aprono nella pagina Carica', onFiles: (files) => C.handOff(files) });
    (async () => {
        try {
            const mine = await getJson('../api/classi.php?action=mine');
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
