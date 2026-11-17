// js/rogue/sprites-art-items3.js — the newer armour (27) and food (12): key 'item_<id>'. Painted with A.pic (see sprites-art.js).
// Armour = six silhouettes (tee, jacket, hoodie, vest, plate, robe, plus dome and box) x its own two colours (U main, V trim) x its own details, so tier and material read at 24 px.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) factory(require('./sprites-art.js'));
    else factory(root.Rogue.art);
})(typeof self !== 'undefined' ? self : this, function (A) {
    'use strict';
    const P = A.pic;
    // silhouettes: [first row, rows]
    const SIL = {
        tee: [2, ['...UUU....UUU...', '.UUUUUU..UUUUUU.', 'UUUUUUUUUUUUUUUU', 'UUUUUUUUUUUUUUUU', 'UUU.UUUUUUUU.UUU', '....UUUUUUUU....', '....UUUUUUUU....', '....UUUUUUUU....', '....UUUUUUUU....', '....UUUUUUUU....', '....UUUUUUUU....', '....UUUUUUUU....']],
        jacket: [1, ['.....UUUUUU.....', '...UUUUUUUUUU...', '..UUUUUUUUUUUU..', '.UUUUUUUUUUUUUU.', '.UUUUUUUUUUUUUU.', '.UUU.UUUUUU.UUU.', '.UUU.UUUUUU.UUU.', '.UUU.UUUUUU.UUU.', '.UUU.UUUUUU.UUU.', '.VVV.UUUUUU.VVV.', '.....UUUUUU.....', '.....UUUUUU.....', '.....UUUUUU.....']],
        hoodie: [0, ['....UUUUUUUU....', '...UUUVVVVUUU...', '..UUUUVVVVUUUU..', '.UUUUUUUUUUUUUU.', '.UUUUUUUUUUUUUU.', '.UUU.UUUUUU.UUU.', '.UUU.UUUUUU.UUU.', '.UUU.UUUUUU.UUU.', '.UUU.UUUUUU.UUU.', '.VVV.UUUUUU.VVV.', '.....UUUUUU.....', '.....UUUUUU.....', '.....UUUUUU.....']],
        vest: [2, ['...UUU....UUU...', '..UUUU....UUUU..', '..UUUUU..UUUUU..', '..UUUUUUUUUUUU..', '..UUUUUUUUUUUU..', '..UUUUUUUUUUUU..', '..UUUUUUUUUUUU..', '..UUUUUUUUUUUU..', '..UUUUUUUUUUUU..', '..UUUUUUUUUUUU..', '..UUUUUUUUUUUU..', '...UUUUUUUUUU...']],
        plate: [2, ['..UUU..UU..UUU..', '.UUUUUUUUUUUUUU.', '.UUUUUUUUUUUUUU.', '..UUUUUUUUUUUU..', '...UUUUUUUUUU...', '...UUUUUUUUUU...', '...UUUUUUUUUU...', '....UUUUUUUU....', '....UUUUUUUU....', '.....UUUUUU.....', '......UUUU......']],
        robe: [1, ['....UUUUUUUU....', '..UUUUUUUUUUUU..', '.UUUUUUUUUUUUUU.', '.UUUUUUUUUUUUUU.', '.UUU.UUUUUU.UUU.', '.UUU.UUUUUU.UUU.', '.UUU.UUUUUU.UUU.', '.UUU.UUUUUU.UUU.', '.VVV.UUUUUU.VVV.', '....UUUUUUUU....', '...UUUUUUUUUU...', '...UUUUUUUUUU...', '..UUUUUUUUUUUU..', '..UUUUUUUUUUUU..']],
        dome: [3, ['.....UUUUUU.....', '...UUUUUUUUUU...', '..UUUUUUUUUUUU..', '.UUUUUUUUUUUUUU.', '.UUUUUUUUUUUUUU.', '.UUUUUUUUUUUUUU.', '.UUUUUUUUUUUUUU.', '.UUUUUUUUUUUUUU.', '..UUUUUUUUUUUU..', '...UUUUUUUUUU...']],
    };
    // armour(silhouette, main colour, trim colour, details(p))
    const arm = (sil, u, v, fn) => P((p) => { p.st(0, SIL[sil][0], SIL[sil][1]); if (fn) fn(p); }, { U: u, V: v });
    const D = {
        item_a_grembiule: arm('vest', '#f0f0f4', '#9aa4b8', (p) => p.rect(6, 8, 4, 3, 'V').rect(3, 7, 10, 1, 'V').px(4, 10, 't').px(10, 5, 'g').px(11, 11, 'c').px(5, 5, 'r')),
        item_a_kway: arm('hoodie', '#f0c020', '#2a3a50', (p) => p.rect(6, 1, 4, 2, 'k').rect(7, 4, 1, 9, 'k').px(11, 8, 'c').px(3, 6, 'c').px(12, 10, 'c').rect(5, 8, 2, 2, 'o')),
        item_a_parka: arm('jacket', '#4a6a50', '#e8e8e8', (p) => p.rect(4, 1, 8, 2, 'W').rect(7, 3, 1, 10, 'k').rect(5, 9, 2, 2, 'V').rect(9, 9, 2, 2, 'V').px(12, 9, 'W')),
        item_a_imbracatura: arm('tee', '#b09060', '#2a2a30', (p) => p.line(4, 4, 11, 11, 'K').line(11, 4, 4, 11, 'K').rect(4, 11, 8, 1, 'K').rect(5, 8, 2, 2, 'V').rect(9, 8, 2, 2, 'V').px(3, 5, 'Y').px(12, 5, 'Y')),
        item_a_gilet_sic: arm('vest', '#ff9a20', '#d8d8d8', (p) => p.rect(2, 7, 12, 1, 'V').rect(2, 10, 12, 1, 'V').rect(4, 4, 1, 8, 'V').rect(11, 4, 1, 8, 'V')),
        item_a_faraday: arm('jacket', '#9aa8b8', '#4a5a6a', (p) => { for (let y = 3; y < 13; y += 2) for (let x = 3; x < 13; x += 2) if ((x + y) % 4 === 0) p.px(x, y, 'k'); p.st(7, 5, ['.Y', 'YY', '.Y', 'Y.']); }),
        item_a_piastra: arm('plate', '#6a7480', '#3a4450', (p) => { for (let i = 0; i < 4; i++) { p.rect(4 + i * 2, 7, 1, 2, 'k'); p.rect(4 + i * 2, 10, 1, 1, i % 2 ? 'c' : 'Y'); } p.rect(3, 5, 10, 1, 'k').px(3, 3, 'Y').px(12, 3, 'Y'); }),
        item_a_cardigan: arm('jacket', '#8a7a68', '#5a4a3a', (p) => p.rect(7, 3, 2, 10, 'V').px(6, 5, 'Y').px(6, 8, 'Y').px(6, 11, 'Y').px(10, 9, 't').px(11, 10, 't').px(3, 6, 't')),
        item_a_corazza: arm('plate', '#e8dcb0', '#9a6a3a', (p) => { for (const y of [5, 7, 9]) p.rect(3, y, 10, 1, 'V'); p.rect(7, 3, 2, 8, 'T').px(4, 4, 'w').px(11, 6, 'w'); }),
        item_a_felpacloud: arm('hoodie', '#d8ecff', '#8ab8e8', (p) => p.rect(6, 1, 4, 2, 'V').st(5, 6, ['.WW.W.', 'WWWWWW']).rect(5, 8, 6, 1, 'V').st(7, 10, ['..WW', '.WWW']).rect(7, 3, 1, 2, 'V').rect(8, 3, 1, 2, 'V')),
        item_a_container: P((p) => { p.rect(2, 3, 12, 10, 'U'); for (let x = 3; x < 14; x += 2) p.rect(x, 4, 1, 8, 'V'); p.rect(2, 3, 12, 1, 'V').rect(2, 12, 12, 1, 'V').rect(7, 7, 2, 2, 'G'); }, { U: '#d84a2a', V: '#8a2a1a' }),
        item_a_offerta: arm('jacket', '#e04060', '#fff0f0', (p) => p.rect(7, 3, 1, 10, 'k').rect(9, 7, 4, 3, 'W').px(10, 8, 'r').px(12, 9, 'r').px(11, 8, 'k')),
        item_a_acl: arm('vest', '#2a8a50', '#1a4a2a', (p) => { p.st(4, 5, ['r.r', '.r.', 'r.r']).st(9, 5, ['..c', 'c.c', '.c.']).rect(4, 9, 8, 1, 'V'); p.st(4, 10, ['r.r', '.r.']).st(9, 10, ['c', 'c']); }),
        item_a_drop: arm('plate', '#3a2a5a', '#0a0a14', (p) => p.disc(8, 8, 3, 'k').disc(8, 8, 1, 'o').px(6, 6, 'W').px(10, 10, 'W').px(5, 9, 'w').px(11, 6, 'w')),
        item_a_mantello: arm('robe', '#5a4a7a', '#2a2040', (p) => { p.rect(6, 1, 4, 1, 'V'); for (const [x, y] of [[4, 6], [10, 7], [6, 9], [11, 11], [3, 12], [8, 5]]) p.rect(x, y, 2, 1, 'c'); p.px(7, 8, 'w'); }),
        item_a_maglia: arm('plate', '#b0b8c8', '#ffd24a', (p) => { for (let y = 4; y < 11; y++) for (let x = 3; x < 13; x++) if ((x + y) % 2 === 0) p.px(x, y, 'g'); p.rect(7, 3, 2, 1, 'V').px(7, 11, 'V'); }),
        item_a_maglietta_irq: arm('tee', '#e8803a', '#ffe055', (p) => p.st(6, 5, ['..VV', '.VV.', 'VVVV', '..VV', '.V..']).rect(5, 11, 6, 1, 'V')),
        item_a_guscio: arm('dome', '#9a6a3a', '#5a3a1a', (p) => { p.rect(3, 6, 10, 1, 'V').rect(3, 9, 10, 1, 'V').rect(5, 4, 1, 3, 'V').rect(10, 4, 1, 3, 'V').rect(8, 6, 1, 4, 'V').rect(4, 7, 1, 2, 'V').rect(12, 7, 1, 2, 'V'); }),
        item_a_grembiulemf: arm('vest', '#c8d8e8', '#e8dcb0', (p) => p.rect(5, 7, 6, 4, 'V').rect(6, 8, 4, 1, 'k').rect(6, 9, 4, 1, 'k').px(4, 5, 'c').disc(8, 4, 1, 'g')),
        item_a_valvole: arm('plate', '#8a5a3a', '#ffb040', (p) => { for (const x of [4, 7, 10]) { p.rect(x, 4, 2, 4, 'V').rect(x, 8, 2, 1, 'k'); } p.px(4, 4, 'w').px(7, 4, 'w').px(10, 4, 'w').rect(4, 10, 8, 1, 'k'); }),
        item_a_cappotto: arm('robe', '#b8a080', '#6a4a2a', (p) => p.rect(3, 8, 10, 1, 'V').rect(7, 2, 2, 10, 'V').rect(3, 10, 3, 2, 'P').rect(10, 10, 3, 2, 'P').px(4, 10, 'k').px(11, 10, 'k').px(5, 5, 'Y').px(10, 5, 'Y')),
        item_a_giaccaroot: arm('jacket', '#2a2a34', '#e04848', (p) => p.st(6, 5, ['V.V.', 'VVVV', 'V.V.', 'VVVV', 'V.V.']).rect(7, 11, 2, 2, 'k')),
        item_a_piastrasudo: arm('plate', '#e8c040', '#8a6a10', (p) => p.st(6, 5, ['V.V.', 'VVVV', 'V.V.', 'VVVV', 'V.V.']).px(3, 3, 'W').px(12, 3, 'W').rect(5, 10, 6, 1, 'V')),
        item_a_vesteadmin: arm('robe', '#7a3ac0', '#ffd24a', (p) => p.rect(7, 2, 2, 12, 'V').rect(1, 13, 14, 1, 'V').disc(8, 6, 2, 'V').px(8, 6, 'o').rect(8, 8, 1, 3, 'V')),
        item_a_gilet: arm('vest', '#9ae8f0', '#ffffff', (p) => { p.rect(4, 7, 3, 4, 'V').rect(9, 7, 3, 4, 'V').px(5, 8, 'c').px(5, 9, 'c').px(10, 8, 'c').px(10, 9, 'c').rect(7, 4, 2, 8, 'k').px(7, 3, 'W'); }),
        item_a_nuvola: arm('robe', '#e8f0ff', '#a8c0e8', (p) => { p.er(0, 13, 16, 1); for (const x of [0, 3, 6, 9, 12]) p.rect(x, 13, 3, 1, 'U'); p.rect(5, 7, 6, 1, 'V').rect(4, 10, 8, 1, 'V'); p.rect(6, 1, 4, 1, 'V'); }),
        item_a_camice: arm('robe', '#f4f4f8', '#7ac8e0', (p) => p.rect(7, 2, 2, 12, 'V').rect(10, 6, 3, 2, 'W').px(11, 7, 'r').rect(4, 8, 2, 3, 'V').px(5, 7, 'c').px(4, 7, 'r').rect(3, 11, 3, 1, 'V')),
        // ── food
        item_f_crackers: P((p) => { p.rect(4, 5, 9, 8, 'T').rect(2, 3, 9, 8, 'U'); for (const [x, y] of [[4, 5], [7, 5], [5, 8], [8, 8]]) p.px(x, y, 'k'); p.px(9, 4, 'w').px(3, 9, 'w').px(6, 3, 'w'); }, { U: '#e8c878', T: '#b88a40' }),
        item_f_banana: P((p) => p.line(3, 11, 5, 12, 'Y', 1).line(5, 12, 10, 10, 'Y', 1).line(10, 10, 12, 7, 'Y', 1).line(12, 7, 12, 3, 'Y', 1).px(12, 2, 'T').px(13, 2, 'T').px(2, 10, 'T').px(3, 10, 'T'), { Y: '#f0d040' }),
        item_f_yogurt: P((p) => { p.rect(3, 2, 10, 2, 'G'); for (let y = 4; y < 14; y++) p.rect(3 + Math.floor((y - 4) / 4), y, 10 - 2 * Math.floor((y - 4) / 4), 1, 'W'); p.disc(8, 8, 2, 'R').px(7, 7, 'w').rect(5, 12, 6, 1, 'V'); }, { V: '#d84a6a' }),
        item_f_crostatina: P((p) => { p.disc(8, 8, 6, 'U').disc(8, 8, 4, 'R'); p.line(5, 5, 11, 11, 'U').line(11, 5, 5, 11, 'U').px(4, 3, 'w').px(12, 4, 'w').px(3, 12, 'w'); }, { U: '#d8a850' }),
        item_f_schiacciata: P((p) => { p.rect(2, 4, 12, 8, 'U').er(2, 4, 1, 1).er(13, 4, 1, 1).er(2, 11, 1, 1).er(13, 11, 1, 1); for (const [x, y] of [[4, 6], [7, 7], [10, 6], [5, 9], [9, 9], [12, 8]]) p.px(x, y, 'T'); p.px(6, 5, 'g').px(11, 10, 'g').px(8, 5, 'y').px(3, 8, 'y'); }, { U: '#e8c068', T: '#b88a40' }),
        item_f_tramezzino: P((p) => { for (let y = 3; y <= 13; y++) { const h = Math.floor((y - 3) * 0.65) + 1; p.rect(8 - h, y, h * 2, 1, y === 7 ? 'L' : y === 9 ? 'R' : y === 11 ? 'Y' : 'W'); } }, { L: '#4ab04a', R: '#e8808a' }),
        item_f_brioche: P((p) => { p.disc(8, 9, 5, 'U').disc(8, 3, 2, 'U').rect(3, 12, 10, 1, 'T'); p.line(5, 8, 5, 11, 'T').line(8, 7, 8, 11, 'T').line(11, 8, 11, 11, 'T').px(7, 8, 'w'); }, { U: '#e0a030', T: '#a06820' }),
        item_f_toast: P((p) => { p.rect(2, 3, 12, 11, 'T').rect(3, 4, 10, 9, 'U').rect(4, 7, 9, 2, 'R').rect(3, 9, 10, 2, 'Y').px(5, 10, 'k').px(9, 10, 'k').px(12, 4, 'w'); }, { U: '#f0d098', T: '#b8782c', R: '#f0909a' }),
        item_f_noodles: P((p) => { p.rect(4, 6, 8, 1, 'W'); for (let y = 7; y < 14; y++) p.rect(4 + Math.floor((y - 7) / 3), y, 8 - 2 * Math.floor((y - 7) / 3), 1, 'R'); p.rect(5, 9, 6, 2, 'Y').px(7, 4, 'Y').px(8, 5, 'Y').px(9, 4, 'Y').px(6, 3, 'w').px(10, 2, 'w').px(7, 1, 'w').line(13, 3, 10, 7, 'G'); }),
        item_f_insalata: P((p) => { p.rect(2, 6, 12, 7, 'C').rect(2, 5, 12, 1, 'G'); for (const [x, y, c] of [[3, 7, 'L'], [6, 8, 'L'], [9, 7, 'L'], [11, 9, 'L'], [4, 10, 'L'], [7, 11, 'L'], [5, 8, 'R'], [10, 11, 'R'], [8, 9, 'Y']]) p.rect(x, y, 2, 2, c); }, { L: '#4ab04a' }),
        item_f_pranzo: P((p) => { p.rect(10, 1, 4, 6, 'P').px(11, 3, 'k').px(12, 3, 'k').px(11, 5, 'k'); p.rect(2, 6, 12, 8, 'U').rect(5, 4, 6, 2, 'K').er(6, 5, 4, 1).rect(7, 9, 2, 2, 'Y').rect(2, 8, 12, 1, 'V'); }, { U: '#3a8ad8', V: '#2a5a9a' }),
        item_f_cioccolata: P((p) => { p.rect(3, 6, 8, 7, 'W').rect(4, 6, 6, 1, 'T').rect(11, 8, 3, 3, 'W').er(12, 9, 1, 1).px(5, 3, 'w').px(6, 2, 'w').px(8, 3, 'w').px(9, 2, 'w').px(7, 4, 'w').rect(4, 10, 6, 1, 'r'); }, { T: '#6a3a1a' }),
    };
    A.add(D);
});
