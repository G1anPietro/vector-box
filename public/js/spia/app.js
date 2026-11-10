// public/js/spia/app.js
// "Who's the Spy" mobile UI. Talks to api/spia.php (rooms, several phones) or to
// SpiaLocal (offline, one phone); both return the same state shape.
// All user text is inserted with textContent (via h()).
(() => {
    'use strict';
    const API = '../api/spia.php';
    const POLL_MS = 2000;
    const POLL_HIDDEN_MS = 8000;
    const LANGS = { it: 'Italiano', en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch' };

    const store = {
        get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
        set(k, v) { try { if (v === null || v === undefined) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    };

    const I18N = window.SpiaI18n;
    const Local = window.SpiaLocal;
    let lang = store.get('spia_lang') || I18N.detect(Object.keys(LANGS));
    const t = (k, vars) => I18N.t(lang, k, vars);

    let LOC = { categories: [], locations: [] };
    const locById = {};
    let mode = store.get('spia_mode');            // 'online' | 'local' | null (lobby)
    let token = store.get('spia_token');
    let state = mode === 'online' ? store.get('spia_state') : null;
    let pending = store.get('spia_pending', []);  // 'seen' actions made while offline
    let netOk = true;
    let serverOffset = 0;
    let pollTimer = null;
    let renderDeferred = false;
    let lastSig = '';
    let wakeLock = null;

    // Per-screen UI state (plain data, part of the render signature)
    const ui = {
        sheet: null,        // settings | help | lang | menu | locations | intro
        flow: null,         // { kind: 'review'|'guess', pid, phase, loc }
        passed: null,       // player id that confirmed "it's me" on a shared phone
        heldOnce: null,     // player id whose card was held at least once
        votePick: null,     // selected vote target
        confirm: null,      // { text, ok, danger, action }
        toast: null,
        holding: false,
        draft: null,        // settings being edited (host)
        introStep: 0,
        helpOpen: 0,
    };
    let confirmFn = null;

    const app = document.getElementById('app');

    // ---------- tiny DOM helper (text only, never HTML) ----------
    function h(tag, attrs, ...kids) {
        const el = document.createElement(tag);
        if (attrs) {
            for (const [k, v] of Object.entries(attrs)) {
                if (v === null || v === undefined || v === false) continue;
                if (k === 'class') el.className = v;
                else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
                else if (k === 'dataset') Object.assign(el.dataset, v);
                else if (k === 'value') el.value = v;
                else if (v === true) el.setAttribute(k, '');
                else el.setAttribute(k, String(v));
            }
        }
        for (const c of kids.flat(Infinity)) {
            if (c === null || c === undefined || c === false) continue;
            el.append(c instanceof Node ? c : document.createTextNode(String(c)));
        }
        return el;
    }
    /** Build a small inline SVG icon from static path data (no HTML parsing). */
    function svg(icon) {
        const NS = 'http://www.w3.org/2000/svg';
        const el = document.createElementNS(NS, 'svg');
        el.setAttribute('viewBox', '0 0 24 24');
        el.setAttribute('class', icon.cls);
        el.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS(NS, 'path');
        path.setAttribute('d', icon.d);
        if (icon.stroke) {
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', 'currentColor');
            path.setAttribute('stroke-width', '1.6');
            path.setAttribute('stroke-linecap', 'round');
        } else {
            path.setAttribute('fill', 'currentColor');
        }
        el.appendChild(path);
        return el;
    }
    const ICON_FP = { cls: 'fp', stroke: true, d: 'M12 4.5a7.5 7.5 0 0 1 7.5 7.5v1.5M4.5 13.5V12A7.5 7.5 0 0 1 8 5.6M12 8a4 4 0 0 1 4 4v2.5a8 8 0 0 1-1.2 4.2M8 12a4 4 0 0 1 1.2-2.9M8 12v2.5a11 11 0 0 1-1.5 5.5M12 12v2.5a12 12 0 0 1-2 6.5' };
    const ICON_CROWN = { cls: 'ico', stroke: false, d: 'M3 7l4.5 4L12 4l4.5 7L21 7l-2 11H5z' };

    // ---------- names ----------
    const lname = (obj) => (obj && (obj[lang] || obj.it || obj.en)) || '?';
    function customLocs() { return (state && state.round && state.round.custom_locations) || (state && state.settings.custom_locations) || []; }
    function locName(id, custom = customLocs()) {
        if (/^c\d+$/.test(id || '')) return (custom[+id.slice(1)] || {}).name || '?';
        return locById[id] ? lname(locById[id].name) : '?';
    }
    function roleName(locId, idx, custom = customLocs()) {
        if (/^c\d+$/.test(locId || '')) return ((custom[+locId.slice(1)] || {}).roles || [])[idx] || '?';
        return locById[locId] ? lname((locById[locId].roles || [])[idx]) : '?';
    }
    function catName(id) {
        if (id === 'custom') return t('cat_custom');
        const c = LOC.categories.find((x) => x.id === id);
        return c ? lname(c.name) : id;
    }
    const playerById = (id) => (state ? state.players.find((p) => p.id === id) : null);
    const pname = (id) => { const p = playerById(id); return p ? p.name : t('someone'); };
    const myPlayers = () => (state ? state.players.filter((p) => p.device_id === state.device_id) : []);
    const isPending = (pid) => pending.some((x) => x.player_id === pid);
    function alive() {
        const r = state.round;
        return r.in_round.filter((id) => !r.out.includes(id) && playerById(id));
    }

    // ---------- network ----------
    function setNet(ok) {
        if (netOk !== ok) { netOk = ok; scheduleRender(); }
    }

    async function api(method, body, query = '', retried = false) {
        const opts = { method, credentials: 'same-origin', cache: 'no-store', headers: {} };
        if (token) opts.headers['X-Spia-Device'] = token;
        if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
        let res;
        try {
            res = await fetch(API + query, opts);
        } catch (e) {
            setNet(false);
            const err = new Error('offline');
            err.code = 'offline';
            throw err;
        }
        setNet(true);
        let data = null;
        try { data = await res.json(); } catch (e) { /* not JSON */ }
        if (res.status === 403 && data && /CSRF/.test(String(data.error)) && !retried) {
            await loadSession();
            return api(method, body, query, true);
        }
        if (!res.ok || !data || data.success === false) {
            const err = new Error((data && data.error) || 'error');
            err.code = (data && data.error) || 'error';
            err.status = res.status;
            throw err;
        }
        return data;
    }

    async function loadSession() {
        try {
            const r = await fetch('../api/check_session.php', { credentials: 'same-origin', cache: 'no-store' });
            const s = await r.json();
            window.SESSION_STATE = { csrfToken: s.csrf_token, isAdmin: !!s.is_admin };
            return s;
        } catch (e) {
            return null;
        }
    }

    async function act(action, data = {}) {
        if (mode === 'local') {
            const s = Local.act(action, data);
            if (s && s.left) { exitRoom(); return s; }
            if (s && s.not_spy !== undefined) return s;
            applyState(s);
            return s;
        }
        const r = await api('POST', { action, ...data });
        if (r.left) { exitRoom(); return r; }
        if (r.not_spy !== undefined) return r;
        if (r.token) return r;
        applyState(r);
        return r;
    }

    /** Run an action from a button: errors become a toast. */
    async function run(action, data = {}, okToast = null) {
        try {
            const r = await act(action, data);
            if (okToast) toast(okToast);
            return r;
        } catch (e) {
            toast(errText(e.code), 'bad');
            return null;
        }
    }

    function errText(code) {
        const key = 'err_' + code;
        const s = t(key);
        return s === key ? t('err_generic') : s;
    }

    function applyState(s) {
        if (!s) return;
        if (typeof s.now === 'number') serverOffset = s.now * 1000 - Date.now();
        // Cards marked seen while offline stay seen until the server confirms
        if (pending.length && s.cards) s.cards.forEach((c) => { if (isPending(c.player_id)) c.seen = true; });
        state = s;
        if (mode === 'online') store.set('spia_state', s);
        if (ui.draft && JSON.stringify(ui.draft) === JSON.stringify(s.settings)) ui.draft = null;
        scheduleRender();
    }

    async function flushPending() {
        while (pending.length && mode === 'online') {
            const p = pending[0];
            try { await api('POST', { action: 'seen', player_id: p.player_id }); } catch (e) { if (e.code === 'offline') return; }
            pending.shift();
            store.set('spia_pending', pending);
        }
    }

    async function poll() {
        clearTimeout(pollTimer);
        if (mode === 'online' && token) {
            try {
                const s = await api('GET', null, '?action=state');
                applyState(s);
                if (pending.length) flushPending();
            } catch (e) {
                if (e.code === 'gone' || e.code === 'no_device') { exitRoom(); toast(t('removed'), 'bad'); }
            }
        } else if (mode === 'local') {
            applyState(Local.state());
        }
        const delay = document.hidden ? POLL_HIDDEN_MS : (mode === 'local' ? 1000 : POLL_MS);
        if (mode) pollTimer = setTimeout(poll, delay);
        keepAwake();
    }

    // ---------- entering / leaving ----------
    function enterOnline(tok) {
        token = tok;
        mode = 'online';
        store.set('spia_token', tok);
        store.set('spia_mode', 'online');
        pending = [];
        store.set('spia_pending', pending);
        resetFlow();
        poll();
    }

    function enterLocal(names = [], settings = null) {
        mode = 'local';
        store.set('spia_mode', 'local');
        state = Local.create(settings || {}, names);
        resetFlow();
        poll();
    }

    function exitRoom() {
        mode = null;
        token = null;
        state = null;
        pending = [];
        ['spia_mode', 'spia_token', 'spia_state', 'spia_pending'].forEach((k) => store.set(k, null));
        resetFlow();
        ui.sheet = null;
        clearTimeout(pollTimer);
        scheduleRender(true);
    }

    function resetFlow() {
        ui.flow = null; ui.passed = null; ui.heldOnce = null; ui.votePick = null; ui.confirm = null; ui.draft = null;
    }

    async function createRoom() {
        try {
            const r = await api('POST', { action: 'create', players: [] });
            enterOnline(r.token);
        } catch (e) {
            if (e.code === 'offline') askConfirm(t('offline_create'), t('play_offline'), () => enterLocal());
            else toast(errText(e.code), 'bad');
        }
    }

    async function joinRoom(code) {
        code = String(code || '').toUpperCase().replace(/[^A-Z]/g, '');
        if (code.length !== 4) { toast(t('err_room_not_found'), 'bad'); return; }
        try {
            const r = await api('POST', { action: 'join', code });
            enterOnline(r.token);
        } catch (e) {
            toast(errText(e.code), 'bad');
        }
    }

    async function shareRoom() {
        if (!state || !state.code) return;
        const url = `${location.origin}${location.pathname}?room=${state.code}`;
        try {
            if (navigator.share) { await navigator.share({ title: t('title'), text: t('share_text', { code: state.code }), url }); return; }
            await navigator.clipboard.writeText(url);
            toast(t('link_copied'));
        } catch (e) { /* user cancelled */ }
    }

    // ---------- feedback ----------
    let toastTimer = null;
    function toast(text, kind = 'ok') {
        ui.toast = { text, kind };
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { ui.toast = null; scheduleRender(); }, 2600);
        scheduleRender();
    }
    function askConfirm(text, ok, fn, danger = false) {
        ui.confirm = { text, ok, danger };
        confirmFn = fn;
        scheduleRender();
    }
    const vibrate = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* unsupported */ } };

    async function keepAwake() {
        const want = !!(mode && state && state.round && state.round.status === 'play' && !document.hidden);
        try {
            if (want && !wakeLock && navigator.wakeLock) {
                wakeLock = await navigator.wakeLock.request('screen');
                wakeLock.addEventListener('release', () => { wakeLock = null; });
            } else if (!want && wakeLock) {
                await wakeLock.release();
                wakeLock = null;
            }
        } catch (e) { wakeLock = null; }
    }

    // ---------- render loop ----------
    function signature() {
        const s = state ? { ...state, now: 0 } : null;
        return JSON.stringify([s, ui, lang, netOk, mode, pending.length]);
    }

    function scheduleRender(force = false) {
        if (ui.holding) { renderDeferred = true; return; }
        const sig = signature();
        if (!force && sig === lastSig) return;
        lastSig = sig;
        render();
    }

    function render() {
        // Keep typed text and focus across re-renders
        const active = document.activeElement && document.activeElement.id;
        const values = {};
        app.querySelectorAll('input[id], textarea[id]').forEach((el) => { if (el.type !== 'checkbox') values[el.id] = el.value; });
        const scroll = (app.querySelector('.sheet-body') || {}).scrollTop;

        app.replaceChildren(topBar(), h('main', { class: 'view' }, mainView()), ...overlays());

        for (const [id, v] of Object.entries(values)) { const el = document.getElementById(id); if (el) el.value = v; }
        if (active) { const el = document.getElementById(active); if (el && el.focus) el.focus({ preventScroll: true }); }
        const sb = app.querySelector('.sheet-body');
        if (sb && scroll) sb.scrollTop = scroll;
        updateTimers();
        window.dispatchEvent(new CustomEvent('spia:render'));
    }

    function updateTimers() {
        document.querySelectorAll('[data-ends]').forEach((el) => {
            const left = Math.max(0, Math.round((+el.dataset.ends * 1000 - (Date.now() + serverOffset)) / 1000));
            el.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
            el.classList.toggle('urgent', left <= 30);
        });
    }

    // ---------- top bar ----------
    function topBar() {
        const chips = [];
        if (mode === 'online' && state && state.code) {
            chips.push(h('button', { class: 'chip code', onclick: shareRoom, 'aria-label': t('invite') }, state.code));
        } else if (mode === 'local') {
            chips.push(h('span', { class: 'chip' }, t('one_phone')));
        }
        if (mode === 'online' && !netOk) chips.push(h('span', { class: 'chip warn' }, t('offline')));
        return h('header', { class: 'topbar' },
            h('div', { class: 'brand', id: 'spia-title' },
                h('img', { src: '../assets/spia/icon.svg', alt: '', class: 'brand-icon', draggable: 'false' }),
                h('span', null, t('title'))),
            h('div', { class: 'top-chips' }, chips),
            h('button', { class: 'icon-btn', onclick: () => openSheet('lang'), 'aria-label': t('language') }, lang.toUpperCase()),
            h('button', { class: 'icon-btn', onclick: () => openSheet('help'), 'aria-label': t('help') }, '?'),
            mode ? h('button', { class: 'icon-btn', onclick: () => openSheet('menu'), 'aria-label': t('menu') }, '⋯') : null);
    }

    function openSheet(name) {
        ui.sheet = name;
        if (name === 'settings') ui.draft = null;
        scheduleRender();
    }
    function closeSheet() { ui.sheet = null; scheduleRender(); }

    // ---------- main views ----------
    function mainView() {
        if (!mode) return lobbyView();
        if (!state) return h('div', { class: 'center muted' }, t('loading'));
        const r = state.round;
        if (r && r.status === 'play') {
            const next = nextReveal();
            if (next) return revealView(next);
            if (ui.flow && ui.flow.kind === 'review') return reviewView();
            if (ui.flow && ui.flow.kind === 'guess') return guessView();
            const voter = nextVoter();
            if (voter) return voteView(voter);
            return gameView();
        }
        return roomView();
    }

    function lobbyView() {
        const prefill = new URLSearchParams(location.search).get('room') || '';
        return h('div', { class: 'lobby' },
            h('div', { class: 'hero' },
                h('h1', { class: 'stencil' }, t('title')),
                h('p', null, t('tagline'))),
            h('button', { class: 'btn primary big', onclick: createRoom }, t('create_room')),
            h('form', {
                class: 'join', onsubmit: (e) => { e.preventDefault(); joinRoom(document.getElementById('join-code').value); },
            },
            h('input', {
                id: 'join-code', class: 'code-input', maxlength: '4', autocomplete: 'off', autocapitalize: 'characters',
                spellcheck: 'false', placeholder: 'ABCD', value: prefill, 'aria-label': t('room_code'),
                oninput: (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); },
            }),
            h('button', { class: 'btn', type: 'submit' }, t('join'))),
            h('div', { class: 'divider' }, h('span', null, t('or'))),
            h('button', { class: 'btn ghost big', onclick: () => enterLocal() }, t('play_offline')),
            h('p', { class: 'muted small center' }, t('offline_note')),
            h('div', { class: 'lobby-links' },
                h('button', { class: 'link', onclick: () => { ui.introStep = 0; openSheet('intro'); } }, t('how_to_play')),
                h('a', { class: 'link', href: '../index.php' }, t('back_to_site'))));
    }

    // ----- room (between rounds) -----
    function roomView() {
        const s = state;
        const host = s.is_host;
        const r = s.round;
        const parts = [];

        if (mode === 'online' && !netOk) parts.push(offlineBanner());
        if (r && r.status === 'ended' && r.result) parts.push(resultCard(r));

        parts.push(section(t('on_this_phone'), myPlayersEditor()));

        if (mode === 'online') parts.push(section(t('players_count', { n: s.players.length }), phonesList()));
        if (s.settings.scores && s.players.length) parts.push(section(t('scores'), scoreList()));
        parts.push(plainSection(t('settings'), settingsSummary(),
            h('button', { class: 'btn ghost', onclick: () => openSheet('settings') }, host ? t('edit_settings') : t('view_settings'))));

        const enough = s.players.length >= 3;
        const bottom = host
            ? h('button', { class: 'btn primary big', disabled: !enough, onclick: () => { resetFlow(); run('start'); } },
                r && r.status === 'ended' ? t('new_round') : t('start_round'))
            : h('div', { class: 'waiting' }, t('waiting_host'));
        return [h('div', { class: 'stack' }, parts),
            h('div', { class: 'bottom-bar' }, !enough ? h('div', { class: 'muted small center' }, t('need_three')) : null, bottom)];
    }

    function section(title, ...body) {
        return h('section', { class: 'panel' }, h('h2', null, title), body);
    }
    function plainSection(title, ...body) {
        return h('section', { class: 'plain' }, h('h2', null, title), body);
    }

    function offlineBanner() {
        return h('div', { class: 'banner warn' },
            h('div', null, t('connection_lost')),
            h('button', {
                class: 'btn small',
                onclick: () => askConfirm(t('continue_offline_q'), t('play_offline'), () => {
                    const names = state.players.map((p) => p.name);
                    const settings = state.settings;
                    exitRoom();
                    enterLocal(names, settings);
                }),
            }, t('play_offline')));
    }

    function myPlayersEditor() {
        const mine = myPlayers();
        const add = async () => {
            const input = document.getElementById('add-player');
            const name = input.value.trim();
            if (!name) return;
            input.value = '';
            const r = await run('player_add', { name });
            const fresh = document.getElementById('add-player'); // the list re-rendered meanwhile
            if (!r && fresh) fresh.value = name;                 // keep the text if it failed
            if (fresh) fresh.focus();
        };
        return [
            mine.length ? h('ul', { class: 'names', id: 'my-players' }, mine.map((p) => h('li', { class: 'name-chip', dataset: { playerId: p.id } },
                h('span', null, p.name),
                h('button', { class: 'x', 'aria-label': t('remove'), onclick: () => run('player_remove', { player_id: p.id }) }, '×'))))
                : h('p', { class: 'muted small' }, mode === 'local' ? t('add_everyone') : t('add_who_uses')),
            h('form', { class: 'add-row', onsubmit: (e) => { e.preventDefault(); add(); } },
                h('input', { id: 'add-player', maxlength: '24', autocomplete: 'off', enterkeyhint: 'done', placeholder: t('player_name'), 'aria-label': t('player_name') }),
                h('button', { class: 'btn', type: 'submit', 'aria-label': t('add') }, '+')),
        ];
    }

    function phonesList() {
        const s = state;
        return h('ul', { class: 'phones' }, s.devices.map((d, i) => {
            const mine = d.id === s.device_id;
            const names = d.players.map((id) => pname(id));
            const actions = [];
            if (!mine && !d.online) {
                actions.push(h('button', { class: 'btn small', onclick: () => run('take', { device_id: d.id }, t('took_players')) }, t('take_players')));
            }
            if (s.is_host && !mine) {
                actions.push(h('button', { class: 'btn small ghost', onclick: () => run('host', { device_id: d.id }) }, t('make_host')));
                actions.push(h('button', {
                    class: 'btn small danger',
                    onclick: () => askConfirm(t('kick_q'), t('remove'), () => run('kick', { device_id: d.id }), true),
                }, t('remove')));
            }
            return h('li', { class: 'phone' + (mine ? ' mine' : '') },
                h('div', { class: 'phone-head' },
                    h('span', { class: 'dot ' + (d.online ? 'on' : 'off'), 'aria-label': d.online ? t('online') : t('offline') }),
                    h('strong', null, mine ? t('this_phone') : t('phone_n', { n: i + 1 })),
                    d.host ? h('span', { class: 'host-tag' }, svg(ICON_CROWN), t('host')) : null,
                    !d.online ? h('span', { class: 'muted small' }, t('offline')) : null),
                h('div', { class: 'phone-names' }, names.length ? names.join(', ') : t('no_players_yet')),
                actions.length ? h('div', { class: 'phone-actions' }, actions) : null);
        }));
    }

    function scoreList() {
        const sorted = state.players.slice().sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
        return [h('ol', { class: 'scores' }, sorted.map((p) => h('li', null, h('span', null, p.name), h('strong', null, String(p.score))))),
            state.is_host ? h('button', {
                class: 'link small', onclick: () => askConfirm(t('reset_scores_q'), t('reset'), () => run('reset_scores'), true),
            }, t('reset_scores')) : null];
    }

    function settingsSummary() {
        const s = state.settings;
        const chips = [];
        chips.push(s.spy_mode === 'range' ? t('sum_spies_range', { min: s.spy_min, max: s.spy_max }) : t('sum_spies', { n: s.spies }));
        if (s.vote) chips.push(t('set_vote'));
        if (s.guess) chips.push(t('set_guess'));
        if (s.timer) chips.push(t('sum_timer', { n: s.timer_min }));
        if (s.scores) chips.push(t('set_scores'));
        if (s.spy_hint) chips.push(t('set_hint'));
        if (s.family) chips.push(t('set_family'));
        if (s.custom && s.custom_locations.length) chips.push(t('sum_custom', { n: s.custom_locations.length }));
        return h('div', { class: 'chips' }, chips.map((c) => h('span', { class: 'chip soft' }, c)));
    }

    function resultCard(r) {
        const res = r.result;
        const custom = r.custom_locations;
        const win = { spies: t('win_spies'), civilians: t('win_civilians'), none: t('win_none'), host: t('win_host') }[res.winner] || '';
        const rows = Object.keys(res.roles).map(Number).filter((id) => playerById(id)).map((id) => {
            const spy = res.spies.includes(id);
            return h('li', { class: spy ? 'is-spy' : '' },
                h('span', null, pname(id)),
                h('span', { class: 'role' }, spy ? t('spy') : roleName(res.location_id, res.roles[id], custom)));
        });
        return h('section', { class: 'panel result ' + res.winner },
            h('div', { class: 'stamp result-stamp' }, win),
            h('div', { class: 'muted' }, t('reason_' + res.reason, {
                name: res.out ? pname(res.out) : (res.guesser ? pname(res.guesser) : ''),
            })),
            h('div', { class: 'result-loc' }, h('span', { class: 'muted small' }, t('location_was')), h('strong', null, locName(res.location_id, custom))),
            h('ul', { class: 'result-list' }, rows));
    }

    // ----- reveal (hold the card) -----
    function nextReveal() {
        const mine = myPlayers().map((p) => p.id);
        return (state.cards || []).find((c) => mine.includes(c.player_id) && !c.seen && !c.out && !isPending(c.player_id)) || null;
    }

    function passView(pid, title, onReady) {
        return h('div', { class: 'pass' },
            h('div', { class: 'muted' }, title),
            h('div', { class: 'pass-name' }, pname(pid)),
            h('p', { class: 'muted small center' }, t('nobody_looking')),
            h('div', { class: 'bottom-bar' }, h('button', { class: 'btn primary big', onclick: onReady }, t('i_am', { name: pname(pid) }))));
    }

    function revealView(card) {
        const pid = card.player_id;
        const shared = myPlayers().length > 1;
        if (shared && ui.passed !== pid) {
            return passView(pid, t('pass_phone_to'), () => { ui.passed = pid; ui.heldOnce = null; scheduleRender(); });
        }
        const done = async () => {
            ui.passed = null;
            ui.heldOnce = null;
            if (mode === 'online' && !netOk) {
                pending.push({ player_id: pid });
                store.set('spia_pending', pending);
                card.seen = true;
                scheduleRender(true);
                return;
            }
            try {
                await act('seen', { player_id: pid });
            } catch (e) {
                if (e.code === 'offline') { pending.push({ player_id: pid }); store.set('spia_pending', pending); card.seen = true; }
                scheduleRender(true);
            }
        };
        const btn = h('button', { class: 'btn primary big', disabled: ui.heldOnce !== pid, onclick: done }, t('got_it'));
        return h('div', { class: 'reveal' },
            h('div', { class: 'muted center' }, t('round_n', { n: state.round.number })),
            holdCard(card, () => { ui.heldOnce = pid; btn.disabled = false; }),
            h('p', { class: 'muted small center' }, t('hold_note')),
            h('div', { class: 'bottom-bar' }, btn));
    }

    function holdCard(card, onReleased) {
        const el = h('div', { class: 'card', tabindex: '0', role: 'button', 'aria-label': t('hold_to_reveal') },
            h('div', { class: 'card-inner' },
                cardBack(card),
                h('div', { class: 'card-face card-front' },
                    h('div', { class: 'card-name' }, pname(card.player_id)),
                    svg(ICON_FP),
                    h('div', { class: 'card-hint' }, t('hold_to_reveal')))));
        const show = (e) => {
            if (e.cancelable) e.preventDefault();
            if (el.classList.contains('revealed')) return;
            ui.holding = true;
            el.classList.add('revealed');
            vibrate(25);
            if (e.pointerId !== undefined && el.setPointerCapture) { try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } }
        };
        const hide = () => {
            if (!el.classList.contains('revealed')) return;
            el.classList.remove('revealed');
            ui.holding = false;
            if (onReleased) onReleased();
            if (renderDeferred) { renderDeferred = false; setTimeout(() => scheduleRender(), 300); }
        };
        el.addEventListener('pointerdown', show);
        el.addEventListener('pointerup', hide);
        el.addEventListener('pointercancel', hide);
        el.addEventListener('lostpointercapture', hide);
        el.addEventListener('contextmenu', (e) => e.preventDefault());
        el.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') show(e); });
        el.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') hide(); });
        return el;
    }

    function cardBack(card) {
        if (card.spy) {
            return h('div', { class: 'card-face card-back spy', dataset: { player: card.player_id } },
                h('div', { class: 'card-label' }, pname(card.player_id)),
                h('div', { class: 'stamp' }, t('you_are_spy')),
                card.hint ? h('div', { class: 'card-sub' }, t('hint_is', { cat: catName(card.hint) })) : null,
                h('p', { class: 'card-text' }, t('spy_goal')));
        }
        return h('div', { class: 'card-face card-back', dataset: { player: card.player_id } },
            h('div', { class: 'card-label' }, pname(card.player_id)),
            h('div', { class: 'card-sub' }, t('secret_location')),
            h('div', { class: 'card-loc' }, locName(card.location_id)),
            h('div', { class: 'card-sub' }, t('your_role')),
            h('div', { class: 'card-role' }, roleName(card.location_id, card.role)));
    }

    function reviewView() {
        const f = ui.flow;
        const mine = myPlayers();
        const cancel = () => { ui.flow = null; scheduleRender(); };
        if (!f.pid) {
            if (mine.length === 1) { f.pid = mine[0].id; } else {
                return h('div', { class: 'stack' },
                    h('h2', { class: 'center' }, t('who_are_you')),
                    h('div', { class: 'pick-list' }, mine.map((p) => h('button', { class: 'btn big', onclick: () => { f.pid = p.id; scheduleRender(true); } }, p.name))),
                    h('div', { class: 'bottom-bar' }, h('button', { class: 'btn ghost big', onclick: cancel }, t('cancel'))));
            }
        }
        const card = (state.cards || []).find((c) => c.player_id === f.pid);
        if (!card) { ui.flow = null; return gameView(); }
        return h('div', { class: 'reveal' },
            holdCard(card, null),
            h('p', { class: 'muted small center' }, t('hold_note')),
            h('div', { class: 'bottom-bar' }, h('button', { class: 'btn big', onclick: cancel }, t('close'))));
    }

    // ----- round in progress -----
    function gameView() {
        const r = state.round;
        const al = alive();
        const parts = [];
        if (mode === 'online' && !netOk) parts.push(offlineBanner());
        if (mode === 'online' && netOk) {
            // Another phone dropped out: anyone can take over its players and keep playing
            state.devices.filter((d) => !d.online && d.id !== state.device_id && d.players.length).forEach((d) => {
                parts.push(h('div', { class: 'banner warn' },
                    h('div', null, t('phone_offline', { names: d.players.map((id) => pname(id)).join(', ') })),
                    h('button', { class: 'btn small', onclick: () => run('take', { device_id: d.id }, t('took_players')) }, t('take_players'))));
            });
        }

        const head = h('section', { class: 'round-head' },
            h('div', { class: 'round-line' },
                h('strong', null, t('round_n', { n: r.number })),
                h('span', { class: 'chip soft' }, t('spies_n', { n: r.spy_count === null ? '?' : r.spy_count }))),
            r.all_seen
                ? (r.starter ? h('div', { class: 'starter' }, h('span', { class: 'muted small' }, t('first_asks')), h('strong', null, pname(r.starter))) : null)
                : h('div', { class: 'muted' }, t('waiting_reveal', { n: r.seen.filter((id) => playerById(id)).length, total: al.length })),
            r.rules.timer && r.timer_ends ? h('div', { class: 'timer', dataset: { ends: r.timer_ends } }, '') : null);
        parts.push(head);

        if (r.vote.open) {
            const voted = r.vote.voted.filter((id) => al.includes(id)).length;
            parts.push(h('section', { class: 'vote-status' },
                h('strong', null, r.vote.forced ? t('final_vote') : t('vote_running')),
                h('div', { class: 'muted' }, t('voted_n', { n: voted, total: al.length })),
                state.is_host ? h('button', {
                    class: 'btn small ghost', onclick: () => askConfirm(t('close_vote_q'), t('close_vote'), () => run('vote_close')),
                }, t('close_vote')) : null));
        }

        parts.push(section(t('players'), h('ul', { class: 'roster' }, r.in_round.filter((id) => playerById(id)).map((id) => {
            const out = r.out.includes(id);
            const ev = r.log.find((e) => e.t === 'out' && e.p === id) || r.log.find((e) => e.t === 'guess' && e.p === id && !e.ok);
            const tag = out ? (ev && (ev.spy || ev.t === 'guess') ? t('was_spy') : t('was_innocent')) : (r.vote.open && r.vote.voted.includes(id) ? '✓' : '');
            return h('li', { class: out ? 'out' : '' }, h('span', null, pname(id)), tag ? h('span', { class: 'tag' }, tag) : null);
        }))));

        const events = r.log.slice().reverse().map(logLine).filter(Boolean).slice(0, 6);
        if (events.length) parts.push(plainSection(t('what_happened'), h('ul', { class: 'log' }, events.map((e) => h('li', null, e)))));

        const buttons = [];
        buttons.push(h('button', { class: 'btn big', onclick: () => { ui.flow = { kind: 'review', pid: null }; scheduleRender(); } }, t('see_role_again')));
        if (r.rules.vote && !r.vote.open) {
            buttons.push(h('button', {
                class: 'btn primary big', onclick: () => askConfirm(t('call_vote_q'), t('call_vote'), () => run('vote_call')),
            }, t('call_vote')));
        }
        if (r.rules.guess) {
            buttons.push(h('button', { class: 'btn big', onclick: () => { ui.flow = { kind: 'guess', pid: null, phase: 'who', loc: null }; scheduleRender(); } }, t('guess_location')));
        }
        if (r.rules.spy_list) buttons.push(h('button', { class: 'btn ghost big', onclick: () => openSheet('locations') }, t('possible_locations')));
        if (state.is_host) {
            buttons.push(h('button', {
                class: 'btn ghost big danger', onclick: () => askConfirm(t('end_round_q'), t('end_round'), () => run('end'), true),
            }, t('end_round')));
        }
        parts.push(h('div', { class: 'actions' }, buttons));
        return h('div', { class: 'stack' }, parts);
    }

    function logLine(e) {
        const custom = state.round.custom_locations;
        switch (e.t) {
            case 'vote': return t('log_vote');
            case 'tie': return t('log_tie') + tallyText(e.counts);
            case 'no_spies': return t('log_no_spies') + tallyText(e.counts);
            case 'out': return (e.spy ? t('log_out_spy', { name: pname(e.p) }) : t('log_out_innocent', { name: pname(e.p) })) + tallyText(e.counts);
            case 'guess': return e.ok ? t('log_guess_right', { name: pname(e.p), loc: locName(e.loc, custom) }) : t('log_guess_wrong', { name: pname(e.p), loc: locName(e.loc, custom) });
            case 'join': return t('log_join', { name: pname(e.p) });
            case 'timer': return t('log_timer');
            case 'time_up': return t('log_time_up');
            default: return null;
        }
    }
    function tallyText(counts) {
        if (!counts) return '';
        const parts = Object.entries(counts).sort((a, b) => b[1] - a[1])
            .map(([id, n]) => `${+id === 0 ? t('no_spies') : pname(+id)} ${n}`);
        return parts.length ? ` (${parts.join(', ')})` : '';
    }

    // ----- voting -----
    function nextVoter() {
        const r = state.round;
        if (!r.vote.open) return null;
        const al = alive();
        return myPlayers().map((p) => p.id).find((id) => al.includes(id) && !r.vote.voted.includes(id)) || null;
    }

    function voteView(pid) {
        const r = state.round;
        const shared = myPlayers().length > 1;
        if (shared && ui.passed !== pid) {
            return passView(pid, r.vote.forced ? t('final_vote_pass') : t('vote_pass'), () => { ui.passed = pid; ui.votePick = null; scheduleRender(); });
        }
        const options = alive().filter((id) => id !== pid);
        const pick = (v) => { ui.votePick = v; scheduleRender(); };
        const send = async () => {
            if (ui.votePick === null) return;
            const res = await run('vote', { player_id: pid, target: ui.votePick });
            if (res) { ui.passed = null; ui.votePick = null; vibrate(15); scheduleRender(true); }
        };
        return h('div', { class: 'stack' },
            h('div', { class: 'center' },
                h('div', { class: 'muted small' }, t('voting_as', { name: pname(pid) })),
                h('h2', null, t('who_is_spy')),
                r.vote.forced ? h('div', { class: 'chip warn' }, t('final_vote')) : null),
            h('div', { class: 'pick-list' },
                options.map((id) => h('button', { class: 'btn big pick' + (ui.votePick === id ? ' selected' : ''), onclick: () => pick(id) }, pname(id))),
                h('button', { class: 'btn big pick nospy' + (ui.votePick === 0 ? ' selected' : ''), onclick: () => pick(0) }, t('no_spies_left'))),
            h('div', { class: 'bottom-bar' }, h('button', { class: 'btn primary big', disabled: ui.votePick === null, onclick: send }, t('confirm_vote'))));
    }

    // ----- spy guess -----
    function poolSorted() {
        const r = state.round;
        return r.pool.map((id) => ({ id, name: locName(id, r.custom_locations) })).sort((a, b) => a.name.localeCompare(b.name, lang));
    }

    function guessView() {
        const f = ui.flow;
        const r = state.round;
        const al = alive();
        const mine = myPlayers().filter((p) => al.includes(p.id));
        const cancel = () => { ui.flow = null; scheduleRender(); };
        if (!mine.length) { ui.flow = null; return gameView(); }
        if (!f.pid && mine.length === 1) f.pid = mine[0].id;
        if (!f.pid) {
            return h('div', { class: 'stack' },
                h('h2', { class: 'center' }, t('who_guesses')),
                h('div', { class: 'pick-list' }, mine.map((p) => h('button', { class: 'btn big', onclick: () => { f.pid = p.id; scheduleRender(true); } }, p.name))),
                h('div', { class: 'bottom-bar' }, h('button', { class: 'btn ghost big', onclick: cancel }, t('cancel'))));
        }
        if (f.phase === 'not_spy') {
            return h('div', { class: 'pass' },
                h('div', { class: 'pass-name small-name' }, t('not_spy')),
                h('p', { class: 'muted center' }, t('not_spy_note')),
                h('div', { class: 'bottom-bar' }, h('button', { class: 'btn primary big', onclick: cancel }, t('ok'))));
        }
        const send = async () => {
            const res = await run('guess', { player_id: f.pid, location_id: f.loc });
            if (res && res.not_spy) { f.phase = 'not_spy'; scheduleRender(true); return; }
            if (res) { ui.flow = null; scheduleRender(true); }
        };
        return h('div', { class: 'stack' },
            h('div', { class: 'center' },
                h('div', { class: 'muted small' }, t('guessing_as', { name: pname(f.pid) })),
                h('h2', null, t('where_are_we')),
                h('p', { class: 'muted small' }, t('guess_warning'))),
            h('div', { class: 'loc-grid' }, poolSorted().map((l) => h('button', {
                class: 'loc' + (f.loc === l.id ? ' selected' : ''), onclick: () => { f.loc = l.id; scheduleRender(true); },
            }, l.name))),
            h('div', { class: 'bottom-bar row2' },
                h('button', { class: 'btn ghost big', onclick: cancel }, t('cancel')),
                h('button', { class: 'btn primary big', disabled: !f.loc, onclick: send }, t('confirm_guess'))));
    }

    // ---------- overlays ----------
    function overlays() {
        const out = [];
        if (ui.sheet) out.push(sheet());
        if (ui.confirm) {
            out.push(h('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === e.currentTarget) { ui.confirm = null; scheduleRender(); } } },
                h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
                    h('p', null, ui.confirm.text),
                    h('div', { class: 'row2' },
                        h('button', { class: 'btn ghost', onclick: () => { ui.confirm = null; scheduleRender(); } }, t('cancel')),
                        h('button', {
                            class: 'btn ' + (ui.confirm.danger ? 'danger' : 'primary'),
                            onclick: () => { const fn = confirmFn; ui.confirm = null; confirmFn = null; scheduleRender(); if (fn) fn(); },
                        }, ui.confirm.ok)))));
        }
        if (ui.toast) out.push(h('div', { class: 'toast ' + ui.toast.kind, role: 'status' }, ui.toast.text));
        return out;
    }

    function sheet() {
        const titles = {
            settings: t('settings'), help: t('help'), lang: t('language'), menu: t('menu'),
            locations: t('possible_locations'), intro: t('how_to_play'),
        };
        const body = {
            settings: settingsSheet, help: helpSheet, lang: langSheet, menu: menuSheet,
            locations: locationsSheet, intro: introSheet,
        }[ui.sheet];
        if (!body) return null;
        return h('div', { class: 'sheet-backdrop', onclick: (e) => { if (e.target === e.currentTarget) closeSheet(); } },
            h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': titles[ui.sheet] },
                h('div', { class: 'sheet-head' },
                    h('h2', null, titles[ui.sheet]),
                    h('button', { class: 'icon-btn', onclick: closeSheet, 'aria-label': t('close') }, '✕')),
                h('div', { class: 'sheet-body' }, body())));
    }

    function langSheet() {
        return h('div', { class: 'pick-list' }, Object.entries(LANGS).map(([code, label]) => h('button', {
            class: 'btn big pick' + (code === lang ? ' selected' : ''),
            onclick: () => { lang = code; store.set('spia_lang', code); document.documentElement.lang = code; closeSheet(); },
        }, label)));
    }

    function menuSheet() {
        const items = [];
        if (mode === 'online' && state && state.code) items.push(h('button', { class: 'btn big', onclick: () => { closeSheet(); shareRoom(); } }, t('invite_code', { code: state.code })));
        items.push(h('button', { class: 'btn big', onclick: () => openSheet('settings') }, t('settings')));
        items.push(h('button', { class: 'btn big', onclick: () => { ui.introStep = 0; openSheet('intro'); } }, t('how_to_play')));
        items.push(h('button', {
            class: 'btn big danger',
            onclick: () => { closeSheet(); askConfirm(mode === 'local' ? t('leave_local_q') : t('leave_q'), t('leave'), () => run('leave'), true); },
        }, mode === 'local' ? t('end_local') : t('leave_room')));
        items.push(h('a', { class: 'btn big ghost', href: '../index.php' }, t('back_to_site')));
        return h('div', { class: 'pick-list' }, items);
    }

    function locationsSheet() {
        if (!state || !state.round) return null;
        return h('ul', { class: 'loc-list' }, poolSorted().map((l) => h('li', null, l.name)));
    }

    function helpSheet() {
        const topics = ['basics', 'spies', 'vote', 'guess', 'phones', 'shared', 'offline', 'scores', 'settings'];
        return [
            h('div', { class: 'accordion' }, topics.map((k, i) => {
                const open = ui.helpOpen === i;
                return h('div', { class: 'acc' + (open ? ' open' : '') },
                    h('button', { class: 'acc-head', 'aria-expanded': open ? 'true' : 'false', onclick: () => { ui.helpOpen = open ? -1 : i; scheduleRender(); } },
                        h('span', null, t('help_' + k + '_t')), h('span', { class: 'acc-arrow' }, open ? '−' : '+')),
                    open ? h('div', { class: 'acc-body' }, t('help_' + k).split('\n').map((p) => h('p', null, p))) : null);
            })),
            h('button', { class: 'btn ghost', onclick: () => { ui.introStep = 0; openSheet('intro'); } }, t('show_intro')),
        ];
    }

    function introSheet() {
        const steps = [1, 2, 3];
        const i = Math.min(ui.introStep, steps.length - 1);
        const last = i === steps.length - 1;
        const finish = () => { store.set('spia_intro_done', true); closeSheet(); };
        return h('div', { class: 'intro' },
            h('div', { class: 'intro-num' }, `${i + 1} / ${steps.length}`),
            h('h3', null, t(`intro_${steps[i]}_t`)),
            h('p', null, t(`intro_${steps[i]}`)),
            h('div', { class: 'dots' }, steps.map((_, k) => h('span', { class: 'dot ' + (k === i ? 'on' : 'off') }))),
            h('div', { class: 'row2' },
                h('button', { class: 'btn ghost', onclick: finish }, t('skip')),
                h('button', { class: 'btn primary', onclick: () => { if (last) finish(); else { ui.introStep = i + 1; scheduleRender(); } } }, last ? t('lets_play') : t('next'))));
    }

    // ----- settings editor -----
    let settingsTimer = null;
    function settingsSheet() {
        const host = state && state.is_host;
        const s = ui.draft || (state ? state.settings : Local.defaults());
        const set = (patch) => {
            if (!host) return;
            ui.draft = { ...(ui.draft || state.settings), ...patch };
            scheduleRender();
            clearTimeout(settingsTimer);
            const draft = ui.draft;
            settingsTimer = setTimeout(async () => {
                const r = await run('settings', { settings: draft });
                if (!r) ui.draft = null;
                scheduleRender();
            }, 350);
        };
        const toggle = (key, title, desc, extra = null) => h('div', { class: 'set-row' },
            h('label', { class: 'set-main' },
                h('span', { class: 'set-text' }, h('span', { class: 'set-title' }, title), h('span', { class: 'set-desc' }, desc)),
                h('input', { type: 'checkbox', role: 'switch', class: 'switch', checked: !!s[key], disabled: !host, onchange: (e) => set({ [key]: e.target.checked }) })),
            s[key] && extra ? h('div', { class: 'set-extra' }, extra) : null);
        const stepper = (key, label, min, max) => h('div', { class: 'stepper' },
            h('span', { class: 'step-label' }, label),
            h('button', { class: 'step', disabled: !host || s[key] <= min, onclick: () => set({ [key]: Math.max(min, s[key] - 1) }), 'aria-label': '−' }, '−'),
            h('span', { class: 'step-val' }, String(s[key])),
            h('button', { class: 'step', disabled: !host || s[key] >= max, onclick: () => set({ [key]: Math.min(max, s[key] + 1) }), 'aria-label': '+' }, '+'));

        const spyBlock = h('div', { class: 'set-row' },
            h('div', { class: 'set-text' }, h('span', { class: 'set-title' }, t('set_spies')), h('span', { class: 'set-desc' }, t('set_spies_d'))),
            h('div', { class: 'segmented' },
                h('button', { class: s.spy_mode === 'fixed' ? 'on' : '', disabled: !host, onclick: () => set({ spy_mode: 'fixed' }) }, t('spies_fixed')),
                h('button', { class: s.spy_mode === 'range' ? 'on' : '', disabled: !host, onclick: () => set({ spy_mode: 'range' }) }, t('spies_random'))),
            s.spy_mode === 'fixed'
                ? stepper('spies', t('how_many'), 0, 20)
                : [stepper('spy_min', t('minimum'), 0, 20),
                    h('div', { class: 'stepper' },
                        h('span', { class: 'step-label' }, t('maximum')),
                        h('button', { class: 'step', disabled: !host || s.spy_max <= s.spy_min, onclick: () => set({ spy_max: Math.max(s.spy_min, s.spy_max - 1) }) }, '−'),
                        h('span', { class: 'step-val' }, String(s.spy_max)),
                        h('button', { class: 'step', disabled: !host || s.spy_max >= 20, onclick: () => set({ spy_max: Math.min(20, s.spy_max + 1) }) }, '+')),
                    h('p', { class: 'set-desc' }, t('range_note')),
                    h('label', { class: 'set-main sub' },
                        h('span', { class: 'set-text' }, h('span', { class: 'set-title' }, t('set_show_count')), h('span', { class: 'set-desc' }, t('set_show_count_d'))),
                        h('input', { type: 'checkbox', role: 'switch', class: 'switch', checked: !!s.show_count, disabled: !host, onchange: (e) => set({ show_count: e.target.checked }) }))]);

        const packs = h('div', { class: 'set-row' },
            h('div', { class: 'set-text' }, h('span', { class: 'set-title' }, t('set_packs')), h('span', { class: 'set-desc' }, t('set_packs_d'))),
            h('div', { class: 'chips' }, LOC.categories.map((c) => {
                const blocked = s.family && c.id === 'adult';
                const on = s.packs.includes(c.id) && !blocked;
                const count = LOC.locations.filter((l) => l.cat === c.id).length;
                return h('button', {
                    class: 'chip toggle' + (on ? ' on' : ''), disabled: !host || blocked, 'aria-pressed': on ? 'true' : 'false',
                    onclick: () => set({ packs: on ? s.packs.filter((x) => x !== c.id) : [...s.packs, c.id] }),
                }, `${lname(c.name)} (${count})`);
            })));

        const customEditor = [
            h('ul', { class: 'custom-list' }, s.custom_locations.map((l, i) => h('li', null,
                h('div', null, h('strong', null, l.name), h('div', { class: 'muted small' }, l.roles.join(', '))),
                host ? h('button', { class: 'x', 'aria-label': t('remove'), onclick: () => set({ custom_locations: s.custom_locations.filter((_, k) => k !== i) }) }, '×') : null))),
            host ? h('div', { class: 'custom-add' },
                h('input', { id: 'cl-name', maxlength: '40', placeholder: t('custom_name'), autocomplete: 'off' }),
                h('textarea', { id: 'cl-roles', rows: '3', placeholder: t('custom_roles') }),
                h('button', {
                    class: 'btn small', onclick: () => {
                        const name = document.getElementById('cl-name').value.trim();
                        const roles = document.getElementById('cl-roles').value.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
                        if (!name || roles.length < 1) { toast(t('custom_need'), 'bad'); return; }
                        document.getElementById('cl-name').value = '';
                        document.getElementById('cl-roles').value = '';
                        set({ custom_locations: [...s.custom_locations, { name, roles }].slice(0, 30) });
                    },
                }, t('add_location'))) : null,
        ];

        return [
            !host ? h('p', { class: 'banner' }, t('only_host_settings')) : null,
            spyBlock,
            toggle('vote', t('set_vote'), t('set_vote_d')),
            toggle('guess', t('set_guess'), t('set_guess_d')),
            toggle('timer', t('set_timer'), t('set_timer_d'), stepper('timer_min', t('minutes'), 1, 30)),
            toggle('scores', t('set_scores'), t('set_scores_d')),
            toggle('spy_list', t('set_list'), t('set_list_d')),
            toggle('spy_hint', t('set_hint'), t('set_hint_d')),
            toggle('no_repeat', t('set_norepeat'), t('set_norepeat_d'), stepper('no_repeat_n', t('rounds'), 1, 15)),
            toggle('family', t('set_family'), t('set_family_d')),
            packs,
            toggle('custom', t('set_custom'), t('set_custom_d'), customEditor),
            state && state.round && state.round.status === 'play' ? h('p', { class: 'muted small' }, t('settings_next_round')) : null,
        ];
    }

    // ---------- boot ----------
    async function boot() {
        document.documentElement.lang = lang;
        try {
            LOC = await (await fetch('../assets/spia/locations.json', { cache: 'no-cache' })).json();
            store.set('spia_loc_cache', LOC);
        } catch (e) {
            LOC = store.get('spia_loc_cache', LOC);
        }
        LOC.locations.forEach((l) => { locById[l.id] = l; });
        Local.setData(LOC);

        if (mode === 'local' && !Local.active()) mode = null;
        if (mode === 'online' && !token) mode = null;
        if (!store.get('spia_intro_done')) ui.sheet = 'intro';

        scheduleRender(true);
        const session = await loadSession();
        if (mode) poll();

        if (session && session.is_admin) {
            const s = document.createElement('script');
            s.src = API + '?action=ext';
            document.body.appendChild(s);
        }
    }

    document.addEventListener('visibilitychange', () => { if (!document.hidden && mode) poll(); keepAwake(); });
    window.addEventListener('online', () => { if (mode) poll(); });
    setInterval(updateTimers, 1000);

    // Small read-only surface for optional extensions
    window.SpiaApp = {
        get state() { return state; },
        get lang() { return lang; },
        t, h, locName, roleName, catName, toast,
        refresh: () => poll(),
        rerender: () => scheduleRender(true),
        api: (method, body, query) => api(method, body, query),
    };

    boot();
})();
