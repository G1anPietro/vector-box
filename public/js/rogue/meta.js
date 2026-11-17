// js/rogue/meta.js — what carries over between runs: the upgrade tree (bought with crediti), the medals. Data only.
//
// The saved profile (`meta`) counts: runs, wins, best (deepest floor), bosses, kills, turns, total (crediti earned in all),
// ng (highest "livello di accesso" you may start: 1 more than the best one cleared), daily (daily challenges played), codex (monster id → {seen, kills}).
//
// TEXTS: every name and info is { en: '…', it: '…' } (see mobs.js).
// HOW TO ADD AN UPGRADE: one object in UPGRADES: id, name {en,it}, info {en,it}, max (levels), cost (crediti for the first level; each next
// level costs cost * (level + 1)), and what one level gives: mod { … } (the numbers of classes.js: atk, def, luck…),
// or gold (starting crediti), kit (extra item ids at the start) or known (items you already know).
// HOW TO ADD A MEDAL: one object in MEDALS: id, name {en,it}, info {en,it}, and `need` { counter: value }: the medal is yours when every
// counter of the profile is at least that. Each medal pays 20 crediti, once.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else (root.Rogue = root.Rogue || {}).meta = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    const UPGRADES = [
        { id: 'vita', name: { en: 'Big Breakfast', it: 'Colazione ricca' }, info: { en: 'Starting HP +3 per level.', it: 'Vita iniziale +3 per livello.' }, max: 10, cost: 20, mod: { maxHp: 3 } },
        { id: 'forza', name: { en: 'School Gym', it: 'Palestra della scuola' }, info: { en: 'Attack +1.', it: 'Attacco +1.' }, max: 5, cost: 60, mod: { atk: 1 } },
        { id: 'difesa', name: { en: 'Padded Sweatshirt', it: 'Felpa imbottita' }, info: { en: 'Defense +1.', it: 'Difesa +1.' }, max: 5, cost: 60, mod: { def: 1 } },
        { id: 'mira', name: { en: 'New Glasses', it: 'Occhiali nuovi' }, info: { en: 'Aim +1.', it: 'Mira +1.' }, max: 4, cost: 40, mod: { acc: 1 } },
        { id: 'schiva', name: { en: 'Running Shoes', it: 'Scarpe da corsa' }, info: { en: 'Dodge +1.', it: 'Schivata +1.' }, max: 4, cost: 50, mod: { dodge: 1 } },
        { id: 'fortuna', name: { en: 'Four-Leaf Clover', it: 'Quadrifoglio' }, info: { en: 'Credits found +10%.', it: 'Crediti trovati +10%.' }, max: 5, cost: 30, mod: { luck: 10 } },
        { id: 'fame', name: { en: 'Packed Lunch', it: 'Colazione al sacco' }, info: { en: 'Slower hunger (+10%).', it: 'Fame più lenta (+10%).' }, max: 5, cost: 30, mod: { hunger: 10 } },
        { id: 'esperto', name: { en: 'Private Tutoring', it: 'Ripetizioni' }, info: { en: 'Experience +5%.', it: 'Esperienza +5%.' }, max: 5, cost: 50, mod: { xp: 5 } },
        { id: 'sconto', name: { en: 'Discount Card', it: 'Tessera sconti' }, info: { en: 'Shop discount +5%.', it: 'Sconto nei negozi +5%.' }, max: 6, cost: 25, mod: { haggle: 5 } },
        { id: 'recupero', name: { en: 'Nap in Class', it: 'Pisolino in aula' }, info: { en: 'You heal faster.', it: 'Guarisci più in fretta.' }, max: 3, cost: 80, mod: { regen: 1 } },
        { id: 'occhio', name: { en: 'Dynamo Flashlight', it: 'Torcia a dinamo' }, info: { en: 'You see one tile further.', it: 'Vedi una casella più lontano.' }, max: 2, cost: 120, mod: { sight: 1 } },
        { id: 'abilita', name: { en: 'Focused Training', it: 'Allenamento mirato' }, info: { en: 'Your skill recharges sooner (+10%).', it: 'L’abilità si ricarica prima (+10%).' }, max: 4, cost: 70, mod: { cd: 10 } },
        { id: 'chiavette', name: { en: 'Power Bank', it: 'Powerbank' }, info: { en: 'USB sticks and skills hit harder (+10%).', it: 'Chiavette e abilità più forti (+10%).' }, max: 4, cost: 70, mod: { usb: 10 } },
        { id: 'soldi', name: { en: 'Pocket Money', it: 'Paghetta' }, info: { en: 'Start with 20 more credits.', it: 'Parti con 20 crediti in più.' }, max: 10, cost: 15, gold: 20 },
        { id: 'scorta', name: { en: 'Grandma’s Backpack', it: 'Zaino della nonna' }, info: { en: 'Start with one extra snack cake.', it: 'Parti con una merendina in più.' }, max: 3, cost: 40, kit: ['merendina'] },
        { id: 'lattina', name: { en: 'Teachers’ Lounge Fridge', it: 'Frigo della sala prof' }, info: { en: 'Start with one extra energy drink.', it: 'Parti con un energy drink in più.' }, max: 3, cost: 90, kit: ['d_cura'] },
        { id: 'manuale', name: { en: 'Survival Manual', it: 'Manuale di sopravvivenza' }, info: { en: 'You already know the “man” and “ls -R” scripts.', it: 'Conosci subito gli script “man” e “ls -R”.' }, max: 1, cost: 150, known: ['s_man', 's_ls'] },
    ];
    const MEDALS = [
        { id: 'm_run1', name: { en: 'Freshman', it: 'Matricola' }, info: { en: 'Play your first run.', it: 'Fai la prima partita.' }, need: { runs: 1 } },
        { id: 'm_run10', name: { en: 'Regular', it: 'Habitué' }, info: { en: '10 runs.', it: '10 partite.' }, need: { runs: 10 } },
        { id: 'm_run50', name: { en: 'Season Ticket', it: 'Abbonato' }, info: { en: '50 runs.', it: '50 partite.' }, need: { runs: 50 } },
        { id: 'm_run200', name: { en: 'Tenant', it: 'Inquilino' }, info: { en: '200 runs.', it: '200 partite.' }, need: { runs: 200 } },
        { id: 'm_d5', name: { en: 'Under the Gym', it: 'Sotto la palestra' }, info: { en: 'Reach floor 5.', it: 'Arriva al piano 5.' }, need: { best: 5 } },
        { id: 'm_d10', name: { en: 'Machine Room', it: 'Sala macchine' }, info: { en: 'Reach floor 10.', it: 'Arriva al piano 10.' }, need: { best: 10 } },
        { id: 'm_d20', name: { en: 'Online', it: 'In rete' }, info: { en: 'Reach floor 20.', it: 'Arriva al piano 20.' }, need: { best: 20 } },
        { id: 'm_d30', name: { en: 'Head in the Clouds', it: 'Nelle nuvole' }, info: { en: 'Reach floor 30.', it: 'Arriva al piano 30.' }, need: { best: 30 } },
        { id: 'm_d40', name: { en: 'Heart of the Kernel', it: 'Cuore del kernel' }, info: { en: 'Reach floor 40.', it: 'Arriva al piano 40.' }, need: { best: 40 } },
        { id: 'm_d50', name: { en: 'All the Way Down', it: 'Fino in fondo' }, info: { en: 'Reach floor 50.', it: 'Arriva al piano 50.' }, need: { best: 50 } },
        { id: 'm_b1', name: { en: 'Bug Hunt', it: 'Caccia al bug' }, info: { en: 'Defeat your first boss.', it: 'Batti il primo boss.' }, need: { bosses: 1 } },
        { id: 'm_b5', name: { en: 'Hunter', it: 'Cacciatore' }, info: { en: 'Defeat 5 bosses.', it: 'Batti 5 boss.' }, need: { bosses: 5 } },
        { id: 'm_b10', name: { en: 'Exterminator', it: 'Sterminatore' }, info: { en: 'Defeat 10 bosses.', it: 'Batti 10 boss.' }, need: { bosses: 10 } },
        { id: 'm_b30', name: { en: 'Legend', it: 'Leggenda' }, info: { en: 'Defeat 30 bosses.', it: 'Batti 30 boss.' }, need: { bosses: 30 } },
        { id: 'm_w1', name: { en: 'Server Off', it: 'Server spento' }, info: { en: 'Win a run.', it: 'Vinci una partita.' }, need: { wins: 1 } },
        { id: 'm_w5', name: { en: 'Serial Shutdowner', it: 'Spegnitore seriale' }, info: { en: 'Win 5 runs.', it: 'Vinci 5 partite.' }, need: { wins: 5 } },
        { id: 'm_w20', name: { en: 'Administrator', it: 'Amministratore' }, info: { en: 'Win 20 runs.', it: 'Vinci 20 partite.' }, need: { wins: 20 } },
        { id: 'm_k100', name: { en: 'Pest Control', it: 'Disinfestatore' }, info: { en: '100 enemies defeated.', it: '100 nemici eliminati.' }, need: { kills: 100 } },
        { id: 'm_k1000', name: { en: 'Antivirus', it: 'Antivirus' }, info: { en: '1000 enemies defeated.', it: '1000 nemici eliminati.' }, need: { kills: 1000 } },
        { id: 'm_k5000', name: { en: 'Spring Cleaning', it: 'Pulizia di primavera' }, info: { en: '5000 enemies defeated.', it: '5000 nemici eliminati.' }, need: { kills: 5000 } },
        { id: 'm_t5k', name: { en: 'Small Hours', it: 'Ore piccole' }, info: { en: '5000 turns played in total.', it: '5000 turni giocati in tutto.' }, need: { turns: 5000 } },
        { id: 'm_t50k', name: { en: 'All-Nighter', it: 'Notte in bianco' }, info: { en: '50000 turns played in total.', it: '50000 turni giocati in tutto.' }, need: { turns: 50000 } },
        { id: 'm_c500', name: { en: 'Saver', it: 'Risparmiatore' }, info: { en: '500 credits earned in total.', it: '500 crediti guadagnati in tutto.' }, need: { total: 500 } },
        { id: 'm_c5000', name: { en: 'Capitalist', it: 'Capitalista' }, info: { en: '5000 credits earned in total.', it: '5000 crediti guadagnati in tutto.' }, need: { total: 5000 } },
        { id: 'm_ng1', name: { en: 'Access 1', it: 'Accesso 1' }, info: { en: 'Win at access level 1.', it: 'Vinci a livello di accesso 1.' }, need: { ng: 2 } },
        { id: 'm_ng3', name: { en: 'Access 3', it: 'Accesso 3' }, info: { en: 'Win at access level 3.', it: 'Vinci a livello di accesso 3.' }, need: { ng: 4 } },
        { id: 'm_ng5', name: { en: 'Superuser', it: 'Superutente' }, info: { en: 'Win at access level 5.', it: 'Vinci a livello di accesso 5.' }, need: { ng: 6 } },
        { id: 'm_day1', name: { en: 'Daily Challenge', it: 'Sfida del giorno' }, info: { en: 'Play the daily challenge.', it: 'Gioca la sfida giornaliera.' }, need: { daily: 1 } },
        { id: 'm_day10', name: { en: 'Creature of Habit', it: 'Abitudinario' }, info: { en: '10 daily challenges.', it: '10 sfide giornaliere.' }, need: { daily: 10 } },
        { id: 'm_dex20', name: { en: 'Collector', it: 'Collezionista' }, info: { en: 'Meet 20 types of enemy.', it: 'Incontra 20 tipi di nemico.' }, need: { codex: 20 } },
        { id: 'm_dex50', name: { en: 'Entomologist', it: 'Entomologo' }, info: { en: 'Meet 50 types of enemy.', it: 'Incontra 50 tipi di nemico.' }, need: { codex: 50 } },
        { id: 'm_dex70', name: { en: 'Bestiary Almost Full', it: 'Bestiario quasi pieno' }, info: { en: 'Meet 70 types of enemy.', it: 'Incontra 70 tipi di nemico.' }, need: { codex: 70 } },
        { id: 'm_dex90', name: { en: 'Taxonomist', it: 'Tassonomista' }, info: { en: 'Meet 90 types of enemy.', it: 'Incontra 90 tipi di nemico.' }, need: { codex: 90 } },
        { id: 'm_lvl20', name: { en: 'Bookworm', it: 'Secchione' }, info: { en: 'Reach level 20 in one run.', it: 'Arriva al livello 20 in una partita.' }, need: { maxLvl: 20 } },
        { id: 'm_lvl40', name: { en: 'Top of the Class', it: 'Primo della classe' }, info: { en: 'Reach level 40 in one run.', it: 'Arriva al livello 40 in una partita.' }, need: { maxLvl: 40 } },
    ];
    /** Experience needed to go from level `lvl` to the next. Gently steeper than linear so the hero stops outgrowing the later sectors. */
    const xpNeed = (lvl) => Math.round(10 * lvl + 1.0 * lvl * lvl);
    return { UPGRADES, MEDALS, xpNeed };
});
