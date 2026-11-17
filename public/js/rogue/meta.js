// js/rogue/meta.js — what carries over between runs: the upgrade tree (bought with crediti), the medals. Data only.
//
// The saved profile (`meta`) counts: runs, wins, best (deepest floor), bosses, kills, turns, total (crediti earned in all),
// ng (highest "livello di accesso" you may start: 1 more than the best one cleared), daily (daily challenges played), codex (monster id → {seen, kills}).
//
// HOW TO ADD AN UPGRADE: one object in UPGRADES: id, name, info, max (levels), cost (crediti for the first level; each next
// level costs cost * (level + 1)), and what one level gives: mod { … } (the numbers of classes.js: atk, def, luck…),
// or gold (starting crediti), kit (extra item ids at the start) or known (items you already know).
// HOW TO ADD A MEDAL: one object in MEDALS: id, name, info, and `need` { counter: value }: the medal is yours when every
// counter of the profile is at least that. Each medal pays 20 crediti, once.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else (root.Rogue = root.Rogue || {}).meta = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    const UPGRADES = [
        { id: 'vita', name: 'Colazione ricca', info: 'Vita iniziale +3 per livello.', max: 10, cost: 20, mod: { maxHp: 3 } },
        { id: 'forza', name: 'Palestra della scuola', info: 'Attacco +1.', max: 5, cost: 60, mod: { atk: 1 } },
        { id: 'difesa', name: 'Felpa imbottita', info: 'Difesa +1.', max: 5, cost: 60, mod: { def: 1 } },
        { id: 'mira', name: 'Occhiali nuovi', info: 'Mira +1.', max: 4, cost: 40, mod: { acc: 1 } },
        { id: 'schiva', name: 'Scarpe da corsa', info: 'Schivata +1.', max: 4, cost: 50, mod: { dodge: 1 } },
        { id: 'fortuna', name: 'Quadrifoglio', info: 'Crediti trovati +10%.', max: 5, cost: 30, mod: { luck: 10 } },
        { id: 'fame', name: 'Colazione al sacco', info: 'Fame più lenta (+10%).', max: 5, cost: 30, mod: { hunger: 10 } },
        { id: 'esperto', name: 'Ripetizioni', info: 'Esperienza +5%.', max: 5, cost: 50, mod: { xp: 5 } },
        { id: 'sconto', name: 'Tessera sconti', info: 'Sconto nei negozi +5%.', max: 6, cost: 25, mod: { haggle: 5 } },
        { id: 'recupero', name: 'Pisolino in aula', info: 'Guarisci più in fretta.', max: 3, cost: 80, mod: { regen: 1 } },
        { id: 'occhio', name: 'Torcia a dinamo', info: 'Vedi una casella più lontano.', max: 2, cost: 120, mod: { sight: 1 } },
        { id: 'abilita', name: 'Allenamento mirato', info: 'L’abilità si ricarica prima (+10%).', max: 4, cost: 70, mod: { cd: 10 } },
        { id: 'chiavette', name: 'Powerbank', info: 'Chiavette e abilità più forti (+10%).', max: 4, cost: 70, mod: { usb: 10 } },
        { id: 'soldi', name: 'Paghetta', info: 'Parti con 20 crediti in più.', max: 10, cost: 15, gold: 20 },
        { id: 'scorta', name: 'Zaino della nonna', info: 'Parti con una merendina in più.', max: 3, cost: 40, kit: ['merendina'] },
        { id: 'lattina', name: 'Frigo della sala prof', info: 'Parti con un energy drink in più.', max: 3, cost: 90, kit: ['d_cura'] },
        { id: 'manuale', name: 'Manuale di sopravvivenza', info: 'Conosci subito gli script “man” e “ls -R”.', max: 1, cost: 150, known: ['s_man', 's_ls'] },
    ];
    const MEDALS = [
        { id: 'm_run1', name: 'Matricola', info: 'Fai la prima partita.', need: { runs: 1 } },
        { id: 'm_run10', name: 'Habitué', info: '10 partite.', need: { runs: 10 } },
        { id: 'm_run50', name: 'Abbonato', info: '50 partite.', need: { runs: 50 } },
        { id: 'm_run200', name: 'Inquilino', info: '200 partite.', need: { runs: 200 } },
        { id: 'm_d5', name: 'Sotto la palestra', info: 'Arriva al piano 5.', need: { best: 5 } },
        { id: 'm_d10', name: 'Sala macchine', info: 'Arriva al piano 10.', need: { best: 10 } },
        { id: 'm_d20', name: 'In rete', info: 'Arriva al piano 20.', need: { best: 20 } },
        { id: 'm_d30', name: 'Nelle nuvole', info: 'Arriva al piano 30.', need: { best: 30 } },
        { id: 'm_d40', name: 'Cuore del kernel', info: 'Arriva al piano 40.', need: { best: 40 } },
        { id: 'm_d50', name: 'Fino in fondo', info: 'Arriva al piano 50.', need: { best: 50 } },
        { id: 'm_b1', name: 'Caccia al bug', info: 'Batti il primo boss.', need: { bosses: 1 } },
        { id: 'm_b5', name: 'Cacciatore', info: 'Batti 5 boss.', need: { bosses: 5 } },
        { id: 'm_b10', name: 'Sterminatore', info: 'Batti 10 boss.', need: { bosses: 10 } },
        { id: 'm_b30', name: 'Leggenda', info: 'Batti 30 boss.', need: { bosses: 30 } },
        { id: 'm_w1', name: 'Server spento', info: 'Vinci una partita.', need: { wins: 1 } },
        { id: 'm_w5', name: 'Spegnitore seriale', info: 'Vinci 5 partite.', need: { wins: 5 } },
        { id: 'm_w20', name: 'Amministratore', info: 'Vinci 20 partite.', need: { wins: 20 } },
        { id: 'm_k100', name: 'Disinfestatore', info: '100 nemici eliminati.', need: { kills: 100 } },
        { id: 'm_k1000', name: 'Antivirus', info: '1000 nemici eliminati.', need: { kills: 1000 } },
        { id: 'm_k5000', name: 'Pulizia di primavera', info: '5000 nemici eliminati.', need: { kills: 5000 } },
        { id: 'm_t5k', name: 'Ore piccole', info: '5000 turni giocati in tutto.', need: { turns: 5000 } },
        { id: 'm_t50k', name: 'Notte in bianco', info: '50000 turni giocati in tutto.', need: { turns: 50000 } },
        { id: 'm_c500', name: 'Risparmiatore', info: '500 crediti guadagnati in tutto.', need: { total: 500 } },
        { id: 'm_c5000', name: 'Capitalista', info: '5000 crediti guadagnati in tutto.', need: { total: 5000 } },
        { id: 'm_ng1', name: 'Accesso 1', info: 'Vinci a livello di accesso 1.', need: { ng: 2 } },
        { id: 'm_ng3', name: 'Accesso 3', info: 'Vinci a livello di accesso 3.', need: { ng: 4 } },
        { id: 'm_ng5', name: 'Superutente', info: 'Vinci a livello di accesso 5.', need: { ng: 6 } },
        { id: 'm_day1', name: 'Sfida del giorno', info: 'Gioca la sfida giornaliera.', need: { daily: 1 } },
        { id: 'm_day10', name: 'Abitudinario', info: '10 sfide giornaliere.', need: { daily: 10 } },
        { id: 'm_dex20', name: 'Collezionista', info: 'Incontra 20 tipi di nemico.', need: { codex: 20 } },
        { id: 'm_dex50', name: 'Entomologo', info: 'Incontra 50 tipi di nemico.', need: { codex: 50 } },
        { id: 'm_dex70', name: 'Bestiario quasi pieno', info: 'Incontra 70 tipi di nemico.', need: { codex: 70 } },
        { id: 'm_lvl20', name: 'Secchione', info: 'Arriva al livello 20 in una partita.', need: { maxLvl: 20 } },
        { id: 'm_lvl40', name: 'Primo della classe', info: 'Arriva al livello 40 in una partita.', need: { maxLvl: 40 } },
    ];
    return { UPGRADES, MEDALS };
});
