// js/giochi.js — the games shelf: search, filters, "how many of you", favourites, recently played, "surprise me".
// The page already lists every game without this script; it only adds the controls (kept on this phone, localStorage).
(() => {
    'use strict';
    const it = document.documentElement.lang === 'it';
    const $ = (id) => document.getElementById(id);
    const cells = [...document.querySelectorAll('.boxes .cell')];
    if (!cells.length) return;
    const store = {
        get(k) { try { const v = JSON.parse(localStorage.getItem(k)); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch (e) { return []; } },
        set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    };
    let favs = store.get('vb_game_favs'), recent = store.get('vb_game_recent');
    const state = { q: '', n: 0, g: '' };
    const byId = new Map(cells.map((c) => [c.dataset.id, c]));

    $('tools').hidden = false;
    $('tools').addEventListener('submit', (e) => e.preventDefault());   // Enter in the search box must not reload the page
    document.querySelectorAll('.fav').forEach((b) => { b.hidden = false; });

    const matches = (c) => {
        if (state.g && c.dataset.group !== state.g) return false;
        if (state.n && !(state.n >= +c.dataset.min && state.n <= +c.dataset.max)) return false;
        if (state.q && !c.dataset.name.includes(state.q)) return false;
        return true;
    };

    // "Your games" shelf (favourites, then recently played) is rebuilt from clones so the real shelves stay intact.
    function mineShelf() {
        const host = $('mine');
        host.replaceChildren();
        const ids = [...favs, ...recent.filter((r) => !favs.includes(r))].filter((id) => byId.has(id)).slice(0, 8);
        if (!ids.length || state.q || state.n || state.g) return;
        const sec = document.createElement('section'); sec.className = 'group mine';
        const h = document.createElement('h2'); h.textContent = it ? 'I tuoi giochi' : 'Your games';
        const wrap = document.createElement('div'); wrap.className = 'boxes';
        for (const id of ids) { const c = byId.get(id).cloneNode(true); c.classList.remove('hide'); wrap.append(c); }
        sec.append(h, wrap); host.append(sec);
        paintFavs();
    }
    function paintFavs() {
        document.querySelectorAll('.cell').forEach((c) => {
            const on = favs.includes(c.dataset.id), b = c.querySelector('.fav');
            b.setAttribute('aria-pressed', String(on));
            b.textContent = on ? '★' : '☆';
            b.setAttribute('aria-label', (on ? (it ? 'Togli dai preferiti: ' : 'Remove from favourites: ') : (it ? 'Aggiungi ai preferiti: ' : 'Add to favourites: ')) + b.dataset.label);
        });
    }
    function apply() {
        let shown = 0;
        cells.forEach((c) => { const ok = matches(c); c.classList.toggle('hide', !ok); if (ok) shown++; });
        document.querySelectorAll('section.group[data-kind]').forEach((s) => { s.hidden = !s.querySelector('.cell:not(.hide)'); });
        $('none').hidden = shown > 0;
        mineShelf(); paintFavs();
    }

    document.addEventListener('click', (e) => {
        const fav = e.target.closest('.fav');
        if (fav) {
            const id = fav.closest('.cell').dataset.id;
            favs = favs.includes(id) ? favs.filter((x) => x !== id) : [id, ...favs].slice(0, 20);
            store.set('vb_game_favs', favs); mineShelf(); paintFavs(); return;
        }
        const box = e.target.closest('a.box');
        if (box) {   // remembered when opened; the page then changes, so no re-render
            const id = box.closest('.cell').dataset.id;
            store.set('vb_game_recent', [id, ...recent.filter((x) => x !== id)].slice(0, 6));
        }
    });
    $('q').addEventListener('input', (e) => { state.q = e.target.value.trim().toLowerCase(); apply(); });
    $('n').addEventListener('input', (e) => { state.n = Math.max(0, Math.min(20, parseInt(e.target.value, 10) || 0)); apply(); });
    document.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
        state.g = b.dataset.g;
        document.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        apply();
    }));
    $('surprise').addEventListener('click', () => {
        const pool = cells.filter(matches);
        const pick = $('pick');
        pick.replaceChildren();
        if (!pool.length) { pick.textContent = it ? 'Nessun gioco con questi filtri.' : 'No game with these filters.'; return; }
        const c = pool[Math.floor(Math.random() * pool.length)];
        const a = document.createElement('a');
        a.href = c.querySelector('a.box').getAttribute('href');
        a.textContent = c.querySelector('.name').textContent;
        pick.append(it ? 'Prova: ' : 'Try: ', a);
        c.classList.add('glow'); setTimeout(() => c.classList.remove('glow'), 2500);
        c.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
    mineShelf(); paintFavs();
})();
