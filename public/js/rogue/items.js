// js/rogue/items.js — everything you can pick up. Data only.
//
// TEXTS: every text the player reads is an object { en: '…', it: '…' } (English first; both are required and the tests check them). Keep ids stable and
// language-free; never write a sentence in game.js. Proper names that are the same in both languages are written twice.
// HOW TO ADD AN ITEM: add one object to LIST. Needed: id, cat, name {en,it}, price. Optional: from (first floor where it can
// be found, default 1), w (how common, default 10), col (colour), info {en,it} (one line for the inventory).
//   cat 'weapon':  dmg [min, max]; optional acc (aim), crit (% more critical hits), holy (extra damage to `undead`)
//   cat 'armor':   def; optional dodge
//   cat 'food':    food (how much hunger it removes; the belly holds 1200)
//   cat 'plugin':  mod { … } — the same numbers the skills use (see classes.js): atk, def, acc, dodge, crit, regen…
//   cat 'drink' and 'script':  effect (+ power) — used once
//   cat 'throw':   dmg [min, max] — thrown at a tile (range 6), hits the first enemy on the line; sometimes it can be picked up again
//   cat 'usb':     effect (+ power), ch (charges) — hits the nearest enemy you see
// The effects are the functions in EFFECTS in game.js: an item with an existing effect needs only its line here.
// Drinks, scripts, USB sticks and plugins are unknown until used: each run gives them a random look from LOOKS
// (there must be at least as many looks as items of that kind: the tests check it). A look is [name, colour]: name is { en, it } or a plain string
// when it is the same in both languages (a file name); CATS[cat].unk is the template of an unknown name: '{look} can' / 'Lattina {look}'.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else (root.Rogue = root.Rogue || {}).items = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    const CATS = {
        weapon: { name: { en: 'Weapon', it: 'Arma' }, shape: 'weapon', col: '#c9d6e3', slot: 'weapon' },
        armor:  { name: { en: 'Armor', it: 'Protezione' }, shape: 'armor', col: '#8fb4e8', slot: 'armor' },
        plugin: { name: { en: 'Plugin', it: 'Plugin' }, unk: { en: '{look} plugin', it: 'Plugin {look}' }, shape: 'plugin', slot: 'plugin', unknown: true },
        drink:  { name: { en: 'Can', it: 'Lattina' }, unk: { en: '{look} can', it: 'Lattina {look}' }, shape: 'can', unknown: true, stack: true },
        script: { name: { en: 'Script', it: 'Script' }, unk: { en: 'Script {look}', it: 'Script {look}' }, shape: 'script', unknown: true, stack: true },
        usb:    { name: { en: 'USB stick', it: 'Chiavetta' }, unk: { en: '{look} USB stick', it: 'Chiavetta {look}' }, shape: 'usb', unknown: true },
        food:   { name: { en: 'Food', it: 'Cibo' }, shape: 'food', col: '#e8b84a', stack: true },
        throw:  { name: { en: 'Throwable', it: 'Da lancio' }, shape: 'dart', col: '#c9d6e3', stack: true },
    };
    const LOOKS = {
        drink: [[{ en: 'red', it: 'rossa' }, '#e85a5a'], [{ en: 'blue', it: 'blu' }, '#5a8fe8'], [{ en: 'green', it: 'verde' }, '#5ad87b'], [{ en: 'yellow', it: 'gialla' }, '#e8d45a'], [{ en: 'purple', it: 'viola' }, '#b06ae8'], [{ en: 'orange', it: 'arancione' }, '#e8964a'],
                [{ en: 'pink', it: 'rosa' }, '#e88ac0'], [{ en: 'black', it: 'nera' }, '#6b6880'], [{ en: 'white', it: 'bianca' }, '#e8e6f0'], [{ en: 'cyan', it: 'azzurra' }, '#6ad8e8'], [{ en: 'silver', it: 'argento' }, '#aab3c0'], [{ en: 'golden', it: 'dorata' }, '#d8b44a']],
        script: [['xk7.sh', '#e8e6f0'], ['a.out', '#e8e6f0'], ['tmp_2.bat', '#e8e6f0'], [{ en: 'new(3).py', it: 'nuovo(3).py' }, '#e8e6f0'], ['qwe.sh', '#e8e6f0'], [{ en: 'test.js', it: 'prova.js' }, '#e8e6f0'],
                 ['zzz.pl', '#e8e6f0'], [{ en: 'final_v2.sh', it: 'finale_v2.sh' }, '#e8e6f0'], [{ en: 'idk.cmd', it: 'boh.cmd' }, '#e8e6f0'], ['asdf.rb', '#e8e6f0'], ['core.dump', '#e8e6f0'], [{ en: 'untitled', it: 'senza_nome' }, '#e8e6f0'],
                 [{ en: 'copy_of_copy', it: 'copia_di_copia' }, '#e8e6f0'], [{ en: 'DO_NOT_OPEN', it: 'NON_APRIRE' }, '#e8e6f0']],
        usb: [[{ en: 'red', it: 'rossa' }, '#e85a5a'], [{ en: 'blue', it: 'blu' }, '#5a8fe8'], [{ en: 'green', it: 'verde' }, '#5ad87b'], [{ en: 'yellow', it: 'gialla' }, '#e8d45a'], [{ en: 'black', it: 'nera' }, '#6b6880'], [{ en: 'white', it: 'bianca' }, '#e8e6f0'], [{ en: 'purple', it: 'viola' }, '#b06ae8'], [{ en: 'orange', it: 'arancione' }, '#e8964a']],
        plugin: [[{ en: 'square', it: 'quadrato' }, '#5ad87b'], [{ en: 'round', it: 'rotondo' }, '#5a8fe8'], [{ en: 'crooked', it: 'storto' }, '#e8964a'], [{ en: 'shiny', it: 'lucido' }, '#e8e6f0'], [{ en: 'scratched', it: 'graffiato' }, '#aab3c0'], [{ en: 'gilded', it: 'dorato' }, '#d8b44a'],
                 [{ en: 'tiny', it: 'minuscolo' }, '#e88ac0'], [{ en: 'scorched', it: 'bruciacchiato' }, '#8a6a55'], [{ en: 'transparent', it: 'trasparente' }, '#6ad8e8'], [{ en: 'heavy', it: 'pesante' }, '#6b6880']],
    };
    // Short builders for the long lists below. Every item gets `sprite: 'item_<id>'` (a picture key for the art file; until it exists the picture of its category is used).
    const I = (cat, id, en, it, ien, iit, p) => Object.assign({ id, cat, name: { en, it }, info: { en: ien, it: iit }, sprite: 'item_' + id }, cat === 'plugin' ? { w: 4 } : {}, p);
    /** Weapon: damage [min, max], floors from-to, x = acc / crit / holy / w. The price follows the numbers. */
    const W = (id, en, it, dmg, from, to, ien, iit, x) => { x = x || {}; return I('weapon', id, en, it, ien, iit, Object.assign({ dmg, from, to, w: 5, price: Math.round((dmg[0] + dmg[1]) * 7 + (x.crit || 0) * 3 + (x.acc || 0) * 8 + (x.holy || 0) * 12) }, x)); };
    /** Armour: def, dodge, floors from-to. */
    const A = (id, en, it, def, dodge, from, to, ien, iit) => I('armor', id, en, it, ien, iit, Object.assign({ def, from, to, w: 5, price: def * 24 + Math.max(0, dodge) * 20 }, dodge ? { dodge } : {}));
    /** Throwable: damage [min, max], floors from-to. */
    const T = (id, en, it, dmg, from, to, ien, iit) => I('throw', id, en, it, ien, iit, { dmg, from, to, w: 6, price: Math.round((dmg[0] + dmg[1]) * 2.5) });
    /** Food: how much hunger it removes, floors from-to. */
    const F = (id, en, it, food, from, to, ien, iit) => I('food', id, en, it, ien, iit, { food, from, to, w: 6, price: Math.round(food / 35) });
    // more looks (the tests check there are at least as many looks as items of a kind)
    LOOKS.drink.push([{ en: 'lime', it: 'lime' }, '#a8e84a'], [{ en: 'teal', it: 'turchese' }, '#2ab0a0'], [{ en: 'brown', it: 'marrone' }, '#9a6a40'], [{ en: 'gray', it: 'grigia' }, '#8a8a96'], [{ en: 'violet', it: 'lilla' }, '#c8a0f0'], [{ en: 'coral', it: 'corallo' }, '#f07a6a'], [{ en: 'mint', it: 'menta' }, '#8af0c0'], [{ en: 'peach', it: 'pesca' }, '#f0b890'], [{ en: 'navy', it: 'blu notte' }, '#2a3a8a'], [{ en: 'amber', it: 'ambra' }, '#f0a020'], [{ en: 'lavender', it: 'lavanda' }, '#b8a8e8'], [{ en: 'crimson', it: 'cremisi' }, '#c0304a'], [{ en: 'olive', it: 'oliva' }, '#8a9a3a'], [{ en: 'beige', it: 'beige' }, '#e0d0b0'], [{ en: 'indigo', it: 'indaco' }, '#5a3ab0'], [{ en: 'rust', it: 'ruggine' }, '#b0602a']);
    LOOKS.usb.push([{ en: 'lime', it: 'lime' }, '#a8e84a'], [{ en: 'teal', it: 'turchese' }, '#2ab0a0'], [{ en: 'brown', it: 'marrone' }, '#9a6a40'], [{ en: 'gray', it: 'grigia' }, '#8a8a96'], [{ en: 'violet', it: 'lilla' }, '#c8a0f0'], [{ en: 'coral', it: 'corallo' }, '#f07a6a'], [{ en: 'mint', it: 'menta' }, '#8af0c0'], [{ en: 'peach', it: 'pesca' }, '#f0b890'], [{ en: 'navy', it: 'blu notte' }, '#2a3a8a'], [{ en: 'amber', it: 'ambra' }, '#f0a020'], [{ en: 'lavender', it: 'lavanda' }, '#b8a8e8'], [{ en: 'crimson', it: 'cremisi' }, '#c0304a'], [{ en: 'olive', it: 'oliva' }, '#8a9a3a'], [{ en: 'beige', it: 'beige' }, '#e0d0b0'], [{ en: 'indigo', it: 'indaco' }, '#5a3ab0'], [{ en: 'rust', it: 'ruggine' }, '#b0602a']);
    LOOKS.plugin.push([{ en: 'hexagonal', it: 'esagonale' }, '#9ab0e8'], [{ en: 'dented', it: 'ammaccato' }, '#a0a0a8'], [{ en: 'sticky', it: 'appiccicoso' }, '#e8c85a'], [{ en: 'glowing', it: 'luminoso' }, '#c8f06a'], [{ en: 'dusty', it: 'impolverato' }, '#b0a898'], [{ en: 'rusty', it: 'arrugginito' }, '#b0703a'], [{ en: 'bent', it: 'piegato' }, '#8ab0c0'], [{ en: 'striped', it: 'a righe' }, '#e88a8a'], [{ en: 'spotted', it: 'a pois' }, '#e8a8d0'], [{ en: 'warm', it: 'tiepido' }, '#f0a060'], [{ en: 'cold', it: 'freddo' }, '#80c0f0'], [{ en: 'sparkly', it: 'scintillante' }, '#f0f0a0'], [{ en: 'wobbly', it: 'traballante' }, '#a8e8a8'], [{ en: 'oval', it: 'ovale' }, '#c0a0d8'], [{ en: 'triangular', it: 'triangolare' }, '#d8d870'], [{ en: 'thin', it: 'sottile' }, '#a0d0d0'], [{ en: 'thick', it: 'spesso' }, '#a08868'], [{ en: 'smooth', it: 'liscio' }, '#d0e0f0'], [{ en: 'rough', it: 'ruvido' }, '#a88868'], [{ en: 'faded', it: 'sbiadito' }, '#b8b0c0'], [{ en: 'neon', it: 'al neon' }, '#40f0a0'], [{ en: 'pale', it: 'pallido' }, '#e8e0e0'], [{ en: 'dark', it: 'scuro' }, '#505068'], [{ en: 'twisted', it: 'contorto' }, '#c06ab0'], [{ en: 'chipped', it: 'scheggiato' }, '#98a0a8'], [{ en: 'flat', it: 'piatto' }, '#88a0b8'], [{ en: 'long', it: 'lungo' }, '#88c0a0'], [{ en: 'short', it: 'corto' }, '#c0a088'], [{ en: 'hollow', it: 'vuoto' }, '#a0b0c0'], [{ en: 'taped', it: 'con lo scotch' }, '#d8c898']);
    LOOKS.script.push(['main.py', '#e8e6f0'], ['run.sh', '#e8e6f0'], ['setup.exe', '#e8e6f0'], ['foo.txt', '#e8e6f0'], ['x.bat', '#e8e6f0'], ['tmp.sh', '#e8e6f0'], ['a1.js', '#e8e6f0'], ['go.pl', '#e8e6f0'], ['fix.cmd', '#e8e6f0'], ['hack.sh', '#e8e6f0'], ['lol.py', '#e8e6f0'], ['bak.sh', '#e8e6f0'], ['out.log', '#e8e6f0'], ['v3.rb', '#e8e6f0'], ['test2.sh', '#e8e6f0'], ['k.sh', '#e8e6f0'], ['do_it.sh', '#e8e6f0'], ['oops.bat', '#e8e6f0']);
    const LIST = [
        // ── armi
        { id: 'righello', cat: 'weapon', to: 10, name: { en: '50 cm Ruler', it: 'Righello da 50' }, dmg: [1, 4], acc: 1, price: 15, info: { en: 'Made of metal. Painful on the knuckles.', it: 'Di metallo. Fa male sulle dita.' } },
        { id: 'cacciavite', cat: 'weapon', to: 14, name: { en: 'Screwdriver', it: 'Cacciavite' }, dmg: [1, 4], acc: 2, crit: 15, price: 25, info: { en: 'Precise: more critical hits.', it: 'Preciso: più colpi critici.' } },
        { id: 'cavo', cat: 'weapon', to: 14, name: { en: 'Network Cable', it: 'Cavo di rete' }, dmg: [1, 6], price: 25, info: { en: 'Cat 5e, three meters. Used like a whip.', it: 'Cat 5e, tre metri. Si usa come una frusta.' } },
        { id: 'tastiera', cat: 'weapon', to: 20, name: { en: 'Keyboard', it: 'Tastiera' }, dmg: [2, 6], price: 40, info: { en: 'Some keys are missing. More will be.', it: 'Mancano dei tasti. Ne mancheranno altri.' } },
        { id: 'mouse', cat: 'weapon', to: 22, name: { en: 'Corded Mouse', it: 'Mouse con il filo' }, dmg: [2, 7], acc: -1, price: 55, from: 2, info: { en: 'Swung around, it’s a serious weapon.', it: 'Fatto roteare, è un’arma seria.' } },
        { id: 'saldatore', cat: 'weapon', to: 26, name: { en: 'Soldering Iron', it: 'Saldatore' }, dmg: [3, 8], price: 80, from: 3, info: { en: 'Still hot.', it: 'Ancora caldo.' } },
        { id: 'meccanica', cat: 'weapon', to: 30, name: { en: 'Mechanical Keyboard', it: 'Tastiera meccanica' }, dmg: [3, 10], price: 120, from: 4, info: { en: 'Blue switches. Three classrooms away can hear it.', it: 'Switch blu. La sentono tre aule più in là.' } },
        { id: 'router', cat: 'weapon', to: 38, name: { en: 'Router', it: 'Router' }, dmg: [4, 11], acc: -1, price: 150, from: 5, w: 6, info: { en: 'Heavy, with antennas. Hits hard but is awkward.', it: 'Pesante, con le antenne. Colpisce forte ma è scomodo.' } },
        // ── protezioni
        { id: 'maglietta', cat: 'armor', to: 10, name: { en: 'T-shirt', it: 'Maglietta' }, def: 1, price: 15, info: { en: 'The one from the school trip.', it: 'Quella della gita.' } },
        { id: 'felpa', cat: 'armor', to: 16, name: { en: 'Sweatshirt', it: 'Felpa' }, def: 2, price: 35, info: { en: 'Keeps you warm and cushions the blows.', it: 'Tiene caldo e attutisce.' } },
        { id: 'badge', cat: 'armor', to: 20, name: { en: 'Lanyard with Badge', it: 'Laccetto con badge' }, def: 1, dodge: 2, price: 45, info: { en: 'Light: you dodge better.', it: 'Leggero: schivi meglio.' } },
        { id: 'cappuccio', cat: 'armor', to: 26, name: { en: 'Hoodie', it: 'Felpa col cappuccio' }, def: 3, price: 70, from: 2, info: { en: 'Hood up and nobody sees you. Almost.', it: 'Col cappuccio su non ti vede nessuno. Quasi.' } },
        { id: 'antistatico', cat: 'armor', to: 34, name: { en: 'Antistatic Vest', it: 'Giubbotto antistatico' }, def: 4, price: 110, from: 4, info: { en: 'The real technician look.', it: 'Da tecnico vero.' } },
        { id: 'zaino', cat: 'armor', to: 42, name: { en: 'Backpack Full of Books', it: 'Zaino pieno di libri' }, def: 5, dodge: -1, price: 140, from: 5, w: 6, info: { en: 'A suit of armor. Weighs as much as one.', it: 'Una corazza. Pesa come una corazza.' } },
        // ── oggetti da lancio (tocca l'icona nella barra rapida, poi la casella dove lanciare)
        { id: 'dardi', cat: 'throw', to: 25, name: { en: 'Darts', it: 'Dardi da freccette' }, dmg: [2, 5], price: 12, w: 12, info: { en: 'Thrown from afar (6 tiles). Sometimes you can pick them back up.', it: 'Si lanciano da lontano (6 caselle). A volte si recuperano.' } },
        { id: 'cd', cat: 'throw', to: 18, name: { en: 'Scratched CD', it: 'CD graffiato' }, dmg: [1, 4], price: 8, w: 10, info: { en: 'Useless for listening, great for throwing.', it: 'Inutile per ascoltare, ottimo da lanciare.' } },
        { id: 'taglierino', cat: 'throw', to: 36, name: { en: 'Box Cutter', it: 'Taglierino' }, dmg: [3, 6], price: 25, from: 2, w: 7, info: { en: 'Thrown from afar; hurts more than a dart.', it: 'Si lancia da lontano e fa più male di un dardo.' } },
        // ── cibo
        { id: 'merendina', cat: 'food', name: { en: 'Snack Cake', it: 'Merendina' }, food: 350, price: 10, w: 14, info: { en: 'From the vending machine.', it: 'Dal distributore.' } },
        { id: 'mela', cat: 'food', name: { en: 'Apple', it: 'Mela' }, food: 250, price: 8, info: { en: 'Somebody actually brought it.', it: 'Qualcuno l’ha portata davvero.' } },
        { id: 'panino', cat: 'food', name: { en: 'Sandwich', it: 'Panino' }, food: 700, price: 20, info: { en: 'Made by mom. Keeps you full for a long time.', it: 'Della mamma. Sazia a lungo.' } },
        { id: 'pizzetta', cat: 'food', name: { en: 'Mini Pizza', it: 'Pizzetta' }, food: 500, price: 15, from: 2, info: { en: 'Cold, but it’s pizza.', it: 'Fredda, ma è pizza.' } },
        // ── lattine (bibite energetiche): sconosciute finché non le bevi
        { id: 'd_cura', cat: 'drink', name: { en: 'Energy Drink', it: 'Energy drink' }, effect: 'heal', power: 45, price: 30, w: 26, info: { en: 'Restores energy (HP).', it: 'Ridà energia (vita).' } },
        { id: 'd_cura2', cat: 'drink', name: { en: 'Double Energy Drink', it: 'Energy drink doppio' }, effect: 'heal', power: 100, price: 70, from: 3, w: 8, info: { en: 'Restores all your HP.', it: 'Ridà tutta la vita.' } },
        { id: 'd_forza', cat: 'drink', name: { en: 'Vanilla Protein Shake', it: 'Proteine alla vaniglia' }, effect: 'strength', power: 1, price: 90, w: 4, info: { en: 'Attack +1 forever.', it: 'Attacco +1 per sempre.' } },
        { id: 'd_vita', cat: 'drink', name: { en: 'Multivitamin Juice', it: 'Succo multivitaminico' }, effect: 'life', power: 5, price: 90, w: 4, info: { en: 'Max HP +5 forever.', it: 'Vita massima +5 per sempre.' } },
        { id: 'd_scaduta', cat: 'drink', to: 35, name: { en: 'Expired Can', it: 'Lattina scaduta' }, effect: 'poison', power: 8, price: 10, w: 7, info: { en: 'From 2011. Hurts for a few turns.', it: 'Del 2011. Fa male per qualche turno.' } },
        { id: 'd_veloce', cat: 'drink', name: { en: 'Triple Espresso', it: 'Caffè triplo' }, effect: 'haste', power: 20, price: 50, w: 7, info: { en: 'For a while you get two moves per turn.', it: 'Per un po’ fai due mosse a turno.' } },
        { id: 'd_zucchero', cat: 'drink', to: 35, name: { en: 'Too Much Sugar', it: 'Troppo zucchero' }, effect: 'confuse', power: 10, price: 10, w: 6, info: { en: 'You stumble around at random for a few turns.', it: 'Cammini a caso per qualche turno.' } },
        { id: 'd_invis', cat: 'drink', name: { en: 'Still Water', it: 'Acqua liscia' }, effect: 'invis', power: 25, price: 50, w: 5, info: { en: 'So plain that nobody notices you.', it: 'Così anonima che non ti nota nessuno.' } },
        { id: 'd_xp', cat: 'drink', name: { en: 'Teacher’s Tea', it: 'Tè del prof' }, effect: 'xp', price: 100, w: 3, info: { en: 'Level up instantly.', it: 'Sali subito di un livello.' } },
        { id: 'd_regen', cat: 'drink', name: { en: 'Chamomile', it: 'Camomilla' }, effect: 'regen', power: 30, price: 40, w: 6, info: { en: 'You recover HP every turn for a while.', it: 'Recuperi vita a ogni turno per un po’.' } },
        // ── script: sconosciuti finché non li lanci
        { id: 's_cd', cat: 'script', name: { en: 'cd /random', it: 'cd /a/caso' }, effect: 'teleport', price: 30, w: 12, info: { en: 'Moves you to a random spot on the floor.', it: 'Ti sposta in un punto a caso del piano.' } },
        { id: 's_ls', cat: 'script', name: { en: 'ls -R', it: 'ls -R' }, effect: 'map', price: 40, w: 9, info: { en: 'Shows the floor map, secret doors included.', it: 'Mostra la mappa del piano, porte segrete comprese.' } },
        { id: 's_man', cat: 'script', name: { en: 'man', it: 'man' }, effect: 'identify', price: 30, w: 10, info: { en: 'You identify everything in your bag.', it: 'Riconosci tutto quello che hai nello zaino.' } },
        { id: 's_chmod', cat: 'script', name: { en: 'chmod +x', it: 'chmod +x' }, effect: 'enchW', price: 80, w: 7, info: { en: 'The weapon you hold becomes +1.', it: 'L’arma che impugni diventa +1.' } },
        { id: 's_ufw', cat: 'script', name: { en: 'ufw enable', it: 'ufw enable' }, effect: 'enchA', price: 80, w: 7, info: { en: 'The armor you wear becomes +1.', it: 'La protezione che indossi diventa +1.' } },
        { id: 's_sudo', cat: 'script', name: { en: 'sudo', it: 'sudo' }, effect: 'fear', power: 12, price: 45, w: 8, info: { en: 'Enemies you can see run away: you have the permissions.', it: 'I nemici che vedi scappano: hai i permessi.' } },
        { id: 's_rm', cat: 'script', name: { en: 'rm -rf', it: 'rm -rf' }, effect: 'fire', power: 8, price: 70, w: 6, info: { en: 'Hits every enemy you can see.', it: 'Colpisce tutti i nemici che vedi.' } },
        { id: 's_fork', cat: 'script', name: { en: 'fork()', it: 'fork()' }, effect: 'summon', power: 2, price: 10, w: 5, info: { en: 'Enemies appear. You should not have run it.', it: 'Compaiono dei nemici. Non andava lanciato.' } },
        { id: 's_sleep', cat: 'script', name: { en: 'sleep 10', it: 'sleep 10' }, effect: 'sleep', power: 10, price: 45, w: 8, info: { en: 'Enemies you can see fall asleep.', it: 'I nemici che vedi si addormentano.' } },
        { id: 's_apt', cat: 'script', name: { en: 'apt upgrade', it: 'apt upgrade' }, effect: 'recharge', power: 3, price: 60, w: 5, info: { en: 'Recharges your USB sticks.', it: 'Ricarica le chiavette USB.' } },
        { id: 's_ping', cat: 'script', name: { en: 'ping', it: 'ping' }, effect: 'ping', power: 30, price: 25, w: 8, info: { en: 'For a while you can see every enemy on the floor.', it: 'Per un po’ vedi tutti i nemici del piano.' } },
        { id: 's_grep', cat: 'script', name: { en: 'grep -r', it: 'grep -r' }, effect: 'grep', price: 25, w: 8, info: { en: 'Finds the floor’s traps and secret doors.', it: 'Trova trappole e porte segrete del piano.' } },
        // ── chiavette USB: colpiscono il nemico più vicino che vedi
        { id: 'u_exploit', cat: 'usb', name: { en: 'exploit.exe', it: 'exploit.exe' }, effect: 'bolt', power: 7, ch: 5, price: 70, info: { en: 'A long-range hit.', it: 'Un colpo a distanza.' } },
        { id: 'u_volt', cat: 'usb', name: { en: 'USB killer', it: 'USB killer' }, effect: 'bolt', power: 14, ch: 3, price: 120, from: 4, w: 5, info: { en: 'A very strong long-range hit.', it: 'Un colpo a distanza molto forte.' } },
        { id: 'u_freeze', cat: 'usb', name: { en: 'freeze.sys', it: 'freeze.sys' }, effect: 'freeze', power: 6, ch: 4, price: 70, w: 7, info: { en: 'The enemy is stuck in place for a few turns.', it: 'Il nemico resta bloccato per qualche turno.' } },
        { id: 'u_mv', cat: 'usb', name: { en: 'mv /dev/null', it: 'mv /dev/null' }, effect: 'banish', ch: 4, price: 60, w: 7, info: { en: 'Moves the enemy away from you.', it: 'Sposta il nemico lontano da te.' } },
        { id: 'u_lag', cat: 'usb', name: { en: 'lag.dll', it: 'lag.dll' }, effect: 'slow', ch: 5, price: 50, w: 7, info: { en: 'The enemy moves at half speed.', it: 'Il nemico va a metà velocità.' } },
        { id: 'u_leak', cat: 'usb', name: { en: 'Data leak', it: 'Data leak' }, effect: 'drain', power: 6, ch: 4, price: 90, from: 3, w: 5, info: { en: 'Drains HP from the enemy and gives it to you.', it: 'Toglie vita al nemico e la dà a te.' } },
        // ── plugin (uno alla volta): sconosciuti finché non li installi
        { id: 'p_antivirus', cat: 'plugin', w: 4, name: { en: 'Antivirus', it: 'Antivirus' }, mod: { def: 2 }, price: 100, info: { en: 'Defense +2.', it: 'Difesa +2.' } },
        { id: 'p_overclock', cat: 'plugin', w: 4, name: { en: 'Overclock', it: 'Overclock' }, mod: { atk: 2 }, price: 100, info: { en: 'Attack +2.', it: 'Attacco +2.' } },
        { id: 'p_autosave', cat: 'plugin', w: 4, name: { en: 'Autosave', it: 'Salvataggio automatico' }, mod: { regen: 2 }, price: 100, info: { en: 'You recover HP faster.', it: 'Recuperi vita più in fretta.' } },
        { id: 'p_risparmio', cat: 'plugin', w: 4, name: { en: 'Power Saver', it: 'Risparmio energetico' }, mod: { hunger: 50 }, price: 80, info: { en: 'Hunger comes at half speed.', it: 'La fame arriva a metà velocità.' } },
        { id: 'p_dark', cat: 'plugin', w: 4, name: { en: 'Dark Mode', it: 'Dark mode' }, mod: { dodge: 3 }, price: 90, info: { en: 'Dodge +3.', it: 'Schivata +3.' } },
        { id: 'p_adblock', cat: 'plugin', w: 4, name: { en: 'AdBlock', it: 'AdBlock' }, mod: { search: 40, sight: 1 }, price: 80, info: { en: 'You see further and find traps and secret doors.', it: 'Vedi più lontano e trovi trappole e porte segrete.' } },
        { id: 'p_cache', cat: 'plugin', w: 4, name: { en: 'Cache', it: 'Cache' }, mod: { crit: 12, acc: 1 }, price: 90, info: { en: 'More critical hits.', it: 'Più colpi critici.' } },
        { id: 'p_backup', cat: 'plugin', w: 4, name: { en: 'Backup', it: 'Backup' }, mod: { vamp: 25 }, price: 110, from: 3, info: { en: 'Sometimes a hit that lands heals you.', it: 'A volte un colpo andato a segno ti ridà vita.' } },

        // ───────────────────────────────────────────────────────────────────────────────────────────────────────────
        // More items. Written with the short helpers above (W weapon, A armour, I anything else); `from`/`to` are floors (sector n starts at floor 5n-4).
        // `from: 99` = never found on the floor: a mini-boss leaves it (see `drop` in mobs.js).
        // ── armi per settore (poi gli unici: danno, colpi critici, mira o danno ai non-morti; nient'altro che il motore sa fare)
        W('w_compasso', 'Compass', 'Compasso', [1, 5], 1, 9, 'Pointy end first. A few more critical hits.', 'Punta in avanti. Qualche colpo critico in più.', { crit: 10 }),
        W('w_squadra', 'Set Square', 'Squadra', [2, 5], 1, 10, 'Triangular and surprisingly accurate.', 'Triangolare e sorprendentemente precisa.', { acc: 2 }),
        W('w_alimentatore', 'Power Supply Brick', 'Alimentatore', [3, 9], 6, 18, 'A laptop charger on a long cable. Heavy at the end.', 'Un carica-portatile con il cavo lungo. Pesante in fondo.'),
        W('w_ventola', 'Case Fan', 'Ventola da case', [2, 8], 6, 18, 'Light and quick to swing.', 'Leggera e svelta da menare.', { acc: 2, crit: 8 }),
        W('w_manuale', 'Server Manual', 'Manuale del server', [4, 9], 7, 19, 'Eight hundred pages of rules. Ghosts hate rules.', 'Ottocento pagine di regole. I fantasmi odiano le regole.', { holy: 1 }),
        W('w_taglia', 'Cable Cutter', 'Tronchese', [5, 12], 11, 24, 'Snip. Snip. Mostly on the critical spots.', 'Zac. Zac. Soprattutto sui punti critici.', { crit: 12 }),
        W('w_scala', 'Aluminium Ladder', 'Scala di alluminio', [6, 13], 11, 24, 'Long and clumsy, but it hits like a wall.', 'Lunga e scomoda, ma colpisce come un muro.', { acc: -2 }),
        W('w_torcia', 'Heavy Flashlight', 'Torcia pesante', [5, 11], 12, 26, 'Dazzles them first, then hits.', 'Prima li abbaglia, poi colpisce.', { acc: 2 }),
        W('w_switch', 'Rack Switch', 'Switch da rack', [7, 15], 16, 30, 'Forty-eight ports and none of them is a handle.', 'Quarantotto porte e nessuna è un manico.', { acc: -1 }),
        W('w_patch', 'Patch Cord Flail', 'Flagello di patch', [6, 16], 16, 30, 'A bundle of patch cords on a stick. Wild swings.', 'Un fascio di patch su un bastone. Colpi selvaggi.', { crit: 10 }),
        W('w_antenna', 'Antenna Whip', 'Frusta d’antenna', [6, 14], 17, 32, 'Long, thin and very precise.', 'Lunga, sottile e molto precisa.', { acc: 2 }),
        W('w_faldone', 'Ring Binder', 'Raccoglitore ad anelli', [8, 17], 21, 34, 'Four rings, one big bruise.', 'Quattro anelli, un grosso livido.'),
        W('w_pinzatrice', 'Industrial Stapler', 'Pinzatrice industriale', [7, 17], 21, 36, 'It staples. To anything.', 'Pinza. Qualunque cosa.', { crit: 15 }),
        W('w_perforatore', 'Hole Punch', 'Perforatore', [8, 16], 22, 36, 'Two precise holes every time.', 'Due buchi precisi ogni volta.', { acc: 2 }),
        W('w_lama', 'Server Blade', 'Lama server', [9, 19], 26, 40, 'A hot-swappable sword. Please keep it plugged in.', 'Una spada sostituibile a caldo. Tienila collegata.'),
        W('w_bobina', 'Fibre Spool', 'Bobina di fibra', [8, 20], 26, 42, 'Unwinds into a very sharp line.', 'Si srotola in una linea affilatissima.', { crit: 12 }),
        W('w_incudine', 'Cloud Anvil', 'Incudine del cloud', [10, 19], 27, 42, 'Light as a cloud, until it lands.', 'Leggera come una nuvola, finché non cade.', { acc: -2 }),
        W('w_ascia', 'Packet Axe', 'Ascia di pacchetti', [10, 22], 31, 46, 'Splits the data stream right in two.', 'Divide in due il flusso di dati.'),
        W('w_martelletto', 'ACL Gavel', 'Martelletto ACL', [11, 21], 31, 47, 'Order in the network. Undead hate it.', 'Ordine nella rete. I non-morti lo odiano.', { holy: 2 }),
        W('w_regolamento', 'Rulebook Hammer', 'Martello del regolamento', [10, 23], 32, 50, 'Page after page after page. Lands slowly.', 'Pagina dopo pagina dopo pagina. Cala lento.', { acc: -2 }),
        W('w_lancia', 'Thread Spear', 'Lancia dei thread', [11, 24], 36, 50, 'Many threads, one point.', 'Tanti thread, una sola punta.', { acc: 1 }),
        W('w_maglio', 'Kernel Mallet', 'Maglio del kernel', [12, 24], 36, 50, 'The most privileged hit in the building.', 'Il colpo più privilegiato dell’edificio.'),
        W('w_frusta', 'Interrupt Whip', 'Frusta degli interrupt', [10, 22], 37, 50, 'Cracks right when it hurts the most.', 'Schiocca proprio quando fa più male.', { crit: 15 }),
        W('w_tranciaschede', 'Punch Card Cutter', 'Tranciaschede', [12, 26], 41, 50, 'Cuts anything into neat little rectangles.', 'Taglia tutto in ordinati rettangolini.', { crit: 12 }),
        W('w_flagello', 'Tape Reel Flail', 'Flagello a bobina', [13, 25], 41, 50, 'A heavy reel that never stops spinning.', 'Una bobina pesante che non smette di girare.'),
        W('w_valvola', 'Vacuum Tube Rod', 'Asta a valvola', [11, 24], 42, 50, 'Glows warm and hits straight.', 'Brilla calda e colpisce dritta.', { acc: 2 }),
        W('w_lamaroot', 'Root Shell Blade', 'Lama della shell root', [14, 28], 46, 50, 'Cuts through every permission.', 'Taglia ogni permesso.'),
        W('w_martellosudo', 'Sudo Hammer', 'Martello sudo', [15, 27], 46, 50, 'Because I said so, with the maximum privileges.', 'Perché lo dico io, con il massimo dei privilegi.', { acc: -1 }),
        W('w_scettro', 'Admin Scepter', 'Scettro dell’admin', [13, 26], 46, 50, 'Heavy is the hand that holds the keys.', 'Pesa la mano che tiene le chiavi.', { crit: 15 }),
        // ── armi uniche (rare)
        W('w_gessetto', 'Teacher’s Chalk', 'Gessetto del prof', [2, 5], 1, 12, 'Squeaks. Never misses the board, or you.', 'Stride. Non sbaglia mai la lavagna, né te.', { acc: 3, crit: 10, w: 3 }),
        W('w_forbici', 'Safety Scissors', 'Forbici a punta tonda', [3, 9], 3, 14, 'Rounded tips. Somehow it is still a crime.', 'Punta tonda. In qualche modo è comunque un crimine.', { crit: 18, w: 3 }),
        W('w_bacchetta', 'Pointer Stick', 'Bacchetta della lavagna', [3, 8], 4, 18, 'Extendable. Points out your mistakes.', 'Allungabile. Ti indica gli errori.', { acc: 3, w: 3 }),
        W('w_laser', 'Laser Pointer', 'Puntatore laser', [4, 9], 12, 24, 'Red dot, exact aim and cat-level hate.', 'Puntino rosso, mira esatta e odio da gatto.', { acc: 5, crit: 20, w: 2 }),
        W('w_registro', 'Heavy Class Register', 'Registro di classe', [6, 13], 8, 26, 'Everything you did is written inside.', 'Dentro c’è scritto tutto quello che hai fatto.', { holy: 3, w: 3 }),
        W('w_campanella', 'Brass Hand Bell', 'Campanella d’ottone', [5, 11], 10, 28, 'Ring it and the dead remember school hours.', 'Suonala e i morti ricordano l’orario scolastico.', { holy: 4, w: 3 }),
        W('w_ctrl', 'Ctrl+Alt+Del', 'Ctrl+Alt+Canc', [7, 15], 14, 34, 'Three keys at once. Restarts the enemy.', 'Tre tasti insieme. Riavvia il nemico.', { crit: 25, w: 2 }),
        W('w_cavo5', 'Cat 8 Whip', 'Frusta Cat 8', [6, 18], 16, 36, 'Forty gigabits of stinging.', 'Quaranta gigabit di bruciore.', { acc: 2, w: 3 }),
        W('w_nunchaku', 'Cable Nunchucks', 'Nunchaku di cavi', [8, 18], 18, 40, 'Two cable ties. Many bruises.', 'Due fascette. Molti lividi.', { acc: 2, crit: 8, w: 3 }),
        W('w_exorcist', 'Exorcist Router', 'Router esorcista', [8, 17], 20, 44, 'A blessed antenna. It rattles ghosts.', 'Un’antenna benedetta. Fa tremare i fantasmi.', { holy: 6, w: 2 }),
        W('w_katana', 'Fibre-Optic Katana', 'Katana a fibra ottica', [9, 19], 22, 46, 'Glows. Cuts. Looks great in the dark.', 'Brilla. Taglia. Sta benissimo al buio.', { crit: 22, w: 2 }),
        W('w_rack', 'Rack Rail Lance', 'Lancia da guida rack', [10, 21], 24, 50, 'A metal rail with a very sharp end.', 'Una guida di metallo con la punta affilata.', { acc: 1, w: 3 }),
        W('w_mazza', 'Deprecated Sledge', 'Mazza deprecata', [11, 22], 26, 50, 'Obsolete, but it still hurts.', 'Obsoleta, ma fa ancora male.', { acc: -3, w: 3 }),
        W('w_defrag', 'Defrag Pole', 'Asta di deframmentazione', [9, 20], 28, 50, 'Puts every hit in a tidy row.', 'Mette ogni colpo in fila ordinata.', { acc: 3, w: 3 }),
        W('w_diskaxe', 'Hard Disk Axe', 'Ascia di hard disk', [10, 22], 30, 50, 'Platters spinning at 7200 rpm. Ouch.', 'Piatti a 7200 giri al minuto. Ahi.', { crit: 15, w: 3 }),
        W('w_firewall', 'Firewall Paddle', 'Racchetta del firewall', [11, 23], 32, 50, 'Blocks and bashes. The undead bounce.', 'Para e colpisce. I non-morti rimbalzano.', { acc: -1, holy: 3, w: 2 }),
        W('w_quantum', 'Quantum Sword', 'Spada quantistica', [12, 26], 40, 50, 'Hits and misses at the same time. Mostly hits.', 'Colpisce e manca allo stesso tempo. Più che altro colpisce.', { crit: 25, holy: 2, w: 2 }),
        // armi lasciate dai mini-boss (non si trovano in giro)
        W('w_incisivo', 'Rat King’s Incisor', 'Incisivo del Re dei Ratti', [3, 7], 99, 99, 'Sharp enough to chew any cable. Fast to bite.', 'Affilato da rosicchiare qualunque cavo. Morde in fretta.', { crit: 20 }),
        W('w_crimpatore', 'Foreman’s Crimper', 'Crimpatrice del caposquadra', [6, 14], 99, 99, 'Squeezes until it clicks, then keeps squeezing.', 'Stringe fino al clic, poi continua a stringere.', { crit: 10, acc: 1 }),
        W('w_timbro', 'Archivist’s Stamp', 'Timbro dell’archivista', [7, 15], 99, 99, 'Stamps “VOID” on ghosts, in triplicate.', 'Timbra “ANNULLATO” sui fantasmi, in triplice copia.', { holy: 4 }),
        W('w_banhammer', 'Ban Hammer', 'Martello del ban', [12, 22], 99, 99, 'One swing and you are off the list.', 'Un colpo e sei fuori dalla lista.', { acc: 1, holy: 2 }),
        W('w_chiave', 'Master Key', 'Chiave universale', [15, 30], 99, 99, 'Opens everything. Also skulls.', 'Apre tutto. Anche i crani.', { crit: 15, acc: 2 }),
        // ── protezioni per settore
        A('a_grembiule', 'Lab Apron', 'Grembiule da laboratorio', 2, 1, 1, 12, 'Stained with things best left unnamed.', 'Macchiato di cose meglio non nominare.'),
        A('a_kway', 'Rain Jacket', 'K-way', 3, 1, 6, 18, 'Waterproof. And a bit cable-proof.', 'Impermeabile. E un po’ anti-cavo.'),
        A('a_parka', 'Server Room Parka', 'Parka da sala server', 5, -1, 7, 20, 'Built for 16 degrees all year round.', 'Fatto per i 16 gradi tutto l’anno.'),
        A('a_imbracatura', 'Cable Harness', 'Imbracatura per cavi', 5, 1, 11, 24, 'Straps everywhere. Pockets for tools.', 'Cinghie ovunque. Tasche per gli attrezzi.'),
        A('a_gilet_sic', 'Safety Vest', 'Gilet di sicurezza', 6, 0, 12, 26, 'Bright yellow. Nobody can say they did not see you.', 'Giallo acceso. Nessuno può dire di non averti visto.'),
        A('a_faraday', 'Faraday Jacket', 'Giacca di Faraday', 7, 0, 16, 30, 'Lined with metal mesh. Zaps slide off.', 'Foderata di rete metallica. Le scosse scivolano via.'),
        A('a_piastra', 'Switch Plate Armor', 'Armatura a piastre di switch', 8, -1, 17, 32, 'Rack-mount plates and a few spare ports.', 'Piastre da rack e qualche porta di scorta.'),
        A('a_cardigan', 'Archivist Cardigan', 'Cardigan dell’archivista', 7, 2, 21, 34, 'Soft, grey and full of old coffee stains.', 'Morbido, grigio e pieno di vecchie macchie di caffè.'),
        A('a_corazza', 'Binder Cuirass', 'Corazza di faldoni', 9, -2, 22, 36, 'Forty years of paperwork, stacked and tied.', 'Quarant’anni di pratiche, impilate e legate.'),
        A('a_felpacloud', 'Cloud Hoodie', 'Felpa del cloud', 8, 2, 26, 40, 'Soft as a cloud, strong as a contract.', 'Morbida come una nuvola, forte come un contratto.'),
        A('a_container', 'Container Plate', 'Piastra container', 10, -1, 27, 42, 'A shipping container, worn in a pinch.', 'Un container da trasporto, indossato alla meglio.'),
        A('a_offerta', 'Bargain Jacket', 'Giacca in offerta', 7, 3, 28, 44, 'Last-minute price, last-second dodges.', 'Prezzo dell’ultimo minuto, schivate dell’ultimo secondo.'),
        A('a_acl', 'ACL Vest', 'Gilet ACL', 10, 1, 31, 46, 'Allow, deny, deny, deny.', 'Consenti, nega, nega, nega.'),
        A('a_drop', 'DROP Plate', 'Piastra DROP', 12, -2, 32, 50, 'Silently discards everything thrown at it.', 'Scarta in silenzio tutto quello che le arriva.'),
        A('a_mantello', 'Stealth Cloak', 'Mantello furtivo', 8, 4, 33, 50, 'Looks like a 404 page. Hard to hit.', 'Sembra una pagina 404. Difficile da colpire.'),
        A('a_maglia', 'Kernel Mail', 'Maglia del kernel', 12, 0, 36, 50, 'Every link a protected, privileged ring.', 'Ogni anello è protetto e privilegiato.'),
        A('a_maglietta_irq', 'Interrupt Jersey', 'Maglia a interrupt', 9, 4, 37, 50, 'Always moving, never where you aimed.', 'Sempre in movimento, mai dove hai mirato.'),
        A('a_guscio', 'Heavy Shell', 'Guscio pesante', 13, -2, 38, 50, 'You are the cargo now.', 'Ora il carico sei tu.'),
        A('a_grembiulemf', 'Mainframe Apron', 'Grembiule da mainframe', 12, 1, 41, 50, 'Smells of ozone and old punched cards.', 'Odora di ozono e vecchie schede perforate.'),
        A('a_valvole', 'Vacuum Tube Mail', 'Cotta di valvole', 14, 0, 42, 50, 'Warm to the touch. Gets warmer when hit.', 'Calda al tatto. Si scalda se la colpiscono.'),
        A('a_cappotto', 'Operator Coat', 'Cappotto da operatore', 11, 3, 43, 50, 'Lots of pockets, all full of punch cards.', 'Molte tasche, tutte piene di schede perforate.'),
        A('a_giaccaroot', 'Root Jacket', 'Giacca di root', 14, 2, 46, 50, 'The # on the back says it all.', 'Il # sulla schiena dice tutto.'),
        A('a_piastrasudo', 'Sudo Plate', 'Piastra sudo', 16, -2, 46, 50, 'It asks for no password. It simply does not move.', 'Non chiede password. Semplicemente non si sposta.'),
        A('a_vesteadmin', 'Admin Robe', 'Veste dell’admin', 13, 4, 47, 50, 'Flowing, mysterious, slightly too long.', 'Fluente, misteriosa, un po’ troppo lunga.'),
        // protezioni dei mini-boss
        A('a_gilet', 'Cooling Vest', 'Gilet refrigerante', 4, 2, 99, 99, 'Straight from the Thermostat. Pleasantly chilly.', 'Direttamente dal Termostato. Piacevolmente freddo.'),
        A('a_nuvola', 'Cloud Cloak', 'Mantello di nuvola', 9, 3, 99, 99, 'It floats. So do your problems.', 'Fluttua. Come i tuoi problemi.'),
        A('a_camice', 'Operator Lab Coat', 'Camice dell’operatore', 12, 2, 99, 99, 'Whose is it? It fits you perfectly.', 'Di chi è? Ti sta a pennello.'),
        // ── da lancio
        T('t_puntine', 'Thumbtacks', 'Puntine da disegno', [1, 3], 1, 14, 'A handful, thrown at the nearest enemy. Ouch.', 'Una manciata, lanciata al nemico più vicino. Ahi.'),
        T('t_rj45', 'RJ45 Plugs', 'Connettori RJ45', [2, 6], 3, 18, 'Tiny and clicky, and they hurt when thrown.', 'Piccoli e scattanti, e lanciati fanno male.'),
        T('t_floppy', 'Floppy Stars', 'Stelle di floppy', [3, 8], 4, 22, 'The corners of a floppy disk, folded into stars.', 'Gli angoli di un floppy, piegati a stella.'),
        T('t_toner', 'Toner Cartridge', 'Cartuccia di toner', [4, 9], 5, 26, 'Bursts on impact. Stains too.', 'Scoppia all’impatto. E macchia pure.'),
        T('t_piatto', 'Hard Disk Platter', 'Piatto di hard disk', [5, 11], 8, 34, 'A spinning mirror. Throw it flat.', 'Uno specchio che gira. Lancialo piatto.'),
        T('t_punch', 'Punch Cards', 'Schede perforate', [3, 7], 12, 40, 'Flat, light and full of holes.', 'Piatte, leggere e piene di buchi.'),
        T('t_cella', 'Lithium Cell', 'Cella al litio', [6, 13], 16, 44, 'Hot-headed, like most of the staff.', 'Testa calda, come buona parte del personale.'),
        T('t_dissipatore', 'Heat Sink', 'Dissipatore', [8, 15], 24, 50, 'Metal fins, hurled hard and fast.', 'Alette di metallo, lanciate forte e veloce.'),
        T('t_manuale', 'Thick Manual', 'Manuale spesso', [9, 17], 32, 50, 'Throw the book at them. Literally.', 'Gli tiri addosso il manuale. Letteralmente.'),
        // ── cibo
        F('f_crackers', 'Crackers', 'Cracker', 200, 1, 20, 'Salty and dry. Better than nothing.', 'Salati e secchi. Meglio di niente.'),
        F('f_banana', 'Banana', 'Banana', 280, 1, 30, 'Energy in a yellow wrapper.', 'Energia in un involucro giallo.'),
        F('f_yogurt', 'Yogurt', 'Yogurt', 300, 2, 30, 'Cold from the staff room fridge. Expiry unknown.', 'Freddo dal frigo della sala professori. Scadenza ignota.'),
        F('f_crostatina', 'Jam Tart', 'Crostatina', 400, 3, 40, 'Sweet, crumbly, ideal for a mid-lesson snack.', 'Dolce, friabile, ideale per lo spuntino a metà lezione.'),
        F('f_schiacciata', 'Flatbread', 'Schiacciata', 600, 4, 50, 'Olive oil and salt. Disappears too fast.', 'Olio e sale. Sparisce troppo in fretta.'),
        F('f_tramezzino', 'Triangle Sandwich', 'Tramezzino', 550, 5, 50, 'Crustless and mysteriously filled.', 'Senza crosta e farcito in modo misterioso.'),
        F('f_brioche', 'Brioche', 'Brioche', 450, 6, 50, 'The breakfast of the lucky few.', 'La colazione dei pochi fortunati.'),
        F('f_toast', 'Ham and Cheese Toast', 'Toast prosciutto e formaggio', 650, 8, 50, 'Hot from the school bar. Do not ask how.', 'Caldo dal bar della scuola. Non chiedere come.'),
        F('f_noodles', 'Cup Noodles', 'Noodles in tazza', 750, 10, 50, 'Just add hot water. Any hot water.', 'Basta aggiungere acqua calda. Una qualsiasi.'),
        F('f_insalata', 'Salad Box', 'Insalata nella vaschetta', 500, 12, 50, 'Healthy. Also strangely heavy.', 'Sana. E stranamente pesante.'),
        F('f_pranzo', 'Lunch Box', 'Pranzo al sacco', 1000, 15, 50, 'Pasta, fruit and a note: “eat everything”.', 'Pasta, frutta e un biglietto: “mangia tutto”.'),
        F('f_cioccolata', 'Hot Chocolate', 'Cioccolata calda', 380, 18, 50, 'From the vending machine. Burns the tongue.', 'Dal distributore. Brucia la lingua.'),
        // ── lattine (bibite): sconosciute finché non le bevi
        I('drink', 'd_mini', 'Mini Can', 'Lattina piccola', 'A small sip of energy (HP).', 'Un piccolo sorso di energia (vita).', { effect: 'heal', power: 25, price: 16, to: 14, w: 22 }),
        I('drink', 'd_cola', 'Cola', 'Cola', 'Fizzy and fast: restores some HP.', 'Frizzante e veloce: ridà un po’ di vita.', { effect: 'heal', power: 35, price: 24, to: 26, w: 14 }),
        I('drink', 'd_smoothie', 'Fruit Smoothie', 'Frullato di frutta', 'Restores plenty of HP and tastes great.', 'Ridà molta vita e ha un buon sapore.', { effect: 'heal', power: 60, price: 45, from: 6, w: 12 }),
        I('drink', 'd_max', 'Super Energy Max', 'Super Energy Max', 'Restores almost all your HP.', 'Ridà quasi tutta la vita.', { effect: 'heal', power: 80, price: 60, from: 12, w: 8 }),
        I('drink', 'd_forza2', 'Creatine Shake', 'Frullato di creatina', 'Rare: attack +2 forever.', 'Raro: attacco +2 per sempre.', { effect: 'strength', power: 2, price: 200, from: 14, w: 1 }),
        I('drink', 'd_vita2', 'Mega Multivitamin', 'Multivitaminico mega', 'Rare: max HP +10 forever.', 'Raro: vita massima +10 per sempre.', { effect: 'life', power: 10, price: 200, from: 12, w: 1 }),
        I('drink', 'd_veloce2', 'Double Espresso', 'Caffè doppio', 'A short burst of extra moves.', 'Una breve raffica di mosse in più.', { effect: 'haste', power: 10, price: 30, to: 30, w: 8 }),
        I('drink', 'd_veloce3', 'Cold Brew', 'Caffè freddo', 'A long stretch of extra moves.', 'Un lungo periodo di mosse in più.', { effect: 'haste', power: 40, price: 80, from: 10, w: 3 }),
        I('drink', 'd_regen2', 'Mint Tea', 'Tè alla menta', 'You recover HP every turn for a long while.', 'Recuperi vita a ogni turno per molto tempo.', { effect: 'regen', power: 60, price: 70, from: 6, w: 4 }),
        I('drink', 'd_invis2', 'Fog Smoothie', 'Frullato di nebbia', 'Nobody sees you for a long while.', 'Nessuno ti vede per molto tempo.', { effect: 'invis', power: 45, price: 90, from: 10, w: 2 }),
        I('drink', 'd_acida', 'Sour Milk', 'Latte acido', 'Past its date. You will feel it for a while.', 'Scaduto. Lo sentirai per un po’.', { effect: 'poison', power: 14, price: 8, w: 5 }),
        I('drink', 'd_mistero', 'Mystery Soda', 'Bibita misteriosa', 'No label. You walk around in circles for a while.', 'Senza etichetta. Giri in tondo per un po’.', { effect: 'confuse', power: 20, price: 8, w: 5 }),
        I('drink', 'd_xp2', 'Honours Tea', 'Tè dell’eccellenza', 'Rare: level up instantly.', 'Raro: sali subito di un livello.', { effect: 'xp', price: 150, from: 12, w: 1 }),
        I('drink', 'd_fuoco', 'Spicy Cola', 'Cola piccante', 'Burns every enemy you can see.', 'Brucia tutti i nemici che vedi.', { effect: 'fire', power: 7, price: 55, from: 4, w: 4 }),
        I('drink', 'd_calma', 'Chill Tea', 'Tè rilassante', 'Enemies you can see doze off.', 'I nemici che vedi si appisolano.', { effect: 'sleep', power: 8, price: 50, from: 4, w: 4 }),
        I('drink', 'd_coraggio', 'Bravery Shot', 'Shottino di coraggio', 'Enemies you can see run away for a while.', 'I nemici che vedi scappano per un po’.', { effect: 'fear', power: 8, price: 45, from: 4, w: 4 }),
        I('drink', 'd_radar', 'Radar Mint', 'Menta radar', 'For a while you can see every enemy on the floor.', 'Per un po’ vedi tutti i nemici del piano.', { effect: 'ping', power: 20, price: 35, from: 3, w: 4 }),
        // ── script
        I('script', 's_tail', 'tail -f', 'tail -f', 'You can see every enemy on the floor for a long time.', 'Vedi tutti i nemici del piano per molto tempo.', { effect: 'ping', power: 60, price: 45, from: 6, w: 5 }),
        I('script', 's_rmfile', 'rm file.txt', 'rm file.txt', 'Hits every enemy you can see, a little.', 'Colpisce poco tutti i nemici che vedi.', { effect: 'fire', power: 4, price: 25, to: 20, w: 8 }),
        I('script', 's_killall', 'killall', 'killall', 'Hits every enemy you can see, hard.', 'Colpisce forte tutti i nemici che vedi.', { effect: 'fire', power: 12, price: 90, from: 8, w: 5 }),
        I('script', 's_rmrf2', 'rm -rf /*', 'rm -rf /*', 'Hits every enemy you can see, very hard.', 'Colpisce fortissimo tutti i nemici che vedi.', { effect: 'fire', power: 22, price: 140, from: 16, w: 3 }),
        I('script', 's_nohup', 'nohup', 'nohup', 'Nobody sees you for a while.', 'Nessuno ti vede per un po’.', { effect: 'invis', power: 20, price: 45, from: 2, w: 6 }),
        I('script', 's_screen', 'screen', 'screen', 'You get two moves per turn for a while.', 'Per un po’ fai due mosse a turno.', { effect: 'haste', power: 15, price: 50, from: 3, w: 6 }),
        I('script', 's_cron', 'crontab -e', 'crontab -e', 'You recover HP every turn for a while.', 'Recuperi vita a ogni turno per un po’.', { effect: 'regen', power: 40, price: 55, from: 3, w: 6 }),
        I('script', 's_revert', 'git revert', 'git revert', 'Undo the damage: restores some HP.', 'Annulla i danni: ridà un po’ di vita.', { effect: 'heal', power: 40, price: 45, w: 7 }),
        I('script', 's_restart', 'systemctl restart', 'systemctl restart', 'Back from the dead: restores most of your HP.', 'Resuscitato: ridà quasi tutta la vita.', { effect: 'heal', power: 75, price: 80, from: 8, w: 4 }),
        I('script', 's_fsck', 'fsck', 'fsck', 'A quick repair: restores a few HP.', 'Una riparazione veloce: ridà un po’ di vita.', { effect: 'heal', power: 20, price: 20, to: 16, w: 8 }),
        I('script', 's_yes', 'yes', 'yes', 'It never stops. Neither do you: you stumble about.', 'Non si ferma mai. Neanche tu: barcolli in giro.', { effect: 'confuse', power: 12, price: 5, w: 4 }),
        I('script', 's_dd', 'dd if=/dev/zero', 'dd if=/dev/zero', 'Overwrites your energy: you feel sick for a while.', 'Sovrascrive la tua energia: stai male per un po’.', { effect: 'poison', power: 10, price: 5, w: 4 }),
        I('script', 's_forkbomb', ':(){ :|:& };:', ':(){ :|:& };:', 'Many enemies appear at once. Why would you?', 'Compaiono molti nemici insieme. Chi te lo fa fare?', { effect: 'summon', power: 4, price: 10, from: 5, w: 3 }),
        I('script', 's_sudosu', 'sudo su', 'sudo su', 'Enemies you can see flee for a long time.', 'I nemici che vedi scappano a lungo.', { effect: 'fear', power: 25, price: 90, from: 8, w: 4 }),
        I('script', 's_shutdown', 'shutdown -h now', 'shutdown -h now', 'Enemies you can see sleep for a long time.', 'I nemici che vedi dormono a lungo.', { effect: 'sleep', power: 25, price: 90, from: 6, w: 4 }),
        I('script', 's_pip', 'pip install', 'pip install', 'Recharges your USB sticks a lot.', 'Ricarica molto le chiavette USB.', { effect: 'recharge', power: 6, price: 90, from: 8, w: 3 }),
        I('script', 's_distup', 'apt dist-upgrade', 'apt dist-upgrade', 'Rare: attack +1 forever.', 'Raro: attacco +1 per sempre.', { effect: 'strength', power: 1, price: 140, from: 10, w: 1 }),
        I('script', 's_useradd', 'useradd', 'useradd', 'Rare: max HP +6 forever.', 'Raro: vita massima +6 per sempre.', { effect: 'life', power: 6, price: 140, from: 10, w: 1 }),
        I('script', 's_commit', 'git commit', 'git commit', 'Rare: level up instantly.', 'Raro: sali subito di un livello.', { effect: 'xp', price: 130, from: 10, w: 1 }),
        I('script', 's_find', 'find / -name', 'find / -name', 'Shows the floor map and finds all traps.', 'Mostra la mappa del piano e trova tutte le trappole.', { effect: 'grep', price: 55, from: 3, w: 5 }),
        // ── chiavette USB (colpiscono il nemico più vicino che vedi)
        I('usb', 'u_ping', 'ping.exe', 'ping.exe', 'A weak ranged hit, but many charges.', 'Un debole colpo a distanza, ma con molte cariche.', { effect: 'bolt', power: 4, ch: 7, price: 45, to: 20, w: 8 }),
        I('usb', 'u_worm', 'worm.exe', 'worm.exe', 'A solid ranged hit.', 'Un solido colpo a distanza.', { effect: 'bolt', power: 10, ch: 4, price: 95, from: 6, w: 6 }),
        I('usb', 'u_ransom', 'ransom.exe', 'ransom.exe', 'A heavy ranged hit. Pay up.', 'Un colpo a distanza pesante. Pagare, prego.', { effect: 'bolt', power: 18, ch: 3, price: 170, from: 11, w: 4 }),
        I('usb', 'u_rootkit', 'rootkit.sys', 'rootkit.sys', 'The biggest ranged hit there is.', 'Il più grande colpo a distanza che esista.', { effect: 'bolt', power: 26, ch: 2, price: 240, from: 20, w: 2 }),
        I('usb', 'u_deepfreeze', 'deepfreeze.sys', 'deepfreeze.sys', 'The enemy is stuck for a long while.', 'Il nemico resta bloccato a lungo.', { effect: 'freeze', power: 12, ch: 3, price: 110, from: 6, w: 4 }),
        I('usb', 'u_throttle', 'throttle.dll', 'throttle.dll', 'The enemy slows down. Lots of charges.', 'Il nemico rallenta. Molte cariche.', { effect: 'slow', ch: 7, price: 60, w: 5 }),
        I('usb', 'u_vampire', 'vampire.exe', 'vampire.exe', 'Drains a lot of HP from the enemy.', 'Toglie molta vita al nemico.', { effect: 'drain', power: 10, ch: 3, price: 150, from: 7, w: 3 }),
        I('usb', 'u_leech', 'leech.bin', 'leech.bin', 'Drains a little HP from the enemy, often.', 'Toglie poca vita al nemico, spesso.', { effect: 'drain', power: 4, ch: 6, price: 80, from: 2, w: 5 }),
        I('usb', 'u_molotov', 'molotov.bat', 'molotov.bat', 'Burns every enemy you can see.', 'Brucia tutti i nemici che vedi.', { effect: 'fire', power: 6, ch: 3, price: 110, from: 3, w: 4 }),
        I('usb', 'u_napalm', 'napalm.bat', 'napalm.bat', 'Burns every enemy you can see, a lot.', 'Brucia molto tutti i nemici che vedi.', { effect: 'fire', power: 14, ch: 2, price: 190, from: 8, w: 3 }),
        I('usb', 'u_lullaby', 'lullaby.mp3', 'lullaby.mp3', 'Puts the enemies you can see to sleep.', 'Fa addormentare i nemici che vedi.', { effect: 'sleep', power: 8, ch: 3, price: 100, from: 3, w: 4 }),
        I('usb', 'u_scarecrow', 'scarecrow.exe', 'scarecrow.exe', 'The enemies you can see run away.', 'I nemici che vedi scappano.', { effect: 'fear', power: 10, ch: 3, price: 100, from: 3, w: 4 }),
        I('usb', 'u_bin', 'rm_enemy.sh', 'rm_enemy.sh', 'Sends the enemy far away. Many charges.', 'Manda il nemico lontano. Molte cariche.', { effect: 'banish', ch: 6, price: 90, from: 5, w: 4 }),
        I('usb', 'u_radar', 'radar.sys', 'radar.sys', 'Shows every enemy on the floor.', 'Mostra tutti i nemici del piano.', { effect: 'ping', power: 40, ch: 4, price: 80, from: 4, w: 4 }),
        I('usb', 'u_tempesta', 'Storm.exe', 'Storm.exe', 'Burns every enemy you can see. From the Sniffer.', 'Brucia tutti i nemici che vedi. Dallo Sniffer.', { effect: 'fire', power: 10, ch: 4, price: 180, from: 99 }),
        I('usb', 'u_sigkill', 'SIGKILL.exe', 'SIGKILL.exe', 'A terrible ranged hit. From the Reaper.', 'Un terribile colpo a distanza. Dal Mietitore.', { effect: 'bolt', power: 22, ch: 3, price: 260, from: 99 }),
        // ── plugin (uno alla volta): sconosciuti finché non li installi
        I('plugin', 'p_vpn', 'VPN', 'VPN', 'Enemies you are not fighting forget you sooner.', 'I nemici che non combatti ti dimenticano prima.', { mod: { stealth: 40 }, price: 90 }),
        I('plugin', 'p_ram', 'RAM Upgrade', 'Più RAM', 'Max HP +8.', 'Vita massima +8.', { mod: { maxHp: 8 }, price: 100 }),
        I('plugin', 'p_ssd', 'SSD', 'SSD', 'Dodge +2, aim +2.', 'Schivata +2, mira +2.', { mod: { dodge: 2, acc: 2 }, price: 110, from: 3 }),
        I('plugin', 'p_gpu', 'GPU', 'GPU', 'Attack +3, but you get hungry faster.', 'Attacco +3, ma la fame arriva prima.', { mod: { atk: 3, hunger: -25 }, price: 150, from: 6 }),
        I('plugin', 'p_cronplug', 'Scheduler Plugin', 'Plugin pianificatore', 'Your active skill recharges much sooner.', 'L’abilità attiva si ricarica molto prima.', { mod: { cd: 35 }, price: 100, from: 3 }),
        I('plugin', 'p_wallet', 'Crypto Wallet', 'Portafoglio cripto', 'You find far more credits.', 'Trovi molti più crediti.', { mod: { luck: 40 }, price: 90 }),
        I('plugin', 'p_coupon', 'Coupon Manager', 'Gestore di coupon', 'Shops give you a big discount.', 'I negozi ti fanno un grosso sconto.', { mod: { haggle: 30 }, price: 90 }),
        I('plugin', 'p_pdf', 'PDF Reader', 'Lettore PDF', 'You learn faster: experience +25%.', 'Impari prima: esperienza +25%.', { mod: { xp: 25 }, price: 110 }),
        I('plugin', 'p_vim', 'Vim', 'Vim', 'Hits on sleeping enemies and critical hits improve.', 'Migliorano i colpi su chi dorme e i critici.', { mod: { backstab: 1, crit: 6 }, price: 110, from: 4 }),
        I('plugin', 'p_firewall', 'Personal Firewall', 'Firewall personale', 'Defense +3 but dodge -1.', 'Difesa +3 ma schivata -1.', { mod: { def: 3, dodge: -1 }, price: 120, from: 6 }),
        I('plugin', 'p_lente', 'Magnifying Glass', 'Lente d’ingrandimento', 'Attacks on undead hit harder.', 'I colpi ai non-morti fanno più male.', { mod: { holy: 3 }, price: 100, from: 3 }),
        I('plugin', 'p_powerbank', 'Power Bank', 'Power bank', 'USB sticks recharge by themselves.', 'Le chiavette USB si ricaricano da sole.', { mod: { recharge: 1 }, price: 120, from: 4 }),
        I('plugin', 'p_estensione', 'USB Hub', 'Hub USB', 'USB sticks and skills hit 40% harder.', 'Chiavette e abilità colpiscono il 40% più forte.', { mod: { usb: 40 }, price: 130, from: 5 }),
        I('plugin', 'p_biofeedback', 'Biofeedback', 'Biofeedback', 'Cans heal 40% more.', 'Le lattine curano il 40% in più.', { mod: { drink: 40 }, price: 110, from: 4 }),
        I('plugin', 'p_visione', 'Night Vision', 'Visione notturna', 'You see two cells further.', 'Vedi due caselle più lontano.', { mod: { sight: 2 }, price: 110, from: 4 }),
        I('plugin', 'p_adrenalina', 'Adrenaline App', 'App adrenalina', 'Below half HP you hit much harder.', 'Sotto metà vita colpisci molto più forte.', { mod: { fury: 4 }, price: 130, from: 6 }),
        I('plugin', 'p_sanguisuga', 'Bloodsucker', 'Sanguisuga', 'Many hits that land heal you.', 'Molti colpi andati a segno ti curano.', { mod: { vamp: 40 }, price: 170, from: 10 }),
        I('plugin', 'p_scudo', 'Hard Shield', 'Scudo duro', 'Defense +4.', 'Difesa +4.', { mod: { def: 4 }, price: 160, from: 9 }),
        I('plugin', 'p_ombra', 'Shadow Theme', 'Tema ombra', 'Dodge +5.', 'Schivata +5.', { mod: { dodge: 5 }, price: 150, from: 9 }),
        I('plugin', 'p_gamer', 'Gaming Mouse', 'Mouse da gaming', 'Aim +4, critical hits +10%.', 'Mira +4, colpi critici +10%.', { mod: { acc: 4, crit: 10 }, price: 140, from: 8 }),
        I('plugin', 'p_neon', 'Neon Skin', 'Skin al neon', 'Attack +1, dodge +2, aim +1.', 'Attacco +1, schivata +2, mira +1.', { mod: { atk: 1, dodge: 2, acc: 1 }, price: 150, from: 8 }),
        I('plugin', 'p_ricarica', 'Wireless Charger', 'Caricatore wireless', 'You recover HP much faster.', 'Recuperi vita molto più in fretta.', { mod: { regen: 4 }, price: 170, from: 12 }),
        I('plugin', 'p_dieta', 'Diet App', 'App dieta', 'Hunger comes at a quarter of the speed.', 'La fame arriva a un quarto della velocità.', { mod: { hunger: 75 }, price: 100, from: 5 }),
        I('plugin', 'p_cuffie', 'Noise-Cancelling Headphones', 'Cuffie con cancellazione', 'Sleeping enemies stay asleep much longer.', 'I nemici che dormono restano addormentati molto più a lungo.', { mod: { stealth: 60 }, price: 120, from: 6 }),
        I('plugin', 'p_tastierino', 'Numeric Keypad', 'Tastierino numerico', 'Attack +2, aim +2.', 'Attacco +2, mira +2.', { mod: { atk: 2, acc: 2 }, price: 160, from: 12 }),
        I('plugin', 'p_certificato', 'TLS Certificate', 'Certificato TLS', 'Defense +2, dodge +2, max HP +4.', 'Difesa +2, schivata +2, vita massima +4.', { mod: { def: 2, dodge: 2, maxHp: 4 }, price: 190, from: 14 }),
        I('plugin', 'p_quantum', 'Quantum Chip', 'Chip quantistico', 'Attack +4 and critical hits +15%.', 'Attacco +4 e colpi critici +15%.', { mod: { atk: 4, crit: 15 }, price: 260, from: 24, w: 4 }),
        I('plugin', 'p_ia', 'Helpful AI', 'IA gentile', 'Experience +40% and traps spotted more often.', 'Esperienza +40% e trappole viste più spesso.', { mod: { xp: 40, search: 40 }, price: 220, from: 20, w: 4 }),
        I('plugin', 'p_root', 'Root Access', 'Accesso root', 'Attack +3, defense +3 and max HP +6.', 'Attacco +3, difesa +3 e vita massima +6.', { mod: { atk: 3, def: 3, maxHp: 6 }, price: 320, from: 30, w: 3 }),
    ];
    return { CATS, LOOKS, LIST };
});
