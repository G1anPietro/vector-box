// tests/errori-404.test.js — unknown paths get the 404 page; the home page and static error pages are untouched
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite } = require('./helpers');

test.describe('404 for unknown paths', () => {
    let site;
    test.before(async () => { site = await startSite(); });
    test.after(async () => { await site.stop(); });

    test('home page still answers 200 (with or without a query string)', async () => {
        for (const p of ['/', '/?x=1', '/index.php']) {
            const r = await fetch(site.base + p);
            assert.equal(r.status, 200, p);
            assert.ok(!(await r.text()).includes('SIGNAL_LOST'), p);
        }
    });

    test('an unknown path answers 404 with the error page', async () => {
        for (const p of ['/nonexistent', '/foo/bar', '/index.php/extra']) {
            const r = await fetch(site.base + p);
            assert.equal(r.status, 404, p);
            assert.match(await r.text(), /SIGNAL_LOST/, p);
        }
    });

    test('the error page assets are served', async () => {
        assert.equal((await fetch(`${site.base}/errors/errors.css`)).status, 200);
        assert.equal((await fetch(`${site.base}/errors/errors.js`)).status, 200);
    });
});
