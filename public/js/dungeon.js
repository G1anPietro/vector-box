// js/dungeon.js — the page of "Il Dungeon del Server": drawing, touch and keyboard, saving. The rules are in js/rogue/*.js.
// Everything the player can type or that comes from the game goes in with textContent (never innerHTML).
(function () {
    'use strict';
    const R = self.Rogue, G = R.game, SP = R.sprites, MAP = R.map, W = MAP.W, H = MAP.H, T = MAP.T;
    const RUN_KEY = 'vb_dg_run', META_KEY = 'vb_dg_meta', OPT_KEY = 'vb_dg_opt';
    const $ = (id) => document.getElementById(id);
    const reduce = !!(self.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

    // ── storage (it can be blocked: the game still works, it just does not remember) ──
    const store = {
        get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
        set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* full or blocked */ } },
        del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
    };
    function readJson(k, fallback) { try { const v = JSON.parse(store.get(k)); return v && typeof v === 'object' ? v : fallback; } catch (e) { return fallback; } }
    let meta = G.fixMeta(readJson(META_KEY, {}));
    const opt = Object.assign({ sound: false, scan: false, controls: 'touch', zoom: 1, slots: [null, null, null, null] }, readJson(OPT_KEY, {}));
    if (!Array.isArray(opt.slots) || opt.slots.length !== 4) opt.slots = [null, null, null, null];
    if (opt.controls !== 'dpad') opt.controls = 'touch';
    const saveMeta = () => store.set(META_KEY, JSON.stringify(meta));
    const saveOpt = () => store.set(OPT_KEY, JSON.stringify(opt));

    let s = null;               // the run
    let selected = null;        // class chosen on the title screen
    let travel = null;          // a walk in progress
    let view = { ts: 24, vw: 13, vh: 13 };
    let pan = null;             // camera dragged by the finger: { ox, oy } in tiles; null = follow the hero
    let aim = null;             // targeting a throwable: { k, slot }
    let flash = null;           // a tapped tile, briefly highlighted
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    // ── sound: tiny blips, off unless the player turns it on ──
    let actx = null;
    function blip(freq, ms, type) {
        if (!opt.sound) return;
        try {
            actx = actx || new (self.AudioContext || self.webkitAudioContext)();
            const o = actx.createOscillator(), g = actx.createGain();
            o.type = type || 'square'; o.frequency.value = freq; g.gain.value = 0.04;
            o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + ms / 1000);
        } catch (e) { /* no audio */ }
    }
    const SOUND = { hit: [220, 60], kill: [440, 90], hurt: [110, 120, 'sawtooth'], pick: [660, 50], level: [880, 160], stairs: [330, 120] };

    // ── sprites: 8x8 text pictures painted once per colour ──
    const sprCache = {};
    function shade(hex, f) {
        const n = parseInt(hex.slice(1), 16), c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
        return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => c(v).toString(16).padStart(2, '0')).join('');
    }
    function sprite(name, col) {
        const key = name + col;
        if (sprCache[key]) return sprCache[key];
        const rows = SP[name] || SP.blob, c = document.createElement('canvas');
        c.width = c.height = 8;
        const x = c.getContext('2d'), pal = { '#': col, '+': shade(col, 1.35), '-': shade(col, 0.6), o: '#000000', w: '#f2f2f2' };
        rows.forEach((row, y) => { for (let i = 0; i < 8; i++) { const p = pal[row[i]]; if (p) { x.fillStyle = p; x.fillRect(i, y, 1, 1); } } });
        return (sprCache[key] = c);
    }
    function icon(host, name, col, px) {
        const c = document.createElement('canvas');
        c.width = c.height = 8; c.getContext('2d').drawImage(sprite(name, col), 0, 0);
        if (px) { c.style.width = c.style.height = px + 'px'; }
        host.appendChild(c);
    }

    // ── drawing the floor ──
    const cv = $('dg-canvas'), ctx = cv.getContext('2d');
    const touchMode = () => opt.controls !== 'dpad';
    function layout() {
        // the map takes exactly the room the page leaves it (the wrapper is a flexible area between the bars and the controls),
        // in whole tiles, so nothing ever overflows the screen whatever the phone, the browser bars or the orientation
        const ts = (innerWidth >= 800 ? [20, 32, 48] : [16, 24, 36])[clamp(opt.zoom | 0, 0, 2)];
        const r = $('dg-wrap').getBoundingClientRect();
        const aw = r.width > 60 ? r.width - 4 : Math.min(innerWidth - 14, 640), ah = r.height > 60 ? r.height - 4 : innerHeight - 290;
        const vw = clamp(Math.floor(aw / ts), 5, W), vh = clamp(Math.floor(ah / ts), 5, H);
        view = { ts, vw, vh };
        cv.width = vw * ts; cv.height = vh * ts;
        cv.style.width = cv.width + 'px'; cv.style.height = cv.height + 'px';
        $('dg-stage').style.width = cv.width + 2 + 'px';
        $('dg-zin').disabled = opt.zoom >= 2; $('dg-zout').disabled = opt.zoom <= 0;
    }
    function setZoom(d) {
        const z = clamp((opt.zoom | 0) + d, 0, 2);
        if (z === opt.zoom) return;
        opt.zoom = z; saveOpt(); pan = null; layout(); if (s) render();
    }
    const idx = (x, y) => y * W + x;
    function draw() {
        if (!s) return;
        const { ts, vw, vh } = view, sec = G.sectorOf(s.depth);
        let ox = clamp(s.p.x - (vw >> 1), 0, W - vw), oy = clamp(s.p.y - (vh >> 1), 0, H - vh);
        if (pan) { ox = clamp(pan.ox, 0, W - vw); oy = clamp(pan.oy, 0, H - vh); }
        const x0 = Math.floor(ox), y0 = Math.floor(oy), x1 = Math.min(W, Math.ceil(ox + vw)), y1 = Math.min(H, Math.ceil(oy + vh));
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height);
        const cell = (x, y) => [Math.round((x - ox) * ts), Math.round((y - oy) * ts)];
        const spr = (name, col, x, y) => { const [px, py] = cell(x, y); ctx.drawImage(sprite(name, col), px, py, ts, ts); };
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
            const i = idx(x, y), seen = s.seen[i];
            if (!seen) continue;
            const t = s.map.tiles[i], [px, py] = cell(x, y), wall = t === T.WALL || t === T.SECRET;
            ctx.fillStyle = wall ? sec.wall : sec.floor; ctx.fillRect(px, py, ts, ts);
            if (wall) { ctx.fillStyle = sec.edge; ctx.fillRect(px, py, ts, 2); ctx.fillRect(px, py, 2, ts); }
            else if ((x + y) % 2 === 0) { ctx.fillStyle = sec.dot; ctx.fillRect(px + (ts >> 1) - 1, py + (ts >> 1) - 1, 2, 2); }
            if (t === T.STAIRS) spr('stairs', '#00ff66', x, y);
            else if (t === T.DOOR) spr('door', '#b98a55', x, y);
            else if (t === T.ALTAR) spr('altar', '#00e5ff', x, y);
            else if (t === T.SHOP) spr('shop', '#ffb000', x, y);
            else if (t === T.BENCH) spr('bench', '#b98a55', x, y);
        }
        for (const t of s.traps) if (t.found && s.seen[idx(t.x, t.y)]) spr('trap', '#ff5e5e', t.x, t.y);
        for (const e of s.items) if (s.seen[idx(e.x, e.y)]) { const l = G.itemLook(s, e.it); spr(l.shape, l.col, e.x, e.y); }
        for (const m of s.mobs) {
            if (!G.shown(s, m) || m.x < x0 || m.y < y0 || m.x >= x1 || m.y >= y1) continue;
            const d = G.MOB[m.k], boss = !!d.boss;
            spr(d.shape, m.asleep ? shade(d.col, 0.55) : d.col, m.x, m.y);
            if (m.hp < m.max || boss) {
                const [px, py] = cell(m.x, m.y);
                ctx.fillStyle = '#000'; ctx.fillRect(px + 2, py + ts - 5, ts - 4, 4);
                ctx.fillStyle = '#ff4d4d'; ctx.fillRect(px + 3, py + ts - 4, Math.max(1, (ts - 6) * m.hp / m.max), 2);
            }
        }
        spr('hero', G.CLASS[s.cls].col, s.p.x, s.p.y);
        // what you remember but cannot see now is dimmed
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
            const i = idx(x, y);
            if (s.seen[i] && !s.vis[i]) { const [px, py] = cell(x, y); ctx.fillRect(px, py, ts, ts); }
        }
        // feedback: the throwing range, the path being walked (faint dots) and the target tile
        if (aim) {
            ctx.fillStyle = 'rgba(255,176,0,.16)';
            for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
                if (s.vis[idx(x, y)] && Math.max(Math.abs(x - s.p.x), Math.abs(y - s.p.y)) <= G.THROW_RANGE) { const [px, py] = cell(x, y); ctx.fillRect(px, py, ts, ts); }
            }
        }
        const tg = travel && travel.target ? travel.target() : flash;
        if (tg) {
            ctx.fillStyle = 'rgba(0,255,102,.5)';
            if (travel && travel.target) for (const [x, y] of G.travelPath(s, tg[0], tg[1]).slice(0, -1)) { const [px, py] = cell(x, y); ctx.beginPath(); ctx.arc(px + ts / 2, py + ts / 2, Math.max(2, ts / 9), 0, 6.3); ctx.fill(); }
            const [px, py] = cell(tg[0], tg[1]);
            ctx.strokeStyle = 'rgba(0,255,102,.9)'; ctx.lineWidth = 2; ctx.strokeRect(px + 1, py + 1, ts - 2, ts - 2);
        }
        cv._cam = { ox, oy };
    }

    // ── the HUD, the log, the buttons ──
    function hud() {
        const p = s.p, st = G.stats(s), sec = G.sectorOf(s.depth);
        $('dg-hp').style.width = Math.max(0, 100 * p.hp / p.maxHp) + '%';
        $('dg-hptxt').textContent = 'PS ' + p.hp + '/' + p.maxHp;
        $('dg-fd').style.width = (100 * p.food / G.MAX_FOOD) + '%';
        $('dg-fdtxt').textContent = p.food < 150 ? 'Fame!' : 'Fame';
        const status = Object.keys(p.st).map((k) => ({ poison: 'veleno', haste: 'veloce', conf: 'confuso', invis: 'invisibile', regen: 'recupero', weak: 'debole', stun: 'bloccato', ping: 'ping' }[k] || k)).join(', ');
        const info = $('dg-info');
        info.textContent = '';
        const add = (t, b) => { const e = document.createElement(b ? 'b' : 'span'); e.textContent = t; info.appendChild(e); };
        add(s.hub ? 'Sala Server' : 'P' + s.depth + ' ' + sec.name, true); add('Lv ' + p.lvl + ' (' + p.xp + '/' + G.xpNeed(p.lvl) + ')'); add(p.gold + ' cr');
        add('Atk ' + st.atk + ' Dif ' + st.def);
        if (status) add(status);
        const sk = $('dg-skill'), a = G.CLASS[s.cls].active;
        sk.textContent = p.cd > 0 ? a.name + ' (' + p.cd + ')' : a.name;
        sk.classList.toggle('ready', p.cd <= 0);
        const lg = $('dg-log');
        lg.textContent = '';
        for (const l of s.log.slice(-4)) { const d = document.createElement('div'); d.textContent = l.t; if (l.c) d.className = 'c-' + l.c; lg.appendChild(d); }
    }
    function render() { draw(); hud(); slots(); }

    // ── the four quickslots: each holds an item kind; tap uses it (or aims it), long press chooses what lives there ──
    const SLOT_CATS = ['drink', 'script', 'usb', 'food', 'throw'];
    const invOf = (k) => s.p.inv.find((it) => it.k === k);
    function slots() {
        if (!s) return;
        let dirty = false;
        opt.slots.forEach((k, j) => {
            if (k === '' || (k && invOf(k))) return;
            const c = s.p.inv.find((it) => SLOT_CATS.includes(G.ITEM[it.k].cat) && !opt.slots.includes(it.k));
            if (c) { opt.slots[j] = c.k; dirty = true; }
        });
        if (dirty) saveOpt();
        document.querySelectorAll('.dg-slot').forEach((b, j) => {
            const k = opt.slots[j], it = k ? invOf(k) : null;
            b.textContent = '';
            b.classList.toggle('empty', !it);
            b.classList.toggle('aiming', !!aim && aim.slot === j);
            if (!it) { b.setAttribute('aria-label', 'Slot rapido ' + (j + 1) + ': vuoto'); return; }
            const l = G.itemLook(s, it), n = s.p.inv.filter((o) => o.k === k).reduce((a, o) => a + (o.n || 1), 0), c = G.ITEM[k].cat === 'usb' ? it.ch : n;
            icon(b, l.shape, l.col, 28);
            if (c > 1 || G.ITEM[k].cat === 'usb') el('b', String(c), '', b);
            b.setAttribute('aria-label', 'Slot rapido ' + (j + 1) + ': ' + G.itemName(s, it));
        });
    }
    function slotPicker(j) {
        endAim();
        const body = openModal('Slot rapido ' + (j + 1), 'slot');
        const put = (k) => { const o = opt.slots.indexOf(k); if (k && o >= 0 && o !== j) opt.slots[o] = opt.slots[j]; opt.slots[j] = k; saveOpt(); $('dg-modal').hidden = true; modalKind = ''; render(); };
        btn('Vuoto', () => put(''), body, 'dg-choice');
        const seen = new Set();
        for (const it of s.p.inv) {
            if (seen.has(it.k)) continue;
            seen.add(it.k);
            const r = el('div', '', 'dg-item', body), l = G.itemLook(s, it);
            icon(r, l.shape, l.col, 32);
            const t2 = el('div', '', 't', r); el('span', G.itemName(s, it), '', t2); el('small', G.itemInfo(s, it), '', t2);
            btn('Qui', () => put(it.k), r);
        }
        if (!seen.size) el('p', 'Lo zaino è vuoto.', '', body);
    }
    function useSlot(j) {
        if (!s || s.status !== 'play' || !$('dg-modal').hidden) return;
        const was = aim && aim.slot === j;
        stopTravel(); endAim(); travelTurn = s.turn;
        if (was) return render();
        const k = opt.slots[j], it = k && G.slotIntent(s, k);
        if (!it || it.type === 'none') return slotPicker(j);
        if (it.type === 'use') return act({ t: 'use', i: it.i });
        aim = { k, slot: j }; $('dg-stage').classList.add('aiming');
        note('Tocca la casella dove lanciare (portata ' + G.THROW_RANGE + ').', 'info');
    }
    function endAim() { if (!aim) return; aim = null; $('dg-stage').classList.remove('aiming'); if (s) render(); }
    function showCard(it, x, y) {
        const c = $('dg-card');
        c.textContent = '';
        el('b', it.title, '', c);
        for (const l of it.lines) el('div', l, '', c);
        const lower = cv._cam && (y - cv._cam.oy) * view.ts > cv.height / 2;
        c.style.top = lower ? '6px' : 'auto'; c.style.bottom = lower ? 'auto' : '6px';
        c.hidden = false;
    }
    const hideCard = () => { $('dg-card').hidden = true; };

    // ── modal sheets ──
    let modalKind = '';
    function openModal(title, kind) { $('dg-mtitle').textContent = title; $('dg-mbody').textContent = ''; $('dg-modal').hidden = false; modalKind = kind || ''; return $('dg-mbody'); }
    function closeModal() { $('dg-modal').hidden = true; modalKind = ''; if (s && ((s.shop && s.shop.open) || (s.bench && s.bench.open))) act({ t: 'leave' }); }
    function el(tag, text, cls, host) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; if (host) host.appendChild(e); return e; }
    function btn(label, fn, host, cls) { const b = el('button', label, cls, host); b.type = 'button'; b.addEventListener('click', fn); return b; }

    function bagModal() {
        const body = openModal('Zaino', 'bag'), p = s.p;
        const row = (it, sub, buttons) => {
            const r = el('div', '', 'dg-item', body), l = G.itemLook(s, it);
            icon(r, l.shape, l.col, 32);
            const t = el('div', '', 't', r); el('span', G.itemName(s, it), '', t); el('small', sub, '', t);
            for (const [label, fn] of buttons) btn(label, fn, r);
        };
        el('h2', 'Addosso', '', body);
        for (const slot of ['weapon', 'armor', 'plugin']) {
            if (p[slot]) row(p[slot], G.itemInfo(s, p[slot]), [['Togli', () => { closeModal(); act({ t: 'unequip', slot }); }]]);
        }
        if (!p.weapon && !p.armor && !p.plugin) el('p', 'Niente.', '', body);
        el('h2', 'Nello zaino (' + p.inv.length + '/' + G.INV_CAP + ')', '', body);
        if (!p.inv.length) el('p', 'Vuoto.', '', body);
        p.inv.forEach((it, i) => {
            const d = G.ITEM[it.k], eq = !!R.items.CATS[d.cat].slot;
            const label = eq ? 'Equip.' : d.cat === 'food' ? 'Mangia' : d.cat === 'usb' ? 'Usa' : d.cat === 'drink' ? 'Bevi' : d.cat === 'throw' ? 'Lancia' : 'Leggi';
            const go = () => { closeModal(); if (d.cat === 'throw') { aim = { k: it.k, slot: opt.slots.indexOf(it.k) }; $('dg-stage').classList.add('aiming'); note('Tocca la casella dove lanciare (portata ' + G.THROW_RANGE + ').', 'info'); } else act({ t: 'use', i }); };
            row(it, G.itemInfo(s, it), [[label, go], ['Getta', () => { closeModal(); act({ t: 'drop', i }); }]]);
        });
    }
    function levelModal() {
        const body = openModal('Livello ' + s.p.lvl + ': scegli', 'level');
        $('dg-mclose').hidden = true;
        for (const id of s.p.choices) {
            const k = G.SKILL[id], b = btn(k.name, () => { $('dg-mclose').hidden = false; $('dg-modal').hidden = true; modalKind = ''; act({ t: 'skill', id }); }, body, 'dg-choice');
            el('small', k.info, '', b);
        }
    }
    function shopModal() {
        const body = openModal('Negozio — ' + s.p.gold + ' crediti', 'shop');
        if (!s.shop.stock.length) el('p', 'Hanno venduto tutto.', '', body);
        s.shop.stock.forEach((it, i) => {
            const r = el('div', '', 'dg-item', body), l = G.itemLook(s, it);
            icon(r, l.shape, l.col, 32);
            const t = el('div', '', 't', r); el('span', G.itemName(s, it), '', t); el('small', G.itemInfo(s, it), '', t);
            const b = btn(G.price(s, it) + ' cr', () => { act({ t: 'buy', i }); }, r); b.disabled = s.p.gold < G.price(s, it);
        });
    }
    function benchModal() {
        const body = openModal('Panchina', 'bench');
        btn('Riposa: cura tutto e ricarica l’abilità', () => { act({ t: 'rest' }); }, body, 'dg-choice');
        el('h2', 'Ricicla (metà del prezzo in crediti)', '', body);
        if (!s.p.inv.length) el('p', 'Lo zaino è vuoto.', '', body);
        s.p.inv.forEach((it, i) => {
            const r = el('div', '', 'dg-item', body), l = G.itemLook(s, it);
            icon(r, l.shape, l.col, 32);
            const t = el('div', '', 't', r); el('span', G.itemName(s, it), '', t); el('small', 'Ne ricavi ' + Math.max(1, Math.round(G.ITEM[it.k].price / 2)) + ' cr', '', t);
            btn('Ricicla', () => act({ t: 'recycle', i }), r);
        });
    }
    function logModal() {
        const body = openModal('Registro', 'log'), box = el('div', '', 'dg-logfull', body);
        for (const l of s.log) el('div', l.t, l.c ? 'c-' + l.c : '', box);
    }
    function endModal() {
        meta = G.recordRun(meta, s, new Date().toISOString().slice(0, 10)); saveMeta(); store.del(RUN_KEY);
        const won = s.status === 'won', body = openModal(won ? 'Hai vinto!' : 'Partita finita', 'end');
        $('dg-mclose').hidden = true;
        el('p', won ? 'Il server è tuo.' : 'Sconfitto da ' + s.cause + ' al piano ' + s.depth + '.');
        el('p', 'Livello ' + s.p.lvl + ', ' + s.kills + ' nemici, ' + s.turn + ' turni, ' + s.earned + ' crediti trovati.');
        const last = meta.history[0];
        if (last) el('p', 'Crediti guadagnati per il futuro: +' + last.crediti, 'c-info');
        for (const id of s.medals || []) el('p', 'Nuova medaglia: ' + G.MEDALS.find((d) => d.id === id).name, 'c-good');
        btn('Torna al menu', () => { $('dg-mclose').hidden = false; $('dg-modal').hidden = true; modalKind = ''; s = null; showTitle(); }, body, 'dg-big');
    }
    // ── the archive: upgrade tree, medals, bestiary, history ──
    function archiveModal(tab) {
        tab = tab || 'tree';
        const body = openModal('Archivio — ' + meta.crediti + ' crediti', 'archive'), bar = el('div', '', 'dg-row', body);
        for (const [id, label] of [['tree', 'Albero'], ['medals', 'Medaglie'], ['dex', 'Bestiario'], ['hist', 'Storia']]) {
            const b = btn(label, () => archiveModal(id), bar); b.setAttribute('aria-pressed', String(id === tab));
        }
        if (tab === 'tree') {
            el('p', 'Ogni potenziamento vale per tutte le partite future.', '', body);
            for (const u of G.UPGRADES) {
                const lv = G.level(meta, u.id), r = el('div', '', 'dg-item', body), t = el('div', '', 't', r);
                el('span', u.name + '  ' + lv + '/' + u.max, '', t); el('small', u.info, '', t);
                const full = lv >= u.max, cost = full ? 0 : G.upCost(meta, u.id);
                const b = btn(full ? 'Max' : cost + ' cr', () => { if (G.buyUpgrade(meta, u.id)) { saveMeta(); blip(660, 60); archiveModal('tree'); } }, r);
                b.disabled = full || meta.crediti < cost;
            }
        } else if (tab === 'medals') {
            const got = new Set(meta.medals);
            el('p', got.size + ' di ' + G.MEDALS.length + ' medaglie.', '', body);
            for (const d of G.MEDALS) { const r = el('div', '', 'dg-item', body), t = el('div', '', 't', r); el('span', (got.has(d.id) ? '[x] ' : '[ ] ') + d.name, got.has(d.id) ? 'c-good' : '', t); el('small', d.info, '', t); }
        } else if (tab === 'dex') {
            const all = R.mobs.LIST, met = all.filter((d) => meta.codex[d.id]).length;
            el('p', 'Nemici incontrati: ' + met + ' di ' + all.length + '.', '', body);
            for (const d of all) {
                const e = meta.codex[d.id], r = el('div', '', 'dg-item', body), t = el('div', '', 't', r);
                icon(r, d.shape, e ? d.col : '#2a3a30', 32); r.appendChild(t);
                el('span', e ? d.name : '???', '', t);
                el('small', e ? d.info + ' (visto ' + e.seen + ', eliminato ' + e.kills + ')' : 'Non l’hai ancora incontrato.', '', t);
            }
        } else {
            if (!meta.history.length) el('p', 'Nessuna partita finita.', '', body);
            for (const h of meta.history) {
                const r = el('div', '', 'dg-item', body), t = el('div', '', 't', r);
                el('span', (h.won ? 'VITTORIA ' : '') + (G.CLASS[h.cls] ? G.CLASS[h.cls].name : h.cls) + ' — piano ' + h.depth + ', liv ' + h.lvl, h.won ? 'c-good' : '', t);
                el('small', (h.date || '') + (h.daily ? ' sfida del giorno' : '') + (h.tier ? ' accesso ' + h.tier : '') + ' · ' + h.kills + ' nemici, ' + h.turns + ' turni' + (h.won ? '' : ' · ' + h.cause) + ' · +' + h.crediti + ' cr', '', t);
            }
        }
    }

    function menuModal() {
        const body = openModal('Menu', 'menu');
        btn('Come si gioca', helpModal, body, 'dg-choice');
        const snd = btn('Suono: ' + (opt.sound ? 'sì' : 'no'), () => { opt.sound = !opt.sound; saveOpt(); snd.textContent = 'Suono: ' + (opt.sound ? 'sì' : 'no'); blip(660, 80); }, body, 'dg-choice');
        const sc = btn('Linee CRT: ' + (opt.scan ? 'sì' : 'no'), () => { opt.scan = !opt.scan; saveOpt(); applyOpt(); sc.textContent = 'Linee CRT: ' + (opt.scan ? 'sì' : 'no'); }, body, 'dg-choice');
        const ct = btn('', () => { opt.controls = touchMode() ? 'dpad' : 'touch'; saveOpt(); ct.textContent = ctl(); endAim(); applyOpt(); if (s) render(); }, body, 'dg-choice');
        const ctl = () => 'Comandi: ' + (touchMode() ? 'Tocco (come Pixel Dungeon)' : 'Croce direzionale');
        ct.textContent = ctl();
        if (s) btn('Registro completo', logModal, body, 'dg-choice');
        if (s) btn('Abbandona la partita', () => {
            if (!confirm('Abbandonare la partita? Si perde tutto.')) return;
            s.status = 'dead'; s.cause = 'la resa'; closeModal(); endModal();
        }, body, 'dg-choice');
    }
    function helpModal() {
        const body = openModal('Come si gioca', 'help');
        for (const t of [
            'Tocco: tocca una casella per camminarci (ti fermi se compare un nemico), un nemico per attaccarlo, un oggetto per raccoglierlo, le scale per scendere. Tocca te stesso per aspettare un turno, doppio tocco per cercare porte segrete e trappole. Tieni premuto su qualcosa per leggerne la scheda senza agire. Trascina per spostare la vista, pizzica o usa + e − per lo zoom.',
            'Barra in basso: Aspetta, Cerca, Zaino e 4 slot rapidi: tocca per usare un oggetto (i dardi si lanciano: poi tocca la casella). Tieni premuto uno slot per scegliere cosa ci sta. Nelle opzioni puoi tornare alla croce direzionale.',
            'Camminare su un nemico lo attacca. Ogni passo è un turno: il gioco salva da solo e riprendi da dove eri anche dopo aver chiuso la scheda.',
            'Raccogli oggetti camminandoci sopra. Lattine, script e chiavette sono sconosciuti finché non li provi: usa il Zaino.',
            'Esplora cammina verso la prossima cosa da scoprire. Scale scende se sei sulle scale (o ci cammina).',
            'Ogni 5 piani c’è un boss: le scale restano bloccate finché non lo batti.',
            'Tastiera: frecce o WASD, spazio aspetta, C cerca, 1-4 slot rapidi, I zaino, E esplora, F abilità, > scale, B nascondi lo schermo.',
        ]) el('p', t, '', body);
    }

    // ── playing ──
    function persist() { if (s && s.status === 'play') store.set(RUN_KEY, G.save(s)); }
    function afterTurn() {
        if (s.fx.some((f) => f.t === 'hit' || f.t === 'miss' || f.t === 'kill')) { try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) { /* no haptics */ } }
        for (const f of s.fx) { const b = SOUND[f.t]; if (b) blip(b[0], b[1], b[2]); if (f.t === 'hurt' && !reduce) { const st = $('dg-stage'); st.classList.add('hurt'); setTimeout(() => st.classList.remove('hurt'), 160); } }
        persist(); render();
        if (s.status !== 'play') { stopTravel(); endAim(); endModal(); }
        else if (s.p.pending && modalKind !== 'level') levelModal();
        else if (s.shop && s.shop.open) shopModal();
        else if (s.bench && s.bench.open) benchModal();
    }
    function act(a) {
        if (!s || s.status !== 'play') return false;
        pan = null; flash = null;
        const logLen = s.log.length, took = G.act(s, a);
        act.lastBad = s.log.slice(logLen).some((l) => l.c === 'bad');
        afterTurn();
        return took;
    }
    function note(text, c) { s.log.push({ t: text, c }); persist(); render(); }
    function stopTravel() { if (travel) { clearTimeout(travel.timer); const had = !!travel.target; travel = null; if (had && s) draw(); } }
    /** Walks by itself: `next()` gives the next step (null = arrived or no way). Stops when a new enemy shows up, something bad happens or there is no way.
     *  o.target() = the cell to highlight; o.fin() runs when `next()` says there is nothing more to do; o.fight = an enemy is already the goal, so it does not stop the walk. */
    function startTravel(next, limit, o) {
        stopTravel();
        o = o || {};
        const t = travel = { timer: 0, n: 0, hp: s.p.hp, depth: s.depth, target: o.target, th0: G.threats(s).length };
        const seen = () => o.fight ? G.threats(s).length > t.th0 : G.threats(s).length > 0;
        const step = () => {
            if (travel !== t || !s || s.status !== 'play' || document.hidden) return stopTravel();
            if (t.n++ >= (limit || 80) || s.p.pending || (s.shop && s.shop.open) || s.depth !== t.depth) return stopTravel();
            if (t.n > 1 && seen()) return stopTravel();
            const v = next();
            if (!v) { stopTravel(); if (o.fin) o.fin(); return; }
            act({ t: 'move', dx: v[0], dy: v[1] });
            if (s.p.hp < t.hp || act.lastBad || s.depth !== t.depth) return stopTravel();
            if (seen()) return stopTravel();
            t.timer = setTimeout(step, reduce ? 0 : 55);
        };
        step();
    }
    /** Walks to a cell, then runs `fin` there. With an enemy in view it only takes one step per tap. */
    function goTo(tx, ty, fin) {
        const here = () => s.p.x === tx && s.p.y === ty;
        if (here()) return fin && fin();
        if (G.threats(s).length) { const v = G.travelNext(s, tx, ty); if (v) act({ t: 'move', dx: v[0], dy: v[1] }); return; }
        startTravel(() => here() ? null : G.travelNext(s, tx, ty), 80, { target: () => [tx, ty], fin: () => { if (here() && fin) fin(); } });
    }
    function attackMob(id) {
        const mob = () => s.mobs.find((m) => m.id === id), adj = (m) => Math.abs(m.x - s.p.x) + Math.abs(m.y - s.p.y) === 1;
        const hit = () => { const m = mob(); if (m && adj(m)) act({ t: 'move', dx: m.x - s.p.x, dy: m.y - s.p.y }); };
        const m0 = mob();
        if (!m0) return;
        if (adj(m0)) return hit();
        if (!G.travelNext(s, m0.x, m0.y)) return note('Non riesci a raggiungerlo.', 'info');
        startTravel(() => { const m = mob(); return !m || adj(m) ? null : G.travelNext(s, m.x, m.y); }, 60, { fight: true, target: () => { const m = mob(); return m ? [m.x, m.y] : null; }, fin: hit });
    }
    let travelTurn = 0;
    function explore() {
        if (G.threats(s).length) { return note('Ci sono nemici in vista.', 'bad'); }
        startTravel(() => G.exploreNext(s), 200);
        if (!travel && s.turn === travelTurn) { return note('Non c’è altro da scoprire qui: cerca le scale.', 'info'); }
    }
    function stairs() {
        const here = s.map.tiles[idx(s.p.x, s.p.y)] === T.STAIRS;
        if (here) return act({ t: 'descend' });
        const st = s.map.stairs;
        if (!s.seen[idx(st.x, st.y)]) { return note('Non hai ancora trovato le scale.', 'info'); }
        startTravel(() => (s.p.x === st.x && s.p.y === st.y) ? null : G.travelNext(s, st.x, st.y), 120);
    }
    function useFirst(test, msg) {
        const i = s.p.inv.findIndex(test);
        if (i < 0) return note(msg, 'info');
        act({ t: 'use', i });
    }
    function command(name) {
        if (!s || s.status !== 'play' || !$('dg-modal').hidden) return;
        stopTravel();
        travelTurn = s.turn;
        endAim();
        if (name === 'wait') act({ t: 'wait' });
        else if (name === 'search') act({ t: 'search' });
        else if (name === 'bag') bagModal();
        else if (name === 'skill') act({ t: 'active' });
        else if (name === 'explore') explore();
        else if (name === 'stairs') stairs();
        else if (name === 'eat') useFirst((it) => G.ITEM[it.k].cat === 'food', 'Non hai niente da mangiare.');
        else if (name === 'heal') useFirst((it) => G.ITEM[it.k].cat === 'drink' && G.known(s, it) && G.ITEM[it.k].effect === 'heal', 'Non hai lattine curative che conosci.');
    }
    function step(dx, dy) { if (s && s.status === 'play' && $('dg-modal').hidden) { stopTravel(); endAim(); act({ t: 'move', dx, dy }); } }

    // ── input ──
    for (const b of document.querySelectorAll('[data-d]')) b.addEventListener('click', () => { const [dx, dy] = b.dataset.d.split(',').map(Number); step(dx, dy); });
    for (const b of document.querySelectorAll('[data-a]')) b.addEventListener('click', () => command(b.dataset.a));
    $('dg-log').addEventListener('click', () => { if (s) logModal(); });
    $('dg-menu').addEventListener('click', menuModal);
    $('dg-mclose').addEventListener('click', closeModal);
    $('dg-hide').addEventListener('click', () => { stopTravel(); $('dg-cover').hidden = false; });
    $('dg-cover').addEventListener('click', () => { $('dg-cover').hidden = true; });
    // ── touch on the map, like Pixel Dungeon: tap = go / attack / pick up / use, tap yourself = rest, double tap (or hold) yourself = search,
    //    hold anything else = info card, drag = pan the view, pinch = zoom. What a touch means is decided by G.intentForTap (rules, tested). ──
    const LONG_MS = 400, SLOP = 10;
    const ptrs = new Map();
    let g = null, longTimer = 0, pinch = null, swallow = false, pendingHero = 0;
    const tileAt = (px, py) => {
        const r = cv.getBoundingClientRect(), sc = cv.width / r.width, cam = cv._cam || { ox: 0, oy: 0 };
        return [Math.floor(cam.ox + ((px - r.left) * sc) / view.ts), Math.floor(cam.oy + ((py - r.top) * sc) / view.ts)];
    };
    const canPlay = () => s && s.status === 'play' && $('dg-modal').hidden;
    function doIntent(it) {
        if (!canPlay()) return;
        stopTravel();
        switch (it.type) {
            case 'rest': return act({ t: 'wait' });
            case 'search': return act({ t: 'search' });
            case 'throw': endAim(); return act({ t: 'throw', i: it.i, x: it.x, y: it.y });
            case 'cancel': return endAim();
            case 'walk': case 'pickup': return goTo(it.x, it.y);
            case 'attack': return attackMob(it.id);
            case 'use':
                if (it.what === 'stairs') return goTo(it.x, it.y, () => act({ t: 'descend' }));
                return goTo(it.via[0], it.via[1], () => act({ t: 'move', dx: Math.sign(it.x - s.p.x), dy: Math.sign(it.y - s.p.y) }));
        }
    }
    function intentAt(x, y, kind) {
        const ai = aim ? s.p.inv.findIndex((o) => o.k === aim.k) : null;
        return G.intentForTap(s, x, y, kind, ai);
    }
    function tapAt(x, y) {
        if (!canPlay() || x < 0 || y < 0 || x >= W || y >= H) return;
        if (pendingHero) { clearTimeout(pendingHero.t); const p0 = pendingHero; pendingHero = 0; if (x === s.p.x && y === s.p.y) return doIntent(intentAt(x, y, 'double')); doIntent(p0.it); }
        const it = intentAt(x, y, 'tap');
        if (it.type === 'rest') { pendingHero = { it, t: setTimeout(() => { pendingHero = 0; doIntent(it); }, 280) }; return; }   // wait: it may be a double tap
        if (it.type === 'none') { flash = [x, y]; draw(); setTimeout(() => { flash = null; if (s) draw(); }, 200); }
        doIntent(it);
    }
    function longPress() {
        if (!g || g.moved || g.multi || !canPlay()) return;
        g.long = true;
        const [x, y] = tileAt(g.x0, g.y0);
        if (x < 0 || y < 0 || x >= W || y >= H) return;
        const it = intentAt(x, y, 'long');
        if (it.type === 'info') { stopTravel(); showCard(it, x, y); } else doIntent(it);
    }
    document.addEventListener('pointerdown', (e) => { if (!$('dg-card').hidden) { hideCard(); swallow = e.target === cv; } }, true);
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
        try { cv.setPointerCapture(e.pointerId); } catch (x) { /* not capturable */ }
        ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (ptrs.size === 1) {
            const cam = cv._cam || { ox: 0, oy: 0 };
            g = { x0: e.clientX, y0: e.clientY, moved: false, long: false, multi: false, swallow, ox: cam.ox, oy: cam.oy };
            swallow = false;
            clearTimeout(longTimer); longTimer = setTimeout(longPress, LONG_MS);
        } else if (g) {
            g.multi = true; clearTimeout(longTimer);
            const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        }
    });
    cv.addEventListener('pointermove', (e) => {
        const p = ptrs.get(e.pointerId);
        if (!p || !g) return;
        p.x = e.clientX; p.y = e.clientY;
        if (g.multi) {
            if (ptrs.size < 2) return;
            const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
            if (d / pinch > 1.3) { setZoom(1); pinch = d; } else if (d / pinch < 0.77) { setZoom(-1); pinch = d; }
            return;
        }
        const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
        if (!g.moved && Math.hypot(dx, dy) > SLOP) { g.moved = true; clearTimeout(longTimer); stopTravel(); }
        if (g.moved && canPlay() && !g.long) { pan = { ox: g.ox - dx / view.ts, oy: g.oy - dy / view.ts }; draw(); }
    });
    cv.addEventListener('pointerup', (e) => {
        if (!ptrs.delete(e.pointerId) || ptrs.size > 0 || !g) return;
        clearTimeout(longTimer);
        const gg = g; g = null;
        if (gg.multi || gg.moved || gg.long || gg.swallow) return;
        const [x, y] = tileAt(e.clientX, e.clientY);
        tapAt(x, y);
    });
    cv.addEventListener('pointercancel', (e) => { ptrs.delete(e.pointerId); if (!ptrs.size) { clearTimeout(longTimer); g = null; } });
    $('dg-zin').addEventListener('click', () => setZoom(1));
    $('dg-zout').addEventListener('click', () => setZoom(-1));
    // quickslots: tap = use / aim, hold = choose the item
    document.querySelectorAll('.dg-slot').forEach((b) => {
        let timer = 0, held = false;
        const j = Number(b.dataset.slot);
        b.addEventListener('contextmenu', (e) => e.preventDefault());
        b.addEventListener('pointerdown', () => { held = false; clearTimeout(timer); timer = setTimeout(() => { held = true; if (canPlay()) slotPicker(j); }, LONG_MS); });
        for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => clearTimeout(timer));
        b.addEventListener('click', () => { if (held) { held = false; return; } useSlot(j); });
    });
    addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (!$('dg-cover').hidden) { $('dg-cover').hidden = true; return; }
        const k = e.key;
        if (k === 'b' || k === 'B') { stopTravel(); $('dg-cover').hidden = false; return; }
        if (k === 'Escape') { if (aim) endAim(); else if (!$('dg-modal').hidden && modalKind !== 'level' && modalKind !== 'end') closeModal(); else stopTravel(); return; }
        if (!s || s.status !== 'play' || !$('dg-modal').hidden) return;
        const dirs = { ArrowUp: [0, -1], w: [0, -1], W: [0, -1], ArrowDown: [0, 1], s: [0, 1], S: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0], ArrowRight: [1, 0], d: [1, 0], D: [1, 0] };
        if (dirs[k]) { e.preventDefault(); step(dirs[k][0], dirs[k][1]); }
        else if (k === ' ' || k === '.') { e.preventDefault(); command('wait'); }
        else if (k === 'i' || k === 'I') command('bag');
        else if (k === 'c' || k === 'C') command('search');
        else if (k >= '1' && k <= '4') useSlot(Number(k) - 1);
        else if (k === 'e' || k === 'E') command('explore');
        else if (k === 'f' || k === 'F') command('skill');
        else if (k === '>' || k === 'Enter') command('stairs');
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopTravel(); });
    let rt = 0;
    const relayout = () => { clearTimeout(rt); rt = setTimeout(() => { layout(); if (s) render(); }, 80); };
    addEventListener('resize', relayout);
    addEventListener('orientationchange', relayout);
    if (self.visualViewport) visualViewport.addEventListener('resize', relayout);    // the browser's address bar appearing or hiding

    // ── full screen ──
    const root = document.documentElement;
    const fsRequest = root.requestFullscreen || root.webkitRequestFullscreen;
    const fsActive = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
    const standalone = () => (self.matchMedia && matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches) || navigator.standalone === true;
    function fullscreenHelp() {
        const body = openModal('Schermo intero', 'fullscreen');
        el('p', 'Questo browser non permette lo schermo intero a una pagina web (succede su iPhone e iPad).', '', body);
        el('p', 'Per giocare senza barre: apri il menu Condividi di Safari, scegli «Aggiungi alla schermata Home» e avvia il gioco da quell\'icona. Si apre a tutto schermo, e il salvataggio resta lo stesso.', '', body);
        el('p', 'Su Android, in Chrome: menu ⋮ → «Aggiungi a schermata Home» oppure «Installa app».', '', body);
    }
    function toggleFullscreen() {
        if (!fsRequest) return fullscreenHelp();
        try {
            if (fsActive()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
            else { const p = fsRequest.call(root, { navigationUI: 'hide' }); if (p && p.catch) p.catch(fullscreenHelp); }
        } catch (e) { fullscreenHelp(); }
    }
    const fsButton = $('dg-full');
    fsButton.hidden = standalone();                            // already running full screen from the home screen: nothing to ask
    fsButton.addEventListener('click', toggleFullscreen);
    const onFs = () => { document.body.classList.toggle('fs', fsActive()); fsButton.textContent = fsActive() ? '✕' : '⛶'; fsButton.setAttribute('aria-label', fsActive() ? 'Esci dallo schermo intero' : 'Schermo intero'); relayout(); };
    document.addEventListener('fullscreenchange', onFs); document.addEventListener('webkitfullscreenchange', onFs);

    // ── title screen ──
    function applyOpt() {
        $('dg-stage').classList.toggle('scan', !!opt.scan);
        $('dg-game').classList.toggle('mode-touch', touchMode()); $('dg-game').classList.toggle('mode-dpad', !touchMode());
        layout();
    }
    function showTitle() {
        $('dg-game').hidden = true; $('dg-title').hidden = false; document.body.classList.remove('ingame');
        $('dg-stats').textContent = meta.runs ? `Partite ${meta.runs} · Piano record ${meta.best} · Vittorie ${meta.wins} · Boss ${meta.bosses} · Crediti ${meta.crediti}` : 'Prima partita: buona discesa.';
        const box = $('dg-classes');
        box.textContent = '';
        for (const c of R.classes.CLASSES) {
            const open = G.unlocked(meta, c), b = el('button', '', open ? '' : 'locked', box);
            b.type = 'button'; b.setAttribute('aria-pressed', 'false');
            icon(b, 'hero', c.col); el('span', c.name, '', b);
            b.addEventListener('click', () => pick(c, b));
        }
        pick(R.classes.CLASSES[0], box.firstChild);
        tier = Math.min(tier, meta.ng); tierLabel();
        const db = meta.dailyBest[today()];
        $('dg-daily').textContent = 'Sfida del giorno' + (db ? ' (record ' + db + ')' : '');
    }
    function pick(c, b) {
        selected = c;
        for (const x of $('dg-classes').children) x.setAttribute('aria-pressed', String(x === b));
        const box = $('dg-classinfo'), open = G.unlocked(meta, c);
        box.textContent = '';
        el('b', c.name + (open ? '' : ' (bloccato)'), '', box);
        el('div', c.info, '', box);
        if (open) el('div', 'Abilità: ' + c.active.name + ' — ' + c.active.info, 'c-info', box);
        $('dg-start').disabled = !open;
    }
    let tier = 0;
    const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    function startRun(seed, daily) {
        s = G.newGame(seed, selected.id, meta, { tier: daily ? 0 : tier, daily: daily || '' });
        persist(); enterGame();
    }
    function enterGame() {
        $('dg-title').hidden = true; $('dg-game').hidden = false; document.body.classList.add('ingame');
        applyOpt(); render();
        if (s.p.pending) levelModal();
    }
    $('dg-start').addEventListener('click', () => startRun((Math.random() * 4294967296) >>> 0));
    $('dg-daily').addEventListener('click', () => { const d = today(); startRun(R.rng.hash('daily-' + d), d); });
    $('dg-archive').addEventListener('click', () => archiveModal());
    $('dg-tier').addEventListener('click', () => { tier = (tier + 1) % (meta.ng + 1); tierLabel(); });
    function tierLabel() { $('dg-tier').textContent = 'Livello di accesso: ' + tier; $('dg-tier').hidden = meta.ng < 1; }
    $('dg-help').addEventListener('click', helpModal);

    // ── boot: resume a saved run exactly where it was ──
    const saved = store.get(RUN_KEY), resumed = saved && G.load(saved);
    if (resumed && resumed.status === 'play') { s = resumed; G.updateFov(s); enterGame(); } else showTitle();
    if (!s) layout();

    // handles for the tests and for debugging in the console
    self.RogueUI = { state: () => s, act, command, render, tileAt, view: () => view };
})();
