// js/rogue/sprites-art-items5.js — the newer USB sticks (16) and plugins (29): key 'item_<id>'. Painted with A.pic (see sprites-art.js).
// Both kinds are unknown until used: the game shows the plain category icon first and this drawing afterwards, in the colour of the look the item was given, so the body is
// the tint 'B' and the identifying marks use fixed colours. USB: a shell shape (slim / standard / wide / long / ring) + a symbol. Plugins: a different object each (chip, DIMM, card, pad, headphones...).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) factory(require('./sprites-art.js'));
    else factory(root.Rogue.art);
})(typeof self !== 'undefined' ? self : this, function (A) {
    'use strict';
    const P = A.pic;
    // a USB stick: connector on top, shell of width w from x, down to row y1; `round` clips the lower corners
    const usb = (p, x, w, y1, round) => {
        p.rect(x + 1, 1, w - 2, 4, 'G').rect(x + 2, 2, 1, 2, 'k').rect(x + w - 3, 2, 1, 2, 'k').rect(x, 5, w, y1 - 4, 'B');
        if (round) p.er(x, y1, 1, 1).er(x + w - 1, y1, 1, 1);
        return p;
    };
    const chip = (p) => { for (const i of [4, 6, 8, 10]) { p.rect(i, 1, 1, 2, 'G').rect(i, 13, 1, 2, 'G').rect(1, i, 2, 1, 'G').rect(13, i, 2, 1, 'G'); } return p.rect(3, 3, 10, 10, 'B'); };
    const D = {
        // ── USB sticks
        item_u_ping: P((p) => usb(p, 6, 4, 13).st(6, 7, ['.W.', 'W.W', '...']).st(7, 10, ['W'])),
        item_u_worm: P((p) => usb(p, 5, 6, 14).line(6, 8, 7, 8, 'L').line(7, 8, 8, 10, 'L').line(8, 10, 7, 12, 'L').line(7, 12, 9, 13, 'L').px(9, 12, 'L').px(10, 9, 'W'), { L: '#4ab04a' }),
        item_u_ransom: P((p) => usb(p, 4, 8, 13).rect(6, 9, 4, 3, 'Y').px(6, 8, 'Y').px(9, 8, 'Y').rect(7, 7, 2, 1, 'Y').px(8, 10, 'k').rect(3, 14, 2, 1, 'G')),
        item_u_rootkit: P((p) => usb(p, 4, 8, 14).st(5, 7, ['W.W.W', 'WWWWW', 'W.W.W', 'WWWWW', 'W.W.W']).px(11, 12, 'r').px(5, 12, 'r')),
        item_u_deepfreeze: P((p) => { usb(p, 5, 6, 12).line(8, 6, 8, 11, 'W').line(6, 8, 10, 8, 'W').line(6, 6, 10, 10, 'W').line(10, 6, 6, 10, 'W'); p.rect(5, 13, 1, 2, 'C').rect(7, 13, 1, 1, 'C').rect(9, 13, 1, 3, 'C').rect(10, 13, 1, 1, 'C'); }),
        item_u_throttle: P((p) => usb(p, 6, 4, 14).st(6, 7, ['Y.Y', '.Y.']).st(6, 10, ['Y.Y', '.Y.'])),
        item_u_vampire: P((p) => usb(p, 5, 6, 13).rect(6, 8, 4, 1, 'R').px(6, 9, 'W').px(9, 9, 'W').px(7, 9, 'R').px(8, 9, 'R').px(8, 11, 'R').px(8, 12, 'R')),
        item_u_leech: P((p) => usb(p, 6, 4, 13).st(6, 7, ['KK', '.KK', 'KK.', '.KK']).px(8, 12, 'R').px(8, 11, 'R')),
        item_u_molotov: P((p) => usb(p, 4, 8, 12, true).st(6, 6, ['..R..', '.RRR.', 'RRYRR', 'RYYYR', '.RRR.'])),
        item_u_napalm: P((p) => usb(p, 4, 8, 14).rect(4, 6, 8, 1, 'K').rect(4, 13, 8, 1, 'K').st(5, 7, ['R..R.R.', 'RR.RRRR', 'RRRYRRR', 'RYYYYYR', '.RRYYR.'])),
        item_u_lullaby: P((p) => usb(p, 5, 6, 13, true).st(7, 7, ['.WW', '.W.', '.W.', 'WW.']).px(10, 8, 'W').px(11, 11, 'w').px(10, 11, 'w')),
        item_u_scarecrow: P((p) => { usb(p, 5, 6, 13).st(4, 6, ['..YYYY..', 'YYYYYYYY']).line(6, 9, 9, 12, 'T').line(9, 9, 6, 12, 'T'); p.rect(7, 14, 2, 2, 'G'); }),
        item_u_bin: P((p) => usb(p, 4, 8, 13).rect(5, 7, 6, 1, 'G').rect(7, 6, 2, 1, 'G').rect(6, 8, 4, 4, 'G').rect(7, 9, 1, 2, 'k').rect(9, 9, 1, 2, 'k')),
        item_u_radar: P((p) => usb(p, 5, 6, 13, true).disc(8, 10, 3, 'K').line(8, 10, 10, 8, 'c').px(7, 9, 'c').px(9, 11, 'c').px(8, 10, 'W')),
        item_u_tempesta: P((p) => usb(p, 4, 8, 13).rect(5, 6, 6, 2, 'W').rect(6, 5, 3, 1, 'W').rect(4, 7, 8, 1, 'G').st(7, 8, ['.YY', 'YY.', '.Y.', 'Y..'])),
        item_u_sigkill: P((p) => { usb(p, 5, 6, 14).st(6, 6, ['WWWW', 'WkWk', 'WWWW', '.WW.']).rect(5, 11, 6, 1, 'R').rect(5, 13, 6, 1, 'R'); }),
        // ── plugins
        item_p_vpn: P((p) => { chip(p).rect(6, 8, 4, 3, 'Y').px(6, 7, 'Y').px(9, 7, 'Y').rect(7, 6, 2, 1, 'Y').px(8, 9, 'k'); }),
        item_p_ram: P((p) => { p.rect(1, 4, 14, 7, 'B').rect(1, 11, 14, 2, 'Y').er(7, 12, 1, 1).er(8, 12, 1, 1); for (const x of [2, 5, 9, 12]) p.rect(x, 5, 2, 4, 'K'); p.px(1, 4, 'w').rect(1, 9, 14, 1, 'g'); }),
        item_p_ssd: P((p) => { p.rect(2, 3, 12, 10, 'B').rect(2, 12, 12, 1, 'G').rect(4, 5, 8, 4, 'W').rect(5, 6, 1, 2, 'k').rect(7, 6, 1, 2, 'k').rect(9, 6, 1, 2, 'k').rect(11, 2, 2, 1, 'Y').rect(3, 13, 10, 2, 'Y').px(3, 4, 'k').px(12, 4, 'k'); }),
        item_p_gpu: P((p) => { p.rect(1, 3, 14, 9, 'B').rect(1, 12, 14, 2, 'Y').rect(0, 2, 1, 12, 'G').disc(7, 7, 3, 'K').disc(7, 7, 1, 'G').px(11, 5, 'r').px(11, 7, 'L').px(13, 5, 'c'); }, { L: '#4ab04a' }),
        item_p_cronplug: P((p) => { chip(p).disc(8, 8, 3, 'W').line(8, 8, 8, 6, 'k').line(8, 8, 10, 8, 'k'); }),
        item_p_wallet: P((p) => { p.disc(8, 8, 6, 'B').disc(8, 8, 4, 'Y').rect(7, 5, 2, 7, 'k').rect(6, 6, 4, 1, 'k').rect(6, 8, 4, 1, 'k').rect(6, 10, 4, 1, 'k'); }),
        item_p_coupon: P((p) => { p.rect(1, 4, 14, 8, 'B').er(1, 7, 1, 2).er(14, 7, 1, 2).rect(10, 4, 1, 8, 'g').rect(3, 6, 1, 1, 'R').rect(6, 9, 1, 1, 'R').line(6, 6, 3, 9, 'R').px(12, 6, 'W').px(12, 8, 'W').px(12, 10, 'W'); }),
        item_p_pdf: P((p) => { p.rect(3, 1, 10, 14, 'W').er(11, 1, 2, 1).er(12, 2, 1, 1).rect(10, 1, 1, 2, 'g').rect(3, 11, 10, 3, 'R').rect(4, 12, 2, 1, 'W').rect(7, 12, 2, 1, 'W').rect(10, 12, 2, 1, 'W').rect(5, 4, 6, 1, 'B').rect(5, 6, 6, 1, 'B').rect(5, 8, 4, 1, 'B'); }),
        item_p_vim: P((p) => { chip(p).st(5, 5, ['L...L', '.L.L.', '..L..']).rect(5, 10, 6, 1, 'L'); }, { L: '#3ad870' }),
        item_p_firewall: P((p) => { chip(p).rect(4, 8, 8, 4, 'R'); for (const y of [9, 11]) p.rect(4, y, 8, 1, 'o'); p.rect(7, 8, 1, 1, 'o').rect(10, 10, 1, 1, 'o').st(6, 4, ['.YR', 'YYR', '.YY']); }),
        item_p_lente: P((p) => { p.disc(7, 7, 5, 'B').disc(7, 7, 3, 'C').line(11, 11, 14, 14, 'K', 1).px(5, 5, 'W').px(6, 5, 'W'); }),
        item_p_powerbank: P((p) => { p.rect(2, 3, 12, 10, 'B').rect(14, 6, 1, 4, 'G').st(6, 5, ['..YY', '.YY.', 'YYYY', '.YY.', 'YY..']).rect(3, 11, 1, 1, 'L').rect(5, 11, 1, 1, 'L').rect(7, 11, 1, 1, 'L'); }, { L: '#4ab04a' }),
        item_p_estensione: P((p) => { p.rect(2, 5, 12, 8, 'B').rect(1, 8, 1, 2, 'G').rect(0, 7, 1, 4, 'G'); for (const x of [3, 6, 9, 12]) p.rect(x, 6, 2, 3, 'k'); p.rect(3, 11, 10, 1, 'g').px(4, 12, 'c'); }),
        item_p_biofeedback: P((p) => { chip(p).st(5, 5, ['.R.R.', 'RRRRR', 'RRRRR', '.RRR.', '..R..']).line(4, 11, 6, 11, 'W').px(7, 10, 'W').px(8, 12, 'W').line(9, 11, 11, 11, 'W'); }),
        item_p_visione: P((p) => { p.rect(1, 4, 14, 8, 'B').disc(5, 8, 3, 'K').disc(11, 8, 3, 'K').disc(5, 8, 2, 'L').disc(11, 8, 2, 'L').px(4, 7, 'W').px(10, 7, 'W').rect(6, 7, 4, 2, 'K'); }, { L: '#3af070' }),
        item_p_adrenalina: P((p) => { p.line(3, 13, 11, 5, 'C', 1).line(4, 12, 10, 6, 'R').rect(11, 2, 3, 1, 'G').line(12, 3, 12, 5, 'G').px(2, 14, 'G').px(1, 15, 'G').rect(10, 6, 2, 1, 'G'); }),
        item_p_sanguisuga: P((p) => { chip(p).rect(5, 6, 6, 1, 'R').px(5, 7, 'W').px(10, 7, 'W').px(5, 8, 'W').px(10, 8, 'W').st(7, 8, ['.R', 'RR', 'RR', '.R']); }),
        item_p_scudo: P((p) => { for (let y = 2; y < 14; y++) { const h = y < 9 ? 6 : 6 - (y - 8) * 1.1; p.rect(Math.round(8 - h), y, Math.round(h * 2), 1, 'B'); } p.rect(7, 4, 2, 7, 'W').rect(5, 6, 6, 2, 'W'); }),
        item_p_ombra: P((p) => { chip(p).disc(8, 8, 3, 'K').disc(9, 7, 3, 'B').px(10, 5, 'W').px(5, 11, 'W'); }),
        item_p_gamer: P((p) => { p.disc(8, 8, 5, 'B').rect(7, 3, 2, 4, 'K').rect(3, 7, 10, 1, 'K').rect(7, 4, 2, 2, 'R').rect(5, 11, 1, 1, 'C').rect(7, 11, 1, 1, 'R').rect(9, 11, 1, 1, 'Y').rect(7, 1, 2, 2, 'G'); }),
        item_p_neon: P((p) => { p.disc(8, 8, 6, 'B').disc(8, 8, 4, '.').disc(8, 8, 5, 'C').disc(8, 8, 3, 'B').px(8, 8, 'W').rect(3, 7, 1, 2, 'R').rect(12, 7, 1, 2, 'R'); }),
        item_p_ricarica: P((p) => p.disc(8, 10, 5, 'B').disc(8, 10, 3, 'K').disc(8, 10, 1, 'c').st(6, 1, ['..YY', '.YY.', 'YYYY', '.YY.', 'YY..']).px(12, 7, 'c').px(4, 7, 'c')),
        item_p_dieta: P((p) => { p.disc(8, 9, 5, 'R').disc(6, 8, 1, 'W').rect(8, 2, 1, 3, 'T').st(9, 2, ['LL', '.L']).px(8, 4, 'k').rect(1, 5, 1, 8, 'G').rect(0, 5, 1, 3, 'G').rect(2, 5, 1, 3, 'G'); }, { L: '#4ab04a' }),
        item_p_cuffie: P((p) => { p.rect(4, 2, 8, 1, 'K').rect(3, 3, 1, 5, 'K').rect(12, 3, 1, 5, 'K').rect(1, 7, 4, 7, 'B').rect(11, 7, 4, 7, 'B').rect(2, 9, 2, 3, 'K').rect(12, 9, 2, 3, 'K'); }),
        item_p_tastierino: P((p) => { p.rect(3, 1, 10, 14, 'B'); for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) p.rect(4 + c * 3, 3 + r * 3, 2, 2, 'W'); p.rect(4, 3, 8, 1, 'c'); }),
        item_p_certificato: P((p) => { p.rect(1, 2, 14, 10, 'W').rect(1, 2, 14, 1, 'B').rect(3, 5, 8, 1, 'B').rect(3, 7, 6, 1, 'B').disc(11, 11, 2, 'Y').px(10, 14, 'R').px(12, 14, 'R').rect(10, 13, 1, 2, 'R').rect(12, 13, 1, 2, 'R'); }),
        item_p_quantum: P((p) => { chip(p).disc(8, 8, 1, 'W').line(4, 8, 12, 8, 'C').line(5, 5, 11, 11, 'C').line(11, 5, 5, 11, 'C').px(8, 8, 'W'); }),
        item_p_ia: P((p) => { p.rect(3, 4, 10, 9, 'B').rect(7, 1, 2, 3, 'G').px(7, 0, 'Y').px(8, 0, 'Y').rect(1, 7, 2, 3, 'G').rect(13, 7, 2, 3, 'G').rect(4, 6, 3, 3, 'W').rect(9, 6, 3, 3, 'W').px(5, 7, 'c').px(10, 7, 'c').rect(5, 11, 6, 1, 'k').px(6, 11, 'W').px(8, 11, 'W').px(10, 11, 'W'); }),
        item_p_root: P((p) => { chip(p).st(4, 4, ['R..R..', 'RRRRRR', 'R..R..', 'RRRRRR', 'R..R..']).rect(5, 11, 6, 1, 'Y'); }),
    };
    A.add(D);
});
