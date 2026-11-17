// tests/statistiche-mappa.test.js — country lookup (local database), the map on the statistics page, bots highlighted
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { startSite, makeAdmin, REPO, Client } = require('./helpers');

const CSV = [
    '0.0.0.0,4.255.255.255,ZZ', '5.0.0.0,5.255.255.255,IT', '6.0.0.0,7.255.255.255,IT', '8.0.0.0,8.255.255.255,US',
    '10.0.0.0,10.255.255.255,ZZ', '60.0.0.0,60.255.255.255,JP', '255.0.0.0,255.255.255.255,AU',
    '2001:db8::,2001:db8:ffff:ffff:ffff:ffff:ffff:ffff,FR', '2a00::,2a00:ffff:ffff:ffff:ffff:ffff:ffff:ffff,IT',
].join('\n') + '\n';

const php = (code, ...args) => execFileSync('php', ['-r', `require ${JSON.stringify(path.join(REPO, 'public/api/geoip.php'))}; ${code}`, ...args], { encoding: 'utf8' });

test('the country database: built from the CSV, lookups for IPv4 and IPv6, holes and private addresses give nothing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-geo-'));
    const gz = path.join(dir, 'x.csv.gz'); fs.writeFileSync(gz, zlib.gzipSync(CSV));
    const bin = path.join(dir, 'g.bin');
    const out = php('[$a,$b]=geoipBuild($argv[1],$argv[2],1); echo "$a,$b";', gz, bin);
    assert.match(out, /^\d+,\d+$/);
    const look = (ip) => php('echo var_export(geoipLookup($argv[1], $argv[2]), true);', ip, bin);
    assert.equal(look('5.1.2.3'), "'IT'");
    assert.equal(look('7.255.255.255'), "'IT'", 'two adjacent ranges of one country are one record');
    assert.equal(look('8.8.8.8'), "'US'");
    assert.equal(look('60.1.1.1'), "'JP'");
    assert.equal(look('255.255.255.255'), "'AU'", 'the very last address');
    assert.equal(look('9.1.1.1'), 'NULL', 'a hole nobody owns');
    assert.equal(look('10.1.1.1'), 'NULL', 'ZZ = no information');
    assert.equal(look('2001:db8::1'), "'FR'");
    assert.equal(look('2a00:1450::1'), "'IT'");
    assert.equal(look('2001:4860::1'), 'NULL');
    assert.equal(look('not an address'), 'NULL');
    assert.equal(php('echo var_export(geoipLookup("5.1.2.3", "/nonexistent/g.bin"), true);'), 'NULL', 'no database yet: no crash');
    assert.throws(() => php('geoipBuild($argv[1], $argv[2]);', gz, path.join(dir, 'small.bin')), /too small/, 'a tiny CSV is refused by default');
});

test.describe('the statistics page', () => {
    let site, admin;
    const day = new Date().toISOString().slice(0, 10);
    test.before(async () => {
        site = await startSite();
        await fetch(site.base + '/api/get_feed.php');
        admin = await makeAdmin(site, 'st_admin');
        const d = path.join(site.root, 'data');
        const gz = path.join(d, 'x.csv.gz'); fs.writeFileSync(gz, zlib.gzipSync(CSV));
        execFileSync('php', ['-r', `require ${JSON.stringify(path.join(REPO, 'public/api/geoip.php'))}; geoipBuild($argv[1], $argv[2], 1);`, gz, path.join(d, 'geoip-country.bin')]);
        const t = (n) => `${day} 10:0${n}:00`;
        fs.writeFileSync(path.join(d, 'visits.log'), [
            [t(1), '5.1.1.1', '-', '/', 'Chrome / Windows', 'first', '-'],
            [t(2), '5.1.1.2', '-', '/', 'Safari / iPhone', 'first', '-'],
            [t(3), '8.8.8.8', 'ada', '/pages/giochi.php', 'Firefox / Linux', 'returning', 'google.com'],
        ].map((c) => c.join('\t')).join('\n') + '\n');
        fs.writeFileSync(path.join(d, 'bots.log'), [
            [t(4), '60.1.1.1', 'scanner', 'wp-login probe', '/wp-login.php', '444'],
            [t(5), '60.1.1.1', 'scanner', 'wp-login probe', '/xmlrpc.php', '444'],
            [t(6), '8.8.4.4', 'crawler', 'Googlebot', '/', '200'],
        ].map((c) => c.join('\t')).join('\n') + '\n');
    });
    test.after(async () => { await site.stop(); });

    test('admin only; the map has the countries, the counts, the table and the bots in red', async () => {
        const guest = await fetch(`${site.base}/pages/stats.php`);
        assert.equal(guest.status, 403);
        const r = await fetch(`${site.base}/pages/stats.php?days=7`, { headers: { Cookie: admin.cookieHeader() } });
        assert.equal(r.status, 200);
        const html = await r.text();
        assert.match(html, /<svg class="map"/);
        assert.match(html, /data-c="IT" data-h="2" data-b="0"/, 'two visits from Italy');
        assert.match(html, /data-c="US" data-h="1" data-b="1"/, 'one visit and one bot request from the US');
        assert.match(html, /data-c="JP" data-h="0" data-b="2"/, 'two bot requests from Japan');
        assert.match(html, /<tr class="row-bot"><td class="mono">60\.1\.1\.1<\/td>/, 'a bot address is a highlighted row');
        assert.match(html, /<span class="badge-bot">BOT<\/span> wp-login probe/);
        assert.match(html, /Indirizzi più attivi/);
        assert.match(html, /IP Geolocation by DB-IP/);
        assert.ok(html.includes('<span class="cc">IT</span>'));
        assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'no inline script');
    });

    test('without the database the page says how to get it, and does not break', async () => {
        fs.rmSync(path.join(site.root, 'data', 'geoip-country.bin'));
        const r = await fetch(`${site.base}/pages/stats.php`, { headers: { Cookie: admin.cookieHeader() } });
        assert.equal(r.status, 200);
        assert.match(await r.text(), /geoip-update\.php/);
    });
});

test('the world map file: the main countries are there and every path is closed', () => {
    const j = JSON.parse(fs.readFileSync(path.join(REPO, 'public/assets/stats/world.json'), 'utf8'));
    for (const cc of ['IT', 'US', 'FR', 'NO', 'RU', 'CN', 'AU', 'BR', 'ZA', 'CA', 'DE', 'ES', 'GB', 'IN', 'JP']) assert.ok(j.countries[cc], cc);
    assert.ok(Object.values(j.countries).every((c) => /^M[\d. MLZ-]+Z$/.test(c.d) && c.n));
});
