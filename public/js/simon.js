// js/simon.js — Simon (repeat the sequence). The rules (no DOM) are at the top and testable from Node.
(function (root) {
    'use strict';
    const PADS = 4;

    function newGame(rng) { const g = { seq: [], pos: 0, score: 0, status: 'idle', rng: rng || Math.random }; return g; }

    /** Adds one pad to the sequence; the player must now repeat it from the start. */
    function nextRound(g) {
        g.seq.push(Math.floor(g.rng() * PADS));
        g.pos = 0; g.status = 'input';
        return g.seq;
    }

    /** The player taps a pad. 'ok' (right, more to go) | 'round' (the whole sequence repeated) | 'lost' | 'ignored'. */
    function press(g, pad) {
        if (g.status !== 'input' || !(pad >= 0 && pad < PADS)) return 'ignored';
        if (g.seq[g.pos] !== pad) { g.status = 'lost'; return 'lost'; }
        g.pos++;
        if (g.pos === g.seq.length) { g.score = g.seq.length; g.status = 'idle'; return 'round'; }
        return 'ok';
    }

    /** Milliseconds between the pads of the showing: faster as the sequence grows. */
    const pace = (len) => Math.max(260, 650 - len * 25);

    const api = { PADS, newGame, nextRound, press, pace };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
    root.Simon = api;
    VBI18N.add('it', {
        title: 'Simon — vector-box', desc: 'Simon gratis nel browser: guarda la sequenza di luci e suoni e ripetila, ogni turno una più lunga. Record personale, nessun account.',
        back: '← Giochi', go: 'Via', sequence: 'Sequenza', best: 'Record', sound: 'Suono', board: 'Quattro pulsanti colorati',
        pad_green: 'Verde (tasto 1)', pad_red: 'Rosso (tasto 2)', pad_yellow: 'Giallo (tasto 3)', pad_blue: 'Blu (tasto 4)',
        help: 'Guarda la sequenza di luci e ripetila. Ogni turno se ne aggiunge una. Sul computer puoi usare i tasti 1, 2, 3 e 4, e P per la pausa.',
        m_press: 'Premi Via per cominciare.', m_watch: 'Guarda…', m_you: 'Tocca a te', m_lost: 'Sbagliato! Sequenza di {n}. Premi Via per riprovare.', m_ok: 'Bene!', m_pause: 'In pausa: premi P o Riprendi per continuare.',
    });
    VBI18N.add('en', {
        m_press: 'Press Go to start.', m_watch: 'Watch…', m_you: 'Your turn', m_lost: 'Wrong! Sequence of {n}. Press Go to try again.', m_ok: 'Good!', m_pause: 'Paused: press P or Resume to continue.',
    });

    document.addEventListener('DOMContentLoaded', () => {
        const $ = (id) => document.getElementById(id);
        const pads = [...document.querySelectorAll('.pad')];
        if (!pads.length) return;
        const KEY = 'vb_simon_best';
        let g = newGame(), best = 0, busy = false, timers = [], pz, resumeAs = null;
        try { best = +localStorage.getItem(KEY) || 0; } catch (e) { /* private mode */ }
        if (window.VBRecords) VBRecords.sync('simon', best > 0 ? { '': best } : {}).then((m) => { if (m && m[''] > best) { best = m['']; try { localStorage.setItem(KEY, String(best)); } catch (e) { /* private mode */ } if (typeof paint === 'function') paint(); } });
        function light(i, ms) {
            pads[i].classList.add('on'); VBFx.play('pad' + i, ms);
            timers.push(setTimeout(() => pads[i].classList.remove('on'), ms));
        }
        let msg = ['m_press'];   // kept as a key (+ values) so it is redrawn when the language changes
        const say = (k, v) => { msg = [k, v]; $('sm-msg').textContent = VBLang.t(k, v); };
        function paint() { $('sm-score').textContent = String(g.score); $('sm-best').textContent = String(best); }
        function show() {
            busy = true; say('m_watch');
            const gap = pace(g.seq.length);
            g.seq.forEach((p, k) => timers.push(setTimeout(() => light(p, gap * 0.6), 500 + k * gap)));
            timers.push(setTimeout(() => { busy = false; say('m_you'); }, 500 + g.seq.length * gap));
        }
        function round() { nextRound(g); paint(); show(); }
        function start() { timers.forEach(clearTimeout); timers = []; pz.reset(); pads.forEach((p) => p.classList.remove('on')); g = newGame(); paint(); round(); }
        pads.forEach((p, i) => p.addEventListener('click', () => {
            if (pz.paused || busy || g.status !== 'input') return;
            light(i, 180);
            const r = press(g, i);
            if (r === 'lost') {
                if (g.seq.length - 1 > best) { best = g.seq.length - 1; try { localStorage.setItem(KEY, String(best)); } catch (e) { /* private mode */ } if (window.VBRecords && best > 0) VBRecords.submit('simon', '', best); }
                g.score = g.seq.length - 1; paint();
                VBFx.play('lose'); say('m_lost', { n: g.seq.length - 1 });
            } else if (r === 'round') { paint(); busy = true; say('m_ok'); timers.push(setTimeout(round, 700)); }
        }));
        document.addEventListener('keydown', (e) => { if (e.ctrlKey || e.metaKey || e.altKey) return; const i = { '1': 0, '2': 1, '3': 2, '4': 3 }[e.key]; if (i !== undefined) pads[i].click(); });
        $('sm-start').addEventListener('click', start);
        // pause: while the sequence is shown (or the next round is pending) it is cut short and restarted on resume; waiting for the player just waits
        pz = VBFx.bindPause({ button: $('sm-pause'), cover: $('sm-board'), can: () => busy || g.status === 'input',
            onPause: () => { timers.forEach(clearTimeout); timers = []; pads.forEach((p) => p.classList.remove('on')); resumeAs = busy ? (g.status === 'input' ? show : round) : null; busy = false; say('m_pause'); },
            onResume: () => { if (resumeAs) resumeAs(); else say('m_you'); resumeAs = null; } });
        window.addEventListener('vb-lang', () => say(msg[0], msg[1]));
        say('m_press'); paint();
    });
})(typeof window !== 'undefined' ? window : globalThis);
