// tests/cookie-consenso.test.js — Google ads need consent: nothing from Google before "Accept", banner logic, privacy text
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');
const { startSite, Client, makeAdmin } = require('./helpers');

/** Runs public/js/cookie_consent.js against a tiny fake browser and returns the pieces we need to look at. */
function browser({ cookie = '', ads = 'own', lang = 'it' } = {}) {
    const listeners = {};
    const elements = [];
    const doc = {
        cookie, documentElement: { lang }, body: { appendChild: (e) => elements.push(e) },
        addEventListener: (ev, fn) => { listeners[ev] = fn; },
        querySelector: (sel) => (sel === 'meta[name="vb-ads"]' && ads ? { getAttribute: () => ads } : null),
        querySelectorAll: () => [],
        createElement: (tag) => ({ tag, children: [], style: {}, setAttribute() {}, addEventListener(ev, fn) { this.on = this.on || {}; this.on[ev] = fn; },
            appendChild(c) { this.children.push(c); return c; }, get parentNode() { return null; } }),
    };
    // a cookie jar that behaves like document.cookie for the one cookie we write
    let jar = cookie;
    Object.defineProperty(doc, 'cookie', { get: () => jar, set: (v) => { const [kv, ...attrs] = v.split(';'); const [k, val] = kv.split('='); if (attrs.some((a) => a.trim() === 'max-age=0')) jar = jar.split('; ').filter((c) => !c.startsWith(k + '=')).join('; '); else jar = jar.split('; ').filter((c) => c && !c.startsWith(k + '=')).concat(`${k}=${val}`).join('; '); } });
    const win = { location: { protocol: 'https:', pathname: '/pages/giochi.php', reload() { win.reloaded = true; } } };
    const ctx = vm.createContext({ window: win, document: doc, location: win.location, Date, JSON, decodeURIComponent, encodeURIComponent, RegExp });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/cookie_consent.js'), 'utf8'), ctx);
    return { win, doc, elements, boot: () => listeners.DOMContentLoaded && listeners.DOMContentLoaded(), jar: () => jar };
}
const find = (el, pred) => (pred(el) ? el : (el.children || []).map((c) => find(c, pred)).find(Boolean));

test.describe('consent logic (browser script)', () => {
    const now = Date.now();
    const cookieFor = (obj) => 'vb_consent=' + encodeURIComponent(JSON.stringify(obj));

    test('a valid choice is read back; missing, damaged or older than 6 months means "ask again"', () => {
        const b = browser();
        const parse = b.win.VBConsent._parse;
        assert.deepEqual({ ...parse(encodeURIComponent(JSON.stringify({ v: 1, ads: true, t: now })), now) }, { ads: true, t: now });
        assert.equal(parse(encodeURIComponent(JSON.stringify({ v: 1, ads: false, t: now })), now).ads, false);
        assert.equal(parse(encodeURIComponent(JSON.stringify({ v: 1, ads: true, t: now - 181 * 86400000 })), now), null);
        assert.equal(parse('%7Bbroken', now), null);
        assert.equal(parse(null, now), null);
        assert.equal(parse(encodeURIComponent(JSON.stringify({ v: 2, ads: true, t: now })), now), null);
    });

    test('the banner shows on an ad page with no decision, and not when ads are off, decided, or Google asks instead', () => {
        const shown = (opts) => { const b = browser(opts); b.boot(); return b.elements.length > 0; };
        assert.equal(shown({ ads: 'own' }), true);
        assert.equal(shown({ ads: '' }), false);                                           // a page without ads
        assert.equal(shown({ ads: 'google' }), false);                                     // Google's own message in charge
        assert.equal(shown({ ads: 'own', cookie: cookieFor({ v: 1, ads: false, t: now }) }), false);
        assert.equal(shown({ ads: 'own', cookie: cookieFor({ v: 1, ads: true, t: now - 200 * 86400000 }) }), true);
    });

    test('Reject and Accept are the same kind of button, nothing is pre-chosen, and each remembers its answer', () => {
        const b = browser({ ads: 'own' });
        b.boot();
        const box = b.elements[0];
        const row = find(box, (e) => e.className === 'vb-row');
        assert.equal(row.children.length, 2);
        const [no, yes] = row.children;
        assert.equal(no.tag, 'button'); assert.equal(yes.tag, 'button');
        assert.equal(no.textContent, 'Rifiuta'); assert.equal(yes.textContent, 'Accetta');
        assert.equal(b.win.VBConsent.get(), null);                       // nothing stored before a click
        const seen = [];
        b.win.VBConsent.onChange((c) => seen.push(c.ads));
        yes.on.click();
        assert.equal(b.win.VBConsent.has('ads'), true);
        assert.deepEqual(seen, [true]);
        assert.match(b.jar(), /vb_consent=/);
    });

    test('rejecting (after accepting) reloads the page so the ad scripts stop', () => {
        const b = browser({ ads: 'own', cookie: cookieFor({ v: 1, ads: true, t: now }) });
        b.boot();
        b.win.VBConsent.open();
        const row = find(b.elements[0], (e) => e.className === 'vb-row');
        row.children[0].on.click();
        assert.equal(b.win.VBConsent.has('ads'), false);
        assert.equal(b.win.reloaded, true);
    });
});

test.describe('ads in the HTML: nothing from Google before consent', () => {
    let site, admin;
    test.before(async () => {
        site = await startSite({ ADSENSE_CLIENT: 'ca-pub-1234567890123456', ADSENSE_SLOT_GAMES: '1234567890', ADSENSE_SLOT_SUPPORT: '1234567891' });
        admin = await makeAdmin(site, 'ck_admin');
    });
    test.after(async () => { await site.stop(); });

    test('the page holds our two scripts and the marker, no Google script, and the unit starts hidden', async () => {
        const html = await (await fetch(`${site.base}/pages/ads.php?lang=it`)).text();
        assert.match(html, /<meta name="vb-ads" content="own">/);
        assert.match(html, /js\/cookie_consent\.js/);
        assert.match(html, /js\/ads\.js[^>]*data-client="ca-pub-1234567890123456" data-cmp="own"/);
        assert.ok(!html.includes('pagead2.googlesyndication.com'), 'no Google script in the page');
        assert.ok(!html.includes('fundingchoicesmessages'), 'no Google message either');
        assert.match(html, /<aside class="ad-slot" hidden/);
        assert.match(html, /data-vb-cookie>Cookie</);                                   // the way back to the choice
    });

    test('the admin sees no ads, no banner marker and no cookie link', async () => {
        const html = (await admin.get('/pages/ads.php?lang=it')).text;
        assert.ok(!html.includes('vb-ads') && !html.includes('ad-slot') && !html.includes('data-vb-cookie'));
    });

    test('the privacy page explains the choice and offers the button; the games page carries the cookie link', async () => {
        const html = await (await fetch(`${site.base}/pages/privacy.php?lang=it`)).text();
        assert.match(html, /non carica nulla da Google/);
        assert.match(html, /<button type="button" data-vb-cookie>/);
        assert.match(html, /Statistiche:<\/strong> il sito non usa Google Analytics/);
        assert.match(await (await fetch(`${site.base}/pages/giochi.php?lang=it`)).text(), /data-vb-cookie>Cookie</);
    });

    test('with Google\'s own message in charge the marker says so', async () => {
        const s2 = await startSite({ ADSENSE_CLIENT: 'ca-pub-1234567890123456', ADSENSE_SLOT_SUPPORT: '1234567891', ADSENSE_CMP: 'google' });
        try {
            const html = await (await fetch(`${s2.base}/pages/ads.php`)).text();
            assert.match(html, /<meta name="vb-ads" content="google">/);
            assert.match(html, /data-cmp="google"/);
        } finally { await s2.stop(); }
    });

    test('ads off: no marker, no banner, no cookie link', async () => {
        const s3 = await startSite();
        try {
            const html = await (await fetch(`${s3.base}/pages/giochi.php?lang=it`)).text();
            assert.ok(!html.includes('vb-ads') && !html.includes('data-vb-cookie') && !html.includes('ads.js'));
            assert.ok(!(await (await fetch(`${s3.base}/pages/privacy.php?lang=it`)).text()).includes('<button type="button" data-vb-cookie>'));
        } finally { await s3.stop(); }
    });
});
