// tests/accessibilita.test.js — the basics found by the automatic accessibility check (axe-core, 36 pages): kept from coming back
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startSite, Client, makeAdmin } = require('./helpers');

const PUB = path.join(__dirname, '..', 'public');
const ARCADE = ['tris', 'forza4', 'impiccato', 'memory', 'simon', 'snake', 'minato', 'dueamila', 'tetris', 'parola', 'vita', 'difesa', 'skillcheck'];

let site;
test.before(async () => { site = await startSite(); });
test.after(() => site.stop());

test('arcade pages: one main landmark around the game, a level-one heading, a language and nothing that breaks the layout', () => {
    for (const g of ARCADE) {
        const html = fs.readFileSync(path.join(PUB, 'pages', g + '.html'), 'utf8');
        assert.equal((html.match(/<main[\s>]/g) || []).length, 1, g + ': one <main>');
        assert.match(html, /<h1[\s>]/, g + ': an h1');
        assert.match(html, /<html lang="en"/, g);
    }
    for (const css of ['arcade.css', 'minato.css', 'dueamila.css']) assert.match(fs.readFileSync(path.join(PUB, 'css', css), 'utf8'), /\.ar-main \{ display: contents; \}/, css + ' keeps the layout');
});

test('the language buttons are named starting with their visible letters (EN – English, IT – Italiano)', () => {
    for (const f of ['js/i18n.js', 'js/dungeon.js']) assert.match(fs.readFileSync(path.join(PUB, f), 'utf8'), /l\.toUpperCase\(\) \+ ' – ' \+ \(l === 'it' \? 'Italiano' : 'English'\)/, f);
    for (const f of ['js/spia/app.js', 'js/nonhomai/app.js']) assert.match(fs.readFileSync(path.join(PUB, f), 'utf8'), /'aria-label': lang\.toUpperCase\(\) \+ ' – ' \+ t\('language'\)/, f);
});

test('2048: the grid is a group (a grid role needs rows) and empty tiles are hidden from screen readers', () => {
    assert.match(fs.readFileSync(path.join(PUB, 'pages', 'dueamila.html'), 'utf8'), /id="db-grid" role="group"/);
    const js = fs.readFileSync(path.join(PUB, 'js', 'dueamila.js'), 'utf8');
    assert.ok(!js.includes("setAttribute('aria-label', v ?") && js.includes("setAttribute('aria-hidden', 'true')"));
});

test('pages that had no level-one heading now have one (desktop, statistics, library, solitaire)', async () => {
    const admin = await makeAdmin(site, 'a11y_admin');
    site.db("UPDATE accounts SET can_read_books = 1 WHERE username = 'a11y_admin'");
    for (const p of ['/desktop.php', '/pages/stats.php', '/pages/reader.php']) {
        const r = await admin.get(p);
        assert.equal(r.status, 200, p);
        assert.match(r.text, /<h1[\s>]/, p + ' has an h1');
    }
    assert.match(fs.readFileSync(path.join(PUB, 'pages', 'solitario.html'), 'utf8'), /<h1 class="sr-only" id="sol-h1">/);
    const reader = (await admin.get('/pages/reader.php')).text;
    assert.equal((reader.match(/<main[\s>]/g) || []).length, 1, 'library: one main');
    assert.match(reader, /class="reader-brand"[^>]*aria-label="[^"]+"/, 'the brand link has a name');
    for (const lib of ['jszip.min.js', 'pdf.min.js', 'epub.min.js']) assert.match(reader, new RegExp(`<script defer src="[^"]*${lib.replace('.', '\\.')}`), lib + ' does not block the page');
});

test('the Botola credit is a footer landmark; the leaderboard and language bar are placed inside main', () => {
    assert.match(fs.readFileSync(path.join(PUB, 'pages', 'botola.html'), 'utf8'), /<footer class="bo-credit">[\s\S]*<\/footer>/);
    assert.match(fs.readFileSync(path.join(PUB, 'js', 'arcade-scores.js'), 'utf8'), /document\.querySelector\('\.ar-main'\)/);
    assert.match(fs.readFileSync(path.join(PUB, 'js', 'i18n.js'), 'utf8'), /\(doc\.querySelector\('main'\) \|\| doc\.body\)\.appendChild\(host\)/);
});
