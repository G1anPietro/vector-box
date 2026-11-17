// js/rogue/text-systems.js — the sentences of the SYSTEMS layer (terrain hazards, crafting, elites, recap screen), in English and Italian.
// Same structure and rules as text.js (key -> { en, it }, the same {placeholders} in both languages); it is merged into text.js's MSG when it loads,
// so game.js and dungeon.js use these keys exactly like the others. It lives in its own file so that the data branch (text.js) and the systems branch merge cleanly.
// Load it right after text.js (dungeon.html does).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./text.js'));
    else factory(root.Rogue.text);
})(typeof self !== 'undefined' ? self : this, function (TX) {
    'use strict';
    const MSG = {
        // ── the end of a run: the recap screen
        end_next: { en: 'Next run', it: 'Prossima partita' },
        end_class: { en: 'Class', it: 'Classe' },
        end_floor: { en: 'Floor', it: 'Piano' },
        end_level: { en: 'Level', it: 'Livello' },
        end_kills: { en: 'Enemies', it: 'Nemici' },
        end_turns: { en: 'Turns', it: 'Turni' },
        end_bosses: { en: 'Bosses', it: 'Boss' },
        end_found: { en: 'Credits found', it: 'Crediti trovati' },
        end_reward: { en: 'Archive reward', it: 'Premio archivio' },
        end_seed: { en: 'Seed', it: 'Seme' },
        end_where: { en: '{depth} · {sector}', it: '{depth} · {sector}' },
        end_cause: { en: 'Cause: {cause}', it: 'Causa: {cause}' },
        end_best: { en: 'New best floor!', it: 'Nuovo piano record!' },
        // ── diagonal moves and sleep
        diag_blocked: { en: 'You cannot cut a corner or go through a door sideways.', it: 'Non puoi tagliare l’angolo né passare di lato da una porta.' },
        sleep: { en: 'Sleep', it: 'Dormi' },
        sleep_aria: { en: 'Sleep until healed or disturbed', it: 'Dormi finché non sei guarito o disturbato' },
        sleep_start: { en: 'You lie down and doze off. Zzz…', it: 'Ti sdrai e ti appisolli. Zzz…' },
        sleep_enemy: { en: 'You cannot sleep with an enemy in sight.', it: 'Non puoi dormire con un nemico in vista.' },
        sleep_hungry: { en: 'Too hungry to sleep: eat something first.', it: 'Hai troppa fame per dormire: mangia qualcosa.' },
        sleep_starving: { en: 'You are starving: no sleeping.', it: 'Stai morendo di fame: niente sonno.' },
        sleep_full: { en: 'You are already in full health: nothing to sleep off.', it: 'Sei già in piena forma: non serve dormire.' },
        sleep_wake_mob: { en: '{mob} appears!', it: 'Compare: {mob}!' },
        sleep_wake_hurt: { en: 'Ouch! You wake up.', it: 'Ahi! Ti svegli.' },
        sleep_wake_hungry: { en: 'Your stomach growls: you wake up hungry.', it: 'Ti brontola lo stomaco: ti svegli affamato.' },
        sleep_wake_full: { en: 'You wake up rested: full health.', it: 'Ti svegli riposato: vita al massimo.' },
        sleep_wake_cap: { en: 'You have slept long enough.', it: 'Hai dormito abbastanza.' },
        st_sleep: { en: 'Zzz', it: 'Zzz' },
        card_you_sleep: { en: 'Asleep: you heal twice as fast, but enemies notice you from further away.', it: 'Dormi: guarisci il doppio più in fretta, ma i nemici ti notano da più lontano.' },
        help_7: { en: 'Keyboard: arrows or WASD (and Y U V N for the diagonals, or the numpad), space waits, Z sleeps, C searches, 1-4 quick slots, I bag, E explore, F skill, > stairs, B hides the screen.', it: 'Tastiera: frecce o WASD (e Y U V N per le diagonali, o il tastierino), spazio aspetta, Z dorme, C cerca, 1-4 slot rapidi, I zaino, E esplora, F abilità, > scale, B nasconde lo schermo.' },
        help_10: { en: 'You and the monsters move and hit in 8 directions, but you cannot cut a corner (a wall at either side blocks the diagonal) and doors are crossed straight. The D-pad has the four diagonals; tapping a tile walks there around obstacles.', it: 'Tu e i mostri vi muovete e colpite in 8 direzioni, ma non si taglia l’angolo (un muro su un lato blocca la diagonale) e le porte si passano dritte. La croce ha le quattro diagonali; toccando una casella ci vai aggirando gli ostacoli.' },
        help_11: { en: 'Sleep (button, long-press on Wait, or Z) rests until you are healed, hungry, hurt or a monster shows up (at most 100 turns). You heal twice as fast, but enemies notice you from 2 tiles further: sleep in a cleared room, not in a corridor.', it: 'Dormi (pulsante, pressione lunga su Aspetta, o Z) riposa finché non sei guarito, affamato, ferito o compare un mostro (al massimo 100 turni). Guarisci il doppio più in fretta, ma i nemici ti notano da 2 caselle più lontano: dormi in una stanza ripulita, non in un corridoio.' },
        dir_ul: { en: 'Up-left', it: 'Su a sinistra' },
        dir_ur: { en: 'Up-right', it: 'Su a destra' },
        dir_dl: { en: 'Down-left', it: 'Giù a sinistra' },
        dir_dr: { en: 'Down-right', it: 'Giù a destra' },
        // ── terrain hazards
        haz_title: { en: '{haz}', it: '{haz}' },
        haz_desc: { en: '{hazinfo}', it: '{hazinfo}' },
        card_haz_dmg: { en: 'Damage: {a}-{b}.', it: 'Danno: {a}-{b}.' },
        cause_haz: { en: '{haz}', it: '{haz}' },
        haz_poison: { en: '{haz}: you are poisoned!', it: '{haz}: sei avvelenato!' },
        haz_slide: { en: '{haz}: you slip and slide on!', it: '{haz}: scivoli e vai oltre!' },
        haz_shock: { en: '{haz}! A shock hits you for {n}.', it: '{haz}! Una scossa ti fa {n} di danno.' },
        haz_push: { en: '{haz} carries you along.', it: '{haz} ti trascina via.' },
        haz_push_against: { en: '{haz}: you wade against the stream.', it: '{haz}: avanzi controcorrente.' },
        haz_collapse: { en: '{haz} collapses on you: {n} damage.', it: '{haz} ti crolla addosso: {n} di danno.' },
        haz_fire: { en: '{haz}! {n} damage, and you are on fire.', it: '{haz}! {n} di danno, e prendi fuoco.' },
        haz_lag: { en: '{haz}: you freeze for a moment.', it: '{haz}: resti bloccato per un attimo.' },
        haz_heat: { en: '{haz}: the heat drains your energy.', it: '{haz}: il calore ti toglie energia.' },
        st_burn: { en: 'Burning', it: 'In fiamme' },
        // ── crafting
        bench_craft: { en: 'Workbench: combine items', it: 'Banco di lavoro: unisci oggetti' },
        craft_title: { en: 'Workbench', it: 'Banco di lavoro' },
        craft_hint: { en: 'Pick 2 or 3 items from the bag, then Combine. A wrong mix wastes nothing.', it: 'Scegli 2 o 3 oggetti dallo zaino, poi Unisci. Un miscuglio sbagliato non fa perdere nulla.' },
        craft_bag: { en: 'Your bag', it: 'Il tuo zaino' },
        craft_add: { en: 'Add', it: 'Aggiungi' },
        craft_do: { en: 'Combine', it: 'Unisci' },
        craft_clear: { en: 'Clear', it: 'Svuota' },
        craft_back: { en: 'Back to the bench', it: 'Torna alla panchina' },
        craft_empty_slot: { en: 'empty', it: 'vuoto' },
        craft_none: { en: 'Nothing happens. These do not go together.', it: 'Non succede nulla. Queste cose non stanno insieme.' },
        craft_ok: { en: 'You made {item}.', it: 'Hai creato {item}.' },
        craft_new: { en: 'New recipe: {recipe}!', it: 'Nuova ricetta: {recipe}!' },
        craft_item_hint: { en: 'This only works at the bench: combine it with something.', it: 'Serve alla panchina: uniscilo a qualcos’altro.' },
        craft_book: { en: 'Recipe book ({n}/{all})', it: 'Ricettario ({n}/{all})' },
        craft_book_empty: { en: 'No recipes yet. Try combining things at the bench, or find a Recipe Book.', it: 'Nessuna ricetta ancora. Prova a unire cose alla panchina, o trova un Ricettario.' },
        craft_use: { en: 'Use', it: 'Usa' },
        craft_fn_recharge: { en: 'a fully recharged stick', it: 'una chiavetta ricaricata' },
        book_read: { en: 'You read the recipe book: you now know every recipe.', it: 'Leggi il ricettario: ora conosci tutte le ricette.' },
        // ── elites (mini-bosses)
        floor_elite: { en: 'Something big lurks on this floor: {mob}.', it: 'Su questo piano si aggira qualcosa di grosso: {mob}.' },
        elite_slain: { en: '{mob} is down! It dropped something good.', it: '{mob} è a terra! Ha lasciato qualcosa di buono.' },
        card_mob_elite: { en: 'Elite: a named foe. It always drops an item.', it: 'Élite: un nemico con nome. Lascia sempre un oggetto.' },
        // ── help
        help_8: { en: 'Each sector has its own look and one terrain hazard (live cables, packet streams, fire, lag zones…). Hazards are always visible: hold on one to read what it does. Auto-walk goes around the ones you have seen.', it: 'Ogni settore ha un aspetto suo e un pericolo del terreno (cavi scoperti, flussi di pacchetti, fuoco, zone di lag…). I pericoli si vedono sempre: tieni premuto su uno per leggere cosa fa. Il cammino automatico li aggira.' },
        help_9: { en: 'At the bench in the Server Lounge you can craft: pick 2 or 3 items from the bag and combine them. Recipes you discover are saved in the recipe book.', it: 'Alla panchina della Sala Server puoi creare oggetti: scegli 2 o 3 cose dallo zaino e uniscile. Le ricette scoperte restano nel ricettario.' },
    };
    Object.assign(TX.MSG, MSG);
    return { MSG };
});
