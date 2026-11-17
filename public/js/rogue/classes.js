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
        { id: 'studente', name: { en: 'Student', it: 'Studente' }, col: '#00ff66', hp: 36, hpLvl: 5, mods: { xp: 15 },
          kit: ['righello', 'felpa', 'd_cura', 'merendina', 'merendina', 'dardi', 'dardi'],
          active: { name: { en: 'Review', it: 'Ripasso' }, info: { en: 'Recover about a third of your HP.', it: 'Recuperi un terzo della vita.' }, cd: 70, effect: 'heal', power: 35 },
          info: { en: 'Balanced and a fast learner (+15% experience).', it: 'Equilibrato e impara in fretta (+15% esperienza).' } },
        { id: 'hacker', name: { en: 'Hacker', it: 'Hacker' }, col: '#00e5ff', hp: 30, hpLvl: 4, mods: { dodge: 2, search: 30, backstab: 1, usb: 25, stealth: 40 },
          kit: ['cacciavite', 'maglietta', 'u_exploit', 's_cd', 'merendina'],
          active: { name: { en: 'Exploit', it: 'Exploit' }, info: { en: 'A ranged hit on the nearest enemy.', it: 'Un colpo a distanza sul nemico più vicino.' }, cd: 30, effect: 'bolt', power: 6 },
          info: { en: 'Fragile but quiet: hits sleeping enemies hard, uses USB sticks well, finds traps.', it: 'Fragile ma silenzioso: colpisce forte chi dorme, usa bene le chiavette, trova le trappole.' } },
        { id: 'prof', name: { en: 'Teacher', it: 'Prof' }, col: '#ffb000', hp: 38, hpLvl: 4, mods: { drink: 25, acc: 1, atk: 1, def: 1 },
          kit: ['righello', 'badge', 's_sudo', 's_sleep', 'd_cura', 'merendina'],
          active: { name: { en: 'Detention Slip', it: 'Nota sul registro' }, info: { en: 'Enemies you can see run away for a while.', it: 'I nemici che vedi scappano per un po’.' }, cd: 50, effect: 'fear', power: 10 },
          info: { en: 'Scares enemies and knows the scripts. Cans work better on them.', it: 'Mette paura ai nemici e conosce gli script. Le lattine gli fanno più effetto.' } },
        { id: 'tecnico', name: { en: 'Technician', it: 'Tecnico' }, col: '#e8964a', hp: 40, hpLvl: 5, mods: { usb: 15, recharge: 1, def: 1 }, unlock: { best: 5 },
          kit: ['cavo', 'felpa', 'u_freeze', 's_apt', 'merendina'],
          active: { name: { en: 'Reboot', it: 'Riavvio' }, info: { en: 'Enemies you can see shut down for a few turns.', it: 'I nemici che vedi si spengono per qualche turno.' }, cd: 60, effect: 'sleep', power: 5 },
          info: { en: 'Their USB sticks recharge on their own. Unlocked by reaching floor 5.', it: 'Le sue chiavette si ricaricano da sole. Si sblocca arrivando al piano 5.' } },
        { id: 'bidello', name: { en: 'Janitor', it: 'Bidello' }, col: '#5a8fe8', hp: 44, hpLvl: 6, mods: { def: 1, fury: 2 }, unlock: { bosses: 1 },
          kit: ['tastiera', 'felpa', 'panino', 'd_cura'],
          active: { name: { en: 'Bucket Splash', it: 'Secchiata' }, info: { en: 'Hits every enemy you can see.', it: 'Colpisce tutti i nemici che vedi.' }, cd: 45, effect: 'fire', power: 4 },
          info: { en: 'The sturdiest. Hits harder when in trouble. Unlocked by beating a boss.', it: 'Il più robusto. Quando è messo male picchia di più. Si sblocca battendo un boss.' } },
        { id: 'sistemista', name: { en: 'Sysadmin', it: 'Sistemista' }, col: '#b06ae8', hp: 36, hpLvl: 4, mods: { search: 20, usb: 20, sight: 1, atk: 1, def: 1 }, unlock: { best: 10 },
          kit: ['tastiera', 'maglietta', 's_rm', 's_ls', 'u_lag', 'merendina'],
          active: { name: { en: 'kill -9', it: 'kill -9' }, info: { en: 'A very strong ranged hit.', it: 'Un colpo a distanza molto forte.' }, cd: 60, effect: 'bolt', power: 14 },
          info: { en: 'Sees far and has a command for everything. Unlocked by reaching floor 10.', it: 'Vede lontano e ha un comando per tutto. Si sblocca arrivando al piano 10.' } },
        { id: 'designer', name: { en: 'Designer', it: 'Designer' }, col: '#e88ac0', hp: 34, hpLvl: 4, mods: { dodge: 3, crit: 10, luck: 20, atk: 1, def: 1 }, unlock: { wins: 1 },
          kit: ['cavo', 'badge', 'd_invis', 'd_veloce', 'merendina'],
          active: { name: { en: 'Camouflage', it: 'Mimetismo' }, info: { en: 'For a few turns, distant enemies can’t see you.', it: 'Per qualche turno i nemici lontani non ti vedono.' }, cd: 70, effect: 'invis', power: 12 },
          info: { en: 'Dodges, lands critical hits and finds more credits. Unlocked by winning a run.', it: 'Schiva, fa colpi critici e trova più crediti. Si sblocca vincendo una partita.' } },
        { id: 'segreteria', name: { en: 'Secretary', it: 'Segreteria' }, col: '#d8b44a', hp: 34, hpLvl: 5, mods: { haggle: 30, luck: 30, drink: 20 }, unlock: { runs: 10 },
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
        // ── class skills (3+ per class: only that class is offered them)
        { id: 'ripetizioni', name: { en: 'Private Tutoring', it: 'Ripetizioni' }, info: { en: 'Experience +15%.', it: 'Esperienza +15%.' }, mod: { xp: 15 }, max: 2, cls: ['studente'] },
        { id: 'appunti', name: { en: 'Good Notes', it: 'Appunti ordinati' }, info: { en: 'Cans heal 15% more and you spot traps more often.', it: 'Le lattine curano il 15% in più e noti meglio le trappole.' }, mod: { drink: 15, search: 15 }, max: 3, cls: ['studente'] },
        { id: 'primodellaclasse', name: { en: 'Top of the Class', it: 'Primo della classe' }, info: { en: 'Attack +1, aim +1, defense +1.', it: 'Attacco +1, mira +1, difesa +1.' }, mod: { atk: 1, acc: 1, def: 1 }, max: 2, cls: ['studente'] },
        { id: 'nottebianca', name: { en: 'All-Nighter', it: 'Notte in bianco' }, info: { en: 'You recover HP faster and hunger comes more slowly.', it: 'Recuperi vita più in fretta e la fame arriva più piano.' }, mod: { regen: 1, hunger: 20 }, max: 2, cls: ['studente'] },
        { id: 'zerodayscorta', name: { en: 'Zero-Day Stash', it: 'Scorta di zero-day' }, info: { en: 'USB sticks hit 30% harder and sleeping enemies take more damage.', it: 'Le chiavette colpiscono il 30% più forte e chi dorme prende più danno.' }, mod: { usb: 30, backstab: 1 }, max: 2, cls: ['hacker'] },
        { id: 'proxychain', name: { en: 'Proxy Chain', it: 'Catena di proxy' }, info: { en: 'Dodge +1 and sleeping enemies stay asleep longer.', it: 'Schivata +1 e i nemici che dormono restano addormentati più a lungo.' }, mod: { dodge: 1, stealth: 30 }, max: 3, cls: ['hacker'] },
        { id: 'bruteforce', name: { en: 'Brute Force', it: 'Forza bruta' }, info: { en: 'Critical hits +8%, aim +1.', it: 'Colpi critici +8%, mira +1.' }, mod: { crit: 8, acc: 1 }, max: 3, cls: ['hacker'] },
        { id: 'sniffing', name: { en: 'Packet Sniffing', it: 'Sniffing di pacchetti' }, info: { en: 'You see further and find more traps.', it: 'Vedi più lontano e trovi più trappole.' }, mod: { search: 30, sight: 1 }, max: 2, cls: ['hacker'] },
        { id: 'cattedra', name: { en: 'Teacher’s Desk', it: 'Cattedra' }, info: { en: 'Defense +2.', it: 'Difesa +2.' }, mod: { def: 2 }, max: 3, cls: ['prof'] },
        { id: 'penna', name: { en: 'Red Pen', it: 'Penna rossa' }, info: { en: 'Critical hits +10%, more damage to undead.', it: 'Colpi critici +10%, più danno ai non-morti.' }, mod: { crit: 10, holy: 1 }, max: 3, cls: ['prof'] },
        { id: 'lezione', name: { en: 'Long Lecture', it: 'Lezione lunga' }, info: { en: 'Cans heal 15% more and your skill recharges sooner.', it: 'Le lattine curano il 15% in più e l’abilità si ricarica prima.' }, mod: { drink: 15, cd: 15 }, max: 3, cls: ['prof'] },
        { id: 'interrogazione', name: { en: 'Oral Exam', it: 'Interrogazione' }, info: { en: 'Aim +2 and experience +10%.', it: 'Mira +2 ed esperienza +10%.' }, mod: { acc: 2, xp: 10 }, max: 3, cls: ['prof'] },
        { id: 'cassetta', name: { en: 'Toolbox', it: 'Cassetta degli attrezzi' }, info: { en: 'Attack +1 and defense +1.', it: 'Attacco +1 e difesa +1.' }, mod: { atk: 1, def: 1 }, max: 3, cls: ['tecnico'] },
        { id: 'multimetro', name: { en: 'Multimeter', it: 'Multimetro' }, info: { en: 'You find more traps and your aim improves.', it: 'Trovi più trappole e la mira migliora.' }, mod: { search: 30, acc: 1 }, max: 3, cls: ['tecnico'] },
        { id: 'ordine', name: { en: 'Cable Management', it: 'Ordine nei cavi' }, info: { en: 'Max HP +5 and dodge +1.', it: 'Vita massima +5 e schivata +1.' }, mod: { maxHp: 5, dodge: 1 }, max: 3, cls: ['tecnico'] },
        { id: 'riparazione', name: { en: 'Quick Fix', it: 'Riparazione al volo' }, info: { en: 'You recover HP faster and cans heal 15% more.', it: 'Recuperi vita più in fretta e le lattine curano il 15% in più.' }, mod: { regen: 1, drink: 15 }, max: 2, cls: ['tecnico'] },
        { id: 'carrello', name: { en: 'Cleaning Cart', it: 'Carrello delle pulizie' }, info: { en: 'Max HP +4 and defense +1.', it: 'Vita massima +4 e difesa +1.' }, mod: { maxHp: 4, def: 1 }, max: 3, cls: ['bidello'] },
        { id: 'mazzochiavi', name: { en: 'Key Ring', it: 'Mazzo di chiavi' }, info: { en: 'You find more credits and more secret doors.', it: 'Trovi più crediti e più porte segrete.' }, mod: { luck: 25, search: 20 }, max: 2, cls: ['bidello'] },
        { id: 'mocio', name: { en: 'Mop Swing', it: 'Colpo di mocio' }, info: { en: 'Attack +1 and more damage when hurt.', it: 'Attacco +1 e più danno quando sei messo male.' }, mod: { atk: 1, fury: 1 }, max: 3, cls: ['bidello'] },
        { id: 'doppiturno', name: { en: 'Double Shift', it: 'Doppio turno' }, info: { en: 'You recover HP faster and hunger comes more slowly.', it: 'Recuperi vita più in fretta e la fame arriva più piano.' }, mod: { regen: 1, hunger: 30 }, max: 2, cls: ['bidello'] },
        { id: 'cronjob', name: { en: 'Cron Jobs', it: 'Cron job' }, info: { en: 'Your skill recharges much sooner.', it: 'L’abilità si ricarica molto prima.' }, mod: { cd: 25 }, max: 3, cls: ['sistemista'] },
        { id: 'monitoraggio', name: { en: 'Monitoring', it: 'Monitoraggio' }, info: { en: 'You see further and find more traps.', it: 'Vedi più lontano e trovi più trappole.' }, mod: { sight: 1, search: 30 }, max: 2, cls: ['sistemista'] },
        { id: 'scriptshell', name: { en: 'Shell Scripting', it: 'Scripting da shell' }, info: { en: 'USB sticks and skills hit 30% harder.', it: 'Chiavette e abilità colpiscono il 30% più forte.' }, mod: { usb: 30 }, max: 3, cls: ['sistemista'] },
        { id: 'uptime', name: { en: 'Uptime', it: 'Uptime' }, info: { en: 'Max HP +6 and you recover HP faster.', it: 'Vita massima +6 e recuperi vita più in fretta.' }, mod: { maxHp: 6, regen: 1 }, max: 3, cls: ['sistemista'] },
        { id: 'palette', name: { en: 'Colour Palette', it: 'Tavolozza' }, info: { en: 'You find more credits and dodge a little better.', it: 'Trovi più crediti e schivi un po’ meglio.' }, mod: { luck: 30, dodge: 1 }, max: 3, cls: ['designer'] },
        { id: 'prospettiva', name: { en: 'Perspective', it: 'Prospettiva' }, info: { en: 'Critical hits +10%, aim +1.', it: 'Colpi critici +10%, mira +1.' }, mod: { crit: 10, acc: 1 }, max: 3, cls: ['designer'] },
        { id: 'minimalismo', name: { en: 'Minimalism', it: 'Minimalismo' }, info: { en: 'Dodge +2 and sleeping enemies stay asleep longer.', it: 'Schivata +2 e i nemici che dormono restano addormentati più a lungo.' }, mod: { dodge: 2, stealth: 20 }, max: 3, cls: ['designer'] },
        { id: 'moodboard', name: { en: 'Mood Board', it: 'Moodboard' }, info: { en: 'Experience +15% and cans heal 15% more.', it: 'Esperienza +15% e le lattine curano il 15% in più.' }, mod: { xp: 15, drink: 15 }, max: 2, cls: ['designer'] },
        { id: 'protocollo', name: { en: 'Filing Protocol', it: 'Protocollo' }, info: { en: 'Shop prices fall by 20%.', it: 'I prezzi nei negozi calano del 20%.' }, mod: { haggle: 20 }, max: 2, cls: ['segreteria'] },
        { id: 'cuscinettotimbri', name: { en: 'Stamp Pad', it: 'Cuscinetto dei timbri' }, info: { en: 'Your skill recharges sooner and USB sticks hit 15% harder.', it: 'L’abilità si ricarica prima e le chiavette colpiscono il 15% più forte.' }, mod: { cd: 20, usb: 15 }, max: 3, cls: ['segreteria'] },
        { id: 'schedario', name: { en: 'Filing Cabinet', it: 'Schedario' }, info: { en: 'Defense +1 and you find more credits.', it: 'Difesa +1 e trovi più crediti.' }, mod: { def: 1, luck: 20 }, max: 3, cls: ['segreteria'] },
        { id: 'pausacaffe', name: { en: 'Coffee Break', it: 'Pausa caffè' }, info: { en: 'You recover HP faster and cans heal 20% more.', it: 'Recuperi vita più in fretta e le lattine curano il 20% in più.' }, mod: { regen: 1, drink: 20 }, max: 3, cls: ['segreteria'] },
    ];
    return { CLASSES, SKILLS };
});
