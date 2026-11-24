// js/skillcheck.js — Skill check: a needle goes round, tap when it is inside the green zone (like the skill checks of
// Dead by Daylight). Three lives (or no end at all in the endless mode); every hit makes the zone smaller and the needle faster. The rules (no DOM) are at the top.
(function (root) {
    'use strict';
    const LIVES = 3;
    /** Difficulty shifts the start: easy has a wider zone and a slower needle, hard the opposite. */
    const DIFF = { easy: { size: 16, speed: -50 }, normal: { size: 0, speed: 0 }, hard: { size: -14, speed: 60 } };
    /** Level n (hits so far): the zone shrinks and the needle speeds up (degrees, degrees per second). */
    function levelFor(n, diff) {
        const d = DIFF[diff] || DIFF.normal;
        return { size: Math.max(10, 64 + d.size - 3 * n), speed: Math.min(520, 190 + d.speed + 12 * n) };
    }
    /** Is the needle (degrees, 0-360) inside the zone that starts at `start`? */
    function inZone(angle, start, size) { return ((angle - start) % 360 + 360) % 360 <= size; }
    /** Where the next zone starts: never right under the needle at 0°. */
    function zoneStart(size, rng) { return 80 + Math.floor((rng || Math.random)() * (340 - size - 80)); }
    /** Endless mode: the next zone starts somewhere ahead of the needle (at least 70° away, wrapping past 360°). */
    function zoneAhead(angle, size, rng) { return ((angle % 360) + 70 + Math.floor((rng || Math.random)() * (360 - size - 140))) % 360; }
    /** One tap: 'hit' or 'miss'. A needle that goes past the zone without a tap is also a miss (see passed). */
    const tap = (angle, start, size) => (inZone(angle, start, size) ? 'hit' : 'miss');
    const passed = (angle, start, size) => angle > start + size;

    const api = { LIVES, DIFF, levelFor, inZone, zoneStart, zoneAhead, tap, passed };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
    root.SkillCheck = api;

    VBI18N.add('it', {
        title: 'Skill check — vector-box', desc: 'Skill check: la lancetta gira, tocca quando è nella zona verde. Ogni colpo giusto rimpicciolisce la zona e accelera la lancetta. Gratis, senza account.',
        back: '← Giochi', h1: 'Skill check', new: 'Nuova', help: 'Tocca (o premi spazio) quando la lancetta è nella zona verde. Se tocchi fuori zona o la lasci passare perdi una vita; con tre errori finisce. Ogni colpo giusto rende la zona più piccola e la lancetta più veloce. Nella modalità infinita la lancetta gira per sempre e non finisce mai: un errore azzera solo la serie.',
        score: 'Punti', best: 'Record', streak: 'Serie', easy: 'Facile', normal: 'Normale', hard: 'Difficile', lifemode: 'Tre vite', endless: 'Infinita', difficulty: 'Difficoltà', mode: 'Modalità', lives: 'Vite', tap: 'TOCCA', start: 'Inizia', over: 'Finita! Punti: {n}', record: 'Nuovo record!', hit: 'Perfetto', miss: 'Mancato',
    });
    VBI18N.add('en', { score: 'Score', best: 'Best', streak: 'Streak', easy: 'Easy', normal: 'Normal', hard: 'Hard', lifemode: 'Three lives', endless: 'Endless', difficulty: 'Difficulty', mode: 'Mode', lives: 'Lives', tap: 'TAP', start: 'Start', over: 'Game over! Score: {n}', record: 'New record!', hit: 'Nice', miss: 'Missed' });

    document.addEventListener('DOMContentLoaded', () => {
        const $ = (id) => document.getElementById(id);
        const dial = $('sc-dial'); if (!dial) return;
        const needle = $('sc-needle'), msg = $('sc-msg'), go = $('sc-go');
        let diff = 'normal', endless = false;
        const key = () => 'vb_skillcheck_best_' + diff + (endless ? '_endless' : '');
        const loadBest = () => { try { return +localStorage.getItem(key()) || 0; } catch (e) { return 0; } };
        let best = loadBest(), streak = 0;
        // records on the account (js/records.js): send a new one; at load merge the account's bests with this phone's
        const variants = ['easy', 'normal', 'hard'].flatMap((d) => [d, d + '-endless']);
        const keyOf = (v) => 'vb_skillcheck_best_' + v.replace('-endless', '_endless');
        const submitRecord = () => { if (window.VBRecords) VBRecords.submit('skillcheck', diff + (endless ? '-endless' : ''), best); };
        if (window.VBRecords) {
            const local = {};
            variants.forEach((v) => { try { const n = +localStorage.getItem(keyOf(v)) || 0; if (n > 0) local[v] = n; } catch (e) { /* private mode */ } });
            VBRecords.sync('skillcheck', local).then((m) => {
                if (!m) return;
                for (const [v, n] of Object.entries(m)) if (variants.includes(v) && n > (local[v] || 0)) { try { localStorage.setItem(keyOf(v), String(n)); } catch (e) { /* private mode */ } }
                best = loadBest(); paint();
            });
        }
        let score = 0, lives = LIVES, zone = null, angle = 0, last = 0, raf = 0, running = false, lastMsg = null;
        const T = (k) => VBLang.t(k);
        const say = (k, v) => { lastMsg = k ? [k, v] : null; msg.textContent = k ? VBLang.t(k, v) : ''; };
        const paint = () => { $('sc-score').textContent = score; $('sc-best').textContent = best; $('sc-lives').textContent = endless ? T('streak') + ' ' + streak : '♥'.repeat(lives) + '·'.repeat(LIVES - lives); $('sc-lives-l').textContent = endless ? '' : T('lives'); };

        function next() {
            const lv = levelFor(score, diff);
            // endless: the needle never stops or goes back, only the zone moves; otherwise every check starts from 0°
            zone = { start: endless && zone ? zoneAhead(angle, lv.size) : zoneStart(lv.size), size: lv.size, speed: lv.speed };
            dial.style.setProperty('--zs', zone.start + 'deg'); dial.style.setProperty('--zsz', zone.size + 'deg');
            if (!endless) { angle = 0; needle.style.transform = 'rotate(0deg)'; last = performance.now(); raf = requestAnimationFrame(step); }
        }
        function finish() {
            running = false; cancelAnimationFrame(raf);
            const rec = score > best; if (rec) { best = score; try { localStorage.setItem(key(), String(best)); } catch (e) { /* private mode */ } submitRecord(); }
            say('over', { n: score }); if (rec) msg.textContent += ' ' + VBLang.t('record');
            go.hidden = false; $('sc-tap').disabled = true; paint();
        }
        function result(r) {
            if (!endless) cancelAnimationFrame(raf);
            if (r === 'hit') { score++; streak++; VBFx.play('win'); say('hit'); } else { if (!endless) lives--; streak = 0; VBFx.play('lose'); say('miss'); }
            if (endless && score > best) { best = score; try { localStorage.setItem(key(), String(best)); } catch (e) { /* private mode */ } submitRecord(); }
            paint();
            if (endless) { if (r === 'hit') next(); return; }   // a miss keeps the same zone, the needle goes on
            if (lives <= 0) return finish();
            setTimeout(() => { if (running) next(); }, 450);
        }
        function step(now) {
            angle += zone.speed * (now - last) / 1000; last = now;
            needle.style.transform = 'rotate(' + (angle % 360) + 'deg)';
            if (!endless && passed(angle, zone.start, zone.size)) return result('miss');
            raf = requestAnimationFrame(step);
        }
        const press = () => { if (running && zone) result(tap(angle, zone.start, zone.size)); };
        function start() { score = 0; streak = 0; lives = LIVES; best = loadBest(); zone = null; cancelAnimationFrame(raf); running = true; go.hidden = true; $('sc-tap').disabled = false; say(null); paint(); angle = 0; last = performance.now(); next(); if (endless) raf = requestAnimationFrame(step); }

        $('sc-tap').addEventListener('click', press);
        document.addEventListener('keydown', (e) => { if (e.code === 'Space' && running) { e.preventDefault(); press(); } });
        const pick = (attr, set) => document.querySelectorAll('[data-' + attr + ']').forEach((b) => b.addEventListener('click', () => {
            set(b.dataset[attr]); document.querySelectorAll('[data-' + attr + ']').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
            running = false; zone = null; cancelAnimationFrame(raf); go.hidden = false; $('sc-tap').disabled = true; say(null); score = 0; streak = 0; lives = LIVES; best = loadBest(); paint();
        }));
        pick('diff', (v) => { diff = v; }); pick('mode', (v) => { endless = v === 'endless'; });
        go.addEventListener('click', start); $('sc-new').addEventListener('click', start);
        window.addEventListener('vb-lang', () => { paint(); if (lastMsg) { say(lastMsg[0], lastMsg[1]); } });
        $('sc-tap').disabled = true; paint();
    });
})(typeof window !== 'undefined' ? window : globalThis);
