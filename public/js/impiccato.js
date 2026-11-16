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

    function pick(category, rng, not) {
        const cats = Object.keys(WORDS);
        const cat = category in WORDS ? category : cats[Math.floor((rng || Math.random)() * cats.length)];
        const list = WORDS[cat].filter((w) => w !== not);
        return { word: list[Math.floor((rng || Math.random)() * list.length)], category: cat };
    }

    const api = { LIVES, WORDS, norm, newGame, guess, shown, pick };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
    root.Impiccato = api;

    document.addEventListener('DOMContentLoaded', () => {
        const $ = (id) => document.getElementById(id);
        const kb = $('im-keys');
        if (!kb) return;
        const KEY = 'vb_impiccato';
        let g, category = 'tutte', last = null;
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
            $('im-cat').textContent = g.category;
            $('im-lives').textContent = String(g.lives);
            $('im-stat').textContent = `${stat.w} vinte · ${stat.l} perse · serie ${stat.streak} (record ${stat.best})`;
            for (const L in keys) { const k = keys[L]; k.disabled = g.status !== 'play' || g.guessed.includes(L) || g.wrong.includes(L); k.className = 'key' + (g.guessed.includes(L) ? ' hit' : g.wrong.includes(L) ? ' miss' : ''); }
            draw();
        }
        function end() {
            if (g.status === 'won') { stat.w++; stat.streak++; stat.best = Math.max(stat.best, stat.streak); $('im-msg').textContent = 'Bravo, hai indovinato!'; }
            else { stat.l++; stat.streak = 0; $('im-msg').textContent = 'Era: ' + g.word; }
            save();
        }
        function press(L) { const r = guess(g, L); if (r === 'ignored' || r === 'again') return; paint(); if (g.status !== 'play') { end(); paint(); } }
        function start() {
            const p = pick(category, null, last);
            last = p.word; g = newGame(p.word, p.category);
            $('im-msg').textContent = ''; paint();
        }
        kb.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) press(b.dataset.l); });
        document.addEventListener('keydown', (e) => { if (e.ctrlKey || e.metaKey || e.altKey) return; if (/^[a-zA-Z]$/.test(e.key)) press(e.key); });
        $('im-new').addEventListener('click', start);
        $('im-category').addEventListener('change', (e) => { category = e.target.value; start(); });
        start();
    });
})(typeof window !== 'undefined' ? window : globalThis);
