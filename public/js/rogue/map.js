// js/rogue/map.js — floors (rooms and corridors), field of view and path-finding. No DOM.
// A floor depends only on (seed, depth): the same seed always builds the same building.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./rng.js'));
    else (root.Rogue = root.Rogue || {}).map = factory(root.Rogue.rng);
})(typeof self !== 'undefined' ? self : this, function (RNG) {
    'use strict';
    const W = 40, H = 28;
    // SECRET looks like a wall until found. ALTAR, SHOP and BENCH are furniture: you bump into them to use them.
    const T = { WALL: 0, FLOOR: 1, DOOR: 2, STAIRS: 3, SECRET: 4, ALTAR: 5, SHOP: 6, BENCH: 7 };
    const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const walkable = (t) => t === 1 || t === 2 || t === 3;
    const opaque = (t) => t === 0 || t === 4;
    const centre = (r) => ({ x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) });

    /** Cells of an L-shaped walk from a to b (a excluded, b included). */
    function lpath(a, b, horizontalFirst) {
        const out = [];
        let x = a.x, y = a.y;
        const goX = () => { while (x !== b.x) { x += x < b.x ? 1 : -1; out.push([x, y]); } };
        const goY = () => { while (y !== b.y) { y += y < b.y ? 1 : -1; out.push([x, y]); } };
        if (horizontalFirst) { goX(); goY(); } else { goY(); goX(); }
        return out;
    }

    /** Breadth-first distances from `sources` (cell indexes) over the cells `pass(i, tile)` accepts. -1 = not reached. */
    function flood(m, sources, pass) {
        const dist = new Int16Array(m.w * m.h).fill(-1);
        const queue = new Int32Array(m.w * m.h);
        let head = 0, tail = 0;
        for (const s of sources) { dist[s] = 0; queue[tail++] = s; }
        while (head < tail) {
            const i = queue[head++], x = i % m.w, y = (i / m.w) | 0;
            for (const [dx, dy] of DIRS) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
                const j = ny * m.w + nx;
                if (dist[j] !== -1 || !pass(j, m.tiles[j])) continue;
                dist[j] = dist[i] + 1;
                queue[tail++] = j;
            }
        }
        return dist;
    }

    /** The neighbour of (x, y) nearest to the flood's sources, as [dx, dy]; null when none is reached. */
    function downhill(m, dist, x, y, blocked) {
        let best = null, bestD = Infinity;
        for (const d of DIRS) {
            const nx = x + d[0], ny = y + d[1];
            if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
            const j = ny * m.w + nx;
            if (dist[j] < 0 || dist[j] >= bestD || (blocked && blocked(j))) continue;
            best = d; bestD = dist[j];
        }
        return best;
    }

    function build(r) {
        const m = { w: W, h: H, tiles: new Array(W * H).fill(T.WALL), rooms: [] };
        const set = (x, y, t) => { m.tiles[y * W + x] = t; };
        const get = (x, y) => m.tiles[y * W + x];
        const want = 7 + RNG.int(r, 4);
        for (let i = 0; i < 300 && m.rooms.length < want; i++) {
            const w = 4 + RNG.int(r, 6), h = 3 + RNG.int(r, 4);
            const x = 2 + RNG.int(r, W - w - 4), y = 2 + RNG.int(r, H - h - 4);
            if (m.rooms.some((o) => x < o.x + o.w + 2 && o.x < x + w + 2 && y < o.y + o.h + 2 && o.y < y + h + 2)) continue;
            m.rooms.push({ x, y, w, h });
        }
        if (m.rooms.length < 5) return null;
        for (const o of m.rooms) for (let y = o.y; y < o.y + o.h; y++) for (let x = o.x; x < o.x + o.w; x++) set(x, y, T.FLOOR);
        const near = (o, list) => list.reduce((b, c) => {
            const d = (q) => Math.abs(centre(q).x - centre(o).x) + Math.abs(centre(q).y - centre(o).y);
            return !b || d(c) < d(b) ? c : b;
        }, null);
        const link = (a, b) => { for (const [x, y] of lpath(centre(a), centre(b), RNG.chance(r, 0.5))) if (get(x, y) === T.WALL) set(x, y, T.FLOOR); };
        for (let i = 1; i < m.rooms.length; i++) link(m.rooms[i], near(m.rooms[i], m.rooms.slice(0, i)));   // a tree: every room is joined
        for (let i = 0; i < 2; i++) link(RNG.pick(r, m.rooms), RNG.pick(r, m.rooms));                         // and a couple of loops
        // doors: a corridor that crosses a room's wall, with wall on both sides
        for (const o of m.rooms) {
            for (let x = o.x; x < o.x + o.w; x++) for (const y of [o.y - 1, o.y + o.h]) if (get(x, y) === T.FLOOR && get(x - 1, y) === T.WALL && get(x + 1, y) === T.WALL) set(x, y, T.DOOR);
            for (let y = o.y; y < o.y + o.h; y++) for (const x of [o.x - 1, o.x + o.w]) if (get(x, y) === T.FLOOR && get(x, y - 1) === T.WALL && get(x, y + 1) === T.WALL) set(x, y, T.DOOR);
        }
        // secret rooms: a small room in solid rock, joined by a corridor that starts with a hidden door. Never on the way to the stairs.
        for (let n = RNG.int(r, 3), tries = 0; n > 0 && tries < 60; tries++) {
            const w = 3 + RNG.int(r, 2), h = 3, x = 3 + RNG.int(r, W - w - 6), y = 3 + RNG.int(r, H - h - 6);
            let solid = true;
            for (let yy = y - 2; yy < y + h + 2 && solid; yy++) for (let xx = x - 2; xx < x + w + 2; xx++) if (get(xx, yy) !== T.WALL) { solid = false; break; }
            if (!solid) continue;
            const v = { x, y, w, h, vault: true };
            const inside = (cx, cy) => cx >= x && cx < x + w && cy >= y && cy < y + h;
            for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) set(xx, yy, T.FLOOR);
            let out = false;
            for (const [cx, cy] of lpath(centre(v), centre(near(v, m.rooms.filter((o) => !o.vault))), RNG.chance(r, 0.5))) {
                if (inside(cx, cy)) continue;
                if (!out) { set(cx, cy, T.SECRET); v.door = { x: cx, y: cy }; out = true; }
                else if (get(cx, cy) === T.WALL) set(cx, cy, T.FLOOR);
            }
            m.rooms.push(v);
            n--;
        }
        m.start = centre(m.rooms[0]);
        const dist = flood(m, [m.start.y * W + m.start.x], (i, t) => walkable(t));
        // a corridor that ran along a secret room's wall opened it: then it is just a room
        for (const v of m.rooms) if (v.vault && dist[centre(v).y * W + centre(v).x] >= 0) { v.vault = false; set(v.door.x, v.door.y, T.DOOR); }
        let far = m.rooms[1];
        for (const o of m.rooms) if (!o.vault && o !== m.rooms[0] && dist[centre(o).y * W + centre(o).x] > dist[centre(far).y * W + centre(far).x]) far = o;
        far.last = true;
        m.stairs = centre(far);
        set(m.stairs.x, m.stairs.y, T.STAIRS);
        return m;
    }

    /** The stairs are reachable without secret doors, and every open cell is reachable once the secrets are found. */
    function valid(m) {
        const from = [m.start.y * m.w + m.start.x];
        const plain = flood(m, from, (i, t) => walkable(t));
        if (plain[m.stairs.y * m.w + m.stairs.x] < 1) return false;
        const all = flood(m, from, (i, t) => t !== T.WALL);
        for (let i = 0; i < m.tiles.length; i++) if (m.tiles[i] !== T.WALL && all[i] < 0) return false;
        return true;
    }

    function generate(seed, depth) {
        for (let attempt = 0; attempt < 200; attempt++) {
            const m = build(RNG.make(RNG.mix(seed, depth * 1000 + attempt)));
            if (m && valid(m)) return m;
        }
        throw new Error('no floor for seed ' + seed + ' depth ' + depth);
    }

    /** The safe room between two sectors: one big hall with the stairs at the far end. */
    function hub() {
        const m = { w: W, h: H, tiles: new Array(W * H).fill(T.WALL), rooms: [{ x: 14, y: 9, w: 13, h: 9 }] };
        for (let y = 9; y < 18; y++) for (let x = 14; x < 27; x++) m.tiles[y * W + x] = T.FLOOR;
        m.start = { x: 20, y: 16 };
        m.stairs = { x: 20, y: 10 };
        m.tiles[10 * W + 20] = T.STAIRS;
        return m;
    }

    /** True when nothing opaque stands strictly between the two cells. */
    function los(m, x0, y0, x1, y1) {
        const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
        let err = dx - dy, x = x0, y = y0;
        for (;;) {
            if (x === x1 && y === y1) return true;
            if ((x !== x0 || y !== y0) && opaque(m.tiles[y * m.w + x])) return false;
            const e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x += sx; }
            if (e2 < dx) { err += dx; y += sy; }
        }
    }

    /** 1 for every cell seen from (px, py) within `radius`. */
    function fov(m, px, py, radius) {
        const vis = new Array(m.w * m.h).fill(0), r2 = radius * radius + radius;
        for (let y = Math.max(0, py - radius); y <= Math.min(m.h - 1, py + radius); y++) {
            for (let x = Math.max(0, px - radius); x <= Math.min(m.w - 1, px + radius); x++) {
                if ((x - px) * (x - px) + (y - py) * (y - py) <= r2 && los(m, px, py, x, y)) vis[y * m.w + x] = 1;
            }
        }
        return vis;
    }

    return { W, H, T, DIRS, walkable, opaque, centre, lpath, flood, downhill, generate, valid, hub, los, fov };
});
