// tests/dungeon-i18n.test.js — The Server Dungeon in English and Italian: every text exists in both, placeholders match, no language mix-ups
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { looksItalian, looksEnglish } = require('./lang-helpers');
const { startSite } = require('./helpers');
const dir = path.join(__dirname, '..', 'public', 'js', 'rogue');
const MOBS = require(path.join(dir, 'mobs.js')), ITEMS = require(path.join(dir, 'items.js')), CLS = require(path.join(dir, 'classes.js')),
    META = require(path.join(dir, 'meta.js')), TX = require(path.join(dir, 'text.js')), G = require(path.join(dir, 'game.js'));

require(path.join(dir, 'text-bot.js'));    // the watch-the-bot texts join text.js's MSG, like in the page
const ph = (t) => (String(t).match(/\{\w+\}/g) || []).sort().join(',');
const words = (t) => String(t).trim().split(/\s+/).length;
/** Every { en, it } text of the data tables, with a label. `same` = may be identical in both languages (proper names, commands). */
function texts() {
    const out = [];
    const add = (label, v) => { if (v !== undefined) out.push([label, v]); };
    for (const d of MOBS.LIST) { add('mob ' + d.id + ' name', d.name); add('mob ' + d.id + ' info', d.info); if (d.ranged) add('mob ' + d.id + ' verb', d.ranged.verb); }
    for (const d of MOBS.SECTORS) { add('sector ' + d.id + ' name', d.name); add('sector ' + d.id + ' intro', d.intro); }
    for (const d of MOBS.TRAPS) add('trap ' + d.id, d.name);
    for (const d of ITEMS.LIST) { add('item ' + d.id + ' name', d.name); add('item ' + d.id + ' info', d.info); }
    for (const k in ITEMS.CATS) { add('cat ' + k, ITEMS.CATS[k].name); if (ITEMS.CATS[k].unk) add('cat unk ' + k, ITEMS.CATS[k].unk); }
    for (const k in ITEMS.LOOKS) ITEMS.LOOKS[k].forEach((l, i) => add('look ' + k + i, l[0]));
    for (const c of CLS.CLASSES) { add('class ' + c.id + ' name', c.name); add('class ' + c.id + ' info', c.info); add('class ' + c.id + ' skill', c.active.name); add('class ' + c.id + ' skillinfo', c.active.info); }
    for (const d of CLS.SKILLS) { add('skill ' + d.id + ' name', d.name); add('skill ' + d.id + ' info', d.info); }
    for (const d of META.UPGRADES) { add('upgrade ' + d.id + ' name', d.name); add('upgrade ' + d.id + ' info', d.info); }
    for (const d of META.MEDALS) { add('medal ' + d.id + ' name', d.name); add('medal ' + d.id + ' info', d.info); }
    for (const k in TX.MSG) add('msg ' + k, TX.MSG[k]);
    return out;
}

test('every data text exists in both languages, non-empty, with the same placeholders', () => {
    for (const [label, v] of texts()) {
        if (typeof v === 'string') continue;                              // a plain string = same in both languages (file names)
        assert.ok(v && typeof v === 'object', label);
        assert.ok(v.en && v.en.trim() && v.it && v.it.trim(), label + ' has both languages');
        assert.equal(ph(v.en), ph(v.it), label + ' placeholders');
    }
});

test('texts of 5+ words differ between the languages and each reads as its own language', () => {
    for (const [label, v] of texts()) {
        if (typeof v !== 'object' || words(v.en) < 5) continue;
        if (!/^msg (title|desc|h1)$|^msg (m_|sector_intro)/.test(label)) assert.notEqual(v.en, v.it, label + ' is not translated');
        assert.ok(!looksItalian(v.en), label + ' English reads as Italian: ' + v.en);
        assert.ok(!looksEnglish(v.it), label + ' Italian reads as English: ' + v.it);
    }
});

test('monsters, items, classes, skills, medals and upgrades are translated (different texts, except proper names)', () => {
    const SAME = new Set(['Plugin', 'Script', 'ROOT', 'Kernel', 'Router', 'Switch', 'Cloud', 'Mainframe', 'Root', 'Firewall', 'Backup', 'Cache', 'AdBlock', 'Antivirus', 'Overclock', 'DDoS', 'Sniffer', 'Spooler',
        'Bug', 'Sudoer', 'Spam', 'Phishing', 'Container', 'Rootkit', 'Redirect', 'Deadlock', 'Honeypot', 'Interrupt', 'Hacker', 'Designer', 'Menu', 'man', 'sudo', 'ping', 'Max', 'Dark Mode', 'Power Bank', 'Fork Bomb', 'Race Condition', 'Memory Leak', 'Brute Force', 'Kernel Panic', 'Data leak', 'Vendor Lock-in', 'Man in the Middle', 'Port Scanner', 'Sync Loop', 'Spot Instance', 'Latency', 'Zombie Process', 'Segmentation Fault']);
    let differ = 0, total = 0;
    for (const [label, v] of texts()) {
        if (typeof v !== 'object' || !/ info$| intro$/.test(label)) continue;
        total++;
        if (v.en !== v.it) differ++; else assert.ok(SAME.has(v.en) || words(v.en) < 3, label + ' not translated: ' + v.en);
    }
    assert.ok(total > 200 && differ / total > 0.97, differ + '/' + total);
    for (const d of [...MOBS.LIST, ...ITEMS.LIST, ...CLS.CLASSES, ...CLS.SKILLS, ...META.UPGRADES, ...META.MEDALS]) assert.ok(d.name.en && d.name.it, d.id);
});

test('every message key used by the engine and the page exists in text.js', () => {
    const used = new Set();
    for (const f of [path.join(dir, 'game.js'), path.join(__dirname, '..', 'public', 'js', 'dungeon.js')]) {
        const src = fs.readFileSync(f, 'utf8');
        for (const m of src.matchAll(/\b(?:log|note)\(s?,? ?'(\w+)'/g)) used.add(m[1]);
        for (const m of src.matchAll(/\bmsg\('(\w+)'/g)) used.add(m[1]);
        for (const m of src.matchAll(/\b(?:tl|t)\('(\w+)'/g)) used.add(m[1]);
        for (const m of src.matchAll(/'((?:tile|help|fs|b|st|menu|arch|end|bench|shop|hist|card|cause|fx|terminal|mob|dir)_\w+)'/g)) used.add(m[1]);
        for (const m of src.matchAll(/'(\w+_\w+)'\s*[:,)]/g)) if (TX.MSG[m[1]]) used.add(m[1]);
    }
    used.delete('key');
    for (const k of used) assert.ok(TX.MSG[k], 'missing message ' + k);
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'pages', 'dungeon.html'), 'utf8');
    for (const m of html.matchAll(/data-i18n(?:-attr)?="([^"]+)"/g)) for (const part of m[1].split(';')) { const k = part.includes(':') ? part.split(':')[1] : part; assert.ok(TX.MSG[k.trim()], 'html key ' + k); }
});

test('a played run only holds messages: the log reads in English and in Italian, with no leftover placeholder', () => {
    for (const seed of [3, 9, 14]) {
        const s = G.newGame(seed, 'studente');
        for (let i = 0; i < 300 && s.status === 'play'; i++) {
            if (s.p.pending) { G.act(s, { t: 'skill', id: s.p.choices[0] }); continue; }
            const v = G.exploreNext(s);
            G.act(s, v ? { t: 'move', dx: v[0], dy: v[1] } : { t: 'search' });
        }
        for (const l of s.log) {
            assert.ok(l.m, 'a message, not a sentence');
            const en = G.logText(l, 'en'), it = G.logText(l, 'it');
            assert.ok(en && it && !/\{\w+\}/.test(en + it), JSON.stringify(l));
            assert.ok(TX.MSG[l.m.k], l.m.k);
        }
        if (s.status !== 'play') assert.ok(G.text(s.cause, 'en') && G.text(s.cause, 'it'));
    }
});

test('a run saved before the translation (plain Italian log text) still loads and is shown as it is', () => {
    const s = G.newGame(4, 'hacker');
    s.log = [{ t: 'Sei Hacker. Scendi fino in fondo.', c: 'info' }]; s.cause = 'una botola';
    const back = G.load(G.save(s));
    assert.ok(back);
    assert.equal(G.logText(back.log[0], 'en'), 'Sei Hacker. Scendi fino in fondo.');
    assert.equal(G.text(back.cause, 'en'), 'una botola');
    const v = G.exploreNext(back); G.act(back, { t: 'move', dx: v[0], dy: v[1] });
    assert.ok(back.log.length >= 1);
});

test('item names: unknown things read in both languages and the same run keeps the same look', () => {
    const s = G.newGame(6, 'studente');
    const it = { k: 'd_forza', n: 1 };
    assert.match(G.itemName(s, it, 'en'), /can$/); assert.match(G.itemName(s, it, 'it'), /^Lattina /);
    s.known.d_forza = 1;
    assert.equal(G.itemName(s, it, 'en'), 'Vanilla Protein Shake'); assert.equal(G.itemName(s, it, 'it'), 'Proteine alla vaniglia');
});

test('the boss-key notes: many subjects, each complete in both languages, true to its language', () => {
    const { NOTES } = require(path.join(__dirname, '..', 'public', 'js', 'rogue', 'cover.js'));
    const { looksItalian, looksEnglish } = require('./lang-helpers');
    assert.ok(NOTES.length >= 10, 'at least ten subjects');
    assert.ok(new Set(NOTES.map((n) => n.subject.en)).size >= 8, 'several different subjects');
    for (const n of NOTES) {
        const texts = [n.subject, n.title, n.lead, n.box.h, n.box.t, ...n.points];
        assert.ok(n.points.length >= 4, n.title.en);
        for (const x of texts) assert.ok(x.en && x.it && x.en.trim() && x.it.trim(), n.title.en + ': both languages');
        assert.ok(!looksItalian(n.lead.en), 'English lead of ' + n.title.en);
        assert.ok(!looksEnglish(n.lead.it), 'Italian lead of ' + n.title.en);
        assert.notEqual(n.lead.en, n.lead.it);
    }
});

test('the dungeon page loads the notes script and the notes show a different subject each time the cover opens', async () => {
    const site = await startSite();
    try {
        const html = await (await fetch(`${site.base}/pages/dungeon.html`)).text();
        assert.match(html, /rogue\/cover\.js\?v=/);
        const { chromium } = (() => { try { return require('playwright'); } catch (e) { return {}; } })();
        if (!chromium) return;                                         // the browser check needs Playwright (installed locally, not a project dependency)
        const b = await chromium.launch();
        const p = await b.newPage();
        await p.goto(`${site.base}/pages/dungeon.html`);
        const seen = new Set();
        for (let i = 0; i < 8; i++) {
            await p.evaluate(() => { const c = document.getElementById('dg-cover'); c.hidden = true; c.hidden = false; });
            await p.waitForTimeout(30);
            seen.add(await p.evaluate(() => document.querySelector('#dg-cover h2').textContent));
        }
        await b.close();
        assert.ok(seen.size >= 4, 'subjects change: ' + [...seen].join(' | '));
    } finally { await site.stop(); }
});
