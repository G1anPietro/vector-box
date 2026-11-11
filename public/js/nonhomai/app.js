// public/js/nonhomai/app.js
// "Non ho mai…" (Never have I ever): one phone in the middle of the table, works offline.
// Categories, family mode, custom cards and an optional lives counter. Everything is stored on
// the phone (localStorage). UI strings come from js/spia/i18n.js (nh_* keys); user text always
// goes in with textContent.
(() => {
    'use strict';
    const LANGS = { it: 'Italiano', en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch' };
    const ADULT_CATS = ['adult', 'dark'];
    const store = {
        get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
        set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    };
    const I18N = window.SpiaI18n;
    let lang = store.get('spia_lang') || I18N.detect(Object.keys(LANGS));
    const t = (k, v) => I18N.t(lang, k, v);

    let DATA = { categories: [], cards: [] };
    let settings = Object.assign({ cats: null, family: false, lives: false, livesN: 5 }, store.get('nh_settings', {}));
    let players = store.get('nh_players', []);          // [{ name, lives }]
    let custom = store.get('nh_custom', []);            // ["Non ho mai …"]
    let game = store.get('nh_game', null);              // { deck: [ids], pos, marked: [], history: [] }
    const ui = { sheet: null, toast: null, flip: false };
    const app = document.getElementById('app');

    const save = () => {
        store.set('nh_settings', settings);
        store.set('nh_players', players);
        store.set('nh_custom', custom);
        store.set('nh_game', game);
    };

    function h(tag, attrs, ...kids) {
        const el = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs || {})) {
            if (v === null || v === undefined || v === false) continue;
            if (k === 'class') el.className = v;
            else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
            else if (v === true) el.setAttribute(k, '');
            else el.setAttribute(k, String(v));
        }
        for (const c of kids.flat(Infinity)) {
            if (c === null || c === undefined || c === false) continue;
            el.append(c instanceof Node ? c : document.createTextNode(String(c)));
        }
        return el;
    }

    const catName = (id) => {
        const c = DATA.categories.find((x) => x.id === id);
        return c ? (c.name[lang] || c.name.en) : (id === 'custom' ? t('nh_custom') : id);
    };
    const enabledCats = () => {
        const all = DATA.categories.map((c) => c.id);
        const chosen = settings.cats || all;
        return chosen.filter((c) => all.includes(c) && !(settings.family && ADULT_CATS.includes(c)));
    };
    const cardText = (id) => {
        if (id.startsWith('c')) return custom[+id.slice(1)] || '';
        const c = DATA.cards[+id.slice(1)];
        if (!c) return '';
        return c[lang] || c.en;   // phrases exist in it/en; other languages show English
    };
    const cardCat = (id) => (id.startsWith('c') ? 'custom' : (DATA.cards[+id.slice(1)] || {}).cat);

    function shuffle(a) {
        const r = new Uint32Array(1);
        for (let i = a.length - 1; i > 0; i--) {
            crypto.getRandomValues(r);
            const j = r[0] % (i + 1);
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }
    function buildDeck() {
        const cats = enabledCats();
        const ids = DATA.cards.map((c, i) => (cats.includes(c.cat) ? 'b' + i : null)).filter(Boolean);
        custom.forEach((_, i) => ids.push('c' + i));
        return shuffle(ids);
    }

    function toast(text) {
        ui.toast = text;
        render();
        clearTimeout(toast.timer);
        toast.timer = setTimeout(() => { ui.toast = null; render(); }, 2400);
    }

    // ---------- game flow ----------
    function start() {
        const deck = buildDeck();
        if (!deck.length) { toast(t('nh_no_cards')); return; }
        if (settings.lives) {
            if (players.length < 2) { toast(t('nh_need_two')); return; }
            players = players.map((p) => ({ name: p.name, lives: settings.livesN }));
        }
        game = { deck, pos: 0, marked: [], history: [] };
        save();
        render();
    }

    function alive() { return players.filter((p) => p.lives > 0); }

    function next() {
        if (!game) return;
        game.history.push({ pos: game.pos, lives: players.map((p) => p.lives), marked: game.marked.slice() });
        if (game.history.length > 50) game.history.shift();
        if (settings.lives) {
            players.forEach((p) => { if (game.marked.includes(p.name) && p.lives > 0) p.lives -= 1; });
        }
        game.marked = [];
        game.pos += 1;
        if (game.pos >= game.deck.length) {
            game.deck = buildDeck();
            game.pos = 0;
            toast(t('nh_reshuffled'));
        }
        if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) { /* unsupported */ } }
        ui.flip = !ui.flip;
        save();
        render();
    }

    function undo() {
        const last = game && game.history.pop();
        if (!last) return;
        game.pos = last.pos;
        players.forEach((p, i) => { if (last.lives[i] !== undefined) p.lives = last.lives[i]; });
        game.marked = last.marked;
        ui.flip = !ui.flip;
        save();
        render();
    }

    function endGame() {
        game = null;
        save();
        render();
    }

    // ---------- screens ----------
    function topBar() {
        return h('header', { class: 'topbar' },
            h('a', { class: 'brand', href: '../index.php', 'aria-label': t('back_to_site') },
                h('img', { src: '../assets/nonhomai/icon.svg?v=1', alt: '', class: 'brand-icon' }),
                h('span', null, t('nh_title'))),
            h('button', { class: 'icon-btn', onclick: () => { ui.sheet = 'lang'; render(); }, 'aria-label': t('language') }, lang.toUpperCase()),
            h('button', { class: 'icon-btn', onclick: () => { ui.sheet = 'help'; render(); }, 'aria-label': t('help') }, '?'));
    }

    function setupView() {
        const cats = enabledCats();
        const count = (id) => DATA.cards.filter((c) => c.cat === id).length;
        const addPlayer = (e) => {
            e.preventDefault();
            const input = document.getElementById('nh-player');
            const name = input.value.trim().slice(0, 24);
            if (!name) return;
            if (players.some((p) => p.name.toLowerCase() === name.toLowerCase())) { toast(t('err_name_taken')); return; }
            players.push({ name, lives: settings.livesN });
            input.value = '';
            save();
            render();
            document.getElementById('nh-player').focus();
        };
        const addCustom = (e) => {
            e.preventDefault();
            const input = document.getElementById('nh-custom');
            let text = input.value.trim().replace(/\s+/g, ' ').slice(0, 160);
            if (!text) return;
            if (!/[.!?…]$/.test(text)) text += '.';
            custom.push(text);
            input.value = '';
            save();
            render();
        };
        return [
            h('div', { class: 'stack' },
                h('div', { class: 'hero' },
                    h('h1', null, t('nh_title')),
                    h('p', null, t('nh_tagline'))),
                h('section', { class: 'panel' },
                    h('h2', null, t('nh_categories')),
                    h('div', { class: 'chips' }, DATA.categories.map((c) => {
                        const blocked = settings.family && ADULT_CATS.includes(c.id);
                        const on = cats.includes(c.id);
                        return h('button', {
                            class: 'chip toggle' + (on ? ' on' : '') + (ADULT_CATS.includes(c.id) ? ' spicy' : ''),
                            disabled: blocked, 'aria-pressed': on ? 'true' : 'false',
                            onclick: () => {
                                const cur = settings.cats || DATA.categories.map((x) => x.id);
                                settings.cats = on ? cur.filter((x) => x !== c.id) : [...cur, c.id];
                                save(); render();
                            },
                        }, `${c.name[lang] || c.name.en} (${count(c.id)})`);
                    })),
                    h('label', { class: 'set-main sub' },
                        h('span', { class: 'set-text' }, h('span', { class: 'set-title' }, t('set_family')), h('span', { class: 'set-desc' }, t('nh_family_d'))),
                        h('input', { type: 'checkbox', role: 'switch', class: 'switch', checked: settings.family, onchange: (e) => { settings.family = e.target.checked; save(); render(); } }))),
                h('section', { class: 'panel' },
                    h('label', { class: 'set-main' },
                        h('span', { class: 'set-text' }, h('span', { class: 'set-title' }, t('nh_lives')), h('span', { class: 'set-desc' }, t('nh_lives_d'))),
                        h('input', { type: 'checkbox', role: 'switch', class: 'switch', checked: settings.lives, onchange: (e) => { settings.lives = e.target.checked; save(); render(); } })),
                    settings.lives ? [
                        h('div', { class: 'stepper' },
                            h('span', { class: 'step-label' }, t('nh_lives_n')),
                            h('button', { class: 'step', disabled: settings.livesN <= 1, onclick: () => { settings.livesN -= 1; save(); render(); } }, '−'),
                            h('span', { class: 'step-val' }, String(settings.livesN)),
                            h('button', { class: 'step', disabled: settings.livesN >= 10, onclick: () => { settings.livesN += 1; save(); render(); } }, '+')),
                        players.length ? h('ul', { class: 'names' }, players.map((p, i) => h('li', { class: 'name-chip' },
                            h('span', null, p.name),
                            h('button', { class: 'x', 'aria-label': t('remove'), onclick: () => { players.splice(i, 1); save(); render(); } }, '×')))) : null,
                        h('form', { class: 'add-row', onsubmit: addPlayer },
                            h('input', { id: 'nh-player', maxlength: '24', autocomplete: 'off', placeholder: t('player_name'), 'aria-label': t('player_name') }),
                            h('button', { class: 'btn', type: 'submit', 'aria-label': t('add') }, '+')),
                    ] : null),
                h('section', { class: 'panel' },
                    h('h2', null, t('nh_custom')),
                    h('p', { class: 'muted small' }, t('nh_custom_d')),
                    custom.length ? h('ul', { class: 'custom-list' }, custom.map((c, i) => h('li', null,
                        h('span', null, c),
                        h('button', { class: 'x', 'aria-label': t('remove'), onclick: () => { custom.splice(i, 1); save(); render(); } }, '×')))) : null,
                    h('form', { class: 'add-row', onsubmit: addCustom },
                        h('input', { id: 'nh-custom', maxlength: '160', autocomplete: 'off', placeholder: t('nh_custom_ph') }),
                        h('button', { class: 'btn', type: 'submit', 'aria-label': t('add') }, '+')))),
            h('div', { class: 'bottom-bar' }, h('button', { class: 'btn primary big', onclick: start }, t('nh_start'))),
        ];
    }

    function playView() {
        const id = game.deck[game.pos];
        const left = game.deck.length - game.pos - 1;
        const winners = settings.lives ? alive() : null;
        if (settings.lives && winners.length <= 1) return winnerView(winners[0]);

        const coaster = h('button', { class: 'coaster' + (ui.flip ? ' flip-a' : ' flip-b'), onclick: next, 'aria-label': t('nh_next') },
            h('span', { class: 'coaster-cat' }, catName(cardCat(id))),
            h('span', { class: 'coaster-text' }, cardText(id)));

        const roster = settings.lives ? h('section', { class: 'roster-nh' },
            h('p', { class: 'muted small center' }, t('nh_did_it')),
            h('div', { class: 'chips' }, players.map((p) => {
                const out = p.lives <= 0;
                const marked = game.marked.includes(p.name);
                return h('button', {
                    class: 'chip life' + (marked ? ' marked' : '') + (out ? ' out' : ''), disabled: out, 'aria-pressed': marked ? 'true' : 'false',
                    onclick: () => {
                        game.marked = marked ? game.marked.filter((n) => n !== p.name) : [...game.marked, p.name];
                        save(); render();
                    },
                }, h('span', null, p.name), h('span', { class: 'dots' }, '●'.repeat(Math.max(0, p.lives - (marked ? 1 : 0))) + (marked ? '○' : '')));
            }))) : null;

        return [
            h('div', { class: 'play' },
                h('div', { class: 'muted small center' }, t('nh_left', { n: left })),
                coaster,
                h('p', { class: 'muted small center' }, t('nh_tap_card')),
                roster),
            h('div', { class: 'bottom-bar row3' },
                h('button', { class: 'btn ghost', disabled: !game.history.length, onclick: undo }, t('nh_undo')),
                h('button', { class: 'btn primary big', onclick: next }, t('nh_next')),
                h('button', { class: 'btn ghost', onclick: () => { ui.sheet = 'end'; render(); } }, t('nh_end'))),
        ];
    }

    function winnerView(winner) {
        return [
            h('div', { class: 'play' },
                h('div', { class: 'coaster won' },
                    h('span', { class: 'coaster-text' }, winner ? t('nh_winner', { name: winner.name }) : t('nh_nobody_left')))),
            h('div', { class: 'bottom-bar' },
                h('button', { class: 'btn primary big', onclick: start }, t('nh_again')),
                h('button', { class: 'btn ghost big', onclick: endGame }, t('nh_back_setup'))),
        ];
    }

    function sheet() {
        if (!ui.sheet) return null;
        const close = () => { ui.sheet = null; render(); };
        let title, body;
        if (ui.sheet === 'lang') {
            title = t('language');
            body = h('div', { class: 'pick-list' }, Object.entries(LANGS).map(([code, label]) => h('button', {
                class: 'btn big pick' + (code === lang ? ' selected' : ''),
                onclick: () => { lang = code; store.set('spia_lang', code); document.documentElement.lang = code; close(); },
            }, label)));
        } else if (ui.sheet === 'help') {
            title = t('help');
            body = h('div', { class: 'acc-body' }, t('nh_help').split('\n').map((p) => h('p', null, p)));
        } else {
            title = t('nh_end');
            body = h('div', { class: 'row2' },
                h('button', { class: 'btn ghost', onclick: close }, t('cancel')),
                h('button', { class: 'btn primary', onclick: () => { ui.sheet = null; endGame(); } }, t('nh_end')));
        }
        return h('div', { class: 'sheet-backdrop', onclick: (e) => { if (e.target === e.currentTarget) close(); } },
            h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
                h('div', { class: 'sheet-head' }, h('h2', null, title), h('button', { class: 'icon-btn', onclick: close, 'aria-label': t('close') }, '✕')),
                h('div', { class: 'sheet-body' }, body)));
    }

    function render() {
        const keep = {};
        app.querySelectorAll('input[id]').forEach((el) => { if (el.type !== 'checkbox') keep[el.id] = el.value; });
        const focused = document.activeElement && document.activeElement.id;
        app.replaceChildren(...[topBar(), h('main', { class: 'view' }, game ? playView() : setupView()), sheet(),
            ui.toast ? h('div', { class: 'toast', role: 'status' }, ui.toast) : null].filter(Boolean));
        for (const [k, v] of Object.entries(keep)) { const el = document.getElementById(k); if (el) el.value = v; }
        if (focused) { const el = document.getElementById(focused); if (el) el.focus({ preventScroll: true }); }
    }

    async function boot() {
        document.documentElement.lang = lang;
        try {
            DATA = await (await fetch('../assets/nonhomai/cards.json?v=1', { cache: 'no-cache' })).json();
            store.set('nh_cards_cache', DATA);
        } catch (e) {
            DATA = store.get('nh_cards_cache', DATA);   // offline: last copy
        }
        if (game && !game.deck.every((id) => cardText(id))) game = null;   // cards changed since last time
        render();
    }

    boot();
})();
