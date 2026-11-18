// js/impiccato.js — Impiccato (hangman) with Italian words. The rules (no DOM) are at the top and testable from Node.
(function (root) {
    'use strict';
    const LIVES = 7;
    const WORDS = {
        animali: ['ELEFANTE', 'GIRAFFA', 'COCCODRILLO', 'PIPISTRELLO', 'SCOIATTOLO', 'CAVALLO', 'FARFALLA', 'DELFINO', 'TARTARUGA', 'PAPPAGALLO', 'LEOPARDO', 'CRICETO', 'GABBIANO', 'RINOCERONTE', 'CANGURO', 'MEDUSA', 'FORMICA', 'POLPO', 'GATTO', 'LUPO', 'ORSO', 'VOLPE', 'ZEBRA', 'CAMMELLO', 'ARAGOSTA'],
        cibo: ['PIZZA', 'LASAGNE', 'TIRAMISU', 'GELATO', 'MINESTRONE', 'PANETTONE', 'CIOCCOLATO', 'FORMAGGIO', 'SPAGHETTI', 'MELANZANA', 'ZUCCHINA', 'CARCIOFO', 'FRAGOLA', 'ALBICOCCA', 'ANGURIA', 'BISCOTTO', 'FOCACCIA', 'POLENTA', 'RISOTTO', 'CAPPUCCINO', 'PEPERONCINO', 'MARMELLATA', 'ARANCINO', 'GNOCCHI'],
        citta: ['ROMA', 'MILANO', 'NAPOLI', 'TORINO', 'PALERMO', 'GENOVA', 'BOLOGNA', 'FIRENZE', 'VENEZIA', 'VERONA', 'BARI', 'CATANIA', 'TRIESTE', 'PERUGIA', 'CAGLIARI', 'PARIGI', 'LONDRA', 'MADRID', 'BERLINO', 'LISBONA', 'VIENNA', 'ATENE', 'AMSTERDAM', 'BRUXELLES'],
        scuola: ['QUADERNO', 'ZAINO', 'LAVAGNA', 'PROFESSORE', 'INTERROGAZIONE', 'COMPITO', 'RICREAZIONE', 'MATEMATICA', 'GEOGRAFIA', 'INFORMATICA', 'BIBLIOTECA', 'LABORATORIO', 'ASSEMBLEA', 'PAGELLA', 'GRAMMATICA', 'ESAME', 'LEZIONE', 'ASTUCCIO', 'CALCOLATRICE', 'VOCABOLARIO', 'TASTIERA', 'PROCESSORE', 'ALGORITMO', 'PROGRAMMA'],
        oggetti: ['OMBRELLO', 'BICICLETTA', 'TELEFONO', 'OROLOGIO', 'CHITARRA', 'VALIGIA', 'CANDELA', 'FINESTRA', 'SPECCHIO', 'LAMPADINA', 'PENNARELLO', 'FORBICI', 'BOTTIGLIA', 'CUSCINO', 'TELECOMANDO', 'CACCIAVITE', 'SCATOLA', 'PALLONE', 'AUTOBUS', 'MARTELLO', 'LIBRERIA', 'CALENDARIO', 'MICROFONO', 'TRENO'],
    };

    // English word list (used when the page language is English): same categories and keys as WORDS, letters A-Z only.
    const WORDS_EN = {
        animali: ['ELEPHANT', 'GIRAFFE', 'CROCODILE', 'PENGUIN', 'SQUIRREL', 'HORSE', 'BUTTERFLY', 'DOLPHIN', 'TORTOISE', 'PARROT', 'LEOPARD', 'HAMSTER', 'SEAGULL', 'RHINOCEROS', 'KANGAROO', 'JELLYFISH', 'ANT', 'OCTOPUS', 'CAT', 'WOLF', 'BEAR', 'FOX', 'ZEBRA', 'CAMEL', 'LOBSTER'],
        cibo: ['PIZZA', 'LASAGNA', 'PANCAKE', 'ICECREAM', 'SANDWICH', 'CHOCOLATE', 'CHEESE', 'SPAGHETTI', 'AUBERGINE', 'COURGETTE', 'ARTICHOKE', 'STRAWBERRY', 'APRICOT', 'WATERMELON', 'BISCUIT', 'BREAD', 'PORRIDGE', 'RISOTTO', 'CAPPUCCINO', 'CHILLI', 'JAM', 'BURGER', 'NOODLES', 'CEREAL'],
        citta: ['ROME', 'MILAN', 'NAPLES', 'TURIN', 'PALERMO', 'GENOA', 'BOLOGNA', 'FLORENCE', 'VENICE', 'VERONA', 'LONDON', 'PARIS', 'MADRID', 'BERLIN', 'LISBON', 'VIENNA', 'ATHENS', 'AMSTERDAM', 'BRUSSELS', 'DUBLIN', 'EDINBURGH', 'OXFORD', 'CAMBRIDGE', 'MANCHESTER'],
        scuola: ['NOTEBOOK', 'BACKPACK', 'BLACKBOARD', 'TEACHER', 'HOMEWORK', 'PLAYGROUND', 'MATHEMATICS', 'GEOGRAPHY', 'COMPUTING', 'LIBRARY', 'LABORATORY', 'ASSEMBLY', 'REPORT', 'GRAMMAR', 'EXAM', 'LESSON', 'PENCILCASE', 'CALCULATOR', 'DICTIONARY', 'KEYBOARD', 'PROCESSOR', 'ALGORITHM', 'PROGRAM', 'DESK'],
        oggetti: ['UMBRELLA', 'BICYCLE', 'TELEPHONE', 'WATCH', 'GUITAR', 'SUITCASE', 'CANDLE', 'WINDOW', 'MIRROR', 'LIGHTBULB', 'MARKER', 'SCISSORS', 'BOTTLE', 'CUSHION', 'REMOTE', 'SCREWDRIVER', 'BOX', 'BALLOON', 'HAMMER', 'BOOKSHELF', 'CALENDAR', 'MICROPHONE', 'TRAIN', 'LADDER'],
    };

    /** Letters without accents, upper case: "è" counts as E. */
    const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

    function newGame(word, category) {
        return { word: norm(word), category: category || '', guessed: [], wrong: [], lives: LIVES, status: 'play' };
    }

    /** Tries a letter. Returns 'hit' | 'miss' | 'again' (already tried) | 'ignored' (not a letter, or the game is over). */
    function guess(g, letter) {
        const l = norm(letter);
        if (g.status !== 'play' || !/^[A-Z]$/.test(l)) return 'ignored';
        if (g.guessed.includes(l) || g.wrong.includes(l)) return 'again';
        if (g.word.includes(l)) {
            g.guessed.push(l);
            if ([...g.word].every((ch) => g.guessed.includes(ch))) g.status = 'won';
            return 'hit';
        }
        g.wrong.push(l); g.lives--;
        if (g.lives <= 0) g.status = 'lost';
        return 'miss';
    }

    /** The word as it is known so far: "_ A _ _ A". */
    const shown = (g) => [...g.word].map((ch) => (g.guessed.includes(ch) || g.status === 'lost' ? ch : '_')).join(' ');

    /** A random word; `lang` 'en' uses the English list, anything else the Italian one. */
    function pick(category, rng, not, lang) {
        const words = lang === 'en' ? WORDS_EN : WORDS;
        const cats = Object.keys(words);
        const cat = category in words ? category : cats[Math.floor((rng || Math.random)() * cats.length)];
        const list = words[cat].filter((w) => w !== not);
        return { word: list[Math.floor((rng || Math.random)() * list.length)], category: cat };
    }

    const api = { LIVES, WORDS, WORDS_EN, norm, newGame, guess, shown, pick };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
    root.Impiccato = api;
    VBI18N.add('it', {
        title: 'Impiccato — vector-box', desc: 'Impiccato gratis nel browser con parole italiane: animali, cibo, città, scuola e oggetti. Indovina la parola prima di finire le vite. Nessun account.',
        back: '← Giochi', h1: 'Impiccato', new: 'Nuova', topic: 'Argomento', cat_tutte: 'Tutti', cat_animali: 'Animali', cat_cibo: 'Cibo', cat_citta: 'Città', cat_scuola: 'Scuola', cat_oggetti: 'Oggetti',
        lives: 'Vite', drawing: "Il disegno dell'impiccato", keyboard: 'Tastiera', help: 'Tocca le lettere (o usa la tastiera del computer). Ogni errore aggiunge un pezzo al disegno: hai 7 vite.',
        stat: '{w} vinte · {l} perse · serie {s} (record {b})', m_won: 'Bravo, hai indovinato!', m_was: 'Era: {w}',
    });
    VBI18N.add('en', {
        cat_animali: 'Animals', cat_cibo: 'Food', cat_citta: 'Cities', cat_scuola: 'School', cat_oggetti: 'Objects',
        stat: '{w} won · {l} lost · streak {s} (best {b})', m_won: 'Well done, you guessed it!', m_was: 'It was: {w}',
    });

    document.addEventListener('DOMContentLoaded', () => {
        const $ = (id) => document.getElementById(id);
        const kb = $('im-keys');
        if (!kb) return;
        const KEY = 'vb_impiccato';
        let g, category = 'tutte', last = null, wordLang = 'it', msg = null;
        const stat = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || { w: 0, l: 0, streak: 0, best: 0 }; } catch (e) { return { w: 0, l: 0, streak: 0, best: 0 }; } })();
        const save = () => { try { localStorage.setItem(KEY, JSON.stringify(stat)); } catch (e) { /* private mode */ } };
        const keys = {};
        for (const L of 'QWERTYUIOPASDFGHJKLZXCVBNM') { const b = document.createElement('button'); b.type = 'button'; b.textContent = L; b.className = 'key'; b.dataset.l = L; kb.append(b); keys[L] = b; }

        function draw() {          // the gallows grows with every mistake (7 steps): base, pole, beam, rope, head, body, legs and arms at the end
            const n = LIVES - g.lives;
            const parts = ['M10 150h100', 'M35 150V15', 'M35 15h65', 'M100 15v25', 'c', 'M100 70v40', 'M100 80l-18 15M100 80l18 15M100 110l-16 28M100 110l16 28'];
            const svg = $('im-svg');
            svg.replaceChildren();
            parts.slice(0, n).forEach((d) => {
                if (d === 'c') { const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); c.setAttribute('cx', '100'); c.setAttribute('cy', '55'); c.setAttribute('r', '15'); svg.append(c); return; }
                const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); svg.append(p);
            });
        }
        function paint() {
            $('im-word').textContent = shown(g);
            $('im-cat').textContent = VBLang.t('cat_' + g.category);
            $('im-lives').textContent = String(g.lives);
            $('im-stat').textContent = VBLang.t('stat', { w: stat.w, l: stat.l, s: stat.streak, b: stat.best });
            $('im-msg').textContent = msg ? VBLang.t(msg[0], msg[1]) : '';
            for (const L in keys) { const k = keys[L]; k.disabled = g.status !== 'play' || g.guessed.includes(L) || g.wrong.includes(L); k.className = 'key' + (g.guessed.includes(L) ? ' hit' : g.wrong.includes(L) ? ' miss' : ''); }
            draw();
        }
        function end() {
            VBFx.play(g.status === 'won' ? 'win' : 'lose');
            if (g.status === 'won') { stat.w++; stat.streak++; stat.best = Math.max(stat.best, stat.streak); msg = ['m_won']; }
            else { stat.l++; stat.streak = 0; msg = ['m_was', { w: g.word }]; }
            save();
        }
        function press(L) { const r = guess(g, L); if (r === 'ignored' || r === 'again') return; if (g.status === 'play') VBFx.play(r === 'miss' ? 'bad' : 'good'); paint(); if (g.status !== 'play') { end(); paint(); } }
        function start() {
            wordLang = VBLang.lang === 'en' ? 'en' : 'it';
            const p = pick(category, null, last, wordLang);
            last = p.word; g = newGame(p.word, p.category);
            msg = null; paint();
        }
        kb.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) press(b.dataset.l); });
        document.addEventListener('keydown', (e) => { if (e.ctrlKey || e.metaKey || e.altKey) return; if (/^[a-zA-Z]$/.test(e.key)) press(e.key); });
        $('im-new').addEventListener('click', start);
        $('im-category').addEventListener('change', (e) => { category = e.target.value; start(); });
        // the word list follows the language: a new word when it changes (the old one would be in the wrong language)
        window.addEventListener('vb-lang', () => { if ((VBLang.lang === 'en' ? 'en' : 'it') !== wordLang) start(); else paint(); });
        start();
    });
})(typeof window !== 'undefined' ? window : globalThis);
