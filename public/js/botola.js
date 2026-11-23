// js/botola.js — Botola: a quiz where you fall. One phone passed around. A wrong answer (or time out) opens the trapdoor: you
// are out. Last one standing wins.
// The rules (no DOM) are at the top and can be tested from Node.
(function (root) {
    'use strict';
    // [question it, question en, right answer, 3 wrong ones]; "it|en" where the answer is written differently
    const Q = [
        ['Qual è la capitale dell’Australia?', 'What is the capital of Australia?', 'Canberra', 'Sydney', 'Melbourne', 'Perth'],
        ['Qual è il pianeta più piccolo del sistema solare?', 'What is the smallest planet in the solar system?', 'Mercurio|Mercury', 'Marte|Mars', 'Venere|Venus', 'Plutone|Pluto'],
        ['Qual è l’oceano più grande?', 'What is the largest ocean?', 'Pacifico|Pacific', 'Atlantico|Atlantic', 'Indiano|Indian', 'Artico|Arctic'],
        ['Qual è il simbolo chimico dell’oro?', 'What is the chemical symbol of gold?', 'Au', 'Ag', 'Or', 'Go'],
        ['Chi scrisse «I promessi sposi»?', 'Who wrote “The Betrothed” (I promessi sposi)?', 'Manzoni', 'Leopardi', 'Verga', 'Foscolo'],
        ['In che anno l’uomo mise piede sulla Luna?', 'In what year did people first walk on the Moon?', '1969', '1959', '1972', '1965'],
        ['Chi dipinse la Gioconda?', 'Who painted the Mona Lisa?', 'Leonardo da Vinci', 'Michelangelo', 'Raffaello|Raphael', 'Botticelli'],
        ['Quanti giocatori in campo per squadra nel calcio?', 'How many players per team are on the pitch in football?', '11', '10', '12', '9'],
        ['Qual è il fiume più lungo d’Italia?', 'What is the longest river in Italy?', 'Po', 'Tevere|Tiber', 'Adige', 'Arno'],
        ['A che temperatura bolle l’acqua al livello del mare?', 'At what temperature does water boil at sea level?', '100 °C', '90 °C', '110 °C', '80 °C'],
        ['Qual è l’animale terrestre più veloce?', 'What is the fastest land animal?', 'Ghepardo|Cheetah', 'Leone|Lion', 'Cavallo|Horse', 'Lepre|Hare'],
        ['Chi scrisse la «Divina Commedia»?', 'Who wrote the “Divine Comedy”?', 'Dante', 'Petrarca|Petrarch', 'Boccaccio', 'Ariosto'],
        ['Qual è la capitale della Spagna?', 'What is the capital of Spain?', 'Madrid', 'Barcellona|Barcelona', 'Siviglia|Seville', 'Valencia'],
        ['Qual è il mammifero più grande?', 'What is the largest mammal?', 'Balenottera azzurra|Blue whale', 'Elefante|Elephant', 'Orca', 'Capodoglio|Sperm whale'],
        ['Qual è la radice quadrata di 144?', 'What is the square root of 144?', '12', '14', '11', '16'],
        ['Qual è la moneta del Giappone?', 'What is the currency of Japan?', 'Yen', 'Won', 'Yuan', 'Baht'],
        ['Quanti tasti ha un pianoforte?', 'How many keys does a piano have?', '88', '76', '92', '64'],
        ['Qual è la montagna più alta del mondo?', 'What is the highest mountain in the world?', 'Everest', 'K2', 'Kilimangiaro|Kilimanjaro', 'Monte Bianco|Mont Blanc'],
        ['Quante corde ha una chitarra classica?', 'How many strings does a classical guitar have?', '6', '4', '5', '7'],
        ['Chi dipinse «Notte stellata»?', 'Who painted “The Starry Night”?', 'Van Gogh', 'Monet', 'Picasso', 'Dalí'],
        ['Quale pianeta è chiamato il pianeta rosso?', 'Which planet is called the red planet?', 'Marte|Mars', 'Giove|Jupiter', 'Venere|Venus', 'Saturno|Saturn'],
        ['Quanti giorni ha un anno bisestile?', 'How many days does a leap year have?', '366', '365', '364', '367'],
        ['Qual è la capitale del Canada?', 'What is the capital of Canada?', 'Ottawa', 'Toronto', 'Montréal', 'Vancouver'],
        ['Qual è il simbolo chimico del ferro?', 'What is the chemical symbol of iron?', 'Fe', 'Fr', 'Ir', 'Fi'],
        ['Chi raggiunse l’America nel 1492?', 'Who reached America in 1492?', 'Cristoforo Colombo|Christopher Columbus', 'Amerigo Vespucci', 'Marco Polo', 'Vasco da Gama'],
        ['Qual è lo Stato più piccolo del mondo?', 'What is the smallest country in the world?', 'Città del Vaticano|Vatican City', 'Monaco', 'San Marino', 'Liechtenstein'],
        ['Quante ossa ha un adulto?', 'How many bones does an adult have?', '206', '186', '256', '312'],
        ['Qual è l’animale più alto del mondo?', 'What is the tallest animal in the world?', 'Giraffa|Giraffe', 'Elefante|Elephant', 'Struzzo|Ostrich', 'Alce|Moose'],
        ['Quale gas assorbono le piante per la fotosintesi?', 'Which gas do plants absorb for photosynthesis?', 'Anidride carbonica|Carbon dioxide', 'Ossigeno|Oxygen', 'Azoto|Nitrogen', 'Elio|Helium'],
        ['Chi scrisse «Pinocchio»?', 'Who wrote “Pinocchio”?', 'Collodi', 'Rodari', 'De Amicis', 'Salgari'],
        ['Qual è la capitale del Portogallo?', 'What is the capital of Portugal?', 'Lisbona|Lisbon', 'Porto', 'Madrid', 'Coimbra'],
        ['Cosa misura un anno luce?', 'What does a light-year measure?', 'Una distanza|A distance', 'Un tempo|A time', 'Una velocità|A speed', 'Una luminosità|A brightness'],
        ['Quanti lati ha un esagono?', 'How many sides does a hexagon have?', '6', '5', '7', '8'],
        ['Qual è il deserto caldo più grande del mondo?', 'What is the largest hot desert in the world?', 'Sahara', 'Gobi', 'Kalahari', 'Atacama'],
        ['Chi è considerato l’inventore del telefono?', 'Who is credited with inventing the telephone?', 'Bell', 'Edison', 'Marconi', 'Tesla'],
        ['Il Sole è…', 'The Sun is…', 'Una stella|A star', 'Un pianeta|A planet', 'Una cometa|A comet', 'Un satellite'],
        ['Quali sono le prime due cifre di π?', 'What are the first digits of π?', '3,14|3.14', '3,12|3.12', '3,41|3.41', '2,14|2.14'],
        ['Quale città è famosa per la Torre pendente?', 'Which city is famous for its Leaning Tower?', 'Pisa', 'Siena', 'Bologna', 'Ravenna'],
        ['Quale elemento ha simbolo O?', 'Which element has the symbol O?', 'Ossigeno|Oxygen', 'Oro|Gold', 'Osmio|Osmium', 'Ozono|Ozone'],
    ];

    const rand = (rng) => (rng || Math.random)();
    function shuffle(a, rng) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand(rng) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
    const pick = (s, lang) => { const p = String(s).split('|'); return lang === 'it' ? p[0] : (p[1] || p[0]); };

    /** A question ready to ask: the four answers shuffled, `right` is the index of the correct one. */
    function ask(i, lang, rng) {
        const [qi, qe, ...opts] = Q[i];
        const order = shuffle([0, 1, 2, 3], rng);
        return { text: lang === 'it' ? qi : qe, options: order.map((k) => pick(opts[k], lang)), right: order.indexOf(0) };
    }

    function newGame(names, rng) {
        const players = names.map((n) => String(n).trim()).filter(Boolean).slice(0, 8);
        if (players.length < 2) return null;
        return { players: players.map((name) => ({ name, out: false })), deck: shuffle(Q.map((_, i) => i), rng), round: 1, turn: 0, fell: [], played: 0, winner: null, phase: 'ready' };
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
    /** Start the turn: takes the next question. */
    function begin(g) { g.roundSize = g.roundSize || alive(g).length; g.q = g.deck.shift(); if (g.deck.length === 0) g.deck = shuffle(Q.map((_, i) => i)); g.nobody = false; g.phase = 'question'; return g.q; }
    /** Answer given (right = true/false; time out = false). Wrong: the trapdoor opens and the player is out. */
    function answer(g, right) {
        if (right) { nextTurn(g); return 'safe'; }
        g.players[g.turn].out = true; g.fell.push(g.turn); nextTurn(g); return 'fell';
    }

    const api = { Q, ask, newGame, alive, begin, answer, shuffle };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
    root.Botola = api;

    VBI18N.add('it', {
        title: 'Botola — vector-box', desc: 'Botola, il quiz in cui si cade: un telefono da passare, risposta sbagliata e la botola si apre. Gratis, senza account.',
        back: '← Giochi', h1: 'Botola', new: 'Nuova', help: 'Un telefono da passare, da 2 a 8 giocatori. Rispondi in 12 secondi: se sbagli o scade il tempo la botola si apre e sei fuori. Resta in piedi l’ultimo.',
        players: 'Giocatori', name: 'Nome', add: 'Aggiungi', start: 'Via!', need: 'Servono almeno 2 giocatori.', remove: 'Togli {n}',
        pass: 'Passa il telefono a', ready: 'Sono pronto', round: 'Giro {n}', left: 'in piedi: {n}', time: '{s} s',
        right: 'Giusto!', wrong: 'Sbagliato… {p} cade nella botola!', timeup: 'Tempo scaduto… {p} cade nella botola!', nobody: 'Sarebbero caduti tutti: nessuno cade questo giro.', wins: '{p} vince!', again: 'Rigioca',
    });
    VBI18N.add('en', {
        pass: 'Pass the phone to', ready: 'I am ready', round: 'Round {n}', left: 'standing: {n}', time: '{s} s',
        players: 'Players', name: 'Name', add: 'Add', start: 'Go!', need: 'At least 2 players are needed.', remove: 'Remove {n}',
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
            const msg = el('div', 'ar-msg'); msg.setAttribute('role', 'status');
            const go = btn(T('start'), () => { g = api.newGame(names, Math.random); if (!g) { msg.textContent = T('need'); return; } turn(); }, 'bo-go');
            show(el('h2', '', T('players')), list, names.length < 8 ? btn(T('add'), () => { names.push(''); setup(); }) : el('span'), go, msg);
        }
        function turn() {
            redraw = turn;
            if (g.phase === 'over') return over();
            show(head(), el('p', 'bo-pass', T('pass')), el('p', 'bo-who', g.players[g.turn].name), btn(T('ready'), question, 'bo-go'));
        }
        function question() {
            redraw = null;
            const idx = api.begin(g); const q = api.ask(idx, VBLang.lang);
            const box = el('div', 'bo-opts'); const clock = el('div', 'bo-clock');
            let left = 12, done = false;
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
