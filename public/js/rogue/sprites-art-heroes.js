// js/rogue/sprites-art-heroes.js — the 8 heroes (key 'hero:<class id>', 'hero' = generic) and the effects/markers ('fx:*'). Format: see sprites-art.js.
// The heroes share one body (BASE) and change the rows that make each class different, so a hero is a few lines of `put(row, col, 'text')`.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) factory(require('./sprites-art.js'));
    else factory(root.Rogue.art);
})(typeof self !== 'undefined' ? self : this, function (A) {
    'use strict';
    const BASE = [
        '................',
        '....oooooooo....',
        '...ohhhhhhhho...',
        '...ohHHhhhhho...',
        '...ohhnnnnhho...',
        '...onwennweno...',
        '...onnnnnnnno...',
        '...onnnNNnnno...',
        '....onnnnnno....',
        '...obbllllbbo...',
        '..obbsbbbbsbbo..',
        '..obsbbbbbbsbo..',
        '..onnbbbbbbnno..',
        '...oobbbbbboo...',
        '....okkookko....',
        '...oowwoowwoo...',
    ];
    BASE[5] = '...onwennweno...';
    // hero(patches): copy BASE and write `text` at (row, col) for every [row, col, text]
    function hero(patches, extra) {
        const g = BASE.map((r) => r.split(''));
        for (const [y, x, t] of patches) for (let i = 0; i < t.length; i++) if (x + i < 16) g[y][x + i] = t[i];
        return Object.assign({ r: g.map((r) => r.join('')) }, extra);
    }
    const D = {
        'hero': hero([]),
        // Student: green hoodie, messy hair, backpack straps and a notebook under the arm
        'hero:studente': hero([
            [1, 5, 'oHooHo'], [10, 5, 'a'], [10, 10, 'a'], [11, 5, 'a'], [11, 10, 'a'], [9, 1, 'oo'], [10, 1, 'a'], [11, 1, 'a'], [12, 1, 'a'], [13, 1, 'oo'],
            [10, 14, 'a'], [11, 14, 'a'], [12, 14, 'a'], [9, 13, 'o'], [13, 13, 'o'], [12, 13, 'p'],
        ]),
        // Hacker: hood up, glasses, a laptop held in front
        'hero:hacker': hero([
            [2, 3, 'obbbbbbbbo'], [3, 2, 'obbllllllbbo'], [4, 2, 'obsnnnnnnsbo'], [5, 2, 'obsceccecsbo'], [6, 2, 'obsnnnnnnsbo'], [7, 2, 'obsnnNNnnsbo'], [8, 3, 'obsnnnnsbo'],
            [9, 3, 'obbbaabbbbo'], [10, 3, 'bbsbaabsbb'], [11, 3, 'bsggggggsb'], [12, 3, 'nnggaaggnn'], [13, 5, 'bkkkkb'],
        ], { p: { c: '#8fe8ff' } }),
        // Teacher: bald head with side hair, round glasses, moustache, tie and a ruler
        'hero:prof': hero([
            [2, 3, 'onnnnnnnno'], [3, 3, 'oGnnnnnnGo'], [4, 3, 'oGnnnnnnGo'], [5, 4, 'cecnncec'], [6, 4, 'nnnGGnnn'], [7, 4, 'nnnnnnnn'],
            [9, 4, 'bbwwwwbb'], [10, 5, 'bbrrbb'], [11, 5, 'bbrrbb'], [12, 6, 'brrb'], [13, 6, 'brrb'],
            [6, 14, 'k'], [7, 14, 'y'], [8, 14, 'k'], [9, 14, 'y'], [10, 14, 'k'], [11, 14, 'y'], [12, 14, 'n'], [13, 14, 'k'],
        ], { p: { c: '#8fe8ff' } }),
        // Technician: hard hat, vest with a tool belt and a wrench
        'hero:tecnico': hero([
            [0, 4, 'oooooooo'], [1, 3, 'oyyllyyyyo'], [2, 2, 'ooyyyyyyyyoo'], [3, 3, 'ohhhhhhhho'],
            [9, 4, 'bbaaaabb'], [10, 5, 'a'], [10, 10, 'a'], [11, 5, 'a'], [11, 10, 'a'], [13, 4, 'kkayyakk'],
            [8, 1, 'oo'], [9, 1, 'gg'], [10, 1, 'g'], [11, 0, 'og'], [12, 1, 'n'], [10, 13, 'o'],
        ]),
        // Janitor: cap, apron and a mop held like a staff
        'hero:bidello': hero([
            [1, 4, 'oooooooo'], [2, 3, 'obbbbbbbbo'], [3, 3, 'oblllbbbbo'], [4, 3, 'ohhnnnnhho'],
            [9, 4, 'bbllllbb'], [10, 5, 'bwwwwb'], [11, 5, 'wwwwww'], [12, 5, 'wwwwww'], [13, 5, 'wwwwww'],
            [0, 13, 'wGw'], [1, 12, 'GwwwG'], [2, 13, 'GwG'], [3, 14, 't'], [4, 14, 't'], [5, 14, 't'], [6, 14, 't'], [7, 14, 't'], [8, 14, 't'], [9, 14, 't'], [10, 14, 't'], [11, 14, 't'], [12, 14, 'n'], [13, 14, 't'], [14, 14, 't'], [15, 13, 'gg'],
        ]),
        // Sysadmin: headset with microphone, beard, a coil of network cable
        'hero:sistemista': hero([
            [1, 4, 'okkkkkko'], [2, 3, 'okhhhhhhko'], [3, 2, 'okkhHHhhkko'], [4, 2, 'okkhhnnhkko'], [5, 2, 'okk'], [5, 5, 'wennwenn'], [6, 2, 'ok'], [6, 4, 'nnnnnnnn'], [7, 3, 'oknnnnnnno'], [7, 6, 'hhhh'], [8, 4, 'ohhhhhho'],
            [6, 3, 'k'], [7, 2, 'kk'], [7, 4, 'a'],
            [11, 12, 'aaa'], [12, 12, 'oaao'], [13, 12, 'aaa'],
        ]),
        // Designer: beret, a pen behind the ear, a tablet
        'hero:designer': hero([
            [0, 6, 'oooooo'], [1, 4, 'ooblllbbboo'], [2, 3, 'obbbbbbbbbo'], [3, 3, 'ohhhhhhhho'],
            [9, 4, 'bbllllbb'], [10, 7, 'a'], [11, 3, 'oggggggo'], [12, 3, 'ogaaaaggo'], [13, 3, 'oggggggo'],
            [11, 10, 'o'],
        ]),
        // Secretary: hair bun, glasses, lanyard with a badge, a stamp
        'hero:segreteria': hero([
            [0, 6, 'oHHo'], [1, 5, 'oHHHHo'], [2, 3, 'ohhhhhhhho'], [3, 3, 'ohhhhhhhho'], [4, 3, 'ohhnnnnhho'],
            [5, 4, 'cennnnec'], [6, 3, 'ohnnnnnnho'], [7, 3, 'ohnnnNNnho'], [8, 3, 'ohhnnnnhho'],
            [9, 4, 'bbaabbaa'], [10, 7, 'aa'], [11, 7, 'aa'], [12, 7, 'ww'], [13, 7, 'ww'],
            [11, 13, 'oo'], [12, 13, 'kk'], [13, 13, 'rr'], [14, 13, 'rr'],
        ], { p: { c: '#8fe8ff' } }),
    };
    A.add(D, { anim: true });
});
