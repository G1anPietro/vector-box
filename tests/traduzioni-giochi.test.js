// Static checks for the translated game pages: English HTML, dictionaries complete, i18n.js loaded early.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { visibleText, looksItalian } = require('./lang-helpers');

const PUB = path.join(__dirname, '..', 'public');
const ARCADE = ['minato', 'dueamila', 'memory', 'tris', 'snake', 'forza4', 'impiccato', 'simon', 'tetris', 'parola', 'vita', 'difesa'];
const PARTY = ['spia', 'lupus', 'cucu', 'botola', 'probabile', 'preferiresti', 'bomba', 'undercover', 'mimo', 'obbligo', 'nonhomai', 'solitario', 'proibita', 'indovina', 'bandiere', 'bingo', 'storia', 'scommessa'];
const read = (p) => fs.readFileSync(path.join(PUB, p), 'utf8');

/** Runs a game script in a sandbox with a fake VBI18N/VBLang and returns the dictionaries it registered. */
function dictionaries(js) {
    const dict = {};
    const sandbox = {
        VBI18N: { add: (l, t) => { dict[l] = Object.assign(dict[l] || {}, t); } },
        VBLang: { t: (k) => k, lang: 'en' },
        document: { addEventListener() {} }, window: {}, module: undefined,
    };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(js, sandbox);
    return dict;
}

for (const g of [...ARCADE, ...PARTY]) {
    test(g + ': HTML is English, i18n.js in <head> without defer', () => {
        const html = read(`pages/${g}.html`);
        assert.ok(!looksItalian(visibleText(html)), 'visible text looks Italian');
        const head = html.slice(0, html.indexOf('</head>'));
        if (ARCADE.includes(g)) assert.match(head, /<script src="\.\.\/js\/i18n\.js[^"]*"><\/script>/, 'i18n.js in head, no defer');
        assert.match(html, /<html lang="en"/);
        assert.match(html, /<meta name="description" content="[^"]{40,}"/);
        assert.ok(!looksItalian(html.match(/<meta property="og:description" content="([^"]*)"/)[1]), 'og:description is English');
    });
}

for (const g of ARCADE) {
    test(g + ': every key used exists in the dictionaries', () => {
        const html = read(`pages/${g}.html`), js = read(`js/${g}.js`);
        const d = dictionaries(js);
        assert.ok(d.it && d.en, 'both dictionaries registered');
        // the pause and sound texts are shared: js/arcade-fx.js registers them (it/en) for every page that loads it
        if (html.includes('js/arcade-fx.js')) {
            const fx = read('js/arcade-fx.js');
            for (const l of ['it', 'en']) {
                const m = fx.match(new RegExp("VBI18N\\.add\\('" + l + "', \\{([^}]*)\\}\\)"));
                assert.ok(m, 'arcade-fx.js registers its ' + l + ' texts');
                for (const k of m[1].matchAll(/(\w+):/g)) d[l][k[1]] = true;
            }
        }
        const keys = new Set();
        for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) keys.add(m[1]);
        for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) m[1].split(';').forEach((p) => keys.add(p.split(':')[1].trim()));
        for (const k of keys) assert.ok(k in d.it, `${g}: "${k}" missing in the Italian dictionary`);
        const used = new Set([...js.matchAll(/VBLang\.t\('([^']+)'/g)].map((m) => m[1]));
        for (const m of js.matchAll(/(?:say|msg|showMsg)\(\s*'([a-z_]+)'/g)) used.add(m[1]);
        for (const m of js.matchAll(/'(m_[a-z]+|c_[a-z]+)'/g)) used.add(m[1]);
        for (const k of used) {
            if (k === 'cat_') continue;
            assert.ok(k in d.it, `${g}: "${k}" missing in Italian`);
            assert.ok(k in d.en || (html.includes(`data-i18n="${k}"`)) || /^cat_/.test(k) || k in d.it, `${g}: "${k}" missing in English`);
        }
        // keys that the JS builds in English must exist in the English dictionary (the HTML carries the rest)
        for (const k of Object.keys(d.en)) assert.ok(k in d.it, `${g}: English-only key "${k}"`);
        for (const k of Object.keys(d.en)) assert.ok(!looksItalian(d.en[k]), `${g}: "${k}" English text looks Italian`);
    });
}

test('impiccato: English word list is big enough and A-Z only', () => {
    const I = require(path.join(PUB, 'js', 'impiccato.js'));
    assert.deepEqual(Object.keys(I.WORDS_EN), Object.keys(I.WORDS));
    let n = 0;
    for (const list of Object.values(I.WORDS_EN)) for (const w of list) { n++; assert.match(w, /^[A-Z]+$/, w); }
    assert.ok(n >= 100, 'at least 100 words');
    assert.ok(I.WORDS_EN.animali.includes('ELEPHANT'));
    assert.ok(I.WORDS.animali.includes('ELEFANTE'));
    assert.ok(I.WORDS_EN.cibo.includes(I.pick('cibo', () => 0, null, 'en').word));
});

test('party games: language order saved choice > cookie > browser > English', () => {
    const src = read('js/spia/i18n.js');
    const mk = (cookie, langs, saved) => {
        const sb = { window: {}, document: { currentScript: null, cookie }, navigator: { languages: langs } };
        sb.window = sb;
        vm.runInNewContext(src, sb);
        return sb.SpiaI18n.initial(() => saved, ['it', 'en', 'es', 'fr', 'de'], () => {});
    };
    assert.equal(mk('', [], null), 'en', 'visitor from nowhere gets English');
    assert.equal(mk('', ['de-DE'], null), 'de');
    assert.equal(mk('vb_lang=it', ['de-DE'], null), 'it', 'site cookie beats browser');
    assert.equal(mk('vb_lang=it', ['de-DE'], 'es'), 'es', 'own saved choice beats the cookie');
});
