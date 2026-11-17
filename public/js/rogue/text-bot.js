// js/rogue/text-bot.js — the sentences of "Watch the bot play": the setup sheet, the spectator bar and the "Why?" panel, in English and Italian.
// Same structure and rules as text.js (key -> { en, it }, the same {placeholders} in both languages); merged into text.js's MSG when it loads.
// Load it right after text.js (dungeon.html does).
//
// bot_* keys = the REASONS bot.js leaves in memo.why = { key, params } at every decision. explain(why, lang, names) turns one into a sentence:
//   - the sentence is MSG[key + '_' + variant] when it exists, else MSG[key]; the variant is params.how, params.what, params.why, 'low' (params.low) or 'boss' (params.boss);
//   - the placeholders {item} {mob} {skill} are names: names.item(k), names.mob(k), names.skill(id) give them in the right language ('' item = one the bot has not identified);
//   - the other params ({price}) go in as they are.
// Adding a reason: set memo.why in bot.js, add the key here in both languages (tests/dungeon-watch.test.js checks that every key bot.js uses exists).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./text.js'));
    else root.Rogue.textBot = factory(root.Rogue.text);
})(typeof self !== 'undefined' ? self : this, function (TX) {
    'use strict';
    const MSG = {
        // ── the reasons of the bot
        bot_skill: { en: 'Level up: it picks {skill}.', it: 'Sale di livello: sceglie {skill}.' },
        bot_shop: { en: 'Shopping: it buys {item} for {price} cr.', it: 'Acquisti: compra {item} per {price} cr.' },
        bot_leave: { en: 'Done here: it leaves.', it: 'Ha finito qui: esce.' },
        bot_leave_shop: { en: 'Nothing else worth buying: it leaves the shop.', it: 'Non c’è altro da comprare: esce dal negozio.' },
        bot_leave_bench: { en: 'Nothing else to do at the bench: it leaves.', it: 'Alla panchina non c’è altro da fare: se ne va.' },
        bot_bench_rest: { en: 'Resting at the bench: free healing and the skill cooldown resets.', it: 'Riposa alla panchina: cura gratis e l’abilità si ricarica.' },
        bot_recycle: { en: 'Recycles {item}: it is no use to it.', it: 'Ricicla {item}: non gli serve.' },
        bot_drink_heal: { en: 'Low on health with an enemy close: it drinks {item}.', it: 'Poca vita e un nemico vicino: beve {item}.' },
        bot_drink_unknown: { en: 'Desperate: it tries an unknown potion hoping it heals.', it: 'Disperato: prova una pozione sconosciuta sperando che curi.' },
        bot_flee: { en: 'Too dangerous: it runs away.', it: 'Troppo pericoloso: scappa.' },
        bot_flee_stairs: { en: 'Badly hurt: it runs for the stairs to escape.', it: 'Ferito gravemente: corre verso le scale per scappare.' },
        bot_flee_teleport: { en: 'Badly hurt: it reads a teleport script to get away.', it: 'Ferito gravemente: legge uno script di teletrasporto per fuggire.' },
        bot_ability: { en: 'It uses its class skill.', it: 'Usa l’abilità di classe.' },
        bot_ability_low: { en: 'Low on health: it uses its class skill.', it: 'Poca vita: usa l’abilità di classe.' },
        bot_use_item: { en: 'It uses {item}.', it: 'Usa {item}.' },
        bot_try_item: { en: 'It tries an unknown item to find out what it does.', it: 'Prova un oggetto sconosciuto per scoprire cosa fa.' },
        bot_throw: { en: 'It throws {item} at {mob}.', it: 'Lancia {item} contro {mob}.' },
        bot_fight: { en: 'Fights {mob}, the weakest enemy next to it.', it: 'Combatte {mob}, il nemico più debole accanto a lui.' },
        bot_choke: { en: 'Several enemies are coming: it backs into a corridor so they come one at a time.', it: 'Stanno arrivando più nemici: si mette in un corridoio così arrivano uno alla volta.' },
        bot_wait: { en: 'It waits a turn.', it: 'Aspetta un turno.' },
        bot_wait_enemy: { en: 'Waits for {mob} to come close: the first hit will be its own.', it: 'Aspetta che {mob} si avvicini: il primo colpo sarà suo.' },
        bot_wait_stuck: { en: 'The last action was refused again and again: it waits instead.', it: 'L’ultima azione è stata rifiutata più volte: aspetta invece.' },
        bot_chase: { en: 'Goes after {mob}.', it: 'Va incontro a {mob}.' },
        bot_gear: { en: 'Equips {item}: better than what it wears.', it: 'Indossa {item}: meglio di quello che ha addosso.' },
        bot_eat: { en: 'Hungry: it eats.', it: 'Ha fame: mangia.' },
        bot_rest: { en: 'Nobody around and not at full health: it sleeps to heal.', it: 'Nessuno in giro e non è in piena salute: dorme per curarsi.' },
        bot_rest_boss: { en: 'The boss is near: it heals almost fully before going in.', it: 'Il boss è vicino: si cura quasi del tutto prima di entrare.' },
        bot_place: { en: 'Goes to a place it can use.', it: 'Va in un posto che può usare.' },
        bot_place_bench: { en: 'Goes to the bench to rest and recycle.', it: 'Va alla panchina per riposare e riciclare.' },
        bot_place_shop: { en: 'Goes to the shop with its credits.', it: 'Va al negozio con i suoi crediti.' },
        bot_place_altar: { en: 'Healthy enough to try the altar.', it: 'Sta abbastanza bene per provare l’altare.' },
        bot_stab: { en: 'Sneaks up on sleeping {mob}: a hit on a sleeper does triple damage.', it: 'Si avvicina a {mob} che dorme: colpire chi dorme fa danno triplo.' },
        bot_stairs: { en: 'Heads for the stairs.', it: 'Va verso le scale.' },
        bot_stairs_descend: { en: 'Floor explored: it goes down the stairs.', it: 'Piano esplorato: scende le scale.' },
        bot_stairs_food: { en: 'Almost out of food: it stops exploring and goes down (new floors have food).', it: 'Il cibo sta finendo: smette di esplorare e scende (nei piani nuovi c’è cibo).' },
        bot_stairs_walk: { en: 'Nothing left to explore: it walks to the stairs.', it: 'Non c’è più niente da esplorare: va alle scale.' },
        bot_explore: { en: 'Explores to find items and the way down.', it: 'Esplora per trovare oggetti e la via per scendere.' },
        bot_boss: { en: 'Goes straight for the boss.', it: 'Va dritto dal boss.' },
        bot_search: { en: 'Nowhere to go: it searches for secret doors.', it: 'Non sa dove andare: cerca porte segrete.' },
        // ── the title screen and the setup sheet
        watch_btn: { en: 'Watch the bot play', it: 'Guarda il bot giocare' },
        watch_title: { en: 'Watch the bot play', it: 'Guarda il bot giocare' },
        watch_note: { en: 'The bot plays by itself with the same rules. Your own run, profile, medals and archive are never touched.', it: 'Il bot gioca da solo con le stesse regole. La tua partita, il profilo, le medaglie e l’archivio non vengono mai toccati.' },
        watch_class: { en: 'Class', it: 'Classe' },
        watch_seed: { en: 'Seed', it: 'Seme' },
        watch_seed_random: { en: 'Random seed', it: 'Seme casuale' },
        watch_seed_daily: { en: 'Today’s daily seed', it: 'Seme di oggi (sfida del giorno)' },
        watch_seed_bad: { en: 'The seed is up to 8 hex digits (0-9, A-F).', it: 'Il seme è fatto da al massimo 8 cifre esadecimali (0-9, A-F).' },
        watch_style: { en: 'Style', it: 'Stile' },
        watch_style_normal: { en: 'Normal', it: 'Normale' },
        watch_style_careful: { en: 'Careful', it: 'Prudente' },
        watch_start: { en: 'Start watching', it: 'Inizia a guardare' },
        watch_resume: { en: 'Resume the bot run (floor {depth}, turn {turn})', it: 'Riprendi la partita del bot (piano {depth}, turno {turn})' },
        watch_discard: { en: 'Discard the bot run', it: 'Scarta la partita del bot' },
        // ── the spectator bar and the Why? panel
        watch_badge: { en: 'Watching the bot', it: 'Guardi il bot' },
        watch_pause: { en: 'Pause', it: 'Pausa' },
        watch_play: { en: 'Play', it: 'Avvia' },
        watch_step: { en: 'Step', it: 'Passo' },
        watch_stop: { en: 'Stop', it: 'Stop' },
        watch_speed: { en: 'Speed', it: 'Velocità' },
        watch_max: { en: 'max', it: 'max' },
        watch_why: { en: 'Why?', it: 'Perché?' },
        watch_why_title: { en: 'What is it thinking?', it: 'Cosa sta pensando?' },
        watch_why_none: { en: 'No decision yet.', it: 'Ancora nessuna decisione.' },
        watch_why_turn: { en: 'turn {turn}', it: 'turno {turn}' },
        watch_stat: { en: 'HP {hp}/{max} · floor {depth} · turn {turn} · kills {kills} · {style}', it: 'PS {hp}/{max} · piano {depth} · turno {turn} · nemici {kills} · {style}' },
        watch_stalled: { en: 'The bot stopped making progress, so the run was stopped.', it: 'Il bot non faceva più progressi, quindi la partita è stata fermata.' },
        watch_cap: { en: 'The run reached the limit of {n} actions and was stopped.', it: 'La partita ha raggiunto il limite di {n} azioni ed è stata fermata.' },
        watch_stopped_line: { en: 'Stopped on floor {depth}.', it: 'Fermata al piano {depth}.' },
        // ── the end of a watched run
        watch_end_won: { en: 'The bot won!', it: 'Il bot ha vinto!' },
        watch_end_lost: { en: 'The bot died on floor {depth}', it: 'Il bot è morto al piano {depth}' },
        watch_end_halt: { en: 'The bot run was stopped', it: 'La partita del bot è stata fermata' },
        watch_end_won_line: { en: 'The bot switched the server off.', it: 'Il bot ha spento il server.' },
        watch_again: { en: 'Watch again (same seed)', it: 'Guarda di nuovo (stesso seme)' },
        watch_new: { en: 'New seed', it: 'Nuovo seme' },
        watch_menu: { en: 'Back to the menu', it: 'Torna al menu' },
        bot_unknown_item: { en: 'an unknown item', it: 'un oggetto sconosciuto' },
    };
    Object.assign(TX.MSG, MSG);
    /** One memo.why = { key, params } as a sentence. names = { item(k), mob(k), skill(id) } → localised names (optional). */
    function explain(why, lang, names) {
        if (!why || !TX.MSG[why.key]) return '';
        const p = why.params || {}, vars = Object.assign({}, p), nm = names || {};
        if ('item' in p) vars.item = p.item ? (nm.item ? nm.item(p.item) : p.item) : TX.t('bot_unknown_item', null, lang);
        if (p.mob) vars.mob = nm.mob ? nm.mob(p.mob) : p.mob;
        if (p.skill) vars.skill = nm.skill ? nm.skill(p.skill) : p.skill;
        const v = p.how || p.what || p.why || (p.low ? 'low' : '') || (p.boss ? 'boss' : '');
        const key = v && TX.MSG[why.key + '_' + v] ? why.key + '_' + v : why.key;
        return TX.t(key, vars, lang);
    }
    return { MSG, explain };
});
