// tests/concorrenza.test.js — many requests at once must not end in "database is locked" (HTTP 500)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client } = require('./helpers');

test('spia: parallel polls of the same room never get a 500', async () => {
    const site = await startSite();
    try {
        const c = await new Client(site).init();
        const made = await c.post('/api/spia.php', { action: 'create', game: 'spia', players: ['A', 'B', 'C'], settings: {} });
        assert.equal(made.status, 200, made.text);
        const token = made.json.token;
        const poll = async () => (await fetch(`${site.base}/api/spia.php?action=state`, { headers: { 'X-Spia-Device': token, Cookie: c.cookieHeader() } })).status;
        const results = (await Promise.all(Array.from({ length: 8 }, async () => { const out = []; for (let i = 0; i < 25; i++) out.push(await poll()); return out; }))).flat();
        const bad = results.filter((s) => s !== 200);
        assert.deepEqual(bad, [], `${bad.length} of ${results.length} polls failed`);
    } finally { await site.stop(); }
});

test('poker: parallel plays on a live table never get a 500', async () => {
    const site = await startSite();
    try {
        const c = new Client(site); await c.register('cc_poker');
        const form = (q, fields) => fetch(`${site.base}/api/poker.php?${q}`, { method: 'POST', body: new URLSearchParams(fields), headers: { Cookie: c.cookieHeader(), 'X-CSRF-Token': c.csrf } }).then((r) => r.status);
        assert.equal(await form('action=join&table_id=general', {}), 200);
        const statuses = [];
        await Promise.all(Array.from({ length: 6 }, async () => {
            for (let i = 0; i < 12; i++) {
                statuses.push(await form('action=deal&table_id=general', {}));
                statuses.push(await form('action=play&table_id=general', { user_action: 'call' }));
                statuses.push((await fetch(`${site.base}/api/poker.php?action=state&table_id=general`, { headers: { Cookie: c.cookieHeader() } })).status);
            }
        }));
        assert.deepEqual(statuses.filter((s) => s >= 500), [], 'no server errors');
    } finally { await site.stop(); }
});
