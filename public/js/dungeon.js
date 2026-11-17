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
    const opt = Object.assign({ sound: false, scan: false }, readJson(OPT_KEY, {}));
    const saveMeta = () => store.set(META_KEY, JSON.stringify(meta));
    const saveOpt = () => store.set(OPT_KEY, JSON.stringify(opt));

    let s = null;               // the run
    let selected = null;        // class chosen on the title screen
    let travel = null;          // a walk in progress
    let view = { ts: 24, vw: 13, vh: 13 };

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
    function layout() {
        const ts = innerWidth >= 800 ? 32 : 24;
        const vw = Math.max(9, Math.min(21, Math.floor(Math.min(innerWidth - 14, 640) / ts)));
        const vh = Math.max(9, Math.min(vw + 4, Math.floor((innerHeight - 310) / ts)));
        view = { ts, vw, vh };
        cv.width = vw * ts; cv.height = vh * ts;
        cv.style.width = cv.width + 'px'; cv.style.height = cv.height + 'px';
        $('dg-stage').style.width = cv.width + 2 + 'px';
    }
    const idx = (x, y) => y * W + x;
    function draw() {
        if (!s) return;
        const { ts, vw, vh } = view, sec = G.sectorOf(s.depth);
        const ox = Math.max(0, Math.min(W - vw, s.p.x - (vw >> 1))), oy = Math.max(0, Math.min(H - vh, s.p.y - (vh >> 1)));
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height);
        const cell = (x, y) => [(x - ox) * ts, (y - oy) * ts];
        const spr = (name, col, x, y) => { const [px, py] = cell(x, y); ctx.drawImage(sprite(name, col), px, py, ts, ts); };
        for (let y = oy; y < oy + vh; y++) for (let x = ox; x < ox + vw; x++) {
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
            if (!G.shown(s, m) || m.x < ox || m.y < oy || m.x >= ox + vw || m.y >= oy + vh) continue;
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
        for (let y = oy; y < oy + vh; y++) for (let x = ox; x < ox + vw; x++) {
            const i = idx(x, y);
            if (s.seen[i] && !s.vis[i]) { const [px, py] = cell(x, y); ctx.fillRect(px, py, ts, ts); }
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
    function render() { draw(); hud(); }

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
            const label = eq ? 'Equip.' : d.cat === 'food' ? 'Mangia' : d.cat === 'usb' ? 'Usa' : d.cat === 'drink' ? 'Bevi' : 'Leggi';
            row(it, G.itemInfo(s, it), [[label, () => { closeModal(); act({ t: 'use', i }); }], ['Getta', () => { closeModal(); act({ t: 'drop', i }); }]]);
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
        if (s) btn('Registro completo', logModal, body, 'dg-choice');
        if (s) btn('Abbandona la partita', () => {
            if (!confirm('Abbandonare la partita? Si perde tutto.')) return;
            s.status = 'dead'; s.cause = 'la resa'; closeModal(); endModal();
        }, body, 'dg-choice');
    }
    function helpModal() {
        const body = openModal('Come si gioca', 'help');
        for (const t of [
            'Muovi con le frecce, scorrendo il dito sulla mappa, o toccando una casella: ci cammini da solo finché non compare un nemico.',
            'Camminare su un nemico lo attacca. Ogni passo è un turno: il gioco salva da solo e riprendi da dove eri anche dopo aver chiuso la scheda.',
            'Raccogli oggetti camminandoci sopra. Lattine, script e chiavette sono sconosciuti finché non li provi: usa il Zaino.',
            'Esplora cammina verso la prossima cosa da scoprire. Scale scende se sei sulle scale (o ci cammina).',
            'Ogni 5 piani c’è un boss: le scale restano bloccate finché non lo batti.',
            'Tastiera: frecce o WASD, spazio aspetta, I zaino, E esplora, F abilità, > scale, B nascondi lo schermo.',
        ]) el('p', t, '', body);
    }

    // ── playing ──
    function persist() { if (s && s.status === 'play') store.set(RUN_KEY, G.save(s)); }
    function afterTurn() {
        for (const f of s.fx) { const b = SOUND[f.t]; if (b) blip(b[0], b[1], b[2]); if (f.t === 'hurt' && !reduce) { const st = $('dg-stage'); st.classList.add('hurt'); setTimeout(() => st.classList.remove('hurt'), 160); } }
        persist(); render();
        if (s.status !== 'play') { stopTravel(); endModal(); }
        else if (s.p.pending && modalKind !== 'level') levelModal();
        else if (s.shop && s.shop.open) shopModal();
        else if (s.bench && s.bench.open) benchModal();
    }
    function act(a) {
        if (!s || s.status !== 'play') return false;
        const logLen = s.log.length, took = G.act(s, a);
        act.lastBad = s.log.slice(logLen).some((l) => l.c === 'bad');
        afterTurn();
        return took;
    }
    function note(text, c) { s.log.push({ t: text, c }); persist(); render(); }
    function stopTravel() { if (travel) { clearTimeout(travel.timer); travel = null; } }
    /** Walks by itself: `next()` gives the next step. Stops when an enemy shows up, something bad happens or there is no way. */
    function startTravel(next, limit) {
        stopTravel();
        const t = travel = { timer: 0, n: 0, hp: s.p.hp, depth: s.depth };
        const step = () => {
            if (travel !== t || !s || s.status !== 'play' || document.hidden) return stopTravel();
            if (t.n++ >= (limit || 80) || s.p.pending || (s.shop && s.shop.open) || s.depth !== t.depth) return stopTravel();
            if (t.n > 1 && G.threats(s).length) return stopTravel();
            const v = next();
            if (!v) return stopTravel();
            act({ t: 'move', dx: v[0], dy: v[1] });
            if (s.p.hp < t.hp || act.lastBad || s.depth !== t.depth) return stopTravel();
            if (G.threats(s).length) return stopTravel();
            t.timer = setTimeout(step, reduce ? 0 : 55);
        };
        step();
    }
    function walkTo(tx, ty) {
        if (tx === s.p.x && ty === s.p.y) return;
        if (G.threats(s).length) { const v = G.travelNext(s, tx, ty); if (v) act({ t: 'move', dx: v[0], dy: v[1] }); return; }
        startTravel(() => (s.p.x === tx && s.p.y === ty) ? null : G.travelNext(s, tx, ty));
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
        if (name === 'wait') act({ t: 'wait' });
        else if (name === 'bag') bagModal();
        else if (name === 'skill') act({ t: 'active' });
        else if (name === 'explore') explore();
        else if (name === 'stairs') stairs();
        else if (name === 'eat') useFirst((it) => G.ITEM[it.k].cat === 'food', 'Non hai niente da mangiare.');
        else if (name === 'heal') useFirst((it) => G.ITEM[it.k].cat === 'drink' && G.known(s, it) && G.ITEM[it.k].effect === 'heal', 'Non hai lattine curative che conosci.');
    }
    function step(dx, dy) { if (s && s.status === 'play' && $('dg-modal').hidden) { stopTravel(); act({ t: 'move', dx, dy }); } }

    // ── input ──
    for (const b of document.querySelectorAll('[data-d]')) b.addEventListener('click', () => { const [dx, dy] = b.dataset.d.split(',').map(Number); step(dx, dy); });
    for (const b of document.querySelectorAll('[data-a]')) b.addEventListener('click', () => command(b.dataset.a));
    $('dg-log').addEventListener('click', () => { if (s) logModal(); });
    $('dg-menu').addEventListener('click', menuModal);
    $('dg-mclose').addEventListener('click', closeModal);
    $('dg-hide').addEventListener('click', () => { stopTravel(); $('dg-cover').hidden = false; });
    $('dg-cover').addEventListener('click', () => { $('dg-cover').hidden = true; });
    let down = null;
    cv.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    cv.addEventListener('pointerup', (e) => {
        if (!down || !s || s.status !== 'play' || !$('dg-modal').hidden) return;
        const dx = e.clientX - down.x, dy = e.clientY - down.y; down = null;
        if (Math.hypot(dx, dy) > 28) { if (Math.abs(dx) > Math.abs(dy)) step(Math.sign(dx), 0); else step(0, Math.sign(dy)); return; }
        const r = cv.getBoundingClientRect(), sc = cv.width / r.width, cam = cv._cam || { ox: 0, oy: 0 };
        const x = cam.ox + Math.floor(((e.clientX - r.left) * sc) / view.ts), y = cam.oy + Math.floor(((e.clientY - r.top) * sc) / view.ts);
        if (x < 0 || y < 0 || x >= W || y >= H) return;
        stopTravel();
        if (x === s.p.x && y === s.p.y) return s.map.tiles[idx(x, y)] === T.STAIRS ? act({ t: 'descend' }) : act({ t: 'wait' });
        const adj = Math.abs(x - s.p.x) + Math.abs(y - s.p.y) === 1;
        if (adj) return act({ t: 'move', dx: x - s.p.x, dy: y - s.p.y });
        if (s.seen[idx(x, y)]) walkTo(x, y);
    });
    cv.addEventListener('pointercancel', () => { down = null; });
    addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (!$('dg-cover').hidden) { $('dg-cover').hidden = true; return; }
        const k = e.key;
        if (k === 'b' || k === 'B') { stopTravel(); $('dg-cover').hidden = false; return; }
        if (k === 'Escape') { if (!$('dg-modal').hidden && modalKind !== 'level' && modalKind !== 'end') closeModal(); else stopTravel(); return; }
        if (!s || s.status !== 'play' || !$('dg-modal').hidden) return;
        const dirs = { ArrowUp: [0, -1], w: [0, -1], W: [0, -1], ArrowDown: [0, 1], s: [0, 1], S: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0], ArrowRight: [1, 0], d: [1, 0], D: [1, 0] };
        if (dirs[k]) { e.preventDefault(); step(dirs[k][0], dirs[k][1]); }
        else if (k === ' ' || k === '.') { e.preventDefault(); command('wait'); }
        else if (k === 'i' || k === 'I') command('bag');
        else if (k === 'e' || k === 'E') command('explore');
        else if (k === 'f' || k === 'F') command('skill');
        else if (k === '>' || k === 'Enter') command('stairs');
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopTravel(); });
    let rt = 0;
    addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { layout(); if (s) render(); }, 100); });

    // ── title screen ──
    function applyOpt() { $('dg-stage').classList.toggle('scan', !!opt.scan); }
    function showTitle() {
        $('dg-game').hidden = true; $('dg-title').hidden = false;
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
        $('dg-title').hidden = true; $('dg-game').hidden = false;
        layout(); applyOpt(); render();
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
    self.RogueUI = { state: () => s, act, command, render };
})();
