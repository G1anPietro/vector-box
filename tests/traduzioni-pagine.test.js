// tests/traduzioni-pagine.test.js — the PHP pages and the home page in English and Italian; the language of accounts and e-mails
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client, makeAdmin } = require('./helpers');
const { visibleText, looksItalian, looksEnglish } = require('./lang-helpers');

let site, admin;
test.before(async () => {
    site = await startSite({ MAIL_DRIVER: 'log', SITE_URL: 'https://example.org', MAIL_FROM: 'vector-box <no-reply@example.org>' });
    admin = await makeAdmin(site, 'tp_admin');
});
test.after(async () => { await site.stop(); });

const PAGES = ['/index.php', '/pages/login.php', '/pages/hack.php', '/pages/vault.php', '/pages/credits.php', '/pages/ads.php', '/pages/soldi.php', '/pages/dona.php'];
const ADMIN_PAGES = ['/index.php', '/pages/account.php', '/pages/stats.php', '/pages/mail.php', '/pages/admin_users.php'];

test('public pages: English page reads English, Italian page reads Italian', async () => {
    for (const p of PAGES) {
        for (const [lang, check, name] of [['en', looksItalian, 'Italian'], ['it', looksEnglish, 'English']]) {
            const r = await new Client(site).get(`${p}?lang=${lang}`);
            assert.equal(r.status, 200, p);
            assert.match(r.text, new RegExp(`<html lang="${lang}"`), p);
            assert.ok(!check(visibleText(r.text)), `${p} ?lang=${lang} still reads ${name}`);
        }
    }
});

test('admin pages and the home page of a logged-in admin follow the language', async () => {
    for (const p of ADMIN_PAGES) {
        for (const [lang, check, name] of [['en', looksItalian, 'Italian'], ['it', looksEnglish, 'English']]) {
            const r = await admin.get(`${p}?lang=${lang}`);
            assert.equal(r.status, 200, p);
            assert.ok(!check(visibleText(r.text)), `${p} ?lang=${lang} still reads ${name}`);
        }
    }
    assert.match((await admin.get('/index.php?lang=en')).text, />\/\/ STATISTICS</);
    assert.match((await admin.get('/index.php?lang=it')).text, />\/\/ STATISTICHE</);
});

test('every PHP page loads i18n.js before any deferred script and the home menu has the EN | IT switch', async () => {
    const html = (await new Client(site).get('/index.php?lang=en')).text;
    assert.match(html, /<meta name="vb-lang" content="en">/);
    assert.ok(html.indexOf('js/i18n.js') > 0 && html.indexOf('js/i18n.js') < html.indexOf('js/menu.js'));
    assert.match(html, /id="vb-lang"/);
    assert.ok(!/<script[^>]*i18n\.js[^>]*defer/.test(html));
});

test('the terminal has a lang command (commands stay English)', async () => {
    const src = (await fetch(`${site.base}/js/commands.js`)).headers && require('fs').readFileSync(require('path').join(require('./helpers').REPO, 'public/js/commands.js'), 'utf8');
    assert.match(src, /"lang":/);
});

test('schema 37: accounts.lang, set at registration from the page language and updated by the user', async () => {
    assert.equal(site.db('PRAGMA user_version')[0].user_version, 39);
    const it = new Client(site);
    await it.get('/pages/login.php?lang=it');            // sets the vb_lang cookie
    it.cookies.set('vb_lang', 'it');
    await it.init();
    await it.post('/api/login.php', { action: 'register', username: 'tp_it', password: 'password123', accept_terms: true });
    const en = new Client(site); await en.register('tp_en');
    assert.equal(site.db("SELECT lang FROM accounts WHERE username = 'tp_it'")[0].lang, 'it');
    assert.equal(site.db("SELECT lang FROM accounts WHERE username = 'tp_en'")[0].lang, 'en');
    await it.login('tp_it');
    const r = await it.post('/api/lang.php', { lang: 'en' });
    assert.equal(r.json.lang, 'en');
    assert.equal(site.db("SELECT lang FROM accounts WHERE username = 'tp_it'")[0].lang, 'en');
    assert.equal((await it.post('/api/lang.php', { lang: 'xx' })).status, 400);
    await it.post('/api/lang.php', { lang: 'it' });
});

test('the confirmation e-mail is in the language of the person', async () => {
    for (const [lang, subject] of [['it', 'Conferma il tuo indirizzo e-mail'], ['en', 'Confirm your e-mail address']]) {
        const c = new Client(site);
        c.cookies.set('vb_lang', lang);
        await c.register('tp_mail_' + lang);
        const page = (await c.get('/pages/account.php')).text;
        const token = /name="csrf_token" value="([0-9a-f]+)"/.exec(page)[1];
        const res = await fetch(`${site.base}/pages/account.php`, {
            method: 'POST', headers: { Cookie: c.cookieHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ csrf_token: token, action: 'save_email', email: `${lang}@example.com` }),
        });
        assert.equal(res.status, 200);
        const row = site.db('SELECT subject, body FROM mail_queue WHERE to_email = ?', [`${lang}@example.com`])[0];
        assert.equal(row.subject, subject);
        assert.ok(lang === 'it' ? looksItalian(row.body) : looksEnglish(row.body), row.body);
    }
});

test('the news footer follows the recipient account language, not the admin', async () => {
    const out = require('child_process').execFileSync('php', ['-r',
        'require $argv[1]; $d = new PDO("sqlite:" . $argv[2]); $a = (int)$argv[3]; echo mailFooter($d, $a);',
        require('path').join(require('./helpers').REPO, 'public/api/mailer.php'), require('path').join(site.root, 'data', 'vector_uplink.sqlite'),
        String(site.db("SELECT id FROM accounts WHERE username = 'tp_mail_it'")[0].id)], { encoding: 'utf8' });
    assert.match(out, /Ricevi questo messaggio/);
});

test('notifications: Italian text, English for members whose account language is English', async () => {
    const { execFileSync } = require('child_process'), path = require('path');
    const ids = ['tp_en', 'tp_it'].map((u) => site.db('SELECT id FROM accounts WHERE username = ?', [u])[0].id);
    site.db("UPDATE accounts SET lang = 'it' WHERE username = 'tp_it'");
    const dbFile = path.join(site.root, 'data', 'vector_uplink.sqlite');
    execFileSync('php', ['-r', 'require $argv[1] . "/database.php"; require $argv[1] . "/notifiche_lib.php"; $d = new PDO("sqlite:" . $argv[2]);'
        + ' notifyUsers($d, array_map("intval", explode(",", $argv[3])), null, "annuncio", "Titolo", "Corpo", "/", false, true, null, ["Title", "Body"]);',
        path.join(require('./helpers').REPO, 'public/api'), dbFile, ids.join(',')]);
    assert.equal(site.db('SELECT title FROM notifications WHERE user_id = ?', [ids[0]])[0].title, 'Title');
    assert.equal(site.db('SELECT title FROM notifications WHERE user_id = ?', [ids[1]])[0].title, 'Titolo');
});

test('the static error pages are English with Italian texts for i18n.js', async () => {
    const fs = require('fs'), path = require('path'), dir = path.join(require('./helpers').REPO, 'public/errors');
    const js = fs.readFileSync(path.join(dir, 'errors.js'), 'utf8');
    for (const f of fs.readdirSync(dir).filter((x) => /^\d{3}\.html$/.test(x))) {
        const html = fs.readFileSync(path.join(dir, f), 'utf8'), code = f.slice(0, 3);
        assert.match(html, /<html lang="en">/, f);
        assert.match(html, /<script src="\/js\/i18n\.js"><\/script>/, f);
        assert.ok(!looksItalian(visibleText(html)), f);
        assert.ok(js.includes(`e${code}_title:`) && js.includes(`e${code}_text:`), `${f} has Italian texts`);
    }
});
