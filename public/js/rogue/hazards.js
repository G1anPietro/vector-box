// js/rogue/hazards.js — the terrain hazards, one signature hazard per sector. Data only (what each one does is in game.js: HAZARD_FX).
//
// HOW IT WORKS: when a floor is built, game.js scatters small groups ("patches") of hazard cells over the floor of the sector, from the seed
// (same seed + floor = same hazards). Hazards are always visible once the cell is seen, listed in the info card (long press), and the auto-walk
// goes round the ones it can. They never stand on the spawn, the stairs, an item, a monster or a trap, and they never cut the floor in two:
// the cells that were reachable without hazards still are (tests check it on 300 seeds per sector).
// HOW TO ADD A HAZARD: add an object to LIST:
//   id, sector (id of a sector in mobs.js), kind (one of the keys of HAZARD_FX in game.js), name {en,it}, info {en,it}, col (colour of the picture),
//   shape (a picture of sprites-tiles.js), dmg [min, max] (damage kinds only; it grows mildly with the floor), and kind parameters: turns, food…
//   A sector with `mix: [ids]` has no hazard of its own: each patch is one of those hazards (Root).
// HOW TO ADD A KIND: write a function in HAZARD_FX (game.js), it receives (state, hazardCell, definition); add the messages to text-systems.js (haz_<kind>).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else (root.Rogue = root.Rogue || {}).hazards = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    const LIST = [
        { id: 'spill', sector: 'scantinato', kind: 'poison', turns: 4, col: '#7fd34a', shape: 'hz_drop', name: { en: 'Coolant Spill', it: 'Perdita di liquido' },
          info: { en: 'Greenish coolant. Stepping in it poisons you for a few turns.', it: 'Liquido di raffreddamento verdastro. Se ci cammini sopra ti avvelena per qualche turno.' } },
        { id: 'frost', sector: 'aula', kind: 'slide', col: '#8fe8ff', shape: 'hz_flake', name: { en: 'Cold Aisle Ice', it: 'Ghiaccio della corsia fredda' },
          info: { en: 'Frost on the floor. You slide one more tile in the direction you were walking.', it: 'Brina sul pavimento. Scivoli di una casella in più nella direzione in cui camminavi.' } },
        { id: 'cable', sector: 'cablaggi', kind: 'shock', dmg: [2, 4], col: '#ffe14a', shape: 'hz_bolt', name: { en: 'Live Cable', it: 'Cavo scoperto' },
          info: { en: 'A stripped cable that sparks. Stepping on it gives you an electric shock.', it: 'Un cavo scoperto che sfrigola. Se ci cammini sopra prendi la scossa.' } },
        { id: 'stream', sector: 'rete', kind: 'push', col: '#3ff0d0', shape: 'hz_arrow', name: { en: 'Packet Stream', it: 'Flusso di pacchetti' },
          info: { en: 'Packets flowing along the arrows. Stepping in pushes you one tile that way, unless you wade against it.', it: 'Pacchetti che scorrono lungo le frecce. Se ci entri vieni spinto di una casella in quella direzione, a meno che tu non cammini controcorrente.' } },
        { id: 'shelf', sector: 'archivio', kind: 'collapse', dmg: [3, 5], col: '#c98a4a', shape: 'hz_books', name: { en: 'Shaky Shelf', it: 'Scaffale pericolante' },
          info: { en: 'Books piled up, ready to fall. Stepping on it brings them down on you once, then it is just rubble.', it: 'Libri accatastati pronti a cadere. Se ci passi sopra ti crollano addosso una volta sola, poi restano solo macerie.' } },
        { id: 'fog', sector: 'cloud', kind: 'fog', col: '#b8c8ff', shape: 'hz_cloud', name: { en: 'Data Fog', it: 'Nebbia di dati' },
          info: { en: 'Thick fog. It does no harm, but enemies and items inside it are hidden until you are next to them.', it: 'Nebbia fitta. Non fa male, ma nemici e oggetti al suo interno restano nascosti finché non sei accanto.' } },
        { id: 'flame', sector: 'firewall', kind: 'fire', dmg: [1, 3], turns: 3, col: '#ff6a2a', shape: 'hz_flame', name: { en: 'Firewall Flames', it: 'Fiamme del firewall' },
          info: { en: 'Burning packets. Stepping in hurts and sets you on fire for a few turns.', it: 'Pacchetti in fiamme. Se ci entri ti ferisci e prendi fuoco per qualche turno.' } },
        { id: 'lag', sector: 'kernel', kind: 'lag', col: '#c58bff', shape: 'hz_clock', name: { en: 'Lag Zone', it: 'Zona di lag' },
          info: { en: 'Time stutters here. Stepping in makes you lose your next turn.', it: 'Qui il tempo balbetta. Se ci entri perdi il turno successivo.' } },
        { id: 'heat', sector: 'mainframe', kind: 'heat', food: 60, col: '#ff9f43', shape: 'hz_heat', name: { en: 'Overheating Zone', it: 'Zona surriscaldata' },
          info: { en: 'The air shimmers. Stepping in drains your energy: you get hungrier and your skill takes longer to recharge.', it: 'L’aria vibra. Se ci entri perdi energia: ti viene più fame e l’abilità si ricarica più lentamente.' } },
        { id: 'perm', sector: 'root', mix: ['cable', 'stream', 'shelf', 'flame', 'lag', 'heat'], name: { en: 'Unstable Permissions', it: 'Permessi instabili' },
          info: { en: 'Root mixes everything: each patch is a different hazard.', it: 'Root mescola tutto: ogni chiazza è un pericolo diverso.' } },
    ];
    const BY_ID = Object.fromEntries(LIST.map((h) => [h.id, h]));
    /** The hazard of a sector (the entry with that `sector`), or undefined. */
    const ofSector = (sectorId) => LIST.find((h) => h.sector === sectorId);
    /** Damage range [min, max] of a damage hazard on a floor: grows by 1 every 8 floors and by 1 per access level (mild). */
    const damageRange = (h, depth, tier) => { const b = Math.floor(depth / 8) + (tier || 0); return [h.dmg[0] + b, h.dmg[1] + b]; };
    return { LIST, BY_ID, ofSector, damageRange };
});
