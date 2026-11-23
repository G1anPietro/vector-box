// js/skillcheck.js — Skill check: a needle goes round, tap when it is inside the green zone (like the skill checks of
// Dead by Daylight). Three lives; every hit makes the zone smaller and the needle faster. The rules (no DOM) are at the top.
(function (root) {
    'use strict';
    const LIVES = 3;
    /** Level 0 is easy; the zone shrinks and the needle speeds up (degrees, degrees per second). */
    function levelFor(n) { return { size: Math.max(14, 64 - 3 * n), speed: Math.min(440, 190 + 12 * n) }; }
    /** Is the needle (degrees, 0-360) inside the zone that starts at `start`? */
    function inZone(angle, start, size) { return ((angle - start) % 360 + 360) % 360 <= size; }
    /** Where the next zone starts: never right under the needle at 0°. */
    function zoneStart(size, rng) { return 80 + Math.floor((rng || Math.random)() * (340 - size - 80)); }
    /** One tap: 'hit' or 'miss'. A needle that goes past the zone without a tap is also a miss (see passed). */
    const tap = (angle, start, size) => (inZone(angle, start, size) ? 'hit' : 'miss');
    const passed = (angle, start, size) => angle > start + size;

    const api = { LIVES, levelFor, inZone, zoneStart, tap, passed };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
    root.SkillCheck = api;

    VBI18N.add('it', {
        title: 'Skill check — vector-box', desc: 'Skill check: la lancetta gira, tocca quando è nella zona verde. Ogni colpo giusto rimpicciolisce la zona e accelera la lancetta. Gratis, senza account.',
        back: '← Giochi', h1: 'Skill check', new: 'Nuova', help: 'Tocca (o premi spazio) quando la lancetta è nella zona verde. Se tocchi fuori zona o la lasci passare perdi una vita; con tre errori finisce. Ogni colpo giusto rende la zona più piccola e la lancetta più veloce.',
        score: 'Punti', best: 'Record', lives: 'Vite', tap: 'TOCCA', start: 'Inizia', over: 'Finita! Punti: {n}', record: 'Nuovo record!', hit: 'Perfetto', miss: 'Mancato',
    });
    VBI18N.add('en', { score: 'Score', best: 'Best', lives: 'Lives', tap: 'TAP', start: 'Start', over: 'Game over! Score: {n}', record: 'New record!', hit: 'Nice', miss: 'Missed' });

    document.addEventListener('DOMContentLoaded', () => {
        const $ = (id) => document.getElementById(id);
        const dial = $('sc-dial'); if (!dial) return;
        const needle = $('sc-needle'), msg = $('sc-msg'), go = $('sc-go');
        const KEY = 'vb_skillcheck_best';
        let best = 0; try { best = +localStorage.getItem(KEY) || 0; } catch (e) { /* private mode */ }
        let score = 0, lives = LIVES, zone = null, angle = 0, last = 0, raf = 0, running = false, lastMsg = null;
        const say = (k, v) => { lastMsg = k ? [k, v] : null; msg.textContent = k ? VBLang.t(k, v) : ''; };
        const paint = () => { $('sc-score').textContent = score; $('sc-best').textContent = best; $('sc-lives').textContent = '♥'.repeat(lives) + '·'.repeat(LIVES - lives); };

        function next() {
            const lv = levelFor(score);
            zone = { start: zoneStart(lv.size), size: lv.size, speed: lv.speed };
            dial.style.setProperty('--zs', zone.start + 'deg'); dial.style.setProperty('--ze', (zone.start + zone.size) + 'deg');
            angle = 0; needle.style.transform = 'rotate(0deg)'; last = performance.now();
            raf = requestAnimationFrame(step);
        }
        function finish() {
            running = false; cancelAnimationFrame(raf);
            const rec = score > best; if (rec) { best = score; try { localStorage.setItem(KEY, String(best)); } catch (e) { /* private mode */ } }
            say('over', { n: score }); if (rec) msg.textContent += ' ' + VBLang.t('record');
            go.hidden = false; $('sc-tap').disabled = true; paint();
        }
        function result(r) {
            cancelAnimationFrame(raf);
            if (r === 'hit') { score++; VBFx.play('win'); say('hit'); } else { lives--; VBFx.play('lose'); say('miss'); }
            paint();
            if (lives <= 0) return finish();
            setTimeout(() => { if (running) next(); }, 450);
        }
        function step(now) {
            angle += zone.speed * (now - last) / 1000; last = now;
            needle.style.transform = 'rotate(' + (angle % 360) + 'deg)';
            if (passed(angle, zone.start, zone.size)) return result('miss');
            raf = requestAnimationFrame(step);
        }
        const press = () => { if (running && zone) result(tap(angle, zone.start, zone.size)); };
        function start() { score = 0; lives = LIVES; running = true; go.hidden = true; $('sc-tap').disabled = false; say(null); paint(); next(); }

        $('sc-tap').addEventListener('click', press);
        document.addEventListener('keydown', (e) => { if (e.code === 'Space' && running) { e.preventDefault(); press(); } });
        go.addEventListener('click', start); $('sc-new').addEventListener('click', start);
        window.addEventListener('vb-lang', () => { if (lastMsg) { say(lastMsg[0], lastMsg[1]); } });
        $('sc-tap').disabled = true; paint();
    });
})(typeof window !== 'undefined' ? window : globalThis);
