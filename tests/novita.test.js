// tests/novita.test.js — the news board: public read, admin-only write, bilingual fallback, finishing an item.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client, makeAdmin } = require('./helpers');

let site, admin, user;
test.before(async () => {
    site = await startSite();
    admin = await makeAdmin(site, 'nv_admin');
    user = new Client(site);
    await user.register('nv_user');
});
test.after(() => site.stop());

test('the board is public to read, but only an admin with CSRF writes', async () => {
    assert.equal((await new Client(site).init().then(c => c.get('/api/news.php'))).json.success, true);
    assert.equal((await user.post('/api/news.php', { slug: 'abc', title_en: 'x' })).status, 403);
    assert.equal((await admin.post('/api/news.php', { slug: 'abc', title_en: 'x' }, { csrf: false })).status, 403);
});

test('create, update with a note, finish; one language fills the other', async () => {
    let r = await admin.post('/api/news.php', { slug: 'news-board', title_en: 'News board', status: 'doing', progress: 40, note_it: 'Pagina fatta' });
    assert.equal(r.json.success, true);
    let it = (await user.get('/api/news.php')).json.items.find(i => i.slug === 'news-board');
    assert.equal(it.title.it, 'News board');
    assert.equal(it.progress, 40);
    assert.equal(it.updates[0].en, 'Pagina fatta');
    r = await admin.post('/api/news.php', { slug: 'news-board', status: 'done', version: 'v9' });
    it = (await user.get('/api/news.php')).json.items.find(i => i.slug === 'news-board');
    assert.equal(it.status, 'done');
    assert.equal(it.progress, 100);
    assert.ok(it.done_at);
});

test('bad input is refused; hidden items never reach the public', async () => {
    assert.equal((await admin.post('/api/news.php', { slug: 'Bad Slug!' })).status, 400);
    assert.equal((await admin.post('/api/news.php', { slug: 'nokind', title_en: 'x', kind: 'zzz' })).status, 400);
    assert.equal((await admin.post('/api/news.php', { slug: 'secret', title_en: 's', is_public: false })).json.success, true);
    assert.ok(!(await user.get('/api/news.php')).json.items.some(i => i.slug === 'secret'));
});

test('the page renders in both languages', async () => {
    const en = await user.get('/pages/novita.php?lang=en');
    assert.match(en.text, /Working on it now/);
    assert.match((await user.get('/pages/novita.php?lang=it')).text, /In lavorazione adesso/);
});

test('a script with NEWS_TOKEN can write without a session; a wrong token cannot', async () => {
    const s2 = await startSite({ NEWS_TOKEN: 'x'.repeat(30) });
    try {
        const c = await new Client(s2).init();
        const ok = await fetch(s2.base + '/api/news.php', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-News-Token': 'x'.repeat(30) }, body: JSON.stringify({ slug: 'via-token', title_en: 'T' }) });
        assert.equal((await ok.json()).success, true);
        const bad = await fetch(s2.base + '/api/news.php', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-News-Token': 'y'.repeat(30) }, body: JSON.stringify({ slug: 'nope', title_en: 'T' }) });
        assert.equal(bad.status, 403);
        assert.ok((await c.get('/api/news.php')).json.items.some(i => i.slug === 'via-token'));
    } finally { s2.stop(); }
});

test('ideas box: accounts only, CSRF, limits, own list, admin answers, delete by the author', async () => {
    const guest = await new Client(site).init();
    assert.equal((await guest.get('/api/news_ideas.php')).status, 401);
    assert.equal((await guest.post('/api/news_ideas.php', { text: 'a guest idea for the site' })).status, 401);
    assert.equal((await user.post('/api/news_ideas.php', { text: 'an idea without a token' }, { csrf: false })).status, 403);
    assert.equal((await user.post('/api/news_ideas.php', { text: 'short' })).status, 400);
    assert.equal((await user.post('/api/news_ideas.php', { text: 'x'.repeat(501) })).status, 400);
    const add = await user.post('/api/news_ideas.php', { text: 'A  chess page,​ with daily puzzles <b>please</b>' });
    assert.equal(add.json.success, true);
    const other = new Client(site); await other.register('nv_other');
    assert.equal((await other.get('/api/news_ideas.php')).json.ideas.length, 0);      // nobody else's ideas
    let mine = (await user.get('/api/news_ideas.php')).json;
    assert.equal(mine.ideas[0].status, 'new');
    assert.equal(mine.ideas[0].username, null);
    assert.ok(!mine.ideas[0].text.includes('​'));
    const id = mine.ideas[0].id;
    assert.equal((await user.post('/api/news_ideas.php', { action: 'set', id, status: 'planned' })).status, 403);   // not an admin
    assert.equal((await admin.post('/api/news_ideas.php', { action: 'set', id, status: 'planned', reply: 'Good one!' })).json.success, true);
    mine = (await user.get('/api/news_ideas.php')).json;
    assert.equal(mine.ideas[0].status, 'planned');
    assert.equal(mine.ideas[0].reply, 'Good one!');
    const all = (await admin.get('/api/news_ideas.php')).json;
    assert.equal(all.admin, true);
    assert.equal(all.ideas[0].username, 'nv_user');
    await other.post('/api/news_ideas.php', { action: 'delete', id });                // not the author: nothing happens
    assert.equal((await user.get('/api/news_ideas.php')).json.ideas.length, 1);
    await user.post('/api/news_ideas.php', { action: 'delete', id });
    assert.equal((await user.get('/api/news_ideas.php')).json.ideas.length, 0);
});

test('ideas box: 5 a day per person', async () => {
    const u = new Client(site); await u.register('nv_spammer');
    for (let i = 0; i < 5; i++) assert.equal((await u.post('/api/news_ideas.php', { text: 'idea number ' + i + ' for the site' })).json.success, true);
    assert.equal((await u.post('/api/news_ideas.php', { text: 'idea number six for the site' })).status, 429);
});
