// js/botola.js — Botola: a quiz where you fall. One phone passed around. A wrong answer (or time out) opens the trapdoor: you
// are out. Last one standing wins.
// The rules (no DOM) are at the top and can be tested from Node.
(function (root) {
    'use strict';
    // The questions live in js/botola-q-it.js and js/botola-q-en.js (same order, so the language can change mid-game):
    // [difficulty 0 easy / 1 medium / 2 hard, question, right answer, 3 wrong answers]. Source: Open Trivia DB (CC BY-SA 4.0).
    const DATA = () => ({ it: root.BotolaQ_it || [], en: root.BotolaQ_en || [] });

    const rand = (rng) => (rng || Math.random)();
    function shuffle(a, rng) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand(rng) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
    /** The question at `i` ready to ask: the four answers shuffled, `right` is the index of the correct one. */
    function ask(data, i, lang, rng) {
        const [, q, c, ...w] = (data[lang] || data.en)[i];
        const opts = shuffle([c, ...w], rng);
        return { text: q, options: opts, right: opts.indexOf(c) };
    }
    /** Levels: easy / normal / hard use that difficulty only; rising goes easy, then medium, then hard as the rounds pass. */
    const LEVELS = { easy: { time: 15 }, normal: { time: 12 }, hard: { time: 9 }, rising: { time: 12 } };
    function difficultyFor(level, round) { return level === 'easy' ? 0 : level === 'hard' ? 2 : level === 'rising' ? Math.min(2, Math.floor((round - 1) / 2)) : 1; }

    function newGame(names, level, data, rng) {
        const players = names.map((n) => String(n).trim()).filter(Boolean).slice(0, 8);
        if (players.length < 2) return null;
        const decks = [0, 1, 2].map((d) => shuffle(data.en.map((q, i) => (q[0] === d ? i : -1)).filter((i) => i >= 0), rng));
        return { players: players.map((name) => ({ name, out: false })), level: LEVELS[level] ? level : 'rising', data, decks, round: 1, turn: 0, fell: [], played: 0, winner: null, phase: 'ready' };
    }
    const alive = (g) => g.players.map((p, i) => (p.out ? -1 : i)).filter((i) => i >= 0);
    function nextTurn(g) {
        const a = alive(g);
        g.played++;
        if (g.played >= g.roundSize) return endRound(g);
        g.turn = a[(a.indexOf(g.turn) + 1) % a.length];
        g.phase = 'ready';
    }
    function endRound(g) {
        // everybody still standing would fall: nobody does, the round counts as a draw
        g.nobody = g.fell.length > 0 && g.fell.length === g.roundSize;
        if (g.nobody) g.fell.forEach((i) => { g.players[i].out = false; });
        const a = alive(g);
        g.nobody = g.nobody || false; g.fell = []; g.played = 0; g.round++;
        if (a.length === 1) { g.winner = a[0]; g.phase = 'over'; return; }
        g.roundSize = a.length; g.turn = a[0]; g.phase = 'ready';
    }
    /** Start the turn: takes the next question of the level (an empty pile falls back to the next easier one). */
    function begin(g) {
        g.roundSize = g.roundSize || alive(g).length;
        let d = difficultyFor(g.level, g.round);
        while (!g.decks[d].length && d > 0) d--;
        while (!g.decks[d].length && d < 2) d++;
        g.q = g.decks[d].shift(); g.nobody = false; g.phase = 'question'; return g.q;
    }
    /** Answer given (right = true/false; time out = false). Wrong: the trapdoor opens and the player is out. */
    function answer(g, right) {
        if (right) { nextTurn(g); return 'safe'; }
        g.players[g.turn].out = true; g.fell.push(g.turn); nextTurn(g); return 'fell';
    }

    const api = { ask, newGame, alive, begin, answer, shuffle, difficultyFor, LEVELS };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
    root.Botola = api;

    VBI18N.add('it', {
        title: 'Botola — vector-box', desc: 'Botola, il quiz in cui si cade: un telefono da passare, risposta sbagliata e la botola si apre. Gratis, senza account.',
        back: '← Giochi', h1: 'Botola', new: 'Nuova', help: 'Un telefono da passare, da 2 a 8 giocatori. Rispondi in tempo (da 15 a 9 secondi, secondo la difficoltà): se sbagli o scade il tempo la botola si apre e sei fuori. Resta in piedi l’ultimo.',
        players: 'Giocatori', level: 'Difficoltà', lv_easy: 'Facile', lv_normal: 'Normale', lv_hard: 'Difficile', lv_rising: 'Crescente', name: 'Nome', add: 'Aggiungi', start: 'Via!', need: 'Servono almeno 2 giocatori.', remove: 'Togli {n}',
        pass: 'Passa il telefono a', ready: 'Sono pronto', round: 'Giro {n}', left: 'in piedi: {n}', time: '{s} s',
        right: 'Giusto!', wrong: 'Sbagliato… {p} cade nella botola!', timeup: 'Tempo scaduto… {p} cade nella botola!', nobody: 'Sarebbero caduti tutti: nessuno cade questo giro.', wins: '{p} vince!', again: 'Rigioca',
    });
    VBI18N.add('en', {
        pass: 'Pass the phone to', ready: 'I am ready', round: 'Round {n}', left: 'standing: {n}', time: '{s} s',
        players: 'Players', level: 'Difficulty', lv_easy: 'Easy', lv_normal: 'Normal', lv_hard: 'Hard', lv_rising: 'Rising', name: 'Name', add: 'Add', start: 'Go!', need: 'At least 2 players are needed.', remove: 'Remove {n}',
        right: 'Right!', wrong: 'Wrong… {p} falls through the trapdoor!', timeup: 'Time is up… {p} falls through the trapdoor!', nobody: 'Everyone would have fallen: nobody falls this round.', wins: '{p} wins!', again: 'Play again',
    });

    document.addEventListener('DOMContentLoaded', () => {
        const app = document.getElementById('bo-app');
        if (!app) return;
        const T = (k, v) => VBLang.t(k, v);
        const KEY = 'vb_botola_names';
        const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 8) : ['', '']; } catch (e) { return ['', '']; } };
        const saveNames = (n) => { try { localStorage.setItem(KEY, JSON.stringify(n)); } catch (e) { /* private mode */ } };
        let names = load(); if (names.length < 2) names = ['', ''];
        let level = 'rising'; try { const l = localStorage.getItem('vb_botola_level'); if (l && api.LEVELS[l]) level = l; } catch (e) { /* private mode */ }
        let g = null, timer = null, redraw = null;
        const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
        const btn = (text, fn, cls) => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; };
        const stop = () => clearInterval(timer);
        function show(...kids) { stop(); app.replaceChildren(...kids); }
        const head = () => el('div', 'bo-head', T('round', { n: g.round }) + ' · ' + T('left', { n: api.alive(g).length }));

        function setup() {
            redraw = setup;
            const list = el('div', 'bo-names');
            names.forEach((n, i) => {
                const row = el('div', 'bo-row'); const inp = el('input'); inp.value = n; inp.maxLength = 20; inp.placeholder = T('name') + ' ' + (i + 1);
                inp.addEventListener('input', () => { names[i] = inp.value; saveNames(names); });
                row.append(inp);
                if (names.length > 2) row.append(btn('×', () => { names.splice(i, 1); saveNames(names); setup(); }));
                list.append(row);
            });
            const lv = el('div', 'ar-bar'); lv.setAttribute('role', 'group'); lv.setAttribute('aria-label', T('level'));
            Object.keys(api.LEVELS).forEach((k) => { const b = btn(T('lv_' + k), () => { level = k; try { localStorage.setItem('vb_botola_level', k); } catch (e) { /* private mode */ } setup(); }); b.setAttribute('aria-pressed', String(k === level)); lv.append(b); });
            const msg = el('div', 'ar-msg'); msg.setAttribute('role', 'status');
            const go = btn(T('start'), () => { g = api.newGame(names, level, DATA()); if (!g) { msg.textContent = T('need'); return; } turn(); }, 'bo-go');
            show(el('h2', '', T('level')), lv, el('h2', '', T('players')), list, names.length < 8 ? btn(T('add'), () => { names.push(''); setup(); }) : el('span'), go, msg);
        }
        function turn() {
            redraw = turn;
            if (g.phase === 'over') return over();
            show(head(), el('p', 'bo-pass', T('pass')), el('p', 'bo-who', g.players[g.turn].name), btn(T('ready'), question, 'bo-go'));
        }
        function question() {
            redraw = null;
            const idx = api.begin(g); const q = api.ask(g.data, idx, VBLang.lang);
            const box = el('div', 'bo-opts'); const clock = el('div', 'bo-clock');
            let left = api.LEVELS[g.level].time, done = false;
            const pickAns = (i) => { if (done) return; done = true; stop(); const ok = i === q.right, who = g.players[g.turn].name; VBFx.play(ok ? 'win' : 'lose'); api.answer(g, ok); result(ok ? 'right' : (i === null ? 'timeup' : 'wrong'), who, g.nobody); };
            q.options.forEach((o, i) => box.append(btn(o, () => pickAns(i))));
            const tick = () => { clock.textContent = T('time', { s: left }); if (left-- <= 0) pickAns(null); };
            show(head(), el('div', 'bo-who', g.players[g.turn].name), clock, el('p', 'bo-q', q.text), box);
            tick(); timer = setInterval(tick, 1000);
        }
        function result(key, who, nobody) {
            redraw = null;
            show(head(), el('p', 'bo-res', nobody ? T('nobody') : T(key, { p: who })), btn('OK', turn, 'bo-go'));
        }
        function over() {
            redraw = over;
            show(el('h2', '', T('wins', { p: g.players[g.winner].name })), btn(T('again'), setup, 'bo-go'));
        }
        document.getElementById('bo-new').addEventListener('click', setup);
        window.addEventListener('vb-lang', () => { if (redraw === setup || redraw === turn || redraw === over) redraw(); });   // the timed screens are left alone
        setup();
    });
})(typeof window !== 'undefined' ? window : globalThis);
