// js/rogue/sprites-art.js — the 16x16 sprite engine of the Server Dungeon. The drawings are in sprites-art-*.js (see docs/ROGUELIKE.md, "Come disegnare uno sprite").
// A drawing is 16 strings of 16 characters. Each character is a colour ROLE of the item's tint (so one drawing makes many colours):
//   o outline (dark)   s shade   b base (the tint itself)   l light   a accent   e eye (dark pupil)   w white
// plus a few fixed colours shared by all drawings (skin n/N, hair h/H, dark metal k, greys g/G, gold y, red r, wood t, paper p, glass c) and any
// character a drawing redefines in its own palette `p: { x: 'role' | '#hex' }`. '.' is empty.
// Names: bare ('bug', 'weapon'…) = archetypes and category icons, 'm:<id>' a single monster, 'i:<id>' a single item, 'hero:<class>' a hero, 'fx:<name>'.
// A sprite name may be a fallback CHAIN 'm:rogueai>eye>m:generic': the first name that exists is drawn (exact key, then archetype, then generic).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(() => require('./sprites.js'));
    else (root.Rogue = root.Rogue || {}).art = factory(() => (root.Rogue || {}).sprites);
})(typeof self !== 'undefined' ? self : this, function (legacyOf) {
    'use strict';
    const N = 16, DEFS = {}, CACHE = new Map(), CACHE_MAX = 500;
    const FIXED = { n: '#e8b48c', N: '#b87a58', h: '#4a3226', H: '#7a5a42', k: '#1c2228', g: '#7d8794', G: '#c4ccd6', y: '#ffd24a', r: '#e04848', t: '#9a6a3a', p: '#e8e2cc', c: '#8fe8ff' };
    const hex = (c) => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
    const css = (v) => '#' + v.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
    const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
    // one tint -> the four tones of a ramp (+ accent: the opposite temperature of the tint, so it always stands out)
    function ramp(col) {
        const t = hex(/^#[0-9a-f]{6}$/i.test(col) ? col : '#8fa3b8');
        if (Math.min(t[0], t[1], t[2]) > 215) for (let i = 0; i < 3; i++) t[i] *= 0.86; // white tints keep room for a light tone
        return {
            o: css(mix(mix(t, [0, 0, 0], 0.88), [10, 12, 20], 0.35)), s: css(mix(mix(t, [18, 20, 56], 0.5), t, 0.2)), b: css(t), l: css(mix(t, [255, 255, 255], 0.42)),
            a: t[0] > t[2] ? '#00e5ff' : '#ffb000', e: '#0b0e12', w: '#f4f6f8',
        };
    }
    function add(defs, opts) { for (const k of Object.keys(defs)) DEFS[k] = Object.assign({ anim: !!(opts && opts.anim) }, defs[k]); }
    const legacy = () => { try { return legacyOf() || {}; } catch (e) { return {}; } };
    // name or chain -> { key, def | rows (legacy 8x8), kind: 'art' | 'legacy' | 'missing', exact }
    function resolve(name) {
        const list = String(name || '').split('>').filter(Boolean), L = legacy();
        for (let i = 0; i < list.length; i++) {
            if (DEFS[list[i]]) return { key: list[i], def: DEFS[list[i]], kind: 'art', exact: i === 0 };
            if (L[list[i]]) return { key: list[i], rows: L[list[i]], kind: 'legacy', exact: i === 0 };
        }
        return { key: 'fx:unknown', def: DEFS['fx:unknown'] || null, kind: 'missing', exact: false };
    }
    // the chain for a data entry of mobs.js (kind 'm'), items.js ('i') or a class ('h'): its own sprite key, id, archetype, shape, then a generic
    function chain(d, kind) {
        const gen = { m: 'm:generic', i: 'i:generic', h: 'hero' }[kind] || 'fx:unknown';
        return [d.sprite, kind === 'h' ? 'hero:' + d.id : kind + ':' + d.id, d.archetype, d.shape, gen].filter(Boolean).join('>');
    }
    // grid of characters for a frame (0 or 1). Frame 1: the upper `bob` rows sink one pixel (a breath), then the drawing's own patches [row, col, char].
    function grid(def, frame) {
        const rows = def.r.map((r) => r.split(''));
        if (!frame) return rows;
        const out = rows.map((r) => r.slice()), n = Math.min(def.bob == null ? 10 : def.bob, N - 1);
        for (let r = 0; r <= n; r++) for (let x = 0; x < N; x++) {
            const u = r ? rows[r - 1][x] : '.';
            out[r][x] = u !== '.' ? u : r < n ? '.' : rows[r][x];
        }
        for (const [y, x, c] of def.f2 || []) out[y][x] = c;
        return out;
    }
    // colour of every pixel (null = empty) for a name, tint and frame; legacy 8x8 pictures are doubled
    function pixels(name, col, frame) {
        const r = resolve(name), pal = ramp(col), px = new Array(N * N).fill(null);
        if (r.kind === 'legacy') {
            const lp = { '#': pal.b, '+': pal.l, '-': pal.s, o: '#000000', w: '#f2f2f2' };
            r.rows.forEach((row, y) => { for (let x = 0; x < 8; x++) { const c = lp[row[x]]; if (c) for (let k = 0; k < 4; k++) px[(y * 2 + (k >> 1)) * N + x * 2 + (k & 1)] = c; } });
            return px;
        }
        if (!r.def) return px;
        const p = Object.assign({}, pal, FIXED), g = grid(r.def, frame | 0), own = r.def.p || {};
        for (const k of Object.keys(own)) p[k] = own[k][0] === '#' ? own[k] : pal[own[k]] || p[own[k]];
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) px[y * N + x] = g[y][x] === '.' ? null : p[g[y][x]] || null;
        return px;
    }
    const reduced = () => { try { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } };
    const clock = () => (reduced() ? 0 : Math.floor(Date.now() / 500) & 1);
    // the canvas of a sprite (cached: one small canvas per name+tint+frame, the cache is emptied at CACHE_MAX).
    // Without `frame`, animated sprites follow the 2 fps clock (always frame 0 under prefers-reduced-motion).
    function sprite(name, col, frame) {
        if (typeof document === 'undefined') return null;
        const r = resolve(name), f = frame == null ? (r.def && r.def.anim ? clock() : 0) : frame & 1, key = r.key + '|' + col + '|' + f;
        let c = CACHE.get(key);
        if (c) return c;
        if (CACHE.size >= CACHE_MAX) CACHE.clear();
        c = document.createElement('canvas'); c.width = c.height = N;
        const x = c.getContext('2d'), px = pixels(name, col, f);
        for (let i = 0; i < px.length; i++) if (px[i]) { x.fillStyle = px[i]; x.fillRect(i % N, (i / N) | 0, 1, 1); }
        CACHE.set(key, c);
        return c;
    }
    // calls cb twice a second (not with prefers-reduced-motion, not in a hidden tab) so the page can redraw the floor
    function animate(cb) {
        if (typeof setInterval !== 'function') return null;
        return setInterval(() => { if (!reduced() && !(typeof document !== 'undefined' && document.hidden)) cb(); }, 500);
    }
    // symmetric drawings: write the LEFT 8 columns of each row, the right half is the mirror image
    // (optional patches [row, col, 'text'] are written after mirroring, for the asymmetric details)
    const mirror = (left, patches) => {
        const g = left.map((r) => (r + r.split('').reverse().join('')).split(''));
        for (const [y, x, t] of patches || []) for (let i = 0; i < t.length; i++) if (x + i < 16) g[y][x + i] = t[i];
        return g.map((r) => r.join(''));
    };
    return { N, add, mirror, resolve, chain, pixels, sprite, animate, frame: clock, ramp, keys: () => Object.keys(DEFS), def: (k) => DEFS[k], cacheSize: () => CACHE.size, CACHE_MAX };
});
