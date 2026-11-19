// tests/temi.test.js — the desktop themes: one list (js/theme.js and api/helpers.php agree), saved on the account,
// the same everywhere (menu, terminal, settings), default monochrome; index without night/high-contrast, with the matrix switch
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startSite, Client, REPO } = require('./helpers');

let site, ana, guest;
const themeOf = (name) => site.db('SELECT theme FROM accounts WHERE username = ?', [name])[0].theme;
const save = (c, theme) => c.post('/api/save_theme.php', { theme });

test.before(async () => {
    site = await startSite();
    ana = new Client(site); await ana.register('tm_ana');
    guest = new Client(site);
});
test.after(() => site.stop());

test('the JavaScript list and the PHP list have the same themes, and each has every colour', () => {
    const js = fs.readFileSync(path.join(REPO, 'public/js/theme.js'), 'utf8');
    const ids = [...js.matchAll(/^\s{8}(\w+):\s+\{ label:/gm)].map((m) => m[1]);
    const php = fs.readFileSync(path.join(REPO, 'public/api/helpers.php'), 'utf8');
    const block = php.slice(php.indexOf('const SYSTEM_THEMES'), php.indexOf('const DEFAULT_SYSTEM_THEME'));
    const phpIds = [...block.matchAll(/'(\w+)' => '/g)].map((m) => m[1]);
    assert.deepEqual([...ids].sort(), [...phpIds].sort());
    assert.ok(ids.length >= 15, 'more themes than before');
    assert.equal(ids[0], 'monochrome');
    for (const line of js.split('\n').filter((l) => /\{ label:/.test(l))) {
        for (const k of ['bg', 'accent', 'muted', 'prompt', 'panel', 'matrix']) assert.match(line, new RegExp(`${k}: `), `${k} missing in: ${line.trim().slice(0, 30)}`);
    }
});

test('a new account starts with the monochrome theme; the choice is saved on the account and shows in the page', async () => {
    assert.equal(themeOf('tm_ana'), 'monochrome');
    let html = await (await fetch(`${site.base}/desktop.php`, { headers: { Cookie: ana.cookieHeader() } })).text();
    assert.match(html, /<meta name="vb-theme" content="monochrome">/);
    const r = await save(ana, 'tokyonight');
    assert.equal(r.json.success, true);
    assert.equal(themeOf('tm_ana'), 'tokyonight');
    html = await (await fetch(`${site.base}/desktop.php`, { headers: { Cookie: ana.cookieHeader() } })).text();
    assert.match(html, /<meta name="vb-theme" content="tokyonight">/);
    assert.match(html, /<option value="tokyonight" selected>/);
    // another device = another session of the same account: it gets the same theme
    const other = new Client(site); await other.login('tm_ana', 'password123');
    html = await (await fetch(`${site.base}/desktop.php`, { headers: { Cookie: other.cookieHeader() } })).text();
    assert.match(html, /<meta name="vb-theme" content="tokyonight">/);
});

test('unknown themes are refused, reader themes never overwrite the desktop theme, guests cannot save', async () => {
    const bad = await save(ana, 'nonesiste');
    assert.equal(bad.status, 400);
    const reader = await save(ana, 'sepia');
    assert.equal(reader.json.success, true);
    assert.equal(reader.json.stored, false);
    assert.equal(themeOf('tm_ana'), 'tokyonight');
    const g = await save(guest, 'nord');
    assert.equal(g.status, 401);
});

test('the account settings page offers the same themes', async () => {
    const html = await (await fetch(`${site.base}/pages/account.php`, { headers: { Cookie: ana.cookieHeader() } })).text();
    for (const id of ['monochrome', 'catppuccin', 'solarized', 'rosepine', 'ice']) assert.match(html, new RegExp(`<option value="${id}"`));
    assert.match(html, /id="rice-selector"/);
});

test('the desktop menu: no night mode and no high contrast; matrix switch and theme list; scanlines only on the desktop', async () => {
    const html = await (await fetch(`${site.base}/desktop.php`)).text();
    assert.doesNotMatch(html, /MODE: NIGHT|theme-toggle|contrast-toggle|HIGH CONTRAST/);
    assert.match(html, /id="matrix-toggle"/);
    assert.match(html, /id="glass-toggle"/);
    assert.match(html, /Monochrome \(default\)/);
    assert.doesNotMatch(html, /Monocromatico|predefinito/);
    assert.match(html, /id="scanline-toggle"/);
    assert.match(html, /<body class="home">/);
    const css = fs.readFileSync(path.join(REPO, 'public/css/components.css'), 'utf8');
    assert.match(css, /body\.home\.scanlines-active::before/);
    assert.doesNotMatch(css, /(^|\n)body\.scanlines-active::before/);
    const base = fs.readFileSync(path.join(REPO, 'public/css/base.css'), 'utf8');
    assert.doesNotMatch(base, /high-contrast/);
});
