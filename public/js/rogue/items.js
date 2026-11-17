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
    const LIST = [
        // ── armi
        { id: 'righello', cat: 'weapon', name: { en: '50 cm Ruler', it: 'Righello da 50' }, dmg: [1, 4], acc: 1, price: 15, info: { en: 'Made of metal. Painful on the knuckles.', it: 'Di metallo. Fa male sulle dita.' } },
        { id: 'cacciavite', cat: 'weapon', name: { en: 'Screwdriver', it: 'Cacciavite' }, dmg: [1, 4], acc: 2, crit: 15, price: 25, info: { en: 'Precise: more critical hits.', it: 'Preciso: più colpi critici.' } },
        { id: 'cavo', cat: 'weapon', name: { en: 'Network Cable', it: 'Cavo di rete' }, dmg: [1, 6], price: 25, info: { en: 'Cat 5e, three meters. Used like a whip.', it: 'Cat 5e, tre metri. Si usa come una frusta.' } },
        { id: 'tastiera', cat: 'weapon', name: { en: 'Keyboard', it: 'Tastiera' }, dmg: [2, 6], price: 40, info: { en: 'Some keys are missing. More will be.', it: 'Mancano dei tasti. Ne mancheranno altri.' } },
        { id: 'mouse', cat: 'weapon', name: { en: 'Corded Mouse', it: 'Mouse con il filo' }, dmg: [2, 7], acc: -1, price: 55, from: 2, info: { en: 'Swung around, it’s a serious weapon.', it: 'Fatto roteare, è un’arma seria.' } },
        { id: 'saldatore', cat: 'weapon', name: { en: 'Soldering Iron', it: 'Saldatore' }, dmg: [3, 8], price: 80, from: 3, info: { en: 'Still hot.', it: 'Ancora caldo.' } },
        { id: 'meccanica', cat: 'weapon', name: { en: 'Mechanical Keyboard', it: 'Tastiera meccanica' }, dmg: [3, 10], price: 120, from: 4, info: { en: 'Blue switches. Three classrooms away can hear it.', it: 'Switch blu. La sentono tre aule più in là.' } },
        { id: 'router', cat: 'weapon', name: { en: 'Router', it: 'Router' }, dmg: [4, 11], acc: -1, price: 150, from: 5, w: 6, info: { en: 'Heavy, with antennas. Hits hard but is awkward.', it: 'Pesante, con le antenne. Colpisce forte ma è scomodo.' } },
        // ── protezioni
        { id: 'maglietta', cat: 'armor', name: { en: 'T-shirt', it: 'Maglietta' }, def: 1, price: 15, info: { en: 'The one from the school trip.', it: 'Quella della gita.' } },
        { id: 'felpa', cat: 'armor', name: { en: 'Sweatshirt', it: 'Felpa' }, def: 2, price: 35, info: { en: 'Keeps you warm and cushions the blows.', it: 'Tiene caldo e attutisce.' } },
        { id: 'badge', cat: 'armor', name: { en: 'Lanyard with Badge', it: 'Laccetto con badge' }, def: 1, dodge: 2, price: 45, info: { en: 'Light: you dodge better.', it: 'Leggero: schivi meglio.' } },
        { id: 'cappuccio', cat: 'armor', name: { en: 'Hoodie', it: 'Felpa col cappuccio' }, def: 3, price: 70, from: 2, info: { en: 'Hood up and nobody sees you. Almost.', it: 'Col cappuccio su non ti vede nessuno. Quasi.' } },
        { id: 'antistatico', cat: 'armor', name: { en: 'Antistatic Vest', it: 'Giubbotto antistatico' }, def: 4, price: 110, from: 4, info: { en: 'The real technician look.', it: 'Da tecnico vero.' } },
        { id: 'zaino', cat: 'armor', name: { en: 'Backpack Full of Books', it: 'Zaino pieno di libri' }, def: 5, dodge: -1, price: 140, from: 5, w: 6, info: { en: 'A suit of armor. Weighs as much as one.', it: 'Una corazza. Pesa come una corazza.' } },
        // ── oggetti da lancio (tocca l'icona nella barra rapida, poi la casella dove lanciare)
        { id: 'dardi', cat: 'throw', name: { en: 'Darts', it: 'Dardi da freccette' }, dmg: [2, 5], price: 12, w: 12, info: { en: 'Thrown from afar (6 tiles). Sometimes you can pick them back up.', it: 'Si lanciano da lontano (6 caselle). A volte si recuperano.' } },
        { id: 'cd', cat: 'throw', name: { en: 'Scratched CD', it: 'CD graffiato' }, dmg: [1, 4], price: 8, w: 10, info: { en: 'Useless for listening, great for throwing.', it: 'Inutile per ascoltare, ottimo da lanciare.' } },
        { id: 'taglierino', cat: 'throw', name: { en: 'Box Cutter', it: 'Taglierino' }, dmg: [3, 6], price: 25, from: 2, w: 7, info: { en: 'Thrown from afar; hurts more than a dart.', it: 'Si lancia da lontano e fa più male di un dardo.' } },
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
        { id: 'd_scaduta', cat: 'drink', name: { en: 'Expired Can', it: 'Lattina scaduta' }, effect: 'poison', power: 8, price: 10, w: 7, info: { en: 'From 2011. Hurts for a few turns.', it: 'Del 2011. Fa male per qualche turno.' } },
        { id: 'd_veloce', cat: 'drink', name: { en: 'Triple Espresso', it: 'Caffè triplo' }, effect: 'haste', power: 20, price: 50, w: 7, info: { en: 'For a while you get two moves per turn.', it: 'Per un po’ fai due mosse a turno.' } },
        { id: 'd_zucchero', cat: 'drink', name: { en: 'Too Much Sugar', it: 'Troppo zucchero' }, effect: 'confuse', power: 10, price: 10, w: 6, info: { en: 'You stumble around at random for a few turns.', it: 'Cammini a caso per qualche turno.' } },
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
        { id: 'p_antivirus', cat: 'plugin', name: { en: 'Antivirus', it: 'Antivirus' }, mod: { def: 2 }, price: 100, info: { en: 'Defense +2.', it: 'Difesa +2.' } },
        { id: 'p_overclock', cat: 'plugin', name: { en: 'Overclock', it: 'Overclock' }, mod: { atk: 2 }, price: 100, info: { en: 'Attack +2.', it: 'Attacco +2.' } },
        { id: 'p_autosave', cat: 'plugin', name: { en: 'Autosave', it: 'Salvataggio automatico' }, mod: { regen: 2 }, price: 100, info: { en: 'You recover HP faster.', it: 'Recuperi vita più in fretta.' } },
        { id: 'p_risparmio', cat: 'plugin', name: { en: 'Power Saver', it: 'Risparmio energetico' }, mod: { hunger: 50 }, price: 80, info: { en: 'Hunger comes at half speed.', it: 'La fame arriva a metà velocità.' } },
        { id: 'p_dark', cat: 'plugin', name: { en: 'Dark Mode', it: 'Dark mode' }, mod: { dodge: 3 }, price: 90, info: { en: 'Dodge +3.', it: 'Schivata +3.' } },
        { id: 'p_adblock', cat: 'plugin', name: { en: 'AdBlock', it: 'AdBlock' }, mod: { search: 40, sight: 1 }, price: 80, info: { en: 'You see further and find traps and secret doors.', it: 'Vedi più lontano e trovi trappole e porte segrete.' } },
        { id: 'p_cache', cat: 'plugin', name: { en: 'Cache', it: 'Cache' }, mod: { crit: 12, acc: 1 }, price: 90, info: { en: 'More critical hits.', it: 'Più colpi critici.' } },
        { id: 'p_backup', cat: 'plugin', name: { en: 'Backup', it: 'Backup' }, mod: { vamp: 25 }, price: 110, from: 3, info: { en: 'Sometimes a hit that lands heals you.', it: 'A volte un colpo andato a segno ti ridà vita.' } },
    ];
    return { CATS, LOOKS, LIST };
});
