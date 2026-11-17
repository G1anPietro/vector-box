// js/rogue/recipes.js — CRAFTING at the bench of the Server Lounge (the hub between sectors). Data only.
//
// HOW IT WORKS: at the bench the player picks 2 or 3 things from the bag and presses Combine. If they match a recipe (in any order) they are used up and
// the result goes into the bag; if not, nothing happens and nothing is lost. A recipe is "discovered" the first time it is made (the recipe book at
// the bench lists the ones you know) or when a Recipe Book item (c_ricettario) is read: that one reveals them all. Discovered recipes are kept between runs.
// HOW TO ADD A RECIPE: add an object to RECIPES:
//   id, name {en,it}, in [2 or 3 matchers], out
//   a matcher is an item id ('s_rm') or 'cat:usb' (any item of that category: weapon, armor, plugin, drink, script, usb, food, throw, craft)
//   out: { give: [item id or { k, n }] }      the new things (a stack item takes n)
//     or { fn: 'recharge' }                  a function of CRAFT_FX in game.js (it gets the used items and returns what goes back into the bag)
//   Two inputs of the same id need two units (a stack of 2 is enough). Keep inputs distinct as a SET: two recipes must not have the same inputs
//   (the tests check it), and every id must exist (here in ITEMS or in items.js).
// HOW TO ADD A CRAFTED ITEM: add it to ITEMS below like in items.js (cat 'craft' = a stackable thing used like a script when it has an effect; from: 99
// keeps it out of the floors and shops: it can only be made). Both languages are required.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else (root.Rogue = root.Rogue || {}).recipes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    const CATS = {
        craft: { name: { en: 'Crafting', it: 'Creazione' }, shape: 'script', col: '#7fe8ff', stack: true },
    };
    // items.js's ITEMS.LIST gets these when game.js loads
    const ITEMS = [
        { id: 'c_batteria', cat: 'craft', shape: 'can', col: '#e8d45a', name: { en: 'Battery', it: 'Batteria' }, price: 20, w: 6,
          info: { en: 'Does nothing alone. At the bench, with a USB stick: a full recharge.', it: 'Da sola non fa nulla. Alla panchina, con una chiavetta USB: ricarica completa.' } },
        { id: 'c_ricettario', cat: 'craft', shape: 'script', col: '#ffb000', name: { en: 'Recipe Book', it: 'Ricettario' }, effect: 'recipes', price: 60, from: 2, w: 3,
          info: { en: 'Read it to learn every crafting recipe.', it: 'Leggilo per imparare tutte le ricette.' } },
        { id: 'c_rm', cat: 'craft', col: '#ff6a2a', name: { en: 'rm -rf /', it: 'rm -rf /' }, effect: 'fire', power: 18, price: 140, from: 99,
          info: { en: 'Hits every enemy you can see, twice as hard as rm -rf.', it: 'Colpisce ogni nemico che vedi, il doppio di rm -rf.' } },
        { id: 'c_sudo', cat: 'craft', col: '#ffd84a', name: { en: 'sudo su', it: 'sudo su' }, effect: 'fear', power: 30, price: 100, from: 99,
          info: { en: 'Enemies you can see run away for a long time.', it: 'I nemici che vedi scappano per molto tempo.' } },
        { id: 'c_sleep', cat: 'craft', col: '#8fb4e8', name: { en: 'sleep 1h', it: 'sleep 1h' }, effect: 'sleep', power: 28, price: 100, from: 99,
          info: { en: 'Enemies you can see fall asleep for a long time.', it: 'I nemici che vedi si addormentano per molto tempo.' } },
        { id: 'c_tastiera', cat: 'weapon', name: { en: 'Wired Keyboard', it: 'Tastiera cablata' }, dmg: [3, 8], acc: 1, price: 70, from: 99,
          info: { en: 'A keyboard with a network cable wrapped round it. Hits harder and further than either.', it: 'Una tastiera con un cavo di rete avvolto intorno. Colpisce più forte di entrambi.' } },
    ];
    const RECIPES = [
        { id: 'r_energy', name: { en: 'Double shot', it: 'Doppio shot' }, in: ['d_cura', 'd_cura'], out: { give: ['d_cura2'] } },
        { id: 'r_rm', name: { en: 'Root of all evil', it: 'La radice di ogni male' }, in: ['s_rm', 's_rm'], out: { give: ['c_rm'] } },
        { id: 'r_sudo', name: { en: 'Become root', it: 'Diventare root' }, in: ['s_sudo', 's_sudo'], out: { give: ['c_sudo'] } },
        { id: 'r_sleep', name: { en: 'Long nap', it: 'Pisolino lungo' }, in: ['s_sleep', 's_sleep'], out: { give: ['c_sleep'] } },
        { id: 'r_usb', name: { en: 'Recharge', it: 'Ricarica' }, in: ['cat:usb', 'c_batteria'], out: { fn: 'recharge' } },
        { id: 'r_kbd', name: { en: 'Cable keyboard', it: 'Tastiera con cavo' }, in: ['cavo', 'tastiera'], out: { give: ['c_tastiera'] } },
        { id: 'r_blade', name: { en: 'Disc blades', it: 'Lame di dischi' }, in: ['cd', 'cd', 'dardi'], out: { give: [{ k: 'taglierino', n: 2 }] } },
    ];
    return { CATS, ITEMS, RECIPES };
});
