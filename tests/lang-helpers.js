// tests/lang-helpers.js — helpers for the translation tests.
'use strict';

// Very common Italian words that are not English words: if several of them show up in a text that should be English, a sentence was left untranslated.
const IT = ['il', 'lo', 'la', 'gli', 'le', 'di', 'del', 'della', 'dei', 'delle', 'che', 'per', 'con', 'non', 'una', 'uno', 'sono', 'è', 'più', 'nel', 'nella',
    'questo', 'questa', 'come', 'anche', 'tutto', 'tutti', 'hai', 'ho', 'dal', 'dalla', 'sul', 'sulla', 'ogni', 'puoi', 'solo', 'ancora', 'quando', 'dove', 'perché', 'giocatori', 'partita', 'nuova'];
const EN = ['the', 'and', 'of', 'to', 'is', 'you', 'your', 'for', 'with', 'this', 'that', 'are', 'on', 'it', 'new', 'game', 'player', 'players'];

/** The visible text of an HTML page (scripts, styles and tags removed). */
function visibleText(html) {
    return String(html).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');
}
const words = (text) => String(text).toLowerCase().match(/[a-zàèéìòù']+/g) || [];

/** How many very common Italian words a text has (and how many English ones). */
function score(text) {
    const w = words(text);
    return { it: w.filter((x) => IT.includes(x)).length, en: w.filter((x) => EN.includes(x)).length, total: w.length };
}
/** true when the text reads as Italian: clearly more Italian than English function words. */
const looksItalian = (text) => { const s = score(text); return s.it >= 3 && s.it > s.en; };
const looksEnglish = (text) => { const s = score(text); return s.en >= 3 && s.en > s.it; };

module.exports = { visibleText, score, looksItalian, looksEnglish, IT, EN };
