// tests/lingua.test.js — which language a visitor gets: explicit choice, Italy -> Italian, browser, English by default
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { startSite, REPO } = require('./helpers');

const php = (code) => execFileSync('php', ['-r', `require ${JSON.stringify(path.join(REPO, 'public/api/helpers.php'))}; ${code}`], { encoding: 'utf8' });
const detect = (q, c, a, cc) => JSON.parse(php(`echo json_encode(detectLang(${JSON.stringify(q)}, ${JSON.stringify(c)}, ${JSON.stringify(a)}, ${JSON.stringify(cc)}));`));

test('detectLang: explicit choice beats everything, Italy gets Italian, then the browser, then English', () => {
    assert.deepEqual(detect('it', null, 'en-US', null), ['it', 'query']);
    assert.deepEqual(detect('en', 'it', '', 'IT'), ['en', 'query'], 'a ?lang= choice even in Italy');
    assert.deepEqual(detect(null, 'en', 'it-IT', 'IT'), ['en', 'cookie'], 'the saved choice even in Italy');
    assert.deepEqual(detect(null, null, 'en-US,en;q=0.9', 'IT'), ['it', 'country'], 'an English phone in Italy: the page stays Italian');
    assert.deepEqual(detect(null, null, 'it-IT,it;q=0.9,en;q=0.8', 'DE'), ['it', 'browser'], 'an Italian phone abroad');
    assert.deepEqual(detect(null, null, 'en-US,en;q=0.9,it;q=0.8', 'US'), ['en', 'browser']);
    assert.deepEqual(detect(null, null, 'it;q=0.3,en;q=0.9', null), ['en', 'browser'], 'q weights decide');
    assert.deepEqual(detect(null, null, 'fr-FR,fr;q=0.9', 'FR'), ['en', 'default'], 'a language we do not have: English');
    assert.deepEqual(detect(null, null, 'fr,it;q=0.5', 'CH'), ['it', 'browser'], 'the best language we do have');
    assert.deepEqual(detect(null, null, '', null), ['en', 'default']);
    assert.deepEqual(detect('xx', 'zz', '*;q=0.5, ;q=', null), ['en', 'default'], 'garbage is ignored, never an error');
    assert.deepEqual(detect('IT', null, '', null), ['it', 'query'], 'case does not matter');
});

test('the client script: texts, fallbacks and the browser list', () => {
    const I = require(path.join(REPO, 'public/js/i18n.js'));
    I.add('en', { hello: 'Hello {name}', only_en: 'Only English' });
    I.add('it', { hello: 'Ciao {name}' });
    assert.equal(I.translate('it', 'hello', { name: 'Ada' }), 'Ciao Ada');
    assert.equal(I.translate('en', 'hello', { name: 'Ada' }), 'Hello Ada');
    assert.equal(I.translate('it', 'only_en'), 'Only English', 'a missing Italian text falls back to English');
    assert.equal(I.translate('it', 'nothing_at_all'), 'nothing_at_all', 'and then to the key');
    assert.equal(I.translate('it', 'hello'), 'Ciao {name}', 'no values given: the placeholder stays');
    assert.equal(I.fromBrowser(['fr-CA', 'it-IT', 'en']), 'it');
    assert.equal(I.fromBrowser(['de', 'fr']), null);
    assert.equal(I.fromBrowser(undefined), null);
});

test.describe('on the site', () => {
    let site;
    const CSV = ['0.0.0.0,4.255.255.255,ZZ', '5.0.0.0,5.255.255.255,IT', '8.0.0.0,8.255.255.255,US'].join('\n') + '\n';
    test.before(async () => {
        site = await startSite({ TRUSTED_PROXIES: '127.0.0.1' });
        await fetch(site.base + '/api/get_feed.php');
        const gz = path.join(site.root, 'data', 'c.csv.gz'); fs.writeFileSync(gz, zlib.gzipSync(CSV));
        execFileSync('php', ['-r', `require ${JSON.stringify(path.join(REPO, 'public/api/geoip.php'))}; geoipBuild($argv[1], $argv[2], 1);`, gz, path.join(site.root, 'data', 'geoip-country.bin')]);
    });
    test.after(async () => { await site.stop(); });
    const lang = async (headers, q = '') => (await (await fetch(`${site.base}/api/lang.php${q}`, { headers })).json());

    test('api/lang.php: Italy gets Italian, elsewhere the browser or English, and a choice wins', async () => {
        assert.deepEqual(await lang({ 'X-Forwarded-For': '5.1.2.3', 'Accept-Language': 'en-US' }), { success: true, lang: 'it', source: 'country', languages: ['en', 'it'] });
        const us = await lang({ 'X-Forwarded-For': '8.8.8.8', 'Accept-Language': 'en-US' });
        assert.deepEqual([us.lang, us.source], ['en', 'browser']);
        assert.deepEqual([(await lang({ 'X-Forwarded-For': '8.8.8.8' })).lang, (await lang({ 'X-Forwarded-For': '8.8.8.8' })).source], ['en', 'default']);
        assert.equal((await lang({ 'X-Forwarded-For': '8.8.8.8', 'Accept-Language': 'it' })).lang, 'it');
        assert.equal((await lang({ 'X-Forwarded-For': '5.1.2.3', Cookie: 'vb_lang=en' })).lang, 'en', 'the saved choice in Italy');
        assert.equal((await lang({ 'X-Forwarded-For': '5.1.2.3' }, '?lang=en')).lang, 'en');
        const noGeo = await lang({});
        assert.equal(noGeo.lang, 'en', 'no address information at all: English');
    });

    test('a PHP page follows the same rules, and ?lang= is remembered in a cookie scripts can read', async () => {
        const html = async (headers, q = '') => { const r = await fetch(`${site.base}/pages/giochi.php${q}`, { headers }); return { text: await r.text(), cookie: r.headers.get('set-cookie') || '' }; };
        assert.match((await html({ 'X-Forwarded-For': '5.1.2.3' })).text, /<html lang="it">/);
        assert.match((await html({ 'X-Forwarded-For': '8.8.8.8' })).text, /<html lang="en">/);
        const chosen = await html({ 'X-Forwarded-For': '5.1.2.3' }, '?lang=en');
        assert.match(chosen.text, /<html lang="en">/);
        assert.match(chosen.cookie, /vb_lang=en/);
        assert.ok(!/httponly/i.test(chosen.cookie), 'the static pages read it');
    });
});
