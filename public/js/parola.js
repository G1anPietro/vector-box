// js/parola.js — "Parola del giorno": the page (board, keyboard, daily/free modes, stats, share). The rules are in parola-logic.js.
(function () {
    'use strict';
    VBI18N.add('it', {
        title: 'Parola del giorno — vector-box', desc: 'Indovina la parola italiana di 5 lettere in 6 tentativi: una nuova ogni giorno, oppure gioca libero. Serie di vittorie e statistiche, nessun account.',
        back: '← Giochi', new: 'Nuova', daily: 'Del giorno', free: 'Libera', mode: 'Modalità', board: 'Tabellone', keyboard: 'Tastiera', enter: 'Invio', del: 'Cancella',
        streak: 'Serie', played: 'Partite', wins: 'Vinte', share: 'Condividi', stats: 'Statistiche',
        help: 'Indovina la parola di 5 lettere in 6 tentativi. Dopo ogni tentativo: ● lettera giusta al posto giusto, ◆ lettera nella parola ma altrove, × lettera assente. Vale solo una parola italiana (senza accenti).',
        t_c: 'giusta', t_p: 'altrove', t_a: 'assente', t_empty: 'vuota', k_state: '{l}: {s}',
        short: 'Servono 5 lettere.', unknown: 'Parola non in elenco.', won: 'Bravo! Indovinata in {n} tentativi.', lost: 'Peccato! La parola era: {w}', done_today: 'Hai già giocato oggi. Torna domani per la prossima.',
        copied: 'Risultato copiato negli appunti.', nocopy: 'Non riesco a copiare: seleziona il testo a mano.', share_title: 'Parola del giorno', free_title: 'Parola libera', dist: 'Tentativi: {d}',
    });
    VBI18N.add('en', {
        t_c: 'right place', t_p: 'elsewhere', t_a: 'absent', t_empty: 'empty', k_state: '{l}: {s}',
        short: 'Five letters are needed.', unknown: 'Not in the word list.', won: 'Well done! Solved in {n} tries.', lost: 'Too bad! The word was: {w}', done_today: 'You already played today. Come back tomorrow for the next one.',
        copied: 'Result copied to the clipboard.', nocopy: 'Cannot copy: select the text by hand.', share_title: 'Parola del giorno', free_title: 'Parola libera', dist: 'Tries: {d}',
    });

    document.addEventListener('DOMContentLoaded', () => {
        const $ = (id) => document.getElementById(id);
        const board = $('pa-board');
        if (!board) return;
        const L = window.ParolaLogic, W = window.ParolaWords, T = (k, v) => VBLang.t(k, v);
        const accepted = new Set(W.ANSWERS.concat(W.EXTRA));
        const SYM = { c: '●', p: '◆', a: '×' };
        const DAILY_KEY = 'vb_parola_daily', STATS_KEY = 'vb_parola_stats';
        const load = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
        const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } };

        let mode = 'daily', answer = '', guesses = [], cur = '', over = false, msgKey = null, msgVars = null, today = 0;
        let stats = Object.assign(L.EMPTY(), load(STATS_KEY) || {});

        const rows = [];
        for (let r = 0; r < L.TRIES; r++) {
            const row = document.createElement('div'); row.className = 'pa-row'; row.setAttribute('role', 'row');
            const cells = [];
            for (let c = 0; c < L.LEN; c++) { const t = document.createElement('div'); t.className = 'pa-tile'; t.setAttribute('role', 'cell'); row.append(t); cells.push(t); }
            board.append(row); rows.push(cells);
        }
        const keys = {};
        function key(label, action, wide) {
            const b = document.createElement('button'); b.type = 'button'; b.className = 'pa-key' + (wide ? ' wide' : ''); b.dataset.k = action; b.textContent = label;
            keys[action] = b; return b;
        }
        ['qwertyuiop', 'asdfghjkl', '+zxcvbnm-'].forEach((line) => {
            const row = document.createElement('div'); row.className = 'pa-krow';
            for (const ch of line) {
                if (ch === '+') { const b = key('', 'enter', true); b.dataset.i18n = 'enter'; row.append(b); }
                else if (ch === '-') { const b = key('⌫', 'back', true); b.setAttribute('aria-label', T('del')); b.dataset.i18nAttr = 'aria-label:del'; row.append(b); }
                else row.append(key(ch, ch));
            }
            $('pa-keys').append(row);
        });
        keys.enter.textContent = T('enter');

        const scores = () => guesses.map((g) => L.score(g, answer));
        const say = (k, v) => { msgKey = k; msgVars = v || null; $('pa-msg').textContent = k ? T(k, v) : ''; };

        function paint() {
            const sc = scores();
            for (let r = 0; r < L.TRIES; r++) for (let c = 0; c < L.LEN; c++) {
                const t = rows[r][c], g = guesses[r], typing = r === guesses.length && !over;
                const ch = g ? g[c] : (typing ? cur[c] || '' : '');
                t.textContent = ch.toUpperCase();
                const s = g ? sc[r][c] : '';
                t.className = 'pa-tile' + (s ? ' ' + s : '') + (!g && ch ? ' typed' : '');
                if (s) t.dataset.m = SYM[s]; else delete t.dataset.m;
                t.setAttribute('aria-label', ch ? ch.toUpperCase() + (s ? ', ' + T('t_' + s) : '') : T('t_empty'));
            }
            const ks = L.keyStates(guesses, sc);
            for (const a in keys) if (a.length === 1) {
                const s = ks[a] || '';
                keys[a].className = 'pa-key' + (s ? ' ' + s : '');
                if (s) keys[a].dataset.m = SYM[s]; else delete keys[a].dataset.m;
                keys[a].setAttribute('aria-label', s ? T('k_state', { l: a.toUpperCase(), s: T('t_' + s) }) : a.toUpperCase());
            }
            $('pa-streak').textContent = String(L.shownStreak(stats, today));
            $('pa-played').textContent = String(stats.played);
            $('pa-winpct').textContent = stats.played ? Math.round(stats.won * 100 / stats.played) + '%' : '—';
            $('pa-dist').textContent = T('dist', { d: stats.dist.join(' · ') });
            $('pa-share').hidden = !over;
            document.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.mode === mode)));
            $('pa-new').hidden = mode !== 'free';
            $('pa-msg').textContent = msgKey ? T(msgKey, msgVars) : '';
        }

        function finish(won) {
            over = true;
            if (mode === 'daily') { stats = L.addResult(stats, today, won, guesses.length); save(STATS_KEY, stats); }
            if (won) say('won', { n: guesses.length }); else say('lost', { w: answer.toUpperCase() });
        }

        function persist() { if (mode === 'daily') save(DAILY_KEY, { day: today, guesses, over }); }

        function submit() {
            if (over) return;
            if (cur.length < L.LEN) { say('short'); paint(); return; }
            if (!accepted.has(cur)) { say('unknown'); paint(); return; }
            guesses.push(cur); cur = '';
            const won = guesses[guesses.length - 1] === answer;
            say(null);
            if (won || guesses.length >= L.TRIES) finish(won);
            persist(); paint();
        }

        function press(k) {
            if (over) return;
            if (k === 'enter') return submit();
            if (k === 'back') cur = cur.slice(0, -1);
            else if (/^[a-z]$/.test(k) && cur.length < L.LEN) cur += k;
            else return;
            say(null); paint();
        }

        function start(m) {
            mode = m; cur = ''; say(null);
            today = L.dayNumber(new Date());
            if (m === 'daily') {
                answer = L.dailyWord(new Date(), W.ANSWERS);
                const s = load(DAILY_KEY);
                // a saved game counts only if it is today's and every word in it is still valid (a tampered value is ignored)
                const ok = s && s.day === today && Array.isArray(s.guesses) && s.guesses.length <= L.TRIES && s.guesses.every((g) => typeof g === 'string' && /^[a-z]{5}$/.test(g));
                guesses = ok ? s.guesses.slice() : [];
                over = ok && (guesses[guesses.length - 1] === answer || guesses.length >= L.TRIES);
                if (over) say(guesses[guesses.length - 1] === answer ? 'won' : 'lost', guesses[guesses.length - 1] === answer ? { n: guesses.length } : { w: answer.toUpperCase() });
            } else {
                answer = W.ANSWERS[Math.floor(Math.random() * W.ANSWERS.length)];
                guesses = []; over = false;
            }
            paint();
        }

        async function share() {
            const won = guesses[guesses.length - 1] === answer;
            const text = L.shareText(T(mode === 'daily' ? 'share_title' : 'free_title'), mode === 'daily' ? L.puzzleNumber(new Date()) : 0, scores(), won);
            try {
                if (navigator.share) { await navigator.share({ text }); return; }
            } catch (e) { if (e && e.name === 'AbortError') return; }
            try { await navigator.clipboard.writeText(text); say('copied'); } catch (e) { say('nocopy'); }
            paint();
        }

        $('pa-keys').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) press(b.dataset.k); });
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            if (e.target.closest && e.target.closest('button') && (e.key === 'Enter' || e.key === ' ')) return;   // let a focused button act
            if (e.key === 'Enter') { e.preventDefault(); press('enter'); }
            else if (e.key === 'Backspace') { e.preventDefault(); press('back'); }
            else if (/^[a-zA-Z]$/.test(e.key)) press(e.key.toLowerCase());
        });
        document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => start(b.dataset.mode)));
        $('pa-new').addEventListener('click', () => start('free'));
        $('pa-share').addEventListener('click', share);
        window.addEventListener('vb-lang', () => { keys.enter.textContent = T('enter'); paint(); });
        start('daily');
    });
})();
