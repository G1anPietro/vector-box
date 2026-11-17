// public/js/stats.js — hover/focus tooltip for the visits-per-day columns (data-tip on each column).
(() => {
    'use strict';
    const tip = document.getElementById('tip');
    if (!tip) return;
    const show = (col, x, y) => {
        tip.textContent = col.dataset.tip;
        tip.hidden = false;
        const w = tip.offsetWidth;
        tip.style.left = Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2)) + 'px';
        tip.style.top = Math.max(8, y - 36) + 'px';
    };
    document.querySelectorAll('.col[data-tip], .map path[data-tip]').forEach((col) => {
        col.tabIndex = 0;
        col.addEventListener('pointermove', (e) => show(col, e.clientX, e.clientY));
        col.addEventListener('pointerleave', () => { tip.hidden = true; });
        col.addEventListener('focus', () => { const r = col.getBoundingClientRect(); show(col, r.left + r.width / 2, r.top); });
        col.addEventListener('blur', () => { tip.hidden = true; });
    });

    // the map: colour every country by its visits (or bot requests, or both: red where bots are more than people)
    const map = document.querySelector('.map');
    if (map) {
        const paths = [...map.querySelectorAll('path')];
        const level = (n, max) => (n <= 0 ? 0 : Math.min(5, 1 + Math.floor(4 * Math.log(1 + n) / Math.log(1 + max))));   // log scale: one busy country must not hide the rest
        const paint = (mode) => {
            const val = (p) => (mode === 'h' ? +p.dataset.h : mode === 'b' ? +p.dataset.b : +p.dataset.h + +p.dataset.b);
            const max = Math.max(1, ...paths.map(val));
            paths.forEach((p) => {
                p.dataset.lvl = String(level(val(p), max));
                p.dataset.hue = mode === 'b' || (mode === 'a' && +p.dataset.b > +p.dataset.h) ? 'bot' : 'human';
            });
            document.querySelectorAll('.map-modes button').forEach((b) => { const on = b.dataset.mode === mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
            const legend = document.querySelector('.map-legend');
            if (legend) legend.dataset.hue = mode === 'b' ? 'bot' : 'human';
        };
        document.querySelectorAll('.map-modes button').forEach((b) => b.addEventListener('click', () => paint(b.dataset.mode)));
        paint('h');
    }
})();
