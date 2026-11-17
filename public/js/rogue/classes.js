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
// TEXTS: every text is { en: '…', it: '…' } (see mobs.js). Ids stay language-free.
// HOW TO ADD A CLASS: add one object to CLASSES: id, name {en,it}, info {en,it}, col, hp, hpLvl (life per level), mods, kit (item ids:
// the first weapon and protection are worn), active { name {en,it}, info {en,it}, cd (turns), effect, power } (an effect from
// game.js), and optionally unlock { best: 5 } — counters of the saved profile: best (deepest floor), bosses, wins, runs.
// HOW TO ADD A SKILL: add one object to SKILLS: id, name {en,it}, info {en,it}, mod, optional max (times it can be taken, default 3)
// and cls (list of class ids that can learn it; everybody when missing).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else (root.Rogue = root.Rogue || {}).classes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    const CLASSES = [
        { id: 'studente', name: { en: 'Student', it: 'Studente' }, col: '#00ff66', hp: 28, hpLvl: 4, mods: { xp: 15 },
          kit: ['righello', 'felpa', 'd_cura', 'merendina', 'merendina', 'dardi', 'dardi'],
          active: { name: { en: 'Review', it: 'Ripasso' }, info: { en: 'Recover about a third of your HP.', it: 'Recuperi un terzo della vita.' }, cd: 70, effect: 'heal', power: 35 },
          info: { en: 'Balanced and a fast learner (+15% experience).', it: 'Equilibrato e impara in fretta (+15% esperienza).' } },
        { id: 'hacker', name: { en: 'Hacker', it: 'Hacker' }, col: '#00e5ff', hp: 22, hpLvl: 3, mods: { dodge: 2, search: 30, backstab: 1, usb: 25, stealth: 40 },
          kit: ['cacciavite', 'maglietta', 'u_exploit', 's_cd', 'merendina'],
          active: { name: { en: 'Exploit', it: 'Exploit' }, info: { en: 'A ranged hit on the nearest enemy.', it: 'Un colpo a distanza sul nemico più vicino.' }, cd: 30, effect: 'bolt', power: 6 },
          info: { en: 'Fragile but quiet: hits sleeping enemies hard, uses USB sticks well, finds traps.', it: 'Fragile ma silenzioso: colpisce forte chi dorme, usa bene le chiavette, trova le trappole.' } },
        { id: 'prof', name: { en: 'Teacher', it: 'Prof' }, col: '#ffb000', hp: 25, hpLvl: 3, mods: { drink: 25, acc: 1 },
          kit: ['righello', 'badge', 's_sudo', 's_sleep', 'd_cura', 'merendina'],
          active: { name: { en: 'Detention Slip', it: 'Nota sul registro' }, info: { en: 'Enemies you can see run away for a while.', it: 'I nemici che vedi scappano per un po’.' }, cd: 50, effect: 'fear', power: 10 },
          info: { en: 'Scares enemies and knows the scripts. Cans work better on them.', it: 'Mette paura ai nemici e conosce gli script. Le lattine gli fanno più effetto.' } },
        { id: 'tecnico', name: { en: 'Technician', it: 'Tecnico' }, col: '#e8964a', hp: 30, hpLvl: 4, mods: { usb: 15, recharge: 1 }, unlock: { best: 5 },
          kit: ['cavo', 'felpa', 'u_freeze', 's_apt', 'merendina'],
          active: { name: { en: 'Reboot', it: 'Riavvio' }, info: { en: 'Enemies you can see shut down for a few turns.', it: 'I nemici che vedi si spengono per qualche turno.' }, cd: 60, effect: 'sleep', power: 5 },
          info: { en: 'Their USB sticks recharge on their own. Unlocked by reaching floor 5.', it: 'Le sue chiavette si ricaricano da sole. Si sblocca arrivando al piano 5.' } },
        { id: 'bidello', name: { en: 'Janitor', it: 'Bidello' }, col: '#5a8fe8', hp: 36, hpLvl: 5, mods: { def: 1, fury: 2 }, unlock: { bosses: 1 },
          kit: ['tastiera', 'felpa', 'panino', 'd_cura'],
          active: { name: { en: 'Bucket Splash', it: 'Secchiata' }, info: { en: 'Hits every enemy you can see.', it: 'Colpisce tutti i nemici che vedi.' }, cd: 45, effect: 'fire', power: 4 },
          info: { en: 'The sturdiest. Hits harder when in trouble. Unlocked by beating a boss.', it: 'Il più robusto. Quando è messo male picchia di più. Si sblocca battendo un boss.' } },
        { id: 'sistemista', name: { en: 'Sysadmin', it: 'Sistemista' }, col: '#b06ae8', hp: 24, hpLvl: 3, mods: { search: 20, usb: 20, sight: 1 }, unlock: { best: 10 },
          kit: ['tastiera', 'maglietta', 's_rm', 's_ls', 'u_lag', 'merendina'],
          active: { name: { en: 'kill -9', it: 'kill -9' }, info: { en: 'A very strong ranged hit.', it: 'Un colpo a distanza molto forte.' }, cd: 60, effect: 'bolt', power: 14 },
          info: { en: 'Sees far and has a command for everything. Unlocked by reaching floor 10.', it: 'Vede lontano e ha un comando per tutto. Si sblocca arrivando al piano 10.' } },
        { id: 'designer', name: { en: 'Designer', it: 'Designer' }, col: '#e88ac0', hp: 22, hpLvl: 3, mods: { dodge: 3, crit: 10, luck: 20 }, unlock: { wins: 1 },
          kit: ['cavo', 'badge', 'd_invis', 'd_veloce', 'merendina'],
          active: { name: { en: 'Camouflage', it: 'Mimetismo' }, info: { en: 'For a few turns, distant enemies can’t see you.', it: 'Per qualche turno i nemici lontani non ti vedono.' }, cd: 70, effect: 'invis', power: 12 },
          info: { en: 'Dodges, lands critical hits and finds more credits. Unlocked by winning a run.', it: 'Schiva, fa colpi critici e trova più crediti. Si sblocca vincendo una partita.' } },
        { id: 'segreteria', name: { en: 'Secretary', it: 'Segreteria' }, col: '#d8b44a', hp: 26, hpLvl: 4, mods: { haggle: 30, luck: 30, drink: 20 }, unlock: { runs: 10 },
          kit: ['righello', 'felpa', 's_man', 'd_cura', 'd_cura', 'merendina'],
          active: { name: { en: 'Rubber Stamp', it: 'Timbro' }, info: { en: 'Freezes the nearest enemy for a few turns.', it: 'Blocca il nemico più vicino per qualche turno.' }, cd: 35, effect: 'freeze', power: 6 },
          info: { en: 'Shop discounts and more credits. Unlocked after 10 runs.', it: 'Sconti nei negozi e più crediti. Si sblocca dopo 10 partite.' } },
    ];
    const SKILLS = [
        { id: 'vigore', name: { en: 'Big Breakfast', it: 'Colazione abbondante' }, info: { en: 'Max HP +6.', it: 'Vita massima +6.' }, mod: { maxHp: 6 }, max: 9 },
        { id: 'forza', name: { en: 'Trained Arm', it: 'Braccio allenato' }, info: { en: 'Attack +1.', it: 'Attacco +1.' }, mod: { atk: 1 }, max: 6 },
        { id: 'difesa', name: { en: 'Thick Skin', it: 'Pelle dura' }, info: { en: 'Defense +1.', it: 'Difesa +1.' }, mod: { def: 1 }, max: 6 },
        { id: 'mira', name: { en: 'Steady Hand', it: 'Mano ferma' }, info: { en: 'Aim +2 and more critical hits.', it: 'Mira +2 e più colpi critici.' }, mod: { acc: 2, crit: 5 } },
        { id: 'riflessi', name: { en: 'Back-Row Reflexes', it: 'Riflessi da ultimo banco' }, info: { en: 'Dodge +2.', it: 'Schivata +2.' }, mod: { dodge: 2 } },
        { id: 'recupero', name: { en: 'Power Nap', it: 'Pisolino' }, info: { en: 'You recover HP faster.', it: 'Recuperi vita più in fretta.' }, mod: { regen: 1 } },
        { id: 'stomaco', name: { en: 'Iron Stomach', it: 'Stomaco di ferro' }, info: { en: 'Hunger comes more slowly.', it: 'La fame arriva più piano.' }, mod: { hunger: 25 }, max: 2 },
        { id: 'sanguisuga', name: { en: 'Copying from Your Neighbor', it: 'Copiare dal vicino' }, info: { en: 'Sometimes a hit that lands heals you.', it: 'A volte un colpo andato a segno ti ridà vita.' }, mod: { vamp: 15 }, max: 2 },
        { id: 'fortuna', name: { en: 'Shameless Luck', it: 'Fortuna sfacciata' }, info: { en: 'You find more credits.', it: 'Trovi più crediti.' }, mod: { luck: 25 } },
        { id: 'occhio', name: { en: 'Eagle Eye', it: 'Occhio clinico' }, info: { en: 'You see further and find traps and secret doors.', it: 'Vedi più lontano e trovi trappole e porte segrete.' }, mod: { search: 25, sight: 1 }, max: 2 },
        { id: 'smanettone', name: { en: 'Tinkerer', it: 'Smanettone' }, info: { en: 'Stronger USB sticks and skills.', it: 'Chiavette e abilità più forti.' }, mod: { usb: 25 } },
        { id: 'zuccheri', name: { en: 'Fast Metabolism', it: 'Metabolismo veloce' }, info: { en: 'Cans heal more.', it: 'Le lattine curano di più.' }, mod: { drink: 25 } },
        { id: 'furia', name: { en: 'Last-Minute Cramming', it: 'Ultima ora' }, info: { en: 'Below half HP you deal more damage.', it: 'Sotto metà vita fai più danno.' }, mod: { fury: 2 } },
        { id: 'colpobasso', name: { en: 'Cheap Shot', it: 'Colpo basso' }, info: { en: 'Even more damage to sleeping enemies.', it: 'Ancora più danno ai nemici che dormono.' }, mod: { backstab: 1 }, max: 2 },
        { id: 'allenamento', name: { en: 'Training', it: 'Allenamento' }, info: { en: 'Your skill recharges sooner.', it: 'L’abilità si ricarica prima.' }, mod: { cd: 20 }, max: 2 },
        { id: 'secchione', name: { en: 'Overachiever', it: 'Secchione' }, info: { en: 'Experience +10%.', it: 'Esperienza +10%.' }, mod: { xp: 10 } },
        { id: 'passofelpato', name: { en: 'Sneaky Steps', it: 'Passo felpato' }, info: { en: 'Sleeping enemies wake up less often.', it: 'I nemici che dormono si svegliano meno.' }, mod: { stealth: 25 }, max: 2, cls: ['hacker', 'designer', 'studente'] },
        { id: 'autorita', name: { en: 'Authority', it: 'Autorità' }, info: { en: 'Aim +1, defense +1.', it: 'Mira +1, difesa +1.' }, mod: { acc: 1, def: 1 }, cls: ['prof', 'bidello', 'segreteria'] },
        { id: 'ricarica', name: { en: 'Power Bank', it: 'Powerbank' }, info: { en: 'USB sticks recharge on their own.', it: 'Le chiavette si ricaricano da sole.' }, mod: { recharge: 1 }, max: 2, cls: ['hacker', 'tecnico', 'sistemista'] },
    ];
    return { CLASSES, SKILLS };
});
