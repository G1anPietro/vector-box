// js/rogue/sprites-tiles.js — the look of the floors: one tile set per sector (floor, wall, door colour) and the pictures of the terrain hazards.
// Tile sets are 8x8 pixel patterns like the other sprites. Characters: '.' the base colour of the tile (the sector's `floor` or `wall` colour in mobs.js),
// '+' the sector's lighter `edge` colour, '-' a darker shade of the base, 'a' and 'b' the two accent colours of the set, 'd' a dim accent.
// HOW TO CHANGE A SECTOR'S LOOK: edit its entry in SETS (floor = two variants, used in a chessboard of 2, wall = one pattern). A new sector needs a new entry here.
// HAZARD PICTURES (SPR) are ordinary sprites (see sprites.js for the characters); hazards.js points to them with `shape`. dungeon.js merges SPR into the sprite table.
// The functions below need a canvas, so they only run in the browser; the data is also read by the tests.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else (root.Rogue = root.Rogue || {}).tiles = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    const SETS = {
        scantinato: { a: '#7a8f5a', b: '#8a7a4a', door: '#b98a55',   // concrete and bricks
            floor: [['........', '.....-..', '........', '..-.....', '........', '.......-', '...-....', '........'], ['........', '..-.....', '.......-', '........', '.-......', '........', '.....-..', '........']],
            wall: ['++++++++', '..+.....', '..+.....', '++++++++', '.....+..', '.....+..', '++++++++', '..+.....'] },
        aula: { a: '#00c8ff', b: '#ffb000', door: '#7fb0d0',          // raised floor tiles and racks with LEDs
            floor: [['--------', '-.......', '-.......', '-.......', '-.......', '-.......', '-.......', '-.......'], ['--------', '-.......', '-.......', '-..d....', '-.......', '-.......', '-.......', '-.......']],
            wall: ['++++++++', '+.a.-..+', '+.-.-.b+', '++++++++', '+..-.a.+', '+b.-...+', '++++++++', '+......+'] },
        cablaggi: { a: '#ffb000', b: '#ff5e5e', door: '#c9a24a',      // cable trays
            floor: [['--------', '........', '..d.....', '........', '--------', '........', '.....d..', '........'], ['--------', '........', '.....d..', '........', '--------', '........', '..d.....', '........']],
            wall: ['--------', 'aaaaaaaa', '........', 'bbbbbbbb', '--------', 'aaaaaaaa', '........', 'bbbbbbbb'] },
        rete: { a: '#3ff0d0', b: '#2a8fff', door: '#4fc0b0',          // circuit board traces
            floor: [['........', '..d.....', '..d.....', '..dddd..', '......d.', '......d.', '........', '........'], ['........', '........', '.dddd...', '....d...', '....d...', '....dddd', '........', '........']],
            wall: ['........', '.aaaa...', '....a...', '....a.aa', '..aaa.a.', '..a...a.', '..a.....', '........'] },
        archivio: { a: '#c98a4a', b: '#8aa05a', door: '#a8743f',      // bookshelves and wooden planks
            floor: [['........', '--------', '........', '......-.', '--------', '.-......', '........', '--------'], ['........', '--------', '.....-..', '........', '--------', '........', '..-.....', '--------']],
            wall: ['++++++++', 'abdabbda', 'abdabbda', '++++++++', 'dabdabba', 'dabdabba', '++++++++', '........'] },
        cloud: { a: '#b8c8ff', b: '#8aa8ff', door: '#8fa8e0',         // soft clouds
            floor: [['........', '..d.....', '.ddd....', '..d..d..', '....ddd.', '.....d..', '........', '........'], ['........', '.....d..', '..ddd...', '...d....', '.d...d..', '.....dd.', '........', '........']],
            wall: ['..++....', '.++++..+', '.++++.++', '..++..++', '+...++..', '++.++++.', '++.++++.', '.....++.'] },
        firewall: { a: '#ff6a2a', b: '#ffb000', door: '#e0603a',       // glowing red bricks and embers
            floor: [['........', '....d...', '..d.....', '.......d', '.d......', '.....d..', 'd.......', '...d....'], ['........', '.d......', '.....d..', '...d....', '.......d', '..d.....', '....d...', 'd.......']],
            wall: ['++++++++', '.a....a.', '.a....a.', '++++++++', '...a..a.', '...a..a.', '++++++++', '........'] },
        kernel: { a: '#c58bff', b: '#ff8bd8', door: '#a070e0',         // glowing grid
            floor: [['dddddddd', 'd.......', 'd.......', 'd.......', 'd.......', 'd.......', 'd.......', 'd.......'], ['dddddddd', 'd.......', 'd.......', 'd...d...', 'd.......', 'd.......', 'd.......', 'd.......']],
            wall: ['aaaaaaaa', 'a......a', 'a.dddd.a', 'a.d..d.a', 'a.d..d.a', 'a.dddd.a', 'a......a', 'aaaaaaaa'] },
        mainframe: { a: '#a8d84a', b: '#ff9f43', door: '#9aa84a',      // panels with blinking LEDs, perforated floor
            floor: [['--------', '-.......', '-..-.-..', '-.......', '-..-.-..', '-.......', '-..-.-..', '-.......'], ['--------', '-.......', '-.-..-..', '-.......', '-.-..-..', '-.......', '-.-..-..', '-.......']],
            wall: ['--------', '-++++++-', '-+a++b+-', '-++++++-', '-+b++a+-', '-++++++-', '-+a++a+-', '--------'] },
        root: { a: '#ffd84a', b: '#ffffff', door: '#d0b040',            // the # of the root prompt
            floor: [['dd..dd..', 'dd..dd..', '..dd..dd', '..dd..dd', 'dd..dd..', 'dd..dd..', '..dd..dd', '..dd..dd'], ['..dd..dd', '..dd..dd', 'dd..dd..', 'dd..dd..', '..dd..dd', '..dd..dd', 'dd..dd..', 'dd..dd..']],
            wall: ['..a..a..', 'aaaaaaaa', '..a..a..', '..a..a..', 'aaaaaaaa', '..a..a..', 'b.....b.', '........'] },
    };
    /** Pictures of the hazards (8x8, coloured by the hazard's `col`). */
    const SPR = {
        hz_drop:  ['...##...', '...##...', '..####..', '.######.', '.#+####.', '.#+####.', '..####..', '........'],
        hz_flake: ['...##...', '#..##..#', '.#.##.#.', '..####..', '########', '..####..', '.#.##.#.', '#..##..#'],
        hz_bolt:  ['....###.', '...###..', '..###...', '.######.', '....###.', '...###..', '..##....', '.#......'],
        hz_arrow: ['........', '...#....', '...##...', '########', '########', '...##...', '...#....', '........'],   // points right; the draw code turns it
        hz_books: ['########', '#+#-#+##', '#+#-#+##', '########', '#-#+#-##', '#-#+#-##', '########', '........'],
        hz_cloud: ['........', '..###...', '.#####.#', '########', '########', '.######.', '........', '........'],
        hz_flame: ['....#...', '...##...', '...###..', '..####.#', '.#+####.', '.#+###..', '..####..', '...##...'],
        hz_clock: ['..####..', '.#....#.', '#..##..#', '#..##..#', '#..###.#', '#......#', '.#....#.', '..####..'],
        hz_heat:  ['..#..#..', '.#..#...', '..#..#..', '.#..#...', '........', '########', '#++++++#', '########'],
    };
    const num = (hex) => parseInt(hex.slice(1), 16);
    const hex = (n) => '#' + (n & 0xffffff).toString(16).padStart(6, '0');
    const mix = (c1, c2, t) => { const a = num(c1), b = num(c2), f = (s) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t); return hex((f(16) << 16) | (f(8) << 8) | f(0)); };
    const cache = {};
    /** The 8x8 canvas of a tile: kind 'floor' | 'wall', variant 0|1 (floors), for a sector { id, wall, edge, floor }. */
    function tileCanvas(sec, kind, variant) {
        const key = sec.id + kind + (variant | 0);
        if (cache[key]) return cache[key];
        const set = SETS[sec.id] || SETS.scantinato, rows = kind === 'wall' ? set.wall : set.floor[variant | 0], base = kind === 'wall' ? sec.wall : sec.floor;
        const pal = { '.': base, '+': sec.edge, '-': mix(base, '#000000', 0.35), a: set.a, b: set.b, d: mix(base, set.a, 0.3) };
        const c = document.createElement('canvas'); c.width = c.height = 8;
        const x = c.getContext('2d');
        rows.forEach((row, y) => { for (let i = 0; i < 8; i++) { x.fillStyle = pal[row[i]] || base; x.fillRect(i, y, 1, 1); } });
        return (cache[key] = c);
    }
    /** Draws the floor or wall tile of cell (cx, cy) at pixel (px, py), ts pixels wide. */
    function drawTile(ctx, sec, wall, px, py, ts, cx, cy) {
        ctx.drawImage(tileCanvas(sec, wall ? 'wall' : 'floor', (cx + cy) & 1), px, py, ts, ts);
    }
    const doorColour = (secId) => (SETS[secId] || SETS.scantinato).door;
    return { SETS, SPR, tileCanvas, drawTile, doorColour, mix };
});
