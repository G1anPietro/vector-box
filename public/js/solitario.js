// public/js/solitario.js
// Klondike solitaire. Two layouts on the same game:
//  - desktop (mouse, wide screen): menu bar, toolbar and status bar, like a classic desktop app;
//  - touch (phones): top bar, big bottom buttons, everything else in the ⋯ menu.
// Input: tap/click = best move, double-click = foundation, long press = pick then tap a pile,
// drag and drop with finger or mouse. Undo/redo, restart, hint, classic scoring, four themes.
// State, settings and stats live in localStorage. UI strings: js/spia/i18n.js (sol_* keys).
(() => {
    'use strict';
    const LANGS = { it: 'Italiano', en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch' };
    const SUITS = ['h', 'd', 'c', 's'];
    const SYM = { h: '♥', d: '♦', c: '♣', s: '♠' };
    const RANK = [null, 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    const THEMES = { classic: '#2c6a3a', neon: '#0b0e14', wood: '#3a2416', night: '#000000' };
    const red = (c) => c.s === 'h' || c.s === 'd';

    const store = {
        get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
        set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    };
    const I18N = window.SpiaI18n;
    let lang = store.get('spia_lang') || I18N.detect(Object.keys(LANGS));
    const t = (k, v) => I18N.t(lang, k, v);

    let settings = Object.assign({ draw: 1, theme: 'classic' }, store.get('sol_settings', {}));
    let stats = Object.assign({ played: 0, won: 0, best: null, streak: 0, bestStreak: 0, bestScore: 0 }, store.get('sol_stats', {}));
    let g = store.get('sol_game', null);
    let undoStack = [];
    let redoStack = [];
    let selected = null;      // a move source picked with a long press
    let sheet = null;         // overlay: help | lang | theme | stats | new | more
    let openMenu = null;      // desktop dropdown
    let message = '';         // status-bar message (hints)
    let autoTimer = null;
    let hintTimer = null;
    let GEO = null;

    const $ = (id) => document.getElementById(id);
    const board = $('board');
    const deskMQ = window.matchMedia('(min-width: 760px)');
    const coarseMQ = window.matchMedia('(pointer: coarse)');   // phones and tablets keep the touch layout
    const isDesk = () => deskMQ.matches && !coarseMQ.matches;

    // ---------- game state ----------
    function shuffle(a) {
        const r = new Uint32Array(1);
        for (let i = a.length - 1; i > 0; i--) { crypto.getRandomValues(r); const j = r[0] % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
        return a;
    }

    function finishUnplayed() {
        if (g && g.moves > 0 && !g.won) { stats.played++; stats.streak = 0; }
    }

    function newGame() {
        finishUnplayed();
        const deck = shuffle(SUITS.flatMap((s) => Array.from({ length: 13 }, (_, i) => ({ s, r: i + 1, up: false }))));
        const tab = Array.from({ length: 7 }, (_, i) => deck.splice(0, i + 1));
        tab.forEach((col) => { col[col.length - 1].up = true; });
        const deal = JSON.stringify({ stock: deck, tab });
        g = { stock: deck, waste: [], found: { h: [], d: [], c: [], s: [] }, tab, draw: settings.draw,
              moves: 0, score: 0, elapsed: 0, startedAt: null, won: false, deal };
        resetSession();
    }

    function restartGame() {
        if (!g || !g.deal) { newGame(); return; }
        finishUnplayed();
        const deal = JSON.parse(g.deal);
        Object.assign(g, { stock: deal.stock, waste: [], found: { h: [], d: [], c: [], s: [] }, tab: deal.tab,
                           moves: 0, score: 0, elapsed: 0, startedAt: null, won: false, draw: settings.draw });
        resetSession();
    }

    function resetSession() {
        undoStack = [];
        redoStack = [];
        selected = null;
        message = '';
        sheet = null;
        saveAll();
        render();
    }

    const snapshot = () => JSON.stringify({ stock: g.stock, waste: g.waste, found: g.found, tab: g.tab, moves: g.moves, score: g.score });
    function remember() { undoStack.push(snapshot()); if (undoStack.length > 500) undoStack.shift(); redoStack = []; }
    function undo() {
        if (!undoStack.length || g.won) return;
        redoStack.push(snapshot());
        Object.assign(g, JSON.parse(undoStack.pop()));
        selected = null; message = '';
        saveAll(); render();
    }
    function redo() {
        if (!redoStack.length || g.won) return;
        undoStack.push(snapshot());
        Object.assign(g, JSON.parse(redoStack.pop()));
        selected = null; message = '';
        saveAll(); render();
    }

    function tick() { if (!g.startedAt && !g.won) g.startedAt = Date.now(); }
    const elapsed = () => g.elapsed + (g.startedAt && !g.won ? Date.now() - g.startedAt : 0);
    const addScore = (n) => { g.score = Math.max(0, g.score + n); };

    function drawFromStock() {
        if (g.won) return;
        if (!g.stock.length && !g.waste.length) return;
        tick();
        remember();
        if (!g.stock.length) {
            g.stock = g.waste.reverse().map((c) => ({ ...c, up: false }));
            g.waste = [];
            if (g.draw === 1) addScore(-100);
        } else {
            const n = Math.min(g.draw, g.stock.length);
            for (let i = 0; i < n; i++) { const c = g.stock.pop(); c.up = true; g.waste.push(c); }
        }
        g.moves++;
        selected = null; message = '';
        saveAll(); render();
    }

    // A move source: { from: 'waste' } | { from: 'found', s } | { from: 'tab', col, idx }
    function cardsOf(src) {
        if (src.from === 'waste') return g.waste.length ? [g.waste[g.waste.length - 1]] : [];
        if (src.from === 'found') { const f = g.found[src.s]; return f.length ? [f[f.length - 1]] : []; }
        const col = g.tab[src.col];
        const run = col.slice(src.idx);
        return run.length && run.every((c) => c.up) ? run : [];
    }
    const canFound = (card, run) => run.length === 1 && card.r === g.found[card.s].length + 1;
    function canTab(card, col) {
        const pile = g.tab[col];
        if (!pile.length) return card.r === 13;
        const top = pile[pile.length - 1];
        return top.up && red(top) !== red(card) && top.r === card.r + 1;
    }

    /** Try to move `src` to `dst` ({ to: 'found' } | { to: 'tab', col }). Classic scoring. */
    function tryMove(src, dst) {
        if (g.won) return false;
        const run = cardsOf(src);
        if (!run.length) return false;
        const card = run[0];
        if (dst.to === 'found') { if (!canFound(card, run)) return false; }
        else if ((src.from === 'tab' && src.col === dst.col) || !canTab(card, dst.col)) return false;

        tick();
        remember();
        let moved;
        if (src.from === 'waste') moved = g.waste.splice(-1, 1);
        else if (src.from === 'found') moved = g.found[src.s].splice(-1, 1);
        else {
            moved = g.tab[src.col].splice(src.idx, run.length);
            const col = g.tab[src.col];
            if (col.length && !col[col.length - 1].up) { col[col.length - 1].up = true; addScore(5); }
        }
        if (dst.to === 'found') g.found[card.s].push(...moved); else g.tab[dst.col].push(...moved);

        if (dst.to === 'found') addScore(src.from === 'found' ? 0 : 10);
        else if (src.from === 'waste') addScore(5);
        else if (src.from === 'found') addScore(-15);

        g.moves++;
        selected = null; message = '';
        checkWin();
        saveAll(); render();
        return true;
    }

    /** Where should this card go with a single tap? Foundation first, then a useful tableau spot. */
    function bestMove(src) {
        const run = cardsOf(src);
        if (!run.length) return null;
        const card = run[0];
        if (src.from !== 'found' && canFound(card, run)) return { to: 'found' };
        const targets = [];
        for (let col = 0; col < 7; col++) {
            if (src.from === 'tab' && src.col === col) continue;
            if (!canTab(card, col)) continue;
            if (!g.tab[col].length && src.from === 'tab' && src.idx === 0) continue;   // king to another empty column: pointless
            targets.push(col);
        }
        if (!targets.length) return null;
        targets.sort((a, b) => (g.tab[b].length > 0) - (g.tab[a].length > 0));
        return { to: 'tab', col: targets[0] };
    }

    /** A useful move to suggest: foundation, then moves that turn a card over, then from the waste. */
    function findHint() {
        const cands = [];
        const push = (src, dst, prio) => cands.push({ src, dst, prio });
        if (g.waste.length) {
            const src = { from: 'waste' };
            const card = g.waste[g.waste.length - 1];
            if (canFound(card, [card])) push(src, { to: 'found' }, 1);
            for (let col = 0; col < 7; col++) if (canTab(card, col)) push(src, { to: 'tab', col }, 3);
        }
        g.tab.forEach((pile, ci) => {
            const first = pile.findIndex((c) => c.up);
            if (first < 0) return;
            const last = pile[pile.length - 1];
            if (canFound(last, [last])) push({ from: 'tab', col: ci, idx: pile.length - 1 }, { to: 'found' }, 1);
            for (let col = 0; col < 7; col++) {
                if (col === ci || !canTab(pile[first], col)) continue;
                const src = { from: 'tab', col: ci, idx: first };
                if (first > 0) push(src, { to: 'tab', col }, 2);                                          // turns a card over
                else if (pile[first].r !== 13 && g.tab[col].length) push(src, { to: 'tab', col }, 4);     // empties a column
            }
        });
        cands.sort((a, b) => a.prio - b.prio);
        return cands[0] || null;
    }

    function clearHints() { board.querySelectorAll('.hint').forEach((n) => n.classList.remove('hint')); }

    function showHint() {
        if (g.won) return;
        clearTimeout(hintTimer);
        clearHints();
        const h = findHint();
        if (!h) {
            const canDraw = g.stock.length || g.waste.length;
            message = canDraw ? t('sol_hint_draw') : t('sol_hint_none');
            if (canDraw) { const st = board.querySelector('.slot.stock'); if (st) st.classList.add('hint'); }
        } else {
            message = '';
            nodesFor(h.src).forEach((n) => n.classList.add('hint'));
            const target = h.dst.to === 'found'
                ? board.querySelector(`.slot.found[data-suit="${cardsOf(h.src)[0].s}"]`)
                : (board.querySelector(`.card-sol[data-col="${h.dst.col}"][data-idx="${g.tab[h.dst.col].length - 1}"]`)
                    || board.querySelector(`.slot.tab[data-col="${h.dst.col}"]`));
            if (target) target.classList.add('hint');
        }
        renderChrome();
        hintTimer = setTimeout(() => { clearHints(); message = ''; renderChrome(); }, 2200);
    }

    function checkWin() {
        if (!SUITS.every((s) => g.found[s].length === 13)) return;
        g.won = true;
        g.elapsed = elapsed();
        g.startedAt = null;
        stats.played++;
        stats.won++;
        stats.streak++;
        stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
        stats.bestScore = Math.max(stats.bestScore, g.score);
        if (stats.best === null || g.elapsed < stats.best) stats.best = g.elapsed;
        if (navigator.vibrate) { try { navigator.vibrate([30, 60, 30, 60, 60]); } catch (e) { /* unsupported */ } }
    }

    const canAutoComplete = () => !g.won && !g.stock.length && !g.waste.length && g.tab.every((col) => col.every((c) => c.up));
    /** Send every card that can go to the foundations there, one at a time (waste and column tops). */
    function collectAll() {
        clearTimeout(autoTimer);
        const step = () => {
            if (g.won) return;
            const srcs = [{ from: 'waste' }];
            for (let col = 0; col < 7; col++) if (g.tab[col].length) srcs.push({ from: 'tab', col, idx: g.tab[col].length - 1 });
            for (const src of srcs) {
                if (tryMove(src, { to: 'found' })) { autoTimer = setTimeout(step, 90); return; }
            }
        };
        step();
    }
    const autoComplete = collectAll;

    function saveAll() {
        if (g && g.startedAt && !g.won) { g.elapsed = elapsed(); g.startedAt = Date.now(); }
        store.set('sol_game', g);
        store.set('sol_settings', settings);
        store.set('sol_stats', stats);
    }

    // ---------- drawing ----------
    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    // Pip positions (x%, y%, upside-down) inside the card's centre box, as on real cards
    const PIPS = {
        2: [[50, 0], [50, 100, 1]],
        3: [[50, 0], [50, 50], [50, 100, 1]],
        4: [[0, 0], [100, 0], [0, 100, 1], [100, 100, 1]],
        5: [[0, 0], [100, 0], [50, 50], [0, 100, 1], [100, 100, 1]],
        6: [[0, 0], [100, 0], [0, 50], [100, 50], [0, 100, 1], [100, 100, 1]],
        7: [[0, 0], [100, 0], [50, 25], [0, 50], [100, 50], [0, 100, 1], [100, 100, 1]],
        8: [[0, 0], [100, 0], [50, 25], [0, 50], [100, 50], [50, 75, 1], [0, 100, 1], [100, 100, 1]],
        9: [[0, 0], [100, 0], [0, 33], [100, 33], [50, 50], [0, 67, 1], [100, 67, 1], [0, 100, 1], [100, 100, 1]],
        10: [[0, 0], [100, 0], [50, 17], [0, 33], [100, 33], [0, 67, 1], [100, 67, 1], [50, 83, 1], [0, 100, 1], [100, 100, 1]],
    };

    function cardEl(c) {
        const e = el('div', 'card-sol' + (c.up ? (red(c) ? ' up red' : ' up') : ' down'));
        if (!c.up) return e;
        const corner = (cls) => {
            const k = el('span', 'corner ' + cls);
            k.appendChild(el('b', null, RANK[c.r]));
            k.appendChild(el('i', null, SYM[c.s]));
            return k;
        };
        e.appendChild(corner('tl'));
        e.appendChild(corner('br'));
        e.appendChild(el('span', 'pip', SYM[c.s]));
        if (c.r === 1) e.appendChild(el('span', 'ace', SYM[c.s]));
        else if (c.r > 10) {
            const court = el('span', 'court');
            court.appendChild(el('b', null, RANK[c.r]));
            court.appendChild(el('i', null, SYM[c.s]));
            e.appendChild(court);
        } else {
            const box = el('span', 'pips');
            PIPS[c.r].forEach(([px, py, flip]) => {
                const p = el('span', flip ? 'flip' : '', SYM[c.s]);
                p.style.left = px + '%';
                p.style.top = py + '%';
                box.appendChild(p);
            });
            e.appendChild(box);
        }
        e.setAttribute('aria-label', RANK[c.r] + ' ' + SYM[c.s]);
        return e;
    }

    const fmtTime = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

    function render() {
        renderChrome();
        board.replaceChildren();
        const desk = isDesk();
        const W = Math.min(board.clientWidth, desk ? 900 : 640);
        const gap = W < 420 ? 4 : (desk ? 14 : 8);
        const cw = Math.floor((W - 6 * gap) / 7);
        const ch = Math.round(cw * 1.42);
        const x0 = (board.clientWidth - W) / 2;
        board.style.setProperty('--cw', cw + 'px');
        const x = (i) => x0 + i * (cw + gap);
        const top0 = ch + (desk ? 22 : 14);
        GEO = { cw, ch, gap, x0, top0 };
        const place = (node, left, top, z) => {
            node.style.left = left + 'px';
            node.style.top = top + 'px';
            node.style.width = cw + 'px';
            node.style.height = ch + 'px';
            if (z !== undefined) node.style.zIndex = z;
            board.appendChild(node);
            return node;
        };

        const stock = place(el('button', 'slot stock' + (g.stock.length ? '' : ' empty')), x(0), 0);
        stock.setAttribute('aria-label', t('sol_stock'));
        stock.textContent = g.stock.length ? '' : '↻';
        if (g.stock.length) stock.appendChild(cardEl(g.stock[g.stock.length - 1]));
        stock.addEventListener('click', drawFromStock);

        const shown = g.waste.slice(-(g.draw === 3 ? 3 : 1));
        if (g.waste.length > shown.length) place(cardEl(g.waste[g.waste.length - shown.length - 1]), x(1), 0, 9);
        shown.forEach((c, i) => {
            const node = place(cardEl(c), x(1) + i * Math.round(cw * 0.32), 0, 10 + i);
            if (i === shown.length - 1) bindCard(node, { from: 'waste' });
        });

        SUITS.forEach((s, i) => {
            const pile = g.found[s];
            const slot = place(el('div', 'slot found', SYM[s]), x(3 + i), 0);
            slot.dataset.suit = s;
            slot.classList.toggle('red', s === 'h' || s === 'd');
            slot.addEventListener('click', () => { if (selected && !suppressed()) tryMove(selected, { to: 'found' }); });
            slot.addEventListener('dblclick', (e) => { e.preventDefault(); collectAll(); });
            if (pile.length > 1) place(cardEl(pile[pile.length - 2]), x(3 + i), 0, 4);
            if (pile.length) bindCard(place(cardEl(pile[pile.length - 1]), x(3 + i), 0, 5), { from: 'found', s });
        });

        const avail = Math.max(ch * 2, board.clientHeight - top0 - 6);
        g.tab.forEach((col, ci) => {
            const slot = place(el('div', 'slot tab'), x(ci), top0);
            slot.dataset.col = ci;
            slot.addEventListener('click', () => { if (selected && !suppressed()) tryMove(selected, { to: 'tab', col: ci }); });
            const downs = col.filter((c) => !c.up).length;
            const ups = col.length - downs;
            let od = Math.round(ch * 0.13);
            let ou = Math.round(ch * 0.3);
            const need = downs * od + Math.max(0, ups - 1) * ou + ch;
            if (need > avail) {
                const f = (avail - ch) / Math.max(1, downs * od + Math.max(0, ups - 1) * ou);
                od = Math.max(3, Math.floor(od * f));
                ou = Math.max(12, Math.floor(ou * f));
            }
            let y = top0;
            col.forEach((c, idx) => {
                const node = place(cardEl(c), x(ci), y, 20 + idx);
                node.dataset.col = ci;
                node.dataset.idx = idx;
                if (c.up) bindCard(node, { from: 'tab', col: ci, idx });
                else node.addEventListener('contextmenu', (e) => e.preventDefault());
                y += c.up ? ou : od;
            });
        });
        if (selected) nodesFor(selected).forEach((n) => n.classList.add('picked'));
        renderOverlay();
    }

    function nodesFor(src) {
        if (src.from === 'tab') {
            return [...board.querySelectorAll('.card-sol.up')]
                .filter((n) => +n.dataset.col === src.col && +n.dataset.idx >= src.idx)
                .sort((a, b) => a.dataset.idx - b.dataset.idx);
        }
        const key = JSON.stringify(src);
        return [...board.querySelectorAll('.card-sol.up')].filter((n) => n.dataset.src === key);
    }

    // ---------- chrome: status, buttons, menus ----------
    function renderChrome() {
        const desk = isDesk();
        document.body.classList.toggle('desk', desk);
        document.body.classList.toggle('touch', !desk);
        $('sol-time').textContent = $('sol-time2').textContent = fmtTime(elapsed());
        $('sol-score').textContent = $('sol-score2').textContent = String(g.score || 0);
        $('sol-moves').textContent = String(g.moves);
        $('sol-msg').textContent = message || t('sol_stats', { won: stats.won, played: stats.played });
        document.querySelectorAll('[data-act="undo"]').forEach((b) => { b.disabled = !undoStack.length || g.won; });
        document.querySelectorAll('[data-act="redo"]').forEach((b) => { b.disabled = !redoStack.length || g.won; });
        document.querySelectorAll('[data-act="auto"]').forEach((b) => { b.hidden = !canAutoComplete(); });
    }

    const ACTIONS = {
        new: () => { if (g.moves > 0 && !g.won) { sheet = 'new'; render(); } else newGame(); },
        restart: restartGame,
        undo, redo,
        hint: showHint,
        deal: drawFromStock,
        auto: autoComplete,
        stats: () => { sheet = 'stats'; render(); },
        theme: () => { sheet = 'theme'; render(); },
        lang: () => { sheet = 'lang'; render(); },
        help: () => { sheet = 'help'; render(); },
        more: () => { sheet = 'more'; render(); },
        draw: () => {
            settings.draw = settings.draw === 1 ? 3 : 1;
            saveAll();
            if (g.moves === 0) newGame(); else { message = t('sol_draw_next'); buildChrome(); render(); }
        },
        full: () => {
            try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); } catch (e) { /* unsupported */ }
        },
        exit: () => { location.href = '../index.php'; },
    };

    // Desktop menus, with the keyboard shortcut next to each command
    const MENUS = () => [
        ['sol_menu_game', [['new', t('sol_new'), 'F2'], ['restart', t('sol_restart')], null, ['stats', t('sol_stats_title')], null, ['exit', t('back_to_site')]]],
        ['sol_menu_view', [['theme', t('sol_theme') + '…'], ['draw', settings.draw === 3 ? t('sol_draw1') : t('sol_draw3')], ['full', t('sol_fullscreen'), 'F11']]],
        ['sol_menu_control', [['undo', t('nh_undo'), 'Ctrl+Z'], ['redo', t('sol_redo'), 'Ctrl+Y'], null, ['hint', t('sol_hint'), 'H'], ['deal', t('sol_deal'), 'D']]],
        ['sol_menu_help', [['help', t('sol_rules'), 'F1'], ['lang', t('language') + '…']]],
    ];

    function buildChrome() {
        const bar = $('sol-menubar');
        bar.replaceChildren();
        MENUS().forEach(([key, items], mi) => {
            const wrap = el('div', 'menu' + (openMenu === mi ? ' open' : ''));
            const btn = el('button', 'menu-title', t(key));
            btn.addEventListener('click', (e) => { e.stopPropagation(); openMenu = openMenu === mi ? null : mi; buildChrome(); });
            btn.addEventListener('mouseenter', () => { if (openMenu !== null && openMenu !== mi) { openMenu = mi; buildChrome(); } });
            wrap.appendChild(btn);
            if (openMenu === mi) {
                const list = el('div', 'menu-list');
                items.forEach((it) => {
                    if (!it) { list.appendChild(el('hr')); return; }
                    const [act, label, key2] = it;
                    const b = el('button', 'menu-item');
                    b.dataset.act = act;
                    b.append(el('span', null, label), el('kbd', null, key2 || ''));
                    b.addEventListener('click', (e) => { e.stopPropagation(); openMenu = null; buildChrome(); ACTIONS[act](); });
                    list.appendChild(b);
                });
                wrap.appendChild(list);
            }
            bar.appendChild(wrap);
        });

        const tb = $('sol-toolbar');
        tb.replaceChildren();
        [['new', 'sol_new'], ['restart', 'sol_restart'], ['hint', 'sol_hint'], ['undo', 'nh_undo'], ['redo', 'sol_redo'], ['deal', 'sol_deal'], ['auto', 'sol_auto']]
            .forEach(([act, key]) => {
                const b = el('button', 'tool', t(key));
                b.dataset.act = act;
                b.addEventListener('click', ACTIONS[act]);
                tb.appendChild(b);
            });
        renderChrome();
    }

    function renderOverlay() {
        const ov = $('overlay');
        ov.replaceChildren();
        ov.hidden = !(g.won || sheet);
        const box = el('div', 'win');
        const close = () => { sheet = null; render(); };
        const button = (label, cls, fn) => { const b = el('button', 'btn ' + (cls || ''), label); b.addEventListener('click', fn); return b; };
        if (g.won && !sheet) {
            box.appendChild(el('h2', null, t('sol_won')));
            box.appendChild(el('p', null, t('sol_won_d', { time: fmtTime(g.elapsed), moves: g.moves })));
            box.appendChild(el('p', null, t('sol_score') + ': ' + g.score));
            if (stats.streak > 1) box.appendChild(el('p', 'muted', t('sol_streak', { n: stats.streak })));
            box.appendChild(button(t('sol_new'), 'primary', newGame));
            ov.appendChild(box);
            return;
        }
        if (!sheet) return;
        if (sheet === 'new') {
            box.appendChild(el('p', null, t('sol_new_q')));
            const row = el('div', 'row2');
            row.append(button(t('cancel'), '', close), button(t('sol_new'), 'primary', () => { sheet = null; newGame(); }));
            box.appendChild(row);
        } else if (sheet === 'help') {
            box.appendChild(el('h2', null, t('sol_rules')));
            t('sol_help').split('\n').forEach((p) => box.appendChild(el('p', null, p)));
            box.appendChild(el('p', 'muted', t('sol_keys')));
            box.appendChild(button(t('close'), 'primary', close));
        } else if (sheet === 'stats') {
            box.appendChild(el('h2', null, t('sol_stats_title')));
            const pct = stats.played ? Math.round(100 * stats.won / stats.played) : 0;
            [t('sol_stat_played', { n: stats.played }), t('sol_stat_won', { n: stats.won, pct }),
             t('sol_stat_best', { time: stats.best !== null ? fmtTime(stats.best) : '–' }),
             t('sol_stat_streak', { n: stats.streak, best: stats.bestStreak }), t('sol_stat_score', { n: stats.bestScore })]
                .forEach((line) => box.appendChild(el('p', null, line)));
            box.appendChild(button(t('close'), 'primary', close));
        } else if (sheet === 'theme') {
            box.appendChild(el('h2', null, t('sol_theme')));
            Object.keys(THEMES).forEach((key) => {
                const b = button('', 'theme-pick' + (key === settings.theme ? ' primary' : ''), () => { settings.theme = key; applyTheme(); saveAll(); close(); });
                b.append(el('span', 'swatch ' + key), document.createTextNode(t('sol_theme_' + key)));
                box.appendChild(b);
            });
        } else if (sheet === 'lang') {
            box.appendChild(el('h2', null, t('language')));
            Object.entries(LANGS).forEach(([code, label]) => box.appendChild(button(label, code === lang ? 'primary' : '', () => {
                lang = code; store.set('spia_lang', code); document.documentElement.lang = code; sheet = null; applyStatic(); render();
            })));
        } else if (sheet === 'more') {
            [['restart', t('sol_restart')], ['redo', t('sol_redo')], ['draw', settings.draw === 3 ? t('sol_draw1') : t('sol_draw3')],
             ['stats', t('sol_stats_title')], ['theme', t('sol_theme')], ['lang', t('language')], ['help', t('sol_rules')], ['exit', t('back_to_site')]]
                .forEach(([act, label]) => {
                    const b = button(label, '', () => { sheet = null; ACTIONS[act](); if (!sheet) render(); });
                    if (act === 'redo') b.disabled = !redoStack.length;
                    box.appendChild(b);
                });
            box.appendChild(button(t('close'), 'primary', close));
        }
        ov.appendChild(box);
    }

    function applyTheme() {
        if (!THEMES[settings.theme]) settings.theme = 'classic';
        document.documentElement.dataset.theme = settings.theme;
        const meta = document.querySelector('meta[name=theme-color]');
        if (meta) meta.content = THEMES[settings.theme];
    }

    function applyStatic() {
        document.title = t('sol_title');
        $('sol-title').textContent = t('sol_title');
        $('sol-time-l').textContent = t('sol_time');
        $('sol-score-l').textContent = t('sol_score');
        $('sol-moves-l').textContent = t('sol_moves');
        $('sol-score-l2').textContent = t('sol_score');
        $('sol-time-l2').textContent = t('sol_time');
        document.querySelectorAll('[data-label]').forEach((b) => { b.textContent = t(b.dataset.label); });
        buildChrome();
    }

    // ---------- input: tap = best move, double-click = foundation, long press = pick, drag = move ----------
    let press = null;
    let suppressUntil = 0;
    const suppressed = () => Date.now() < suppressUntil;

    function bindCard(node, src) {
        node.dataset.src = JSON.stringify(src);
        node.addEventListener('pointerdown', (e) => {
            if (e.button === 2 || e.button === 1) { peek(node); return; }
            if (g.won || (e.button !== undefined && e.button > 0)) return;
            press = { src, node, x0: e.clientX, y0: e.clientY, dragging: false, long: false, nodes: null };
            press.timer = setTimeout(() => {
                if (!press || press.dragging) return;
                press.long = true;
                selected = src;
                if (navigator.vibrate) { try { navigator.vibrate(15); } catch (err) { /* unsupported */ } }
                render();
            }, 450);
        });
        node.addEventListener('contextmenu', (e) => e.preventDefault());
        node.addEventListener('dblclick', (e) => e.preventDefault());   // handled in tapCard (the board re-renders between clicks)
    }

    window.addEventListener('pointermove', (e) => {
        if (!press || press.long) return;
        const dx = e.clientX - press.x0;
        const dy = e.clientY - press.y0;
        if (!press.dragging) {
            if (Math.hypot(dx, dy) < 8 || !cardsOf(press.src).length) return;
            press.dragging = true;
            clearTimeout(press.timer);
            press.nodes = nodesFor(press.src);
            if (!press.nodes.length) press.nodes = [press.node];
            press.nodes.forEach((n, i) => { n.classList.add('dragging'); n.style.zIndex = 1000 + i; });
        }
        press.nodes.forEach((n) => { n.style.transform = `translate(${dx}px, ${dy}px)`; });
        markDrop(press.src, dropTarget(e.clientX, e.clientY));
    }, { passive: true });

    /** Would this move be legal? (no side effects) */
    function canDrop(src, dst) {
        const run = cardsOf(src);
        if (!run.length || !dst) return false;
        if (dst.to === 'found') return src.from !== 'found' && canFound(run[0], run);
        return !(src.from === 'tab' && src.col === dst.col) && canTab(run[0], dst.col);
    }
    let dropNode = null;
    function markDrop(src, dst) {
        let node = null;
        if (canDrop(src, dst)) {
            node = dst.to === 'found'
                ? board.querySelector(`.slot.found[data-suit="${cardsOf(src)[0].s}"]`)
                : (board.querySelector(`.card-sol[data-col="${dst.col}"][data-idx="${g.tab[dst.col].length - 1}"]`)
                    || board.querySelector(`.slot.tab[data-col="${dst.col}"]`));
        }
        if (node === dropNode) return;
        if (dropNode) dropNode.classList.remove('drop-ok');
        dropNode = node;
        if (dropNode) dropNode.classList.add('drop-ok');
    }

    // Right (or middle) button held on a covered card: lift it to read it, put it back on release
    let peeked = null;
    function peek(node) {
        peeked = node;
        node.classList.add('peek');
        const done = () => { if (peeked) peeked.classList.remove('peek'); peeked = null; window.removeEventListener('pointerup', done); };
        window.addEventListener('pointerup', done);
    }

    function dropTarget(clientX, clientY) {
        if (!GEO) return null;
        const r = board.getBoundingClientRect();
        const col = Math.floor((clientX - r.left - GEO.x0) / (GEO.cw + GEO.gap));
        if (col < 0 || col > 6) return null;
        if (clientY - r.top < GEO.top0 - 4) return col >= 3 ? { to: 'found' } : null;
        return { to: 'tab', col };
    }

    window.addEventListener('pointerup', (e) => {
        if (!press) return;
        const p = press;
        press = null;
        clearTimeout(p.timer);
        suppressUntil = Date.now() + 400;
        if (p.long) return;
        if (p.dragging) {
            const dst = dropTarget(e.clientX, e.clientY);
            dropNode = null;
            if (!dst || !tryMove(p.src, dst)) render();   // invalid drop: everything snaps back
            return;
        }
        tapCard(p.src, p.node);
    });
    window.addEventListener('pointercancel', () => {
        if (press && press.dragging) render();
        if (press) clearTimeout(press.timer);
        press = null;
    });

    let lastTap = null;
    function tapCard(src, node) {
        // double click / double tap: on a foundation it collects everything, on a card it sends it up
        const top = cardsOf(src)[0];
        const key = JSON.stringify(src) + (top ? top.s + top.r : '');
        const now = Date.now();
        if (lastTap && lastTap.key === key && now - lastTap.t < 450) {
            lastTap = null;
            selected = null;
            if (src.from === 'found') collectAll();
            else if (!(cardsOf(src).length === 1 && tryMove(src, { to: 'found' }))) render();
            return;
        }
        lastTap = { key, t: now };
        if (src.from === 'found' && !selected && !isDesk()) return;   // phone: wait for a possible double tap
        if (selected) {
            const target = src.from === 'tab' ? { to: 'tab', col: src.col } : src.from === 'found' ? { to: 'found' } : null;
            const was = selected;
            const same = was.from === src.from && was.col === src.col && was.idx === src.idx;
            if (target && !same && tryMove(was, target)) return;
            selected = isDesk() && !same ? src : null;   // desktop: clicking another card picks that one
            render();
            return;
        }
        if (isDesk()) { selected = src; render(); return; }
        const dst = bestMove(src);
        if (dst) tryMove(src, dst);
        else { node.classList.remove('shake'); void node.offsetWidth; node.classList.add('shake'); }
    }

    // ---------- keyboard (desktop) ----------
    document.addEventListener('keydown', (e) => {
        const k = e.key.toLowerCase();
        const ctrl = e.ctrlKey || e.metaKey;
        let act = null;
        if (ctrl && k === 'z' && !e.shiftKey) act = 'undo';
        else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) act = 'redo';
        else if (!ctrl && k === 'h') act = 'hint';
        else if (!ctrl && k === 'd') act = 'deal';
        else if (e.key === 'F2') act = 'new';
        else if (e.key === 'F1') act = 'help';
        else if (e.key === 'Escape') { sheet = null; openMenu = null; selected = null; buildChrome(); render(); return; }
        if (act) { e.preventDefault(); ACTIONS[act](); }
    });

    // ---------- wiring ----------
    document.querySelectorAll('[data-act]').forEach((b) => { if (ACTIONS[b.dataset.act]) b.addEventListener('click', ACTIONS[b.dataset.act]); });
    document.addEventListener('click', () => { if (openMenu !== null) { openMenu = null; buildChrome(); } });
    board.addEventListener('click', () => { if (selected && !suppressed()) { selected = null; render(); } });
    window.addEventListener('resize', () => render());
    [deskMQ, coarseMQ].forEach((mq) => mq.addEventListener('change', () => { buildChrome(); render(); }));
    document.addEventListener('visibilitychange', () => { if (g && document.hidden) saveAll(); });
    setInterval(() => { if (g && g.startedAt && !g.won && !document.hidden) $('sol-time').textContent = $('sol-time2').textContent = fmtTime(elapsed()); }, 1000);

    document.documentElement.lang = lang;
    applyTheme();
    if (!g || !g.tab) {
        g = { stock: [], waste: [], found: { h: [], d: [], c: [], s: [] }, tab: [[], [], [], [], [], [], []], moves: 0, score: 0, elapsed: 0, won: false };
        applyStatic();
        newGame();
    } else {
        if (g.score === undefined) g.score = 0;
        if (g.startedAt) g.startedAt = Date.now();
        applyStatic();
        render();
    }
})();
