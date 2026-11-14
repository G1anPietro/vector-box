// public/js/appunti-classifica.js — the "Classifica" tab: my points, the weekly and total tables, joining or leaving.
// Points are given by the server (api/classifica.php, quiz_answer / review_answer).
(() => {
    'use strict';
    const C = window.AppuntiCommon;
    const { el, getJson, toast } = C;
    let view = 'week';
    let all = false;
    let data = null;

    const P = () => window.AppuntiPage;
    const join = async (on) => {
        if (!on && !confirm('Se esci dalla classifica i tuoi punti vengono cancellati e non si contano più. Continuare?')) return;
        try { await C.post('../api/classifica.php', { action: 'set_in', class_id: P().current.id, in: on }); load(); } catch (e) { toast(e.message, 'err'); }
    };

    function draw() {
        const box = document.querySelector('#sc-box');
        const sc = data;
        if (!sc || sc.on === false) {
            box.replaceChildren(el('div', { class: 'card' }, el('h2', { text: 'Classifica' }),
                el('p', { class: 'muted', text: 'La classifica è spenta per questa classe.' + (sc && sc.can_manage ? ' Puoi riaccenderla da Impostazioni › Classifica.' : '') })));
            return;
        }
        const mine = sc.mine || {};
        const head = el('div', { class: 'card sc-mine' },
            sc.in
                ? el('div', {}, el('b', { class: 'sc-big', text: String(mine.week || 0) }), ' punti questa settimana', el('br'),
                    el('span', { class: 'muted small', text: `${mine.total || 0} in tutto` + (mine.rank_week ? ` · ${mine.rank_week}° su ${mine.count} questa settimana` : '') }))
                : el('p', { class: 'muted', text: 'Non partecipi alla classifica: i tuoi punti non si contano e non compari.' }),
            el('button', { type: 'button', class: 'ghost mini', text: sc.in ? 'Esci dalla classifica' : 'Partecipa', onclick: () => join(!sc.in) }));
        const parts = [head];
        if (sc.in && !sc.can_see) {
            parts.push(el('p', { class: 'muted', text: 'La tabella la vede solo chi ha il permesso: tu vedi i tuoi punti.' }));
        } else if (sc.in) {
            const rows = view === 'week' ? sc.week : sc.total;
            const shown = all ? rows : rows.slice(0, 10).concat(rows.slice(10).filter((r) => r.me));
            parts.push(el('div', { class: 'card' },
                el('div', { class: 'bb-head' }, el('h2', { text: 'Classifica' }),
                    el('span', { class: 'bb-seg' }, ...[['week', 'Settimana'], ['total', 'Sempre']].map(([k, t]) =>
                        el('button', { type: 'button', class: 'ghost mini', 'aria-pressed': String(view === k), text: t, onclick: () => { view = k; draw(); } })))),
                rows.length ? el('ol', { class: 'bb-score' }, ...shown.map((r) => el('li', { class: r.me ? 'me' : '' },
                    el('span', { class: 'rk', text: String(rows.indexOf(r) + 1) }), el('span', { class: 'nm', text: r.name + (r.me ? ' (tu)' : '') }), el('b', { text: String(r.points) }))))
                    : el('p', { class: 'muted', text: 'Ancora nessuno.' }),
                rows.length > 10 ? el('button', { type: 'button', class: 'ghost mini', text: all ? 'Mostra meno' : 'Mostra tutti', onclick: () => { all = !all; draw(); } }) : null));
        }
        parts.push(el('div', { class: 'card' }, el('h3', { text: 'Come si prendono i punti' }),
            el('ul', { class: 'plain sc-how' },
                el('li', { text: '10 punti per ogni risposta giusta al primo tentativo in un quiz (una volta sola per domanda).' }),
                el('li', { text: '5 punti per ogni domanda giusta del ripasso di oggi.' }),
                el('li', { text: 'Rifare un quiz è solo allenamento: niente punti. Risposte troppo veloci non contano.' }),
                el('li', { text: 'Massimo 250 punti al giorno. La settimana riparte il lunedì.' })),
            el('a', { href: 'appunti-impostazioni.php?class=' + P().current.id, text: 'Impostazioni della classifica' })));
        box.replaceChildren(...parts);
    }

    async function load() {
        const c = P().current;
        if (!c) return;
        try { data = await getJson(`../api/classifica.php?action=board&class_id=${c.id}`); } catch (e) { data = null; toast(e.message, 'err'); }
        draw();
    }

    window.AppuntiScore = { load };
})();
