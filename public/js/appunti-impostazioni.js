// public/js/appunti-impostazioni.js — personal settings of the class chosen at the top.
// Notification choices are kept on the server per class (api/notifiche.php prefs/save_prefs); the way the week and the PDFs are
// shown is a choice of this device (localStorage).
(() => {
    'use strict';
    const C = window.AppuntiCommon;
    const { el, getJson, post } = C;
    const $ = (s) => document.querySelector(s);
    let classId = null;
    let classes = [];

    const status = (text, kind = '') => { const s = $('#status'); s.textContent = text; s.className = 'status ' + kind; };
    const saved = () => { status('Salvato.', 'ok'); setTimeout(() => status(''), 2000); };
    const fail = (e) => status(e.message, 'err');

    function section(title, hint, ...children) {
        return el('section', { class: 'card set-sec' }, el('h2', { text: title }), hint ? el('p', { class: 'muted small', text: hint }) : null, ...children);
    }
    function sw(label, checked, onchange, disabled = false) {
        return el('label', { class: 'switch' }, el('input', { type: 'checkbox', checked, disabled, onchange: (ev) => onchange(ev.target.checked, ev.target) }), label);
    }

    async function draw() {
        const root = $('#settings-root');
        root.replaceChildren(el('p', { class: 'muted', text: 'Carico…' }));
        let cls, prefs;
        try {
            [cls, prefs] = await Promise.all([getJson(`../api/classi.php?action=class&id=${classId}`), getJson(`../api/notifiche.php?action=prefs&class_id=${classId}`)]);
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
        const slotLabel = { d2: 'Due giorni prima, alle 16:00', d1: 'Il giorno prima, alle 16:00', sera: 'La sera prima, alle 21:00' };

        // name in the class
        const name = el('input', { name: 'name', maxLength: 40, placeholder: 'Nome e cognome', value: me ? me.display_name : '' });
        const nameForm = el('form', { class: 'row my-name' }, el('label', { text: 'Il tuo nome in questa classe' }, name), el('button', { class: 'ghost', text: 'Salva' }));
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

        $('#settings-root').replaceChildren(
            section(`${c.name} · ${c.school}`, 'Queste scelte valgono solo per te.', nameForm,
                el('p', { class: 'muted small', text: 'Lo vedono solo i compagni di questa classe; nel resto del sito resta il tuo nome utente.' })),
            section('Notifiche', 'Scegli cosa ricevere. Per riceverle sul telefono a sito chiuso attiva anche le notifiche su questo dispositivo (campanella in Appunti).',
                sw('Promemoria di verifiche e interrogazioni', p.promemoria, (on) => { p.promemoria = on; slotBox.hidden = !on; sendPrefs(); }), slotBox,
                sw('Quando sono io a essere interrogato (il pomeriggio prima)', p.turno, (on) => { p.turno = on; sendPrefs(); }),
                sw('Annunci della bacheca', p.annuncio, (on) => { p.annuncio = on; sendPrefs(); }),
                sw('5 minuti prima della fine di ogni ora: materia e aula dopo', prefs.bell, async (on, box) => {
                    try { await post('../api/notifiche.php', { action: 'bell_notify', class_id: classId, on }); saved(); } catch (e) { box.checked = !on; fail(e); }
                })),
            section('Come lo vedo', 'Su questo dispositivo.',
                el('label', { text: 'La settimana inizia di' }, week),
                el('label', { text: 'I PDF dell\'archivio si aprono con' }, pdf)),
            section('Classe', 'Ruoli, permessi, materie, orario e compagni li gestisce il rappresentante (e chi ha il permesso) dalla scheda Classe.',
                el('a', { class: 'ghost-link', href: 'appunti.php?class=' + classId + '&tab=class', text: 'Apri la scheda Classe' })));
    }

    (async () => {
        try {
            const mine = await getJson('../api/classi.php?action=mine');
            classes = mine.classes;
            if (!classes.length) { location.href = 'appunti.php'; return; }
            const want = Number(new URLSearchParams(location.search).get('class') || C.stored(C.CLASS_KEY));
            const pick = classes.find((c) => c.id === want) || classes[0];
            classId = pick.id;
            const sel = $('#class-select');
            sel.replaceChildren(...classes.map((c) => el('option', { value: c.id, text: `${c.name} · ${c.school}`, selected: c.id === pick.id })));
            sel.addEventListener('change', () => { classId = Number(sel.value); C.store(C.CLASS_KEY, String(classId)); draw(); });
            await draw();
        } catch (e) { fail(e); }
    })();
})();
