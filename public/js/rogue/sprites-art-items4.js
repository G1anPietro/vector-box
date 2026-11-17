// js/rogue/sprites-art-items4.js — the newer cans (17) and scripts (20): key 'item_<id>'. Painted with A.pic (see sprites-art.js).
// These are unidentified-by-use: the game shows the plain category icon until the player knows the item, and only then this drawing, in the tint of the look it was given
// (cans: any colour, so the body is the tint 'B'; scripts: always pale paper, so a script is told apart by its shape and rune, never by colour).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) factory(require('./sprites-art.js'));
    else factory(root.Rogue.art);
})(typeof self !== 'undefined' ? self : this, function (A) {
    'use strict';
    const P = A.pic;
    const can = (p, x, y, w, h) => p.rect(x, y, w, h, 'B').rect(x, y, w, 1, 'G').rect(x, y + h - 1, w, 1, 'G');
    const sheet = (p) => p.rect(3, 1, 10, 14, 'B').er(11, 1, 2, 1).er(12, 2, 1, 1).px(10, 1, 'G').px(10, 2, 'G').px(11, 2, 'G');
    const scroll = (p) => p.rect(3, 2, 10, 12, 'B').rect(2, 0, 12, 2, 'Y').rect(2, 14, 12, 2, 'Y');
    const lines = (p, ys, x0, x1) => { for (const y of ys) p.rect(x0 || 4, y, (x1 || 11) - (x0 || 4), 1, 'g'); return p; };
    const D = {
        // ── cans
        item_d_mini: P((p) => can(p, 5, 6, 6, 7).rect(5, 8, 6, 1, 'W').px(8, 10, 'R').px(7, 10, 'R').px(9, 10, 'R')),
        item_d_cola: P((p) => { can(p, 4, 2, 8, 12).rect(4, 6, 8, 4, 'W'); for (let x = 4; x < 12; x++) p.px(x, 7 + (x % 3 === 0 ? 1 : 0), 'R'); p.px(6, 9, 'R'); }),
        item_d_smoothie: P((p) => { p.rect(5, 3, 6, 1, 'W').rect(4, 4, 8, 1, 'W'); for (let y = 5; y < 14; y++) p.rect(4 + Math.floor((y - 5) / 4), y, 8 - 2 * Math.floor((y - 5) / 4), 1, 'B'); p.line(10, 0, 8, 4, 'R').rect(6, 8, 2, 2, 'R').px(9, 10, 'Y').px(6, 11, 'Y'); }),
        item_d_max: P((p) => { can(p, 4, 1, 8, 13).rect(4, 3, 8, 1, 'K').rect(4, 11, 8, 1, 'K').st(6, 4, ['..YY', '.YY.', 'YYYY', '.YY.', 'YY..']); }),
        item_d_forza2: P((p) => p.rect(5, 4, 6, 10, 'B').rect(5, 2, 6, 2, 'K').rect(11, 1, 2, 2, 'K').px(5, 6, 'w').px(5, 8, 'w').px(5, 10, 'w').st(6, 8, ['W.W', 'WWW', 'W.W'])),
        item_d_vita2: P((p) => p.rect(4, 5, 8, 9, 'B').rect(4, 3, 8, 2, 'W').rect(5, 9, 6, 3, 'W').rect(7, 9, 2, 3, 'R').rect(6, 10, 4, 1, 'R').px(6, 6, 'Y').px(8, 7, 'R').px(10, 6, 'C').px(5, 7, 'L').px(10, 8, 'Y'), { L: '#4ab04a' }),
        item_d_veloce2: P((p) => p.rect(4, 7, 7, 6, 'B').rect(11, 8, 2, 3, 'B').er(12, 9, 1, 1).rect(2, 12, 12, 2, 'G').rect(4, 7, 7, 1, 'T').px(6, 3, 'w').px(7, 2, 'w').px(8, 4, 'w').px(9, 3, 'w').px(6, 5, 'w').px(5, 9, 'T').px(6, 10, 'T')),
        item_d_veloce3: P((p) => p.rect(6, 1, 4, 3, 'B').rect(4, 4, 8, 10, 'B').rect(6, 0, 4, 1, 'T').rect(5, 6, 2, 2, 'W').rect(8, 9, 2, 2, 'W').rect(6, 11, 2, 2, 'W').rect(4, 8, 8, 1, 'K').px(10, 6, 'w')),
        item_d_regen2: P((p) => p.rect(3, 7, 8, 6, 'B').rect(11, 8, 2, 3, 'B').er(12, 9, 1, 1).rect(2, 13, 11, 1, 'G').st(5, 2, ['.LL.', 'LLLL', 'LL..']).line(8, 4, 9, 7, 'W').rect(10, 4, 2, 2, 'W').rect(3, 7, 8, 1, 'L'), { L: '#4ab04a' }),
        item_d_invis2: P((p) => { can(p, 4, 2, 8, 12); for (let y = 8; y < 13; y++) for (let x = 4; x < 12; x++) if ((x + y) % 2) p.px(x, y, '.'); p.px(13, 4, 'w').px(2, 9, 'w').px(14, 11, 'w').px(6, 5, 'W').px(9, 5, 'W'); }),
        item_d_acida: P((p) => p.rect(4, 5, 8, 9, 'B').st(4, 2, ['..BBBB..', '.BBBBBB.']).rect(7, 1, 2, 2, 'G').st(6, 7, ['WWWW', 'WkkW', 'WWWW', '.WW.']).rect(11, 5, 1, 6, 'L').px(11, 12, 'L').px(11, 13, 'L'), { L: '#7ad84a' }),
        item_d_mistero: P((p) => { can(p, 4, 2, 8, 12).rect(4, 5, 8, 7, 'K').st(6, 6, ['.WW.', 'W..W', '..W.', '.W..', '....', '.W..']); }),
        item_d_xp2: P((p) => { can(p, 4, 2, 8, 12).rect(4, 5, 8, 7, 'W').st(5, 6, ['..Y..', 'YYYYY', '.YYY.', 'YY.YY']).rect(5, 11, 6, 1, 'R'); }),
        item_d_fuoco: P((p) => { can(p, 4, 2, 8, 12).st(5, 5, ['...R..', '..RR.R', '.RRYRR', '.RYYYR', '.RRYRR', '..RRR.']); }),
        item_d_calma: P((p) => { can(p, 4, 2, 8, 12).line(8, 5, 8, 11, 'W').line(5, 8, 11, 8, 'W').line(6, 6, 10, 10, 'W').line(10, 6, 6, 10, 'W').px(12, 3, 'w'); }),
        item_d_coraggio: P((p) => { p.rect(3, 4, 10, 1, 'W'); for (let y = 5; y < 13; y++) p.rect(3 + Math.floor((y - 5) / 3), y, 10 - 2 * Math.floor((y - 5) / 3), 1, 'B'); p.rect(5, 12, 6, 2, 'G').st(6, 6, ['..Y..', 'YYYYY', '.YYY.', 'YY.YY']); }),
        item_d_radar: P((p) => { can(p, 4, 2, 8, 12).disc(8, 8, 3, 'K').line(8, 8, 10, 5, 'c').px(6, 7, 'c').px(10, 9, 'c').px(7, 10, 'Y').px(8, 8, 'W'); }),
        // ── scripts
        item_s_tail: P((p) => { sheet(p); lines(p, [3, 4]); p.st(4, 6, ['.kkkk.', 'kwcckk', '.kkkk.']).st(6, 10, ['.c.', '.c.', 'ccc', '.c.']); }),
        item_s_rmfile: P((p) => { sheet(p); lines(p, [3], 4, 9); p.line(5, 6, 10, 11, 'r').line(10, 6, 5, 11, 'r').line(6, 6, 10, 10, 'r'); }),
        item_s_killall: P((p) => { sheet(p); lines(p, [3, 4], 4, 9); p.st(5, 6, ['.rrrr.', 'rrrrrr', 'rkrrkr', '.rrrr.', '.rkrk.']); lines(p, [12], 5, 10); }),
        item_s_rmrf2: P((p) => { sheet(p); p.st(5, 3, ['r.r.r', '.rrr.', 'rrrrr', '.rrr.', 'r.r.r']); p.rect(3, 11, 10, 4, 'K').px(4, 10, 'R').px(6, 9, 'R').px(6, 10, 'Y').px(9, 10, 'R').px(11, 10, 'Y').px(10, 9, 'R').px(7, 10, 'R'); }),
        item_s_nohup: P((p) => { sheet(p); for (let y = 7; y < 15; y++) for (let x = 3; x < 13; x++) if ((x + y) % 2) p.px(x, y, '.'); lines(p, [3, 4]); p.line(5, 6, 10, 6, 'k').px(5, 7, 'k').px(10, 7, 'k'); }),
        item_s_screen: P((p) => { sheet(p); p.rect(4, 3, 6, 5, 'K').rect(5, 4, 4, 3, 'C').rect(7, 7, 5, 5, 'K').rect(8, 8, 3, 3, 'L'); lines(p, [13], 4, 9); }, { L: '#4ab04a' }),
        item_s_cron: P((p) => { sheet(p); p.disc(8, 8, 4, 'K').disc(8, 8, 3, 'W').line(8, 8, 8, 6, 'k').line(8, 8, 10, 8, 'k').px(8, 5, 'r'); lines(p, [3, 13], 4, 10); }),
        item_s_revert: P((p) => { sheet(p); lines(p, [3], 4, 9); p.line(6, 6, 10, 6, 'L').line(10, 6, 10, 10, 'L').line(10, 10, 6, 10, 'L').st(4, 7, ['.L.', 'LLL']).px(6, 11, 'L'); lines(p, [13], 4, 9); }, { L: '#2a9a48' }),
        item_s_restart: P((p) => { sheet(p); p.disc(8, 9, 4, 'C').disc(8, 9, 2, 'B').rect(8, 5, 1, 5, 'k').px(10, 5, 'C').px(11, 6, 'C'); lines(p, [3], 4, 9); }),
        item_s_fsck: P((p) => { sheet(p); lines(p, [3], 4, 9); p.rect(7, 5, 3, 7, 'R').rect(5, 7, 7, 3, 'R'); lines(p, [13], 4, 9); }),
        item_s_yes: P((p) => { sheet(p); for (const y of [3, 7, 11]) for (const x of [4, 8]) p.st(x, y, ['k.k', '.k.', '.k.']); p.px(11, 3, 'c').px(12, 4, 'c').px(11, 5, 'c').px(10, 4, 'c'); }),
        item_s_dd: P((p) => { sheet(p); lines(p, [3], 4, 9); p.disc(8, 8, 4, 'K').disc(8, 8, 1, 'W').disc(8, 8, 2, 'G').px(8, 8, 'o').px(5, 13, 'L').px(8, 14, 'L').px(11, 13, 'L'); }, { L: '#7ad84a' }),
        item_s_forkbomb: P((p) => { sheet(p); p.disc(7, 10, 3, 'K').line(9, 8, 11, 6, 'T').px(12, 5, 'Y').px(11, 5, 'R').px(12, 4, 'R').px(6, 9, 'W'); lines(p, [3, 4], 4, 9); }),
        item_s_sudosu: P((p) => { sheet(p); lines(p, [3], 4, 9); p.st(4, 6, ['Y.Y.Y.Y', 'YYYYYYY', 'YYYYYYY', 'YrYrYrY']); lines(p, [12, 13], 4, 9); }),
        item_s_shutdown: P((p) => { sheet(p); p.disc(8, 9, 4, 'R').disc(8, 9, 3, 'B').rect(7, 5, 3, 3, 'B').rect(8, 5, 1, 5, 'R'); lines(p, [3], 4, 9); }),
        item_s_pip: P((p) => { sheet(p); p.rect(4, 6, 8, 6, 'T').rect(7, 6, 2, 6, 'P').st(6, 3, ['.Y', 'YY', '.Y']).rect(4, 6, 8, 1, 'T'); lines(p, [13], 4, 9); }),
        item_s_distup: P((p) => { scroll(p); p.st(6, 4, ['..Y..', '.YYY.', 'YYYYY', '..Y..', '..Y..', '..Y..']).rect(5, 11, 6, 1, 'g'); }),
        item_s_useradd: P((p) => { scroll(p); p.disc(7, 5, 1, 'k').rect(5, 7, 5, 4, 'k').rect(11, 6, 1, 3, 'L').rect(10, 7, 3, 1, 'L'); lines(p, [12], 5, 10); }, { L: '#2a9a48' }),
        item_s_commit: P((p) => { scroll(p); p.rect(8, 3, 1, 3, 'k').rect(8, 10, 1, 3, 'k').disc(8, 8, 2, 'C').px(8, 8, 'W').px(11, 5, 'Y').px(5, 11, 'Y').px(12, 10, 'Y'); }),
        item_s_find: P((p) => { sheet(p); lines(p, [3], 4, 9); p.disc(7, 8, 3, 'K').disc(7, 8, 2, 'C').line(9, 10, 12, 13, 'T').px(6, 7, 'W').px(5, 12, 'r').px(5, 13, 'r').px(4, 13, 'r'); }),
    };
    A.add(D);
});
