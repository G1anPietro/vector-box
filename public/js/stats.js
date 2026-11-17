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

        // zoom and pan: only the viewBox changes (the paths stay as they are), so it is cheap and crisp
        const full = map.getAttribute('viewBox').split(/\s+/).map(Number);        // [0, 0, 360, 142]
        let v = full.slice();
        const MAXZ = 14;
        const clampView = () => {
            v[2] = Math.min(full[2], Math.max(full[2] / MAXZ, v[2]));
            v[3] = v[2] * full[3] / full[2];
            v[0] = Math.min(full[0] + full[2] - v[2], Math.max(full[0], v[0]));
            v[1] = Math.min(full[1] + full[3] - v[3], Math.max(full[1], v[1]));
            map.setAttribute('viewBox', v.map((n) => Math.round(n * 100) / 100).join(' '));
            map.classList.toggle('zoomed', v[2] < full[2] - 0.01);
        };
        const zoomAt = (factor, cx, cy) => {          // cx, cy in viewBox units: the point that stays under the finger
            const nw = v[2] / factor;
            v[0] = cx - (cx - v[0]) * (nw / v[2]); v[1] = cy - (cy - v[1]) * (nw / v[2]); v[2] = nw;
            clampView();
        };
        const toView = (clientX, clientY) => {
            const r = map.getBoundingClientRect();
            const k = Math.max(v[2] / r.width, v[3] / r.height);                       // preserveAspectRatio meet: the same scale on both axes
            const offX = (r.width - v[2] / k) / 2, offY = (r.height - v[3] / k) / 2;
            return [v[0] + (clientX - r.left - offX) * k, v[1] + (clientY - r.top - offY) * k, k];
        };
        const centre = () => [v[0] + v[2] / 2, v[1] + v[3] / 2];
        document.querySelectorAll('.map-zoom button').forEach((b) => b.addEventListener('click', () => {
            if (b.dataset.z === 'reset') { v = full.slice(); clampView(); return; }
            const [cx, cy] = centre(); zoomAt(b.dataset.z === 'in' ? 1.7 : 1 / 1.7, cx, cy);
        }));
        map.addEventListener('wheel', (e) => { e.preventDefault(); const [x, y] = toView(e.clientX, e.clientY); zoomAt(e.deltaY < 0 ? 1.25 : 0.8, x, y); }, { passive: false });
        map.addEventListener('dblclick', (e) => { const [x, y] = toView(e.clientX, e.clientY); zoomAt(2, x, y); });
        const ptrs = new Map(); let drag = null, pinch = null;
        map.addEventListener('pointerdown', (e) => {
            ptrs.set(e.pointerId, [e.clientX, e.clientY]);
            if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, v0: v.slice(), moved: false };
            if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), w: v[2] }; drag = null; }
        });
        map.addEventListener('pointermove', (e) => {
            if (!ptrs.has(e.pointerId)) return;
            ptrs.set(e.pointerId, [e.clientX, e.clientY]);
            if (pinch && ptrs.size === 2) {
                const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
                const [x, y] = toView((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
                zoomAt((pinch.w / v[2]) * (d / pinch.d), x, y);
            } else if (drag) {
                const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
                if (!drag.moved && Math.hypot(dx, dy) < 5) return;
                drag.moved = true;
                if (!map.hasPointerCapture(e.pointerId)) map.setPointerCapture(e.pointerId);
                const k = Math.max(v[2] / map.getBoundingClientRect().width, v[3] / map.getBoundingClientRect().height);
                v[0] = drag.v0[0] - dx * k; v[1] = drag.v0[1] - dy * k; clampView();
            }
        });
        const up = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; if (!ptrs.size) drag = null; };
        ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => map.addEventListener(t, up));
    }
})();
