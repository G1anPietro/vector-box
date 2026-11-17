// js/rogue/classes.js — who you can play and what you learn when you level up. Data only.
//
// THE NUMBERS (`mods`) used by classes, skills and plugins — they all add up:
//   maxHp, atk (damage), def (armour), acc (aim), dodge, crit (% critical hits), regen (faster healing),
//   hunger (% slower hunger), vamp (% chance a hit heals you), luck (% more credits), search (% better at finding
//   traps and secret doors), sight (cells seen further), usb (% stronger USB sticks and active skills),
//   drink (% stronger healing), fury (damage when under half life), backstab (extra multiplier on sleeping enemies),
//   holy (damage to `undead`), stealth (% sleeping enemies stay asleep), recharge (USB sticks refill by themselves),
//   haggle (% discount in shops), xp (% more experience), cd (% faster active skill).
//
// HOW TO ADD A CLASS: add one object to CLASSES: id, name, col, hp, hpLvl (life per level), mods, kit (item ids:
// the first weapon and protection are worn), active { name, info, cd (turns), effect, power } (an effect from
// game.js), and optionally unlock { best: 5 } — counters of the saved profile: best (deepest floor), bosses, wins, runs.
// HOW TO ADD A SKILL: add one object to SKILLS: id, name, info, mod, optional max (times it can be taken, default 3)
// and cls (list of class ids that can learn it; everybody when missing).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else (root.Rogue = root.Rogue || {}).classes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    const CLASSES = [
        { id: 'studente', name: 'Studente', col: '#00ff66', hp: 28, hpLvl: 4, mods: { xp: 15 },
          kit: ['righello', 'felpa', 'd_cura', 'merendina', 'merendina', 'dardi', 'dardi'],
          active: { name: 'Ripasso', info: 'Recuperi un terzo della vita.', cd: 70, effect: 'heal', power: 35 },
          info: 'Equilibrato e impara in fretta (+15% esperienza).' },
        { id: 'hacker', name: 'Hacker', col: '#00e5ff', hp: 22, hpLvl: 3, mods: { dodge: 2, search: 30, backstab: 1, usb: 25, stealth: 40 },
          kit: ['cacciavite', 'maglietta', 'u_exploit', 's_cd', 'merendina'],
          active: { name: 'Exploit', info: 'Un colpo a distanza sul nemico più vicino.', cd: 30, effect: 'bolt', power: 6 },
          info: 'Fragile ma silenzioso: colpisce forte chi dorme, usa bene le chiavette, trova le trappole.' },
        { id: 'prof', name: 'Prof', col: '#ffb000', hp: 25, hpLvl: 3, mods: { drink: 25, acc: 1 },
          kit: ['righello', 'badge', 's_sudo', 's_sleep', 'd_cura', 'merendina'],
          active: { name: 'Nota sul registro', info: 'I nemici che vedi scappano per un po’.', cd: 50, effect: 'fear', power: 10 },
          info: 'Mette paura ai nemici e conosce gli script. Le lattine gli fanno più effetto.' },
        { id: 'tecnico', name: 'Tecnico', col: '#e8964a', hp: 30, hpLvl: 4, mods: { usb: 15, recharge: 1 }, unlock: { best: 5 },
          kit: ['cavo', 'felpa', 'u_freeze', 's_apt', 'merendina'],
          active: { name: 'Riavvio', info: 'I nemici che vedi si spengono per qualche turno.', cd: 60, effect: 'sleep', power: 5 },
          info: 'Le sue chiavette si ricaricano da sole. Si sblocca arrivando al piano 5.' },
        { id: 'bidello', name: 'Bidello', col: '#5a8fe8', hp: 36, hpLvl: 5, mods: { def: 1, fury: 2 }, unlock: { bosses: 1 },
          kit: ['tastiera', 'felpa', 'panino', 'd_cura'],
          active: { name: 'Secchiata', info: 'Colpisce tutti i nemici che vedi.', cd: 45, effect: 'fire', power: 4 },
          info: 'Il più robusto. Quando è messo male picchia di più. Si sblocca battendo un boss.' },
        { id: 'sistemista', name: 'Sistemista', col: '#b06ae8', hp: 24, hpLvl: 3, mods: { search: 20, usb: 20, sight: 1 }, unlock: { best: 10 },
          kit: ['tastiera', 'maglietta', 's_rm', 's_ls', 'u_lag', 'merendina'],
          active: { name: 'kill -9', info: 'Un colpo a distanza molto forte.', cd: 60, effect: 'bolt', power: 14 },
          info: 'Vede lontano e ha un comando per tutto. Si sblocca arrivando al piano 10.' },
        { id: 'designer', name: 'Designer', col: '#e88ac0', hp: 22, hpLvl: 3, mods: { dodge: 3, crit: 10, luck: 20 }, unlock: { wins: 1 },
          kit: ['cavo', 'badge', 'd_invis', 'd_veloce', 'merendina'],
          active: { name: 'Mimetismo', info: 'Per qualche turno i nemici lontani non ti vedono.', cd: 70, effect: 'invis', power: 12 },
          info: 'Schiva, fa colpi critici e trova più crediti. Si sblocca vincendo una partita.' },
        { id: 'segreteria', name: 'Segreteria', col: '#d8b44a', hp: 26, hpLvl: 4, mods: { haggle: 30, luck: 30, drink: 20 }, unlock: { runs: 10 },
          kit: ['righello', 'felpa', 's_man', 'd_cura', 'd_cura', 'merendina'],
          active: { name: 'Timbro', info: 'Blocca il nemico più vicino per qualche turno.', cd: 35, effect: 'freeze', power: 6 },
          info: 'Sconti nei negozi e più crediti. Si sblocca dopo 10 partite.' },
    ];
    const SKILLS = [
        { id: 'vigore', name: 'Colazione abbondante', info: 'Vita massima +6.', mod: { maxHp: 6 }, max: 9 },
        { id: 'forza', name: 'Braccio allenato', info: 'Attacco +1.', mod: { atk: 1 }, max: 6 },
        { id: 'difesa', name: 'Pelle dura', info: 'Difesa +1.', mod: { def: 1 }, max: 6 },
        { id: 'mira', name: 'Mano ferma', info: 'Mira +2 e più colpi critici.', mod: { acc: 2, crit: 5 } },
        { id: 'riflessi', name: 'Riflessi da ultimo banco', info: 'Schivata +2.', mod: { dodge: 2 } },
        { id: 'recupero', name: 'Pisolino', info: 'Recuperi vita più in fretta.', mod: { regen: 1 } },
        { id: 'stomaco', name: 'Stomaco di ferro', info: 'La fame arriva più piano.', mod: { hunger: 25 }, max: 2 },
        { id: 'sanguisuga', name: 'Copiare dal vicino', info: 'A volte un colpo andato a segno ti ridà vita.', mod: { vamp: 15 }, max: 2 },
        { id: 'fortuna', name: 'Fortuna sfacciata', info: 'Trovi più crediti.', mod: { luck: 25 } },
        { id: 'occhio', name: 'Occhio clinico', info: 'Vedi più lontano e trovi trappole e porte segrete.', mod: { search: 25, sight: 1 }, max: 2 },
        { id: 'smanettone', name: 'Smanettone', info: 'Chiavette e abilità più forti.', mod: { usb: 25 } },
        { id: 'zuccheri', name: 'Metabolismo veloce', info: 'Le lattine curano di più.', mod: { drink: 25 } },
        { id: 'furia', name: 'Ultima ora', info: 'Sotto metà vita fai più danno.', mod: { fury: 2 } },
        { id: 'colpobasso', name: 'Colpo basso', info: 'Ancora più danno ai nemici che dormono.', mod: { backstab: 1 }, max: 2 },
        { id: 'allenamento', name: 'Allenamento', info: 'L’abilità si ricarica prima.', mod: { cd: 20 }, max: 2 },
        { id: 'secchione', name: 'Secchione', info: 'Esperienza +10%.', mod: { xp: 10 } },
        { id: 'passofelpato', name: 'Passo felpato', info: 'I nemici che dormono si svegliano meno.', mod: { stealth: 25 }, max: 2, cls: ['hacker', 'designer', 'studente'] },
        { id: 'autorita', name: 'Autorità', info: 'Mira +1, difesa +1.', mod: { acc: 1, def: 1 }, cls: ['prof', 'bidello', 'segreteria'] },
        { id: 'ricarica', name: 'Powerbank', info: 'Le chiavette si ricaricano da sole.', mod: { recharge: 1 }, max: 2, cls: ['hacker', 'tecnico', 'sistemista'] },
    ];
    return { CLASSES, SKILLS };
});
