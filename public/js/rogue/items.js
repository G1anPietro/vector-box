// js/rogue/items.js — everything you can pick up. Data only.
//
// HOW TO ADD AN ITEM: add one object to LIST. Needed: id, cat, name, price. Optional: from (first floor where it can
// be found, default 1), w (how common, default 10), col (colour), info (one line for the inventory).
//   cat 'weapon':  dmg [min, max]; optional acc (aim), crit (% more critical hits), holy (extra damage to `undead`)
//   cat 'armor':   def; optional dodge
//   cat 'food':    food (how much hunger it removes; the belly holds 1200)
//   cat 'plugin':  mod { … } — the same numbers the skills use (see classes.js): atk, def, acc, dodge, crit, regen…
//   cat 'drink' and 'script':  effect (+ power) — used once
//   cat 'usb':     effect (+ power), ch (charges) — hits the nearest enemy you see
// The effects are the functions in EFFECTS in game.js: an item with an existing effect needs only its line here.
// Drinks, scripts, USB sticks and plugins are unknown until used: each run gives them a random look from LOOKS
// (there must be at least as many looks as items of that kind: the tests check it).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else (root.Rogue = root.Rogue || {}).items = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    const CATS = {
        weapon: { name: 'Arma', shape: 'weapon', col: '#c9d6e3', slot: 'weapon' },
        armor:  { name: 'Protezione', shape: 'armor', col: '#8fb4e8', slot: 'armor' },
        plugin: { name: 'Plugin', shape: 'plugin', slot: 'plugin', unknown: true },
        drink:  { name: 'Lattina', shape: 'can', unknown: true, stack: true },
        script: { name: 'Script', shape: 'script', unknown: true, stack: true },
        usb:    { name: 'Chiavetta', shape: 'usb', unknown: true },
        food:   { name: 'Cibo', shape: 'food', col: '#e8b84a', stack: true },
    };
    const LOOKS = {
        drink: [['rossa', '#e85a5a'], ['blu', '#5a8fe8'], ['verde', '#5ad87b'], ['gialla', '#e8d45a'], ['viola', '#b06ae8'], ['arancione', '#e8964a'],
                ['rosa', '#e88ac0'], ['nera', '#6b6880'], ['bianca', '#e8e6f0'], ['azzurra', '#6ad8e8'], ['argento', '#aab3c0'], ['dorata', '#d8b44a']],
        script: [['xk7.sh', '#e8e6f0'], ['a.out', '#e8e6f0'], ['tmp_2.bat', '#e8e6f0'], ['nuovo(3).py', '#e8e6f0'], ['qwe.sh', '#e8e6f0'], ['prova.js', '#e8e6f0'],
                 ['zzz.pl', '#e8e6f0'], ['finale_v2.sh', '#e8e6f0'], ['boh.cmd', '#e8e6f0'], ['asdf.rb', '#e8e6f0'], ['core.dump', '#e8e6f0'], ['senza_nome', '#e8e6f0'],
                 ['copia_di_copia', '#e8e6f0'], ['NON_APRIRE', '#e8e6f0']],
        usb: [['rossa', '#e85a5a'], ['blu', '#5a8fe8'], ['verde', '#5ad87b'], ['gialla', '#e8d45a'], ['nera', '#6b6880'], ['bianca', '#e8e6f0'], ['viola', '#b06ae8'], ['arancione', '#e8964a']],
        plugin: [['quadrato', '#5ad87b'], ['rotondo', '#5a8fe8'], ['storto', '#e8964a'], ['lucido', '#e8e6f0'], ['graffiato', '#aab3c0'], ['dorato', '#d8b44a'],
                 ['minuscolo', '#e88ac0'], ['bruciacchiato', '#8a6a55'], ['trasparente', '#6ad8e8'], ['pesante', '#6b6880']],
    };
    const LIST = [
        // ── armi
        { id: 'righello', cat: 'weapon', name: 'Righello da 50', dmg: [1, 4], acc: 1, price: 15, info: 'Di metallo. Fa male sulle dita.' },
        { id: 'cacciavite', cat: 'weapon', name: 'Cacciavite', dmg: [1, 4], acc: 2, crit: 15, price: 25, info: 'Preciso: più colpi critici.' },
        { id: 'cavo', cat: 'weapon', name: 'Cavo di rete', dmg: [1, 6], price: 25, info: 'Cat 5e, tre metri. Si usa come una frusta.' },
        { id: 'tastiera', cat: 'weapon', name: 'Tastiera', dmg: [2, 6], price: 40, info: 'Mancano dei tasti. Ne mancheranno altri.' },
        { id: 'mouse', cat: 'weapon', name: 'Mouse con il filo', dmg: [2, 7], acc: -1, price: 55, from: 2, info: 'Fatto roteare, è un’arma seria.' },
        { id: 'saldatore', cat: 'weapon', name: 'Saldatore', dmg: [3, 8], price: 80, from: 3, info: 'Ancora caldo.' },
        { id: 'meccanica', cat: 'weapon', name: 'Tastiera meccanica', dmg: [3, 10], price: 120, from: 4, info: 'Switch blu. La sentono tre aule più in là.' },
        { id: 'router', cat: 'weapon', name: 'Router', dmg: [4, 11], acc: -1, price: 150, from: 5, w: 6, info: 'Pesante, con le antenne. Colpisce forte ma è scomodo.' },
        // ── protezioni
        { id: 'maglietta', cat: 'armor', name: 'Maglietta', def: 1, price: 15, info: 'Quella della gita.' },
        { id: 'felpa', cat: 'armor', name: 'Felpa', def: 2, price: 35, info: 'Tiene caldo e attutisce.' },
        { id: 'badge', cat: 'armor', name: 'Laccetto con badge', def: 1, dodge: 2, price: 45, info: 'Leggero: schivi meglio.' },
        { id: 'cappuccio', cat: 'armor', name: 'Felpa col cappuccio', def: 3, price: 70, from: 2, info: 'Col cappuccio su non ti vede nessuno. Quasi.' },
        { id: 'antistatico', cat: 'armor', name: 'Giubbotto antistatico', def: 4, price: 110, from: 4, info: 'Da tecnico vero.' },
        { id: 'zaino', cat: 'armor', name: 'Zaino pieno di libri', def: 5, dodge: -1, price: 140, from: 5, w: 6, info: 'Una corazza. Pesa come una corazza.' },
        // ── cibo
        { id: 'merendina', cat: 'food', name: 'Merendina', food: 350, price: 10, w: 14, info: 'Dal distributore.' },
        { id: 'mela', cat: 'food', name: 'Mela', food: 250, price: 8, info: 'Qualcuno l’ha portata davvero.' },
        { id: 'panino', cat: 'food', name: 'Panino', food: 700, price: 20, info: 'Della mamma. Sazia a lungo.' },
        { id: 'pizzetta', cat: 'food', name: 'Pizzetta', food: 500, price: 15, from: 2, info: 'Fredda, ma è pizza.' },
        // ── lattine (bibite energetiche): sconosciute finché non le bevi
        { id: 'd_cura', cat: 'drink', name: 'Energy drink', effect: 'heal', power: 45, price: 30, w: 26, info: 'Ridà energia (vita).' },
        { id: 'd_cura2', cat: 'drink', name: 'Energy drink doppio', effect: 'heal', power: 100, price: 70, from: 3, w: 8, info: 'Ridà tutta la vita.' },
        { id: 'd_forza', cat: 'drink', name: 'Proteine alla vaniglia', effect: 'strength', power: 1, price: 90, w: 4, info: 'Attacco +1 per sempre.' },
        { id: 'd_vita', cat: 'drink', name: 'Succo multivitaminico', effect: 'life', power: 5, price: 90, w: 4, info: 'Vita massima +5 per sempre.' },
        { id: 'd_scaduta', cat: 'drink', name: 'Lattina scaduta', effect: 'poison', power: 8, price: 10, w: 7, info: 'Del 2011. Fa male per qualche turno.' },
        { id: 'd_veloce', cat: 'drink', name: 'Caffè triplo', effect: 'haste', power: 20, price: 50, w: 7, info: 'Per un po’ fai due mosse a turno.' },
        { id: 'd_zucchero', cat: 'drink', name: 'Troppo zucchero', effect: 'confuse', power: 10, price: 10, w: 6, info: 'Cammini a caso per qualche turno.' },
        { id: 'd_invis', cat: 'drink', name: 'Acqua liscia', effect: 'invis', power: 25, price: 50, w: 5, info: 'Così anonima che non ti nota nessuno.' },
        { id: 'd_xp', cat: 'drink', name: 'Tè del prof', effect: 'xp', price: 100, w: 3, info: 'Sali subito di un livello.' },
        { id: 'd_regen', cat: 'drink', name: 'Camomilla', effect: 'regen', power: 30, price: 40, w: 6, info: 'Recuperi vita a ogni turno per un po’.' },
        // ── script: sconosciuti finché non li lanci
        { id: 's_cd', cat: 'script', name: 'cd /a/caso', effect: 'teleport', price: 30, w: 12, info: 'Ti sposta in un punto a caso del piano.' },
        { id: 's_ls', cat: 'script', name: 'ls -R', effect: 'map', price: 40, w: 9, info: 'Mostra la mappa del piano, porte segrete comprese.' },
        { id: 's_man', cat: 'script', name: 'man', effect: 'identify', price: 30, w: 10, info: 'Riconosci tutto quello che hai nello zaino.' },
        { id: 's_chmod', cat: 'script', name: 'chmod +x', effect: 'enchW', price: 80, w: 7, info: 'L’arma che impugni diventa +1.' },
        { id: 's_ufw', cat: 'script', name: 'ufw enable', effect: 'enchA', price: 80, w: 7, info: 'La protezione che indossi diventa +1.' },
        { id: 's_sudo', cat: 'script', name: 'sudo', effect: 'fear', power: 12, price: 45, w: 8, info: 'I nemici che vedi scappano: hai i permessi.' },
        { id: 's_rm', cat: 'script', name: 'rm -rf', effect: 'fire', power: 8, price: 70, w: 6, info: 'Colpisce tutti i nemici che vedi.' },
        { id: 's_fork', cat: 'script', name: 'fork()', effect: 'summon', power: 2, price: 10, w: 5, info: 'Compaiono dei nemici. Non andava lanciato.' },
        { id: 's_sleep', cat: 'script', name: 'sleep 10', effect: 'sleep', power: 10, price: 45, w: 8, info: 'I nemici che vedi si addormentano.' },
        { id: 's_apt', cat: 'script', name: 'apt upgrade', effect: 'recharge', power: 3, price: 60, w: 5, info: 'Ricarica le chiavette USB.' },
        { id: 's_ping', cat: 'script', name: 'ping', effect: 'ping', power: 30, price: 25, w: 8, info: 'Per un po’ vedi tutti i nemici del piano.' },
        { id: 's_grep', cat: 'script', name: 'grep -r', effect: 'grep', price: 25, w: 8, info: 'Trova trappole e porte segrete del piano.' },
        // ── chiavette USB: colpiscono il nemico più vicino che vedi
        { id: 'u_exploit', cat: 'usb', name: 'exploit.exe', effect: 'bolt', power: 7, ch: 5, price: 70, info: 'Un colpo a distanza.' },
        { id: 'u_volt', cat: 'usb', name: 'USB killer', effect: 'bolt', power: 14, ch: 3, price: 120, from: 4, w: 5, info: 'Un colpo a distanza molto forte.' },
        { id: 'u_freeze', cat: 'usb', name: 'freeze.sys', effect: 'freeze', power: 6, ch: 4, price: 70, w: 7, info: 'Il nemico resta bloccato per qualche turno.' },
        { id: 'u_mv', cat: 'usb', name: 'mv /dev/null', effect: 'banish', ch: 4, price: 60, w: 7, info: 'Sposta il nemico lontano da te.' },
        { id: 'u_lag', cat: 'usb', name: 'lag.dll', effect: 'slow', ch: 5, price: 50, w: 7, info: 'Il nemico va a metà velocità.' },
        { id: 'u_leak', cat: 'usb', name: 'Data leak', effect: 'drain', power: 6, ch: 4, price: 90, from: 3, w: 5, info: 'Toglie vita al nemico e la dà a te.' },
        // ── plugin (uno alla volta): sconosciuti finché non li installi
        { id: 'p_antivirus', cat: 'plugin', name: 'Antivirus', mod: { def: 2 }, price: 100, info: 'Difesa +2.' },
        { id: 'p_overclock', cat: 'plugin', name: 'Overclock', mod: { atk: 2 }, price: 100, info: 'Attacco +2.' },
        { id: 'p_autosave', cat: 'plugin', name: 'Salvataggio automatico', mod: { regen: 2 }, price: 100, info: 'Recuperi vita più in fretta.' },
        { id: 'p_risparmio', cat: 'plugin', name: 'Risparmio energetico', mod: { hunger: 50 }, price: 80, info: 'La fame arriva a metà velocità.' },
        { id: 'p_dark', cat: 'plugin', name: 'Dark mode', mod: { dodge: 3 }, price: 90, info: 'Schivata +3.' },
        { id: 'p_adblock', cat: 'plugin', name: 'AdBlock', mod: { search: 40, sight: 1 }, price: 80, info: 'Vedi più lontano e trovi trappole e porte segrete.' },
        { id: 'p_cache', cat: 'plugin', name: 'Cache', mod: { crit: 12, acc: 1 }, price: 90, info: 'Più colpi critici.' },
        { id: 'p_backup', cat: 'plugin', name: 'Backup', mod: { vamp: 25 }, price: 110, from: 3, info: 'A volte un colpo andato a segno ti ridà vita.' },
    ];
    return { CATS, LOOKS, LIST };
});
