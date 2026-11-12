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
    document.querySelectorAll('.col[data-tip]').forEach((col) => {
        col.tabIndex = 0;
        col.addEventListener('pointermove', (e) => show(col, e.clientX, e.clientY));
        col.addEventListener('pointerleave', () => { tip.hidden = true; });
        col.addEventListener('focus', () => { const r = col.getBoundingClientRect(); show(col, r.left + r.width / 2, r.top); });
        col.addEventListener('blur', () => { tip.hidden = true; });
    });
})();
