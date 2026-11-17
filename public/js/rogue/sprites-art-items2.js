// js/rogue/sprites-art-items2.js — the newer weapons (51) and throwables (9): key 'item_<id>' (the `sprite` of items.js). Painted with A.pic (see sprites-art.js): a silhouette plus details,
// the outline and the three tones are added by the engine. Weapons point up-right (grip bottom-left) unless the object is flat or upright; each has its own shape or head so it reads at 24 px.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) factory(require('./sprites-art.js'));
    else factory(root.Rogue.art);
})(typeof self !== 'undefined' ? self : this, function (A) {
    'use strict';
    const P = A.pic;
    const grip = (p, c) => p.line(1, 14, 4, 11, c || 'T', 1);            // a handle in the bottom-left corner
    const guard = (p, c) => p.line(3, 9, 6, 12, c || 'Y');                // a cross-guard where it meets the blade
    // a long pole going up-right with a head drawn by `head`
    const pole = (p, c, x1, y1) => p.line(2, 14, x1 || 11, y1 || 5, c || 'T', 0);
    const D = {
        // ── desk and classroom
        item_w_compasso: P((p) => p.line(8, 3, 4, 13, 'B').line(8, 3, 12, 12, 'B').rect(6, 1, 5, 2, 'Y').line(5, 9, 11, 9, 'G').px(4, 14, 'k').px(12, 13, 'R').px(12, 14, 'k')),
        item_w_squadra: P((p) => { for (let y = 2; y <= 13; y++) p.rect(2, y, y - 1, 1, 'C'); for (let y = 8; y <= 12; y++) p.rect(4, y, y - 7, 1, '.'); for (let x = 3; x < 14; x += 2) p.px(x, 13, 'k'); }),
        item_w_gessetto: P((p) => p.line(4, 12, 11, 5, 'W', 1).line(3, 13, 4, 12, 'P').px(12, 3, 'w').px(13, 5, 'w').px(14, 3, 'w').px(9, 10, 'P').px(2, 8, 'w').px(6, 3, 'w')),
        item_w_forbici: P((p) => p.line(8, 8, 5, 1, 'G').line(8, 8, 11, 1, 'G').line(8, 8, 5, 11, 'R').line(8, 8, 11, 11, 'R').disc(4, 12, 2, 'R').disc(12, 12, 2, 'R').er(4, 12, 1, 1).er(12, 12, 1, 1).px(8, 8, 'k')),
        item_w_bacchetta: P((p) => p.line(2, 13, 5, 10, 'K', 1).line(6, 9, 10, 5, 'G', 0).line(11, 4, 13, 2, 'B', 0).px(14, 1, 'R').px(13, 1, 'R').px(14, 2, 'R')),
        item_w_laser: P((p) => p.line(2, 13, 8, 7, 'K', 1).line(9, 6, 10, 5, 'G', 1).px(5, 10, 'R').px(6, 9, 'R').px(12, 3, 'r').px(14, 1, 'r').px(13, 1, 'w')),
        item_w_registro: P((p) => p.rect(3, 2, 10, 12, 'U').rect(3, 2, 2, 12, 'R').rect(6, 4, 5, 4, 'W').px(7, 5, 'k').px(8, 5, 'k').px(9, 5, 'k').px(7, 6, 'k').px(9, 6, 'k').rect(3, 2, 10, 1, 'Y').rect(6, 10, 5, 1, 'Y'), { U: '#2f7a48' }),
        item_w_campanella: P((p) => p.st(4, 3, ['..YYYY..', '.YYYYYY.', '.YYYYYY.', 'YYYYYYYY', 'YYYYYYYY', 'YYYYYYYY']).rect(2, 9, 12, 1, 'Y').px(7, 10, 'K').px(8, 10, 'K').rect(7, 11, 2, 1, 'K').rect(7, 0, 2, 3, 'T').rect(6, 12, 4, 2, 'T')),
        item_w_timbro: P((p) => p.disc(8, 3, 2, 'T').rect(7, 5, 3, 4, 'T').rect(4, 9, 9, 3, 'K').rect(4, 12, 9, 2, 'R').px(6, 13, 'w').px(9, 13, 'w').px(11, 13, 'w')),
        // ── office and school hardware
        item_w_manuale: P((p) => p.rect(3, 2, 10, 12, 'U').rect(3, 2, 2, 12, 'K').rect(6, 4, 6, 3, 'W').rect(6, 9, 6, 1, 'Y').rect(12, 3, 1, 10, 'P'), { U: '#3a6ac0' }),
        item_w_faldone: P((p) => p.rect(3, 2, 9, 12, 'U').rect(5, 4, 5, 4, 'W').st(1, 4, ['GG', 'G.']).st(1, 8, ['GG', 'G.']).st(1, 11, ['GG', 'G.']).rect(3, 12, 9, 1, 'k'), { U: '#c8402a' }),
        item_w_pinzatrice: P((p) => p.rect(2, 8, 12, 3, 'R').rect(2, 11, 12, 2, 'K').rect(12, 8, 2, 2, 'G').px(3, 8, 'w').rect(5, 9, 4, 1, 'o')),
        item_w_perforatore: P((p) => p.rect(2, 11, 12, 3, 'G').line(3, 10, 12, 5, 'K', 1).disc(12, 5, 2, 'R').px(6, 12, 'o').px(9, 12, 'o').rect(4, 9, 3, 2, 'K')),
        item_w_taglia: P((p) => p.line(1, 12, 7, 8, 'R').line(3, 14, 8, 10, 'R').disc(9, 8, 1, 'G').line(9, 7, 13, 2, 'B').line(10, 9, 14, 5, 'B').px(14, 2, 'B')),
        item_w_alimentatore: P((p) => p.rect(7, 2, 7, 5, 'K').px(12, 3, 'c').rect(8, 3, 3, 1, 'G').line(8, 7, 7, 9, 'K').line(7, 9, 4, 11, 'K').rect(1, 11, 4, 3, 'G').px(2, 14, 'Y').px(4, 14, 'Y').px(0, 12, 'Y')),
        item_w_ventola: P((p) => p.rect(2, 2, 12, 12, 'K').disc(8, 8, 5, '.').rect(4, 6, 3, 2, 'B').rect(9, 8, 3, 2, 'B').rect(8, 4, 2, 3, 'B').rect(6, 9, 2, 3, 'B').disc(8, 8, 1, 'G').px(3, 3, 'o').px(12, 3, 'o').px(3, 12, 'o').px(12, 12, 'o')),
        item_w_scala: P((p) => { p.line(2, 13, 9, 2, 'B').line(5, 14, 12, 3, 'B'); for (const y of [4, 6, 8, 10, 12]) { const x1 = Math.round(2 + ((13 - y) * 7) / 11) + 1; p.line(x1, y, x1 + 2, y, 'G'); } }),
        item_w_torcia: P((p) => p.line(2, 13, 8, 7, 'K', 1).line(9, 6, 12, 3, 'G', 1).px(13, 2, 'Y').px(14, 2, 'y').px(14, 1, 'y').px(14, 3, 'y').px(5, 10, 'R').px(6, 9, 'R')),
        item_w_switch: P((p) => { p.rect(1, 5, 14, 6, 'G').rect(1, 4, 2, 8, 'K'); for (let i = 0; i < 5; i++) { p.rect(4 + i * 2, 6, 1, 2, 'k'); p.rect(4 + i * 2, 9, 1, 1, i % 2 ? 'c' : 'Y'); } }),
        item_w_patch: P((p) => p.line(2, 14, 7, 9, 'T', 0).line(7, 9, 9, 7, 'K').disc(11, 4, 3, 'K').line(9, 2, 13, 6, 'R').line(10, 2, 14, 6, 'Y').line(8, 3, 12, 7, 'C')),
        item_w_antenna: P((p) => p.line(2, 14, 4, 11, 'K', 1).line(4, 11, 13, 2, 'G').rect(3, 12, 2, 1, 'Y').disc(14, 1, 1, 'R')),
        // ── blades
        item_w_lama: P((p) => { grip(p); guard(p); p.line(5, 10, 13, 2, 'K', 1).line(6, 9, 12, 3, 'c'); }),
        item_w_lamaroot: P((p) => { grip(p, 'K'); guard(p, 'R'); p.line(5, 10, 13, 2, 'K', 1).line(5, 9, 12, 2, 'r').px(14, 1, 'r'); }),
        item_w_katana: P((p) => { p.line(1, 14, 4, 11, 'K', 1).line(3, 10, 4, 11, 'R').line(5, 9, 6, 10, 'Y').line(6, 9, 13, 2, 'C').line(7, 9, 14, 3, 'W'); }),
        item_w_quantum: P((p) => { grip(p, 'K'); guard(p, 'C'); p.line(5, 10, 13, 2, 'B', 1).line(4, 9, 11, 2, 'C').px(14, 1, 'w').px(2, 5, 'w').px(12, 10, 'w').px(14, 7, 'c'); }),
        item_w_incisivo: P((p) => p.st(3, 2, ['..WWW...', '.WWWWW..', '.WWWWW..', '..WWWW..', '..WWWW..', '..WWW...', '...WW...', '...WW...', '....W...', '....W...']).px(5, 3, 'w')),
        item_w_chiave: P((p) => p.disc(4, 11, 3, 'Y').disc(4, 11, 1, '.').line(6, 9, 13, 2, 'Y', 1).rect(11, 4, 2, 1, '.').px(10, 5, 'Y').px(9, 6, 'Y').rect(9, 4, 2, 1, 'Y').px(14, 4, 'Y').px(12, 6, 'Y').px(13, 7, 'Y').px(4, 11, 'o').px(3, 10, 'r')),
        item_w_crimpatore: P((p) => p.line(1, 12, 7, 8, 'R').line(3, 14, 8, 10, 'R').disc(9, 8, 1, 'K').rect(9, 4, 4, 4, 'G').rect(11, 3, 3, 2, 'K').rect(10, 9, 4, 3, 'G').px(11, 6, 'o')),
        // ── hammers and axes
        item_w_ascia: P((p) => { pole(p, 'T', 10, 6); p.st(8, 1, ['..BBBB', '.BBBBBB', 'BBBBBBB', 'BBBBBBB', '.BBBBB.', '..BBB..']).px(11, 3, 'c').px(12, 2, 'c').px(12, 4, 'c').px(10, 4, 'c'); }),
        item_w_diskaxe: P((p) => { pole(p, 'T', 9, 7); p.disc(11, 4, 3, 'G').px(11, 4, 'o').line(14, 1, 14, 7, 'K').px(10, 3, 'W'); }),
        item_w_martelletto: P((p) => { p.line(2, 14, 9, 7, 'T', 0).rect(8, 2, 7, 4, 'T').rect(10, 2, 1, 4, 'Y').rect(13, 2, 1, 4, 'Y').px(9, 3, 'w'); }),
        item_w_regolamento: P((p) => { pole(p, 'T', 9, 7); p.rect(8, 1, 7, 6, 'R').rect(14, 2, 1, 4, 'P').rect(9, 3, 4, 1, 'Y'); }),
        item_w_maglio: P((p) => { pole(p, 'T', 9, 7); p.rect(7, 1, 8, 6, 'K').rect(8, 3, 6, 1, 'c').rect(8, 5, 6, 1, 'c'); }),
        item_w_martellosudo: P((p) => { pole(p, 'T', 9, 7); p.rect(7, 1, 8, 6, 'Y').rect(9, 2, 1, 4, 'k').rect(12, 2, 1, 4, 'k').rect(8, 3, 6, 1, 'k').rect(8, 4, 6, 1, 'Y').rect(8, 5, 6, 1, 'k'); }),
        item_w_banhammer: P((p) => { pole(p, 'T', 9, 7); p.rect(6, 1, 9, 6, 'R').disc(10, 4, 2, 'W').line(9, 5, 12, 2, 'R').px(10, 4, 'R'); }),
        item_w_mazza: P((p) => { pole(p, 'T', 9, 7); p.rect(7, 1, 8, 6, 'U').px(9, 2, 'o').px(10, 3, 'o').px(11, 4, 'o').px(11, 5, 'o').px(13, 2, 'Y').rect(7, 1, 8, 1, 'K'); }, { U: '#8a6a50' }),
        item_w_firewall: P((p) => { p.line(2, 14, 7, 9, 'T', 0).rect(6, 1, 8, 8, 'R'); for (const y of [3, 5, 7]) p.rect(6, y, 8, 1, 'o'); p.px(8, 2, 'Y').px(11, 4, 'Y').px(9, 6, 'Y').px(12, 8, 'Y').px(7, 4, 'y'); }, { R: '#d8542a' }),
        item_w_tranciaschede: P((p) => p.rect(2, 10, 12, 4, 'K').rect(3, 8, 8, 2, 'P').line(2, 9, 13, 2, 'B', 1).disc(2, 9, 1, 'R').px(11, 4, 'w')),
        item_w_incudine: P((p) => p.disc(7, 2, 1, 'W').disc(10, 2, 2, 'W').rect(5, 2, 8, 2, 'W').rect(3, 6, 11, 3, 'K').rect(1, 6, 2, 1, 'K').rect(6, 9, 5, 2, 'K').rect(4, 11, 9, 3, 'K')),
        // ── whips, flails, poles
        item_w_cavo5: P((p) => { grip(p); p.line(4, 11, 3, 6, 'U').line(3, 6, 7, 3, 'U').line(7, 3, 12, 4, 'U').px(13, 5, 'W').px(14, 5, 'W').px(14, 4, 'G').px(12, 5, 'Y').px(5, 4, 'Y').px(3, 9, 'Y'); }, { U: '#3ac07a' }),
        item_w_frusta: P((p) => { grip(p); p.line(4, 11, 7, 7, 'K').line(7, 7, 10, 8, 'K').line(10, 8, 11, 5, 'K').st(11, 1, ['.YY', 'YY.', '.Y.', 'Y..']); }),
        item_w_nunchaku: P((p) => { p.line(1, 13, 5, 9, 'R', 1).line(10, 6, 14, 2, 'R', 1).line(5, 9, 6, 11, 'G').line(6, 11, 9, 11, 'G').line(9, 11, 10, 6, 'G').px(2, 12, 'W').px(12, 4, 'W'); }),
        item_w_flagello: P((p) => { p.line(1, 14, 6, 9, 'T', 0).line(6, 9, 9, 6, 'G'); p.disc(11, 4, 3, 'G').px(11, 4, 'o').rect(9, 1, 5, 1, 'T').rect(9, 7, 5, 1, 'T'); }),
        item_w_valvola: P((p) => { p.line(4, 11, 11, 4, 'C', 1).disc(12, 3, 2, 'C').line(7, 8, 11, 4, 'Y').rect(2, 12, 3, 2, 'K').px(1, 14, 'G').px(3, 14, 'G').px(5, 14, 'G'); }),
        item_w_scettro: P((p) => { pole(p, 'T', 11, 5); p.disc(12, 3, 3, 'Y').px(12, 3, 'c').px(11, 2, 'w').rect(4, 11, 3, 1, 'Y'); }),
        item_w_lancia: P((p) => { pole(p, 'T', 11, 5); p.st(11, 0, ['..B', '.BB', 'BBB', 'BB.']).line(8, 8, 10, 6, 'R', 0).px(6, 10, 'C').px(7, 9, 'Y').px(5, 11, 'R'); }),
        item_w_rack: P((p) => { p.line(2, 14, 11, 5, 'G', 1); for (const [x, y] of [[4, 12], [6, 10], [8, 8]]) p.px(x, y, 'o'); p.st(11, 0, ['..B', '.BB', 'BBB', 'BB.']).px(9, 7, 'o'); }),
        item_w_defrag: P((p) => { pole(p, 'T', 9, 7); p.rect(7, 1, 7, 5, 'K').rect(8, 2, 2, 1, 'C').rect(11, 2, 2, 1, 'R').rect(8, 4, 2, 1, 'Y').rect(11, 4, 2, 1, 'C').rect(10, 3, 1, 1, 'Y'); }),
        item_w_ctrl: P((p) => { for (const [x, n] of [[1, 1], [6, 2], [11, 3]]) { p.rect(x, 4, 4, 6, 'G').rect(x, 10, 4, 2, 'K').rect(x + 1, 6, 2, 1, 'k'); if (n > 1) p.px(x + 1, 8, 'k'); if (n > 2) p.px(x + 2, 8, 'k'); } }),
        item_w_bobina: P((p) => p.disc(6, 9, 5, 'G').disc(6, 9, 4, 'Y').disc(6, 9, 2, 'G').px(6, 9, 'o').line(10, 5, 14, 1, 'C').px(13, 1, 'w')),
        item_w_exorcist: P((p) => p.rect(2, 9, 12, 4, 'K').line(4, 9, 3, 4, 'G').line(12, 9, 13, 4, 'G').line(8, 9, 8, 4, 'G').st(7, 0, ['.Y.', 'YYY', '.Y.']).px(3, 3, 'W').px(13, 3, 'W').px(4, 11, 'c').px(7, 11, 'Y').px(10, 11, 'c').rect(5, 12, 6, 1, 'k')),
        // ── throwables
        item_t_puntine: P((p) => p.st(1, 1, ['RRRR', 'RRRR', '.RR.', '..k.', '..k.']).st(9, 2, ['CCCC', 'CCCC', '.CC.', '..k.', '..k.']).st(4, 9, ['YYYY', 'YYYY', '.YY.', '..k.', '..k.'])),
        item_t_rj45: P((p) => p.rect(4, 2, 8, 8, 'C').rect(6, 10, 4, 2, 'C').rect(5, 12, 6, 3, 'U').rect(5, 3, 1, 3, 'Y').rect(7, 3, 1, 3, 'Y').rect(9, 3, 1, 3, 'Y').rect(11, 3, 1, 3, 'Y').rect(5, 7, 6, 1, 'k'), { U: '#3a6ac0' }),
        item_t_floppy: P((p) => p.line(8, 1, 8, 14, 'U', 1).line(1, 8, 14, 8, 'U', 0).rect(4, 4, 8, 8, 'U').er(4, 4, 2, 2).er(10, 4, 2, 2).er(4, 10, 2, 2).er(10, 10, 2, 2).rect(7, 7, 3, 3, 'G').px(8, 8, 'o'), { U: '#3a6ad8' }),
        item_t_toner: P((p) => p.rect(3, 7, 10, 6, 'K').rect(4, 5, 8, 2, 'K').rect(5, 9, 6, 2, 'c').px(2, 4, 'G').px(4, 3, 'G').px(7, 2, 'G').px(11, 3, 'G').px(13, 5, 'G').px(1, 6, 'k').px(14, 7, 'k')),
        item_t_piatto: P((p) => p.disc(8, 8, 6, 'G').disc(8, 8, 3, 'B').disc(8, 8, 1, '.').px(4, 5, 'w').px(5, 4, 'w').px(6, 3, 'w')),
        item_t_punch: P((p) => { p.rect(4, 7, 10, 7, 'W').rect(2, 2, 11, 8, 'P').er(2, 2, 1, 1); for (let x = 3; x < 12; x += 2) { p.px(x, 4, 'k'); p.px(x + (x % 4 ? 0 : 1), 6, 'k'); } p.rect(3, 8, 9, 1, 'R'); }),
        item_t_cella: P((p) => p.rect(5, 3, 6, 10, 'Y').rect(6, 1, 4, 2, 'G').rect(5, 9, 6, 2, 'R').px(8, 6, 'k').px(7, 6, 'k').px(8, 5, 'k').px(8, 7, 'k').px(3, 4, 'y').px(12, 3, 'y').px(13, 6, 'y')),
        item_t_dissipatore: P((p) => { p.rect(2, 10, 12, 4, 'K'); for (let x = 3; x < 14; x += 2) p.rect(x, 2, 1, 8, 'B'); p.rect(2, 10, 12, 1, 'G'); }),
        item_t_manuale: P((p) => p.rect(3, 2, 10, 12, 'U').rect(3, 2, 2, 12, 'K').rect(12, 3, 1, 10, 'P').rect(6, 4, 5, 3, 'W').rect(6, 9, 5, 1, 'Y').rect(6, 11, 5, 1, 'Y'), { U: '#8a4ac8' }),
    };
    A.add(D);
});
