// tests/idea-to-board.test.js — admin puts an idea on the public board ("idea-<id>"), kept in sync, never with the author.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client, makeAdmin } = require('./helpers');

let site, admin, ann;
test.before(async () => {
    site = await startSite();
    admin = await makeAdmin(site, 'tb_admin');
    ann = new Client(site);
    await ann.register('tb_ann');
});
test.after(() => site.stop());

const board = async () => (await new Client(site).init().then(c => c.get('/api/news.php'))).json.items;
const idea = async (text) => {
    await ann.post('/api/news_ideas.php', { text });
    return (await ann.get('/api/news_ideas.php')).json.ideas.find(i => i.text === text).id;
};

test('to_board is admin + CSRF only, and needs a reviewed idea', async () => {
    const id = await idea('A very long idea about a tournament mode for the arcade games, with brackets');
    assert.equal((await ann.post('/api/news_ideas.php', { action: 'to_board', id })).status, 403);
    assert.equal((await admin.post('/api/news_ideas.php', { action: 'to_board', id }, { csrf: false })).status, 403);
    assert.equal((await admin.post('/api/news_ideas.php', { action: 'to_board', id })).status, 400);   // still "new"
    assert.equal((await admin.post('/api/news_ideas.php', { action: 'to_board', id: 99999 })).status, 404);
});

test('idempotent, status mapping, sync, removal, no author, GET flag', async () => {
    const text = 'A very long idea about a bright theme for the whole site, with many colours';
    const id = await idea(text);
    await admin.post('/api/news_ideas.php', { action: 'set', id, status: 'considering' });
    const flag = () => admin.get('/api/news_ideas.php').then(r => r.json.ideas.find(i => i.id === id).on_board);
    assert.equal(await flag(), false);
    assert.equal((await admin.post('/api/news_ideas.php', { action: 'to_board', id })).json.slug, 'idea-' + id);
    await admin.post('/api/news_ideas.php', { action: 'to_board', id, title_en: 'Bright theme', title_it: 'Tema chiaro' });
    let items = (await board()).filter(i => i.slug === 'idea-' + id);
    assert.equal(items.length, 1);
    assert.equal(items[0].status, 'planned');
    assert.equal(items[0].kind, 'feature');
    assert.equal(items[0].title.it, 'Tema chiaro');
    assert.equal(items[0].body.en, text);
    assert.equal(await flag(), true);
    assert.equal((await ann.get('/api/news_ideas.php')).json.ideas[0].on_board, undefined);
    // default titles: first 60 characters
    const id2 = await idea('Another idea that is long enough to be cut at sixty characters for the title');
    await admin.post('/api/news_ideas.php', { action: 'set', id: id2, status: 'planned' });
    await admin.post('/api/news_ideas.php', { action: 'to_board', id: id2 });
    assert.equal((await board()).find(i => i.slug === 'idea-' + id2).title.en.length, 60);
    // sync
    await admin.post('/api/news_ideas.php', { action: 'set', id, status: 'done' });
    items = (await board()).filter(i => i.slug === 'idea-' + id);
    assert.equal(items[0].status, 'done');
    assert.ok(items[0].done_at);
    await admin.post('/api/news_ideas.php', { action: 'set', id, status: 'planned' });
    assert.equal((await board()).find(i => i.slug === 'idea-' + id).status, 'planned');
    // an idea not on the board stays off when its status changes
    const id3 = await idea('Third idea, long enough, that the admin never puts on the board');
    await admin.post('/api/news_ideas.php', { action: 'set', id: id3, status: 'done' });
    assert.ok(!(await board()).some(i => i.slug === 'idea-' + id3));
    // no author anywhere on the public board
    const raw = JSON.stringify(await board());
    assert.ok(!raw.includes('tb_ann') && !raw.includes('user_id'));
    // declined: gone from the board, flag false
    await admin.post('/api/news_ideas.php', { action: 'set', id, status: 'declined' });
    assert.ok(!(await board()).some(i => i.slug === 'idea-' + id));
    assert.equal(await flag(), false);
    // log keeps the whitelist only
    const log = JSON.stringify(site.db("SELECT detail FROM admin_log WHERE action = 'to_board'"));
    assert.ok(log.includes('to_board') && !log.includes('Bright theme'));
});

test('a short idea fills the title only: no identical second line on the board', async () => {
    const id = await idea('Add dark mode');
    await admin.post('/api/news_ideas.php', { action: 'set', id, status: 'planned' });
    await admin.post('/api/news_ideas.php', { action: 'to_board', id });
    const it = (await board()).find(i => i.slug === 'idea-' + id);
    assert.equal(it.title.en, 'Add dark mode');
    assert.ok(!it.body.en && !it.body.it);
});
