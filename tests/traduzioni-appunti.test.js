// tests/traduzioni-appunti.test.js — class notes in English (default) and Italian: pages, dictionaries, placeholders
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startSite, Client } = require('./helpers');
const { visibleText, looksItalian, looksEnglish } = require('./lang-helpers');

const JS = path.join(__dirname, '..', 'public', 'js');
const PAGES = ['appunti.php', 'appunti-carica.php', 'appunti-archivio.php', 'appunti-impostazioni.php', 'appunti-guida.php', 'condiviso.php'];
const SCRIPTS = fs.readdirSync(JS).filter((f) => /^(appunti.*|condiviso)\.js$/.test(f));

/** The dictionary of a language: runs the dictionary file with a fake VBI18N. */
function dictionary(lang) {
    let out = {};
    new Function('VBI18N', fs.readFileSync(path.join(JS, 'i18n', `appunti-${lang}.js`), 'utf8'))({ add: (l, t) => { if (l === lang) out = t; } });
    return out;
}
const en = dictionary('en');
const it = dictionary('it');
const placeholders = (t) => [...String(t).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('both dictionaries have the same keys, the same placeholders and no empty text', () => {
    assert.deepEqual(Object.keys(en).sort(), Object.keys(it).sort());
    for (const k of Object.keys(en)) {
        assert.ok(String(en[k]).length && String(it[k]).length, `empty text for ${k}`);
        assert.equal(placeholders(en[k]), placeholders(it[k]), `placeholders differ for ${k}`);
    }
});

test('every VBLang.t key used by the scripts exists in both dictionaries, with the placeholders it is given', () => {
    let used = 0;
    for (const f of SCRIPTS) {
        const src = fs.readFileSync(path.join(JS, f), 'utf8');
        for (const m of src.matchAll(/VBLang\.t\('([\w]+)'(?:,\s*\{([^}]*)\})?/g)) {
            used++;
            assert.ok(m[1] in en && m[1] in it, `${f}: key ${m[1]} missing`);
            if (m[2] !== undefined) {
                // the names given in { a: x, b } must be the ones the text uses (only checked for flat objects)
                const given = [...m[2].matchAll(/(?:^|,)\s*(\w+)\s*(?::|(?=,|$))/g)].map((x) => x[1]).sort().join(',');
                if (!/[{}]/.test(m[2])) assert.equal(given, placeholders(en[m[1]]), `${f}: ${m[1]} placeholders`);
            }
        }
    }
    assert.ok(used > 400, `only ${used} uses found`);
});

test('every key of the dictionary is used somewhere (no leftovers)', () => {
    const all = SCRIPTS.map((f) => fs.readFileSync(path.join(JS, f), 'utf8')).join('\n');
    const spare = Object.keys(en).filter((k) => !all.includes(`'${k}'`));
    assert.deepEqual(spare, [], 'unused keys');
});

test('the English texts are English and the Italian ones are Italian', () => {
    const e = Object.values(en).join('. ');
    const i = Object.values(it).join('. ');
    assert.ok(!looksItalian(e), 'the English dictionary reads as Italian');
    assert.ok(!looksEnglish(i), 'the Italian dictionary reads as English');
    for (const [k, v] of Object.entries(en)) assert.ok(!looksItalian(v), `Italian in English text ${k}: ${v}`);
});

test('the study prompts exist in both languages', () => {
    const load = (lang) => {
        const win = { VBLang: { lang } };
        new Function('window', fs.readFileSync(path.join(JS, 'appunti-prompts.js'), 'utf8'))(win);
        return win.AppuntiPrompts.list.map((p) => ({ key: p.key, title: p.title, text: p.text({ ai: 'claude', essay: true }) }));
    };
    const a = load('en'); const b = load('it');
    assert.equal(a.length, 4);
    for (let n = 0; n < 4; n++) {
        assert.ok(!looksItalian(a[n].text) && !looksItalian(a[n].title), `English prompt ${a[n].key}`);
        assert.ok(!looksEnglish(b[n].text) && !looksEnglish(b[n].title), `Italian prompt ${b[n].key}`);
    }
});

test.describe('pages', () => {
    let site, anna;
    test.before(async () => {
        site = await startSite();
        anna = new Client(site); await anna.register('tr_anna');
    });
    test.after(() => site.stop());

    for (const page of PAGES) {
        test(`${page}: English with ?lang=en, Italian with ?lang=it, the right <html lang>`, async () => {
            for (const lang of ['en', 'it']) {
                const res = await fetch(`${site.base}/pages/${page}?lang=${lang}`, { headers: { Cookie: anna.cookieHeader() }, redirect: 'manual' });
                assert.equal(res.status, 200, `${page} ${lang}`);
                const html = await res.text();
                assert.match(html, new RegExp(`<html lang="${lang}"`));
                assert.match(html, /js\/i18n\.js\?v=/);
                assert.match(html, /js\/i18n\/appunti-en\.js\?v=/);
                const text = visibleText(html);
                if (lang === 'en') assert.ok(!looksItalian(text), `${page} reads as Italian in English`);
                else assert.ok(!looksEnglish(text), `${page} reads as English in Italian`);
            }
        });
    }

    test('the dictionaries and i18n.js are inside the cache buster of every notes page', async () => {
        for (const page of PAGES) {
            const html = await (await fetch(`${site.base}/pages/${page}?lang=en`, { headers: { Cookie: anna.cookieHeader() } })).text();
            const v = (html.match(/appunti\.css\?v=([^"]+)"/) || [])[1];
            const i18nV = (html.match(/i18n\/appunti-it\.js\?v=([^"]+)"/) || [])[1];
            assert.ok(v && v === i18nV, `${page}: one ?v= for every file`);
            for (const f of ['i18n.js', 'i18n/appunti-en.js', 'i18n/appunti-it.js']) {
                const m = fs.statSync(path.join(JS, f)).mtimeMs; assert.ok(m > 0);
            }
            const parts = v.split('-').length;
            assert.ok(parts >= 5, `${page}: too few files in ?v=`);
        }
    });

    test('the top bar is translated too (same four places on every page)', async () => {
        const html = await (await fetch(`${site.base}/pages/appunti-impostazioni.php?lang=en`, { headers: { Cookie: anna.cookieHeader() } })).text();
        for (const w of ['Archive', 'Upload', 'Guide', 'Settings and notifications']) assert.ok(html.includes(w), w);
        const it2 = await (await fetch(`${site.base}/pages/appunti-impostazioni.php?lang=it`, { headers: { Cookie: anna.cookieHeader() } })).text();
        for (const w of ['Archivio', 'Carica', 'Guida', 'Impostazioni e notifiche']) assert.ok(it2.includes(w), w);
    });
});

test('the service worker has both languages', () => {
    const sw = fs.readFileSync(path.join(__dirname, '..', 'public', 'pages', 'appunti-sw.js'), 'utf8');
    assert.match(sw, /Class notes/);
    assert.match(sw, /Appunti di classe/);
});
