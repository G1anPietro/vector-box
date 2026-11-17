// tests/sicurezza-pagina.test.js — the public security page and /.well-known/security.txt (RFC 9116)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startSite } = require('./helpers');

test.describe('security page', () => {
    let site;
    test.before(async () => { site = await startSite({ SITE_URL: 'https://example.test' }); });
    test.after(async () => { await site.stop(); });

    test('served in Italian and in English, with the links it promises', async () => {
        const it = await fetch(`${site.base}/pages/sicurezza.php?lang=it`);
        assert.equal(it.status, 200);
        const itHtml = await it.text();
        assert.match(itHtml, /<html lang="it">/);
        assert.match(itHtml, /<h1>Sicurezza<\/h1>/);
        assert.match(itHtml, /id="segnala">Segnalare una vulnerabilità/);
        assert.match(itHtml, /Non ci sono ricompense in denaro/);

        const enHtml = await (await fetch(`${site.base}/pages/sicurezza.php?lang=en`)).text();
        assert.match(enHtml, /<html lang="en">/);
        assert.match(enHtml, /<h1>Security<\/h1>/);
        assert.match(enHtml, /id="segnala">Reporting a vulnerability/);
        assert.match(enHtml, /There are no money rewards/);

        for (const html of [itHtml, enHtml]) {
            assert.match(html, /href="privacy\.php"/);
            assert.match(html, /href="\.\.\/\.well-known\/security\.txt"/);
            assert.match(html, /href="\.\.\/index\.php"/);                    // where the Uplink form is
            assert.doesNotMatch(html, /mailto:/);                              // no CONTACT_EMAIL set: no address invented
            assert.match(html, /og:url" content="https:\/\/example\.test\/pages\/sicurezza\.php"/);
        }
    });

    test('CONTACT_EMAIL is shown when set; the CSP sentence follows CSP_ENFORCE', async () => {
        const s = await startSite({ CONTACT_EMAIL: 'sicurezza@example.test', CSP_ENFORCE: 'true' });
        try {
            const html = await (await fetch(`${s.base}/pages/sicurezza.php?lang=en`)).text();
            assert.match(html, /href="mailto:sicurezza@example\.test"/);
            assert.match(html, /It is enforced right now\./);
        } finally { await s.stop(); }
        assert.match(await (await fetch(`${site.base}/pages/sicurezza.php?lang=en`)).text(), /report-only/);
    });

    test('linked next to Privacy, and listed in the sitemap', async () => {
        for (const p of ['giochi.php', 'privacy.php', 'ads.php', 'dona.php', 'soldi.php', 'appunti-guida.php', 'progetto.php']) {
            assert.match(await (await fetch(`${site.base}/pages/${p}?lang=it`)).text(), /href="sicurezza\.php"/, p);
        }
        assert.ok((await (await fetch(`${site.base}/sitemap.php`)).text()).includes('https://example.test/pages/sicurezza.php'));
    });

    test('security.txt is served and has the RFC 9116 fields, with Expires in the future', async () => {
        const r = await fetch(`${site.base}/.well-known/security.txt`);
        assert.equal(r.status, 200);
        const txt = await r.text();
        const field = (name) => (txt.match(new RegExp(`^${name}: (.+)$`, 'm')) || [])[1];
        assert.match(field('Contact'), /^https:\/\/[^/]+\/pages\/sicurezza\.php/);
        assert.match(field('Canonical'), /^https:\/\/[^/]+\/\.well-known\/security\.txt$/);
        assert.match(field('Preferred-Languages'), /\bit\b.*\ben\b/);
        const expires = Date.parse(field('Expires'));
        assert.ok(expires > Date.now(), 'renew Expires in public/.well-known/security.txt (and keep it under a year ahead)');
        assert.ok(expires < Date.now() + 366 * 86400e3, 'Expires should be less than a year ahead (RFC 9116)');
        // the same domain as robots.txt (both are static: SITE_URL cannot reach them)
        const domain = fs.readFileSync(path.join(__dirname, '..', 'public', 'robots.txt'), 'utf8').match(/^Sitemap: (https:\/\/[^/]+)\//m)[1];
        for (const f of ['Contact', 'Canonical', 'Policy']) assert.ok(field(f).startsWith(domain + '/'), f);
    });
});
