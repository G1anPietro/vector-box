// public/js/solitario.js
// Klondike solitaire, phone first, works offline. Tap a card: it goes to the best place
// (foundation first, then the tableau). Long-press a card to pick it, then tap where it goes.
// State, settings and stats live in localStorage. UI strings: js/spia/i18n.js (sol_* keys).
(() => {
    'use strict';
    const LANGS = { it: 'Italiano', en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch' };
    const SUITS = ['h', 'd', 'c', 's'];
    const SYM = { h: '♥', d: '♦', c: '♣', s: '♠' };
    const RANK = [null, 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    const red = (c) => c.s === 'h' || c.s === 'd';

    const store = {
        get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
        set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    };
    const I18N = window.SpiaI18n;
    let lang = store.get('spia_lang') || I18N.detect(Object.keys(LANGS));
    const t = (k, v) => I18N.t(lang, k, v);

    let settings = Object.assign({ draw: 1 }, store.get('sol_settings', {}));
    let stats = Object.assign({ played: 0, won: 0, best: null, streak: 0, bestStreak: 0 }, store.get('sol_stats', {}));
    let g = store.get('sol_game', null);
    let undoStack = [];
    let selected = null;      // a move source picked with a long press
    let sheet = null;         // 'help' | 'lang' | 'new'
    let autoTimer = null;

    const board = document.getElementById('board');
    const $ = (id) => document.getElementById(id);

    // ---------- the game ----------
    function shuffle(a) {
        const r = new Uint32Array(1);
        for (let i = a.length - 1; i > 0; i--) { crypto.getRandomValues(r); const j = r[0] % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
        return a;
    }

    function newGame() {
        if (g && g.moves > 0 && !g.won) { stats.played++; stats.streak = 0; }
        const deck = shuffle(SUITS.flatMap((s) => Array.from({ length: 13 }, (_, i) => ({ s, r: i + 1, up: false }))));
        const tab = Array.from({ length: 7 }, (_, i) => deck.splice(0, i + 1));
        tab.forEach((col) => { col[col.length - 1].up = true; });
        g = { stock: deck, waste: [], found: { h: [], d: [], c: [], s: [] }, tab, draw: settings.draw, moves: 0, elapsed: 0, startedAt: null, won: false };
        undoStack = [];
        selected = null;
        saveAll();
        render();
    }

    const snapshot = () => JSON.stringify({ stock: g.stock, waste: g.waste, found: g.found, tab: g.tab, moves: g.moves });
    function pushUndo() { undoStack.push(snapshot()); if (undoStack.length > 300) undoStack.shift(); }
    function undo() {
        const s = undoStack.pop();
        if (!s || g.won) return;
        Object.assign(g, JSON.parse(s));
        selected = null;
        saveAll();
        render();
    }

    function tick() {
        if (!g.startedAt && !g.won) g.startedAt = Date.now();
    }
    const elapsed = () => g.elapsed + (g.startedAt && !g.won ? Date.now() - g.startedAt : 0);

    function drawFromStock() {
        if (g.won) return;
        tick();
        pushUndo();
        if (!g.stock.length) {
            if (!g.waste.length) { undoStack.pop(); return; }
            g.stock = g.waste.reverse().map((c) => ({ ...c, up: false }));
            g.waste = [];
        } else {
            const n = Math.min(g.draw, g.stock.length);
            for (let i = 0; i < n; i++) { const c = g.stock.pop(); c.up = true; g.waste.push(c); }
        }
        g.moves++;
        selected = null;
        saveAll();
        render();
    }

    // A move source: { from: 'waste' } | { from: 'found', s } | { from: 'tab', col, idx }
    function cardsOf(src) {
        if (src.from === 'waste') return g.waste.length ? [g.waste[g.waste.length - 1]] : [];
        if (src.from === 'found') { const f = g.found[src.s]; return f.length ? [f[f.length - 1]] : []; }
        const col = g.tab[src.col];
        const run = col.slice(src.idx);
        return run.length && run.every((c) => c.up) ? run : [];
    }

    function canFound(card, run) {
        if (run.length !== 1) return false;
        return card.r === g.found[card.s].length + 1;
    }
    function canTab(card, col) {
        const pile = g.tab[col];
        if (!pile.length) return card.r === 13;
        const top = pile[pile.length - 1];
        return top.up && red(top) !== red(card) && top.r === card.r + 1;
    }

    function removeFrom(src, n) {
        if (src.from === 'waste') return g.waste.splice(g.waste.length - 1, 1);
        if (src.from === 'found') return g.found[src.s].splice(g.found[src.s].length - 1, 1);
        const moved = g.tab[src.col].splice(src.idx, n);
        const col = g.tab[src.col];
        if (col.length && !col[col.length - 1].up) col[col.length - 1].up = true;   // flip
        return moved;
    }

    /** Try to move `src` to `dst` ({ to: 'found' } | { to: 'tab', col }). */
    function tryMove(src, dst) {
        if (g.won) return false;
        const run = cardsOf(src);
        if (!run.length) return false;
        const card = run[0];
        if (dst.to === 'found') {
            if (!canFound(card, run)) return false;
        } else {
            if (src.from === 'tab' && src.col === dst.col) return false;
            if (!canTab(card, dst.col)) return false;
        }
        tick();
        pushUndo();
        const moved = removeFrom(src, run.length);
        if (dst.to === 'found') g.found[card.s].push(...moved); else g.tab[dst.col].push(...moved);
        g.moves++;
        selected = null;
        checkWin();
        saveAll();
        render();
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
            // a king already at the bottom of a column gains nothing by moving to another empty one
            if (!g.tab[col].length && src.from === 'tab' && src.idx === 0) continue;
            targets.push(col);
        }
        if (!targets.length) return null;
        targets.sort((a, b) => (g.tab[b].length > 0) - (g.tab[a].length > 0));   // non-empty first
        return { to: 'tab', col: targets[0] };
    }

    function checkWin() {
        if (SUITS.every((s) => g.found[s].length === 13)) {
            g.won = true;
            g.elapsed = elapsed();
            g.startedAt = null;
            stats.played++;
            stats.won++;
            stats.streak++;
            stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
            if (stats.best === null || g.elapsed < stats.best) stats.best = g.elapsed;
            if (navigator.vibrate) { try { navigator.vibrate([30, 60, 30, 60, 60]); } catch (e) { /* unsupported */ } }
        }
    }

    const canAutoComplete = () => !g.won && !g.stock.length && !g.waste.length && g.tab.every((col) => col.every((c) => c.up));
    function autoComplete() {
        clearTimeout(autoTimer);
        const step = () => {
            if (g.won) return;
            for (let col = 0; col < 7; col++) {
                const pile = g.tab[col];
                if (pile.length && tryMove({ from: 'tab', col, idx: pile.length - 1 }, { to: 'found' })) {
                    autoTimer = setTimeout(step, 90);
                    return;
                }
            }
        };
        step();
    }

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

    function cardEl(c) {
        const e = el('div', 'card-sol' + (c.up ? (red(c) ? ' up red' : ' up') : ' down'));
        if (c.up) {
            e.appendChild(el('span', 'corner', RANK[c.r] + SYM[c.s]));
            e.appendChild(el('span', 'pip', SYM[c.s]));
            e.setAttribute('aria-label', RANK[c.r] + ' ' + SYM[c.s]);
        }
        return e;
    }

    function fmtTime(ms) {
        const s = Math.floor(ms / 1000);
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }

    function render() {
        board.replaceChildren();
        const W = Math.min(board.clientWidth, 640);
        const gap = W < 420 ? 4 : 8;
        const cw = Math.floor((W - 6 * gap) / 7);
        const ch = Math.round(cw * 1.42);
        board.style.setProperty('--cw', cw + 'px');
        const x = (i) => i * (cw + gap) + (board.clientWidth - W) / 2;
        const place = (node, left, top, z) => {
            node.style.left = left + 'px';
            node.style.top = top + 'px';
            node.style.width = cw + 'px';
            node.style.height = ch + 'px';
            if (z !== undefined) node.style.zIndex = z;
            board.appendChild(node);
            return node;
        };

        // stock
        const stock = place(el('button', 'slot stock' + (g.stock.length ? '' : ' empty')), x(0), 0);
        stock.setAttribute('aria-label', t('sol_stock'));
        stock.textContent = g.stock.length ? '' : '↻';
        if (g.stock.length) stock.appendChild(cardEl(g.stock[g.stock.length - 1]));
        stock.addEventListener('click', drawFromStock);

        // waste (last three fanned)
        const shown = g.waste.slice(-(g.draw === 3 ? 3 : 1));
        shown.forEach((c, i) => {
            const node = place(cardEl(c), x(1) + i * Math.round(cw * 0.32), 0, 10 + i);
            if (i === shown.length - 1) bindCard(node, { from: 'waste' });
        });

        // foundations
        SUITS.forEach((s, i) => {
            const pile = g.found[s];
            const slot = place(el('div', 'slot found', SYM[s]), x(3 + i), 0);
            slot.classList.toggle('red', s === 'h' || s === 'd');
            slot.addEventListener('click', () => { if (selected) tryMove(selected, { to: 'found' }); });
            if (pile.length) bindCard(place(cardEl(pile[pile.length - 1]), x(3 + i), 0, 5), { from: 'found', s });
        });

        // tableau: offsets shrink so long columns fit the screen
        const top0 = ch + 14;
        const avail = Math.max(ch * 2, board.clientHeight - top0 - 6);
        g.tab.forEach((col, ci) => {
            const slot = place(el('div', 'slot tab'), x(ci), top0);
            slot.addEventListener('click', () => { if (selected) tryMove(selected, { to: 'tab', col: ci }); });
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
                if (c.up) bindCard(node, { from: 'tab', col: ci, idx });
                if (selected && selected.from === 'tab' && selected.col === ci && idx >= selected.idx) node.classList.add('picked');
                y += c.up ? ou : od;
            });
        });
        if (selected && selected.from !== 'tab') {
            const nodes = board.querySelectorAll('.card-sol.up');
            nodes.forEach((n) => { if (n.dataset.src === JSON.stringify(selected)) n.classList.add('picked'); });
        }

        $('sol-moves').textContent = String(g.moves);
        $('sol-time').textContent = fmtTime(elapsed());
        $('sol-undo').disabled = !undoStack.length || g.won;
        $('sol-auto').hidden = !canAutoComplete();
        $('sol-draw').textContent = settings.draw === 3 ? t('sol_draw3') : t('sol_draw1');
        $('sol-stats').textContent = t('sol_stats', { won: stats.won, played: stats.played })
            + (stats.best !== null ? '  ' + t('sol_best', { time: fmtTime(stats.best) }) : '');
        renderOverlay();
    }

    function bindCard(node, src) {
        node.dataset.src = JSON.stringify(src);
        let pressTimer = null;
        let long = false;
        node.addEventListener('pointerdown', () => {
            long = false;
            pressTimer = setTimeout(() => {
                long = true;
                selected = src;
                if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) { /* unsupported */ } }
                render();
            }, 450);
        });
        const cancel = () => clearTimeout(pressTimer);
        node.addEventListener('pointerup', cancel);
        node.addEventListener('pointerleave', cancel);
        node.addEventListener('contextmenu', (e) => e.preventDefault());
        node.addEventListener('click', (e) => {
            e.stopPropagation();
            if (long) return;                      // the long press already picked it
            if (selected) {
                // tapping a card while something is picked: drop onto that card's pile
                const target = src.from === 'tab' ? { to: 'tab', col: src.col } : src.from === 'found' ? { to: 'found' } : null;
                const was = selected;
                if (target && !(was.from === src.from && was.col === src.col && was.idx === src.idx) && tryMove(was, target)) return;
                selected = null;
                render();
                return;
            }
            const dst = bestMove(src);
            if (dst) tryMove(src, dst);
            else { node.classList.remove('shake'); void node.offsetWidth; node.classList.add('shake'); }
        });
    }

    function renderOverlay() {
        const ov = $('overlay');
        ov.replaceChildren();
        ov.hidden = !(g.won || sheet);
        if (g.won && !sheet) {
            const box = el('div', 'win');
            box.appendChild(el('h2', null, t('sol_won')));
            box.appendChild(el('p', null, t('sol_won_d', { time: fmtTime(g.elapsed), moves: g.moves })));
            if (stats.streak > 1) box.appendChild(el('p', 'muted', t('sol_streak', { n: stats.streak })));
            const b = el('button', 'btn primary', t('sol_new'));
            b.addEventListener('click', newGame);
            box.appendChild(b);
            ov.appendChild(box);
            return;
        }
        if (!sheet) return;
        const box = el('div', 'win');
        const close = () => { sheet = null; render(); };
        if (sheet === 'new') {
            box.appendChild(el('p', null, t('sol_new_q')));
            const row = el('div', 'row2');
            const c = el('button', 'btn', t('cancel')); c.addEventListener('click', close);
            const ok = el('button', 'btn primary', t('sol_new')); ok.addEventListener('click', () => { sheet = null; newGame(); });
            row.append(c, ok);
            box.appendChild(row);
        } else if (sheet === 'help') {
            box.appendChild(el('h2', null, t('help')));
            t('sol_help').split('\n').forEach((p) => box.appendChild(el('p', null, p)));
            const c = el('button', 'btn primary', t('close')); c.addEventListener('click', close);
            box.appendChild(c);
        } else if (sheet === 'lang') {
            box.appendChild(el('h2', null, t('language')));
            Object.entries(LANGS).forEach(([code, label]) => {
                const b = el('button', 'btn' + (code === lang ? ' primary' : ''), label);
                b.addEventListener('click', () => { lang = code; store.set('spia_lang', code); document.documentElement.lang = code; applyStatic(); close(); });
                box.appendChild(b);
            });
        }
        ov.appendChild(box);
    }

    function applyStatic() {
        document.title = t('sol_title');
        $('sol-title').textContent = t('sol_title');
        $('sol-new').textContent = t('sol_new');
        $('sol-undo').textContent = t('nh_undo');
        $('sol-auto').textContent = t('sol_auto');
        $('sol-moves-l').textContent = t('sol_moves');
        $('sol-time-l').textContent = t('sol_time');
        $('sol-lang').textContent = lang.toUpperCase();
    }

    // ---------- wiring ----------
    $('sol-new').addEventListener('click', () => { if (g.moves > 0 && !g.won) { sheet = 'new'; render(); } else newGame(); });
    $('sol-undo').addEventListener('click', undo);
    $('sol-auto').addEventListener('click', autoComplete);
    $('sol-draw').addEventListener('click', () => {
        settings.draw = settings.draw === 1 ? 3 : 1;
        saveAll();
        render();
        if (g.moves === 0) newGame();   // fresh deal: apply right away; otherwise from the next game
    });
    $('sol-help').addEventListener('click', () => { sheet = 'help'; render(); });
    $('sol-lang').addEventListener('click', () => { sheet = 'lang'; render(); });
    board.addEventListener('click', () => { if (selected) { selected = null; render(); } });
    window.addEventListener('resize', () => render());
    document.addEventListener('visibilitychange', () => { if (g) { if (document.hidden) saveAll(); } });
    setInterval(() => { if (g && g.startedAt && !g.won && !document.hidden) $('sol-time').textContent = fmtTime(elapsed()); }, 1000);

    document.documentElement.lang = lang;
    applyStatic();
    if (!g || !g.tab) newGame();
    else { if (g.startedAt) g.startedAt = Date.now(); render(); }
})();
