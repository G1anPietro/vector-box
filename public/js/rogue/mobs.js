// js/rogue/mobs.js — the sectors of the datacentre, the monsters that live in them and the traps. Data only.
//
// HOW TO ADD A SECTOR: add one object to SECTORS (name, colours). Every sector is PER_SECTOR floors deep and the game
// is as long as the list: a new sector makes the run 5 floors longer. Give it monsters (below) and a boss.
//
// HOW TO ADD A MONSTER: add one object to LIST. Needed: id, name, shape (a picture in sprites.js), col, hp,
// atk [min, max], xp, floors [first, last] (absolute floor numbers: sector 1 is 1-5, sector 2 is 6-10…).
// Optional numbers: def (armour), acc (aim), dodge, w (how common, default 10), speed (2 = two moves a turn, 0.5 = one every two).
// Optional behaviours (mix them freely):
//   erratic: 0.5        moves at random half of the time
//   ranged: { range, dmg: [a, b], verb }   attacks from far when it sees you
//   summon: { k: 'id', every: 5 }          calls another monster every 5 turns
//   steal: 'gold' | 'item'                 robs you, runs away and disappears if you lose sight of it
//   poison: 5, weaken: true, stun: true, confuse: true, leech: true    what its hit does to you
//   regen: 1            heals every turn          split: true     divides when hit
//   explode: [a, b]     bursts when it dies       phase: true     walks through walls
//   invisible: true     seen only from one step   ambush: true    looks like a crate until you are next to it
//   still: true         never moves               coward: true    runs when badly hurt
//   blink: true         teleports when hit        undead: true    (some weapons and skills hit these harder)
//   boss: 5             the boss of floor 5: the stairs stay locked until it dies. The boss of the last floor ends the game.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else (root.Rogue = root.Rogue || {}).mobs = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    const PER_SECTOR = 5;
    const SECTORS = [
        { id: 'scantinato', name: 'Scantinato', wall: '#3d4a3f', edge: '#57695a', floor: '#161b17', dot: '#232b25',
          intro: 'Sotto la palestra c’è una porta che nessuno apre dal 1998. Dietro: polvere, cavi e qualcosa che ronza.' },
    ];
    const LIST = [
        // ── settore 1: Scantinato (piani 1-5)
        { id: 'bug', name: 'Bug', shape: 'bug', col: '#7bd86a', hp: 5, atk: [1, 3], xp: 2, floors: [1, 3],
          info: 'Piccolo, verde, ovunque. Nessuno sa chi l’ha scritto.' },
        { id: 'topo', name: 'Topo di rete', shape: 'bat', col: '#b9a48a', hp: 4, atk: [1, 2], dodge: 3, speed: 2, erratic: 0.5, xp: 3, floors: [1, 5],
          info: 'Rosicchia i cavi e scappa in ogni direzione.' },
        { id: 'polvere', name: 'Gomitolo di polvere', shape: 'blob', col: '#9a94a8', hp: 12, atk: [1, 3], speed: 0.5, split: true, xp: 3, floors: [2, 5],
          info: 'Se lo colpisci si divide. Andava passato l’aspirapolvere.' },
        { id: 'ragno', name: 'Ragno dei cavi', shape: 'spider', col: '#c97fd8', hp: 7, atk: [1, 3], poison: 4, xp: 4, floors: [2, 5],
          info: 'Il suo morso dà la scossa per qualche turno.' },
        { id: 'cavo', name: 'Cavo vivo', shape: 'worm', col: '#e8b84a', hp: 9, atk: [1, 5], def: 1, xp: 5, floors: [1, 5],
          info: 'Un cavo di rete che ha deciso di non farsi più calpestare.' },
        { id: 'stampante', name: 'Stampante posseduta', shape: 'printer', col: '#8fa3b8', hp: 8, atk: [1, 3], still: true, w: 6,
          ranged: { range: 5, dmg: [1, 4], verb: 'ti spara un foglio inceppato' }, xp: 6, floors: [2, 5],
          info: 'Non si muove, ma stampa. Contro di te.' },
        { id: 'kiddie', name: 'Script kiddie', shape: 'hood', col: '#5fb4e8', hp: 10, atk: [1, 3], dodge: 2, steal: 'gold', w: 6, xp: 6, floors: [2, 5],
          info: 'Ti svuota il portafoglio e scappa. Se lo prendi, riprendi tutto.' },
        { id: 'cassa', name: 'Scatolone sospetto', shape: 'chest', col: '#b98a55', hp: 16, atk: [3, 7], ambush: true, w: 3, xp: 9, floors: [3, 5],
          info: 'Sembra uno scatolone. Morde.' },
        { id: 'boss1', name: 'Il Nido dei Bug', shape: 'bug', col: '#ffb000', hp: 48, atk: [2, 6], def: 1, acc: 1, boss: 5,
          summon: { k: 'bug', every: 4 }, xp: 40,
          info: 'Il primo bug mai scritto in questa scuola. Da allora ne produce altri.' },
    ];
    // Traps: `effect` is one of the effects in game.js (the same ones the items use), `power` its strength.
    const TRAPS = [
        { id: 'scossa', name: 'Presa scoperta', effect: 'zap', power: 3 },
        { id: 'colla', name: 'Toner rovesciato', effect: 'poison', power: 5 },
        { id: 'redirect', name: 'Redirect', effect: 'teleport' },
        { id: 'allarme', name: 'Allarme', effect: 'alarm' },
        { id: 'botola', name: 'Botola', effect: 'pit', power: 3, w: 5 },
    ];
    return { PER_SECTOR, SECTORS, LIST, TRAPS };
});
