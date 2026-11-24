// tools/a11y-audit.js — accessibility (axe-core) and simple speed measures of every page, on a clean copy of the site, phone-size Chromium.
//   one-off setup (not part of the project's dependencies):  mkdir /tmp/audit && cd /tmp/audit && npm i playwright-core axe-core
//   run it from that folder:  node /path/to/vector-box/tools/a11y-audit.js        (ONLY=/pages/a.html,/pages/b.html  limits the pages)
// Writes result.json next to where it is run. Last full run (v2.4.17x): 36 pages, 0 violations.
// accessibility (axe-core) + simple performance measures of every page, on a clean copy of the site, in a phone-size Chromium
const { chromium } = require('playwright-core');
const fs = require('fs');
const { startSite, Client, makeAdmin } = require('/home/user/vector-box/tests/helpers');
const axeSrc = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const exe = require('child_process').execSync("find ~/.cache/ms-playwright/chromium-1255 -maxdepth 3 -name chrome | head -1").toString().trim();

const GUEST = ['/', '/pages/giochi.php', '/pages/appunti.php', '/pages/wikipedia.php', '/pages/novita.php', '/pages/progetto.php', '/pages/come-funziona.php', '/pages/privacy.php', '/pages/sicurezza.php', '/pages/login.php', '/pages/ads.php',
  '/pages/tris.html', '/pages/forza4.html', '/pages/impiccato.html', '/pages/memory.html', '/pages/simon.html', '/pages/snake.html', '/pages/minato.html', '/pages/dueamila.html', '/pages/tetris.html', '/pages/parola.html', '/pages/vita.html', '/pages/difesa.html', '/pages/skillcheck.html', '/pages/botola.html', '/pages/solitario.html', '/pages/spia.html', '/pages/lupus.html', '/pages/cucu.html', '/pages/nonhomai.html', '/pages/dungeon.html', '/desktop.php', '/pages/classifiche.php'];
const USER = ['/pages/account.php', '/pages/reader.php'];
const ADMIN = ['/pages/stats.php'];

(async () => {
  const site = await startSite();
  const reader = await new Client(site).init(); await reader.register('audit_user');
  site.db("UPDATE accounts SET can_read_books = 1, can_upload_books = 1 WHERE username = 'audit_user'");
  site.db("INSERT INTO books (title, author, format, file_path, meta_checked) VALUES ('Libro di prova', 'Autore', 'pdf', '/x.pdf', 1)");
  const admin = await makeAdmin(site, 'audit_admin');
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  const results = [];
  async function run(paths, client) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, locale: 'it-IT' });
    if (client) await ctx.addCookies([...client.cookies].map(([name, value]) => ({ name, value, url: site.base })));
    for (const p of paths) {
      const page = await ctx.newPage();
      let bytes = 0, reqs = 0; const big = [];
      page.on('response', async (r) => { try { const b = (await r.body()).length; bytes += b; reqs++; if (b > 150000) big.push([r.url().replace(site.base, ''), Math.round(b / 1024)]); } catch (e) { /* redirects etc */ } });
      await page.addInitScript(() => { window.__lcp = 0; window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
      let status = 0;
      try { const r = await page.goto(site.base + p, { waitUntil: 'load', timeout: 20000 }); status = r.status(); await page.waitForTimeout(1200); } catch (e) { results.push({ p, error: String(e).slice(0, 80) }); await page.close(); continue; }
      const nav = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), lcp: Math.round(window.__lcp), cls: +window.__cls.toFixed(3) }; });
      let violations = [];
      try {
        await page.evaluate(axeSrc);
        violations = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })).violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, n: v.nodes.length, ex: v.nodes.slice(0, 2).map((x) => x.html.slice(0, 110)), target: v.nodes.slice(0, 2).map((x) => x.target.join(' ')), all: v.nodes.slice(0, 8).map((x) => ({ t: x.target.join(' ').slice(0, 80), h: x.html.slice(0, 140), d: ((x.any && x.any[0]) || {}).data && { fg: x.any[0].data.fgColor, bg: x.any[0].data.bgColor, r: x.any[0].data.contrastRatio, need: x.any[0].data.expectedContrastRatio } })) })));
      } catch (e) { violations = [{ id: 'axe-failed', impact: 'n/a', help: String(e).slice(0, 80), n: 0, ex: [] }]; }
      results.push({ p, status, ...nav, kb: Math.round(bytes / 1024), reqs, big, violations });
      await page.close();
    }
    await ctx.close();
  }
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const f = (l) => (only ? l.filter((p) => only.includes(p)) : l);
  await run(f(GUEST), null); await run(f(USER), reader); await run(f(ADMIN), admin);
  await browser.close(); await site.stop();
  fs.writeFileSync(process.cwd() + '/result.json', JSON.stringify(results, null, 1));
  console.log('done', results.length);
})().catch((e) => { console.error(e); process.exit(1); });
